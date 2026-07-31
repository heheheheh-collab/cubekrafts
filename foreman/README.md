# Foreman

A whole organisation — COO, web developer, sales, marketing, content, finance — running as AI agents at a URL you sign into.

**Design stage. No code yet. Read [PLAN.md](./PLAN.md).**

## What it is

One always-on service and one Postgres database, reachable at a link from your laptop or your phone. You set goals; a COO agent splits them into work and assigns it to role agents; anything that leaves the building — an email, a published page, a git push, money spent — stops in an approvals queue until you press the button.

Because it's hosted rather than local, it keeps working overnight. The standup is written before you wake up and the approvals queue is waiting.

Claude only. `claude-opus-5` for planning and code, `claude-sonnet-5` for writing, `claude-haiku-4-5` for triage and recurring numbers.

## Its relationship to Cubekrafts

Foreman is a standalone app. It shares no code with the Cubekrafts site or API, and this repository depends on nothing in that one.

It *controls* Cubekrafts from the outside, the way an external contractor would:

- reads inquiries over the public API with a read-only token
- edits a checkout of the site on `foreman/*` branches and opens pull requests, never pushing to `main`
- proposes; you approve

## Ground rules

- **One account, ever.** No signup, no invites. Passkey sign-in, one allowed identity, sessions you can revoke from your phone.
- **Being behind a login is one layer of four.** The approvals queue, the tool classifier, and branch protection on `main` each hold on their own.
- Every tool call is classified `safe` / `guarded` / `forbidden` by the runtime before it executes
- Outbound traffic goes to an allowlist of four hosts and nowhere else
- Hard daily cap on model spend that stops the loop rather than warning you
- One export endpoint gives you the database, every artifact, and all your charters in a single archive

## Where to start reading

| Section | What's in it |
|---|---|
| §3 | Where it runs — hosting, the address, secrets, backups |
| §4 | Who can get in — passkeys, sessions, and why the login isn't the security model |
| §5 | The seven roles and what each one owns |
| §7 | Permissions, the autonomy ladder, and the approvals inbox |
| §12 | Models, prompt-cache layout, and the cost envelope |
| §14 | Build order — phase 0 is a weekend, and auth lands before the second role |
| §16 | Decisions made in advance, and the six questions that need you |

## Cost

$5–10/month hosting, plus $45–90/month of model spend at normal load. Both capped.

## Status

Nothing is built. Phase 0 is the tick loop, the tool effect classifier, the audit log, the approvals inbox, and one role writing blog posts — on localhost, with no deployment until phase 1 adds authentication.
