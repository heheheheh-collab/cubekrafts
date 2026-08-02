# Foreman — a whole organisation, at a URL

**Status:** built. Every phase in §16 has landed — 385 tests, typecheck clean, the success condition exercised end to end through the real HTTP surface and behind the real authentication gate. What remains is not code: a domain, an ESP account with SPF and DKIM, a GitHub token, and a Cubekrafts read token. Each turns a piece on; without them Foreman still runs and says plainly what it cannot do. See the README.
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
| Email goes out as you, after you've read it | The approved payload is frozen and sent verbatim, and `email.send` is excluded from autonomy promotion in code. §10. |
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
                                  │ email API    │
                                  └──────────────┘
```

**Recommended host: Fly.io.** A `shared-cpu-1x` machine with 512 MB, one small volume, in the region nearest you. Managed Postgres from Neon or Supabase on their free tier to start. Roughly **$5–10/month** all in, before model spend. Railway or Render work the same way if you prefer their dashboards.

**Not Vercel for the service itself.** Serverless functions have execution limits and no long-lived process, and an agent run with a dozen tool calls can take minutes. You would end up with Vercel for the UI plus a worker elsewhere plus a cron — three moving parts where one suffices. If you want Vercel for the front end later, the API is already HTTP and CORS is a config line; the loop still needs the always-on worker.

### The address

`foreman.cubekrafts.com` on a domain you already own, behind Cloudflare. A platform-issued `*.fly.dev` hostname works to start, but an unguessable hostname is not a security control — treat it as a convenience only, because §4 is what actually keeps people out.

### Secrets

No OS keychain any more. The Anthropic key, the Cubekrafts read token, the GitHub PAT, and the email provider's API key live in the **host's secret store as environment variables** — never in Postgres, never in a config file in the repo, never in a prompt. The app reads them at boot into memory. Every one is individually rotatable, and the app logs which secrets are present at startup without logging any value.

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

**The ratchet has an exclusion list, in code.** `email.send` and `git.push` can never be promoted, by any path, including the "always allow this" button. Those two reach real people and a real repository, and the value of the design rests on a human having read each one.

Because it's hosted, **L2 and L3 mean things happen while you're not looking.** That is exactly why the two hardest actions to walk back are excluded from promotion rather than left to discipline.

### The approvals inbox

The most important screen in the app, and the one you'll use most on a phone. Each item shows what will happen rendered as the actual effect — the email as it will send, the diff as it will apply, the ₹ figure as it will be spent — why, in the agent's own words, and what it's attached to. Four actions: **Approve**, **Edit & approve**, **Reject with reason**, **Always allow this**.

**Rejections are training data.** A rejection with a reason is appended to that role's `## Learned` section, so the next context pack includes it. This is the loop that makes month three better than month one, and it costs almost nothing to build.

### Hard guardrails

- **Kill switch** — pauses every agent mid-run, reachable from the phone in two taps.
- **Egress allowlist** — the only outbound hosts are the Claude API, the Cubekrafts API, GitHub, and your email provider. Everything else is refused at the HTTP client, and the attempt is logged.
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
| `git.push` + open PR | dev | **guarded, permanently L1** (forbidden to `main`) |
| `shell.run` (allowlisted commands only) | dev | safe |
| `http.fetch` | marketing, content | safe on allowlist, else guarded |
| `web.search` | marketing, sales, finance | safe |
| `cubekrafts.inquiries.list` | sales, finance | safe (read-only token) |
| `cubekrafts.admin.*` (writes) | — | **forbidden** in v1 |
| `email.draft` | sales | safe |
| `email.send` | sales | **guarded, permanently L1** — see §10 |
| `artifact.create/update` | all | safe |
| `work.*` (create/assign/update tasks) | COO only | safe |
| `memory.search` | all | safe |
| `ask_founder` | all | safe (parks the task, queues a question) |
| `spend.propose` | marketing | **guarded** |

