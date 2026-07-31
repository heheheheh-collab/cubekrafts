# Foreman — a whole organisation, at a URL

**Status:** design, not built. Nothing here ships yet.
**Working name:** Foreman (a foreman runs a crew and reports to the owner). Rename is a find-and-replace.

**Two decisions fixed as of this revision:** Claude only, no second AI vendor. And it runs at a link you can open from anywhere, not on localhost.

---

## 1. What this is

Foreman is **a small company you own, that happens to be software**. You are the founder. Everyone else — the COO, the web developer, sales, marketing, content, finance — is an AI agent with a written job description, a fixed set of tools, and a permission level you set.

You give it goals. The COO breaks them into work, assigns it to the right role, and the roles do the work: sales drafts follow-ups to real inbound leads, content writes the posts, the web developer edits your site on a branch and shows you the diff, marketing plans the campaign, finance tells you what any of it costs. Anything that leaves the building — an email, a published page, a git push, a rupee spent — stops in an approval queue until you press the button.

**It lives at a URL.** One small always-on service, one Postgres database, one address you sign into from your laptop or your phone. It keeps working while you sleep, which is the point: the standup is written before you wake up, and the approvals queue is waiting.

### What it is *not*

- Not part of Cubekrafts. Its own repository, its own database, sharing no code with the Cubekrafts site or API. It talks to Cubekrafts the way an outside contractor would — over the public API with a read-only token, and against a checkout it may only branch from, never push to `main`.
- Not multi-tenant. Exactly one account can ever sign in: yours. There is no signup page, no invite flow, no user table with a `role` column.
- Not a chatbot with a persona menu. The point is the *organisation*: persistent roles, a shared work queue, memory that carries across weeks, and a boss with a veto.

### The one-line test for whether this was worth building

> You open your phone on Monday, read one standup digest, approve four things, reject one with a sentence explaining why — and the company moved a week's worth without you writing anything yourself.

---

## 2. Ground rules

| Rule | Consequence for the design |
|---|---|
| Reachable by link | Real auth, TLS, a session model, and rate limiting are not optional extras. §4 is the whole of it. |
| One account, ever | No signup, no invites, no permissions matrix. One identity in an allowlist; everything else is rejected before it reaches a route. |
| Nothing irreversible without you | Every tool call is classified `safe` / `guarded` / `forbidden` by the runtime before it executes. Guarded means it queues. |
| Defence does not depend on the network | Being behind a login is one layer. The approval gate, the tool classifier, and the branch protection on your repo each hold on their own. |
| Cheap to run | One agent at a time. Cache-friendly context assembly. Model tier per role. A hard daily spend cap that stops the loop, not just warns. |
| It keeps running when you close the laptop | The tick loop is server-side and always on. Runs checkpoint before and after every model call, so a deploy or a crash resumes cleanly rather than half-executing. |
| You can always leave | One endpoint exports everything — database, artifacts, charters — as a single archive. No lock-in to the host or to me. |

---

## 3. Where it runs

### The shape

**One always-on container plus managed Postgres.** The container serves the UI, the HTTP API, the SSE stream, *and* runs the tick loop in the same process. Postgres holds the work graph and transcripts. A small persistent volume holds the Cubekrafts checkout the developer agent works in. Artifacts go to object storage.

```
    your phone / laptop
            │  HTTPS
            ▼
   ┌──────────────────────┐
   │  foreman.<domain>    │   Cloudflare in front: TLS, WAF, rate limit
   └──────────┬───────────┘
              ▼
   ┌──────────────────────────────────────────┐
   │  one always-on container                 │
   │   ├─ HTTP API + SSE                      │
   │   ├─ tick loop (every 10 min)            │
   │   └─ agent runtime + tool sandbox        │
   └───┬──────────────┬───────────────┬───────┘
       ▼              ▼               ▼
   Postgres      volume:            object store
   (work graph,  cubekrafts          (artifacts,
    transcripts)  checkout            exports)
                                  ┌──────────────┐
       outbound, allowlisted ───► │ Claude API   │
                                  │ Cubekrafts   │
                                  │ GitHub       │
                                  │ SMTP         │
                                  └──────────────┘
```

**Recommended host: Fly.io.** A `shared-cpu-1x` machine with 512 MB, one small volume, in the region nearest you. Managed Postgres from Neon or Supabase on their free tier to start. Roughly **$5–10/month** all in, before model spend. Railway or Render work the same way if you prefer their dashboards.

