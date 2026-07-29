# Foreman

A whole organisation — COO, web developer, sales, marketing, content, finance — running as AI agents on your own machine.

**Design stage. No code yet. Read [PLAN.md](./PLAN.md).**

## What it is

One local process serving a browser tab at `http://127.0.0.1:7777`, with everything in a SQLite file under `~/.foreman/`. You set goals; a COO agent splits them into work and assigns it to role agents; anything that leaves the building — an email, a published page, a git push, money spent — stops in an approvals queue until you press the button.

No cloud, no account, no telemetry. Data leaves the machine only as Claude API calls and the specific outbound requests you have allowlisted.

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
- Hard daily cap on model spend that stops the loop rather than warning you

## Where to start reading

| Section | What's in it |
|---|---|
| §3 | The seven roles and what each one owns |
| §5 | Permissions, the autonomy ladder, and the approvals inbox |
| §10 | Model routing, prompt-cache layout, and the cost envelope |
| §11 | Build order — phase 0 is a weekend |
| §13 | Decisions made in advance, and the four questions that need you |

## Status

Nothing is built. The next step is phase 0: the tick loop, the tool effect classifier, the audit log, the approvals inbox, and one role writing blog posts.
