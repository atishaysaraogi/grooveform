/* ---------------------------------------------------------------------------
   The builder: the exercise on the studio's left-hand side.

   There is always one exercise open, and it is always a working copy: picking a
   library exercise opens an untouched copy of its file (nothing is stored, the
   recordings are judged with the library's own exercise); the first edit makes it
   the draft — kept in this browser (localStorage 'ontrack.draft'), laid over the
   library (Moves.draft) so the recordings and the coach run it, listed as
   "(draft)". A new exercise starts from a pose and is a draft from its first
   moment. The numbers being tuned have one home, the draft's `defaults`: the
   inputs on the cards write there, a recommendation's Apply writes there, the
   phone receives them in the file or the link.

   A measurement is one card, read top to bottom as a physio would say it: WHAT
   is measured (the shape and its points) and HOW it is read; what it is FOR;
   WHEN it must be right and the RULE; the faults on either side of the rule, each
   with the recommendation the classified reps make for its number. The words come
   from the geometry (Spec.words), never typed, so they are never out of date.

   Everything the file needs that the person has not touched is derived: the
   landmarks and bones from the measurements, the drawing on the picture, which
   way the body faces from the position, the faults' first words from the shape.
   A field once edited is left alone (draft.auto keeps which are still the
   template's; it is not written to the file).
   --------------------------------------------------------------------------- */
