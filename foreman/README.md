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

## Talking to it

The front door is a conversation, not a dashboard. You ask, it answers — recognised questions in under 100ms straight from a live snapshot with no model call, everything else streaming a first token inside 400ms. You can interrupt a running agent mid-sentence, steer it without restarting it, and dispatch work by saying what you want. Voice runs in the browser, so no audio leaves the device.

The thing you talk to is deliberately not the thing that does the work: a fast concierge owns the conversation and can read anything, while the COO and the six roles do the slow, careful part. That split is what buys both responsiveness and rigour.

## Ground rules

- **One account, ever.** No signup, no invites. Passkey sign-in, one allowed identity, sessions you can revoke from your phone.
- **Email goes out for real, as you, after you have read it.** The approved message is frozen and sent verbatim, and the send tool can never be promoted to run unattended.
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
| §10 | Sending email — the freeze rule, deliverability, suppression, and consent |
| §13 | Talking to it — the concierge, latency budget, voice, interruption, proactivity |
| §14 | Models, prompt-cache layout, and the cost envelope |
| §16 | Build order — phase 0 is a weekend, and auth lands before the second role |
| §18 | Decisions made in advance, and the seven questions that need you |

## Cost

$5–10/month hosting, plus $45–90/month of model spend at normal load. Both capped. The email provider is free at these volumes.

## Status

Nothing is built. Phase 0 is the tick loop, the tool effect classifier, the audit log, the approvals inbox, and one role writing blog posts — on localhost, with no deployment until phase 1 adds authentication.
