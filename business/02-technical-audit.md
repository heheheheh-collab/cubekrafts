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

> **Pivot note (2026-06-29):** Cubekrafts has pivoted from prefab housing to **modular furnishings** (modular kitchens, wardrobes, bar units, TV/storage units) — a marketplace + **configurator** play, India, INR. The security findings below remain valid (same backend). Sections 4 (Product–Tech Gaps), 5 (Roadmap), and 6 (Target Stack) have been rewritten for the furnishings vertical. Read the new **"Honest Verdict on the Pivot"** section immediately below first.

---

## 0. Honest Verdict on the Pivot (Technical Lens)

The founder asked for honesty, not reassurance. Here it is.

### Does the current backend serve this pivot?

**No. It is now materially under-scoped — arguably more under-scoped than it was for the prefab comparison site.** The thin Express/Prisma/SQLite backend was *almost* adequate for prefab "Prefab Partners," because that product was fundamentally **listings + filters + lead forms + a client-side calculator**. That is CRUD. SQLite-on-a-box can fake it for a demo, and the existing `Inquiry` table is a (tiny) head start.

The furnishings pivot is a **different class of product**. A credible modular-furniture offering is not listings — it is a **parametric configurator + a structured component catalog + a deterministic pricing engine**, and those three things are tightly coupled:

- **The catalog is a bill-of-materials model, not a product list.** A "wardrobe" is not one SKU; it is carcass + shutters + finish + hardware + internal accessories, each with dimensions, compatibility rules, and its own price. You are modelling a configurable product (think automotive "build your car"), which is genuinely hard data modelling — orders of magnitude beyond the 5-column `Inquiry` table that exists today.
- **The configurator is real engineering.** Even a 2D room/elevation layout with snapping, module constraints, and live dimension math is weeks of focused frontend work. A 3D/AR preview is a specialist discipline (Three.js / react-three-fiber / model pipelines) most solo founders have never touched.
- **The pricing engine must be correct, not approximate.** In prefab, a wrong ROI number was a marketing estimate. In furnishings, the configurator price **is the quote the customer expects to pay** — wrong math is a refund, a margin loss, or a lost sale. This needs a server-side, versioned, rules-driven engine, not four constants in React (`App.jsx:271-276`).
- **It is image- and asset-heavy.** Finishes, textures, swatches, 3D models, render thumbnails — none of which the current stack stores, serves, or CDNs.

Net: of the new product's core, **roughly 0% exists in the backend today.** The `Inquiry`/`AuditLog` schema and the admin CRUD carry over as a lead-capture sidecar, nothing more.

### Solo founder, 90-day fundraise window — realistic?

**Not the full product. A fundable *slice*, yes — barely, and only with ruthless scope discipline.**

Be honest about what "configurator + catalog + pricing engine" means in build-hours. A polished, production version of all three — with 3D, AR, dealer inventory, and a large SKU catalog — is a **multi-engineer, 6–12 month build**. No solo founder ships that in 90 days. Anyone who tells the founder otherwise is selling something.

What a disciplined solo founder *can* do in 90 days, leveraging the existing Lovable frontend and AI-assisted build:

- **One vertical, not four.** Pick **modular wardrobes OR kitchens** — not both, definitely not all four categories. Kitchens are the hardest (corner units, appliances, plumbing constraints); wardrobes are the cleanest first configurator.
- **2D configurator only.** A constrained 2D elevation/layout builder with snapping and live pricing is achievable. **3D and AR are explicitly OUT** of the 90-day window — they are demo-day eye candy that will eat the entire runway. Show them as a roadmap slide, not a built feature.
- **A seeded catalog, not a dealer platform.** Founder hand-curates 1–2 product lines. **Dealer self-serve onboarding/inventory is OUT** — it is a whole second product (a B2B SaaS) bolted onto the first.
- **A correct pricing engine for that one vertical.** This is non-negotiable and where the founder's time should go.

That is a credible, demoable, fundable MVP. It is also **at the absolute limit** of a solo founder's capacity in 90 days, and it assumes the founder can do or AI-assist real frontend engineering (canvas/SVG configurator, state management). If the founder is non-technical or can only do no-code, the configurator+pricing core is **not** solo-buildable to a fundable bar in this window — that scenario needs at least one strong product engineer.

### The single biggest technical risk

