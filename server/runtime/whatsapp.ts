import makeWASocket, {
	DisconnectReason,
	useMultiFileAuthState as loadMultiFileAuthState,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { WhatsAppSessionManager } from "../../src/lib/whatsapp/session-manager";
import type { WhatsAppService, WhatsAppStatus } from "../../src/lib/whatsapp/types";
import { WhatsAppStorage } from "./whatsapp-storage";

/** One local process owns every socket. Auth files remain inside mode-0700 user folders. */
export class WhatsAppRegistry implements WhatsAppService {
	private readonly storage: WhatsAppStorage;
	private readonly manager: WhatsAppSessionManager;
	constructor(dataDir: string, maxSessions = 10) {
		this.storage = new WhatsAppStorage(dataDir);
		this.manager = new WhatsAppSessionManager(
			{
				erase: (userId) => this.storage.erase(userId),
				open: async (userId, update) => {
					const dir = await this.storage.prepare(userId);
					const { state, saveCreds } = await loadMultiFileAuthState(dir);
					const sock = makeWASocket({
						auth: state,
						logger: pino({ level: "silent" }),
						browser: ["Mailflare", "Chrome", "1.0"],
						syncFullHistory: false,
						markOnlineOnConnect: false,
						connectTimeoutMs: 30000,
						qrTimeout: 60000,
					});
					let stopped = false;
					let saves = Promise.resolve();
					sock.ev.on("creds.update", () => {
						if (!stopped)
							saves = saves
								.then(() => saveCreds())
								.catch(() => {
									sock.end(new Error("Unable to persist session"));
								});
					});
					sock.ev.on("connection.update", (event) => {
						if (stopped) return;
						if (event.qr) update({ qr: event.qr });
						if (event.connection === "open")
							update({ connected: true, account: sock.user?.id?.split(":")[0]?.split("@")[0] });
						if (event.connection === "close") {
							const error = event.lastDisconnect?.error as
								| { output?: { statusCode?: number } }
								| undefined;
							const code = error?.output?.statusCode;
							// A logged-out credential directory must not race a pending credentials write.
							void saves.then(() =>
								update({
									closed: true,
									loggedOut: code === DisconnectReason.loggedOut,
									restartRequired: code === DisconnectReason.restartRequired,
								}),
							);
						}
					});
					const stop = async () => {
						stopped = true;
						sock.ev.removeAllListeners("connection.update");
						sock.ev.removeAllListeners("creds.update");
						sock.end(undefined);
						await saves;
					};
					return {
						close: stop,
						logout: async () => {
							stopped = true;
							try {
								await sock.logout();
							} finally {
								await stop();
							}
						},
					};
				},
			},
			{ maxSessions },
		);
	}
	async restore(shouldRestore: (userId: string) => Promise<boolean> = async () => true) {
		for (const owner of await this.storage.owners()) {
			if (!(await shouldRestore(owner))) {
				await this.storage.erase(owner);
				continue;
			}
			if (await this.storage.isPaired(owner)) {
				try {
					await this.manager.connect(owner, false);
				} catch {
					/* A configured session limit may skip extra saved sessions. */
				}
			}
		}
	}
	async status(userId: string): Promise<WhatsAppStatus> {
		const { qr, ...status } = this.manager.status(userId);
		return {
			...status,
			available: true,
			qrDataUrl: qr
				? await QRCode.toDataURL(qr, { width: 300, margin: 2, errorCorrectionLevel: "M" })
				: null,
		};
	}
	async connect(userId: string) {
		await this.manager.connect(userId);
		return this.status(userId);
	}
	async disconnect(userId: string) {
		await this.manager.disconnect(userId);
	}
	async close() {
		await this.manager.close();
	}
}
