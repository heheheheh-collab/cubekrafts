# Cubekrafts — Fundraise Package (COO Consolidation)

**Prepared by:** COO · **Date:** 29 June 2026 · **For:** Tarun Mittal (Founder)
**Goal:** Be **pre-seed/seed fundraise-ready in 90 days** · **Reality:** Solo founder, pre-revenue (~15 visitors/30d)

> This is the master document. It consolidates the three department reports into one
> investor-facing narrative + a solo-founder execution plan. The detailed reports are your data room:
> `01-market-research.md` · `02-technical-audit.md` · `03-gtm-sales-playbook.md`

---

## 0. The COO's blunt take (read this first)

You have a **real market, a real wedge, and a believable story** — but today the *product is a contact form*, the *traction is ~15 visitors*, and there's a *live customer-PII database sitting in your git repo*. None of that is fatal at pre-seed. Investors at this stage fund **a founder + a market + evidence of pull**, not a finished marketplace.

So the 90 days are NOT about building the whole marketplace. They are about assembling **three proof points**:
1. **The market is big and the wedge is non-obvious** → already done (see §2, market research).
2. **You can manufacture liquidity cheaply** → sign 20–25 manufacturers + route real buyer leads (the concierge play, no code required).
3. **You're a credible technical founder** → fix the embarrassing security holes, ship a thin slice of the real domain model.

Do those three, and you have a deck with a story, a number, and a demo. That raises a pre-seed.

**The single most important reframe:** *Trust is the product; software is just the delivery mechanism.* All three reports independently landed here. Lead the raise with it.

---

## 1. The one-paragraph narrative (memorize this)

> India's prefab housing market is ~**USD 15B** and growing, but buying prefab is broken — manufacturers are abundant and fragmented while buyers have **no neutral, structured way to compare and trust them**. Existing players are unstructured directories (IndiaMART) or capital-heavy full-stack builders (Brick&Bolt). **Cubekrafts is building the "PolicyBazaar of prefab housing"** — a neutral comparison + quotation + verified-ratings layer, asset-light, monetized by sending manufacturers high-intent, budget-confirmed leads. We start with the premium individual buyer (villas, farmhouses, second homes, ₹12–65L) where the trust gap — and willingness to pay — is highest.

That paragraph is your elevator pitch, your cold email to investors, and slide 2 of your deck.

---

## 2. Pitch deck outline (slide by slide)

Each slide names its source so you can pull the exact data.

| # | Slide | Content | Source |
|---|-------|---------|--------|
| 1 | **Title / one-liner** | "Cubekrafts — the trusted way to compare and buy prefab homes in India." Logo, founder, contact. | — |
| 2 | **Problem** | Buying prefab = acute information asymmetry: no standard specs, opaque pricing (₹1k–4k/sq ft), no neutral quality signal, fear of vendor disappearing, no advisor. | Research §4 |
| 3 | **Why now** | Govt push (PMAY-U 2.0: 1cr homes, ₹10L cr), prefab is ~2× faster & 10–25% cheaper, material/labor inflation, housing shortage 10M→25–31M units by 2030. | Research §1.2 |
| 4 | **Market size** | TAM ~USD 1.3B residential prefab (→2.6B by 2030); SAM ~USD 350–450M comparison-shopped; SOM 3-yr ~₹2–10cr platform revenue. Show the funnel, label estimates. | Research §1.4 |
| 5 | **Solution / product** | Prefab Partners: requirements intake → filter & compare manufacturers → cost estimator → request 3 quotes → verified ratings. Live demo of `prefab-finder-pro.lovable.app`. | Product |
| 6 | **The wedge** | Premium individual/SME buyer (villas/farmhouses/resorts, ₹12–65L) — worst info asymmetry, fastest decision, highest lead value. | Research §2 |
| 7 | **Business model** | Asset-light. Manufacturers pay: pay-per-qualified-lead (₹250–600) → subscription tiers (₹0/4,999/12,999) → featured placement. Buyer side free. Estimator = lead engine, not revenue. | Sales §5, Research §5 |
| 8 | **Competition / whitespace** | 2×2: Directories (IndiaMART) vs full-stack builders (Brick&Bolt) vs materials (Infra.Market) vs **us = neutral structured comparison.** The slot is open. | Research §3 |
| 9 | **Moat** | Trust infrastructure: standardized spec schema, verification badges, real reviews, proprietary lead-quality data. Software is copyable; the trust corpus + supply liquidity is not. | Research §6, §4 |
| 10 | **Traction (the 90-day proof)** | Manufacturers signed, leads routed, ≥3 comparable options/metro, first closed project, North Star number trending up. *This is what the 90-day plan exists to fill.* | Sales §6 |
| 11 | **GTM** | Supply-first concierge marketplace → SEO on "cost" intent + estimator lead magnet → paid pilot at ~₹500/qualified lead. | Sales §1–3 |
| 12 | **Team** | You (technical founder who ships — Lovable product live + backend built). Name the 1–2 hires the round funds (ops/BD, part-time eng). | — |
| 13 | **Financials / model** | Unit economics: lead sold ₹250–600 vs blended CAC ~₹500; ₹20–40L avg deal → manufacturers gladly pay. 18-mo projection to ₹2–10cr SOM. | Research §1.3, Sales §5 |
| 14 | **The ask** | Raise $X pre-seed for 18 months runway → hit [N manufacturers, ₹Y MRR, Z metros]. Use of funds: eng, demand spend, ops hire. | Set with founder |