**The configurator and the pricing engine are one coupled system, and getting them correct-and-consistent is the hard part — not the UI.** The trap is building a pretty drag-and-drop configurator whose prices are subtly wrong, whose module-compatibility rules leak, or whose catalog model can't represent real products. A wrong price shown in the configurator is a direct revenue/trust failure, and retrofitting a correct, versioned pricing rules engine *after* the UI is built is a painful rewrite. This is where solo timelines die.

### Verdict: 🟡 **YELLOW** (for a solo founder)

**YELLOW, conditional.** Green only if the founder (a) can do or AI-assist genuine frontend engineering, and (b) ruthlessly cuts scope to **one category, 2D-only, seeded catalog, correct pricing**. It turns **RED** if scope stays at "configurator for all four categories with 3D/AR and dealer onboarding" on a solo, 90-day clock — that is not solo-buildable and chasing it will burn the runway with nothing demoable. The build complexity is **materially higher** than the prefab comparison site, which was mostly listings + forms.

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

## 4. Product–Tech Gaps (modular furnishings: from lead form to configurator marketplace)

The new product is a **modular furnishings marketplace + configurator** (modular kitchens, wardrobes, bar units, TV/storage units), India, INR. The core experience is: a customer configures a piece of furniture in a room/elevation layout, sees a **live, correct price** as they swap modules/materials/finishes, and converts that configuration into a quote, a measurement/site visit, and an order. **Essentially none of this exists in the backend** — today it is a single `Inquiry` table behind a contact form, and the ROI calculator (`App.jsx:267-356`) is client-side with four hardcoded constants. The gaps, in dependency order:

1. **A configurable-product (bill-of-materials) catalog — this is the foundation and the hard part.** Not a flat product list. A configurable item (e.g. a wardrobe) decomposes into **carcass + shutters/fronts + finish/laminate + hardware + internal accessories**, each with dimensions, a price contribution, and **compatibility/constraint rules** (which shutter fits which carcass, which finish is available on which front, min/max dimensions). Entities needed: `Category`, `ModuleType`, `Component` (carcass/shutter/hardware/accessory), `Finish/Material`, `CompatibilityRule`, `PriceRule`, `Configuration` (a saved customer build = a list of chosen components + dimensions), `Dealer`, `User` (customer/dealer/admin), `Quote`, `Order`, `SiteVisit`. This data model is the project's spine; get it wrong and everything above it leaks. **Effort: L.**

2. **Pricing engine — server-side, deterministic, versioned.** The configurator price *is the quote*, so it must be correct to the rupee and reproducible. Price = f(modules, dimensions, material/finish, hardware, dealer markup, GST). This must live on the server (not the client — clients can be tampered with and constants drift), be **rules-driven and version-stamped** (so a saved quote re-prices identically), and emit an itemized breakdown. This is the single highest-value, highest-risk backend component. **Effort: L.**

3. **The configurator itself (frontend, but backend-coupled).** A **2D** room/elevation layout builder: place modules on a wall, snap to a grid, enforce dimension and compatibility constraints, call the pricing engine live. This is real frontend engineering (canvas/SVG + constraint state). **3D preview** (react-three-fiber / Three.js) and **AR preview** (WebXR / model-viewer / `<model-viewer>` + USDZ/GLB) are a separate, specialist tier — **roadmap, not MVP.** **Effort: L for 2D; XL/specialist for 3D+AR.**

4. **Media storage + CDN.** Furnishings are image-heavy: finish swatches, textures, product photos, 3D model files (GLB/USDZ), render thumbnails. Current stack stores nothing. Need object storage (S3/Cloudflare R2/Supabase Storage) + CDN + an image-transform pipeline (thumbnails, WebP). **Effort: M.**

5. **Search & filter on a large SKU catalog.** Browsing/filtering by category, dimensions, finish family, price band, dealer, lead time. SQLite `contains` LIKE scans (`inquiries.js:78-86`) collapse on a real component catalog. Postgres FTS + `pg_trgm`/GIN first; **Typesense/Meilisearch** when the SKU count and faceting grow. **Effort: M.**

6. **Design-to-quote workflow.** Saved `Configuration` → generated itemized quote (PDF, GST-compliant) → measurement/site-visit scheduling → revised quote → order. A state machine with notifications. The **measurement/site-visit scheduling** step is specific to furnishings (installed product) and gates conversion. **Effort: M.**

7. **Dealer/inventory catalog management.** Dealers manage their catalog, finishes, pricing markup, stock/lead-times, and receive routed leads. This is effectively a **second product (B2B SaaS)** layered on the marketplace — large, and a prime candidate to defer. **Effort: L.**

