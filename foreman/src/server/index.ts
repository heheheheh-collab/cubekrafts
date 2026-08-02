import { Pool } from 'pg';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Sql } from '../db/sql.ts';
import { migrate } from '../db/migrate.ts';
import { setSetting, getSetting } from '../db/repo.ts';
import { Claude } from '../claude/client.ts';
import { modelFor } from '../claude/catalog.ts';
import { DEFAULT_POLICY, type PolicyConfig } from '../domain/types.ts';
import { stableSystemFor } from '../agents/charters.ts';
import { EventBus } from './events.ts';
import { createApp } from './app.ts';
import { startScheduler, SETTINGS, type TickDeps } from '../scheduler/tick.ts';
import { makeSinks } from '../tools/sinks.ts';
import { configFromEnv, sweepChallenges } from '../auth/passkey.ts';
import { sweep as sweepRateCounters } from '../auth/ratelimit.ts';
import { ask } from '../concierge/ask.ts';

/**
 * The entrypoint.
 *
 * Migrate, seed, wire, listen, tick.
 *
 * The bind address defaults to loopback and only opens up when `FOREMAN_HOST`
 * says so, which is what the deployed container sets. Authentication is on
 * either way: there is no flag that turns the gate off, because a flag like
 * that is eventually left on by accident.
 */

const PORT = Number(process.env['PORT'] ?? 7777);
const HOST = process.env['FOREMAN_HOST'] ?? '127.0.0.1';
const HOME = process.env['FOREMAN_HOME'] ?? join(homedir(), '.foreman');
/** True when something else terminates TLS and forwards the caller's address. */
const TRUST_PROXY = process.env['FOREMAN_TRUST_PROXY'] === 'true';

/** Who is on the payroll, and on which model. */
const STAFF = [
  { id: 'coo', tier: 'top', effort: 'high' },
  { id: 'content', tier: 'mid', effort: 'high' },
] as const;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const sql = pool as unknown as Sql;

  const applied = await migrate(sql);
  if (applied.length > 0) console.log(`applied ${applied.length} migration(s): ${applied.join(', ')}`);

  const roles: TickDeps['roles'] = {};
  const allowedRoots: PolicyConfig['allowedRoots'] = {};
  for (const member of STAFF) {
    await sql.query(
      `INSERT INTO role (id, name, model, effort, enabled) VALUES ($1, $1, $2, $3, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [member.id, modelFor(member.tier).model, member.effort],
    );
    const workspace = join(HOME, 'workspace', member.id);
    await mkdir(workspace, { recursive: true });
    allowedRoots[member.id] = [workspace];
    roles[member.id] = {
      name: member.id,
      tier: member.tier,
      effort: member.effort,
      stableSystem: stableSystemFor(member.id),
    };
  }

  if ((await getSetting<number | null>(sql, SETTINGS.dailyCapUsd, null)) === null) {
    await setSetting(sql, SETTINGS.dailyCapUsd, 5);
  }

  // The key is read at boot and never stored, logged, or shown to an agent.
  const hasKey = Boolean(process.env['ANTHROPIC_API_KEY']);
  console.log(`anthropic key: ${hasKey ? 'present' : 'MISSING — runs will fail'}`);

  const policy: PolicyConfig = {
    ...DEFAULT_POLICY,
    allowedRoots,
    allowedHosts: ['cubekrafts.com', '.cubekrafts.com'],
  };

  const bus = new EventBus();
  const claude = new Claude();
  const sinks = makeSinks(sql, HOME);

  const tickDeps: TickDeps = { sql, claude, policy, sinks, roles };

  const webauthn = configFromEnv();
  console.log(`origin: ${webauthn.origin} (relying party ${webauthn.rpID})`);

  const app = createApp({
    sql,
    bus,
    tickDeps,
    webauthn,
    security: {
      origin: webauthn.origin,
      https: webauthn.origin.startsWith('https:'),
      trustProxy: TRUST_PROXY,
    },
    ask: (text, snapshot) => ask(text, snapshot, { sql, claude, policy, sinks }),
    decideDeps: {
      context: ({ runId: _runId, role }) => ({
        claude,
        model: modelFor(tickDeps.roles[role]!.tier),
        effort: tickDeps.roles[role]!.effort,
        policy,
        facts: {},
        autonomy: () => 'approve',
        sinks,
        stableSystem: tickDeps.roles[role]!.stableSystem,
      }),
    },
  });

  const scheduler = startScheduler(tickDeps, {
    intervalMs: Number(process.env['TICK_MS'] ?? 10 * 60 * 1000),
    onResult: (r) =>
      bus.publish(
        r.ran
          ? { type: 'tick', ran: true, kind: r.kind, taskId: r.taskId }
          : { type: 'tick', ran: false, why: r.why },
      ),
  });

  // Expired challenges and spent rate-limit windows are dead weight rather
  // than a correctness problem, so they go on a slow timer rather than in the
  // request path.
  const janitor = setInterval(
    () => {
      void Promise.all([sweepChallenges(sql), sweepRateCounters(sql)]).catch((err: unknown) =>
        console.error('sweep failed', err),
      );
    },
    60 * 60 * 1000,
  );
  janitor.unref?.();

  app.listen(PORT, HOST, () => {
    console.log(`foreman listening on http://${HOST}:${PORT}`);
    console.log(`staff: ${STAFF.map((m) => m.id).join(', ')}`);
  });

  const shutdown = async () => {
    console.log('shutting down');
    clearInterval(janitor);
    scheduler.stop();
    bus.closeAll();
    app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
