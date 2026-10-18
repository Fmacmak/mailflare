import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq, and, like } from 'drizzle-orm';
import { PostgresDatabase } from '../../server/runtime/postgres-database';
import { SqliteDatabase } from '../../server/runtime/sqlite-database';
import { applyMigrations } from '../../server/runtime/migrate';
import { bootstrapAdmin } from '../../server/runtime/bootstrap';
import { WhatsAppMessages } from '../../server/runtime/whatsapp-messages';
import { createDb } from '../../src/db';
import { users,mailboxes,messages,domains,appSettings } from '../../src/db/schema';
import { exportDatabaseRecords,restoreDatabaseRecords } from '../../src/lib/backups/export';
import { buildSearchConditions } from '../../src/lib/search/conditions';
import { getMigrationStatus,applyPendingMigrations } from '../../src/lib/migrations/service';
import { loadConversationPage } from '../../src/app/api/messages/utils';
import { applySpamFeedback } from '../../src/lib/spam/feedback';
import { recordReputationObservation } from '../../src/lib/spam/repository';
import { createBookedCalendarEvents } from '../../src/lib/booking/create';
import type { BookingEventRecord } from '../../src/lib/booking/types';
import { getSearchIndexStatus,rebuildSearchIndex } from '../../src/lib/search/index-admin';

