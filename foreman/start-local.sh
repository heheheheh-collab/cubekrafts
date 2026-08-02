#!/usr/bin/env bash
# Run Foreman on this machine.
#
# Everything here is reversible and local: a database called `foreman`, a
# node_modules, and a directory under ~/.foreman for drafts. Nothing is
# deployed, nothing is sent, and no key is written to disk.
#
#   ./start-local.sh
#
# Re-running it is safe. It skips whatever is already done.

set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ── node ────────────────────────────────────────────────────────────────────
command -v node >/dev/null || die "Node is not installed. Get Node 22 or newer from nodejs.org."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || die "Foreman needs Node 22 or newer. This is $(node -v).
It runs TypeScript directly, which older versions cannot do."

# ── postgres ────────────────────────────────────────────────────────────────
# Skipped entirely when DATABASE_URL is already set — that is the escape hatch
# for a hosted database, and the common case for anyone who would rather not
# install Postgres at all.
if [ -z "${DATABASE_URL:-}" ]; then
  command -v psql >/dev/null || die "Postgres is not installed, and DATABASE_URL is not set.

Either install it:
    macOS    brew install postgresql@16 && brew services start postgresql@16
    Ubuntu   sudo apt install -y postgresql

Or use a free hosted one — make a database at neon.tech, then:
    export DATABASE_URL='postgres://...'   # and run this again"

  if ! pg_isready -q 2>/dev/null; then
    say "Starting Postgres…"
    if command -v brew >/dev/null; then
      brew services start postgresql@16 >/dev/null 2>&1 ||
        brew services start postgresql >/dev/null 2>&1 || true
    else
      sudo service postgresql start >/dev/null 2>&1 || true
    fi
    for _ in 1 2 3 4 5 6 7 8 9 10; do pg_isready -q 2>/dev/null && break; sleep 1; done
  fi
  pg_isready -q 2>/dev/null || die "Could not start Postgres. Start it yourself and run this again."

  # A Debian/Ubuntu install has no role for your user; a Homebrew one does.
  psql -d postgres -c 'select 1' >/dev/null 2>&1 ||
    sudo -u postgres createuser -s "$(whoami)" >/dev/null 2>&1 || true

  psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw foreman || {
    say "Creating the database…"
    createdb foreman
  }
  export DATABASE_URL="postgres://localhost/foreman"
fi

# ── the key ─────────────────────────────────────────────────────────────────
# Read into the environment of this process only. Not echoed, not written to a
# file, not added to your shell history.
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  say "Anthropic API key"
  echo "From console.anthropic.com. Set a spend limit there while you try this."
  read -rsp "  Paste it (input hidden): " ANTHROPIC_API_KEY
  echo
  [ -n "$ANTHROPIC_API_KEY" ] || die "No key, no agents. Nothing else was changed."
  export ANTHROPIC_API_KEY
fi

# ── dependencies ────────────────────────────────────────────────────────────
[ -d node_modules ] || { say "Installing dependencies…"; npm install --no-audit --no-fund; }

# ── go ──────────────────────────────────────────────────────────────────────
# A minute rather than ten: right for somebody sitting in front of it, wrong
# for a server, which is why it is set here and not in the code.
export TICK_MS="${TICK_MS:-60000}"
export FOREMAN_ORIGIN="${FOREMAN_ORIGIN:-http://localhost:7777}"

say "Starting Foreman on http://localhost:7777"
cat <<'NEXT'
  1. Register a passkey — Touch ID, Windows Hello, or your phone.
  2. WRITE DOWN THE RECOVERY CODE. It is shown once and never again.
  3. Type: what's pending
  4. Then give it something to do, and use ⋯ → Run now rather than waiting.

  Ctrl-C to stop. Email, git and Cubekrafts stay switched off until they are
  configured, and the boot lines below say so plainly.

NEXT

exec npm start