8. **Payments + GST.** Booking/advance payments and full orders via **Razorpay** (India-native, UPI), GST-compliant invoicing, dealer payouts/commission. **Effort: M.**

9. **Notifications / email + jobs.** Replace synchronous nodemailer (`inquiries.js:60`) with a transactional provider (Resend/SES) behind a **job queue** (BullMQ/Redis) for quote PDFs, visit reminders, retries. **Effort: M.**

10. **Analytics.** Funnel: configure → save → quote → visit → order, plus configurator drop-off (which step loses customers) and per-dealer conversion. **Effort: S.**

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

### P1 — Foundation for the configurator MVP (Weeks 3–8)
This is the platform + the data spine the configurator and pricing engine sit on. Scope assumes **one category (wardrobes), 2D, seeded catalog** per the Honest Verdict.
| Item | Effort | Business reason |
|------|--------|-----------------|
| Migrate SQLite → managed **Postgres** (Neon/Supabase/RDS); single Prisma client singleton; `prisma migrate deploy` in CI | **M** | SQLite cannot model/serve a configurable catalog at scale; Postgres FTS/JSON is needed for the catalog and pricing rules. Highest-leverage move. |
| **Configurable-product catalog data model** (Category, ModuleType, Component, Finish, CompatibilityRule, Configuration) + admin seeding | **L** | The spine of the entire product (Gap 4.1). Nothing — configurator, pricing, quote — works without it. |
| **Server-side pricing engine** (rules-driven, versioned, itemized breakdown) + API | **L** | The configurator price *is* the quote; wrong/unversioned pricing = refunds and lost trust. The biggest technical risk (Gap 4.2). |
| **Object storage + CDN** (S3/R2/Supabase Storage) + image-transform pipeline | **M** | Furnishings are media-heavy (swatches, textures, photos); the API has no asset story today (Gap 4.4). |
| Real **User/role model** (customer/dealer/admin) + sessions; httpOnly cookie auth | **M** | Saved configurations, quotes, and dealer access all need real accounts (S9, S10). |
| Move email to async **job queue** (BullMQ + Redis) + transactional provider | **S** | Decouples quote/visit emails from the request path; adds retries/deliverability. |
| Structured logging, `/health` endpoint, uptime + error alerting; CI (lint/test/migration check) | **S** | Operability before paying customers configure live; prevents the next committed-DB mistake. |
| Clean repo: separate backend from the stray Vite frontend; delete duplicate `src/prisma/schema.prisma` | **S** | Removes schema-drift and deploy confusion. |

### P2 — Configurator, quote-to-order, and go-to-market (Weeks 9–13)
| Item | Effort | Business reason |
|------|--------|-----------------|
| **2D configurator** (room/elevation layout, snapping, constraint enforcement, live pricing calls) | **L** | The headline product experience; what makes this a configurator marketplace, not a catalog. |
| **Design-to-quote workflow**: save Configuration → itemized GST quote PDF → measurement/site-visit scheduling → order | **M** | The conversion path and the monetizable transaction; site-visit scheduling is specific to installed furnishings (Gap 4.6). |
| **Search/filter on the SKU catalog** (Postgres FTS + `pg_trgm` → Typesense later) | **M** | Browse/discovery for a real component catalog; LIKE scans don't scale (Gap 4.5). |
| **Payments + GST invoicing** (Razorpay, UPI, advance/booking) | **M** | Revenue; India-native rails. |
| Analytics / configurator-funnel instrumentation (configure→save→quote→visit→order, drop-off) | **S** | Find where customers abandon the configurator and where dealers convert (Gap 4.10). |

### P3 — Deferred (post-fundraise / requires a team) — explicitly OUT of the 90-day solo window
| Item | Effort | Why deferred |
|------|--------|-------------|
| **3D + AR preview** (react-three-fiber / Three.js / WebXR, GLB/USDZ model pipeline) | **XL / specialist** | Demo-day eye candy that eats the entire solo runway; show as a roadmap slide, not a built feature. |
| **Dealer self-serve onboarding + inventory/catalog management portal** | **L** | Effectively a second B2B SaaS product; seed catalog by hand first (Gap 4.7). |
| **Additional categories** (kitchens, bar units, TV/storage) | **L each** | Kitchens especially are the hardest (corner units, appliances, plumbing constraints); win one vertical first. |

---

## 6. Recommended Target Stack & Migration Path (modular furnishings configurator)

