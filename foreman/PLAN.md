# Foreman — a whole organisation that runs on your laptop

**Status:** design, not built. Nothing in this folder ships yet.
**Working name:** Foreman (a foreman runs a crew and reports to the owner). Rename is a find-and-replace.

---

## 1. What this is

Foreman is a **single desktop app that behaves like a small company you own**. You are the founder. Everyone else — the COO, the web developer, sales, marketing, content, finance — is an AI agent with a written job description, a fixed set of tools, and a permission level you set.

You give it goals. The COO breaks them into work, assigns it to the right role, and the roles do the work: sales drafts follow-ups to real inbound leads, content writes the posts, the web developer edits a checkout of your site on a branch and shows you the diff, marketing plans the campaign, finance tells you what any of it costs. Anything that leaves the building — an email, a published page, a git push, a rupee spent — stops in an approval queue until you press the button.

**It runs entirely on your device.** One process, one SQLite file, one browser tab at `http://127.0.0.1:7777`. No server to rent, no account to create, no data leaving the machine except the Claude API calls the agents make and the specific outbound requests you have allowlisted.

### What it is *not*

- Not part of Cubekrafts. Its own repository, its own package.json, its own database, sharing no code with the Cubekrafts site or API. It talks to Cubekrafts the way any outside operator would — over the public API with a read-only token, and against a local git clone it may only branch from, never push to `main`.
- Not a SaaS, not multi-tenant, not hosted, and it never phones home.
- Not a chatbot with a persona menu. The point is the *organisation*: persistent roles, a shared work queue, a memory that carries across weeks, and a boss (you) with a veto.

### The one-line test for whether this was worth building

> You open the laptop on Monday, read one standup digest, approve four things, reject one with a sentence explaining why — and the company moved a week's worth without you writing anything yourself.

---

## 2. Ground rules (these constrain every decision below)

| Rule | Consequence for the design |
|---|---|
| Runs on your device only | Bind to `127.0.0.1` only. No inbound port on the LAN. No auth server — a local passphrase unlocks the secrets file, that's it. |
| One user, ever | No roles/permissions system, no orgs, no invites. Every table is single-tenant. Saves ~40% of the code a normal app of this shape needs. |
| Your data stays yours | SQLite at `~/.foreman/foreman.db`, artifacts as plain files in `~/.foreman/files/`. Backup = copy the folder. Export = it's already a file. No telemetry, ever. |
| Cheap to run | One agent at a time by default. Prompt caching on every call. Model tiering by task. A hard daily spend cap that stops the loop, not just warns. |
| Nothing irreversible without you | Every tool is classified `safe` / `guarded` / `forbidden` before the runtime will execute it. Guarded means it queues. |
| Laptops sleep | The tick loop must survive being suspended mid-run: every run is checkpointed to the DB before and after the model call, and an interrupted run resumes or fails cleanly rather than half-executing. |

---

## 3. The staff

Every role is a **markdown charter file** on disk (`~/.foreman/charters/sales.md`) plus a row in the DB holding its tool grants, autonomy levels, and model. Charters are yours to edit — that's the main way you manage these employees.

