import { createServer, type Server } from 'node:http';
import type { Sql } from '../db/sql.ts';
import { EventBus } from './events.ts';
import { decide, listPending, ApprovalError, type DecideDeps } from '../agents/approvals.ts';
import { tick, SETTINGS, type TickDeps } from '../scheduler/tick.ts';
import { getSetting, setSetting, spendToday, id } from '../db/repo.ts';
import { fastPath } from '../concierge/intents.ts';
import type { Snapshot } from '../concierge/snapshot.ts';
import type { AskResult } from '../concierge/ask.ts';
import { json, readJson, route, type Ctx, type Route } from './http.ts';
import { applySecurityHeaders, checkOrigin, type SecurityConfig } from './security.ts';
import { readCookie, verifySession } from '../auth/session.ts';
import { clientIp } from '../auth/log.ts';
import { authRoutes } from './auth-routes.ts';
import { configFromEnv, type WebAuthnConfig } from '../auth/passkey.ts';
import { defaultWebDir, serveAsset } from './static.ts';

/**
 * The HTTP surface.
 *
 * Every route declares what it demands of the caller and the dispatcher
 * enforces it in one place, before the handler runs. There is no per-handler
 * check to forget: a route that says nothing gets nothing, because `route()`
 * has no default for the level.
 */

export interface AppDeps {
  sql: Sql;
  bus: EventBus;
  tickDeps: TickDeps;
  decideDeps: Omit<DecideDeps, 'sql'>;
  security?: SecurityConfig & { trustProxy?: boolean };
  webauthn?: WebAuthnConfig;
  /** Where the front end lives. Set to null to run headless, as the tests do. */
  webDir?: string | null;
  /** The concierge's model path. Absent means only the fast path exists. */
  ask?: (text: string, snapshot: Snapshot) => Promise<AskResult>;
}

