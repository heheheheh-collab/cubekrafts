# Cubekrafts — Revenue Model v2 (approved & shipped)

**Prepared by:** COO · **Approved by:** Founder (Jul 2026) · **Status:** live in product (billing manual until payments integration)
**Supersedes:** the "free leads + 1% won-fee" model and the §6 credit sketch in `07-lead-allocation-schematic.md`.

---

## 1. Why v1 was not sustainable (the diagnosis)

| Leak | Math |
|---|---|
| Tiny revenue/lead | 1% × ₹3L avg kitchen = ₹3,000, × ~25–30% any-dealer-win rate × ~50% honor-system collection ≈ **₹375–450 expected revenue per lead** |
| Real cost/lead | Organic runs out; Indian home-improvement CPL at scale ≈ **₹300–800** (search CPCs ₹50–300, form conv. 5–10%) |
| Result | **~zero gross margin** on the core loop before ops |
| Free tier consumed demand | 5 free leads/mo × 10 dealers = 50 free leads in a city generating ~30 → **demand fully consumed at ₹0, forever** |
| No recurring floor | MRR = 0; collections = chasing SMBs in arrears for ₹3k |

## 2. The v2 model — three layers, each fixes a leak

### Layer 1 — Membership (recurring floor)
- **Quoting tool: free forever.** Never gated — it drives activation, catalog data, and lock-in.
- **Intro: 2 free leads total** on signup (was: 5/month forever).
- **Pro — ₹999/month:** 8 lead credits/month + priority in allocation tie-breaks + reputation page + analytics.
- Anchor: dealers pay Justdial/IndiaMART ₹12–40k/yr for context-free shared junk. One won kitchen pays for ~8 years of Pro.
- **Founding-dealer offer:** pilots keep free routing 60 days, then ₹499/mo for 6 months.

### Layer 2 — Lead credits (metered, prepaid, priced above CPL)
- **Shared lead ₹249** (scarcity cap intact, max 3 dealers → one lead monetizes up to **₹747**).
- **Exclusive lead ₹699** (later ₹999 for kitchen/full-home; category pricing post-pilot).
- **Prepaid only** — zero receivables. **Junk-lead auto credit-back** — the quality guarantee Justdial never gives; our differentiation.

### Layer 3 — Flat success fees (replaces the unbounded 1%)
| Won deal value | Fee |
|---|---|
| < ₹1,00,000 | ₹999 |
| ₹1–3,00,000 | ₹2,499 |
| > ₹3,00,000 | ₹4,999 |

Why flat > 1%: predictable for dealers (no "success tax" feeling), psychologically ≤1%, easier to collect, and **capping reduces the incentive to hide big wins** — shrinking the §5 leakage problem by design. All §5 defenses still apply.

## 3. Unit economics (per city cohort, 100 leads/month)

```
Cost:    100 leads × ₹250–400 blended CPL          ≈ ₹25–40k
Revenue: ~60 shared × 3 × ₹249                     ≈ ₹45k
         ~15 exclusive × ₹699                      ≈ ₹10k
         ~12 Pro subs × ₹999                       ≈ ₹12k   (MRR floor)
         ~12 wins × ~₹2,000 avg flat fee           ≈ ₹24k
                                                    ≈ ₹91k
Gross margin ≈ 65–70%, with a recurring floor.
```

Dealer-side sanity: a Pro dealer pays ₹999 + ~₹2,499 on a win from 8 leads → ~₹3.5k cost against a ₹3L job with 25–35% dealer margin (₹75k–1L gross). **Platform cost ≈ 4–5% of the dealer's margin on one win** — comfortably payable, honestly priced.

## 4. What shipped in product

- `credit_ledger` (+2 intro grant on signup; lazy +8/month Pro accrual; −1 per allocated lead outside pilot window; admin grants; junk-refund reason code).
- Allocation eligibility: pilot window OR credits > 0 (existing dealers grandfathered 60 days).
- Dealer UI: balance chip, ledger, plan; upgrade/buy CTAs via WhatsApp (manual billing until Razorpay).
- Admin: plan/credits/pilot-window controls per dealer; KPIs on flat fees.
- Public pricing: Starter / Pro / Pay-as-you-go cards + flat-fee table + credit-back guarantee. All 1% claims removed.

## 5. Post-raise layers (unchanged from §5/§6 of doc 07)
Procurement margin, financing/EMI take-rate, escrow/payment-protection — the leakage-proof terminal economics.

## 6. Validate with pilots before hard-coding forever
Price points are hypotheses. The pilot cohort must confirm: Pro conversion ≥30–40% of activated dealers, shared-lead sell-through ≥60%, and zero churn attributable to the success fee. Adjust ₹ numbers on evidence, not vibes.
