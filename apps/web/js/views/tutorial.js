// First-run tutorial: a dismissible, step-by-step "how to play" overlay.
// Shows automatically the first time a signed-in detective reaches the
// precinct; re-openable any time from the "How to play" button.

const KEY = 'ct_tutorial_v1';

const STEPS = [
  {
    icon: '🕵️',
    title: 'Welcome to Cold Trail',
    body: `You're the detective on a fresh homicide. Exactly one of the suspects did it — and every case is generated from scratch, so no walkthrough exists. Your job: prove <b>who</b> killed the victim, <b>how</b>, <b>when</b>, and <b>why</b>, using the evidence in the casefile.`,
  },
  {
    icon: '📄',
    title: 'Read the casefile',
    body: `Open documents from the file list: the <b>briefing</b>, the <b>autopsy</b> (it gives a time-of-death window — memorise it), the <b>crime scene</b>, <b>call records</b> with cell-tower locations, <b>background checks</b>, and a <b>witness statement</b> for every suspect. People lie — cross-reference everything.`,
  },
  {
    icon: '🗺️',
    title: 'Work the map',
    body: `Open the <b>Area map</b> and tap any two places to measure travel time. Alibis break on geography: if a suspect's phone pinged a tower near the scene during the death window while they claim they were home, that's your lead.`,
  },
  {
    icon: '🔍',
    title: 'Track your suspects',
    body: `In the <b>Suspects</b> panel, tick off <b>means / motive / opportunity</b> for each person, mark someone <b>PRIME</b>, and jot notes. Playing with friends? The board and chat sync live for your whole squad.`,
  },
  {
    icon: '⚖️',
    title: 'Use your tools',
    body: `In the <b>Actions</b> panel: petition a judge for <b>warrants</b> (financials, the estate) — but you need real grounds. Spend limited <b>lab credits</b> on prints, footwear, phone extractions or a weapon-recovery dive. And pull <b>CCTV</b> from cameras around town.`,
  },
  {
    icon: '🗣️',
    title: 'Interrogate',
    body: `Pull a suspect into the interview room and <b>confront them with a document that contradicts their story</b>. Weak evidence gets stonewalled; the guilty turn evasive and eventually lawyer up; the innocent-but-shifty crack and confess an unrelated secret.`,
  },
  {
    icon: '🔒',
    title: 'Make the accusation',
    body: `When you're sure, open <b>Accuse</b> and name the killer, the motive, the weapon and the half-hour it happened. Get it right and the case is closed with a full debrief. Get it wrong and it costs you — so build the case first. Good luck, detective.`,
  },
];

export function shouldAutoShow() {
  try { return !localStorage.getItem(KEY); } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
}

export function showTutorial(force = false) {
  if (!force && !shouldAutoShow()) return;
  if (document.querySelector('.tut-overlay')) return;

  let i = 0;
  const overlay = document.createElement('div');
  overlay.className = 'tut-overlay';
  document.body.appendChild(overlay);

  const close = () => { markSeen(); overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };
  document.addEventListener('keydown', onKey);

  function go(delta) {
    const next = i + delta;
    if (next < 0) return;
    if (next >= STEPS.length) { close(); return; }
    i = next;
    render();
  }

  function render() {
    const s = STEPS[i];
    const last = i === STEPS.length - 1;
    overlay.innerHTML = `
      <div class="tut-card" role="dialog" aria-modal="true" aria-label="How to play">
        <button class="tut-x" aria-label="Close">✕</button>
        <div class="tut-icon">${s.icon}</div>
        <div class="tut-step">Step ${i + 1} of ${STEPS.length}</div>
        <h2>${s.title}</h2>
        <p>${s.body}</p>
        <div class="tut-dots">${STEPS.map((_, n) => `<span class="${n === i ? 'on' : ''}"></span>`).join('')}</div>
        <div class="tut-actions">
          <button class="tut-skip">${last ? '' : 'Skip'}</button>
          <div class="tut-nav">
            ${i > 0 ? '<button class="tut-back">Back</button>' : ''}
            <button class="primary tut-next">${last ? 'Start investigating' : 'Next'}</button>
          </div>
        </div>
      </div>`;
    overlay.querySelector('.tut-x').onclick = close;
    overlay.querySelector('.tut-skip').onclick = close;
    overlay.querySelector('.tut-next').onclick = () => go(1);
    const back = overlay.querySelector('.tut-back');
    if (back) back.onclick = () => go(-1);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  render();
}
