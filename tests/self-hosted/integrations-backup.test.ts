import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDatabase } from '../../server/runtime/sqlite-database';
import { applyMigrations } from '../../server/runtime/migrate';
import { bootstrapAdmin } from '../../server/runtime/bootstrap';
import { exportDatabaseRecords,restoreDatabaseRecords } from '../../src/lib/backups/export';

test('Buzz workspace survives full backups and legacy backups still restore before and after the migration',async()=>{
 const database=new SqliteDatabase(':memory:');
 const db=database as unknown as D1Database;
 try {
  await applyMigrations(database,'drizzle/migrations');
  await bootstrapAdmin(database,{email:'owner@example.test',password:'a-long-test-password'});
  const {id}=database.db.prepare('SELECT id FROM users').get() as {id:string};
  await db.prepare("INSERT INTO buzz_connections(user_id,team_name,relay_url,web_url,updated_at) VALUES (?, 'Our team', 'wss://buzz.example.test', 'https://buzz.example.test', 1)").bind(id).run();
  const full=await exportDatabaseRecords(db);
  const document=JSON.parse(new TextDecoder().decode(full));
  assert.equal(document.tables.buzz_connections.length,1);
  await restoreDatabaseRecords(db,full.buffer as ArrayBuffer);
  assert.equal(await db.prepare('SELECT team_name FROM buzz_connections').first('team_name'),'Our team');
  delete document.tables.buzz_connections;
  delete document.includedTables;
  const legacy=new TextEncoder().encode(JSON.stringify(document));
  await restoreDatabaseRecords(db,legacy.buffer as ArrayBuffer);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM buzz_connections').first('n'),0);
  database.db.exec('DROP TABLE buzz_connections');
  const before=JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(db)));
  assert.deepEqual(before.tables.buzz_connections,[]);
  await restoreDatabaseRecords(db,legacy.buffer as ArrayBuffer);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM users').first('n'),1);
 } finally {database.db.close();}
});
