// The Detective Desk: document viewers, interactive map, shared suspect
// board, squad chat, accusation flow, versus race state and the debrief.

import { api, auth, openStream } from '../api.js';
import { el, esc, fmtTime, clock, initials } from '../util.js';
import { avatarImg } from '../avatar.js';

export async function renderGame(layout, sessionId) {
  let state = await api('GET', `/api/sessions/${sessionId}`);
  if (!state.started) { location.hash = `#/lobby/${sessionId}`; return; }

  const c = state.case;
  const docs = c.documents;
  const suspects = docs.find((d) => d.kind === 'background_checks').payload.rows;
  const mapDoc = docs.find((d) => d.kind === 'map');
  const nameOf = {};
  for (const d of docs.find((x) => x.kind === 'call_logs').payload.subscribers) nameOf[d.charId] = d.name;

  // Synthesize a visual "case timeline" from the open casefile: each suspect's
  // claimed movements as bars, with the death window shaded — so alibi gaps are
  // seen, not read out of paragraphs.
  {
    const autopsyP = docs.find((d) => d.kind === 'autopsy').payload;
    const locKind = Object.fromEntries(mapDoc.payload.locations.map((l) => [l.id, l.kind]));
    const locNm = Object.fromEntries(mapDoc.payload.locations.map((l) => [l.id, l.name]));
    const stmtOf = {};
    for (const d of docs.filter((x) => x.kind === 'witness_statement')) stmtOf[d.payload.charId] = d.payload;
    docs.splice(docs.findIndex((d) => d.kind === 'map') + 1, 0, {
      id: 'doc_timeline',
      kind: 'case_timeline',
      title: 'Case Timeline',
      payload: {
        windowStart: autopsyP.windowStart,
        windowEnd: autopsyP.windowEnd,
        rows: suspects.map((s) => ({
          charId: s.charId, name: s.name, motiveId: s.motiveId,
          claims: (stmtOf[s.charId]?.claims || []).map((cl) => ({
            from: cl.from, to: cl.to, kind: locKind[cl.locId] || 'home', place: locNm[cl.locId] || cl.locId,
          })),
        })),
      },
    });
  }

  let activeDocId = docs[0].id;
  let railTab = 'suspects';
  let readDocs = new Set(state.me?.readDocs || []);
  const localBoard = {}; // versus keeps notes client-side only
  let inv = state.inv || { labCredits: 0, docs: [], pendingLab: [], transcript: [], warrants: [] };
  let interrogating = null; // suspectId when the interview room is open
  const allDocs = () => [...docs, ...inv.docs];

  const modeLabel = { solo: 'SOLO', coop: 'CO-OP SQUAD', versus: 'VERSUS RACE' }[state.mode];

  layout(`
  <div class="banner" id="banner">
    <b>${esc(c.title)}</b> · ${esc(c.town)} · case ${esc(c.id)} · <span class="tag amber">${modeLabel}</span>
    ${state.mode !== 'solo' ? ` · invite code <b>${esc(state.code)}</b>` : ''}
    <span id="banner-msg"></span>
  </div>
  <div class="desk m-doc">
    <nav class="desk-col doc-list" id="doc-list"></nav>
    <main class="desk-col doc-view" id="doc-view"></main>
    <aside class="rail">
      <div class="rail-tabs" id="rail-tabs"></div>
      <div class="rail-body" id="rail-body"></div>
    </aside>
  </div>
  <nav class="mobile-nav" id="mobile-nav">
    <button data-mview="files"><span class="mn-ico">🗂️</span>Files</button>
    <button data-mview="doc" class="active"><span class="mn-ico">📄</span>Case</button>
    <button data-mview="tools"><span class="mn-ico">🔍</span>Tools</button>
  </nav>`);

  // On phones only one panel shows at a time; the bottom nav switches between
  // the file list, the reading pane and the investigation rail.
  function setMobileView(v) {
    const desk = document.querySelector('.desk');
    if (!desk) return;
    desk.classList.remove('m-files', 'm-doc', 'm-tools');
    desk.classList.add(`m-${v}`);
    for (const b of document.querySelectorAll('#mobile-nav [data-mview]')) {
      b.classList.toggle('active', b.dataset.mview === v);
    }
  }
  for (const b of document.querySelectorAll('#mobile-nav [data-mview]')) {
    b.onclick = () => setMobileView(b.dataset.mview);
  }

  // ------------------------------------------------------------ doc list ----
  const GROUPS = [
    ['REPORTS', (d) => ['briefing', 'crime_scene', 'autopsy'].includes(d.kind)],
    ['RECORDS', (d) => ['call_logs', 'anpr', 'background_checks', 'map', 'case_timeline'].includes(d.kind)],
    ['STATEMENTS', (d) => d.kind === 'witness_statement'],
  ];

  function shortTitle(d) {
    if (d.kind === 'witness_statement') return d.title.replace('Witness Statement — ', '');
    if (d.kind === 'financial_records') return d.title.replace('Financial Records (Warrant) — ', '$ ');
    if (d.kind === 'lab_report') return d.title.replace('Lab Report — ', '🧪 ');
    if (d.kind === 'cctv_footage') return d.title.replace('CCTV Pull — ', '📹 ');
    if (d.kind === 'estate_file') return '§ Estate & insurance file';
    return { briefing: 'Case briefing', crime_scene: 'Crime scene', autopsy: 'Autopsy report', call_logs: 'Call records', anpr: '🚗 Number-plate reads', map: 'Area map', case_timeline: '⏱ Case timeline', background_checks: 'Background checks' }[d.kind] || d.title;
  }

  function drawDocList() {
    const whoRead = (docId) => {
      if (state.mode !== 'coop') return '';
      const others = state.players.filter((p) => p.id !== auth.user.id && p.readDocs?.includes(docId));
      return others.length ? `<span class="who">${others.map((p) => esc(initials(p.name))).join(' ')}</span>` : '';
    };
    const item = (d) => `
        <button class="doc-item ${d.id === activeDocId ? 'active' : ''}" data-doc="${d.id}">
          <span class="read">${readDocs.has(d.id) ? '✓' : '·'}</span>
          <span>${esc(shortTitle(d))}</span>
          ${whoRead(d.id)}
        </button>`;
    el('doc-list').innerHTML = GROUPS.map(([label, match]) => `
      <div class="doc-group">${label}</div>
      ${docs.filter(match).map(item).join('')}
    `).join('') + (inv.docs.length ? `
      <div class="doc-group">INVESTIGATION</div>
      ${inv.docs.map(item).join('')}` : '')
      + (inv.pendingLab.length ? `<div class="doc-group" style="color:var(--amber)">⧗ ${inv.pendingLab.length} lab result${inv.pendingLab.length > 1 ? 's' : ''} pending…</div>` : '');
    for (const btn of el('doc-list').querySelectorAll('[data-doc]')) {
      btn.onclick = () => openDoc(btn.dataset.doc);
    }
  }

  // ---------------------------------------------------------- doc viewer ----
  function openDoc(docId) {
    activeDocId = docId;
    interrogating = null;
    setMobileView('doc'); // tapping a file jumps to the reading pane on phones
    if (!readDocs.has(docId)) {
      readDocs.add(docId);
      api('POST', `/api/sessions/${sessionId}/read`, { docId }).catch(() => {});
    }
    drawDocList();
    const d = allDocs().find((x) => x.id === docId);
    if (!d) return;
    const head = d.kind === 'witness_statement'
      ? `<div class="stmt-head">${avatarImg(d.payload.charId, 'avatar lg')}<h2>${esc(d.title)}</h2></div>`
      : `<h2>${esc(d.title)}</h2>`;
    el('doc-view').innerHTML = `<article class="paper">
      <div class="stamp">${esc(c.town)} P.D. · case ${esc(c.id)} · confidential</div>
      ${head}
      ${renderDoc(d)}
    </article>`;
    wireDoc(d);
    el('doc-view').scrollTop = 0;
  }

  function prosePara(text) {
    return text.split('\n').filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`).join('');
  }

  function renderDoc(d) {
    if (d.kind === 'crime_scene') {
      return `<p class="muted-ink">Tap a numbered marker to read the finding.</p>
        <canvas id="scenecanvas" width="640" height="440"></canvas>
        <div class="scene-detail" id="scene-detail">Select a marker on the diagram above.</div>`;
    }
    if (d.kind === 'call_logs') {
      const subs = d.payload.subscribers;
      return `
        ${prosePara(d.prose)}
        <div class="toolrow">
          <span>FILTER LINE:</span>
          <select id="cdr-filter"><option value="">— all subscribers —</option>
            ${subs.map((s) => `<option value="${esc(s.charId)}">${esc(s.name)} (${esc(s.number)})</option>`).join('')}
          </select>
        </div>
        <table><thead><tr><th>Time</th><th>From</th><th>To</th><th>Dur</th><th>From tower</th><th>To tower</th><th>Note</th></tr></thead>
        <tbody>${d.payload.rows.map((r, i) => `
          <tr data-row="${i}" data-from="${esc(r.fromCharId || '')}" data-to="${esc(r.toCharId || '')}">
            <td>${fmtTime(r.time)}</td>
            <td>${esc(nameOf[r.fromCharId] || r.from)}</td>
            <td>${esc(nameOf[r.toCharId] || r.to)}</td>
            <td>${r.durationMin}m</td>
            <td>${esc(r.fromTower || '—')}</td>
            <td>${esc(r.toTower || '—')}</td>
            <td>${esc(r.note || '')}</td>
          </tr>`).join('')}</tbody></table>
        <div class="subidx">Cross-reference tower IDs with the area map — a handset registers to whichever cell site is nearest.</div>`;
    }
    if (d.kind === 'background_checks') {
      return `${prosePara(d.prose)}${d.payload.rows.map((r) => `
        <div class="bg-row">${avatarImg(r.charId, 'avatar')}<div>
          <b>${esc(r.name)}</b>, ${r.age}, ${esc(r.occupation)} — ${esc(r.relationship)}.
          ${r.motiveId ? '<span class="tag red">⚑ motive</span>' : ''}<br>
          ${esc(r.motiveNote)}</div></div>`).join('')}`;
    }
    if (d.kind === 'map') {
      const cams = d.payload.cameras || [];
      return `${prosePara(d.prose)}
        <canvas id="mapcanvas" width="760" height="760"></canvas>
        <div class="map-readout" id="map-readout">Click two points to measure travel time.</div>
        ${cams.length ? `<div class="subidx">CCTV coverage: ${cams.map((cm) => esc(cm.label)).join(' · ')} — pull footage from the ACTIONS panel.</div>` : ''}`;
    }
    if (d.kind === 'financial_records') {
      return `${prosePara(d.prose)}
        <table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>${d.payload.rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.desc)}</td><td>${esc(r.amount)}</td></tr>`).join('')}</tbody></table>`;
    }
    if (d.kind === 'anpr') {
      return `${prosePara(d.prose)}
        <table><thead><tr><th>Time</th><th>Plate</th><th>Registered keeper</th><th>Camera</th></tr></thead>
        <tbody>${d.payload.rows.map((r) => `<tr><td>${fmtTime(r.time)}</td><td>${esc(r.plate)}</td><td>${esc(nameOf[r.charId] || '—')}</td><td>${esc(r.camera)}</td></tr>`).join('')}</tbody></table>`;
    }
    if (d.kind === 'case_timeline') {
      const h = 26 + d.payload.rows.length * 22 + 6;
      return `<p class="muted-ink">Each bar is what that person <b>claims</b>. The red band is the death window — a red name has a motive. Look for who claims to be tucked safely away exactly when it happened.</p>
        <canvas id="tlcanvas" width="700" height="${h}"></canvas>
        <div class="tl-legend"><span style="background:#6b5b3e"></span>home <span style="background:#8c2f2f"></span>bar/diner <span style="background:#3e5b6b"></span>shops/office <span style="background:#3e6b45"></span>park</div>`;
    }
    return prosePara(d.prose || '');
  }

  const TL_COL = { home: '#6b5b3e', bar: '#8c2f2f', diner: '#8c2f2f', motel: '#8c2f2f', office: '#3e5b6b', store: '#3e5b6b', bridge: '#3e5b6b', park: '#3e6b45' };
  function wireTimeline(d) {
    const cv = el('tlcanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width; const H = cv.height;
    const T0 = 1140; const T1 = 1470; const span = T1 - T0;
    const nameW = 92; const padR = 10; const axisH = 18; const rowH = 22;
    const x0 = nameW; const x1 = W - padR;
    const pxT = (t) => x0 + ((Math.max(T0, Math.min(T1, t)) - T0) / span) * (x1 - x0);
    ctx.clearRect(0, 0, W, H);
    // death-window band
    const wl = pxT(d.payload.windowStart); const wr = pxT(d.payload.windowEnd);
    ctx.fillStyle = 'rgba(176,74,67,.15)'; ctx.fillRect(wl, axisH, wr - wl, H - axisH);
    ctx.strokeStyle = '#b04a43'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(wl, axisH); ctx.lineTo(wl, H); ctx.moveTo(wr, axisH); ctx.lineTo(wr, H); ctx.stroke();
    // hour gridlines + labels
    ctx.font = '10px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (let t = T0; t <= T1; t += 60) {
      const x = pxT(t);
      ctx.strokeStyle = '#cfc5aa'; ctx.beginPath(); ctx.moveTo(x, axisH); ctx.lineTo(x, H); ctx.stroke();
      ctx.fillStyle = '#8a7c5c'; ctx.fillText(fmtTime(t).slice(0, 5), x, 12);
    }
    // rows
    ctx.textAlign = 'left';
    d.payload.rows.forEach((r, i) => {
      const y = axisH + i * rowH;
      const nm = `${r.name.split(' ')[0]} ${(r.name.split(' ')[1] || '')[0] || ''}`;
      ctx.fillStyle = r.motiveId ? '#b04a43' : '#26221a';
      ctx.font = `${r.motiveId ? 'bold ' : ''}11px Courier New`;
      ctx.fillText(nm, 4, y + 15);
      for (const cl of r.claims) {
        const bx = pxT(cl.from); const bw = Math.max(2, pxT(cl.to) - bx);
        ctx.fillStyle = TL_COL[cl.kind] || '#6b5b3e';
        ctx.fillRect(bx, y + 4, bw, rowH - 8);
        if (bw > 34) {
          ctx.fillStyle = '#f0e6cf'; ctx.font = '9px Courier New';
          ctx.fillText(cl.kind === 'home' ? 'home' : cl.place.split(/[ ,]/)[0], bx + 3, y + 15);
        }
      }
    });
  }

  function wireDoc(d) {
    if (d.kind === 'call_logs') {
      const sel = el('cdr-filter');
      sel.onchange = () => {
        const v = sel.value;
        for (const tr of el('doc-view').querySelectorAll('tbody tr')) {
          tr.classList.toggle('hl', !!v && (tr.dataset.from === v || tr.dataset.to === v));
        }
      };
    }
    if (d.kind === 'map') wireMap(d);
    if (d.kind === 'crime_scene') wireScene(d);
    if (d.kind === 'case_timeline') wireTimeline(d);
  }

  // ------------------------------------------------ interactive crime scene ----
  function wireScene(d) {
    const cv = el('scenecanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width; const H = cv.height;
    // Schematic top-down layout; markers keyed by their number.
    const POS = { 1: [0.5, 0.52], 2: [0.66, 0.4], 3: [0.5, 0.12], 4: [0.83, 0.6], 5: [0.17, 0.82], 6: [0.83, 0.85] };
    const markers = d.payload.markers;
    let sel = null;

    const px = (fx) => 40 + fx * (W - 80);
    const py = (fy) => 30 + fy * (H - 60);

    const bloody = ['blunt_force', 'stabbing', 'gunshot'].includes(d.payload.crimeType);
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    function bloodBlob(x, y, rad) {
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.4) { const r2 = rad * (0.6 + ((Math.sin(a * 3 + 1) + 1) / 2) * 0.6); const bx = x + Math.cos(a) * r2; const by = y + Math.sin(a) * r2 * 0.7; if (a === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by); }
      ctx.closePath(); ctx.fill();
    }
    function chalkBody(x, y) {
      ctx.strokeStyle = '#f4eede'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.arc(x - 36, y - 2, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - 6, y, 28, 13, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 8, y - 11); ctx.lineTo(x + 8, y - 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 8, y + 11); ctx.lineTo(x + 4, y + 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 20, y - 6); ctx.lineTo(x + 44, y - 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 20, y + 6); ctx.lineTo(x + 44, y + 13); ctx.stroke();
    }
    function evMarker(x, y, n, on) {
      ctx.fillStyle = on ? '#c94a3f' : '#e8c24a'; ctx.strokeStyle = '#7a5a10'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - 10, y + 10); ctx.lineTo(x + 10, y + 10); ctx.lineTo(x, y - 13); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#33301f'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), x, y + 3);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      // wood floor
      ctx.fillStyle = '#cbb48b'; ctx.fillRect(30, 20, W - 60, H - 40);
      ctx.strokeStyle = '#c0a97c'; ctx.lineWidth = 1;
      for (let y = 34; y < H - 24; y += 14) { ctx.beginPath(); ctx.moveTo(33, y); ctx.lineTo(W - 33, y); ctx.stroke(); }
      // walls
      ctx.strokeStyle = '#5b513a'; ctx.lineWidth = 6; ctx.strokeRect(30, 20, W - 60, H - 40);
      // rug under the body
      ctx.fillStyle = '#b0996f'; ctx.beginPath(); ctx.ellipse(px(0.5), py(0.55), 78, 50, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9a8358'; ctx.lineWidth = 3; ctx.stroke();
      // furniture
      const fur = '#8a6f4a'; const furD = '#6f5836';
      ctx.fillStyle = fur; ctx.fillRect(px(0.7), py(0.13), 96, 34); ctx.strokeStyle = furD; ctx.lineWidth = 2; ctx.strokeRect(px(0.7), py(0.13), 96, 34); // desk
      ctx.fillStyle = furD; ctx.fillRect(W - 44, py(0.34), 14, 120); // bookshelf
      ctx.fillStyle = fur; ctx.fillRect(px(0.7), H - 60, 84, 20); // sideboard
      ctx.fillStyle = '#d8e4ea'; ctx.strokeStyle = '#a9b8bf'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px(0.75), H - 50, 4, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(px(0.82), H - 50, 4, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = fur; rr(px(0.11), py(0.6), 58, 56, 9); ctx.fill(); ctx.strokeStyle = furD; ctx.lineWidth = 2; ctx.stroke(); // armchair
      // door + swing arc
      ctx.strokeStyle = '#cbb48b'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(px(0.4), 20); ctx.lineTo(px(0.56), 20); ctx.stroke();
      ctx.strokeStyle = '#9a8358'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px(0.4), 23, px(0.56) - px(0.4), -Math.PI / 2, 0); ctx.stroke();
      // window
      ctx.strokeStyle = '#5a86a0'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(30, py(0.66)); ctx.lineTo(30, py(0.9)); ctx.stroke();
      // blood (violent crimes only)
      if (bloody) { ctx.fillStyle = 'rgba(140,28,24,0.5)'; bloodBlob(px(0.5) - 4, py(0.56) + 6, 30); }
      chalkBody(px(0.5), py(0.55));
      // labels
      ctx.fillStyle = '#5c5540'; ctx.font = 'italic 10px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('door', px(0.48), 15); ctx.fillText('desk', px(0.78), py(0.13) - 4);
      ctx.save(); ctx.translate(22, py(0.78)); ctx.rotate(-Math.PI / 2); ctx.fillText('window', 0, 0); ctx.restore();
      // evidence markers
      for (const m of markers) { const p = POS[m.n] || [0.5, 0.5]; evMarker(px(p[0]), py(p[1]), m.n, sel === m.n); }
    }

    function showDetail(n) {
      const m = markers.find((x) => x.n === n);
      el('scene-detail').innerHTML = m
        ? `<b>[${m.n}] ${esc(m.label)}.</b> ${esc(m.detail)}`
        : 'Select a marker on the diagram above.';
    }

    cv.onclick = (e) => {
      const rect = cv.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width);
      const my = (e.clientY - rect.top) * (H / rect.height);
      let best = null; let bd = 26;
      for (const m of markers) {
        const p = POS[m.n] || [0.5, 0.5];
        const dd = Math.hypot(px(p[0]) - mx, py(p[1]) - my);
        if (dd < bd) { best = m.n; bd = dd; }
      }
      if (best) { sel = best; draw(); showDetail(best); }
    };
    draw();
  }

  // ------------------------------------------------------ interactive map ----
  function wireMap(d) {
    const cv = el('mapcanvas');
    const ctx = cv.getContext('2d');
    const { locations, towers, travel, town } = d.payload;
    const PAD = 30; const SIZE = cv.width - PAD * 2; const KM = 8.5;
    const X = (x) => PAD + (x / KM) * SIZE;
    const Y = (y) => cv.height - PAD - (y / KM) * SIZE;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let picked = [];

    const ROOF = { bar: '#9a3b34', diner: '#9a3b34', motel: '#9a3b34', office: '#40607a', store: '#40607a', bridge: '#6d7684', park: '#4e7a4a', home: '#7a6a48' };

    // Road network: connect each place to its two nearest neighbours.
    const roads = []; const seen = new Set();
    for (const a of locations) {
      const near = locations.filter((o) => o !== a).sort((p, q) => dist(a, p) - dist(a, q)).slice(0, 2);
      for (const b of near) { const k = [a.id, b.id].sort().join('|'); if (!seen.has(k)) { seen.add(k); roads.push([a, b]); } }
    }
    // River runs through the bridge, top to bottom.
    const bridge = locations.find((l) => l.kind === 'bridge') || { x: KM / 2, y: KM / 2 };
    let th = 0; for (let i = 0; i < town.length; i++) th = (th * 31 + town.charCodeAt(i)) >>> 0;
    const amp = 0.7 + (th % 40) / 100; const freq = 1.4 + (th % 7) / 10; const phase = (th % 100) / 16;
    const riverX = (y) => bridge.x + amp * Math.sin(y * freq + phase);

    function roadPath(w, color) {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
      for (const [a, b] of roads) { ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke(); }
    }

    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      // land
      ctx.fillStyle = '#dfd7bf'; ctx.fillRect(0, 0, cv.width, cv.height);
      // river
      ctx.strokeStyle = '#9cc0cf'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.beginPath();
      for (let y = -0.3; y <= KM + 0.3; y += 0.2) { const px = X(riverX(y)); const py = Y(y); if (y < 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.stroke();
      ctx.strokeStyle = '#b6d6e2'; ctx.lineWidth = 9; ctx.beginPath();
      for (let y = -0.3; y <= KM + 0.3; y += 0.2) { const px = X(riverX(y)); const py = Y(y); if (y < 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.stroke();
      // parks as green ground
      for (const l of locations) if (l.kind === 'park') { ctx.fillStyle = '#bcd0a0'; ctx.beginPath(); ctx.ellipse(X(l.x), Y(l.y), 34, 26, 0, 0, Math.PI * 2); ctx.fill(); }
      // roads: casing then surface
      roadPath(9, '#c3b48c');
      roadPath(6, '#f2ecda');
      // buildings
      ctx.font = '10px Georgia';
      for (const l of locations) {
        if (l.kind === 'park') continue;
        const on = picked.includes(l);
        const x = X(l.x); const y = Y(l.y);
        const sz = l.kind === 'home' ? 7 : 11;
        ctx.fillStyle = '#6f6549'; ctx.fillRect(x - sz / 2 - 1, y - sz / 2 - 1, sz + 2, sz + 2);
        ctx.fillStyle = on ? '#b04a43' : (ROOF[l.kind] || '#7a6a48');
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        if (on) { ctx.strokeStyle = '#b04a43'; ctx.lineWidth = 2; ctx.strokeRect(x - sz / 2 - 2, y - sz / 2 - 2, sz + 4, sz + 4); }
      }
      // labels (venues bold, homes small surname)
      ctx.textAlign = 'left';
      for (const l of locations) {
        if (l.kind === 'park' || l.kind === 'home') continue;
        ctx.fillStyle = '#33301f'; ctx.font = 'bold 10.5px Georgia';
        ctx.fillText(l.name.split(' — ')[0], X(l.x) + 9, Y(l.y) + 3);
      }
      ctx.fillStyle = '#5c5540'; ctx.font = '9px Georgia';
      for (const l of locations) if (l.kind === 'home') ctx.fillText(l.name.split(/[ ,]/)[0], X(l.x) + 6, Y(l.y) + 3);
      for (const l of locations) if (l.kind === 'park') { ctx.fillStyle = '#3e6b45'; ctx.font = 'italic 10px Georgia'; ctx.fillText(l.name, X(l.x) - 26, Y(l.y) + 3); }
      // cell towers with faint coverage
      for (const t of towers) {
        ctx.fillStyle = 'rgba(138,124,92,0.10)'; ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), 34, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#8a7c5c'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), 34, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#6f6549'; ctx.beginPath(); ctx.moveTo(X(t.x) - 4, Y(t.y) + 4); ctx.lineTo(X(t.x) + 4, Y(t.y) + 4); ctx.lineTo(X(t.x), Y(t.y) - 5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8a7c5c'; ctx.font = '9px Courier New'; ctx.fillText(t.id.replace('tower_', 'Tower '), X(t.x) + 7, Y(t.y) - 5);
      }
      // travel line
      if (picked.length === 2) {
        ctx.strokeStyle = '#b04a43'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 4]);
        ctx.beginPath(); ctx.moveTo(X(picked[0].x), Y(picked[0].y)); ctx.lineTo(X(picked[1].x), Y(picked[1].y)); ctx.stroke(); ctx.setLineDash([]);
      }
      // scale bar
      ctx.strokeStyle = '#33301f'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(PAD, cv.height - 12); ctx.lineTo(PAD + (SIZE / KM), cv.height - 12); ctx.stroke();
      ctx.fillStyle = '#33301f'; ctx.font = '10px Georgia'; ctx.textAlign = 'left';
      ctx.fillText('1 km', PAD + 4, cv.height - 16);
    }

    cv.onclick = (e) => {
      const rect = cv.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (cv.width / rect.width);
      const my = (e.clientY - rect.top) * (cv.height / rect.height);
      let best = null; let bestD = 18;
      for (const l of locations) {
        const dd = Math.hypot(X(l.x) - mx, Y(l.y) - my);
        if (dd < bestD) { best = l; bestD = dd; }
      }
      if (!best) return;
      if (picked.length === 2 || (picked.length === 1 && picked[0] === best)) picked = [];
      picked.push(best);
      if (picked.length === 2) {
        const dist = Math.hypot(picked[0].x - picked[1].x, picked[0].y - picked[1].y);
        const drive = dist < 0.05 ? 0 : Math.round(dist * travel.driveMinPerKm) + travel.driveOverhead;
        const walk = Math.round(dist * travel.walkMinPerKm);
        el('map-readout').innerHTML = `<b>${esc(picked[0].name)}</b> → <b>${esc(picked[1].name)}</b>: ${dist.toFixed(1)} km · drive ~${drive} min · walk ~${walk} min`;
      } else {
        el('map-readout').textContent = `${picked[0].name} — now click a destination.`;
      }
      draw();
    };
    draw();
  }

  // ------------------------------------------------------------ right rail ----
  function drawRailTabs() {
    const tabs = [['suspects', 'SUSPECTS'], ['actions', 'ACTIONS']];
    if (state.mode === 'coop') tabs.push(['chat', 'CHAT']);
    tabs.push(['accuse', 'ACCUSE']);
    if (state.debrief) tabs.push(['debrief', 'DEBRIEF']);
    el('rail-tabs').innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}" class="${railTab === id ? 'active' : ''}">${label}</button>`).join('');
    for (const b of el('rail-tabs').querySelectorAll('[data-tab]')) {
      b.onclick = () => { railTab = b.dataset.tab; drawRail(); };
    }
  }

  function drawRail() {
    drawRailTabs();
    if (railTab === 'suspects') drawSuspects();
    else if (railTab === 'actions') drawActions();
    else if (railTab === 'chat') drawChat();
    else if (railTab === 'accuse') drawAccuse();
    else if (railTab === 'debrief') drawDebrief();
  }

  // -- actions: warrants, lab, cctv --
  function drawActions() {
    const cams = mapDoc.payload.cameras || [];
    const locs = mapDoc.payload.locations;
    const slots = [];
    for (let w = 990; w <= 1530; w += 30) slots.push(w);
    const citable = docs.filter((d) => ['background_checks', 'call_logs', 'anpr', 'witness_statement'].includes(d.kind));
    el('rail-body').innerHTML = `
      <div class="actions">
        <div class="lab-credits">🧪 LAB CREDITS: <b>${inv.labCredits}</b>${inv.pendingLab.length ? ` · ⧗ ${inv.pendingLab.length} pending` : ''}</div>

        <h4 class="act-h">WARRANT REQUEST</h4>
        <p class="muted">The judge grants warrants on documented motive or a lie you can prove — not hunches.</p>
        <label>Target</label>
        <select id="wr-target">
          <option value="estate">The victim’s estate & insurance file</option>
          ${suspects.map((s) => `<option value="${esc(s.charId)}">${esc(s.name)} — financial records</option>`).join('')}
        </select>
        <label>Grounds (cite a document)</label>
        <select id="wr-grounds">${citable.map((d) => `<option value="${esc(d.id)}">${esc(shortTitle(d))}</option>`).join('')}</select>
        <button class="primary" id="wr-go">Petition the judge</button>
        <div id="wr-out" class="act-out"></div>

        <h4 class="act-h">FORENSICS LAB</h4>
        <label>Analysis</label>
        <select id="lab-type">
          <option value="tumbler">Latent prints — the second tumbler</option>
          <option value="shoeprint">Footwear comparison vs. a suspect</option>
          <option value="phone">Device extraction — a suspect’s phone</option>
          <option value="weapon_search">Evidence search at a location</option>
        </select>
        <div id="lab-extra"></div>
        <button class="primary" id="lab-go">Send to the lab (1 credit)</button>
        <div id="lab-out" class="act-out"></div>

        <h4 class="act-h">CCTV PULL</h4>
        <label>Camera</label>
        <select id="cctv-cam">${cams.map((cm) => `<option value="${esc(cm.id)}">${esc(cm.label)}</option>`).join('')}</select>
        <label>Window</label>
        <select id="cctv-win">${slots.map((w) => `<option value="${w}">${fmtTime(w)} – ${fmtTime(w + 30)}</option>`).join('')}</select>
        <button class="primary" id="cctv-go">Pull footage</button>
        <div id="cctv-out" class="act-out"></div>
      </div>`;

    const labExtra = () => {
      const t = el('lab-type').value;
      if (t === 'shoeprint' || t === 'phone') {
        el('lab-extra').innerHTML = `<label>Suspect</label><select id="lab-suspect">${suspects.map((s) => `<option value="${esc(s.charId)}">${esc(s.name)}</option>`).join('')}</select>`;
      } else if (t === 'weapon_search') {
        el('lab-extra').innerHTML = `<label>Location</label><select id="lab-loc">${locs.filter((l) => l.kind !== 'home').map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select>`;
      } else el('lab-extra').innerHTML = '';
    };
    el('lab-type').onchange = labExtra;
    labExtra();

    el('wr-go').onclick = async () => {
      try {
        const r = await api('POST', `/api/sessions/${sessionId}/warrant`, { target: el('wr-target').value, groundsDocId: el('wr-grounds').value });
        el('wr-out').innerHTML = `<div class="verdict ${r.granted ? 'good' : 'bad'}">${esc(r.judge)}</div>`;
      } catch (err) { el('wr-out').innerHTML = `<div class="verdict bad">${esc(err.message)}</div>`; }
    };
    el('lab-go').onclick = async () => {
      try {
        const body = { type: el('lab-type').value };
        if (el('lab-suspect')) body.suspectId = el('lab-suspect').value;
        if (el('lab-loc')) body.locId = el('lab-loc').value;
        const r = await api('POST', `/api/sessions/${sessionId}/lab`, body);
        inv.labCredits = r.labCredits;
        drawRail(); // refresh the credits counter first — it re-renders the panel
        el('lab-out').innerHTML = '<div class="verdict good">Sent. The lab will file its report shortly — watch the sidebar.</div>';
      } catch (err) { el('lab-out').innerHTML = `<div class="verdict bad">${esc(err.message)}</div>`; }
    };
    el('cctv-go').onclick = async () => {
      try {
        const r = await api('POST', `/api/sessions/${sessionId}/cctv`, { cameraId: el('cctv-cam').value, windowStart: Number(el('cctv-win').value) });
        el('cctv-out').innerHTML = '<div class="verdict good">Footage pulled — filed under INVESTIGATION.</div>';
        if (!inv.docs.some((d) => d.id === r.doc.id)) { inv.docs.push(r.doc); drawDocList(); }
      } catch (err) { el('cctv-out').innerHTML = `<div class="verdict bad">${esc(err.message)}</div>`; }
    };
  }

  // -- suspects board (shared in solo/coop, local in versus) --
  const boardOf = (id) => (state.mode === 'versus' ? localBoard : state.board)[id]
    || { means: false, motive: false, opportunity: false, status: 'open', note: '' };

  function drawSuspects() {
    el('rail-body').innerHTML = suspects.map((s) => {
      const b = boardOf(s.charId);
      return `
      <div class="suspect-card ${b.status}" data-sus="${s.charId}">
        <div class="sus-head">
          ${avatarImg(s.charId, 'avatar')}
          <div>
            <h4>${esc(s.name)} ${s.motiveId ? '<span class="tag red">⚑ motive</span>' : ''}</h4>
            <div class="rel">${esc(s.relationship)} · ${esc(s.occupation)}</div>
          </div>
        </div>
        <div class="mmo">
          ${['means', 'motive', 'opportunity'].map((k) => `<label><input type="checkbox" data-k="${k}" ${b[k] ? 'checked' : ''}>${k.slice(0, 3)}</label>`).join('')}
        </div>
        <div class="statusrow">
          <button data-status="cleared" class="${b.status === 'cleared' ? 'sel-cleared' : ''}">cleared</button>
          <button data-status="open" class="${b.status === 'open' ? 'active' : ''}">?</button>
          <button data-status="prime" class="${b.status === 'prime' ? 'sel-prime' : ''}">PRIME</button>
        </div>
        <textarea data-k="note" placeholder="notes…">${esc(b.note)}</textarea>
        <button data-interrogate="${s.charId}" style="width:100%;margin-top:6px">🗣 Interrogate</button>
      </div>`;
    }).join('');
    for (const b of el('rail-body').querySelectorAll('[data-interrogate]')) {
      b.onclick = () => openInterrogation(b.dataset.interrogate);
    }

    for (const card of el('rail-body').querySelectorAll('[data-sus]')) {
      const sid = card.dataset.sus;
      for (const cb of card.querySelectorAll('input[type=checkbox]')) {
        cb.onchange = () => pushBoard(sid, { [cb.dataset.k]: cb.checked });
      }
      for (const b of card.querySelectorAll('[data-status]')) {
        b.onclick = () => { pushBoard(sid, { status: b.dataset.status }); drawSuspects(); };
      }
      const ta = card.querySelector('textarea');
      let t = null;
      ta.oninput = () => { clearTimeout(t); t = setTimeout(() => pushBoard(sid, { note: ta.value }), 500); };
    }
  }

  function pushBoard(suspectId, patch) {
    const store = state.mode === 'versus' ? localBoard : state.board;
    store[suspectId] = { ...boardOf(suspectId), ...patch };
    if (state.mode !== 'versus') {
      api('POST', `/api/sessions/${sessionId}/board`, { suspectId, patch }).catch(() => {});
    }
  }

  // -- interrogation room (renders in the reading pane) --
  function openInterrogation(suspectId) {
    interrogating = suspectId;
    activeDocId = null;
    setMobileView('doc'); // the interview renders in the reading pane
    drawDocList();
    const s = suspects.find((x) => x.charId === suspectId);
    const citable = docs.filter((d) => ['call_logs', 'anpr', 'witness_statement'].includes(d.kind));
    el('doc-view').innerHTML = `<article class="paper interrogation">
      <div class="stamp">${esc(c.town)} P.D. · interview room 2 · recording</div>
      <div class="stmt-head">${avatarImg(suspectId, 'avatar lg')}<h2>INTERROGATION — ${esc(s.name)}</h2></div>
      <p class="muted-ink">${esc(s.relationship)} · ${esc(s.occupation)}. Confrontations only bite when the cited record actually contradicts their story — press with nothing and they stonewall; press the guilty too hard and they call a lawyer.</p>
      <div id="iq-log">${transcriptHtml(suspectId)}</div>
      <div class="iq-controls">
        <button id="iq-alibi">“Walk me through your evening.”</button>
        <button id="iq-victim">“How were things with the victim?”</button>
        <div class="iq-confront">
          <select id="iq-evidence">${citable.map((d) => `<option value="${esc(d.id)}">${esc(shortTitle(d))}</option>`).join('')}</select>
          <button id="iq-go" class="primary">Confront with it</button>
        </div>
      </div>
    </article>`;
    const ask = async (body) => {
      try {
        const { entry } = await api('POST', `/api/sessions/${sessionId}/interrogate`, { suspectId, ...body });
        if (!inv.transcript.some((t) => t.at === entry.at && t.a === entry.a)) inv.transcript.push(entry);
        el('iq-log').innerHTML = transcriptHtml(suspectId);
      } catch (err) {
        el('iq-log').insertAdjacentHTML('beforeend', `<div class="verdict bad">${esc(err.message)}</div>`);
      }
    };
    el('iq-alibi').onclick = () => ask({ question: 'alibi' });
    el('iq-victim').onclick = () => ask({ question: 'victim' });
    el('iq-go').onclick = () => ask({ question: 'confront', evidenceDocId: el('iq-evidence').value });
  }

  function transcriptHtml(suspectId) {
    const rows = inv.transcript.filter((t) => t.suspectId === suspectId);
    if (!rows.length) return '<p class="muted-ink">The suspect sits down. Your move, detective.</p>';
    return rows.map((t) => `
      <div class="qa">
        <div class="qa-q">Det. ${esc(t.byName)}: ${esc(t.q)}</div>
        <div class="qa-a">${esc(t.suspectName)}: ${esc(t.a)}
          ${t.outcome === 'evasive' ? '<span class="tag red">evasive</span>' : ''}
          ${t.outcome === 'lawyered_up' ? '<span class="tag red">lawyered up</span>' : ''}
          ${t.outcome === 'confessed_secret' ? '<span class="tag green">broke — secret out</span>' : ''}
        </div>
      </div>`).join('');
  }

  // -- chat --
  function drawChat() {
    el('rail-body').innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%">
        <div class="chat-log" id="chat-log"></div>
        <form class="chat-form" id="chat-form"><input id="chat-input" placeholder="talk to the squad…" maxlength="500"><button class="primary">➤</button></form>
      </div>`;
    for (const msg of state.chat) appendChat(msg, false);
    scrollChat();
    el('chat-form').onsubmit = async (e) => {
      e.preventDefault();
      const input = el('chat-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await api('POST', `/api/sessions/${sessionId}/chat`, { text }).catch(() => {});
    };
  }

  function appendChat(msg, scroll = true) {
    const log = el('chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="by">${esc(msg.byName)}:</span> ${esc(msg.text)}<span class="at">${clock(msg.at)}</span>`;
    log.appendChild(div);
    if (scroll) scrollChat();
  }
  const scrollChat = () => { const log = el('chat-log'); if (log) log.scrollTop = log.scrollHeight; };

  // -- accuse --
  function windowSlots() {
    const slots = [];
    for (let w = 1200; w <= 1410; w += 30) slots.push(w);
    return slots;
  }

  const GIVEUP = {
    solo: { label: 'Concede — reveal the killer', warn: 'You’ll see who did it, but the case is marked unsolved.' },
    coop: { label: 'Concede for the squad', warn: 'This ends the case for everyone and reveals the killer.' },
    versus: { label: 'Give up — forfeit the race', warn: 'You’re out and it counts as a loss. Your rivals keep racing.' },
  };

  function drawAccuse() {
    const me = state.me || {};
    const lockedFor = Math.max(0, (me.lockedUntil || 0) - Date.now());
    const done = me.solved || me.conceded || me.forfeited || state.winnerId;
    const g = GIVEUP[state.mode] || GIVEUP.solo;
    el('rail-body').innerHTML = `
      <div class="accuse-form">
        <p class="muted" style="margin-top:0">A formal accusation goes to the D.A. — name the killer, the motive, the weapon and the half-hour it happened. ${state.mode === 'versus' ? 'A wrong accusation locks you out for 3 minutes and your rivals will hear about it.' : 'Wrong accusations cost score.'}</p>
        <label>The killer</label>
        <select id="acc-suspect"><option value="">— select —</option>${suspects.map((s) => `<option value="${esc(s.charId)}">${esc(s.name)}</option>`).join('')}</select>
        <label>The motive</label>
        <select id="acc-motive"><option value="">— select —</option>${c.taxonomy.motives.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</select>
        <label>The weapon</label>
        <select id="acc-weapon"><option value="">— select —</option>${c.taxonomy.weapons.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join('')}</select>
        <label>Time of the murder</label>
        <select id="acc-window"><option value="">— select —</option>${windowSlots().map((w) => `<option value="${w}">${fmtTime(w)} – ${fmtTime(w + 30)}</option>`).join('')}</select>
        <button class="primary" id="acc-submit" style="width:100%;margin-top:14px" ${lockedFor > 0 || done ? 'disabled' : ''}>Submit accusation</button>
        <div id="acc-verdict">${lockedFor > 0 ? `<div class="verdict bad">Locked out for ${Math.ceil(lockedFor / 1000)}s after a wrong accusation.</div>` : ''}</div>

        <div class="giveup">
          ${state.daily
    ? '<p class="muted">No giving up on the daily — the culprit is revealed to everyone the day after. Check the precinct screen tomorrow.</p>'
    : done
      ? ''
      : `<p class="muted">Stuck? You can give up and see the answer.</p>
             <button id="giveup-btn">${esc(g.label)}</button>
             <div id="giveup-out"></div>`}
        </div>
      </div>`;

    const submit = el('acc-submit');
    if (submit) submit.onclick = submitAccusation;

    const gb = el('giveup-btn');
    if (gb) {
      gb.onclick = () => {
        el('giveup-out').innerHTML = `
          <div class="verdict bad">${esc(g.warn)} Are you sure?
            <div style="margin-top:8px;display:flex;gap:8px">
              <button id="giveup-yes" class="primary" style="flex:1">Yes, reveal it</button>
              <button id="giveup-no" style="flex:1">Keep going</button>
            </div>
          </div>`;
        gb.style.display = 'none';
        el('giveup-yes').onclick = revealCase;
        el('giveup-no').onclick = drawAccuse;
      };
    }
  }

  async function submitAccusation() {
    const payload = {
      suspectId: el('acc-suspect').value,
      motiveId: el('acc-motive').value,
      weapon: el('acc-weapon').value,
      windowStart: Number(el('acc-window').value),
    };
    if (!payload.suspectId || !payload.motiveId || !payload.weapon || !payload.windowStart) {
      el('acc-verdict').innerHTML = '<div class="verdict bad">The D.A. wants all four: killer, motive, weapon, time.</div>';
      return;
    }
    try {
      const v = await api('POST', `/api/sessions/${sessionId}/accuse`, payload);
      if (v.correct) {
        state.debrief = v.debrief;
        state.debriefOutcome = 'won';
        state.me.solved = true;
        state.me.score = v.score;
        state.verdictBreakdown = v.breakdown;
        railTab = 'debrief';
        drawRail();
        openDebriefDoc();
      } else {
        if (v.lockedUntil) state.me.lockedUntil = v.lockedUntil;
        el('acc-verdict').innerHTML = `<div class="verdict bad">Wrong. The suspect walks and the trail goes colder.${v.lockedUntil ? ' Locked out 3 minutes.' : ` (wrong attempts: ${v.wrongAttempts})`}</div>`;
        if (v.lockedUntil) drawAccuse();
      }
    } catch (err) {
      el('acc-verdict').innerHTML = `<div class="verdict bad">${esc(err.message)}</div>`;
    }
  }

  async function revealCase() {
    try {
      const v = await api('POST', `/api/sessions/${sessionId}/reveal`, {});
      state.debrief = v.debrief;
      state.debriefOutcome = v.forfeit ? 'forfeit' : 'conceded';
      if (state.me) { if (v.forfeit) state.me.forfeited = true; else state.me.conceded = true; }
      railTab = 'debrief';
      drawRail();
      openDebriefDoc();
    } catch (err) {
      const box = el('giveup-out');
      if (box) box.innerHTML = `<div class="verdict bad">${esc(err.message)}</div>`;
    }
  }

  // -- debrief --
  function outcomeBanner() {
    const o = state.debriefOutcome || (state.me?.score != null ? 'won' : 'won');
    const bd = state.verdictBreakdown;
    if (o === 'won') {
      return `<div class="verdict good">CASE CLOSED — score ${state.me?.score ?? ''}${bd ? `<br><span class="muted">motive ${bd.motive ? '✓' : '✗'} · weapon ${bd.weapon ? '✓' : '✗'} · time ${bd.window ? '✓' : '✗'}</span>` : ''}</div>`;
    }
    if (o === 'conceded') return '<div class="verdict bad">YOU GAVE UP — here’s who did it. Case marked unsolved.</div>';
    if (o === 'forfeit') return '<div class="verdict bad">FORFEITED — you’re out of the race and it counts as a loss.</div>';
    if (o === 'lost') return '<div class="verdict bad">Another team cracked it first — you didn’t win this one.</div>';
    return '';
  }

  function drawDebrief() {
    const d = state.debrief;
    if (!d) { el('rail-body').innerHTML = '<p class="muted">Nothing to see yet.</p>'; return; }
    el('rail-body').innerHTML = `
      ${outcomeBanner()}
      <p><b>${esc(d.killerName)}</b> killed the victim at ${esc(d.murderTimeText)} — motive: ${esc(d.motiveLabel)}. Method: ${esc(d.weapon)}.</p>
      <p class="muted">Open the full debrief in the reading pane →</p>
      <button class="primary" id="open-debrief" style="width:100%">Read the full debrief</button>`;
    el('open-debrief').onclick = openDebriefDoc;
  }

  function openDebriefDoc() {
    const d = state.debrief;
    if (!d) return;
    const o = state.debriefOutcome || 'won';
    const stamp = o === 'forfeit' ? 'FORFEITED' : o === 'conceded' ? 'CONCEDED' : 'CLOSED';
    activeDocId = null;
    interrogating = null;
    setMobileView('doc'); // show the reading pane so the debrief is visible on phones
    drawDocList();
    el('doc-view').innerHTML = `<div class="debrief"><article class="paper">
      <div class="stamp">${esc(c.town)} P.D. · case ${esc(c.id)} · ${stamp}</div>
      <h2>DEBRIEF — WHAT REALLY HAPPENED</h2>
      <p><b>${esc(d.killerName)}</b> murdered the victim at <b>${esc(d.murderTimeText)}</b>. Method: <b>${esc(d.weapon)}</b>. Motive: <b>${esc(d.motiveLabel)}</b>.</p>
      <h3 style="font-family:var(--mono)">The fair path to the answer</h3>
      <ol>${d.keyEvidence.map((k) => `<li>${esc(k)}</li>`).join('')}</ol>
      <h3 style="font-family:var(--mono)">The killer's real evening</h3>
      ${d.killerTimeline.map((s) => `<div class="timeline-row"><span>${fmtTime(s.start)} – ${fmtTime(s.end)}</span><span>${esc(s.place)} — ${esc(s.activity)}</span></div>`).join('')}
      <h3 style="font-family:var(--mono)">Who was lying, and why</h3>
      ${d.liars.map((l) => `<div class="marker"><b>${esc(l.name)}</b> — ${esc(l.why)}</div>`).join('')}
    </article></div>`;
    el('doc-view').scrollTop = 0;
  }

  // ------------------------------------------------------------- realtime ----
  openStream(sessionId, {
    players: (players) => { state.players = players; drawDocList(); },
    chat: (msg) => { if (railTab === 'chat') appendChat(msg); },
    unlock: ({ doc, labCredits }) => {
      if (labCredits !== undefined) inv.labCredits = labCredits;
      if (!inv.docs.some((d) => d.id === doc.id)) inv.docs.push(doc);
      inv.pendingLab = inv.pendingLab.filter((p) => `doc_${p.id}` !== doc.id);
      drawDocList();
      const msg = el('banner-msg');
      if (msg) msg.innerHTML = ` · <span class="tag amber">NEW: ${esc(doc.title).slice(0, 60)}</span>`;
      const lc = document.querySelector('.lab-credits b');
      if (lc) lc.textContent = inv.labCredits;
    },
    lab_pending: ({ pending, labCredits }) => {
      inv.labCredits = labCredits;
      if (!inv.pendingLab.some((p) => p.id === pending.id)) inv.pendingLab.push(pending);
      drawDocList();
      if (railTab === 'actions' && !el('rail-body').contains(document.activeElement)) drawRail();
    },
    transcript: (entry) => {
      if (!inv.transcript.some((t) => t.at === entry.at && t.a === entry.a)) inv.transcript.push(entry);
      if (interrogating === entry.suspectId && el('iq-log')) el('iq-log').innerHTML = transcriptHtml(entry.suspectId);
    },
    board: ({ suspectId, entry, byId }) => {
      if (byId === auth.user.id) return;
      state.board[suspectId] = entry;
      if (railTab === 'suspects' && !el('rail-body').contains(document.activeElement)) drawSuspects();
    },
    accusation: (ev) => {
      if (ev.byId === auth.user.id) return;
      const msg = el('banner-msg');
      if (msg) {
        msg.innerHTML = ev.forfeit
          ? ` · <span class="tag red">Det. ${esc(ev.byName)} gave up (forfeit)</span>`
          : ev.correct
            ? ` · <span class="tag green">Det. ${esc(ev.byName)} CLOSED THE CASE</span>`
            : ` · <span class="tag red">Det. ${esc(ev.byName)} accused the wrong person</span>`;
      }
    },
    solved: async () => {
      state = await api('GET', `/api/sessions/${sessionId}`);
      drawRail();
      if (state.debrief && !state.me?.score) openDebriefDoc();
    },
    conceded: async () => {
      // A squadmate gave up — the case ends for everyone; show the debrief.
      state = await api('GET', `/api/sessions/${sessionId}`);
      drawRail();
      if (state.debrief) openDebriefDoc();
    },
  });

  // ---------------------------------------------------------------- boot ----
  drawDocList();
  openDoc(activeDocId);
  drawRail();
}
