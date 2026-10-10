import { sql, type SQL } from 'drizzle-orm';
import { messages } from '@/db/schema';
import { tokenizeSearchText } from './query-utils';
import type { ParsedSearchQuery } from './types';

// Must match the migration's expression exactly for PostgreSQL to use its GIN index.
export const postgresMessageVector = sql`to_tsvector('simple', mailflare_search_text(coalesce(${messages.subject},'') || ' ' || coalesce(${messages.fromAddr},'') || ' ' || coalesce(${messages.toAddr},'') || ' ' || coalesce(${messages.ccAddr},'') || ' ' || coalesce(${messages.textBody},'') || ' ' || coalesce(${messages.htmlBody},'')))`;
export function postgresSearchConditions(parsed:ParsedSearchQuery):SQL[] {
 const conditions:SQL[]=[];
 const match=(text:string,vector:SQL,negation:boolean)=>{
  for(const token of tokenizeSearchText(text)) {
   const words=token.term.replace(/[^\p{L}\p{N}\s]+/gu,' ').trim().split(/\s+/).filter(Boolean);
   if(!words.length) continue;
   const term=words.join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
   const query=token.phrase || words.length>1 ? sql`phraseto_tsquery('simple', ${term})` : sql`to_tsquery('simple', ${`${term}:*`})`;
   const condition=sql`${vector} @@ ${query}`;
   conditions.push(negation && token.negate ? sql`NOT (${condition})` : condition);
  }
 };
 match(parsed.text,postgresMessageVector,true);
 if(parsed.subject) match(parsed.subject,sql`to_tsvector('simple',mailflare_search_text(coalesce(${messages.subject},'')))`,false);
 if(parsed.from) match(parsed.from,sql`to_tsvector('simple',mailflare_search_text(coalesce(${messages.fromAddr},'')))`,false);
 if(parsed.to) match(parsed.to,sql`to_tsvector('simple',mailflare_search_text(coalesce(${messages.toAddr},'') || ' ' || coalesce(${messages.ccAddr},'')))`,false);
 return conditions;
}
