import type { WhatsAppState } from "./types";
export type SocketUpdate = {
	qr?: string;
	connected?: boolean;
	account?: string;
	closed?: boolean;
	loggedOut?: boolean;
	restartRequired?: boolean;
};
export type SessionSocket = { close(): Promise<void>; logout(): Promise<void> };
export type SessionTransport = {
	open(userId: string, update: (event: SocketUpdate) => void): Promise<SessionSocket>;
	erase(userId: string): Promise<void>;
};
type Session = {
	state: WhatsAppState;
	qr: string | null;
	account: string | null;
	error: string | null;
	socket?: SessionSocket;
	opening?: Promise<void>;
	timer?: ReturnType<typeof setTimeout>;
	attempts: number;
	stopped: boolean;
	generation: number;
	allowPairing: boolean;
	pairingDeadline?: number;
};
export class WhatsAppSessionManager {
	private readonly sessions = new Map<string, Session>();
	private stopped = false;
	private readonly operations = new Map<string, Promise<void>>();
	private async serialized(userId: string, operation: () => Promise<void>) {
		const previous = this.operations.get(userId) ?? Promise.resolve();
		const current = previous.catch(() => {}).then(operation);
		this.operations.set(userId, current);
		try {
			await current;
		} finally {
			if (this.operations.get(userId) === current) this.operations.delete(userId);
		}
	}
	constructor(
		private readonly transport: SessionTransport,
		private readonly options: {
			qrTimeoutMs?: number;
			maxSessions?: number;
			reconnectDelayMs?: number;
		} = {},
	) {
		const max = options.maxSessions ?? 10;
		if (!Number.isInteger(max) || max < 1 || max > 20)
			throw new Error("WHATSAPP_MAX_SESSIONS must be an integer between 1 and 20");
	}
	status(userId: string) {
		const s = this.sessions.get(userId);
		return {
			state: s?.state ?? ("disconnected" as WhatsAppState),
			qr: s?.qr ?? null,
			account: s?.account ?? null,
			error: s?.error ?? null,
		};
	}
	async connect(userId: string, allowPairing = true): Promise<void> {
		return this.serialized(userId, () => this.connectSession(userId, allowPairing));
	}
	private async connectSession(userId: string, allowPairing: boolean): Promise<void> {
		if (this.stopped) throw new Error("WhatsApp service is stopped");
		let s = this.sessions.get(userId);
		if (
			s &&
			!s.stopped &&
			["connecting", "pairing", "connected", "reconnecting"].includes(s.state)
		) {
			await s.opening;
			return;
		}
		if (
			[...this.sessions.values()].filter((entry) => !entry.stopped).length >=
			(this.options.maxSessions ?? 10)
		)
			throw new Error("WhatsApp connection limit reached");
		s = {
			state: "connecting",
			qr: null,
			account: null,
			error: null,
			attempts: 0,
			stopped: false,
			generation: 0,
			allowPairing,
		};
		this.sessions.set(userId, s);
		await this.open(userId, s);
	}
	private async open(userId: string, s: Session): Promise<void> {
		const generation = ++s.generation;
		const opening = (async () => {
			try {
				const socket = await this.transport.open(userId, (event) => {
					if (s.generation === generation) this.update(userId, s, event);
				});
				if (s.stopped) await socket.close();
				else s.socket = socket;
			} catch {
				if (!s.stopped) {
					s.state = "error";
					s.error = "Unable to connect to WhatsApp. Try again.";
					s.stopped = true;
					s.qr = null;
				}
			}
		})();
		s.opening = opening;
		await opening;
		if (s.opening === opening) s.opening = undefined;
	}
	private update(userId: string, s: Session, event: SocketUpdate) {
		if (s.stopped || this.sessions.get(userId) !== s) return;
		if (event.connected) {
			clearTimeout(s.timer);
			s.state = "connected";
			s.qr = null;
			s.account = event.account ?? null;
			s.attempts = 0;
			return;
		}
		if (event.qr) {
			if (!s.allowPairing) {
				s.state = "disconnected";
				s.qr = null;
				s.stopped = true;
				void this.serialized(userId, async () => {
					await s.socket?.close().catch(() => {});
				}).catch(() => {});
				return;
			}
			clearTimeout(s.timer);
			s.state = "pairing";
			s.qr = event.qr;
			s.pairingDeadline ??= Date.now() + (this.options.qrTimeoutMs ?? 120000);
			s.timer = setTimeout(
				() => {
					s.state = "expired";
					s.qr = null;
					s.stopped = true;
					void this.serialized(userId, async () => {
						await s.socket?.close().catch(() => {});
					}).catch(() => {});
				},
				Math.max(0, s.pairingDeadline - Date.now()),
			);
			s.timer.unref?.();
			return;
		}
		if (event.closed) {
			clearTimeout(s.timer);
			s.qr = null;
			if (event.loggedOut) {
				s.state = "disconnected";
				s.account = null;
				s.stopped = true;
				void this.serialized(userId, async () => {
					await s.socket?.close().catch(() => {});
					await this.transport.erase(userId);
				}).catch(() => {});
				return;
			}
			if (++s.attempts > 5) {
				s.state = "error";
				s.error = "Connection lost. Connect again to retry.";
				s.stopped = true;
				void this.serialized(userId, async () => {
					await s.socket?.close().catch(() => {});
				}).catch(() => {});
				return;
			}
			s.state = "reconnecting";
			s.timer = setTimeout(
				() => {
					if (!s.stopped)
						void (async () => {
							await s.socket?.close().catch(() => {});
							if (!s.stopped) await this.open(userId, s);
						})();
				},
				event.restartRequired
					? 100
					: Math.min((this.options.reconnectDelayMs ?? 1000) * 2 ** (s.attempts - 1), 30000),
			);
			s.timer.unref?.();
		}
	}
	async disconnect(userId: string) {
		return this.serialized(userId, () => this.disconnectSession(userId));
	}
	private async disconnectSession(userId: string) {
		const s = this.sessions.get(userId);
		if (s) {
			s.stopped = true;
			clearTimeout(s.timer);
			await s.opening;
			s.state = "disconnected";
			s.qr = null;
			s.account = null;
			s.error = null;
			try {
				await s.socket?.logout();
			} catch {
				await s.socket?.close().catch(() => {});
			}
		}
		await this.transport.erase(userId);
		this.sessions.delete(userId);
	}
	async close() {
		this.stopped = true;
		await Promise.allSettled(this.operations.values());
		await Promise.all(
			[...this.sessions.values()].map(async (s) => {
				s.stopped = true;
				clearTimeout(s.timer);
				s.qr = null;
				await s.opening;
				await s.socket?.close().catch(() => {});
			}),
		);
	}
}
