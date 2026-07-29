# Foreman

A whole organisation — COO, web developer, sales, marketing, content, finance — running as AI agents on your own machine.

**Design stage. No code yet. Read [PLAN.md](./PLAN.md).**

## Separate from Cubekrafts, on purpose

This folder is self-contained. It has its own `package.json`, its own database, and imports nothing from the Cubekrafts app. It only lives in this repo for convenience during design — `mv foreman/ ~/foreman && git init` and it works unchanged.

It *controls* Cubekrafts from the outside, the way any external operator would:

- reads inquiries over the public API with a read-only token
- edits a local git clone of the site on `foreman/*` branches, never `main`
- proposes; you approve

## Ground rules

- Runs only on your device — `127.0.0.1:7777`, one process, one SQLite file at `~/.foreman/`
- No cloud, no account, no telemetry
- Nothing outbound or irreversible happens without your approval
- Hard daily spend cap on model usage

## Where to start reading

- §3 of the plan — the seven roles and what each owns
- §5 — permissions, the autonomy ladder, and the approvals inbox
- §12 — the build order (Phase 0 is a weekend)
- §14 — the decisions made for you, and the four questions only you can answer