| Layer | Today | Target | Migration path |
|-------|-------|--------|----------------|
| **DB** | SQLite file (`prisma/dev.db`) | **Postgres** (managed: Neon / Supabase / RDS). Use relational tables for the catalog + JSONB for flexible spec/option blobs and saved configurations | Prisma abstracts the swap. SQLite cannot model a configurable BOM catalog or serve faceted search; Postgres is mandatory, not optional, for this product. P1. |
| **ORM** | Prisma 5 | Prisma (keep) — one client singleton | Delete duplicate schema; one `prisma/`; `migrate deploy` in CI. |
| **Pricing engine** | 4 constants in React (`App.jsx:271-276`) | **Server-side rules engine**, version-stamped, itemized output. Start as plain TypeScript service over Postgres rules tables (no exotic infra needed) | Build in P1; never let price logic live on the client again. |
| **Media / assets** | None | **Object storage + CDN**: Cloudflare R2 or S3 + CloudFront, or Supabase Storage; image transforms (thumbnails/WebP) via the CDN or a service like imgproxy | New capability (P1). Image-heavy product — provision early. |
| **3D / AR (deferred)** | None | **react-three-fiber / Three.js** for 3D; **`<model-viewer>` / WebXR** with **GLB (Android/web) + USDZ (iOS)** for AR. Asset pipeline to author/optimize models | P3 only — specialist work; out of the 90-day solo window. |
| **Search** | SQLite LIKE scan | **Postgres FTS + `pg_trgm`/GIN** first → **Typesense / Meilisearch** as SKU count and faceting grow | Postgres FTS in P2; dedicated search engine when catalog scales. |
| **Hosting** | Single Node process, manual | Containerized API on **Render/Railway/Fly.io** (early) → ECS/Fargate or k8s (scale); LB + ≥2 instances | Containerize; externalize state (Postgres + Redis + object storage) so instances are stateless. |
| **Auth** | Hand-rolled JWT, plaintext pw, localStorage | Real users + roles (customer/dealer/admin); httpOnly cookies; **Supabase Auth / Clerk** to avoid building auth (and it pairs naturally if Supabase is used for DB+storage) | Introduce `User` model in P1; adopt managed auth as dealer/customer roles arrive. |
| **Jobs/Email** | Synchronous nodemailer (`inquiries.js:60`) | **BullMQ + Redis**, transactional email (Resend/SES) — quote PDFs, visit reminders | P1. |
| **Payments** | None | **Razorpay** (India-native, UPI), GST invoicing, dealer payouts | P2. |
| **Observability** | morgan + Sentry (now guarded) | Sentry (fixed in P0) + structured logs + metrics/alerts | Metrics in P1. |
| **Frontend** | Lovable (Vite/React/shadcn/TS) + stray admin SPA here | Keep Lovable for marketing/catalog/intake; the **configurator** is a custom React app (canvas/SVG + r3f later) against the new API; separate admin/dealer surfaces | Decouple admin SPA from backend repo (P1); build configurator as its own app (P2). |

> **Stack consolidation note:** for a solo founder, **Supabase** (Postgres + Auth + Storage in one) plus **Razorpay** + **Resend** is the lowest-operational-overhead path and removes several integration tasks from the 90-day critical path. The pricing engine and configurator are the parts no platform gives you for free — that is where the founder's scarce engineering time must go.

---

## Bottom Line

The code is a **clean, well-intentioned MVP** that does one thing — capture leads — reasonably well, and shows good instincts (validation, audit log, graceful shutdown). But after the furnishings pivot it is **materially under-scoped**: a modular-furniture configurator marketplace needs a configurable bill-of-materials catalog, a correct server-side pricing engine, a 2D configurator, and media/CDN infra — **roughly none of which exists.** This is a **harder build than the prefab comparison site**, which was mostly listings + forms. **Fix the P0 security items this week** (days of effort, existential downside), then **re-platform to Postgres + storage + a versioned pricing engine** as the spine. For a solo founder on a 90-day clock the realistic, fundable target is **one category (wardrobes), 2D-only, seeded catalog, correct pricing** — with 3D/AR and dealer onboarding explicitly deferred. **Technical feasibility for a solo founder: 🟡 YELLOW**, conditional on that scope discipline; it turns RED if the founder tries to build all four categories with 3D/AR and dealer self-serve in the window. The single biggest technical risk is the **tightly-coupled configurator + pricing engine**: a pretty configurator that shows wrong prices is a direct revenue-and-trust failure, and bolting a correct pricing rules engine on afterward is a painful rewrite.
