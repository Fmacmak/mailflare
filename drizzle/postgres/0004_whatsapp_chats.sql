CREATE TABLE whatsapp_chats (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 jid text NOT NULL,
 name text NOT NULL DEFAULT '',
 updated_at bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, jid)
);
--> statement-breakpoint
CREATE TABLE whatsapp_messages (
 user_id text NOT NULL,
 jid text NOT NULL,
 message_id text NOT NULL,
 from_me integer NOT NULL DEFAULT 0,
 sender text NOT NULL DEFAULT '',
 text_body text NOT NULL DEFAULT '',
 kind text NOT NULL DEFAULT 'text',
 timestamp bigint NOT NULL,
 status integer NOT NULL DEFAULT 0,
 raw_json text,
 PRIMARY KEY (user_id, jid, message_id, from_me),
 FOREIGN KEY (user_id, jid) REFERENCES whatsapp_chats(user_id, jid) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX whatsapp_messages_history_idx ON whatsapp_messages(user_id, jid, timestamp);
