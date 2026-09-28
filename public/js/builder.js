/* ---------------------------------------------------------------------------
   The builder: an exercise from a pose to a file, in five steps.

     1  The exercise    a name, and what it is (reps or a hold, which sides, a load)
     2  Drawn           the movement as a figure: a starting pose to drag into the
                        start (A) and the end (B) — the editor from the Animation
                        tab, placed here
     3  Measured        what the camera judges, chosen by clicking the figure: the
                        angle at a joint, the lean of a limb, the height of one
                        point over another, the length between two. Each has a
                        role — tracks the rep, must be right, a note, a reading —
                        and its value at A and at B is read off the drawing, which
                        is where its edges and thresholds come from
     4  Phone, words    templated from the pose; the long tail under More words
     5  Numbers         reps, sets, the hold; then the check, try it, download

   Everything the file needs that the person has not touched is derived: the
   landmarks and bones from the measurements, the drawing on the picture, which
   way the body faces from the position, the rep thresholds from A and B, the
   faults from the bands. A field once edited is left alone (draft.auto keeps
   which are still the template's; it is not written to the file).

   Every change goes into the draft, the draft is checked (Spec.check) and the
   problems listed, and when it has no errors it is laid over the library
   (Moves.draft) so the Recordings tab judges videos with it and Try it live runs
   it in the coach. Download writes the one file to drop into public/exercises.
   The draft is kept in this browser (localStorage 'ontrack.draft') until dropped.
   --------------------------------------------------------------------------- */
