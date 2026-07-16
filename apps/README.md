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
  - **Accusation** — killer + motive + weapon + half-hour time window; graded server-side against the engine's solution. Wrong accusations cost score (solo/co-op) or trigger a 3-minute lockout broadcast to rivals (versus).
  - **Debrief** — on a correct accusation: score breakdown, the fair evidence path, the killer's real minute-by-minute evening, and every liar unmasked.
- **Real-time** — one SSE stream per session (`/api/sessions/:id/events`); the server pushes players/chat/board/accusation/solved events. Sessions are server-authoritative: the client never receives the solution or hidden timeline until the case is legitimately closed.

## Architecture

```
apps/server/server.js       HTTP + static + JSON API + SSE routing (no deps)
apps/server/lib/auth.js     scrypt passwords, HMAC tokens
apps/server/lib/db.js       JSON-file store for users + results
apps/server/lib/sessions.js lobbies, modes, board, chat, accusation grading, SSE hub
apps/web/                   vanilla-JS SPA (hash router, views per screen)
```

The in-memory session store and JSON persistence are deliberate MVP choices; the API surface is shaped so a Postgres/Redis/Socket.IO upgrade (plan §6) swaps in behind the same routes.

## End-to-end verified

A Playwright run covers: register → solo case → document viewers → map measuring → wrong + correct accusation → debrief; co-op lobby join via code, live chat and board sync across two browsers; versus chat-hiding, wrong-accusation lockout and rival broadcast banners.
