# Foreman

A whole organisation — COO, web developer, sales, marketing, content, finance — running as AI agents on your own machine.

**Design stage. No code yet. Read [PLAN.md](./PLAN.md).**

## What it is

One local process serving a browser tab at `http://127.0.0.1:7777`, with everything in a SQLite file under `~/.foreman/`. You set goals; a COO agent splits them into work and assigns it to role agents; anything that leaves the building — an email, a published page, a git push, money spent — stops in an approvals queue until you press the button.

No cloud, no account, no telemetry. Data leaves the machine only as model API calls and the specific outbound requests you have allowlisted.

## Two model vendors, one organisation

Roles run on Claude or on ChatGPT, chosen per role from a dropdown. Vendor knowledge lives in two small adapter files behind one narrow interface — the tick loop, the tools, the permission classifier, the transcripts and the audit log know nothing about either company.

That buys three things: per-role cost and quality tuning, failover when one vendor is down or declines a request, and a **second reader** — high-stakes work such as a code diff or a pricing page gets an independent review from the *other* vendor's model before it reaches you. Two models from different labs fail differently, which is what catches confident-and-wrong output that a self-review will not.

## Its relationship to Cubekrafts

Foreman is a standalone app. It shares no code with the Cubekrafts site or API, and this repository depends on nothing in that one.

It *controls* Cubekrafts from the outside, the way an external contractor would:

- reads inquiries over the public API with a read-only token
- edits a local git clone of the site on `foreman/*` branches, never `main`, and never deploys
- proposes; you approve

## Ground rules

- Runs only on your device — one process, one SQLite file
- Single user, no auth server, no multi-tenancy anywhere in the schema
- Every tool call is classified `safe` / `guarded` / `forbidden` by the runtime before it executes
- Hard daily cap on model spend, across both vendors combined, that stops the loop rather than warning you
- No vendor names anywhere above the two provider adapters

## Where to start reading

| Section | What's in it |
|---|---|
| §3 | The seven roles and what each one owns |
| §5 | Permissions, the autonomy ladder, and the approvals inbox |
| §10 | The provider layer — one interface, two adapters, and what each has to normalise |
| §11 | What it costs, including second-reader and A/B overhead |
| §13 | Build order — phase 0 is a weekend, the second vendor lands in phase 2 |
| §15 | Decisions made in advance, and the six questions that need you |

## Status

Nothing is built. The next step is phase 0: the provider interface with one adapter behind it, our own agent loop, the tool effect classifier, the audit log, the approvals inbox, and one role writing blog posts.