// An isolated schema, deleted afterwards. Never uses or truncates public tables.
const connection = process.env.MAILFLARE_TEST_DATABASE_URL;
if(!connection) throw new Error('Set MAILFLARE_TEST_DATABASE_URL to a local test PostgreSQL database');
test('PostgreSQL migrations, D1/Drizzle mapping, search, triggers, rollback, SQLite backup import and restore', async () => {
 const root=new Pool({connectionString:connection});
 const namespace=`mailflare_test_${randomUUID().replaceAll('-','')}`;
 await root.query(`CREATE SCHEMA "${namespace}"`);
 const url=new URL(connection!);url.searchParams.set('options',`-c search_path=${namespace}`);
 const database=new PostgresDatabase(url.toString());
 const d1=database as unknown as D1Database;
 const previous=globalThis.__mailflareNodeEnv;
 globalThis.__mailflareNodeEnv={DB:d1,MAILFLARE_RUNTIME:'node'} as CloudflareEnv;
 const sqlite=new SqliteDatabase(':memory:');
 try {
  assert.equal((await getMigrationStatus(d1)).ready,false);
  assert.equal((await applyMigrations(database,'drizzle/migrations')).length,5);
  assert.deepEqual(await applyMigrations(database,'drizzle/migrations'),[]);
  assert.equal((await getMigrationStatus(d1)).ready,true);
  assert.deepEqual((await applyPendingMigrations(d1)).applied,[]);
  await applyMigrations(sqlite,'drizzle/migrations');
  const tables=(sqlite.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'messages_fts%' AND name <> 'd1_migrations'").all() as {name:string}[]).map(row=>row.name);
  for(const table of tables) {
   const sqliteColumns=(sqlite.db.pragma(`table_info(${table})`) as {name:string}[]).map(column=>column.name).sort();
   const pgColumns=(await database.pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',[table])).rows.map(row=>row.column_name).sort();
   assert.deepEqual(pgColumns,sqliteColumns,`PostgreSQL schema drift in ${table}; add an explicit migration`);
  }
  const input={email:'owner@example.test',password:'a-long-test-password',appName:'Postgres Mail'};
  assert.equal((await bootstrapAdmin(database,input)).email,input.email);
  await assert.rejects(async()=>bootstrapAdmin(database,input),/already exists/);
  const db=createDb(d1);
  await db.insert(appSettings).values({id:'default',resendApiKey:'integration-test-placeholder',updatedAt:new Date()}).onConflictDoUpdate({target:appSettings.id,set:{resendApiKey:'integration-test-placeholder',updatedAt:new Date()}});
  assert.equal(await d1.prepare('SELECT resend_api_key FROM app_settings WHERE id=?').bind('default').first('resend_api_key'),'integration-test-placeholder');
  const [user]=await db.select().from(users);
  assert.equal(user.isPrimaryAdmin,true);assert.equal(user.disabled,false);assert.ok(user.createdAt instanceof Date);
  const [mailbox]=await db.select().from(mailboxes);
  const joined=await db.select({mailbox:mailboxes,user:users,domain:domains}).from(mailboxes).innerJoin(users,eq(users.id,mailboxes.userId)).innerJoin(domains,eq(domains.id,mailboxes.domainId));
  assert.equal(joined[0].user.email,input.email);assert.equal(joined[0].mailbox.id,mailbox.id);
  await db.insert(messages).values([
   {id:'pg_m1',userId:user.id,mailboxId:mailbox.id,direction:'inbound',status:'received',subject:'Invoice for June',fromAddr:'Maya <maya@acme.test>',toAddr:'owner@example.test',textBody:'Please pay the invoice promptly',threadId:'pg_thread',read:false,createdAt:new Date('2026-06-01T10:00:00Z')},
   {id:'pg_m2',userId:user.id,mailboxId:mailbox.id,direction:'inbound',status:'received',subject:'Weekend meeting',fromAddr:'sam@example.test',toAddr:'owner@example.test',textBody:'Please confirm café',read:true,createdAt:new Date('2026-06-02T10:00:00Z')},
  ]).returning();
  assert.equal((await db.select().from(messages).where(like(messages.subject,'%INVOICE%'))).length,1);
  const search=async(q:string)=>(await db.select({id:messages.id}).from(messages).where(and(...buildSearchConditions(q)))).map(row=>row.id).sort();
  assert.deepEqual(await search('inv from:maya'),['pg_m1']);
  assert.deepEqual(await search('from:maya@acme.test'),['pg_m1']);
  assert.deepEqual(await search('"pay the invoice" is:unread'),['pg_m1']);
  assert.deepEqual(await search('-invoice'),['pg_m2']);
  assert.deepEqual(await search('cafe'),['pg_m2']);
  assert.deepEqual(await search('café'),['pg_m2']);
  assert.deepEqual(await search('subject:weekend to:owner'),['pg_m2']);
  assert.deepEqual(await loadConversationPage({db,where:undefined,offset:0,limit:10}),{ids:['pg_m2','pg_m1'],total:2});
  assert.deepEqual(await getSearchIndexStatus(globalThis.__mailflareNodeEnv),{indexed:2,messages:2});
  await rebuildSearchIndex(globalThis.__mailflareNodeEnv);
  await db.update(messages).set({subject:'Updated receipt',textBody:'Payment complete',status:'trash'}).where(eq(messages.id,'pg_m1'));
  assert.deepEqual(await search('invoice'),[]);
  assert.deepEqual(await search('receipt'),['pg_m1']);
  const trash=await d1.prepare('SELECT trashed_at FROM messages WHERE id=?').bind('pg_m1').first<{trashed_at:number}>();
  assert.ok(trash!.trashed_at>0);
  const revision=await d1.prepare('SELECT revision FROM jmap_mailbox_revisions WHERE mailbox_id=?').bind(mailbox.id).first<{revision:number}>();assert.ok(revision!.revision>=3);
  await assert.rejects(()=>d1.batch([d1.prepare("UPDATE app_settings SET app_name='rolled back'"),d1.prepare('INSERT INTO users(id) VALUES (?)').bind('invalid')]),/null value/);
  assert.equal(await d1.prepare('SELECT app_name FROM app_settings').first('app_name'),'Postgres Mail');
  const event = {name:'Intro',hostIds:[user.id],location:'Online',color:'#123456',timeZone:'UTC'} as BookingEventRecord;
  assert.equal(await createBookedCalendarEvents(globalThis.__mailflareNodeEnv,event,'Guest','guest@example.test','2026-12-01T10:00:00Z','2026-12-01T10:30:00Z'),true);
  assert.equal(await createBookedCalendarEvents(globalThis.__mailflareNodeEnv,event,'Guest','guest@example.test','2026-12-01T10:00:00Z','2026-12-01T10:30:00Z'),false);
  await recordReputationObservation(globalThis.__mailflareNodeEnv,mailbox.id,[{type:'domain',key:'acme.test'}]);
  await recordReputationObservation(globalThis.__mailflareNodeEnv,mailbox.id,[{type:'domain',key:'acme.test'}]);
  assert.equal(await applySpamFeedback(globalThis.__mailflareNodeEnv,user,'pg_m1','spam'),true);
  assert.equal(await applySpamFeedback(globalThis.__mailflareNodeEnv,user,'pg_m1','ham'),true);
  await d1.batch([
   d1.prepare("INSERT INTO drive_items(id,owner_id,kind,name,created_at,updated_at) VALUES ('pg_drive',?,'file','demo.txt',1,1)").bind(user.id),
   d1.prepare("INSERT INTO drive_shares(id,item_id,user_id,created_at) VALUES ('pg_share','pg_drive',?,1)").bind(user.id),
   d1.prepare("INSERT INTO drive_upload_parts(item_id,part_number,etag) VALUES ('pg_drive',1,'test-etag')"),
  ]);
  await d1.prepare("INSERT INTO buzz_connections(user_id,team_name,relay_url,web_url,updated_at) VALUES (?,'PG team','wss://buzz.example.test','https://buzz.example.test',1)").bind(user.id).run();
  const whatsapp=new WhatsAppMessages(d1);
  await whatsapp.ingest(user.id,[{key:{id:'test_wa_message',remoteJid:'123@s.whatsapp.net',fromMe:false},messageTimestamp:123,message:{conversation:'PostgreSQL chat check'}}]);
  assert.equal((await whatsapp.chats(user.id)).length,1);
  assert.equal((await whatsapp.messages(user.id,'123@s.whatsapp.net'))[0].text,'PostgreSQL chat check');
  const pgBackup=await exportDatabaseRecords(d1);
  await restoreDatabaseRecords(d1,pgBackup.buffer as ArrayBuffer);
  assert.equal((await db.select().from(messages)).length,2);
  assert.equal((await whatsapp.messages(user.id,'123@s.whatsapp.net')).length,1);
  assert.equal(await d1.prepare('SELECT count(*) FROM drive_upload_parts').first('count'),1);
  assert.equal(await d1.prepare('SELECT team_name FROM buzz_connections').first('team_name'),'PG team');
  assert.deepEqual(await search('receipt'),['pg_m1']);
  await applyMigrations(sqlite,'drizzle/migrations');await bootstrapAdmin(sqlite,{...input,appName:'Imported from SQLite'});
  const sqliteBackup=await exportDatabaseRecords(sqlite as unknown as D1Database);
  await restoreDatabaseRecords(d1,sqliteBackup.buffer as ArrayBuffer);
  assert.equal(await d1.prepare('SELECT app_name FROM app_settings').first('app_name'),'Imported from SQLite');
  assert.equal((await db.select().from(users)).length,1);
 } finally {
  globalThis.__mailflareNodeEnv=previous;sqlite.db.close();await database.close();
  await root.query(`DROP SCHEMA "${namespace}" CASCADE`);await root.end();
 }
});