`ask_founder` matters more in a hosted design than it did on localhost. When the agents run overnight and you aren't there, a first-class way to say "I need a decision" is what stops a role inventing an answer and confidently proceeding for six hours.

Tools are defined in JSON Schema, with `strict: true` so arguments validate exactly. Keep the set small: every tool is a description the model has to interpret correctly, and a tool that gets misused usually has a bad description rather than a bad model.

---

## 10. Sending email

Sales replies go out **as real email, from you, after you have read and approved each one**. That decision is what the rest of this section has to protect, because it is the only place where an agent's output reaches a stranger who did not ask to hear from a machine.

### What "you approved it" has to actually mean

**The approved payload is frozen and the frozen payload is what sends.** On approval, the rendered message — recipient, subject, body, headers, any attachment — is written as an immutable record with a hash. The sender reads that record. Nothing re-renders between your tap and the SMTP conversation. If the message were regenerated at send time from the task and the charter, you would have approved one email and dispatched a slightly different one, and you would never know.

**The preview is the email.** The approvals screen renders the exact HTML and plain-text alternates that will be transmitted, at phone width, with the real sender name and subject line. Not a summary of the email. Not the model's description of what it wrote.

**`email.send` never leaves L1.** The autonomy ratchet in §7 promotes tools to L2 after you approve enough of them without editing — `email.send` is on an explicit exclusion list, in code, and the UI has no control that promotes it. Your sentence above is only true for as long as the system cannot quietly stop asking. A stale approval helps here too: anything sitting in the queue longer than seven days requires a second confirmation, with its age shown, because the context that made it a good reply may have moved on.

### Delivery

**Use a transactional email provider, not raw SMTP from the container.** Hosting-provider IP ranges have poor sending reputation and are widely blocked; a message that silently lands in spam is worse than one that fails loudly, because you will keep sending into a void and conclude the copy is bad. Postmark or Resend both work; Postmark has the stronger deliverability record for one-to-one mail, Resend the simpler API.

**Authenticate the sending domain before the first send.** SPF, DKIM and a DMARC policy on `cubekrafts.com`. This is the single highest-impact thing on this page for whether the replies get read, and it is twenty minutes of DNS.

**Send from a real mailbox you monitor** — `tarun@cubekrafts.com`, not `noreply@`. These are replies to people who wrote to you; a no-reply address on a sales reply reads as a mass mailing and invites the response it deserves.

**Set the threading headers.** `Message-ID` on the way out, `In-Reply-To` and `References` when replying, correct `Reply-To`. Without them the lead's client shows your reply as a disconnected new message and the conversation loses its history.

### When they reply

In v1, replies go to your normal mailbox and Foreman does not see them. You mark the lead's stage when you read one. That is a deliberate scope limit: inbound parsing is a bigger surface than it looks, and the sales agent is useful without it.

Phase 5 adds an inbound webhook from the provider so replies land against the lead automatically, and the follow-up sequence cancels itself the moment a human answers. Until then, **the follow-up sequence is the dangerous part** — see the caps below.

### Guardrails specific to sending

These are enforced in the tool implementation, not requested in a prompt.

- **A suppression list, checked before the send executes.** Anyone who asks to stop, hard-bounces, or reports spam goes on it permanently. A queued approval targeting a suppressed address fails closed and tells you why.
- **A daily send cap**, separate from the spend cap and much smaller — 25 to start. A bug that loops approvals costs money under the spend cap; a bug that loops *sends* costs your domain reputation, which is far harder to get back.
- **A per-recipient cap.** No more than three messages to the same address in fourteen days without you explicitly overriding. This is what stops a follow-up sequence from continuing to chase someone who already replied to your inbox where Foreman cannot see it.
- **Idempotency on every send.** The approval ID is the idempotency key with the provider, and each message walks a state machine — `queued → sending → sent(provider_id) → failed`. A network failure after transmission but before the database write is the classic double-send, and an idempotency key is the only thing that reliably prevents it.
- **Bounce and complaint webhooks wired from day one.** A hard bounce suppresses the address and marks the lead invalid; a spam complaint suppresses and alerts you. Without these you degrade your own deliverability silently over months.
- **Test mode** for the first week: every send is redirected to your own address with the intended recipient shown in a header. Turn it off when the rendering has stopped surprising you.

