import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { buildConfig, writePrivateEnv, readPrivateEnv, provisionDatabase } from '../../scripts/selfhost/config.mjs';
const root = '/tmp/mailflare-test';
const input = {MAILFLARE_ADMIN_EMAIL:'owner@example.com',MAILFLARE_ADMIN_PASSWORD:'a sufficiently long password',DATABASE_BACKEND:'sqlite'};
test('configuration retains secrets and unknown existing settings on rerun', () => {
 const first = buildConfig({},input,root);
 const second = buildConfig({...first,TURNSTILE_SECRET_KEY:'existing-key'},{MAILFLARE_BRAND_NAME:'My Mail'},root);
 assert.equal(second.MINIO_ROOT_PASSWORD,first.MINIO_ROOT_PASSWORD);
 assert.equal(second.S3_SECRET_ACCESS_KEY,first.S3_SECRET_ACCESS_KEY);
 assert.equal(second.TURNSTILE_SECRET_KEY,'existing-key');
 assert.equal(second.MAILFLARE_BRAND_NAME,'My Mail');
 assert.equal(second.HOST,'127.0.0.1');
});
test('invalid configuration refuses Umami database and injected environment', () => {
 assert.throws(()=>buildConfig({}, {...input,DATABASE_BACKEND:'postgres',DATABASE_URL:'postgresql://umami:secret@localhost/umami'},root), /dedicated/);
 assert.throws(()=>buildConfig({}, {...input,NODE_OPTIONS:'--import evil'},root), /Unknown/);
 assert.throws(()=>buildConfig({}, {...input,PORT:'70000'},root), /PORT/);
 assert.throws(()=>buildConfig({}, {...input,APP_URL:'https://host.example/path'},root), /origin/);
 assert.throws(()=>buildConfig({}, {...input,MAILFLARE_ADMIN_PASSWORD:'short'},root), /password/);
});
test('private env roundtrips punctuation, refuses multiline secrets and symlinks', () => {
 const dir=mkdtempSync(join(tmpdir(),'mailflare-config-')),file=join(dir,'.env');
 writePrivateEnv(file,{SECRET:'$quotes \' " # = \\ suffix',EMPTY:''});
 assert.deepEqual(readPrivateEnv(file),{SECRET:'$quotes \' " # = \\ suffix',EMPTY:''});
 assert.equal(statSync(file).mode & 0o777,0o600);
 assert.deepEqual({...parseEnv(readFileSync(file,'utf8'))},readPrivateEnv(file));
 assert.throws(()=>writePrivateEnv(file,{SECRET:'one\ntwo'}), /line/);
 symlinkSync(file,join(dir,'link'));
 assert.throws(()=>writePrivateEnv(join(dir,'link'),{SECRET:'replace'}), /symbolic/);
 assert.equal(existsSync(file),true);
});
test('database provisioning will not rotate an existing role or touch unrelated databases', async () => {
 const queries=[];
 const client={query:async (sql,args)=>{queries.push([sql,args]); if(sql.includes('FROM pg_roles')) return {rows:[{rolname:'mailflare'}]}; if(sql.includes('FROM pg_database')) return {rows:[{owner:'mailflare',encoding:'UTF8'}]}; return {rows:[]};}};
 await provisionDatabase(client,'postgresql://mailflare:secret@127.0.0.1:5432/mailflare');
 assert.equal(queries.some(([sql])=>/CREATE|ALTER|DROP/.test(sql)),false);
 await assert.rejects(()=>provisionDatabase(client,'postgresql://umami:secret@localhost/umami'),/dedicated/);
});
test('new database uses escaped password, UTF8 and a dedicated owner', async () => {
 const queries=[];const client={query:async (sql,args)=>{queries.push([sql,args]);return {rows:[]};}};
 await provisionDatabase(client,"postgresql://mailflare:a%27b@localhost/mailflare");
 assert.ok(queries.some(([sql])=>sql.includes("PASSWORD 'a''b'")));
 assert.ok(queries.some(([sql])=>sql.includes("OWNER \"mailflare\" ENCODING 'UTF8' TEMPLATE template0")));
 assert.equal(queries.some(([sql])=>/SUPERUSER|ALTER ROLE|DROP/.test(sql)),false);
});
import { spawnSync } from 'node:child_process';
const repository=new URL('../../',import.meta.url).pathname;
function cli(args,input){return spawnSync(process.execPath,['scripts/selfhost.mjs',...args],{cwd:repository,input,encoding:'utf8'});}
test('unattended CLI configuration is private and never prints its secret',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mailflare-cli-')),file=join(dir,'.env');
 const result=cli(['configure','--file',file,'--input-json','-'],JSON.stringify(input));
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.includes(input.MAILFLARE_ADMIN_PASSWORD),false);
 assert.equal(readPrivateEnv(file).MAILFLARE_ADMIN_EMAIL,input.MAILFLARE_ADMIN_EMAIL);
 const bad=cli(['configure','--file',file,'--input-json','-'],'{"RESEND_API_KEY":"SECRET-SHOULD-NOT-APPEAR');
 assert.equal(bad.status,1);assert.equal(bad.stderr.includes('SECRET-SHOULD-NOT-APPEAR'),false);
});
test('dotenv serialization preserves literal backslash n without creating extra lines',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mailflare-literal-')),file=join(dir,'.env');
 writePrivateEnv(file,{SECRET:"has'quote\\n-literal"});assert.equal(readPrivateEnv(file).SECRET,"has'quote\\n-literal");
});
test('bootstrap can be rerun after the password has been removed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mailflare-bootstrap-cli-')),file=join(dir,'.env');
 const env=buildConfig({}, {...input,DATA_DIR:join(dir,'database')},repository);writePrivateEnv(file,env);
 const first=cli(['bootstrap','--file',file]);assert.equal(first.status,0,first.stderr);assert.equal(readPrivateEnv(file).MAILFLARE_ADMIN_PASSWORD,undefined);
 const second=cli(['bootstrap','--file',file]);assert.equal(second.status,0,second.stderr);assert.match(second.stdout,/already exists/);
});
import { createServer } from 'node:net';
import { assertPortAvailable } from '../../scripts/selfhost/config.mjs';
test('unmanaged occupied ports fail before starting another service',async()=>{
 const server=createServer();await new Promise(res=>server.listen(0,'127.0.0.1',res));
 const port=server.address().port;
 try{await assert.rejects(()=>assertPortAvailable(port,false),/already in use/);await assertPortAvailable(port,true);}finally{await new Promise(res=>server.close(res));}
 await assertPortAvailable(port,false);
});