/** Everything the concierge answers from, read fresh. */
export async function buildSnapshot(deps: AppDeps): Promise<Snapshot> {
  const { sql } = deps;
  const pending = await listPending(sql);
  // LEFT JOIN, because the COO's supervision passes belong to no task and an
  // inner join would quietly hide the one agent that is actually working.
  const { rows: running } = await sql.query<{ id: string; title: string; role: string; started_at: Date }>(
    `SELECT r.id,
            COALESCE(t.title, 'supervising') AS title,
            COALESCE(t.owner_role, r.role_id) AS role,
            r.started_at
       FROM run r LEFT JOIN task t ON t.id = r.task_id
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
      role: r.role,
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
    // Health is public because a load balancer has no cookie.
    route('GET', '/api/health', 'public', ({ res }) => json(res, 200, { ok: true })),

    route('GET', '/api/stream', 'session', ({ res }) => {
      bus.subscribe(res);
    }),

    route('GET', '/api/snapshot', 'session', async ({ res }) => {
      json(res, 200, await buildSnapshot(deps));
    }),

    // The concierge fast path: recognised questions answered from the snapshot
    // with no model call at all. Anything else returns needsModel so the
    // caller can escalate rather than being handed a guess.
    route('POST', '/api/talk', 'session', async ({ req, res }) => {
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

    // The slow half. Reached only when the fast path did not recognise the
    // question, and 404 when no model path is wired up at all — the front end
    // says so plainly rather than inventing an answer.
    route('POST', '/api/ask', 'session', async ({ req, res }) => {
      if (!deps.ask) {
        json(res, 404, { error: 'no model path is configured' });
        return;
      }
      const body = await readJson(req);
      const text = String(body['text'] ?? '').trim();
      if (!text) {
        json(res, 400, { error: 'nothing to answer' });
        return;
      }
      const result = await deps.ask(text, await buildSnapshot(deps));
      bus.publish({ type: 'spend', todayUsd: await spendToday(sql), capUsd: await getSetting<number>(sql, SETTINGS.dailyCapUsd, 5) });
      json(res, 200, { speech: result.speech, did: result.did, runId: result.runId });
    }),

    route('GET', '/api/approvals', 'session', async ({ res }) => {
      json(res, 200, await listPending(sql));
    }),

    route('POST', '/api/approvals/:id/decide', 'session', async ({ req, res, params }) => {
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

    route('POST', '/api/goals', 'session', async ({ req, res }) => {
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

    route('POST', '/api/tasks', 'session', async ({ req, res }) => {
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

    route('GET', '/api/tasks', 'session', async ({ res }) => {
      const { rows } = await sql.query(
        `SELECT id, title, status, owner_role, priority, created_at
           FROM task ORDER BY created_at DESC LIMIT 100`,
      );
      json(res, 200, rows);
    }),

    route('POST', '/api/tick', 'session', async ({ res }) => {
      const result = await tick(deps.tickDeps);
      bus.publish(
        result.ran
          ? { type: 'tick', ran: true, kind: result.kind, taskId: result.taskId }
          : { type: 'tick', ran: false, why: result.why },
      );
      json(res, 200, result);
    }),

    route('POST', '/api/control/pause', 'session', async ({ req, res }) => {
      const body = await readJson(req);
      const paused = body['paused'] !== false;
      await setSetting(sql, SETTINGS.paused, paused);
      bus.publish({ type: 'paused', paused });
      json(res, 200, { paused });
    }),

    route('GET', '/api/spend', 'session', async ({ res }) => {
      json(res, 200, {
        todayUsd: await spendToday(sql),
        capUsd: await getSetting<number>(sql, SETTINGS.dailyCapUsd, 5),
      });
    }),

    // One of the dangerous four: raising the cap is how a compromised session
    // would turn a read into a bill, so it wants a recent passkey.
    route('POST', '/api/spend/cap', 'fresh', async ({ req, res }) => {
      const body = await readJson(req);
      const cap = Number(body['capUsd']);
      if (!Number.isFinite(cap) || cap < 0 || cap > 1000) {
        json(res, 400, { error: 'the cap must be a number between 0 and 1000' });
        return;
      }
      await setSetting(sql, SETTINGS.dailyCapUsd, cap);
      bus.publish({ type: 'spend.cap', capUsd: cap });
      json(res, 200, { capUsd: cap });
    }),

    route('GET', '/api/runs/:id', 'session', async ({ res, params }) => {
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

    route('GET', '/api/audit', 'session', async ({ res }) => {
      const { rows } = await sql.query(
        `SELECT at, actor, action, subject, detail FROM audit ORDER BY at DESC LIMIT 200`,
      );
      json(res, 200, rows);
    }),
  ];
}

export function createApp(deps: AppDeps): Server {
  const webauthn = deps.webauthn ?? configFromEnv();
  const security: SecurityConfig = deps.security ?? {
    origin: webauthn.origin,
    https: webauthn.origin.startsWith('https:'),
  };
  const trustProxy = deps.security?.trustProxy ?? false;
  const webDir = deps.webDir === undefined ? defaultWebDir() : deps.webDir;

  const routes = [
    ...authRoutes({ sql: deps.sql, webauthn, https: security.https }),
    ...buildRoutes(deps),
  ];

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    applySecurityHeaders(res, security);

    // Before the route table, so a cross-site post cannot reach a handler at
    // all — not even one that would have refused it for another reason.
    const origin = checkOrigin(req, security);
    if (!origin.ok) {
      json(res, 403, { error: `refused: ${origin.reason}` });
      return;
    }

    for (const r of routes) {
      if (r.method !== method) continue;
      const match = r.pattern.exec(url.pathname);
      if (!match) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(match[i + 1] ?? '');
      });

      try {
        // Resolved for public routes too: registration needs to know whether
        // the caller is the owner adding a second device.
        const session = await verifySession(deps.sql, readCookie(req.headers.cookie));
        if (r.auth !== 'public' && session === null) {
          json(res, 401, { error: 'sign in first' });
          return;
        }
        if (r.auth === 'fresh' && !session?.fresh) {
          // Not 401: the session is fine, it is the age that is wrong, and
          // the client needs to tell those apart to prompt for a passkey
          // rather than dumping the owner back at the sign-in screen.
          json(res, 403, { error: 'confirm with your passkey first', reauth: true });
          return;
        }

        const ctx: Ctx = { req, res, params, session, ip: clientIp(req, trustProxy) };
        await r.handler(ctx);
      } catch (err) {
        if (!res.headersSent) {
          json(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
        } else {
          res.end();
        }
      }
      return;
    }

    // The front end, after the API, and only for reads. It is deliberately
    // outside the gate: the shell and its script hold nothing secret, and
    // they are what draws the sign-in screen.
    if (webDir !== null && (method === 'GET' || method === 'HEAD')) {
      if (!url.pathname.startsWith('/api/')) {
        try {
          if ((await serveAsset(res, webDir, url.pathname)).served) return;
          // An unknown path that is not a file is a client-side route, so the
          // shell answers it and the browser sorts out what to draw.
          if ((await serveAsset(res, webDir, '/index.html')).served) return;
        } catch {
          if (!res.headersSent) json(res, 500, { error: 'could not read that asset' });
          return;
        }
      }
    }

    json(res, 404, { error: `no route for ${method} ${url.pathname}` });
  });
}
