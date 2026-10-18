import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "../../server/runtime/sqlite-database";
import { applyMigrations } from "../../server/runtime/migrate";
import { bootstrapAdmin } from "../../server/runtime/bootstrap";
import {
  exportDatabaseRecords,
  restoreDatabaseRecords,
} from "../../src/lib/backups/export";
const module = await import("../../server/runtime/whatsapp-messages").catch(
  () => null,
);
test("WhatsApp history is idempotent, ordered, isolated by owner and included in restorable backups", async () => {
  assert.ok(
    module?.WhatsAppMessages,
    "persistent WhatsApp messages are implemented",
  );
  const database = new SqliteDatabase(":memory:");
  const db = database as unknown as D1Database;
  try {
    await applyMigrations(database, "drizzle/migrations");
    await bootstrapAdmin(database, {
      email: "admin@example.test",
      password: "long-test-password",
    });
    const owner = await db.prepare("SELECT id FROM users").first<string>("id");
    const store = new module!.WhatsAppMessages(db);
    const message = (id: string, time: number, text: string) => ({
      key: { id, remoteJid: "123@s.whatsapp.net", fromMe: false },
      messageTimestamp: time,
      message: { conversation: text },
      pushName: "Alice",
    });
    await store.ingest(owner!, [
      message("b", 2, "second"),
      message("a", 1, "first"),
    ]);
    await store.ingest(owner!, [message("b", 2, "second")]);
    assert.equal((await store.chats(owner!)).length, 1);
    assert.deepEqual(
      (await store.messages(owner!, "123@s.whatsapp.net")).map((m) => m.text),
      ["first", "second"],
    );
    assert.equal(
      (await store.messages(owner!, "123@s.whatsapp.net", 2)).length,
      1,
    );
    assert.deepEqual(await store.chats("someone-else"), []);
    assert.deepEqual(
      await store.messages("someone-else", "123@s.whatsapp.net"),
      [],
    );
    const full = await exportDatabaseRecords(db);
    const doc = JSON.parse(new TextDecoder().decode(full));
    assert.equal(doc.tables.whatsapp_messages.length, 2);
    await restoreDatabaseRecords(db, full.buffer as ArrayBuffer);
    assert.equal(
      (await store.messages(owner!, "123@s.whatsapp.net")).length,
      2,
    );
    await store.remove(owner!, [
      { id: "b", remoteJid: "123@s.whatsapp.net", fromMe: false },
    ]);
    assert.equal(
      (await store.messages(owner!, "123@s.whatsapp.net")).at(-1)?.text,
      "Message deleted",
    );
    delete doc.tables.whatsapp_messages;
    delete doc.tables.whatsapp_chats;
    delete doc.includedTables;
    const legacy = new TextEncoder().encode(JSON.stringify(doc));
    await restoreDatabaseRecords(db, legacy.buffer as ArrayBuffer);
    assert.deepEqual(await store.chats(owner!), []);
    database.db.exec("DROP TABLE whatsapp_messages; DROP TABLE whatsapp_chats");
    await assert.rejects(
      () => restoreDatabaseRecords(db, full.buffer as ArrayBuffer),
      /Apply pending database migrations/,
    );
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(db)))
        .tables.whatsapp_chats,
      [],
    );
    await restoreDatabaseRecords(db, legacy.buffer as ArrayBuffer);
  } finally {
    database.db.close();
  }
});
test("Message normalization unwraps ephemeral text, preserves captions and excludes status broadcasts", async () => {
  assert.ok(module?.normalizeWhatsAppMessage, "normalizer is implemented");
  const base = {
    key: { id: "a", remoteJid: "123@s.whatsapp.net" },
    messageTimestamp: 1,
  };
  assert.equal(
    module!.normalizeWhatsAppMessage({
      ...base,
      message: {
        ephemeralMessage: {
          message: { extendedTextMessage: { text: "hello" } },
        },
      },
    })?.text,
    "hello",
  );
  assert.equal(
    module!.normalizeWhatsAppMessage({
      ...base,
      message: { imageMessage: { caption: "caption" } },
    })?.text,
    "caption",
  );
  assert.equal(
    module!.normalizeWhatsAppMessage({
      ...base,
      key: { ...base.key, remoteJid: "status@broadcast" },
      message: { conversation: "status" },
    }),
    null,
  );
});
