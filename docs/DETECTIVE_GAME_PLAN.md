# COLD TRAIL — Detective Case Game: Full Design & Implementation Plan

A multiplayer web game that procedurally generates elaborate criminal cases — murders, disappearances, poisonings — where every case is unique, internally consistent, and genuinely hard. Players (solo or with friends) dig through call logs, witness statements, maps, crime-scene evidence, autopsy reports, financial records, CCTV timelines and interrogations to identify the killer, the motive, the murder weapon and the window of opportunity — then formally accuse.

---

## 1. Game Concept

### 1.1 Core Loop

1. **Case opens** — players get a briefing: victim found, time/place of discovery, initial responding-officer report. Almost nothing else.
2. **Investigate** — players unlock and cross-reference sources of evidence (Section 4). Every document can contain truths, half-truths, irrelevant noise, and deliberate lies from the killer or people protecting secrets.
3. **Build the theory** — a shared Case Board lets the team pin evidence, link people/places/times, and mark contradictions.
4. **Accuse** — the team submits a formal accusation: *who*, *how* (weapon/method), *when* (opportunity window), and *why* (motive), each backed by cited evidence.
5. **Verdict & debrief** — the engine scores the accusation, reveals the full hidden timeline of what actually happened, and shows which clues the team found, missed, or misread.

### 1.2 Design Pillars

- **No two cases alike.** Cases are generated, not authored. The generator composes crime templates, cast graphs, motives, timelines and red herrings from combinatorial pools plus constraint solving (Section 5), so the solution space is effectively unbounded.
- **Fair but hard.** Every case is *guaranteed solvable* — the generator proves a unique deductive path exists before publishing the case (Section 5.5). Difficulty comes from noise, lies and misdirection, never from missing information.
- **Realism first.** Documents look and read like the real thing: autopsy reports use real forensic structure (lividity, rigor, stomach contents, wound morphology), call logs have cell-tower data, witness statements contradict each other the way real ones do.
- **Deduction over grinding.** There are no dice rolls and no pixel hunts. Everything is solvable by reading carefully, cross-referencing, and reasoning about time, place, means and motive.
- **Better with friends.** Real-time co-op: split the workload ("you take financials, I'll do the autopsy"), argue theories on the shared board, vote on the accusation.

### 1.3 Game Modes

| Mode | Players | Description |
|------|---------|-------------|
| **Solo Case** | 1 | Full case at chosen difficulty; personal stats and case history. |
| **Co-op Squad** | 2–6 | Shared case, shared board, live cursors/chat, majority vote to accuse. |
| **Versus (Race)** | 2–6 teams | Same generated case dealt to every team; first *correct* accusation wins; wrong accusations lock a team out for a penalty period. |
| **Daily Case** | Everyone | One seeded case per day, global leaderboard on solve time + evidence efficiency. |
| **Saboteur (stretch)** | 4–8 | One player secretly plays the killer's accomplice inside the squad, able to plant one fake note per act — social-deduction layer. |

### 1.4 Difficulty Tiers

| Tier | Cast size | Red herrings | Lying witnesses | Twists |
|------|-----------|--------------|-----------------|--------|
| Rookie | 6–8 suspects | few, clearly resolvable | 1 | none |
| Detective | 9–12 | moderate | 2–3 | 1 (e.g., staged scene) |
| Inspector | 13–18 | heavy | 3–5 | 1–2 (accomplice, false alibi ring) |
| Cold Case | 18–25 | extreme, plus degraded evidence | many | 2–3 (frame job, staged suicide, twin/identity, tampered evidence) |

---

## 2. What Makes a Case

Every generated case is a **hidden ground-truth simulation** plus a **visible evidence layer** derived from it.

### 2.1 Hidden Ground Truth (never shown until debrief)

- **The crime**: type (blunt-force, stabbing, poisoning, gunshot, strangulation, staged accident/suicide, hit-and-run…), exact time, exact location, weapon/method.
- **The killer**: identity, motive (from a motive taxonomy: inheritance, affair, blackmail, business rivalry, revenge, cover-up of a prior crime, jealousy, debt…), plan vs. improvisation, cover-up actions (moved the body, wiped prints, planted evidence, built a false alibi, recruited/coerced an accomplice).
- **The cast graph**: 6–25 characters with relationships (family, romantic, business, employment, criminal), each with their *own* secrets — several suspects hide things unrelated to the murder (an affair, embezzlement, drug habit), which is what makes them plausible suspects and makes interrogation noisy.
- **The full timeline**: minute-resolution simulated schedule for every character across the critical 24–72 hours — where they were, who they called, what they bought, who saw them. All evidence documents are *rendered from this timeline*, which is what keeps the case internally consistent.

