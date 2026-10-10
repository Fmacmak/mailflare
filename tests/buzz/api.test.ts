import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteDatabase } from '../../server/runtime/sqlite-database';
import { handleBuzzConnectionRequest } from '../../src/lib/buzz/api';

test('cross-site session mutations are refused before saving or deleting', async()=>{
 const database=new SqliteDatabase(':memory:');
 database.db.exec('CREATE TABLE buzz_connections (user_id TEXT PRIMARY KEY, team_name TEXT NOT NULL, relay_url TEXT NOT NULL, web_url TEXT NOT NULL, updated_at INTEGER NOT NULL)');
 const env={DB:database as unknown as D1Database};
 for(const method of ['PUT','DELETE']){
  const response=await handleBuzzConnectionRequest(new Request('https://mail.example.com/api/buzz/connection',{method,headers:{Origin:'https://evil.example.com','Sec-Fetch-Site':'cross-site'}}),env,'user-a');
  assert.equal(response.status,403);assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
 assert.equal((database.db.prepare('SELECT count(*) AS count FROM buzz_connections').get() as {count:number}).count,0);
 database.db.close();
});
test('oversized input is rejected and successful authenticated writes stay private',async()=>{
 const database=new SqliteDatabase(':memory:');
 database.db.exec('CREATE TABLE buzz_connections (user_id TEXT PRIMARY KEY, team_name TEXT NOT NULL, relay_url TEXT NOT NULL, web_url TEXT NOT NULL, updated_at INTEGER NOT NULL)');
 const env={DB:database as unknown as D1Database};
 const headers={Origin:'https://mail.example.com','Content-Type':'application/json'};
 const tooLarge=await handleBuzzConnectionRequest(new Request('https://mail.example.com/api/buzz/connection',{method:'PUT',headers,body:JSON.stringify({teamName:'a'.repeat(17000)})}),env,'user-a');
 assert.equal(tooLarge.status,413);
 const saved=await handleBuzzConnectionRequest(new Request('https://mail.example.com/api/buzz/connection',{method:'PUT',headers,body:JSON.stringify({teamName:'Team',webUrl:'https://buzz.example.com',relayUrl:'wss://buzz.example.com'})}),env,'user-a');
 assert.equal(saved.status,200);assert.equal(saved.headers.get('Cache-Control'),'no-store');
 const other=await handleBuzzConnectionRequest(new Request('https://mail.example.com/api/buzz/connection'),env,'user-b');
 assert.deepEqual(await other.json(),{connection:null});
 database.db.close();
});
