/** Translate the small SQLite SQL surface used by the shared D1/Drizzle driver.
 * Strings, quoted identifiers and comments are tokens, never replacements. */
export function postgresSql(input: string): string {
 const pragma = input.match(/^\s*PRAGMA\s+table_info\((\w+)\)\s*;?$/i);
 if (pragma) return `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${pragma[1]}' ORDER BY ordinal_position`;
 const tokens = input.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|--[^\n]*|\/\*[\s\S]*?\*\/|[a-zA-Z_][a-zA-Z_0-9]*|\s+|./g) ?? [];
 // Drizzle's SQLite driver qualifies conflict columns; PostgreSQL requires bare columns.
 const significant = tokens.map((value,index)=>({value,index})).filter(({value})=>!/^\s+$|^--|^\/\*/.test(value));
 const identifier = (value:string) => /^(?:[a-zA-Z_]\w*|"(?:[^"]|"")*"|`(?:[^`]|``)*`)$/.test(value);
 for(let i=0;i<significant.length-2;i++) {
  if(!/^ON$/i.test(significant[i].value)||!/^CONFLICT$/i.test(significant[i+1].value)||significant[i+2].value!=='(')continue;
  let depth=1;
  for(let j=i+3;j<significant.length&&depth>0;j++) {
   const token=significant[j];
   if(token.value==='(')depth++;
   else if(token.value===')')depth--;
   else if(depth===1&&identifier(token.value)&&significant[j+1]?.value==='.'&&identifier(significant[j+2]?.value||'')) {
    for(let k=token.index;k<=significant[j+1].index;k++)tokens[k]='';
   }
  }
 }
 let parameter = 0;
 return tokens.map((token,index) => {
  if (token === '?') return `$${++parameter}`;
  if (token.startsWith('`')) return `"${token.slice(1,-1).replaceAll('``','`').replaceAll('"','""')}"`;
  if (/^LIKE$/i.test(token)) return 'ILIKE';
  if (token === 'sqlite_master') return "(SELECT table_name AS name, 'table' AS type FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE') AS sqlite_master";
  if (/^MAX$/i.test(token)) {
   let depth = 0;
   for (let i=index+1;i<tokens.length;i++) {
    if (tokens[i] === '(') depth++;
    if (tokens[i] === ')') {if (--depth === 0) break;}
    if (tokens[i] === ',' && depth === 1) return 'GREATEST';
   }
  }
  return token;
 }).join('');
}