**Not Vercel for the service itself.** Serverless functions have execution limits and no long-lived process, and an agent run with a dozen tool calls can take minutes. You would end up with Vercel for the UI plus a worker elsewhere plus a cron — three moving parts where one suffices. If you want Vercel for the front end later, the API is already HTTP and CORS is a config line; the loop still needs the always-on worker.

### The address

`foreman.cubekrafts.com` on a domain you already own, behind Cloudflare. A platform-issued `*.fly.dev` hostname works to start, but an unguessable hostname is not a security control — treat it as a convenience only, because §4 is what actually keeps people out.

### Secrets

No OS keychain any more. The Anthropic key, the Cubekrafts read token, the GitHub PAT, and SMTP credentials live in the **host's secret store as environment variables** — never in Postgres, never in a config file in the repo, never in a prompt. The app reads them at boot into memory. Every one is individually rotatable, and the app logs which secrets are present at startup without logging any value.

### Backups, and getting out

Managed Postgres gives you daily automated backups; add a weekly `pg_dump` plus an artifact sync to object storage, retained for 30 days. `GET /api/export` produces one archive with the database, every artifact, and all your charters. Test the restore path once, in the first month, before you have anything you'd miss.

---

## 4. Who can get in

This section exists only because of the URL. On localhost, the answer was "whoever is sitting at the machine". Now it needs a real answer, because the app holds an API key, can push code, and can send email as you.

### Sign-in: a passkey, and one recovery code

**Passkey (WebAuthn) as the only routine method.** Register your phone and your laptop as authenticators on first run. There is no password to phish, no reset flow to social-engineer, and it works well from a phone, which is where you'll approve most things.

One **recovery code**, shown once at setup, hashed at rest, single-use. Regenerated from settings after use. That is the entire account-recovery story, deliberately — every additional recovery path is another way in.

If passkeys turn out to be awkward on a device you care about, the fallback is a **magic link to one hardcoded email address**, with a five-minute expiry and single use. Not a password. Never a password.

### Sessions

- `httpOnly`, `Secure`, `SameSite=Lax` cookie holding an opaque random token; the session record lives in Postgres so you can revoke it.
- 30-day sliding expiry, so your phone stays signed in and this stays pleasant to use.
- A **Sessions** panel in settings listing every active session with device and last-seen, and a **Revoke all** button.
- Re-authentication required for four things regardless of session age: rotating a secret, changing the spend cap, promoting a tool to L3, and exporting the archive.

### Before any of that

- **Exactly one allowed identity.** A hardcoded user ID compared before any route logic runs. There is no code path that creates a second user.
- **Rate limiting** on the auth routes — a few attempts a minute per IP, with a global ceiling so a distributed attempt can't grind away either.
- **Cloudflare Access in front of the whole origin** is worth the twenty minutes it takes: the app is never reachable raw, and you get a second independent gate that isn't code you wrote.
- **Security headers**: HSTS, a strict CSP, no framing, no referrer leakage.
- **An auth log** — every sign-in, every failure, every revocation, with IP and user agent — surfaced on the dashboard, not buried. You should notice a failed attempt without going looking.

### Being behind a login is not the security model

It is one layer of four. The approvals queue means a session hijack still cannot send an email or push code without a human pressing a button. The tool classifier means a compromised prompt cannot reach a tool the role was never granted. **Branch protection on `main` in GitHub** means even a total compromise of the app cannot rewrite your site's main branch — that rule is enforced by GitHub, not by my code, which is exactly why it's worth setting.

Design it so that the worst outcome of someone getting a session is that they read your business data and queue some approvals you then reject.

---

## 5. The staff

Every role is a **markdown charter** — stored in Postgres, edited in the app, versioned on every save. Charters are yours to edit; that's the main way you manage these employees.

```markdown
# Sales
## Mission          — one sentence, why this role exists
## Owns             — the decisions this role gets to make alone
## Never            — hard boundaries, stated as absolutes
## Inputs           — where its work comes from
## Deliverables     — what "done" looks like, concretely
## Definition of done — the checklist the COO reviews against
## Escalate when    — the conditions that require the founder
## Voice            — how it writes, with two examples
## Learned          — appended automatically from your rejections
```

### The seven roles

**COO — the only one that plans.**
Converts your goals into initiatives and tasks, assigns them, sequences them, reviews finished work against its definition of done, writes the daily standup, and escalates. It does not do the work itself — it has no tools except the work graph and read access to artifacts. Keeping planning and doing in separate agents is what stops the whole thing collapsing into one confused agent that plans, half-does, and reports success.
*`claude-opus-5`, effort `high`. The most expensive role per token and the cheapest per mistake.*

