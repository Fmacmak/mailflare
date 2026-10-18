#!/usr/bin/env node
/** Explicit, rerunnable setup for the native installation. Secrets never enter argv or logs. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Client } from "pg";
import { addMailflareIngress } from "./selfhost/cloudflare.mjs";
import {
  readPrivateEnv,
  writePrivateEnv,
  buildConfig,
} from "./selfhost/config.mjs";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [accountId, zoneId, hostname] = process.argv.slice(2);
if (
  !/^[a-f0-9]{32}$/.test(accountId || "") ||
  !/^[a-f0-9]{32}$/.test(zoneId || "") ||
  !/^mail\.[a-z0-9.-]+$/.test(hostname || "")
)
  throw new Error(
    "Usage: node scripts/cloudflare-setup.mjs ACCOUNT_ID ZONE_ID mail.example.com",
  );
const file = resolve(root, ".env.selfhosted"),
  env = readPrivateEnv(file);
const token = (
  process.env.CLOUDFLARE_API_TOKEN ||
  readFileSync(resolve(root, ".cloudflare-setup-token"), "utf8")
).trim();
if (!token || /\s/.test(token))
  throw new Error(
    "Save only the API token value in .cloudflare-setup-token first.",
  );
async function api(path, init = {}) {
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    signal: AbortSignal.timeout(60000),
  });
  const json = await r.json();
  if (!r.ok || !json.success) {
    const error = new Error(
      `Cloudflare ${r.status}: ${json.errors?.map((e) => e.message).join("; ") || "request failed"}`,
    );
    error.status = r.status;
    throw error;
  }
  return json.result;
}
const zone = await api(`/zones/${zoneId}`);
if (zone.account?.id !== accountId || !hostname.endsWith("." + zone.name))
  throw new Error("Account, zone and hostname do not match.");
// Check Email Routing permissions before deploying or exposing infrastructure.
await api(`/zones/${zoneId}/email/routing`);
const tunnels = await api(`/accounts/${accountId}/cfd_tunnel?is_deleted=false`);
const candidates = [];
for (const tunnel of tunnels) {
  if (tunnel.config_src !== "cloudflare") continue;
  const current = await api(
    `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`,
  );
  if (
    current.config?.ingress?.some((rule) =>
      /^http:\/\/(localhost|127\.0\.0\.1):3000\/?$/.test(rule.service || ""),
    )
  )
    candidates.push({ tunnel, current });
}
if (candidates.length !== 1)
  throw new Error(
    "Could not uniquely identify the existing Umami tunnel. No changes made.",
  );
const { tunnel, current } = candidates[0];
const tunnelPath = `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`;
const next = addMailflareIngress(current.config, hostname, Number(env.PORT));
const records = await api(
  `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`,
);
const cname = `${tunnel.id}.cfargotunnel.com`;
if (
  records.some((record) => record.type !== "CNAME" || record.content !== cname)
)
  throw new Error(
    "Public hostname already has a different DNS record; no changes made.",
  );
const workerName = env.CF_EMAIL_WORKER_NAME || "mailflare-email-relay";
const workerPath = `/accounts/${accountId}/workers/scripts/${workerName}`;
const existing = await fetch(
  "https://api.cloudflare.com/client/v4" + workerPath,
  {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  },
);
if (existing.ok) {
  const source = await existing.text();
  if (
    !source.includes("X-Mailflare-Signature") ||
    !source.includes("/api/inbound")
  )
    throw new Error("Worker name already belongs to another application.");
} else if (existing.status !== 404)
  throw new Error(`Unable to inspect existing Worker (${existing.status}).`);
const secrets = buildConfig(
  env,
  { MAILFLARE_RECEIVING_PROVIDER: "cloudflare" },
  root,
);
const output = await build({
  entryPoints: [resolve(root, "deploy/cloudflare-email-relay/src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});
const body = new FormData();
body.set(
  "metadata",
  JSON.stringify({
    main_module: "worker.js",
    compatibility_date: "2026-05-20",
    bindings: [
      {
        name: "MAILFLARE_URL",
        type: "secret_text",
        text: `https://${hostname}`,
      },
      {
        name: "INBOUND_WEBHOOK_SECRET",
        type: "secret_text",
        text: secrets.INBOUND_WEBHOOK_SECRET,
      },
    ],
  }),
);
body.set(
  "worker.js",
  new Blob([output.outputFiles[0].text], {
    type: "application/javascript+module",
  }),
  "worker.js",
);
const snapshots = resolve(root, "data/cloudflare-setup");
mkdirSync(snapshots, { recursive: true, mode: 0o700 });
writeFileSync(
  resolve(snapshots, `tunnel-before-${Date.now()}.json`),
  JSON.stringify(current, null, 2),
  { mode: 0o600 },
);
await api(workerPath, { method: "PUT", body });
console.log("Email relay Worker deployed.");
await api(tunnelPath, {
  method: "PUT",
  body: JSON.stringify({ config: next }),
});
if (!records.length)
  await api(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "CNAME",
      name: hostname,
      content: cname,
      proxied: true,
      ttl: 1,
    }),
  });
writePrivateEnv(
  file,
  buildConfig(
    secrets,
    {
      CF_TOKEN: token,
      CF_ACCOUNT_ID: accountId,
      CF_EMAIL_WORKER_NAME: workerName,
      APP_URL: `https://${hostname}`,
    },
    root,
  ),
);
console.log(
  "Public tunnel route configured; Umami ingress preserved. Private runtime configuration saved. Restart Mailflare before enabling email routes.",
);
const db = new Client({ connectionString: env.DATABASE_URL });
try {
  await db.connect();
  await db.query(
    "UPDATE domains SET zone_id=$1, receiving_provider='cloudflare', routing_enabled=0 WHERE hostname=$2 AND (zone_id='manual' OR zone_id=$1)",
    [zoneId, zone.name],
  );
} finally {
  await db.end();
}
console.log(
  "Domain attached to Cloudflare. Use Admin > Domains > Receiving > Setup after public health verification, then create users in Admin > Accounts.",
);
