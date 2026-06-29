# Cubekrafts — Fundraise Package (COO Consolidation)

**Prepared by:** COO · **Date:** 29 June 2026 · **For:** Tarun Mittal (Founder)
**Goal:** Be **pre-seed/seed fundraise-ready in 90 days** · **Reality:** Solo founder, pre-revenue
**Direction:** **Dealer OS for India's modular-kitchen dealers** — B2B SaaS shape, lead-gen-led acquisition, **transaction-attached** monetization (not flat subscription)

> Master document. Consolidates the three department reports into one investor-facing narrative + a
> solo-founder plan. Data room: `01-market-research.md` · `02-technical-audit.md` ·
> `03-gtm-sales-playbook.md` · `05-manufacturer-target-list.md`

---

## 0. The council's honest verdict (READ THIS FIRST)

We tested three successive shapes of the idea. Here's the honest scorecard of the journey:

| Shape | Council verdict |
|---|---|
| Broad modular-furnishings marketplace | 🔴 RED — unfundable, me-too Livspace |
| Kitchens-only Tier-2 consumer marketplace | 🟡 YELLOW — survivable but still a B2C CAC war |
| **Dealer OS (B2B SaaS, this doc)** | 🟢 **Conditional GREEN — the best shape yet** |

**The dealer-OS shape scores, lens by lens:**

| Lens | Verdict | Crux |
|---|---|---|
| ⚙️ Technical | 🟢 **GREEN** (conditional) | First shape solo-buildable in 90 days. Consumer configurator killed. New risk: **multi-tenant data isolation**. |
| 🔬 Research | 🟡 **YELLOW** | Don't sell a subscription — micro-SMBs convert 5–10%. Winners attach **transaction revenue**. |
| 📈 Sales | 🟡 **YELLOW** (strong) | GREEN *iff* lead-gen-led and ≥30–40% of pilots convert free→paid because the tool brought them orders. |

**The synthesis — and the single edit that makes it fully GREEN:** Research and Sales, working independently, converged on the *same* fix. **Do not charge a flat ₹/month for a quoting tool** — that is the Khatabook/OkCredit graveyard (tens of millions of free users, ~5–10% paid). Instead: **acquire dealers free via lead-gen → make the tool indispensable → monetize the *transaction*** (per-won-deal fee, hardware-procurement margin, or EMI/financing take). Petpooja proved the pattern: a mission-critical tool + transaction revenue → ~$189M revenue on ~$27M raised.

**So the green form of the idea is:** *a dealer operating system for India's modular-kitchen dealers — free leads in, indispensable quoting/catalog tool, money made on the transaction.* The consumer comparison marketplace becomes a no-cold-start **Act 2** once dealers' catalogs already live on the platform.

**What is NOT yet proven (the honest gap):** that dealers will actually pay. That's the one number the 90 days exists to produce.

---

## 1. The one-paragraph narrative (memorize)

> India has tens of thousands of local modular-kitchen dealers who lose deals every week because they quote on Excel/paper, misprice jobs, and have no way to manage leads — while branded players (Livspace/HomeLane) charge homeowners 25–45% more for the same hardware. **Cubekrafts is the operating system for these dealers**: we send them free high-intent leads, give them a quoting + catalog + pricing engine they can't run the business without, and monetize the *transaction* — a fee on won deals and hardware procurement — not a subscription they'd churn out of. Once their catalogs live on us, we hold the supply to switch on a consumer comparison marketplace with zero cold-start.

That's your elevator pitch and slide 2.

---

## 2. Pitch deck outline (full content in `04-pitch-deck.md`)

| # | Slide | Content |
|---|-------|---------|
| 1 | Title | "Cubekrafts — the operating system for India's modular-kitchen dealers." |
| 2 | Problem | Dealers lose deals: manual quotes, mispricing, no lead management, no catalog. |
| 3 | Why now | Tier-2 demand boom + hardware democratized + dealers still on Excel/WhatsApp. |
| 4 | Market size | # of dealers × ARPU (transaction-attached). TAM/SAM/SOM — label estimates. |
| 5 | Solution | Free leads → quoting/catalog/pricing engine → win more, priced right. Live demo. |
| 6 | The wedge | **Lead-gen-led**: money-in first, tool becomes indispensable, then monetize. |
| 7 | Business model | **Transaction-attached**, not subscription: per-won-deal fee + procurement margin. |
| 8 | Competition | No dealer-OS exists; Hettich/Hafele portals are catalogs, not workflow. Whitespace. |
| 9 | Moat | Tooling lock-in (catalog/pricing lives on us) + transaction data + supply liquidity. |
| 10 | Traction (90-day proof) | Dealers activated, **free→paid conversion %**, first transaction rupee, channel LOI. |
| 11 | GTM | Countable B2B outreach → free signup → activation → paid on a deal they won. |
| 12 | Team | Solo technical founder who ships; the 1–2 hires this round funds. |
| 13 | Financials | ARPU from transactions + procurement; NRR > 100% on first cohort. |
| 14 | The ask | Raise $X / 18 months → [N paying dealers, ₹Y MRR, proven conversion]. |