/* after the library is loaded and review.js has set itself up (both wait on Moves.ready; this waits after it) */
Moves.ready.then(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DRAFT = 'ontrack.draft';
  const LM = Spec.LANDMARKS;
  const W = Spec.words;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const TIMING = [
    ['lowerSec', 'Lowering takes at least, seconds (0: not judged)'], ['restSec', 'Quiet after a rep, seconds'], ['readyMs', 'Set-up wait before coaching, ms'],
    ['deepAt', 'Degrees past the band for the stronger words'], ['persistMs', 'A fault holds this long before it is said, ms'], ['cooldownMs', 'The same cue not again inside, ms'],
    ['gapMs', 'No two cues inside, ms'], ['settleMs', 'In position this long before the clock starts, ms'], ['returnMs', 'Back at the start this long before a rep is over, ms'],
    ['lostEverySec', '"I can’t see you" every, seconds'], ['smooth', 'Smoothing on the readings (1 = none)'], ['vis', 'A landmark below this is not trusted (0–1)'],
    ['edge', 'A needed point nearer the picture’s edge than this share of it is not trusted (0–0.2)'], ['drop', 'Near the edge, certainty this far below its recent best is not trusted (0–1)'],
    ['jump', 'A point moving faster than this many body-diagonals a second is held where it was'], ['jumpHold', 'For at most this many frames'],
  ];

  /* the draft: the file being worked on, with the builder's bookkeeping on it (auto, source, touched —
     all stripped by fileOf). `source` is the library id the copy came from, null for a pose start
     or a loaded file; `touched` is false for an untouched copy */
  let draft = null, timer = 0;
  const source = () => (draft ? draft.source || null : null);
  const touched = () => !!(draft && draft.touched);
  /* the shapes a measurement can take, in the physio's words, and the file kind (and axis) each is */
  const SHAPES = [
    ['angle', 'an angle at a joint'], ['tilt', 'a line’s lean from upright'], ['floor', 'a line’s angle from the floor'], ['down', 'a line lifted from hanging'],
    ['rise', 'how high one point is over another, as an angle'], ['height', 'the height of one point over another, as a length'], ['ahead', 'how far one point is ahead of another, as a length'],
    ['distance', 'the distance between two points'], ['bend', 'a point off a line'],
  ];
  const SHAPE_HELP = {
    angle: 'the angle at the middle point between the other two — a knee, a hip, an elbow. 180 is straight. One tap on a joint fills all three from the limbs meeting there.',
    tilt: 'how far the line leans off vertical, signed the way the body faces: a trunk from upright, a shin from plumb.',
    floor: 'the angle the line makes with the floor: 90 is upright, over 90 the second point is forward of the first.',
    down: 'how far the line is lifted from hanging straight down: 0 hanging, 90 level, 180 straight up. A thigh from the hip, an arm from the shoulder.',
    rise: 'how far the second point sits above the first, as an angle off level: + above, − below. Good for two points close together (heel and toe).',
    height: 'the height of the second point over the first as a share of a limb: a small lift far from its reference wants a length, not an angle.',
    ahead: 'how far the second point is ahead of the first the way the body faces, as a share of a limb: a knee past the toes by so much.',
    distance: 'the straight distance between the two points as a share of a limb: feet apart, a hand from the shoulder.',
    bend: 'how far the middle point sits off the straight line between the other two, + above: a back sagging or arching between shoulder and ankle.',
  };
  const shapeOf = (m) => (m.kind === 'distance' ? (m.axis === 'y' ? 'height' : m.axis === 'x' ? 'ahead' : 'distance') : m.kind);
  const kindOfShape = (s) => (s === 'height' || s === 'ahead' ? 'distance' : s);
  /* the slot names per kind, in order, and the sentence each shape makes of them */
  const SLOTS = {
    angle: [['a', 'one end'], ['b', 'the joint'], ['c', 'other end']], tilt: [['base', 'base'], ['top', 'top']], floor: [['at', 'at'], ['to', 'to']],
    down: [['from', 'from'], ['to', 'to']], rise: [['a', 'the reference'], ['b', 'the point']], distance: [['a', 'from'], ['b', 'to']], bend: [['a', 'line start'], ['b', 'the point'], ['c', 'line end']],
  };
  const SENTENCE = {
    angle: ['at', 'b', 'between', 'a', 'and', 'c'], tilt: ['of the', 'base', '→', 'top', 'line'], floor: ['of the', 'at', '→', 'to', 'line'], down: ['of the', 'from', '→', 'to', 'line'],
    rise: [':', 'b', 'over', 'a'], height: [':', 'b', 'over', 'a', ', as % of', 'per'], ahead: [':', 'b', 'ahead of', 'a', ', as % of', 'per'],
    distance: ['from', 'a', 'to', 'b', ', as % of', 'per'], bend: [':', 'b', 'off the', 'a', '–', 'c', 'line'],
  };
  /* which measurement's which slot the next pick from the list fills */
  let editing = null;

  /* ================= starting poses ================= */
  const FRONT_SIDE_LYING = { h: [200, 148], shL: [220, 166], shR: [220, 130], hipL: [262, 159], hipR: [262, 137], knL: [290, 161], knR: [290, 135], anL: [315, 163], anR: [315, 133], elL: [180, 160], wrL: [166, 158], elR: [232, 128], wrR: [246, 150] };
  const FRONT_STANDING = { h: [306, 44], shL: [292, 66], shR: [320, 66], hipL: [296, 108], hipR: [316, 108], knL: [294, 136], knR: [318, 136], anL: [293, 162], anR: [319, 162], elL: [282, 90], elR: [330, 90], wrL: [276, 112], wrR: [336, 112] };
  const POSES = [
    { id: 'standing', name: 'Standing, side on', view: 'side', position: 'standing', pose: { A: { torso: 0, thigh: 0, shin: 0, uarm: 8, farm: 8 } } },
    { id: 'seated', name: 'Seated, side on', view: 'side', position: 'seated', pose: { A: { torso: 0, thigh: 90, shin: 0, foot: 0, uarm: 10, farm: 30 } } },
    { id: 'kneeling', name: 'Kneeling, side on', view: 'side', position: 'kneeling', pose: { A: { torso: 0, thigh: 0, shin: -90, foot: 0, uarm: 8, farm: 8 } } },
    { id: 'back', name: 'On the back, side on', view: 'side', position: 'lying', pose: { A: { torso: 90, neck: 0, thigh: -90, shin: -90, foot: 90, uarm: -90, farm: -90 } } },
    { id: 'prone', name: 'On the front, side on', view: 'side', position: 'prone', pose: { A: { torso: 90, neck: 0, thigh: -90, shin: -90, foot: -90, uarm: 140, farm: 60 } } },
    { id: 'fours', name: 'All fours, side on', view: 'side', position: 'quadruped', pose: { A: { face: 'left', torso: -88, neck: -25, thigh: 0, shin: -90, foot: 180, uarm: 0, farm: 0 } } },
    { id: 'sidelying', name: 'On the side, facing the phone', view: 'front', position: 'sidelying', points: { view: 'front', A: FRONT_SIDE_LYING } },
    { id: 'frontstand', name: 'Standing, facing the phone', view: 'front', position: 'standing', points: { view: 'front', A: FRONT_STANDING } },
  ];
  /* a pose as the figure the file carries: points, both keyframes */
  function figureOfPose(p) {
    if (p.points) { const A = clone(p.points.A); return withFeet({ view: 'front', A, B: clone(A), hold: false, side: 'both', flip: false, w: {} }); }
    const f = Figure.fromAngles(p.pose);
    return withFeet({ view: 'side', A: f.A, B: clone(f.A), hold: false, side: 'both', flip: (p.pose.A || {}).face === 'left', w: {} });
  }
  const SIDE_CHAINS = [['h', 'sh', 'hip', 'kn', 'an', 'he', 'ft'], ['an', 'ft'], ['sh', 'el', 'wr'], ['hip', 'knF', 'anF', 'heF', 'ftF'], ['anF', 'ftF'], ['sh', 'elF', 'wrF']];
  const FRONT_CHAINS = [['shL', 'hipL', 'knL', 'anL', 'heL', 'toL'], ['shR', 'hipR', 'knR', 'anR', 'heR', 'toR'], ['shL', 'shR'], ['hipL', 'hipR'], ['shL', 'elL', 'wrL'], ['shR', 'elR', 'wrR'], ['h', 'shL'], ['h', 'shR']];
  const chainsOf = (view) => (view === 'front' ? FRONT_CHAINS : SIDE_CHAINS);
  /* a small drawing of a pose for the picker */
  function poseSvg(fig) {
    const K = fig.A, pts = Object.values(K);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs) - 16, x1 = Math.max(...xs) + 16, y0 = Math.min(...ys) - 18;
    const path = chainsOf(fig.view).map((c) => c.filter((k) => K[k])).filter((c) => c.length > 1).map((c) => 'M' + c.map((k) => K[k].join(' ')).join(' L ')).join(' ');
    return `<svg viewBox="${x0} ${y0} ${x1 - x0} ${168 - y0}"><line class="floor" x1="${x0}" y1="163" x2="${x1}" y2="163"/><path class="ink" d="${path}"/><circle class="ink" cx="${K.h[0]}" cy="${K.h[1]}" r="9"/></svg>`;
  }

  /* ================= templates: what the position implies ================= */
  const ORIENT = { standing: 'tall', seated: 'tall', kneeling: 'tall', lying: 'wide', prone: 'wide', sidelying: 'wide', quadruped: 'wide' };
  const FACING = { standing: ['hip', 'knee'], seated: ['hip', 'knee'], kneeling: ['hip', 'knee'], lying: ['hip', 'knee'], prone: ['hip', 'shoulder'], sidelying: ['hip', 'shoulder'], quadruped: ['hip', 'shoulder'] };
  const INTO = {
    standing: 'step into the frame, side on', seated: 'sit down side on to it', kneeling: 'kneel side on to it', lying: 'lie down on your back, side on to it',
    prone: 'lie face down, side on to it', sidelying: 'lie on your side facing it', quadruped: 'get onto your hands and knees, side on to it',
  };
  const LOST = {
    standing: 'Step into the camera, side on', seated: 'Sit side on to the camera, whole body in', kneeling: 'Kneel side on to the camera, whole body in',
    lying: 'Lie down side on to the camera, whole body in', prone: 'Lie face down, side on to the camera, whole body in', sidelying: 'Lie on your side facing the camera, whole body in',
    quadruped: 'Onto your hands and knees, side on to the camera, whole body in',
  };
  function placementWords(d) {
    const dist = d.phone.distance || 'two or three metres';
    const pos = d.position || 'standing', front = d.phone.view === 'front';
    const where = front ? `facing where you will ${pos === 'standing' ? 'stand' : 'lie'}` : `side on to where you will ${pos === 'standing' ? 'stand' : pos === 'seated' ? 'sit' : pos === 'kneeling' ? 'kneel' : pos === 'quadruped' ? 'be' : 'lie'}`;
    return d.phone.orientation === 'tall' ? `Stand the phone up on the floor, leaning on something, ${dist} away, ${where}.` : `Lay the phone on its side on the floor, ${dist} away, ${where}.`;
  }
  const startWords = (d) => `${placementWords(d)} Then ${(INTO[d.position] || INTO.standing).replace(', side on', d.phone.view === 'front' ? ', facing it' : ', side on')}.`;
  const lostWords = (d) => (d.phone.view === 'front' && d.position !== 'sidelying' ? (LOST[d.position] || LOST.standing).replace('side on', 'facing it') : LOST[d.position] || LOST.standing);

  /* ================= the draft ================= */
  const AUTO = () => ({ id: true, placement: true, start: true, lost: true, landmarks: true, draw: true, facing: true, side: true, prompt: true });
  function fromPose(p) {
    const d = {
      v: 1, id: 'newmove', name: 'New exercise', order: 99, status: 'draft', category: '', tags: [], equipment: [],
      type: 'reps', position: p.position, movement: '', sides: 'both', load: 'none',
      phone: { orientation: ORIENT[p.position] || 'tall', view: p.view, distance: 'two or three metres', height: 'on the floor', placement: '' },
      words: { hint: '', start: '', position: '', top: '', howto: [], cannot: '', about: '', lost: '', lower: 'Lower slowly', early: 'Hold it at the top next time' },
      muscles: {}, facing: { from: 'hip', to: 'knee' }, side: { pick: 'clearest' },
      landmarks: { joints: [], needed: [], bones: [], dots: [], limb: {} },
      measurements: [], faults: [], draw: [],
      defaults: { holdTargetSec: 0, callAtSec: [], repCount: 10, setCount: 3, lowerSec: 1, restSec: 2, deepAt: 10 },
      settings: [{ key: 'repCount', label: 'Reps in a set', min: 1, max: 50 }, { key: 'setCount', label: 'Sets', min: 1, max: 10 }, { key: 'lowerSec', label: 'Lowering takes at least, seconds', min: 0, max: 10 }, { key: 'restSec', label: 'Quiet after a rep, seconds', min: 0, max: 10 }],
      prompt: { id: 'raise', text: '' },
      figure: { points: figureOfPose(p) },
      auto: AUTO(),
    };
    return d;
  }
  /* the feet the muscle figure never drew: a heel behind and below the ankle, a toe ahead; in a
     front view both below it. Added once to a figure that lacks them, then dragged like any joint. */
  function withFeet(f) {
    const feet = (K) => {
      if (!K) return K;
      if (f.view === 'front') {
        for (const sd of ['L', 'R']) { const an = K['an' + sd]; if (!an) continue; if (!K['he' + sd]) K['he' + sd] = [an[0], an[1] + 4]; if (!K['to' + sd]) K['to' + sd] = [an[0] + (sd === 'L' ? -3 : 3), an[1] + 9]; }
      } else {
        for (const [an, ft, he] of [['an', 'ft', 'he'], ['anF', 'ftF', 'heF']]) { if (!K[an] || K[he]) continue; const t = K[ft] || [K[an][0] + 10, K[an][1] + 4]; const dx = t[0] - K[an][0], dy = t[1] - K[an][1], n = Math.hypot(dx, dy) || 1; K[he] = [Math.round(K[an][0] - dx / n * 5), Math.round(K[an][1] - dy / n * 5 + 4)]; }
      }
      return K;
    };
    f.A = feet(f.A); if (f.B) f.B = feet(f.B);
    return f;
  }
  /* the figure a draft carries, as points for the editor */
  function figurePoints(d) {
    const f = d.figure || {};
    if (f.points && f.points.A) return withFeet(Object.assign({ view: f.points.view || 'side' }, clone(f.points), { w: d.muscles || f.points.w || {} }));
    if (f.pose && f.pose.A) { const r = Figure.fromAngles(f.pose); return withFeet({ view: 'side', A: r.A, B: r.B, hold: !!f.pose.hold, flip: (f.pose.A || {}).face === 'left', side: 'both', w: d.muscles || {}, ...(r.wall != null ? { wall: r.wall } : {}) }); }
    return withFeet(figureOfPose(POSES[0]));
  }
  /* a file opened: as a copy of a library exercise (untouched until edited), a new one from a pose,
     a loaded file, or the draft kept from last time */
  function start(json, auto, opts) {
    opts = opts || {};
    draft = clone(json);
    draft.auto = auto || draft.auto || {};   // a loaded or copied file is the person's: nothing in it is the template's
    draft.source = opts.source !== undefined ? opts.source : (draft.source || null);
    draft.touched = !!opts.touched;
    draft.figure = { points: figurePoints(draft) }; delete draft.figure.pose;
    inferRoles();
    editing = null;
    if (window.__review) window.__review.setFig(draft.figure.points);
    render();
    commit(false);
  }
  /* a library exercise opened as an untouched copy; a draft of another exercise stays parked */
  function open(id) { const m = (Moves.library && Moves.library[id]) || Moves[id]; if (!m) return; start(m.spec, {}, { source: id, touched: !!m.draft }); }
  const fromLibrary = open;
  /* a file says which banded measurements make the position (inPosition, or all of them):
     that is each measurement's role here, and the role is the builder's, not the file's */
  function inferRoles() {
    const pos = draft.inPosition, pk = progressKey();
    for (const m of draft.measurements || []) { m.role = m.key === pk ? 'progress' : !m.band ? 'reading' : (!pos || pos.includes(m.key)) ? 'hold' : 'note'; m.named = true; m.short = m.short || m.label || m.key; }
  }
  /* the file as it is written: the builder's bookkeeping left out */
  function fileOf() { const f = clone(draft); delete f.auto; delete f.source; delete f.touched; for (const m of f.measurements || []) { delete m.role; delete m.short; delete m.autoBand; delete m.named; } return f; }
  /* the first edit: the copy becomes the draft. One draft at a time: a draft of another exercise
     still parked is dropped, after asking */
  function touch() {
    if (!draft || draft.touched) return true;
    const parked = Moves.list.find((m) => m.draft && m.id !== draft.id);
    if (parked && !window.confirm(`Drop the draft of “${parked.name}” first? It has not been downloaded.`)) return false;
    if (parked) Moves.draft(null);
    draft.touched = true;
    return true;
  }
  /* the move the recordings are judged with: the draft laid over the library when it is whole, else the library's own */
  const judged = () => Moves[draft.id] || (source() && Moves[source()]) || Moves.list[0];

  /* every change comes here: the derived parts are brought up to date, the file is
     checked, the problems listed, the draft kept, and when whole laid over the library */
  function commit(structural) {
    if (!draft) return;
    derive();
    const file = fileOf();
    const problems = Spec.check(file);
    const errors = problems.filter((p) => p.level === 'error');
    $('problems').innerHTML = problems.length
      ? problems.map((p) => `<li class="${p.level}" data-at="${esc(p.at || '')}"><b>${esc(p.at || '')}</b> ${esc(p.message)}</li>`).join('')
      : '<li class="ok">Nothing wrong with it.</li>';
    const note = $('build-note');
    note.classList.toggle('bad', !!errors.length);
    note.textContent = errors.length ? `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before it can run — see Problems` : `${draft.id}.json · ${touched() ? 'edited' : 'as in the library'}${problems.length ? ` (${problems.length} to look at)` : ''}`;
    $('try-live').disabled = !!errors.length;
    $('build-drop').hidden = !touched();
    $('build-json').value = JSON.stringify(file, null, 2);
    if (touched()) {
      try { localStorage.setItem(DRAFT, JSON.stringify(draft)); } catch { }
      if (!errors.length) { try { Moves.draft(file); } catch (e) { note.textContent = 'Could not compile: ' + (e.message || e); } }
    }
    if (window.__review) { window.__review.refreshMoves(); window.__review.setMove(judged()); }
    if (structural) render(); else refreshValues();
    mark(problems);
    $('measures-note').textContent = `${draft.measurements.length} measurement${draft.measurements.length === 1 ? '' : 's'} · ${draft.faults.length} fault${draft.faults.length === 1 ? '' : 's'}`;
    const reset = $('numbers-reset'); if (reset) reset.hidden = !(touched() && source() && ((Moves.library && Moves.library[source()]) || Moves[source()]));
    $('fig-note').textContent = `${draft.name} · ${draft.type === 'hold' ? 'a hold' : 'reps'} · ${draft.position || ''} · ${draft.phone && draft.phone.view === 'front' ? 'facing the phone' : 'side on'}`;
  }
  /* a number changed by a recommendation's Apply, or any input: one path */
  function setNumber(key, value) { setNumbers({ [key]: value }); }
  function setNumbers(obj) {
    if (!draft || !touch()) return;
    for (const [k, v] of Object.entries(obj)) if (Number.isFinite(v)) draft.defaults[k] = v;
    commit(false);
    document.querySelectorAll('[data-def]').forEach((n) => { if (obj[n.dataset.def] != null && document.activeElement !== n) { n.value = obj[n.dataset.def]; n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); } });
  }

  /* ---- where a problem is on the form ----
     The checker names a place in the file (measurements[2].band, words.start, draw[3].measure);
     the form's controls carry the place they edit (data-at), and a problem lands on the
     control with the longest head of its path — a card when nothing on it is closer. It is
     marked there with its words, every closed section round it says there is something
     inside, and the problem in the list below goes to it, opening what is closed. */
  const AT_ALIAS = { settings: 'defaults', inPosition: 'measurements', 'ready.ranges': 'measurements' };
  function placesOf(at) {
    const path = AT_ALIAS[at] || at || '';
    let best = -1, out = [];
    document.querySelectorAll('#build-form [data-at]').forEach((n) => {
      const a = n.dataset.at;
      if (!(path === a || (path.startsWith(a) && /[.[]/.test(path[a.length])))) return;
      if (a.length > best) { best = a.length; out = [n]; } else if (a.length === best) out.push(n);
    });
    return out;
  }
  function mark(problems) {
    document.querySelectorAll('#build-form .at-msg').forEach((n) => n.remove());
    document.querySelectorAll('#build-form .bad-at, #build-form .warn-at, #build-form .has-bad, #build-form .has-warn').forEach((n) => { n.classList.remove('bad-at', 'warn-at', 'has-bad', 'has-warn'); if (n.dataset.atTitle != null) { n.title = n.dataset.atTitle; delete n.dataset.atTitle; } });
    for (const p of problems) {
      const cls = p.level === 'error' ? 'bad' : 'warn';
      for (const n of placesOf(p.at)) {
        if (cls === 'bad') { n.classList.remove('warn-at'); n.classList.add('bad-at'); } else if (!n.classList.contains('bad-at')) n.classList.add('warn-at');
        if (n.tagName === 'LABEL' || n.tagName === 'DIV') n.appendChild(el('em', 'at-msg ' + cls, esc(p.message)));
        else { if (n.dataset.atTitle == null) n.dataset.atTitle = n.title || ''; n.title = p.message; }
        for (let a = n.parentElement; a && a.id !== 'build-form'; a = a.parentElement) {
          if (a.tagName !== 'DETAILS') continue;
          if (cls === 'bad') { a.classList.remove('has-warn'); a.classList.add('has-bad'); } else if (!a.classList.contains('has-bad')) a.classList.add('has-warn');
        }
      }
    }
    $('problems').querySelectorAll('li[data-at]').forEach((li) => {
      const there = placesOf(li.dataset.at).length > 0;
      li.classList.toggle('goes', there);
      li.onclick = there ? () => goTo(li.dataset.at) : null;
    });
  }
  function goTo(at) {
    const n = placesOf(at)[0]; if (!n) return;
    for (let a = n.parentElement; a; a = a.parentElement) if (a.tagName === 'DETAILS') a.open = true;
    n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
    const f = n.matches('input,select,textarea') ? n : n.querySelector('input,select,textarea');
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
  }
  function drop() {
    try { localStorage.removeItem(DRAFT); } catch { }
    Moves.draft(null);
    const back = source() || Moves.list[0].id;
    draft = null; editing = null;
    open(Moves[back] ? back : Moves.list[0].id);
  }
  const debounce = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 250); };

  /* ================= what is derived ================= */
  const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^[^a-z]+/, '') || 'newmove';
  const lmRefs = (m) => { const out = []; for (const k of ['a', 'b', 'c', 'base', 'top', 'at', 'to', 'from']) { const v = m[k]; if (Array.isArray(v)) out.push(...v); else if (v) out.push(v); } if (m.per) out.push(...m.per); return out; };
  const plain = (n) => String(n || '').replace(/^(other|L|R)\./, '');
  const bandedKeys = () => draft.measurements.filter((m) => m.band).map((m) => m.key);
  const progressKey = () => (draft.type === 'reps' && draft.progress ? draft.progress.measure : null);
  const roleOf = (m) => (m.key === progressKey() ? 'progress' : !m.band ? 'reading' : (draft.inPosition || bandedKeys()).includes(m.key) ? 'hold' : 'note');
  /* the units a kind reads in: degrees, or percent for a length */
  /* when a measurement's faults are judged — kept on each of its faults */
  const whenOf = (m) => { const f = (draft.faults || []).find((x) => x.measure === m.key); return f ? (f.when || (f.setup ? 'always' : 'top')) : 'top'; };
  const setWhen = (m, w) => { for (const x of draft.faults || []) if (x.measure === m.key) { delete x.setup; if (w === 'top') delete x.when; else x.when = w; } };
  function derive() {
    const d = draft, a = d.auto || {};
    d.words = d.words || {}; d.phone = d.phone || {}; d.landmarks = d.landmarks || {}; d.measurements = d.measurements || []; d.faults = d.faults || []; d.defaults = d.defaults || {}; d.settings = d.settings || []; d.draw = d.draw || [];
    if (a.id) d.id = keyOf(d.name);
    if (a.placement) d.phone.placement = placementWords(d);
    if (a.start) d.words.start = startWords(d);
    if (a.lost) d.words.lost = lostWords(d);
    if (a.facing) { const f = FACING[d.position] || FACING.standing; d.facing = { from: f[0], to: f[1] }; }
    /* the position: the lift and the things that must be right; a note is called but does not stop the clock */
    const pos = d.measurements.filter((m) => m.band && (m.role || 'hold') !== 'note').map((m) => m.key);
    const pk = progressKey(); if (pk && !pos.includes(pk)) pos.push(pk);
    if (d.measurements.some((m) => m.band && m.role === 'note')) d.inPosition = pos; else delete d.inPosition;
    if (a.landmarks) {
      const used = [], need = [];
      for (const m of d.measurements) for (const n of lmRefs(m)) { if (!used.includes(n)) used.push(n); if (!m.optional && !m.gate && !need.includes(n)) need.push(n); }
      const order = (arr) => arr.slice().sort((x, y) => (LM.indexOf(plain(x)) - LM.indexOf(plain(y))) || x.localeCompare(y));
      d.landmarks.joints = order(used); d.landmarks.needed = order(need.filter((n) => !/^other\./.test(n)));
      d.landmarks.dots = order(used.filter((n) => !/^other\./.test(n)));
      const chain = [['ear', 'shoulder'], ['shoulder', 'elbow'], ['elbow', 'wrist'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe'], ['heel', 'toe']];
      const has = (n) => used.includes(n);
      const bones = [];
      for (const pre of ['', 'L.', 'R.']) for (const [x, y] of chain) if (has(pre + x) && has(pre + y)) bones.push([pre + x, pre + y]);
      d.landmarks.bones = bones;
      const limb = {};
      for (const [x, y] of bones) { const m = d.measurements.find((q) => q.band && lmRefs(q).includes(x) && lmRefs(q).includes(y)); if (m) limb[x + '|' + y] = m.key; }
      d.landmarks.limb = limb;
    }
    if (a.draw) {
      d.draw = [];
      for (const m of d.measurements) {
        if (!m.band) continue;
        if (m.kind === 'angle' || m.kind === 'bend') d.draw.push({ kind: 'arc', measure: m.key, size: 0.8 });
        else if (m.kind === 'tilt' || m.kind === 'down' || m.kind === 'floor') d.draw.push({ kind: 'arc', measure: m.key, size: 0.7 });
        else d.draw.push({ kind: 'readout', measure: m.key, at: m.b || m.top || m.to, side: -1 });
      }
    }
    if (a.side) {
      if (d.sides === 'alternate' && pk) { const m = d.measurements.find((q) => q.key === pk); d.side = m ? { pick: 'measure', measure: pk, hold: { margin: m.kind === 'distance' ? 8 : 10, frames: 5 } } : { pick: 'clearest' }; }
      else d.side = { pick: 'clearest' };
    }
    if (d.type === 'reps') {
      if (pk) { d.progress.raiseAt = 'raiseAt'; d.progress.downAt = 'downAt'; if (typeof d.defaults.raiseAt !== 'number') d.defaults.raiseAt = 0; if (typeof d.defaults.downAt !== 'number') d.defaults.downAt = 0; }
      if (!d.settings.some((s) => s.key === 'raiseAt') && pk) { const m = d.measurements.find((q) => q.key === pk); d.settings.push({ key: 'raiseAt', label: `${m ? m.label || m.key : 'Reading'} that counts as under way`, min: Math.min(d.defaults.raiseAt - 40, 0), max: d.defaults.raiseAt + 40 }); }
      d.prompt = d.prompt || { id: 'raise', text: '' };
      if (a.prompt && pk) { const m = d.measurements.find((q) => q.key === pk); d.prompt.text = m ? (d.progress.direction === 'down' ? `Lower — ${m.short || m.label || m.key}` : `${cap(m.short || m.label || m.key)} — lift`) : ''; }
    } else { delete d.progress; delete d.prompt; }
    /* every setting a band names is in defaults; every setting listed has one */
    for (const m of d.measurements) for (const s of m.settings || []) if (typeof d.defaults[s.key] !== 'number') d.defaults[s.key] = 0;
    for (const s of d.settings) if (typeof d.defaults[s.key] !== 'number') d.defaults[s.key] = s.key === 'repCount' ? 10 : s.key === 'setCount' ? 3 : 0;
  }

  /* ================= the figure's geometry: what a measurement reads at A and at B ================= */
  const NAME = {
    side: { h: 'ear', sh: 'shoulder', hip: 'hip', kn: 'knee', an: 'ankle', he: 'heel', ft: 'toe', el: 'elbow', wr: 'wrist', knF: 'other.knee', anF: 'other.ankle', heF: 'other.heel', ftF: 'other.toe', elF: 'other.elbow', wrF: 'other.wrist' },
    front: { h: 'ear', shL: 'L.shoulder', shR: 'R.shoulder', hipL: 'L.hip', hipR: 'R.hip', knL: 'L.knee', knR: 'R.knee', anL: 'L.ankle', anR: 'R.ankle', heL: 'L.heel', heR: 'R.heel', toL: 'L.toe', toR: 'R.toe', elL: 'L.elbow', elR: 'R.elbow', wrL: 'L.wrist', wrR: 'R.wrist' },
  };
  const keyOfName = (name, view) => Object.keys(NAME[view]).find((k) => NAME[view][k] === name) || null;
  const figView = () => (draft && draft.figure && draft.figure.points && draft.figure.points.view === 'front' ? 'front' : 'side');
  /* a landmark name → the figure's point (the heel is the ankle; a far limb not drawn apart is the near one) */
  function pointFor(name, K, view) {
    if (!name || !K) return null;
    const P = (k) => (K[k] ? { x: K[k][0], y: K[k][1] } : null);
    if (view === 'front') {
      const m = /^([LR])\.(\w+)$/.exec(name); const sd = m ? m[1] : 'R', n = m ? m[2] : name;
      const key = { shoulder: 'sh', hip: 'hip', knee: 'kn', ankle: 'an', heel: 'he', toe: 'to', elbow: 'el', wrist: 'wr' }[n];
      return n === 'ear' ? P('h') : key ? (P(key + sd) || P((n === 'heel' || n === 'toe' ? 'an' : key) + sd)) : null;
    }
    const far = /^other\./.test(name), n = plain(name);
    const near = { ear: 'h', shoulder: 'sh', hip: 'hip', knee: 'kn', ankle: 'an', heel: 'he', toe: 'ft', elbow: 'el', wrist: 'wr' }[n];
    const farK = { knee: 'knF', ankle: 'anF', heel: 'heF', toe: 'ftF', elbow: 'elF', wrist: 'wrF' }[n];
    return (far && farK && P(farK)) || (near ? (P(near) || (n === 'heel' ? P('an') : null)) : null);
  }
  function facingOf(K, view) {
    const f = draft.facing || { from: 'hip', to: 'knee' };
    const a = pointFor(f.from, K, view), b = pointFor(f.to, K, view);
    return a && b ? (Math.sign(b.x - a.x) || 1) : 1;
  }
  function valueOf(m, K) {
    if (!K || !m) return null;
    const view = figView(), P = (n) => (n ? pointFor(Array.isArray(n) ? n[0] : n, K, view) : null), facing = facingOf(K, view);
    let x = null;
    try {
      switch (m.kind) {
        case 'angle': { const a = P(m.a), b = P(m.b), c = P(m.c); if (a && b && c) x = Core.angleAt(a, b, c); break; }
        case 'tilt': { const a = P(m.base), b = P(m.top); if (a && b) x = Core.tiltFromVertical(a, b, facing); break; }
        case 'floor': { const a = P(m.at), b = P(m.to); if (a && b) x = Core.fromFloor(a, b, facing); break; }
        case 'bend': { const a = P(m.a), b = P(m.b), c = P(m.c); if (a && b && c) x = Core.lineBend(a, b, c, facing); break; }
        case 'rise': { const a = P(m.a), b = P(m.b); if (a && b) x = Core.rise(a, b); break; }
        case 'down': { const a = P(m.from), b = P(m.to); if (a && b) x = Core.fromDown(a, b); break; }
        case 'distance': { const a = P(m.a), b = P(m.b); if (a && b) { x = Math.hypot(a.x - b.x, a.y - b.y); if (m.per) { const c = P(m.per[0]), d = P(m.per[1]); const ref = c && d ? Math.hypot(c.x - d.x, c.y - d.y) : 0; x = ref ? x / ref : null; } } break; }
        default: x = null;
      }
    } catch { x = null; }
    if (x == null || !Number.isFinite(x)) return null;
    return x * (m.times == null ? 1 : m.times) + (m.offset || 0);
  }
  const fmt = (v, m) => (v == null ? '—' : (m && m.kind === 'distance' && !m.times ? v.toFixed(2) : Math.round(v) + (m && m.kind === 'distance' ? '%' : '°')));
  const valuesAB = (m) => { const f = draft.figure.points; return { A: valueOf(m, f.A), B: valueOf(m, f.B || f.A) }; };

  const NEIGHBOURS = {
    side: { kn: ['hip', 'an'], hip: ['sh', 'kn'], an: ['kn', 'ft'], sh: ['hip', 'el'], el: ['sh', 'wr'], he: ['ft', 'kn'], knF: ['hip', 'anF'], anF: ['knF', 'ftF'], elF: ['sh', 'wrF'], heF: ['ftF', 'knF'] },
    front: { knL: ['hipL', 'anL'], hipL: ['shL', 'knL'], shL: ['hipL', 'elL'], elL: ['shL', 'wrL'], anL: ['knL', 'toL'], heL: ['toL', 'knL'], knR: ['hipR', 'anR'], hipR: ['shR', 'knR'], shR: ['hipR', 'elR'], elR: ['shR', 'wrR'], anR: ['knR', 'toR'], heR: ['toR', 'knR'] },
  };
  const SEGMENTS = [['hip', 'shoulder', 'torso'], ['hip', 'knee', 'thigh'], ['knee', 'ankle', 'shin'], ['shoulder', 'elbow', 'arm'], ['elbow', 'wrist', 'forearm'], ['heel', 'toe', 'foot'], ['ankle', 'toe', 'foot'], ['shoulder', 'wrist', 'arm'], ['hip', 'ankle', 'leg'], ['shoulder', 'ear', 'neck']];
  /* ================= measuring: a shape, a point per slot, the words from the geometry ================= */
  const side_ = (n) => (/^other\./.test(n) ? 'other' : /^L\./.test(n) ? 'l' : /^R\./.test(n) ? 'r' : '');
  const uniqueKey = (base, self) => { base = keyOf(base) || 'm'; let k = base, n = 2; while (draft.measurements.some((m) => m !== self && m.key === k)) k = base + n++; return k; };
  const slotsOf = (kind) => SLOTS[kind] || SLOTS.angle;
  const filled = (m) => slotsOf(m.kind).every(([k]) => m[k]) && (!needsPer(m) || (m.per && m.per[0] && m.per[1]));
  const needsPer = (m) => m.kind === 'distance';
  const nextEmpty = (m, after) => { const sl = slotsOf(m.kind).map(([k]) => k); const from = after ? sl.indexOf(after) + 1 : 0; return sl.slice(from).concat(sl.slice(0, from)).find((k) => !m[k]) || null; };
  const describe = (m) => W.describe(m, draft);
  /* the key, the words and the short name follow the geometry until the person names it */
  function nameIt(m) {
    if (m.named) return;
    const d = describe(m);
    const old = m.key, nk = uniqueKey(d.named ? d.short : 'm', m);
    if (old !== nk) { m.key = nk; for (const x of draft.faults) if (x.measure === old) x.measure = nk; if (draft.progress && draft.progress.measure === old) draft.progress.measure = nk; if (draft.inPosition) draft.inPosition = draft.inPosition.map((k) => (k === old ? nk : k)); renameRefs(old, nk); }
    m.label = d.named ? d.what : ''; m.short = d.named ? d.short.replace(/([A-Z])/g, ' $1').toLowerCase() : 'reading'; m.hud = d.hud;
  }
  /* a slot filled from the list: the next empty one is the one being filled */
  function fillSlot(m, slot, name) {
    if (!touch()) return;
    if (slot === 'per0' || slot === 'per1') { m.per = m.per || [null, null]; m.per[slot === 'per0' ? 0 : 1] = name; }
    else {
      m[slot] = name;
      if (m.kind === 'angle' && slot === 'b' && !m.a && !m.c) { const k = keyOfName(name, figView()); const nb = k && NEIGHBOURS[figView()][k]; if (nb) { m.a = NAME[figView()][nb[0]]; m.c = NAME[figView()][nb[1]]; } }
    }
    nameIt(m);
    const nxt = nextEmpty(m, slot);
    editing = nxt ? { m, slot: nxt } : null;
    commit(true);
  }
  /* the shape changed: the points kept by position, the words and the band's defaults re-derived */
  function setShape(m, shape) {
    const was = slotsOf(m.kind).map(([k]) => m[k]), kind = kindOfShape(shape);
    for (const k of ['a', 'b', 'c', 'base', 'top', 'at', 'to', 'from']) delete m[k];
    slotsOf(kind).forEach(([k], i) => { if (was[i]) m[k] = was[i]; });
    m.kind = kind;
    if (shape === 'height') m.axis = 'y'; else if (shape === 'ahead') m.axis = 'x'; else delete m.axis;
    if (kind === 'distance') { m.per = m.per || (figView() === 'front' ? ['R.knee', 'R.ankle'] : ['knee', 'ankle']); m.times = 100; } else { delete m.per; if (m.times === 100) delete m.times; }
    m.named = false;
    if (m.band) setBand(m, Spec.bandKind(m.band));
    nameIt(m);
    editing = nextEmpty(m) ? { m, slot: nextEmpty(m) } : null;
  }
  /* the landmark list over a slot */
  const LIMBS = [['the trunk', ['hip', 'shoulder']], ['the thigh', ['hip', 'knee']], ['the shin', ['knee', 'ankle']], ['the upper arm', ['shoulder', 'elbow']], ['the forearm', ['elbow', 'wrist']], ['the foot', ['heel', 'toe']]];
  function landmarkPopup(anchor, m, slot) {
    document.querySelectorAll('.lm-pop').forEach((n) => n.remove());
    const pop = el('div', 'lm-pop');
    const group = (title, names, pick) => { pop.appendChild(el('div', 'lm-title', esc(title))); const g = el('div', 'lm-grid'); for (const n of names) { const b = btn(W.pointWords(n, true), () => { pop.remove(); pick(n); }, 'tiny-btn'); if (m[slot] === n) b.setAttribute('aria-pressed', 'true'); g.appendChild(b); } pop.appendChild(g); };
    if (slot === 'per') {
      pop.appendChild(el('div', 'lm-title', 'as a share of which limb'));
      const g = el('div', 'lm-grid'); const pre = figView() === 'front' ? 'R.' : '';
      for (const [w, [a, b]] of LIMBS) { const bt = btn(w, () => { pop.remove(); if (!touch()) return; m.per = [pre + a, pre + b]; nameIt(m); commit(true); }, 'tiny-btn'); if (m.per && m.per[0] === pre + a && m.per[1] === pre + b) bt.setAttribute('aria-pressed', 'true'); g.appendChild(bt); }
      pop.appendChild(g);
      pop.appendChild(el('div', 'lm-title', 'or two points: from'));
      const g2 = el('div', 'lm-grid'); for (const n of LM) g2.appendChild(btn(W.pointWords(n, true), () => { pop.remove(); fillSlot(m, 'per0', n); }, 'tiny-btn')); pop.appendChild(g2);
      pop.appendChild(el('div', 'lm-title', 'to')); const g3 = el('div', 'lm-grid'); for (const n of LM) g3.appendChild(btn(W.pointWords(n, true), () => { pop.remove(); fillSlot(m, 'per1', n); }, 'tiny-btn')); pop.appendChild(g3);
    } else if (figView() === 'front') { group('Left', LM.map((n) => 'L.' + n), (n) => fillSlot(m, slot, n)); group('Right', LM.map((n) => 'R.' + n), (n) => fillSlot(m, slot, n)); }
    else { group('This side', LM, (n) => fillSlot(m, slot, n)); group('The other side', LM.map((n) => 'other.' + n), (n) => fillSlot(m, slot, n)); }
    anchor.parentNode.appendChild(pop);
    const close = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  }
  /* what the drawing says the measurement reads, on request: the edges around the end, the
     thresholds between start and end */
  const TOL = (m) => (m.kind === 'angle' || m.kind === 'bend' ? 10 : m.kind === 'distance' ? 10 : 8);
  const bandDefault = (m) => ({ angle: { range: [90, 180], min: 160, max: 20, sym: 10 }, tilt: { range: [-20, 20], min: -20, max: 20, sym: 10 }, floor: { range: [60, 120], min: 60, max: 120, sym: 10 }, down: { range: [0, 90], min: 45, max: 45, sym: 10 }, rise: { range: [-10, 10], min: 0, max: 10, sym: 10 }, distance: m.axis ? { range: [-20, 20], min: -10, max: 10, sym: 10 } : { range: [50, 150], min: 50, max: 150, sym: 20 }, bend: { range: [-10, 10], min: -5, max: 5, sym: 5 } }[m.kind] || { range: [0, 100], min: 0, max: 100, sym: 10 });
  const settingLabel = (m, words) => `${cap((describe(m).what || m.key))}, ${words}`;
  const ensureSetting = (m, key, value, words, lo, hi) => { if (typeof draft.defaults[key] !== 'number') draft.defaults[key] = Math.round(value); m.settings = m.settings || []; if (!m.settings.some((s) => s.key === key)) m.settings.push({ key, label: settingLabel(m, words), min: Math.round(lo), max: Math.round(hi) }); };
  function clearBand(m) {
    for (const s of m.settings || []) { if (!(draft.settings || []).some((t) => t.key === s.key) && !['raiseAt', 'downAt'].includes(s.key)) delete draft.defaults[s.key]; }
    delete m.band; delete m.settings; delete m.scale; delete m.note;
    draft.faults = draft.faults.filter((x) => x.measure !== m.key);
  }
  /* a band of a shape, with default edges for its kind and a fault for each side, worded from the geometry */
  function setBand(m, kind) {
    const d = draft, base = m.key, def = bandDefault(m), span = def.range[1] - def.range[0], w = whenOf(m);
    const keep = d.faults.filter((x) => x.measure === m.key && x.own);   // faults the person has worded stay through a change of rule
    clearBand(m);
    if (kind === 'none') return;
    m.scale = m.kind === 'angle' ? [0, 180] : m.kind === 'distance' ? (m.axis ? [-100, 100] : [0, 200]) : m.kind === 'down' ? [0, 180] : m.kind === 'floor' ? [0, 180] : [-90, 90];
    if (kind === 'range') { m.band = { lo: base + 'Min', hi: base + 'Max' }; ensureSetting(m, base + 'Min', def.range[0], 'at least', def.range[0] - span, def.range[1] + span); ensureSetting(m, base + 'Max', def.range[1], 'at most', def.range[0] - span, def.range[1] + span); }
    else if (kind === 'min') { m.band = { min: base + 'Min' }; ensureSetting(m, base + 'Min', def.min, 'at least', def.min - span, def.min + span); }
    else if (kind === 'max') { m.band = { max: base + 'Max' }; ensureSetting(m, base + 'Max', def.max, 'at most', def.max - span, def.max + span); }
    else if (kind === 'sym') { m.band = { sym: base + 'Max' }; m.scale = [-45, 45]; ensureSetting(m, base + 'Max', def.sym, 'allowed either way', 1, 45); }
    const f = (id, side) => { const kept = keep.find((x) => x.side === side); if (kept) { d.faults.push(kept); return; } const t = W.faultTemplate(d, m, side); d.faults.push(Object.assign({ id, measure: m.key, side, label: t.label.slice(0, 26), text: t.text, tone: roleOf(m) === 'progress' ? (side === 'above' ? 'down' : 'up') : 'plain' }, w !== 'top' ? { when: w } : {})); };
    if (kind === 'min') f(base + 'Low', 'below');
    else if (kind === 'max') f(base + 'High', 'above');
    else if (kind === 'sym') { f(base + 'Over', 'above'); f(base + 'Under', 'below'); }
    else { f(base + 'Low', 'below'); f(base + 'High', 'above'); }
  }
  function setRole(m, role) {
    const d = draft, was = roleOf(m);
    if (was === 'progress' && role !== 'progress') { delete d.progress; delete d.defaults.raiseAt; delete d.defaults.downAt; d.settings = d.settings.filter((s) => s.key !== 'raiseAt'); }
    m.role = role;
    if (role === 'reading') { clearBand(m); return; }
    if (role === 'progress') {
      const prev = d.measurements.find((q) => q !== m && roleOf(q) === 'progress'); if (prev) prev.role = 'hold';
      const def = bandDefault(m).range;
      d.progress = { measure: m.key, raiseAt: 'raiseAt', downAt: 'downAt', direction: (d.progress && d.progress.direction) || 'up' };
      if (typeof d.defaults.raiseAt !== 'number') d.defaults.raiseAt = Math.round(def[0] + (def[1] - def[0]) * 0.4);
      if (typeof d.defaults.downAt !== 'number') d.defaults.downAt = Math.round(def[0] + (def[1] - def[0]) * 0.15);
      d.settings = d.settings.filter((s) => s.key !== 'raiseAt');
      d.settings.push({ key: 'raiseAt', label: `${cap(m.short || m.label || m.key)} that counts as under way`, min: Math.round(def[0] - (def[1] - def[0])), max: Math.round(def[1] + (def[1] - def[0])) });
      if (!m.band) setBand(m, 'range');
      m.note = 'at the top';
      return;
    }
    if (!m.band) setBand(m, m.kind === 'angle' ? 'min' : 'range');
    m.note = role === 'note' ? 'a note' : 'keep';
  }
  /* the numbers the drawing gives, on request */
  function fromDrawing(m) {
    const d = draft, { A, B } = valuesAB(m); if (A == null || B == null) return;
    const tol = TOL(m), lo = Math.min(A, B), hi = Math.max(A, B), kind = Spec.bandKind(m.band), role = roleOf(m);
    if (role === 'progress') {
      d.progress.direction = B >= A ? 'up' : 'down';
      d.defaults.raiseAt = Math.round(A + (B - A) * 0.4); d.defaults.downAt = Math.round(A + (B - A) * 0.15);
      if (kind === 'range') { d.defaults[m.band.lo] = Math.round(B - tol); d.defaults[m.band.hi] = Math.round(B + tol); }
      for (const x of d.faults) { if (x.measure !== m.key) continue; const up = B >= A; if (/Low$/.test(x.id)) { x.side = up ? 'below' : 'above'; x.tone = up ? 'up' : 'down'; } if (/High$/.test(x.id)) { x.side = up ? 'above' : 'below'; x.tone = up ? 'down' : 'up'; } }
      return;
    }
    if (kind === 'min') d.defaults[m.band.min] = Math.round(lo - tol);
    else if (kind === 'max') d.defaults[m.band.max] = Math.round(hi + tol);
    else if (kind === 'sym') d.defaults[m.band.sym] = Math.round(Math.max(Math.abs(lo), Math.abs(hi)) + tol);
    else if (kind === 'range') { d.defaults[m.band.lo] = Math.round(lo - tol); d.defaults[m.band.hi] = Math.round(hi + tol); }
  }
  function addMeasure() {
    if (!touch()) return;
    const m = { key: uniqueKey('m'), kind: 'angle', label: '', hud: 'M', role: 'reading' };
    draft.measurements.push(m);
    editing = { m, slot: 'b' };
    commit(true);
  }
  /* the numbers a recording gives, on request: the reading of this measurement over the shown recording's
     frames; its 5th and 95th percentiles are the start and the top (or the two edges) */
  function fromRecording(m) {
    const rv = window.__review, shown = rv && rv.shown; if (!shown || !shown.result || !filled(m)) return false;
    const OTHER = { L: 'R', R: 'L' }, bare = Object.assign({}, m); delete bare.fromStart;
    const vals = [], early = [], t0 = shown.result.rows.length ? shown.result.rows[0].t : 0;
    for (const row of shown.result.rows) {
      const r = row.reading; if (!r || !r.ok) continue;
      const ctx = { P: r.points, both: { [r.side]: r.points, [OTHER[r.side]]: r.other }, cfg: shown.result.cfg, facing: r.facing, Core, values: {}, side: r.side };
      const x = Spec.measure(bare, ctx).x; if (x == null || !Number.isFinite(x)) continue;
      vals.push(x); if (row.t - t0 < 1500) early.push(x);
    }
    if (vals.length < 10) return false;
    const sorted = vals.slice().sort((a, b) => a - b), pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
    const lo = pct(0.05), hi = pct(0.95), med = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const startV = early.length ? med(early) : lo;
    const d = draft, tol = TOL(m), kind = Spec.bandKind(m.band), role = roleOf(m);
    if (role === 'progress') {
      const up = Math.abs(hi - startV) >= Math.abs(lo - startV), Aval = startV, Bval = up ? hi : lo;
      d.progress.direction = up ? 'up' : 'down';
      d.defaults.raiseAt = Math.round(Aval + (Bval - Aval) * 0.4); d.defaults.downAt = Math.round(Aval + (Bval - Aval) * 0.15);
      if (kind === 'range') { d.defaults[m.band.lo] = Math.round(Bval - tol); d.defaults[m.band.hi] = Math.round(Bval + tol); }
      for (const x of d.faults) { if (x.measure !== m.key) continue; if (/Low$/.test(x.id)) { x.side = up ? 'below' : 'above'; x.tone = up ? 'up' : 'down'; } if (/High$/.test(x.id)) { x.side = up ? 'above' : 'below'; x.tone = up ? 'down' : 'up'; } }
      return true;
    }
    if (kind === 'min') d.defaults[m.band.min] = Math.round(lo - tol);
    else if (kind === 'max') d.defaults[m.band.max] = Math.round(hi + tol);
    else if (kind === 'sym') d.defaults[m.band.sym] = Math.round(Math.max(Math.abs(lo), Math.abs(hi)) + tol);
    else if (kind === 'range') { d.defaults[m.band.lo] = Math.round(lo - tol); d.defaults[m.band.hi] = Math.round(hi + tol); }
    return true;
  }
  /* a measure the studio found in the recordings, written in as a card with a fault on it: a note, so
     the reps stay cut as they were and the labels find them */
  function addDiscovered(row, group) {
    if (!row || !row.measurement || !touch()) return;
    const d = draft;
    if (!d.inPosition) d.inPosition = bandedKeys();
    const m = clone(row.measurement); delete m.key;
    const base = W.describe(m, d).short || 'found';
    m.key = uniqueKey(base); m.named = true; m.role = 'note';
    const settingKey = m.key + (row.side === 'above' ? 'Max' : 'Min');
    const s = (m.settings && m.settings[0]) || {};
    m.band = row.side === 'above' ? { max: settingKey } : { min: settingKey };
    m.settings = [{ key: settingKey, label: settingLabel(m, row.side === 'above' ? 'at most' : 'at least'), min: s.min != null ? s.min : (m.scale ? m.scale[0] : -90), max: s.max != null ? s.max : (m.scale ? m.scale[1] : 180) }];
    m.label = m.label || W.describe(m, d).what; m.hud = m.hud || W.describe(m, d).hud; m.note = row.side === 'above' ? 'at most' : 'at least';
    d.measurements.push(m);
    d.defaults[settingKey] = row.edge;
    const words = group && group.id && group.id[0] === '+' ? group.id.slice(1) : (group && group.label) || (row.fault && row.fault.label) || 'Found';
    const id = uniqueFaultId(keptFaultId(group) || W.camel(words));
    const when = (row.fault && row.fault.when) || (group && group.when) || 'top';
    d.faults.push(Object.assign({ id, measure: m.key, side: row.side, label: words.slice(0, 26), text: (row.fault && row.fault.text) || words, tone: 'plain' }, when !== 'top' ? { when } : {}));
    if (!d.auto.landmarks && d.landmarks) { const L = d.landmarks; for (const n of lmRefs(m)) { if (!L.joints.includes(n)) L.joints.push(n); if (!L.dots.includes(n)) L.dots.push(n); } }
    if (group && group.id && group.id[0] === '+' && window.__review) window.__review.renameFault(group.id, id);
    commit(true);
    goTo(`measurements[${d.measurements.length - 1}]`);
  }
  /* a fault on a measurement the exercise already has, at the edge the recordings suggest */
  function addFaultOn(row, group) {
    if (!row || !row.existing || !touch()) return;
    const d = draft, m = d.measurements.find((q) => q.key === row.existing.key); if (!m) return;
    if (!m.band) { if (!d.inPosition) d.inPosition = bandedKeys(); setBand(m, row.side === 'above' ? 'max' : 'min'); d.faults = d.faults.filter((x) => x.measure !== m.key); const k = row.side === 'above' ? m.band.max : m.band.min; d.defaults[k] = row.edge; }
    const words = group && group.id && group.id[0] === '+' ? group.id.slice(1) : (group && group.label) || 'Found';
    const id = uniqueFaultId(keptFaultId(group) || W.camel(words));
    const when = (group && group.when) || 'top';
    d.faults.push(Object.assign({ id, measure: m.key, side: row.side, label: words.slice(0, 26), text: words, tone: 'plain' }, when !== 'top' ? { when } : {}));
    if (group && group.id && group.id[0] === '+' && window.__review) window.__review.renameFault(group.id, id);
    commit(true);
    goTo(`measurements[${d.measurements.indexOf(m)}]`);
  }
  /* the verdicts and a take's tag name a fault by its id: when the draft no longer has that fault (its measure
     was removed), the one built from the recordings takes the id back, so the verdicts keep meaning it */
  const keptFaultId = (group) => (group && group.id && group.id !== '*' && group.id[0] !== '+' && !draft.faults.some((f) => f.id === group.id) ? group.id : null);
  const uniqueFaultId = (base) => { base = (base || 'fault').replace(/[^a-zA-Z0-9]/g, '') || 'fault'; if (!/^[a-zA-Z]/.test(base)) base = 'f' + base; let id = base, n = 2; const taken = new Set(draft.faults.map((x) => x.id).concat(['lost', 'edge', 'framing', 'dark', 'backlit', 'blend', 'notready', 'room', 'raise'])); while (taken.has(id)) id = base + n++; return id; };
  /* Everywhere else a measurement is named: the drawing (arcs, readouts, a line's good),
     the bone colours, the side pick, the gates of later measurements, the start ranges,
     the position list, faults' requires. Removed with it, or renamed with it — whatever
     the derived flags say, since a loaded file keeps its own lists and nothing else
     would bring them up to date. `fn(what, holder, key)` returns false to drop the mention. */
  function eachRef(key, fn) {
    const d = draft;
    d.draw = (d.draw || []).filter((g) => g.measure !== key || fn('draw', g, 'measure') !== false);
    for (const g of d.draw) if (g.good === key && fn('good', g, 'good') === false) delete g.good;
    const L = d.landmarks || {};
    for (const b of Object.keys(L.limb || {})) if (L.limb[b] === key && fn('limb', L.limb, b) === false) delete L.limb[b];
    if (d.side && d.side.pick === 'measure' && d.side.measure === key && fn('side', d.side, 'measure') === false) d.side = { pick: 'clearest' };
    for (const q of d.measurements) if (q.gate && q.gate.measure === key && fn('gate', q.gate, 'measure') === false) delete q.gate;
    if (d.ready && d.ready.ranges && d.ready.ranges[key] != null && fn('ready', d.ready.ranges, key) === false) delete d.ready.ranges[key];
    if (d.inPosition && d.inPosition.includes(key) && fn('inPosition', d.inPosition, d.inPosition.indexOf(key)) === false) d.inPosition = d.inPosition.filter((k) => k !== key);
    for (const x of d.faults || []) if (x.requires && x.requires.includes(key) && fn('requires', x.requires, x.requires.indexOf(key)) === false) { x.requires = x.requires.filter((k) => k !== key); if (!x.requires.length) delete x.requires; }
  }
  const dropRefs = (key) => eachRef(key, () => false);
  const renameRefs = (old, key) => eachRef(old, (what, o, k) => { if (what === 'ready') { o[key] = o[k]; delete o[k]; } else o[k] = key; return true; });
  function removeMeasure(m) {
    clearBand(m);
    if (roleOf(m) === 'progress') { delete draft.progress; delete draft.defaults.raiseAt; delete draft.defaults.downAt; draft.settings = draft.settings.filter((s) => s.key !== 'raiseAt'); }
    draft.measurements = draft.measurements.filter((q) => q !== m);
    dropRefs(m.key);
    /* the landmarks it alone used go too, when the lists are the file's own (derived lists are rebuilt) */
    if (!draft.auto.landmarks && draft.landmarks) {
      const gone = lmRefs(m).filter((n) => !draft.measurements.some((q) => lmRefs(q).includes(n)));
      if (gone.length) {
        const L = draft.landmarks, keep = (arr) => (arr || []).filter((n) => !gone.includes(n));
        L.joints = keep(L.joints); L.needed = keep(L.needed); L.dots = keep(L.dots);
        L.bones = (L.bones || []).filter((b) => !gone.includes(b[0]) && !gone.includes(b[1]));
        for (const b of Object.keys(L.limb || {})) if (b.split('|').some((n) => gone.includes(n))) delete L.limb[b];
      }
    }
    if (editing && editing.m === m) editing = null;
  }

  /* ================= controls ================= */
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
    if (o.at) lab.dataset.at = o.at;
    if (o.def) input.dataset.def = o.def;
    input.onchange = () => {
      if (!touch()) { render(); return; }
      const v = o.type === 'check' ? input.checked : o.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
      onchange(v);
      commit(!!o.structural);
    };
    if (!o.options && o.type !== 'check') input.oninput = () => { if (o.live !== false) debounce(() => { input.onchange(); }); };
    lab.appendChild(input);
    return lab;
  }
  const section = (title, note) => { const s = el('section', 'panel build-sec step'); s.appendChild(el('h2', null, esc(title))); if (note) s.appendChild(el('p', 'tiny', note)); return s; };
  const grid = (cls) => el('div', 'grid ' + (cls || ''));
  const details = (title, open) => { const d = el('details'); if (open) d.open = true; d.appendChild(el('summary', null, esc(title))); return d; };
  const list = (v) => (Array.isArray(v) ? v.join(', ') : '');
  const fromList = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const lines = (v) => (Array.isArray(v) ? v.join('\n') : '');
  const fromLines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const btn = (txt, fn, cls) => { const b = el('button', 'btn ' + (cls || ''), txt); b.type = 'button'; b.onclick = fn; return b; };
  const chips = (items, current, onpick) => { const c = el('div', 'chips'); for (const [v, t, title] of items) { const b = btn(t, () => onpick(v)); b.setAttribute('aria-pressed', String(v === current)); if (title) b.title = title; c.appendChild(b); } return c; };
  /* a field that is the template's until edited: editing it makes it the person's; a link puts the template back */
  function autoField(flag, label, value, onchange, o) {
    const lab = field(label, value, (v) => { draft.auto[flag] = false; onchange(v); }, o);
    if (draft.auto[flag]) lab.querySelector('span').appendChild(el('em', 'auto-note', ' · from the pose; edit to make it yours'));
    else { const a = el('button', 'linkbtn', 'use the template'); a.type = 'button'; a.style.marginLeft = '6px'; a.onclick = () => { if (!touch()) return; draft.auto[flag] = true; commit(true); }; lab.querySelector('span').appendChild(a); }
    return lab;
  }
  const settingKeys = () => Object.keys(draft.defaults || {});
  const optsOf = (arr, blank) => (blank ? [['', blank]] : []).concat(arr.map((k) => [k, k]));
  const lmOpts = (blank) => optsOf(LM.concat(LM.map((k) => 'other.' + k), figView() === 'front' ? LM.flatMap((k) => ['L.' + k, 'R.' + k]) : []), blank);

  /* the editor's every drag: into the draft */
  function figChanged(j) {
    if (!draft) return;
    if (!j || !j.A) return;   // the editor before any figure is set
    if (!touch()) { if (window.__review) window.__review.setFig(draft.figure.points); return; }
    draft.figure = { points: Object.assign({}, j, { B: j.hold ? undefined : j.B }) };
    draft.muscles = j.w || {};
    commit(false);
    /* the edges on the cards follow too */
    document.querySelectorAll('[data-def]').forEach((n) => { if (document.activeElement !== n) n.value = draft.defaults[n.dataset.def]; });
  }
  /* the values at A and B on the cards, without rebuilding the form */
  function refreshValues() {
    if (!draft) return;
    document.querySelectorAll('[data-val]').forEach((n) => { const m = draft.measurements.find((q) => q.key === n.dataset.val); if (!m) return; const { A, B } = valuesAB(m); n.innerHTML = `A <b>${fmt(A, m)}</b> · B <b>${fmt(B, m)}</b>`; });
    document.querySelectorAll('[data-edge]').forEach((n) => { const [key, side] = n.dataset.edge.split('|'); const m = draft.measurements.find((q) => q.key === key); if (!m || !m.band) return; n.textContent = edgeOf(m, side); });
  }
  const edgeKeyOf = (m, side) => (side === 'above' ? (m.band.sym || m.band.hi || m.band.max) : (m.band.sym || m.band.lo || m.band.min));
  const edgeOf = (m, side) => { const k = edgeKeyOf(m, side); if (!k) return ''; const v = draft.defaults[k]; return W.edgeWords(draft, m, side, m.band.sym && side === 'below' ? -v : v); };

  /* ================= the start: a pose ================= */
  function renderStart() {
    const host = $('build-start'); if (!host) return; host.innerHTML = '';
    host.appendChild(el('p', 'tiny', 'Pick how the person starts and which way the phone looks at them. Everything else follows from it and can be changed. The exercise open now stays as it is until you edit the new one.'));
    const g = el('div', 'pose-pick');
    for (const p of POSES) { const b = btn(`${poseSvg(figureOfPose(p))}<span>${esc(p.name)}</span>`, () => { if (touched() && !window.confirm(`Start a new exercise? The draft of “${draft.name}” would be dropped — download it first if you want it.`)) return; Moves.draft(null); start(fromPose(p), AUTO(), { source: null, touched: true }); $('start-over').open = false; $('exercise-panel').open = true; $('fig-edit').open = true; window.scrollTo({ top: 0, behavior: 'smooth' }); }, null); g.appendChild(b); }
    host.appendChild(g);
  }

  /* ================= the form ================= */
  function render() {
    renderStart();
    if (!draft) return;
    const d = draft; d.auto = d.auto || {};
    d.words = d.words || {}; d.phone = d.phone || {}; d.landmarks = d.landmarks || {}; d.measurements = d.measurements || []; d.faults = d.faults || [];
    d.defaults = d.defaults || {}; d.settings = d.settings || []; d.draw = d.draw || []; d.muscles = d.muscles || {}; d.figure = d.figure || {};
    renderMeasures(); renderDerived(); renderExercise(); renderNumbers();
    refreshValues();
  }
  /* bare controls for a sentence: a select, a number, words */
  const pick = (value, options, onchange, title, structural, at) => { const sel = el('select', 'inline'); for (const [v, t] of options) { const it = el('option', null, esc(t)); it.value = v; sel.appendChild(it); } sel.value = value == null ? '' : String(value); if (title) sel.title = title; if (at) sel.dataset.at = at; sel.onchange = () => { if (!touch()) { sel.value = value == null ? '' : String(value); return; } onchange(sel.value); commit(!!structural); }; return sel; };
  const num = (value, onchange, defKey, title) => { const inp = el('input', 'inline num'); inp.type = 'number'; inp.step = 'any'; inp.value = value == null ? '' : value; if (defKey) { inp.dataset.def = defKey; if (!document.getElementById('def-' + defKey)) inp.id = 'def-' + defKey; } if (title) inp.title = title; inp.onchange = () => { if (!touch()) { inp.value = value == null ? '' : value; return; } const v = inp.value === '' ? null : Number(inp.value); onchange(v); commit(false); }; return inp; };
  const words = (t, cls) => el('span', 'w ' + (cls || ''), esc(t));
  const text = (value, onchange, placeholder, cls, at, max) => { const inp = el('input', 'inline ' + (cls || '')); inp.value = value || ''; if (placeholder) inp.placeholder = placeholder; if (at) inp.dataset.at = at; if (max) inp.maxLength = max; inp.onchange = () => { if (!touch()) { inp.value = value || ''; return; } onchange(inp.value); commit(false); }; return inp; };
  const WHEN_OPTS = [['top', 'at the top of the rep'], ['rep', 'through the rep'], ['always', 'at all times, before the rep too'], ['between', 'between reps, at rest']];
  const whenOpts = () => WHEN_OPTS.map(([v, t]) => [v, v === 'top' && draft.words && draft.words.atTop ? draft.words.atTop : t]);

  function renderMeasures() {
    const host = $('measures'); host.innerHTML = '';
    const d = draft;
    if (!d.measurements.length) host.appendChild(el('p', 'tiny', d.type === 'reps' ? 'Nothing measured yet. Add one and make it the one that tracks the rep.' : 'Nothing measured yet. Add what has to be right for the hold.'));
    d.measurements.forEach((m, i) => host.appendChild(card(m, i)));
  }
  function card(m, i) {
    const d = draft, role = roleOf(m), desc = describe(m), u = desc.unit, at = `measurements[${i}]`;
    const cardEl = el('div', 'mcard' + (editing && editing.m === m ? ' editing' : '')); cardEl.dataset.at = at; cardEl.dataset.key = m.key;
    /* the head: what it is, its values at A and B, the tools */
    const head = el('div', 'mhead');
    /* the head says what the geometry is, in words; the file's own short label, when it differs, is under More */
    head.appendChild(el('b', 'what', esc(desc.named ? desc.what : (m.label || m.key))));
    head.appendChild(el('span', 'mvals', '')); head.lastChild.dataset.val = m.key;
    const tools = el('span', 'rowtools');
    tools.appendChild(btn('↑', () => { if (i > 0 && touch()) { [d.measurements[i - 1], d.measurements[i]] = [d.measurements[i], d.measurements[i - 1]]; commit(true); } }, 'tiny-btn'));
    tools.appendChild(btn('↓', () => { if (i < d.measurements.length - 1 && touch()) { [d.measurements[i + 1], d.measurements[i]] = [d.measurements[i], d.measurements[i + 1]]; commit(true); } }, 'tiny-btn'));
    tools.appendChild(btn('✕', () => { if (touch()) { removeMeasure(m); commit(true); } }, 'tiny-btn'));
    head.appendChild(tools);
    cardEl.appendChild(head);
    /* sentence 1 — what is measured, and how it is read */
    const what = el('div', 'sentence what');
    what.appendChild(words('Measure'));
    const shape = shapeOf(m);
    what.appendChild(pick(shape, SHAPES, (v) => setShape(m, v), SHAPE_HELP[shape] || '', true, at + '.kind'));
    const slotBtn = (k, label) => {
      const val = k === 'per' ? (m.per && m.per[0] && m.per[1] ? (LIMBS.find(([, [a, b]]) => plain(m.per[0]) === a && plain(m.per[1]) === b) || [null])[0] || `${W.pointWords(m.per[0], true)}–${W.pointWords(m.per[1], true)}` : null) : m[k] ? W.pointWords(m[k], true) : null;
      const b = btn(val ? esc(val) : (label || '…'), () => { editing = { m, slot: k }; document.querySelectorAll('.mcard').forEach((c) => c.classList.toggle('editing', c === cardEl)); landmarkPopup(b, m, k); });
      b.classList.add('slot'); b.dataset.at = at + '.' + (k === 'per' ? 'per' : k); b.setAttribute('aria-pressed', String(!!(editing && editing.m === m && editing.slot === k)));
      if (!val) b.classList.add('empty');
      return b;
    };
    for (const tok of SENTENCE[shape] || SENTENCE.angle) { if (tok === 'per') what.appendChild(slotBtn('per', 'a limb')); else if (SLOTS[m.kind].some(([k]) => k === tok)) what.appendChild(slotBtn(tok, (SLOTS[m.kind].find(([k]) => k === tok) || [])[1])); else what.appendChild(words(tok)); }
    what.appendChild(words(', read'));
    what.appendChild(pick(m.fromStart || '', [['', 'as is'], ['change', 'as the change since the start position'], ['ratio', 'as % of its value at the start position'], ['peak', 'as % of the most it has been this set'], ['belowPeak', 'as how far under the most it has been this set'], ['rest', 'as the change from the rest position (which follows slowly)']], (v) => { if (v) m.fromStart = v; else delete m.fromStart; m.named = false; nameIt(m); }, 'the coach reads the value when the set-up wait ends and from then on gives the change from it, or the percentage of it', true, at + '.fromStart'));
    cardEl.appendChild(what);
    /* the meaning line: what the number is, which way is which */
    if (desc.meaning || desc.notes.length) cardEl.appendChild(el('div', 'meaning', esc([desc.meaning].concat(desc.notes.map((n) => cap(n) + '.')).filter(Boolean).join(' '))));
    /* what it is for */
    const roles = d.type === 'reps'
      ? [['progress', 'tracks the rep', 'the count follows this one: a rep is under way past one line and counts when it is back past the other'], ['hold', 'must be right to hold', 'the hold clock at the top runs only while this is inside its rule; out of it is a fault'], ['note', 'a note', 'called when it is out, but the count goes on'], ['reading', 'just shown', 'on the picture only, never judged']]
      : [['hold', 'must be right to hold', 'the hold clock runs only while this is inside its rule'], ['note', 'a note', 'called when it is out, but the clock goes on'], ['reading', 'just shown', 'on the picture only, never judged']];
    cardEl.appendChild(chips(roles, role, (v) => { if (!touch()) return; setRole(m, v); commit(true); }));
    /* the rep's two lines */
    if (role === 'progress') {
      const row = el('div', 'sentence progress'); row.dataset.at = 'progress';
      const dn = d.progress.direction === 'down';
      row.appendChild(words('The rep is under way once it')); row.appendChild(pick(d.progress.direction || 'up', [['up', 'rises past'], ['down', 'falls under']], (v) => { d.progress.direction = v; }, '', true));
      row.appendChild(num(d.defaults.raiseAt, (v) => { d.defaults.raiseAt = v; }, 'raiseAt', 'the rep is under way once the reading passes this')); row.appendChild(words(u));
      row.appendChild(words(`and counts once it is back ${dn ? 'over' : 'under'}`)); row.appendChild(num(d.defaults.downAt, (v) => { d.defaults.downAt = v; }, 'downAt', 'the rep counts once the reading is back past this')); row.appendChild(words(u));
      cardEl.appendChild(row);
      const rec = el('div', 'rec'); rec.dataset.recKey = 'raiseAt'; cardEl.appendChild(rec);
    }
    if (role !== 'reading') {
      const kind = Spec.bandKind(m.band) || 'none';
      const row = el('div', 'sentence rule'); row.dataset.at = at + '.band';
      if (d.type === 'reps') row.appendChild(pick(whenOf(m), whenOpts(), (v) => { setWhen(m, v); }, 'when the rule is checked and its faults called', true)); else row.appendChild(words('In the hold,'));
      row.appendChild(words('it must be'));
      row.appendChild(pick(kind, [['none', 'anything: not judged'], ['range', 'between'], ['min', 'at least'], ['max', 'at most'], ['sym', 'within ±']], (v) => { setBand(m, v); }, '', true));
      if (m.band) {
        const n = (rk, title) => { const key = m.band[rk]; row.appendChild(num(d.defaults[key], (v) => { d.defaults[key] = v; }, key, title)); row.appendChild(words(u)); };
        if (kind === 'range') { n('lo', 'the lower edge'); row.appendChild(words('and')); n('hi', 'the upper edge'); }
        else if (kind === 'min') n('min', 'the edge'); else if (kind === 'max') n('max', 'the edge'); else { n('sym', 'either side of zero'); row.appendChild(words(`of ${desc.zero || 'zero'}`)); }
      }
      cardEl.appendChild(row);
      /* the start position: a second rule, judged before the coaching begins */
      const sr = el('div', 'sentence start'); sr.dataset.at = `ready.ranges.${m.key}`;
      const range = d.ready && d.ready.ranges && d.ready.ranges[m.key];
      if (range) {
        sr.appendChild(words('At the start position it must be between'));
        sr.appendChild(num(range[0], (v) => { d.ready.ranges[m.key][0] = v; }, null, 'the start position\'s lower edge')); sr.appendChild(words(u));
        sr.appendChild(words('and')); sr.appendChild(num(range[1], (v) => { d.ready.ranges[m.key][1] = v; }, null, 'the start position\'s upper edge')); sr.appendChild(words(u));
        const rm = btn('✕', () => { if (!touch()) return; delete d.ready.ranges[m.key]; if (!Object.keys(d.ready.ranges).length) { delete d.ready.ranges; if (d.ready.atStart === undefined && !d.ready.nudge) delete d.ready; } commit(true); }, 'tiny-btn'); rm.title = 'no start-position rule'; sr.appendChild(rm);
      } else {
        const g = btn('○ add a start-position rule', () => { if (!touch()) return; const { A } = valuesAB(m); const tol = TOL(m); const base = A != null ? A : (m.band ? d.defaults[m.band.lo || m.band.min || m.band.max || m.band.sym] : 0); d.ready = d.ready || {}; d.ready.ranges = d.ready.ranges || {}; d.ready.ranges[m.key] = [Math.round(base - tol), Math.round(base + tol)]; commit(true); }, 'tiny-btn ghost'); g.title = 'judged in the set-up wait, before the coaching begins'; sr.appendChild(g);
      }
      cardEl.appendChild(sr);
      /* the faults: one row each, the edge in words, then the words the coach uses */
      const fs = d.faults.filter((x) => x.measure === m.key);
      for (const x of fs) {
        const fat = `faults[${d.faults.indexOf(x)}]`;
        const row = el('div', 'fault-row sentence'); row.dataset.at = fat; row.dataset.fault = x.id;
        const edge = el('span', 'edge', esc(edgeOf(m, x.side))); edge.dataset.edge = `${m.key}|${x.side}`; row.appendChild(edge);
        row.appendChild(words('→'));
        row.appendChild(text(x.label, (v) => { x.label = v; x.own = true; }, 'short words on the picture', '', fat + '.label', 26));
        row.appendChild(words('said as'));
        row.appendChild(text(x.text, (v) => { x.text = v; x.own = true; }, 'what the coach says', 'wide', fat + '.text'));
        row.appendChild(words('well past'));
        row.appendChild(text(x.deep, (v) => { x.deep = v; }, 'stronger words (optional)', 'wide'));
        const more = btn('⋯', () => { ex.hidden = !ex.hidden; }, 'tiny-btn'); more.title = 'this fault\'s side, when, tone, and what silences it'; row.appendChild(more);
        const rm = btn('✕', () => { if (!touch()) return; d.faults = d.faults.filter((q) => q !== x); commit(true); }, 'tiny-btn'); rm.title = 'remove this fault'; row.appendChild(rm);
        const ex = el('div', 'more-f'); ex.hidden = true;
        const g = el('div', 'sentence');
        g.appendChild(words('on the')); g.appendChild(pick(x.side, [['above', 'high side'], ['below', 'low side']], (v) => { x.side = v; }, '', true, fat + '.side')); g.appendChild(words('of the rule'));
        if (d.type === 'reps') { g.appendChild(words(', judged')); g.appendChild(pick(x.when || (x.setup ? 'always' : 'top'), whenOpts(), (v) => { delete x.setup; if (v === 'top') delete x.when; else x.when = v; }, 'this fault alone; the rule above sets every fault on it at once', true, fat + '.when')); }
        g.appendChild(words(', tone')); g.appendChild(pick(x.tone || 'plain', Spec.TONES.map((t) => [t, t]), (v) => { x.tone = v; }, '', false, fat + '.tone'));
        ex.appendChild(g);
        const others = d.measurements.filter((q) => q.band && q !== m);
        if (others.length) { const rq = el('div', 'sentence'); rq.appendChild(words('only while these are right:')); rq.appendChild(chipsMulti(others.map((q) => [q.key, describe(q).short]), x.requires || [], (set) => { if (set.length) x.requires = set; else delete x.requires; })); ex.appendChild(rq); }
        const otherF = d.faults.filter((q) => q !== x);
        if (otherF.length) { const un = el('div', 'sentence'); un.appendChild(words('not while one of these is on:')); un.appendChild(chipsMulti(otherF.map((q) => [q.id, q.label || q.id]), x.unless || [], (set) => { if (set.length) x.unless = set; else delete x.unless; })); ex.appendChild(un); }
        row.appendChild(ex);
        cardEl.appendChild(row);
        const rec = el('div', 'rec'); rec.dataset.fault = x.id; rec.dataset.recKey = edgeKeyOf(m, x.side) || ''; cardEl.appendChild(rec);
      }
      const acts = el('div', 'row');
      if (m.band) acts.appendChild(btn('Add a fault', () => { if (!touch()) return; const side = fs.some((q) => q.side === 'above') && !fs.some((q) => q.side === 'below') ? 'below' : 'above'; const t = W.faultTemplate(d, m, side); d.faults.push(Object.assign({ id: uniqueFaultId(m.key + 'Fault'), measure: m.key, side, label: t.label.slice(0, 26), text: t.text, tone: 'plain' }, whenOf(m) !== 'top' ? { when: whenOf(m) } : {})); commit(true); }, 'tiny-btn'));
      if (filled(m)) acts.appendChild(btn('Numbers from the drawing', () => { if (!touch()) return; fromDrawing(m); commit(true); }, 'tiny-btn'));
      if (filled(m) && window.__review && window.__review.shown) acts.appendChild(btn('Numbers from the recording', () => { if (!touch()) return; if (fromRecording(m)) commit(true); }, 'tiny-btn'));
      cardEl.appendChild(acts);
    }
    /* more: the names, the arithmetic, the gate, the meter */
    const more = details('More about this measurement');
    const gg = grid('tight');
    const lab = field('words for it (the picture and the settings use these)', m.label, (v) => { m.label = v; m.named = true; }, { structural: true, at: at + '.label', wide: true });
    if (desc.named && m.label !== desc.what) { const use = el('button', 'linkbtn', 'use the generated words'); use.type = 'button'; use.style.marginLeft = '6px'; use.onclick = () => { if (!touch()) return; m.label = desc.what; m.named = true; commit(true); }; lab.querySelector('span').appendChild(use); }
    gg.appendChild(lab);
    gg.appendChild(field('short name on the picture', m.hud, (v) => { m.hud = v; m.named = true; }, { at: at + '.hud' }));
    gg.appendChild(field('key', m.key, (v) => { const old = m.key; m.key = keyOf(v); m.named = true; for (const x of d.faults) if (x.measure === old) x.measure = m.key; if (d.progress && d.progress.measure === old) d.progress.measure = m.key; renameRefs(old, m.key); }, { structural: true, at: at + '.key' }));
    gg.appendChild(field('offset (added)', m.offset, (v) => { if (v == null) delete m.offset; else m.offset = v; }, { type: 'number' }));
    gg.appendChild(field('times', m.times, (v) => { if (v == null) delete m.times; else m.times = v; }, { type: 'number' }));
    gg.appendChild(field('bias (taken off: a number or a setting)', m.bias, (v) => { if (v == null || v === '') delete m.bias; else m.bias = isNaN(Number(v)) ? v : Number(v); }, { at: at + '.bias' }));
    gg.appendChild(field('unseen: the reading when a landmark is hidden', m.unseen, (v) => { if (v == null) delete m.unseen; else m.unseen = v; }, { type: 'number', at: at + '.unseen' }));
    gg.appendChild(field('optional: not read is not a fault', m.optional, (v) => { if (v) m.optional = true; else delete m.optional; }, { type: 'check' }));
    { const gt = m.gate || {}; const earlier = d.measurements.slice(0, i).map((q) => q.key);
      gg.appendChild(field('read only while this earlier measurement…', gt.measure, (v) => { if (!v) delete m.gate; else m.gate = Object.assign({}, m.gate, { measure: v }); }, { options: [['', '— (always)']].concat(earlier.map((k) => [k, k])), at: at + '.gate' }));
      gg.appendChild(field('…is at least', gt.min, (v) => { if (m.gate) { if (v == null || v === '') delete m.gate.min; else m.gate.min = isNaN(Number(v)) ? v : Number(v); } }, { at: at + '.gate.min' }));
      gg.appendChild(field('…and at most', gt.max, (v) => { if (m.gate) { if (v == null || v === '') delete m.gate.max; else m.gate.max = isNaN(Number(v)) ? v : Number(v); } }, { at: at + '.gate.max' })); }
    if (m.band) { gg.appendChild(field('meter from', (m.scale || [])[0], (v) => { m.scale = [v, (m.scale || [])[1]]; }, { type: 'number', at: at + '.scale' })); gg.appendChild(field('meter to', (m.scale || [])[1], (v) => { m.scale = [(m.scale || [])[0], v]; }, { type: 'number', at: at + '.scale' })); }
    gg.appendChild(field('why (a note for the file)', m.why, (v) => { m.why = v; }, { type: 'textarea', rows: 2, wide: true }));
    more.appendChild(gg); cardEl.appendChild(more);
    return cardEl;
  }
  const chipsMulti = (items, current, onchange) => { const c = el('div', 'chips'); const set = new Set(current); for (const [v, t] of items) { const b = btn(t, () => { if (!touch()) return; if (set.has(v)) set.delete(v); else set.add(v); onchange([...set]); commit(true); }); b.setAttribute('aria-pressed', String(set.has(v))); c.appendChild(b); } return c; };
  function renderDerived() {
    const host = $('derived'); host.innerHTML = '';
    const d = draft, more = details('Landmarks, bones and the drawing (derived from the measurements)');
    const g = grid();
    const L = d.landmarks;
    const lmField = (label, value, set, at) => autoField('landmarks', label, value, set, { wide: true, at });
    g.appendChild(lmField('Joints used', list(L.joints), (v) => { L.joints = fromList(v); }, 'landmarks.joints'));
    g.appendChild(lmField('Needed — the frame is unusable without these', list(L.needed), (v) => { L.needed = fromList(v); }, 'landmarks.needed'));
    g.appendChild(lmField('Dots drawn', list(L.dots), (v) => { L.dots = fromList(v); }, 'landmarks.dots'));
    g.appendChild(autoField('landmarks', 'Bones, one a line as a-b', (L.bones || []).map((b) => b.join('-')).join('\n'), (v) => { L.bones = fromLines(v).map((x) => x.split('-').map((y) => y.trim())).filter((b) => b.length === 2); }, { type: 'textarea', rows: 3, at: 'landmarks.bones' }));
    g.appendChild(autoField('landmarks', 'Bone colours, a|b: measurement', Object.entries(L.limb || {}).map(([k, v]) => `${k}: ${v}`).join('\n'), (v) => { L.limb = {}; for (const line of fromLines(v)) { const mm = /^([^:]+):\s*(\S+)$/.exec(line); if (mm) L.limb[mm[1].trim()] = mm[2]; } }, { type: 'textarea', rows: 3, at: 'landmarks.limb' }));
    g.appendChild(autoField('facing', 'Faces from', (d.facing || {}).from, (v) => { d.facing = Object.assign({}, d.facing, { from: v }); }, { options: lmOpts('—'), at: 'facing' }));
    g.appendChild(autoField('facing', 'toward', (d.facing || {}).to, (v) => { d.facing = Object.assign({}, d.facing, { to: v }); }, { options: lmOpts('—'), at: 'facing' }));
    g.appendChild(field('The two direction words (forward, back)', (d.facing && d.facing.words || []).join(', '), (v) => { const w = fromList(v); d.facing = Object.assign({}, d.facing); if (w.length === 2) d.facing.words = w; else delete d.facing.words; }, { placeholder: 'forward, back', title: 'what + and − mean in the sentences: forward/back, toward the feet/toward the head' }));
    g.appendChild(autoField('side', 'Which side is measured', (d.side || {}).pick || 'clearest', (v) => { d.side = { pick: v }; }, { options: [['clearest', 'the side the model sees best'], ['left', 'the left'], ['right', 'the right'], ['highest', 'the side whose joint is higher'], ['measure', 'the side whose measurement is larger']], structural: true, at: 'side.pick' }));
    if ((d.side || {}).pick === 'highest') g.appendChild(autoField('side', 'that joint', d.side.joint, (v) => { d.side.joint = v; }, { options: lmOpts('—'), at: 'side.joint' }));
    if ((d.side || {}).pick === 'measure') g.appendChild(autoField('side', 'that measurement', d.side.measure, (v) => { d.side.measure = v; }, { options: optsOf(d.measurements.map((m) => m.key), '—'), at: 'side.measure' }));
    if (['highest', 'measure'].includes((d.side || {}).pick)) { const h = d.side.hold || {}; g.appendChild(autoField('side', 'held until the other side leads by', h.margin, (v) => { if (v == null) delete d.side.hold; else d.side.hold = Object.assign({ frames: 5 }, d.side.hold, { margin: v }); }, { type: 'number', at: 'side.hold' })); }
    g.appendChild(autoField('draw', 'Drawn on the picture, as JSON', JSON.stringify(d.draw), (v) => { try { d.draw = JSON.parse(v); } catch { } }, { type: 'textarea', rows: 3, wide: true, at: 'draw' }));
    more.appendChild(g); host.appendChild(more);
  }
  function renderExercise() {
    const host = $('exercise-form'); host.innerHTML = '';
    const d = draft;
    let g = grid();
    g.appendChild(autoField('id', 'Name', d.name, (v) => { d.name = v; }, { placeholder: 'Glute bridge', at: 'name' }));
    g.appendChild(field(`File and key: ${d.id}.json`, d.id, (v) => { d.id = keyOf(v); d.auto.id = false; }, { placeholder: 'bridge', title: 'one word, lowercase: the file’s name and what the browser remembers it by', at: 'id', structural: true }));
    g.appendChild(field('What it is', d.type, (v) => { d.type = v; if (v === 'hold') { d.defaults.holdTargetSec = Math.max(d.defaults.holdTargetSec || 0, 20); } }, { options: [['reps', 'reps — a movement, counted'], ['hold', 'hold — one position, timed']], structural: true, at: 'type' }));
    g.appendChild(field('Sides', d.sides || 'both', (v) => { d.sides = v; }, { options: [['both', 'both at once'], ['left', 'the left'], ['right', 'the right'], ['alternate', 'one side per set, alternating']], structural: true, at: 'sides' }));
    g.appendChild(field('Load', d.load || 'none', (v) => { d.load = v; }, { options: [['none', 'none'], ['weight', 'a weight (kg bubble)'], ['band', 'a band (light, medium, heavy)'], ['both', 'a weight and a band']], at: 'load' }));
    g.appendChild(field('Body position', d.position || '', (v) => { d.position = v; }, { options: optsOf(Spec.POSITIONS), structural: true, title: 'sets the phone’s orientation, the opening words and which way the body faces, until you change those yourself', at: 'position' }));
    if (d.type === 'reps') g.appendChild(field('The top of the rep, in a phrase (for the sentences)', d.words.atTop, (v) => { if (v) d.words.atTop = v; else delete d.words.atTop; }, { placeholder: 'at the top of the rep', structural: true, title: '“at the bottom of the squat”, “at the full slide”, “at the cat”' }));
    host.appendChild(g);
    let more = details('More about it');
    g = grid();
    g.appendChild(field('The movement, in words', d.movement, (v) => { d.movement = v; }, { placeholder: 'hips lifted to a line and lowered' }));
    g.appendChild(field('Category', d.category, (v) => { d.category = v; }, { placeholder: 'Glutes and hips' }));
    g.appendChild(field('Tags (the search finds these)', list(d.tags), (v) => { d.tags = fromList(v); }));
    g.appendChild(field('Equipment', list(d.equipment), (v) => { d.equipment = fromList(v); }));
    g.appendChild(field('Order in the list', d.order, (v) => { d.order = v == null ? 99 : v; }, { type: 'number' }));
    g.appendChild(field('Status', d.status || 'ready', (v) => { d.status = v; }, { options: [['ready', 'ready — on the home page'], ['draft', 'draft — listed with a badge']] }));
    const mg = grid('tight'); mg.dataset.at = 'muscles'; for (const k of Spec.REGIONS) mg.appendChild(field(k, d.muscles[k], (v) => { if (v) d.muscles[k] = v; else delete d.muscles[k]; if (d.figure.points) d.figure.points.w = d.muscles; if (window.__review) window.__review.setFig(d.figure.points); }, { type: 'number', step: '0.05' }));
    more.appendChild(g); more.appendChild(el('p', 'tiny', 'Muscles working, 0 to 1 — the figure warms them by this:')); more.appendChild(mg);
    host.appendChild(more);
    host.appendChild(el('h3', 'tiny-h', 'The phone and the words'));
    g = grid();
    g.appendChild(field('The phone', d.phone.orientation || 'tall', (v) => { d.phone.orientation = v; }, { options: [['tall', 'stood up (tall picture)'], ['wide', 'on its side (wide picture)']], structural: true, at: 'phone.orientation' }));
    g.appendChild(field('It sees the body', d.phone.view || 'side', (v) => { d.phone.view = v; }, { options: [['side', 'side on'], ['front', 'from the front (left and right apart)']], structural: true, title: 'a front view names landmarks L.knee and R.knee; the figure’s view should match', at: 'phone.view' }));
    g.appendChild(field('How far away', d.phone.distance || 'two or three metres', (v) => { d.phone.distance = v; }, { options: [['a metre or two', 'a metre or two'], ['two or three metres', 'two or three metres'], ['three metres or more', 'three metres or more']], structural: true }));
    g.appendChild(autoField('placement', 'Where it goes (the set-up card)', d.phone.placement, (v) => { d.phone.placement = v; }, { type: 'textarea', rows: 2, wide: true, at: 'phone.placement' }));
    g.appendChild(autoField('start', 'Opening words (said once, first)', d.words.start, (v) => { d.words.start = v; }, { type: 'textarea', rows: 2, wide: true, at: 'words.start' }));
    if (d.type === 'reps') g.appendChild(autoField('prompt', 'The prompt that asks for the movement', (d.prompt || {}).text, (v) => { d.prompt = Object.assign({ id: 'raise' }, d.prompt, { text: v }); }, { wide: true, placeholder: 'Lift your hips', at: 'prompt' }));
    g.appendChild(field('The starting position, in a line', d.words.position, (v) => { d.words.position = v; }, { wide: true, placeholder: 'On your back, knees bent, feet flat, side on to the phone.', at: 'words.position' }));
    host.appendChild(g);
    more = details('More words');
    g = grid();
    g.appendChild(field('The end position (the top)', d.words.top, (v) => { d.words.top = v; }, { type: 'textarea', rows: 2, wide: true, at: 'words.top' }));
    g.appendChild(field('How to do it, one step a line', lines(d.words.howto), (v) => { d.words.howto = fromLines(v); }, { type: 'textarea', rows: 4, wide: true, at: 'words.howto' }));
    g.appendChild(field('What the camera cannot see', d.words.cannot, (v) => { d.words.cannot = v; }, { type: 'textarea', rows: 2, wide: true, at: 'words.cannot' }));
    g.appendChild(field('The numbers, explained (About)', d.words.about, (v) => { d.words.about = v; }, { type: 'textarea', rows: 3, wide: true, at: 'words.about' }));
    g.appendChild(field('One line for the card', d.words.hint, (v) => { d.words.hint = v; }, { wide: true }));
    g.appendChild(autoField('lost', 'Nobody in the frame', d.words.lost, (v) => { d.words.lost = v; }, { at: 'words.lost' }));
    g.appendChild(field('A part at the edge of the picture ({joint} is filled in)', d.words.edge, (v) => { d.words.edge = v; }, { placeholder: Core.SHARED_CUES.edge.text }));
    g.appendChild(field('Close to the edge, during the set-up wait', d.words.framing, (v) => { d.words.framing = v; }, { placeholder: Core.SHARED_CUES.framing.text }));
    g.appendChild(field('Too dark', d.words.dark, (v) => { d.words.dark = v; }, { placeholder: Core.SHARED_CUES.dark.text }));
    g.appendChild(field('Against the light', d.words.backlit, (v) => { d.words.backlit = v; }, { placeholder: Core.SHARED_CUES.backlit.text }));
    g.appendChild(field('Blending into the background', d.words.blend, (v) => { d.words.blend = v; }, { placeholder: Core.SHARED_CUES.blend.text }));
    if (d.type === 'reps') { g.appendChild(field('The hold at the top is done', d.words.lower, (v) => { d.words.lower = v; })); g.appendChild(field('Down before the hold was done', d.words.early, (v) => { d.words.early = v; })); }
    g.appendChild(field('Into position (blank keeps “That is it — hold”)', d.words.hold, (v) => { d.words.hold = v; }));
    g.appendChild(field('Label for the hold setting', d.words.holdLabel, (v) => { d.words.holdLabel = v; }, { placeholder: d.type === 'reps' ? 'Hold at the top for' : 'Hold the set for' }));
    g.appendChild(field('Safety', d.words.safety, (v) => { d.words.safety = v; }, { type: 'textarea', rows: 2 }));
    g.appendChild(field('Common mistakes', d.words.mistakes, (v) => { d.words.mistakes = v; }, { type: 'textarea', rows: 2 }));
    g.appendChild(field('Easier', d.words.easier, (v) => { d.words.easier = v; }));
    g.appendChild(field('Harder', d.words.harder, (v) => { d.words.harder = v; }));
    more.appendChild(g); host.appendChild(more);
  }
  function renderNumbers() {
    const host = $('numbers-form'); host.innerHTML = '';
    const d = draft;
    let g = grid('tight');
    if (d.type === 'reps') { g.appendChild(field('Reps in a set', d.defaults.repCount, (v) => { d.defaults.repCount = v; }, { type: 'number', at: 'defaults.repCount', def: 'repCount' })); g.appendChild(field('Hold at the top, seconds (0: the rep counts on reaching the top and coming back)', d.defaults.holdTargetSec, (v) => { d.defaults.holdTargetSec = v; }, { type: 'number', at: 'defaults.holdTargetSec', def: 'holdTargetSec' })); }
    else g.appendChild(field('Hold the position for, seconds', d.defaults.holdTargetSec, (v) => { d.defaults.holdTargetSec = v; }, { type: 'number', at: 'defaults.holdTargetSec', def: 'holdTargetSec' }));
    g.appendChild(field('Sets', d.defaults.setCount, (v) => { d.defaults.setCount = v; }, { type: 'number', at: 'defaults.setCount', def: 'setCount' }));
    if (d.type === 'hold') g.appendChild(field('Time calls, seconds left', list(d.defaults.callAtSec), (v) => { d.defaults.callAtSec = fromList(v).map(Number).filter((n) => n > 0); }, { at: 'defaults.callAtSec' }));
    host.appendChild(g);
    const more = details('Timing, smoothing, and every number the file has');
    g = grid('tight');
    for (const [k, label] of TIMING) g.appendChild(field(label, d.defaults[k], (v) => { if (v == null) delete d.defaults[k]; else d.defaults[k] = v; }, { type: 'number', at: 'defaults.' + k, def: k }));
    more.appendChild(g);
    more.appendChild(el('p', 'tiny', 'Every number in defaults, as the file has it (the edges and the lines are on the cards too):'));
    g = grid('tight'); g.dataset.at = 'defaults';
    for (const k of settingKeys()) if (k !== 'callAtSec') { const sw = W.settingWords(d, k); g.appendChild(field(sw ? `${k} — ${sw}` : k, d.defaults[k], (v) => { if (v == null) delete d.defaults[k]; else d.defaults[k] = v; }, { type: 'number', at: 'defaults.' + k, def: k })); }
    more.appendChild(g); host.appendChild(more);
  }

  /* ================= the recommendations, on the rows they concern ================= */
  let lastRec = null;
  function showRecommendations(rec) {
    lastRec = rec;
    const haveRecs = !!(window.__review && window.__review.recordings && window.__review.recordings.length);
    const fmtV = (v, u) => (v == null ? '—' : (Math.abs(v) >= 100 || u === '°' ? Math.round(v) : +v.toFixed(1)) + (u || ''));
    const range = (x, u) => (x && x.n ? (Math.abs(x.lo - x.hi) < 0.05 ? fmtV(x.lo, u) : `${fmtV(x.lo, u)}–${fmtV(x.hi, u)}`) + ` (${x.n})` : 'none');
    document.querySelectorAll('.mcard .rec').forEach((n) => {
      n.className = 'rec'; n.innerHTML = '';
      if (!haveRecs) { n.hidden = true; return; }
      n.hidden = false;
      const line = n.dataset.recKey === 'raiseAt' && !n.dataset.fault ? (rec && rec.lines.find((l) => l.key === 'raiseAt')) : null;
      const f = n.dataset.fault && rec ? rec.faults.find((x) => x.id === n.dataset.fault) : null;
      if (!rec || !rec.labelled || (!f && !line)) { n.classList.add('muted'); n.textContent = rec && rec.labelled ? 'No rep is classified with this yet.' : 'No verdicts yet — classify the reps on the right.'; return; }
      const apply = (key, value) => { const b = el('button', 'btn tiny-btn', `Apply ${esc(String(value))}`); b.type = 'button'; b.dataset.key = key; b.dataset.value = value; b.onclick = () => setNumber(key, Number(value)); return b; };
      if (line) {
        n.classList.add(line.status);
        n.innerHTML = line.status === 'fine' ? `✓ the reps you called reps reach ${fmtV(line.nearest, line.unit)} at the least (${line.n}): the line at ${fmtV(line.now, line.unit)} holds.` : `The shortest rep you called a rep reaches ${fmtV(line.nearest, line.unit)}, short of the line at ${fmtV(line.now, line.unit)}: move the line to <b>${fmtV(line.value, line.unit)}</b>.`;
        if (line.status !== 'fine') n.appendChild(apply(line.key, line.value));
        return;
      }
      n.classList.add(f.status);
      const thin = (f.clean.n < 3 || f.bad.n < 2) ? ' — few reps: label more' : '';
      const by = f.by && f.by.length ? ` <details><summary>by rep</summary><ul>${f.by.map((b) => `<li>${esc(b.take || '')} ${b.n ? 'rep ' + b.n : ''} · ${fmtV(b.v, f.unit)} · ${b.marked ? 'marked' : 'clean'}</li>`).join('')}</ul></details>` : '';
      if (f.status === 'fine') n.innerHTML = `✓ <b>${fmtV(f.now, f.unit)}</b> agrees with your verdicts: clean reps ${range(f.clean, f.unit)}, marked ${range(f.bad, f.unit)}${thin}.${by}`;
      else if (f.status === 'move') { n.innerHTML = `Clean reps ${range(f.clean, f.unit)}, marked ${range(f.bad, f.unit)}: as it stands ${f.nowFalse} false alarm${f.nowFalse === 1 ? '' : 's'}, ${f.nowMiss} missed. Move the number to <b>${fmtV(f.value, f.unit)}</b>${thin}.${by} `; n.appendChild(apply(f.key, f.value)); }
      else { n.innerHTML = `The clean and the marked reps overlap: clean ${range(f.clean, f.unit)}, marked ${range(f.bad, f.unit)}. The cut that gets most right is <b>${fmtV(f.value, f.unit)}</b>: ${f.afterFalse} clean rep${f.afterFalse === 1 ? '' : 's'} would still be flagged, ${f.afterMiss} marked still missed${thin}.${by} `; n.appendChild(apply(f.key, f.value)); }
    });
  }

  /* ================= try it: here, on the phone by a link, or by the file ================= */
  const sheet = $('try-sheet');
  async function openTry() {
    if (!draft) return;
    commit(false);
    if ($('try-live').disabled) return;
    sheet.hidden = false;
    $('share-link').value = 'Making the link…'; $('share-note').textContent = '';
    try {
      const code = await Share.encode(fileOf());
      const url = location.origin + location.pathname.replace(/[^/]*$/, 'index.html') + '#/ex/~' + code;
      $('share-link').value = url;
      $('share-note').textContent = `${(url.length / 1024).toFixed(1)} KB — fine for a message, a note or an email; too long for a QR code.`;
      $('share-send').hidden = !navigator.share;
    } catch (e) { $('share-link').value = ''; $('share-note').textContent = 'Could not make the link: ' + (e.message || e); }
  }
  $('try-live').onclick = openTry;
  $('try-close').onclick = () => { sheet.hidden = true; };
  sheet.onclick = (e) => { if (e.target === sheet) sheet.hidden = true; };
  $('try-here').onclick = () => { if (!draft) return; if (!draft.touched) { /* an untouched copy runs as the library's own */ } commit(false); location.href = 'index.html#/ex/' + draft.id; };
  $('share-copy').onclick = async () => { try { await navigator.clipboard.writeText($('share-link').value); $('share-copy').textContent = 'Copied'; setTimeout(() => { $('share-copy').textContent = 'Copy the link'; }, 1500); } catch { $('share-link').select(); } };
  $('share-send').onclick = async () => { try { await navigator.share({ title: draft.name, text: `${draft.name} — an OnTrack exercise`, url: $('share-link').value }); } catch { } };
  $('share-download').onclick = () => download();
  function download() {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(fileOf(), null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${draft.id || 'exercise'}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const link = async () => location.origin + location.pathname.replace(/[^/]*$/, 'index.html') + '#/ex/~' + (await Share.encode(fileOf()));

  /* ================= wiring ================= */
  $('build-new').onclick = () => { $('start-over').open = true; $('start-over').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  $('build-file').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j && j.move && j.defaults && !j.measurements) { /* a numbers file from an earlier studio: its numbers into the open exercise */ if (touch()) { Object.assign(draft.defaults, j.defaults); commit(true); } return; }
      if (touched() && !window.confirm(`Replace the draft of “${draft.name}” with this file? Download it first if you want it.`)) return;
      Moves.draft(null);
      start(j, {}, { source: Moves[j.id] && !Moves[j.id].draft ? j.id : null, touched: true });
    } catch (err) { $('build-note').textContent = 'Not an exercise file: ' + (err.message || err); }
    e.target.value = '';
  };
  $('build-download').onclick = download;
  $('build-drop').onclick = drop;
  $('add-measure').onclick = addMeasure;
  /* the library's own numbers back into the draft, the rest of the edit kept */
  $('numbers-reset').onclick = () => { const lib = source() && ((Moves.library && Moves.library[source()]) || Moves[source()]); if (!lib || !touch()) return; for (const [k, v] of Object.entries(lib.spec.defaults || {})) if (k in draft.defaults) draft.defaults[k] = v; commit(true); };
  $('build-apply-json').onclick = () => {
    try { const j = JSON.parse($('build-json').value); if (!touch()) return; start(j, draft ? draft.auto : {}, { source: source(), touched: true }); }
    catch (e) { $('build-note').textContent = 'That is not JSON: ' + (e.message || e); }
  };
  /* a keyframe from the frame the video is on: the landmarks of that moment, as the figure's points */
  $('fig-from-frame').onclick = () => {
    const rv = window.__review, rec = rv && rv.shown; if (!rec || !rec.result || !touch()) return;
    const t = $('clip').duration ? $('clip').currentTime * 1000 : 0;
    let best = null; for (const r of rec.result.rows) if (!best || Math.abs(r.t - t) < Math.abs(best.t - t)) best = r;
    const rd = best && best.reading; if (!rd || !rd.ok) { $('build-note').textContent = 'The model does not see the person in this frame.'; return; }
    const K = figureFromReading(rd, rec.aspect); if (!K) return;
    const f = draft.figure.points, kf = $('kf-B').getAttribute('aria-pressed') === 'true' ? 'B' : 'A';
    f[kf] = K; if (kf === 'A' && !f.B) f.B = clone(K);
    if (window.__review) window.__review.setFig(f);
    commit(false);
  };
  /* a reading's points scaled into the drawing's space (400 × 175, the floor at y 161), the near side as the figure's near limb */
  function figureFromReading(rd, aspect) {
    const P = rd.points, O = rd.other || {};
    const near = { h: P.ear, sh: P.shoulder, hip: P.hip, kn: P.knee, an: P.ankle, he: P.heel, ft: P.toe, el: P.elbow, wr: P.wrist }, far = { knF: O.knee, anF: O.ankle, heF: O.heel, ftF: O.toe, elF: O.elbow, wrF: O.wrist };
    const pts = Object.assign({}, near, far); const have = Object.entries(pts).filter(([, p]) => p && p.v >= 0.5);
    if (have.length < 5) return null;
    const ys = have.map(([, p]) => p.y), xs = have.map(([, p]) => p.x);
    const span = Math.max(Math.max(...ys) - Math.min(...ys), (Math.max(...xs) - Math.min(...xs))) || 1;
    const s = 130 / span, cx = (Math.min(...xs) + Math.max(...xs)) / 2, bottom = Math.max(...ys);
    const flip = (rd.facing || 1) < 0 ? -1 : 1;
    const K = {}; for (const [k, p] of have) K[k] = [Math.round(306 + (p.x - cx) * s * flip), Math.round(161 - (bottom - p.y) * s)];
    return K;
  }

  /* a draft kept from last time comes back; otherwise the exercise in the address, or the first */
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch { kept = null; }
  const q = new URLSearchParams(location.search);
  if (kept && kept.id && kept.measurements) start(kept, kept.auto || {}, { source: kept.source || (Moves.library && Moves.library[kept.id] ? kept.id : null), touched: true });
  else open(Moves[q.get('move')] ? q.get('move') : (Moves.bridge ? 'bridge' : Moves.list[0].id));
  if (q.get('move') && draft && draft.id !== q.get('move') && Moves[q.get('move')]) open(q.get('move'));

  window.__builder = { get draft() { return draft; }, get source() { return source(); }, get touched() { return touched(); }, start, open, fromLibrary, commit, drop, render, figChanged, fromPose, POSES, valueOf, addMeasure, fillSlot, setShape, setRole, setBand, fromDrawing, fromRecording, setNumber, setNumbers, showRecommendations, addDiscovered, addFaultOn, fileOf, link, download, get editing() { return editing; }, set editing(v) { editing = v; }, keyOfName: (n) => keyOfName(n, figView()) };
  if (window.__studio) Object.assign(window.__studio, { builder: window.__builder });
});
