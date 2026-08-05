/**
 * Cards.
 *
 * A card exists when a list or a number reads better than a sentence. Nothing
 * here fetches or decides anything — it draws what it is handed and calls
 * `act` when a button is pressed, so there is exactly one place that changes
 * server state and it is not this file.
 *
 * Everything goes in through `textContent`, and nothing anywhere in this app
 * assigns markup as a string — test/static.test.ts enforces that. It is the
 * cheapest possible answer to the question of what happens when an agent
 * writes a task title containing a script tag.
 */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function card(heading, className = '') {
  const node = el('div', `card ${className}`.trim());
  if (heading) node.append(el('h3', null, heading));
  return node;
}

function rows(items) {
  const list = el('div', 'rows');
  for (const [key, value, tone] of items) {
    const row = el('div', 'row');
    row.append(el('span', 'k', key), el('span', `v ${tone ?? ''}`.trim(), value));
    list.append(row);
  }
  return list;
}

function ago(minutes) {
  if (minutes === undefined || minutes === null) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function when(value) {
  if (!value) return '—';
  const then = new Date(value);
  return ago((Date.now() - then.getTime()) / 60_000);
}

// ── approvals ───────────────────────────────────────────────────────────────

function approval(item, { act }) {
  const node = card(item.kind ?? item.tool, 'waiting');
  node.append(el('div', 'what', item.summary ?? item.reason ?? ''));

  // An email you cannot read in full is one you cannot meaningfully approve,
  // and the whole design rests on the founder having read it. The hash is the
  // one the sender will check against, so what is on screen is provably what
  // goes out.
  if (item.email && !item.email.missing) {
    const letter = el('div', 'letter');
    letter.append(el('div', 'to', `To: ${item.email.to}`));
    letter.append(el('div', 'subject', item.email.subject));
    letter.append(el('div', 'body', item.email.body));
    letter.append(el('div', 'meta', `frozen as ${item.email.hash}`));
    node.append(letter);
  }

  node.append(
    el('div', 'meta', `${item.role ?? 'an agent'} · waiting ${ago(item.waitingMinutes)}`),
  );

  const actions = el('div', 'actions');
  const approve = el('button', 'approve', 'Approve');
  const reject = el('button', 'reject', 'Decline');
  actions.append(reject, approve);
  node.append(actions);

  const settle = (text, tone) => {
    actions.replaceWith(el('div', 'meta', text));
    if (tone) node.className = 'card';
  };

  const press = async (button, decision) => {
    approve.disabled = true;
    reject.disabled = true;
    const result = await act(decision, { id: item.id });
    if (result?.cancelled) {
      approve.disabled = false;
      reject.disabled = false;
      return;
    }
    if (result?.error) {
      settle(result.error);
      return;
    }
    settle(decision === 'approve' ? 'Approved, and the run carried on.' : 'Declined.', true);
    void button;
  };

  approve.addEventListener('click', () => press(approve, 'approve'));
  reject.addEventListener('click', () => press(reject, 'reject'));
  return node;
}

// ── the rest ────────────────────────────────────────────────────────────────

const STATUS_TONE = {
  done: 'good',
  review: 'good',
  running: '',
  blocked: 'bad',
  cancelled: 'bad',
};

const RENDERERS = {
  approvals: (data, ctx) => {
    const items = data.items ?? [];
    if (items.length === 0) {
      const empty = card('Approvals');
      empty.append(el('div', 'what', 'Nothing is waiting on you.'));
      return empty;
    }
    const wrap = document.createDocumentFragment();
    for (const item of items) wrap.append(approval(item, ctx));
    return wrap;
  },

  running: (data) => {
    const node = card('Running');
    node.append(
      rows((data.items ?? []).map((r) => [`${r.role} · ${r.title}`, ago(r.runningMinutes)])),
    );
    return node;
  },

  tasks: (data) => {
    const node = card('Tasks');
    node.append(
      rows(
        (data.items ?? [])
          .slice(0, 25)
          .map((t) => [t.title, t.status, STATUS_TONE[t.status] ?? '']),
      ),
    );
    return node;
  },

  questions: (data) => {
    const node = card('Questions');
    node.append(rows((data.items ?? []).map((q) => [`${q.role}: ${q.text}`, ago(q.waitingMinutes)])));
    return node;
  },

  spend: (data) => {
    const node = card('Spend today');
    // The menu says todayUsd/capUsd; the fast path says today/cap. Both are
    // ours, both are correct at their own end, and this is the seam.
    const spent = data.todayUsd ?? data.today ?? 0;
    const cap = data.capUsd ?? data.cap ?? 0;
    node.append(
      rows([
        ['Spent', `$${spent.toFixed(2)}`],
        ['Cap', `$${cap.toFixed(2)}`],
        ['Left', `$${Math.max(0, cap - spent).toFixed(2)}`, cap - spent <= 0 ? 'bad' : 'good'],
      ]),
    );
    const track = el('div', 'bar-track');
    const share = cap > 0 ? Math.min(1, spent / cap) : 0;
    const fill = el('div', `bar-fill ${share > 0.9 ? 'hot' : share > 0.6 ? 'warm' : ''}`.trim());
    fill.style.width = `${Math.round(share * 100)}%`;
    track.append(fill);
    node.append(track);
    return node;
  },

  standup: (data) => {
    const node = card('Standup');
    if (data.rows?.length) node.append(rows(data.rows));
    else if (data.standup) node.append(el('div', 'what', data.standup));
    else node.append(el('div', 'what', 'No standup has been written yet today.'));
    return node;
  },

  /* The fast path can answer "status" but nothing drew it, so the reply
     arrived as a sentence with a card that silently vanished. */
  status: (data) => {
    const node = card('Status');
    node.append(
      rows([
        ['Running', String(data.running ?? 0)],
        ['Waiting on you', String(data.approvals ?? 0), (data.approvals ?? 0) > 0 ? 'bad' : 'good'],
        ['Questions', String(data.questions ?? 0), (data.questions ?? 0) > 0 ? 'bad' : 'good'],
        ['Spent today', `$${(data.spendTodayUsd ?? 0).toFixed(2)}`],
        ...(data.paused ? [['State', 'PAUSED', 'bad']] : []),
      ]),
    );
    return node;
  },

  model: (data, { act }) => {
    const node = card('Model');
    node.append(
      rows([
        ['Running on', data.provider === 'anthropic' ? 'Anthropic' : data.provider ?? '—'],
        ['Model', data.model ?? '—'],
        ['Key', data.keyHint ? `${data.keyHint} · from ${data.keySource}` : 'none set'],
        ['Last check', data.lastCheck ?? '—'],
      ]),
    );

    // The one place a key is ever typed. It goes to the server once, lives in
    // the database, and never comes back — only the last four characters do.
    const form = el('div', 'actions');
    const input = el('input');
    input.type = 'password';
    input.placeholder = 'sk-ant-… paste a key';
    input.autocomplete = 'off';
    input.style.flex = '1';
    const save = el('button', 'approve', 'Save & check');
    form.append(input, save);

    let clear = null;
    if (data.keySource === 'settings') {
      clear = el('button', 'reject', 'Remove');
      form.append(clear);
    }
    node.append(form);

    const meta = el(
      'div',
      'meta',
      'Saved in the app and survives restarts. Removing it goes back to whatever ran before.',
    );
    node.append(meta);

    const submit = async (value) => {
      save.disabled = true;
      if (clear) clear.disabled = true;
      meta.textContent = 'checking with the real API…';
      const result = await act('setkey', { apiKey: value });
      save.disabled = false;
      if (clear) clear.disabled = false;
      if (result?.error) {
        meta.textContent = result.error;
        return;
      }
      input.value = '';
      meta.textContent = `${result.lastCheck} — running on ${result.model}`;
    };

    save.addEventListener('click', () => {
      if (input.value.trim()) void submit(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) void submit(input.value);
    });
    if (clear) clear.addEventListener('click', () => void submit(null));
    return node;
  },

  /**
   * Walking in the door. The work comes first because that is the question,
   * and the queue second because that is the ask.
   */
  homecoming: (data, ctx) => {
    const wrap = document.createDocumentFragment();

    if (data.standup) {
      const brief = card('While you were out');
      brief.append(el('div', 'what', data.standup));
      wrap.append(brief);
    }

    const node = card('Right now');
    node.append(
      rows([
        ['Running', String(data.running?.length ?? 0), (data.running?.length ?? 0) > 0 ? '' : 'good'],
        [
          'Waiting on you',
          String(data.approvals?.length ?? 0),
          (data.approvals?.length ?? 0) > 0 ? 'bad' : 'good',
        ],
        ['Questions', String(data.questions?.length ?? 0), (data.questions?.length ?? 0) > 0 ? 'bad' : 'good'],
        ['Spent today', `$${(data.spendTodayUsd ?? 0).toFixed(2)}`, ''],
        ...(data.paused ? [['State', 'PAUSED', 'bad']] : []),
      ]),
    );
    wrap.append(node);

    // The approvals themselves, so the answer to "anything for me" is the
    // buttons rather than a number you then have to go and find.
    if (data.approvals?.length > 0) {
      for (const item of data.approvals) wrap.append(approval(item, ctx));
    }
    return wrap;
  },

  connections: (data, { act }) => {
    const wrap = document.createDocumentFragment();
    for (const c of data.items ?? []) {
      const node = card(c.title, c.connected ? '' : 'waiting');
      node.append(el('div', 'what', c.enables));

      const form = el('div', 'rows');
      const inputs = new Map();
      for (const f of c.fields) {
        const row = el('div', 'row');
        row.append(el('span', 'k', f.label));
        const input = el('input');
        // A secret is never sent back to the browser, so the box shows what
        // is set and stays empty: typing replaces, leaving it alone keeps.
        input.type = f.secret ? 'password' : 'text';
        input.placeholder = f.value ? `set (${f.value})` : (f.placeholder ?? '');
        if (!f.secret && f.value) input.value = f.value;
        input.autocomplete = 'off';
        input.style.flex = '1';
        inputs.set(f.env, { input, secret: f.secret });
        const right = el('span', 'v');
        right.append(input);
        row.append(right);
        form.append(row);
      }
      node.append(form);

      const meta = el('div', 'meta', c.connected ? 'Connected.' : c.how);
      node.append(meta);

      const actions = el('div', 'actions');
      const save = el('button', 'approve', 'Save');
      actions.append(save);
      node.append(actions);

      save.addEventListener('click', async () => {
        save.disabled = true;
        meta.textContent = 'saving…';
        const body = {};
        for (const [env, { input, secret }] of inputs) {
          // An untouched secret box must not clear the stored secret.
          if (secret && input.value === '') continue;
          body[env] = input.value;
        }
        const result = await act('connect', body);
        save.disabled = false;
        meta.textContent = result?.error ?? 'Saved, and in force now.';
      });

      wrap.append(node);
    }
    return wrap;
  },

  email: (data) => {
    const node = card('Email');
    if (data.dns?.configured) {
      node.append(
        rows(
          data.dns.findings.map((f) => [
            f.what,
            f.severity === 'ok' ? 'ok' : f.severity,
            f.severity === 'ok' ? 'good' : 'bad',
          ]),
        ),
      );
      const worst = data.dns.findings.find((f) => f.severity !== 'ok');
      if (worst) node.append(el('div', 'meta', worst.detail));
    }
    node.append(
      rows(
        data.messages
          .slice(0, 20)
          .map((m) => [
            `${m.to_address} · ${m.subject}`,
            m.status,
            m.status === 'sent' ? 'good' : m.status === 'draft' ? '' : 'bad',
          ]),
      ),
    );
    if (data.suppressed.length > 0) {
      node.append(el('h3', null, 'Never write to these again'));
      node.append(rows(data.suppressed.map((s) => [s.address, s.reason, 'bad'])));
    }
    return node;
  },

  audit: (data) => {
    const node = card('Recent activity');
    node.append(
      rows(
        (data.items ?? [])
          .slice(0, 30)
          .map((a) => [`${a.actor} ${a.action}${a.subject ? ` · ${a.subject}` : ''}`, when(a.at)]),
      ),
    );
    return node;
  },

  sessions: (data, { act }) => {
    const node = card('Signed-in devices');
    const list = el('div', 'rows');
    for (const s of data.items ?? []) {
      const row = el('div', 'row');
      row.append(
        el('span', 'k', `${s.device ?? 'Unknown'}${s.current ? ' · this one' : ''}`),
      );
      const right = el('span', 'v');
      const revoke = el('button', 'reject', 'Revoke');
      revoke.style.flex = 'none';
      revoke.style.padding = '4px 10px';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        const result = await act('revoke', { id: s.id });
        right.textContent = result?.error ?? 'revoked';
        if (s.current) location.reload();
      });
      right.append(revoke);
      row.append(right);
      list.append(row);
    }
    node.append(list);
    return node;
  },

  authlog: (data) => {
    const node = card('Sign-ins and attempts');
    node.append(
      rows(
        (data.items ?? [])
          .slice(0, 30)
          .map((e) => [
            `${e.kind}${e.ip ? ` · ${e.ip}` : ''}`,
            e.ok ? when(e.at) : `failed ${when(e.at)}`,
            e.ok ? '' : 'bad',
          ]),
      ),
    );
    return node;
  },
};

