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
- The price list can also be (re)imported from inside the app: click
  **Import CSV** once signed in (`/import-csv`) and upload the file. This
  means you don't need shell/SCP access to wherever the server ends up
  deployed — the CLI script and the in-app upload both call the same
  importer (`server/src/import-logic.js`).

## Deploying with a custom domain (e.g. abg1992.com via GoDaddy)

This app is two separate deployables — a static frontend and a Node API —
so it needs two hosts. GoDaddy stays as your domain registrar/DNS host the
whole time; you're just adding DNS records there that point at wherever
each piece ends up running.

### 1. Backend (Render, free/cheap tier with persistent disk)

1. Push this repo to GitHub (already done) and sign up at render.com.
2. **New > Web Service**, connect the `heheheheh-collab/cubekrafts` repo.
3. Set **Root Directory** to `jaguar-nrp-search/server`.
4. Build command: `npm install`. Start command: `npm start`.
5. Add a **Disk** (Render dashboard > your service > Disks), mount path
   e.g. `/data`, 1GB is plenty.
6. Environment variables (Render dashboard > Environment):
   - `JWT_SECRET` — a random value, e.g. output of `openssl rand -hex 32`
   - `DATABASE_PATH` — `/data/jaguar-nrp.db` (must be under the disk's mount path)
   - `CLIENT_ORIGIN` — `https://abg1992.com` (your future frontend URL)
   - `COOKIE_SECURE` — `true`
   - Render sets `PORT` automatically; the app already reads it.
7. Deploy. Once it's live, sign in isn't possible yet (no users exist) —
   use Render's **Shell** tab to run `npm run create-user -- <username> <password>`
   once, or temporarily allow the CLI approach; after that, use the in-app
   **Create user** and **Import CSV** pages for everything else.
8. Render gives you a `*.onrender.com` URL — note it, you'll point a
   subdomain at it next.
9. In Render, go to your service > **Settings > Custom Domains**, add
   `api.abg1992.com`. Render will show you a DNS target (a `CNAME` value).
10. In GoDaddy's DNS panel for `abg1992.com`, add:
    - Type `CNAME`, Name `api`, Value: whatever Render showed you.

(Railway works the same way — a service with a volume, env vars, and a
custom domain with a CNAME target it gives you.)

### 2. Frontend (Vercel)

1. In Vercel, **Add New Project**, import `heheheheh-collab/cubekrafts`.
2. Set **Root Directory** to `jaguar-nrp-search/client`. Vercel auto-detects
   Vite (build command `npm run build`, output `dist`).
3. Add environment variable `VITE_API_URL` = `https://api.abg1992.com`
   (must match the backend's `CLIENT_ORIGIN` from step 1, and must be set
   *before* the first deploy since Vite bakes it in at build time).
4. Deploy.
5. In the Vercel project, **Settings > Domains**, add `abg1992.com` (and
   optionally `www.abg1992.com`). Vercel will show you the exact records
   to add.
6. In GoDaddy's DNS panel, add the records Vercel gave you — typically:
   - Type `A`, Name `@`, Value `76.76.21.21` (Vercel's apex IP — use
     whatever Vercel's dashboard actually shows you, it can change)
   - Type `CNAME`, Name `www`, Value `cname.vercel-dns.com`

DNS changes can take anywhere from a few minutes to a few hours to
propagate. Once both domains resolve, `https://abg1992.com` is your search
UI and it talks to `https://api.abg1992.com` for data.
