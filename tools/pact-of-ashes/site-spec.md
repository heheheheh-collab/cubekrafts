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

## Design language

Ash, ember, candlelight, dried blood. A burnt page held up to a candle.

- Semantic HSL design tokens only — no hardcoded colours in components.
- Base: near-black charcoal, warm smoke greys, bone/parchment foreground.
- Two accents with fixed meaning: **ember** (orange-gold) = interaction and life;
  **oxblood** (deep crimson) = death, the Devil, irreversible things.
- Type: Cormorant Garamond display serif for titles; Inter, tracked wide and
  uppercase, for UI labels.
- Texture always: film grain + vignette. Never a flat background.
- Motion: slow and weighted, never bouncy. `prefers-reduced-motion` disables
  particles and long transitions without ever hiding content.

## Pages

### 1. The Pact — `/`
Cinematic opening: title settling out of smoke over a drifting ash field, ember glow
breathing behind it. The hook is the book's own invitation; beneath it, the author's
driving question. Three figures count up on scroll — 77 chapters, 60,534 words, one
pact. A single primary CTA, **"Make the Pact"**; there is no "read now" anywhere on
the site. Below, curated fragments drift up and fade like smoke, never more than two
on screen, so they read as overheard rather than excerpted.

### 2. First Lines — `/first-lines`
The centrepiece, and the strongest argument the site can make. All 78 opening
sentences in order, each alone in the dark with its chapter number beside it. A line
ignites as it enters the viewport, then dims to smoke as it leaves; only the two or
three nearest centre are fully lit, so the page reads like embers in a dark room.
Hovering reveals that section's word count — the size of what's being withheld.
Ends on *"Seventy-seven beginnings. No endings."*

Every line is a hook and none of them give anything away.

### 3. The Ledger — `/ledger`
The Council's names on ruled parchment — aged paper, faint blue rules, red margin
line, ink bled slightly into the grain. Hovering an entry darkens the ink and starts
drawing a strikethrough across the name, which **stops halfway and retreats**. It is
never completed. Footer, in the same hand: *"Some names are underlined. Some are
crossed out. You do not get to know which."*

### 4. Dossiers — `/dossiers`
Twelve case files — Kate, Kael, the Devil, Varos, Marcus Hale, Jackson, the hunters
(Kraye, Sable, Icarus) and the Council (the Judge, the silver-haired woman, the
gray-suited man). Each carries a name, role, one real quoted line, a brief, and an
oxblood **REDACTED** bar naming what it withholds. Hovering doesn't reveal it; the
bar flickers, strains and holds. Unrevealable by construction.

### 5. The Descent — `/descent`
The `descent` index across all 78 sections as a single ember ridgeline against black —
the tonal arc as a landscape you can see but not enter. Scrubbing moves a candle-flame
cursor and surfaces the nearest section's number and opening line. Caption: *"The
shape of a descent, with the words removed."*

## Conversion

The pact is the only thing the site asks for and the only door out of it.

**"Make the Pact"** takes a name and an email, stored in the project database (email
unique; re-signing updates rather than duplicates). On confirm, an ink-bleed sweep
resolves into a wax seal with the signer's name burned into it, and the payoff appears:

> "The pact is signed. The rest is not free."
> **Take it from here →** *(Amazon listing)*

The store URL lives in one constant, `src/config/book.ts` → `AMAZON_URL`, so it swaps
in a single place. While empty it renders as a quiet disabled "Listing coming" state —
never a dead href. Signed readers are remembered in localStorage; their seal sits in
the header and carries the CTA site-wide.

## Non-negotiables

- Nothing readable. If a page feels like it's giving the story away, it's wrong.
- No fabricated prose in the author's voice, ever.
- The author's chapter numbering is preserved (54, 66 and 78 are absent by design).
- Fully responsive; the atmosphere must survive mobile.
