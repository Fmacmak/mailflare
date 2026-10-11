#!/usr/bin/env bash
# Native setup for a trusted local checkout; never curl-pipe this script.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
install_tools=false
with_buzz=false
configure_only=false
for option in "$@"; do
 case "$option" in
  --install-tools) install_tools=true ;;
  --with-buzz) with_buzz=true ;;
  --configure-only) configure_only=true ;;
  --help) printf '%s\n' 'Usage: bash scripts/setup-macos.sh [--install-tools] [--with-buzz] [--configure-only]' 'Uses your existing PostgreSQL server. Prompts privately for credentials.'; exit 0 ;;
  *) printf 'Unknown option: %s\n' "$option" >&2; exit 1 ;;
 esac
done
[[ "$(uname -s)" == Darwin ]] || { printf '%s\n' 'This installer is for macOS.' >&2; exit 1; }
if $install_tools; then
 command -v brew >/dev/null || { printf '%s\n' 'Install Homebrew from https://brew.sh first, then rerun.' >&2; exit 1; }
 brew install node@24 go libpq cloudflared
 export PATH="$(brew --prefix node@24)/bin:$(brew --prefix libpq)/bin:$PATH"
 command -v pm2 >/dev/null || npm install -g pm2
 if $with_buzz; then
  brew install redis pnpm rustup
  export PATH="$(brew --prefix rustup)/bin:${HOME}/.cargo/bin:$PATH"
 fi
fi
for tool in node npm pm2 git; do
 command -v "$tool" >/dev/null || { printf 'Missing %s; rerun with --install-tools.\n' "$tool" >&2; exit 1; }
done
node scripts/selfhost.mjs configure
if $configure_only; then exit 0; fi
node scripts/selfhost.mjs minio:install
node scripts/selfhost.mjs build
node scripts/selfhost.mjs db:create
node scripts/selfhost.mjs up
if $with_buzz; then
 node scripts/selfhost.mjs buzz:configure
 node scripts/selfhost.mjs buzz:db:create
 node scripts/selfhost.mjs buzz:build
 node scripts/selfhost.mjs buzz:up
fi
printf '%s\n' 'Local services are ready. Finish the provider, hostname and startup steps in docs/setup-cli.md.'
