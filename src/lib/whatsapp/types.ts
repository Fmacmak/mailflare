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
  chats(userId: string): Promise<WhatsAppChat[]>;
  messages(
    userId: string,
    jid: string,
    before?: number,
  ): Promise<WhatsAppMessage[]>;
  sendText(userId: string, jid: string, text: string): Promise<void>;
  history(userId: string, jid?: string): Promise<void>;
  connect(userId: string): Promise<WhatsAppStatus>;
  disconnect(userId: string): Promise<void>;
}

export type WhatsAppChat = {
  jid: string;
  name: string;
  updatedAt: number;
  preview: string;
};
export type WhatsAppMessage = {
  id: string;
  jid: string;
  fromMe: boolean;
  sender: string;
  text: string;
  kind: string;
  timestamp: number;
  status: number;
};
export function validWhatsAppJid(jid: string): boolean {
  return (
    /^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid) ||
    /^\d+-?\d*@g\.us$/.test(jid)
  );
}
