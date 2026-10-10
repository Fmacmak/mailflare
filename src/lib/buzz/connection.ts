export type BuzzConnectionInput = { teamName: string; relayUrl: string; webUrl: string };
export type BuzzConnection = BuzzConnectionInput & { updatedAt: string };

function workspaceUrl(value: unknown, websocket: boolean): URL {
 if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid Buzz workspace URL.');
 let url: URL;
 try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid Buzz workspace URL.'); }
 const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
 const secureProtocol = websocket ? 'wss:' : 'https:';
 const localProtocol = websocket ? 'ws:' : 'http:';
 if (url.protocol !== secureProtocol && !(loopback && url.protocol === localProtocol)) throw new Error('Use HTTPS and WSS for public workspaces. HTTP and WS are allowed only on localhost.');
 if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the workspace origin without credentials, paths, queries or fragments.');
 return url;
}

export function parseBuzzConnection(value: unknown): BuzzConnectionInput {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter your Buzz workspace details.');
 const input = value as Record<string, unknown>;
 if (typeof input.teamName !== 'string' || !input.teamName.trim() || input.teamName.trim().length > 100) throw new Error('Enter a team name of 1–100 characters.');
 const relay = workspaceUrl(input.relayUrl, true);
 const web = workspaceUrl(input.webUrl, false);
 if (relay.host !== web.host || (relay.protocol === 'wss:') !== (web.protocol === 'https:')) throw new Error('The web and relay URLs must use the same workspace host and transport.');
 return { teamName: input.teamName.trim(), relayUrl: relay.href, webUrl: web.href };
}

/** Public discovery only. Called from the browser; never proxies a user URL from the server. */
export async function probeBuzzRelay(relayUrl: string, fetcher: typeof fetch = fetch): Promise<{ name: string | null }> {
 const url = workspaceUrl(relayUrl, true);
 url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
 const response = await fetcher(url.href, { headers: { Accept: 'application/nostr+json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
 if (!response.ok) throw new Error(`Relay discovery returned HTTP ${response.status}.`);
 const document: unknown = await response.json();
 if (!document || typeof document !== 'object') throw new Error('This endpoint did not return a Buzz relay document.');
 const info = document as Record<string, unknown>;
 if (typeof info.software !== 'string' || !/^https:\/\/github\.com\/block\/buzz(?:\/|$)/.test(info.software) || !Array.isArray(info.supported_nips) || !info.supported_nips.includes(1)) throw new Error('This endpoint did not identify itself as a Buzz relay.');
 return { name: typeof info.name === 'string' ? info.name : null };
}
