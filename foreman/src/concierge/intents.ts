import type { Snapshot } from './snapshot.ts';

/**
 * The fast path.
 *
 * A short list of questions people actually ask a dozen times a day, answered
 * from the snapshot with no model call: no network, no tokens, no chance of a
 * hallucinated number. Target is under 100 ms, which really means "as fast as
 * the database round trip that produced the snapshot".
 *
 * Deliberately **high precision, low recall**. If the phrasing is not clearly
 * one of these, this returns `null` and the model handles it. A fast wrong
 * answer is worse than a slightly slower right one, so every matcher here is
 * anchored and none of them guess.
 */

export type IntentName =
  | 'approvals'
  | 'spend'
  | 'running'
  | 'questions'
  | 'standup'
  | 'status'
  | 'homecoming'
  | 'pause'
  | 'resume';

export interface Answer {
  intent: IntentName;
  /** One or two sentences, number first. Also what gets spoken aloud. */
  speech: string;
  /** Structured payload for the UI to render as a card rather than prose. */
  card: { type: IntentName; data: unknown };
  /** Set when the answer implies a state change the caller must perform. */
  effect?: 'pause' | 'resume';
}

/** `n thing` / `n things`, because "1 approvals" reads like a bug. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function minutes(m: number): string {
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${Math.round(h / 24)}d`;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Each intent is a set of anchored patterns. They match a whole utterance,
 * modulo politeness and punctuation, rather than searching for a keyword
 * anywhere in a sentence — "don't send the approval email" must not match
 * the approvals intent.
 */