/**
 * The two shapes a card arrives in, reduced to one.
 *
 * The menu builds cards inline and passes the renderer's own props:
 * `{ type: 'running', items: [...] }`. The concierge's fast path builds them
 * on the server, where a card is `{ type, data }` and `data` is whatever that
 * intent had to hand — sometimes an array, sometimes an object of fields.
 *
 * Both are reasonable at their own end, and nothing reconciled them, so every
 * list card from the fast path reached a renderer that read `data.items` off
 * an array and threw. This is that reconciliation, in one place, rather than
 * a `?? []` in each renderer that would hide the next mismatch instead of
 * fixing it.
 */
export function normaliseCard(card) {
  if (!card || typeof card !== 'object' || !card.type) return null;
  // Already renderer-shaped.
  if (!('data' in card)) return card;

  const { type, data } = card;
  if (Array.isArray(data)) return { type, items: data };
  if (data && typeof data === 'object') return { type, ...data };
  return { type };
}

/** Every card shape this file can draw. Exported so a test can prove the
 *  server never invents one that lands here with nothing to draw it. */
export const CARD_TYPES = Object.freeze(Object.keys(RENDERERS));

/** Draw a card, or nothing at all for a shape we do not know. */
export function render(card, ctx = {}) {
  const shaped = normaliseCard(card);
  const renderer = shaped && RENDERERS[shaped.type];
  if (!renderer) return null;
  return renderer(shaped, ctx);
}
