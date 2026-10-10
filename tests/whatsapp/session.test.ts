import assert from "node:assert/strict";
import test from "node:test";
const module = await import("../../src/lib/whatsapp/session-manager").catch(() => null);
test("WhatsApp sessions isolate users, deduplicate pairing, and erase QR on connection", async () => {
	assert.equal(typeof module?.WhatsAppSessionManager, "function", "session manager is implemented");
	const callbacks = new Map<string, (event: any) => void>();
	let opens = 0;
	const manager = new module!.WhatsAppSessionManager(
		{
			open: async (id: string, update: any) => {
				opens++;
				callbacks.set(id, update);
				return { close: async () => {}, logout: async () => {} };
			},
			erase: async () => {},
		},
		{ qrTimeoutMs: 1000 },
	);
	await Promise.all([manager.connect("alice"), manager.connect("alice")]);
	assert.equal(opens, 1);
	callbacks.get("alice")!({ qr: "real-pairing-value" });
	assert.equal(manager.status("alice").qr, "real-pairing-value");
	assert.equal(manager.status("bob").qr, null);
	callbacks.get("alice")!({ connected: true, account: "123@s.whatsapp.net" });
	assert.equal(manager.status("alice").qr, null);
	assert.equal(manager.status("alice").state, "connected");
	await manager.close();
});
test("Disconnect removes saved credentials and prevents late socket updates", async () => {
	assert.ok(module);
	let update: any;
	let erased = false;
	let loggedOut = false;
	const manager = new module!.WhatsAppSessionManager({
		open: async (_id: string, cb: any) => {
			update = cb;
			return {
				close: async () => {},
				logout: async () => {
					loggedOut = true;
				},
			};
		},
		erase: async () => {
			erased = true;
		},
	});
	await manager.connect("alice");
	await manager.disconnect("alice");
	update({ connected: true });
	assert.equal(manager.status("alice").state, "disconnected");
	assert.equal(loggedOut, true);
	assert.equal(erased, true);
	await manager.close();
});
test("Expired QR stops pairing without exposing an expired code", async () => {
	assert.ok(module);
	let update: any;
	let closed = false;
	const manager = new module!.WhatsAppSessionManager(
		{
			open: async (_id: string, cb: any) => {
				update = cb;
				return {
					close: async () => {
						closed = true;
					},
					logout: async () => {},
				};
			},
			erase: async () => {},
		},
		{ qrTimeoutMs: 10 },
	);
	await manager.connect("alice");
	update({ qr: "code" });
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(manager.status("alice").qr, null);
	assert.equal(manager.status("alice").state, "expired");
	assert.equal(closed, true);
	await manager.close();
});
test("Session limit and closed service reject new connections", async () => {
	assert.ok(module);
	const manager = new module!.WhatsAppSessionManager(
		{
			open: async () => ({ close: async () => {}, logout: async () => {} }),
			erase: async () => {},
		},
		{ maxSessions: 1 },
	);
	await manager.connect("alice");
	await assert.rejects(manager.connect("bob"), /limit/);
	await manager.close();
	await assert.rejects(manager.connect("bob"), /stopped/);
});
test("Transient closure reconnects and logged-out sessions erase credentials", async () => {
	assert.ok(module);
	const updates: Array<(event: any) => void> = [];
	let erased = 0;
	const manager = new module!.WhatsAppSessionManager(
		{
			open: async (_id: string, cb: any) => {
				updates.push(cb);
				return { close: async () => {}, logout: async () => {} };
			},
			erase: async () => {
				erased++;
			},
		},
		{ reconnectDelayMs: 5 },
	);
	await manager.connect("alice");
	updates[0]({ connected: true });
	updates[0]({ closed: true });
	assert.equal(manager.status("alice").state, "reconnecting");
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(updates.length, 2);
	updates[1]({ closed: true, loggedOut: true });
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(erased, 1);
	assert.equal(manager.status("alice").state, "disconnected");
	await manager.close();
});
test("Old socket events cannot overwrite a newer connection", async () => {
	assert.ok(module);
	const updates: Array<(event: any) => void> = [];
	const manager = new module!.WhatsAppSessionManager(
		{
			open: async (_id: string, cb: any) => {
				updates.push(cb);
				return { close: async () => {}, logout: async () => {} };
			},
			erase: async () => {},
		},
		{ reconnectDelayMs: 1 },
	);
	await manager.connect("alice");
	updates[0]({ closed: true });
	await new Promise((resolve) => setTimeout(resolve, 10));
	updates[1]({ connected: true, account: "new" });
	updates[0]({ qr: "stale" });
	assert.equal(manager.status("alice").state, "connected");
	assert.equal(manager.status("alice").qr, null);
	await manager.close();
});
test("Startup restoration cannot generate a new pairing QR", async () => {
	assert.ok(module);
	let update: any;
	let closed = false;
	const manager = new module!.WhatsAppSessionManager({
		open: async (_id: string, cb: any) => {
			update = cb;
			return {
				close: async () => {
					closed = true;
				},
				logout: async () => {},
			};
		},
		erase: async () => {},
	});
	await manager.connect("alice", false);
	update({ qr: "requires-new-scan" });
 await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(manager.status("alice").qr, null);
	assert.equal(manager.status("alice").state, "disconnected");
	assert.equal(closed, true);
	await manager.close();
});
test("Reconnect waits until concurrent disconnect finishes erasing credentials", async () => {
	assert.ok(module);
	let opens = 0;
	let release!: () => void;
	let erased = false;
	const manager = new module!.WhatsAppSessionManager({
		open: async () => {
			opens++;
			return {
				close: async () => {},
				logout: async () => {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				},
			};
		},
		erase: async () => {
			erased = true;
		},
	});
	await manager.connect("alice");
	const disconnect = manager.disconnect("alice");
	await new Promise((resolve) => setTimeout(resolve, 0));
	const reconnect = manager.connect("alice");
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(opens, 1);
	release();
	await disconnect;
	await reconnect;
	assert.equal(erased, true);
	assert.equal(opens, 2);
	await manager.close();
});
test("Invalid session limits fail closed", () => {
	assert.ok(module);
	const transport = {
		open: async () => ({ close: async () => {}, logout: async () => {} }),
		erase: async () => {},
	};
	for (const value of [NaN, Infinity, 0, -1, 1.5, 21])
		assert.throws(
			() => new module!.WhatsAppSessionManager(transport, { maxSessions: value }),
			/integer between 1 and 20/,
		);
});
test("A failed transport startup exposes a safe retryable error", async () => {
	assert.ok(module);
	const manager = new module!.WhatsAppSessionManager({
		open: async () => {
			throw new Error("secret provider exception");
		},
		erase: async () => {},
	});
	await manager.connect("alice");
	assert.equal(manager.status("alice").state, "error");
	assert.equal(manager.status("alice").qr, null);
	assert.equal(manager.status("alice").error, "Unable to connect to WhatsApp. Try again.");
	await manager.close();
});
test("New pairing waits for an expired socket to finish closing", async () => {
	assert.ok(module);
	let update: any;
	let opens = 0;
	let release!: () => void;
	const manager = new module!.WhatsAppSessionManager(
		{
			open: async (_id: string, cb: any) => {
				opens++;
				update = cb;
				return {
					close: async () => {
						if (opens === 1)
							await new Promise<void>((resolve) => {
								release = resolve;
							});
					},
					logout: async () => {},
				};
			},
			erase: async () => {},
		},
		{ qrTimeoutMs: 5 },
	);
	await manager.connect("alice");
	update({ qr: "code" });
	await new Promise((resolve) => setTimeout(resolve, 15));
	const next = manager.connect("alice");
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(opens, 1);
	release();
	await next;
	assert.equal(opens, 2);
	await manager.close();
});
