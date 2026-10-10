"use client";

import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Users, Radio, CheckCircle2 } from 'lucide-react';
import { authFetch } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseBuzzConnection, probeBuzzRelay, type BuzzConnection } from '@/lib/buzz/connection';

export default function BuzzPage() {
 const [connection, setConnection] = useState<BuzzConnection | null>(null);
 const [teamName, setTeamName] = useState('');
 const [webUrl, setWebUrl] = useState('');
 const [relayUrl, setRelayUrl] = useState('');
 const [loading, setLoading] = useState(true);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const [checking, setChecking] = useState(false);
 const [relayStatus, setRelayStatus] = useState('');
 useEffect(() => {
  const controller = new AbortController();
  authFetch('/api/buzz/connection', { signal: controller.signal }).then(async response => {
   const payload = await response.json() as { connection: BuzzConnection | null; error?: string };
   if (!response.ok) throw new Error(payload.error || 'Unable to load workspace.');
   const saved = payload.connection as BuzzConnection | null;
   setConnection(saved);
   if (saved) { setTeamName(saved.teamName); setWebUrl(saved.webUrl); setRelayUrl(saved.relayUrl); }
  }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load workspace.'); })
   .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  return () => controller.abort();
 }, []);
 async function save(event: FormEvent) {
  event.preventDefault(); setError(''); setNotice(''); setRelayStatus(''); setBusy(true);
  try {
   const input = parseBuzzConnection({ teamName, webUrl, relayUrl });
   const response = await authFetch('/api/buzz/connection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
   const payload = await response.json() as { connection: BuzzConnection | null; error?: string };
   if (!response.ok) throw new Error(payload.error || 'Unable to save workspace.');
   setConnection(payload.connection); setNotice('Workspace saved. Open Buzz to sign in and join your team.');
  } catch(cause) { setError(cause instanceof Error ? cause.message : 'Unable to save workspace.'); }
  finally { setBusy(false); }
 }
 async function disconnect() {
  setBusy(true); setError(''); setNotice('');
  try {
   const response = await authFetch('/api/buzz/connection', { method: 'DELETE' });
   if (!response.ok) throw new Error('Unable to remove workspace.');
   setConnection(null); setTeamName(''); setWebUrl(''); setRelayUrl(''); setRelayStatus('');
   setNotice('Workspace removed from Mailflare. Your Buzz account and team are unchanged.');
  } catch(cause) { setError(cause instanceof Error ? cause.message : 'Unable to remove workspace.'); }
  finally { setBusy(false); }
 }
 async function checkRelay() {
  if (!connection) return;
  setChecking(true); setRelayStatus('Checking public relay information…');
  try {
   const info = await probeBuzzRelay(connection.relayUrl);
   setRelayStatus(`Buzz relay reachable${info.name ? `: ${info.name}` : ''}. Sign in inside Buzz to verify team access.`);
  } catch { setRelayStatus('Relay could not be verified from this browser. Check the URL, HTTPS, tunnel and CORS settings. You can still open Buzz directly.'); }
  finally { setChecking(false); }
 }
 return <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-8">
  <div className="mb-8 flex items-center gap-4"><div className="rounded-2xl bg-amber-100 p-3 text-amber-700"><Users className="h-7 w-7" /></div><div><h1 className="text-2xl font-semibold text-neutral-900">Buzz for your team</h1><p className="mt-1 text-sm text-neutral-600">Keep your self-hosted team workspace close to your mail.</p></div></div>
  {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
  {notice && <p role="status" className="mb-4 rounded-xl bg-green-50 p-4 text-sm text-green-800">{notice}</p>}
  {loading ? <p role="status" className="text-sm text-neutral-600">Loading workspace…</p> : <>
   {connection && <section aria-label="Saved Buzz workspace" className="mb-6 rounded-2xl border border-neutral-200 bg-white p-6">
    <div className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" />Saved workspace</div>
    <h2 className="mt-3 text-lg font-semibold">{connection.teamName}</h2><p className="mt-1 break-all text-sm text-neutral-600">{connection.webUrl}</p>
    <p className="mt-3 text-sm text-neutral-600">Buzz manages your identity, team membership and conversations. Sign in there using your Buzz account.</p>
    <div className="mt-5 flex flex-wrap gap-3"><a href={connection.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">Open Buzz <ExternalLink className="h-4 w-4" /></a><Button variant="outline" disabled={checking || busy} onClick={checkRelay}><Radio className="mr-2 h-4 w-4" />{checking ? 'Checking…' : 'Check relay'}</Button><Button variant="ghost" disabled={busy} onClick={disconnect}>Remove workspace</Button></div>
    {relayStatus && <p role="status" className="mt-4 text-sm text-neutral-600">{relayStatus}</p>}
   </section>}
   <section className="rounded-2xl border border-neutral-200 bg-white p-6"><h2 className="text-lg font-semibold">{connection ? 'Update workspace' : 'Connect your workspace'}</h2><p className="mt-2 text-sm text-neutral-600">Use the web and relay URLs for your team’s Buzz installation. A separate Buzz sign-in is required.</p>
    <form onSubmit={save} className="mt-6 space-y-5">
     <div><label htmlFor="buzz-team-name" className="mb-2 block text-sm font-medium">Team name</label><Input id="buzz-team-name" value={teamName} onChange={event => setTeamName(event.target.value)} maxLength={100} required placeholder="Your team" /></div>
     <div><label htmlFor="buzz-web-url" className="mb-2 block text-sm font-medium">Buzz web URL</label><Input id="buzz-web-url" type="url" value={webUrl} onChange={event => { const value = event.target.value; setWebUrl(value); try { const url = new URL(value); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; setRelayUrl(url.href); } catch {} }} required placeholder="https://buzz.your-domain.com" /><p className="mt-2 text-xs text-neutral-500">For a native local instance, use http://127.0.0.1:3200.</p></div>
     <div><label htmlFor="buzz-relay-url" className="mb-2 block text-sm font-medium">Buzz relay URL</label><Input id="buzz-relay-url" type="url" value={relayUrl} onChange={event => setRelayUrl(event.target.value)} required placeholder="wss://buzz.your-domain.com" /></div>
     <Button type="submit" disabled={busy}>{busy ? 'Saving…' : connection ? 'Save changes' : 'Save workspace'}</Button>
    </form>
   </section>
   <section className="mt-6 rounded-2xl bg-amber-50 p-6 text-sm text-neutral-700"><h2 className="font-semibold text-neutral-900">Hosting a new Buzz instance</h2><p className="mt-2">Run Buzz’s native relay and web client on your laptop with a separate PostgreSQL database, Redis and MinIO bucket. Publish it through a dedicated Cloudflare Tunnel hostname, then enter that hostname above.</p><p className="mt-2">Your administrator must configure a Buzz owner identity and team membership. Mailflare saves the workspace link; it does not copy Buzz messages or hold your private signing key.</p></section>
  </>}
 </div>;
}
