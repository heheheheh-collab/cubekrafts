/**
 * The narrowest possible database interface.
 *
 * Both `pg.Pool` and PGlite satisfy it, which is what lets the tests run the
 * real schema against a real Postgres engine while production talks to a
 * managed one. Nothing above this file knows which is which.
 */
export interface Sql {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;

  /**
   * Run a script containing several statements.
   *
   * Parameterised queries use the extended protocol, which accepts exactly one
   * statement — so a migration file cannot go through `query`. `pg` will run a
   * multi-statement string through `query` when no parameters are passed
   * (that path uses the simple protocol), while PGlite exposes it separately
   * as `exec`. Optional here, and callers fall back to `query`.
   */
  exec?(text: string): Promise<unknown>;
}

/** Run a multi-statement script through whichever path the driver offers. */
export async function execScript(sql: Sql, text: string): Promise<void> {
  if (sql.exec) {
    await sql.exec(text);
    return;
  }
  await sql.query(text);
}

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function transact<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  await sql.query('BEGIN');
  try {
    const out = await fn(sql);
    await sql.query('COMMIT');
    return out;
  } catch (err) {
    await sql.query('ROLLBACK');
    throw err;
  }
}