### 2.2 Visible Evidence Layer

Every document is a deterministic (but stylistically varied) projection of the ground truth, with controlled noise:

- **Truthful noise** — irrelevant real events (a witness really did go bowling).
- **Honest error** — witnesses misremember times by plausible margins, misidentify colors at night, etc.
- **Deliberate lies** — the killer and secret-holders lie; lies are always *detectable* through at least one cross-reference (a phone record, another witness, CCTV, physical evidence).
- **Red herrings** — suspicious-but-innocent facts (a suspect bought a knife… for a fishing trip, confirmed by a receipt players can find).

---

## 3. Multiplayer Design

- **Lobby system**: create/join by invite code or friend list; host picks difficulty, crime-type pool, and time limit (untimed / 60 / 90 / 120 min).
- **Shared investigation state**: which documents are unlocked, board pins, links and annotations sync in real time (WebSockets). Per-player read-tracking shows teammates what you've covered ("Maya has read the autopsy and 3 of 14 witness statements").
- **Live presence**: see teammates' cursors on the map and board; per-document "who's viewing" indicators.
- **Comms**: built-in text chat with evidence-linking (paste a doc reference and it renders as a clickable chip); optional voice via WebRTC later.
- **Division of labor mechanics**: documents can be "claimed"; a summary sidebar per player encourages splitting the casefile.
- **Accusation voting**: any player drafts an accusation (who/how/when/why + cited evidence); goes to team vote; majority (host tie-break) submits it. In Versus, wrong accusations impose a 5-minute lockout and are announced to other teams ("Team Raven accused… and was wrong").
- **Reconnect-safe**: full state lives server-side; refresh/drop and rejoin at any time. Sessions persist for days — a squad can play one Cold Case across multiple evenings.

---

## 4. Evidence Systems (the heart of the game)

Each is a distinct in-game "app" inside the Detective Desk UI, with realistic formatting.

### 4.1 Case Briefing & Police Reports
First-responder report, dispatch log (with 911/emergency-call transcript and caller ID — the caller matters), scene-securing notes, chain-of-custody log. Chain-of-custody gaps can themselves be clues in tampering cases.

### 4.2 Crime Scene Explorer
- An annotated interactive scene: floor plan / area view with numbered evidence markers.
- Clicking a marker opens a forensic photo card (procedurally described; later: generated images): blood spatter pattern & direction, drag marks, shoe prints (size/tread), fibers, broken window (glass inside vs. outside — forced entry or staged?), position of the body vs. lividity (was the body moved?), tool marks, cigarette butts, glassware (how many drinks? lipstick trace?).
- **Forensics requests**: players spend limited "lab credits" to run analyses (DNA on the cigarette butt, prints on the glass, toxicology on the wine). Limited credits force prioritization and are a difficulty lever; results return after a short in-game delay to pace the session.

### 4.3 Autopsy & Medical
Full ME report in authentic structure: external examination, wound morphology (single-edged blade, 4cm, upward angle → attacker height/handedness inferences), defensive wounds, lividity & rigor (time-of-death window — often *contradicting* a witness's claimed sighting), stomach contents (last meal → cross-reference restaurant receipts), toxicology, prior medical history (the victim's illness can be a motive clue). Victim's medical records and prescription history available by warrant.

### 4.4 Call Logs & Digital Forensics
- **CDRs (call detail records)**: number, direction, duration, timestamp, **cell tower** — tower data places phones geographically; a suspect whose phone pinged near the scene while they claim to have been home is caught. Burner numbers appear as unregistered and must be attributed by pattern (only ever calls one person; goes silent after the murder).
- **Text/chat extracts**: obtained per-device by warrant; deleted-message gaps are visible ("messages 41–47 unrecoverable") and suggestive.
- **Email, browser history, smart-device data** (door lock logs, fitness-tracker heart rate spiking at 23:41): higher tiers only.

