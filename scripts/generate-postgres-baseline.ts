// Development helper only. Review the output before publishing a new baseline.
// Existing PostgreSQL installs need additive SQL migrations, never regeneration.
import { SqliteDatabase } from '../server/runtime/sqlite-database';
import { applyMigrations } from '../server/runtime/migrate';
import { mkdirSync,writeFileSync } from 'node:fs';
const db=new SqliteDatabase(':memory:');
await applyMigrations(db,'drizzle/migrations');
const quote=(s:string)=>`"${s.replaceAll('"','""')}"`;
const tables=db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'messages_fts%' AND name <> 'd1_migrations' ORDER BY name").all() as {name:string}[];
const out=['-- PostgreSQL baseline corresponding to the current SQLite migrations.\n-- Integer booleans and epoch seconds preserve the shared D1 data contract.'];
const constraints:string[]=[];
for(const {name} of tables) {
 const cols=db.db.pragma(`table_info(${name})`) as {name:string;type:string;notnull:number;dflt_value:string|null;pk:number}[];
 const definitions=cols.map(c=>`${quote(c.name)} ${{INTEGER:'bigint',integer:'bigint',TEXT:'text',text:'text',REAL:'double precision',real:'double precision',BLOB:'bytea',blob:'bytea'}[c.type] ?? c.type}${c.notnull?' NOT NULL':''}${c.dflt_value!==null?` DEFAULT ${c.dflt_value === 'false' ? '0' : c.dflt_value === 'true' ? '1' : c.dflt_value}`:''}`);
 const pk=cols.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk);if(pk.length) definitions.push(`PRIMARY KEY (${pk.map(c=>quote(c.name)).join(', ')})`);
 const indexes=db.db.pragma(`index_list(${name})`) as {name:string;unique:number;origin:string}[];
 for(const index of indexes.filter(i=>i.origin==='u')) {
  const columns=db.db.pragma(`index_info('${index.name}')`) as {name:string}[];
  definitions.push(`UNIQUE (${columns.map(c=>quote(c.name)).join(', ')})`);
 }
 out.push(`CREATE TABLE ${quote(name)} (\n  ${definitions.join(',\n  ')}\n);`);
 const fks=db.db.pragma(`foreign_key_list(${name})`) as {id:number;seq:number;table:string;from:string;to:string;on_update:string;on_delete:string}[];
 for(const id of new Set(fks.map(f=>f.id))) {
  const group=fks.filter(f=>f.id===id).sort((a,b)=>a.seq-b.seq), f=group[0];
  constraints.push(`ALTER TABLE ${quote(name)} ADD FOREIGN KEY (${group.map(f=>quote(f.from)).join(', ')}) REFERENCES ${quote(f.table)} (${group.map(f=>quote(f.to)).join(', ')}) ON UPDATE ${f.on_update} ON DELETE ${f.on_delete} DEFERRABLE INITIALLY DEFERRED;`);
 }
}
out.push(...constraints);
for(const row of db.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND tbl_name NOT LIKE 'messages_fts%'").all() as {sql:string}[]) out.push(row.sql.replaceAll('`','"')+';');
// Seed only the schema's installation defaults, never user/mail data.
for(const table of ['app_settings','backup_settings']) {
 for(const row of db.db.prepare(`SELECT * FROM ${table}`).all() as Record<string,unknown>[]) {
  out.push(`INSERT INTO ${quote(table)} (${Object.keys(row).map(quote).join(', ')}) VALUES (${Object.values(row).map(v=>v===null?'NULL':typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`).join(', ')});`);
 }
}
mkdirSync('drizzle/postgres',{recursive:true});
writeFileSync('drizzle/postgres/0000_baseline.sql',out.join('\n\n')+'\n');
db.db.close();
