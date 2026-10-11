# macOS / Apple Silicon with PM2, MinIO and Cloudflare Tunnel

This fork can run on an M1 Mac with 8 GB RAM, alongside Umami. Mailflare uses one Node process on `127.0.0.1:3100`, either SQLite under `data/mailflare` or a dedicated PostgreSQL database, and an S3-compatible private bucket. The included PM2 configuration runs MinIO on `127.0.0.1:9000` with its console on `127.0.0.1:9001`. No Docker, D1 or R2 is required. Use a current Node 22 patch release or newer supported Node version; this checkout was verified with Node 26.7.0.

For an interactive installer and configuration CLI, start with [the setup CLI guide](setup-cli.md). The steps below remain available for manual setup.

## 1. Install and build

On the spare laptop, use this modified checkout (or clone your fork after these changes have been published), then:

```sh
npm ci
npm rebuild better-sqlite3
npm run build:node
cp .env.selfhosted.example .env.selfhosted
chmod 600 .env.selfhosted
```

Use your existing PM2 installation. If PM2 is not installed, install it with `npm install -g pm2`. Keep a single Mailflare instance: its realtime hub, queues and scheduler are in-process.

Install a native MinIO executable and set `MINIO_BINARY` to its absolute path. MinIO's community repository is archived, and the old direct binary URL returned HTTP 410 during this setup. To build the pinned upstream source with Go installed:

```sh
mkdir -p "$HOME/.local/bin"
GOBIN="$HOME/.local/bin" go install github.com/minio/minio@v0.0.0-20260212201848-7aac2a2c5b7c
```

