/* ---------------------------------------------------------------------------
   The builder: an exercise's file, written on a page.

   Every field of the file (docs/exercise-file.md) is a control here, grouped
   the way the file is: who it is, the phone, the words, the muscles, the
   landmarks, the measurements, the movement, the faults, the drawing, the
   numbers, the figure. Each change goes into the draft, the draft is checked
   (Spec.check) and the problems listed, and when it has no errors it is laid
   over the library (Moves.draft) so the Recordings tab judges videos with it,
   the Animation tab draws it, and Try it live runs it in the coach. Download
   writes the one file to drop into public/exercises.

   The draft is kept in this browser (localStorage 'ontrack.draft') until it is
   dropped, here or on the coach's page.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DRAFT = 'ontrack.draft';
  const LM = Spec.LANDMARKS;
  const POSE_KEYS = ['face', 'torso', 'neck', 'thigh', 'shin', 'foot', 'uarm', 'farm', 'thighF', 'shinF', 'footF', 'uarmF', 'farmF'];
  const TIMING = [
    ['holdTargetSec', 'Hold, seconds (a hold’s target; a rep’s hold at the top)'], ['repCount', 'Reps in a set'], ['setCount', 'Sets'],
    ['lowerSec', 'Lowering takes at least, seconds (0: not judged)'], ['restSec', 'Quiet after a rep, seconds'], ['readyMs', 'Set-up wait before coaching, ms'],
    ['deepAt', 'Degrees past the band for the stronger words'], ['persistMs', 'A fault holds this long before it is said, ms'], ['cooldownMs', 'The same cue not again inside, ms'],
    ['gapMs', 'No two cues inside, ms'], ['settleMs', 'In position this long before the clock starts, ms'], ['lostEverySec', '"I can’t see you" every, seconds'], ['smooth', 'Smoothing on the readings (1 = none)'], ['vis', 'A landmark below this is not trusted (0–1)'],
  ];

  let draft = null, dirty = false, timer = 0;

  /* ---------- the draft ---------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function start(json) {
    draft = clone(json);
    dirty = true;
    render();
    commit(false);
  }
  function fromLibrary(id) {
    const m = Moves[id]; if (!m) return;
    start(m.spec);
  }
  /* every change comes here: the file is checked, the problems listed, the JSON
     shown, the draft kept in the browser and, when it is whole, laid over the
     library for the other tabs and the coach */
  function commit(structural) {
    if (!draft) return;
    const problems = Spec.check(draft);
    const errors = problems.filter((p) => p.level === 'error');
    $('problems').innerHTML = problems.length
      ? problems.map((p) => `<li class="${p.level}"><b>${esc(p.at || '')}</b> ${esc(p.message)}</li>`).join('')
      : '<li class="ok">Nothing wrong with it.</li>';
    $('build-note').textContent = errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'} to fix before it can run` : `${draft.id}.json is whole${problems.length ? ` (${problems.length} to look at)` : ''}`;
    $('try-live').disabled = !!errors.length;
    if (!structural) $('build-json').value = JSON.stringify(draft, null, 2);
    try { localStorage.setItem(DRAFT, JSON.stringify(draft)); } catch { }
    if (!errors.length) {
      try {
        Moves.draft(draft);
        if (window.__review) { window.__review.refreshMoves(); window.__review.pickMove(draft.id, true); }
      } catch (e) { $('build-note').textContent = 'Could not compile: ' + (e.message || e); }
    }
    if (structural) { render(); $('build-json').value = JSON.stringify(draft, null, 2); }
  }
  function drop() {
    try { localStorage.removeItem(DRAFT); } catch { }
    Moves.draft(null);
    if (window.__review) { window.__review.refreshMoves(); window.__review.pickMove(Moves.list[0].id, true); }
    draft = null; $('build-form').innerHTML = ''; $('problems').innerHTML = ''; $('build-json').value = '';
    $('build-note').textContent = 'No draft. Start one above.';
    $('try-live').disabled = true;
  }
  const debounce = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 250); };

  /* ---------- controls ---------- */
  function field(label, value, onchange, o) {
    o = o || {};
    const lab = el('label', o.wide ? 'wide' : null);
    lab.appendChild(el('span', null, esc(label)));
    let input;
    if (o.options) {
      input = el('select');
      for (const opt of o.options) { const it = el('option', null, esc(Array.isArray(opt) ? opt[1] : opt)); it.value = Array.isArray(opt) ? opt[0] : opt; input.appendChild(it); }
      input.value = value == null ? '' : String(value);
    } else if (o.type === 'textarea') { input = el('textarea'); input.rows = o.rows || 3; input.value = value == null ? '' : value; }
    else if (o.type === 'check') { input = el('input'); input.type = 'checkbox'; input.checked = !!value; lab.className = (lab.className || '') + ' check'; }
    else { input = el('input'); input.type = o.type || 'text'; if (o.type === 'number') { input.step = o.step || 'any'; } input.value = value == null ? '' : value; if (o.placeholder) input.placeholder = o.placeholder; }
    if (o.title) lab.title = o.title;
    input.onchange = () => {
      const v = o.type === 'check' ? input.checked : o.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
      onchange(v);
      commit(!!o.structural);
    };
    if (!o.options && o.type !== 'check') input.oninput = () => { if (o.live !== false) debounce(() => { input.onchange(); }); };
    lab.appendChild(input);
    return lab;
  }
  const section = (title, note) => { const s = el('section', 'panel build-sec'); s.appendChild(el('h2', null, esc(title))); if (note) s.appendChild(el('p', 'tiny', note)); return s; };
  const grid = (cls) => el('div', 'grid ' + (cls || ''));
  const list = (v) => (Array.isArray(v) ? v.join(', ') : '');
  const fromList = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const lines = (v) => (Array.isArray(v) ? v.join('\n') : '');
  const fromLines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const toolbar = (arr, i, onchange) => {
    const t = el('span', 'rowtools');
    const b = (txt, fn, title) => { const x = el('button', 'btn tiny-btn', txt); x.type = 'button'; x.title = title; x.onclick = () => { fn(); onchange(); commit(true); }; t.appendChild(x); };
    b('↑', () => { if (i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; }, 'up');
    b('↓', () => { if (i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; }, 'down');
    b('✕', () => { arr.splice(i, 1); }, 'remove');
    return t;
  };
  const addBtn = (txt, fn) => { const b = el('button', 'btn', txt); b.type = 'button'; b.onclick = () => { fn(); commit(true); }; return b; };
  const measureKeys = () => (draft.measurements || []).map((m) => m.key).filter(Boolean);
  const settingKeys = () => Object.keys(draft.defaults || {});
  const optsOf = (arr, blank) => (blank ? [['', blank]] : []).concat(arr.map((k) => [k, k]));
  const lmOpts = (blank) => optsOf(LM.concat(draft.phone && draft.phone.view === 'front' ? LM.flatMap((k) => ['L.' + k, 'R.' + k]) : []), blank);

  /* ---------- the form ---------- */
  function render() {
    const host = $('build-form'); host.innerHTML = '';
    if (!draft) return;
    const d = draft;
    d.words = d.words || {}; d.phone = d.phone || {}; d.landmarks = d.landmarks || {}; d.measurements = d.measurements || []; d.faults = d.faults || [];
    d.defaults = d.defaults || {}; d.settings = d.settings || []; d.draw = d.draw || []; d.muscles = d.muscles || {}; d.figure = d.figure || {};

    /* identity */
    let s = section('The exercise', 'Its id is the file’s name and the key it is remembered by: one word, lowercase.');
    let g = grid();
    g.appendChild(field('id', d.id, (v) => { d.id = v.trim(); }, { placeholder: 'bridge' }));
    g.appendChild(field('Name', d.name, (v) => { d.name = v; }));
    g.appendChild(field('Order in the list', d.order, (v) => { d.order = v == null ? 99 : v; }, { type: 'number' }));
    g.appendChild(field('Status', d.status || 'ready', (v) => { d.status = v; }, { options: [['ready', 'ready — on the home page'], ['draft', 'draft — listed with a badge']] }));
    g.appendChild(field('Type', d.type, (v) => { d.type = v; }, { options: [['reps', 'reps — a movement, counted'], ['hold', 'hold — one position, timed']], structural: true }));
    g.appendChild(field('Body position', d.position || '', (v) => { d.position = v; }, { options: optsOf(Spec.POSITIONS, '—') }));
    g.appendChild(field('The movement, in words', d.movement, (v) => { d.movement = v; }, { placeholder: 'hips lifted to a line and lowered' }));
    g.appendChild(field('Sides', d.sides || 'both', (v) => { d.sides = v; }, { options: [['both', 'both at once'], ['left', 'the left'], ['right', 'the right'], ['alternate', 'one side per set, alternating']] }));
    g.appendChild(field('Load', d.load || 'none', (v) => { d.load = v; }, { options: [['none', 'none'], ['weight', 'a weight (kg bubble)'], ['band', 'a band (light, medium, heavy)'], ['both', 'a weight and a band']] }));
    g.appendChild(field('Category', d.category, (v) => { d.category = v; }, { placeholder: 'Glutes and hips' }));
    g.appendChild(field('Tags, comma-separated (the search finds these)', list(d.tags), (v) => { d.tags = fromList(v); }));
    g.appendChild(field('Equipment, comma-separated', list(d.equipment), (v) => { d.equipment = fromList(v); }));
    s.appendChild(g); host.appendChild(s);

    /* the phone */
    s = section('The phone', 'Which way it lies decides the frame; the view decides which landmarks can be read.');
    g = grid();
    g.appendChild(field('Orientation', d.phone.orientation || 'tall', (v) => { d.phone.orientation = v; }, { options: [['tall', 'tall — stood up'], ['wide', 'wide — on its side']] }));
    g.appendChild(field('View', d.phone.view || 'side', (v) => { d.phone.view = v; }, { options: [['side', 'side on'], ['front', 'front on (landmarks named L.knee, R.knee)']], structural: true }));
    g.appendChild(field('Distance', d.phone.distance, (v) => { d.phone.distance = v; }, { placeholder: 'two or three metres' }));
    g.appendChild(field('Height', d.phone.height, (v) => { d.phone.height = v; }, { placeholder: 'on the floor' }));
    g.appendChild(field('Placement, in words (the set-up card)', d.phone.placement, (v) => { d.phone.placement = v; }, { type: 'textarea', rows: 2, wide: true }));
    s.appendChild(g); host.appendChild(s);

    /* the words */
    const w = d.words;
    s = section('The words', 'What is said and shown. The opening words are said once; nothing else is said until the start position has been held.');
    g = grid();
    g.appendChild(field('Opening words (said first)', w.start, (v) => { w.start = v; }, { type: 'textarea', rows: 2, wide: true }));
    g.appendChild(field('Starting position, in words', w.position, (v) => { w.position = v; }, { type: 'textarea', rows: 2, wide: true }));
    g.appendChild(field('End position (the top), in words', w.top, (v) => { w.top = v; }, { type: 'textarea', rows: 2, wide: true }));
    g.appendChild(field('How to do it, one step a line', lines(w.howto), (v) => { w.howto = fromLines(v); }, { type: 'textarea', rows: 4, wide: true }));
    g.appendChild(field('What the camera cannot see', w.cannot, (v) => { w.cannot = v; }, { type: 'textarea', rows: 2, wide: true }));
    g.appendChild(field('The numbers, explained (About)', w.about, (v) => { w.about = v; }, { type: 'textarea', rows: 3, wide: true }));
    g.appendChild(field('One line for the card', w.hint, (v) => { w.hint = v; }, { wide: true }));
    g.appendChild(field('Nobody in the frame', w.lost, (v) => { w.lost = v; }, { placeholder: 'Step into the camera, side on' }));
    if (d.type === 'reps') {
      g.appendChild(field('The hold at the top is done', w.lower, (v) => { w.lower = v; }, { placeholder: 'Lower slowly' }));
      g.appendChild(field('Down before the hold was done', w.early, (v) => { w.early = v; }, { placeholder: 'Hold it at the top next time' }));
    }
    g.appendChild(field('Label for the hold setting', w.holdLabel, (v) => { w.holdLabel = v; }, { placeholder: d.type === 'reps' ? 'Hold at the top for' : 'Hold the set for' }));
    g.appendChild(field('Into position (blank keeps “That is it — hold”)', w.hold, (v) => { w.hold = v; }));
    g.appendChild(field('Safety', w.safety, (v) => { w.safety = v; }, { type: 'textarea', rows: 2 }));
    g.appendChild(field('Common mistakes', w.mistakes, (v) => { w.mistakes = v; }, { type: 'textarea', rows: 2 }));
    g.appendChild(field('Easier', w.easier, (v) => { w.easier = v; }));
    g.appendChild(field('Harder', w.harder, (v) => { w.harder = v; }));
    s.appendChild(g); host.appendChild(s);

    /* muscles */
    s = section('Muscles', 'How hard each works, 0 to 1: the figure warms them by this.');
    g = grid('tight');
    for (const k of Spec.REGIONS) g.appendChild(field(k, d.muscles[k], (v) => { if (v) d.muscles[k] = v; else delete d.muscles[k]; }, { type: 'number', step: '0.05' }));
    s.appendChild(g); host.appendChild(s);

    /* landmarks */
    const L = d.landmarks;
    s = section('Landmarks and the skeleton', 'Which points the model must see, which are drawn, and which measurement colours each bone. “Fill from the measurements” works these out from the table below.');
    g = grid();
    g.appendChild(field('Joints used (comma-separated)', list(L.joints), (v) => { L.joints = fromList(v); }, { wide: true, placeholder: LM.join(', ') }));
    g.appendChild(field('Needed — the frame is unusable without these', list(L.needed), (v) => { L.needed = fromList(v); }, { wide: true }));
    g.appendChild(field('Dots drawn', list(L.dots), (v) => { L.dots = fromList(v); }, { wide: true }));
    g.appendChild(field('Bones, one a line as a-b', (L.bones || []).map((b) => b.join('-')).join('\n'), (v) => { L.bones = fromLines(v).map((x) => x.split('-').map((y) => y.trim())).filter((b) => b.length === 2); }, { type: 'textarea', rows: 4 }));
    g.appendChild(field('Bone colours, one a line as a|b: measurement', Object.entries(L.limb || {}).map(([k, v]) => `${k}: ${v}`).join('\n'), (v) => { L.limb = {}; for (const line of fromLines(v)) { const m = /^([^:]+):\s*(\S+)$/.exec(line); if (m) L.limb[m[1].trim()] = m[2]; } }, { type: 'textarea', rows: 4 }));
    s.appendChild(g);
    s.appendChild(addBtn('Fill from the measurements', () => {
      const used = new Set();
      for (const m of d.measurements) for (const k of ['a', 'b', 'c', 'base', 'top', 'at', 'to', 'from']) { const v = m[k]; if (Array.isArray(v)) v.forEach((n) => used.add(n)); else if (v) used.add(v); }
      const order = LM.filter((k) => used.has(k)).concat([...used].filter((k) => !LM.includes(k)));
      L.joints = order; L.needed = order.slice(); L.dots = order.slice();
      const chain = [['shoulder', 'elbow'], ['elbow', 'wrist'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe'], ['heel', 'toe']];
      L.bones = chain.filter(([a, b]) => used.has(a) && used.has(b));
      L.limb = L.limb || {};
    }));
    g = grid();
    d.facing = d.facing || {};
    g.appendChild(field('Faces from', d.facing.from, (v) => { d.facing.from = v; }, { options: lmOpts('—') }));
    g.appendChild(field('toward', d.facing.to, (v) => { d.facing.to = v; }, { options: lmOpts('—'), title: 'the body faces from the first landmark toward the second: tilt, floor and bend readings are signed by it' }));
    d.side = d.side || {};
    g.appendChild(field('Which side is measured', d.side.pick || 'clearest', (v) => { d.side.pick = v; }, { options: [['clearest', 'the side the model sees best'], ['left', 'the left'], ['right', 'the right'], ['highest', 'the side whose joint is higher'], ['measure', 'the side whose measurement is larger']], structural: true }));
    if (d.side.pick === 'highest') g.appendChild(field('That joint', d.side.joint, (v) => { d.side.joint = v; }, { options: lmOpts('—') }));
    if (d.side.pick === 'measure') g.appendChild(field('That measurement', d.side.measure, (v) => { d.side.measure = v; }, { options: optsOf(measureKeys(), '—') }));
    s.appendChild(g); host.appendChild(s);

    /* measurements */
    s = section('Measurements', 'Each is a number read every frame. One with a band is judged, shown on the live page and on the picture; one without only tells the phases apart or picks a side. Bands and settings name keys in the numbers below.');
    const NEED = { angle: ['a', 'b', 'c'], tilt: ['base', 'top'], floor: ['at', 'to'], bend: ['a', 'b', 'c'], rise: ['a', 'b'], down: ['from', 'to'], distance: ['a', 'b'], sum: [] };
    const HINT = { angle: 'the angle at b between a and c', tilt: 'base→top off vertical, + the way the body faces', floor: 'at→to against the floor, 90 plumb', bend: 'b off the line a→c, + above', rise: 'b above a, signed', down: 'from→to lifted from straight down', distance: 'a to b, as a share of per', sum: 'other measurements added' };
    d.measurements.forEach((m, i) => {
      const row = el('div', 'rowbox');
      const head = el('div', 'rowhead', `<b>${esc(m.key || '?')}</b> <span class="muted">${esc(HINT[m.kind] || '')}</span>`);
      head.appendChild(toolbar(d.measurements, i, () => { }));
      row.appendChild(head);
      g = grid('tight');
      g.appendChild(field('key', m.key, (v) => { m.key = v.trim(); }, { structural: true }));
      g.appendChild(field('reading name (blank: the key)', m.of, (v) => { if (v) m.of = v.trim(); else delete m.of; }));
      g.appendChild(field('kind', m.kind, (v) => { m.kind = v; }, { options: Spec.KINDS, structural: true }));
      for (const k of NEED[m.kind] || []) {
        if (k === 'to' && m.kind === 'floor') g.appendChild(field('to (a list: the first the model trusts)', Array.isArray(m.to) ? m.to.join(', ') : m.to, (v) => { const l = fromList(v); m.to = l.length > 1 ? l : l[0]; }));
        else g.appendChild(field(k, m[k], (v) => { m[k] = v; }, { options: lmOpts('—') }));
      }
      if (m.kind === 'distance') g.appendChild(field('per (two landmarks, comma-separated)', list(m.per), (v) => { const l = fromList(v); m.per = l.length === 2 ? l : undefined; }));
      if (m.kind === 'sum') g.appendChild(field('terms, as JSON', JSON.stringify(m.terms || []), (v) => { try { m.terms = JSON.parse(v); } catch { } }, { wide: true, title: '[{ "measure": "back" }, { "kind": "rise", "a": "hip", "b": "knee", "times": -1 }]' }));
      g.appendChild(field('offset (added)', m.offset, (v) => { if (v == null) delete m.offset; else m.offset = v; }, { type: 'number' }));
      g.appendChild(field('times (multiplied)', m.times, (v) => { if (v == null) delete m.times; else m.times = v; }, { type: 'number' }));
      g.appendChild(field('optional — not read is not a fault', m.optional, (v) => { if (v) m.optional = true; else delete m.optional; }, { type: 'check' }));
      const kind = Spec.bandKind(m.band) || 'none';
      g.appendChild(field('band', kind, (v) => { setBand(m, v); }, { options: [['none', 'none — not judged'], ['range', 'between two edges'], ['sym', 'within ± one number'], ['min', 'at least'], ['max', 'at most']], structural: true }));
      if (m.band) {
        const refs = kind === 'sym' ? [['sym', 'within ±']] : kind === 'min' ? [['min', 'at least']] : kind === 'max' ? [['max', 'at most']] : [['lo', 'low edge'], ['hi', 'high edge']];
        for (const [rk, rl] of refs) {
          const key = m.band[rk];
          g.appendChild(field(`${rl}: setting`, key, (v) => { m.band[rk] = v.trim(); ensureSetting(m, v.trim(), rl); }, { structural: true }));
          if (key) g.appendChild(field(`${key} =`, d.defaults[key], (v) => { d.defaults[key] = v; }, { type: 'number' }));
        }
        g.appendChild(field('meter from', (m.scale || [])[0], (v) => { m.scale = [v, (m.scale || [])[1]]; }, { type: 'number' }));
        g.appendChild(field('meter to', (m.scale || [])[1], (v) => { m.scale = [(m.scale || [])[0], v]; }, { type: 'number' }));
        g.appendChild(field('words for the reading', m.label, (v) => { m.label = v; }, { placeholder: 'knee angle' }));
        g.appendChild(field('HUD name', m.hud, (v) => { m.hud = v; }, { placeholder: 'KNEE' }));
        g.appendChild(field('HUD note', m.note, (v) => { m.note = v; }, { placeholder: 'target' }));
        (m.settings || []).forEach((st, j) => {
          g.appendChild(field(`setting ${st.key}: label`, st.label, (v) => { st.label = v; }));
          g.appendChild(field(`${st.key}: slider min`, st.min, (v) => { st.min = v; }, { type: 'number' }));
          g.appendChild(field(`${st.key}: slider max`, st.max, (v) => { st.max = v; }, { type: 'number' }));
        });
      }
      g.appendChild(field('why (a note for the file)', m.why, (v) => { m.why = v; }, { type: 'textarea', rows: 2, wide: true }));
      row.appendChild(g); s.appendChild(row);
    });
    s.appendChild(addBtn('Add a measurement', () => { d.measurements.push({ key: 'm' + (d.measurements.length + 1), kind: 'angle', a: 'hip', b: 'knee', c: 'ankle' }); }));
    host.appendChild(s);

    /* the movement */
    if (d.type === 'reps') {
      d.progress = d.progress || { measure: '', raiseAt: 'raiseAt', downAt: 'downAt', direction: 'up' };
      d.prompt = d.prompt || { id: 'raise', text: '' };
      d.ready = d.ready || { atStart: true, ranges: {} };
      s = section('The movement', 'The progress measurement says how far into the rep the person is: past raiseAt the rep is under way, back past downAt it counts. The prompt asks for it and is never red.');
      g = grid();
      g.appendChild(field('Progress measurement', d.progress.measure, (v) => { d.progress.measure = v; }, { options: optsOf(measureKeys(), '—') }));
      g.appendChild(field('Direction', d.progress.direction || 'up', (v) => { d.progress.direction = v; }, { options: [['up', 'it rises during the rep'], ['down', 'it falls during the rep']] }));
      g.appendChild(field('raiseAt = (counts as under way)', d.defaults.raiseAt, (v) => { d.defaults.raiseAt = v; d.progress.raiseAt = 'raiseAt'; }, { type: 'number' }));
      g.appendChild(field('downAt = (back at the start)', d.defaults.downAt, (v) => { d.defaults.downAt = v; d.progress.downAt = 'downAt'; }, { type: 'number' }));
      g.appendChild(field('Prompt id', d.prompt.id, (v) => { d.prompt.id = v.trim(); }));
      g.appendChild(field('Prompt words', d.prompt.text, (v) => { d.prompt.text = v; }, { placeholder: 'Lift your hips' }));
      g.appendChild(field('In position needs (blank: every banded measurement)', list(d.inPosition), (v) => { const l = fromList(v); if (l.length) d.inPosition = l; else delete d.inPosition; }, { wide: true }));
      g.appendChild(field('Start rule: at the start (below downAt)', d.ready.atStart !== false, (v) => { d.ready.atStart = v; }, { type: 'check' }));
      g.appendChild(field('Start rule: readings in range, one a line as key: low, high', Object.entries(d.ready.ranges || {}).map(([k, r]) => `${k}: ${r[0]}, ${r[1]}`).join('\n'), (v) => { d.ready.ranges = {}; for (const line of fromLines(v)) { const m = /^(\w+):\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(line); if (m) d.ready.ranges[m[1]] = [Number(m[2]), Number(m[3])]; } }, { type: 'textarea', rows: 2, wide: true }));
      s.appendChild(g); host.appendChild(s);
    } else {
      s = section('The hold', 'The clock runs while every banded measurement is good (or the ones named here), after a short settle, and stops the instant one is not.');
      g = grid();
      g.appendChild(field('In position needs (blank: every banded measurement)', list(d.inPosition), (v) => { const l = fromList(v); if (l.length) d.inPosition = l; else delete d.inPosition; }, { wide: true }));
      s.appendChild(g); host.appendChild(s);
    }

    /* faults */
    s = section('Faults, in the order they are corrected', 'The chain of cause: what the rest of the body stands on comes first. A set-up fault is coached at the start, before the movement is asked for. Labels go on the picture (26 characters at most); the spoken words and the stronger words are said.');
    d.faults.forEach((x, i) => {
      const row = el('div', 'rowbox');
      const head = el('div', 'rowhead', `<b>${i + 1}. ${esc(x.id || '?')}</b>`);
      head.appendChild(toolbar(d.faults, i, () => { }));
      row.appendChild(head);
      g = grid('tight');
      g.appendChild(field('id', x.id, (v) => { x.id = v.trim(); }, { structural: true }));
      g.appendChild(field('measurement', x.measure, (v) => { x.measure = v; }, { options: optsOf(measureKeys(), '—') }));
      g.appendChild(field('side of the band', x.side, (v) => { x.side = v; }, { options: [['above', 'above'], ['below', 'below']] }));
      g.appendChild(field('tone', x.tone || '', (v) => { if (v) x.tone = v; else delete x.tone; }, { options: optsOf(Spec.TONES, 'tick (the default)') }));
      g.appendChild(field('set-up fault (coached at the start)', x.setup, (v) => { if (v) x.setup = true; else delete x.setup; }, { type: 'check' }));
      g.appendChild(field('label on the picture', x.label, (v) => { x.label = v; }));
      g.appendChild(field('spoken words', x.text, (v) => { x.text = v; }, { wide: true }));
      g.appendChild(field('stronger words, well past the band', x.deep, (v) => { x.deep = v; }, { wide: true }));
      g.appendChild(field('only when these are good (comma-separated measurements)', list(x.requires), (v) => { const l = fromList(v); if (l.length) x.requires = l; else delete x.requires; }));
      g.appendChild(field('not while these faults are on (comma-separated ids)', list(x.unless), (v) => { const l = fromList(v); if (l.length) x.unless = l; else delete x.unless; }));
      row.appendChild(g); s.appendChild(row);
    });
    s.appendChild(addBtn('Add a fault', () => { d.faults.push({ id: 'fault' + (d.faults.length + 1), measure: measureKeys()[0] || '', side: 'above', label: '', text: '' }); }));
    host.appendChild(s);

    /* the drawing */
    s = section('Drawn on the picture (when angles are on)', 'Arcs at the measurements, guide lines, plumb and floor lines, readouts. Landmarks may be written as measurement:end, e.g. shin:to, for the point a measurement actually used.');
    d.draw.forEach((x, i) => {
      const row = el('div', 'rowbox');
      const head = el('div', 'rowhead', `<b>${esc(x.kind)}</b>`);
      head.appendChild(toolbar(d.draw, i, () => { }));
      row.appendChild(head);
      g = grid('tight');
      g.appendChild(field('kind', x.kind, (v) => { x.kind = v; }, { options: Spec.DRAWS, structural: true }));
      if (x.kind === 'arc' || x.kind === 'readout') g.appendChild(field('measurement', x.measure, (v) => { x.measure = v; }, { options: optsOf(measureKeys(), '—') }));
      if (x.kind === 'arc') { g.appendChild(field('size', x.size, (v) => { x.size = v == null ? 1 : v; }, { type: 'number', step: '0.05' })); g.appendChild(field('dim (not coloured by the verdict)', x.tone === 'none', (v) => { if (v) x.tone = 'none'; else delete x.tone; }, { type: 'check' })); g.appendChild(field('good when these are (comma-separated)', list(x.goodOf), (v) => { const l = fromList(v); if (l.length) x.goodOf = l; else delete x.goodOf; })); }
      if (x.kind === 'readout' || x.kind === 'plumb' || x.kind === 'floor') g.appendChild(field('at', x.at, (v) => { x.at = v; }, { placeholder: 'hip or shin:to' }));
      if (x.kind === 'readout') g.appendChild(field('side (1 below, -1 above, sign)', x.side == null ? '1' : String(x.side), (v) => { x.side = v === 'sign' ? 'sign' : Number(v); }, { options: [['1', 'below the point'], ['-1', 'above it'], ['sign', 'by the reading’s sign']] }));
      if (x.kind === 'plumb') g.appendChild(field('share of the height (negative: downward)', x.share, (v) => { x.share = v; }, { type: 'number', step: '0.01' }));
      if (x.kind === 'floor') g.appendChild(field('direction (1 the way the body faces, -1 back)', x.dir == null ? 1 : x.dir, (v) => { x.dir = v; }, { type: 'number' }));
      if (x.kind === 'line') { g.appendChild(field('from', x.from, (v) => { x.from = v; }, { options: lmOpts('—') })); g.appendChild(field('to', x.to, (v) => { x.to = v; }, { options: lmOpts('—') })); g.appendChild(field('coloured by', x.good, (v) => { x.good = v; }, { options: optsOf(measureKeys(), '—') })); }
      row.appendChild(g); s.appendChild(row);
    });
    s.appendChild(addBtn('Add a drawing', () => { d.draw.push({ kind: 'arc', measure: measureKeys()[0] || '', size: 1 }); }));
    host.appendChild(s);

    /* the numbers */
    s = section('The set, the timing, and the numbers', 'Blank means the app’s own default. Everything here goes into defaults; the settings list is what the exercise page offers to change.');
    g = grid('tight');
    for (const [k, label] of TIMING) g.appendChild(field(label, d.defaults[k], (v) => { if (v == null) delete d.defaults[k]; else d.defaults[k] = v; }, { type: 'number' }));
    g.appendChild(field('Time calls, seconds left (comma-separated)', list(d.defaults.callAtSec), (v) => { d.defaults.callAtSec = fromList(v).map(Number).filter((n) => n > 0); }, { wide: true }));
    s.appendChild(g);
    s.appendChild(el('p', 'tiny', 'Every number in defaults, as the file has it:'));
    g = grid('tight');
    for (const k of settingKeys()) if (k !== 'callAtSec') g.appendChild(field(k, d.defaults[k], (v) => { if (v == null) delete d.defaults[k]; else d.defaults[k] = v; }, { type: 'number' }));
    s.appendChild(g);
    s.appendChild(el('p', 'tiny', 'Offered on the exercise page under “Every number” (a band’s edges are offered by the measurement):'));
    d.settings.forEach((st, i) => {
      const row = el('div', 'rowbox');
      const head = el('div', 'rowhead', `<b>${esc(st.key)}</b>`); head.appendChild(toolbar(d.settings, i, () => { })); row.appendChild(head);
      g = grid('tight');
      g.appendChild(field('key (in defaults)', st.key, (v) => { st.key = v.trim(); }, { options: optsOf(settingKeys()) }));
      g.appendChild(field('label', st.label, (v) => { st.label = v; }));
      g.appendChild(field('min', st.min, (v) => { st.min = v; }, { type: 'number' }));
      g.appendChild(field('max', st.max, (v) => { st.max = v; }, { type: 'number' }));
      row.appendChild(g); s.appendChild(row);
    });
    s.appendChild(addBtn('Add a setting', () => { d.settings.push({ key: settingKeys()[0] || 'repCount', label: '', min: 0, max: 100 }); }));
    host.appendChild(s);

    /* the figure */
    s = section('The figure', 'The exercise page animates it between A and B. Angles are easiest to write by hand; the Animation tab drags points instead, and its figure can be taken from there.');
    const fig = d.figure;
    const mode = fig.points ? 'points' : 'pose';
    g = grid();
    g.appendChild(field('Given as', mode, (v) => { if (v === 'pose') { delete fig.points; fig.pose = fig.pose || { A: { torso: 0 } }; } else { delete fig.pose; fig.points = fig.points || (window.__review ? window.__review.fig : { A: {} }); } }, { options: [['pose', 'joint angles (A and B)'], ['points', 'points, from the Animation tab']], structural: true }));
    if (mode === 'pose') {
      fig.pose = fig.pose || {}; fig.pose.A = fig.pose.A || {}; fig.pose.B = fig.pose.B || null;
      g.appendChild(field('Holds still (A only)', !!fig.pose.hold, (v) => { fig.pose.hold = v; if (v) fig.pose.B = null; else fig.pose.B = fig.pose.B || Object.assign({}, fig.pose.A); }, { type: 'check', structural: true }));
      g.appendChild(field('Wall', fig.pose.wall || '', (v) => { if (v) fig.pose.wall = v; else delete fig.pose.wall; }, { options: [['', 'none'], ['behind', 'behind'], ['ahead', 'ahead']] }));
      s.appendChild(g);
      s.appendChild(el('p', 'tiny', 'Degrees. torso from vertical (+ leaning the way the body faces); thigh, shin from straight down (+ forward); foot from horizontal (+ toes up); arms from straight down. The F ones are the far limb when it differs.'));
      for (const K of fig.pose.hold ? ['A'] : ['A', 'B']) {
        fig.pose[K] = fig.pose[K] || {};
        const row = el('div', 'rowbox'); row.appendChild(el('div', 'rowhead', `<b>${K} — ${K === 'A' ? 'the start' : 'the end'}</b>`));
        const gg = grid('tight');
        gg.appendChild(field('face', fig.pose[K].face || 'right', (v) => { if (v === 'left') fig.pose[K].face = 'left'; else delete fig.pose[K].face; }, { options: ['right', 'left'] }));
        for (const pk of POSE_KEYS.slice(1)) gg.appendChild(field(pk, fig.pose[K][pk], (v) => { if (v == null) delete fig.pose[K][pk]; else fig.pose[K][pk] = v; }, { type: 'number' }));
        row.appendChild(gg); s.appendChild(row);
      }
    } else {
      s.appendChild(g);
      s.appendChild(el('p', 'tiny', `Points from the Animation tab (${Object.keys(fig.points.A || {}).length} joints in A). Edit them there, then press the button below.`));
      s.appendChild(addBtn('Take the figure from the Animation tab', () => { if (window.__review) fig.points = clone(window.__review.fig); }));
    }
    host.appendChild(s);
  }
  /* a band's edges are settings: changing the band's kind makes the keys and their defaults */
  function setBand(m, kind) {
    const base = m.key || 'm';
    const d = draft;
    if (kind === 'none') { delete m.band; delete m.settings; return; }
    const mk = (suffix, value, label) => { const key = base + suffix; if (typeof d.defaults[key] !== 'number') d.defaults[key] = value; return key; };
    m.scale = m.scale || [0, 180];
    m.settings = [];
    if (kind === 'range') { m.band = { lo: mk('Min', 80), hi: mk('Max', 100) }; ensureSetting(m, m.band.lo, 'lowest'); ensureSetting(m, m.band.hi, 'highest'); }
    else if (kind === 'sym') { m.band = { sym: mk('Max', 10) }; m.scale = [-40, 40]; ensureSetting(m, m.band.sym, 'allowed either way'); }
    else if (kind === 'min') { m.band = { min: mk('Min', 160) }; ensureSetting(m, m.band.min, 'at least'); }
    else if (kind === 'max') { m.band = { max: mk('Max', 5) }; ensureSetting(m, m.band.max, 'at most'); }
  }
  function ensureSetting(m, key, words) {
    if (!key) return;
    m.settings = m.settings || [];
    if (typeof draft.defaults[key] !== 'number') draft.defaults[key] = 0;
    if (!m.settings.some((s) => s.key === key)) m.settings.push({ key, label: `${m.label || m.key}, ${words}`, min: Math.min(0, Math.floor(draft.defaults[key] - 40)), max: Math.ceil(draft.defaults[key] + 40) });
  }

  /* ---------- wiring ---------- */
  $('build-new').onclick = () => start(Spec.blank());
  $('build-copy').onclick = () => { const id = $('move').value; if (Moves[id]) start(Moves[id].spec); };
  $('build-file').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { start(JSON.parse(await f.text())); } catch (err) { $('build-note').textContent = 'Not an exercise file: ' + (err.message || err); }
  };
  $('build-download').onclick = () => {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${draft.id || 'exercise'}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  $('try-live').onclick = () => { if (!draft) return; commit(false); location.href = 'index.html#/ex/' + draft.id; };
  $('build-drop').onclick = drop;
  $('build-apply-json').onclick = () => {
    try { const j = JSON.parse($('build-json').value); draft = j; dirty = true; render(); commit(false); }
    catch (e) { $('build-note').textContent = 'That is not JSON: ' + (e.message || e); }
  };
  /* the tuned numbers from the Recordings tab, into the draft */
  $('tuned-to-draft').onclick = () => {
    if (!draft || !window.__review) return;
    Object.assign(draft.defaults, window.__review.tuned);
    commit(true);
  };

  /* a draft kept from last time comes back; otherwise the page waits */
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch { kept = null; }
  if (kept) { draft = kept; render(); commit(false); }
  else $('build-note').textContent = 'No draft. Start one above.';

  window.__builder = { get draft() { return draft; }, start, fromLibrary, commit, drop, render };
})();