### 4.5 Witness Statements & Interrogation
- 8–25 written statements taken by officers, in varied voices (rambling neighbor, precise accountant, hostile teenager). Each is generated from that character's true timeline + their personality's error model + their lies.
- **Interrogation room**: players ask follow-up questions from a contextual question menu that grows as evidence is found ("You said you were home at 10 — then why does your phone show a call from the Riverside tower?"). Confronting a suspect with *hard evidence contradicting their statement* breaks the lie and yields a revised statement (which may contain a new lie protecting a deeper secret). Suspects can lawyer up if pressed with weak evidence — pressing costs credibility, another resource to manage.
- Statement viewer supports highlighting and extracting claims to the Case Board as structured "claims" (person / place / time), which the board can auto-check against other pinned claims.

### 4.6 Maps & Geography
- City/neighborhood map generated per case: victim's home, suspects' homes/work, bars, ATMs, the scene, cell towers, CCTV cameras, bus routes.
- **Travel-time engine**: right-click two points → realistic travel time by foot/car/transit. Alibi-breaking is often geometric: "He was seen at the marina at 21:40; the murder was 21:55; the marina is 30 minutes away."
- Timeline-on-map playback: scrub a time slider and watch every *claimed* location plotted; contradictions glow.

### 4.7 CCTV & Physical Records
- Camera index on the map; each camera yields a described (later: rendered) frame log for requested time windows — partial plates, silhouettes, timestamps that may be skewed (a camera whose clock runs 6 minutes fast is a classic generated trap, discoverable via a known event).
- ATM withdrawals, credit-card receipts, transit-card taps, parking tickets, pharmacy logs, gun-registry lookups, vehicle registrations.

### 4.8 Financial & Legal Records
Bank statements (odd cash withdrawals = blackmail payments?), wills and life-insurance policies (who benefits?), business filings, debts, pending lawsuits, prior criminal records, restraining orders. Obtained via **warrant requests** — players justify a warrant by citing evidence; frivolous warrant requests are denied by the in-game judge (rate-limits fishing expeditions and rewards directed reasoning).

### 4.9 The Case Board
- Corkboard canvas: pin any document/photo/claim, draw links (supports / contradicts / same-time / same-place), sticky notes, suspect cards with means/motive/opportunity checkboxes.
- **Contradiction engine assist (toggleable)**: when two pinned structured claims are logically incompatible, the board can flag the pair — on Rookie it's automatic, on higher tiers it's off and players must spot contradictions themselves.
- Board is the shared multiplayer surface: live-synced, with per-player pin colors.

### 4.10 Accusation Dossier
Structured form: culprit, method/weapon, time window, motive, and **minimum N cited evidence items per element**. Scoring rewards accusations that cite the *load-bearing* clues (the generator knows which ones they are) over lucky guesses.

---

## 5. The Case Generator (the hard, differentiating part)

A pipeline that guarantees uniqueness, consistency, and solvability.

### 5.1 Stage 1 — Skeleton
Seeded RNG picks: crime type, setting (from setting packs: coastal town, city block, corporate campus, university, resort…), era/season, cast size, difficulty knobs. Seed = case ID → daily cases and Versus deals are reproducible; two different seeds never share a solution because every layer below derives from the seed.

### 5.2 Stage 2 — Cast & Motive Graph
- Sample characters from trait pools (occupation, age, personality, vice, secret) and wire a relationship graph.
- Choose the killer and motive such that **at least 3 other suspects also end up with plausible means/motive/opportunity** (the generator explicitly manufactures competing suspects, then makes each innocent one *exonerable* by discoverable evidence).
- Assign every major character 1–2 secrets; secrets drive their lies.

### 5.3 Stage 3 — Timeline Simulation
Simulate 24–72h of minute-level schedules for all characters under constraints: the murder happens; the killer executes plan + cover-up; everyone else follows motivated routines (work, errands, their own secrets). The simulator records every *observable* event: who was within sight of whom, every call, purchase, camera pass, door unlock.

### 5.4 Stage 4 — Evidence Projection
Render documents from the timeline through each source's "sensor model": witnesses get personality-based error models and lie injection; CDRs get tower geometry from the map; the autopsy derives from the murder parameters; CCTV from camera positions and clock skews. Noise events (unrelated crimes, weather, a loud party) are injected to create honest confusion. Text is realized via template grammars + LLM polish (see 5.6) so no two documents read alike.