**Web Developer — ships code, never deploys.**
Works in a checkout on the container's volume. Reads, edits, runs the test/lint/build commands, commits to `foreman/<task-id>`, and opens a pull request. It **cannot** push to `main` — enforced by branch protection on the GitHub side as well as by the tool classifier — cannot run deploy scripts, and cannot touch anything outside the checkout.
*`claude-opus-5`, effort `xhigh`. Agentic coding is where that setting earns its cost.*

**Sales — drafts, never sends.**
Pulls new inquiries from the Cubekrafts API, qualifies each against your ICP, writes the first reply and a two-touch follow-up, maintains a pipeline with stages and next actions. Every outbound message queues with the lead's context beside it. It also keeps a running list of the objections it sees, which is the most valuable thing it produces for marketing.
*`claude-sonnet-5` for drafting, `claude-haiku-4-5` for the qualify pass.*

**Marketing — plans, doesn't publish.**
Channel calendar, campaign briefs, keyword and competitor research via web search on a domain allowlist, landing-page concepts, budget proposals. Output is briefs that Content and the Web Developer execute against. Proposed spend is a guarded action with a number attached.
*`claude-sonnet-5`, effort `high`.*

**Content — writes to brief.**
Turns briefs into posts, case studies, product copy, and social. Reads the brand canon and the last ten approved pieces first, so voice drifts slowly rather than per-piece. Publishing is a separate guarded step.
*`claude-sonnet-5`. This is where token volume concentrates.*

**Finance / Analyst — the one that says no.**
Unit economics, quote and ROI math, weekly numbers, and Foreman's own API spend — including telling you when a role is burning money for no output. Read-only on everything.
*`claude-haiku-4-5` for the recurring numbers, `claude-sonnet-5` for the weekly written analysis.*

**Support (phase 4, optional).**
Post-sale FAQs, order status, warranty questions. Deferred until there's post-sale volume to justify it.

### Why seven

Each role costs you charter-maintenance attention and adds a routing decision for the COO. Seven is about where the COO can still hold the whole org in one context window alongside the work graph. Add an eighth when you can name the work falling between two existing roles.

---

## 6. How work flows

```
        You                    COO                  Role agent            You
         │                      │                        │                 │
    "goal: 20 qualified ───►  splits into                │                 │
     leads by Sept"           initiatives                │                 │
                              + tasks ──────────────► picks up task        │
                                  ▲                      │                 │
                                  │                   builds context       │
                                  │                   calls Claude         │
                                  │                   uses tools           │
                                  │                      │                 │
                                  │                 ┌────┴────┐            │
                                  │            safe tool   guarded tool ──►│ approvals
                                  │             executes      queues       │ inbox
                                  │                 └────┬────┘            │
                                  │                      │                 │
                              reviews ◄──────────── produces artifact      │
                              vs. DoD                                      │
                                  │                                        │
                    ┌─────────────┼─────────────┐                          │
                 accept      send back      escalate ────────────────────► │
                                (max 2)                                    │
```

### The tick

Server-side, every 10 minutes, plus an immediate tick when you press "Run now" or approve something. Because it's hosted, this runs overnight — which is the main practical gain over the localhost design.

```
tick():
  if paused or daily_spend >= cap: return
  task = next ready task           # deps satisfied, role enabled, slot free
  if none: return
  run = start_run(task)            # checkpoint BEFORE the model call
  result = agent_loop(task)
  finish_run(run, result)          # checkpoint AFTER
  if deliverable complete: queue COO review
```

Concurrency defaults to **1**. Two agents in the same checkout is the obvious way to produce garbage, and on a 512 MB machine you gain nothing from parallelism.

### Foreman owns the agent loop

The SDK ships a tool runner that will drive the call-tool-call-again cycle for you. Write the loop instead — it's about thirty lines, and it's where the permission classifier, the budget check, the checkpoint, and the audit write all live:

```
agent_loop(task):
  msgs = build_context(task)
  for step in 1..MAX_STEPS:
    result = call_claude({ msgs, tools, effort, budget })
    audit(result.usage, cost(result.usage))
    if result.stop == 'end_turn':  return result
    if result.stop == 'refusal':   return escalate(result)
    if result.stop == 'max_tokens': return retry_with_more_room(result)
    for call in result.toolCalls:
      cls = classify(role, call)            # safe | guarded | forbidden
      if cls == 'forbidden': abort_run(); return
      if cls == 'guarded':   queue_approval(call); park_run(); return
      msgs += tool_result(call, execute(call))
```

