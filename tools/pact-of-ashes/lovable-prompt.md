Paste the block below into the Lovable chat, and attach `cover.jpg` from this directory.

---

The real book cover is attached. Retheme the entire site to match it, fix the motion, and wire up the store link. Four jobs.

## JOB 1 — HARD FACTS TO SET NOW

- Author: **Tarun Mittal**. Put it wherever the book is named — hero, footer, meta tags, OG.
- `src/config/book.ts` → `export const AMAZON_URL = "https://amzn.in/d/0eLYvHUv"`. The pact payoff button is now live, not disabled.
- Save the attached cover to `public/cover.jpg` and use it as the OG/twitter image and favicon source.

## JOB 2 — MATCH THE COVER (this is the main job)

The current site is elegant, muted, ash-grey with a fine Cormorant serif. **The cover is not that.** The cover is a movie poster: molten, heavy, saturated, brutal. The site currently looks like a different book. Fix that.

Study the attached image. What defines it:
- A colossal cracked stone hand, palm up, **glowing molten orange through its fissures** — like cooling lava.
- A woman standing in the palm, her whole body burning red-orange, dissolving upward into embers.
- Charcoal-black ground of charred rock with **bright ember flecks** scattered through it.
- Grey smoke plumes rising behind everything.
- Dark ivy silhouettes framing the top corners.
- Title in **massive, heavy, condensed uppercase** with a cracked, weathered texture — "PACT" in molten red-orange with gold highlights, "OF ASHES" in dirty bone-white.
- Author name across the top in **gold**, uppercase, wide-tracked.

### Retheme accordingly

**Colour** — retune every token, hotter and more saturated than now:
- `--void`: near-black charcoal, slightly warm, like charred rock
- `--magma`: the bright molten orange-red of the lava cracks — the primary accent, and it should genuinely glow
- `--blood`: the deep crimson of the hand
- `--gold`: the author-name gold — reserve it for the highest-value elements only (the Amazon CTA, the pact seal)
- `--bone`: the dirty off-white of "OF ASHES" for body text
- `--smoke`: the grey of the plumes, for muted text and rules

Kill the muted ash-grey palette. Everything should feel lit from inside by something molten.

**Type** — replace Cormorant Garamond as the display face. The cover is heavy condensed uppercase, not a fine old-style serif. Use a heavy condensed display (Oswald 600/700, Anton, or Archivo Black — pick whichever sits closest to the cover) for all headings, uppercase, tight leading, wide tracking on small labels. Keep a clean readable face for body copy. Headings should feel stamped, not calligraphed.

**Texture** — the signature motif is **glowing cracks through dark stone**. Use it as the site's structural language:
- Section dividers are lava fissures, not hairline rules.
- Card and panel borders look like cracks in charred rock, faintly lit from within.
- Keep the grain, deepen the vignette, add drifting smoke.
- Ember flecks replace generic ash motes — small, warm, glowing, rising.
- Consider dark ivy silhouettes at the top corners of the hero, echoing the cover framing.

**Hero** — use the cover image itself. Show it properly (it's a beautiful piece of art), with the page's molten atmosphere continuing out of its edges so the cover and the site read as one surface. Author name in gold above, title treatment matching the cover's weight.

## JOB 3 — MAKE IT FLOW, NOT GLITCH

The site currently feels glitchy and stuttery. It must feel like smoke and lava: continuous, heavy, liquid. Nothing should ever jump, snap, flicker or stutter.

- **Delete every flicker effect.** Remove the `flicker` keyframe and any opacity-jitter animation. Flicker reads as broken, not atmospheric. Glow should *breathe* on a long slow sine, not blink.
- **Animate only `transform` and `opacity`.** Nothing that animates layout, width, height, top/left, or filter on scroll. Promote animated layers with `will-change` so nothing repaints.
- **Long, eased, overlapping.** Generous durations (600–1200ms) with a smooth ease-out curve. Nothing linear, nothing bouncy, nothing under 300ms.
- **Scroll animations must be continuous, not triggered.** Tie them to scroll progress so elements ease in and out smoothly as they pass, rather than snapping on at a threshold. On `/first-lines` especially: the ignite/dim should be a smooth gradient of opacity and glow across the viewport, driven by each line's distance from centre — no discrete on/off states.
- **One rAF loop.** The ember canvas and any scroll-driven work should share a single requestAnimationFrame loop with throttled scroll reads. Multiple competing loops and unthrottled scroll handlers are almost certainly what's causing the stutter. Cap particle count, pause when the tab is hidden.
- **No layout shift.** Reserve space for the cover image and anything else that loads in, so nothing jumps as the page settles.
- **Page transitions fade** through the molten dark rather than cutting.
- Keep full `prefers-reduced-motion` support: no particles, no scroll animation, instant states, content always readable.

## JOB 4 — AUDIT AND FIX

Verify these rather than assuming, and repair anything that fails:
1. `public/novel.json` must not exist — delete it if it's still there.
2. Zero references anywhere in `src/` to `novel.json` or `paragraphs`. Remove dead types and helpers.
3. No `/read` route, no `ChapterDrawer`, `ReadingControls` or `KeepToolbar`, no link pointing at `/read`. A visitor must not reach a reading view by typing a URL.
4. `public/teaser.json` exists and no object in it has a `paragraphs` key.

Also rewrite the project description and the page `<title>`/meta description. They still describe the old build — "a complete, interactive reading of the novel", "customizable reading settings", "a chapter drawer with progress tracking". That is now exactly wrong. Describe what it actually is: a teaser site for Tarun Mittal's 77-chapter dark fantasy revenge novel that deliberately withholds the text, offering opening lines, redacted dossiers, the Council's ledger and a tonal-arc visualisation, converting through a signed pact to the Amazon listing.

Reply with a short factual report on the four audit points.