### 5.5 Stage 5 — Solvability Proof & Difficulty Calibration
Before a case ships, an **automated solver** runs over the visible evidence layer only:
1. Confirms a deductive chain exists to the true killer (means + motive + opportunity all reachable).
2. Confirms **no innocent suspect survives full cross-referencing** — every competing theory is defeated by at least one discoverable fact (unique-solution guarantee).
3. Measures chain length, cross-references required, and lie-depth → difficulty score. If the score misses the target tier, the generator adds/removes noise, lies, or exonerating evidence and re-proves.
Failed cases are regenerated. This stage is what lets us promise "hard but always fair."

### 5.6 Text Realization: Deterministic Core + LLM Polish
- **Facts are 100% deterministic** — generated from the timeline into structured JSON (the "canon").
- An LLM pass (Claude API) rewrites each document's *prose only*, constrained to the canon facts via structured prompting, then a **verification pass diff-checks** every entity/time/number in the output against canon; any drift → regenerate. This gives limitless stylistic variety with zero factual corruption.
- All LLM work happens at generation time server-side; gameplay never depends on live LLM calls (cheap, fast, exploit-proof). Cases are generated in a background worker and banked in a case pool.

### 5.7 Anti-spoiler / Anti-cheat
- Ground truth never leaves the server; the client only ever receives unlocked documents.
- Versus: all teams get identical seeds; document unlock timing is server-authoritative.
- Daily case answers are salted-hashed client-side-uncheckable; accusation grading is server-side only.

---

## 6. Architecture & Tech Stack

Builds on this repo's existing stack (Express + Prisma + React/Vite) and grows it:

```
┌──────────────────────────────────────────────────────────┐
│  React + Vite SPA (Detective Desk UI)                    │
│  Zustand state · TailwindCSS · react-konva (board/map)   │
└──────────────┬───────────────────────────┬───────────────┘
               │ REST (case docs, auth)    │ WebSocket (rooms, board sync, chat)
┌──────────────▼───────────────────────────▼───────────────┐
│  Node.js / Express API          Socket.IO gateway        │
│  ├─ Auth (JWT — extend existing middleware/auth.js)      │
│  ├─ Lobby / room service                                 │
│  ├─ Evidence service (unlock rules, warrants, lab)       │
│  ├─ Accusation grader                                    │
│  └─ Case pool manager                                    │
├──────────────────────────────────────────────────────────┤
│  Case Generation Worker (BullMQ queue)                   │
│  skeleton → cast → timeline sim → projection →           │
│  LLM polish (Claude API) → solver proof → bank case      │
├──────────────────────────────────────────────────────────┤
│  Prisma ORM                                              │
│  SQLite (dev) → PostgreSQL (prod) · Redis (rooms/queue)  │
└──────────────────────────────────────────────────────────┘
```

**Key choices**
- **Socket.IO** for rooms/presence/board sync (battle-tested reconnection semantics).
- **Redis** for ephemeral room state + BullMQ job queue; Postgres for durable data.
- **react-konva** canvas for the Case Board and Map (pan/zoom, thousands of nodes, live multi-cursor).
- **Monorepo layout**: `apps/web`, `apps/api`, `packages/case-engine` (generator + solver, pure TypeScript, fully unit-testable with seeded determinism), `packages/shared` (types/zod schemas).

### 6.1 Core Data Model (Prisma, abbreviated)

```prisma
model User        { id, email, handle, stats Json, ... }
model Case        { id, seed, tier, status, canon Json /*server-only*/, createdAt }
model Document    { id, caseId, kind, payload Json, unlockRule Json }
model GameSession { id, caseId, mode, hostId, state, timeLimit, startedAt }
model SessionPlayer { sessionId, userId, role, readDocs Json }
model UnlockEvent { sessionId, documentId, byUserId, at }
model BoardItem   { id, sessionId, type /*pin|link|note|claim*/, data Json, byUserId }
model Accusation  { id, sessionId, byUserId, payload Json, verdict Json, at }
model DailyResult { userId, caseId, timeMs, score, rank }
```

### 6.2 Realism & Content Ethics Guardrails
- Fictional cities, names from curated fictional pools; no real people, brands, or addresses.
- Violence handled documentary-style (clinical report language, illustrated diagrams rather than gore); content rating ~16+.
- No sexual violence or crimes against children in the generator's crime pools, ever.
- Report-a-case button in every session for anything that slips through generation review.