The runner's per-turn hooks could gate tools too, but the classifier is the security boundary of an internet-facing app and it belongs in code you can read top to bottom in one sitting.

### Review, not vibes

When a role marks a task complete, the COO gets the artifact and the definition of done and returns **accept**, **revise** with numbered feedback (max two rounds, then auto-escalate — an agent on its third revision is a task that was specified wrong), or **escalate** to you in one paragraph.

### The second reader

On tasks marked high-stakes — a code diff, a pricing page, anything customer-facing at volume — the artifact also goes to a **fresh-context reviewer** before it reaches you: a separate call, on `claude-opus-5`, that sees only the artifact and the definition of done. Not the author's reasoning, not the transcript. It returns concrete objections or "no objections".

A fresh context catches a real class of error — the confident conclusion that only looks right if you followed the author's reasoning to get there. Be honest about its limit: a same-family reviewer shares the author's blind spots in a way an outside reader wouldn't. It is a good cheap check, not an independent audit.

Default on for diffs and published pages, off for everything else.

---

## 7. Permission and autonomy

### Every tool call is classified before it runs

```ts
type Effect = 'safe' | 'guarded' | 'forbidden'
// safe      — reversible, server-side, invisible outside the system. Executes.
// guarded   — outbound, spends money, or writes to something you own. Queues.
// forbidden — not for this role, ever. Refused, logged, run aborted.
```

Classification is a function of `(role, tool, arguments)` — not just the tool. `git.commit` on a `foreman/*` branch is safe; on `main` it's forbidden. `http.fetch` to an allowlisted domain is safe; anywhere else it's guarded. Enforced in the runtime, because a prompt is a suggestion and a switch statement is not.

### The autonomy ladder

| Level | Behaviour |
|---|---|
| **L0 Propose** | Describes what it would do, never executes. Good for a role's first week. |
| **L1 Approve** | Executes only after you approve, with a full preview. **Default for everything guarded.** |
| **L2 Notify** | Executes immediately; you get a push notification and a one-click undo window. |
| **L3 Auto** | Executes silently, appears only in the audit log. Requires re-authentication to enable. |

Promote a tool to L2 after you've approved ~20 of them without editing. That ratchet is the trust model — not something you configure up front, something the org earns.

Because it's hosted, **L2 and L3 mean things happen while you're not looking.** Keep the dev agent's push and sales' send at L1 indefinitely; they're the two that are hard to walk back.

### The approvals inbox

The most important screen in the app, and the one you'll use most on a phone. Each item shows what will happen rendered as the actual effect — the email as it will send, the diff as it will apply, the ₹ figure as it will be spent — why, in the agent's own words, and what it's attached to. Four actions: **Approve**, **Edit & approve**, **Reject with reason**, **Always allow this**.

**Rejections are training data.** A rejection with a reason is appended to that role's `## Learned` section, so the next context pack includes it. This is the loop that makes month three better than month one, and it costs almost nothing to build.

### Hard guardrails

- **Kill switch** — pauses every agent mid-run, reachable from the phone in two taps.
- **Egress allowlist** — the only outbound hosts are the Claude API, the Cubekrafts API, GitHub, and your SMTP provider. Everything else is refused at the HTTP client, and the attempt is logged.
- **Filesystem jail** — every path resolved and checked against allowed roots before any read or write. Resolve first, then compare, or `../` and symlinks walk straight out.
- **Spend caps**, daily and monthly, that hard-stop the loop, plus a per-run token ceiling.
- **Branch protection on `main`**, set in GitHub, so the strongest rule in the system isn't enforced by my code at all.
- **Append-only audit log** — every tool call with arguments, result hash, timestamp, run ID, model.
- **Secrets never enter a prompt.** Injected by the tool implementation at call time, redacted from logs. An agent never sees a credential, so no prompt injection can leak one.

### Treat inbound content as hostile

Lead messages, fetched pages, and competitor sites are untrusted input, wrapped in a delimiter block labelled explicitly as data rather than instructions. Combined with every consequential action being guarded, an injection attempt in an inquiry form can at worst produce a weird draft you reject.

---

## 8. Memory

**Canon** — brand voice, pricing, product specs, ICP, competitor notes, case studies. Stored as documents you edit in the app, loaded whole into the cached prefix for the roles that need them. The highest-leverage thing you will ever type into this system.

