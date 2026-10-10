export type WhatsAppState =
	| "disconnected"
	| "connecting"
	| "pairing"
	| "connected"
	| "reconnecting"
	| "expired"
	| "error";
export type WhatsAppStatus = {
	available: boolean;
	state: WhatsAppState;
	account: string | null;
	qrDataUrl: string | null;
	error: string | null;
};
export interface WhatsAppService {
	status(userId: string): Promise<WhatsAppStatus>;
	connect(userId: string): Promise<WhatsAppStatus>;
	disconnect(userId: string): Promise<void>;
}
