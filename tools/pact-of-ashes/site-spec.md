# The Pact of Ashes — interactive site spec

Build brief for the Lovable project.

**The site does not let anyone read the novel.** Not a sample, not a free chapter, not
one paragraph. Its only job is to make a visitor want the book badly enough to buy it.

Everything is driven by `data/teaser.json` (served as `public/teaser.json`), which
contains no prose bodies at all — only each section's opening line, a handful of
one-line fragments, and character/ledger copy with fates withheld. The full manuscript
never reaches a browser. That absence is the architecture, not a policy layered on top
of it: the redactions can't be defeated in devtools because the redacted content was
never sent.

No invented prose anywhere. UI copy is written freely; fiction comes only from
`teaser.json`.

## Book

**The Pact of Ashes** by **Tarun Mittal**. 77 chapters, 60,534 words.
Store listing: <https://amzn.in/d/0eLYvHUv> — held in one constant,
`src/config/book.ts` → `AMAZON_URL`.

## Design language

**The cover is the design system.** See `cover.jpg`. It is a movie poster, not a
literary jacket: molten, heavy, saturated. A colossal cracked stone hand, palm up,
glowing orange through its fissures; a woman burning in the palm, dissolving upward
into embers; charred ground flecked with live coals; grey smoke plumes; dark ivy
framing the corners. Everything on the site should feel lit from inside by
something molten.

An earlier iteration used muted ash-grey and a fine Cormorant Garamond serif. That
was elegant and wrong — it read as a different book. Hotter and heavier is correct
for colour and texture.

**Typography is the deliberate exception: loud art, quiet type.** The cover carries
the volume; the type gets out of its way. Two passes both failed by reaching for the
genre shelf — Cormorant Garamond is the stock "literary" choice, and heavy condensed
caps (Anton, Oswald, Bebas Neue) is the stock "dark thriller poster" choice. Both
read as generic. All-caps condensed in particular is what you reach for when the
design isn't carrying itself, and this is a book about someone being quietly
hollowed out — the horror is intimate, not loud.

Banned outright, including as near-substitutes: Anton, Oswald, Bebas Neue, Archivo
Black, Cinzel, Playfair Display, Cormorant Garamond, any condensed face, all-caps
headings, and heavy weights used for emphasis. A heading that needs presence gets
more size or more space — never more weight. No effects on type at all: no glow,
text-shadow, gradient fill, distressed letterforms or per-letter animation. The
molten treatment belongs to backgrounds, dividers and art, never to letters.
Uppercase appears in exactly one place: the small tracked mono label style.

- Semantic HSL design tokens only — no hardcoded colours in components.
- `--void` charred near-black · `--magma` molten orange-red, the primary accent,
  and it should genuinely glow · `--blood` the deep crimson of the hand ·
  `--gold` the author-name gold, reserved for the highest-value elements only
  (the Amazon CTA, the pact seal) · `--bone` dirty off-white body text ·
  `--smoke` plume grey for muted text and rules.
- Type: **Spectral** throughout, set like a literary press — large headings,
  generous leading, real margins, mixed case. **IBM Plex Mono**, small and tracked,
  for labels, chapter numbers and word counts; that clerical note is the one
  flourish, and it echoes the ledger the book turns on.
- Texture: **glowing cracks through dark stone** is the structural motif. Section
  dividers are lava fissures, not hairline rules; panel borders look like cracks in
  charred rock lit faintly from within. Grain and deep vignette throughout, drifting
  smoke, rising ember flecks. Never a flat background.

## Voice

**The site's own voice nearly disappears.** Label things plainly and let the book's
real sentences carry the persuasion.