**Working memory** — the task, its artifacts, its run history. Dropped when the task closes.

**Recall** — Postgres full-text search (`tsvector` with a GIN index) over every artifact, run summary, approval decision and rejection reason, retrieved top-k into the context pack. No vector database: at a few thousand documents, Postgres FTS is fast, debuggable, and already running. If recall genuinely disappoints after a few months, `pgvector` is an extension and a column, not a migration.

---

## 9. Tools

| Tool | Given to | Default class |
|---|---|---|
| `fs.read` / `fs.write` / `fs.list` | dev, content (scoped roots) | safe within jail |
| `git.status/diff/branch/commit` | dev | safe on `foreman/*` |
| `git.push` + open PR | dev | **guarded** (forbidden to `main`) |
| `shell.run` (allowlisted commands only) | dev | safe |
| `http.fetch` | marketing, content | safe on allowlist, else guarded |
| `web.search` | marketing, sales, finance | safe |
| `cubekrafts.inquiries.list` | sales, finance | safe (read-only token) |
| `cubekrafts.admin.*` (writes) | — | **forbidden** in v1 |
| `email.draft` | sales | safe |
| `email.send` | sales | **guarded** |
| `artifact.create/update` | all | safe |
| `work.*` (create/assign/update tasks) | COO only | safe |
| `memory.search` | all | safe |
| `ask_founder` | all | safe (parks the task, queues a question) |
| `spend.propose` | marketing | **guarded** |

`ask_founder` matters more in a hosted design than it did on localhost. When the agents run overnight and you aren't there, a first-class way to say "I need a decision" is what stops a role inventing an answer and confidently proceeding for six hours.

Tools are defined in JSON Schema, with `strict: true` so arguments validate exactly. Keep the set small: every tool is a description the model has to interpret correctly, and a tool that gets misused usually has a bad description rather than a bad model.

---

## 10. Data model

Postgres.

```sql
-- identity (exactly one row in "owner", by construction)
owner(id, email, created_at)
credential(id, kind, public_key, sign_count, label, created_at, last_used_at)
recovery_code(hash, used_at)
session(id, token_hash, device, ip, created_at, last_seen_at, revoked_at)
auth_event(id, at, kind, ip, user_agent, ok, detail)

-- org
role(id, name, model, effort, enabled, concurrency, second_reader, created_at)
charter(id, role_id, version, body, created_at)
tool_grant(role_id, tool, autonomy, config_json)

-- work graph
goal(id, title, why, target_date, status)
initiative(id, goal_id, title, owner_role, status)
task(id, initiative_id, title, spec, definition_of_done, owner_role,
     status, priority, due, blocked_by, high_stakes,
     revision_count, created_at, closed_at)

-- execution
run(id, task_id, role_id, model, effort, status, started_at, ended_at,
    input_tokens, cached_input_tokens, output_tokens,
    cost_usd, summary, error)
tool_call(id, run_id, tool, args, effect_class, approved_by,
          result_hash, ok, ms, created_at)
message(id, run_id, seq, role, content)          -- full transcript, for replay

-- outputs & decisions
artifact(id, task_id, kind, title, storage_key, status, version, created_at)
review(id, artifact_id, reviewer, kind, verdict, notes, created_at)
approval(id, run_id, tool_call_id, kind, preview, status,
         decided_at, reason, promoted_to_l2)
question(id, task_id, role_id, text, answer, asked_at, answered_at)

-- business objects (Foreman's own copy — never writes back in v1)
lead(id, source_id, name, email, location, message, stage,
     score, next_action, next_action_at, synced_at)
campaign(id, title, channel, status, budget, brief_artifact_id)
content_piece(id, title, channel, status, artifact_id, published_at)

-- knowledge & ops
canon_doc(id, slug, title, body, updated_at)
memory(id, kind, ref_table, ref_id, text, tsv)   -- GIN index on tsv
audit(id, at, actor, action, subject, detail)
setting(key, value)
spend_day(date, usd, input_tokens, output_tokens)
```

Two details worth defending. `run` splits cached from uncached input tokens and stores `cost_usd` computed at write time — cache-hit rate is what decides whether this costs $15 or $150 a month, and a stored cost is a fact where a recomputed one is a guess. `message` keeps full transcripts so a run can be replayed after you edit a charter, which is how you'll actually debug agent behaviour.

---

## 11. The interface

Eight screens, React + Vite, served by the same service, live over SSE. Built mobile-first, because approvals will mostly happen on a phone.

