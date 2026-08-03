#!/usr/bin/env bash
# Run Foreman on this machine.
#
# Everything here is reversible and local: a database called `foreman`, a
# node_modules, and a directory under ~/.foreman for drafts and the model.
# Nothing is deployed, nothing is sent, and no key is asked for or written to
# disk — Foreman brings its own model.
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
# A DATABASE_URL that is still a placeholder is worse than none at all: it
# skips this whole section and then fails forty lines later inside the pg
# driver, with an ENOTFOUND naming a hostname of "..." that explains nothing.
# Documentation writes `postgres://...` and people paste it, so catch it here.
if [ -n "${DATABASE_URL:-}" ]; then
  DB_HOST=$(node -e 'try{const u=new URL(process.argv[1]);console.log(u.hostname)}catch{console.log("")}' "$DATABASE_URL")
  case "$DB_HOST" in
    ''|*.\.\.*|...|'<'*|*'>'|your-host*|host|HOST)
      die "DATABASE_URL is still a placeholder:

    $DATABASE_URL

That is example text, not a database. Either clear it and let this script set
up a local one:

    unset DATABASE_URL && ./start-local.sh

or paste the real connection string from Neon or Supabase, which looks like
    postgres://user:password@ep-something.aws.neon.tech/dbname" ;;
  esac
fi

# Skipped entirely when DATABASE_URL is a real one — that is the escape hatch
# for a hosted database, and the common case for anyone who would rather not
# install Postgres at all.
if [ -z "${DATABASE_URL:-}" ]; then
  command -v psql >/dev/null || die "Postgres is not installed, and DATABASE_URL is not set.

Either install it:
    macOS    brew install postgresql@16 && brew services start postgresql@16
    Ubuntu   sudo apt install -y postgresql

Or use a free hosted one — make a database at neon.tech and paste the whole
connection string it gives you, which looks like this but is not this:
    export DATABASE_URL='postgres://user:pw@ep-x.aws.neon.tech/dbname'
then run this again."

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

# ── the model ───────────────────────────────────────────────────────────────
# No key is asked for and none is needed. Foreman runs its own model, so the
# only thing this section does is warn you once about the download.
#
# A key in the environment is taken as saying you want it used, and is read
# into this process only: not echoed, not written to a file, not added to your
# shell history.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_API_KEY=$(printf '%s' "$ANTHROPIC_API_KEY" | tr -d '[:space:]')
  case "$ANTHROPIC_API_KEY" in
    sk-ant-*) export ANTHROPIC_API_KEY ;;
    *) die "ANTHROPIC_API_KEY is set but does not begin with 'sk-ant-'.
Fix it, or 'unset ANTHROPIC_API_KEY' to run on the built-in model instead." ;;
  esac
  say "Using Anthropic, because ANTHROPIC_API_KEY is set."
  echo "  unset it to run entirely on this machine instead."
fi

# ── dependencies ────────────────────────────────────────────────────────────
[ -d node_modules ] || { say "Installing dependencies…"; npm install --no-audit --no-fund; }

# ── which brain ─────────────────────────────────────────────────────────────
# Asked once, on the first run only, because it is the one choice that changes
# how good the results are and there is no default that is right for everyone.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${FOREMAN_PROVIDER:-}" ] && [ -z "${FOREMAN_LOCAL_URL:-}" ]; then
  MODELS_DIR="${FOREMAN_HOME:-$HOME/.foreman}/models"
  # Only when there is somebody there to answer. Piped or scripted, this whole
  # block is skipped and the built-in model is used, silently.
  if [ -z "$(ls -A "$MODELS_DIR" 2>/dev/null)" ] && { exec 3</dev/tty; } 2>/dev/null; then
    say "One question, then it runs."
    cat <<'ASK'
  Foreman needs something that thinks. Two ways, both free:

    1  Run it on this Mac. Nothing to sign up for, works offline, private.
       Downloads a few GB once. Slower, and noticeably less sharp.

    2  Use a free hosted model. Two minutes to get a key, no card, no
       credits. Much closer to Claude in quality. Needs internet.

ASK
    printf '  1 or 2 (default 1): '
    read -r CHOICE <&3 || CHOICE=1
    if [ "${CHOICE:-1}" = "2" ]; then
      cat <<'KEY'

  Open https://console.groq.com/keys, sign in, "Create API Key", copy it.
  It is free and does not ask for a card.

KEY
      printf '  Paste the key (hidden): '
      read -rs FOREMAN_KEY <&3 || FOREMAN_KEY=''
      echo
      FOREMAN_KEY=$(printf '%s' "$FOREMAN_KEY" | tr -d '[:space:]')
      if [ -n "$FOREMAN_KEY" ]; then
        export FOREMAN_KEY FOREMAN_PROVIDER=groq
        say "Using Groq. Nothing was written to disk — set these again next time, or add to ~/.zshrc:"
        echo "  export FOREMAN_PROVIDER=groq"
        echo "  export FOREMAN_KEY=your-key"
      else
        say "No key given. Running on this Mac instead."
      fi
    fi
    exec 3<&-
  fi
fi

# Said before the wait rather than during it: the first start fetches several
# gigabytes of weights, and an unexplained ten-minute pause reads as a hang.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${FOREMAN_PROVIDER:-}" ] && [ -z "${FOREMAN_LOCAL_URL:-}" ]; then
  MODELS_DIR="${FOREMAN_HOME:-$HOME/.foreman}/models"
  if [ -z "$(ls -A "$MODELS_DIR" 2>/dev/null)" ]; then
    say "Downloading the model — a few GB, once. Later starts skip this."
  fi
fi

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

  The first reply is slow while the model loads into memory. After that it
  settles.

NEXT

exec npm start