**Demo matters more than polish at pre-seed.** A working `prefab-finder-pro` walkthrough + a real routed-lead screenshot beats a beautiful but empty deck.

---

## 3. The 5 metrics to start tracking TODAY

You cannot raise without numbers, and you cannot get numbers retroactively. Instrument these **this week** (even a spreadsheet works):

1. ⭐ **North Star: Qualified Leads Delivered to Paying Manufacturers / month.** Proves both sides live + money moving.
2. **Manufacturers listed** (and # paying) — supply liquidity.
3. **Thin-search rate** (% of buyer searches returning <3 comparable options) — keep <20%.
4. **Cost per Qualified Lead** (blended, paid + organic) — must stay *below* what manufacturers pay you.
5. **Visitor → Qualified Lead conversion %** through the estimator funnel.

A pre-seed investor will ask for exactly these. Have a one-screen dashboard.

---

## 4. Solo-founder sequenced plan (don't drown)

You're doing everything alone, so this is **strictly sequenced** — do them in order, don't parallelize five workstreams. Total: ~13 weeks.

### 🔴 Week 1 — Stop the bleeding (1–2 days, then move on)
Non-negotiable, existential-downside, cheap. From the tech audit P0:
- [x] Add `.gitignore` + untrack `prisma/dev.db` *(COO already did this for you)*.
- [ ] **Decide on git history:** the PII DB is still in past commits — see §6. Treat as potential breach if the repo was ever shared.
- [ ] Remove hardcoded admin password `cubekrafts2024`; fail-fast if `ADMIN_*`/`JWT_SECRET` unset; hash the password.
- [ ] Lock CORS to your real origin; add login rate-limit; fix the mis-wired Sentry handler.

*Why first: a leaked-PII story or "anyone can log into your admin" finding kills investor trust and is a DPDP-Act liability. Days of work, removes an existential risk.*

### 🟠 Weeks 1–4 — Manufacture traction (the concierge play, NO code)
This is where your fundraise proof comes from. From the sales playbook:
- Build a 100-manufacturer target list (IndiaMART/TradeIndia/Google Maps), 4 metros (NCR, Bengaluru, Pune/Mumbai, Hyderabad).
- Cold outreach (the email + WhatsApp scripts in `03-gtm-sales-playbook.md` §2 are copy-paste ready), ~10/day.
- **Sign 15–20 manufacturers**, ≥3 per metro. Free to list, pay-per-qualified-lead.
- **Manually route 20+ real buyer inquiries** to them (pull from IndiaMART buy-leads, Quora, referrals). This is your "we're already routing leads" proof — it requires zero new product.

### 🟡 Weeks 4–8 — Turn on demand + thin product slice
- Publish the pillar cost-guide + make the **cost estimator the hero** of the landing page, gated behind email+phone+budget.
- Small Google Search pilot (₹25–40k/mo) on "prefab cost per sq ft" intent → measure CAC.
- **Ship the minimum real domain model** (Manufacturer, Quote, Review tables + APIs) so the demo isn't a façade — but resist building the whole marketplace. A thin slice that makes the demo *true* is enough.

### 🟢 Weeks 8–13 — Package the raise
- Convert 3–5 manufacturers to a paid tier using lead proof → first revenue line.
- Land ≥1 documented **closed project** (the killer slide).
- Build the deck (§2), the metrics dashboard (§3), the data room (the 3 reports + this doc).
- Start investor conversations.

**What to deliberately NOT build:** Postgres migration, job queues, payments infra, faceted search, manufacturer self-serve portal. The CTO ranked these P1/P2 — they are *post-raise* work. Building them now as a solo founder burns the 90 days you need for traction. (Full reasoning: `02-technical-audit.md` §5.)

---

## 5. Where the three reports agree (your conviction points)

When three independent analyses converge, lead with those points — they're your highest-conviction bets:

- **Supply-first, asset-light, monetize the introduction — not the construction.** (All three.) Avoid the capital-heavy Brick&Bolt commission path until v2.
- **The premium individual buyer (₹12–65L) is the beachhead.** (Research + Sales.)
- **The cost estimator is the funnel engine, not a revenue line.** (Research + Sales.)
- **Trust infrastructure — verified profiles, standardized specs, real reviews — is the moat, not the code.** (Research + Tech.)
- **The product is currently a lead-capture form, not a marketplace** — closing that gap (thinly) is the credibility task. (Tech, acknowledged by all.)

---

## 6. ⚠️ Open decision for you (COO needs a call)

**Your customer-PII database (`prisma/dev.db`) is still present in your git *history*,** even though I've now untracked it going forward. Three options:

1. **Purge git history** (`git filter-repo` / BFG) to scrub the DB from all past commits, then force-push. Cleanest, but rewrites history and is irreversible — needs your explicit go-ahead, and anyone with a clone keeps the old data.
2. **Leave history as-is** if the repo has *only ever* been private to you (lower risk, but the PII remains recoverable from history).
3. **Treat as a minor breach**: since real names/emails/locations were involved, the cautious move under India's DPDP Act is to note it and ensure the repo was never public.

Tell me which, and whether the repo was ever shared/public — I'll execute (1) if you want it.

---

*Bottom line: you don't need a finished marketplace to raise — you need a sharp story (you have it), cheap proof of liquidity (4 weeks of concierge outreach), and a credible founder (fix the P0 security, ship a thin real slice). That's the 90 days. Everything heavier is post-money.*