**HQ** — today's standup in plain English, active tasks, approvals waiting, spend against cap, four KPI tiles.

**The Org** — a card per role: on/off, current task, model and effort, autonomy sliders per tool, cost this week, last five outputs, edit charter.

**Board** — kanban by status, swimlanes by role, filterable by goal.

**Room** — one thread per role; you chat directly, and autonomous runs appear inline with collapsible tool calls.

**Approvals** — the queue from §7. Thumb-sized targets, swipe to approve, keyboard shortcuts on desktop.

**Artifacts** — everything produced, with version history, diffs, and second-reader objections attached.

**Numbers** — pipeline, content shipped, site changes, spend by role and day, cache-hit rate, task cycle time.

**Settings** — passkeys and sessions, spend caps, egress allowlist, secret rotation, the auth log, export, and the kill switch.

Push notifications via the web push API for three things only: an approval that's been waiting an hour, a question from an agent, and the spend cap being hit. Anything more and you'll turn them off.

---

## 12. Models, caching, and cost

### Which model for what

| Use | Model | In / Out per Mtok | Why |
|---|---|---|---|
| COO planning and review, second reader | `claude-opus-5` | $5 / $25 | Judgement-heavy, low volume. Wrong plans are the expensive failure. |
| Web developer | `claude-opus-5` (effort `xhigh`) | $5 / $25 | Agentic coding is its strength; a bad diff costs an hour. |
| Content, marketing, sales drafting | `claude-sonnet-5` | $3 / $15 (intro $2 / $10 through 2026-08-31) | The volume tier — near-Opus writing quality at a fraction of the cost. |
| Lead triage, recurring numbers | `claude-haiku-4-5` | $1 / $5 | High frequency, low judgement. |

Roles reference a **tier** (`top` / `mid` / `cheap`) resolved through one config file that also holds prices. New models ship faster than you'll want to edit code, and a stored price means the cost column is never silently wrong.

### The request shape

```ts
const res = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 16000,
  thinking: { type: 'adaptive' },        // on by default on Opus 5; budget_tokens 400s
  output_config: { effort: 'high' },     // low | medium | high | xhigh | max
  system: [
    { type: 'text', text: TOOL_PREAMBLE },
    { type: 'text', text: charter },
    { type: 'text', text: canon, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ],
  tools,                                  // stable order, deterministic serialisation
  messages,
})
```

Four things that are easy to get wrong and expensive to find later:

- **No `temperature`, `top_p`, or `top_k`** — they return 400 on Opus 5 and Sonnet 5. Steer voice with the charter's `## Voice` section.
- **No `budget_tokens`** — use `output_config.effort`, and sweep `medium`/`high`/`xhigh` per role against your own work before settling. Effort moves cost more than model choice does.
- **Stream anything above ~16k `max_tokens`**, or a long dev-agent turn hits an HTTP timeout.
- **Check `stop_reason` before reading `content`.** A refusal arrives as a normal 200 with possibly-empty content, and `content[0].text` will throw. Enable the server-side fallback so a refusal is retried automatically rather than failing a run.

### Caching is the whole cost story

Caching is a **prefix match**: any byte that changes anywhere in the prefix invalidates everything after it. Render order is `tools` → `system` → `messages`.

- Tool definitions serialised deterministically, sorted by name, never varied per tick.
- Charter and canon next, frozen, with the `cache_control` breakpoint on the last block.
- Task, retrieved memory, date and metrics after the breakpoint.
- **Never interpolate a timestamp, run ID, or `new Date()` into the system prompt.** This is the mistake that produces a bill ten times larger than expected with no other symptom.
- Minimum cacheable prefix is 512 tokens on Opus 5, 1024 on Sonnet 5 — a charter plus canon clears either easily.
- Reads cost ~0.1×, writes 1.25× at the 5-minute TTL and 2× at one hour. With ticks ten minutes apart the short window usually misses, so use the **1-hour TTL** for the COO and any role that ticks all day.
- Mid-run operator context — a new instruction, an approval that just landed — goes in as a `{ role: 'system' }` message appended to `messages`, which is supported on Opus 5 and leaves the cached prefix intact.
- **Log `cache_read_input_tokens` on every run.** Zero across consecutive runs of the same role means something in the prefix is moving. Find it before doing anything else.

### What it costs

A typical role turn: ~15k input (mostly cache reads after the first), ~3k output.

