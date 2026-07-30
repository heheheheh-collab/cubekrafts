# Foreman — a whole organisation that runs on your laptop

**Status:** design, not built. Nothing here ships yet.
**Working name:** Foreman (a foreman runs a crew and reports to the owner). Rename is a find-and-replace.

---

## 1. What this is

Foreman is a **single desktop app that behaves like a small company you own**. You are the founder. Everyone else — the COO, the web developer, sales, marketing, content, finance — is an AI agent with a written job description, a fixed set of tools, and a permission level you set.

You give it goals. The COO breaks them into work, assigns it to the right role, and the roles do the work: sales drafts follow-ups to real inbound leads, content writes the posts, the web developer edits a checkout of your site on a branch and shows you the diff, marketing plans the campaign, finance tells you what any of it costs. Anything that leaves the building — an email, a published page, a git push, a rupee spent — stops in an approval queue until you press the button.

**It runs entirely on your device.** One process, one SQLite file, one browser tab at `http://127.0.0.1:7777`. No server to rent, no account to create, no data leaving the machine except the model API calls the agents make and the specific outbound requests you have allowlisted.

**It is not tied to one AI vendor.** Roles run on Claude or on ChatGPT, chosen per role, and the two can review each other's work. Section 10 is how that gets built without turning the codebase into a compatibility shim.

### What it is *not*

- Not part of Cubekrafts. Its own repository, its own package.json, its own database, sharing no code with the Cubekrafts site or API. It talks to Cubekrafts the way any outside operator would — over the public API with a read-only token, and against a local git clone it may only branch from, never push to `main`.
- Not a SaaS, not multi-tenant, not hosted, and it never phones home.
- Not a chatbot with a persona menu. The point is the *organisation*: persistent roles, a shared work queue, a memory that carries across weeks, and a boss (you) with a veto.

### The one-line test for whether this was worth building

> You open the laptop on Monday, read one standup digest, approve four things, reject one with a sentence explaining why — and the company moved a week's worth without you writing anything yourself.

---

## 2. Ground rules

| Rule | Consequence for the design |
|---|---|
| Runs on your device only | Bind to `127.0.0.1` only. No inbound port on the LAN. No auth server — a local passphrase unlocks the secrets file. |
| One user, ever | No roles/permissions system, no orgs, no invites. Every table is single-tenant. Saves ~40% of the code an app of this shape usually needs. |
| Your data stays yours | SQLite at `~/.foreman/foreman.db`, artifacts as plain files in `~/.foreman/files/`. Backup = copy the folder. No telemetry, ever. |
| **No vendor in the core** | The tick loop, the tools, the permission classifier, the transcripts and the audit log know nothing about Anthropic or OpenAI. Vendor knowledge lives in two adapter files and one config file. |
| Cheap to run | One agent at a time by default. Cache-friendly context assembly. Model tiering by task. A hard daily spend cap that stops the loop, not just warns. |
| Nothing irreversible without you | Every tool is classified `safe` / `guarded` / `forbidden` before the runtime will execute it. Guarded means it queues. |
| Laptops sleep | Every run is checkpointed to the DB before and after the model call, so an interrupted run resumes or fails cleanly rather than half-executing. |

---

## 3. The staff

Every role is a **markdown charter file** on disk (`~/.foreman/charters/sales.md`) plus a row in the DB holding its tool grants, autonomy levels, provider, model tier, and effort. Charters are yours to edit — that's the main way you manage these employees.

