# Buzz team workspaces

Mailflare’s **Buzz** navigation item saves a workspace per Mailflare user. Enter the
team name, HTTPS web origin and corresponding WSS relay origin. **Open Buzz** opens
its web client in a new tab; Buzz handles identity, invitations and membership.
Mailflare never receives your Buzz private signing key. Removing the workspace
only removes this user’s saved connection; it does not delete the Buzz account,
team, messages or other Mailflare users’ saved connections.

**Check relay** requests the public NIP-11 document from the browser with no
credentials. It checks Buzz’s software identifier and supported NIP-01 protocol.
“Relay reachable” proves discovery, not authentication or team membership. This
check can fail because of CORS or a browser’s local-network restrictions even
when opening Buzz directly works. The API never fetches a user-supplied URL.

## Native macOS installation, without Docker

Reference inspected: [block/buzz](https://github.com/block/buzz), commit
`845fc16ebf5ec84f87a94ceaf69bb79c004b3a76`. Buzz’s relay is Rust, uses PostgreSQL and
Redis, stores media and Git objects in S3/MinIO, and can serve its built web client.
Its native relay and web assets must be built separately from Mailflare. This
scaffold provides launch configuration; no live Buzz workspace has been created,
and a native Buzz build was not run during this Mailflare change.

An 8 GB M1 can be a reasonable starting point for a small team, but no combined
Mailflare/Umami/Buzz load benchmark has been run. The launcher limits PostgreSQL
and Redis pools, upload concurrency and Redis memory. Build Rust with one job;
compilation can require substantial disk space, time and swap. Do builds while
other heavy work is stopped. Monitor memory pressure and PM2 restarts before
inviting a larger team. Git hosting and agent workloads can be much heavier than
chat. The PM2 memory limit applies to the Node launcher, not its Rust child;
use Activity Monitor to observe the relay and Redis themselves.

1. Install Xcode Command Line Tools, Git, Rust/rustup, Node 24+, pnpm 10 and Redis.
   Use Homebrew `brew install redis` for Redis. Do not start its default service
   if you intend to use the dedicated PM2 Redis below. Buzz already uses pnpm.
2. Clone Buzz outside Mailflare and pin the inspected revision:

   ```sh
   git clone https://github.com/block/buzz.git "$HOME/buzz"
   cd "$HOME/buzz"
   git checkout 845fc16ebf5ec84f87a94ceaf69bb79c004b3a76
   rustup toolchain install 1.95.0
   CARGO_BUILD_JOBS=1 cargo build --release --locked -p buzz-relay --bin buzz-relay -p buzz-admin --bin buzz-admin
   pnpm install --frozen-lockfile --filter buzz-web
   pnpm -C web build
   ```

   The pinned checkout’s `rust-toolchain.toml` selects Rust 1.95.0. Runtime SQLx
   queries do not require a running database to compile. Do not use `just setup`:
   upstream’s quick-start command starts Docker services.
3. On the existing PostgreSQL server, create a **separate** `buzz` role and `buzz`
   database owned by that role. Keep Umami and Mailflare database credentials
   separate. With a PostgreSQL administrative connection:

   ```sql
   CREATE ROLE buzz LOGIN;
   -- In psql, use \password buzz to set its password interactively.
   CREATE DATABASE buzz OWNER buzz;
   ```

4. Reuse the native MinIO service, creating a separate `buzz-media` bucket in
   its console and a dedicated access key scoped to that bucket. Buzz needs
   read/write/list/delete and multipart permissions for its objects. Avoid
   granting access to Mailflare’s bucket. MinIO remains managed by Mailflare’s
   existing PM2 entry; the Buzz ecosystem does not start another copy.
5. From Mailflare’s root, copy `deploy/buzz/env.example` to `deploy/buzz/.env` and
   `chmod 600 deploy/buzz/.env`. The actual file is ignored by Git. Set absolute
   `BUZZ_SOURCE_DIR` and `BUZZ_DATA_DIR`, Buzz’s database credentials and MinIO
   credentials. Generate separate stable relay and Git HMAC secrets using
   `openssl rand -hex 32` twice and put them in the corresponding fields.
6. Establish your own Buzz/Nostr identity. You can use the upstream CLI
   `"$HOME/buzz/target/release/buzz-admin" generate-key` locally; keep the private
   key in your password manager. Set `RELAY_OWNER_PUBKEY` to your **public hex
   key** and sign in to Buzz with that identity. Never paste the private key into
   Mailflare. This launcher requires a private, membership-restricted team.
7. Start the isolated Redis instance, run migrations once, then start the relay:

   ```sh
   pm2 start deploy/buzz/ecosystem.config.cjs --only buzz-redis
   node --env-file=deploy/buzz/.env deploy/buzz/run.mjs admin migrate
   pm2 start deploy/buzz/ecosystem.config.cjs --only buzz-relay
   pm2 logs buzz-relay
   ```

   Use the same modern Node PATH used for Mailflare. Redis binds
   `127.0.0.1:6380`, uses append-only persistence under `BUZZ_DATA_DIR/redis`, and
   has a 128 MB cap with `noeviction` so membership/coordination keys are not
   silently discarded. Memory-full errors need operator attention. The relay
   binds `127.0.0.1:3200` and serves `web/dist` at
   [localhost:3200](http://127.0.0.1:3200). Auto-migration is disabled; run the
   explicit admin command during controlled updates.

   The upstream relay also binds separate health and metrics listeners on all
   interfaces (defaults overridden for health to `8083`; metrics `9102`). These
   are not tunnel targets. Keep these ports private with the laptop firewall
   or trusted network. Do not forward them from the router.
8. Sign in as the owner in Buzz. Add teammates through Buzz’s own invitation or
   membership flow. Alternatively the operator can explicitly run
   `node --env-file=deploy/buzz/.env deploy/buzz/run.mjs admin add-member --pubkey PUBLIC_HEX_OR_NPUB`.
   `admin list-members` inspects the membership list. Mailflare does not grant
   team access merely by saving a workspace link.
9. Add a **dedicated** Cloudflare Tunnel hostname for Buzz pointing to
   `http://127.0.0.1:3200`. HTTP and WebSocket traffic must use the same host.
   Change `RELAY_URL` to `wss://buzz.your-domain.com`, configure
   `BUZZ_MEDIA_BASE_URL=https://buzz.your-domain.com/media`,
   `BUZZ_MEDIA_SERVER_DOMAIN=buzz.your-domain.com`, and
   `BUZZ_CORS_ORIGINS=https://buzz.your-domain.com,https://mail.your-domain.com`
   with your actual public origins. Restart `buzz-relay`; keep its private relay
   and HMAC keys stable. Save the HTTPS/WSS public URLs on Mailflare’s Buzz page.
   Preserve the Host header when configuring any reverse proxy because Buzz
   derives the community from it. Authentication/Access layers must allow
   Buzz’s web client to establish its authenticated WebSocket session.

Only run `pm2 save` once you have reviewed all processes in your own PM2 instance.
Set up the existing PM2 login/startup flow on macOS so processes survive a reboot.

## Backups, updates and verification

Back up Buzz PostgreSQL with `pg_dump`, its MinIO bucket, `BUZZ_DATA_DIR` (Redis AOF,
Git data/cache as needed), and its `.env` secrets securely. Back up the Buzz user’s
private identity key independently. A Mailflare database backup includes saved
workspace links; it does not include Buzz’s own database or objects.

Stop the relay before a planned update, pin the new reviewed upstream revision,
rebuild the Rust binary and web bundle, run `admin migrate`, then restart and
verify sign-in, memberships, a small test message, media upload and a WebSocket
reconnect in Buzz using your own account. A test message is a human action, not
performed by this setup change. Do not replace relay keys on updates.

Mailflare connector tests:

```sh
node --import tsx --test tests/buzz/*.test.ts
```

The tests cover URL validation, public discovery, per-user storage isolation and
removal, private native-launch requirements, and separate local process settings.
