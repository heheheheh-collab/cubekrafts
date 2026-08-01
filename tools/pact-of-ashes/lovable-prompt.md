Paste the block below into the Lovable chat, and attach `cover.jpg` from this directory.

---

The real book cover is attached, along with a revised `teaser.json`. Retheme the site to match the cover, rewrite all the copy, fix the motion, wire up the store link, and polish. Six jobs.

Also replace `public/teaser.json` with the attached version — the curated `quotes[]` have been re-picked from the manuscript and are stronger, and one character brief has been tightened. Everything else in it is unchanged.

## JOB 1 — HARD FACTS TO SET NOW

- Author: **Tarun Mittal**. Put it wherever the book is named — hero, footer, meta tags, OG.
- `src/config/book.ts` → `export const AMAZON_URL = "https://amzn.in/d/0eLYvHUv"`. The pact payoff button is now live, not disabled.
- Save the attached cover to `public/cover.jpg` and use it as the OG/twitter image and favicon source.

## JOB 2 — MATCH THE COVER (this is the main job)

The current site is muted ash-grey and looks like a different book. The cover is molten, heavy and saturated, and the site's **colour, texture and atmosphere** should come from it.

Its **typography** should not — see the Type section below. Loud art, quiet type. That contrast is deliberate and it is the whole design idea: the cover carries the volume, the site gets out of its way.

Study the attached image. What defines it (this is description of the artwork, not a list of things to imitate in type):
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

**Type** — the colour and texture match the cover. The typography deliberately does not. The art is loud, so the type stays quiet and lets it carry the volume. This is the single most important instruction in this brief: it is very easy to drift back to the genre default, and the genre default is exactly what is being rejected.

Set it like a literary press would, with severity and restraint:

- **Spectral** for everything textual — display and body both. Large sizes for headings, generous leading, real margins, a lot of negative space. Confidence through restraint.
- **IBM Plex Mono**, small and tracked, for labels, chapter numbers, word counts, and any metadata. That clerical note is the one flourish; it echoes the ledger the book turns on.
- The title is **mixed case**: `The Pact of Ashes`. Not all-caps. Set large, but never shouting.
- **No effects on type whatsoever.** No glow, no text-shadow, no gradient fills, no cracked or distressed letterforms, no per-letter animation, no letter-spacing on large display sizes. The molten treatment belongs to the background, the dividers and the art — never to the letters.

Banned outright, including as "close enough" substitutes: Anton, Oswald, Bebas Neue, Archivo Black, Cinzel, Playfair Display, Cormorant Garamond, and any condensed face. Also banned: all-caps headings, and heavy weights used to create emphasis. If a heading needs more presence, make it larger or give it more space — never heavier, never wider-tracked, never louder.

Uppercase is permitted in exactly one place: the small tracked IBM Plex Mono label style. Everywhere else, sentence or title case.

**Texture** — the signature motif is **glowing cracks through dark stone**. Use it as the site's structural language:
- Section dividers are lava fissures, not hairline rules.
- Card and panel borders look like cracks in charred rock, faintly lit from within.
- Keep the grain, deepen the vignette, add drifting smoke.
- Ember flecks replace generic ash motes — small, warm, glowing, rising.
- Consider dark ivy silhouettes at the top corners of the hero, echoing the cover framing.