Charters are **provider-neutral by rule.** A charter describes the job, never the model. Anything a specific vendor's model needs to be told about *how* to call tools or format output lives in that provider's adapter preamble, not in the job description. This is what lets you move a role from Claude to ChatGPT by changing one field.

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
## Learned          — appended automatically from your rejections
```

### The seven roles

**COO — the only one that plans.**
Converts your goals into initiatives and tasks, assigns them, sequences them, reviews finished work against its definition of done, writes the daily standup, and escalates. It does not do the work itself — it has no tools except the work-graph tools and read access to artifacts. This is deliberate: keeping planning and doing in separate agents is what stops the whole thing collapsing into one confused agent that plans, half-does, and reports success.
*Suggested: Claude Opus 5 at high effort. Keep this role on one vendor permanently — planning style is the thing you least want drifting.*

**Web Developer — ships code, never deploys.**
Works in a local git clone of the Cubekrafts repo at a path you configure. Reads, edits, runs the test/lint/build commands, commits to a branch named `foreman/<task-id>`. It **cannot** push to `main`, cannot run deploy scripts, and cannot touch anything outside the clone directory. Its deliverable is a branch plus a plain-English diff summary in the approvals queue.
*Suggested: Claude Opus 5 at xhigh effort, with the other vendor's strongest reasoning model as second reader on any diff over ~100 lines (§4).*

**Sales — drafts, never sends.**
Pulls new inquiries from the Cubekrafts API (read-only token), qualifies each against your ICP, writes the first reply and a two-touch follow-up sequence, and maintains a pipeline with stages and next actions. Every outbound message lands in the approvals queue with the lead's context beside it. It also keeps a running list of objections it's seeing, which is the single most valuable thing it produces for marketing.
*Suggested: a mid tier for drafting, the cheapest tier for the initial qualify pass. A good candidate for an A/B across vendors (§10) — reply quality is easy for you to judge.*

**Marketing — plans, doesn't publish.**
Owns the channel calendar, campaign briefs, keyword and competitor research (web search with a domain allowlist), landing-page concepts, and budget proposals. Its output is briefs that Content and the Web Developer execute against. Any proposed spend is a guarded action with a number attached.

**Content — writes to brief.**
Turns marketing briefs into posts, case studies, product page copy, and social. Reads the brand-voice canon and the last ten approved pieces before writing, so voice drifts slowly rather than per-piece. Output is a markdown artifact; publishing is a separate guarded step.
*Content volume is where token spend concentrates, so this is the role where a vendor price difference actually shows up on the monthly bill. Worth measuring rather than guessing.*

**Finance / Analyst — the one that says no.**
Unit economics per product, quote and ROI math, weekly numbers (leads, conversion, content shipped, site changes), and — importantly — tracks Foreman's own API spend **split by vendor** and tells you when a role is burning money for no output. Read-only on everything.

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
                                  │                   provider.turn()      │
                                  │                   uses tools           │
                                  │                      │                 │
                                  │                 ┌────┴────┐            │
                                  │            safe tool   guarded tool ──►│ approvals
                                  │             executes      queues       │ inbox
                                  │                 └────┬────┘            │
                                  │                      │                 │
                              reviews ◄──────────── produces artifact      │
                              vs. DoD                    │                 │
                                  │             (optional) second reader   │
                    ┌─────────────┼─────────────┐   on the other vendor    │
                 accept      send back      escalate ────────────────────► │
                                (max 2)                                    │
```

### The tick

A single loop, default every 10 minutes, plus an instant tick when you press "Run now" or approve something.

```
tick():
  if paused or daily_spend >= cap: return
  task = next ready task            # deps satisfied, role enabled, slot free
  if none: return
  run = start_run(task)             # checkpoint BEFORE the model call
  result = agent_loop(task)         # our loop — see below
  finish_run(run, result)           # checkpoint AFTER
  if deliverable complete: queue COO review
```

Concurrency defaults to **1**. Two agents editing the same repo checkout or the same artifact is the most obvious way to make this produce garbage, and on a laptop you gain nothing from parallelism except a bigger bill.

### Foreman owns the agent loop

Both vendors ship a helper that runs the call-tool-call-again cycle for you. **Foreman uses neither.** The loop is about thirty lines, and it is where the permission classifier, the budget check, the checkpoint, and the audit write all live:

```
agent_loop(task):
  msgs = build_context(task)                  # neutral format, see §10
  for step in 1..MAX_STEPS:
    result = provider.turn({ msgs, tools, effort, budget })
    audit(result.usage, result.costUsd)
    if result.finish == 'end':       return result
    if result.finish == 'refused':   return escalate(result)
    if result.finish == 'truncated': return retry_with_more_room(result)
    for call in result.toolCalls:
      cls = classify(role, call)              # safe | guarded | forbidden
      if cls == 'forbidden': abort_run(); return
      if cls == 'guarded':   queue_approval(call); park_run(); return
      msgs += tool_result(call, execute(call))
```

Handing that loop to a vendor SDK would mean a tool executing before the classifier saw it, and would mean writing the security boundary twice, in two shapes, from two sets of documentation. Adapters do exactly one thing: **one model call in, one normalised result out.**

### Review, not vibes

When a role marks a task complete, the COO gets the artifact and the task's definition of done and returns one of three verdicts:

- **accept** → artifact finalised, task closed, dependents unblocked
- **revise** → back to the role with specific, numbered feedback (max 2 rounds, then auto-escalate — an agent on its third revision is a task that was specified wrong)
- **escalate** → straight to you, with the disagreement stated in one paragraph