Two earlier passes both failed. The first was restrained but literary in a generic
way. The second over-corrected into poster copy and leant on a single rhetorical
move — state a number, then withhold something (*"Seventy-eight openings. Every door
locked."* / *"Twelve files. Every ending redacted."* / *"Ten lines got out. The rest
is still burning."*). Eight variations on one formula reads as a copywriter
performing, and several strings taunted the visitor outright (`SEE WHAT YOU CAN'T
HAVE`, `IT DOESN'T OPEN`, `SIGN IN ASH`), which is adversarial rather than
seductive.

The deeper fault: that copy competed with the author's prose and lost. The opening
lines in `teaser.json` are the best writing available anywhere on the site —
*"The gray-suited man lived in ledgers."* — and our own clever lines were sitting in
front of them.

So: no taunting, no withholding jokes, no parallel constructions, no scarcity
language, no line that draws attention to its own cleverness. Plain, quiet,
confident — the same register as the typography. **If a string could appear on a
poster, rewrite it.** Where a page needs a line with weight, use the author's, not
ours: `The gray-suited man lived in ledgers.` heads the Ledger; the preface
invitation carries the landing page and the pact dialog.

Silence beats commentary. The redacted bars simply do not open — no caption
explaining that they don't.

The full string-by-string deck lives in `lovable-prompt.md`.

One hard rule: UI copy is ours to write, the book's words are not. Every quoted
fragment, opening line and character line comes from `teaser.json` verbatim. Never
add to it, never rewrite it, never invent a line in the author's voice — including
to fill an empty-looking section.

## Motion

It should feel like smoke and lava — continuous, heavy, liquid. Nothing jumps,
snaps, flickers or stutters.

- **No flicker effects.** Opacity jitter reads as broken, not atmospheric. Glow
  breathes on a long slow sine.
- Animate `transform` and `opacity` only; `will-change` on animated layers. Never
  animate layout properties or filters on scroll.
- Durations 600–1200ms on a smooth ease-out. Nothing linear, bouncy, or under 300ms.
- Scroll animation is **continuous, not triggered** — driven by scroll progress and
  distance from viewport centre, so elements ease through rather than snapping on at
  a threshold.
- One shared `requestAnimationFrame` loop with throttled scroll reads. Competing
  loops and unthrottled scroll handlers are the usual cause of stutter. Cap particle
  count; pause when the tab is hidden.
- No layout shift: reserve space for the cover and anything else that loads in.
- `prefers-reduced-motion` disables particles and scroll animation without ever
  hiding content.

## Pages

### 1. The Pact — `/`
Cinematic opening built around the cover art itself, with the page's molten
atmosphere continuing out of its edges so cover and site read as one surface.
The cover already carries a loud title treatment, so the page's own title sits
quietly beside it in Spectral, with the author's name in a small gold mono label
above — never a restatement of the cover's lettering at the cover's volume.

The hook is the book's own invitation, given room as the emotional centre of the
page; beneath it, the author's driving question, attributed and left without
commentary. Two figures only — 77 chapters, 60,534 words. A single primary CTA,
**"Make the Pact"**; there is no "read now" anywhere on the site. Below, curated
fragments drift up and fade like smoke, never more than two on screen, so they read
as overheard rather than excerpted.

### 2. First Lines — `/first-lines`
The centrepiece, and the strongest argument the site can make. All 78 opening
sentences in order, each alone in the dark with its chapter number beside it. A line
ignites as it enters the viewport, then dims to smoke as it leaves; only the two or
three nearest centre are fully lit, so the page reads like embers in a dark room.
Hovering reveals that section's word count — the size of what's being withheld.
Closes plainly: *"The rest of each chapter is in the book."*

Every line is a hook and none of them give anything away.

### 3. The Ledger — `/ledger`
The Council's names on ruled parchment — aged paper, faint blue rules, red margin
line, ink bled slightly into the grain. Hovering an entry darkens the ink and starts
drawing a strikethrough across the name, which **stops halfway and retreats**. It is
never completed. Footer: *"Their fates are in the book."*

### 4. Dossiers — `/dossiers`
Twelve case files — Kate, Kael, the Devil, Varos, Marcus Hale, Jackson, the hunters
(Kraye, Sable, Icarus) and the Council (the Judge, the silver-haired woman, the
gray-suited man). Each carries a name, role, one real quoted line, a brief, and an
oxblood **REDACTED** bar naming what it withholds. It simply does not open, with no
caption explaining that it doesn't. Unrevealable by construction.

### 5. The Descent — `/descent`
The `descent` index across all 78 sections as a single ember ridgeline against black —
the tonal arc as a landscape you can see but not enter. Scrubbing moves a candle-flame
cursor and surfaces the nearest section's number and opening line. Caption: *"The
shape of a descent, with the words removed."*

## Conversion

The pact is the only thing the site asks for and the only door out of it.

**"Make the Pact"** takes a name and an email, stored in the project database (email
unique; re-signing updates rather than duplicates). The dialog carries the author's
own line — *"It will start when you say yes."* On confirm, an ink-bleed sweep
resolves into a wax seal with the signer's name burned into it, and the payoff
appears, stated plainly rather than sold:

> Signed.
> **FIND IT ON AMAZON**

The store URL lives in one constant, `src/config/book.ts` → `AMAZON_URL`
(<https://amzn.in/d/0eLYvHUv>), so it swaps in a single place. If ever empty it
renders as a quiet disabled "Listing coming" state — never a dead href. Signed
readers are remembered in localStorage; their seal sits in the header and carries
the CTA site-wide.

## Non-negotiables

- Nothing readable. If a page feels like it's giving the story away, it's wrong.
- No fabricated prose in the author's voice, ever.
- The author's chapter numbering is preserved (54, 66 and 78 are absent by design).
- Fully responsive; the atmosphere must survive mobile.
