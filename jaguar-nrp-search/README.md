# Jaguar NRP Search

A small, standalone, login-protected website for searching Jaguar's NRP (price
list) items. This is fully independent of the rest of the `cubekrafts` repo —
its own server, database, and frontend — so it can be deployed on its own.

**Because this repo is public on GitHub, the actual price-list data (the CSV
and the database file) is never committed.** Only application code lives in
git; you import your CSV into a local database on whatever machine/server you
run this on.

## Structure

- `server/` — Express API: session-cookie login, product search, CSV importer
- `client/` — React (Vite) frontend: login page + search UI

## Security features

- Login required for every product/pricing endpoint (no public routes expose data)
- Passwords hashed with bcrypt (never stored or logged in plaintext)
- Sessions are signed JWTs in an `httpOnly`, `SameSite=Lax` cookie — not
  readable by JavaScript, so a lot harder to steal via XSS than
  `localStorage` tokens
- Rate limiting on the login endpoint (10 attempts / 15 min / IP) plus a
  general API rate limit, to slow down brute-force/credential-stuffing
- All SQL uses parameterized queries (no string-built SQL), so search input
  can't be used for SQL injection
- `helmet` security headers, CORS locked to a single configured origin
- The CSV / SQLite database are git-ignored (`server/data/`, `.env`) so
  pricing data and secrets never reach the public repo
- Not discoverable via search engines: `<meta name="robots" content="noindex, nofollow">`
  in the frontend HTML, a `client/public/robots.txt` disallowing all
  crawlers, and an `X-Robots-Tag: noindex, nofollow` header on every API
  response. The site is never linked to from anywhere public, so in
  practice it's only reachable by whoever you give the URL to, and it's
  behind the login wall regardless.
- SDP (dealer price) is intentionally never sent to the frontend — the
  `/api/products` response only includes NRP and Price, not SDP

For production use behind a real domain, put this behind HTTPS (e.g. a
reverse proxy / platform load balancer) and set `COOKIE_SECURE=true` so the
session cookie is only ever sent encrypted.

## Setup

### 1. Server

```bash
cd server
npm install
cp .env.example .env
# Edit .env: set JWT_SECRET to a random value, e.g.
openssl rand -hex 32
```

Import your CSV (columns: `ItemCode,ItemName,SDP,NRP,Price,UnitCode,RangeCode,ColorCode`):

```bash
npm run import-csv -- /path/to/ItemsList.csv
```

This can be re-run any time you get an updated price list — it upserts by
`ItemCode`.

Create your first login account (only you should know these credentials):

```bash
npm run create-user -- <username> <password>
```

Start the API:

```bash
npm start        # production
npm run dev       # auto-reload during development
```

### 2. Client

```bash
cd client
npm install
cp .env.example .env   # point VITE_API_URL at your server if not localhost
npm run dev             # local development, http://localhost:5173
npm run build            # production build -> client/dist, serve with any static host
```

## Notes

- The source CSV export has inconsistent quoting for the `ItemName` column
  (stray/unbalanced quotes, embedded commas, and even a few embedded
  newlines). `server/src/scripts/import-csv.js` handles this with a tolerant
  parser rather than a strict CSV parser, since only `ItemName` is affected —
  the other seven columns are always simple, comma-free values.
- After that first account exists, more logins can be added straight from the
  app: click **Create user** in the header once signed in (`/create-user`).
  That page is itself behind the login wall, so only someone who can already
  sign in can create additional accounts — there's no public self-signup.
  The `npm run create-user -- <username> <password>` CLI script still works
  too, e.g. for bootstrapping the very first account or resetting a password.
