import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState as loadMultiFileAuthState,
  proto,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { WhatsAppSessionManager } from "../../src/lib/whatsapp/session-manager";
import type {
  WhatsAppService,
  WhatsAppStatus,
} from "../../src/lib/whatsapp/types";
import { WhatsAppMessages } from "./whatsapp-messages";
import { WhatsAppStorage } from "./whatsapp-storage";

/** One local process owns every socket. Auth files remain inside mode-0700 user folders. */
export class WhatsAppRegistry implements WhatsAppService {
  private readonly storage: WhatsAppStorage;
  private readonly manager: WhatsAppSessionManager;
  private readonly messagesStore: WhatsAppMessages;
  constructor(dataDir: string, maxSessions = 10, database: D1Database) {
    this.messagesStore = new WhatsAppMessages(database);
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
            syncFullHistory: true,
            getMessage: async (key) => {
              const raw = await this.messagesStore.raw(userId, key);
              return raw ? proto.Message.fromObject(raw) : undefined;
            },
            markOnlineOnConnect: false,
            connectTimeoutMs: 30000,
            qrTimeout: 60000,
          });
          let stopped = false;
          let saves = Promise.resolve();
          let events = Promise.resolve();
          const persist = (operation: () => Promise<void>) => {
            if (stopped) return;
            events = events.then(operation).catch(() => {
              console.error(
                "WhatsApp chat persistence failed; check database availability.",
              );
            });
          };
          const namedGroups = new Set<string>();
          const loadGroupNames = (jids: string[]) => {
            for (const jid of new Set(jids)) {
              if (!jid.endsWith("@g.us") || namedGroups.has(jid)) continue;
              namedGroups.add(jid);
              void sock
                .groupMetadata(jid)
                .then((group) =>
                  persist(() =>
                    this.messagesStore.chat(userId, jid, group.subject || ""),
                  ),
                )
                .catch(() => {});
            }
          };
          sock.ev.on("groups.upsert", (groups) =>
            persist(async () => {
              for (const group of groups)
                await this.messagesStore.chat(
                  userId,
                  group.id,
                  group.subject || "",
                );
            }),
          );
          sock.ev.on("groups.update", (groups) =>
            persist(async () => {
              for (const group of groups)
                if (group.id)
                  await this.messagesStore.chat(
                    userId,
                    group.id,
                    group.subject || "",
                  );
            }),
          );
          sock.ev.on("messaging-history.set", ({ chats, contacts, messages }) =>
            persist(async () => {
              for (const chat of chats)
                await this.messagesStore.chat(
                  userId,
                  chat.id || "",
                  chat.name || "",
                  Number(chat.conversationTimestamp || 0),
                );
              for (const c of contacts)
                await this.messagesStore.chat(
                  userId,
                  c.id || "",
                  c.name || c.notify || "",
                );
              await this.messagesStore.ingest(userId, messages);
              loadGroupNames(
                chats.filter((c) => !c.name).map((c) => c.id || ""),
              );
            }),
          );
          sock.ev.on("messages.upsert", ({ messages }) => {
            persist(() => this.messagesStore.ingest(userId, messages));
            loadGroupNames(messages.map((m) => m.key.remoteJid || ""));
          });
          sock.ev.on("chats.upsert", (chats) =>
            persist(async () => {
              for (const c of chats)
                await this.messagesStore.chat(
                  userId,
                  c.id || "",
                  c.name || "",
                  Number(c.conversationTimestamp || 0),
                );
            }),
          );
          sock.ev.on("chats.update", (chats) =>
            persist(async () => {
              for (const c of chats)
                await this.messagesStore.chat(
                  userId,
                  c.id || "",
                  c.name || "",
                  Number(c.conversationTimestamp || 0),
                );
            }),
          );
          sock.ev.on("contacts.upsert", (contacts) =>
            persist(async () => {
              for (const c of contacts)
                await this.messagesStore.chat(
                  userId,
                  c.id || "",
                  c.name || c.notify || "",
                );
            }),
          );
          sock.ev.on("messages.update", (updates) =>
            persist(async () => {
              for (const { key, update } of updates) {
                if (update.status != null)
                  await this.messagesStore.update(userId, key, update.status);
                if (update.message === null)
                  await this.messagesStore.remove(userId, [key]);
                else if (update.message)
                  await this.messagesStore.ingest(userId, [{ key, ...update }]);
              }
            }),
          );
          sock.ev.on("messages.delete", (event) =>
            persist(async () => {
              if ("keys" in event)
                await this.messagesStore.remove(userId, event.keys);
              else if (event.all)
                await this.messagesStore.chat(userId, event.jid);
            }),
          );
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
              update({
                connected: true,
                account: sock.user?.id?.split(":")[0]?.split("@")[0],
              });
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
            await events;
          };
          return {
            close: stop,
            sendText: async (jid, text) => {
              const sent = await sock.sendMessage(jid, { text });
              if (!sent) throw new Error("WhatsApp did not accept the message");
              // Delivery happened even if persistence fails: do not encourage a duplicate retry.
              persist(() => this.messagesStore.ingest(userId, [sent]));
              await events;
            },
            history: async (jid) => {
              if (!jid) {
                await sock.sendPeerDataOperationMessage({
                  peerDataOperationRequestType:
                    proto.Message.PeerDataOperationRequestType
                      .FULL_HISTORY_SYNC_ON_DEMAND,
                  fullHistorySyncOnDemandRequest: {
                    requestMetadata: { requestId: crypto.randomUUID() },
                    historySyncConfig: {
                      fullSyncDaysLimit: 90,
                      fullSyncSizeMbLimit: 100,
                      storageQuotaMb: 100,
                      onDemandReady: true,
                      completeOnDemandReady: true,
                    },
                  },
                });
                return;
              }
              const oldest = await this.messagesStore.oldest(userId, jid);
              if (!oldest)
                throw new Error("No message available for history request");
              await sock.fetchMessageHistory(
                50,
                { remoteJid: jid, id: oldest.id, fromMe: !!oldest.from_me },
                oldest.timestamp,
              );
            },
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
  async restore(
    shouldRestore: (userId: string) => Promise<boolean> = async () => true,
  ) {
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
        ? await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            errorCorrectionLevel: "M",
          })
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
  async chats(userId: string) {
    return this.messagesStore.chats(userId);
  }
  async messages(userId: string, jid: string, before?: number) {
    return this.messagesStore.messages(userId, jid, before);
  }
  async sendText(userId: string, jid: string, text: string) {
    await this.manager.sendText(userId, jid, text);
  }
  async history(userId: string, jid?: string) {
    await this.manager.history(userId, jid);
  }
  async close() {
    await this.manager.close();
  }
}
