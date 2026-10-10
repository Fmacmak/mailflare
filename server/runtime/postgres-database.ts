import { Pool, types, type PoolClient } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { postgresSql } from './postgres-sql';

// Epochs, counters and aggregates retain the numeric contract of D1. Refuse
// unsafe integers instead of silently corrupting imported backup records.
const numericTypes = { getTypeParser(oid:number, format?:string) {
 if ([20,1700].includes(oid)) return (value:string) => {
  const number = Number(value);
  if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) throw new Error('PostgreSQL value exceeds the supported numeric range');
  return number;
 };
 return types.getTypeParser(oid,format as 'text');
}};
function normalize(value:unknown) {
 if (value instanceof Date) return Math.floor(value.getTime()/1000);
 if (typeof value === 'boolean') return Number(value);
 if (value instanceof ArrayBuffer) return Buffer.from(value);
 if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
 return value;
}
class PostgresStatement {
 constructor(readonly database:PostgresDatabase,readonly sql:string,readonly params:unknown[] = []) {}
 bind(...params:unknown[]) {return new PostgresStatement(this.database,this.sql,params.map(normalize));}
 async execute(client:Pool|PoolClient = this.database.pool, arrays=false) {
  const config={text:postgresSql(this.sql),values:this.params,types:numericTypes};
  return arrays ? client.query({...config,rowMode:'array'}) : client.query(config);
 }
 async first<T = Record<string,unknown>>(column?:string):Promise<T|null> {
  const {rows} = await this.execute();return rows.length ? (column ? rows[0][column] : rows[0]) as T : null;
 }
 async run<T = Record<string,unknown>>(client?:PoolClient) {
  const result = await this.execute(client);
  return {results:result.rows as T[],success:true as const,meta:{duration:0,size_after:0,rows_read:result.rows.length,rows_written:result.rowCount ?? 0,last_row_id:0,changed_db:result.command!=='SELECT',changes:result.rowCount ?? 0}};
 }
 all<T = Record<string,unknown>>() {return this.run<T>();}
 async raw<T = unknown[]>(options?:{columnNames?:boolean}):Promise<T[]> {
  const result = await this.execute(undefined,true);
  return (options?.columnNames ? [result.fields.map(field=>field.name),...result.rows] : result.rows) as T[];
 }
}
export class PostgresDatabase {
 readonly dialect = 'postgres';
 readonly pool:Pool;
 constructor(connectionString:string,max=4) {
  if (!/^postgres(ql)?:\/\//.test(connectionString)) throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  if (!Number.isInteger(max) || max<1 || max>20) throw new Error('DATABASE_POOL_SIZE must be between 1 and 20');
  this.pool = new Pool({connectionString,max,idleTimeoutMillis:30000,connectionTimeoutMillis:10000,application_name:'mailflare'});
  this.pool.on('error',error=>console.error('Mailflare PostgreSQL connection error:',error.message));
 }
 prepare(sql:string) {return new PostgresStatement(this,sql);}
 async transaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client = await this.pool.connect();
  try {await client.query('BEGIN');const result=await operation(client);await client.query('COMMIT');return result;}
  catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
 }
 batch<T>(statements:PostgresStatement[]) {return this.transaction(async client=>{
  const results: Awaited<ReturnType<PostgresStatement["run"]>>[]=[];
  for(const statement of statements) {
   if(statement.database!==this) throw new Error('Batch statements must belong to the same database');
   results.push(await statement.run<T>(client));
  }
  return results;
 });}
 async exec(sql:string) {await this.pool.query(postgresSql(sql));return {count:0,duration:0};}
 withSession() {return this;}
 async dump():Promise<ArrayBuffer> {throw new Error('Use the Mailflare JSON backup or pg_dump for PostgreSQL');}
 close() {return this.pool.end();}
 async migrationStatus() {
  const files=(await readdir(resolve(process.env.POSTGRES_MIGRATIONS_DIR ?? 'drizzle/postgres'))).filter(name=>name.endsWith('.sql')).sort();
  const table=await this.pool.query("SELECT to_regclass('mailflare_pg_migrations') AS name");
  const applied=new Set<string>(table.rows[0]?.name ? (await this.pool.query('SELECT name FROM mailflare_pg_migrations')).rows.map(row=>row.name) : []);
  const pending=files.filter(name=>!applied.has(name)),unknown=[...applied].filter(name=>!files.includes(name));
  return {ready:!pending.length && !unknown.length,pending,unknown};
 }
 async migratePending() {
  const applied=await this.migrate(resolve(process.env.POSTGRES_MIGRATIONS_DIR ?? 'drizzle/postgres'));
  return {...await this.migrationStatus(),applied};
 }
 async migrate(directory:string) {
  return this.transaction(async client=>{
   const encoding = await client.query('SHOW server_encoding');
   if(encoding.rows[0]?.server_encoding !== 'UTF8') throw new Error('Mailflare PostgreSQL requires a UTF8 database; create it with ENCODING UTF8 TEMPLATE template0');
   await client.query("SELECT pg_advisory_xact_lock(731029145)");
   await client.query('CREATE TABLE IF NOT EXISTS mailflare_pg_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
   const applied = new Set((await client.query('SELECT name FROM mailflare_pg_migrations')).rows.map(row=>row.name));
   const files = (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
   const unknown=[...applied].filter(name=>!files.includes(name));
   if(unknown.length) throw new Error('Database contains unknown PostgreSQL migrations');
   const ran:string[]=[];
   for(const name of files) {
    if(applied.has(name)) continue;
    await client.query(await readFile(join(directory,name),'utf8'));
    await client.query('INSERT INTO mailflare_pg_migrations(name) VALUES ($1)',[name]);ran.push(name);
   }
   return ran;
  });
 }
}
