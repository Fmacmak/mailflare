import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteDatabase } from '../../server/runtime/sqlite-database';
import { applyMigrations } from '../../server/runtime/migrate';
import { verifyPassword } from '../../src/lib/auth/password';
const mod = await import('../../server/runtime/bootstrap');
test('fresh self-hosted bootstrap creates a Resend mailbox atomically without DNS calls and refuses to overwrite it', async () => {
 assert.equal(typeof mod?.bootstrapAdmin,'function');
 const database = new SqliteDatabase(':memory:');
 try {
  await applyMigrations(database,'drizzle/migrations');
  const result = await mod!.bootstrapAdmin(database,{email:'owner@example.test',password:'a-long-test-password',appName:'Test Mail'});
  assert.equal(result.email,'owner@example.test');
  const user = database.db.prepare('SELECT * FROM users').get() as {password_hash:string;role:string};
  assert.equal(user.role,'admin'); assert.ok(verifyPassword('a-long-test-password',user.password_hash));
  const domain = database.db.prepare('SELECT * FROM domains').get() as {sending_provider:string;receiving_provider:string};
  assert.equal(domain.sending_provider,'resend');assert.equal(domain.receiving_provider,'resend');
  assert.equal((database.db.prepare('SELECT app_name FROM app_settings').get() as {app_name:string}).app_name,'Test Mail');
  assert.throws(()=>mod!.bootstrapAdmin(database,{email:'another@example.test',password:'a-long-test-password'}),/already exists/);
  assert.equal((database.db.prepare('SELECT count(*) AS n FROM users').get() as {n:number}).n,1);
 } finally {database.db.close();}
});

test('bootstrap can select Cloudflare receiving while keeping Resend sending', async () => {
 const database = new SqliteDatabase(':memory:');
 try {
  await applyMigrations(database,'drizzle/migrations');
  await mod!.bootstrapAdmin(database,{email:'owner@example.test',password:'a-long-test-password',receivingProvider:'cloudflare'});
  const domain = database.db.prepare('SELECT sending_provider,receiving_provider FROM domains').get();
  assert.deepEqual(domain,{sending_provider:'resend',receiving_provider:'cloudflare'});
 } finally {database.db.close();}
});
