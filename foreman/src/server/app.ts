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
import { safeEqual } from '../auth/session.ts';
import { loadMessage, suppress } from '../email/messages.ts';
import { recordProviderEvent, type ProviderEventKind } from '../email/send.ts';
import { checkDomain, domainOf } from '../email/deliverability.ts';
import { buildStandup } from '../scheduler/standup.ts';
import { buildArchive } from './export.ts';
import type { SwitchingModel } from '../claude/runtime.ts';
import { status as connectionStatus, save as saveConnections } from './connections.ts';

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
  /** Shared secret for the provider's bounce webhook. Absent disables the route. */
  webhookSecret?: string;
  /** The swappable model client. Absent (in unit tests) disables the routes. */
  model?: SwitchingModel;
  /** Rebuild whatever reads the connection settings. Absent means no rebuild. */
  onConnectionsChanged?: () => Promise<void>;
}

/**
 * Attach the actual message to an email approval.
 *
 * One extra query on a list that is almost always shorter than five, in
 * exchange for the founder seeing the text they are agreeing to send.
 */
async function withEmailBodies(
  sql: Sql,
  pending: Awaited<ReturnType<typeof listPending>>,
): Promise<unknown[]> {
  return Promise.all(
    pending.map(async (item) => {
      if (item.tool !== 'email.send') return item;
      const draftId = item.args['draft_id'];
      if (typeof draftId !== 'string') return item;
      const message = await loadMessage(sql, draftId);
      if (!message) return { ...item, email: { missing: true } };
      return {
        ...item,
        email: {
          to: message.toAddress,
          subject: message.subject,
          body: message.body,
          // Shown so the founder can see that what they are reading is what
          // was frozen, rather than taking it on faith.
          hash: message.payloadHash.slice(0, 12),
        },
      };
    }),
  );
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

    // Approvals carry the thing being approved, not a description of it. An
    // email you cannot read in full is an email you cannot meaningfully
    // approve, and the whole design rests on the founder having read it.
    route('GET', '/api/approvals', 'session', async ({ res }) => {
      json(res, 200, await withEmailBodies(sql, await listPending(sql)));
    }),

    // What the provider tells us afterwards. Public because the provider has
    // no session, and authenticated by a shared secret compared in constant
    // time — a bounce that suppresses an address is worth forging.
    route('POST', '/api/webhooks/email', 'public', async ({ req, res }) => {
      const secret = deps.webhookSecret;
      if (!secret) {
        json(res, 404, { error: 'no webhook is configured' });
        return;
      }
      const offered = req.headers['x-foreman-webhook-secret'];
      if (typeof offered !== 'string' || !safeEqual(offered, secret)) {
        json(res, 401, { error: 'no' });
        return;
      }

      const body = await readJson(req);
      const kind = String(body['type'] ?? body['kind'] ?? '');
      const known: Record<string, ProviderEventKind> = {
        'email.delivered': 'delivered',
        'email.bounced': 'bounced',
        'email.complained': 'complained',
        'email.opened': 'opened',
        'email.clicked': 'clicked',
        delivered: 'delivered',
        bounced: 'bounced',
        complained: 'complained',
      };
      const mapped = known[kind];
      if (!mapped) {
        // Acknowledged, not acted on. Returning an error would make the
        // provider retry an event we will never understand.
        json(res, 200, { ignored: kind });
        return;
      }

      const data = (body['data'] ?? {}) as Record<string, unknown>;
      const result = await recordProviderEvent(sql, {
        kind: mapped,
        ...(typeof data['email_id'] === 'string' ? { providerId: data['email_id'] } : {}),
        ...(typeof data['to'] === 'string' ? { address: data['to'] } : {}),
        detail: data,
      });
      if (result.suppressed) bus.publish({ type: 'email.suppressed', kind: mapped });
      json(res, 200, { ok: true, suppressed: result.suppressed });
    }),

    // Whether the domain will actually let us send as it. Its own route
    // because it is a DNS lookup, and the email list should not wait on one.
    route('GET', '/api/email/dns', 'session', async ({ res }) => {
      const from = process.env['EMAIL_FROM'];
      const domain = from ? domainOf(from) : null;
      if (!domain) {
        json(res, 200, { configured: false, reason: 'no EMAIL_FROM is set' });
        return;
      }
      json(res, 200, {
        configured: true,
        ...(await checkDomain(domain, {
          ...(process.env['EMAIL_SPF_INCLUDE']
            ? { expectedInclude: process.env['EMAIL_SPF_INCLUDE'] }
            : {}),
        })),
      });
    }),

    route('GET', '/api/email', 'session', async ({ res }) => {
      const { rows } = await sql.query(
        `SELECT m.id, m.to_address, m.subject, m.status, m.created_at, m.sent_at
           FROM email_message m ORDER BY m.created_at DESC LIMIT 50`,
      );
      const { rows: suppressed } = await sql.query(
        `SELECT address, reason, created_at FROM email_suppression ORDER BY created_at DESC LIMIT 50`,
      );
      json(res, 200, { messages: rows, suppressed });
    }),

    // The founder's own override, for the person who replies "take me off this".
    route('POST', '/api/email/suppress', 'session', async ({ req, res }) => {
      const body = await readJson(req);
      const address = String(body['address'] ?? '').trim();
      if (!address) {
        json(res, 400, { error: 'which address?' });
        return;
      }
      await suppress(sql, address, 'manual', typeof body['detail'] === 'string' ? body['detail'] : undefined);
      json(res, 200, { ok: true });
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

    route('GET', '/api/connections', 'session', async ({ res }) => {
      json(res, 200, await connectionStatus(sql));
    }),

    // Same gate as the API key and the spend cap: these are credentials to
    // other people's systems, and a stolen session should not be able to
    // point Foreman at a different database or repository.
    route('POST', '/api/connections', 'fresh', async ({ req, res }) => {
      const body = await readJson(req);
      await saveConnections(sql, body);
      // Rebuilt rather than left until the next restart, so pasting a secret
      // and pressing the button is the whole action.
      await deps.onConnectionsChanged?.();
      json(res, 200, await connectionStatus(sql));
    }),

    route('GET', '/api/model', 'session', async ({ res }) => {
      if (!deps.model) {
        json(res, 200, { provider: 'none', model: null, keySource: null, keyHint: null, lastCheck: 'not wired' });
        return;
      }
      json(res, 200, deps.model.status());
    }),

    // Setting the key is joining the dangerous four: a key directs spending
    // and impersonates the account it belongs to, so it wants a recent
    // passkey — and it goes into the database, never into a log or the export.
    route('POST', '/api/model/key', 'fresh', async ({ req, res }) => {
      if (!deps.model) {
        json(res, 503, { error: 'the model is not wired in this configuration' });
        return;
      }
      const body = await readJson(req);
      const raw = body['apiKey'];
      // Whitespace comes along with a paste surprisingly often, and a null or
      // empty box means "go back to whatever it was before I pasted one".
      const key = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
      try {
        const status = await deps.model.setKey(sql, key === '' ? null : key);
        bus.publish({ type: 'model.changed', provider: status.provider, model: status.model });
        json(res, 200, status);
      } catch (err) {
        json(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
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

    route('GET', '/api/standup', 'session', async ({ res }) => {
      json(res, 200, await buildStandup(sql));
    }),

    // The last of the dangerous four: one file containing the whole business,
    // which is exactly the file somebody with a stolen session would want.
    route('GET', '/api/export', 'fresh', async ({ res }) => {
      const archive = await buildArchive(sql);
      const text = JSON.stringify(archive, null, 2);
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(text),
        'content-disposition': `attachment; filename="foreman-${archive.exportedAt.slice(0, 10)}.json"`,
      });
      res.end(text);
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
          const inm = req.headers['if-none-match'];
          if ((await serveAsset(res, webDir, url.pathname, inm)).served) return;
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