### The second reader

On tasks you mark high-stakes — a code diff, a pricing page, anything customer-facing at volume — the COO sends the finished artifact to a **model from the other vendor** for an independent read before it reaches you. The second reader gets the artifact and the definition of done, and nothing else: not the author's reasoning, not the transcript. It returns a short list of concrete objections, or "no objections".

This is the strongest reason to run two vendors, and it is worth more than any per-token price difference. Two models trained by different labs on different data fail differently, so an independent read catches the confident-and-wrong outputs that a self-review will not. It costs one extra call on a small fraction of tasks.

Configurable per task type, defaulting to on for diffs and published pages, off for everything else.

---

## 5. Permission, autonomy, and the things that keep this safe

### Every tool call is classified before it runs

```ts
type Effect = 'safe' | 'guarded' | 'forbidden'
// safe      — reversible, local, invisible outside this machine. Executes.
// guarded   — outbound, spends money, or writes to something you own. Queues.
// forbidden — not for this role, ever. Refused, logged, run aborted.
```

The classification is a function of `(role, tool, arguments)` — not just the tool. `git.commit` on a `foreman/*` branch is safe; on `main` it's forbidden. `http.fetch` to an allowlisted domain is safe; anywhere else it's guarded. Enforced in the runtime, not requested in the prompt, because a prompt is a suggestion and a switch statement is not.

**This is also why the loop is ours (§4).** The classifier sits between the model's tool call and the tool's execution. That position has to be vendor-independent, or you are trusting two different SDKs to enforce your security boundary identically.

### The autonomy ladder

Set per `(role, tool)` pair from the UI:

| Level | Behaviour |
|---|---|
| **L0 Propose** | Agent describes what it would do. Never executes. Good for a role's first week. |
| **L1 Approve** | Executes only after you approve, with a full preview of the effect. **The default for everything guarded.** |
| **L2 Notify** | Executes immediately, you get a notification and a one-click undo window. |
| **L3 Auto** | Executes silently, appears only in the audit log. Earn this one tool at a time. |

Promote a specific tool to L2 after you've approved ~20 of them without editing. That ratcheting is the whole trust model — not a setting you configure up front, something the org earns.

**Autonomy is per role, not per vendor.** Moving a role to a different model does not change what it's allowed to do. If a vendor swap made a role more capable of harm, the permission model was wrong to begin with.

### The approvals inbox

The most important screen in the app. Each item shows:

- **what will happen**, rendered as the actual effect — the email as it will send, the diff as it will apply, the ₹ figure as it will be spent
- **why**, in the agent's own words, one paragraph
- **who wrote it** — role, vendor, and model, because after a month you will start noticing patterns
- four buttons: **Approve** / **Edit & approve** / **Reject with reason** / **Always allow this**

**Rejections are training data.** A rejection with a reason gets appended to that role's `## Learned` section, so the next context pack includes it. This is the loop that makes month three better than month one, and it costs almost nothing to build.

### Hard guardrails, all enforced in code

- **Kill switch** — one button pauses every agent, mid-run.
- **Offline mode** — blocks all egress except the model API hosts you have enabled. Agents keep working on local artifacts.
- **Filesystem jail** — every path resolved and checked against allowed roots before any read or write. Resolve first, then compare, or `../` and symlinks walk straight out.
- **Domain allowlist** for all outbound HTTP.
- **Daily and monthly spend caps**, enforced across both vendors combined, plus a per-run token ceiling.
- **Full audit log** — every tool call with arguments, result hash, timestamp, run ID, vendor, model. Append-only.
- **Secrets never enter a prompt.** Both API keys live in the OS keychain, are injected by the tool implementation at call time, and are redacted from all logs. An agent never sees a credential, so no prompt injection can leak one.

### Treat inbound content as hostile

Lead messages, fetched web pages, and competitor sites are **untrusted input** — wrapped in a delimiter block with an explicit instruction that content inside is data, never instructions. Combined with every consequential action being guarded, an injection attempt in an inquiry form can at worst produce a weird draft that you reject.

Injection resistance differs between vendors and between model versions. Don't treat a vendor swap as behaviour-neutral here: the delimiting and the approval gate are what you actually rely on, and they hold either way.

---

## 6. Memory

Three tiers, deliberately boring:

**Canon** — files you own in `~/.foreman/canon/`: brand voice, pricing, product specs, ICP, competitor notes, past-project case studies. Loaded whole into the cached prefix for the roles that need it. The highest-leverage thing you will ever type into this app.

