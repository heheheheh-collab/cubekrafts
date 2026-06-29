# Cubekrafts — Technical Audit & Engineering Roadmap

**Prepared by:** Acting CTO
**Date:** 2026-06-29
**Scope:** Backend repository at `/home/user/cubekrafts` (Node/Express + Prisma + SQLite, embedded React admin app). Frontend "Prefab Partners" (Lovable: Vite/React/shadcn/TS) reviewed at the product-strategy level only — its source is not in this repo.

---

## Executive Summary

- **This is a competent MVP scaffold, not a production marketplace.** The backend is a single-file Express app serving one real data model (`Inquiry`) plus an audit log. It is clean and readable, but the "marketplace" (manufacturers, comparisons, quotes, ratings, estimator) described in the product vision **does not exist in code** — the backend only captures contact-form leads. The gap between the pitch and the codebase is the single biggest business risk.
- **Two Critical security issues ship today:** (1) the live SQLite database `prisma/dev.db` containing real customer PII (names, emails, locations) **is committed to the git repository**, and there is **no `.gitignore` at all** — so secrets/`.env` and the DB are one mistake away from public exposure. (2) Admin credentials default to a hardcoded, publicly-knowable password (`cubekrafts2024`) and the app **does not refuse to boot if `ADMIN_JWT_SECRET` is unset** — an unset secret means `jwt.verify` throws and auth is effectively broken/unconfigured.
- **The auth model is weak for an admin panel guarding customer PII:** plaintext password comparison (no hashing), no bcrypt/argon2, no rate limiting specific to login (brute-forceable within the global 100-req/15-min budget), 2-hour non-refreshable tokens stored in `localStorage` (XSS-exfiltratable), and CORS wide open (`cors()` with no origin allowlist).
- **Scalability ceiling is low by design.** SQLite + single Node process + synchronous SMTP in the request path + `tracesSampleRate: 1.0` will be fine to ~100 concurrent users and start degrading well before 10k. There is no connection pooling story, no horizontal scaling path, no migrations-in-CI, and no real observability beyond `morgan("dev")` and Sentry (which is also mis-wired — see findings).
- **Overall Health Score: 4.5 / 10.** Justification: code quality and structure are reasonable for an MVP (+), validation and an audit log exist (+), but committed PII/DB, default credentials, no `.gitignore`, a mis-ordered Sentry handler, and the total absence of the marketplace domain model pull it down hard. It is shippable as a lead-capture site; it is **not** a foundation a marketplace can scale on without deliberate re-platforming.

> **Shape change (2026-06-29, supersedes prior pivot):** Cubekrafts is now a **vertical B2B SaaS for local modular-kitchen dealers** — *"the quoting & catalog operating system."* Dealer signs up → builds a catalog (modules, finishes, hardware tiers) → generates accurate customer quotes in minutes via a **server-side versioned pricing engine** → manages incoming leads. **Multi-tenant SaaS.** The consumer marketplace is demoted to an emergent *Act 2* reusing the same catalog/pricing data. India, INR. This is **B2B, not B2C** — the consumer 3D/AR/2D configurator is **fully out of scope.** Security findings below remain valid (same backend). Section 0 (Honest Verdict), 4 (Product–Tech Gaps), 5 (Roadmap), and 6 (Target Stack) are rewritten for the dealer-SaaS shape.

---

## 0. Honest Verdict on the Dealer-SaaS Shape (Technical Lens)

The founder asked for honesty, not reassurance, and explicitly asked me **not** to just agree with the COO's framing. So I'll be precise about what's right and what's wrong in the pitch.

### Is the COO's core claim true — that this shape is MORE solo-buildable?

**Yes, on balance — but for a different reason than stated, and with one part of the claim that is wrong.**

The pitch is: "the scary consumer configurator is gone, and the pricing engine becomes the bounded core, so it's easier." Two halves:

- **Half that's TRUE and is the real win:** killing the consumer-facing **2D/3D/AR configurator** removes the single largest, riskiest *frontend* effort from the prior plan. That configurator was weeks of specialist canvas/WebGL state-machine work, and it was the thing a solo founder was least likely to ship well. Replacing it with a **B2B form-driven catalog + quote builder** — boring CRUD-heavy screens a solo founder (AI-assisted) can absolutely build — is a genuine, large reduction in build risk. **This is the strongest argument for the pivot and it holds.**
- **Half that's MISLEADING:** "the pricing engine becomes the bounded core" does **not** mean the pricing engine gets *easier*. It gets **harder in one specific way**: in B2C you (the founder) authored one pricing ruleset and could hand-tune it. In B2B SaaS, **every dealer authors their own catalog and pricing rules**, so the engine must be fully **data-driven, per-tenant, and configurable by non-technical dealers** — you can no longer hardcode anything. The correctness bar is also higher: a dealer's whole business runs on these quotes, and a wrong number in front of *their* customer is a churned account, not one lost sale. So the pricing engine is correctly identified as the core product, but it is **not** a simplification of the #1 risk — it is the same risk, now load-bearing.

