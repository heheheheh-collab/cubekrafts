# Cubekrafts — Security Fortress (audit + hardening plan)

**Prepared by:** COO/Acting CTO · **Date:** Jul 2026 · **Method:** live audit against the production Supabase database + edge/app hardening pass.
**Verdict:** the core is already above seed-stage norm. This doc records what was verified, what was hardened, and the 4 dashboard toggles only the founder can flip.

---

## 1. Verified STRONG (audited against the live DB — no action needed)

| Control | Evidence |
|---|---|
| **RLS coverage** | Enabled on **all 18 tables**. |
| **Policy quality** | Every policy is owner-scoped (`auth.uid() = owner_id` / `= id`). **Zero bare `true` policies.** |
| **Anonymous reach** | Only `catalog_items WHERE is_active` is anon-readable — intentional public catalog. Nothing else. |
| **SECURITY DEFINER safety** | **All 15 definer functions have `search_path` locked** — the #1 Supabase privilege-escalation vector is closed. |
| **Money layer integrity** | `admin_grant_credits`, `admin_set_plan`, `admin_set_pilot_until`, `admin_resolve_lead_report` all **check `is_admin()` internally**. `credit_ledger` has **no client write policy** — dealers can read their own balance but cannot write it; only server functions mint credits. **A dealer cannot self-grant credits.** |
| **Admin gate** | `is_admin()` checks the JWT email against `admin_emails` (locked table, 0 client policies) — enforced in the DB, not the client. |
| **Public quote / review** | Reached only via unguessable UUID / single-use token; each returns exactly one record. |
| **Tenant isolation** | Previously verified by direct role impersonation — dealer A cannot read dealer B. |
| **PII tables** | `unrouted_requests`, `submission_events`, `admin_emails` — service-role only (no client policies). |

## 2. HARDENED in the fortress pass (defense-in-depth, shipped)

1. **Edge-function input validation** — length caps + type checks on all public inputs; field allow-listing; generic response on abuse.
2. **Service-role key** — confirmed used only server-side; never in the client bundle.
3. **CORS** — restricted to own origins (no `*`).
4. **Stored-XSS audit** — no raw HTML rendering of homeowner text anywhere (dashboard, admin, printed quote); all user text escaped.
5. **Public review RPC** — single-use + expiry enforced, rating bounded 1–5, text capped, rate-limited; anon (logged-out) execution path verified.
6. **HTTP security headers** — CSP, `X-Frame-Options: DENY` (anti-clickjacking), `nosniff`, `Referrer-Policy`, HSTS, minimal Permissions-Policy.
7. **Route guards** — session verified on load; no flash of protected content; admin re-checks `is_admin` via DB.
8. **Error hygiene** — generic client messages; internals only in server logs.
9. **Abuse caps** — per-dealer limits on catalog/modules/quotes and lead-report spam.

## 3. ⚠️ FOUNDER ACTION — Supabase dashboard toggles (I cannot flip these; SQL/code can't reach them)

Open the Supabase project → **Authentication → Policies/Settings**:

1. **Enable "Leaked password protection"** (checks passwords against HaveIBeenPwned). One toggle, big win.
2. **Shorten OTP / magic-link expiry** to ≤ 1 hour (default is often long).
3. **Require email confirmation** before login — this *protects the admin gate*: since `is_admin()` trusts the JWT email, unconfirmed-email signups must never be able to claim `mittaltarun962@gmail.com`. Confirm this is ON.
4. **Enable MFA** option for the admin account (your login is the master key to every dealer's data — put 2FA on it).

Also in the dashboard, one-time:
5. Run the **Supabase Security Advisor** (Database → Advisors) and clear anything it flags — it catches config drift the SQL audit can't.
6. Confirm **Point-in-Time Recovery / backups** are on (ransomware/oops insurance).

## 4. Residual risks accepted for now (with rationale)

- **Founder-verification mode is the human firewall** during pilots — every lead is manually checked, so automated-abuse blast radius is tiny at current scale.
- **No WAF / DDoS layer** — Supabase + the host provide baseline protection; a dedicated WAF (Cloudflare) is a post-traction add, not a pilot blocker.
- **Payments not yet integrated** — when Razorpay lands, its own PCI-compliant hardening pass is required before going live (never store card data).

## 5. The fortress principle
Security here mirrors the allocation doc's philosophy: **boring, layered, and enforced at the lowest level possible.** The database — not the UI — is the wall. The UI is convenience; RLS is the law. Every new table ships with RLS + owner scoping from commit one, and every new SECURITY DEFINER function ships with `search_path` locked and an `is_admin()` guard if it touches money or other tenants. Hold that line and the fortress holds.