**Working memory** — the task, its artifacts, and its run history. Scoped to the task, dropped when it closes.

**Recall** — SQLite **FTS5** full-text index over every artifact, run summary, approval decision, and rejection reason, retrieved top-k into the context pack. No vector database: at a few thousand documents on one machine, FTS5 is fast, debuggable, and has zero moving parts. If recall genuinely disappoints after a few months, the upgrade path is `sqlite-vec` with local embeddings — same table, one extra column.

Memory is stored as plain text, not as vendor-formatted messages, so it reads the same to whichever model is asking.

---

## 7. The capability layer (tools)

Tools are defined once, in **JSON Schema**, which is the format both vendors accept for function parameters. Authoring them with a schema library is fine; the schema object is the source of truth and each adapter translates it into that vendor's envelope.

| Tool | Given to | Default class |
|---|---|---|
| `fs.read` / `fs.write` / `fs.list` | dev, content, all (scoped roots) | safe within jail |
| `git.status/diff/branch/commit` | dev | safe on `foreman/*` |
| `git.push` | dev | **guarded** (forbidden to `main`) |
| `shell.run` (allowlisted commands only) | dev | safe |
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

`ask_founder` is worth calling out: giving agents a first-class way to say "I need a decision" is what prevents them from inventing an answer and confidently proceeding. Because it's a tool, the question is structured, attributable, and parks the task instead of failing it.

**Keep the tool set small and identical across vendors.** Every tool you add is a schema two different models have to interpret the same way. A tool that works on one and confuses the other is a tool with a bad description, and the fix is the description, not a per-vendor branch.

---

## 8. Data model

SQLite. `better-sqlite3` with numbered `.sql` migrations — synchronous API suits a single-process local app, and FTS5 is available without fighting an ORM.

```sql
-- org
role(id, name, charter_path, provider, tier, effort,
     enabled, concurrency, second_reader_provider, created_at)
tool_grant(role_id, tool, autonomy, config_json)

-- work graph
goal(id, title, why, target_date, status)
initiative(id, goal_id, title, owner_role, status)
task(id, initiative_id, title, spec, definition_of_done,
     owner_role, status, priority, due, blocked_by_json,
     high_stakes, revision_count, created_at, closed_at)
     -- status: draft|ready|running|blocked|review|revise|done|cancelled

-- execution
run(id, task_id, role_id, provider, model, effort, status,
    started_at, ended_at,
    input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
    cost_usd, summary, error)
tool_call(id, run_id, tool, args_json, effect_class,
          approved_by, result_hash, ok, ms, created_at)
message(id, run_id, seq, role, content_json)  -- NEUTRAL format, never wire format
provider_payload(run_id, step, request_json, response_json)  -- debug only, prunable

-- outputs & decisions
artifact(id, task_id, kind, title, path, status, version, created_at)
review(id, artifact_id, reviewer_role, reviewer_provider, kind,
       verdict, notes, created_at)           -- kind: coo | second_reader
approval(id, run_id, tool_call_id, kind, preview_json, status,
         decided_at, reason, promoted_to_l2)
question(id, task_id, role_id, text, answer, asked_at, answered_at)

-- comparison
ab_trial(id, task_id, run_a, run_b, winner, note, decided_at)

-- business objects (Foreman's own copy — never writes back in v1)
lead(id, source_id, name, email, location, message, stage,
     score, next_action, next_action_at, synced_at)
campaign(id, title, channel, status, budget, brief_artifact_id)
content_piece(id, title, channel, status, artifact_id, published_at)

-- knowledge & ops
memory(id, kind, ref_table, ref_id, text, created_at)
memory_fts(text)
audit(id, at, actor, action, subject, detail_json)
setting(key, value_json)
spend_day(date, provider, usd, input_tokens, output_tokens)
```

Three things here exist specifically because of the two-vendor decision:

**`message` stores Foreman's own neutral format, never a vendor's wire format.** The two vendors attach tool results differently, place system instructions differently, and identify tool calls differently. If transcripts are stored in one vendor's shape, you can never replay a run on the other — and replay-after-editing-a-charter is how you will actually debug agent behaviour. Adapters render neutral → wire on every call. `provider_payload` keeps the raw request and response for debugging and can be pruned on a schedule.

**`run` splits cached from uncached input tokens and stores `cost_usd` computed at write time**, from the price table for that vendor and model. Prices change and vendors add models; a stored cost is a fact, a recomputed one is a guess.

