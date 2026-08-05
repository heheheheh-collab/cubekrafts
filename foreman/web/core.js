/**
 * The core: the orb, its rings, the floating panels, and the sound.
 *
 * This is the presence layer. It sits behind the conversation rather than
 * beside it, because the conversation is still the thing you use and a
 * decorative hero that pushes the text off a phone screen is a worse app with
 * a better screenshot. The orb is always there, breathing, and it reacts —
 * which is what makes it read as something attending to you rather than a
 * loading spinner that happens to be round.
 *
 * Everything here is drawn with the platform: SVG for the rings, CSS for the
 * glow and the motion, WebAudio for the tones. Nothing is fetched, no asset is
 * loaded, and the content security policy that forbids offsite resources is
 * satisfied by there being none.
 *
 * Nothing in this file assigns markup as a string — the same rule the rest of
 * the front end follows, and test/static.test.ts enforces.
 */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** Honoured throughout: motion is the whole design, so its absence must work too. */
const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

// ── sound ───────────────────────────────────────────────────────────────────

/**
 * Tones, synthesised.
 *
 * A browser will not let audio start before the person has interacted with the
 * page, so the context is created on the first gesture rather than at load —
 * and until then every call here is a no-op rather than an error in the
 * console. The hum is deliberately near the threshold of noticing: it is meant
 * to be felt while the orb pulses, not listened to.
 */
class Tones {
  #ctx = null;
  #hum = null;
  #muted = false;

  get muted() {
    return this.#muted;
  }

  set muted(value) {
    this.#muted = value;
    if (value) this.stopHum();
  }

  /** Called from a real user gesture; safe to call repeatedly. */
  unlock() {
    if (this.#ctx || this.#muted) return;
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.#ctx = new Ctx();
    void this.#ctx.resume?.();
  }

  #gain(value, at) {
    const g = this.#ctx.createGain();
    g.gain.setValueAtTime(value, at);
    g.connect(this.#ctx.destination);
    return g;
  }

  /** A soft harmonic bed while the orb is working. */
  startHum() {
    if (!this.#ctx || this.#muted || this.#hum) return;
    const now = this.#ctx.currentTime;
    const gain = this.#gain(0, now);
    gain.gain.linearRampToValueAtTime(0.035, now + 0.6);

    const voices = [110, 165, 220].map((hz) => {
      const osc = this.#ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(hz, now);
      osc.connect(gain);
      osc.start(now);
      return osc;
    });

    // Tremolo on the same 1.5s period as the idle pulse, so the sound and the
    // light are obviously one thing rather than two that happen to coincide.
    const lfo = this.#ctx.createOscillator();
    const depth = this.#ctx.createGain();
    lfo.frequency.setValueAtTime(1 / 1.5, now);
    depth.gain.setValueAtTime(0.012, now);
    lfo.connect(depth).connect(gain.gain);
    lfo.start(now);

    this.#hum = { gain, voices, lfo };
  }

  stopHum() {
    if (!this.#hum) return;
    const { gain, voices, lfo } = this.#hum;
    this.#hum = null;
    const now = this.#ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.35);
    for (const osc of [...voices, lfo]) osc.stop(now + 0.4);
  }

  /** Success: two notes, rising, gone in under half a second. */
  chime() {
    if (!this.#ctx || this.#muted) return;
    const now = this.#ctx.currentTime;
    for (const [i, hz] of [880, 1320].entries()) {
      const at = now + i * 0.09;
      const gain = this.#gain(0, at);
      gain.gain.linearRampToValueAtTime(0.09, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
      const osc = this.#ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(hz, at);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + 0.34);
    }
  }

  /** Failure: low, short, and unmistakably not the chime. */
  buzz() {
    if (!this.#ctx || this.#muted) return;
    const now = this.#ctx.currentTime;
    const gain = this.#gain(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    const osc = this.#ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(96, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.38);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.42);
  }
}

// ── the core ────────────────────────────────────────────────────────────────

/** Ring geometry: radius, how long one turn takes, and which way it goes. */
const RINGS = [
  { r: 118, dur: 44, dir: 1, dash: '2 10', width: 1 },
  { r: 146, dur: 19, dir: -1, dash: '18 26', width: 1.5 },
  { r: 176, dur: 9, dir: 1, dash: '4 16', width: 1 },
];

class Core {
  #root = null;
  #orb = null;
  #rings = [];
  #panels = new Map();
  #bars = [];
  #busy = 0;
  tones = new Tones();

  /** Build the whole layer once. Returns silently if the host is missing. */
  attach(host) {
    if (!host) return;
    this.#root = host;

    const stage = el('div', 'core-stage');

    // Rings first so the orb's glow lands on top of them.
    const rings = svg('svg', { class: 'core-rings', viewBox: '0 0 400 400', 'aria-hidden': 'true' });
    for (const [i, spec] of RINGS.entries()) {
      const group = svg('g', { class: `ring ring-${i}`, style: `--dur:${spec.dur}s; --dir:${spec.dir}` });
      group.append(
        svg('circle', {
          cx: 200,
          cy: 200,
          r: spec.r,
          fill: 'none',
          'stroke-width': spec.width,
          'stroke-dasharray': spec.dash,
          'stroke-linecap': 'round',
        }),
      );
      // One brighter arc per ring, so the rotation is legible rather than a
      // uniform circle that looks static however fast it turns.
      group.append(
        svg('circle', {
          class: 'arc',
          cx: 200,
          cy: 200,
          r: spec.r,
          fill: 'none',
          'stroke-width': spec.width + 0.8,
          'stroke-dasharray': `${spec.r * 0.7} ${spec.r * 10}`,
          'stroke-linecap': 'round',
        }),
      );
      rings.append(group);
      this.#rings.push(group);
    }

    // Data pulses: three dots travelling out from the centre on a stagger, so
    // there is always one in flight and none of them are in step.
    const flow = svg('g', { class: 'flow' });
    for (let i = 0; i < 3; i += 1) {
      flow.append(svg('circle', { class: `spark spark-${i}`, cx: 200, cy: 200, r: 2.2 }));
    }
    rings.append(flow);

    this.#orb = el('div', 'orb');
    this.#orb.append(el('div', 'orb-shell'), el('div', 'orb-core'), el('div', 'orb-filaments'));

    const wave = el('div', 'wave');
    for (let i = 0; i < 9; i += 1) {
      const bar = el('span', 'wave-bar');
      bar.style.setProperty('--i', String(i));
      wave.append(bar);
      this.#bars.push(bar);
    }

    stage.append(rings, this.#orb, wave);

    const panels = el('div', 'panels');
    for (const [key, title] of [
      ['queue', 'Queue'],
      ['work', 'Work'],
      ['spend', 'Spend'],
      ['link', 'Link'],
    ]) {
      const panel = el('div', `panel panel-${key}`);
      panel.append(el('h4', null, title));
      const body = el('div', 'panel-body');
      panel.append(body);
      panels.append(panel);
      this.#panels.set(key, body);
    }

    host.append(stage, panels);
    host.hidden = false;
  }

  /** Fill a panel with label/value rows without ever writing markup. */
  #fill(key, rows) {
    const body = this.#panels.get(key);
    if (!body) return;
    body.replaceChildren();
    for (const [label, value, tone] of rows) {
      const row = el('div', 'panel-row');
      row.append(el('span', 'panel-k', label), el('span', `panel-v ${tone ?? ''}`.trim(), value));
      body.append(row);
    }
  }

  /**
   * The live state, from the same snapshot the header reads.
   *
   * The orb's colour is decided here and nowhere else: anything waiting on the
   * founder is the one condition worth changing colour for, because it is the
   * only one where the system is stopped and a person is the reason.
   */
  update(snapshot, { link = 'open' } = {}) {
    if (!this.#root || !snapshot) return;

    const waiting = snapshot.approvals?.length ?? 0;
    const running = snapshot.running?.length ?? 0;
    const asked = snapshot.questions?.length ?? 0;
    const spent = snapshot.spendTodayUsd ?? 0;
    const cap = snapshot.spendCapUsd ?? 0;
    const overCap = cap > 0 && spent >= cap;

    this.#fill('queue', [
      ['Approvals', String(waiting), waiting > 0 ? 'warn' : 'ok'],
      ['Questions', String(asked), asked > 0 ? 'warn' : 'ok'],
    ]);
    this.#fill('work', [
      ['Running', String(running), running > 0 ? 'live' : 'ok'],
      ['State', snapshot.paused ? 'PAUSED' : 'NOMINAL', snapshot.paused ? 'bad' : 'ok'],
    ]);
    this.#fill('spend', [
      ['Today', `$${spent.toFixed(2)}`, overCap ? 'bad' : 'ok'],
      ['Cap', `$${cap.toFixed(2)}`, ''],
    ]);
    const LINK = { open: ['OPEN', 'ok'], opening: ['OPENING', ''], lost: ['LOST', 'bad'] };
    const [linkLabel, linkTone] = LINK[link] ?? LINK.open;
    this.#fill('link', [
      ['Uplink', linkLabel, linkTone],
      ['Voice', this.tones.muted ? 'MUTED' : 'READY', ''],
    ]);

