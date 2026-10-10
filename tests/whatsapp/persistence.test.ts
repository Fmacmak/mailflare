import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const storage = await import("../../server/runtime/whatsapp-storage").catch(() => null);
test("WhatsApp credential paths cannot escape private user directories and owner manifests persist", async () => {
	assert.equal(typeof storage?.WhatsAppStorage, "function", "storage is implemented");
	const dir = await mkdtemp(join(tmpdir(), "whatsapp-test-"));
	try {
		const store = new storage!.WhatsAppStorage(dir);
		const user = "../not-a-path";
		const path = await store.prepare(user);
		assert.equal(path.startsWith(join(dir, "whatsapp") + "/"), true);
		assert.equal(path.includes("not-a-path"), false);
		assert.equal((await stat(path)).mode & 0o777, 0o700);
		assert.equal((await stat(join(path, "owner.json"))).mode & 0o777, 0o600);
		assert.deepEqual(await store.owners(), [user]);
		assert.equal(JSON.parse(await readFile(join(path, "owner.json"), "utf8")).userId, user);
		await store.erase(user);
		assert.deepEqual(await store.owners(), []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
