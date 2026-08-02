import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Sql } from '../db/sql.ts';
import { EventBus } from './events.ts';
import { decide, listPending, ApprovalError, type DecideDeps } from '../agents/approvals.ts';
import { tick, SETTINGS, type TickDeps } from '../scheduler/tick.ts';
import { getSetting, setSetting, spendToday, id } from '../db/repo.ts';
import { fastPath } from '../concierge/intents.ts';
import type { Snapshot } from '../concierge/snapshot.ts';

/**
 * The HTTP surface.
 *
 * Node's own server and a small router, rather than a framework: the route
 * list is short, it is all one consumer, and a dependency here would be more
 * code than it saves.
 *
 * Phase 0 has no authentication. That is deliberate and it is why nothing is
 * deployed yet — §4 of the plan lands before this ever gets an address.
 */

export interface AppDeps {
  sql: Sql;
  bus: EventBus;
  tickDeps: TickDeps;
  decideDeps: Omit<DecideDeps, 'sql'>;
}

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:[a-zA-Z]+/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      }) +
      '/?$',
  );
  return { method, pattern, keys, handler };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A body larger than this is a bug or an attack, not a real request.
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

/** Everything the concierge answers from, read fresh. */
export async function buildSnapshot(deps: AppDeps): Promise<Snapshot> {
  const { sql } = deps;
  const pending = await listPending(sql);
  const { rows: running } = await sql.query<{ id: string; title: string; owner_role: string; started_at: Date }>(
    `SELECT t.id, t.title, t.owner_role, r.started_at
       FROM run r JOIN task t ON t.id = r.task_id
      WHERE r.status = 'running' ORDER BY r.started_at`,
  );
  const { rows: questions } = await sql.query<{ id: string; role_id: string; text: string; asked_at: Date }>(
    `SELECT id, role_id, text, asked_at FROM question WHERE answered_at IS NULL ORDER BY asked_at`,
  );
  const now = Date.now();

  return {
    at: new Date(),
    approvals: pending.map((a) => ({
      id: a.id,
      kind: a.tool,
      summary: a.reason,
      role: a.role,
      waitingMinutes: a.waitingMinutes,
    })),
    running: running.map((r) => ({
      id: r.id,
      title: r.title,
      role: r.owner_role,
      runningMinutes: (now - new Date(r.started_at).getTime()) / 60_000,
    })),
    questions: questions.map((q) => ({
      id: q.id,
      role: q.role_id,
      text: q.text,
      waitingMinutes: (now - new Date(q.asked_at).getTime()) / 60_000,
    })),
    spendTodayUsd: await spendToday(sql),
    spendCapUsd: await getSetting<number>(sql, SETTINGS.dailyCapUsd, 5),
    paused: await getSetting<boolean>(sql, SETTINGS.paused, false),
  };
}

