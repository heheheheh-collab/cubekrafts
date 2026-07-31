import { describe, it, expect } from 'vitest';
import { fastPath, recognise, normalise, answer } from '../src/concierge/intents.ts';
import { EMPTY_SNAPSHOT, type Snapshot } from '../src/concierge/snapshot.ts';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ ...EMPTY_SNAPSHOT, ...over });

const busy = snap({
  approvals: [
    { id: 'a1', kind: 'email', summary: 'Reply to Anita about the 3BHK quote', role: 'sales', waitingMinutes: 95 },
    { id: 'a2', kind: 'push', summary: 'Pricing page copy fix', role: 'developer', waitingMinutes: 12 },
  ],
  running: [{ id: 't1', title: 'August blog post', role: 'content', runningMinutes: 4 }],
  questions: [{ id: 'q1', role: 'sales', text: 'Do we quote for Goa?', waitingMinutes: 30 }],
  spendTodayUsd: 1.25,
  spendCapUsd: 5,
});

describe('recognition is forgiving about phrasing', () => {
  it('matches the ways a person actually asks about approvals', () => {
    for (const q of [
      'approvals',
      'Approvals?',
      "what's pending",
      'what is pending',
      'any pending approvals',
      'approvals waiting',
      'anything to approve',
      'hey, approvals please',
    ]) {
      expect(recognise(q), q).toBe('approvals');
    }
  });

  it('matches spend, running, questions, standup and status', () => {
    expect(recognise('spend')).toBe('spend');
    expect(recognise('how much have we spent today')).toBe('spend');
    expect(recognise("what's running")).toBe('running');
    expect(recognise('what is the team doing')).toBe('running');
    expect(recognise('any open questions')).toBe('questions');
    expect(recognise("what's blocked on me")).toBe('questions');
    expect(recognise('standup')).toBe('standup');
    expect(recognise('catch me up')).toBe('standup');
    expect(recognise('how are we doing')).toBe('status');
  });

  it('normalises politeness and punctuation away', () => {
    expect(normalise("  Hey, what's pending, please?  ")).toBe("what's pending");
  });
});

describe('recognition refuses to guess', () => {
  it('returns null for anything that is a real request', () => {
    for (const q of [
      'draft a reply to Anita',
      'why is the pricing page slow',
      "don't send the approval email",
      'approve the first one',
      'what should our pricing be',
      'tell sales to stop chasing that lead',
      'spend more on marketing next month',
      '',
      '   ',
    ]) {
      expect(recognise(q), q).toBeNull();
    }
  });

  it('sends anything long to the model rather than pattern-matching it', () => {
    const long =
      'approvals — but only the ones from sales, and can you also tell me which of them mention pricing';
    expect(recognise(long)).toBeNull();
  });

  it('does not fire on a keyword buried in a sentence', () => {
    expect(recognise('the spend on that campaign was too high last month')).toBeNull();
    expect(recognise('there is a question I keep meaning to ask you')).toBeNull();
  });
});

describe('answers put the number first', () => {
  it('reports approvals with the oldest wait', () => {
    const a = fastPath('approvals', busy)!;
    expect(a.speech).toBe(
      '2 approvals waiting. Oldest 1.6h: Reply to Anita about the 3BHK quote.',
    );
    expect(a.card.data).toHaveLength(2);
  });

  it('says nothing is waiting when nothing is', () => {
    expect(fastPath('approvals', snap())!.speech).toBe('Nothing waiting on you.');
  });

  it('uses the singular for one', () => {
    const one = snap({ approvals: [{ ...busy.approvals[0]!, waitingMinutes: 3 }] });
    expect(fastPath('approvals', one)!.speech).toMatch(/^1 approval waiting\. Oldest 3m:/);
  });

  it('reports spend against the cap', () => {
    expect(fastPath('spend', busy)!.speech).toBe('$1.25 today, 25% of the $5.00 cap. $3.75 left.');
  });

  it('says plainly when the cap has stopped the loop', () => {
    const capped = snap({ spendTodayUsd: 5.4, spendCapUsd: 5 });
    expect(fastPath('spend', capped)!.speech).toBe(
      '$5.40 today — cap reached, the loop is stopped.',
    );
  });

  it('summarises what is running, and notices when paused', () => {
    expect(fastPath('running', busy)!.speech).toBe(
      '1 task running. content on August blog post (4m).',
    );
    expect(fastPath('running', snap({ paused: true }))!.speech).toBe('Everything is paused.');
  });

  it('leads with the question when one is open', () => {
    expect(fastPath('any questions', busy)!.speech).toBe(
      '1 question for you. sales asks: Do we quote for Goa?',
    );
  });

  it('admits when there is no standup yet rather than inventing one', () => {
    expect(fastPath('standup', snap())!.speech).toMatch(/No standup yet/);
    expect(fastPath('standup', snap({ standup: 'Three things moved.' }))!.speech).toBe(
      'Three things moved.',
    );
  });

  it('gives a one-line status', () => {
    expect(fastPath('how are we doing', busy)!.speech).toBe(
      '1 task running, 2 approvals waiting, 1 question for you, $1.25 spent.',
    );
  });
});

describe('pause and resume report the effect the caller must apply', () => {
  it('pauses when running', () => {
    const a = fastPath('stop', snap())!;
    expect(a.effect).toBe('pause');
    expect(a.speech).toMatch(/^Paused\./);
  });

  it('is idempotent, and says so without pretending to act', () => {
    const a = fastPath('pause', snap({ paused: true }))!;
    expect(a.effect).toBeUndefined();
    expect(a.speech).toBe('Already paused.');
  });

  it('resumes only when actually paused', () => {
    expect(fastPath('resume', snap({ paused: true }))!.effect).toBe('resume');
    expect(fastPath('resume', snap())!.effect).toBeUndefined();
  });
});

describe('the fast path is fast', () => {
  it('answers a thousand times in well under the latency budget', () => {
    const started = performance.now();
    for (let i = 0; i < 1000; i++) fastPath('what is pending', busy);
    const perCall = (performance.now() - started) / 1000;
    // The budget is 100ms per answer including the snapshot read. The pure
    // matching and rendering should be three orders of magnitude inside it.
    expect(perCall).toBeLessThan(1);
  });
});

describe('answer() is exhaustive over the intent union', () => {
  it('returns a non-empty sentence for every intent', () => {
    for (const intent of [
      'approvals',
      'spend',
      'running',
      'questions',
      'standup',
      'status',
      'pause',
      'resume',
    ] as const) {
      expect(answer(intent, busy).speech.length, intent).toBeGreaterThan(0);
    }
  });
});
