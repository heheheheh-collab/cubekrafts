import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { answer, type IntentName } from '../src/concierge/intents.ts';
import { EMPTY_SNAPSHOT, type Snapshot } from '../src/concierge/snapshot.ts';

/**
 * The seam between the fast path and the cards that draw it.
 *
 * A card is built on the server as `{ type, data }` and drawn in the browser
 * by a function that reads named props. Nothing checked that the two agreed,
 * and they did not: every list intent shipped `data` as a bare array to a
 * renderer that read `data.items` off it, so asking "what's running" answered
 * with `undefined is not an object`. The speech was right, which is why it
 * survived every server-side test — the break was one layer further out.
 *
 * So this test runs the real renderers against the real payloads. It needs a
 * document to do that, and a real headless browser for six pure functions is
 * a poor trade, so it stands up the smallest DOM those functions actually
 * touch. If a renderer starts using more of the platform than this shim
 * provides, this test fails loudly — which is the correct outcome, because a
 * renderer reaching for something new is exactly when to look again.
 */

class FakeNode {
  tagName: string;
  className = '';
  children: FakeNode[] = [];
  style: Record<string, unknown> = { setProperty: () => {} };
  #text = '';
  type = '';
  value = '';
  placeholder = '';
  autocomplete = '';
  disabled = false;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  set textContent(value: string) {
    this.#text = String(value);
    this.children = [];
  }

  get textContent(): string {
    return this.#text + this.children.map((c) => c.textContent).join('');
  }

  append(...nodes: unknown[]): void {
    for (const node of nodes) if (node instanceof FakeNode) this.children.push(node);
  }

  replaceChildren(...nodes: unknown[]): void {
    this.children = [];
    this.append(...nodes);
  }

  replaceWith(): void {}
  addEventListener(): void {}
  setAttribute(): void {}
}

const shim = {
  createElement: (tag: string) => new FakeNode(tag),
  createDocumentFragment: () => new FakeNode('#fragment'),
};

/**
 * The front end is plain JavaScript with no build step and no type
 * declarations, which is the point of it — so this is the one place that has
 * to describe the module's shape rather than import it.
 */
interface Cards {
  render(card: unknown, ctx?: unknown): { textContent: string } | null;
  normaliseCard(card: unknown): Record<string, unknown> | null;
  CARD_TYPES: readonly string[];
}

let cards: Cards;

beforeAll(async () => {
  (globalThis as { document?: unknown }).document = shim;
  // The front end ships no type declarations — deliberately, since it has no
  // build step — so the compiler cannot see into it. The `Cards` interface
  // above is the contract, and this is the one line that has to assert it.
  // @ts-expect-error untyped browser module, described by `Cards` above
  cards = (await import('../web/cards.js')) as Cards;
});

afterAll(() => {
  delete (globalThis as { document?: unknown }).document;
});

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ ...EMPTY_SNAPSHOT, ...over });

/** A snapshot with something in every list, so no renderer takes an empty path. */
const busy = snap({
  approvals: [
    {
      id: 'ap_1',
      kind: 'email.send',
      summary: 'Reply to Sharma',
      role: 'sales',
      waitingMinutes: 14,
    },
  ],
  running: [{ id: 'r1', title: 'August post', role: 'content', runningMinutes: 6 }],
  questions: [{ id: 'q1', role: 'sales', text: 'What is the lead time?', waitingMinutes: 30 }],
  spendTodayUsd: 1.42,
  spendCapUsd: 5,
  standup: 'Wrote the August post.',
});

const EVERY_INTENT: IntentName[] = [
  'approvals',
  'spend',
  'running',
  'questions',
  'standup',
  'status',
  'homecoming',
  'pause',
  'resume',
];

describe('every card the fast path can produce', () => {
  it('draws without throwing, on a full snapshot and an empty one', () => {
    for (const intent of EVERY_INTENT) {
      for (const [label, s] of [
        ['busy', busy],
        ['empty', snap()],
      ] as const) {
        const card = answer(intent, s).card;
        // The assertion is that this line does not throw. Naming the intent
        // and the snapshot in the expectation means a failure says which.
        const drew = () => cards.render(card, { act: async () => ({ ok: true }) });
        expect({ intent, label, threw: safely(drew) }).toEqual({ intent, label, threw: null });
      }
    }
  });

  it('puts a list intent under a name the renderer reads', () => {
    // The exact break: `data` was the array itself, and the renderer wanted
    // `items`. Asserting the normalised shape pins the contract rather than
    // just the absence of an exception.
    for (const intent of ['approvals', 'running', 'questions'] as const) {
      const shaped = cards.normaliseCard(answer(intent, busy).card) as { items?: unknown };
      expect({ intent, isArray: Array.isArray(shaped.items) }).toEqual({ intent, isArray: true });
    }
  });

  it('leaves a card the menu built exactly as it was', () => {
    const inline = { type: 'running', items: [{ role: 'content', title: 'x', runningMinutes: 1 }] };
    expect(cards.normaliseCard(inline)).toBe(inline);
  });

  it('refuses a shape it cannot draw rather than throwing', () => {
    expect(cards.normaliseCard(null)).toBeNull();
    expect(cards.normaliseCard({})).toBeNull();
    expect(cards.render({ type: 'not-a-card', data: {} })).toBeNull();
  });

  it('shows the real spend, whichever end built the card', () => {
    // The fast path says today/cap; the menu says todayUsd/capUsd. Reading
    // only one of them showed $0.00 and looked like a working card.
    expect(cards.render(answer('spend', busy).card)?.textContent).toContain('1.42');
    expect(cards.render({ type: 'spend', todayUsd: 1.42, capUsd: 5 })?.textContent).toContain('1.42');
  });

  it('has a renderer for every card type the server names', () => {
    for (const intent of EVERY_INTENT) {
      const { type } = answer(intent, busy).card;
      // pause and resume answer in a sentence and draw nothing, deliberately.
      if (type === 'pause' || type === 'resume') continue;
      expect({ type, drawable: cards.CARD_TYPES.includes(type) }).toEqual({ type, drawable: true });
    }
  });
});

function safely(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
