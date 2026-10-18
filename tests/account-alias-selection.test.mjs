import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mailflare-account-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./server/runtime/sqlite-database.ts";
			export { applyMigrations } from "./server/runtime/migrate.ts";
			export { getDb } from "./src/db/index.ts";
			export { createSession, getUserFromSession } from "./src/lib/auth/session.ts";
			export { verifyPassword } from "./src/lib/auth/password.ts";
			export { getMailboxAccessLevel } from "./src/lib/mailboxes/access.ts";
			export { generateApiKey } from "./src/lib/api-keys.ts";
			export { createUserAccountSchema } from "./src/lib/validators.ts";
			export { POST as dashboardCreate } from "./src/app/api/accounts/route.ts";
			export { POST as apiCreate } from "./src/app/api/v1/accounts/route.ts";
			export { registerAdminMcpTools } from "./src/lib/mcp/admin-tools.ts";
			export { getMailboxDomainAddresses } from "./src/lib/mailboxes/domain-addresses.ts";
			export { resolveInboundAddress } from "./src/lib/email/routing.ts";
			export { getAuthorizedSenderAddress } from "./src/lib/email/sender.ts";
		`,
		resolveDir: root,
		sourcefile: "account-alias-test-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "next/headers": "next/headers.js", "next/server": "next/server.js", "cloudflare:workers": "./server/runtime/cloudflare-workers.ts" },
	logLevel: "silent",
});
const {
	SqliteDatabase, applyMigrations, getDb, createSession, getUserFromSession, verifyPassword, getMailboxAccessLevel, generateApiKey, createUserAccountSchema,
	dashboardCreate, apiCreate, registerAdminMcpTools, getMailboxDomainAddresses, resolveInboundAddress, getAuthorizedSenderAddress,
} = await import(pathToFileURL(join(directory, "entry.mjs")).href);
const key = generateApiKey();

async function fixture(t, { rules = [], failAddress, slowAddress } = {}) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
			('admin', 'owner@one.test', 'hash', 'Owner', 'admin', 1),
			('other', 'owner@foreign.test', 'hash', 'Other', 'admin', 1);
		UPDATE users SET is_primary_admin = 1 WHERE id = 'admin';
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES
			('one', 'admin', 'one.test', 'zone-one', 'active', 1),
			('two', 'admin', 'two.test', 'zone-two', 'active', 1),
			('pending', 'admin', 'pending.test', 'zone-pending', 'pending', 1),
			('foreign', 'other', 'foreign.test', 'zone-foreign', 'active', 1);
		INSERT INTO license_settings (id, instance_id, plan, state, features, updated_at)
			VALUES ('default', 'test-instance', 'team', 'active', '[]', 1);
	`);
	database.db.prepare("INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.run("key", "admin", "Test", key.prefix, key.hash, '["accounts"]', 1);
	const env = { DB: database, CF_TOKEN: "test-only", MAILFLARE_RUNTIME: "node" };
	globalThis.__mailflareNodeEnv = env;
	t.after(() => { delete globalThis.__mailflareNodeEnv; });
	const session = await createSession(env, "admin");
	const currentRules = structuredClone(rules);
	const calls = [];
	let nextRule = 0;
	t.mock.method(globalThis, "fetch", async (url, init = {}) => {
		const parsed = new URL(url);
		assert.equal(parsed.origin, "https://api.cloudflare.com", "tests must never contact a real service");
		const match = parsed.pathname.match(/^\/client\/v4\/zones\/([^/]+)\/email\/routing\/rules(?:\/([^/]+))?$/);
		assert.ok(match, parsed.pathname);
		const [, zoneId, ruleId] = match;
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(init.body) : null;
		calls.push({ method, zoneId, ruleId, body });
		if (method === "GET") return Response.json({ success: true, result: structuredClone(currentRules.filter((rule) => rule.zoneId === zoneId)) });
		const address = body?.matchers?.[0]?.value;
		if (slowAddress && address === slowAddress) await new Promise((resolve) => setTimeout(resolve, 20));
		if (failAddress && address === failAddress) return Response.json({ success: false, errors: [{ message: "Simulated routing failure" }] }, { status: 502 });
		if (method === "POST") {
			const rule = { ...body, id: `new-${++nextRule}`, zoneId };
			currentRules.push(rule);
			return Response.json({ success: true, result: rule });
		}
		const index = currentRules.findIndex((rule) => rule.id === ruleId && rule.zoneId === zoneId);
		assert.notEqual(index, -1);
		if (method === "DELETE") currentRules.splice(index, 1);
		if (method === "PUT") currentRules[index] = { ...body, id: ruleId, zoneId };
		return Response.json({ success: true, result: currentRules[index] ?? null });
	});
	const post = (kind, overrides = {}, token) => {
		const handler = kind === "dashboard" ? dashboardCreate : apiCreate;
		return handler(new Request(`https://mailflare.test/api/${kind === "dashboard" ? "" : "v1/"}accounts`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token ?? (kind === "dashboard" ? session : key.fullKey)}`, "Content-Type": "application/json" },
			body: JSON.stringify({ username: "sam", domainId: "one", password: "test-password", ...overrides }),
		}));
	};
	const mailbox = () => {
		const row = database.db.prepare("SELECT * FROM mailboxes WHERE local_part = 'sam'").get();
		return row && { id: row.id, userId: row.user_id, domainId: row.domain_id, localPart: row.local_part, useAllDomains: !!row.use_all_domains };
	};
	return { database, env, db: getDb(env), post, mailbox, calls, currentRules };
}

for (const kind of ["dashboard", "api"]) {
	test(`${kind}: primary-only creation does not grant addresses on other domains`, async (t) => {
		const f = await fixture(t);
		assert.equal((await f.post(kind, { useAllDomains: false })).status, 201);
		const mailbox = f.mailbox();
		assert.ok(f.database.db.prepare("SELECT booking_username FROM users WHERE id = ?").get(mailbox.userId).booking_username);
		assert.equal(mailbox.useAllDomains, false);
		assert.deepEqual(await getMailboxDomainAddresses(f.db, mailbox), ["sam@one.test"]);
		assert.equal((await resolveInboundAddress(f.db, "sam@one.test")).mailbox.mailboxId, mailbox.id);
		assert.equal(await resolveInboundAddress(f.db, "sam@two.test"), null);
		await assert.rejects(getAuthorizedSenderAddress(f.env, { userId: mailbox.userId, mailboxId: mailbox.id, from: "sam@two.test" }), /Sender address/);
		assert.deepEqual(f.calls.filter((call) => call.method === "POST").map((call) => call.body.matchers[0].value), ["sam@one.test"]);
	});

	test(`${kind}: explicit aliases receive and send through the same mailbox`, async (t) => {
		const f = await fixture(t);
		const response = await f.post(kind, { useAllDomains: false, aliases: [{ domainId: "two", localPart: " Sales " }, { domainId: "one", localPart: "support" }] });
		assert.equal(response.status, 201);
		const body = await response.json();
		assert.equal(body.account.email, "sam@one.test");
		assert.equal("passwordHash" in body.account, false);
		const mailbox = f.mailbox();
		assert.deepEqual((await getMailboxDomainAddresses(f.db, mailbox)).sort(), ["sales@two.test", "sam@one.test", "support@one.test"]);
		assert.equal((await resolveInboundAddress(f.db, "sales@two.test")).mailbox.mailboxId, mailbox.id);
		assert.equal((await getAuthorizedSenderAddress(f.env, { userId: mailbox.userId, mailboxId: mailbox.id, from: "sales@two.test" })).mailboxId, mailbox.id);
		assert.equal(await resolveInboundAddress(f.db, "sam@two.test"), null);
		f.database.db.exec("INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('later', 'admin', 'later.test', 'manual', 'active', 1)");
		assert.equal(await resolveInboundAddress(f.db, "sam@later.test"), null);
		assert.equal((await getMailboxDomainAddresses(f.db, mailbox)).includes("sam@later.test"), false);
	});
}

test("omitted settings preserve API compatibility; opting in includes future domains", async (t) => {
	const f = await fixture(t);
	assert.equal((await f.post("api")).status, 201);
	assert.equal(f.mailbox().useAllDomains, true);
	assert.deepEqual(await getMailboxDomainAddresses(f.db, f.mailbox()), ["sam@one.test", "sam@two.test"]);
	f.database.db.exec("INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('later', 'admin', 'later.test', 'manual', 'active', 1)");
	assert.equal((await resolveInboundAddress(f.db, "sam@later.test")).mailbox.mailboxId, f.mailbox().id);
	assert.equal((await f.post("dashboard", { username: "jane", useAllDomains: true, aliases: [{ domainId: "two", localPart: "billing" }] })).status, 201);
	const address = await resolveInboundAddress(f.db, "billing@two.test");
	assert.equal(address.mailbox.localPart, "jane");
});

test("admin MCP forwards alias selection to the same account creation handler", async (t) => {
	const f = await fixture(t);
	const handlers = new Map();
	registerAdminMcpTools({ registerTool: (name, _schema, handler) => handlers.set(name, handler) }, { scopes: ["accounts"] }, "https://mailflare.test", `Bearer ${key.fullKey}`);
	const result = await handlers.get("manage_accounts")({ action: "create", data: { username: "sam", domainId: "one", password: "test-password", useAllDomains: false, aliases: [{ domainId: "two", localPart: "sales" }] } });
	assert.equal(result.isError, false);
	assert.equal(JSON.parse(result.content[0].text).status, 201);
	assert.deepEqual((await getMailboxDomainAddresses(f.db, f.mailbox())).sort(), ["sales@two.test", "sam@one.test"]);
});

test("invalid, duplicate, foreign, and inactive aliases fail before provisioning", async (t) => {
	const f = await fixture(t);
	for (const aliases of [
		[{ domainId: "one", localPart: "s.a.m+tag" }],
		[{ domainId: "two", localPart: "sales" }, { domainId: "two", localPart: "SALES" }],
		[{ domainId: "foreign", localPart: "sales" }],
		[{ domainId: "pending", localPart: "sales" }],
		[{ domainId: "missing", localPart: "sales" }],
		[{ domainId: "two", localPart: "not an address" }],
		[{ domainId: "two", localPart: "+tag" }],
	]) {
		assert.equal((await f.post("api", { useAllDomains: false, aliases })).status, 400, JSON.stringify(aliases));
	}
	assert.equal(f.calls.length, 0);
	assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM users").get().count, 2);
	assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM mailbox_aliases").get().count, 0);
});

test("mailbox and alias conflicts include normalized primary addresses", async (t) => {
	const f = await fixture(t);
	f.database.db.exec(`
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('existing', 'admin', 'two', 'sales', 1);
		INSERT INTO mailbox_aliases (id, mailbox_id, domain_id, local_part, created_at) VALUES ('alias', 'existing', 'one', 'support', 1);
	`);
	for (const input of [
		{ aliases: [{ domainId: "two", localPart: "s.a.l.e.s+tag" }] },
		{ aliases: [{ domainId: "one", localPart: "SUPPORT" }] },
		{ username: "support" },
		{ username: "s.u.p.p.o.r.t+tag" },
	]) assert.equal((await f.post("dashboard", { useAllDomains: false, ...input })).status, 409);
	assert.equal(f.calls.length, 0);
	assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM users").get().count, 2);
});

test("explicit addresses take precedence over implicit all-domain aliases", async (t) => {
	const f = await fixture(t);
	f.database.db.exec("INSERT INTO mailboxes (id, user_id, domain_id, local_part, use_all_domains, created_at) VALUES ('existing', 'admin', 'one', 'sales', 1, 1)");
	assert.equal((await f.post("api", { useAllDomains: false, aliases: [{ domainId: "two", localPart: "sales" }] })).status, 201);
	assert.equal((await resolveInboundAddress(f.db, "sales@two.test")).mailbox.mailboxId, f.mailbox().id);
	assert.equal((await resolveInboundAddress(f.db, "sales@one.test")).mailbox.mailboxId, "existing");
});

test("database failures leave no partial account, aliases, or routing rules", async (t) => {
	const f = await fixture(t);
	f.database.db.exec("CREATE TRIGGER fail_alias BEFORE INSERT ON mailbox_aliases WHEN NEW.local_part = 'alias40' BEGIN SELECT RAISE(ABORT, 'Simulated insert failure'); END");
	const aliases = Array.from({ length: 41 }, (_, i) => ({ domainId: "two", localPart: `alias${i}` }));
	assert.equal((await f.post("api", { useAllDomains: false, aliases })).status, 502);
	assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM users").get().count, 2);
	assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM mailboxes").get().count, 0);
	assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM mailbox_aliases").get().count, 0);
	assert.equal(f.calls.length, 0);
});

function workerRule(id, address, enabled) {
	return { id, zoneId: "zone-one", enabled, name: "Existing route", priority: 20, actions: [{ type: "worker", value: ["mailflare"] }], matchers: [{ type: "literal", field: "to", value: address }] };
}

for (const enabled of [true, false]) {
	test(`routing failure cleans up completed requests and preserves a previously ${enabled ? "enabled" : "disabled"} rule`, async (t) => {
		const original = workerRule("old", "sam@one.test", enabled);
		const f = await fixture(t, { rules: [original], failAddress: "broken@two.test", slowAddress: "slow@two.test" });
		const response = await f.post("api", { useAllDomains: false, aliases: [{ domainId: "two", localPart: "slow" }, { domainId: "two", localPart: "broken" }] });
		assert.equal(response.status, 502);
		assert.deepEqual(f.currentRules, [original]);
		assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM users").get().count, 2);
		assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM mailboxes").get().count, 0);
		assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM mailbox_aliases").get().count, 0);
		assert.ok(f.calls.some((call) => call.method === "DELETE"), "a successfully provisioned alias must be rolled back");
	});
}

test("account creation enforces authorization without requiring a license", async (t) => {
	const f = await fixture(t);
	assert.equal((await f.post("api", {}, "invalid-test-key")).status, 401);
	assert.equal((await f.post("dashboard", {}, "invalid-test-session")).status, 403);
	assert.equal(f.calls.length, 0);
	f.database.db.exec("DELETE FROM license_settings");
	assert.equal((await f.post("api", { username: "alice" })).status, 201);
	assert.equal((await f.post("dashboard", { username: "bob" })).status, 201);
});

test("legacy license state and seat limits do not restrict new accounts", async (t) => {
	const f = await fixture(t);
	for (const [index, state] of ["inactive", "active", "expired"].entries()) {
		f.database.db.prepare("UPDATE license_settings SET plan = 'pro', state = ?, seat_limit = 0").run(state);
		assert.equal((await f.post("dashboard", { username: `person${index}` })).status, 201);
	}
});

test("new email accounts have independent passwords, sessions, and private mailboxes", async (t) => {
	const f = await fixture(t);
	f.database.db.exec("UPDATE license_settings SET state = 'inactive'");
	const accounts = [];
	for (const username of ["alice", "bob"]) {
		const password = `${username}-private-password`;
		const response = await f.post("dashboard", { username, password, useAllDomains: false });
		assert.equal(response.status, 201);
		assert.equal("passwordHash" in (await response.json()).account, false);
		const row = f.database.db.prepare("SELECT * FROM users WHERE email = ?").get(`${username}@one.test`);
		assert.equal(verifyPassword(password, row.password_hash), true);
		assert.equal(verifyPassword("someone-elses-password", row.password_hash), false);
		const session = await createSession(f.env, row.id);
		const user = await getUserFromSession(f.env, session);
		assert.equal(user.email, `${username}@one.test`);
		assert.equal(user.role, "user");
		assert.equal((await f.post("dashboard", { username: "unauthorized" }, session)).status, 403);
		const mailbox = f.database.db.prepare("SELECT id FROM mailboxes WHERE user_id = ?").get(row.id);
		accounts.push({ user, mailbox });
	}
	for (const [index, account] of accounts.entries()) {
		assert.equal((await getMailboxAccessLevel(f.db, account.user, account.mailbox.id)).isOwner, true);
		assert.equal(await getMailboxAccessLevel(f.db, account.user, accounts[1 - index].mailbox.id), null);
	}
});

for (const separateDomains of [false, true]) {
	test(`more than 50 aliases on ${separateDomains ? "separate domains" : "one domain"} stay within database parameter limits`, async (t) => {
		const f = await fixture(t);
		f.database.db.exec("UPDATE domains SET zone_id = 'manual'");
		const aliases = Array.from({ length: 125 }, (_, i) => ({ domainId: separateDomains ? `domain${i}` : "two", localPart: `alias${i}` }));
		if (separateDomains) {
			const insert = f.database.db.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES (?, 'admin', ?, 'manual', 'active', 1)");
			for (const alias of aliases) insert.run(alias.domainId, `${alias.domainId}.test`);
		}
		const prepare = f.database.prepare.bind(f.database);
		t.mock.method(f.database, "prepare", (query) => {
			const statement = prepare(query);
			const bind = statement.bind.bind(statement);
			statement.bind = (...values) => {
				assert.ok(values.length <= 100, "each statement must fit D1's 100-parameter limit");
				return bind(...values);
			};
			return statement;
		});
		assert.equal((await f.post("api", { useAllDomains: false, aliases })).status, 201);
		assert.equal(f.database.db.prepare("SELECT count(*) AS count FROM mailbox_aliases").get().count, 125);
		assert.equal((await getMailboxDomainAddresses(f.db, f.mailbox())).length, 126);
		assert.equal(f.calls.length, 0);
	});
}

test("the all-domain boolean rejects truthy strings", () => {
	const input = { username: "sam", domainId: "one", password: "test-password" };
	assert.equal(createUserAccountSchema.safeParse({ ...input, useAllDomains: "false" }).success, false);
});