**`spend_day` is keyed by provider**, because the first question you'll ask when the bill looks wrong is which vendor it came from.

---

## 9. The interface

Seven screens. React + Vite, served by the same local process, live over SSE.

**HQ** — today's standup from the COO in plain English, active tasks, approvals waiting, spend today vs. cap **split by vendor**, and four KPI tiles.

**The Org** — a card per role: on/off toggle, current task, **vendor + tier + effort selector**, autonomy sliders per tool, cost this week, last five outputs, and an **Edit charter** button. Changing a role's vendor shows a one-line warning that its prompt cache starts cold.

**Board** — kanban by status, swimlanes by role, filterable by goal. Click through to any task's full run history.

**Room** — one thread per role. You chat with an agent directly; its autonomous runs appear inline with collapsible tool calls.

**Approvals** — the queue from §5, keyboard-driven, with the author's vendor and model on every item.

**Artifacts** — everything produced, with version history, diff view, and any second-reader objections attached.

**Numbers** — pipeline, content shipped, site changes, model spend by role/vendor/day, cache-hit rate, average task cycle time, and the A/B ledger: which vendor you picked when you were shown both blind.

---

## 10. The model layer: two vendors, one organisation

This is the section that changed when ChatGPT entered the picture. The goal is that **adding, removing, or swapping a vendor is a config edit**, and that no vendor concept appears anywhere above the adapter boundary.

### One interface, two implementations

```ts
type Effort = 'low' | 'medium' | 'high' | 'max'

interface TurnRequest {
  model: string
  system: Block[]             // stable blocks first; adapter marks the cache boundary
  messages: NeutralMessage[]  // Foreman's own format
  tools: ToolSpec[]           // JSON Schema
  effort: Effort
  maxOutputTokens: number
  taskBudgetTokens?: number
}

interface TurnResult {
  finish: 'end' | 'tool_calls' | 'refused' | 'truncated' | 'error'
  text: string
  toolCalls: { id: string; name: string; args: unknown }[]
  usage: { input: number; cachedInput: number; output: number; reasoning: number }
  costUsd: number
  raw: unknown                // stored for debugging, never read by logic
}

interface Provider {
  id: 'anthropic' | 'openai'
  turn(req: TurnRequest): Promise<TurnResult>
  stream(req: TurnRequest): AsyncIterable<{ delta: string } | { done: TurnResult }>
}
```

**The test for whether this abstraction is holding:** if `TurnRequest` or `TurnResult` grows a field only one vendor understands, it has failed. Push it below the boundary.

### What each adapter owns

| Concern | Why it can't live above the boundary |
|---|---|
| Message wire format | Tool results attach as content blocks in one vendor's scheme and as separate role-tagged messages keyed by call ID in the other. |
| System instruction placement | One takes a top-level system field and supports appending operator messages mid-conversation; the other carries system/developer messages inline. |
| Tool schema translation | Same JSON Schema, different envelope and different strictness flags. |
| Cache directives | One wants explicit cache breakpoints in the request; the other caches long prefixes automatically. Same discipline, different mechanics. |
| Effort mapping | Foreman's four levels map onto each vendor's own reasoning control. Stored as Foreman's enum, never the vendor's string. |
| Refusal and stop-reason normalisation | Both can decline or truncate and both signal it completely differently. Everything above sees one of five `finish` values. |
| Usage → cost | Field names differ and cached input is priced differently. The adapter emits the neutral usage shape and prices it from the catalog. |
| Retry and fallback | Rate limits, overloads, and vendor-side declines are handled inside the adapter, so a transient 429 never surfaces as a failed task. |

### Vendor is a property of the role, not of the tick

Set it once per role and leave it. Two reasons:

1. **Caches are per model, per vendor.** Both discount repeated prefixes heavily, and the charter-plus-canon prefix is the bulk of every request. Alternating a role between vendors pays a cold prefix every single tick, which can cost more than the model choice saves.
2. **Behaviour comparison needs a stable baseline.** If a role's output quality changes and its model changed too, you've learned nothing.

Change it deliberately, from the Org screen, with the cold-cache warning shown. Then leave it for a week.

### The context assembly rule is the same for both

Order the request: **tool schemas → charter → canon → [cache boundary] → task, retrieved memory, date, metrics.** Stable content first, volatile last. One vendor needs the boundary marked explicitly; the other finds it. Getting this wrong is the easiest expensive mistake available here — a timestamp in the charter header defeats caching on both, silently, with no symptom other than the bill.

