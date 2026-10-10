/** Translate the small SQLite SQL surface used by the shared D1/Drizzle driver.
 * Strings, quoted identifiers and comments are tokens, never replacements. */
export function postgresSql(input: string): string {
 const pragma = input.match(/^\s*PRAGMA\s+table_info\((\w+)\)\s*;?$/i);
 if (pragma) return `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${pragma[1]}' ORDER BY ordinal_position`;
 const tokens = input.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|--[^\n]*|\/\*[\s\S]*?\*\/|[a-zA-Z_][a-zA-Z_0-9]*|\s+|./g) ?? [];
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