### Consent, and the honest bit about disclosure

Replying to someone who filled in your contact form is unambiguously fine. **The two-touch follow-up is where care is owed**, because the recipient consented to an answer, not a sequence. Every follow-up carries a one-line way to stop, and honouring it is automatic and permanent via the suppression list. If a lead can plausibly be in the EU or the US, apply the stricter of the rules rather than the local minimum — the cost is one sentence in a footer.

On whether recipients should be told a machine drafted it: **because you read and approve every message before it leaves, it is your email.** Signing your own name to something you have read is not deception, and no disclosure is required. That reasoning depends entirely on the review being real — which is why `email.send` is pinned at L1 above, and why the preview has to be the actual message rather than a summary of it. If you ever find yourself approving a queue of twelve without reading them, the honest fix is to send fewer emails, not to loosen the gate.

### What gets recorded

Every send stores the exact transmitted payload, the provider's message ID, the timestamp, the approval that authorised it, and every subsequent delivery event. When a lead says "you told me X", the answer is one query, not a memory.

---

## 11. Data model

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

-- outbound email (see §10)
email_message(id, approval_id, lead_id, to_addr, from_addr, reply_to,
              subject, body_html, body_text, headers, payload_hash,
              state, provider_id, idempotency_key,
              approved_at, sent_at, failed_reason)
              -- state: queued | sending | sent | failed | suppressed
email_event(id, email_message_id, kind, at, detail)
              -- kind: delivered | opened | bounced | complained | replied
suppression(address, reason, created_at)   -- checked before any send executes

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

`email_message` stores `payload_hash` and the fully rendered body because of the freeze rule in §10: the record is written at approval time and the sender reads it verbatim, so there is a hash you can compare against what you saw. `suppression` is a table rather than a flag on `lead` because a suppressed address must stay suppressed even if the lead record is re-synced or deleted.

Two further details worth defending. `run` splits cached from uncached input tokens and stores `cost_usd` computed at write time — cache-hit rate is what decides whether this costs $15 or $150 a month, and a stored cost is a fact where a recomputed one is a guess. `message` keeps full transcripts so a run can be replayed after you edit a charter, which is how you'll actually debug agent behaviour.

---

## 12. The interface

Nine screens, React + Vite, served by the same service, live over SSE. Built mobile-first, because approvals will mostly happen on a phone. The first is the one you will actually live in.

**Talk** — the default screen and the front door: a conversation with the concierge, with a mic button, streamed replies, and inline cards for approvals, numbers and tasks. Everything below is reachable from here by asking. See §13.

**HQ** — today's standup in plain English, active tasks, approvals waiting, spend against cap, four KPI tiles. Where you look when you want the machinery rather than an answer.

**The Org** — a card per role: on/off, current task, model and effort, autonomy sliders per tool, cost this week, last five outputs, edit charter.

**Board** — kanban by status, swimlanes by role, filterable by goal.

**Room** — one thread per role; you chat directly, and autonomous runs appear inline with collapsible tool calls.

**Approvals** — the queue from §7. Thumb-sized targets, swipe to approve, keyboard shortcuts on desktop. Email items render the actual message at phone width, not a summary of it (§10).

**Artifacts** — everything produced, with version history, diffs, and second-reader objections attached.

**Numbers** — pipeline, content shipped, site changes, spend by role and day, cache-hit rate, task cycle time.

**Settings** — passkeys and sessions, spend caps, egress allowlist, secret rotation, the auth log, export, and the kill switch.

