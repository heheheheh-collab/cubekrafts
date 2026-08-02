# Foreman

A whole organisation — COO, web developer, sales, marketing, content, finance — running as AI agents at a URL you sign into.

**Built. 445 tests, typecheck clean. Read [PLAN.md](./PLAN.md) for the design.**

## What it is

One always-on service and one Postgres database, reachable at a link from your laptop or your phone. You set goals; a COO agent splits them into work and assigns it to role agents; anything that leaves the building — an email, a published page, a git push, money spent — stops in an approvals queue until you press the button.

Because it's hosted rather than local, it keeps working overnight. The standup is written before you wake up and the approvals queue is waiting.

Claude only. `claude-opus-5` for planning and code, `claude-sonnet-5` for writing, `claude-haiku-4-5` for the conversation.

## Its relationship to Cubekrafts

Foreman is a standalone app. It shares no code with the Cubekrafts site or API, and this repository depends on nothing in that one.

It *controls* Cubekrafts from the outside, the way an external contractor would:

- reads quote requests out of the Supabase behind the Lovable project (QuoteCraft Pro)
- edits a checkout of the site on `foreman/*` branches and opens pull requests, never pushing to `main` — branches are cut from the base as the remote has it, because Lovable pushes there too
- proposes; you approve

## Talking to it

The front door is a conversation, not a dashboard. Recognised questions are answered in under 100ms straight from a live snapshot with no model call; everything else goes to the concierge on Haiku, which can read anything and dispatch work but cannot reach outside the building. Voice runs in the browser, so no audio leaves the device.

The thing you talk to is deliberately not the thing that does the work. That split is what buys both responsiveness and rigour.

## Ground rules

- **One account, ever.** No signup, no invites. Passkey sign-in, one allowed identity, sessions you can revoke from your phone.
- **Email goes out for real, as you, after you have read it.** The approved message is frozen by a database constraint and sent verbatim, and the send tool can never be promoted to run unattended.
- **Being behind a login is one layer of four.** The approvals queue, the tool classifier, and branch protection on `main` each hold on their own.
- Every tool call is classified `safe` / `guarded` / `forbidden` by the runtime before it executes
- Outbound traffic goes to an allowlist and nowhere else
- Hard daily cap on model spend that stops the loop rather than warning you
- One export endpoint gives you the database, every artifact, and all your charters in a single file

## Status

Every phase in §16 of the plan is built.

| Phase | What landed | Where |
|---|---|---|
| 0 | Classifier, agent loop, approvals with resume, tick scheduler, HTTP + SSE, concierge fast path | `src/tools/`, `src/agents/`, `src/scheduler/`, `src/server/` |
| 1 | Passkeys, sessions, recovery code, rate limiting, security headers, origin check | `src/auth/`, `src/server/security.ts` |
| 1 | The front end: one conversation surface, no build step | `web/` |
| 2 | COO, work graph, supervision passes, concierge model path | `src/scheduler/supervise.ts`, `src/concierge/ask.ts` |
| 3 | Email: freeze, suppression, caps, idempotency, bounces | `src/email/` |
| 4 | Developer on a real git checkout, pull requests | `src/tools/workspace.ts` |
| 5 | Standup, export archive, charters that learn from rejections | `src/scheduler/standup.ts`, `src/server/export.ts`, `src/agents/learned.ts` |

The success condition is exercised end to end by `test/e2e.test.ts`, through the real HTTP surface and behind the real authentication gate: you post a goal and a task, the Content agent writes a draft to disk and records an artifact, it stops at a guarded publish, the approvals queue shows it with a reason, you approve, the run resumes from where it stopped and finishes, and every step is in the audit log.

Claude is scripted in the tests — the point is the machinery around the model — but the database is real Postgres (PGlite), the files are real files, the HTTP is real HTTP, and git is a real repository.

## Running it

```bash
./start-local.sh
```

It checks Node, starts Postgres, creates the database, installs, asks for your
API key without echoing it or writing it anywhere, and starts on
http://localhost:7777. Re-running skips whatever is already done. Read it
first — it is forty lines and everything it does is reversible.

Already have a database somewhere? `export DATABASE_URL=…` first and it will
skip the Postgres part entirely.

Or by hand:

```bash
npm install
createdb foreman
export DATABASE_URL=postgres://localhost/foreman
export ANTHROPIC_API_KEY=sk-ant-...
export TICK_MS=60000          # a minute, rather than the ten a server wants
npm start                     # http://127.0.0.1:7777
```

Open it, register a passkey, and **write down the recovery code** — it is shown once.

Booting prints exactly what is and is not connected, so you never have to guess:

```
applied 4 migration(s): 001_init.sql, 002_auth.sql, 003_supervision.sql, 004_email.sql
anthropic key: present
checkout: none at ~/.foreman/checkout — the developer cannot work until one exists
email transport: recording (nothing will actually be sent)
cubekrafts: not connected — sales has nothing to reply to
origin: http://localhost:7777 (relying party localhost)
foreman listening on http://127.0.0.1:7777
staff: coo, content, sales, developer
```

```bash
npm test          # 445 tests
npm run typecheck
```

## Deploying

`fly.toml` and the `Dockerfile` are ready; the commands are in the header of `fly.toml`. One machine, never scaled to zero, because a machine that stopped cannot tick at 3am. Budget roughly $5–10/month for the machine and volume, separate from model spend.

You do not need Fly's own Postgres — a free Neon or Supabase database works, and Foreman only wants a `DATABASE_URL`. If you use Supabase, make it a **new** project rather than the one behind QuoteCraft Pro.

**Try it locally first.** `npm start` works with nothing but a database and an API key, and twenty minutes with it is a better basis for opening a hosting account than a README is. What localhost cannot do is the point of hosting it: work overnight, and be there on your phone.

**The address is free and needs no domain**: `https://cubekrafts-foreman.fly.dev`, with a real certificate, already set as `FOREMAN_ORIGIN`. That is a proper domain for our purposes rather than a shared one — `fly.dev` is on the [Public Suffix List](https://publicsuffix.org/), so the subdomain is its own registrable domain. Cookies cannot be read by another Fly app, and WebAuthn accepts it as a relying party ID, so passkeys work on it exactly as they would on a domain you bought.

Point a domain of your own at it later by changing `app` and `FOREMAN_ORIGIN` together. A passkey is bound to the origin it was registered on, so you will register it once more after the move — everything else carries over.

## What it still needs from you

Foreman runs without any of these — it just does less. Each one turns something on:

| To turn on | Set | Costs |
|---|---|---|
| A public address, and passkeys on it | nothing — `fly.dev` is free and already configured | — |
| Email that is actually delivered | `RESEND_API_KEY`, `EMAIL_FROM=Cubekrafts <info@cubekrafts.com>`, and two DNS records at GoDaddy | — you already own the domain |
| Bounce and complaint handling | `EMAIL_WEBHOOK_SECRET`, pointed at `/api/webhooks/email` | — |
| The developer opening pull requests | **the Lovable project connected to GitHub**, then `GITHUB_TOKEN`, `GITHUB_REPO`, a checkout at `FOREMAN_CHECKOUT`, branch protection on `main` | — |
| Sales having anything to reply to | **a decision first — see below** | — |

Nothing in that table costs money — `cubekrafts.com` is already yours, which is what email needs.

### Which people Sales may write to

QuoteCraft Pro is a multi-tenant lead-allocation marketplace for Indian modular kitchen dealers, not a contact form. Two things follow from its schema:

- It was **phone-only** until an optional `email` column was added to `leads` and `unrouted_requests`. Every existing row has a null there, so Sales has nothing to write to until new requests come in with an address. That is expected, not a misconfiguration.
- **`leads.owner_id` points at a dealer.** Those people contacted a dealer through the platform, not Cubekrafts, and writing to them would be contacting another business's customers. **`unrouted_requests`** — requests never allocated to any dealer — reached nobody, so they are the ones Cubekrafts should follow up. That is what `CUBEKRAFTS_INQUIRY_TABLE` points at.

Row level security is on for those tables with policies attached, so the anon key needs a policy granting it `SELECT` on `unrouted_requests` or it reads nothing.

`cubekrafts.com` serves this same Lovable project, so the public form at `/get-quotes` is the one that now carries the optional email field. There is no second form to update.

### Before any email: the SPF record

`cubekrafts.com` currently publishes `v=spf1 include:secureserver.net -all`. The `-all` is a hard fail: anything not in that list is explicitly disavowed by your own DNS, so mail sent through a new provider is rejected or junked with no bounce at the API to tell you. The existing GoDaddy mailbox on `info@` keeps working either way; the new sender has to be added alongside it.

Foreman checks this at boot and on the Email card rather than letting you discover it from customers who never replied. Set `EMAIL_SPF_INCLUDE` to whatever include your provider asks for and it verifies the record actually contains it, flags a missing DKIM key, and reports the DMARC policy. `looksSendable: false` means do not send yet.

Without a checkout the git tools refuse plainly. Nothing pretends.

## Cost

$5–10/month hosting, plus $45–90/month of model spend at normal load. Both capped.
