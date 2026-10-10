import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteDatabase } from '../../server/runtime/sqlite-database';
import { parseBuzzConnection, probeBuzzRelay } from '../../src/lib/buzz/connection';
import { getBuzzConnection, saveBuzzConnection, disconnectBuzzConnection } from '../../src/lib/buzz/service';

test('accepts same-origin secure Buzz workspace and local native development', () => {
 assert.deepEqual(parseBuzzConnection({teamName:'  Team  ',relayUrl:'wss://buzz.example.com/',webUrl:'https://buzz.example.com/'}), {teamName:'Team',relayUrl:'wss://buzz.example.com/',webUrl:'https://buzz.example.com/'});
 assert.equal(parseBuzzConnection({teamName:'Local',relayUrl:'ws://127.0.0.1:3200',webUrl:'http://127.0.0.1:3200'}).webUrl,'http://127.0.0.1:3200/');
});
test('rejects credentials, unsafe transports, non-workspace paths and mismatched hosts', () => {
 for(const [relayUrl, webUrl] of [['ws://example.com','http://example.com'],['wss://user:password@example.com','https://example.com'],['wss://example.com?token=secret','https://example.com'],['wss://example.com','https://other.example.com'],['wss://example.com','javascript:alert(1)'],['wss://example.com/admin','https://example.com']]) {
  assert.throws(()=>parseBuzzConnection({teamName:'Team',relayUrl,webUrl}));
 }
 assert.throws(()=>parseBuzzConnection({teamName:' ',relayUrl:'wss://example.com',webUrl:'https://example.com'}));
});
test('public relay verification validates NIP-11 identity and never authenticates or posts', async () => {
 let captured: {url: string; init?: RequestInit} | undefined;
 const reachable=await probeBuzzRelay('wss://buzz.example.com/', async (url,init)=>{captured={url:String(url),init};return new Response(JSON.stringify({software:'https://github.com/block/buzz',supported_nips:[1,42],name:'Team'}));});
 assert.equal(reachable.name,'Team');
 assert.equal(captured?.url,'https://buzz.example.com/');
 assert.equal(captured?.init?.credentials,'omit');
 assert.equal((captured?.init?.headers as Record<string,string>).Accept,'application/nostr+json');
 await assert.rejects(()=>probeBuzzRelay('wss://buzz.example.com/',async()=>new Response(JSON.stringify({software:'other',supported_nips:[1]}))),/Buzz/);
 await assert.rejects(()=>probeBuzzRelay('wss://buzz.example.com/',async()=>new Response('no',{status:500})),/500/);
});
test('saved workspaces belong only to their user and disconnect retains other users', async () => {
 const db=new SqliteDatabase(':memory:');
 db.db.exec('CREATE TABLE buzz_connections (user_id TEXT PRIMARY KEY, team_name TEXT NOT NULL, relay_url TEXT NOT NULL, web_url TEXT NOT NULL, updated_at INTEGER NOT NULL)');
 const env={DB:db as unknown as D1Database};
 const connection=parseBuzzConnection({teamName:'Team',relayUrl:'wss://buzz.example.com',webUrl:'https://buzz.example.com'});
 await saveBuzzConnection(env,'user-a',connection);
 assert.equal((await getBuzzConnection(env,'user-a'))?.teamName,'Team');
 assert.equal(await getBuzzConnection(env,'user-b'),null);
 await saveBuzzConnection(env,'user-b',{...connection,teamName:'Other'});
 await saveBuzzConnection(env,'user-a',{...connection,teamName:'Renamed'});
 assert.equal((await getBuzzConnection(env,'user-a'))?.teamName,'Renamed');
 await disconnectBuzzConnection(env,'user-a');
 assert.equal(await getBuzzConnection(env,'user-a'),null);
 assert.equal((await getBuzzConnection(env,'user-b'))?.teamName,'Other');
 db.db.close();
});