const PATTERNS: ReadonlyArray<readonly [IntentName, RegExp]> = [
  [
    'approvals',
    /^(what(?:'s| is| are)?\s+)?(any\s+)?(pending\s+)?approvals?(\s+(are\s+)?(pending|waiting|left|outstanding))?$/,
  ],
  ['approvals', /^what(?:'s| is)?\s+(pending|waiting|outstanding|in the queue)$/],
  ['approvals', /^(anything|what)\s+(to|do i need to)\s+approve$/],

  ['spend', /^(what(?:'s| is| are)?\s+)?(the\s+)?(spend|cost|costs|bill|burn)(\s+today)?$/],
  ['spend', /^how much (have (we|i) )?(spent|cost)( today)?$/],

  ['running', /^(what(?:'s| is)?\s+)?(currently\s+)?(running|in progress|working|happening)(\s+now)?$/],
  ['running', /^what(?:'s| is)?\s+(everyone|the team|the org)\s+doing$/],

  ['questions', /^(any\s+)?(open\s+)?questions?(\s+for me)?$/],
  ['questions', /^what(?:'s| is)?\s+blocked(\s+on me)?$/],

  ['standup', /^(the\s+)?(standup|briefing|brief|digest|summary)(\s+please)?$/],
  ['standup', /^(what happened|catch me up|what did i miss)(\s+overnight| last night| today)?$/],

  ['status', /^(status|how are we doing|where are we|how(?:'s| is) it going|sitrep)$/],

  // Walking in the door. Not a status check — the question behind it is "what
  // did you get done while I was out", so it answers with the work first and
  // the queue second, and greets you rather than reciting a table.
  ['homecoming', /^(daddy|dad|papa|mummy|mum|mama|the boss)('?s| is)? (home|back)$/],
  ['homecoming', /^(i'?m|im) (home|back)$/],
  ['homecoming', /^(what have you (been up to|done)|what did you do)(\s+(today|while i was out|all day))?$/],

  ['pause', /^(pause|stop|halt|freeze)(\s+(everything|all|everyone|the agents?))?$/],
  ['resume', /^(resume|unpause|continue|carry on|go)(\s+(everything|all|everyone))?$/],
];

/** Strip politeness and punctuation so "what's pending, please?" still matches. */
export function normalise(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/g, '')
    // The name comes off the front like any other salutation, so "Jordan,
    // what's pending" is the same utterance as "what's pending".
    .replace(/^(hey|hi|hello|ok|okay|so|and|um|uh|jordan)[\s,]+/g, '')
    .replace(/^(jordan)[\s,]+/g, '')
    .replace(/[\s,]+(please|mate|thanks|thank you)$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function recognise(input: string): IntentName | null {
  const text = normalise(input);
  if (text.length === 0 || text.length > 80) return null; // long input is a real request
  for (const [name, pattern] of PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

/**
 * Answer an intent from the snapshot. Pure: same snapshot, same words, every
 * time — which is also what makes it testable to the character.
 */
export function answer(intent: IntentName, s: Snapshot): Answer {
  switch (intent) {
    case 'approvals': {
      const n = s.approvals.length;
      const oldest = s.approvals.reduce<number>((m, a) => Math.max(m, a.waitingMinutes), 0);
      const speech =
        n === 0
          ? 'Nothing waiting on you.'
          : `${plural(n, 'approval')} waiting. Oldest ${minutes(oldest)}: ${s.approvals[0]!.summary}.`;
      return { intent, speech, card: { type: intent, data: s.approvals } };
    }

    case 'spend': {
      const left = Math.max(0, s.spendCapUsd - s.spendTodayUsd);
      const pct = s.spendCapUsd > 0 ? Math.round((s.spendTodayUsd / s.spendCapUsd) * 100) : 0;
      const speech =
        s.spendTodayUsd >= s.spendCapUsd
          ? `${money(s.spendTodayUsd)} today — cap reached, the loop is stopped.`
          : `${money(s.spendTodayUsd)} today, ${pct}% of the ${money(s.spendCapUsd)} cap. ${money(left)} left.`;
      return {
        intent,
        speech,
        card: { type: intent, data: { today: s.spendTodayUsd, cap: s.spendCapUsd, left } },
      };
    }

    case 'running': {
      const n = s.running.length;
      if (s.paused) {
        return {
          intent,
          speech: 'Everything is paused.',
          card: { type: intent, data: { paused: true, running: s.running } },
        };
      }
      const speech =
        n === 0
          ? 'Nothing running.'
          : `${plural(n, 'task')} running. ${s.running
              .slice(0, 3)
              .map((r) => `${r.role} on ${r.title} (${minutes(r.runningMinutes)})`)
              .join('; ')}.`;
      return { intent, speech, card: { type: intent, data: s.running } };
    }

    case 'questions': {
      const n = s.questions.length;
      const speech =
        n === 0
          ? 'No open questions.'
          : `${plural(n, 'question')} for you. ${s.questions[0]!.role} asks: ${s.questions[0]!.text}`;
      return { intent, speech, card: { type: intent, data: s.questions } };
    }

    case 'standup':
      return {
        intent,
        speech: s.standup ?? "No standup yet — the COO writes it at the end of the overnight run.",
        card: { type: intent, data: { standup: s.standup ?? null } },
      };

    case 'status': {
      const bits: string[] = [];
      if (s.paused) bits.push('paused');
      bits.push(s.running.length === 0 ? 'nothing running' : `${plural(s.running.length, 'task')} running`);
      if (s.approvals.length > 0) bits.push(`${plural(s.approvals.length, 'approval')} waiting`);
      if (s.questions.length > 0) bits.push(`${plural(s.questions.length, 'question')} for you`);
      bits.push(`${money(s.spendTodayUsd)} spent`);
      return {
        intent,
        speech: bits.join(', ') + '.',
        card: {
          type: intent,
          data: {
            paused: s.paused,
            running: s.running.length,
            approvals: s.approvals.length,
            questions: s.questions.length,
            spendTodayUsd: s.spendTodayUsd,
          },
        },
      };
    }

    case 'homecoming': {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Morning, sir' : hour < 18 ? 'Welcome back, sir' : 'Evening, sir';

      // What it did comes first, because that is the actual question. The
      // standup is the written record of it when one exists; otherwise the
      // honest answer is what is running and what it cost.
      const did = s.standup?.trim();
      const bits: string[] = [];
      if (s.running.length > 0) bits.push(`${plural(s.running.length, 'task')} still running`);
      if (s.approvals.length > 0) bits.push(`${plural(s.approvals.length, 'approval')} waiting on you`);
      if (s.questions.length > 0) bits.push(`${plural(s.questions.length, 'question')} for you`);
      if (s.paused) bits.push('everything is paused');
      bits.push(`${money(s.spendTodayUsd)} spent today`);

      const speech = did
        ? `${greeting}. ${did} ${bits.join(', ')}.`
        : `${greeting}. ${bits.join(', ')}.`;

      return {
        intent,
        speech,
        card: {
          type: intent,
          data: {
            greeting,
            standup: s.standup ?? null,
            running: s.running,
            approvals: s.approvals,
            questions: s.questions,
            spendTodayUsd: s.spendTodayUsd,
            paused: s.paused,
          },
        },
      };
    }

    case 'pause':
      return {
        intent,
        speech: s.paused ? 'Already paused.' : 'Paused. Nothing will start until you say go.',
        card: { type: intent, data: { paused: true } },
        ...(s.paused ? {} : { effect: 'pause' as const }),
      };

    case 'resume':
      return {
        intent,
        speech: s.paused ? 'Running again.' : 'Already running.',
        card: { type: intent, data: { paused: false } },
        ...(s.paused ? { effect: 'resume' as const } : {}),
      };
  }
}

/**
 * The whole fast path: words in, answer or `null` out. `null` means "this
 * needs the model", which is the honest answer most of the time.
 */
export function fastPath(input: string, s: Snapshot): Answer | null {
  const intent = recognise(input);
  return intent === null ? null : answer(intent, s);
}