    // Only a lost uplink is a fault. A stream that has not opened yet is the
    // ordinary first second of every page load, and colouring that as an
    // alarm teaches you to ignore the alarm.
    const alert = snapshot.paused || overCap || link === 'lost';
    this.#root.classList.toggle('is-alert', Boolean(alert));
    this.#root.classList.toggle('is-waiting', waiting > 0 || asked > 0);
    this.#root.classList.toggle('is-live', running > 0);
  }

  /**
   * Mark the start of work. Returns the function that ends it.
   *
   * Counted rather than boolean because two things can be in flight at once —
   * a tick running while you ask a question — and the first one to finish must
   * not switch the orb back to idle while the second is still going.
   */
  begin() {
    this.#busy += 1;
    this.#root?.classList.add('is-busy');
    this.#orb?.classList.remove('puff');
    // Reflow, so re-triggering the animation actually restarts it.
    void this.#orb?.offsetWidth;
    this.#orb?.classList.add('puff');
    this.tones.startHum();

    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.#busy = Math.max(0, this.#busy - 1);
      if (this.#busy === 0) {
        this.#root?.classList.remove('is-busy');
        this.tones.stopHum();
      }
    };
  }

  /** Listening: the waveform runs and the orb leans cyan-bright. */
  listening(on) {
    this.#root?.classList.toggle('is-listening', Boolean(on));
    if (on) this.tones.unlock();
  }

  succeeded() {
    this.tones.chime();
  }

  /** A failure flashes the whole layer red once and sounds the low tone. */
  failed() {
    this.tones.buzz();
    if (!this.#root || still?.matches) return;
    this.#root.classList.remove('flash-bad');
    void this.#root.offsetWidth;
    this.#root.classList.add('flash-bad');
  }
}

export const core = new Core();
