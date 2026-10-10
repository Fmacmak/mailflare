# WhatsApp linked-device connection

This fork includes a personal WhatsApp connection screen at `/whatsapp`, powered by [Baileys](https://github.com/WhiskeySockets/Baileys). Each authenticated Mailflare user owns an independent linked-device session. The screen manages pairing, status, reconnecting, cancellation, and disconnecting. It does not yet provide WhatsApp conversations, message sending, contact import, or a shared team inbox.

## Enable on the PM2 host

Requires the self-hosted Node runtime, one Mailflare process, and outbound HTTPS/WebSocket access. Cloudflare Workers cannot host this long-lived socket. Add to the private `.env.selfhosted` file:

```dotenv
WHATSAPP_ENABLED=true
WHATSAPP_MAX_SESSIONS=4
```

Restart Mailflare with PM2, then sign in and open **WhatsApp** in the sidebar. Choose **Connect WhatsApp**, open WhatsApp on your phone, select **Linked devices → Link a device**, and scan the real QR code. The code refreshes automatically. Pairing expires after two minutes; generate a new code to retry. No messages are sent by this action. Only your authenticated user can retrieve your QR/status or disconnect your session.

Four simultaneous connections is the suggested starting limit for the 8 GB host that also runs Umami and PostgreSQL. Limits apply to active sessions, including pairing attempts. Choose a limit suitable for the host. PM2 must use one instance in fork mode: multiple processes cannot share this filesystem auth store.

The app restores previously paired sessions after restart. It checks that the owning user remains active before restoring. Unpaired sessions do not create QR codes on startup; a person must choose **Connect WhatsApp**. Network interruptions retry up to five times with backoff. Revoking the linked device on your phone removes saved credentials when WhatsApp reports the logout; the page can start a new pairing.

## Credentials and backups

Baileys authentication state is saved under `DATA_DIR/whatsapp/<sha256(user-id)>`. The root and user directories have mode `0700`; owner manifests have mode `0600`. The Baileys multi-file auth helper serializes credential-file writes. The owning OS account can still read these secrets: protect the laptop account and disk. Do not put this directory in Git or a publicly served location.

Mailflare's database backup does **not** contain these session credentials. Stop Mailflare before taking a separate private filesystem backup of `DATA_DIR/whatsapp`, or omit it and pair again after restoring. Never share session backups or pairing codes. **Disconnect** logs out the linked device and erases its local directory; if the remote logout cannot complete during a network outage, also remove the device from WhatsApp's Linked devices screen.

Baileys implements the WhatsApp Web protocol independently of WhatsApp's official Business Platform. This implementation pins its version and leaves message operations disabled. For a production messaging product, evaluate the official WhatsApp Business Platform separately and review Baileys upgrades before deployment.

## Development checks

```sh
node --import tsx --test tests/whatsapp/*.test.ts
```

Tests cover user isolation, duplicate pairing, QR expiry, disabled-server behavior, request-origin protection, concurrent disconnect/reconnect, stale socket events, reconnection, startup pairing restrictions, and private credential paths. A real account scan and restart reconnect must still be checked by the account owner on the deployed host.
