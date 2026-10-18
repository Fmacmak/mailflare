import { proto, type WAMessage, type WAMessageKey } from "baileys";
import type {
  WhatsAppChat,
  WhatsAppMessage,
} from "../../src/lib/whatsapp/types";

import { validWhatsAppJid } from "../../src/lib/whatsapp/types";
export function normalizeWhatsAppMessage(
  message: WAMessage,
): WhatsAppMessage | null {
  const { key } = message;
  const jid = key.remoteJid;
  if (!jid || !key.id || !validWhatsAppJid(jid)) return null;
  let content = message.message;
  for (let i = 0; i < 5; i++) {
    const wrapped =
      content?.ephemeralMessage?.message ??
      content?.viewOnceMessage?.message ??
      content?.viewOnceMessageV2?.message ??
      content?.documentWithCaptionMessage?.message;
    if (!wrapped) break;
    content = wrapped;
  }
  if (!content) return null;
  let text = content.conversation ?? content.extendedTextMessage?.text ?? "";
  let kind = "text";
  for (const [key, label] of [
    ["imageMessage", "Image"],
    ["videoMessage", "Video"],
    ["audioMessage", "Voice message"],
    ["documentMessage", "Document"],
    ["stickerMessage", "Sticker"],
    ["contactMessage", "Contact"],
    ["locationMessage", "Location"],
  ] as const) {
    if (content[key]) {
      kind = key.replace("Message", "");
      text =
        (content[key] as { caption?: string; fileName?: string }).caption ||
        (content[key] as { fileName?: string }).fileName ||
        label;
      break;
    }
  }
  if (!text) return null; // Protocol, key distribution and other control events are not chat messages.
  const timestamp = Number(
    message.messageTimestamp ?? Math.floor(Date.now() / 1000),
  );
  return {
    id: key.id,
    jid,
    fromMe: !!key.fromMe,
    sender: message.pushName || key.participant || "",
    text,
    kind,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    status: Number(message.status || 0),
  };
}
type Row = {
  message_id: string;
  jid: string;
  from_me: number;
  sender: string;
  text_body: string;
  kind: string;
  timestamp: number;
  status: number;
};
export class WhatsAppMessages {
  constructor(private readonly db: D1Database) {}
  async chat(userId: string, jid: string, name = "", timestamp = 0) {
    if (!validWhatsAppJid(jid)) return;
    await this.db
      .prepare(
        "INSERT INTO whatsapp_chats(user_id,jid,name,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,jid) DO UPDATE SET name=CASE WHEN excluded.name <> '' THEN excluded.name ELSE whatsapp_chats.name END, updated_at=CASE WHEN excluded.updated_at > whatsapp_chats.updated_at THEN excluded.updated_at ELSE whatsapp_chats.updated_at END",
      )
      .bind(userId, jid, name, timestamp)
      .run();
  }
  async ingest(userId: string, messages: WAMessage[]) {
    // Sequential writes keep parent/child inserts and history duplicates deterministic.
    for (const raw of messages) {
      const m = normalizeWhatsAppMessage(raw);
      if (!m) continue;
      await this.chat(userId, m.jid, "", m.timestamp);
      await this.db
        .prepare(
          "INSERT INTO whatsapp_messages(user_id,jid,message_id,from_me,sender,text_body,kind,timestamp,status,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,jid,message_id,from_me) DO UPDATE SET text_body=excluded.text_body, kind=excluded.kind, raw_json=excluded.raw_json, status=CASE WHEN excluded.status > whatsapp_messages.status THEN excluded.status ELSE whatsapp_messages.status END",
        )
        .bind(
          userId,
          m.jid,
          m.id,
          m.fromMe ? 1 : 0,
          m.sender,
          m.text,
          m.kind,
          m.timestamp,
          m.status,
          JSON.stringify(proto.Message.fromObject(raw.message || {}).toJSON()),
        )
        .run();
    }
  }
  async chats(userId: string): Promise<WhatsAppChat[]> {
    const rows = await this.db
      .prepare(
        "SELECT c.jid,c.name,c.updated_at,(SELECT text_body FROM whatsapp_messages m WHERE m.user_id=c.user_id AND m.jid=c.jid ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS preview FROM whatsapp_chats c WHERE user_id=? ORDER BY updated_at DESC,jid LIMIT 500",
      )
      .bind(userId)
      .all<{
        jid: string;
        name: string;
        updated_at: number;
        preview: string | null;
      }>();
    return rows.results.map((r) => ({
      jid: r.jid,
      name: r.name || r.jid.split("@")[0],
      updatedAt: Number(r.updated_at),
      preview: r.preview || "",
    }));
  }
  async messages(
    userId: string,
    jid: string,
    before?: number,
  ): Promise<WhatsAppMessage[]> {
    const rows = await this.db
      .prepare(
        "SELECT message_id,jid,from_me,sender,text_body,kind,timestamp,status FROM whatsapp_messages WHERE user_id=? AND jid=?" +
          (before !== undefined ? " AND timestamp < ?" : "") +
          " ORDER BY timestamp DESC,message_id DESC LIMIT 100",
      )
      .bind(userId, jid, ...(before !== undefined ? [before] : []))
      .all<Row>();
    return rows.results
      .reverse()
      .map((r) => ({
        id: r.message_id,
        jid: r.jid,
        fromMe: !!r.from_me,
        sender: r.sender,
        text: r.text_body,
        kind: r.kind,
        timestamp: Number(r.timestamp),
        status: Number(r.status),
      }));
  }
  async oldest(userId: string, jid: string) {
    return this.db
      .prepare(
        "SELECT message_id AS id, timestamp, from_me FROM whatsapp_messages WHERE user_id=? AND jid=? ORDER BY timestamp,message_id LIMIT 1",
      )
      .bind(userId, jid)
      .first<{ id: string; timestamp: number; from_me: number }>();
  }
  async raw(userId: string, key: WAMessageKey) {
    const row = await this.db
      .prepare(
        "SELECT raw_json FROM whatsapp_messages WHERE user_id=? AND jid=? AND message_id=? AND from_me=?",
      )
      .bind(userId, key.remoteJid || "", key.id || "", key.fromMe ? 1 : 0)
      .first<{ raw_json: string | null }>();
    return row?.raw_json ? JSON.parse(row.raw_json) : undefined;
  }
  async update(userId: string, key: WAMessageKey, status: number) {
    await this.db
      .prepare(
        "UPDATE whatsapp_messages SET status=? WHERE user_id=? AND jid=? AND message_id=? AND from_me=? AND status < ?",
      )
      .bind(
        status,
        userId,
        key.remoteJid || "",
        key.id || "",
        key.fromMe ? 1 : 0,
        status,
      )
      .run();
  }
  async remove(userId: string, keys: WAMessageKey[]) {
    for (const key of keys)
      await this.db
        .prepare(
          "UPDATE whatsapp_messages SET text_body='Message deleted',kind='deleted',raw_json=NULL WHERE user_id=? AND jid=? AND message_id=? AND from_me=?",
        )
        .bind(userId, key.remoteJid || "", key.id || "", key.fromMe ? 1 : 0)
        .run();
  }
  async erase(userId: string) {
    await this.db
      .prepare("DELETE FROM whatsapp_chats WHERE user_id=?")
      .bind(userId)
      .run();
  }
}