| Scenario | Runs/day | Model spend/day | Model spend/month |
|---|---|---|---|
| Quiet (COO + content) | 8 | $0.30–0.60 | $10–20 |
| Normal (all roles, one goal active) | 25 | $1.50–3 | $45–90 |
| Heavy (dev agent on a real feature) | 40+ | $4–8 | $120–240 |

Plus **$5–10/month hosting**. Add ~10–15% if the second reader is on for diffs and published pages.

Set the daily cap as a hard stop — $5 is a sane start — and set a spend limit in the Anthropic console too. The app's cap protects you from a runaway loop; the console's cap protects you from a bug in the app's cap. That second one matters more now that the loop runs unattended overnight.

For the dev agent's long runs, use a **task budget** (`output_config.task_budget`, beta `task-budgets-2026-03-13`, minimum 20k tokens) so the model paces itself and wraps up gracefully instead of being cut off mid-thought.

---

## 13. HTTP API

```
POST /auth/passkey/register        first-run only, then disabled
POST /auth/passkey/challenge
POST /auth/passkey/verify          → session cookie
POST /auth/recovery                single-use code
POST /auth/logout
GET  /auth/sessions                active sessions
POST /auth/sessions/revoke         one, or all

GET  /api/hq                       dashboard payload
GET  /api/stream                   SSE: runs, approvals, questions, spend

GET  /api/roles                    list with live status
PATCH/api/roles/:id                enable, tier, effort, concurrency
GET  /api/roles/:id/charter        current version
PUT  /api/roles/:id/charter        save (new version)
PATCH/api/roles/:id/grants/:tool   set autonomy (L3 needs re-auth)

POST /api/goals                    create a goal → COO plans it
GET  /api/tasks                    filter by status/role/goal
POST /api/tasks/:id/run            run now
POST /api/tasks/:id/cancel

GET  /api/approvals                pending queue
POST /api/approvals/:id/decide     approve | edit | reject(reason) | always-allow

GET  /api/questions                open questions from agents
POST /api/questions/:id/answer

GET  /api/artifacts                filter by kind/role/task
GET  /api/runs/:id                 transcript + tool calls

GET  /api/canon                    brand voice, pricing, ICP, specs
PUT  /api/canon/:slug

POST /api/control/pause            kill switch
GET  /api/spend                    daily/monthly, by role
POST /api/secrets/:name/rotate     re-auth required
GET  /api/export                   full archive, re-auth required
```

Every route except `/auth/*` requires a valid session. CSRF protection on all state-changing routes.

---

## 14. Build order

**Phase 0 — one agent, end to end, on your machine (a weekend).**
Postgres schema + migrations, the tick loop, our agent loop, the tool runtime with effect classification, the audit log, and one role: Content. Two tools, one guarded action, the approvals inbox, a bare HQ screen. **Run it on localhost for now** — do not deploy anything until phase 1 has auth. Success: you type a goal, an agent writes a post, you approve it, and the whole thing is in the audit log.

**Phase 1 — auth, then the URL.**
Passkey registration and sign-in, sessions, rate limiting, the auth log, security headers, Cloudflare in front. Deploy to Fly with Postgres and the volume. Backups configured and a restore tested. Success: you approve something from your phone, on the train.

**Phase 2 — the org appears.**
COO + the work graph, charters in the app, the review/revise cycle, the standup digest, the Org and Board screens, the autonomy ladder, push notifications. Success: you set one goal and get a sensible plan with tasks you didn't have to write.

**Phase 3 — real business input.**
Sales: read-only inquiry sync, lead scoring, drafted replies, pipeline. Finance: weekly numbers and Foreman's own spend. Success: an inquiry arrives overnight and a good reply is waiting when you wake up.

**Phase 4 — it touches the product.**
Web Developer on the checkout: branch, edit, test, commit, PR, diff preview, guarded push, with branch protection set on the GitHub side. Second reader on diffs. Marketing and the content calendar feeding Content. Success: a real site change ships from a Foreman branch.

**Phase 5 — it gets better on its own.**
Metrics loop, weekly review, charter self-tuning from your approve/reject reasons.

The ordering change from the localhost plan is deliberate: **auth comes before the second role.** An app on the internet that can push code and send email does not get to be half-secured for a few weeks while you add features.

---

## 15. How this fails, and what's in the design about it

