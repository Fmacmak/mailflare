import { randomUUID } from 'node:crypto';
import { hashPassword } from '@/lib/auth/password';
import { PostgresDatabase } from './postgres-database';
import type { SqliteDatabase } from './sqlite-database';

export function bootstrapAdmin(database: SqliteDatabase | PostgresDatabase, input: {email:string;password:string;appName?:string;receivingProvider?:"resend"|"cloudflare"}) {
 const email = input.email.trim().toLowerCase();
 if (!/^[a-z0-9][a-z0-9._+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) throw new Error('A valid admin mailbox email is required');
 if (input.password.length < 12 || Buffer.byteLength(input.password) > 72) throw new Error('Admin password must have at least 12 characters and at most 72 bytes');
 const [localPart,hostname] = email.split('@');
 const receivingProvider = input.receivingProvider || 'resend';
 if (!['resend','cloudflare'].includes(receivingProvider)) throw new Error('Receiving provider must be resend or cloudflare');
 const now = Math.floor(Date.now()/1000);
 const userId = `usr_${randomUUID()}`,domainId = `dom_${randomUUID()}`,mailboxId = `mbx_${randomUUID()}`;
 const passwordHash = hashPassword(input.password);
 if (database instanceof PostgresDatabase) return database.transaction(async client => {
  // Serialize initial admin creation across simultaneous bootstrap processes.
  await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
  if ((await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1")).rows.length) throw new Error('An admin already exists; bootstrap will not overwrite this installation');
  const statements = [
   database.prepare("INSERT INTO users (id,email,password_hash,name,role,is_primary_admin,booking_username,created_at) VALUES (?,?,?,?, 'admin',1,?,?)").bind(userId,email,passwordHash,localPart,`user-${randomUUID()}`,now),
   database.prepare("INSERT INTO domains (id,user_id,hostname,zone_id,status,sending_provider,receiving_provider,sending_requested,sending_enabled,routing_enabled,created_at) VALUES (?,?,?,'manual','active','resend',?,1,0,0,?)").bind(domainId,userId,hostname,receivingProvider,now),
   database.prepare("INSERT INTO mailboxes (id,user_id,domain_id,local_part,display_name,created_at) VALUES (?,?,?,?,?,?)").bind(mailboxId,userId,domainId,localPart,localPart,now),
   database.prepare("INSERT INTO app_settings (id,app_name,updated_at) VALUES ('default',?,?) ON CONFLICT(id) DO UPDATE SET app_name=excluded.app_name,updated_at=excluded.updated_at").bind(input.appName?.trim() || 'Mailflare',now),
  ];
  for (const statement of statements) await statement.run(client);
  return {email,domain:hostname};
 });
 database.db.transaction(() => {
  if (database.db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) throw new Error('An admin already exists; bootstrap will not overwrite this installation');
  database.db.prepare("INSERT INTO users (id,email,password_hash,name,role,is_primary_admin,booking_username,created_at) VALUES (?,?,?,?, 'admin',1,?,?)").run(userId,email,passwordHash,localPart,`user-${randomUUID()}`,now);
  database.db.prepare("INSERT INTO domains (id,user_id,hostname,zone_id,status,sending_provider,receiving_provider,sending_requested,sending_enabled,routing_enabled,created_at) VALUES (?,?,?,'manual','active','resend',?,1,0,0,?)").run(domainId,userId,hostname,receivingProvider,now);
  database.db.prepare("INSERT INTO mailboxes (id,user_id,domain_id,local_part,display_name,created_at) VALUES (?,?,?,?,?,?)").run(mailboxId,userId,domainId,localPart,localPart,now);
  database.db.prepare("INSERT INTO app_settings (id,app_name,updated_at) VALUES ('default',?,?) ON CONFLICT(id) DO UPDATE SET app_name=excluded.app_name,updated_at=excluded.updated_at").run(input.appName?.trim() || 'Mailflare',now);
 })();
 return {email,domain:hostname};
}