Push notifications via the web push API for three things only: an approval that's been waiting an hour, a question from an agent, and the spend cap being hit. Anything more and you'll turn them off.

---

## 13. Talking to it

The screens in §12 are the fallback. **The front door is a conversation.** You open Foreman and there is a prompt, not a dashboard — you say what you want, it answers or it dispatches, and the boards are there when you want to see the machinery.

This section is what makes that feel immediate rather than like waiting on a chatbot.

### Two speeds, deliberately separated

The single most important decision here: **the thing you talk to is not the thing that does the work.**

| | Conversation layer | Work layer |
|---|---|---|
| Who | The **concierge** — one always-warm agent that owns your thread | COO and the six roles |
| Answers in | Under a second | Minutes |
| Model | `claude-haiku-4-5`, escalating to `claude-sonnet-5` when the question deserves it | `claude-opus-5` / `claude-sonnet-5` |
| Can do | Read anything, answer, dispatch work, surface an approval, steer a running agent | Write code, draft mail, produce artifacts |
| Cannot do | Any guarded action. It asks the work layer, or it asks you. | Talk to you directly |

If the concierge did the work, every question would wait behind a five-minute Opus run and the whole thing would feel dead. If the roles answered questions, they would lose their charters to small talk. Keeping them separate is what buys both responsiveness and rigour.

### Most questions should not reach a model at all

"What's pending?" "How many leads this week?" "What's the spend?" — these are database queries. Rendering them through a language model adds a second of latency, a fraction of a cent, and a chance of a wrong number.

So the concierge has a **snapshot**: a small in-memory projection of the current state — open approvals, running tasks, today's numbers, the last standup — refreshed on every tick and on every write. A short list of recognised intents answers straight from it, with **no model call**, and renders as a real UI card rather than a sentence. Everything else goes to the model, with the snapshot already in the cached prefix so the model never has to go looking.

Target: **recognised intent answers in under 100 ms. Everything else streams a first token in under 400 ms.** Those numbers are the feature. If they slip, the interactive feeling goes with them, and no amount of good prose recovers it.

### How it stays fast

- **Warm prefix.** The concierge's charter, the company canon, and the snapshot sit in one cached block with a one-hour TTL. It is the one agent that ticks often enough for caching to always hit.
- **Stream everything.** Tokens to the UI as they arrive, over the SSE channel that already exists. Never a spinner where text could be appearing.
- **Speak before you finish thinking.** When the concierge decides to dispatch work, it says so immediately — "putting content on it" — and the task creation happens after the sentence, not before it.
- **Optimistic UI.** Your message appears instantly; approvals mark themselves decided the moment you tap and reconcile when the server confirms.
- **Precompute the predictable.** The morning briefing is written by the COO at the end of the overnight tick, not composed when you open the app.

### Voice

Speech in and speech out, both **in the browser** — the Web Speech API for recognition and synthesis. No audio ever leaves the device, there is no transcription bill, and it works on a phone.

Push-to-talk by default, because an always-listening microphone in your office is a different product with different consent questions. A wake phrase is a setting you can turn on, off by default.

Spoken replies are **written differently from typed ones**: the concierge is told when the channel is voice, and answers in one or two sentences with the number first, because nobody wants a table read aloud. The full answer still renders on screen.

If browser synthesis sounds too robotic to live with, a hosted voice is a config change behind the same interface — but start with the free one, because latency matters more than timbre here.

### Interrupting, and steering mid-run

JARVIS never says "please wait for the current operation to complete".

- **"Stop"** aborts the current run at the next checkpoint, leaving the task parked rather than half-done.
- **"Actually, make it shorter"** while content is mid-draft appends a `{ role: "system" }` message to the running agent's conversation. This is a first-class Claude API feature on Opus 5, and it is exactly right here: the instruction lands with operator authority, and — because it goes into `messages` rather than the top-level system prompt — the cached prefix survives, so steering costs almost nothing.
- **Every long action is cancellable from the same place you started it.**

