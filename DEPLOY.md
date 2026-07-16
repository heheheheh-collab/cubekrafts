# Deploying Cold Trail to a public domain

Cold Trail is a single always-on Node process (live SSE streams + in-memory
game sessions), so it needs a **persistent-process host** — Railway, Render,
Fly.io, or any VPS.

> ## ⚠️ Vercel / Netlify / Cloudflare Pages will NOT work
> Those platforms run **stateless serverless functions** that spin up and down
> per request with no shared memory and no long-lived connections. Cold Trail's
> multiplayer, live board sync, versus races, lab results and daily leaderboard
> all depend on one persistent process holding session state and streaming SSE.
> On Vercel the login page might load, but every real-time feature breaks.
> (The `vite build … exited with 127` error you saw is a *separate* symptom:
> Vercel misdetected the leftover `vite.config.js`/`index.html` from the old
> Cubekrafts frontend and tried to build a Vite app that isn't there. Even
> fixing that just leads to the architecture problem above.) If you connected
> the repo to Vercel, delete that Vercel project so it stops failing on each
> push — then use one of the hosts below.

You already own **thecoldtrail.com**, so once the app is live on one of the
hosts below you just point that domain at it (each section ends with the DNS
records). Recommended host: **Railway** (closest to the Vercel workflow).

Sections: [Railway](#railway-recommended) · [Render](#render-one-click-blueprint)
· [Fly.io](#flyio) · [VPS](#vps-hetznerdigitalocean).

---

## Railway (recommended)

Browser-only, no CLI — the closest thing to how you tried Vercel.

1. Go to <https://railway.app> → sign in with GitHub.
2. **New Project → Deploy from GitHub repo →** pick `heheheheh-collab/cubekrafts`.
   Railway detects the `Dockerfile` and builds it (ignore the old Vite files).
3. Once it's building, open the service → **Settings → Networking → Generate
   Domain** to get a live `*.up.railway.app` URL. Open it — the game is playable
   there immediately; share it to test before touching DNS.
4. **Settings → Variables**: nothing required (defaults work). Optional:
   `COLDTRAIL_LAB_MS=45000` to tune the forensics-lab delay.
5. Add a **Volume** (service → **Variables/Settings → Volumes → New Volume**),
   mount path `/app/apps/server/data`, so accounts and the leaderboard survive
   redeploys.
6. **Attach thecoldtrail.com** — Settings → Networking → **Custom Domain** →
   enter `www.thecoldtrail.com`. Railway shows a CNAME target like
   `abc123.up.railway.app`. Add it at your registrar:

   | Type  | Name | Value                          |
   |-------|------|--------------------------------|
   | CNAME | www  | (the target Railway shows you) |

   For the bare `thecoldtrail.com`, add it as a second custom domain; Railway
   will give you either an ALIAS/ANAME or an A record to use for the apex.

Railway costs ~\$5/mo usage-based (small free trial credit to start).

---

## Fly.io, Render and VPS alternatives

If you'd rather not use Railway, the same app deploys to any of these. The rest
of this guide uses `www.YOURDOMAIN.com` as a placeholder — that's
`www.thecoldtrail.com` for you.

### Render (one-click Blueprint)

This repo ships a `render.yaml`. In the Render dashboard: **New + → Blueprint →**
connect `heheheheh-collab/cubekrafts` **→ Apply**. Render builds the Dockerfile,
attaches a 1 GB persistent disk, and runs it always-on (starter plan). Then
**Settings → Custom Domains → Add `www.thecoldtrail.com`** and add the CNAME it
shows you. (The free plan works for a demo but sleeps when idle and has no disk,
so accounts reset — use `starter` for the real thing.)

### Fly.io

Steps 1–3 below stand up the site on a free `*.fly.dev` URL; step 4 attaches
your domain.

## 1. The domain

You already own **thecoldtrail.com** — good, nothing to buy. If you ever need
another, `fly domains buy <name>` works, or any registrar (Cloudflare,
Namecheap, Porkbun).

## 2. Install the CLI and log in

```bash
curl -L https://fly.io/install.sh | sh
fly auth login          # opens the browser; creates or signs into your Fly account
```

## 3. Launch and deploy

From the repo root (the Dockerfile and fly.toml are already here):

```bash
fly launch --no-deploy --copy-config --name coldtrail   # pick your own name if taken
fly volume create coldtrail_data --size 1 --region iad  # persists accounts + leaderboard
fly deploy
```

When it finishes, `fly open` shows the live site at `https://coldtrail.fly.dev`.
That URL is fully playable — share it to test with friends before wiring DNS.

## 4. Attach your domain

```bash
fly certs add www.YOURDOMAIN.com
fly certs show www.YOURDOMAIN.com     # prints the exact DNS records to add
```

Then, in your registrar's DNS panel, add what `fly certs show` tells you —
typically:

| Type  | Name | Value                     |
|-------|------|---------------------------|
| CNAME | www  | coldtrail.fly.dev         |
| A     | @    | (the IPv4 Fly prints)     |
| AAAA  | @    | (the IPv6 Fly prints)     |

Fly issues a Let's Encrypt certificate automatically once the records
resolve (usually minutes, up to an hour for DNS propagation). Re-run
`fly certs show www.YOURDOMAIN.com` until it reads "Certificate issued."

To make the bare `YOURDOMAIN.com` redirect to `www`, also run
`fly certs add YOURDOMAIN.com` and add the matching apex records.

### VPS (Hetzner/DigitalOcean)

`docker build -t coldtrail . && docker run -d -p 5177:5177 -v
coldtrail-data:/app/apps/server/data --restart unless-stopped coldtrail`, then
put Caddy in front for automatic HTTPS:

  ```
  www.YOURDOMAIN.com {
      reverse_proxy localhost:5177
  }
  ```
  Caddy fetches the certificate on its own; just point the domain's A/AAAA
  records at the server's IP.

## Environment knobs

| Var              | Default                              | Purpose                          |
|------------------|--------------------------------------|----------------------------------|
| `PORT`           | 5177                                 | listen port                      |
| `COLDTRAIL_DB`   | `apps/server/data/coldtrail-db.json` | accounts + leaderboard store     |
| `COLDTRAIL_LAB_MS` | 45000                              | forensics-lab result delay (ms)  |

The `data/` directory is git-ignored and must be a mounted volume in
production so accounts survive redeploys.
