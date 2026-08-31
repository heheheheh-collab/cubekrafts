# Cubekrafts — COO Handover Brief

**Purpose:** complete operating picture for someone stepping in cold. Read this top to bottom and you can run the company tomorrow.
**As of:** 13 Jul 2026 · **Founder:** Tarun Mittal (mittaltarun962@gmail.com) · **Stage:** pre-revenue, product-complete, pilots not yet started

---

## 1. What Cubekrafts is (the thesis in one paragraph)

Cubekrafts is a **two-sided platform for India's modular furniture trade** (kitchens, wardrobes, bar units, TV units, storage — *"if it's built to measure and quoted, it belongs; if it ships in a box with a price tag, it doesn't"*). **Homeowners** get 3 free quotes from verified local dealers via cubekrafts.com. **Dealers** get free qualified leads plus a professional quoting tool (their catalog + rates in once → GST quote in 2 minutes → shared on WhatsApp). Revenue comes from the dealer side: lead credits, an optional Pro plan, and flat success fees on won deals. The moat is the dealer's catalog/pricing living on us (switching cost), city-level supply liquidity, and a lead-quality guarantee no incumbent (Justdial/IndiaMART) offers.

## 2. How we got here (decisions that matter, in order)

1. Started as a **prefab housing** comparison idea → council of agents (research/tech/sales) pressure-tested successive shapes.
2. Pivoted to **modular furnishings** → council rated broad B2C marketplace **RED** (Livspace/HomeLane own demand; ₹100s of crores burned there).
3. Landed on the **dealer-OS shape** (B2B tools + lead-gen, marketplace as Act 2) → rated conditional **GREEN**: solo-buildable, countable customers, no ad war.
4. Broadened from kitchens-only to **everything modular** (founder decision) — platform is category-agnostic; **GTM still leads with kitchens** (highest search volume + ticket).
5. Revenue model v1 (free leads + 1% honor-system fee) diagnosed **unsustainable** → replaced by **v2: credits + Pro + flat fees** (doc 08).
6. Brand: "Kraft Seal" Ck monogram logo → full **Royal Plum rebrand** (aubergine #2E1F35 / champagne #F5EEE1 / old gold #D8B577, Fraunces + Manrope) after the original green/brass proved generic.
7. **Multi-language (Aug 2026, founder call):** English + all 22 scheduled languages of India, switchable site-wide. Rationale is supply-side — Tier-2 fabricators run their business in Marathi/Gujarati/Hindi/Tamil and every quoting tool they have ever been shown was English-only; Livspace/HomeLane do not bother. Two hard rules baked in: the **printed quote document stays English** (GST/terms mistranslation is a real liability — rule #2), and **trade jargon is not over-translated** (the trade code-switches: "shutter", "laminate", "soft-close hinge", "18mm ply", "sq ft" stay English even in fluent Marathi; forced literal translation reads as alien and costs trust).

## 3. What exists today (inventory)

**Product (built on Lovable + Supabase, live preview complete, publish pending):**
- Public: landing, design catalog (/catalog, 8 seeded designs, admin-managed), lead form (/get-quotes) with category + timeline + budget qualification, public quote pages (tokenized), review pages (tokenized), SEO (sitemap, robots, JSON-LD, noindex on private routes), legacy-URL redirects.
- Dealer app: catalog builder (**dual pricing modes: ₹/sq ft or ₹/module**, mixed quotes supported), 2-minute quote builder with auto GST, WhatsApp quote sharing, printable quote docs (columns multiply exactly — non-negotiable), leads CRM (New→Quoted→Won→Lost) with Cubekrafts-lead badges + category/timeline/budget chips, report-junk-lead button, credits balance + ledger, Reputation card, plan management.
- Admin portal (founder-only, DB-enforced via admin_emails + is_admin()): platform KPIs, unrouted-request queue with verify-&-route (founder-verification mode ON), follow-ups queue (30/60-day WhatsApp check-ins), lead-report review with auto credit-back, anomaly flags, dealer management (plans/credits/pilot windows), catalog manager, allocation settings (per-city cap, default 3).
- Engine: fair round-robin allocation with eligibility gates (active + activated + capacity + credits-or-pilot-window), city aliasing, 7-day dedup, allocation audit log, hashed-IP rate limiting, honeypot.

**Security (audited + regression-tested):** RLS on all 19 tables, owner-scoped policies, zero cross-tenant leakage (verified by tenant impersonation), anon sees only active catalog, all SECURITY DEFINER functions have pinned search_path, single-use unguessable tokens for public quote/review pages, security headers + XSS pass, git history purged of an early PII leak. Score ~8.5/10; residuals: enable Supabase leaked-password protection (dashboard toggle), founder-account 2FA, WAF post-traction.

**Business assets:** 10-doc data room in GitHub (`heheheheh-collab/cubekrafts`, branch `claude/startup-business-agents-ngl5yw`, `business/` folder — market research, tech audit, GTM playbook, pitch deck, 15-dealer prospect list, pilot launch kit, allocation schematic, revenue model v2, social media plan, this brief). Logo kits (green + Royal Plum, PNG + SVG masters). Open PR #1 holds it all (mergeable; ignore the failing Vercel check — see §5).

## 4. The business model (doc 08 is canonical)

- **Free forever:** the quoting tool. **2 intro lead credits** on signup.
- **Pro ₹999/mo:** 8 lead credits/mo + allocation-tiebreak priority. Founding dealers: 60 days free routing, then ₹499/mo × 6 months.
- **Pay-as-you-go:** shared lead ₹249 (max 3 dealers/lead — scarcity is deliberate, never broadcast), exclusive ₹699 (not yet wired; price at 3 credits when shipped).
- **Flat success fees** on Won deals: ₹999 (<₹1L) / ₹2,499 (₹1–3L) / ₹4,999 (>₹3L).
- **Quality guarantee:** junk lead = credit auto-restored (never cash). "A junk lead never counts against what you paid for."
- Billing is **manual via WhatsApp until Razorpay** is integrated. Credits never expire (revisit rollover cap post-pilot).
- Unit economics target: ~65–70% gross margin/city; leakage defense in doc 07 §5.

## 5. Pending actions (do these first, in order)

1. **Publish → Update in the Lovable editor** — cubekrafts.com is serving an OLD snapshot; the unpublished batch includes the entire Royal Plum rebrand, plum favicon, security hardening, revenue model v2, quality system, dual-mode quoting, and input fixes. One click.
2. **Founder thumb-tests on preview** (if not done): quote-builder typing stability; per-module toggle + a mixed quote; wardrobe lead category flow.
3. **Delete the Vercel project** `cubekrafts-s5mc` (vercel.com → project → Settings → Delete). It fails a doomed build on every git push and spams PR #1. The real product does NOT deploy via GitHub/Vercel — it deploys via Lovable publish.
4. **Merge PR #1** when convenient (docs → main). The red Vercel status does not block it.
5. **Google Search Console:** sitemap submitted + /login removal requested (done); after publish, Request Indexing on the homepage again.
6. **Supabase dashboard:** enable leaked-password protection. **Founder accounts:** 2FA on Google + GitHub.
7. **Purge test data before first real dealer demo** (keep TestKit as the demo account): test leads ("Aarav Alloc Test", "Test Homeowner", etc.), unrouted test rows, dealer accounts named "X".
8. Replace the 8 catalog placeholder images with real design photos (admin → catalog manager).
9. **Email hygiene for info@cubekrafts.com:** confirm SPF/DKIM/DMARC DNS records on cubekrafts.com (otherwise outbound mail lands in spam — a spam-foldered quote link is a lost deal); if info@ forwards to Gmail, configure Gmail "Send mail as" so replies come from info@cubekrafts.com, never the personal address.

## 6. The 90-day plan (the only plan that matters)

**Goal: fundraise-ready via ONE number — ≥30–40% of activated pilot dealers converting to paid because the platform brought them business.** Everything else is supporting cast.

- **Weeks 1–2:** send the 5 personalized WhatsApp scripts in doc 06 §2 (SLE Pune/WoodMac, Modular Kitchen DSI, Wudley, Interwood, Spacedra — verify current phone numbers at send time). 10 outreaches/day across the wider 15-prospect list. Book 5 pilot calls.
- **Weeks 2–4:** concierge onboarding (doc 06 §4): create their account WITH them, load their real catalog FOR them, build one real quote together and make it match their old Excel numbers, show WhatsApp share on their phone.
- **Weeks 3–6:** every pilot gets ≥1 routed lead; ≥3 dealers activated (built a real quote solo). Founder-verification mode stays ON — founder calls every homeowner before routing ("Verified by Cubekrafts ✓" is the premium claim).
- **Weeks 6–10:** first Won deal → first flat-fee conversation. Pursue one Hettich/Hafele/Godrej distributor-channel LOI.
- **Weeks 10–13:** measure the GREEN gate; build the raise (deck = doc 04, narrative = doc 00) on real numbers.
- **Parallel, ~2h/week:** social launch per doc 09 (WhatsApp-first, founder-face, price-transparency content, city-tagged; never outranks dealer calls).

## 7. Daily/weekly operating rhythm (the assistant's checklist)

- **Daily (~30 min):** admin → unrouted/verification queue (24h SLA — call/WhatsApp each homeowner, verify, route); check anomaly flags; reply to dealer WhatsApps; check lead reports (approve/reject; approval auto-refunds); clear info@cubekrafts.com.
  - **Inbox rule:** info@ notifies, the admin queue decides. Every enquiry is already a row in `leads`/`unrouted_requests` — work them from the admin portal, never from the inbox, or allocation, dedup, credits and the audit log silently stop matching reality.
  - **Email setup to verify once (see §5 item 9):** Gmail "Send mail as" so replies leave FROM info@cubekrafts.com, plus SPF/DKIM/DMARC on the domain.
- **Weekly:** follow-ups queue (30/60-day homeowner check-ins — this is win-detection AND review collection); CRM update in the doc 05 tracker (new→contacted→signed_up→activated→paying); metrics pull (leads routed, activation, junk rate <5%, free→paid %); one social batch session.
- **Monthly:** grant Pro credits happen automatically (lazy accrual); reconcile manual billing; review allocation fairness (no dealer >40% of a city's leads).

## 8. Standing rules (violate these and it stops being Cubekrafts)

1. **Never display invented numbers, testimonials, or claims.** Fake traction was caught and deleted once; the bar stays absolute — site, decks, captions, everywhere.
2. **The printed quote is sacred:** every line must multiply exactly (rate × measure = amount); GST wording accurate; no app chrome in print.
3. **Scarcity is the product:** never broadcast leads beyond the cap; you can't sell exclusivity you gave away.
4. **Homeowner first, fairness second, revenue third** when allocation choices conflict.
5. **Publish discipline:** the live site only changes via Lovable Publish → Update; test on preview first; after any batch, publish promptly (never leave brand/copy split-brained between preview and live).
6. **Scope discipline:** made-to-measure quoted work only; freestanding retail furniture (Pepperfry's war) is out. New categories enter when a real dealer asks.
7. **The next feature is whatever the first real dealer complains about** — not what feels clever. Product is DONE for pilots.

### Parked backlog (decided, not built — do not start before the pilot GREEN gate)
- **Design Studio (post-pilot, founder-approved shape, Jul 2026):** homeowner uploads room photos → AI reimagines the room in a chosen catalog design/style/finish/layout (or from-scratch concept render) → wrapped in a structured brief (dimensions, budget, timeline, must-haves) → one CTA submits render + photos + specs attached to the lead the dealer receives. Renders capped/rate-limited on the existing hashed-IP spine; doubles as the demand-side social hook (doc 09). A true drag-and-drop 3D configurator was explicitly rejected for now — post-raise only.

## 9. Key infrastructure map

| Thing | Where |
|---|---|
| Live site | cubekrafts.com (+ cubekraft-dealer-suite.lovable.app) |
| Latest build preview | id-preview--3dbffddc-a846-4d1e-bfb9-764809b65fbb.lovable.app |
| App editor + publish button | lovable.dev/projects/3dbffddc-a846-4d1e-bfb9-764809b65fbb |
| Database/auth | Supabase (via Lovable project; admin = mittaltarun962@gmail.com in admin_emails) |
| Official inbox | **info@cubekrafts.com** — form/enquiry notifications route here; the public-facing address on the site, WhatsApp Business, Google Business Profile, social bios, deck, and dealer agreements. **Notification channel only — never the system of record (see §7).** |
| Docs + legacy backend repo | github.com/heheheheh-collab/cubekrafts (branch claude/startup-business-agents-ngl5yw, PR #1 open) |
| Legacy Express backend | Same repo — NOT the live product; keep for reference; env fail-fast requires ADMIN_* secrets if ever run |
| Old prefab app (history) | prefab-finder-pro.lovable.app — dormant, superseded |

## 10. Honest risk register

1. **Zero real dealers yet** — every system above is unproven against a human customer. The pilot conversion number is the company.
2. **Manual billing** — fine ≤20 dealers; Razorpay integration is the first post-pilot build.
3. **Won-fee leakage** — mitigated (flat caps, follow-ups, reviews, flags) but honor-based until escrow/procurement (post-raise).
4. **Founder is the single point of failure** — verification mode, routing SLA, billing, outreach all route through one person. This brief exists so it doesn't have to.
5. **Name collision** — "cubekrafts" search is polluted by CubeCraft (Minecraft). Real customers arrive via WhatsApp links and local search terms; brand SEO is a slow background war (GSC work started).

---

*Bottom line for whoever holds this seat: the machine is built, armored, branded, and honest. Its fuel is founder-verified leads and dealer conversations. Protect the standing rules, run the §7 rhythm, execute §6 — and produce the one number. Everything else is noise.*
