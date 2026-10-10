import assert from "node:assert/strict";
import test from "node:test";
const api = await import("../../src/lib/whatsapp/api").catch(() => null);
test("Disabled WhatsApp reports availability and rejects connection attempts", async () => {
	assert.equal(typeof api?.handleWhatsAppRequest, "function", "API policy is implemented");
	const get = await api!.handleWhatsAppRequest(
		new Request("http://localhost/api/whatsapp"),
		"alice",
		undefined,
	);
	assert.equal(get.headers.get("Cache-Control"), "no-store");
	assert.equal(((await get.json()) as { available: boolean }).available, false);
	const post = await api!.handleWhatsAppRequest(
		new Request("http://localhost/api/whatsapp", {
			method: "POST",
			headers: { Origin: "http://localhost" },
		}),
		"alice",
		undefined,
	);
	assert.equal(post.status, 503);
});
test("WhatsApp API prevents cross-site mutations and dispatches only the authenticated user ID", async () => {
	assert.ok(api);
	const ids: string[] = [];
	const service = {
		status: async (id: string) => {
			ids.push(id);
			return {
				available: true,
				state: "disconnected",
				qrDataUrl: null,
				account: null,
				error: null,
			};
		},
		connect: async (id: string) => {
			ids.push(id);
			return { available: true, state: "connecting", qrDataUrl: null, account: null, error: null };
		},
		disconnect: async (id: string) => {
			ids.push(id);
		},
	} as any;
	const denied = await api!.handleWhatsAppRequest(
		new Request("http://localhost/api/whatsapp", {
			method: "POST",
			headers: { Origin: "http://other" },
		}),
		"alice",
		service,
	);
	assert.equal(denied.status, 403);
	assert.deepEqual(ids, []);
	const accepted = await api!.handleWhatsAppRequest(
		new Request("http://localhost/api/whatsapp", {
			method: "POST",
			headers: { Origin: "http://localhost" },
			body: JSON.stringify({ userId: "bob" }),
		}),
		"alice",
		service,
	);
	assert.equal(accepted.status, 200);
	assert.deepEqual(ids, ["alice"]);
});
