# Native setup and configuration CLI

Run this from your fork on the spare Mac. It uses npm for Mailflare, PM2 for the
application and MinIO, and your existing PostgreSQL server alongside Umami.
Buzz is optional and uses Rust and pnpm. It shares your existing PostgreSQL
server with its own `buzz` database/role and uses a separate MinIO bucket. Redis
can be your existing Homebrew service; an isolated PM2 Redis is also supported. No Docker, D1 or R2 is needed.

## Quick start

Clone the fork and enter its folder. Install Xcode Command Line Tools if missing
(`xcode-select --install`) and [Homebrew](https://brew.sh). Then:

```sh
git clone https://github.com/Fmacmak/mailflare.git
cd mailflare
# With Node 24+ and npm already on PATH:
npm run setup:macos -- --install-tools
# Without Node/npm yet, use: bash scripts/setup-macos.sh --install-tools
```

The installer installs Node 24, Go, PostgreSQL client tools and cloudflared with
Homebrew, and PM2 with npm if missing. It does **not** start, stop or upgrade your
existing PostgreSQL service. It builds pinned MinIO source if your configured
executable is missing. See the [MinIO source/maintenance notes](macos-pm2.md).
Native compilation needs free disk space and can take time on an 8 GB laptop.

If the tools are already installed and in PATH, omit `--install-tools`.
To include a new Buzz instance, use:

```sh
npm run setup:macos:all
```

The prompts request:

- Database backend (PostgreSQL by default) and a dedicated connection URL such as
  `postgresql://mailflare:URL_ENCODED_PASSWORD@127.0.0.1:5432/mailflare`.
- First real admin mailbox and initial password (12+ characters, at most 72 bytes).
  Use a mailbox on a domain you intend to connect, not demo credentials.
- Brand name, HTTP loopback origin for initial testing or your public HTTPS origin,
  Resend key, receiving provider and optional WhatsApp QR pairing.
- MinIO executable path. Storage credentials are generated on first configuration
  and retained on reruns. Existing manually configured credentials are preserved.
- A PostgreSQL administrator URL during database creation. This is used in memory
  for that command and is not written to the configuration file.

Passwords, API keys and database URLs are entered without echo. `.env.selfhosted`
and `deploy/buzz/.env` are written atomically with mode 0600 and ignored by Git.
Changing the brand name through the CLI sets the initial bootstrap name; later
changes to name and logo use **Admin > Branding**.

The installer builds Mailflare, creates its database if needed, starts MinIO,
creates a private bucket, applies migrations, creates the first admin/mailbox,
then starts Mailflare and checks health. It clears the initial admin password
from the configuration after successful bootstrap. An existing admin is left
untouched; rerunning configuration does not reset its password.

Automatic database creation is restricted to a matching `mailflare` role/database
and, for Buzz, `buzz`. It never alters existing role passwords or Umami resources.
Both databases must use UTF8 and be owned by their dedicated roles. If your role
already exists, supply its existing password. For custom names, provision them
manually and skip `db:create` using the step-by-step commands below. For SQLite,
no PostgreSQL database is created.

If no PostgreSQL server exists, install/start one explicitly before setup:

```sh
brew install postgresql@18
brew services start postgresql@18
```

Do this only on a machine that has no PostgreSQL installation; an existing Umami
server should be reused instead. Its administrative URL can use the current
macOS role and `/postgres` database when local authentication permits it.

## Individual commands

Keep Node 24+ and your tools on PATH in future terminal sessions. Homebrew's
Node 24 and Rustup are keg-only; use their formula paths, for example:

```sh
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix libpq)/bin:$PATH"
# If hosting Buzz:
export PATH="$(brew --prefix rustup)/bin:$HOME/.cargo/bin:$PATH"
```

These paths follow the Homebrew [Node 24](https://formulae.brew.sh/formula/node@24) and [Rustup](https://formulae.brew.sh/formula/rustup) installation instructions.

The CLI runs without installed application dependencies for `configure` and
`help`. Database commands require `npm ci`; `build` performs that install.

```sh
npm run selfhost -- help
npm run selfhost -- configure
npm run selfhost -- minio:install
npm run selfhost -- build
npm run selfhost -- db:create
npm run selfhost -- up
npm run selfhost -- doctor
npm run selfhost -- status
npm run selfhost -- down
```

`--file /absolute/path/.env` selects another private Mailflare configuration file;
the PM2 launcher receives that path. PM2 names remain `mailflare` and
`mailflare-minio`, so this is for selecting a configuration, not simultaneous
instances. Use `PM2_HOME` consistently if you already use an isolated PM2 daemon.
The CLI refuses to stop/restart a same-named PM2 app owned by another checkout.
`down` stops only those two processes; shared PostgreSQL and Umami remain running.
Stop Buzz separately with `buzz:down`; in existing Redis mode this stops only
the relay and leaves Homebrew Redis running. No command deletes stored data.

For updates, stop Mailflare before replacing its build. Back up the dedicated
PostgreSQL database and MinIO objects first:

```sh
npm run selfhost -- down
npm run selfhost -- build
npm run selfhost -- up
```

For an existing SQLite-to-PostgreSQL backup import, **do not use `up` or
`bootstrap` before restoring**: those commands create an admin in an empty DB.
Use the [manual migration procedure](macos-pm2.md#postgresql-alongside-umami).

## Unattended configuration

Store environment keys as strings in a private JSON file (chmod 600), or pipe
JSON from your secret manager. Never put real secrets in command-line arguments,
a checked-in script or shell history. The JSON can contain a partial update;
unspecified existing settings are preserved. An empty string explicitly clears
a value, except required/generated storage credentials.

```sh
node scripts/selfhost.mjs configure --input-json /private/path/mailflare.json
# Or a secret manager can write the JSON to stdin:
# secret-manager-command | node scripts/selfhost.mjs configure --input-json -
```

For unattended provisioning, provide `MAILFLARE_PG_ADMIN_URL` in the environment
from your secret manager. It must address the same host/port as the target URL.
This admin URL is excluded from child process environments. It is not a runtime
credential. `doctor` reports only sanitized connection results.

## Finish domain and provider setup

Keep your existing Umami tunnel route. Add only these routes as needed to the
existing Cloudflare Tunnel, through its dashboard or your existing ingress file:

```text
mail.your-domain.example -> http://127.0.0.1:3100
buzz.your-domain.example -> http://127.0.0.1:3200  (optional; WebSockets required)
```

Do not tunnel MinIO, Redis, PostgreSQL or Buzz's health port. The installer does
not replace your tunnel configuration, edit DNS/MX records, publish Workers or
send messages. These steps require your selected hostname/provider account.

Set the final public `APP_URL` using `configure`, then run `up` to restart with
that configuration. Log in and finish **Admin > Domains**. Resend webhooks use
`/api/inbound/resend`; its receiving MX records must be enabled separately from
sending verification. Resend/provider webhook endpoints must be publicly
reachable without an interactive Cloudflare Access challenge.

For Cloudflare Email Routing, configuration generates an
`INBOUND_WEBHOOK_SECRET` if missing. Read it locally from your private file and
set the same secret on the [email relay Worker](../deploy/cloudflare-email-relay/README.md).
Deploy/configure that relay and Email Routing explicitly. It uses no D1 or R2.
See the [provider setup guide](macos-pm2.md#5-choose-how-to-receive).

## Optional Buzz and WhatsApp

Buzz prompts additionally request source/data directories, a `buzz` database URL
on the existing PostgreSQL server, Redis mode/URL, relay WSS origin, and your
**public** Nostr owner key. Its relay secret and Git
HMAC secret are generated once. The owner identity's private key is never
requested by Mailflare. Establish your owner identity first following
[Buzz's guide](buzz.md); its key-generation command requires the native admin
binary. If you have no identity yet, do the manual native build from that guide
first, generate/store your identity, then run `buzz:configure`.

```sh
npm run selfhost -- buzz:configure
npm run selfhost -- buzz:db:create
npm run selfhost -- buzz:build
npm run selfhost -- buzz:up
npm run selfhost -- buzz:down
```

For an existing Homebrew Redis service, set these in `deploy/buzz/.env` (or use
`buzz:configure`):

```dotenv
BUZZ_REDIS_MODE=existing
REDIS_URL=redis://127.0.0.1:6379/1
```

Choose an unused logical database (1 is an example; check your other apps). Buzz
checks Redis with `redis-cli PING` before starting. If Redis is installed but
stopped, start it with `brew services start redis`. The CLI never starts, stops
or changes Homebrew Redis settings. An authenticated local Redis URL is also
supported; enter its password through the hidden URL prompt.

For a separate PM2 instance instead, set `BUZZ_REDIS_MODE=managed` and
`REDIS_URL=redis://127.0.0.1:6380/0`. Older configuration files without a mode
keep the original managed behavior. When switching from managed to existing,
stop the old `buzz-redis` PM2 process explicitly first; it is not a Homebrew
service. Redis logical databases separate keys, but Pub/Sub channels and memory
policies remain shared. Run only one Buzz team deployment against this shared
Redis unless you have reviewed its channel namespaces. Configure persistence
and `noeviction` on the existing service as appropriate for all its apps; the
launcher applies its own AOF/memory settings only in managed mode.

The CLI clones the inspected Buzz revision only into a missing directory. It
refuses a different existing revision instead of resetting local work. Rust is
built with one job; a running Buzz relay must be stopped first. Initial Buzz
storage uses the same MinIO access key with a separate `buzz-media` bucket;
replace that key with a bucket-scoped key in `deploy/buzz/.env` for tighter
isolation. Membership, signing in and invitations happen in Buzz's own UI.
Save its workspace URL in **Mailflare > Buzz** afterwards.

Enable WhatsApp through `configure`, run `up`, then open **WhatsApp** and scan
its QR with your phone. This manages pairing/sessions, personal and group chat history, and text sending. Media previews show captions and type; open WhatsApp to view or send media.

After verifying the services, use `pm2 save` and your existing macOS PM2/launchd
startup arrangement. `pm2 startup` prints the required platform command. Keep
the laptop awake. Back up PostgreSQL and MinIO off-device; PM2 is not a backup.

## Checks and troubleshooting

```sh
npm run test:setup
npm run test:selfhosted
pm2 logs mailflare --lines 50
pm2 logs mailflare-minio --lines 50
```

The installer fails immediately on a command error. Already created resources
remain available for diagnosis and reruns; it does not roll them back or delete
data. Resolve occupied ports, wrong database credentials, missing binaries or
compilation failures, then continue with the corresponding CLI command. A
healthy local installation still needs a real inbound/outbound mail check after
its public hostname and DNS/provider configuration are ready.

## Cloudflare API token onboarding on a native host

Set `CF_TOKEN` privately through `configure` (hidden prompt) or `--input-json`, and
set `CF_EMAIL_WORKER_NAME=mailflare-email-relay` after deploying that relay.
The runtime uses this server-side token to create address routes when an admin
creates accounts or aliases. New users never need the token. Create users from
**Admin > Accounts**, select the configured domain, and give each user their own
initial login. Public registration remains closed after the first admin.

For this installation's existing remotely managed macOS tunnel, the explicit
setup command below deploys the relay, preserves existing ingress, adds a mail
hostname, and attaches the existing domain to Cloudflare. It reads the token
from the private `.cloudflare-setup-token` file (or `CLOUDFLARE_API_TOKEN`), not
command-line arguments. The setup token needs Workers Scripts Edit and
Cloudflare Tunnel Edit on the target account, plus DNS Edit, Email Routing Rules
Edit, Zone Settings Edit and Zone Read on the chosen zone. Worker/tunnel permissions are needed only
for infrastructure setup; routine user onboarding needs the zone permissions.

```sh
node scripts/cloudflare-setup.mjs ACCOUNT_ID ZONE_ID mail.example.com
node scripts/selfhost.mjs up
```

After the public login page is reachable, run **Admin > Domains > Receiving >
Cloudflare > Setup** to enable the receiving DNS and Worker routes. Other
providers' MX records require explicit replacement confirmation. The setup
script refuses to overwrite a hostname or Worker owned by another application
and saves the previous tunnel configuration privately under
`data/cloudflare-setup`. Outgoing email needs a separately configured sending
provider; Email Routing alone does not enable outbound sending.
