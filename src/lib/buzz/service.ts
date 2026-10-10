import type { BuzzConnection, BuzzConnectionInput } from './connection';

type BuzzRow = { team_name: string; relay_url: string; web_url: string; updated_at: number };

export async function getBuzzConnection(env: Pick<CloudflareEnv, 'DB'>, userId: string): Promise<BuzzConnection | null> {
 const row = await env.DB.prepare('SELECT team_name, relay_url, web_url, updated_at FROM buzz_connections WHERE user_id = ?').bind(userId).first<BuzzRow>();
 return row ? { teamName: row.team_name, relayUrl: row.relay_url, webUrl: row.web_url, updatedAt: new Date(row.updated_at * 1000).toISOString() } : null;
}
export async function saveBuzzConnection(env: Pick<CloudflareEnv, 'DB'>, userId: string, connection: BuzzConnectionInput): Promise<BuzzConnection> {
 const updatedAt = Math.floor(Date.now() / 1000);
 await env.DB.prepare(`INSERT INTO buzz_connections (user_id, team_name, relay_url, web_url, updated_at) VALUES (?, ?, ?, ?, ?)
 ON CONFLICT(user_id) DO UPDATE SET team_name = excluded.team_name, relay_url = excluded.relay_url, web_url = excluded.web_url, updated_at = excluded.updated_at`).bind(userId, connection.teamName, connection.relayUrl, connection.webUrl, updatedAt).run();
 return { ...connection, updatedAt: new Date(updatedAt * 1000).toISOString() };
}
export async function disconnectBuzzConnection(env: Pick<CloudflareEnv, 'DB'>, userId: string): Promise<void> {
 await env.DB.prepare('DELETE FROM buzz_connections WHERE user_id = ?').bind(userId).run();
}