Each charter has a fixed shape:

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
```

### The seven roles

**COO — the only one that plans.**
Converts your goals into initiatives and tasks, assigns them, sequences them, reviews finished work against its definition of done, writes the daily standup, and escalates. It does not do the work itself — it has no tools except the work-graph tools and read access to artifacts. This is deliberate: keeping planning and doing in separate agents is what stops the whole thing collapsing into one confused agent that plans, half-does, and reports success.
*Model: Opus 5, effort `high`. It's the most expensive per-token role but the cheapest per-mistake.*

**Web Developer — ships code, never deploys.**
Works in a local git clone of the Cubekrafts repo at a path you configure. Reads, edits, runs the test/lint/build commands, commits to a branch named `foreman/<task-id>`. It **cannot** push to `main`, cannot run deploy scripts, and cannot touch anything outside the clone directory. Its deliverable is a branch plus a plain-English diff summary in the approvals queue. You review, then push yourself (or approve a push, which is a guarded tool).
*Model: Opus 5, effort `xhigh` — this is the coding/agentic case where xhigh actually pays for itself.*

**Sales — drafts, never sends.**
Pulls new inquiries from the Cubekrafts API (read-only token), qualifies each against your ICP, writes the first reply and a two-touch follow-up sequence, and maintains a pipeline with stages and next actions. Every outbound message lands in the approvals queue with the lead's context beside it. It also keeps a running list of objections it's seeing, which is the single most valuable thing it produces for marketing.
*Model: Sonnet 5 for drafting, Haiku 4.5 for the initial qualify/triage pass.*

**Marketing — plans, doesn't publish.**
Owns the channel calendar, campaign briefs, keyword and competitor research (via the web-search tool with a domain allowlist), landing-page concepts, and budget proposals. Its output is briefs that Content and the Web Developer execute against. Any proposed spend is a guarded action with a number attached.
*Model: Sonnet 5, effort `high`.*

**Content — writes to brief.**
Turns marketing briefs into posts, case studies, product page copy, and social. Reads the brand-voice canon and the last ten approved pieces before writing, so voice drifts slowly rather than per-piece. Output is a markdown artifact; publishing is a separate guarded step.
*Model: Sonnet 5. Content volume is where token spend concentrates, and Sonnet is genuinely good at this.*

**Finance / Analyst — the one that says no.**
Unit economics per product, quote and ROI math, weekly numbers (leads, conversion, content shipped, site changes), and — importantly — tracks Foreman's own API spend and tells you when a role is burning money for no output. Read-only on everything.
*Model: Haiku 4.5 for the recurring number-crunching, Sonnet 5 for the weekly written analysis.*

**Support (phase 4, optional).**
Post-sale FAQs, order-status templates, warranty questions. Deferred because it needs real post-sale volume to be worth anything.

### Why these seven and not more

Each role costs you charter-maintenance attention and adds a routing decision for the COO. Seven is roughly the point where the COO can still hold the whole org in one context window alongside the work graph. Add an eighth only when you can name the specific work that's falling between two existing roles.

---

## 4. How work actually flows

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

A single loop, default every 10 minutes, plus an instant tick when you press "Run now" or approve something.

```
tick():
  if paused or daily_spend >= cap: return
  claim = next ready task
      (status=ready, deps satisfied, role enabled, concurrency slot free)
  if none: return
  run = start_run(task)                    # checkpoint BEFORE the model call
  ctx = build_context(task)
  result = agent_turn(ctx)                 # Claude + tool runner
  finish_run(run, result)                  # checkpoint AFTER
  if task.deliverable_complete: queue COO review
