import type { Sql } from '../db/sql.ts';
import type { Claude, Message } from '../claude/client.ts';
import type { PolicyConfig } from '../domain/types.ts';
import { modelFor, type Effort } from '../claude/catalog.ts';
import { runAgent, type Outcome } from '../agents/loop.ts';
import { stableSystemFor } from '../agents/charters.ts';
import { PgAudit, addSpend, id } from '../db/repo.ts';
import type { ToolSinks } from '../tools/execute.ts';
import type { Snapshot } from './snapshot.ts';

/**
 * The slow half of the conversation.
 *
 * Anything the fast path did not recognise ends up here: the same agent loop
 * every role uses, on the cheapest model, with a tool set that can read
 * anything and dispatch work but cannot reach outside the building.
 *
 * Two things make this feel quick rather than merely correct. The snapshot is
 * pasted into the prompt, so most questions are answered without a single tool
 * round trip. And the step budget is small — a concierge that has taken six
 * turns is stuck, not thorough, and the founder is sitting there watching.
 */

export interface AskDeps {
  sql: Sql;
  claude: Pick<Claude, 'turn'>;
  policy: PolicyConfig;
  sinks: Partial<ToolSinks>;
  effort?: Effort;
  maxSteps?: number;
}

export interface AskResult {
  speech: string;
  /** Tools it actually used, in order, phrased for the activity line. */
  did: string[];
  costUsd: number;
  runId: string;
}

const MAX_STEPS = 6;

/**
 * The volatile half of the prompt.
 *
 * Kept out of the cached prefix on purpose — it contains a clock and it
 * changes every message, so anything after it would never hit the cache.
 */
export function situation(snapshot: Snapshot, now = new Date()): string {
  const lines = [
    `Right now, ${now.toISOString()}:`,
    `- approvals waiting on the founder: ${snapshot.approvals.length}`,
  ];
  for (const a of snapshot.approvals.slice(0, 8)) {
    lines.push(`    ${a.id} ${a.kind} (${a.role}) — ${a.summary}`);
  }
  lines.push(`- tasks running: ${snapshot.running.length}`);
  for (const r of snapshot.running.slice(0, 8)) {
    lines.push(`    ${r.role}: ${r.title} (${Math.round(r.runningMinutes)}m)`);
  }
  lines.push(`- questions nobody has answered: ${snapshot.questions.length}`);
  for (const q of snapshot.questions.slice(0, 8)) {
    lines.push(`    ${q.id} ${q.role} asks: ${q.text}`);
  }
  lines.push(
    `- spent today: $${snapshot.spendTodayUsd.toFixed(2)} of $${snapshot.spendCapUsd.toFixed(2)}`,
    `- work is ${snapshot.paused ? 'PAUSED' : 'running'}`,
    '',
    'This is a snapshot from the moment the founder pressed send. If the answer',
    'depends on anything not listed above, look it up rather than guessing.',
  );
  return lines.join('\n');
}

/** What each tool call becomes on the activity line under the answer. */
const NARRATION: Record<string, (args: Record<string, unknown>) => string> = {
  'org.look_up': (a) => `looked up ${String(a['view'])}`,
  'org.set_goal': (a) => `recorded the goal “${String(a['title'])}”`,
  'org.dispatch': (a) => `gave ${String(a['owner_role'])} a task: ${String(a['title'])}`,
  'org.answer': () => 'answered a parked question',
  'org.control': (a) => (a['paused'] === true ? 'stopped all work' : 'restarted work'),
  'memory.search': (a) => `searched past work for “${String(a['query'])}”`,
};

export async function ask(
  text: string,
  snapshot: Snapshot,
  deps: AskDeps,
  now = new Date(),
): Promise<AskResult> {
  const runId = id('talk');
  const audit = new PgAudit(deps.sql);
  const did: string[] = [];

  const initial: Message[] = [{ role: 'user', content: [{ type: 'text', text }] }];

  const result = await runAgent(initial, {
    runId,
    role: 'concierge',
    claude: deps.claude,
    // Haiku. The concierge is triage and lookup, and the founder is waiting.
    model: modelFor('cheap'),
    effort: deps.effort ?? 'low',
    policy: deps.policy,
    facts: {},
    audit,
    // Every tool the concierge holds is safe by construction; nothing it can
    // reach leaves the building. The classifier still checks each call.
    autonomy: () => 'auto',
    sinks: deps.sinks,
    stableSystem: stableSystemFor('concierge'),
    volatileSystem: [situation(snapshot, now)],
    maxSteps: deps.maxSteps ?? MAX_STEPS,
    // Read the calls as they are made rather than parsing them back out of
    // the transcript afterwards — `Message.content` is deliberately opaque,
    // and `TurnResult.toolCalls` is the same information already typed.
    onStep: async (_step, turn) => {
      for (const call of turn.toolCalls) {
        const line = NARRATION[call.name]?.(call.args);
        if (line) did.push(line);
      }
    },
  });

  if (result.costUsd > 0) {
    await addSpend(deps.sql, {
      usd: result.costUsd,
      inputTokens: result.usage.input + result.usage.cachedInput,
      outputTokens: result.usage.output,
    });
  }

  return { speech: speechFrom(result.outcome), did, costUsd: result.costUsd, runId };
}

/**
 * Every ending becomes something sayable.
 *
 * A concierge that returns nothing because the loop ran out of steps is worse
 * than one that admits it — the founder is looking at a spinner either way,
 * and only one of those tells them what to do next.
 */
function speechFrom(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'done':
      return outcome.text.trim() || 'Done.';
    case 'awaiting_founder':
      return outcome.question;
    case 'awaiting_approval':
      return `That needs your approval first — ${outcome.reason}. It is in your queue.`;
    case 'refused':
      return `I am not allowed to do that: ${outcome.reason}`;
    case 'aborted':
      return `I stopped partway: ${outcome.reason}`;
    case 'exhausted':
      return 'I went round in circles on that one. Try asking it more specifically.';
  }
}
