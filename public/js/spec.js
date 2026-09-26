/* ---------------------------------------------------------------------------
   An exercise, from its file. Everything the app knows about an exercise is
   one JSON file in public/exercises (see docs/exercise-file.md): what it
   measures, what counts as right, what it says and in what order, how it is
   drawn, and the words around it. This turns such a file into the move the
   coach (core.js), the picture (overlay.js), the Review page (trace.js,
   review.js) and the pages consume — the same shape the moves had when they
   were written by hand, so nothing downstream had to change.

   compile(file, Core)  → the move: read(), judge(), draw(), ready(), and the
                          tables (bands, faults, cues, bones, …)
   check(file)          → problems: [{ level: 'error'|'warn', at, message }]
   blank()              → a starter file for the builder

   Measurements. Each is a named number read from the landmarks each frame:
     angle    the angle at joint b between a and c
     tilt     how far the line from base to top leans off vertical, + the way the body faces
     floor    the angle the line from at to to makes with the floor (90 = plumb)
     bend     how far b sits off the straight line a→c, as the bend at b, + above
     rise     how far b sits above a, as the angle of the a→b line off level, signed
     down     how far the line from→to is lifted from straight down (0 hanging, 90 level)
     distance the distance a→b, as a share of the distance c→d when `per` is given
     sum      the sum of other measurements (`terms`, each with an optional `times`)
   Any of them may carry `offset` (added) and `times` (multiplied first). A
   landmark may be named plainly (the side being measured) or with a side,
   `L.knee` / `R.knee` (a front view). `to` may be a list — the first one the
   model is sure of is used.

   A measurement with a `band` is judged: `good[key]` is whether it is inside,
   and it has a lane on the Review page, a card on the live page and a line on
   the HUD. A band is {lo, hi}, {sym}, {min} or {max}, each naming a key in
   `defaults` (the settings the person can change). One without a band is read
   and smoothed and drawn but never judged — the knee raise's thigh angle,
   which only tells the phases apart.

   Faults come in the file's order, which is the order they are corrected in
   — the chain of cause, not size. Each names its measurement and which side
   of the band it is (`above` or `below`); `requires` names measurements that
   must be good before it is judged; `unless` names faults that silence it.
   `setup` faults are coached at the start position, before the movement is
   asked for. The prompt asks for the movement and is never red.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Spec = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LANDMARKS = ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe'];
  const KINDS = ['angle', 'tilt', 'floor', 'bend', 'rise', 'down', 'distance', 'sum'];
  const REGIONS = ['shoulder', 'arm', 'forearm', 'thigh', 'ham', 'calf', 'chest', 'back', 'abs', 'oblique', 'neck', 'glute'];
  const TONES = ['tick', 'plain', 'up', 'down', 'walking in', 'walking out', 'hold', 'done', 'call'];
  const LOADS = ['none', 'weight', 'band', 'both'];
  const SIDES = ['both', 'left', 'right', 'alternate'];
  const TYPES = ['reps', 'hold'];
  const VIEWS = ['side', 'front'];
  const ORIENTATIONS = ['wide', 'tall'];
  const POSITIONS = ['standing', 'lying', 'sidelying', 'prone', 'kneeling', 'quadruped', 'seated'];
  const PICKS = ['clearest', 'left', 'right', 'highest', 'measure'];
  const DRAWS = ['arc', 'readout', 'plumb', 'floor', 'line'];
  const EDGE = 1e-9;

  /* ---------- the geometry, per kind ---------- */
  /* a landmark name → the point: 'knee' from the side being measured, 'L.knee' from that side */
  function pointOf(name, P, both) {
    if (!name) return null;
    const dot = name.indexOf('.');
    if (dot > 0 && both) { const side = name.slice(0, dot).toUpperCase(); const S = both[side]; return S ? S[name.slice(dot + 1)] || null : null; }
    return P[name] || null;
  }
  /* `to` may be a list of names: the first the model is sure of */
  function resolve(name, P, both, cfg) {
    if (Array.isArray(name)) {
      for (const n of name) { const p = pointOf(n, P, both); if (p && p.v >= cfg.vis) return { p, name: n }; }
      const last = name[name.length - 1];
      return { p: pointOf(last, P, both), name: last };
    }
    return { p: pointOf(name, P, both), name };
  }
  function measure(m, ctx) {
    const { P, both, cfg, facing, Core, values } = ctx;
    const pt = (k) => resolve(m[k], P, both, cfg);
    let x = null, used = {};
    switch (m.kind) {
      case 'angle': { const a = pt('a'), b = pt('b'), c = pt('c'); used = { a: a.name, b: b.name, c: c.name };
        x = a.p && b.p && c.p ? Core.angleAt(a.p, b.p, c.p) : null; break; }
      case 'tilt': { const a = pt('base'), b = pt('top'); used = { base: a.name, top: b.name };
        x = a.p && b.p ? Core.tiltFromVertical(a.p, b.p, facing) : null; break; }
      case 'floor': { const a = pt('at'), b = pt('to'); used = { at: a.name, to: b.name };
        x = a.p && b.p ? Core.fromFloor(a.p, b.p, facing) : null; break; }
      case 'bend': { const a = pt('a'), b = pt('b'), c = pt('c'); used = { a: a.name, b: b.name, c: c.name };
        x = a.p && b.p && c.p ? Core.lineBend(a.p, b.p, c.p, facing) : null; break; }
      case 'rise': { const a = pt('a'), b = pt('b'); used = { a: a.name, b: b.name };
        x = a.p && b.p ? Core.rise(a.p, b.p) : null; break; }
      case 'down': { const a = pt('from'), b = pt('to'); used = { from: a.name, to: b.name };
        x = a.p && b.p ? Core.fromDown(a.p, b.p) : null; break; }
      case 'distance': { const a = pt('a'), b = pt('b'); used = { a: a.name, b: b.name };
        if (a.p && b.p) {
          x = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
          if (m.per) { const c = resolve(m.per[0], P, both, cfg), d = resolve(m.per[1], P, both, cfg); const ref = c.p && d.p ? Math.hypot(c.p.x - d.p.x, c.p.y - d.p.y) : 0; x = ref ? x / ref : null; }
        }
        break; }
      case 'sum': {
        x = 0;
        for (const t of m.terms || []) {
          /* a term is another measurement by key, or a measurement written in place;
             its `times` is applied here, once */
          const v = t.measure != null ? values[t.measure] : measure(Object.assign({}, t, { times: 1, offset: 0 }), ctx).x;
          if (v == null) { x = null; break; }
          x += v * (t.times == null ? 1 : t.times);
        }
        break; }
      default: x = null;
    }
    /* `times` multiplies, `offset` adds; `scale` is the meter's two ends and not this */
    if (x != null) x = x * (m.times == null ? 1 : m.times) + (m.offset || 0);
    return { x, used };
  }

  /* ---------- the compiled move ---------- */
  const bandKind = (b) => (!b ? null : b.sym ? 'sym' : b.min && !b.hi ? 'min' : b.max && !b.lo ? 'max' : 'range');
  function bandEdges(b, cfg) {
    const k = bandKind(b);
    if (k === 'sym') return { lo: -cfg[b.sym], hi: cfg[b.sym] };
    if (k === 'min') return { lo: cfg[b.min], hi: Infinity };
    if (k === 'max') return { lo: -Infinity, hi: cfg[b.max] };
    return { lo: cfg[b.lo], hi: cfg[b.hi] };
  }
  const inside = (x, lo, hi) => x >= lo - EDGE && x <= hi + EDGE;

  function compile(file, Core) {
    const f = file;
    const words = f.words || {}, phone = f.phone || {}, lm = f.landmarks || {};
    const ms = (f.measurements || []).map((m) => Object.assign({}, m));
    const byKey = {}; ms.forEach((m) => { byKey[m.key] = m; });
    /* the reading's name, when it differs from the band's key (the plank's hip is
       read as hipOff and judged as line) */
    const nameOf = (m) => m.of || m.key;
    const banded = ms.filter((m) => m.band);
    const reps = f.type === 'reps';
    const faults = (f.faults || []).map((x) => Object.assign({}, x));
    const prompt = reps ? (f.prompt || { id: 'raise', text: 'Go' }) : null;
    const joints = lm.joints || uniqueLandmarks(f);
    const needed = lm.needed || joints.slice();
    const positionKeys = f.inPosition || banded.map((m) => m.key);
    const alternate = f.sides === 'alternate';

    /* the settings panel's list: each banded measurement's edges, then the move's own */
    const bands = banded.map((m) => {
      const b = Object.assign({ key: m.key, of: nameOf(m), label: m.label || m.key, hud: m.hud || m.key.toUpperCase(), note: m.note || '', scale: m.scale || [0, 180], set: m.settings || [] }, m.band);
      return b;
    });
    const extra = (f.settings || []).slice();

    /* the fault order as the coach wants it: lost, the set-up faults, the prompt, the rest —
       kept in the file's order within each group */
    const setupIds = faults.filter((x) => x.setup).map((x) => x.id);
    const moveIds = faults.filter((x) => !x.setup).map((x) => x.id);
    const order = ['lost'].concat(reps ? setupIds.concat([prompt.id], moveIds) : faults.map((x) => x.id));

    const cues = {};
    for (const x of faults) cues[x.id] = strip({ label: x.label, text: x.text, deep: x.deep, tone: x.tone });
    if (prompt) cues[prompt.id] = strip({ text: prompt.text, tone: prompt.tone });
    cues.lost = { text: words.lost || 'Step into the camera, side on' };
    if (reps) { cues.lower = { text: words.lower || 'Lower slowly' }; cues.early = { text: words.early || 'Hold it at the top next time' }; }
    if (words.hold) cues.hold = { text: words.hold };

    const facingOf = (P, both, cfg) => {
      const d = f.facing;
      if (!d) return 1;
      const a = resolve(d.from, P, both, cfg).p, b = resolve(d.to, P, both, cfg).p;
      return a && b ? (Math.sign(b.x - a.x) || 1) : 1;
    };

    /* the side to measure, and its points */
    const pick = (f.side && f.side.pick) || 'clearest';
    function sides(lmk, aspect, cfg) {
      if (!lmk || lmk.length < 33) return null;
      const both = { L: Core.sidePoints(lmk, aspect, 'L'), R: Core.sidePoints(lmk, aspect, 'R') };
      if (!both.L || !both.R) return null;
      const seen = (P) => needed.every((k) => { const p = pointOf(k, P, both); return p && p.v >= cfg.vis; });
      const vis = (P) => joints.reduce((a, k) => { const p = pointOf(k, P, both); return a + (p ? p.v : 0); }, 0) / Math.max(1, joints.length);
      const opts = ['L', 'R'].map((s) => ({ side: s, P: both[s], ok: seen(both[s]), vis: vis(both[s]) }));
      let chosen;
      if (pick === 'left' || pick === 'right') chosen = [opts[pick === 'left' ? 0 : 1]];
      else chosen = opts;
      const usable = chosen.filter((o) => o.ok);
      if (!usable.length) {
        const best = chosen.slice().sort((a, b) => b.vis - a.vis)[0];
        return { ok: false, side: best.side, vis: best.vis, why: 'Some of you is out of shot or hidden', both };
      }
      let best;
      if (pick === 'highest' && f.side.joint) best = usable.slice().sort((a, b) => ((-pointOf(f.side.joint, b.P, both).y) - (-pointOf(f.side.joint, a.P, both).y)) || (b.vis - a.vis))[0];
      else if (pick === 'measure' && byKey[f.side.measure]) {
        const m = byKey[f.side.measure];
        const val = (o) => measure(m, { P: o.P, both, cfg, facing: facingOf(o.P, both, cfg), Core, values: {} }).x || 0;   // null reads as 0, as a leg not seen lifted
        best = usable.slice().sort((a, b) => (val(b) - val(a)) || (b.vis - a.vis))[0];
      } else best = usable.slice().sort((a, b) => b.vis - a.vis)[0];
      return { ok: true, side: best.side, vis: best.vis, points: best.P, both };
    }

    function read(lmk, aspect, cfg) {
      const s = sides(lmk, aspect, cfg);
      if (!s) return null;
      if (!s.ok) return { ok: false, side: s.side, vis: s.vis, why: s.why };
      const P = s.points, both = s.both;
      const facing = facingOf(P, both, cfg);
      const r = { ok: true, side: s.side, vis: s.vis, points: P, facing, angles: ms.map(nameOf), of: {} };
      const values = {};   // by key, for a sum's terms
      const ctx = { P, both, cfg, facing, Core, values };
      for (const m of ms) { const got = measure(m, ctx); r[nameOf(m)] = got.x; values[m.key] = got.x; r.of[m.key] = got.used; }
      return r;
    }

    const fail = () => Object.assign({ ok: false, inPosition: false, good: {}, faults: {} }, reps ? { raised: false, atStart: false } : {});
    function judge(r, cfg) {
      if (!r || !r.ok) return fail();
      for (const m of banded) if (!m.optional && r[nameOf(m)] == null) return fail();
      const good = {}, on = {};
      for (const m of banded) {
        const x = r[nameOf(m)];
        if (x == null) { good[m.key] = true; continue; }
        const { lo, hi } = bandEdges(m.band, cfg);
        good[m.key] = inside(x, lo, hi);
      }
      for (const x of faults) {
        const m = byKey[x.measure]; if (!m) continue;
        const v = r[nameOf(m)]; if (v == null) continue;
        if (x.requires && !x.requires.every((k) => good[k])) continue;
        if (x.unless && x.unless.some((id) => on[id] != null)) continue;
        const { lo, hi } = bandEdges(m.band, cfg);
        if (x.side === 'above') { if (v > hi) on[x.id] = v - hi; }
        else if (x.side === 'below') { if (v < lo) on[x.id] = lo - v; }
      }
      const v = { ok: true, good, faults: on };
      if (reps) {
        const p = f.progress || {}, pm = byKey[p.measure], x = pm ? r[nameOf(pm)] : null;
        const upAt = cfg[p.raiseAt], downAt = cfg[p.downAt];
        const dir = p.direction === 'down' ? -1 : 1;
        v.raised = x != null && (dir > 0 ? x >= upAt - EDGE : x <= upAt + EDGE);
        v.atStart = x != null && (dir > 0 ? x <= downAt + EDGE : x >= downAt - EDGE);
        v.inPosition = v.raised && positionKeys.every((k) => good[k] !== false);
      } else v.inPosition = positionKeys.every((k) => good[k] !== false);
      return v;
    }

    /* the start position, when the file says what it is */
    let ready = null;
    if (f.ready && (f.ready.ranges || f.ready.atStart != null)) {
      ready = (r, v) => {
        if (f.ready.atStart && !v.atStart) return false;
        for (const [k, range] of Object.entries(f.ready.ranges || {})) { const x = r[byKey[k] ? nameOf(byKey[k]) : k]; if (x == null || x < range[0] || x > range[1]) return false; }
        return true;
      };
    }

    /* what is drawn when the angles are asked for */
    const drawList = f.draw || [];
    function draw(d, r, v) {
      const P = r.points;
      const at = (name) => {
        if (!name) return null;
        const i = String(name).indexOf(':');
        if (i > 0) { const used = r.of[name.slice(0, i)]; const n = used && used[name.slice(i + 1)]; return n ? pointOf(n, P, null) : null; }
        return pointOf(name, P, null);
      };
      const goodOf = (keys) => keys.reduce((a, k) => a && v.good[k], true);
      for (const g of drawList) {
        const m = g.measure ? byKey[g.measure] : null;
        const x = m ? r[nameOf(m)] : null;
        const ok = g.tone === 'none' ? null : m ? (g.goodOf ? goodOf(g.goodOf) : (v.good[m.key] == null ? null : v.good[m.key])) : (g.good ? v.good[g.good] : null);
        if (g.kind === 'plumb') { const p = at(g.at); if (p) d.plumb(p, g.share == null ? 0.3 : g.share); }
        else if (g.kind === 'floor') { const p = at(g.at); if (p) d.floor(p, g.dir || 1); }
        else if (g.kind === 'line') { const a = at(g.from), b = at(g.to); if (a && b) d.guide(a, b, ok); }
        else if (g.kind === 'readout') { const p = at(g.at || (m && (m.b || m.a))); if (p && x != null) d.readout(p, x, ok, g.side === 'sign' ? (x >= 0 ? 1 : -1) : (g.side == null ? 1 : g.side)); }
        else if (g.kind === 'arc' && m && x != null) {
          const raw = (x - (m.offset || 0)) / (m.times == null ? 1 : m.times), size = g.size == null ? 1 : g.size, u = r.of[m.key] || {};
          if (m.kind === 'angle') { const a = at(u.a), b = at(u.b), c = at(u.c); if (a && b && c) d.angleAt(b, a, c, raw, ok, size); }
          else if (m.kind === 'tilt') { const a = at(u.base), b = at(u.top); if (a && b) d.angleTo(a, b, 0, raw, ok, size); }
          else if (m.kind === 'floor') { const a = at(u.at), b = at(u.to); if (a && b) d.angleTo(a, b, r.facing, raw, ok, size); }
          else if (m.kind === 'down') { const a = at(u.from), b = at(u.to); if (a && b) d.angleTo(a, b, 'down', raw, ok, size); }
        }
      }
    }

    const move = {
      v: f.v || 1, id: f.id, name: f.name, order: f.order == null ? 999 : f.order, status: f.status || 'ready',
      category: f.category || '', tags: f.tags || [], equipment: f.equipment || [],
      hint: words.hint || '', start: words.start || '', position: words.position || '', top: words.top || '',
      howto: words.howto || [], cannot: words.cannot || '', about: words.about || '',
      safety: words.safety || '', easier: words.easier || '', harder: words.harder || '', mistakes: words.mistakes || '',
      camera: phone.orientation || 'tall', view: phone.view || 'side', phone,
      bodyPosition: f.position || '', movement: f.movement || '',
      reps, holdLabel: words.holdLabel || (reps ? 'Hold at the top for' : 'Hold the set for'),
      alternate, sides: f.sides || 'both', load: f.load || 'none',
      muscles: f.muscles || {},
      pose: f.figure && f.figure.pose ? f.figure.pose : undefined,
      figure: f.figure && f.figure.points ? f.figure.points : undefined,
      defaults: Object.assign({}, f.defaults || {}),
      extra, joints, needed,
      bones: lm.bones || [], dots: lm.dots || joints.slice(), limb: lm.limb || {},
      bands, measurements: ms,
      faults: order, setup: setupIds, prompts: prompt ? [prompt.id] : [], cues,
      ready, read, judge, draw: drawList.length ? draw : null,
      spec: f,
    };
    return move;
  }
  const strip = (o) => { const out = {}; for (const k of Object.keys(o)) if (o[k] != null && o[k] !== '') out[k] = o[k]; return out; };
  function uniqueLandmarks(f) {
    const out = new Set();
    for (const m of f.measurements || []) for (const k of ['a', 'b', 'c', 'base', 'top', 'at', 'to', 'from']) { const v = m[k]; if (Array.isArray(v)) v.forEach((n) => out.add(n)); else if (v) out.add(v); }
    return [...out];
  }

  /* ---------- the file checked ---------- */
  const isName = (s) => typeof s === 'string' && /^[a-z][a-z0-9]*$/.test(s);
  function check(f) {
    const out = [];
    const err = (at, message) => out.push({ level: 'error', at, message });
    const warn = (at, message) => out.push({ level: 'warn', at, message });
    if (!f || typeof f !== 'object') { err('', 'not an exercise file'); return out; }
    if (!isName(f.id)) err('id', 'one word, lowercase letters and digits, starting with a letter');
    if (!f.name) err('name', 'the exercise needs a name');
    if (!TYPES.includes(f.type)) err('type', 'reps or hold');
    if (f.load && !LOADS.includes(f.load)) err('load', 'one of ' + LOADS.join(', '));
    if (f.sides && !SIDES.includes(f.sides)) err('sides', 'one of ' + SIDES.join(', '));
    if (f.position && !POSITIONS.includes(f.position)) warn('position', 'one of ' + POSITIONS.join(', '));
    const phone = f.phone || {};
    if (!ORIENTATIONS.includes(phone.orientation)) err('phone.orientation', 'wide (on its side) or tall (stood up)');
    if (phone.view && !VIEWS.includes(phone.view)) err('phone.view', 'side or front');
    const words = f.words || {};
    if (!words.start) err('words.start', 'the opening words: where the phone goes and what position to take');
    else if (words.start.length > 160) warn('words.start', 'long for an opening: the coach waits for it to finish before saying anything else');
    if (!words.position) warn('words.position', 'the starting position, in words, for the set-up card');
    if (!words.howto || !words.howto.length) warn('words.howto', 'how to do it, step by step');
    if (!words.cannot) warn('words.cannot', 'what the camera cannot see');
    const defaults = f.defaults || {};
    const ms = f.measurements || [];
    if (!ms.length) err('measurements', 'at least one measurement');
    const keys = new Set();
    const lmOk = (n) => { if (Array.isArray(n)) return n.every(lmOk); if (typeof n !== 'string') return false; const dot = n.indexOf('.'); const base = dot > 0 ? n.slice(dot + 1) : n; return LANDMARKS.includes(base) && (dot <= 0 || ['L', 'R', 'l', 'r'].includes(n.slice(0, dot))); };
    const NEED = { angle: ['a', 'b', 'c'], tilt: ['base', 'top'], floor: ['at', 'to'], bend: ['a', 'b', 'c'], rise: ['a', 'b'], down: ['from', 'to'], distance: ['a', 'b'], sum: [] };
    ms.forEach((m, i) => {
      const at = `measurements[${i}]`;
      if (!isName(m.key)) err(at + '.key', 'one word, lowercase');
      else if (keys.has(m.key)) err(at + '.key', 'used twice: ' + m.key); else keys.add(m.key);
      if (!KINDS.includes(m.kind)) { err(at + '.kind', 'one of ' + KINDS.join(', ')); return; }
      for (const k of NEED[m.kind]) if (!lmOk(m[k])) err(`${at}.${k}`, 'a landmark: ' + LANDMARKS.join(', '));
      if (m.kind === 'sum') { if (!Array.isArray(m.terms) || !m.terms.length) err(at + '.terms', 'the measurements to add'); }
      if (m.band) {
        const b = m.band, kind = bandKind(b);
        const refs = kind === 'sym' ? [b.sym] : kind === 'min' ? [b.min] : kind === 'max' ? [b.max] : [b.lo, b.hi];
        for (const key of refs) if (key == null || typeof defaults[key] !== 'number') err(at + '.band', `names a setting that is not in defaults: ${key}`);
        if (!Array.isArray(m.scale) || m.scale.length !== 2) err(at + '.scale', 'the meter\'s two ends, low and high');
        if (!m.label) warn(at + '.label', 'words for the reading, for the live page');
        if (!m.hud) warn(at + '.hud', 'a short name for the picture, in capitals');
        for (const s of m.settings || []) { if (typeof defaults[s.key] !== 'number') err(at + '.settings', `a setting with no default: ${s.key}`); if (s.min == null || s.max == null) err(at + '.settings', `${s.key} needs min and max`); }
        const setKeys = new Set((m.settings || []).map((s) => s.key));
        for (const key of refs) if (!setKeys.has(key)) warn(at + '.settings', `the edge ${key} is not among the settings, so it cannot be tuned`);
      }
    });
    for (const s of f.settings || []) if (typeof defaults[s.key] !== 'number') err('settings', `a setting with no default: ${s.key}`);
    const ids = new Set(['lost']);
    (f.faults || []).forEach((x, i) => {
      const at = `faults[${i}]`;
      if (!x.id || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(x.id)) err(at + '.id', 'one word'); else if (ids.has(x.id)) err(at + '.id', 'used twice: ' + x.id); else ids.add(x.id);
      const m = ms.find((mm) => mm.key === x.measure);
      if (!m) err(at + '.measure', 'not a measurement: ' + x.measure); else if (!m.band) err(at + '.measure', `${x.measure} has no band, so nothing is above or below it`);
      if (!['above', 'below'].includes(x.side)) err(at + '.side', 'above or below the band');
      if (!x.text) err(at + '.text', 'the spoken words');
      if (!x.label) err(at + '.label', 'short words for the picture'); else if (x.label.length > 26) err(at + '.label', 'short means 26 characters at most');
      if (x.tone && !TONES.includes(x.tone)) warn(at + '.tone', 'one of ' + TONES.join(', '));
      for (const k of x.requires || []) if (!keys.has(k)) err(at + '.requires', 'not a measurement: ' + k);
      if (m && m.band) { const kind = bandKind(m.band); if ((kind === 'min' && x.side === 'above') || (kind === 'max' && x.side === 'below')) warn(at + '.side', `${x.measure}'s band has no edge on that side`); }
    });
    for (const x of f.faults || []) for (const u of x.unless || []) if (!ids.has(u)) err('faults', `unless names a fault that is not there: ${u}`);
    if (f.type === 'reps') {
      const p = f.progress || {};
      if (!keys.has(p.measure)) err('progress.measure', 'the measurement that says how far into the rep the person is');
      for (const k of ['raiseAt', 'downAt']) if (typeof defaults[p[k]] !== 'number') err('progress.' + k, 'names a setting in defaults');
      if (!f.prompt || !f.prompt.text) err('prompt', 'the words that ask for the movement');
      if (typeof defaults.repCount !== 'number') warn('defaults.repCount', 'reps in a set, 10 unless said');
      if (typeof defaults.holdTargetSec !== 'number') warn('defaults.holdTargetSec', 'the hold at the top, in seconds');
    } else {
      if (typeof defaults.holdTargetSec !== 'number') warn('defaults.holdTargetSec', 'the hold, in seconds (60 unless said)');
    }
    if (f.ready && f.ready.ranges) for (const k of Object.keys(f.ready.ranges)) if (!keys.has(k)) err('ready.ranges', 'not a measurement: ' + k);
    for (const k of f.inPosition || []) if (!keys.has(k)) err('inPosition', 'not a measurement: ' + k);
    const lm = f.landmarks || {};
    for (const k of lm.joints || []) if (!lmOk(k)) err('landmarks.joints', 'not a landmark: ' + k);
    for (const k of lm.needed || []) if (!lmOk(k)) err('landmarks.needed', 'not a landmark: ' + k);
    for (const b of lm.bones || []) if (!Array.isArray(b) || b.length !== 2 || !lmOk(b[0]) || !lmOk(b[1])) err('landmarks.bones', 'each bone is two landmarks');
    for (const [bone, key] of Object.entries(lm.limb || {})) if (!keys.has(key)) err('landmarks.limb', `${bone} is coloured by a measurement that is not there: ${key}`);
    if (!lm.bones || !lm.bones.length) warn('landmarks.bones', 'no skeleton to draw');
    if (f.facing && (!lmOk(f.facing.from) || !lmOk(f.facing.to))) err('facing', 'two landmarks: the body faces from the first toward the second');
    if (!f.facing) warn('facing', 'which way the body faces: needed by tilt, floor and bend measurements');
    const side = f.side || {};
    if (side.pick && !PICKS.includes(side.pick)) err('side.pick', 'one of ' + PICKS.join(', '));
    if (side.pick === 'highest' && !lmOk(side.joint)) err('side.joint', 'the landmark whose higher side is measured');
    if (side.pick === 'measure' && !keys.has(side.measure)) err('side.measure', 'the measurement whose larger side is measured');
    (f.draw || []).forEach((g, i) => {
      const at = `draw[${i}]`;
      if (!DRAWS.includes(g.kind)) err(at + '.kind', 'one of ' + DRAWS.join(', '));
      if ((g.kind === 'arc' || g.kind === 'readout') && !keys.has(g.measure)) err(at + '.measure', 'not a measurement: ' + g.measure);
      if (g.good && !keys.has(g.good)) err(at + '.good', 'not a measurement: ' + g.good);
    });
    for (const k of Object.keys(f.muscles || {})) if (!REGIONS.includes(k)) err('muscles', 'not a region the figure knows: ' + k);
    if (!f.muscles || !Object.keys(f.muscles).length) warn('muscles', 'what works, for the muscle figure');
    if (!f.figure || (!f.figure.pose && !f.figure.points)) warn('figure', 'no figure: the exercise page has nothing to animate');
    return out;
  }

  /* ---------- a starter ---------- */
  function blank() {
    return {
      v: 1, id: 'newmove', name: 'New exercise', order: 99, status: 'draft', category: '', tags: [], equipment: [],
      type: 'reps', position: 'standing', movement: '', sides: 'both', load: 'none',
      phone: { orientation: 'tall', view: 'side', placement: 'Stand the phone up on the floor, two or three metres away, side on to where you will be.' },
      words: { hint: '', start: 'Stand the phone up on the floor, then step into the frame, side on.', position: '', top: '', howto: [], cannot: '', about: '', lost: 'Step into the camera, side on', lower: 'Lower slowly', early: 'Hold it at the top next time' },
      muscles: {},
      facing: { from: 'hip', to: 'knee' },
      side: { pick: 'clearest' },
      landmarks: { joints: ['shoulder', 'hip', 'knee', 'ankle'], needed: ['shoulder', 'hip', 'knee', 'ankle'], bones: [['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle']], dots: ['shoulder', 'hip', 'knee', 'ankle'], limb: { 'hip|knee': 'knee', 'knee|ankle': 'knee' } },
      measurements: [
        { key: 'knee', label: 'knee angle', hud: 'KNEE', note: 'target', kind: 'angle', a: 'hip', b: 'knee', c: 'ankle', band: { lo: 'kneeMin', hi: 'kneeMax' }, scale: [40, 180],
          settings: [{ key: 'kneeMin', label: 'Knee angle, lowest', min: 30, max: 175 }, { key: 'kneeMax', label: 'Knee angle, highest', min: 35, max: 180 }] },
      ],
      progress: { measure: 'knee', raiseAt: 'raiseAt', downAt: 'downAt', direction: 'down' },
      prompt: { id: 'raise', text: 'Bend your knees' },
      faults: [
        { id: 'kneeOpen', measure: 'knee', side: 'above', label: 'Not low enough', text: 'Bend your knees more', deep: 'Lower — bend your knees further', tone: 'down' },
        { id: 'kneeShut', measure: 'knee', side: 'below', label: 'Too deep', text: 'Not so deep', deep: 'Come up — that is too deep', tone: 'up' },
      ],
      draw: [{ kind: 'arc', measure: 'knee', size: 1 }],
      defaults: { kneeMin: 80, kneeMax: 100, raiseAt: 120, downAt: 160, holdTargetSec: 2, callAtSec: [], repCount: 10, setCount: 3, lowerSec: 1, restSec: 2, deepAt: 10 },
      settings: [{ key: 'repCount', label: 'Reps in a set', min: 1, max: 50 }, { key: 'raiseAt', label: 'Knee angle that counts as down', min: 60, max: 170 }, { key: 'lowerSec', label: 'Lowering takes at least, seconds', min: 0, max: 10 }, { key: 'restSec', label: 'Quiet after a rep, seconds', min: 0, max: 10 }, { key: 'setCount', label: 'Sets', min: 1, max: 10 }],
      figure: { pose: { A: { torso: 0, thigh: 0, shin: 0, uarm: 8, farm: 8 }, B: { torso: 20, thigh: 70, shin: -30, uarm: 60, farm: 60 } } },
    };
  }

  return { compile, check, blank, measure, bandKind, bandEdges, LANDMARKS, KINDS, REGIONS, TONES, LOADS, SIDES, TYPES, VIEWS, ORIENTATIONS, POSITIONS, PICKS, DRAWS };
});
