import { mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { PostgresDatabase } from './runtime/postgres-database';
import { SqliteDatabase } from './runtime/sqlite-database';
import { applyMigrations } from './runtime/migrate';
import { bootstrapAdmin } from './runtime/bootstrap';

const dataDir = resolve(process.env.DATA_DIR || './data/mailflare');
mkdirSync(dataDir,{recursive:true});
const backend = process.env.DATABASE_BACKEND || 'sqlite';
if (!['sqlite','postgres'].includes(backend)) throw new Error('DATABASE_BACKEND must be sqlite or postgres');
const database = backend === 'postgres'
 ? new PostgresDatabase(process.env.DATABASE_URL || '',Number(process.env.DATABASE_POOL_SIZE || 4))
 : new SqliteDatabase(join(dataDir,'mailflare.sqlite'));
try {
 await applyMigrations(database,resolve('drizzle/migrations'));
 const result = await bootstrapAdmin(database,{email:process.env.MAILFLARE_ADMIN_EMAIL || '',password:process.env.MAILFLARE_ADMIN_PASSWORD || '',appName:process.env.MAILFLARE_BRAND_NAME,receivingProvider:process.env.MAILFLARE_RECEIVING_PROVIDER as "resend"|"cloudflare"|undefined});
 console.log(`Created admin ${result.email}. Log in, then finish Resend setup under Admin > Domains. No external services or DNS records were changed.`);
} finally { if (database instanceof PostgresDatabase) await database.close(); else database.db.close(); }
