import assert from 'node:assert/strict';
import test from 'node:test';
import { readBuzzRuntimeConfig } from '../../deploy/buzz/config.mjs';
const valid={BUZZ_SOURCE_DIR:'/opt/buzz',BUZZ_DATA_DIR:'/var/buzz',DATABASE_URL:'postgres://buzz:secret@127.0.0.1/buzz',REDIS_URL:'redis://127.0.0.1:6380',BUZZ_RELAY_PRIVATE_KEY:'a'.repeat(64),BUZZ_GIT_HOOK_HMAC_SECRET:'b'.repeat(64),RELAY_OWNER_PUBKEY:'c'.repeat(64),BUZZ_S3_ENDPOINT:'http://127.0.0.1:9000',BUZZ_S3_BUCKET:'buzz-media',BUZZ_S3_ACCESS_KEY:'buzz',BUZZ_S3_SECRET_KEY:'secret',RELAY_URL:'ws://127.0.0.1:3200'};
test('native Buzz uses separate loopback relay and Redis with durable private team settings',()=>{
 const config=readBuzzRuntimeConfig(valid);
 assert.equal(config.relay.command,'/opt/buzz/target/release/buzz-relay');
 assert.equal(config.env.BUZZ_BIND_ADDR,'127.0.0.1:3200');
 assert.equal(config.env.BUZZ_HEALTH_PORT,'8083');
 assert.equal(config.env.BUZZ_REQUIRE_RELAY_MEMBERSHIP,'true');
 assert.equal(config.env.BUZZ_DB_POOL_SIZE,'5');
 assert.equal(config.env.BUZZ_WEB_DIR,'/opt/buzz/web/dist');
 assert.equal(config.redis.args[config.redis.args.indexOf('--bind')+1],'127.0.0.1');
 assert.equal(config.redis.args[config.redis.args.indexOf('--port')+1],'6380');
 assert.equal(config.redis.args[config.redis.args.indexOf('--appendonly')+1],'yes');
});
test('refuses weak identities, shared Mailflare bucket and unsafe listener configs',()=>{
 for(const bad of [{RELAY_OWNER_PUBKEY:''},{BUZZ_RELAY_PRIVATE_KEY:'secret'},{DATABASE_URL:''},{BUZZ_REQUIRE_RELAY_MEMBERSHIP:'false'},{BUZZ_BIND_ADDR:'0.0.0.0:3200'},{REDIS_URL:'redis://public.example.com:6380'},{BUZZ_S3_BUCKET:'mailflare',S3_BUCKET:'mailflare'}]) assert.throws(()=>readBuzzRuntimeConfig({...valid,...bad}));
});
test('requires explicit matching Redis port and valid relay/health listener ports',()=>{
 for(const bad of [{REDIS_URL:'redis://127.0.0.1'},{REDIS_URL:'redis://127.0.0.1:0'},{BUZZ_BIND_ADDR:'127.0.0.1:999999'},{BUZZ_BIND_ADDR:'127.0.0.1:0'},{BUZZ_HEALTH_PORT:'0'},{BUZZ_HEALTH_PORT:'65536'},{BUZZ_HEALTH_PORT:'abc'}]) assert.throws(()=>readBuzzRuntimeConfig({...valid,...bad}));
 const config=readBuzzRuntimeConfig({...valid,REDIS_URL:'redis://127.0.0.1:6381',BUZZ_BIND_ADDR:'127.0.0.1:3201',BUZZ_HEALTH_PORT:'8084'});
 assert.equal(config.env.REDIS_URL,'redis://127.0.0.1:6381');
 assert.equal(config.redis.args[config.redis.args.indexOf('--port')+1],'6381');
 assert.equal(config.env.BUZZ_BIND_ADDR,'127.0.0.1:3201');
 assert.equal(config.env.BUZZ_HEALTH_PORT,'8084');
});
test('existing Homebrew Redis accepts a separate logical database and authentication',()=>{
 const config=readBuzzRuntimeConfig({...valid,BUZZ_REDIS_MODE:'existing',REDIS_URL:'redis://buzz:local-secret@localhost:6379/1'});
 assert.equal(config.env.BUZZ_REDIS_MODE,'existing');
 assert.equal(config.env.REDIS_URL,'redis://buzz:local-secret@localhost:6379/1');
 assert.deepEqual(config.managedKinds,['relay']);
});
test('external Redis remains private and bundled Redis cannot use shared service settings',()=>{
 for(const bad of [{BUZZ_REDIS_MODE:'unknown'},{BUZZ_REDIS_MODE:'existing',REDIS_URL:'redis://public.example:6379/1'},{BUZZ_REDIS_MODE:'existing',REDIS_URL:'redis://localhost:6379/-1'},{BUZZ_REDIS_MODE:'existing',REDIS_URL:'redis://localhost:6379/1?ignored=true'},{BUZZ_REDIS_MODE:'managed',REDIS_URL:'redis://localhost:6379/1'}])assert.throws(()=>readBuzzRuntimeConfig({...valid,...bad}));
 assert.deepEqual(readBuzzRuntimeConfig(valid).managedKinds,['redis','relay']);
});
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { writePrivateEnv } from '../../scripts/selfhost/config.mjs';
test('PM2 ecosystem excludes Homebrew Redis and wrapper refuses to launch it',()=>{
 const directory=mkdtempSync(join(tmpdir(),'buzz-existing-')),file=join(directory,'ecosystem.config.cjs');
 writeFileSync(file,readFileSync(new URL('../../deploy/buzz/ecosystem.config.cjs',import.meta.url)));
 writePrivateEnv(join(directory,'.env'),{...valid,BUZZ_REDIS_MODE:'existing',REDIS_URL:'redis://localhost:6379/1'});
 const ecosystem=createRequire(import.meta.url)(file);
 assert.deepEqual(ecosystem.apps.map((app:{name:string})=>app.name),['buzz-relay']);
 const result=spawnSync(process.execPath,['--env-file='+join(directory,'.env'),'deploy/buzz/run.mjs','redis'],{encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/externally managed/);
});
