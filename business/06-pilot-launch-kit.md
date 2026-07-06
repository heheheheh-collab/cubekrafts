# Cubekrafts — Pilot Launch Kit (Top-5 Dealer Onboarding)

**Prepared by:** COO · **For:** Tarun (founder-led sales) · **Goal:** 5 pilots → the free→paid conversion number that decides GREEN
**The product is LIVE at https://cubekraft-dealer-suite.lovable.app** — dealer app + public homeowner lead form (/get-quotes) + design catalog (/catalog) + WhatsApp quote sharing + 1% won-deal fee display.
**Tenant isolation verified** at the database level (see §6) — you can safely put competing dealers on the platform.

---

## 1. The pilot offer (memorize this — it's money-in first)

> "I run Cubekrafts. Homeowners in your city ask us for kitchen quotes — I'll route those enquiries to you **free**. You'll also get our quoting tool: your catalog and rates go in once, then any enquiry becomes a professional GST quote in about two minutes, shareable straight to the customer's WhatsApp. No subscription, no charges. If a lead we bring you turns into a sale, we take 1% of the deal — you pay only when you win. Can I set your catalog up for you this week? Takes 20 minutes on a call."

Why this works (from the council): you're a **revenue source, not a cost**. Never open with the software; open with the leads.

## 2. Personalized first-touch scripts (top 5 pilots)

Verify the current phone/contact from each site/listing at send time. WhatsApp first; email as fallback. Keep it under 5 lines — dealers read on phones.

**1. SLE Pune / WoodMac (Pune)** — angle: they do 3D design + site visits, so they quote constantly.
> Namaste! I saw WoodMac's modular kitchen work in Pune — the 3D design + site-visit process looks serious. I run Cubekrafts: we route Pune homeowners looking for modular kitchens to local manufacturers like you, free. We also give you a tool that turns your rates into a GST quote in ~2 min, shareable on WhatsApp. You pay nothing unless a lead we send becomes a sale (1%). Worth a 15-min call this week?

**2. Modular Kitchen DSI (Delhi-NCR)** — angle: 12+ years, high quoting volume.
> Hi! DSI has been doing kitchens in NCR for 12+ years — you must be sending quotes every single day. I run Cubekrafts: free homeowner enquiries from your area + a quoting tool that makes each quote a 2-minute job (your rates, auto GST, WhatsApp share). Free to use; we charge 1% only on deals you actually win from our leads. Can I show you on a quick call?

**3. Wudley Modulars (Delhi-NCR)** — angle: manufacturer + dealer, complex catalog.
> Hi! Wudley makes kitchens, wardrobes AND TV panels — that's a lot of price combinations to quote by hand. I run Cubekrafts: put your rates in once, and every quote computes itself (module × finish × hardware, GST included) and goes to the customer's WhatsApp in minutes. Plus we send you local homeowner enquiries free. 1% only when you win a deal we brought. 15 minutes to set you up?

**4. Interwood (Bengaluru)** — angle: factory-direct = the exact price story we amplify.
> Hi! Interwood's factory-direct pricing is exactly what Bengaluru homeowners ask us for. I run Cubekrafts — we route those enquiries to manufacturers like you, free, and give you a tool that turns your factory rates into professional GST quotes in 2 minutes. No fees unless a lead we send becomes a sale (1%). Can I set up your catalog this week — takes 20 min?

**5. Spacedra Interiors (Bengaluru)** — angle: established maker that needs distribution.
> Namaste! Saw Spacedra's kitchen + wardrobe work in Bengaluru. I run Cubekrafts: homeowners ask us for kitchen quotes and we pass them to local makers like you — free. You also get our quoting tool (rates in once → 2-min GST quotes → WhatsApp to customer). Pay only 1% when a lead we bring converts. Open to a 15-min call this week?

**Follow-up cadence per prospect:** Day 0 WhatsApp → Day 2 gentle nudge ("should I send a sample lead from your area?") → Day 5 email with the live app link → Day 9 final ("closing pilot spots for [city] this month"). Then park.

## 3. The 2-minute demo (do this live on the call, phone-friendly)

1. Open **/get-quotes** → submit a request as a homeowner in *their* city ("this is what your customers fill").
2. Log in as the demo dealer → show the **Cubekrafts-badged lead** arriving with budget + layout.
3. Hit **Create quote from lead** → add 2 line items (their typical module/finish) → totals + GST compute live.
4. Tap **Share on WhatsApp** → "your customer gets this branded quote link immediately."
5. Mark the lead **Won** → point at the dashboard: "that's the only time we ever charge — 1%."

The demo *is* the pitch. Don't present slides to dealers — present the loop.

## 4. Concierge onboarding checklist (per pilot, ~30 min, you do the work)

- [ ] Create their account WITH them on the call (their email/phone).
- [ ] Load their real catalog FOR them: 4–6 modules with their ₹/rft rates, their 3 finishes, their 2–3 hardware tiers. (They talk, you type — activation is YOUR job, not theirs.)
- [ ] Build one real quote together from a past customer example — verify their numbers match their old Excel quote. **If the totals don't match their expectations, fix the catalog rates on the spot** (pricing trust is everything).
- [ ] Show WhatsApp share on their own phone.
- [ ] Route them their first real lead within 7 days (from /get-quotes traffic or your manual concierge sourcing).
- [ ] WhatsApp check-in at day 3 and day 7 ("did you quote anyone this week?").

**Activated** = built ≥1 real quote on their own. That's the metric gate before any money talk.

## 5. Pilot targets & the number that decides everything

| Week | Target |
|---|---|
| 1–2 | 5 pilot calls booked from top-5 list (10/day outreach on the wider 15) |
| 2–4 | 5 dealers onboarded + catalogs loaded (concierge) |
| 3–6 | Every pilot has received ≥1 routed lead; ≥3 dealers activated |
| 6–10 | First **Won** deal recorded → first 1% fee conversation |
| 10–13 | Measure: **% of activated pilots who pay the 1% without churning** |

⭐ **The GREEN gate (from the council):** ≥30–40% of activated pilots convert to paying because the platform brought them business. Hit that with even 8–12 dealers and the fundraise story is proven. Track in the CRM table (`05` §schema): `new → contacted → signed_up → activated → paying`.

**Honesty rule for pilots:** the 1% fee is disclosed in the first call (it's in the pitch). No surprise billing — the fee lands only when they mark a deal Won, and the dashboard has shown it accruing from day one.

## 6. Due-diligence note: tenant isolation (verified)

Tested at the Postgres level on the live database (29 Jun 2026), by impersonating tenants directly:
- Dealer A cannot read dealer B's quotes/leads/catalog (RLS `owner_id = auth.uid()` on all 7 tables, both directions tested).
- Anonymous users read zero rows in every table.
- Homeowner requests (`unrouted_requests`) are service-role only.
- Public quote links resolve via `SECURITY DEFINER` RPC by unguessable UUID — one quote, nothing else; wrong ID returns nothing.

You can put competing dealers from the same city on the platform safely, and you can say so in diligence.

---

*This kit + the live product is the whole first-90-days motion: outreach (§2) → demo (§3) → concierge onboarding (§4) → the conversion number (§5). Everything else is post-raise.*
