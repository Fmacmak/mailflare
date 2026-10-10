import type { WhatsAppService } from "./types";
declare global {
	var __mailflareWhatsApp: WhatsAppService | undefined;
}
export function getWhatsAppRegistry(): WhatsAppService | undefined {
	return globalThis.__mailflareWhatsApp;
}
export function setWhatsAppRegistry(service: WhatsAppService | undefined): void {
	globalThis.__mailflareWhatsApp = service;
}