### When it speaks first

An assistant that interrupts constantly gets muted, which is worse than one that never speaks. So proactive messages are limited, by rule, to five things:

1. The morning briefing, once, when you first open it.
2. An approval that has waited longer than an hour.
3. A question an agent has parked — the run is blocked on you.
4. The spend cap being hit.
5. The same task failing twice.

Everything else waits to be asked. This list is a setting, and the honest default is fewer.

### How it talks

Terse, specific, and unbothered. The number before the explanation. No "Certainly!", no restating the question, no apology for things that are not its fault. It has opinions when asked for them and says "I don't know" without decoration.

That is a charter like any other role's, and you can edit it — but the default matters, because a verbose assistant is a slow assistant no matter how fast the tokens arrive.

### What this actually costs

The concierge is the cheapest agent in the org despite being the busiest: most turns are Haiku against a fully cached prefix, and a good share never reach a model at all. Budget **$3–8/month** at heavy conversational use, on top of §14. Voice is free.

### What it will not be

It will not anticipate what you want before you say it, it will not hold a flowing conversation that never misunderstands, and it will not have judgement the underlying model lacks. What it can genuinely be is **fast, grounded in real state rather than recollection, and able to act** — which covers most of what makes the fictional version appealing, and the remainder is a film.

---

## 14. Models, caching, and cost

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

Plus **$5–10/month hosting**, and the email provider — free at the volumes a sales agent produces, around $15/month once you pass a few thousand messages. Add ~10–15% of model spend if the second reader is on for diffs and published pages.

Set the daily cap as a hard stop — $5 is a sane start — and set a spend limit in the Anthropic console too. The app's cap protects you from a runaway loop; the console's cap protects you from a bug in the app's cap. That second one matters more now that the loop runs unattended overnight.

For the dev agent's long runs, use a **task budget** (`output_config.task_budget`, beta `task-budgets-2026-03-13`, minimum 20k tokens) so the model paces itself and wraps up gracefully instead of being cut off mid-thought.

---

## 15. HTTP API

