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

## 4. Product–Tech Gaps (from lead-capture form to real marketplace)

The product vision is a prefab-housing **comparison/consultation marketplace**: requirements intake, company filtering, comparisons, quote requests, ratings, expert recs, cost estimator. **Almost none of this exists in the backend.** Today's backend = a single `Inquiry` table behind a contact form. The ROI calculator (`App.jsx:267-356`) is **client-side only** with hardcoded constants and is not the "cost estimator engine" the product needs.

To become a real marketplace you need:

1. **Domain model that doesn't exist yet.** Core entities: `Manufacturer/Company`, `Product/ModuleType`, `Specification`, `Quote`, `QuoteRequest`, `Review/Rating`, `User` (buyer + admin + manufacturer roles), `Project/Requirement`. This is the foundation — everything else hangs off it.
2. **Manufacturer onboarding / CRM.** Self-serve company profiles, verification/KYC, catalog management, lead routing, a manufacturer-facing portal. Currently zero.
3. **Search & filtering infrastructure.** Comparison/filtering at scale needs faceted search (location, price band, module type, lead time, certifications). SQLite `contains` LIKE scans (`inquiries.js:78-86`) won't cut it. Target: Postgres full-text first, Typesense/Meilisearch/Elastic later.
4. **Quote workflow.** Buyer requirement → matched manufacturers → structured quote responses → comparison view → acceptance → handoff. State machine + notifications. None exists.
5. **Payments.** Lead fees / subscription / commission (Razorpay or Stripe for India), invoicing, GST handling. None exists.
6. **Notifications / email at scale.** Replace synchronous nodemailer with a transactional provider (Resend/SES/Postmark) behind a **job queue** (BullMQ/Redis) for retries and decoupling from the request path.
7. **Analytics.** Funnel tracking (intake → comparison → quote → conversion), manufacturer performance, marketplace liquidity metrics. Today there is nothing beyond raw inquiry rows.
8. **Cost-estimator engine.** Move estimation server-side, data-driven (per-manufacturer pricing, regional cost indices, material/labour inputs), versioned and auditable — not four hardcoded constants in React.

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

### P1 — Make it productionizable (Weeks 3–8)
| Item | Effort | Business reason |
|------|--------|-----------------|
| Migrate SQLite → managed **Postgres** (Neon/Supabase/RDS); single Prisma client singleton; `prisma migrate deploy` in CI | **M** | Removes the hard scaling ceiling and write-contention risk; enables multi-instance. |
| Move email to async **job queue** (BullMQ + Redis) + transactional provider | **M** | Decouples SMTP from request latency; adds retries/deliverability. |
| Real **User/role model** + sessions; httpOnly cookie auth; logout/revocation | **M** | Foundation for manufacturer + buyer + admin roles (S9, S10). |
| Structured logging, `/health` endpoint, uptime + error alerting | **S** | Operability — know when prod breaks before customers do. |
| CI pipeline: lint, test scaffold, migration check, build | **S** | Prevents the next committed-DB-class mistake. |
| Split repos / clean monorepo: separate backend from the stray Vite frontend; delete duplicate `src/prisma/schema.prisma` | **S** | Removes schema-drift and deploy confusion. |

### P2 — Build the marketplace (Weeks 9–13 and beyond)
| Item | Effort | Business reason |
|------|--------|-----------------|
| Marketplace domain model (Manufacturer, Product, Quote, Review, Requirement) + APIs | **L** | This is the actual product; without it Cubekrafts is a contact form. |
| Manufacturer onboarding + portal (catalog, verification, lead routing) | **L** | Supply side of the marketplace; no manufacturers = no marketplace. |
| Quote-request workflow (state machine + notifications) | **L** | The core monetizable transaction. |
| Faceted search/filter infra (Postgres FTS → Typesense/Meilisearch) | **M** | Comparison UX at scale; the headline feature. |
| Server-side cost-estimator engine (data-driven, versioned) | **M** | Differentiator + lead-quality driver; replaces hardcoded client calc. |
| Payments (Razorpay/Stripe) + GST/invoicing | **M** | Revenue. |
| Analytics/funnel instrumentation | **S** | Measure marketplace liquidity and conversion to steer the business. |

---

## 6. Recommended Target Stack & Migration Path

| Layer | Today | Target | Migration path |
|-------|-------|--------|----------------|
| **DB** | SQLite file (`prisma/dev.db`) | **Postgres** (managed: Neon / Supabase / AWS RDS) | Prisma already abstracts this. Change `provider` to `postgresql`, regenerate migrations, dump+import data. Do during P1; SQLite→Postgres is the single highest-leverage move. |
| **ORM** | Prisma 5 | Prisma (keep) — consolidate to one client singleton | Delete duplicate schema; one `prisma/` dir; `migrate deploy` in CI. |
| **Hosting** | Single Node process, manual | Containerized API on **Render/Railway/Fly.io** (early) → **ECS/Fargate or k8s** (scale); LB + ≥2 instances | Containerize; externalize state (Postgres + Redis) so instances are stateless. |
| **Auth** | Hand-rolled JWT, plaintext pw, localStorage | Real users + roles; httpOnly cookies; consider **Clerk/Auth0/Supabase Auth** to avoid building auth | Introduce `User` table in P1; adopt managed auth as roles multiply (buyer/manufacturer/admin). |
| **Search** | SQLite LIKE scan | **Postgres FTS** first → **Typesense/Meilisearch** at catalog scale | Add when the comparison feature ships (P2). |
| **Jobs/Email** | Synchronous nodemailer | **BullMQ + Redis**, transactional email (Resend/SES) | P1. |
| **Observability** | morgan + mis-wired Sentry | Fixed Sentry + structured logs + metrics/alerts | Fix Sentry in P0; add metrics in P1. |
| **Frontend** | Lovable (Vite/React/shadcn/TS) + stray admin SPA here | Keep Lovable for marketing/intake; build proper buyer + manufacturer + admin frontends against the new API | Decouple admin SPA from backend repo (P1). |

---

## Bottom Line

The code is a **clean, well-intentioned MVP** that does one thing — capture leads — reasonably well, and shows good instincts (validation, audit log, graceful shutdown). But it is **not a marketplace**, and it ships with **three Critical security issues that are exploitable today**, the worst being a live customer-PII database committed to git with no `.gitignore` to stop the next leak. **Fix the P0 security items this week** (days of effort, existential downside), **re-platform to Postgres + async jobs in the next two months**, and **only then** start building the actual marketplace domain model — because right now that domain model doesn't exist in a single line of backend code.
