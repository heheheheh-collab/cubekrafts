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

/**
 * The entrypoint.
 *
 * Migrate, seed, wire, listen, tick. Binds to loopback only — phase 0 has no
 * authentication, and the plan is explicit that nothing gets an address until
 * §4 lands.
 */

const PORT = Number(process.env['PORT'] ?? 7777);
const HOST = '127.0.0.1';
const HOME = process.env['FOREMAN_HOME'] ?? join(homedir(), '.foreman');

async function main(): Promise<void> {
  const workspace = join(HOME, 'workspace', 'content');
  await mkdir(workspace, { recursive: true });

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const sql = pool as unknown as Sql;

  const applied = await migrate(sql);
  if (applied.length > 0) console.log(`applied ${applied.length} migration(s): ${applied.join(', ')}`);

  await sql.query(
    `INSERT INTO role (id, name, model, effort, enabled)
          VALUES ('content', 'content', 'claude-sonnet-5', 'high', TRUE)
     ON CONFLICT (id) DO NOTHING`,
  );
  if ((await getSetting<number | null>(sql, SETTINGS.dailyCapUsd, null)) === null) {
    await setSetting(sql, SETTINGS.dailyCapUsd, 5);
  }

  // The key is read at boot and never stored, logged, or shown to an agent.
  const hasKey = Boolean(process.env['ANTHROPIC_API_KEY']);
  console.log(`anthropic key: ${hasKey ? 'present' : 'MISSING — runs will fail'}`);

  const policy: PolicyConfig = {
    ...DEFAULT_POLICY,
    allowedRoots: { content: [workspace] },
    allowedHosts: ['cubekrafts.com', '.cubekrafts.com'],
  };

  const bus = new EventBus();
  const claude = new Claude();
  const sinks = makeSinks(sql, HOME);

  const tickDeps: TickDeps = {
    sql,
    claude,
    policy,
    sinks,
    roles: {
      content: {
        name: 'content',
        tier: 'mid',
        effort: 'high',
        stableSystem: stableSystemFor('content'),
      },
    },
  };

  const app = createApp({
    sql,
    bus,
    tickDeps,
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
      bus.publish(r.ran ? { type: 'tick', ran: true, taskId: r.taskId } : { type: 'tick', ran: false, why: r.why }),
  });

  app.listen(PORT, HOST, () => {
    console.log(`foreman listening on http://${HOST}:${PORT}`);
    console.log(`workspace: ${workspace}`);
  });

  const shutdown = async () => {
    console.log('shutting down');
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