Log cached-input tokens on every run. If that number is zero across consecutive runs of the same role, something in the prefix is moving. Find it before doing anything else.

### The model catalog is config, not code

`~/.foreman/models.json`, editable without a rebuild:

```json
{
  "anthropic": {
    "top":   { "model": "claude-opus-5",    "in": 5.00, "cachedIn": 0.50, "out": 25.00 },
    "mid":   { "model": "claude-sonnet-5",  "in": 3.00, "cachedIn": 0.30, "out": 15.00 },
    "cheap": { "model": "claude-haiku-4-5", "in": 1.00, "cachedIn": 0.10, "out":  5.00 }
  },
  "openai": {
    "top":   { "model": "<pin at build time>", "in": null, "cachedIn": null, "out": null },
    "mid":   { "model": "<pin at build time>", "in": null, "cachedIn": null, "out": null },
    "cheap": { "model": "<pin at build time>", "in": null, "cachedIn": null, "out": null }
  }
}
```

Roles reference a **tier** (`top` / `mid` / `cheap`) plus a vendor, never a raw model string. Both vendors ship new models faster than you'll want to edit code, and the tier indirection makes upgrading the whole org one line.

The Anthropic figures are current as of this plan, per million tokens. **The OpenAI model IDs and prices are deliberately left null** — fill them from OpenAI's own model and pricing pages when you build that adapter rather than trusting anything written here from memory. Add a startup check that refuses to run a role whose catalog entry has a null price, so a missing number never becomes a free-looking bill.

### Known divergences, and how they're normalised

- **Sampling knobs.** Some models reject `temperature` outright; others accept it. Foreman's interface simply doesn't expose it — voice is steered by the charter's `## Voice` section, which works everywhere and is inspectable.
- **Reasoning tokens** are billed as output on both, but only some models report them separately. `usage.reasoning` is nullable and cost math must not depend on it.
- **Parallel tool calls.** Both can return several calls in one turn. Foreman classifies each independently and stops at the **first guarded call**, queueing it and parking the run. Don't execute the safe ones and queue the rest — partial execution of a multi-call turn produces half-finished states you can't reason about.
- **Structured output.** Both support strict JSON-schema-constrained output under different parameter names. The adapter takes a schema and returns parsed JSON or a `truncated` finish.
- **Long-run controls.** One vendor exposes a task budget the model can see and pace itself against; where that isn't available, the adapter enforces the same ceiling by counting tokens across the loop and returning `truncated`. Behaviour above the boundary is identical; only the graceful wrap-up is lost.
- **Streaming events** differ entirely. Both reduce to text deltas plus a final result, which is all the UI needs.

### A/B, so the choice is measured rather than argued

For a task type you're unsure about, mark it for trial: the same spec runs on both vendors, both artifacts are kept, and Approvals shows them side by side **with the vendor hidden until you pick**. Your pick is recorded in `ab_trial`.

Twenty trials on content drafts will tell you more than any benchmark, because the thing being measured is whether *you* would send it. Keep trials rare — they double that task's cost — and turn them off once a role has a clear winner.

### The honest cost of two vendors

Two SDKs, two auth paths, two sets of failure modes, two behaviours to tune against, and a class of bug that appears on only one of them. The mitigation is a **narrow interface and small adapters**: if either adapter grows past a few hundred lines, or starts making decisions rather than translating, work has leaked out of the core into the wrong place. Build the boundary in phase 0 with one implementation behind it; add the second when there's real work to compare on.

---

## 11. What it costs

A typical role turn: ~15k input (mostly cache reads after the first), ~3k output.

| Scenario | Runs/day | Rough daily | Rough monthly |
|---|---|---|---|
| Quiet (COO + content only) | 8 | $0.30–0.60 | $10–20 |
| Normal (all roles, one goal active) | 25 | $1.50–3 | $45–90 |
| Heavy (dev agent on a real feature) | 40+ | $4–8 | $120–240 |

Add roughly **10–15%** for second-reader passes if enabled on diffs and published pages, and **double the cost of any task in an A/B trial**. Both are worth it in small doses and ruinous as defaults.

Set the daily cap — $5 is a sane start — as a hard stop across both vendors combined, not per vendor, or a runaway loop just moves to the other one. Set a spend limit on each vendor's dashboard too: the app's cap protects you from the app, the vendor's cap protects you from a bug in the app.

---

## 12. Local API surface

