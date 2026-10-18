#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { buildConfig, readPrivateEnv, writePrivateEnv, secretKeys, databaseTarget, provisionDatabase, assertPortAvailable } from './selfhost/config.mjs';
import { readBuzzRuntimeConfig } from '../deploy/buzz/config.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), command=args.shift() || 'help';
const options={};
while(args.length){const key=args.shift();if(!['--file','--input-json'].includes(key)||!args.length)throw new Error('Options: --file PATH, --input-json PATH|-');options[key]=args.shift();}
const file=resolve(options['--file'] || join(root,'.env.selfhosted'));
const buzzFile=join(root,'deploy/buzz/.env');
let rl,muted=false;
const output=new Writable({write(chunk,_encoding,callback){if(!muted)process.stderr.write(chunk);callback();}});
output.isTTY=process.stderr.isTTY;
async function ask(label,current='',secret=false){
 if(!process.stdin.isTTY)throw new Error('Interactive configuration needs a terminal; use --input-json PATH or - instead.');
 rl ||= createInterface({input:process.stdin,output,terminal:true});
 const prompt=`${label}${current ? secret?' [configured; Enter keeps it]':` [${current}]`:''}: `;
 try{if(secret){process.stderr.write(prompt);muted=true;}const answer=await rl.question(secret?'':prompt);return (secret?answer:answer.trim()) || current;}
 finally{muted=false;if(secret)process.stderr.write('\n');}
}
async function patchInput(){
 const path=options['--input-json'];
 if(!path)return null;
 const text=path==='-'?await new Promise((res,rej)=>{let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{value+=c;if(value.length>65536)rej(new Error('Configuration input too large.'));});process.stdin.on('end',()=>res(value));}):readFileSync(resolve(path),'utf8');
 let data;try{data=JSON.parse(text);}catch{throw new Error('Invalid configuration JSON (contents hidden).');}if(!data || Array.isArray(data) || typeof data!=='object')throw new Error('Input must be a JSON object of environment keys and string values.');
 for(const [key,value] of Object.entries(data))if(typeof value!=='string')throw new Error(`${key} must be a string.`);
 return data;
}
function run(binary,argv,env={},cwd=root,capture=false){
 return new Promise((res,rej)=>{const child=spawn(binary,argv,{cwd,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='MAILFLARE_PG_ADMIN_URL')),...env},stdio:capture?['ignore','pipe','pipe']:'inherit'});let text='';
 if(capture)child.stdout.on('data',c=>text+=c);
 child.on('error',()=>rej(new Error(`Could not run ${binary}; check installed tools.`)));
 child.on('exit',code=>code===0?res(text):rej(new Error(`${binary} failed (exit ${code}); setup stopped.`)));
 });
}
async function managed(name){
 const raw=await run('pm2',['jlist'],{},root,true);
 let apps;try{apps=JSON.parse(raw.trim().split('\n').at(-1));}catch{throw new Error('Could not read PM2 process list. Run pm2 list.');}
 const app=apps.find(a=>a.name===name);
 if(app && resolve(app.pm2_env.pm_cwd)!==root)throw new Error(`PM2 name ${name} belongs to another checkout. Refusing to change it.`);
 return app;
}
async function start(name,ecosystem,env){await managed(name);await run('pm2',['startOrRestart',ecosystem,'--only',name,'--update-env'],env);}
async function wait(url){for(let n=0;n<30;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(2000)});if(r.ok)return;}catch{}await new Promise(res=>setTimeout(res,1000));}throw new Error('Local service did not become healthy within 30 attempts; inspect pm2 logs.');}
function config(){if(!existsSync(file))throw new Error('Run configure first.');return buildConfig(readPrivateEnv(file),{},root);}
async function configure(){
 const old=readPrivateEnv(file);let patch=await patchInput();
 if(!patch){patch={};
 const fields=[['DATABASE_BACKEND','Database: postgres or sqlite',old.DATABASE_BACKEND || 'postgres'],['DATABASE_URL','Dedicated Mailflare database URL (password hidden)',old.DATABASE_URL || ''],['MAILFLARE_ADMIN_EMAIL','First admin mailbox',old.MAILFLARE_ADMIN_EMAIL || ''],['MAILFLARE_ADMIN_PASSWORD','Initial admin password; leave blank for an existing installation',old.MAILFLARE_ADMIN_PASSWORD || ''],['MAILFLARE_BRAND_NAME','Brand name',old.MAILFLARE_BRAND_NAME || 'Mailflare'],['APP_URL','Public HTTPS origin, or local preview origin',old.APP_URL || 'http://127.0.0.1:3100'],['RESEND_API_KEY','Resend API key',old.RESEND_API_KEY || ''],['MAILFLARE_RECEIVING_PROVIDER','Receiving: resend or cloudflare',old.MAILFLARE_RECEIVING_PROVIDER || 'resend'],['CF_TOKEN','Cloudflare API token for domain and user onboarding',old.CF_TOKEN || ''],['CF_ACCOUNT_ID','Cloudflare account ID',old.CF_ACCOUNT_ID || ''],['CF_EMAIL_WORKER_NAME','Deployed email relay Worker (leave blank until deployed)',old.CF_EMAIL_WORKER_NAME || ''],['WHATSAPP_ENABLED','Enable WhatsApp QR pairing: true or false',old.WHATSAPP_ENABLED || 'false'],['MINIO_BINARY','MinIO executable',old.MINIO_BINARY || join(process.env.HOME,'.local/bin/minio')]];
 for(const [key,label,value]of fields){if(key==='DATABASE_URL' && patch.DATABASE_BACKEND==='sqlite')continue;patch[key]=await ask(label,value,secretKeys.has(key));}
 }
 const env=buildConfig(old,patch,root);writePrivateEnv(file,env);console.log('Saved private configuration (0600). Existing keys were preserved; secrets are not displayed.');
}
async function build(){const app=await managed('mailflare');if(app?.pm2_env.status==='online')throw new Error('Stop Mailflare with down before replacing its build.');await run('npm',['ci','--fetch-timeout=600000','--fetch-retries=3']);await run('npm',['run','build:node'],{MAILFLARE_RUNTIME:'node',NODE_ENV:'production',...config()});}
async function database(value){
 const target=databaseTarget(value);
 // Reject unsupported provisioning names before requesting administrator credentials.
 if(!['mailflare','buzz'].includes(target.name)||target.role!==target.name)throw new Error('Automatic database creation requires matching mailflare or buzz names; provision custom names manually.');
 const admin=process.env.MAILFLARE_PG_ADMIN_URL || await ask('PostgreSQL admin URL (used only for this command)','',true);
 let adminTarget;try{adminTarget=new URL(admin);}catch{throw new Error('Invalid PostgreSQL admin URL (contents hidden).');}
 if(!['postgres:','postgresql:'].includes(adminTarget.protocol) || adminTarget.hostname!==target.url.hostname || (adminTarget.port || '5432')!==(target.url.port || '5432'))throw new Error('Admin and target database URLs must use the same PostgreSQL server.');
 const {Client}=await import('pg');const client=new Client({connectionString:admin,connectionTimeoutMillis:10000});
 try{await client.connect();await provisionDatabase(client,value);}catch(error){if(error.code)throw new Error(`PostgreSQL provisioning failed (${error.code}); existing role passwords are never changed.`);throw error;}finally{await client.end();}
 const check=new Client({connectionString:value,connectionTimeoutMillis:10000});try{await check.connect();await check.query('SELECT 1');}catch{throw new Error('Dedicated database login failed. Check its existing password; it was not rotated.');}finally{await check.end();}
 console.log('Dedicated database ready. Umami database and role were not changed.');
}
async function minioInstall(){const env=config();if(existsSync(env.MINIO_BINARY)){console.log('MinIO executable already present.');return;}if(!env.MINIO_BINARY.endsWith('/minio'))throw new Error('MINIO_BINARY must end with /minio for source installation.');await run('go',['install','github.com/minio/minio@v0.0.0-20260212201848-7aac2a2c5b7c'],{GOBIN:dirname(env.MINIO_BINARY)});if(!existsSync(env.MINIO_BINARY))throw new Error('Go installs an executable named minio; set MINIO_BINARY to that filename.');}
async function bootstrap(){
 if(!existsSync(join(root,'dist/bootstrap.mjs')))throw new Error('Run build first.');
 await run(process.execPath,['--env-file='+file,'dist/bootstrap.mjs','--if-needed']);
 const stored=readPrivateEnv(file);delete stored.MAILFLARE_ADMIN_PASSWORD;writePrivateEnv(file,stored);
 console.log('Bootstrap complete; initial password removed from the configuration.');
}
async function up(){
 const env=config();if(!existsSync(env.MINIO_BINARY) || !existsSync(join(root,'dist/server.mjs')))throw new Error('Run minio:install and build first.');
 for(const [name,ports]of [['mailflare-minio',[9000,9001]],['mailflare',[Number(env.PORT)]]]){const app=await managed(name);for(const port of ports)await assertPortAvailable(port,app?.pm2_env.status==='online');}
 await start('mailflare-minio','ecosystem.config.cjs',{MAILFLARE_ENV_FILE:file});await wait('http://127.0.0.1:9000/minio/health/live');
 await run(process.execPath,['--env-file='+file,'scripts/init-storage.mjs']);await bootstrap();
 await start('mailflare','ecosystem.config.cjs',{MAILFLARE_ENV_FILE:file});await wait(`http://127.0.0.1:${env.PORT}/api/setup/status`);
 console.log(`Mailflare ready at ${env.APP_URL}. Configure domains and branding in Admin. Use pm2 save after verification.`);
}
async function down(){for(const name of ['mailflare','mailflare-minio'])if(await managed(name))await run('pm2',['stop',name]);console.log('Mailflare and its MinIO stopped. Shared PostgreSQL remains running.');}
async function buzzConfigure(){
 const env=config(),old=readPrivateEnv(buzzFile);const supplied=await patchInput();
 let patch=supplied;
 if(!patch){patch={};for(const [key,label,value]of [['BUZZ_SOURCE_DIR','External Buzz checkout',old.BUZZ_SOURCE_DIR || join(process.env.HOME,'buzz')],['BUZZ_DATA_DIR','Buzz data folder',old.BUZZ_DATA_DIR || join(process.env.HOME,'buzz-data')],['DATABASE_URL','Buzz database URL on your existing PostgreSQL server',old.DATABASE_URL || ''],['BUZZ_REDIS_MODE','Redis: existing Homebrew service or managed PM2 instance',old.BUZZ_REDIS_MODE || 'existing'],['REDIS_URL','Local Redis URL with an unused logical database',old.REDIS_URL || 'redis://127.0.0.1:6379/1'],['RELAY_URL','Public WSS relay origin or local WS origin',old.RELAY_URL || 'ws://127.0.0.1:3200'],['RELAY_OWNER_PUBKEY','Your public Buzz/Nostr owner key (64 hex)',old.RELAY_OWNER_PUBKEY || '']])patch[key]=await ask(label,value,secretKeys.has(key));}
 const defaults=readPrivateEnv(join(root,'deploy/buzz/env.example'));
 const allowed=new Set([...Object.keys(defaults),'BUZZ_REDIS_BINARY']);for(const key of Object.keys(patch))if(!allowed.has(key))throw new Error(`Unknown Buzz key ${key}.`);
 const value={...defaults,...old,...patch};
 for(const key of ['BUZZ_RELAY_PRIVATE_KEY','BUZZ_GIT_HOOK_HMAC_SECRET'])if(!value[key] || value[key].includes('CHANGE_ME'))value[key]=randomBytes(32).toString('hex');
 for(const [key,source]of [['BUZZ_S3_ENDPOINT','S3_ENDPOINT'],['BUZZ_S3_ACCESS_KEY','S3_ACCESS_KEY_ID'],['BUZZ_S3_SECRET_KEY','S3_SECRET_ACCESS_KEY']])if(!old[key] && !patch[key])value[key]=env[source];
 if(!old.BUZZ_S3_BUCKET && !patch.BUZZ_S3_BUCKET)value.BUZZ_S3_BUCKET='buzz-media';
 if(value.DATABASE_URL===env.DATABASE_URL || databaseTarget(value.DATABASE_URL).name===databaseTarget(env.DATABASE_URL || 'postgres://mailflare@localhost/mailflare').name || value.BUZZ_S3_BUCKET===env.S3_BUCKET)throw new Error('Buzz needs a separate database and MinIO bucket.');
 readBuzzRuntimeConfig({...value,S3_BUCKET:env.S3_BUCKET});writePrivateEnv(buzzFile,value);console.log('Saved private Buzz configuration. Owner private identity is never requested.');
}
function buzzConfig(){const env=readPrivateEnv(buzzFile);readBuzzRuntimeConfig(env);return env;}
async function buzzBuild(){
 const env=buzzConfig(),source=env.BUZZ_SOURCE_DIR,revision='845fc16ebf5ec84f87a94ceaf69bb79c004b3a76';
 const app=await managed('buzz-relay');if(app?.pm2_env.status==='online')throw new Error('Stop Buzz with buzz:down before building.');
 if(!existsSync(source)){await run('git',['clone','https://github.com/block/buzz.git',source]);await run('git',['checkout',revision],{},source);}
 if((await run('git',['rev-parse','HEAD'],{},source,true)).trim()!==revision)throw new Error('Buzz checkout differs from the inspected pinned revision. Pin it manually; it was not reset.');
 await run('rustup',['toolchain','install','1.95.0']);await run('cargo',['build','--release','--locked','-p','buzz-relay','--bin','buzz-relay','-p','buzz-admin','--bin','buzz-admin'],{CARGO_BUILD_JOBS:'1'},source);
 await run('pnpm',['install','--frozen-lockfile','--filter','buzz-web'],{},source);await run('pnpm',['-C','web','build'],{},source);
}
async function buzzUp(){
 const env=buzzConfig();
 const runtime=readBuzzRuntimeConfig(env);
 const portsToCheck=[['buzz-relay',[Number(env.BUZZ_BIND_ADDR?.split(':').at(-1) || 3200),Number(env.BUZZ_HEALTH_PORT || 8083)]]];
 if(runtime.env.BUZZ_REDIS_MODE==='managed')portsToCheck.push(['buzz-redis',[Number(new URL(env.REDIS_URL).port)]]);
 for(const [name,ports]of portsToCheck){const app=await managed(name);for(const port of ports)await assertPortAvailable(port,app?.pm2_env.status==='online');}
 await wait('http://127.0.0.1:9000/minio/health/live');
 await run(process.execPath,['scripts/init-storage.mjs'],{S3_ENDPOINT:env.BUZZ_S3_ENDPOINT,S3_BUCKET:env.BUZZ_S3_BUCKET,S3_ACCESS_KEY_ID:env.BUZZ_S3_ACCESS_KEY,S3_SECRET_ACCESS_KEY:env.BUZZ_S3_SECRET_KEY,S3_REGION:env.BUZZ_S3_REGION});
 if(runtime.env.BUZZ_REDIS_MODE==='managed')await start('buzz-redis','deploy/buzz/ecosystem.config.cjs',{});
 const redis=new URL(env.REDIS_URL);
 const pingArgs=['-h',redis.hostname.replace(/^\[|\]$/g,''),'-p',redis.port,'-n',redis.pathname.slice(1) || '0'];
 if(redis.username)pingArgs.push('--user',decodeURIComponent(redis.username));
 let ready=false;
 for(let attempt=0;attempt<(runtime.env.BUZZ_REDIS_MODE==='managed'?10:1);attempt++){
  try{const pong=await run('redis-cli',[...pingArgs,'PING'],{REDISCLI_AUTH:decodeURIComponent(redis.password)},root,true);if(pong.trim()==='PONG'){ready=true;break;}}catch{}
  if(runtime.env.BUZZ_REDIS_MODE==='managed')await new Promise(res=>setTimeout(res,1000));
 }
 if(!ready)throw new Error('Redis did not respond to PING. Check redis-cli, the Homebrew service, selected DB and credentials.');
 // Upstream migrations connect to PG; Redis starts before the relay.
 await run(process.execPath,['--env-file='+buzzFile,'deploy/buzz/run.mjs','admin','migrate']);
 await start('buzz-relay','deploy/buzz/ecosystem.config.cjs',{});await wait(`http://${env.BUZZ_BIND_ADDR || '127.0.0.1:3200'}`);
 console.log('Buzz running. Open its web UI with your owner identity; save this workspace from Mailflare > Buzz.');
}
async function doctor(){
 let failed=false;
 for(const [name,argv]of [['node',['--version']],['npm',['--version']],['pm2',['--version']],['git',['--version']]])try{await run(name,argv,{},root,true);console.log(`${name}: available`);}catch{failed=true;console.log(`${name}: missing`);}
 const env=config();console.log(`Config: valid (${env.DATABASE_BACKEND}); secret values hidden.`);
 if(!existsSync(env.MINIO_BINARY)){failed=true;console.log('MinIO: missing; run minio:install');}
 if(!existsSync(join(root,'dist/server.mjs'))){failed=true;console.log('Build: missing; run build');}
 if(env.DATABASE_BACKEND==='postgres'){
  const {Client}=await import('pg');const client=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:3000});try{await client.connect();await client.query('SELECT 1');console.log('PostgreSQL: dedicated login works');}catch{failed=true;console.log('PostgreSQL: unreachable or login failed');}finally{await client.end();}
 }
 if(failed)process.exitCode=1;
}
const help=`Mailflare native setup (Node 24+, no Docker)
  configure [--input-json FILE|-] [--file PATH]  Private interactive configuration
  build                  Install locked npm dependencies and build Mailflare
  minio:install          Build pinned MinIO with Go, unless already installed
  db:create              Create dedicated mailflare DB/role on existing PG server
  up / down              Start/bootstrap or stop Mailflare + MinIO via PM2
  bootstrap              Create initial admin if none; clear saved initial password
  doctor / status        Check config/dependencies or list PM2 processes
  buzz:configure         Configure optional native Buzz (also accepts --input-json)
  buzz:db:create         Create separate buzz database/role
  buzz:build             Clone pinned Buzz, build Rust and pnpm web client
  buzz:up / buzz:down    Manage Buzz; Redis is controlled only in managed mode
Secrets are prompted without echo. --input-json - reads private JSON from stdin.
Database admin credentials: prompt or MAILFLARE_PG_ADMIN_URL environment variable.
Cloudflare Tunnel, domain/MX setup, and owner phone/identity steps: docs/setup-cli.md.`;
try{
 if(Number(process.versions.node.split('.')[0])<24)throw new Error('Use Node 24 or newer.');
 switch(command){
 case 'help':case '--help':console.log(help);break;
 case 'configure':await configure();break;case 'build':await build();break;case 'minio:install':await minioInstall();break;
 case 'db:create':{const env=config();if(env.DATABASE_BACKEND==='postgres')await database(env.DATABASE_URL);else console.log('SQLite selected; no server database to create.');break;}
 case 'up':await up();break;case 'down':await down();break;case 'bootstrap':config();await bootstrap();break;
 case 'doctor':await doctor();break;case 'status':await run('pm2',['list']);break;
 case 'buzz:configure':await buzzConfigure();break;case 'buzz:db:create':await database(buzzConfig().DATABASE_URL);break;case 'buzz:build':await buzzBuild();break;case 'buzz:up':await buzzUp();break;
 case 'buzz:down':for(const kind of [...readBuzzRuntimeConfig(buzzConfig()).managedKinds].reverse()){const name=`buzz-${kind}`;if(await managed(name))await run('pm2',['stop',name]);}break;
 default:throw new Error('Unknown command; run help.');
 }
}catch(error){console.error(`Setup: ${error.message}`);process.exitCode=1;}finally{rl?.close();}
