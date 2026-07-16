# Cold Trail — the website

The playable web app for Cold Trail (see [`docs/DETECTIVE_GAME_PLAN.md`](../docs/DETECTIVE_GAME_PLAN.md)). Zero npm dependencies — the server is plain Node, the client is vanilla ES modules, and cases come straight from [`packages/case-engine`](../packages/case-engine).

## Run it

```bash
npm run coldtrail        # -> http://localhost:5177
# PORT=8080 node apps/server/server.js   to pick a port
# COLDTRAIL_DB=/path/db.json             to relocate the user/results store
```

## What's implemented

- **Login screen** — register/sign-in with scrypt-hashed passwords and HMAC-signed bearer tokens (14-day expiry). `apps/server/lib/auth.js`.
- **Precinct home** — open a new case (Solo / Co-op squad / Versus race; Rookie or Detective difficulty), join a squad by 6-character invite code, or take the **Daily Case** (same seeded case for everyone, leaderboard by score + time).
- **Lobby** — live player list over SSE; host starts the investigation.
- **Detective Desk** — the investigation screen:
  - Document sidebar (reports / records / statements) with per-player read tracking; in co-op you see which files your partners have covered.
  - Paper-styled viewers per document type: briefing, crime-scene markers, autopsy, sortable/filterable call-detail records, background checks, witness statements.
  - **Interactive area map** — canvas with homes, venues and cell towers; click any two points to measure driving/walking time (alibi-breaking is geometric).
  - **Suspect board** — means/motive/opportunity checkboxes, cleared/PRIME status, notes; synced live across the squad in solo/co-op (local-only in versus).
  - **Squad chat** (co-op) over SSE.
  - **Interrogation room** — pull any suspect in: ask for their story, ask about the victim, or confront them with a cited record. Confrontations only bite when the evidence really contradicts them (the solver's proof powers the check): red herrings crack and confess their secrets, the killer deflects, and pressing the guilty twice makes them lawyer up — a tell in itself.
  - **Warrants** — petition the judge for a suspect's financial records or the victim's estate & insurance file. Granted only on documented motive or a provable lie; fishing expeditions are denied.
  - **Forensics lab (limited credits)** — 5 credits per case (3 each in versus): latent prints on the second tumbler, footwear comparison against a named suspect, device extraction (the killer's phone was wiped; the affair's texts survive), and evidence searches — divers at the right spot recover the murder weapon. Results file into the casefile after a lab delay, delivered live over SSE.
  - **CCTV pulls** — five exterior cameras marked on the map; request any camera + 30-minute window and get an identified-arrivals/departures log rendered from the hidden ground truth. The bridge camera is how you catch the weapon dump.
  - **Accusation** — killer + motive + weapon + half-hour time window; graded server-side against the engine's solution. Wrong accusations cost score (solo/co-op) or trigger a 3-minute lockout broadcast to rivals (versus).
  - **Debrief** — on a correct accusation: score breakdown, the fair evidence path, the killer's real minute-by-minute evening, and every liar unmasked.
- **Real-time** — one SSE stream per session (`/api/sessions/:id/events`); the server pushes players/chat/board/accusation/lab/unlock/transcript events. Sessions are server-authoritative: the client never receives the solution or hidden timeline until the case is legitimately closed. Investigation resources (warrants, lab results, CCTV, transcripts) are squad-shared in solo/co-op and strictly per-player in versus.

## Architecture

```
apps/server/server.js       HTTP + static + JSON API + SSE routing (no deps)
apps/server/lib/auth.js     scrypt passwords, HMAC tokens
apps/server/lib/db.js       JSON-file store for users + results
apps/server/lib/sessions.js lobbies, modes, board, chat, accusation grading, SSE hub
apps/web/                   vanilla-JS SPA (hash router, views per screen)
```

The in-memory session store and JSON persistence are deliberate MVP choices; the API surface is shaped so a Postgres/Redis/Socket.IO upgrade (plan §6) swaps in behind the same routes.

## Hosting it publicly

The whole stack is one Node process with no build step and no npm installs, so any host that runs a container or a Node server works:

```bash
# Docker (recommended)
docker build -t coldtrail .
docker run -d -p 80:5177 -v coldtrail-data:/app/apps/server/data --restart unless-stopped coldtrail

# or bare Node on a VPS
PORT=5177 node apps/server/server.js
```

- **Where**: Fly.io, Railway, Render, DigitalOcean/Hetzner VPS — anything with a long-running process. Avoid serverless/edge platforms: live sessions use SSE streams and in-memory state, which need one persistent instance.
- **TLS**: put it behind the host's HTTPS (Fly/Railway/Render do this automatically; on a VPS use Caddy or nginx). SSE works through standard reverse proxies — just don't buffer `/api/*/events`.
- **Persistence**: users and daily-case leaderboard live in `apps/server/data/coldtrail-db.json` (mount a volume). Live game sessions are in-memory — a restart ends open cases but keeps accounts.
- **Scale**: single instance only for now; the plan's Postgres + Redis upgrade path is what unlocks multiple instances.
- Security hygiene included: scrypt password hashing, HMAC tokens, CSP + security headers, per-IP throttling on login/register, path-traversal-safe static serving.

## End-to-end verified

A Playwright run covers: register → solo case → document viewers → map measuring → wrong + correct accusation → debrief; co-op lobby join via code, live chat and board sync across two browsers; versus chat-hiding, wrong-accusation lockout and rival broadcast banners.
