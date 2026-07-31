/**
 * The audit log.
 *
 * Append-only, and written *around* every tool call — before, so an action
 * that crashes mid-flight still left a record that it was attempted, and
 * after, with the outcome. This is the thing you read when something strange
 * happened, so it stores what was asked for and a hash of what came back
 * rather than the full payload, which keeps it readable and bounded.
 */

export interface AuditEntry {
  at: Date;
  /** Who acted: a role name, `founder`, or `system`. */
  actor: string;
  /** Dotted verb: `tool.attempt`, `tool.result`, `tool.refused`, `run.start`… */
  action: string;
  /** What it acted on: a run id, a task id, a path. */
  subject?: string;
  detail: Record<string, unknown>;
}

export interface Audit {
  record(entry: Omit<AuditEntry, 'at'> & { at?: Date }): Promise<void>;
}

/** For tests, and for the first weeks before the database layer lands. */
export class MemoryAudit implements Audit {
  readonly entries: AuditEntry[] = [];

  async record(entry: Omit<AuditEntry, 'at'> & { at?: Date }): Promise<void> {
    this.entries.push({ ...entry, at: entry.at ?? new Date() });
  }

  /** Test helper: every action recorded, in order. */
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}
