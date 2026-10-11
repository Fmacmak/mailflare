import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { parseEnv } from 'node:util';
const keys = new Set(['NODE_ENV','MAILFLARE_RUNTIME','HOST','PORT','DATA_DIR','DATABASE_BACKEND','DATABASE_URL','DATABASE_POOL_SIZE','APP_URL','SMTP_INBOUND_PORT','RESEND_API_KEY','CF_TOKEN','INBOUND_WEBHOOK_SECRET','STORAGE_BACKEND','S3_ENDPOINT','S3_REGION','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','MINIO_ROOT_USER','MINIO_ROOT_PASSWORD','MINIO_DATA_DIR','MINIO_BINARY','MAILFLARE_ADMIN_EMAIL','MAILFLARE_ADMIN_PASSWORD','MAILFLARE_BRAND_NAME','MAILFLARE_RECEIVING_PROVIDER','WHATSAPP_ENABLED','WHATSAPP_MAX_SESSIONS']);
export const secretKeys = new Set(['DATABASE_URL','RESEND_API_KEY','CF_TOKEN','INBOUND_WEBHOOK_SECRET','S3_SECRET_ACCESS_KEY','MINIO_ROOT_PASSWORD','MAILFLARE_ADMIN_PASSWORD','BUZZ_RELAY_PRIVATE_KEY','BUZZ_GIT_HOOK_HMAC_SECRET','BUZZ_S3_SECRET_KEY']);
export function readPrivateEnv(file) {
 if (!existsSync(file)) return {};
 if (lstatSync(file).isSymbolicLink()) throw new Error('Refusing a symbolic link configuration file.');
 return {...parseEnv(readFileSync(file,'utf8'))};
}
export function writePrivateEnv(file, values) {
 if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('Refusing a symbolic link configuration file.');
 const lines=Object.entries(values).map(([key,value])=>{
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid environment key.');
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error(`${key} must be a single line string.`);
  // Node dotenv has no backslash escapes. Choose a quote absent from the value.
  const quote=["'",'`','"'].find(q=>!value.includes(q) && parseEnv(`${key}=${q}${value}${q}`)[key]===value);
  if (!quote) throw new Error(`${key} contains all three dotenv quote characters; use a different value.`);
  return `${key}=${quote}${value}${quote}`;
 });
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const temp=`${file}.${randomBytes(6).toString('hex')}.tmp`;
 try {writeFileSync(temp,`${lines.join('\n')}\n`,{mode:0o600,flag:'wx'});renameSync(temp,file);chmodSync(file,0o600);}
 finally {if(existsSync(temp))unlinkSync(temp);}
}
export function databaseTarget(value) {
 let url;try {url=new URL(value);}catch {throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');}
 if (!['postgres:','postgresql:'].includes(url.protocol) || !url.username || !url.pathname.slice(1)) throw new Error('DATABASE_URL must include a PostgreSQL role and database.');
 const name=decodeURIComponent(url.pathname.slice(1)),role=decodeURIComponent(url.username);
 if (name.toLowerCase().includes('umami') || role.toLowerCase().includes('umami')) throw new Error('Use a dedicated Mailflare database and role, separate from Umami.');
 return {url,name,role,password:decodeURIComponent(url.password)};
}
export function buildConfig(existing,patch,root) {
 for (const key of Object.keys(patch)) if(!keys.has(key))throw new Error(`Unknown configuration key ${key}.`);
 const env={NODE_ENV:'production',MAILFLARE_RUNTIME:'node',HOST:'127.0.0.1',PORT:'3100',DATA_DIR:join(root,'data/mailflare'),DATABASE_BACKEND:'postgres',DATABASE_POOL_SIZE:'4',SMTP_INBOUND_PORT:'0',APP_URL:'http://127.0.0.1:3100',STORAGE_BACKEND:'minio',S3_ENDPOINT:'http://127.0.0.1:9000',S3_REGION:'us-east-1',S3_BUCKET:'mailflare',MINIO_ROOT_USER:'mailflare-local',MINIO_DATA_DIR:join(root,'data/minio'),MINIO_BINARY:join(homedir(),'.local/bin/minio'),MAILFLARE_RECEIVING_PROVIDER:'resend',WHATSAPP_ENABLED:'false',WHATSAPP_MAX_SESSIONS:'4',...existing,...patch};
 env.MINIO_ROOT_PASSWORD ||= randomBytes(32).toString('hex');
 env.S3_ACCESS_KEY_ID ||= env.MINIO_ROOT_USER;
 env.S3_SECRET_ACCESS_KEY ||= env.MINIO_ROOT_PASSWORD;
 if (env.MAILFLARE_RECEIVING_PROVIDER==='cloudflare') env.INBOUND_WEBHOOK_SECRET ||= randomBytes(32).toString('hex');
 for (const [key,max] of [['PORT',65535],['DATABASE_POOL_SIZE',20],['WHATSAPP_MAX_SESSIONS',20]]) if (!/^\d+$/.test(env[key]) || Number(env[key])<1 || Number(env[key])>max) throw new Error(`${key} is outside its supported range.`);
 if(env.HOST!=='127.0.0.1' || env.SMTP_INBOUND_PORT!=='0') throw new Error('This installer requires loopback HTTP and disabled SMTP.');
 if(!['postgres','sqlite'].includes(env.DATABASE_BACKEND))throw new Error('DATABASE_BACKEND must be postgres or sqlite.');
 if(env.DATABASE_BACKEND==='postgres')databaseTarget(env.DATABASE_URL);
 if(env.STORAGE_BACKEND!=='minio' || env.S3_ENDPOINT!=='http://127.0.0.1:9000')throw new Error('This installer manages MinIO on http://127.0.0.1:9000.');
 if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET))throw new Error('S3_BUCKET must be a valid bucket name.');
 if(env.MINIO_ROOT_USER.length<3 || env.MINIO_ROOT_PASSWORD.length<8 || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)throw new Error('Valid MinIO credentials are required.');
 if(!['resend','cloudflare'].includes(env.MAILFLARE_RECEIVING_PROVIDER) || !['true','false'].includes(env.WHATSAPP_ENABLED))throw new Error('Invalid receiving provider or WhatsApp flag.');
 let app;try{app=new URL(env.APP_URL);}catch{throw new Error('APP_URL must be an HTTP(S) origin.');}
 if(!['http:','https:'].includes(app.protocol) || app.username || app.password || app.pathname!=='/' || app.search || app.hash || (app.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(app.hostname)))throw new Error('APP_URL must be an HTTPS origin publicly, or HTTP loopback origin locally.');
 if(env.MAILFLARE_ADMIN_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.MAILFLARE_ADMIN_EMAIL))throw new Error('A valid admin email is required.');
 if(env.MAILFLARE_ADMIN_PASSWORD && (env.MAILFLARE_ADMIN_PASSWORD.length<12 || Buffer.byteLength(env.MAILFLARE_ADMIN_PASSWORD)>72))throw new Error('Admin password must be 12+ characters and at most 72 bytes.');
 for(const key of ['DATA_DIR','MINIO_DATA_DIR','MINIO_BINARY'])env[key]=resolve(root,env[key]);
 return env;
}
export async function provisionDatabase(client,value) {
 const {name,role,password}=databaseTarget(value);
 if(!['mailflare','buzz'].includes(name) || role!==name)throw new Error('Automatic provisioning only creates matching mailflare or buzz databases and roles. Create other dedicated names manually.');
 if(!password)throw new Error('Database provisioning requires a password in the target URL.');
 await client.query('SET standard_conforming_strings = on');
 await client.query('SELECT pg_advisory_lock(7489210)');
 try{
  const roles=await client.query('SELECT rolname FROM pg_roles WHERE rolname = $1',[role]);
  const databases=await client.query('SELECT pg_get_userbyid(datdba) AS owner, pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1',[name]);
  if(databases.rows.length && (databases.rows[0].owner!==role || databases.rows[0].encoding!=='UTF8'))throw new Error('Existing database must be UTF8 and owned by its dedicated role. No changes made.');
  if(!roles.rows.length)await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password.replaceAll("'","''")}'`);
  if(!databases.rows.length)await client.query(`CREATE DATABASE "${name}" OWNER "${role}" ENCODING 'UTF8' TEMPLATE template0`);
 }finally{await client.query('SELECT pg_advisory_unlock(7489210)');}
}
export async function assertPortAvailable(port, managedOnline) {
 if(managedOnline)return;
 const {createConnection}=await import('node:net');
 await new Promise((res,rej)=>{
  const socket=createConnection({host:'127.0.0.1',port:Number(port)});
  socket.setTimeout(2000);
  socket.once('connect',()=>{socket.destroy();rej(new Error(`Port ${port} is already in use by an unmanaged service; stop it or choose another port.`));});
  socket.once('error',error=>{socket.destroy();if(error.code==='ECONNREFUSED')res();else rej(new Error(`Could not check port ${port}.`));});
  socket.once('timeout',()=>{socket.destroy();rej(new Error(`Port ${port} check timed out.`));});
 });
}