Everything on `127.0.0.1:7777`. The React app is the only consumer.

```
GET  /api/hq                       dashboard payload
GET  /api/stream                   SSE: runs, approvals, questions, spend

GET  /api/roles                    list with live status
PATCH/api/roles/:id                enable, provider, tier, effort, concurrency
GET  /api/roles/:id/charter        raw markdown
PUT  /api/roles/:id/charter        save (bumps a charter version)
PATCH/api/roles/:id/grants/:tool   set autonomy level

GET  /api/providers                configured vendors, key status, catalog
POST /api/providers/:id/test       one cheap call — confirms key, model ID, pricing

POST /api/goals                    create a goal → COO plans it
GET  /api/tasks                    filter by status/role/goal
POST /api/tasks/:id/run            run now
POST /api/tasks/:id/trial          run on both vendors, queue blind comparison
POST /api/tasks/:id/cancel

GET  /api/approvals                pending queue
POST /api/approvals/:id/decide     approve | edit | reject(reason) | always-allow

GET  /api/questions                open questions from agents
POST /api/questions/:id/answer

GET  /api/artifacts                filter by kind/role/task
GET  /api/runs/:id                 neutral transcript + tool calls + raw payloads

POST /api/control/pause            kill switch
POST /api/control/offline          egress lockdown
GET  /api/spend                    daily/monthly, by role and vendor
```

---

## 13. Build order

Each phase ends with something you actually use. Nothing is built "for later" — except the provider boundary, which is the one thing genuinely cheaper to build on day one than to retrofit.

**Phase 0 — one agent, end to end (a weekend).**
SQLite + migrations, the tick loop, **our agent loop and the provider interface with exactly one adapter behind it**, the tool runtime with effect classification, the audit log, and one role: Content. Two tools, one guarded action, the approvals inbox, a bare HQ screen. Success: you type a goal, an agent writes a blog post, you approve it, and the whole thing is in the audit log.

**Phase 1 — the org appears.**
COO + the work graph, charters as files, the review/revise cycle, the standup digest, the Org and Board screens, the autonomy ladder in the UI. Success: you set one goal and get a sensible plan with tasks you didn't have to write.

**Phase 2 — the second vendor, and real business input.**
The OpenAI adapter behind the same interface, the model catalog, the vendor selector, per-vendor spend, and the provider test endpoint. Sales role: read-only inquiry sync, lead scoring, drafted replies, pipeline. Success: an inquiry arrives and a good reply is waiting within a tick — and you can move Content to the other vendor with one click and see both the cost and the quality difference.

**Phase 3 — it touches the product.**
Web Developer on a local clone: branch, edit, test, commit, diff preview, guarded push. Second reader enabled on diffs. Marketing + the content calendar feeding Content. Success: a real site change ships from a Foreman branch with an independent review attached.

**Phase 4 — it gets better on its own.**
Metrics loop, weekly review, charter self-tuning from your approve/reject reasons, the A/B ledger informing role defaults. Optional: package it so it's an icon you click.

---

## 14. The ways this fails, and what's in the design about it

| Failure | Mitigation already in the design |
|---|---|
| Agents produce plausible work nobody uses | Written definition of done before a task can be `ready`; COO reviews against it; Finance reports output-per-dollar per role. |
| Runaway spend | Hard daily cap across both vendors, per-run token ceiling, task budgets, cache-hit monitoring, tier-based selection. |
| Approval fatigue → rubber-stamping | The L1→L2 ratchet exists so the queue shrinks. Approving 50 things a day in week four means promote tools, not work faster. |
| An agent does something irreversible | Effect classification in the runtime, in *our* loop, not a vendor's. Dev agent branch-only. No live-site writes in v1. |
| Prompt injection via a lead's message | Untrusted input delimited and labelled as data; every consequential action guarded. Holds regardless of which model is running. |
| Voice drifts into generic slop | Brand canon in the cached prefix, last-ten-approved pieces in context, rejections appended to the charter. |
| **The abstraction leaks and the core fills with `if (provider === …)`** | One narrow interface, two small adapters, a stated size budget, and a rule that any vendor-only field goes below the boundary. A third `if` in the core means the interface is wrong. |
| **Cache thrash from switching vendors** | Vendor is a role property with a cold-cache warning, not a per-tick decision. Cached-token count surfaced per run. |
| **Silent price drift on a new model** | Prices live in the catalog; startup refuses to run a role whose model has no price entry. |
| **One vendor is down or declines the request** | Adapter-level retry; the role's second-reader vendor doubles as a manual failover you can flip from the Org screen. |
| **Two vendors, two prompt behaviours** | Charters stay vendor-neutral; per-vendor tool-use guidance lives in the adapter preamble, so tuning one never silently changes the other. |
| Context rot on long tasks | Runs checkpointed and summarised, not accumulated; vendor compaction where available, our own summarisation where not. |
| You stop using it in week three | Phase 0 must deliver something you'd miss. If the standup isn't worth reading on day five, fix that before building phase 1. |