**Hero** — use the cover image itself. Show it properly and give it room (it's a beautiful piece of art), with the page's molten atmosphere continuing out of its edges so the cover and the site read as one surface. The cover already contains a loud title treatment, so the page's own title sits quietly beside or beneath it in Spectral, mixed case, with the author's name in the small gold mono label above. Do not restate the cover's lettering at the cover's volume — that competition is what made the old hero feel generic.

## JOB 3 — REPLACE ALL THE COPY

The copy currently on the site is clever, and that is the problem. It leans on one rhetorical move over and over — state a number, then withhold something ("Seventy-eight openings. Every door locked." / "Twelve files. Every ending redacted.") — and several strings taunt the visitor outright. It reads as a copywriter performing.

Worse, it competes with the author's own prose and loses. The opening lines in `teaser.json` are the best writing available anywhere on this site. Nothing written by us should sit in front of them.

**The new rule: the site's own voice nearly disappears.** Label things plainly and let the book's real sentences carry every ounce of persuasion. No taunting, no withholding jokes, no parallel constructions, no scarcity language, no lines that draw attention to their own cleverness. Plain, quiet, confident — the same register as the typography. If a string could appear on a poster, rewrite it.

Use this deck verbatim.

**On casing:** strings in caps are the small tracked IBM Plex Mono label style — nav, metadata, buttons. Everything else is mixed case in Spectral, exactly as written.

**Site-wide**
- Nav: `First Lines` · `The Ledger` · `The Files` · `The Descent`, then the button `MAKE THE PACT`
- Footer: `The Pact of Ashes — Tarun Mittal`
- Header once signed: `SIGNED — {name}`

**Landing `/`**
- Eyebrow (mono): `TARUN MITTAL`
- Title (Spectral, large, mixed case): `The Pact of Ashes`
- Deck: `A novel in seventy-seven chapters.`
- Then the author's own invitation, given room and set as the emotional centre of the page: `It will start when you say yes — and like all true bargains, it will require something back of you before it is finished.`
- Stat band, two figures only (the third was a sales pitch — drop it): `77 CHAPTERS` · `60,534 WORDS`
- Primary CTA (mono): `MAKE THE PACT`
- Secondary link (mono): `READ THE FIRST LINES` → `/first-lines`
- Question section: set `What is the real cost of devotion?` large, attributed plainly beneath as `— from the preface`. No commentary on it. The question is strong enough alone; anything added weakens it.
- Fragments section heading (Spectral): `Fragments`
- Fragments subhead: `Twelve lines from the book.`

**The four module cards on the landing page** — plain descriptions, no promises:
- `First Lines` — `The opening sentence of every chapter.`
- `The Ledger` — `The names the Council kept.`
- `The Files` — `Twelve people, as the book introduces them.`
- `The Descent` — `How dark each chapter runs.`

**`/first-lines`**
- Title (Spectral): `First Lines`
- Deck: `The opening sentence of every chapter, in reading order.`
- Closing line: `The rest of each chapter is in the book.`
- Closing CTA (mono): `FIND IT ON AMAZON`

**`/ledger`**
- Title (Spectral): `The Ledger`
- Deck — use the author's real line, it is better than anything we would write: `The gray-suited man lived in ledgers.`
- Under it, plain: `The names he kept.`
- Footer: `Their fates are in the book.`

**`/dossiers`**
- Title (Spectral): `The Files`
- Deck: `Twelve people, as the book introduces them.`
- Redacted bar label: `REDACTED — {redacted}`
- Nothing appears when someone tries to reveal a bar. The bar simply does not open. Do not add a message; a silent refusal is stronger than a caption about the refusal.

**`/descent`**
- Title (Spectral): `The Descent`
- Deck: `Each chapter measured for how dark it runs, in reading order.`
- Caption under the graph: `The shape of the book, without its words.`

**The pact dialog**
- Title (Spectral): `Make the Pact`
- Body — the author's own words again: `It will start when you say yes.`
- Field labels (mono): `NAME` and `EMAIL`
- Under the fields, small and plain — this is the only place the site asks for anything, so say what happens to it: `Your email is only used to tell you about this book. Nothing else, no one else.`
- Submit button (mono): `SIGN`
- After signing, on the seal (Spectral): `Signed.`
- Payoff button (mono, gold): `FIND IT ON AMAZON` → `AMAZON_URL`

Do not invent fiction anywhere. Quoted fragments, opening lines and character copy come from `teaser.json` verbatim — the deck above is UI copy, which is ours to set, but the book's words are never rewritten, extended, or added to.

## JOB 4 — MAKE IT FLOW, NOT GLITCH

The site currently feels glitchy and stuttery. It must feel like smoke and lava: continuous, heavy, liquid. Nothing should ever jump, snap, flicker or stutter.

- **Delete every flicker effect.** Remove the `flicker` keyframe and any opacity-jitter animation. Flicker reads as broken, not atmospheric. Glow should *breathe* on a long slow sine, not blink.
- **Animate only `transform` and `opacity`.** Nothing that animates layout, width, height, top/left, or filter on scroll. Promote animated layers with `will-change` so nothing repaints.
- **Long, eased, overlapping.** Generous durations (600–1200ms) with a smooth ease-out curve. Nothing linear, nothing bouncy, nothing under 300ms.
- **Scroll animations must be continuous, not triggered.** Tie them to scroll progress so elements ease in and out smoothly as they pass, rather than snapping on at a threshold. On `/first-lines` especially: the ignite/dim should be a smooth gradient of opacity and glow across the viewport, driven by each line's distance from centre — no discrete on/off states.
- **One rAF loop.** The ember canvas and any scroll-driven work should share a single requestAnimationFrame loop with throttled scroll reads. Multiple competing loops and unthrottled scroll handlers are almost certainly what's causing the stutter. Cap particle count, pause when the tab is hidden.
- **No layout shift.** Reserve space for the cover image and anything else that loads in, so nothing jumps as the page settles.
- **Page transitions fade** through the molten dark rather than cutting.
- Keep full `prefers-reduced-motion` support: no particles, no scroll animation, instant states, content always readable.

## JOB 5 — AUDIT AND FIX

Verify these rather than assuming, and repair anything that fails:
1. `public/novel.json` must not exist — delete it if it's still there.
2. Zero references anywhere in `src/` to `novel.json` or `paragraphs`. Remove dead types and helpers.
3. No `/read` route, no `ChapterDrawer`, `ReadingControls` or `KeepToolbar`, no link pointing at `/read`. A visitor must not reach a reading view by typing a URL.
4. `public/teaser.json` exists and no object in it has a `paragraphs` key.

Also rewrite the project description and the page `<title>`/meta description. They still describe the old build — "a complete, interactive reading of the novel", "customizable reading settings", "a chapter drawer with progress tracking". That is now exactly wrong. Describe what it actually is: a teaser site for Tarun Mittal's 77-chapter dark fantasy revenge novel that deliberately withholds the text, offering opening lines, redacted dossiers, the Council's ledger and a tonal-arc visualisation, converting through a signed pact to the Amazon listing.

Reply with a short factual report on the four audit points.

## JOB 6 — POLISH

Details that decide whether this reads as a real book's site or a demo.

**The form is the only thing the site asks for, so it must be flawless.** Inline validation on blur, not on every keystroke. A visible loading state on submit. A real error message if the write fails, with the typed values preserved — never a silent failure, never a cleared form. A duplicate email is a success, not an error: the person already signed. Full keyboard operation, focus moved into the dialog on open and returned to the trigger on close, `Esc` to dismiss.

**Accessibility, which atmospheric sites usually fail.**
- Body text must clear 4.5:1 against its actual background — check the bone-on-charcoal and especially the smoke-grey muted text, which is the likely failure. Fix by lightening the text, not by dimming the atmosphere.
- Visible focus rings everywhere, in ember, never `outline: none` without a replacement.
- Decorative canvases and the grain overlay get `aria-hidden="true"`.
- The redacted bars must announce as redacted to a screen reader — `aria-label="Redacted"` — rather than reading out as empty or, worse, exposing the withheld text to assistive tech. There is nothing to expose, so confirm the label carries the meaning.
- Every interactive element is a real `button` or `a`, never a `div` with a click handler.
- The `/first-lines` procession must be fully readable with JavaScript animation disabled.

**Sharing.** This link will get pasted into WhatsApp and Instagram, and the preview is the whole first impression. Proper OG and Twitter card tags, the cover as the image, sized so it isn't cropped badly. Add JSON-LD `Book` structured data — name, author Tarun Mittal, numberOfPages/wordCount, the Amazon URL as `offers`. Real `<title>` and description on every route, not just the home page.

**Performance.** Preload the two font families and subset them; nothing else. Serve the cover responsively and compress it — it is the largest asset and it is above the fold. Lazy-load anything below. The ember canvas caps its particle count on small screens and stops entirely when the tab is hidden.

**Loose ends.**
- The Amazon link opens in a new tab with `rel="noopener noreferrer"`.
- A themed 404 that offers a way back, in the same quiet voice — no joke copy.
- Favicon from the cover.
- Check the whole site at 360px wide. The cover, the ledger page and the descent graph are the three most likely to break.