```

Concurrency defaults to **1**. Two agents editing the same repo checkout or the same artifact is the most obvious way to make this thing produce garbage, and on a laptop you gain nothing from parallelism except a bigger bill. Raise it to 2 only for roles with disjoint tool sets (e.g. Content + Finance).

### The context pack

Every agent turn is assembled the same way, and the order is chosen so prompt caching works (§10):

1. **Stable prefix** (cached): tool schemas → role charter → company canon → the definition-of-done template.
2. **Task-scoped**: the task, its parent initiative and goal, linked artifacts, the last N runs on this task.
3. **Retrieved**: top-k memory chunks from FTS over past artifacts and run summaries.
4. **Volatile, last**: today's date, current metrics, the pending question if any.

Anything that changes per-tick goes at the end. A timestamp in the charter header would silently destroy caching for the entire company — this is the single easiest expensive mistake to make here.

### Review, not vibes

When a role marks a task complete, the COO gets the artifact and the task's definition-of-done and returns one of three verdicts:

- **accept** → artifact is finalised, task closed, dependents unblocked
- **revise** → back to the role with specific, numbered feedback (max 2 rounds, then auto-escalate — an agent on its third revision is a task that was specified wrong)
- **escalate** → straight to you, with the disagreement stated in one paragraph

---

## 5. Permission, autonomy, and the things that keep this safe

### Every tool call is classified before it runs

```ts
type Effect = 'safe' | 'guarded' | 'forbidden'
// safe      — reversible, local, invisible outside this machine. Executes.
// guarded   — outbound, spends money, or writes to something you own. Queues.
// forbidden — not for this role, ever. Refused, logged, run aborted.
```

The classification is a function of `(role, tool, arguments)` — not just the tool. `git.commit` on a `foreman/*` branch is safe; on `main` it's forbidden. `http.fetch` to a domain on the allowlist is safe; anywhere else it's guarded. This is enforced in the runtime, not requested in the prompt, because a prompt is a suggestion and a switch statement is not.

### The autonomy ladder

Set per `(role, tool)` pair from the UI:

| Level | Behaviour |
|---|---|
| **L0 Propose** | Agent describes what it would do. Never executes. Good for a role's first week. |
| **L1 Approve** | Executes only after you approve, with a full preview of the effect. **The default for everything guarded.** |
| **L2 Notify** | Executes immediately, you get a notification and a one-click undo window. For things that turned out to be boring. |
| **L3 Auto** | Executes silently, appears only in the audit log. Earn this one tool at a time. |

Start every role at L1 across the board. Promote a specific tool to L2 after you've approved ~20 of them without editing. That ratcheting is the whole trust model — it's not a setting you configure up front, it's something the org earns.

### The approvals inbox

The most important screen in the app. Each item shows:

- **what will happen**, rendered as the actual effect — the email as it will send, the diff as it will apply, the ₹ figure as it will be spent
- **why**, in the agent's own words, one paragraph
- **what it's attached to** — the task, the goal, the lead
- four buttons: **Approve** / **Edit & approve** / **Reject with reason** / **Always allow this** (which is the L1→L2 promotion, done inline)

**Rejections are training data.** A rejection with a reason gets appended to that role's `## Learned` section in its charter, so the next context pack includes it. This is the loop that makes month three better than month one, and it costs almost nothing to build.

### Hard guardrails, all enforced in code

- **Kill switch** — one button pauses every agent, mid-run. Wired to `Esc Esc` too.
- **Offline mode** — blocks all egress except `api.anthropic.com`. Agents keep working on local artifacts.
- **Filesystem jail** — every path is resolved and checked against an allowed-roots list before any read or write. The dev agent sees the Cubekrafts clone and nothing else. (Path traversal via `../` and symlinks is the classic failure here; resolve first, then compare.)
- **Domain allowlist** for all outbound HTTP.
- **Daily and monthly spend caps** that hard-stop the loop, plus a per-run token ceiling.
- **Full audit log** — every tool call with arguments, result hash, timestamp, run ID. Append-only. It's the thing you read when something weird happened.
- **Secrets never enter a prompt.** Tokens live in the OS keychain (or an encrypted file), are injected by the tool implementation at call time, and are redacted from all logs. An agent never sees a credential, so no amount of prompt injection in an inbound lead's message can leak one.

### Treat inbound content as hostile

Lead messages, fetched web pages, and competitor sites are **untrusted input**. They get wrapped in a delimiter block with an explicit instruction that content inside is data, never instructions. Combined with the fact that every consequential action is a guarded tool, a prompt-injection attempt in an inquiry form can at worst produce a weird draft that you then reject.

---

## 6. Memory

Three tiers, deliberately boring:

**Canon** — files you own in `~/.foreman/canon/`: brand voice, pricing, product specs, ICP, competitor notes, past-project case studies. Loaded whole into the cached prefix for the roles that need it. This is the highest-leverage thing you will ever type into this app; a good `pricing.md` is worth more than any prompt tuning.

**Working memory** — the task, its artifacts, and its run history. Scoped to the task, dropped when it closes.

**Recall** — SQLite **FTS5** full-text index over every artifact, run summary, approval decision, and rejection reason. Retrieved top-k into the context pack. No vector database: at a few thousand documents on one machine, FTS5 with a decent query is fast, debuggable, and has zero moving parts. If recall quality genuinely disappoints after a few months, the upgrade path is `sqlite-vec` with local embeddings — same table, one extra column. Don't pre-build it.

---

## 7. The capability layer (tools)

| Tool | Given to | Default class |
|---|---|---|
| `fs.read` / `fs.write` / `fs.list` | dev, content, all (scoped roots) | safe within jail |
| `git.status/diff/branch/commit` | dev | safe on `foreman/*` |
| `git.push` | dev | **guarded** (forbidden to `main`) |
| `shell.run` (allowlisted commands only: test, lint, build) | dev | safe |
| `http.fetch` | marketing, content | safe on allowlist, else guarded |
| `web.search` | marketing, sales, finance | safe |
| `cubekrafts.inquiries.list` | sales, finance | safe (read-only token) |
| `cubekrafts.admin.*` (writes) | — | **forbidden** in v1 |
| `email.draft` | sales | safe (writes to local drafts) |
| `email.send` | sales | **guarded** |
| `artifact.create/update` | all | safe |
| `work.*` (create/assign/update tasks) | COO only | safe |
| `memory.search` | all | safe |
| `ask_founder` | all | safe (blocks the task, queues a question) |
| `spend.propose` | marketing | **guarded** |

`ask_founder` is worth calling out: giving agents a first-class way to say "I need a decision" is what prevents them from inventing an answer and confidently proceeding. It's a tool, so it's structured, attributable, and it parks the task instead of failing it.

---

## 8. Data model

SQLite. `better-sqlite3` with numbered `.sql` migrations — synchronous API suits a single-process local app, and FTS5 is available without fighting an ORM.

```sql
-- org
role(id, name, charter_path, model, effort, enabled, concurrency, created_at)
tool_grant(role_id, tool, autonomy, config_json)      -- the autonomy ladder lives here

-- work graph
goal(id, title, why, target_date, status)
initiative(id, goal_id, title, owner_role, status)
task(id, initiative_id, title, spec, definition_of_done,
     owner_role, status, priority, due, blocked_by_json,
     revision_count, created_at, closed_at)
     -- status: draft|ready|running|blocked|review|revise|done|cancelled

-- execution
run(id, task_id, role_id, status, model, effort,
    started_at, ended_at, input_tokens, cached_tokens, output_tokens,
    cost_usd, summary, error)
tool_call(id, run_id, tool, args_json, effect_class,
          approved_by, result_hash, ok, ms, created_at)
message(id, run_id, seq, role, content_json)          -- full transcript, for replay

-- outputs & decisions
artifact(id, task_id, kind, title, path, status, version, created_at)
     -- kind: draft_email|post|brief|diff|report|doc|plan
approval(id, run_id, tool_call_id, kind, preview_json, status,
         decided_at, reason, promoted_to_l2)
question(id, task_id, role_id, text, answer, asked_at, answered_at)

-- business objects (Foreman's own copy — never writes back in v1)
lead(id, source_id, name, email, location, message, stage,
     score, next_action, next_action_at, synced_at)
campaign(id, title, channel, status, budget, brief_artifact_id)
content_piece(id, title, channel, status, artifact_id, published_at)

-- knowledge & ops
memory(id, kind, ref_table, ref_id, text, created_at)
memory_fts(text)                                      -- FTS5 virtual table
audit(id, at, actor, action, subject, detail_json)    -- append-only
setting(key, value_json)
spend_day(date, usd, input_tokens, output_tokens)
```

Two notes. `run` stores token counts split into cached vs. uncached because cache-hit rate is the metric that determines whether this app costs ₹500/month or ₹5000/month, and you cannot fix what you cannot see. `message` stores full transcripts so any run can be replayed or diffed after you change a charter — that's how you'll actually debug agent behaviour.

---

## 9. The interface

Seven screens. React + Vite, served by the same local process.

**HQ** — today's standup from the COO in plain English, active tasks, approvals waiting (with a count badge you'll learn to read from across the room), spend today vs. cap, and four KPI tiles.

**The Org** — a card per role: on/off toggle, current task, autonomy sliders per tool, cost this week, last five outputs, and an **Edit charter** button that opens the markdown. This is the "management" screen.

**Board** — kanban by status, swimlanes by role, filterable by goal. Drag to reprioritise. Click through to any task's full run history.

**Room** — one thread per role. You chat with an agent directly; its autonomous runs appear inline in the same thread with collapsible tool calls. This is how you correct something in the moment without editing a charter.

**Approvals** — the queue from §5. Keyboard-driven: `j`/`k` to move, `a` to approve, `r` to reject. You will spend more time here than anywhere else, so it gets the most design attention.

**Artifacts** — everything produced, filterable by kind and role, with version history and a diff view.

**Numbers** — pipeline, content shipped, site changes, model spend by role and by day, cache-hit rate, average task cycle time.

Live updates over SSE from the local server. No polling, no websocket library.

---

## 10. Model use, cost, and the API specifics

This is where a local multi-agent app either works or quietly becomes unaffordable, so the details matter.

### Which model for what

| Use | Model | Input / Output per Mtok | Why |
|---|---|---|---|
| COO planning, review, escalation | `claude-opus-5` | $5 / $25 | Judgement-heavy, low volume. Wrong plans are the expensive failure. |
| Web developer | `claude-opus-5` (effort `xhigh`) | $5 / $25 | Agentic coding is exactly its strength; a bad diff costs you an hour. |
| Content, marketing, sales drafting | `claude-sonnet-5` | $3 / $15 (intro $2 / $10 through 2026-08-31) | The volume tier. Near-Opus quality on writing at a fraction of the cost. |
| Lead triage, classification, metric summaries | `claude-haiku-4-5` | $1 / $5 | High frequency, low judgement. |

Foreman is Anthropic-only by design — one SDK (`@anthropic-ai/sdk`), one auth path, one set of behaviours to tune against.

### The request shape (current API, not the 2024 one)

```ts
const runner = client.beta.messages.toolRunner({
  model: 'claude-opus-5',
  max_tokens: 16000,
  thinking: { type: 'adaptive' },              // on by default on Opus 5; no budget_tokens — it 400s
  output_config: { effort: 'high' },           // low | medium | high | xhigh | max
  system: [
    { type: 'text', text: TOOL_PREAMBLE },
    { type: 'text', text: charter },
    { type: 'text', text: canon, cache_control: { type: 'ephemeral' } },  // breakpoint here
  ],
  tools,                                        // stable order — see caching below
  messages,
})
```

Four things that are easy to get wrong and expensive to discover later:

- **No `temperature`, `top_p`, or `top_k`.** They return 400 on Opus 5 and Sonnet 5. Steer voice with the charter's `## Voice` section instead.
- **No `budget_tokens`.** Use `output_config.effort`. Sweep `medium`/`high`/`xhigh` per role on your own work before settling — effort matters more than model choice for cost on this app.
- **Stream anything with `max_tokens` above ~16k**, or the SDK will hit an HTTP timeout on a long dev-agent turn.
- **Handle `stop_reason: 'refusal'` before reading `content`.** It arrives as a normal HTTP 200 with possibly-empty content. Code that does `response.content[0].text` unconditionally will crash on it. Opt into the server-side fallback (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`) so a refusal is retried automatically instead of failing a run.

### Prompt caching is the whole cost story

Caching is a **prefix match**: any byte that changes anywhere in the prefix invalidates everything after it. Render order is `tools` → `system` → `messages`. So:

- Tool definitions serialised deterministically, sorted by name, **never varied per tick**.
- Charter and canon next, frozen, with the `cache_control` breakpoint on the last block.
- Task, retrieved memory, date, and metrics after the breakpoint.
- Never interpolate a timestamp, run ID, or `new Date()` into the system prompt. This is the mistake that produces a bill 10× larger than expected with no visible symptom.
- Minimum cacheable prefix on Opus 5 is **512 tokens** (1024 on Sonnet 5); a charter plus canon clears that easily.
- Cache reads cost ~0.1× and writes ~1.25× (5-minute TTL). With ticks every 10 minutes, the default 5-minute TTL will often miss — use `ttl: '1h'` (2× write) for the COO and any role that ticks all day, and let the low-frequency roles take the cold write.
- **Mid-run operator context** (a new instruction, an approval that just landed) goes in as a `{ role: 'system' }` message appended to `messages[]` — supported on Opus 5, and it leaves the cached prefix intact. Editing the top-level `system` mid-conversation would re-bill the entire history.
- Log `cache_read_input_tokens` on every run. If it's zero across consecutive runs of the same role, something in the prefix is moving; find it before doing anything else.

### What it costs

A typical role turn: ~15k input (mostly cache reads after the first), ~3k output.

| Scenario | Runs/day | Rough daily | Rough monthly |
|---|---|---|---|
| Quiet (COO + content only) | 8 | $0.30–0.60 | $10–20 |
| Normal (all roles, one goal active) | 25 | $1.50–3 | $45–90 |
| Heavy (dev agent on a real feature) | 40+ | $4–8 | $120–240 |

Set the daily cap at whatever you're comfortable losing to a runaway loop — $5 is a sane start — and make the cap a hard stop, not a warning. For the dev agent's long agentic runs, add a **task budget** (`output_config.task_budget`, beta `task-budgets-2026-03-13`, minimum 20k tokens): the model sees the countdown and wraps up gracefully instead of being guillotined by `max_tokens`.

---

## 11. Local API surface

Everything on `127.0.0.1:7777`. The React app is the only consumer, so this stays small.

```
GET  /api/hq                       dashboard payload
GET  /api/stream                   SSE: runs, approvals, questions, spend

GET  /api/roles                    list with live status
PATCH/api/roles/:id                enable, model, effort, concurrency
GET  /api/roles/:id/charter        raw markdown
PUT  /api/roles/:id/charter        save (bumps a charter version)
PATCH/api/roles/:id/grants/:tool   set autonomy level

POST /api/goals                    create a goal → COO plans it
GET  /api/tasks                    filter by status/role/goal
POST /api/tasks/:id/run            run now
POST /api/tasks/:id/cancel

GET  /api/approvals                pending queue
POST /api/approvals/:id/decide     approve | edit | reject(reason) | always-allow

GET  /api/questions                open questions from agents
POST /api/questions/:id/answer

GET  /api/artifacts                filter by kind/role/task
GET  /api/runs/:id                 full transcript + tool calls

POST /api/control/pause            kill switch
POST /api/control/offline          egress lockdown
GET  /api/spend                    daily/monthly, by role
```

---

## 12. Build order

Each phase ends with something you actually use. Nothing is built "for later".

**Phase 0 — one agent, end to end (a weekend).**
SQLite + migrations, the tick loop, the tool runtime with effect classification, the audit log, and **exactly one role: Content**. Two tools (`fs.write`, `artifact.create`), one guarded action, the approvals inbox, and a bare HQ screen. Success: you type a goal, an agent writes a blog post, you approve it, and the whole thing is in the audit log. This proves the loop; everything after is repetition.

**Phase 1 — the org appears.**
COO + the work graph (goal → initiative → task), charters as files, the review/revise cycle, the standup digest, the Org and Board screens, the autonomy ladder in the UI. Success: you set one goal and get a sensible plan with tasks you didn't have to write.

**Phase 2 — real business input.**
Sales role. Read-only sync of Cubekrafts inquiries, lead scoring, drafted replies in the approvals queue, pipeline view. Finance basics (weekly numbers + Foreman's own spend). Success: an inquiry arrives and a good reply is waiting for you within a tick.

**Phase 3 — it touches the product.**
Web Developer on a local clone: branch, edit, test, commit, diff preview, guarded push. Marketing + the content calendar feeding Content properly. Success: a real site change ships from a Foreman branch.

**Phase 4 — it gets better on its own.**
Metrics loop (which content produced leads, which replies converted), the weekly review, charter self-tuning from your accumulated approve/reject reasons, memory recall tuning. Optional: wrap in Tauri so it's an icon you click instead of `npm start`.

---

## 13. The ways this fails, and what's in the design about it

| Failure | Mitigation already in the design |
|---|---|
| Agents produce plausible work nobody uses | Every task needs a written definition of done before it can be `ready`; the COO reviews against it; Finance reports output-per-dollar per role. |
| Runaway spend | Hard daily cap that stops the loop, per-run token ceiling, task budgets, cache-hit monitoring, model tiering. |
| Approval fatigue → rubber-stamping | The L1→L2 ratchet exists precisely so the queue shrinks over time. If you're approving 50 things a day at week four, that's a signal to promote tools, not to work faster. |
| An agent does something irreversible | Effect classification in the runtime, not the prompt. Dev agent branch-only. No write access to the live site in v1. |
| Prompt injection via a lead's message | Untrusted input delimited and labelled as data; every consequential action still needs your approval. |
| Voice drifts into generic AI slop | Brand canon in the cached prefix, last-ten-approved-pieces in context, rejections appended to the charter. |
| Context rot on long-running tasks | Runs are checkpointed and summarised, not accumulated; server-side compaction (`compact-2026-01-12`) and context editing available for the dev agent's long sessions. |
| You stop using it in week three | Phase 0 must deliver something you'd miss. If the standup digest isn't worth reading on day 5, fix that before building phase 1. |

---

## 14. Decisions I've made for you (change any of them)

| Decision | Why | The alternative |
|---|---|---|
| TypeScript, Node 20 | Tool schemas want types; the Anthropic SDK's tool runner + `betaZodTool` gives typed inputs and handles the agent loop, with per-turn hooks for the approval gate | Plain JS — faster to start, more runtime surprises in tool arguments |
| `better-sqlite3` + hand-written SQL migrations | Single process, synchronous, FTS5 available without a fight | Prisma — you already know it, but FTS5 needs raw queries anyway |
| DB-backed queue, in-process | No Redis, no second process, survives restarts | BullMQ — real infrastructure for a problem you don't have |
| React + Vite + SSE | Matches what you already use | Anything else |
| `npm start` now, Tauri later | Packaging before the thing is good is wasted work | Electron/Tauri from day one |
| Concurrency 1 | Two agents in one repo checkout is a corruption bug waiting to happen | Higher, once tool sets are provably disjoint |
| Cubekrafts read-only in v1 | The blast radius of a bad write to a live business system is not worth it in month one | Grant writes per-endpoint later, at L1 |

### Open questions only you can answer

1. **Where's the Cubekrafts git clone going to live**, and which commands may the dev agent run (`npm test`, `npm run lint`, `npm run build`)?
2. **Email**: real SMTP send-after-approval, or drafts-to-a-folder that you paste? Drafts is safer for month one and costs nothing to upgrade later.
3. **Does the Cubekrafts API get a read-only token for Foreman**, or does Foreman read a nightly CSV export? Token is better; export is zero-change.
4. **What's the daily spend cap?** ($5 default.)

None of these block Phase 0.

---

## 15. Repo layout

This repository, at its root:

```
  package.json                  # its own deps — nothing shared with cubekrafts
  PLAN.md                       # this file
  README.md
  .gitignore
  src/
    server/         index.ts, routes/, sse.ts
    db/             migrations/*.sql, schema.ts, queries.ts
    agents/         runtime.ts, context.ts, review.ts, charters/
    tools/          registry.ts, effects.ts, fs.ts, git.ts, http.ts,
                    email.ts, cubekrafts.ts, work.ts, memory.ts
    guards/         jail.ts, allowlist.ts, budget.ts, audit.ts
    scheduler/      tick.ts
    ui/             React app
  data/                         # gitignored; real data lives in ~/.foreman
```

`~/.foreman/` holds `foreman.db`, `files/`, `charters/`, `canon/`, `secrets.enc`, and `config.json`. None of it is ever in git.

---

## 16. What I'd build first, given a day

The tick loop, the tool effect classifier, the audit log, and the approvals inbox — with one role and two tools. Not the org chart, not seven charters, not the KPI dashboard. If a single agent can pick up a task, write something, get stopped at a guarded action, and wait for you — the company works. Everything in this document after that point is filling in employees.
