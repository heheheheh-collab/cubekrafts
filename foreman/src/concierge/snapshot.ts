/**
 * The snapshot is the concierge's answer to "what is going on right now".
 *
 * It is refreshed on every tick and every write, kept small enough to sit in
 * the cached prompt prefix, and — more importantly — shaped so the most common
 * questions can be answered straight from it with **no model call at all**.
 * See PLAN.md §13.
 */

export interface PendingApproval {
  id: string;
  kind: string; // 'email' | 'push' | 'spend' | …
  summary: string; // one line, already human-readable
  role: string;
  waitingMinutes: number;
}

export interface RunningTask {
  id: string;
  title: string;
  role: string;
  runningMinutes: number;
}

export interface OpenQuestion {
  id: string;
  role: string;
  text: string;
  waitingMinutes: number;
}

export interface Snapshot {
  at: Date;
  approvals: readonly PendingApproval[];
  running: readonly RunningTask[];
  questions: readonly OpenQuestion[];
  spendTodayUsd: number;
  spendCapUsd: number;
  paused: boolean;
  /** Last standup the COO wrote, if today's has been generated. */
  standup?: string;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  at: new Date(0),
  approvals: [],
  running: [],
  questions: [],
  spendTodayUsd: 0,
  spendCapUsd: 5,
  paused: false,
};