And the pivot introduces a **brand-new risk that did not exist in B2C**: **multi-tenant data isolation.** One shared database holding many competing dealers' catalogs, pricing, margins, and customer leads. A single missing `tenantId` filter on a query leaks one dealer's margins/customers to another — a fatal trust failure for a B2B SaaS and a contractual/legal liability. The current code has **zero** tenancy concept.

**Net comparison (B2B dealer-SaaS vs B2C marketplace):** **Easier overall**, with a different risk shape. You remove ~one large specialist frontend (the configurator) and add ~one medium-but-pervasive backend discipline (multi-tenancy). For a *solo* founder that trade is favorable, because the removed work was the kind solo founders fail at, and the added work is a well-trodden pattern with known guardrails. **Verdict: genuinely easier to build than the B2C marketplace — but not "easy," and the COO is wrong that the pricing engine becomes simple.**

### Does the current backend serve this shape?

**Still no — roughly 0% of the dealer-SaaS core exists.** But the *gap is now CRUD-and-rules, not graphics.* The existing Express/Prisma stack is an appropriate starting point (it was over-matched by the consumer configurator; it is well-matched by a B2B SaaS). What carries over: the auth scaffold (needs real users/roles), the `Inquiry` table (becomes the per-dealer **lead inbox**), the audit log, and the now-applied P0 security hardening. What's missing: tenancy, the dealer catalog model, the versioned pricing/BOM engine, quote generation/PDF, and notifications. All of it is buildable by a competent solo founder; none of it requires a specialist discipline (unlike WebGL).

### Solo founder, 90-day fundraise window — realistic?

**Yes — this is the first shape where I'd say a credible MVP is realistically solo-buildable in 90 days**, provided scope is held to the Minimum Lovable Version below.

**Minimum Lovable Version (the demo that funds the round):**
1. **One dealer, multi-tenant-ready from day one** (tenancy in the schema even if you only onboard one design partner — retrofitting tenancy later is the trap; see below).
2. **Catalog builder:** dealer defines modules (base/wall/tall units), finishes/laminates, and hardware tiers, each with a price. Form-driven CRUD. No graphics.
3. **Quote builder + versioned pricing engine:** dealer assembles a kitchen from their catalog, the server computes an itemized, GST-aware quote in seconds, every quote stores the **pricing-rule version** it was computed against so it re-prices identically forever.
4. **Quote output:** branded PDF + shareable link to send the customer over **WhatsApp**.
5. **Lead inbox:** incoming customer inquiries land per-dealer (reuse/extend the `Inquiry` table, scoped by tenant).

That is a tight, demoable, *fundable* product — and it's genuinely lovable to a dealer who today quotes on paper or Excel and loses days. **3D/AR and the consumer marketplace are explicitly OUT** (Act 2, roadmap slide).

