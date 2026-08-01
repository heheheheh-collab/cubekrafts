# The Pact of Ashes — manuscript pipeline & site spec

Tooling that turns the Apple Pages manuscript of *The Pact of Ashes* into structured
JSON, plus the build spec for the interactive reading site generated from it.

The website itself is built and hosted on Lovable — this directory holds the
source data and the extraction code, so the dataset can be regenerated if the
manuscript changes.

## Pipeline

`.pages` files are ZIP archives whose payload lives in `Index/*.iwa` — Snappy-framed
protobuf. There is no off-the-shelf reader, so the extraction is done in stages:

| Step | Script | What it does |
| --- | --- | --- |
| 1 | `iwa.py` | Decompresses `Index/Document.iwa` (custom Snappy framing, implemented from scratch — no native deps) |
| 2 | `extract.py` | Pulls contiguous UTF-8 prose runs out of the decompressed protobuf blob |
| 3 | `build.py` | Splits the prose on heading lines into ordered sections |
| 4 | `dataset.py` | Normalises smart quotes/whitespace, tags each section's kind and number |
| 5 | `enrich.py` | Adds a per-section opening-line epigraph and a 0–100 tonal "descent" index |
| 6 | `teaser.py` | Strips every paragraph out, leaving only what the website is allowed to show |

Run them in order from a directory containing the extracted `.pages` archive:

```bash
unzip -q The_Pact_of_Ashes.pages -d pages
python3 iwa.py pages/Index/Document.iwa doc.bin
python3 extract.py     # -> raw_text.txt
python3 build.py       # -> sections.json
python3 dataset.py     # -> novel.json
python3 enrich.py      # -> novel.json (enriched)
python3 teaser.py      # -> teaser.json (what the site actually ships)
```

## Two datasets

`novel.json` holds the full manuscript. **It is deliberately not committed** — see
`.gitignore`. Regenerate it locally from the `.pages` source when needed. The site
does not use it and must never serve it.

`data/teaser.json` is the only dataset the website consumes. `teaser.py` builds it by
discarding every paragraph, leaving:

- each section's **opening line only**, plus its word count and descent value
- a short list of curated one-line fragments
- character and ledger entries written as teaser copy, with fates withheld

21 KB instead of 368 KB. The prose is absent from the payload, which is what makes
the site's redactions real rather than a CSS trick a reader could defeat.

### Full-manuscript shape (`novel.json`, generated locally)

An array of 80 sections in reading order.

```jsonc
{
  "kind": "chapter",        // preface | acknowledgment | prologue | chapter | epilogue
  "number": 1,              // null for front/back matter
  "title": "Chapter 1",
  "paragraphs": ["...", "..."],
  "words": 843,
  "epigraph": "The world looked the same, yet nothing felt familiar.",
  "descent": 41,            // 0-100 tonal darkness, derived from lexical signal
  "id": "chapter-1"
}
```

Totals: 80 sections, 77 chapters, 60,534 words.

**Numbering:** chapters 54, 66 and 78 do not exist in the manuscript — the author
skipped those numbers. The dataset preserves the original numbering; consumers must
not renumber or assume a contiguous 1..79 range.

**`descent`** is derived, not authorial: a per-1000-word ratio of dark lexical
signal (blood, ash, silence, knife, devil…) against warm signal (laughter, sun,
warmth, home…), normalised across the book. It drives the Descent graph on the
site and is a reading aid, not a claim about the text.

## The book

A revenge novel. Kate, an assassin, is tortured to death in a dungeon and made to
watch her brother Kael die first. She takes her own life — and something answers
in the dark wearing Kael's face and voice, sending her back with one instruction:
*don't forget, don't forgive, kill.* She climbs a ladder of bodies (Varos, Marcus
Hale, the hunters Kraye/Sable/Icarus) to the Council that ordered it — the Judge
with her pearls, the silver-haired woman with her mirrors, and the gray-suited man
whose ledger turns out to be scripture. The question the book closes on is not
whether she wins, but whether anything of Kate survived the climb.

## Site

Built on Lovable from `data/novel.json`, served at `public/novel.json` and loaded
at runtime. See `site-spec.md` for the full feature brief.