```
POST /auth/passkey/register        first-run only, then disabled
POST /auth/passkey/challenge
POST /auth/passkey/verify          → session cookie
POST /auth/recovery                single-use code
POST /auth/logout
GET  /auth/sessions                active sessions
POST /auth/sessions/revoke         one, or all

POST /api/talk                     a turn with the concierge; streams the reply
GET  /api/talk/history             the thread, continuous across devices
POST /api/talk/interrupt           stop the current run at its next checkpoint
POST /api/runs/:id/steer           append an operator instruction to a live run
GET  /api/snapshot                 the precomputed state the concierge answers from

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

GET  /api/email                    sent, queued, failed, with delivery state
GET  /api/email/:id                the exact transmitted payload
POST /api/email/webhook            provider callbacks: bounce, complaint, delivery
GET  /api/suppression              the do-not-contact list
POST /api/suppression              add an address by hand

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

## 16. Build order

**Phase 0 — one agent, end to end, on your machine (a weekend).**
Postgres schema + migrations, the tick loop, our agent loop, the tool runtime with effect classification, the audit log, and one role: Content. Two tools, one guarded action, the approvals inbox, a bare HQ screen. **Run it on localhost for now** — do not deploy anything until phase 1 has auth. Success: you type a goal, an agent writes a post, you approve it, and the whole thing is in the audit log.

**Phase 1 — auth, then the URL.**
Passkey registration and sign-in, sessions, rate limiting, the auth log, security headers, Cloudflare in front. Deploy to Fly with Postgres and the volume. Backups configured and a restore tested. Success: you approve something from your phone, on the train.

**Phase 2 — the org appears, and you can talk to it.**
COO + the work graph, charters in the app, the review/revise cycle, the standup digest, the Org and Board screens, the autonomy ladder, push notifications. Then the concierge from §13: the snapshot, the no-model fast path for recognised intents, streamed replies, dispatch-by-conversation, interrupt and steer. Success: you say "how are we doing" and have an answer before you've finished looking at the screen, and "get the pricing page rewritten" creates the right task without you touching a form.

**Phase 3 — real business input, and the first real email.**
Sales: read-only inquiry sync, lead scoring, drafted replies, pipeline. Finance: weekly numbers and Foreman's own spend. Then the send pipeline from §10 in this order — SPF, DKIM and DMARC on the sending domain first; the frozen-payload record and the faithful preview second; suppression, caps and idempotency third; bounce and complaint webhooks fourth; and a week in test mode with every send redirected to your own address before a single message reaches a lead. Success: an inquiry arrives overnight, a good reply is waiting when you wake up, you read it, you approve it, and it lands in their inbox rather than their spam folder.

**Phase 4 — it touches the product.**
Web Developer on the checkout: branch, edit, test, commit, PR, diff preview, guarded push, with branch protection set on the GitHub side. Second reader on diffs. Marketing and the content calendar feeding Content. Success: a real site change ships from a Foreman branch.

**Phase 5 — voice, and it gets better on its own.**
Push-to-talk and spoken replies through the browser. The metrics loop, the weekly review, and charter self-tuning from your approve/reject reasons. Success: you ask it something on the drive home without touching the phone.

The ordering change from the localhost plan is deliberate: **auth comes before the second role.** An app on the internet that can push code and send email does not get to be half-secured for a few weeks while you add features.

---

## 17. How this fails, and what's in the design about it

| Failure | Mitigation |
|---|---|
| Someone finds the URL | Passkey-only sign-in, one allowed identity, rate limiting, Cloudflare Access in front, security headers, an auth log you actually see. |
| A session is stolen | Nothing outbound happens without an approval press; secrets are never rendered to the client; sessions are individually revocable; re-auth for the four dangerous settings. |
| The host is compromised | Branch protection on `main` is enforced by GitHub, not by us. Cubekrafts access is read-only. Blast radius is business data plus a rotatable set of keys. |
| Runaway spend overnight | Hard daily cap that stops the loop, per-run ceiling, task budgets, a console-side cap as backstop, cache-hit monitoring. |
| Agents produce plausible work nobody uses | Written definition of done before a task can be `ready`; COO reviews against it; Finance reports output per dollar per role. |
| Approval fatigue → rubber-stamping | The L1→L2 ratchet exists so the queue shrinks. Fifty a day in week four means promote tools, not work faster. |
| An agent does something irreversible | Effect classification in our loop, before execution. Dev agent branch-only. No live-site writes in v1. |
| **The same email sends twice** | An idempotency key per approval, and a `queued → sending → sent → failed` state machine. A network failure after transmission is the classic cause and the key is the only reliable fix. |
| **What sent isn't what you approved** | The rendered payload is frozen and hashed at approval time; the sender reads that record verbatim rather than re-rendering from the task. |
| **A follow-up chases someone who already replied** | A per-recipient cap of three messages in fourteen days, plus inbound reply handling in phase 5 that cancels the sequence automatically. |
| **Domain reputation quietly degrades** | Authenticated sending domain, bounce and complaint webhooks from day one, permanent suppression on both, and a daily send cap far below the spend cap. |
| **You approve a queue of twelve without reading them** | The design can't stop this, and loosening the gate would be the wrong response. Send fewer emails. `email.send` stays at L1 so the choice stays yours each time. |
| Prompt injection via a lead's message | Untrusted input delimited and labelled as data; every consequential action guarded. |
| Voice drifts into generic slop | Canon in the cached prefix, last-ten-approved pieces in context, rejections appended to the charter. |
| **The conversation feels slow, and you stop using it** | Recognised intents answer from the snapshot with no model call at all; everything else streams a first token inside 400 ms against a warm cached prefix. Those numbers are a feature with a test, not an aspiration. |
| **It becomes a chatty assistant you mute** | Proactive messages are limited by rule to five situations, and that list is a setting whose honest default is fewer. |
| **It answers confidently from stale state** | The concierge answers from a snapshot refreshed on every tick and every write, and numbers render as cards from the database rather than as model prose. |
| A deploy interrupts a run | Runs checkpoint before and after every model call; an interrupted run resumes or fails cleanly, never half-executes. |
| Context rot on long tasks | Runs checkpointed and summarised rather than accumulated; server-side compaction and context editing for the dev agent's long sessions. |
| You stop using it in week three | Phase 0 must deliver something you'd miss. If the standup isn't worth reading on day five, fix that before building phase 2. |

---

## 18. Decisions made for you

| Decision | Why | The alternative |
|---|---|---|
| One always-on container, not serverless | The tick loop and multi-minute agent runs don't fit a function timeout | Vercel + external worker + cron — three parts where one suffices |
| Postgres, not SQLite | It's hosted now; managed backups and full-text search come with it | SQLite on a volume — fine until the first restore you actually need |
| Conversation is the front door, dashboards are the fallback | It is the interface you will actually use, and the one that works one-handed on a phone | A dashboard-first app with a chat panel bolted on the side |
| The concierge cannot take guarded actions itself | Keeps the fast, chatty layer away from anything that reaches a customer | One agent that both talks and acts — simpler, and exactly how you end up with a fast agent sending mail |
| Voice runs in the browser | No audio leaves the device, no transcription bill, works on a phone today | A hosted speech pipeline — better voice, real latency and real cost |
| Passkey, no password | Nothing to phish, no reset flow to attack, pleasant on a phone | Password + TOTP — more code, more ways in |
| We own the agent loop | The classifier is the security boundary of an internet-facing app | The SDK tool runner's hooks — workable, but the boundary lives in someone else's control flow |
| Auth before the second role | An internet-facing app that can push code doesn't get to be half-secured | Ship features first, add auth "soon" |
| Branch protection on `main`, set in GitHub | The strongest rule shouldn't be enforced by my code | Trust the classifier alone |
| Concurrency 1 | Two agents in one checkout is a corruption bug waiting to happen | Higher, once tool sets are provably disjoint |
| Email sends for real, but never above L1 | You read and approve each one, which is what makes it your message rather than a machine's | Drafts you copy out — safer, but you said you want it sent |
| Transactional provider, not raw SMTP | Hosting IPs have poor reputation; silent spam-foldering is worse than a loud failure | SMTP from the container — free, and invisible when it stops working |
| Cubekrafts read-only in v1 | The blast radius of a bad write to a live business system isn't worth it in month one | Grant writes per-endpoint later, at L1 |

### Open questions

1. **Which domain?** `foreman.cubekrafts.com`, or something unrelated to the business? A subdomain is simpler; an unrelated domain leaks nothing about what it is.
2. **Which GitHub repo does the dev agent work in**, and which commands may it run — `npm test`, `npm run lint`, `npm run build`?
3. **Which email provider, and which address does mail come from?** Postmark or Resend; `tarun@cubekrafts.com` or another mailbox you actually watch. You'll need DNS access on the sending domain for SPF, DKIM and DMARC.
4. **Daily send cap?** (25 default — deliberately far below anything you'd hit legitimately.)
5. **Read-only Cubekrafts API token**, or a nightly export the app pulls?
6. **Daily spend cap?** ($5 default.)
7. **Region** — nearest you for latency, or nearest the Claude API for throughput? Nearest you; the model call dominates either way.

None of these block Phase 0.

---

## 19. Repo layout

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

## 20. What I'd build first, given a day

The tick loop, the tool effect classifier, the audit log, and the approvals inbox — one role, two tools, running on localhost with no auth and no deployment.

If a single agent can pick up a task, write something, get stopped at a guarded action, and wait for you, the company works. Then spend the next day on §4, because that's what stands between that working prototype and a URL you can safely give an address to.
