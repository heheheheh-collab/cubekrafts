Paste the block below into the Lovable chat, and attach `cover.jpg` from this directory.

---

The real book cover is attached. Retheme the entire site to match it, rewrite all the copy, fix the motion, and wire up the store link. Five jobs.

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

The current writing is restrained and literary. The cover is not restrained. Rewrite every string on the site in a harder voice: short declarative sentences, present tense, heat and stone, no preciousness, no wistfulness. It should sound like the poster, not like a review of the book.

Use the deck below verbatim. Anything not listed here that you have written yourself, rewrite to match this register.

**On casing in this deck:** strings written in caps below are the small tracked IBM Plex Mono label style — nav items, stat figures, metadata, buttons. Everything that is a real heading or a sentence is set mixed case in Spectral, exactly as written. Do not upper-case the headings.

**Site-wide**
- Nav: `FIRST LINES` · `LEDGER` · `DOSSIERS` · `DESCENT` · `MAKE THE PACT`
- Footer line 1 (mono label): `THE PACT OF ASHES — TARUN MITTAL`
- Footer line 2: `Seventy-seven chapters. None of them here.`
- Header seal once signed: `SIGNED — {name}`

**Landing `/`**
- Eyebrow (mono label): `TARUN MITTAL`
- Title (Spectral, large, mixed case): `The Pact of Ashes`
- Deck (directly under the title, Spectral): `She died in a dungeon. Something in the dark offered her a way back. It wore her brother's face.`
- Invitation block — keep the author's own words, they are the best line on the page: `It will start when you say yes — and like all true bargains, it will require something back of you before it is finished.`
- Stat band, three figures: `SEVENTY-SEVEN CHAPTERS` · `SIXTY THOUSAND WORDS` · `NOT ONE OF THEM FREE`
- Primary CTA (mono label): `MAKE THE PACT`
- Secondary link (mono label): `SEE WHAT YOU CAN'T HAVE` → `/first-lines`
- Question section heading (Spectral): `The book asks one question`
- Question, in large display type: `What is the real cost of devotion?`
- Under it: `It spends seventy-seven chapters refusing to answer kindly.`
- Fragments section heading (Spectral): `What escaped`
- Fragments subhead: `Ten lines got out. The rest is still burning.`

**The four module cards on the landing page**
- `First Lines` — `Seventy-eight openings. Every door locked.`
- `The Ledger` — `The Council keeps a list. You don't get to see who's crossed out.`
- `Dossiers` — `Twelve files. Every ending redacted.`
- `The Descent` — `The shape of her fall, with the words removed.`

**`/first-lines`**
- Title (Spectral): `First Lines`
- Deck: `Every chapter's opening sentence. Nothing after it.`
- Hover hint (shown once): `Hover a line to see the size of what you're not getting.`
- Closing line at the end of the procession: `Seventy-seven beginnings. No endings.`
- Closing CTA (mono label): `THE REST IS ON AMAZON`

**`/ledger`**
- Title (Spectral): `The Ledger`
- Deck: `The gray-suited man believed the world could be kept in a book. Every name. Every fate. Underlined, and finished.`
- Footer, in the same hand: `Some names are underlined. Some are crossed out. You do not get to know which.`

**`/dossiers`**
- Title (Spectral): `The Files`
- Deck: `Twelve people. What happens to them is not on this page.`
- Redacted bar label: `REDACTED — {redacted}`
- Text shown when someone tries to reveal a bar: `IT DOESN'T OPEN.`

**`/descent`**
- Title (Spectral): `The Descent`
- Deck: `Seventy-eight sections, measured for how dark they run.`
- Caption under the graph: `The shape of a descent, with the words removed.`

**The pact dialog**
- Title (Spectral): `Make the Pact`
- Body: `Sign it. Like all true bargains, it will require something back of you.`
- Field labels: `THE NAME YOU SIGN WITH` and `WHERE TO REACH YOU`
- Submit button (mono label): `SIGN IN ASH`
- After signing, on the seal: `The pact is signed. The rest is not free.`
- Payoff button: `TAKE IT FROM HERE →` linking to `AMAZON_URL`

Do not invent fiction anywhere. The quoted fragments, opening lines and character copy all come from `teaser.json` and nothing else — the deck above is UI copy, which is yours to set, but the book's own words are not to be rewritten or added to.

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