---

## 7. UI/UX Direction

- **"Detective Desk" metaphor**: a dark, tactile workspace — dossier folders, tabbed evidence apps, typewriter/document textures, coffee-stained case files. Film-noir meets modern police intranet.
- Each evidence system gets a skeuomorphic-but-usable app: the autopsy looks like a medical PDF, CDRs look like a telecom export table (sortable/filterable — filtering is gameplay), the map looks like a case wall map.
- Global **omni-search** across unlocked documents (search "red sedan" across everything) — a core power tool.
- Personal notebook per player + shared board; keyboard-first navigation for power users.
- Accessibility: full text alternative for every visual clue (scene photos ship with written forensic descriptions — this is also the pre-image-generation MVP path), colorblind-safe link colors, screen-reader-friendly document viewers.
- Mobile: read documents & chat on phone (second-screen use in co-op); full board editing is desktop/tablet.

---

## 8. Development Roadmap

### Phase 0 — Foundations (2 wks)
Monorepo scaffold, auth (extend existing JWT), CI, Postgres/Redis, socket skeleton, design system.

### Phase 1 — Case Engine MVP (5–6 wks) ← the critical path
- Skeleton/cast/timeline generator for **one crime type** (blunt-force homicide), one setting pack, Rookie+Detective tiers.
- Evidence projection for the MVP six: briefing, witness statements, call logs, map w/ travel times, crime-scene (text descriptions), autopsy.
- Solver + solvability proof; 200 banked cases; determinism test suite (same seed → identical case; 10k-seed uniqueness audit).

### Phase 2 — Playable Solo (4 wks)
Detective Desk UI, document viewers, case board (single-player), accusation flow + grading + debrief reveal. **First external playtest here.**

### Phase 3 — Multiplayer (4 wks)
Lobbies, live board sync, presence, chat, claims, voting, reconnection. Co-op playtests; tune session pacing.

### Phase 4 — Depth (5 wks)
Interrogation system, warrants, lab credits, financial/CCTV/digital evidence, contradiction assist, Inspector tier, 2 more crime types + 2 setting packs, LLM prose-polish pipeline hardening.

### Phase 5 — Competitive & Live (4 wks)
Versus mode, Daily Case + leaderboards, Cold Case tier with twist mechanics (staged scenes, accomplices, frame jobs), player profiles/rank ("Close Rate"), spectator/replay of the debrief timeline.

### Phase 6 — Polish & Launch (3 wks)
Scene image generation pipeline (optional visual upgrade), sound design, onboarding tutorial case (hand-tuned seed), load testing, moderation tooling, beta → launch.

**Total: ~6 months to launch; playable solo build by ~week 12.**

### Testing strategy highlights
- The case engine is a pure function of its seed → golden-file snapshot tests per seed.
- The solver doubles as a regression test: every banked case must remain provably solvable after any engine change.
- "Confusion telemetry" in playtests: track which documents players reread most and where wrong accusations cluster → feeds difficulty calibration constants.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Generated cases feel same-y despite unique facts | Setting packs, crime-type variety, LLM prose variation, twist mechanics, rotating red-herring archetypes; uniqueness audits on structure, not just content. |
| Case is technically solvable but *feels* unfair | Solver difficulty metrics + playtest confusion telemetry gate every tier's constants; debrief always shows the fair path so players learn the game's logic. |
| LLM polish corrupts facts | Deterministic canon + automated diff verification + regenerate-on-drift (5.6). |
| Multiplayer state bugs (board desync) | Server-authoritative state, event-sourced board ops, reconnect replays event log. |
| Generation cost | All LLM/gen work is offline & banked; a case is generated once, played by thousands. |
| Scope explosion | Phase 1's single-crime-type vertical slice is the go/no-go gate before UI investment. |

---

## 10. Immediate Next Steps

1. Approve/adjust this plan (especially Phase 1 scope: the six MVP evidence types).
2. Scaffold the monorepo and `packages/case-engine` with the seeded skeleton→cast→timeline pipeline.
3. Build the timeline simulator + witness-statement projection first — it's the riskiest novel piece; validate with hand-checked seeds.
4. Prototype the solver against the first 50 generated cases before writing any UI.