What still makes it *hard* (don't let anyone call it trivial): the pricing engine must be correct to the rupee across dealer-defined rules, and tenant isolation must be airtight. Both are achievable solo, but both are unforgiving of shortcuts.

### The biggest technical trap

Ranked, because the founder asked specifically:

1. **Pricing-engine correctness + versioning (highest).** Still the #1 risk, now per-tenant. A dealer's business runs on these numbers. The trap is a quote that's subtly wrong, or a quote that **re-prices differently after the dealer edits their catalog** (an already-sent quote must be immutable). Mitigation: server-side, data-driven rules, every quote stamped with an immutable pricing-version snapshot, from day one.
2. **Multi-tenant isolation (close second, and the *new* trap).** A leaked `tenantId` filter exposes one dealer's margins/customers to a competitor. The fatal mistake is **retrofitting tenancy** after building single-tenant — it touches every query and every table. Mitigation: `tenantId` on every table and a **enforced-at-the-data-layer** scoping (Prisma middleware/extension, or Postgres Row-Level Security) from the first migration, not bolted on.
3. **Dealer catalog data migration/onboarding (real but lower).** Dealers arrive with messy Excel price lists; importing and modelling them is fiddly and is often the true adoption blocker. Mitigation: for the MVP, onboard 1–2 design-partner dealers by hand; don't build a generic importer yet.

### Verdict: 🟢 **GREEN** (for a solo founder) — conditional, leaning green

**GREEN, conditional.** This is the first of the three shapes I can call solo-buildable in the 90-day window, *if* the founder (a) holds to the Minimum Lovable Version, (b) builds tenancy and pricing-version stamping in from the first migration rather than retrofitting, and (c) onboards dealers by hand instead of building a generic catalog importer. It slips to **YELLOW** if scope creeps (multiple dealer tiers, a real self-serve importer, marketplace Act 2 pulled forward) and to **RED** only if tenancy is deferred and later retrofitted under deadline pressure.

**Is it genuinely easier or harder than the B2C marketplace? Genuinely EASIER.** You delete the specialist consumer configurator (the part most likely to sink a solo founder) and replace it with form-driven B2B CRUD. You add multi-tenancy — real work, but a standard, well-documented pattern with guardrails (RLS / query-scoping). The pricing engine is *not* easier, but it's now the focused core rather than one of several hard things competing for attention, which is a better shape to build solo. The COO's instinct is right; the framing that "the pricing engine becomes simple" is wrong — it becomes central.

---

## 1. Architecture Assessment

### Current state
- **Runtime:** Express 4 (`src/index.js`), ES modules, single process, `app.listen` on `PORT || 4000`.
- **Data:** Prisma 5 + SQLite (`prisma/schema.prisma`). Two models: `Inquiry`, `AuditLog`. Two migrations on disk (`20250708091251_init`, `20250708105133_add_audit_log`).
- **Routes:** `src/routes/inquiries.js` (POST public, GET/PATCH/DELETE protected) and `src/routes/admin.js` (login, CSV export).
- **Auth:** `src/middleware/auth.js` — JWT Bearer verification.
- **Admin UI:** `src/admin/AdminApp.jsx` — React + react-router, talks to API via `src/api.js`. Hidden entry point: a 2-second long-press on the "Cubekrafts" logo (`src/App.jsx:14-20`) navigates to `/admin`.
- **Cross-cutting:** helmet, cors, morgan, express-rate-limit, Sentry, nodemailer SMTP.

### What's good
- **Clean separation** of routes/middleware; readable, consistent code.
- **Input validation** on write paths via `express-validator` (`src/routes/inquiries.js:43-48, 105-110`).
- **Audit log** for edit/delete with before/after snapshots (`inquiries.js:124-131, 145-152`) — genuinely good instinct for a PII admin tool.
- **Email failure is non-fatal** to inquiry creation (`inquiries.js:59-64`) — correct prioritization of the lead capture.
- **Pagination + search** already implemented server-side (`inquiries.js:73-99`).
- **Graceful shutdown** with Prisma disconnect (`index.js:46-54`).
- **Parameterized queries** via Prisma ORM — no raw SQL, so classic SQL injection is not a concern.

### What's fragile
- **The repo conflates two apps.** This is nominally "the backend," but it also contains a Vite frontend (`src/App.jsx`, `index.html`, `vite.config.js`, `dist/`) plus the admin SPA, while the real marketing/product frontend lives separately on Lovable. There are **two copies of the Prisma schema** (`prisma/schema.prisma` and `src/prisma/schema.prisma`) — a drift hazard.
- **`package.json` is malformed in intent:** `"nodemailer": "^6.9.8"` appears inside the `scripts` block (`package.json` line ~9) as a stray key, while the real dependency `"nodemailer": "^7.0.5"` is in `dependencies`. A v6→v7 confusion is latent here. There is also no `engines` field, no lockfile-enforced Node version, and no test script.
- **Port mismatch:** server defaults to `4000` (`index.js:56`) but the admin client defaults to `4001` (`src/api.js:1`, `AdminApp.jsx:143`). Without `VITE_API_URL` set, the admin panel calls the wrong port out of the box.
- **Prisma client instantiated per-route-file** (`new PrismaClient()` in `index.js`, `inquiries.js`, `admin.js`) — three clients, three connection pools. Should be one shared singleton.
- **No tests, no CI, no `.gitignore`, no `.env.example`** (README references one that does not exist).

---

## 2. Security Review

| # | Severity | Issue | Location | Fix |
|---|----------|-------|----------|-----|
| S1 | **Critical** | **Live SQLite DB with customer PII committed to git** (`prisma/dev.db` is tracked). Anyone with repo access — or a future public mirror — gets every inquiry's name/email/location. | `prisma/dev.db` (tracked) | Add `.gitignore`, `git rm --cached prisma/dev.db`, rotate the DB, treat it as a breach if the repo was ever shared. |
| S2 | **Critical** | **No `.gitignore` exists.** `node_modules`, `.env`, `dist`, backups, and the DB are all eligible to be committed. One `git add .` leaks all secrets. | repo root (file absent) | Create `.gitignore` covering `.env*`, `*.db`, `node_modules/`, `dist/`, `backups/`. |
| S3 | **Critical** | **Hardcoded default admin password** `cubekrafts2024` and default username `admin`. If env vars are unset in prod, the panel is open to anyone. | `src/routes/admin.js:9-10` | Remove defaults; fail startup if `ADMIN_USERNAME`/`ADMIN_PASSWORD` (better: hashed) are missing. |
| S4 | **High** | **Plaintext password comparison**, no hashing (bcrypt/argon2). Credentials live in env as plaintext and are compared with `!==`. | `admin.js:18` | Store an argon2/bcrypt hash; compare with constant-time verify. Move to a real `User` table. |
| S5 | **High** | **`ADMIN_JWT_SECRET` has no fallback and no startup validation.** If unset, `jwt.sign`/`jwt.verify` throw at runtime; behavior is undefined and easy to misconfigure. A weak/short secret also enables token forgery. | `auth.js:3`, `admin.js:11` | Validate presence + min length at boot; refuse to start otherwise. Use a 256-bit random secret. |
| S6 | **High** | **CORS fully open** (`cors()` allows all origins with credentials defaults). Any site can call the API on a user's behalf. | `src/index.js:24` | Restrict to the known frontend origin(s) via an allowlist. |
| S7 | **High** | **No login-specific rate limiting.** Login shares the global 100/15min budget, which is generous for brute force against a single weak password. | `admin.js:16`, `index.js:27` | Add a strict limiter (e.g. 5/15min per IP) on `/api/admin/login`; add lockout/backoff. |
| S8 | **High** | **Sentry handlers mis-wired.** `Sentry.Handlers.errorHandler()` is registered as middleware *before* the routes (`index.js:28`) and there is **no `requestHandler`/`tracingHandler` at the top**. As written, Sentry will not capture route errors correctly; the custom error handler at `index.js:42` is what actually runs. Observability is effectively broken. | `index.js:17-28, 42-45` | Add `Sentry.Handlers.requestHandler()` first, routes, then `errorHandler()` before the final handler (or migrate to the modern `@sentry/node` v8+ `setupExpressErrorHandler`). |
| S9 | **Med** | **JWT stored in `localStorage`** — readable by any injected script; XSS = full admin takeover. | `AdminApp.jsx:39, 102` | Prefer httpOnly secure cookie + CSRF token, or accept the risk with strong CSP. |
| S10 | **Med** | **Tokens not revocable**, 2h fixed lifetime, no refresh, no logout-server-side. A leaked token is valid until expiry. | `admin.js:21` | Short access token + server-side session/denylist, or rotate secret on incident. |
| S11 | **Med** | **PII in CSV export with no access logging.** `/api/admin/export` dumps all inquiries; this bulk PII egress is **not** written to the audit log (unlike edit/delete). | `admin.js:26-38` | Audit-log every export with admin identity + row count. |
| S12 | **Med** | **No output sanitization / stored-XSS risk in admin table.** Inquiry fields are user-supplied and rendered into the admin DOM; React escapes by default (mitigates), but CSV export of `=cmd`-style fields enables **CSV injection** when opened in Excel. | `admin.js:33`, `AdminApp.jsx:262-277` | Prefix fields starting with `= + - @` with a quote on CSV export. |
| S13 | **Med** | **Verbose error leakage.** Global handler returns `err.message` to clients (`index.js:44`) and logs full errors; can leak stack/internal detail. | `index.js:42-45` | Return generic messages in prod; log detail server-side only. |
| S14 | **Low** | **Security-through-obscurity admin entry** (logo long-press). Harmless but not a control; the `/admin` route is directly reachable. | `App.jsx:14-20` | Treat as UX only; ensure real auth is the gate (it is). |
| S15 | **Low** | **`PATCH` requires full payload** (all four fields validated as required), so partial edits are impossible and a missing field 400s — minor robustness/UX issue, not security. | `inquiries.js:105-110` | Make validation conditional for true PATCH semantics. |
| S16 | **Low** | **No body size limit** on `express.json()`; large-payload DoS possible. | `index.js:25` | `express.json({ limit: "100kb" })`. |

**Net:** The three Criticals (committed PII DB, no `.gitignore`, default credentials) are exploitable today and must be fixed before any further marketing push. Under India's DPDP Act, leaked inquiry PII is a reportable data-protection failure.

---

## 3. Scalability Gaps

**Architecture today:** one Node process, one SQLite file, synchronous SMTP in the POST path, Sentry `tracesSampleRate: 1.0` (100% tracing — expensive and noisy at volume).

- **At ~100 users / low traffic:** Works fine. SQLite handles this comfortably; the contact form is low-write.
- **At ~10k users:** Cracks appear.
  - **SQLite write contention:** SQLite serializes writes with a single writer lock. Concurrent inquiry bursts + admin edits + audit-log inserts (each write is now 2 inserts) will start hitting `SQLITE_BUSY`.
  - **Synchronous email** (`inquiries.js:60`): `await sendInquiryEmails` blocks the response on two SMTP round-trips. Under load or SMTP slowness, request latency balloons.
  - **No horizontal scaling:** SQLite is a local file; you cannot run a second instance behind a load balancer without splitting the DB. Single process = single point of failure; one crash drops all traffic.
  - **Backups are a cron `cp`** (`backup_sqlite.sh`) — copying a live SQLite file risks a torn/corrupt backup, and there's no offsite/retention story.
  - **`tracesSampleRate: 1.0`** floods Sentry and adds per-request overhead.
- **At ~100k users:** SQLite is non-viable. You need Postgres, a managed connection pool, a job queue for email, read replicas for the admin/reporting reads, and a search service. None of that exists or is stubbed.

**Cross-cutting scalability gaps:**
- **No migrations-in-CI / deploy strategy.** Migrations are run manually (`prisma migrate dev`); there is no `migrate deploy` step, no environment separation, and two divergent schema files.
- **No real observability:** `morgan("dev")` is dev-format console logging only; no structured logs, no metrics, no uptime/health endpoint (only `GET /` returns a string), no alerting. Sentry is mis-wired (S8).
- **No caching, no CDN story** for the API; no rate-limit store (the default `express-rate-limit` memory store does not work across multiple instances).

---

## 4. Product–Tech Gaps (multi-tenant dealer SaaS: "the quoting & catalog OS")

The product is a **multi-tenant B2B SaaS for local modular-kitchen dealers**: a dealer signs up, builds their own catalog (modules, finishes, hardware tiers), generates accurate itemized customer quotes in minutes via a server-side versioned pricing engine, and manages incoming leads. India, INR. **Consumer-facing 3D/AR/2D configurator is fully out of scope** — the front door is the *dealer's* app, not a consumer's. **Essentially none of the dealer-SaaS core exists** today; the `Inquiry`/`AuditLog` tables and admin CRUD carry over (the `Inquiry` table becomes the per-dealer lead inbox), and the P0 security fixes apply. The ROI calculator (`App.jsx:267-356`) is irrelevant to this shape. Gaps, in dependency order:

1. **Multi-tenancy — the foundation, and a NEW concern this shape introduces.** One database serving many competing dealers. Every domain table needs a `tenantId` (dealer/org) column, and scoping must be **enforced at the data layer** — via Prisma middleware/client-extension that injects the tenant filter on every query, and/or **Postgres Row-Level Security** — not left to per-route discipline. A single missing filter leaks one dealer's margins, pricing, and customer list to a competitor: a fatal B2B trust/legal failure. **This must exist from the first migration; retrofitting it later touches every table and query (see §0 trap #2). Effort: M (but pervasive).**

2. **Dealer catalog data model (bill-of-materials).** Per-tenant catalog: `Tenant/Dealer`, `ModuleType` (base/wall/tall/corner units), `Finish/Laminate`, `HardwareTier` (e.g. economy/standard/premium hinges & channels), `CatalogItem`/`Component` with dimensions and a price contribution, and `CompatibilityRule` (which finish/hardware applies to which module). Less exotic than the B2C consumer configurator's model because the **dealer**, not a consumer, assembles it through forms — but still the spine; get it wrong and pricing and quotes leak. **Effort: L.**

3. **Server-side versioned pricing/BOM engine — THE core product, not a bolt-on.** Computes an itemized, GST-aware quote from a dealer-assembled kitchen: price = f(modules, dimensions/running-feet, finish, hardware tier, dealer margin, taxes). Must be **fully data-driven per tenant** (no hardcoded constants — every dealer authors their own rules), **version-stamped** so an already-sent quote re-prices identically forever even after the dealer edits their catalog, and emit a line-item breakdown. Highest value, highest risk (see §0 trap #1). Architecturally simple to host (a TypeScript service over Postgres rules tables); the difficulty is correctness and immutability, not infrastructure. **Effort: L.**

4. **Quote generation, PDF, and share.** Turn a computed quote into a **branded PDF** and a **shareable link** the dealer sends the customer. Quote lifecycle: draft → sent → accepted/revised, each quote immutably tied to its pricing-version snapshot. PDF rendering (e.g. a HTML-to-PDF service / Puppeteer / a hosted API). **Effort: M.**

5. **Lead inbox (per dealer).** Reuse and extend the existing `Inquiry` table, scoped by `tenantId`: incoming customer inquiries land in the owning dealer's inbox with status tracking (new/contacted/quoted/won/lost) and link to quotes. This is the lowest-cost gap because the table and admin list already exist. **Effort: S.**

6. **WhatsApp / notification integration.** Indian dealers live on WhatsApp; sending the quote link/PDF via WhatsApp (WhatsApp Business Cloud API, or a provider like Gupshup/AiSensy/Twilio) is a core adoption driver, not a nice-to-have. Plus transactional email (Resend/SES) for quotes and lead alerts, behind a **job queue** (BullMQ/Redis) so sends don't block requests. **Effort: M.**

7. **Auth, roles & tenant membership.** Real users with **per-dealer org membership** and roles (owner/staff). Dealer self-signup, invite teammates, role-scoped access. Replaces the single hardcoded admin. Pairs naturally with a managed provider (Supabase Auth / Clerk). **Effort: M.**

8. **Billing / subscriptions (SaaS revenue).** Per-dealer subscription (Razorpay subscriptions / UPI mandates), plan tiers, GST invoicing. Can be a thin manual layer for the MVP (invoice design-partner dealers by hand) and hardened post-fundraise. **Effort: M (S if manual for MVP).**

9. **Catalog import / onboarding.** Dealers arrive with messy Excel price lists; a generic importer is fiddly and often the true adoption blocker. **Defer** — onboard 1–2 design-partner dealers by hand for the MVP (see §0 trap #3). **Effort: L (deferred).**

10. **Analytics.** Per-tenant: quotes created → sent → accepted (win rate), time-to-quote, catalog usage. Steers the SaaS and the sales pitch. **Effort: S.**

> **Note — consumer 3D/AR is fully OUT of scope.** No consumer configurator, no 3D (react-three-fiber/Three.js), no AR (WebXR/model-viewer), no consumer marketplace in the MVP. The marketplace is **Act 2**, an emergent layer that *reuses the same dealer catalog + pricing data* once enough dealers are on the platform — explicitly post-fundraise.

---

## 5. 90-Day Engineering Roadmap

Effort: **S** ≤ 2 days · **M** ≤ 1–2 weeks · **L** ≥ 2 weeks.

### P0 — Stop the bleeding (Weeks 1–2) — security & data-protection
| Item | Effort | Business reason |
|------|--------|-----------------|
| Add `.gitignore`; remove `prisma/dev.db` from git history; rotate DB | **S** | Prevents customer-PII leak / DPDP exposure (S1, S2). |
| Remove hardcoded admin defaults; fail-fast if `ADMIN_*`/`JWT_SECRET` unset; hash password (argon2) | **S** | Closes open-admin-panel risk (S3, S4, S5). |
| Lock CORS to known origins; add `express.json` size limit; harden error handler | **S** | Stops cross-site abuse + info leak (S6, S13, S16). |
| Login-specific rate limit + lockout | **S** | Blocks brute force on the one password (S7). |
| Fix Sentry handler ordering / upgrade wiring; lower `tracesSampleRate` to ~0.1 | **S** | Restores error visibility before scaling (S8). |
| Audit-log CSV exports; CSV-injection escaping | **S** | PII egress accountability + Excel-injection fix (S11, S12). |

### P1 — Multi-tenant foundation + the pricing core (Weeks 3–8)
The platform + data spine + the engine that *is* the product. Scope assumes the **Minimum Lovable Version** from §0 (one design-partner dealer, kitchens, hand-seeded catalog).
| Item | Effort | Business reason |
|------|--------|-----------------|
| Migrate SQLite → managed **Postgres** (Supabase/Neon/RDS); single Prisma client singleton; `prisma migrate deploy` in CI | **M** | SQLite cannot serve a multi-tenant SaaS (single-writer lock, no RLS, no horizontal scale). Postgres is mandatory and unlocks tenancy + RLS. Highest-leverage move. |
| **Multi-tenancy from the first migration:** `tenantId` on every table + data-layer enforcement (Prisma client-extension and/or Postgres **RLS**) | **M** | The new, pervasive risk (Gap 4.1, §0 trap #2). A leaked tenant filter exposes a dealer's margins/customers to a competitor. Must NOT be retrofitted. |
| **Dealer catalog data model** (Tenant, ModuleType, Finish, HardwareTier, CatalogItem, CompatibilityRule) + admin seeding | **L** | The spine (Gap 4.2). Pricing and quotes hang off it. |
| **Server-side versioned pricing/BOM engine** + API (data-driven per tenant, version-stamped, itemized) | **L** | THE core product and #1 risk (Gap 4.3, §0 trap #1). A wrong or non-reproducible quote churns a dealer account. |
| **Auth + tenant membership & roles** (dealer self-signup, owner/staff, invite); httpOnly cookies — consider Supabase Auth/Clerk | **M** | Real per-dealer accounts replace the single hardcoded admin (Gap 4.7; S9, S10). |
| Structured logging, `/health` endpoint, uptime + error alerting; CI (lint/test/migration check) | **S** | Operability before paying dealers quote live; prevents the next committed-DB mistake. |
| Clean repo: separate backend from the stray Vite frontend; delete duplicate `src/prisma/schema.prisma` | **S** | Removes schema-drift and deploy confusion. |

### P2 — Quote output, leads, and dealer go-to-market (Weeks 9–13)
| Item | Effort | Business reason |
|------|--------|-----------------|
| **Quote generation → branded PDF → shareable link** (immutable, tied to pricing-version snapshot) | **M** | The dealer's deliverable to *their* customer; the visible value of the product (Gap 4.4). |
| **WhatsApp send** (WhatsApp Business Cloud API / Gupshup / AiSensy) + transactional email via **job queue** (BullMQ/Redis) | **M** | Indian dealers run on WhatsApp; sending quotes there is a core adoption driver, not a nice-to-have (Gap 4.6). |
| **Lead inbox per dealer** (extend `Inquiry` table, tenant-scoped, status pipeline new→quoted→won/lost) | **S** | Lowest-cost gap — table + admin list already exist; closes the loop from lead to quote (Gap 4.5). |
| **Subscription billing** (Razorpay subscriptions/UPI mandate, GST invoice) — thin/manual for MVP | **M** (S if manual) | SaaS revenue; can invoice design partners by hand initially (Gap 4.8). |
| Per-tenant analytics (quotes created→sent→accepted, win rate, time-to-quote) | **S** | Steers the product and the sales pitch (Gap 4.10). |

### P3 — Deferred (post-fundraise / requires a team) — explicitly OUT of the 90-day solo window
| Item | Effort | Why deferred |
|------|--------|-------------|
| **Consumer marketplace (Act 2)** reusing dealer catalog + pricing data | **L** | Only credible once enough dealers are on the platform; emergent layer, not the wedge. |
| **Consumer 3D / AR / 2D configurator** (react-three-fiber / Three.js / WebXR, GLB/USDZ) | **XL / specialist** | Fully out of scope for the B2B shape; specialist work that sinks solo timelines. |
| **Generic catalog importer** (dealer Excel → structured catalog) | **L** | Fiddly and often the real adoption blocker; onboard 1–2 dealers by hand first (Gap 4.9, §0 trap #3). |
| **Additional verticals** (wardrobes, bar/TV/storage units) | **L each** | Win modular kitchens first; the catalog/pricing model generalizes later. |

---

## 6. Recommended Target Stack & Migration Path (multi-tenant dealer SaaS)

| Layer | Today | Target | Migration path |
|-------|-------|--------|----------------|
| **DB** | SQLite file (`prisma/dev.db`) | **Postgres** (managed: Supabase / Neon / RDS). Relational catalog tables + JSONB for flexible per-dealer rule blobs; **Row-Level Security** for tenant isolation | Prisma abstracts the swap. SQLite has no RLS, single-writer lock, no horizontal scale — non-viable for multi-tenant SaaS. Mandatory, P1. |
| **Multi-tenancy** | None | `tenantId` on every table + **enforced scoping**: Prisma client-extension/middleware that injects the filter, and/or Postgres **RLS** as a backstop | Bake into the **first** migration. Retrofitting is the trap (§0). P1. |
| **ORM** | Prisma 5 | Prisma (keep) — one client singleton, tenant-scoping extension | Delete duplicate schema; one `prisma/`; `migrate deploy` in CI. |
| **Pricing engine** | 4 constants in React (`App.jsx:271-276`) | **Server-side, per-tenant, data-driven rules engine**, version-stamped, itemized output. Plain TypeScript service over Postgres rules tables — no exotic infra | Build in P1; price logic never on the client; every quote stores its rule-version snapshot. |
| **Auth** | Hand-rolled JWT, plaintext pw, localStorage | Users + **org/tenant membership** + roles (owner/staff); dealer self-signup; httpOnly cookies; **Supabase Auth / Clerk** | Introduce User/Membership model in P1; managed provider avoids building auth + pairs with Supabase DB. |
| **Quote PDF / share** | None | HTML-to-PDF (Puppeteer / a hosted PDF API); signed shareable links | P2. |
| **Notifications** | Synchronous nodemailer (`inquiries.js:60`) | **WhatsApp Business Cloud API** (or Gupshup/AiSensy) + transactional email (Resend/SES), behind **BullMQ + Redis** | P2; WhatsApp is the adoption channel for Indian dealers. |
| **Search** | SQLite LIKE scan | **Postgres FTS + `pg_trgm`/GIN** (per-tenant catalog is small; a dedicated engine is rarely needed at this scale) | P2 if/when needed. |
| **Hosting** | Single Node process, manual | Containerized API on **Render/Railway/Fly.io**; LB + ≥2 instances as dealers grow | Containerize; externalize state (Postgres + Redis) so instances are stateless. |
| **Billing** | None | **Razorpay subscriptions / UPI mandates**, GST invoicing | P2 (manual invoicing acceptable for MVP design partners). |
| **Media / assets** | None | Object storage + CDN (Supabase Storage / R2) for catalog photos & dealer logos | Modest need (no 3D models in this shape); P2. |
| **3D / AR** | None | **Out of scope** for the B2B shape | Not on the roadmap; consumer-only, post-fundraise at the earliest. |
| **Observability** | morgan + Sentry (now guarded) | Sentry (fixed in P0) + structured logs + metrics/alerts | Metrics in P1. |
| **Frontend** | Lovable (Vite/React/shadcn/TS) + stray admin SPA here | The **dealer app** (catalog builder + quote builder + lead inbox) is form-driven React against the new API — well within Lovable/AI-assisted reach | Build the dealer app as the primary surface; decouple from backend repo (P1). |

> **Stack consolidation note:** for a solo founder, **Supabase** (Postgres + RLS + Auth + Storage in one) plus **Razorpay** + a **WhatsApp provider** (Gupshup/AiSensy) + **Resend** is the lowest-operational-overhead path and removes several integration tasks from the 90-day critical path. Supabase RLS is especially valuable here: it gives tenant isolation a database-enforced backstop, so a missed application-layer filter doesn't automatically become a data leak. The **versioned pricing engine is the one piece no platform gives you for free** — that is where the founder's scarce engineering time must go.

---

## Bottom Line

The code is a **clean, well-intentioned MVP** that does one thing — capture leads — reasonably well, and shows good instincts (validation, audit log, graceful shutdown). But after the furnishings pivot it is **materially under-scoped**: a modular-furniture configurator marketplace needs a configurable bill-of-materials catalog, a correct server-side pricing engine, a 2D configurator, and media/CDN infra — **roughly none of which exists.** This is a **harder build than the prefab comparison site**, which was mostly listings + forms. **Fix the P0 security items this week** (days of effort, existential downside), then **re-platform to Postgres + storage + a versioned pricing engine** as the spine. For a solo founder on a 90-day clock the realistic, fundable target is **one category (wardrobes), 2D-only, seeded catalog, correct pricing** — with 3D/AR and dealer onboarding explicitly deferred. **Technical feasibility for a solo founder: 🟡 YELLOW**, conditional on that scope discipline; it turns RED if the founder tries to build all four categories with 3D/AR and dealer self-serve in the window. The single biggest technical risk is the **tightly-coupled configurator + pricing engine**: a pretty configurator that shows wrong prices is a direct revenue-and-trust failure, and bolting a correct pricing rules engine on afterward is a painful rewrite.