export function buildRoutes(deps: AppDeps): Route[] {
  const { sql, bus } = deps;

  return [
    route('GET', '/api/health', (_req, res) => json(res, 200, { ok: true })),

    route('GET', '/api/stream', (_req, res) => {
      bus.subscribe(res);
    }),

    route('GET', '/api/snapshot', async (_req, res) => {
      json(res, 200, await buildSnapshot(deps));
    }),

    // The concierge fast path: recognised questions answered from the snapshot
    // with no model call at all. Anything else returns needsModel so the
    // caller can escalate rather than being handed a guess.
    route('POST', '/api/talk', async (req, res) => {
      const body = await readJson(req);
      const text = String(body['text'] ?? '');
      const snapshot = await buildSnapshot(deps);
      const answer = fastPath(text, snapshot);
      if (!answer) {
        json(res, 200, { needsModel: true, snapshot });
        return;
      }
      if (answer.effect === 'pause' || answer.effect === 'resume') {
        await setSetting(sql, SETTINGS.paused, answer.effect === 'pause');
        bus.publish({ type: 'paused', paused: answer.effect === 'pause' });
      }
      json(res, 200, { speech: answer.speech, card: answer.card, intent: answer.intent });
    }),

    route('GET', '/api/approvals', async (_req, res) => {
      json(res, 200, await listPending(sql));
    }),

    route('POST', '/api/approvals/:id/decide', async (req, res, params) => {
      const body = await readJson(req);
      const decision = body['decision'] === 'reject' ? 'reject' : 'approve';
      try {
        const result = await decide(
          {
            approvalId: params['id']!,
            decision,
            ...(typeof body['reason'] === 'string' ? { reason: body['reason'] } : {}),
            ...(body['confirmStale'] === true ? { confirmStale: true } : {}),
          },
          { sql, ...deps.decideDeps },
        );
        bus.publish({ type: 'approval.decided', approvalId: params['id']!, decision });
        json(res, 200, {
          executed: result.executed,
          outcome: result.resumed?.outcome.kind ?? null,
        });
      } catch (err) {
        // A stale item, an already-decided item, or a policy that changed
        // under the approval — all of these are the caller's to see plainly.
        if (err instanceof ApprovalError) {
          json(res, 409, { error: err.message });
          return;
        }
        throw err;
      }
    }),

    route('POST', '/api/goals', async (req, res) => {
      const body = await readJson(req);
      const title = String(body['title'] ?? '').trim();
      if (!title) {
        json(res, 400, { error: 'a goal needs a title' });
        return;
      }
      const goalId = id('goal');
      await sql.query('INSERT INTO goal (id, title, why) VALUES ($1, $2, $3)', [
        goalId,
        title,
        typeof body['why'] === 'string' ? body['why'] : null,
      ]);
      json(res, 201, { id: goalId });
    }),

    route('POST', '/api/tasks', async (req, res) => {
      const body = await readJson(req);
      const definitionOfDone = String(body['definition_of_done'] ?? '').trim();
      if (!definitionOfDone) {
        // The database enforces this too. Rejecting here gives a readable
        // reason instead of a constraint violation.
        json(res, 400, { error: 'a task needs a definition of done before it can run' });
        return;
      }
      const taskId = id('task');
      await sql.query(
        `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
              VALUES ($1, $2, $3, $4, $5, 'ready')`,
        [
          taskId,
          String(body['title'] ?? 'Untitled'),
          String(body['spec'] ?? ''),
          definitionOfDone,
          String(body['owner_role'] ?? 'content'),
        ],
      );
      json(res, 201, { id: taskId });
    }),

    route('GET', '/api/tasks', async (_req, res) => {
      const { rows } = await sql.query(
        `SELECT id, title, status, owner_role, priority, created_at
           FROM task ORDER BY created_at DESC LIMIT 100`,
      );
      json(res, 200, rows);
    }),

    route('POST', '/api/tick', async (_req, res) => {
      const result = await tick(deps.tickDeps);
      bus.publish(
        result.ran
          ? { type: 'tick', ran: true, taskId: result.taskId }
          : { type: 'tick', ran: false, why: result.why },
      );
      json(res, 200, result);
    }),

    route('POST', '/api/control/pause', async (req, res) => {
      const body = await readJson(req);
      const paused = body['paused'] !== false;
      await setSetting(sql, SETTINGS.paused, paused);
      bus.publish({ type: 'paused', paused });
      json(res, 200, { paused });
    }),

    route('GET', '/api/spend', async (_req, res) => {
      json(res, 200, {
        todayUsd: await spendToday(sql),
        capUsd: await getSetting<number>(sql, SETTINGS.dailyCapUsd, 5),
      });
    }),

    route('GET', '/api/runs/:id', async (_req, res, params) => {
      const { rows: runs } = await sql.query(`SELECT * FROM run WHERE id = $1`, [params['id']]);
      if (runs.length === 0) {
        json(res, 404, { error: 'no such run' });
        return;
      }
      const { rows: calls } = await sql.query(
        `SELECT seq, tool, effect_class, reason, ok, ms FROM tool_call WHERE run_id = $1 ORDER BY seq`,
        [params['id']],
      );
      json(res, 200, { run: runs[0], toolCalls: calls });
    }),

    route('GET', '/api/audit', async (_req, res) => {
      const { rows } = await sql.query(
        `SELECT at, actor, action, subject, detail FROM audit ORDER BY at DESC LIMIT 200`,
      );
      json(res, 200, rows);
    }),
  ];
}

export function createApp(deps: AppDeps): Server {
  const routes = buildRoutes(deps);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';

    for (const r of routes) {
      if (r.method !== method) continue;
      const match = r.pattern.exec(url.pathname);
      if (!match) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(match[i + 1] ?? '');
      });
      try {
        await r.handler(req, res, params);
      } catch (err) {
        if (!res.headersSent) {
          json(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
        } else {
          res.end();
        }
      }
      return;
    }

    json(res, 404, { error: `no route for ${method} ${url.pathname}` });
  });
}