---

## 15. Decisions I've made for you (change any of them)

| Decision | Why | The alternative |
|---|---|---|
| TypeScript, Node 20 | Two SDKs with a neutral schema layer between them is exactly where types earn their keep | Plain JS — faster to start, more runtime surprises at the boundary |
| **We own the agent loop; no vendor tool-runner** | The permission classifier must sit between the model's tool call and execution, and behave identically on both | Each SDK's loop helper — two loops, two security models, one eventually wrong |
| **Neutral transcripts in the DB** | Replay a run on either vendor after editing a charter | Store wire format — simpler today, locks every run to the vendor that produced it |
| **Roles reference a tier, not a model string** | Both vendors ship models faster than you'll edit code | Hardcode model IDs and update them everywhere each time |
| `better-sqlite3` + SQL migrations | Single process, synchronous, FTS5 without a fight | Prisma — familiar, but FTS5 needs raw queries anyway |
| DB-backed queue, in-process | No Redis, no second process, survives restarts | A real job queue — infrastructure for a problem you don't have |
| Concurrency 1 | Two agents in one repo checkout is a corruption bug waiting to happen | Higher, once tool sets are provably disjoint |
| Cubekrafts read-only in v1 | The blast radius of a bad write to a live business system isn't worth it in month one | Grant writes per-endpoint later, at L1 |
| Second adapter in phase 2, boundary in phase 0 | The interface is cheap now and expensive to retrofit; the second implementation needs real work to compare against | Both vendors from day one — twice the surface before you know the loop is right |

### Open questions only you can answer

1. **Which roles start on which vendor?** My default: COO and Web Developer on Claude, Content and Sales on OpenAI so the comparison is real, Finance on whichever bottom tier is cheaper.
2. **Do you already have an OpenAI API key with billing enabled**, and will you set a spend limit on that side too?
3. **Where's the Cubekrafts git clone going to live**, and which commands may the dev agent run (`npm test`, `npm run lint`, `npm run build`)?
4. **Email**: real SMTP send-after-approval, or drafts-to-a-folder that you paste? Drafts is safer for month one.
5. **Read-only Cubekrafts API token for Foreman**, or a nightly CSV export?
6. **Daily spend cap?** ($5 default, across both vendors combined.)

None of these block Phase 0.

---

## 16. Repo layout

This repository, at its root:

```
  package.json                  # its own deps — nothing shared with cubekrafts
  PLAN.md                       # this file
  README.md
  .gitignore
  src/
    server/         index.ts, routes/, sse.ts
    db/             migrations/*.sql, schema.ts, queries.ts
    agents/         loop.ts, context.ts, review.ts, second-reader.ts
    providers/      types.ts          # the interface — the whole contract
                    anthropic.ts      # adapter
                    openai.ts         # adapter
                    catalog.ts        # tiers, model IDs, prices
    tools/          registry.ts, effects.ts, fs.ts, git.ts, http.ts,
                    email.ts, cubekrafts.ts, work.ts, memory.ts
    guards/         jail.ts, allowlist.ts, budget.ts, audit.ts
    scheduler/      tick.ts
    ui/             React app
  data/                         # gitignored; real data lives in ~/.foreman
```

`src/providers/types.ts` is the most important file in the project. Everything in `agents/`, `tools/`, `guards/`, and `scheduler/` should be readable without knowing which vendor is behind it.

`~/.foreman/` holds `foreman.db`, `files/`, `charters/`, `canon/`, `models.json`, `secrets.enc`, and `config.json`. None of it is ever in git.

---

## 17. What I'd build first, given a day

`providers/types.ts`, one adapter behind it, our agent loop, the tool effect classifier, the audit log, and the approvals inbox — with one role and two tools. Not the org chart, not seven charters, not the KPI dashboard, and not the second vendor.

If a single agent can pick up a task, write something, get stopped at a guarded action, and wait for you, the company works. Everything after that is filling in employees — and everything in §10 is making sure it doesn't matter whose model they use.