See [upstream MinIO](https://github.com/minio/minio) for its maintenance and installation status. The adapter supports standard S3 storage, so another compatible server can be used by changing the endpoint and credentials.

## 2. Configure private local storage

Edit `.env.selfhosted` locally:

- Set `MINIO_ROOT_USER` and a strong `MINIO_ROOT_PASSWORD`.
- Set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` to the same pair initially.
- Keep `S3_ENDPOINT=http://127.0.0.1:9000` and `S3_BUCKET=mailflare`.
- Set `RESEND_API_KEY` to your key. A full-access key is needed for automatic domain and webhook management; a sending-only key does not configure receiving.
- Set `APP_URL` to your eventual stable public HTTPS address before configuring webhooks.
- Leave `SMTP_INBOUND_PORT=0`; this setup receives through HTTPS, not a local SMTP listener.

Start only MinIO, then initialize its bucket:

```sh
pm2 start ecosystem.config.cjs --only mailflare-minio
npm run storage:init
```

The initialization script refuses non-local endpoints. Buckets are private; Mailflare serves authorized downloads through its own routes. Do not expose MinIO's API or console through the public tunnel. A bucket-scoped MinIO user can replace the root credentials in the `S3_*` variables afterwards.

## PostgreSQL alongside Umami

Mailflare supports PostgreSQL 14 or newer with a UTF8 database and can share the existing PostgreSQL **server**, using its own database and login. Keep Umami's database, schema and credentials separate. No second PostgreSQL server or Docker container is required. The default is still SQLite.

As your existing PostgreSQL administrator, create a role and database. In `psql`, use `\password` to enter the new password interactively:

```sql
CREATE ROLE mailflare LOGIN;
\password mailflare
CREATE DATABASE mailflare OWNER mailflare ENCODING 'UTF8' TEMPLATE template0;
```

Set these values in `.env.selfhosted`, replacing the example connection details and URL-encoding special characters in the password:

```dotenv
DATABASE_BACKEND=postgres
DATABASE_URL=postgresql://mailflare:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/mailflare
DATABASE_POOL_SIZE=4
```

Run `npm run setup:selfhosted` for a new installation as described below. Bootstrap and startup apply the PostgreSQL migrations in `drizzle/postgres` transactionally, with an advisory lock. SQLite continues to use `drizzle/migrations`. PostgreSQL uses integer flags and epoch-second timestamps to retain the app's existing data and JSON backup format; full-text search uses a PostgreSQL GIN index, and native triggers maintain trash timestamps and JMAP revisions.

For an existing SQLite installation, create an empty PostgreSQL database, stop Mailflare, configure PostgreSQL and restart. Restore a **full** Mailflare JSON database backup from Admin > Backups, and retain the same MinIO bucket and credentials. Do not run admin bootstrap before importing an existing installation. Keep the original SQLite file until the restored installation is verified. Database backups do not include MinIO objects; preserve those separately. `pg_dump`/`pg_restore` are also available for native PostgreSQL backups.

Validate against a disposable test database with:

```sh
MAILFLARE_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:5432/mailflare_test npm run test:postgres
```

The integration test creates and drops its own schema. It checks migrations, typed queries and joins, search, conversation pagination, spam feedback, booking conflicts, triggers, batch rollback, and backup/restore including SQLite import. Future schema changes must include a PostgreSQL migration as well as the upstream SQLite migration; do not regenerate the baseline for an existing installation. `scripts/generate-postgres-baseline.ts` is a development helper for reviewing a fresh baseline only.

## 3. Create your real admin and first mailbox

The upstream browser wizard assumes Cloudflare routing. This fork provides a local bootstrap command to avoid changing live DNS during account creation.

Set `MAILFLARE_ADMIN_EMAIL` to the first real mailbox (for example `you@your-domain.com`), and `MAILFLARE_ADMIN_PASSWORD` to a new password of at least 12 characters and at most 72 UTF-8 bytes. Optionally set `MAILFLARE_BRAND_NAME`. Set `MAILFLARE_RECEIVING_PROVIDER=resend` or `cloudflare`.

```sh
npm run setup:selfhosted
```

The command applies the existing migrations and atomically creates an admin, a domain, and a mailbox. Sending is Resend; receiving uses your choice. No DNS/provider APIs are called. It refuses to overwrite an existing admin. Do not copy the development `.wrangler` database or its demo credentials into production.

Clear `MAILFLARE_ADMIN_PASSWORD` from the file afterwards, then:

```sh
pm2 start ecosystem.config.cjs --only mailflare
pm2 logs mailflare
```

Log in at `http://127.0.0.1:3100/login`. **Admin > Branding** lets you change the name and upload a logo without a commercial branding license in this Node fork. Other upstream license entitlements are unchanged. The sidebar uses the configured brand. The upstream license and source attribution remain in this repository.

## 4. Reuse your Cloudflare Tunnel

Add a public hostname route to the existing tunnel:

```text
https://your-mail-hostname -> http://127.0.0.1:3100
```

Keep Umami's existing route. Set `APP_URL` to that HTTPS origin and restart Mailflare after changing configuration:

```sh
pm2 restart mailflare
```

WebSocket upgrades for `/api/realtime` must reach the app. Provider webhook endpoints must be reachable without a browser login or an interactive Cloudflare Access challenge. The application validates their signatures.

If cloudflared runs on another machine, the loopback address will not reach this Mac; configure a reachable private address and bind Mailflare accordingly instead.

## 5. Choose how to receive

### Resend receiving and sending

In **Admin > Domains**, select Resend for both providers. Use the provider card to finish setup. It enables receiving and registers a signed `email.received` webhook at `APP_URL/api/inbound/resend`; the app downloads the message and stores it locally in MinIO.

Existing Resend domains may already be verified for sending, but receiving and its MX records still need to be enabled. Keep Cloudflare as your DNS host. A scoped `CF_TOKEN` lets Mailflare manage records; otherwise follow the displayed Resend records and create them in Cloudflare yourself. Do not replace an existing provider's MX records until you are ready to switch incoming mail.

### Cloudflare receiving, Resend sending

Set receiving to Cloudflare and sending to Resend. Use the existing relay in [`deploy/cloudflare-email-relay`](../deploy/cloudflare-email-relay/README.md):

1. Generate a random `INBOUND_WEBHOOK_SECRET` locally and set it in `.env.selfhosted`.
2. Set that same secret on the relay Worker, and set its `MAILFLARE_URL` to the public HTTPS origin.
3. Deploy the small relay Worker separately when ready.
4. In Cloudflare Email Routing, route the selected addresses or catch-all to `mailflare-email-relay`.

The relay posts signed raw messages to `/api/inbound`. It does not use D1 or R2. Keep Cloudflare's MX records for this option; Resend is only the sender. Configure Resend DKIM/SPF as shown in its sending card. Do not use the app's Cloudflare Worker provisioning button to target the Node server: the relay route is configured in Cloudflare's dashboard.

## 6. Operations

After you have verified both processes, use `pm2 save`. Configure macOS startup using your existing PM2/launchd arrangement; `pm2 startup` prints platform-specific instructions if needed. Keep the laptop awake while serving mail.

Back up **both** `data/mailflare` and `data/minio`. SQLite or PostgreSQL stores mail metadata, provider/webhook settings and user accounts; MinIO stores raw messages, attachments, logos, Drive files and app backup objects. Automatic app backups in MinIO are on the same laptop and are not an off-device recovery copy. Stop Mailflare and MinIO before making a cold filesystem copy, or use SQLite's backup API / PostgreSQL `pg_dump` plus an S3-aware object backup. When using PostgreSQL, the `data/mailflare` folder is not a database backup: back up the PostgreSQL database explicitly.

Build updates while Mailflare is stopped so Next's build output is replaced safely; MinIO and Umami can remain running:

```sh
pm2 stop mailflare
npm ci
npm rebuild better-sqlite3
npm run build:node
pm2 restart mailflare
```

Do not rerun `setup:selfhosted` to update. Migrations run at startup. Setting `STORAGE_BACKEND=files` uses the original filesystem backend; changing storage backend does not migrate existing objects automatically.

Verification commands:

```sh
npm run test:selfhosted
npm run test:minio  # real local MinIO; deletes only its random verification objects
curl http://127.0.0.1:3100/api/setup/status
```

The unit suite exercises signed S3 HTTP requests, range downloads, metadata, multipart resume/abort, service errors, local bootstrap, configuration validation and branding policy. The real MinIO integration test also verifies a resumed 5 MiB multipart upload against the running server. Use a real inbound message and a test outgoing message after the public hostname and provider configuration are ready.

## Optional sidebar connections

The mail sidebar includes **WhatsApp** and **Buzz**. Enable private QR pairing with the [WhatsApp setup](whatsapp.md). Host a separate native Buzz team relay with the [Buzz PM2 setup](buzz.md), then save its workspace URL from the Buzz page. Buzz uses its own identity and membership; Mailflare does not receive its private signing keys.
