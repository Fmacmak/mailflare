import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { generateText, streamText, tool, jsonSchema } from "ai";

const root = process.cwd();
const directory = mkdtempSync(join(root, "node_modules", "mailflare-gateway-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: { contents: `
		export { SqliteDatabase } from "./server/runtime/sqlite-database.ts";
		export { applyMigrations } from "./server/runtime/migrate.ts";
		export { createSession } from "./src/lib/auth/session.ts";
		export { GET, PUT } from "./src/app/api/admin/agent/utils.ts";
		export { POST as models } from "./src/app/api/admin/agent/models/utils.ts";
		export { getAgentModel } from "./src/lib/agent/model.ts";
		export { PROVIDER_PRESETS, baseUrlForPreset } from "./src/app/(admin)/agent/utils.ts";
	`, resolveDir: root },
	outfile: join(directory, "entry.mjs"), bundle: true, platform: "node", format: "esm",
	target: "node24", packages: "external", tsconfig: join(root, "tsconfig.json"),
	alias: { "next/headers": "next/headers.js", "next/server": "next/server.js", "cloudflare:workers": "./server/runtime/cloudflare-workers.ts" }, logLevel: "silent",
});
const { SqliteDatabase, applyMigrations, createSession, GET, PUT, models, getAgentModel, PROVIDER_PRESETS, baseUrlForPreset } = await import(pathToFileURL(join(directory, "entry.mjs")).href);
const gateway = "https://ai-gateway.vercel.sh/v1";
const settings = { provider: "compatible", preset: "vercel", baseUrl: gateway, apiKey: "gateway-test-only", model: "openai/gpt-4o-mini" };
async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec("INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('admin', 'admin@example.test', 'hash', 'Admin', 'admin', 1, 1), ('user', 'user@example.test', 'hash', 'User', 'user', 0, 1)");
	const env = { DB: database, MAILFLARE_RUNTIME: "node" };
	globalThis.__mailflareNodeEnv = env;
	t.after(() => { delete globalThis.__mailflareNodeEnv; });
	const token = await createSession(env, "admin");
	const request = (body, session = token) => new Request("https://mailflare.test/api/admin/agent", { method: "PUT", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
	return { database, env, token, request };
}

test("Vercel AI Gateway is selectable with its fixed compatible endpoint", () => {
	assert.ok(PROVIDER_PRESETS.some((p) => p.id === "vercel" && p.label === "Vercel AI Gateway"));
	assert.equal(baseUrlForPreset("vercel"), gateway);
});

test("admin can save Gateway settings and reuse its secret without exposing it", async (t) => {
	const f = await fixture(t);
	const response = await PUT(f.request({ ...settings, baseUrl: "https://ignored.example.test" }));
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.config.preset, "vercel");
	assert.equal(data.config.baseUrl, gateway);
	assert.equal(data.config.configured, true);
	assert.equal(data.config.hasApiKey, true);
	assert.equal("apiKey" in data.config, false);
	assert.equal(JSON.stringify(data).includes(settings.apiKey), false);
	assert.equal((await PUT(f.request({ ...settings, apiKey: "" }))).status, 200);
	const loaded = await GET(f.request(undefined));
	assert.equal((await loaded.json()).config.preset, "vercel");
	assert.equal((await PUT(f.request({ ...settings, preset: "openai", apiKey: "" }))).status, 400, "another provider must not inherit the Gateway key");
	const userToken = await createSession(f.env, "user");
	assert.equal((await PUT(f.request(settings, userToken))).status, 403);
});

test("Gateway model discovery loads language models and converts published token prices", async (t) => {
	const f = await fixture(t);
	t.mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(url, `${gateway}/models`);
		assert.equal(init.headers.Authorization, `Bearer ${settings.apiKey}`);
		return Response.json({ data: [
			{ id: settings.model, name: "GPT-4o mini", type: "language", pricing: { input: "0.00000015", output: "0.0000006" } },
			{ id: "test/image-model", name: "Image", type: "image" },
			{ id: "test/embed-model", name: "Embedding", type: "embedding" },
			{ id: "test/unpriced", name: "Unpriced", type: "language" },
		] });
	});
	const response = await models(f.request(settings));
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.deepEqual(data.models, [
		{ id: settings.model, name: "GPT-4o mini", rates: { input: 0.15, output: 0.6 } },
		{ id: "test/unpriced", name: "Unpriced" },
	]);
	assert.equal(data.source, "catalog");
});

test("saved Gateway configuration sends AI requests using Gateway authentication and model IDs", async (t) => {
	const f = await fixture(t);
	assert.equal((await PUT(f.request(settings))).status, 200);
	t.mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(String(url), `${gateway}/chat/completions`);
		assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${settings.apiKey}`);
		assert.equal(JSON.parse(init.body).model, settings.model);
		return Response.json({ id: "test", object: "chat.completion", created: 1, model: settings.model, choices: [{ index: 0, message: { role: "assistant", content: "Gateway works." }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } });
	});
	const selected = await getAgentModel(f.env);
	assert.equal(selected.provider, "vercel");
	const result = await generateText({ model: selected.model, prompt: "Test", maxRetries: 0 });
	assert.equal(result.text, "Gateway works.");
});


test("Gateway supports streaming tool calls used by the email assistant", async (t) => {
	const f = await fixture(t);
	assert.equal((await PUT(f.request(settings))).status, 200);
	t.mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(String(url), `${gateway}/chat/completions`);
		const body = JSON.parse(init.body);
		assert.equal(body.stream, true);
		assert.equal(body.tools[0].function.name, "search_mail");
		const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "stream-test", object: "chat.completion.chunk", created: 1, model: settings.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
		return new Response(
			chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call-test", type: "function", function: { name: "search_mail", arguments: '{"query":"invoice"}' } }] }) +
			chunk({}, "tool_calls") + "data: [DONE]\n\n",
			{ headers: { "Content-Type": "text/event-stream" } },
		);
	});
	const selection = await getAgentModel(f.env);
	const result = streamText({ model: selection.model, prompt: "Find my invoice", maxRetries: 0, tools: {
		search_mail: tool({ description: "Search mail", inputSchema: jsonSchema({ type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }) }),
	} });
	const events = [];
	for await (const event of result.fullStream) events.push(event);
	const call = events.find((event) => event.type === "tool-call");
	assert.ok(call, JSON.stringify(events));
	assert.equal(call.toolName, "search_mail");
	assert.deepEqual(call.input, { query: "invoice" });
	assert.equal(events.some((event) => event.type === "error"), false);
});