/* after the library is loaded and the Review page has set itself up (both wait on Moves.ready; this waits after it) */
Moves.ready.then(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DRAFT = 'ontrack.draft';
  const LM = Spec.LANDMARKS;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const TIMING = [
    ['lowerSec', 'Lowering takes at least, seconds (0: not judged)'], ['restSec', 'Quiet after a rep, seconds'], ['readyMs', 'Set-up wait before coaching, ms'],
    ['deepAt', 'Degrees past the band for the stronger words'], ['persistMs', 'A fault holds this long before it is said, ms'], ['cooldownMs', 'The same cue not again inside, ms'],
    ['gapMs', 'No two cues inside, ms'], ['settleMs', 'In position this long before the clock starts, ms'], ['returnMs', 'Back at the start this long before a rep is over, ms'],
    ['lostEverySec', '"I can’t see you" every, seconds'], ['smooth', 'Smoothing on the readings (1 = none)'], ['vis', 'A landmark below this is not trusted (0–1)'],
  ];

  let draft = null, timer = 0;
  /* measuring on the figure, as the old Studio did it: pick the kind, then tap a point
     for each empty slot; the list walks itself on to the next. `making` is the one
     under way: its kind, its slots so far, and which slot the next tap fills. */
  const SLOTS = {
    angle: [['a', 'one end'], ['b', 'the joint'], ['c', 'other end']], tilt: [['base', 'base'], ['top', 'top']], floor: [['at', 'at'], ['to', 'to']],
    down: [['from', 'from'], ['to', 'to']], rise: [['a', 'the reference'], ['b', 'the point']], distance: [['a', 'from'], ['b', 'to']], bend: [['a', 'line start'], ['b', 'the point'], ['c', 'line end']],
  };
  const KIND_WORDS = { angle: 'Angle at a joint', tilt: 'Segment from vertical', floor: 'Segment from the floor', down: 'Lifted from hanging', rise: 'Height of a point over another', distance: 'Distance, % of a segment', bend: 'Point’s offset from a line' };
  const KIND_HELP = {
    angle: 'the angle at the middle point between the other two — a knee, a hip, an elbow. One tap on a joint fills all three from the limbs meeting there.',
    tilt: 'how far the line base→top leans off vertical, signed the way the body faces: a torso from upright, a shin from plumb.',
    floor: 'the angle the line at→to makes with the floor: 90 is plumb, less is leaning the way the body faces.',
    down: 'how far the line from→to is lifted from hanging straight down: 0 hanging, 90 level, 180 straight up. A thigh from the hip, an arm from the shoulder.',
    rise: 'how far the second point sits above the first, as an angle off level: + above, − below.',
    distance: 'the distance between the two points as a percent of a reference segment, the shin unless changed under More.',
    bend: 'how far the middle point sits off the straight line between the other two, + above: a back sagging or arching between shoulder and ankle.',
  };
  let making = { kind: 'angle', slots: {}, at: 'a' };
  const mode = () => making.kind;

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
      defaults: { holdTargetSec: 2, callAtSec: [], repCount: 10, setCount: 3, lowerSec: 1, restSec: 2, deepAt: 10 },
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
  function start(json, auto) {
    draft = clone(json);
    draft.auto = auto || draft.auto || {};   // a loaded or copied file is the person's: nothing in it is the template's
    draft.figure = { points: figurePoints(draft) }; delete draft.figure.pose;
    inferRoles();
    setKind('angle');
    if (window.__review) window.__review.setFig(draft.figure.points);
    render();
    commit(false);
  }
  const fromLibrary = (id) => { const m = Moves[id]; if (m) start(m.spec); };
  /* a file says which banded measurements make the position (inPosition, or all of them):
     that is each measurement's role here, and the role is the builder's, not the file's */
  function inferRoles() {
    const pos = draft.inPosition, pk = progressKey();
    for (const m of draft.measurements || []) m.role = m.key === pk ? 'progress' : !m.band ? 'reading' : (!pos || pos.includes(m.key)) ? 'hold' : 'note';
  }
  /* the file as it is written: the builder's bookkeeping left out */
  function fileOf() { const f = clone(draft); delete f.auto; for (const m of f.measurements || []) { delete m.role; delete m.short; delete m.autoBand; } return f; }

  /* every change comes here: the derived parts are brought up to date, the file is
     checked, the problems listed, the draft kept, and when whole laid over the library */
  function commit(structural) {
    if (!draft) return;
    derive();
    const file = fileOf();
    const problems = Spec.check(file);
    const errors = problems.filter((p) => p.level === 'error');
    $('problems').innerHTML = problems.length
      ? problems.map((p) => `<li class="${p.level}"><b>${esc(p.at || '')}</b> ${esc(p.message)}</li>`).join('')
      : '<li class="ok">Nothing wrong with it.</li>';
    $('build-note').textContent = errors.length ? `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before it can run — see Problems below` : `${draft.id}.json is whole${problems.length ? ` (${problems.length} to look at)` : ''}`;
    $('try-live').disabled = !!errors.length;
    $('build-json').value = JSON.stringify(file, null, 2);
    try { localStorage.setItem(DRAFT, JSON.stringify(draft)); } catch { }
    if (!errors.length) {
      try {
        Moves.draft(file);
        if (window.__review) { window.__review.refreshMoves(); window.__review.pickMove(draft.id, true); }
      } catch (e) { $('build-note').textContent = 'Could not compile: ' + (e.message || e); }
    }
    if (structural) render(); else refreshValues();
  }
  function drop() {
    try { localStorage.removeItem(DRAFT); } catch { }
    Moves.draft(null);
    if (window.__review) { window.__review.refreshMoves(); window.__review.pickMove(Moves.list[0].id, true); }
    draft = null; setKind('angle');
    parkEditor();
    $('build-form').innerHTML = ''; $('problems').innerHTML = ''; $('build-json').value = '';
    $('build-note').textContent = 'No draft. Start from a pose above, or from a copy of an exercise.';
    $('try-live').disabled = true;
    renderStart();
  }
  const debounce = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 250); };

  /* ================= what is derived ================= */
  const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^[^a-z]+/, '') || 'newmove';
  const lmRefs = (m) => { const out = []; for (const k of ['a', 'b', 'c', 'base', 'top', 'at', 'to', 'from']) { const v = m[k]; if (Array.isArray(v)) out.push(...v); else if (v) out.push(v); } if (m.per) out.push(...m.per); return out; };
  const plain = (n) => n.replace(/^(other|L|R)\./, '');
  const bandedKeys = () => draft.measurements.filter((m) => m.band).map((m) => m.key);
  const progressKey = () => (draft.type === 'reps' && draft.progress ? draft.progress.measure : null);
  const roleOf = (m) => (m.key === progressKey() ? 'progress' : !m.band ? 'reading' : (draft.inPosition || bandedKeys()).includes(m.key) ? 'hold' : 'note');
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
      if (a.prompt && pk) { const m = d.measurements.find((q) => q.key === pk); d.prompt.text = m ? (d.progress.direction === 'down' ? `Lower — ${m.label || m.key}` : `${cap(m.label || m.key)} — lift`) : ''; }
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

  /* ================= measuring: a kind, then a point for each slot ================= */
  const NEIGHBOURS = {
    side: { kn: ['hip', 'an'], hip: ['sh', 'kn'], an: ['kn', 'ft'], sh: ['hip', 'el'], el: ['sh', 'wr'], he: ['ft', 'kn'], knF: ['hip', 'anF'], anF: ['knF', 'ftF'], elF: ['sh', 'wrF'], heF: ['ftF', 'knF'] },
    front: { knL: ['hipL', 'anL'], hipL: ['shL', 'knL'], shL: ['hipL', 'elL'], elL: ['shL', 'wrL'], anL: ['knL', 'toL'], heL: ['toL', 'knL'], knR: ['hipR', 'anR'], hipR: ['shR', 'knR'], shR: ['hipR', 'elR'], elR: ['shR', 'wrR'], anR: ['knR', 'toR'], heR: ['toR', 'knR'] },
  };
  /* what a pair of landmarks is, for names: hip→shoulder is the torso, knee→ankle the shin */
  const SEGMENTS = [['hip', 'shoulder', 'torso'], ['hip', 'knee', 'thigh'], ['knee', 'ankle', 'shin'], ['shoulder', 'elbow', 'arm'], ['elbow', 'wrist', 'forearm'], ['heel', 'toe', 'foot'], ['ankle', 'toe', 'foot'], ['shoulder', 'wrist', 'arm'], ['hip', 'ankle', 'leg'], ['shoulder', 'ear', 'neck']];
  const side_ = (n) => (/^other\./.test(n) ? 'other' : /^L\./.test(n) ? 'l' : /^R\./.test(n) ? 'r' : '');
  const segmentOf = (x, y) => { const a = plain(x), b = plain(y); const hit = SEGMENTS.find(([p, q]) => (p === a && q === b) || (p === b && q === a)); return hit ? (side_(x) || side_(y)) + hit[2] : null; };
  const uniqueKey = (base) => { base = keyOf(base) || 'm'; let k = base, n = 2; while (draft.measurements.some((m) => m.key === k)) k = base + n++; return k; };
  const wordsFor = (name) => String(name).replace(/^other\./, 'other ').replace(/^L\./, 'left ').replace(/^R\./, 'right ').replace(/^other(?=[a-z])/, 'other ').replace(/^l(?=[a-z])/, 'left ').replace(/^r(?=[a-z])/, 'right ');
  const hudOf = (name) => plain(name).replace(/^other/, '').slice(0, 5).toUpperCase();
  /* the measurement the filled slots make */
  function fromSlots(kind, S) {
    const view = figView();
    if (kind === 'angle') { const j = plain(S.b), short = wordsFor(S.b); return { key: uniqueKey(side_(S.b) + j), kind, a: S.a, b: S.b, c: S.c, label: `${short} angle`, short, hud: hudOf(S.b) }; }
    if (kind === 'tilt') { const seg = segmentOf(S.base, S.top); const short = seg ? wordsFor(seg) : `${wordsFor(S.top)} over ${wordsFor(S.base)}`; return { key: uniqueKey(seg || plain(S.top) + 'lean'), kind, base: S.base, top: S.top, label: `${short} lean from vertical`, short, hud: hudOf(seg || S.top) }; }
    if (kind === 'floor') { const seg = segmentOf(S.at, S.to); const short = seg ? wordsFor(seg) : `${wordsFor(S.at)} to ${wordsFor(S.to)}`; return { key: uniqueKey(seg || plain(S.to) + 'floor'), kind, at: S.at, to: S.to, label: `${short} against the floor`, short, hud: hudOf(seg || S.to) }; }
    if (kind === 'down') { const seg = segmentOf(S.from, S.to); const short = seg ? wordsFor(seg) : `${wordsFor(S.from)} to ${wordsFor(S.to)}`; return { key: uniqueKey(seg || plain(S.to) + 'lift'), kind, from: S.from, to: S.to, label: `${short} lifted from hanging`, short, hud: hudOf(seg || S.to) }; }
    if (kind === 'rise') { const short = `${wordsFor(S.b)} height`; return { key: uniqueKey(side_(S.b) + plain(S.b) + 'up'), kind, a: S.a, b: S.b, label: `${wordsFor(S.b)} above the ${wordsFor(S.a)}`, short, hud: hudOf(S.b) }; }
    if (kind === 'distance') { const per = view === 'front' ? ['R.knee', 'R.ankle'] : ['knee', 'ankle']; const seg = segmentOf(S.a, S.b); const short = seg ? `${wordsFor(seg)} length` : `${wordsFor(S.a)}–${wordsFor(S.b)} length`; return { key: uniqueKey((seg || plain(S.a) + plain(S.b)) + 'len'), kind, a: S.a, b: S.b, per, times: 100, label: `${short}, % of the shin`, short, hud: 'LEN' }; }
    if (kind === 'bend') { const short = `${wordsFor(S.b)} off the line`; return { key: uniqueKey(side_(S.b) + plain(S.b) + 'bend'), kind, a: S.a, b: S.b, c: S.c, label: `${wordsFor(S.b)} off the ${wordsFor(S.a)}–${wordsFor(S.c)} line`, short, hud: hudOf(S.b) }; }
    return null;
  }
  const slotsOf = (kind) => SLOTS[kind] || SLOTS.angle;
  const nextEmpty = () => { const sl = slotsOf(making.kind).find(([k]) => !making.slots[k]); return sl ? sl[0] : null; };
  function setKind(kind) { making = { kind, slots: {}, at: slotsOf(kind)[0][0] }; }
  /* a tap on the figure: fills the slot being filled and walks on; on an angle with nothing filled,
     a joint fills all three from the limbs meeting there */
  function tapped(k) {
    if (!k) return;
    const view = figView(), name = NAME[view][k]; if (!name) return;
    const S = making.slots, sl = slotsOf(making.kind);
    if (making.kind === 'angle' && !S.a && !S.b && !S.c && NEIGHBOURS[view][k]) { const [x, y] = NEIGHBOURS[view][k]; S.a = NAME[view][x]; S.b = name; S.c = NAME[view][y]; }
    else { S[making.at || nextEmpty() || sl[sl.length - 1][0]] = name; }
    making.at = nextEmpty();
    if (making.at) { drawMeasure(); renderSlots(); return; }
    const m = fromSlots(making.kind, S); if (!m) return;
    m.role = 'reading';
    draft.measurements.push(m);
    /* the first measurement of a rep exercise is what the rep is: it tracks it */
    if (draft.type === 'reps' && !progressKey()) setRole(m, 'progress'); else setRole(m, 'hold');
    setKind(making.kind);
    commit(true);
  }
  /* the slots as buttons: the one being filled is pressed; a filled one taps to refill */
  let slotHost = null;
  function renderSlots() {
    if (!slotHost) return; slotHost.innerHTML = '';
    slotHost.appendChild(el('p', 'tiny', KIND_HELP[making.kind] || ''));
    const row = el('div', 'chips');
    for (const [k, words] of slotsOf(making.kind)) { const b = btn(`${words}: ${making.slots[k] ? wordsFor(making.slots[k]) : '…'}`, () => { making.at = k; drawMeasure(); renderSlots(); }); b.setAttribute('aria-pressed', String(making.at === k)); row.appendChild(b); }
    if (Object.keys(making.slots).length) row.appendChild(btn('clear', () => { setKind(making.kind); drawMeasure(); renderSlots(); }));
    slotHost.appendChild(row);
  }
  /* a role: what the measurement is for. Its edges and thresholds come from the drawing */
  const TOL = (m) => (m.kind === 'angle' || m.kind === 'bend' ? 10 : m.kind === 'distance' ? 10 : 8);
  const ensure = (m, key, value, words, lo, hi) => { if (typeof draft.defaults[key] !== 'number') draft.defaults[key] = Math.round(value); m.settings = m.settings || []; if (!m.settings.some((s) => s.key === key)) m.settings.push({ key, label: `${cap(m.label || m.key)}, ${words}`, min: Math.round(lo), max: Math.round(hi) }); };
  function clearBand(m) {
    for (const s of m.settings || []) { if (!(draft.settings || []).some((t) => t.key === s.key) && !['raiseAt', 'downAt'].includes(s.key)) delete draft.defaults[s.key]; }
    delete m.band; delete m.settings; delete m.scale; delete m.note;
    draft.faults = draft.faults.filter((x) => x.measure !== m.key);
  }
  function setRole(m, role) {
    const d = draft, was = roleOf(m);
    if (was === 'progress' && role !== 'progress') { delete d.progress; delete d.defaults.raiseAt; delete d.defaults.downAt; d.settings = d.settings.filter((s) => s.key !== 'raiseAt'); }
    if (role === 'reading') { clearBand(m); m.role = 'reading'; return; }
    const { A, B } = valuesAB(m), tol = TOL(m), base = m.key, v = (A + B) / 2;
    clearBand(m);
    m.role = role;
    m.scale = m.kind === 'angle' ? [0, 180] : m.kind === 'distance' ? [0, 150] : m.kind === 'down' ? [0, 180] : [-90, 90];
    const L = m.short || m.label || m.key;
    m.autoBand = true;   // the edges follow the drawing until one of them is edited
    if (role === 'progress') {
      if (A == null || B == null) { m.role = 'hold'; return setRole(m, 'hold'); }
      const up = B >= A;
      d.progress = { measure: m.key, raiseAt: 'raiseAt', downAt: 'downAt', direction: up ? 'up' : 'down' };
      d.defaults.raiseAt = Math.round(A + (B - A) * 0.4); d.defaults.downAt = Math.round(A + (B - A) * 0.15);
      d.settings = d.settings.filter((s) => s.key !== 'raiseAt');
      d.settings.push({ key: 'raiseAt', label: `${cap(L)} that counts as under way`, min: Math.round(Math.min(A, B) - 20), max: Math.round(Math.max(A, B) + 20) });
      m.band = { lo: base + 'Min', hi: base + 'Max' }; m.note = 'at the top';
      ensure(m, base + 'Min', B - tol, 'at the top, at least', Math.min(A, B) - 30, Math.max(A, B) + 30);
      ensure(m, base + 'Max', B + tol, 'at the top, at most', Math.min(A, B) - 30, Math.max(A, B) + 30);
      d.faults.push({ id: base + 'Short', measure: m.key, side: up ? 'below' : 'above', label: `${cap(L)} short`.slice(0, 26), text: `A little further — ${L}`, deep: `Further — ${L} is well short`, tone: up ? 'up' : 'down' });
      d.faults.push({ id: base + 'Far', measure: m.key, side: up ? 'above' : 'below', label: `${cap(L)} too far`.slice(0, 26), text: `Not so far — ${L}`, deep: `Ease off — ${L} is well past`, tone: up ? 'down' : 'up' });
      return;
    }
    /* must be right, or a note: a band around where the drawing has it, one-sided at the extremes */
    m.note = role === 'note' ? 'a note' : 'keep';
    const lo = Math.min(A == null ? B : A, B == null ? A : B), hi = Math.max(A == null ? B : A, B == null ? A : B);
    if (m.kind === 'angle' && lo >= 160) {
      m.band = { min: base + 'Min' }; ensure(m, base + 'Min', lo - tol, 'at least', 90, 180);
      d.faults.push({ id: base + 'Bend', measure: m.key, side: 'below', label: `${cap(L)} bending`.slice(0, 26), text: `Keep the ${L} straight`, deep: `Straighten the ${L} — it is bending`, tone: 'plain' });
    } else if (m.kind === 'angle' && hi <= 20) {
      m.band = { max: base + 'Max' }; ensure(m, base + 'Max', hi + tol, 'at most', 0, 90);
      d.faults.push({ id: base + 'Open', measure: m.key, side: 'above', label: `${cap(L)} opening`.slice(0, 26), text: `Keep the ${L} closed`, deep: `Close the ${L} — it is opening`, tone: 'plain' });
    } else if ((m.kind === 'tilt' || m.kind === 'rise' || m.kind === 'bend') && Math.abs(lo) <= 12 && Math.abs(hi) <= 12) {
      m.band = { sym: base + 'Max' }; m.scale = [-45, 45]; ensure(m, base + 'Max', tol, 'allowed either way', 1, 45);
      d.faults.push({ id: base + 'Over', measure: m.key, side: 'above', label: `${cap(L)} off one way`.slice(0, 26), text: `Bring the ${L} back level`, deep: `The ${L} is well off — bring it back`, tone: 'plain' });
      d.faults.push({ id: base + 'Under', measure: m.key, side: 'below', label: `${cap(L)} off the other`.slice(0, 26), text: `Bring the ${L} back level`, deep: `The ${L} is well off — bring it back`, tone: 'plain' });
    } else {
      m.band = { lo: base + 'Min', hi: base + 'Max' };
      ensure(m, base + 'Min', lo - tol, 'at least', lo - 40, hi + 40); ensure(m, base + 'Max', hi + tol, 'at most', lo - 40, hi + 40);
      d.faults.push({ id: base + 'Low', measure: m.key, side: 'below', label: `${cap(L)} too low`.slice(0, 26), text: `${cap(L)} a little more`, deep: `More ${L} — it is well short`, tone: 'up' });
      d.faults.push({ id: base + 'High', measure: m.key, side: 'above', label: `${cap(L)} too high`.slice(0, 26), text: `Not so much ${L}`, deep: `Less ${L} — it is well past`, tone: 'down' });
    }
  }
  /* the drawing moved: a band that was never edited follows it (its faults keep their words) */
  /* the band's shape the drawing calls for: one-sided at the extremes, symmetric about level, a range otherwise */
  function kindFor(m, role, lo, hi) {
    if (role === 'progress') return 'range';
    if (m.kind === 'angle' && lo >= 160) return 'min';
    if (m.kind === 'angle' && hi <= 20) return 'max';
    if ((m.kind === 'tilt' || m.kind === 'rise' || m.kind === 'bend') && Math.abs(lo) <= 12 && Math.abs(hi) <= 12) return 'sym';
    return 'range';
  }
  function retune(m) {
    const d = draft, role = roleOf(m); if (!m.autoBand || !m.band) return;
    const { A, B } = valuesAB(m); if (A == null || B == null) return;
    const tol = TOL(m), base = m.key, lo = Math.min(A, B), hi = Math.max(A, B), kind = Spec.bandKind(m.band);
    /* a still-automatic band whose shape no longer fits the drawing is made again, words and all */
    if (kindFor(m, role, lo, hi) !== kind) { setRole(m, role); return; }
    if (role === 'progress') {
      const up = B >= A; d.progress.direction = up ? 'up' : 'down';
      d.defaults.raiseAt = Math.round(A + (B - A) * 0.4); d.defaults.downAt = Math.round(A + (B - A) * 0.15);
      d.defaults[m.band.lo] = Math.round(B - tol); d.defaults[m.band.hi] = Math.round(B + tol);
      for (const x of d.faults) { if (x.measure !== m.key) continue; if (x.id === base + 'Short') { x.side = up ? 'below' : 'above'; x.tone = up ? 'up' : 'down'; } if (x.id === base + 'Far') { x.side = up ? 'above' : 'below'; x.tone = up ? 'down' : 'up'; } }
      return;
    }
    if (kind === 'min') d.defaults[m.band.min] = Math.round(lo - tol);
    else if (kind === 'max') d.defaults[m.band.max] = Math.round(hi + tol);
    else if (kind === 'sym') d.defaults[m.band.sym] = Math.round(Math.max(Math.abs(lo), Math.abs(hi)) + tol);
    else { d.defaults[m.band.lo] = Math.round(lo - tol); d.defaults[m.band.hi] = Math.round(hi + tol); }
  }
  function removeMeasure(m) {
    clearBand(m);
    if (roleOf(m) === 'progress') { delete draft.progress; delete draft.defaults.raiseAt; delete draft.defaults.downAt; draft.settings = draft.settings.filter((s) => s.key !== 'raiseAt'); }
    draft.measurements = draft.measurements.filter((q) => q !== m);
    if (draft.inPosition) draft.inPosition = draft.inPosition.filter((k) => k !== m.key);
  }

  /* ---- the measuring canvas: the figure at A with every landmark the model has, named, to tap ---- */
  let mcanvas = null;
  function mBox() {
    const f = draft.figure.points, xs = [], ys = [];
    for (const K of [f.A, f.B || f.A]) for (const k in K) { xs.push(K[k][0]); ys.push(K[k][1]); }
    return { x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, y0: Math.min(...ys) - 24, y1: Math.max(...ys) + 18 };
  }
  function mTransform() {
    /* the canvas takes the drawing's shape: a standing body tall, a lying one wide */
    const b = mBox(), ratio = Math.max(1.2, Math.min(3.2, (b.x1 - b.x0) / (b.y1 - b.y0)));
    if (mcanvas.style.aspectRatio !== `${ratio}`) mcanvas.style.aspectRatio = `${ratio}`;
    const r = mcanvas.getBoundingClientRect();
    const s = Math.min(r.width / (b.x1 - b.x0), r.height / (b.y1 - b.y0)) * 0.96;
    return { s, tx: r.width / 2 - (b.x0 + b.x1) / 2 * s, ty: r.height / 2 - (b.y0 + b.y1) / 2 * s, w: r.width, h: r.height };
  }
  function drawMeasure() {
    if (!mcanvas || !draft) return;
    const r = mcanvas.getBoundingClientRect(); if (!r.width) return;
    const T = mTransform(), rr = mcanvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    mcanvas.width = Math.round(rr.width * dpr); mcanvas.height = Math.round(rr.height * dpr);
    const ctx = mcanvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rr.width, rr.height);
    const f = draft.figure.points, view = figView(), K = f.A, B = f.B || f.A, N = NAME[view];
    const at = (p) => [T.tx + p[0] * T.s, T.ty + p[1] * T.s];
    const chain = (Kf, colour, width) => { ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (const c of chainsOf(view)) { const pts = c.filter((k) => Kf[k]); if (pts.length < 2) continue; ctx.beginPath(); pts.forEach((k, i) => { const [x, y] = at(Kf[k]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); } if (Kf.h) { const [x, y] = at(Kf.h); ctx.beginPath(); ctx.arc(x, y, 8 * T.s, 0, Math.PI * 2); ctx.stroke(); } };
    ctx.strokeStyle = 'rgba(232,237,244,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, T.ty + 163 * T.s); ctx.lineTo(rr.width, T.ty + 163 * T.s); ctx.stroke();
    if (B !== K) chain(B, 'rgba(90,169,255,.22)', 4 * T.s);
    chain(K, 'rgba(232,237,244,.55)', 4 * T.s);
    /* what is measured already, in the colour of its role */
    const P = (n) => { const p = pointFor(Array.isArray(n) ? n[0] : n, K, view); return p ? at([p.x, p.y]) : null; };
    for (const m of draft.measurements) {
      const role = roleOf(m), colour = role === 'progress' ? '#5aa9ff' : role === 'hold' ? '#35d07f' : role === 'note' ? '#ffb545' : 'rgba(232,237,244,.5)';
      ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 2.5;
      if (m.kind === 'angle' || m.kind === 'bend') { const a = P(m.a), b = P(m.b), c = P(m.c); if (a && b && c) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.stroke(); const rad = 14 * Math.max(0.6, T.s / 2); ctx.beginPath(); ctx.arc(b[0], b[1], rad, Math.atan2(a[1] - b[1], a[0] - b[0]), Math.atan2(c[1] - b[1], c[0] - b[0]), false); ctx.stroke(); } }
      else { const a = P(m.a || m.base || m.from || m.at), b = P(m.b || m.top || m.to); if (a && b) { ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]); } }
    }
    /* the slots picked so far, in amber, and their order */
    const picks = Object.entries(making.slots);
    /* every landmark, a dot and a name: the near side's names above, the far side's below, the
       names along a row staggered so a lying body's do not run into each other */
    const fs = Math.max(9, Math.min(11, rr.width / 70));
    ctx.font = `700 ${fs}px ui-sans-serif, system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const keys = Object.keys(K).filter((k) => N[k]);
    const rows = { near: keys.filter((k) => !/^(other|L)\./.test(N[k])).sort((p, q) => K[p][0] - K[q][0]), far: keys.filter((k) => /^(other|L)\./.test(N[k])).sort((p, q) => K[p][0] - K[q][0]) };
    for (const k of keys) {
      const name = N[k], [x, y] = at(K[k]), far = rows.far.includes(k), picked = picks.find(([, v]) => v === name);
      ctx.beginPath(); ctx.arc(x, y, picked ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = picked ? '#ffb545' : far ? 'rgba(232,237,244,.45)' : '#e8edf4'; ctx.fill();
      if (picked) { ctx.fillStyle = '#0b0f16'; ctx.textAlign = 'center'; ctx.fillText(String(picks.indexOf(picked) + 1), x, y + 0.5); }
      const label = name.replace(/^other\./, '·').replace(/^L\./, 'L ').replace(/^R\./, 'R ');
      const row = far ? rows.far : rows.near, i = row.indexOf(k), step = (i % 2) * (fs + 2);
      const lx = x + (far ? -7 : 7), ly = y + (far ? 9 + step : -(9 + step));
      ctx.textAlign = far ? 'right' : 'left';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(11,15,22,.9)'; ctx.strokeText(label, lx, ly);
      ctx.fillStyle = picked ? '#ffb545' : far ? 'rgba(232,237,244,.55)' : 'rgba(232,237,244,.9)'; ctx.fillText(label, lx, ly);
    }
    ctx.fillStyle = 'rgba(232,237,244,.6)'; ctx.textAlign = 'left';
    const sl = slotsOf(making.kind).find(([k]) => k === making.at);
    ctx.fillText(`${KIND_WORDS[making.kind]} — tap ${sl ? sl[1] : 'a point'}` + (making.kind === 'angle' && !picks.length ? ' (a joint fills all three)' : ''), 8, 12);
  }
  function hitAt(e) {
    const T = mTransform(), r = mcanvas.getBoundingClientRect(), K = draft.figure.points.A, N = NAME[figView()];
    const x = (e.clientX - r.left - T.tx) / T.s, y = (e.clientY - r.top - T.ty) / T.s, tol = 12 / T.s;
    let best = null, bd = tol;
    for (const k in K) { if (!N[k]) continue; const d = Math.hypot(K[k][0] - x, K[k][1] - y); if (d < bd) { bd = d; best = k; } }
    return best;
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
    input.onchange = () => {
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
    else { const a = el('button', 'linkbtn', 'use the template'); a.type = 'button'; a.style.marginLeft = '6px'; a.onclick = () => { draft.auto[flag] = true; commit(true); }; lab.querySelector('span').appendChild(a); }
    return lab;
  }
  const settingKeys = () => Object.keys(draft.defaults || {});
  const optsOf = (arr, blank) => (blank ? [['', blank]] : []).concat(arr.map((k) => [k, k]));
  const lmOpts = (blank) => optsOf(LM.concat(LM.map((k) => 'other.' + k), figView() === 'front' ? LM.flatMap((k) => ['L.' + k, 'R.' + k]) : []), blank);

  /* ================= the editor's place ================= */
  function parkEditor() { const e = $('fig-editor'); if (e && e.parentNode !== $('fig-park')) $('fig-park').appendChild(e); }
  function placeEditor(host) { const e = $('fig-editor'); host.appendChild(e); if (window.__review) requestAnimationFrame(() => window.__review.animChanged()); }
  /* the editor's every drag: into the draft */
  function figChanged(j) {
    if (!draft) return;
    if (!j || !j.A) return;   // the editor before any figure is set
    draft.figure = { points: Object.assign({}, j, { B: j.hold ? undefined : j.B }) };
    draft.muscles = j.w || {};
    for (const m of draft.measurements) retune(m);
    commit(false);
    /* the edges on the cards follow too */
    document.querySelectorAll('[data-def]').forEach((n) => { if (document.activeElement !== n) n.value = draft.defaults[n.dataset.def]; });
    drawMeasure();
  }
  /* the values at A and B on the cards, without rebuilding the form */
  function refreshValues() {
    if (!draft) return;
    document.querySelectorAll('[data-val]').forEach((n) => { const m = draft.measurements.find((q) => q.key === n.dataset.val); if (!m) return; const { A, B } = valuesAB(m); n.innerHTML = `at the start <b>${fmt(A, m)}</b> · at the end <b>${fmt(B, m)}</b>`; });
    drawMeasure();
  }

  /* ================= the start: a pose ================= */
  function renderStart() {
    const host = $('build-start'); host.innerHTML = '';
    const pickGrid = () => {
      const g = el('div', 'pose-pick');
      for (const p of POSES) { const b = btn(`${poseSvg(figureOfPose(p))}<span>${esc(p.name)}</span>`, () => start(fromPose(p), AUTO())); g.appendChild(b); }
      return g;
    };
    if (!draft) { host.appendChild(el('h2', null, 'Start from a pose')); host.appendChild(el('p', 'tiny', 'Pick how the person starts and which way the phone looks at them. Everything else follows from it and can be changed.')); host.appendChild(pickGrid()); return; }
    const d = details(`Start over from a pose (the draft “${draft.name}” would be dropped)`); d.appendChild(pickGrid()); host.appendChild(d);
  }

  /* ================= the form ================= */
  function render() {
    renderStart();
    const host = $('build-form');
    parkEditor(); host.innerHTML = '';
    if (!draft) return;
    const d = draft; d.auto = d.auto || {};
    d.words = d.words || {}; d.phone = d.phone || {}; d.landmarks = d.landmarks || {}; d.measurements = d.measurements || []; d.faults = d.faults || [];
    d.defaults = d.defaults || {}; d.settings = d.settings || []; d.draw = d.draw || []; d.muscles = d.muscles || {}; d.figure = d.figure || {};

    /* 1 — the exercise */
    let s = section('The exercise');
    let g = grid();
    g.appendChild(autoField('id', 'Name', d.name, (v) => { d.name = v; }, { placeholder: 'Glute bridge' }));
    g.appendChild(field(`File and key: ${d.id}.json`, d.id, (v) => { d.id = keyOf(v); d.auto.id = false; }, { placeholder: 'bridge', title: 'one word, lowercase: the file’s name and what the browser remembers it by' }));
    g.appendChild(field('What it is', d.type, (v) => { d.type = v; if (v === 'hold') { d.defaults.holdTargetSec = Math.max(d.defaults.holdTargetSec || 0, 20); } }, { options: [['reps', 'reps — a movement, counted'], ['hold', 'hold — one position, timed']], structural: true }));
    g.appendChild(field('Sides', d.sides || 'both', (v) => { d.sides = v; }, { options: [['both', 'both at once'], ['left', 'the left'], ['right', 'the right'], ['alternate', 'one side per set, alternating']], structural: true }));
    g.appendChild(field('Load', d.load || 'none', (v) => { d.load = v; }, { options: [['none', 'none'], ['weight', 'a weight (kg bubble)'], ['band', 'a band (light, medium, heavy)'], ['both', 'a weight and a band']] }));
    g.appendChild(field('Body position', d.position || '', (v) => { d.position = v; }, { options: optsOf(Spec.POSITIONS), structural: true, title: 'sets the phone’s orientation, the opening words and which way the body faces, until you change those yourself' }));
    s.appendChild(g);
    let more = details('More about it');
    g = grid();
    g.appendChild(field('The movement, in words', d.movement, (v) => { d.movement = v; }, { placeholder: 'hips lifted to a line and lowered' }));
    g.appendChild(field('Category', d.category, (v) => { d.category = v; }, { placeholder: 'Glutes and hips' }));
    g.appendChild(field('Tags (the search finds these)', list(d.tags), (v) => { d.tags = fromList(v); }));
    g.appendChild(field('Equipment', list(d.equipment), (v) => { d.equipment = fromList(v); }));
    g.appendChild(field('Order in the list', d.order, (v) => { d.order = v == null ? 99 : v; }, { type: 'number' }));
    g.appendChild(field('Status', d.status || 'ready', (v) => { d.status = v; }, { options: [['ready', 'ready — on the home page'], ['draft', 'draft — listed with a badge']] }));
    const mg = grid('tight'); for (const k of Spec.REGIONS) mg.appendChild(field(k, d.muscles[k], (v) => { if (v) d.muscles[k] = v; else delete d.muscles[k]; if (d.figure.points) d.figure.points.w = d.muscles; if (window.__review) window.__review.setFig(d.figure.points); }, { type: 'number', step: '0.05' }));
    more.appendChild(g); more.appendChild(el('p', 'tiny', 'Muscles working, 0 to 1 — the figure warms them by this:')); more.appendChild(mg);
    s.appendChild(more); host.appendChild(s);

    /* 2 — drawn */
    s = section('The movement, drawn', 'A is the start, B the end; the coach animates between them. Drag the joints. What you draw is what step 3 measures.');
    placeEditor(s);
    host.appendChild(s);

    /* 3 — measured */
    s = section('What is measured', 'Pick the kind, then tap a point on the figure for each slot; the list walks on to the next. Every landmark the camera reads is there, the far side dimmer. Each measurement reads its value at A and at B off the drawing, and its role says what it is for: the one that tracks the rep, the ones that must be right at the top, a note that is called but does not stop the count, or just a reading.');
    s.appendChild(chips(Object.keys(SLOTS).map((k) => [k, KIND_WORDS[k], KIND_HELP[k]]), making.kind, (v) => { setKind(v); drawMeasure(); renderSlots(); document.querySelectorAll('#build-form .kind-chips .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === v))); }));
    s.lastChild.classList.add('kind-chips'); s.lastChild.querySelectorAll('.btn').forEach((b, i) => { b.dataset.kind = Object.keys(SLOTS)[i]; });
    slotHost = el('div'); s.appendChild(slotHost); renderSlots();
    mcanvas = el('canvas', 'measure-fig'); mcanvas.setAttribute('aria-label', 'The figure, to tap what is measured');
    mcanvas.addEventListener('pointerdown', (e) => { e.preventDefault(); tapped(hitAt(e)); });
    s.appendChild(mcanvas);
    if (!d.measurements.length) s.appendChild(el('p', 'tiny', d.type === 'reps' ? 'Nothing measured yet. The first measurement becomes what the rep is tracked by.' : 'Nothing measured yet. Measure what has to be right for the hold.'));
    d.measurements.forEach((m, i) => {
      const card = el('div', 'mcard'); const role = roleOf(m);
      const head = el('div', 'mhead');
      head.appendChild(el('b', null, esc(m.label || m.key)));
      head.appendChild(el('span', 'mvals', ''));
      head.lastChild.dataset.val = m.key;
      const tools = el('span', 'rowtools');
      tools.appendChild(btn('↑', () => { if (i > 0) { [d.measurements[i - 1], d.measurements[i]] = [d.measurements[i], d.measurements[i - 1]]; commit(true); } }, 'tiny-btn'));
      tools.appendChild(btn('↓', () => { if (i < d.measurements.length - 1) { [d.measurements[i + 1], d.measurements[i]] = [d.measurements[i], d.measurements[i + 1]]; commit(true); } }, 'tiny-btn'));
      tools.appendChild(btn('✕', () => { removeMeasure(m); commit(true); }, 'tiny-btn'));
      head.appendChild(tools);
      card.appendChild(head);
      const roles = d.type === 'reps' ? [['progress', 'tracks the rep'], ['hold', 'must be right at the top'], ['note', 'a note — called, does not stop the count'], ['reading', 'just a reading']] : [['hold', 'must be right for the hold'], ['note', 'a note — called, does not stop the clock'], ['reading', 'just a reading']];
      card.appendChild(chips(roles, role, (v) => { if (v === 'progress') { const prev = d.measurements.find((q) => roleOf(q) === 'progress'); if (prev && prev !== m) setRole(prev, 'hold'); } setRole(m, v); commit(true); }));
      g = grid('tight');
      if (m.band) {
        const kind = Spec.bandKind(m.band);
        const refs = kind === 'sym' ? [['sym', 'within ±']] : kind === 'min' ? [['min', 'at least']] : kind === 'max' ? [['max', 'at most']] : [['lo', 'at least'], ['hi', 'at most']];
        const edge = (label, key) => { const f = field(label, d.defaults[key], (v) => { d.defaults[key] = v; delete m.autoBand; }, { type: 'number' }); f.querySelector('input').dataset.def = key; return f; };
        for (const [rk, rl] of refs) g.appendChild(edge(rl, m.band[rk]));
        if (role === 'progress') { g.appendChild(edge('under way past', 'raiseAt')); g.appendChild(edge('counts back at', 'downAt')); }
        if (m.autoBand) g.appendChild(el('p', 'auto-note', 'These follow the drawing (the value at the end, give or take) until you edit one.'));
      }
      card.appendChild(g);
      const fs = d.faults.filter((x) => x.measure === m.key);
      for (const x of fs) {
        const row = el('div', 'fault-row grid tight');
        row.appendChild(field(`when ${x.side} the band: on the picture`, x.label, (v) => { x.label = v; }));
        row.appendChild(field('said', x.text, (v) => { x.text = v; }));
        row.appendChild(field('said when well past', x.deep, (v) => { x.deep = v; }));
        row.appendChild(field('coached before the first rep too', !!x.setup, (v) => { if (v) x.setup = true; else delete x.setup; }, { type: 'check' }));
        card.appendChild(row);
      }
      more = details('More about this measurement');
      const gg = grid('tight');
      gg.appendChild(field('words for it', m.label, (v) => { m.label = v; }, { structural: true }));
      gg.appendChild(field('short name on the picture', m.hud, (v) => { m.hud = v; }));
      gg.appendChild(field('key', m.key, (v) => { const old = m.key; m.key = keyOf(v); for (const x of d.faults) if (x.measure === old) x.measure = m.key; if (d.progress && d.progress.measure === old) d.progress.measure = m.key; }, { structural: true }));
      gg.appendChild(field('kind', m.kind, (v) => { m.kind = v; }, { options: Spec.KINDS, structural: true }));
      const NEED = { angle: ['a', 'b', 'c'], tilt: ['base', 'top'], floor: ['at', 'to'], bend: ['a', 'b', 'c'], rise: ['a', 'b'], down: ['from', 'to'], distance: ['a', 'b'], sum: [] };
      for (const k of NEED[m.kind] || []) gg.appendChild(field(k, Array.isArray(m[k]) ? m[k][0] : m[k], (v) => { m[k] = v; }, { options: lmOpts('—') }));
      if (m.kind === 'distance') gg.appendChild(field('as a share of (two landmarks)', list(m.per), (v) => { const l = fromList(v); m.per = l.length === 2 ? l : undefined; }));
      gg.appendChild(field('offset (added)', m.offset, (v) => { if (v == null) delete m.offset; else m.offset = v; }, { type: 'number' }));
      gg.appendChild(field('times', m.times, (v) => { if (v == null) delete m.times; else m.times = v; }, { type: 'number' }));
      gg.appendChild(field('bias (taken off: a number or a setting)', m.bias, (v) => { if (v == null || v === '') delete m.bias; else m.bias = isNaN(Number(v)) ? v : Number(v); }));
      gg.appendChild(field('unseen: the reading when a landmark is hidden', m.unseen, (v) => { if (v == null) delete m.unseen; else m.unseen = v; }, { type: 'number' }));
      gg.appendChild(field('optional: not read is not a fault', m.optional, (v) => { if (v) m.optional = true; else delete m.optional; }, { type: 'check' }));
      { const gt = m.gate || {}; const earlier = d.measurements.slice(0, i).map((q) => q.key);
        gg.appendChild(field('read only while this earlier measurement…', gt.measure, (v) => { if (!v) delete m.gate; else m.gate = Object.assign({}, m.gate, { measure: v }); }, { options: [['', '— (always)']].concat(earlier.map((k) => [k, k])) }));
        gg.appendChild(field('…is at least', gt.min, (v) => { if (m.gate) { if (v == null || v === '') delete m.gate.min; else m.gate.min = isNaN(Number(v)) ? v : Number(v); } }));
        gg.appendChild(field('…and at most', gt.max, (v) => { if (m.gate) { if (v == null || v === '') delete m.gate.max; else m.gate.max = isNaN(Number(v)) ? v : Number(v); } })); }
      if (m.band) { gg.appendChild(field('meter from', (m.scale || [])[0], (v) => { m.scale = [v, (m.scale || [])[1]]; }, { type: 'number' })); gg.appendChild(field('meter to', (m.scale || [])[1], (v) => { m.scale = [(m.scale || [])[0], v]; }, { type: 'number' })); gg.appendChild(field('note on the picture', m.note, (v) => { m.note = v; })); }
      gg.appendChild(field('why (a note for the file)', m.why, (v) => { m.why = v; }, { type: 'textarea', rows: 2, wide: true }));
      more.appendChild(gg); card.appendChild(more);
      s.appendChild(card);
    });
    more = details('Landmarks, bones and the drawing (derived from the measurements)');
    g = grid();
    const L = d.landmarks;
    const lmField = (label, value, set) => autoField('landmarks', label, value, set, { wide: true });
    g.appendChild(lmField('Joints used', list(L.joints), (v) => { L.joints = fromList(v); }));
    g.appendChild(lmField('Needed — the frame is unusable without these', list(L.needed), (v) => { L.needed = fromList(v); }));
    g.appendChild(lmField('Dots drawn', list(L.dots), (v) => { L.dots = fromList(v); }));
    g.appendChild(autoField('landmarks', 'Bones, one a line as a-b', (L.bones || []).map((b) => b.join('-')).join('\n'), (v) => { L.bones = fromLines(v).map((x) => x.split('-').map((y) => y.trim())).filter((b) => b.length === 2); }, { type: 'textarea', rows: 3 }));
    g.appendChild(autoField('landmarks', 'Bone colours, a|b: measurement', Object.entries(L.limb || {}).map(([k, v]) => `${k}: ${v}`).join('\n'), (v) => { L.limb = {}; for (const line of fromLines(v)) { const mm = /^([^:]+):\s*(\S+)$/.exec(line); if (mm) L.limb[mm[1].trim()] = mm[2]; } }, { type: 'textarea', rows: 3 }));
    g.appendChild(autoField('facing', 'Faces from', (d.facing || {}).from, (v) => { d.facing = Object.assign({}, d.facing, { from: v }); }, { options: lmOpts('—') }));
    g.appendChild(autoField('facing', 'toward', (d.facing || {}).to, (v) => { d.facing = Object.assign({}, d.facing, { to: v }); }, { options: lmOpts('—') }));
    g.appendChild(autoField('side', 'Which side is measured', (d.side || {}).pick || 'clearest', (v) => { d.side = { pick: v }; }, { options: [['clearest', 'the side the model sees best'], ['left', 'the left'], ['right', 'the right'], ['highest', 'the side whose joint is higher'], ['measure', 'the side whose measurement is larger']], structural: true }));
    if ((d.side || {}).pick === 'highest') g.appendChild(autoField('side', 'that joint', d.side.joint, (v) => { d.side.joint = v; }, { options: lmOpts('—') }));
    if ((d.side || {}).pick === 'measure') g.appendChild(autoField('side', 'that measurement', d.side.measure, (v) => { d.side.measure = v; }, { options: optsOf(d.measurements.map((m) => m.key), '—') }));
    if (['highest', 'measure'].includes((d.side || {}).pick)) { const h = d.side.hold || {}; g.appendChild(autoField('side', 'held until the other side leads by', h.margin, (v) => { if (v == null) delete d.side.hold; else d.side.hold = Object.assign({ frames: 5 }, d.side.hold, { margin: v }); }, { type: 'number' })); }
    g.appendChild(autoField('draw', 'Drawn on the picture, as JSON', JSON.stringify(d.draw), (v) => { try { d.draw = JSON.parse(v); } catch { } }, { type: 'textarea', rows: 3, wide: true }));
    more.appendChild(g); s.appendChild(more);
    host.appendChild(s);

    /* 4 — the phone and the words */
    s = section('The phone and the words', 'Where the phone goes and what is said follow from the pose; change what you like.');
    g = grid();
    g.appendChild(field('The phone', d.phone.orientation || 'tall', (v) => { d.phone.orientation = v; }, { options: [['tall', 'stood up (tall picture)'], ['wide', 'on its side (wide picture)']], structural: true }));
    g.appendChild(field('It sees the body', d.phone.view || 'side', (v) => { d.phone.view = v; }, { options: [['side', 'side on'], ['front', 'from the front (left and right apart)']], structural: true, title: 'a front view names landmarks L.knee and R.knee; the figure’s view should match' }));
    g.appendChild(field('How far away', d.phone.distance || 'two or three metres', (v) => { d.phone.distance = v; }, { options: [['a metre or two', 'a metre or two'], ['two or three metres', 'two or three metres'], ['three metres or more', 'three metres or more']], structural: true }));
    g.appendChild(autoField('placement', 'Where it goes (the set-up card)', d.phone.placement, (v) => { d.phone.placement = v; }, { type: 'textarea', rows: 2, wide: true }));
    g.appendChild(autoField('start', 'Opening words (said once, first)', d.words.start, (v) => { d.words.start = v; }, { type: 'textarea', rows: 2, wide: true }));
    if (d.type === 'reps') g.appendChild(autoField('prompt', 'The prompt that asks for the movement', (d.prompt || {}).text, (v) => { d.prompt = Object.assign({ id: 'raise' }, d.prompt, { text: v }); }, { wide: true, placeholder: 'Lift your hips' }));
    g.appendChild(field('The starting position, in a line', d.words.position, (v) => { d.words.position = v; }, { wide: true, placeholder: 'On your back, knees bent, feet flat, side on to the phone.' }));
    s.appendChild(g);
    more = details('More words');
    g = grid();
    g.appendChild(field('The end position (the top)', d.words.top, (v) => { d.words.top = v; }, { type: 'textarea', rows: 2, wide: true }));
    g.appendChild(field('How to do it, one step a line', lines(d.words.howto), (v) => { d.words.howto = fromLines(v); }, { type: 'textarea', rows: 4, wide: true }));
    g.appendChild(field('What the camera cannot see', d.words.cannot, (v) => { d.words.cannot = v; }, { type: 'textarea', rows: 2, wide: true }));
    g.appendChild(field('The numbers, explained (About)', d.words.about, (v) => { d.words.about = v; }, { type: 'textarea', rows: 3, wide: true }));
    g.appendChild(field('One line for the card', d.words.hint, (v) => { d.words.hint = v; }, { wide: true }));
    g.appendChild(autoField('lost', 'Nobody in the frame', d.words.lost, (v) => { d.words.lost = v; }));
    if (d.type === 'reps') { g.appendChild(field('The hold at the top is done', d.words.lower, (v) => { d.words.lower = v; })); g.appendChild(field('Down before the hold was done', d.words.early, (v) => { d.words.early = v; })); }
    g.appendChild(field('Into position (blank keeps “That is it — hold”)', d.words.hold, (v) => { d.words.hold = v; }));
    g.appendChild(field('Label for the hold setting', d.words.holdLabel, (v) => { d.words.holdLabel = v; }, { placeholder: d.type === 'reps' ? 'Hold at the top for' : 'Hold the set for' }));
    g.appendChild(field('Safety', d.words.safety, (v) => { d.words.safety = v; }, { type: 'textarea', rows: 2 }));
    g.appendChild(field('Common mistakes', d.words.mistakes, (v) => { d.words.mistakes = v; }, { type: 'textarea', rows: 2 }));
    g.appendChild(field('Easier', d.words.easier, (v) => { d.words.easier = v; }));
    g.appendChild(field('Harder', d.words.harder, (v) => { d.words.harder = v; }));
    more.appendChild(g); s.appendChild(more);
    host.appendChild(s);

    /* 5 — the numbers */
    s = section('The numbers', 'The set and the hold. The edges and thresholds of what is measured are on their cards above.');
    g = grid('tight');
    if (d.type === 'reps') { g.appendChild(field('Reps in a set', d.defaults.repCount, (v) => { d.defaults.repCount = v; }, { type: 'number' })); g.appendChild(field('Hold at the top, seconds', d.defaults.holdTargetSec, (v) => { d.defaults.holdTargetSec = v; }, { type: 'number' })); }
    else g.appendChild(field('Hold the position for, seconds', d.defaults.holdTargetSec, (v) => { d.defaults.holdTargetSec = v; }, { type: 'number' }));
    g.appendChild(field('Sets', d.defaults.setCount, (v) => { d.defaults.setCount = v; }, { type: 'number' }));
    if (d.type === 'hold') g.appendChild(field('Time calls, seconds left', list(d.defaults.callAtSec), (v) => { d.defaults.callAtSec = fromList(v).map(Number).filter((n) => n > 0); }));
    s.appendChild(g);
    more = details('Timing, smoothing, and every number the file has');
    g = grid('tight');
    for (const [k, label] of TIMING) g.appendChild(field(label, d.defaults[k], (v) => { if (v == null) delete d.defaults[k]; else d.defaults[k] = v; }, { type: 'number' }));
    more.appendChild(g);
    more.appendChild(el('p', 'tiny', 'Every number in defaults, as the file has it:'));
    g = grid('tight');
    for (const k of settingKeys()) if (k !== 'callAtSec') g.appendChild(field(k, d.defaults[k], (v) => { if (v == null) delete d.defaults[k]; else d.defaults[k] = v; }, { type: 'number' }));
    more.appendChild(g); s.appendChild(more);
    host.appendChild(s);

    refreshValues();
  }

  /* ================= wiring ================= */
  $('build-copy').onclick = () => { const id = $('move').value; if (Moves[id]) start(Moves[id].spec); };
  $('build-file').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { start(JSON.parse(await f.text())); } catch (err) { $('build-note').textContent = 'Not an exercise file: ' + (err.message || err); }
  };
  $('build-download').onclick = () => {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(fileOf(), null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${draft.id || 'exercise'}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  $('try-live').onclick = () => { if (!draft) return; commit(false); location.href = 'index.html#/ex/' + draft.id; };
  $('build-drop').onclick = drop;
  $('build-apply-json').onclick = () => {
    try { const j = JSON.parse($('build-json').value); start(j, draft ? draft.auto : {}); }
    catch (e) { $('build-note').textContent = 'That is not JSON: ' + (e.message || e); }
  };
  /* the tuned numbers from the Recordings tab, into the draft */
  $('tuned-to-draft').onclick = () => {
    if (!draft || !window.__review) return;
    Object.assign(draft.defaults, window.__review.tuned);
    commit(true);
  };
  window.addEventListener('resize', () => { if (draft) drawMeasure(); });

  /* a draft kept from last time comes back; otherwise the page offers the poses */
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch { kept = null; }
  if (kept) start(kept, kept.auto || {});
  else { renderStart(); $('build-note').textContent = 'No draft. Start from a pose above, or from a copy of an exercise.'; }

  window.__builder = { get draft() { return draft; }, start, fromLibrary, commit, drop, render, figChanged, fromPose, POSES, valueOf, tapped, setKind, get making() { return making; }, keyOfName: (n) => keyOfName(n, figView()) };
});
