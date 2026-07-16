# Deploying Cold Trail to a public domain

Cold Trail is a single always-on Node process (live SSE streams + in-memory
game sessions), so it needs a **persistent-process host** — Fly.io, Railway,
Render, or any VPS. It will **not** run correctly on Vercel/Netlify/Cloudflare
serverless, which kill SSE connections and wipe session state between requests.

Below is the Fly.io path end to end. Steps 1–3 stand up the site on a free
`*.fly.dev` URL; step 4 attaches your own domain.

## 1. Get the domain

You need to own the domain first. `thecoldtrail.com` is already registered by
someone else, so either:
- use a domain you already control, or
- buy an available one (e.g. `playcoldtrail.com` or `thecoldtrailgame.com` were
  free at ~$11/yr when checked) through any registrar — Cloudflare, Namecheap,
  Porkbun, or Fly itself (`fly domains buy <name>`).

Everything below uses `www.YOURDOMAIN.com` as a placeholder.

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

## Other hosts (same idea)

- **Railway / Render**: connect the GitHub repo, they detect the Dockerfile,
  add a persistent disk mounted at `/app/apps/server/data`, then add your
  domain in their dashboard and set the CNAME they give you.
- **VPS (Hetzner/DigitalOcean)**: `docker build -t coldtrail . && docker run -d
  -p 5177:5177 -v coldtrail-data:/app/apps/server/data --restart unless-stopped
  coldtrail`, then put Caddy in front for automatic HTTPS:

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