| Failure | Mitigation |
|---|---|
| Someone finds the URL | Passkey-only sign-in, one allowed identity, rate limiting, Cloudflare Access in front, security headers, an auth log you actually see. |
| A session is stolen | Nothing outbound happens without an approval press; secrets are never rendered to the client; sessions are individually revocable; re-auth for the four dangerous settings. |
| The host is compromised | Branch protection on `main` is enforced by GitHub, not by us. Cubekrafts access is read-only. Blast radius is business data plus a rotatable set of keys. |
| Runaway spend overnight | Hard daily cap that stops the loop, per-run ceiling, task budgets, a console-side cap as backstop, cache-hit monitoring. |
| Agents produce plausible work nobody uses | Written definition of done before a task can be `ready`; COO reviews against it; Finance reports output per dollar per role. |
| Approval fatigue → rubber-stamping | The L1→L2 ratchet exists so the queue shrinks. Fifty a day in week four means promote tools, not work faster. |
| An agent does something irreversible | Effect classification in our loop, before execution. Dev agent branch-only. No live-site writes in v1. |
| Prompt injection via a lead's message | Untrusted input delimited and labelled as data; every consequential action guarded. |
| Voice drifts into generic slop | Canon in the cached prefix, last-ten-approved pieces in context, rejections appended to the charter. |
| A deploy interrupts a run | Runs checkpoint before and after every model call; an interrupted run resumes or fails cleanly, never half-executes. |
| Context rot on long tasks | Runs checkpointed and summarised rather than accumulated; server-side compaction and context editing for the dev agent's long sessions. |
| You stop using it in week three | Phase 0 must deliver something you'd miss. If the standup isn't worth reading on day five, fix that before building phase 2. |

---

## 16. Decisions made for you

| Decision | Why | The alternative |
|---|---|---|
| One always-on container, not serverless | The tick loop and multi-minute agent runs don't fit a function timeout | Vercel + external worker + cron — three parts where one suffices |
| Postgres, not SQLite | It's hosted now; managed backups and full-text search come with it | SQLite on a volume — fine until the first restore you actually need |
| Passkey, no password | Nothing to phish, no reset flow to attack, pleasant on a phone | Password + TOTP — more code, more ways in |
| We own the agent loop | The classifier is the security boundary of an internet-facing app | The SDK tool runner's hooks — workable, but the boundary lives in someone else's control flow |
| Auth before the second role | An internet-facing app that can push code doesn't get to be half-secured | Ship features first, add auth "soon" |
| Branch protection on `main`, set in GitHub | The strongest rule shouldn't be enforced by my code | Trust the classifier alone |
| Concurrency 1 | Two agents in one checkout is a corruption bug waiting to happen | Higher, once tool sets are provably disjoint |
| Cubekrafts read-only in v1 | The blast radius of a bad write to a live business system isn't worth it in month one | Grant writes per-endpoint later, at L1 |

### Open questions

1. **Which domain?** `foreman.cubekrafts.com`, or something unrelated to the business? A subdomain is simpler; an unrelated domain leaks nothing about what it is.
2. **Which GitHub repo does the dev agent work in**, and which commands may it run — `npm test`, `npm run lint`, `npm run build`?
3. **Email**: real SMTP send-after-approval, or drafts you copy out? Drafts is safer for month one and is a one-line upgrade later.
4. **Read-only Cubekrafts API token**, or a nightly export the app pulls?
5. **Daily spend cap?** ($5 default.)
6. **Region** — nearest you for latency, or nearest the Claude API for throughput? Nearest you; the model call dominates either way.

None of these block Phase 0.

---

## 17. Repo layout

```
  package.json
  PLAN.md
  README.md
  fly.toml                      # host config
  .gitignore
  src/
    server/       index.ts, routes/, sse.ts, middleware/
    auth/         passkey.ts, session.ts, recovery.ts, ratelimit.ts
    db/           migrations/*.sql, schema.ts, queries.ts
    agents/       loop.ts, context.ts, review.ts, second-reader.ts
    claude/       client.ts, catalog.ts     # models, tiers, prices
    tools/        registry.ts, effects.ts, fs.ts, git.ts, http.ts,
                  email.ts, cubekrafts.ts, work.ts, memory.ts
    guards/       jail.ts, allowlist.ts, budget.ts, audit.ts
    scheduler/    tick.ts
    ui/           React app
```

Secrets live in the host's secret store. Artifacts live in object storage. Neither is ever in git.

---

## 18. What I'd build first, given a day

The tick loop, the tool effect classifier, the audit log, and the approvals inbox — one role, two tools, running on localhost with no auth and no deployment.

If a single agent can pick up a task, write something, get stopped at a guarded action, and wait for you, the company works. Then spend the next day on §4, because that's what stands between that working prototype and a URL you can safely give an address to.