---

## 3. The 5 metrics to track TODAY

1. ⭐ **North Star: Paying dealers retained ≥3 months (net of churn).**
2. **Free→Paid conversion %** — *the number that decides GREEN.* Target ≥30–40%, driven by money-in.
3. **Dealers activated** (built a catalog + sent ≥1 real quote).
4. **Leads routed per dealer / month** (the free hook's value).
5. **Revenue per won deal** (transaction take) + **NRR** on the first cohort.

---

## 4. Solo-founder sequenced plan (~13 weeks)

### 🔴 Week 1 — Stop the bleeding *(largely done)*
- [x] `.gitignore` + PII purged from git history (both branches) + force-pushed.
- [x] P0 security shipped (bcrypt, fail-fast secrets, CORS allowlist, login rate-limit, Sentry fix).
- [ ] Set env vars (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET`, `ALLOWED_ORIGINS`); `npm install`.

### 🟠 Weeks 1–4 — Concierge leads + first dealers (NO heavy code)
- Work the prospect list (`05`) — growing 2–10 person dealers (NOT one-man carpenters), 2–3 cities.
- **Route real buyer leads by hand** to 10–15 dealers (Google Maps, FB/local groups, referrals). This is the free hook.
- Goal: dealers feel "Cubekrafts brings me business."

### 🟡 Weeks 4–8 — Ship the Minimum Lovable dealer tool + the pricing engine
- Build the **multi-tenant** dealer app: catalog builder + **server-side, versioned, per-tenant pricing engine** + quote PDF/share + lead inbox. (CTO's MLV in `02`.)
- **Get tenant isolation right from commit one** — the CTO flags a single missing `tenantId` filter as a fatal, contract-breaking leak.
- 2D/forms only. **No consumer 3D/AR** — explicitly out of scope.

### 🟢 Weeks 8–13 — Prove the money number + package the raise
- Turn on **transaction-attached monetization** with 8–12 dealers. Get the **first real rupee tied to a won deal.**
- **Measure free→paid conversion.** ≥30–40% = GREEN proven; below = iterate the wedge before pitching.
- Pursue **one distribution-channel LOI** (Hettich/Hafele/Godrej dealer network) — near-zero-CAC acquisition story (Research's GREEN unlock).
- Build deck (`04`), metrics dashboard (§3), data room. Start investor conversations.

**Do NOT build:** consumer 3D/AR, wardrobes/other categories, payments-at-scale, faceted consumer search. Post-raise.

---

## 5. Where the council agrees (conviction points)

- **B2B dealer OS beats B2C marketplace** for a solo founder — unanimous.
- **Lead-gen-led acquisition + transaction-attached monetization**, never a flat workflow subscription. (Research + Sales, independently.)
- **The pricing engine is the load-bearing core** — per-tenant, data-driven, versioned, correct. (Tech + Research.)
- **Multi-tenant data isolation is the new existential technical risk.** (Tech.)
- **The whole raise hinges on one number: free→paid conversion driven by money-in.** (Sales + Research.)

---

## 6. ⚠️ Open decisions for you

1. **Commit to the dealer-OS direction?** It's the strongest shape we've found (conditional GREEN). My recommendation: **yes**, with the transaction-attached model — not a subscription.
2. **Which monetization mechanic to test first** — per-won-deal fee, hardware-procurement margin, or financing/EMI take? Research leans procurement/financing via distributor channels; Sales leans per-won-deal. We should pick one to prove in the 90 days.
3. **Git history / PII** — *resolved* (purged + force-pushed). Re-clone any old local copies.

---

*Bottom line: the idea is now in its strongest, most fundable form — a lead-gen-led, transaction-monetized dealer OS for modular kitchens. It's technically GREEN and commercially one provable number away from GREEN. Spend the 90 days producing that number.*
