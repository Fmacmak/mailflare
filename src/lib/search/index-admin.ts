import { postgresBackend } from '@/lib/database/backend';
/**
 * Maintenance for the FTS5 index. Triggers keep it current, so a rebuild is
 * only needed after a restore from a backup that predates the index, or if the
 * counts below ever disagree.
 */
export async function rebuildSearchIndex(env: CloudflareEnv): Promise<void> {
	if (postgresBackend(env.DB)) {
		await env.DB.prepare("REINDEX INDEX messages_search_pg_idx").run();
		return;
	}
	await env.DB.prepare("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')").run();
}

export async function getSearchIndexStatus(env: CloudflareEnv): Promise<{ indexed: number; messages: number }> {
	const [indexed, total] = await env.DB.batch<{ n: number }>([
		env.DB.prepare(postgresBackend(env.DB) ? "SELECT count(*) AS n FROM messages" : "SELECT count(*) AS n FROM messages_fts"),
		env.DB.prepare("SELECT count(*) AS n FROM messages"),
	]);
	return { indexed: indexed.results[0]?.n ?? 0, messages: total.results[0]?.n ?? 0 };
}
