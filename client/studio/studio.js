/* ============================================================
   Grooveform Studio — where a physio turns a move into a spec.

   Screen → Describe → Record takes → pick the progress measure →
   write faults as numbers and see them fire on the takes → guide →
   export. Everything stays in the browser: specs in localStorage,
   takes (landmark streams + optional video) in IndexedDB. One
   "session file" carries a whole afternoon's work to the build side.
   ============================================================ */
(function () {
  'use strict';
  const E = window.FormEngine, LIB = window.ExerciseLibrary, SPEC = window.MoveSpec, ANAT = window.FyzioAnatomy, C = window.FyzioCatalog;
  const K = LIB.kinematics;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MP_VER = '0.10.21';
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
  const MOCK = new URLSearchParams(location.search).get('mock') === '1';

  /* ---------- toast ---------- */
  let toastT = 0;
  function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }
  function say(text) { try { if (!('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { } }

  /* ---------- storage ---------- */
  const LS = 'grooveform.studio';
  function loadState() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
  function saveState() { try { localStorage.setItem(LS, JSON.stringify({ moves: state.moves, current: state.current, step: state.step, pt: state.pt })); } catch (e) { toast('Could not save: ' + e.message); } }

  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('grooveform-studio', 1);
        r.onupgradeneeded = () => { const s = r.result.createObjectStore('takes', { keyPath: 'id' }); s.createIndex('move', 'moveId'); };
        r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('takes', mode); const out = fn(t.objectStore('takes')); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); },
    put(take) { return this.tx('readwrite', (s) => s.put(take)); },
    del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
    async forMove(moveId) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('takes').objectStore('takes').index('move').getAll(moveId); q.onsuccess = () => res(q.result.sort((a, b) => a.created - b.created)); q.onerror = () => rej(q.error); }); },
    async all() { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('takes').objectStore('takes').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  };

  /* ---------- state ---------- */
  const saved = loadState();
  const state = { moves: saved.moves || {}, current: saved.current || null, step: saved.step || 'screen', pt: saved.pt || { name: '' }, takes: [], sims: {}, model: null };
  const uid = () => Math.random().toString(36).slice(2, 10);

  function blankSpec() {
    return {
      id: '', name: '', clinicalName: '', group: '', type: 'reps', view: 'front', ptType: 'A', sided: null, upperBody: false, icon: '',
      screen: {}, camera: { height: 'chest', distance: '2.5 m' },
      summary: '', setup: '', why: '', band: false, options: [],
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      calibrationPose: '',
      progress: { metric: { kind: 'angle', pts: [] }, start: 'calibrated', target: 90, targetIsDelta: false },
      hold: { conditions: [{ metric: { kind: 'angle', pts: [] }, min: null, max: null, rel: 'abs' }] },
      faults: [],
      guide: { surface: '', cannotSee: '', stop: '', regions: [{ name: 'Trunk & pelvis', points: [] }, { name: 'Working limb', points: [] }] },
      dosage: '', progression: '', regression: '', notes: '', muscles: {}, figure: null, order: 500,
      tracking: 'form', level: 'beginner', equipmentText: 'none', muscleNames: { primary: [], secondary: [] }, tempo: '', contraindications: '', sourcesText: '',
      created: Date.now(),
    };
  }
  /* ---------- catalogue ⇄ Studio draft ----------
     A catalogue move (client/data/moves/<file>.json) opens in the Studio as a draft with every field
     filled, and a draft goes back as one entry in that file. The Studio's own fields (screen answers,
     PT type, notes) travel in the entry under "_studio", which the loader ignores. */
  const SHARED = () => (C.data && C.data.shared) || { measurements: {}, faults: {}, poses: {}, holds: {} };
  const SETTINGS = () => (C.data && C.data.settings) || E.settings;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const listText = (a) => (a || []).join(', ');
  const listFrom = (t) => String(t || '').split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
  const linesFrom = (t) => String(t || '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
  function entryToSpec(ex) {
    const raw = ex.entry; const r = C.resolveEntry(raw, SHARED(), ex.id); const st = SETTINGS();
    const s = blankSpec();
    const grpCam = (C.data.files.find((f) => f.name === 'moves/' + ex.file) || { json: {} }).json.camera;
    Object.assign(s, {
      _fileCamera: grpCam ? { ...grpCam } : null,
      id: ex.id, name: ex.name, clinicalName: r.clinicalName || '', group: ex.group, type: ex.type, view: ex.view, sided: r.sided ? { ...r.sided } : null, upperBody: !!r.upperBody, icon: r.icon || '',
      camera: { ...(ex.camera || s.camera) }, summary: ex.summary, setup: ex.setup, why: ex.why, calibrationPose: r.calibrationPose || '',
      band: r.band === undefined ? false : r.band, options: (r.options || []).map((o) => ({ ...o })), targets: ex.targets.slice(), defaultTarget: ex.defaultTarget,
      tracking: ex.tracking, level: r.level || 'beginner', equipmentText: (ex.equipment || []).join('\n'), muscleNames: { primary: [...((r.muscles || {}).primary || [])], secondary: [...((r.muscles || {}).secondary || [])] },
      tempo: r.tempo || '', dosage: r.dosage || '', progression: r.progression || '', regression: r.regression || '', contraindications: r.contraindications || '',
      sourcesText: (raw.sources || []).map((x) => x.url ? x.name + ' | ' + x.url : x.name).join('\n'),
      muscles: { ...((raw.pose && raw.pose.work) || {}) }, pose: raw.pose ? JSON.parse(JSON.stringify(raw.pose)) : null, figure: raw.figure || null,
      minMs: r.minMs, focus: r.focus, order: raw.order, vetted: !!r.vetted,
      _file: ex.file, _replaces: ex.id, _key: ex.id, created: Date.now(),
      _inherited: { camera: !raw.camera, targets: !raw.targets, cannotSee: !(raw.guide && raw.guide.cannotSee), level: !raw.level, equipment: !raw.equipment },
    });
    if (r.progress) s.progress = { targetIsDelta: false, ...r.progress };
    if (r.display) s.display = { ...r.display }; if (r.enterCue) s.enterCue = r.enterCue;
    if (r.hold) s.hold = { conditions: r.hold.conditions.map((c) => ({ rel: 'abs', min: null, max: null, ...c })) };
    s.faults = r.faults.map((f) => f.rule ? { ...f } : ({ invalidates: false, ...f, listed: !f.metric, metric: f.metric || { kind: 'angle', pts: [] }, rel: f.rel || 'abs', op: f.op || '>', threshold: f.threshold ?? null, minP: f.minP ?? 0, persist: f.persist || st.fault.persist, severity: f.severity || 2 }));
    s.guide = { surface: '', cannotSee: '', stop: '', ...JSON.parse(JSON.stringify(r.guide || {})) };
    if (!Array.isArray(s.guide.regions) || !s.guide.regions.length) s.guide.regions = [{ name: 'Trunk & pelvis', points: [] }];
    if (!s.guide.cannotSee) s.guide.cannotSee = (ex.guide && ex.guide.cannotSee) || '';   /* the file's default line, so an entry that leaves it out reads the same here */
    if (raw._studio) { const m = raw._studio; s.screen = m.screen || {}; s.ptType = m.ptType || s.ptType; s.notes = m.notes || ''; if (m.tuned) s._tuned = m.tuned; }
    return s;
  }
  /* fold a value back to its name in shared.json, so the file stays as tidy as a hand-written one */
  const foldMetric = (m) => { for (const [n, v] of Object.entries(SHARED().measurements)) if (same(v, m)) return n; return m; };
  function foldFault(f) {
    const out = { ...f };
    if (out.metric) out.metric = foldMetric(out.metric);
    for (const [name, T] of Object.entries(SHARED().faults)) {
      const keys = ['label', 'cue', 'tip', 'severity', 'metric', 'op', 'rel'];
      if (!keys.every((k) => same(out[k], T[k]))) continue;
      const r = { template: name };
      for (const k of Object.keys(out)) if (!keys.includes(k) && !same(out[k], T[k])) r[k] = out[k];
      if (T.threshold === undefined && r.threshold === undefined) r.threshold = out.threshold;
      return r;
    }
    return out;
  }
  const isLive = (f) => !f.listed && f.metric && f.metric.pts.length >= ((SPEC.KINDS[f.metric.kind] || {}).n || 0) && Number.isFinite(f.threshold);
  function specToEntry(s) {
    const e = {};
    const put = (k, v) => { if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return; if (v && typeof v === 'object' && !Array.isArray(v)) for (const kk of Object.keys(v)) if (v[kk] === undefined) delete v[kk]; e[k] = v; };
    put('id', s.id); put('name', s.name); put('clinicalName', s.clinicalName); put('type', s.type); put('view', s.view); put('tracking', s.tracking || 'form');
    if (s.vetted) put('vetted', true);
    const inh = s._inherited || {}; const st = SETTINGS();
    if (!(inh.level && s.level === 'beginner')) put('level', s.level);
    if (!inh.equipment || linesFrom(s.equipmentText).length) put('equipment', linesFrom(s.equipmentText).length ? linesFrom(s.equipmentText) : ['none']);
    put('muscles', { primary: (s.muscleNames || {}).primary || [], secondary: (s.muscleNames || {}).secondary || [] });
    if (s.sided) put('sided', { limb: s.sided.limb, by: s.sided.by, ...(s.sided.auto ? { auto: true } : {}) });
    if (s.upperBody) put('upperBody', true);
    put('summary', s.summary); put('setup', s.setup); put('why', s.why); put('calibrationPose', s.calibrationPose);
    if (!(inh.camera && s._fileCamera && same(s.camera, s._fileCamera))) put('camera', s.camera);
    const dt = st.targets[s.type] || {}; if (!(inh.targets && same(s.targets, dt.choices) && s.defaultTarget === dt.default)) { put('targets', s.targets); put('defaultTarget', s.defaultTarget); }
    put('icon', s.icon);
    if (s.options && s.options.length) put('options', s.options);
    if (s.band !== false && s.band !== undefined) put('band', s.band);
    if (s.minMs) put('minMs', s.minMs); if (s.focus) put('focus', s.focus);
    const tracked = s.tracking !== 'none';
    if (tracked && s.type === 'reps' && s.progress && s.progress.metric.pts.length) { const p = { metric: foldMetric(s.progress.metric), start: s.progress.start }; if (Number.isFinite(s.progress.startMin)) p.startMin = s.progress.startMin; if (Number.isFinite(s.progress.startMax)) p.startMax = s.progress.startMax; p.target = s.progress.target; if (s.progress.targetIsDelta) p.targetIsDelta = true; if (s.progress.delta === -1) p.delta = -1; put('progress', p); }
    if (tracked && s.type === 'hold' && s.hold) { const cs = s.hold.conditions.filter((c) => c.metric.pts.length >= ((SPEC.KINDS[c.metric.kind] || {}).n || 0)).map((c) => { const o = { metric: foldMetric(c.metric) }; if (c.rel === 'change') o.rel = 'change'; if (Number.isFinite(c.min)) o.min = c.min; if (Number.isFinite(c.max)) o.max = c.max; if (c.when && c.when.length) o.when = c.when; return o; }); if (cs.length) { let named = null; for (const [n, v] of Object.entries(SHARED().holds)) if (same(v, cs)) named = n; put('hold', { conditions: named || cs }); } }
    put('faults', (s.faults || []).map((f) => {
      const base = { id: f.id, label: f.label, cue: f.cue, tip: f.tip, severity: +f.severity || 2 };
      if (f.rule) return { ...base, rule: f.rule, ...(f.rule === 'fast' ? { minMs: f.minMs } : f.rule === 'return' && Number.isFinite(f.threshold) ? { threshold: f.threshold } : {}) };
      if (!tracked || !isLive(f)) return base;
      const o = { ...base, metric: f.metric }; if (f.rel === 'change') o.rel = 'change'; o.op = f.op; o.threshold = f.threshold;
      if (f.scale && f.scale.times) o.scale = f.scale;
      if (f.minP != null && f.minP !== 0) o.minP = f.minP; if (f.persist && f.persist !== st.fault.persist) o.persist = f.persist; if (f.cooldown && f.cooldown !== st.fault.cooldown) o.cooldown = f.cooldown; if (f.phase && (s.type !== 'hold' || f.phase === 'any')) o.phase = f.phase;
      const when = (f.when || []).filter((w) => typeof w === 'string' || w.option !== undefined || (w.metric && w.metric.pts.length >= ((SPEC.KINDS[w.metric.kind] || {}).n || 0) && Number.isFinite(w.threshold))).map((w) => typeof w === 'string' || w.option !== undefined ? w : { metric: foldMetric(w.metric), ...(w.rel === 'change' ? { rel: 'change' } : {}), op: w.op, threshold: w.threshold });
      if (when.length) o.when = when; if (f.invalidates) o.invalidates = true;
      return foldFault(o);
    }));
    put('guide', { surface: s.guide.surface, stop: s.guide.stop, cannotSee: inh.cannotSee && s.guide.cannotSee === st.cannotSee ? undefined : s.guide.cannotSee, regions: (s.guide.regions || []).filter((r) => r.name && r.points.some((p) => p.t)).map((r) => ({ name: r.name, points: r.points.filter((p) => p.t).map((p) => ({ t: p.t, tracked: !!p.tracked })) })) });
    if (s.display && Object.keys(s.display).length) put('display', s.display); put('enterCue', s.enterCue);
    if (s.pose) { const pose = JSON.parse(JSON.stringify(s.pose)); if (Object.keys(s.muscles || {}).length) pose.work = { ...s.muscles }; put('pose', pose); }
    else if (s.figure) put('figure', { ...s.figure, w: { ...(s.muscles || {}) } });
    if (s.vetted) e.vetted = true;
    put('tempo', s.tempo); put('dosage', s.dosage); put('progression', s.progression); put('regression', s.regression); put('contraindications', s.contraindications);
    const sources = listFrom(s.sourcesText.replace(/\n/g, ',')).map((line) => { const [name, url] = line.split('|').map((x) => x.trim()); return url ? { name, url } : { name }; });
    put('sources', sources);
    if (s.order && s.order !== 500) put('order', s.order);
    e._studio = { screen: s.screen || {}, ptType: s.ptType, notes: s.notes || '', edited: new Date().toISOString().slice(0, 10), by: state.pt.name || undefined, ...(s._tuned ? { tuned: s._tuned } : {}) };
    return e;
  }
  /* the file this draft belongs in, with the draft in it (replacing the move it was opened from) */
  const fileNames = () => (C.data ? C.data.manifest.moves : []).map((p) => p.replace(/^moves\//, '').replace(/\.json$/, ''));
  function targetFileName(s) { if (s._file) return s._file.replace(/^moves\//, '').replace(/\.json$/, ''); const byGroup = (C.data ? C.data.files : []).find((f) => f.json.group === s.group); return byGroup ? byGroup.name.replace(/^moves\//, '').replace(/\.json$/, '') : (fileNames()[0] || 'knee'); }
  function fileWith(s, name) {
    const rel = 'moves/' + name + '.json';
    const existing = C.data.files.find((f) => f.name === rel);
    const json = existing ? JSON.parse(JSON.stringify(existing.json)) : { _about: (C.data.files[0] || { json: {} }).json._about, region: name, group: s.group || name, order: 2000 + fileNames().length * 100, camera: s.camera, sources: [], moves: [] };
    const entry = specToEntry(s);
    if (s.group && s.group !== json.group) entry.group = s.group;
    const i = json.moves.findIndex((m) => m.id === (s._replaces || s.id) || m.id === s.id);
    if (i >= 0) json.moves[i] = entry; else json.moves.push(entry);
    return { rel, json, entry, isNew: !existing };
  }
  function catalogProblems(s, name) {
    if (!C.data) return ['the library has not loaded'];
    try { const { rel, json } = fileWith(s, name); const others = C.data.files.filter((f) => f.name !== rel).flatMap((f) => f.json.moves.map((m) => m.id)); return C.checkFile(json, rel, C.data, others); }
    catch (e) { return [e.message]; }
  }
  const builtin = (id) => LIB.get(id);
  const isBuiltin = (id) => !!builtin(id) && !state.moves[id];
  function cur() { return state.current ? state.moves[state.current] || null : null; }

  /* ---------- exercise object for the current move (spec-compiled or built-in) ---------- */
  function currentExercise() {
    const s = cur();
    if (!s) return state.current ? builtin(state.current) : null;
    try { return SPEC.compile(JSON.parse(JSON.stringify(s)), K, { lenient: true }); } catch (e) { return null; }
  }

  /* ---------- simulation: run the engine over a recorded take ---------- */
  function simulate(ex, take) {
    if (!ex || !take || !take.frames.length) return null;
    const smoother = new E.PoseSmoother();
    const work = ex.sided && ex.sided.by === 'pick' ? take.side : null;
    const opts = { target: 999, work };
    for (const o of ex.options || []) if (opts[o.key] === undefined) opts[o.key] = o.default;
    const session = new E.SetSession(ex, opts);
    const aspect = take.aspect || 16 / 9;
    const toPts = (lm) => lm.map((l) => ({ x: l[0], y: l[1], z: l[2], visibility: l[3] }));
    const out = { p: [], values: [], active: [], reps: [], faultSpans: {}, faultFrames: {}, calT: null, frames: 0, lost: 0 };
    const CAL_AT = take.calT ?? 1200;
    let calibrated = false; const open = {};
    for (const fr of take.frames) {
      const t = fr[0], lm = fr[1]; out.frames++;
      const pts = lm ? smoother.update(toPts(lm), t, aspect) : null;
      if (!pts) { out.lost++; continue; }
      if (!calibrated) { if (t < CAL_AT) continue; session.calibrate(pts, take.side || 'L'); calibrated = true; out.calT = t; }
      const r = session.step(pts, t);
      const m = r.m || {};
      out.p.push([t, m.p ?? 0]); out.values.push([t, m.v ?? m.value ?? (m.inPosition ? 1 : 0)]);
      if (r.repEvent) out.reps.push({ t, full: r.repEvent.full, rep: r.repEvent.rep });
      for (const f of ex.faults) {
        if (f.onRep) continue;
        const on = session.faults.active.has(f.id);
        if (on) { out.faultFrames[f.id] = (out.faultFrames[f.id] || 0) + 1; if (open[f.id] == null) open[f.id] = t; }
        else if (open[f.id] != null) { (out.faultSpans[f.id] = out.faultSpans[f.id] || []).push([open[f.id], t]); open[f.id] = null; }
      }
      out.active.push([t, [...session.faults.active]]);
    }
    for (const id in open) if (open[id] != null) (out.faultSpans[id] = out.faultSpans[id] || []).push([open[id], take.frames[take.frames.length - 1][0]]);
    out.session = session; out.review = calibrated ? session.review() : null;
    out.repFaults = {}; for (const r of out.reps) for (const id of r.rep.faults) out.repFaults[id] = (out.repFaults[id] || 0) + 1;
    out.full = out.reps.filter((r) => r.full).length; out.partial = out.reps.length - out.full;
    out.holdMs = session.holdMs; out.durationMs = take.frames.length ? take.frames[take.frames.length - 1][0] : 0;
    return out;
  }
  /* Raw metric trace (no engine) — used to suggest thresholds and to plot a metric before it is wired into a rule. */
  /* The option values a draft would run with (its defaults), for measurements that flip on an option. */
  function draftOpts(s) { const o = {}; for (const opt of (s && s.options) || []) o[opt.key] = opt.default; return o; }
  function trace(metric, take, S, opts) {
    const smoother = new E.PoseSmoother(); const aspect = take.aspect || 16 / 9; const out = []; const side = S || take.side || 'L';
    const calT = take.calT ?? 1200; let ref = null; opts = opts || draftOpts(cur());
    for (const fr of take.frames) {
      if (!fr[1]) continue;
      const pts = smoother.update(fr[1].map((l) => ({ x: l[0], y: l[1], z: l[2], visibility: l[3] })), fr[0], aspect);
      if (!pts) continue;
      if (!ref && fr[0] >= calT) { try { ref = SPEC.calibrateRef([metric], pts, K, opts); } catch { } }   /* the still frame: reference lengths, baselines */
      try { out.push([fr[0], SPEC.evalMetric(metric, pts, side, K, ref, opts)]); } catch { }
    }
    return out;
  }
  function resim() { const ex = currentExercise(); state.sims = {}; if (!ex) return; for (const t of state.takes) { try { state.sims[t.id] = simulate(ex, t); } catch (e) { state.sims[t.id] = { error: e.message }; } } }
  const pct = (arr, q) => { if (!arr.length) return NaN; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]; };
  const labelOf = (t) => t.label.startsWith('fault:') ? 'fault' : t.label;
  const median = (a) => pct(a, 0.5);

  /* ---------- charts ---------- */
  const COLORS = { clean: '#4f9a1e', fault: '#ff2e88', borderline: '#ffb830', setup: '#7a3fb8', other: '#5a3f78' };
  function drawChart(canvas, series, { lines = [], spans = [], yLabel = '', y0 = null, y1 = null, marks = [] } = {}) {
    const dpr = Math.min(2, devicePixelRatio || 1); const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, padL = 44, padR = 10, padT = 12, padB = 22;
    ctx.clearRect(0, 0, W, H);
    let tmax = 1, vmin = Infinity, vmax = -Infinity;
    for (const s of series) for (const [t, v] of s.data) { tmax = Math.max(tmax, t); if (Number.isFinite(v)) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); } }
    for (const l of lines) if (Number.isFinite(l.y)) { vmin = Math.min(vmin, l.y); vmax = Math.max(vmax, l.y); }
    if (!Number.isFinite(vmin)) { vmin = 0; vmax = 1; }
    if (y0 !== null) vmin = Math.min(vmin, y0); if (y1 !== null) vmax = Math.max(vmax, y1);
    if (vmax - vmin < 1e-6) { vmax += 1; vmin -= 1; }
    const padV = (vmax - vmin) * 0.08; vmin -= padV; vmax += padV;
    const X = (t) => padL + (t / tmax) * (W - padL - padR), Y = (v) => padT + (1 - (v - vmin) / (vmax - vmin)) * (H - padT - padB);
    const css = getComputedStyle(canvas); const ink = css.getPropertyValue('--text').trim() || '#2b1546', mutedC = css.getPropertyValue('--muted').trim() || '#5a3f78';
    ctx.font = '11px Nunito, sans-serif'; ctx.fillStyle = mutedC; ctx.strokeStyle = 'rgba(128,128,128,.25)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const v = vmin + (vmax - vmin) * i / 4; const y = Y(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(v.toFixed(Math.abs(vmax - vmin) < 5 ? 2 : 0), 4, y + 4); }
    for (let s = 0; s <= tmax / 1000; s += Math.max(1, Math.ceil(tmax / 1000 / 8))) { const x = X(s * 1000); ctx.fillText(s + 's', x - 6, H - 6); }
    if (yLabel) { ctx.fillText(yLabel, padL + 4, padT + 10); }
    for (const sp of spans) { ctx.fillStyle = sp.color || 'rgba(255,46,136,.18)'; ctx.fillRect(X(sp.t0), padT, Math.max(2, X(sp.t1) - X(sp.t0)), H - padT - padB); }
    for (const l of lines) { if (!Number.isFinite(l.y)) continue; ctx.save(); ctx.setLineDash(l.dash || [6, 4]); ctx.strokeStyle = l.color || ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padL, Y(l.y)); ctx.lineTo(W - padR, Y(l.y)); ctx.stroke(); ctx.restore(); ctx.fillStyle = l.color || ink; ctx.fillText(l.label || '', W - padR - 80, Y(l.y) - 3); }
    for (const s of series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6; ctx.globalAlpha = s.alpha ?? 0.9; ctx.beginPath(); let started = false;
      for (const [t, v] of s.data) { if (!Number.isFinite(v)) { started = false; continue; } const x = X(t), y = Y(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const m of marks) { ctx.fillStyle = m.color || ink; ctx.beginPath(); ctx.arc(X(m.t), Y(m.y), 4, 0, Math.PI * 2); ctx.fill(); }
  }

  /* ---------- pose model + camera (Studio has its own, so it never depends on coach.js's DOM) ---------- */
  let vision = null, landmarker = null;
  async function loadModel(onStatus) {
    if (MOCK) { landmarker = { mock: true }; return; }
    if (landmarker) return;
    onStatus('Loading pose engine…');
    try { vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`); }
    catch (e) { vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs'); }
    const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`);
    onStatus('Loading full pose model…');
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (e) { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    onStatus('Pose model ready');
  }
  let mockT0 = 0;
  function detect(video, now) {
    if (MOCK) { if (!mockT0) mockT0 = now; return window.__mockPose ? window.__mockPose(now - mockT0) : null; }
    const res = landmarker.detectForVideo(video, now);
    return res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
  }
  function drawSkeleton(ctx, lm, W, H, color = '#fff3e2', focus = []) {
    if (!lm) return;
    const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility ?? lm[i].v ?? 1 });
    ctx.lineWidth = Math.max(2, W / 320); ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (const [a, b] of E.CONNECTIONS) { const p = P(a), q = P(b); if (p.v < 0.3 || q.v < 0.3) continue; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    for (const i of [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const p = P(i); if (p.v < 0.3) continue; ctx.fillStyle = focus.includes(i) ? '#ff2e88' : color; ctx.beginPath(); ctx.arc(p.x, p.y, focus.includes(i) ? W / 90 : W / 160, 0, Math.PI * 2); ctx.fill(); }
  }

  /* ---------- routing / steps ---------- */
  const STEPS = ['screen', 'describe', 'record', 'measure', 'faults', 'guide', 'export'];
  function go(step) { state.step = step; saveState(); render(); }
  $('steps').addEventListener('click', (e) => { const b = e.target.closest('button[data-step]'); if (b) go(b.dataset.step); });

  function stepDone(step, s) {
    if (!s) return false;
    switch (step) {
      case 'screen': return Object.keys(s.screen || {}).length >= 6;
      case 'describe': return !!(s.id && s.name && s.group && s.summary && s.setup && s.why && s.faults.some((f) => f.label));
      case 'record': return state.takes.length > 0;
      case 'measure': return s.type === 'reps' ? (s.progress.metric.pts.length >= (SPEC.KINDS[s.progress.metric.kind] || {}).n) : s.hold.conditions.some((c) => c.metric.pts.length >= (SPEC.KINDS[c.metric.kind] || {}).n && (Number.isFinite(c.min) || Number.isFinite(c.max)));
      case 'faults': return s.faults.length > 0 && s.faults.every((f) => f.cue && f.tip);
      case 'guide': return !!(s.guide.surface && s.guide.stop && s.guide.cannotSee);
      case 'export': return catalogProblems(s, targetFileName(s)).length === 0;
    }
    return false;
  }

  /* ---------- move selector ---------- */
  function refreshSelect() {
    const sel = $('move-select'); const specs = Object.entries(state.moves).sort((a, b) => (a[1].created || 0) - (b[1].created || 0));
    const opt = (v, t, dis) => `<option value="${esc(v)}" ${dis ? 'disabled' : ''} ${state.current === v ? 'selected' : ''}>${esc(t)}</option>`;
    sel.innerHTML = opt('', specs.length ? 'Your moves' : '— New move to begin —', true) + specs.map(([key, s]) => opt(key, (s.name || 'Untitled') + (SPEC.checkSpec(s).length ? ' ·' : ' ✓'))).join('')
      + opt('', 'Library moves — open one, then “Edit a copy”', true) + LIB.all().filter((e) => !state.moves[e.id]).map((e) => opt(e.id, e.name + (e.catalog ? '' : ' (code)'))).join('');
    sel.value = state.current || '';
  }
  $('move-select').onchange = async (e) => { state.current = e.target.value || null; state.step = isBuiltin(state.current) ? 'record' : state.step; await loadTakes(); saveState(); render(); };
  $('btn-new').onclick = async () => { const s = blankSpec(); const key = 'draft_' + uid(); s._key = key; state.moves[key] = s; state.current = key; state.step = 'screen'; state.takes = []; saveState(); render(); };
  async function loadTakes() { state.takes = state.current ? await idb.forMove(state.current) : []; resim(); }
  /* A draft's id can change while it is being named; takes stay attached through the storage key. */
  function moveKey() { const s = cur(); return s ? (s._key || s.id) : state.current; }

  /* ---------- render ---------- */
  function render() {
    refreshSelect();
    const s = cur();
    document.querySelectorAll('#steps button').forEach((b) => { b.setAttribute('aria-current', b.dataset.step === state.step ? 'step' : 'false'); b.classList.toggle('done', stepDone(b.dataset.step, s)); b.disabled = !state.current || (isBuiltin(state.current) && !['record', 'faults'].includes(b.dataset.step)); });
    const main = $('main');
    if (!state.current) { main.innerHTML = welcome(); wireWelcome(); return; }
    if (isBuiltin(state.current)) { if (state.step === 'faults') { main.innerHTML = builtinFaults(); $('back').onclick = () => go('record'); } else { state.step = 'record'; main.innerHTML = recordPanel(); wireRecord(); } return; }
    const panels = { screen: screenPanel, describe: describePanel, record: recordPanel, measure: measurePanel, faults: faultsPanel, guide: guidePanel, export: exportPanel };
    main.innerHTML = panels[state.step](s);
    ({ screen: wireScreen, describe: wireDescribe, record: wireRecord, measure: wireMeasure, faults: wireFaults, guide: wireGuide, export: wireExport })[state.step](s);
  }
  const field = (label, inner, hint = '') => `<label class="field"><span>${label}</span>${inner}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const text = (key, val, ph = '') => `<input type="text" data-k="${key}" value="${esc(val)}" placeholder="${esc(ph)}">`;
  const area = (key, val, ph = '', rows = 3) => `<textarea data-k="${key}" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
  const chips = (key, values, val, labels = {}) => `<div class="opts" data-chips="${key}">${values.map((v) => `<button type="button" class="chip small" data-v="${esc(v)}" aria-pressed="${String(v) === String(val)}">${esc(labels[v] ?? v)}</button>`).join('')}</div>`;
  /* Generic binding: inputs with data-k write into the spec at that (dotted) path. */
  function bind(root, s, after) {
    const setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) { o = o[ks[i]] = o[ks[i]] ?? {}; } o[ks[ks.length - 1]] = v; };
    root.querySelectorAll('[data-k]').forEach((el) => { el.oninput = () => { setPath(s, el.dataset.k, el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value); saveState(); if (after) after(el.dataset.k); }; });
    root.querySelectorAll('[data-chips]').forEach((g) => { g.onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; let v = b.dataset.v; if (v === 'true') v = true; else if (v === 'false') v = false; else if (v !== '' && !isNaN(+v) && g.dataset.num !== undefined) v = +v; setPath(s, g.dataset.chips, v); saveState(); g.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === b)); if (after) after(g.dataset.chips); }; });
  }

  /* ===================== welcome ===================== */
  function welcome() {
    return `<div class="stack"><h2>Sit down with a physio. Leave with moves the coach can run.</h2>
      <p class="lead">Studio walks one move at a time through the same seven steps as the intake document: screen it, describe it, record it, pick the one number that is progress, write each fault as a number and watch it fire on the recordings, write the guide, export.</p>
      <div class="st-grid">
        <div class="card"><h3>Before the session</h3><ul style="margin:0;padding-left:18px;line-height:1.7">
          <li>Laptop on a stand at chest height, 2.5–3 m of clear floor in front of it, plain background if possible.</li>
          <li>Someone to demonstrate: the physio, or a model they can direct. The camera needs a real body, not a description.</li>
          <li>A band set (tan → black), a mat, a chair, a wall you can use.</li>
          <li>The physio's shortlist of moves, screened on paper first (step 1 takes two minutes per move).</li>
          <li>Chrome or Edge; allow the camera; keep the tab in front while recording.</li></ul></div>
        <div class="card"><h3>Order that works</h3><ol style="margin:0;padding-left:18px;line-height:1.7">
          <li><b>Screen</b> every move on the shortlist first. Drop the ones that fail — before anyone gets up.</li>
          <li>Per move, ~25 minutes: describe (5) · record (8) · measure and faults (8) · guide (4).</li>
          <li>Record in this order: 2 clean takes · one take per fault, exaggerated · 2 borderline takes · the other side · one awkward camera set-up.</li>
          <li>Hold the <b>start position still for the first 2 seconds</b> of every take — that is the calibration the coach will use.</li>
          <li>Save the session file at the end (top right). It carries every move and every take.</li></ol></div>
      </div>
      <div class="card"><div class="fields two">${field('Physio (for the credit line in the move file)', `<input type="text" id="pt-name" value="${esc(state.pt.name)}" placeholder="e.g. Dr. A. Sharma, MPT">`)}<div style="align-self:end"><button class="btn primary" id="btn-new2">Start a new move</button></div></div></div>
      <p class="muted" style="font-size:.85rem">Keyboard while recording: <kbd>space</kbd> start / stop, <kbd>1</kbd>–<kbd>4</kbd> label the next take (clean, fault, borderline, set-up).</p></div>`;
  }
  function wireWelcome() { $('pt-name').oninput = (e) => { state.pt.name = e.target.value; saveState(); }; $('btn-new2').onclick = () => $('btn-new').click(); }

  /* ===================== 1 · screen ===================== */
  const QUESTIONS = [
    ['big', 'Is the movement big?', 'A joint angle changes by more than about 15°, or a landmark travels more than about 5 cm. Scapular retraction is 2 cm — below what the camera can see.'],
    ['across', 'Does it happen across the camera, not toward it?', 'A leg swinging sideways in front of the lens is measurable. An arm pushing straight at the lens just gets shorter.'],
    ['visible', 'From one camera position, can you see the joints that matter?', 'Face-down moves hide the arms under the body. Anything facing a wall puts the working side away from the lens.'],
    ['home', 'Can a person set that camera up at home?', 'Floor level, hip height on a shelf, chest height on a stand — fine. Directly overhead — no.'],
    ['geometry', 'Does the failure mode show as geometry?', '"Hips sagging" is an offset from a line. "Not bracing" is invisible.'],
    ['helps', 'Would the coaching actually help?', 'Some moves people do right by default; cueing them adds noise. Fine to say no — the move stays out.'],
  ];
  function verdictOf(sc) {
    const hard = ['big', 'across', 'visible', 'home'];
    if (hard.some((q) => sc[q] === false)) return { cls: 'no', text: 'Not coachable by one camera. If it matters clinically, add it as an untracked timer with a written guide — or skip it.' };
    if (sc.geometry === false) return { cls: 'timer', text: 'Visible, but its faults are not. Ship it as a timer with a written guide; the coach counts the hold and says nothing about form.' };
    if (sc.helps === false) return { cls: 'timer', text: 'Coachable, but you said the coaching would not help. Leave it out, or ship a timer only.' };
    if (Object.keys(sc).length < 6) return { cls: 'timer', text: 'Answer all six.' };
    return { cls: 'go', text: 'Coachable. Carry on to Describe.' };
  }
  function screenPanel(s) {
    const v = verdictOf(s.screen || {});
    return `<div class="stack"><h2>1 · Screen it</h2><p class="lead">Six questions. A "no" to any of the first four is a rejection — no camera on earth fixes it. Better to find out now than after twenty minutes of recording.</p>
      <div class="card"><div class="qs">${QUESTIONS.map(([k, q, h]) => `<div class="q"><div><div class="qt">${q}</div><div class="qh">${h}</div></div>${chips('screen.' + k, [true, false], s.screen[k], { true: 'Yes', false: 'No' })}</div>`).join('')}</div>
      <div class="verdict ${v.cls}" id="verdict" style="margin-top:12px">${v.text}</div></div>
      <div class="card"><div class="fields two">${field('Working name', text('name', s.name, 'e.g. Side leg raise'))}${field('Physio’s notes on why this move is in the programme', text('notes', s.notes, 'optional'))}</div></div>
      <div class="row"><span class="spacer"></span><button class="btn primary" id="next">Describe it →</button></div></div>`;
  }
  function wireScreen(s) { bind($('main'), s, (k) => { if (k.startsWith('screen')) { const v = verdictOf(s.screen); const el = $('verdict'); el.className = 'verdict ' + v.cls; el.textContent = v.text; } render(); }); $('next').onclick = () => go('describe'); }

  /* ===================== 2 · describe ===================== */
  const PT_TYPES = { A: 'A · Rep with a range target', B: 'B · Timed hold in a position', C: 'C · Stretch (timed, anchor must not move)', D: 'D · One-sided rep or hold', E: 'E · Isometric — timer only', F: 'F · Balance (not supported yet)', G: 'G · Functional cycle (not supported yet)' };
  function describePanel(s) {
    const idHint = s.id ? (LIB.get(s.id) && !state.moves[s.id] ? 'That id is a built-in move — pick another.' : '') : 'Made from the name; letters, digits, underscores.';
    return `<div class="stack"><h2>2 · Describe it</h2><p class="lead">What the move is, what kind it is, and where the camera goes. The three text lines at the bottom appear on the exercise page word for word.</p>
      <div class="st-grid"><div class="card"><div class="fields">
        ${field('Name shown to the user', text('name', s.name, 'Side leg raise'), 'Consumer name. The clinical name goes below.')}
        ${field('Clinical name', text('clinicalName', s.clinicalName, 'Standing hip abduction'))}
        ${field('Id', text('id', s.id, 'side_leg_raise'), idHint)}
        ${field('Group', text('group', s.group, 'Hip strength'), 'Shown as the eyebrow on the page. Reuse an existing one: ' + [...new Set(LIB.all().map((e) => e.group))].join(' · '))}
        ${field('Exercise type', `<select data-k="ptType">${Object.entries(PT_TYPES).map(([k, v]) => `<option value="${k}" ${s.ptType === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`, 'A and D count reps. B, C count seconds in position. E is a plain timer. F and G need engine work — note them and move on.')}
        <div class="fields two">${field('Counts', chips('type', ['reps', 'hold'], s.type, { reps: 'Reps', hold: 'Seconds held' }))}${field('Camera view', chips('view', ['front', 'side'], s.view, { front: 'Facing the camera', side: 'Side-on' }))}</div>
        ${field('One-sided?', chips('sidedKind', ['none', 'leg', 'arm', 'side'], s.sided ? s.sided.limb : 'none', { none: 'No — both at once', leg: 'One leg', arm: 'One arm', side: 'One side' }), 'A one-sided move offers Left / Right / Both on the page.')}
        ${s.sided ? field('Which limb is working is decided by', chips('sided.by', ['pick', 'camera'], s.sided.by, { pick: 'The person’s choice (front-on)', camera: 'The limb nearest the camera (side-on)' })) : ''}
        ${s.sided && s.sided.by === 'pick' ? field('If no side was chosen', chips('sided.auto', [false, true], !!s.sided.auto, { false: 'Assume the left', true: 'Follow whichever limb moves' })) : ''}
        ${field('Upper body only', chips('upperBody', [false, true], s.upperBody, { false: 'Legs must be in frame', true: 'Works from the hips up' }), 'Upper-body moves can be done seated at a desk with only the torso in frame.')}
        ${field('What the camera does', chips('tracking', ['form', 'reps', 'none'], s.tracking || 'form', { form: 'Counts and judges', reps: 'Counts only', none: 'Nothing — guide only' }), '“Counts and judges” needs at least one fault with a measurement and a threshold; “counts only” needs the progress measurement; “nothing” lists the guide and the person logs the set by hand.')}
        ${field('Level', chips('level', ['beginner', 'intermediate', 'advanced'], s.level || 'beginner'))}
      </div></div>
      <div class="card"><div class="fields">
        <div class="fields two">${field('Camera height', chips('camera.height', ['floor', 'knee', 'hip', 'chest', 'eye'], s.camera.height))}${field('Distance', chips('camera.distance', ['1.5 m', '2 m', '2.5 m', '3 m'], s.camera.distance))}</div>
        ${field('Resistance band', chips('band', [false, 'none', 'yellow', 'red', 'green'], s.band, { false: 'No band option', none: 'Optional, default none', yellow: 'Default yellow', red: 'Default red', green: 'Default green' }), 'TheraBand colours; the user picks the colour, the app never describes resistance.')}
        ${field('Rep / second choices offered', text('targetsText', (s.targets || []).join(', '), '6, 8, 10, 12, 15'), 'Default: the one marked *')}
        ${field('Default', chips('defaultTarget', s.targets, s.defaultTarget))}
        ${field('Calibration pose (the first two seconds of every set)', area('calibrationPose', s.calibrationPose, 'Standing tall, arm hanging at the side, band slack.', 2), 'The coach reads its baselines from this still pose. Every take you record must start in it.')}
        ${field('Summary — one line on the tile', area('summary', s.summary, 'Straight-leg raise out to the side, checked for leaning and hip hiking.', 2))}
        ${field('Set-up — where the camera goes, in the user’s words', area('setup', s.setup, 'Stand facing the camera about 2.5 m away, camera at hip height, whole body in frame.', 3))}
        ${field('Why this camera angle works', area('why', s.why, 'From the front the leg swings across the camera plane, so the raise angle, pelvis tilt and trunk lean are all measured directly.', 3))}
      </div></div></div>
      <div class="card"><div class="row" style="align-items:baseline;gap:12px;flex-wrap:wrap"><h3>What goes wrong</h3><span class="muted" style="font-size:.85rem">Name each fault now — every one becomes a take label in step 3, and the numbers come in step 5. Most moves have three to five.</span></div>
        <div class="stack" id="fault-names" style="margin-top:8px">${s.faults.map((f, i) => `<div class="row fault-name" data-fi="${i}" style="gap:8px;align-items:center;flex-wrap:wrap">
          <input type="text" data-k="faults.${i}.label" value="${esc(f.label)}" placeholder="Fault, e.g. Hip hiking" style="flex:1 1 180px">
          <input type="text" data-k="faults.${i}.cue" value="${esc(f.cue)}" placeholder="Spoken cue — what to do, ≤ 8 words" style="flex:1 1 220px">
          ${chips(`faults.${i}.severity`, [1, 2, 3], f.severity || 2, { 1: 'Minor', 2: 'Matters', 3: 'Key' })}
          ${f.rule ? '<span class="muted" style="font-size:.8rem">rule</span>' : chips(`faults.${i}.listed`, [false, true], !!f.listed, { false: 'Camera', true: 'Person' })}
          <button type="button" class="btn ghost small" data-delf="${i}">✕</button></div>`).join('') || '<p class="muted" style="font-size:.9rem">No faults yet.</p>'}</div>
        <div class="row" style="margin-top:8px"><button type="button" class="btn secondary small" id="addf-name">Add a fault</button><span class="muted" style="font-size:.8rem">Camera = the coach will measure it (step 5); Person = listed on the page for them to watch.</span></div></div>
      <div class="row"><button class="btn ghost" id="back">← Screen</button><span class="spacer"></span><button class="btn primary" id="next">Record it →</button></div></div>`;
  }
  function wireDescribe(s) {
    bind($('main'), s, (k) => {
      if (k === 'name' && !s.idTouched) { s.id = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]/, 'm$&'); const el = document.querySelector('[data-k="id"]'); if (el) el.value = s.id; }
      if (k === 'id') { s.idTouched = true; s.id = s.id.toLowerCase().replace(/[^a-z0-9_]/g, '_'); }
      if (k === 'targetsText') { const t = s.targetsText.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0); if (t.length) { s.targets = t; if (!t.includes(s.defaultTarget)) s.defaultTarget = t[Math.floor(t.length / 2)]; } }
      if (k === 'sidedKind') { const v = document.querySelector('[data-chips="sidedKind"] .chip[aria-pressed="true"]').dataset.v; s.sided = v === 'none' ? null : { limb: v, by: s.sided?.by || (s.view === 'side' ? 'camera' : 'pick') }; delete s.sidedKind; }
      if (k === 'ptType') { if (s.ptType === 'A' || s.ptType === 'D') s.type = 'reps'; if (s.ptType === 'B' || s.ptType === 'C') s.type = 'hold'; }
      if (k === 'sided.auto' && s.sided && !s.sided.auto) delete s.sided.auto;
      const fm = k.match(/^faults\.(\d+)\.(\w+)$/);
      if (fm) { const f = s.faults[+fm[1]]; if (fm[2] === 'label' && !f.idTouched) f.id = f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'fault' + fm[1]; if (fm[2] === 'listed') { saveState(); render(); return; } saveState(); return; }
      if (['sidedKind', 'ptType', 'targetsText', 'type', 'view', 'band', 'upperBody', 'sided.by', 'tracking'].includes(k)) { saveState(); render(); }
      else saveState();
    });
    document.querySelectorAll('#fault-names [data-chips]').forEach((g) => { if (/severity$/.test(g.dataset.chips)) g.dataset.num = ''; });
    $('addf-name').onclick = () => { s.faults.push({ id: 'fault' + (s.faults.length + 1), label: '', cue: '', tip: '', severity: 2, listed: false, metric: { kind: 'angle', pts: [] }, rel: 'change', op: '>', threshold: null, minP: s.type === 'reps' ? 0.3 : 0, persist: 400, invalidates: false }); saveState(); render(); setTimeout(() => { const last = document.querySelector('#fault-names .fault-name:last-child input'); if (last) last.focus(); }, 0); };
    document.querySelectorAll('#fault-names [data-delf]').forEach((b) => { b.onclick = () => { s.faults.splice(+b.dataset.delf, 1); saveState(); render(); }; });
    document.querySelector('[data-chips="defaultTarget"]').dataset.num = '';
    $('back').onclick = () => go('screen'); $('next').onclick = () => go('record');
  }

  /* ===================== 3 · record ===================== */
  const LABELS = { clean: 'Clean', borderline: 'Borderline', setup: 'Awkward set-up', other: 'Other' };
  const rec = { on: false, frames: [], t0: 0, raf: 0, stream: null, label: 'clean', side: 'L', mirror: true, keepVideo: true, mr: null, chunks: [], countdown: 0, lastVideoT: -1, fileMode: false };
  function recordPanel() {
    const s = cur(); const ex = state.current ? (cur() ? null : builtin(state.current)) : null;
    const faultLabels = (s ? s.faults : (ex ? ex.faults : [])).map((f) => [`fault:${f.id}`, 'Fault: ' + f.label]);
    const labels = [['clean', 'Clean'], ...faultLabels, ['borderline', 'Borderline'], ['setup', 'Awkward set-up'], ['other', 'Other']];
    const sided = s ? !!s.sided : !!(ex && ex.sided);
    return `<div class="stack"><h2>3 · Record takes</h2><p class="lead">${ex ? `<b>${esc(ex.name)}</b> is in the library. Record takes here and see how its current rules fire on them (step 5)${ex.catalog ? `, or <button type="button" class="btn secondary small" id="edit-copy">Edit a copy</button> to change its numbers and words and save it back to <code>${esc(ex.file)}</code>.` : '. It is a hand-written code move, so its rules are changed in <code>client/coach/library/' + esc(ex.id) + '.js</code>.'}` : 'Recordings are where thresholds come from. Two clean takes, one exaggerated take per fault named in step 2, two borderline ones, the other side, one awkward set-up. Hold the start position still for the first two seconds of every take.'}</p>
      <div class="st-grid wide-left"><div class="stack">
        <div class="stage ${rec.mirror ? 'mirror' : ''}" id="stage"><video id="cam" playsinline muted autoplay></video><canvas id="cam-canvas"></canvas><div class="status" id="cam-status">Camera off</div></div>
        <div class="row"><button class="btn primary" id="btn-cam">Start camera</button><button class="btn ghost" id="btn-flip" title="Mirror the preview">Mirror</button><button class="btn ghost" id="btn-file">Analyze a video file…</button><input type="file" id="file-input" accept="video/*" hidden><span class="spacer"></span><label class="row" style="gap:6px;font-size:.9rem"><input type="checkbox" id="keep-video" ${rec.keepVideo ? 'checked' : ''}> keep video</label></div>
        <div class="card"><h3>Takes <span class="muted" style="font-weight:500">· ${state.takes.length}</span></h3><div class="takes" id="takes">${takesList()}</div></div>
        <div class="card"><h3>Coverage</h3>${coverage()}</div>
      </div>
      <div class="stack"><div class="card"><div class="fields">
          ${field('This take is', `<div class="opts" id="take-label">${labels.map(([v, t]) => `<button type="button" class="chip small" data-v="${esc(v)}" aria-pressed="${rec.label === v}">${esc(t)}</button>`).join('')}</div>`, 'Label the take before you record it. A fault take should exaggerate that one fault and nothing else.')}
          ${sided ? field('Side being worked', `<div class="opts" id="take-side"><button type="button" class="chip small" data-v="L" aria-pressed="${rec.side === 'L'}">Left</button><button type="button" class="chip small" data-v="R" aria-pressed="${rec.side === 'R'}">Right</button></div>`, 'Left and right of the person, not of the picture.') : ''}
          <div class="row"><button class="btn secondary" id="btn-rec" disabled>Record (space)</button><span id="rec-timer" class="mono muted"></span></div>
        </div></div></div></div>
      <div class="row">${s ? '<button class="btn ghost" id="back">← Describe</button>' : ''}<span class="spacer"></span>${s ? '<button class="btn primary" id="next">Measure it →</button>' : '<button class="btn primary" id="next">See the rules fire →</button>'}</div></div>`;
  }
  function takesList() {
    if (!state.takes.length) return '<p class="muted">Nothing recorded yet.</p>';
    return state.takes.map((t) => {
      const sim = state.sims[t.id]; const ex = currentExercise();
      let simText = '';
      if (sim && !sim.error && ex) simText = ex.type === 'reps' ? `<b>${sim.full}</b> reps${sim.partial ? ` · ${sim.partial} partial` : ''}` : `<b>${(sim.holdMs / 1000).toFixed(1)} s</b> in position`;
      else if (sim && sim.error) simText = `<span class="muted">rule error: ${esc(sim.error)}</span>`;
      const fired = sim && !sim.error ? Object.keys(sim.faultSpans).concat(Object.keys(sim.repFaults || {})) : [];
      return `<div class="take" data-id="${t.id}"><span class="lbl ${labelOf(t)}">${esc(t.label.startsWith('fault:') ? 'Fault: ' + t.label.slice(6) : LABELS[t.label] || t.label)}</span>
        <div><div class="meta">${t.side ? (t.side === 'L' ? 'left' : 'right') + ' · ' : ''}${(t.durationMs / 1000).toFixed(1)} s · ${t.frames.length} frames${t.video ? ' · video' : ''}${t.note ? ' · ' + esc(t.note) : ''}</div><div class="sim">${simText}${fired.length ? ` · fired: ${fired.map(esc).join(', ')}` : sim && !sim.error ? ' · no faults' : ''}</div></div>
        <div class="acts"><button class="btn ghost small" data-act="play">Play</button><button class="btn ghost small" data-act="note">Note</button><button class="btn ghost small" data-act="del">✕</button></div></div>`;
    }).join('');
  }
  function coverage() {
    const s = cur(); const ex = currentExercise(); const n = (fn) => state.takes.filter(fn).length;
    const rows = [['Clean', n((t) => t.label === 'clean'), 2], ['Borderline', n((t) => t.label === 'borderline'), 2], ['Awkward set-up', n((t) => t.label === 'setup'), 1]];
    for (const f of (s ? s.faults : (ex ? ex.faults : []))) rows.push(['Fault: ' + f.label, n((t) => t.label === 'fault:' + f.id), 1]);
    if ((s && s.sided) || (ex && ex.sided)) rows.push(['Left', n((t) => t.side === 'L'), 1], ['Right', n((t) => t.side === 'R'), 1]);
    return `<div class="fires">${rows.map(([l, c, want]) => `<span class="${c >= want ? 'ok' : c ? 'warn' : ''}">${esc(l)} ${c}/${want}</span>`).join('')}</div>`;
  }
  function editCopy(id) {
    const ex = builtin(id); if (!ex || !ex.catalog) return;
    try { const s = entryToSpec(ex); state.moves[s._key] = s; state.current = s._key; state.step = 'describe'; saveState(); loadTakes().then(render); toast('Editing a copy of ' + ex.name + ' — save it in step 7'); }
    catch (e) { toast('Could not open: ' + e.message, 6000); }
  }
  function wireRecord() {
    const s = cur();
    if ($('edit-copy')) $('edit-copy').onclick = () => editCopy(state.current);
    if ($('back')) $('back').onclick = () => go('describe');
    $('next').onclick = () => go(s ? 'measure' : 'faults');
    $('take-label').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; rec.label = b.dataset.v; $('take-label').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === b)); };
    if ($('take-side')) $('take-side').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; rec.side = b.dataset.v; $('take-side').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === b)); };
    $('keep-video').onchange = (e) => { rec.keepVideo = e.target.checked; };
    $('btn-flip').onclick = () => { rec.mirror = !rec.mirror; $('stage').classList.toggle('mirror', rec.mirror); };
    $('btn-cam').onclick = () => (rec.stream ? stopCam() : startCam());
    $('btn-rec').onclick = () => (rec.on ? stopRec() : startRec());
    $('btn-file').onclick = () => $('file-input').click();
    $('file-input').onchange = () => { const f = $('file-input').files[0]; $('file-input').value = ''; if (f) analyzeFile(f); };
    $('takes').onclick = async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return; const id = b.closest('.take').dataset.id; const t = state.takes.find((x) => x.id === id);
      if (b.dataset.act === 'del') { if (!confirm('Delete this take?')) return; await idb.del(id); state.takes = state.takes.filter((x) => x.id !== id); resim(); render(); }
      if (b.dataset.act === 'note') { const n = prompt('Note for this take (what was different, what to look for):', t.note || ''); if (n !== null) { t.note = n; await idb.put(t); render(); } }
      if (b.dataset.act === 'play') openPlayer(t);
    };
    if (rec.stream || MOCK) restoreCam();
  }
  document.addEventListener('keydown', (e) => {
    if (state.step !== 'record' || e.target.matches('input,textarea,select')) return;
    if (e.code === 'Space') { e.preventDefault(); if ($('btn-rec') && !$('btn-rec').disabled) $('btn-rec').click(); }
    const map = { Digit1: 'clean', Digit2: 'fault', Digit3: 'borderline', Digit4: 'setup' };
    if (map[e.code]) { const want = map[e.code]; const btn = [...document.querySelectorAll('#take-label .chip')].find((c) => c.dataset.v === want || (want === 'fault' && c.dataset.v.startsWith('fault:'))); if (btn) btn.click(); }
  });

  async function startCam() {
    const status = (t) => { const el = $('cam-status'); if (el) el.textContent = t; };
    try {
      await loadModel(status);
      const video = $('cam');
      if (!MOCK) { rec.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false }); video.srcObject = rec.stream; await video.play(); }
      else { rec.stream = { getTracks: () => [] }; video.width = 640; video.height = 360; }
      rec.fileMode = false; $('btn-cam').textContent = 'Stop camera'; $('btn-rec').disabled = false; status('Live — stand in the start position');
      rec.raf = requestAnimationFrame(camLoop);
    } catch (e) { status('Camera failed: ' + e.message); toast(e.message, 5000); }
  }
  function restoreCam() { const video = $('cam'); if (rec.stream && !MOCK) { video.srcObject = rec.stream; video.play().catch(() => { }); } if (rec.stream) { $('btn-cam').textContent = 'Stop camera'; $('btn-rec').disabled = false; cancelAnimationFrame(rec.raf); rec.raf = requestAnimationFrame(camLoop); } }
  function stopCam() { cancelAnimationFrame(rec.raf); if (rec.on) stopRec(); if (rec.stream && rec.stream.getTracks) rec.stream.getTracks().forEach((t) => t.stop()); rec.stream = null; const v = $('cam'); if (v) { v.srcObject = null; } if ($('btn-cam')) { $('btn-cam').textContent = 'Start camera'; $('btn-rec').disabled = true; $('cam-status').textContent = 'Camera off'; } }
  function camLoop(now) {
    rec.raf = requestAnimationFrame(camLoop);
    const video = $('cam'), canvas = $('cam-canvas'); if (!video || !canvas) return;
    const W = MOCK ? 640 : video.videoWidth, H = MOCK ? 360 : video.videoHeight; if (!W || !H) return;
    if (!MOCK && video.currentTime === rec.lastVideoT) return; rec.lastVideoT = video.currentTime;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const lm = detect(video, now);
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, W, H);
    drawSkeleton(ctx, lm, W, H, rec.on ? '#ff2e88' : '#fff3e2');
    if (rec.countdown > 0) { const left = Math.ceil((rec.countdown - now) / 1000); if (left <= 0) { rec.countdown = 0; beginFrames(now); } else { const el = $('cam-status'); if (el) el.textContent = `Starting in ${left}… hold the start position`; } }
    if (rec.on) { const t = Math.round(now - rec.t0); rec.frames.push([t, lm ? lm.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.z ?? 0).toFixed(3), +(l.visibility ?? 1).toFixed(2)]) : null]); const tm = $('rec-timer'); if (tm) tm.textContent = (t / 1000).toFixed(1) + ' s · ' + rec.frames.length + ' frames'; }
    else if (!rec.countdown) { const el = $('cam-status'); if (el) el.textContent = lm ? 'Tracking — ' + (rec.label.startsWith('fault:') ? 'fault take: ' + rec.label.slice(6) : LABELS[rec.label]) + (rec.side ? ' · ' + (rec.side === 'L' ? 'left' : 'right') : '') : 'No person detected'; }
  }
  function startRec() {
    if (rec.on || rec.countdown) return;
    rec.countdown = performance.now() + 3000; say('Three. Two. One.'); $('btn-rec').textContent = 'Stop (space)';
    if (rec.keepVideo && rec.stream && !MOCK && 'MediaRecorder' in window) { try { rec.chunks = []; rec.mr = new MediaRecorder(rec.stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' }); rec.mr.ondataavailable = (e) => { if (e.data.size) rec.chunks.push(e.data); }; } catch { rec.mr = null; } }
  }
  function beginFrames(now) { rec.on = true; rec.t0 = now; rec.frames = []; if (rec.mr) { try { rec.mr.start(250); } catch { } } const st = $('stage'); if (st) { const b = document.createElement('div'); b.className = 'badge-rec'; b.id = 'rec-badge'; b.textContent = 'REC'; st.appendChild(b); } say('Go'); }
  async function stopRec() {
    if (rec.countdown) { rec.countdown = 0; $('btn-rec').textContent = 'Record (space)'; return; }
    if (!rec.on) return; rec.on = false; say('Stop'); $('btn-rec').textContent = 'Record (space)'; const badge = $('rec-badge'); if (badge) badge.remove();
    let video = null;
    if (rec.mr && rec.mr.state !== 'inactive') { await new Promise((res) => { rec.mr.onstop = res; rec.mr.stop(); }); video = new Blob(rec.chunks, { type: rec.mr.mimeType }); rec.mr = null; }
    const v = $('cam'); const aspect = MOCK ? 640 / 360 : (v.videoWidth / v.videoHeight) || 16 / 9;
    await saveTake(rec.frames, aspect, video);
  }
  async function saveTake(frames, aspect, video, source = 'camera') {
    if (frames.length < 10) { toast('Too short — nothing saved'); return; }
    const take = { id: uid(), moveId: moveKey(), label: rec.label, side: rec.side, note: '', aspect, frames, video, source, created: Date.now(), durationMs: frames[frames.length - 1][0], calT: 1200 };
    await idb.put(take); state.takes.push(take); resim(); toast(`Saved ${LABELS[rec.label] || rec.label} take — ${(take.durationMs / 1000).toFixed(1)} s`); render();
  }
  /* Run the pose model over a video file the physio recorded on a phone, at the video's own pace. */
  async function analyzeFile(file) {
    const status = (t) => { const el = $('cam-status'); if (el) el.textContent = t; };
    try {
      await loadModel(status); stopCam(); rec.fileMode = true;
      const video = $('cam'); video.srcObject = null; video.src = URL.createObjectURL(file); video.loop = false; video.muted = true;
      await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('Could not decode this video (try MP4/H.264).')); });
      const canvas = $('cam-canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const ctx = canvas.getContext('2d');
      const frames = []; let last = -1; const t0 = performance.now();
      await video.play();
      await new Promise((res) => {
        const tick = () => { if (video.ended || video.paused && video.currentTime >= video.duration) return res(); if (video.currentTime !== last) { last = video.currentTime; const lm = MOCK ? null : detect(video, performance.now()); ctx.clearRect(0, 0, canvas.width, canvas.height); drawSkeleton(ctx, lm, canvas.width, canvas.height, '#ff2e88'); frames.push([Math.round(video.currentTime * 1000), lm ? lm.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.z ?? 0).toFixed(3), +(l.visibility ?? 1).toFixed(2)]) : null]); status(`Analyzing… ${video.currentTime.toFixed(1)} / ${video.duration.toFixed(1)} s`); } requestAnimationFrame(tick); };
        tick();
      });
      await saveTake(frames, video.videoWidth / video.videoHeight, rec.keepVideo ? file : null, 'file');
      URL.revokeObjectURL(video.src); video.removeAttribute('src'); video.load(); status('Camera off');
    } catch (e) { status('Failed: ' + e.message); toast(e.message, 5000); }
  }

  /* ---------- player: scrub a take with the skeleton and the live metric readout ---------- */
  const pl = { take: null, raf: 0, playing: false, t: 0, url: null };
  function openPlayer(take) {
    pl.take = take; pl.t = 0; pl.playing = false; $('player').hidden = false; $('pl-title').textContent = `${take.label.startsWith('fault:') ? 'Fault: ' + take.label.slice(6) : LABELS[take.label] || take.label} · ${(take.durationMs / 1000).toFixed(1)} s`;
    const v = $('pl-video'); if (pl.url) { URL.revokeObjectURL(pl.url); pl.url = null; }
    if (take.video) { pl.url = URL.createObjectURL(take.video); v.src = pl.url; v.hidden = false; } else { v.hidden = true; v.removeAttribute('src'); }
    $('pl-scrub').value = 0; drawPlayerFrame();
  }
  function closePlayer() { $('player').hidden = true; pl.playing = false; cancelAnimationFrame(pl.raf); const v = $('pl-video'); v.pause(); }
  $('pl-close').onclick = closePlayer; $('player').onclick = (e) => { if (e.target === $('player')) closePlayer(); };
  $('pl-scrub').oninput = (e) => { pl.t = (+e.target.value / 1000) * pl.take.durationMs; pl.playing = false; const v = $('pl-video'); if (!v.hidden) { v.pause(); v.currentTime = pl.t / 1000; } drawPlayerFrame(); };
  $('pl-play').onclick = () => { pl.playing = !pl.playing; $('pl-play').textContent = pl.playing ? 'Pause' : 'Play'; const v = $('pl-video'); if (pl.playing) { pl.wall = performance.now() - pl.t; if (!v.hidden) { v.currentTime = pl.t / 1000; v.play().catch(() => { }); } pl.raf = requestAnimationFrame(playTick); } else { v.pause(); cancelAnimationFrame(pl.raf); } };
  function playTick(now) { if (!pl.playing) return; pl.t = now - pl.wall; if (pl.t >= pl.take.durationMs) { pl.t = pl.take.durationMs; pl.playing = false; $('pl-play').textContent = 'Play'; } $('pl-scrub').value = Math.round(1000 * pl.t / pl.take.durationMs); drawPlayerFrame(); if (pl.playing) pl.raf = requestAnimationFrame(playTick); }
  function drawPlayerFrame() {
    const take = pl.take; const c = $('pl-canvas'); const aspect = take.aspect || 16 / 9; const W = 960, H = Math.round(960 / aspect); if (c.width !== W) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, W, H);
    let i = 0; while (i < take.frames.length - 1 && take.frames[i + 1][0] <= pl.t) i++;
    const lm = take.frames[i][1]; const sim = state.sims[take.id]; const ex = currentExercise();
    let focus = []; if (ex && sim && sim.session && sim.session.m && sim.session.m.focus) focus = sim.session.m.focus;
    if (!take.video) { ctx.fillStyle = '#7a3fb8'; ctx.fillRect(0, 0, W, H); }
    drawSkeleton(ctx, lm ? lm.map((l) => ({ x: l[0], y: l[1], visibility: l[3] })) : null, W, H, '#fff3e2', focus);
    $('pl-time').textContent = (pl.t / 1000).toFixed(1) + ' s';
    let txt = '';
    if (sim && !sim.error) { const pv = sim.values.length ? sim.values.reduce((best, x) => Math.abs(x[0] - pl.t) < Math.abs(best[0] - pl.t) ? x : best) : null; const pp = sim.p.length ? sim.p.reduce((best, x) => Math.abs(x[0] - pl.t) < Math.abs(best[0] - pl.t) ? x : best) : null; const act = sim.active.length ? sim.active.reduce((best, x) => Math.abs(x[0] - pl.t) < Math.abs(best[0] - pl.t) ? x : best) : null; txt = `${pv ? 'value ' + (+pv[1]).toFixed(1) : ''}${pp ? ' · progress ' + (100 * pp[1]).toFixed(0) + '%' : ''}${act && act[1].length ? ' · firing: ' + act[1].join(', ') : ''}${pl.t < (sim.calT ?? 1200) ? ' · (calibration window)' : ''}`; }
    $('pl-readout').textContent = txt;
  }

  /* ===================== metric editor (shared by measure and faults) ===================== */
  const LM_GROUPS = [['Working side', ['SH', 'EL', 'WR', 'HIP', 'KNEE', 'ANK', 'HEEL', 'FOOT', 'EAR']], ['Other side', ['oSH', 'oEL', 'oWR', 'oHIP', 'oKNEE', 'oANK', 'oHEEL', 'oFOOT', 'oEAR']], ['Middle', ['NOSE', 'mSH', 'mHIP']]];
  const LM_WORDS = { SH: 'shoulder', EL: 'elbow', WR: 'wrist', HIP: 'hip', KNEE: 'knee', ANK: 'ankle', HEEL: 'heel', FOOT: 'toes', EAR: 'ear', NOSE: 'nose', mSH: 'mid-shoulders', mHIP: 'mid-hips' };
  const lmWord = (n) => n.startsWith('o') ? 'other ' + LM_WORDS[n.slice(1)] : LM_WORDS[n] || n;
  function metricEditor(path, m) {
    const kind = SPEC.KINDS[m.kind] || SPEC.KINDS.angle; const n = kind.n;
    return `<div class="metric" data-mpath="${path}">
      <div class="row"><select data-mkind style="width:auto">${Object.entries(SPEC.KINDS).map(([k, v]) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <div class="lms">${Array.from({ length: n }, (_, i) => `<button type="button" class="slot ${m.pts[i] ? 'filled' : ''}" data-slot="${i}" aria-pressed="${i === (m.pts.length < n ? m.pts.length : -1)}">${m.pts[i] ? esc(lmWord(m.pts[i])) : (m.kind === 'offset' && i === 2 ? 'point' : m.kind === 'angle' && i === 1 ? 'joint' : 'pick…')}</button>`).join('')}</div></div>
      <div class="help">${esc(kind.help)}</div>
      ${metricExtras(m)}
      ${n ? `<div class="lm-pick">${LM_GROUPS.map(([h, names]) => `<div><div class="col-h">${h}</div>${names.map((nm) => `<button type="button" data-lm="${nm}">${esc(lmWord(nm))}</button>`).join('')}</div>`).join('')}</div>` : ''}
    </div>`;
  }
  const SEGMENTS = [['torso', 'torso'], ['SH-EL', 'upper arm'], ['EL-WR', 'forearm'], ['HIP-KNEE', 'thigh'], ['KNEE-ANK', 'shin'], ['SH-oSH', 'shoulder width'], ['HIP-oHIP', 'hip width'], ['EAR-oEAR', 'ear to ear'], ['SH-HIP', 'trunk']];
  const PCT = ['dist', 'rise', 'height', 'ratio', 'gap', 'rotation', 'near'];
  /* the measurement's extras: what a % is of, which way is +, ignore the sign, negate for an option value */
  function metricExtras(m) {
    const spec = cur(); const opts = (spec && spec.options || []).filter((o) => Array.isArray(o.values) && o.values.length);
    const per = Array.isArray(m.per) ? m.per.join('-') : 'torso';
    const parts = [];
    if (PCT.includes(m.kind)) parts.push(`<label class="mini">% of <select data-mk="per">${SEGMENTS.map(([v, l]) => `<option value="${v}" ${v === per ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`);
    if (['gap', 'rotation', 'lean'].includes(m.kind)) parts.push(`<label class="mini">+ is <select data-mk="sign"><option value="outward" ${m.sign !== 'forward' ? 'selected' : ''}>away from the midline (front view)</option><option value="forward" ${m.sign === 'forward' ? 'selected' : ''}>the way the toes point (side view)</option></select></label>`);
    if (!['angle', 'ratio', 'dist', 'near', 'rise'].includes(m.kind)) parts.push(`<label class="mini"><input type="checkbox" data-mk="abs" ${m.abs ? 'checked' : ''}> ignore the sign</label>`);
    if (opts.length) parts.push(`<label class="mini">negate when <select data-mk="flip"><option value="">never</option>${opts.flatMap((o) => o.values.map((v) => `<option value="${esc(o.key + '=' + v)}" ${m.flip && m.flip.option === o.key && String(m.flip.when) === String(v) ? 'selected' : ''}>${esc(o.label)} = ${esc((o.labels || {})[v] || v)}</option>`)).join('')}</select></label>`);
    return parts.length ? `<div class="row extras">${parts.join('')}</div>` : '';
  }
  function wireMetricEditors(root, s, after) {
    root.querySelectorAll('[data-mpath]').forEach((box) => {
      const get = () => box.dataset.mpath.split('.').reduce((o, k) => o[k], s);
      box.querySelectorAll('[data-mk]').forEach((el) => { el.onchange = () => { const m = get(); const k = el.dataset.mk;
        if (k === 'per') { if (el.value === 'torso') delete m.per; else m.per = el.value.split('-'); }
        if (k === 'sign') { if (el.value === 'outward') delete m.sign; else m.sign = el.value; }
        if (k === 'abs') { if (el.checked) m.abs = true; else delete m.abs; }
        if (k === 'flip') { if (!el.value) delete m.flip; else { const [option, when] = el.value.split('='); const o = (s.options || []).find((x) => x.key === option); const v = o && o.values.find((x) => String(x) === when); m.flip = { option, when: v === undefined ? when : v }; } }
        saveState(); after(); }; });
      let slot = [...box.querySelectorAll('.slot')].findIndex((b) => b.getAttribute('aria-pressed') === 'true'); if (slot < 0) slot = 0;
      box.querySelector('[data-mkind]').onchange = (e) => { const m = get(); m.kind = e.target.value; m.pts = m.pts.slice(0, SPEC.KINDS[m.kind].n); saveState(); after(); };
      box.querySelectorAll('.slot').forEach((b) => { b.onclick = () => { slot = +b.dataset.slot; box.querySelectorAll('.slot').forEach((c) => c.setAttribute('aria-pressed', c === b)); }; });
      box.querySelectorAll('[data-lm]').forEach((b) => { b.onclick = () => { const m = get(); const n = SPEC.KINDS[m.kind].n; m.pts[slot] = b.dataset.lm; m.pts = m.pts.slice(0, n); slot = Math.min(n - 1, slot + 1); saveState(); after(); }; });
    });
  }
  function takeSeries(metric, rel) {
    return state.takes.map((t) => { let d = trace(metric, t, t.side); if (rel === 'change') { const c = d.find((x) => x[0] >= (t.calT ?? 1200)); const base = c ? c[1] : 0; d = d.map(([tt, v]) => [tt, v - base]); } return { take: t, data: d, color: COLORS[labelOf(t)] || COLORS.other, alpha: labelOf(t) === 'clean' ? 1 : 0.75 }; });
  }
  const legend = () => `<div class="legend"><span><i style="background:${COLORS.clean}"></i>clean</span><span><i style="background:${COLORS.fault}"></i>fault takes</span><span><i style="background:${COLORS.borderline}"></i>borderline</span><span><i style="background:${COLORS.setup}"></i>awkward set-up</span></div>`;

  /* ===================== 4 · measure ===================== */
  function measurePanel(s) {
    const noTakes = !state.takes.length;
    const head = `<div class="stack"><h2>4 · ${s.type === 'reps' ? 'The one number that is progress' : 'What counts as being in position'}</h2>`;
    if (s.type === 'reps') {
      const pr = s.progress; const romOpt = (s.options || []).find((o) => o.key === 'rom');
      return head + `<p class="lead">Pick the joint angle or distance that goes from its start value to a target on every good rep. Measure it from the segment that <i>defines</i> the movement: for a shoulder raise that is shoulder→elbow, not shoulder→wrist, or a bent elbow reads as a lower raise.</p>
        <div class="st-grid wide-left"><div class="stack">
          <div class="card"><h3>Measurement</h3>${metricEditor('progress.metric', pr.metric)}</div>
          <div class="card"><h3>Across the takes</h3>${noTakes ? '<p class="muted">Record a take first and the metric appears here.</p>' : `<canvas class="chart" id="chart-metric"></canvas>${legend()}`}</div>
          <div class="card"><h3>Reps the coach would count</h3>${noTakes ? '<p class="muted">—</p>' : `<canvas class="chart" id="chart-p"></canvas><p class="muted" style="font-size:.85rem;margin-top:6px">Progress 0 = start, 1 = target. A rep counts when it passes 0.85 and returns below 0.15. Dots mark counted reps.</p><div class="fires" style="margin-top:8px">${state.takes.map((t) => { const sim = state.sims[t.id]; return `<span class="${!sim || sim.error ? '' : (labelOf(t) === 'clean' ? (sim.full >= 3 ? 'ok' : 'warn') : '')}">${esc(LABELS[t.label] || t.label.replace('fault:', 'fault: '))}: ${sim && !sim.error ? sim.full + (sim.partial ? ` (+${sim.partial} partial)` : '') : '—'}</span>`; }).join('')}</div>`}</div>
        </div><div class="stack">
          <div class="card"><div class="fields">
            ${field('Start value', `<div class="row">${chips('progress.startMode', ['calibrated', 'fixed'], pr.start === 'calibrated' ? 'calibrated' : 'fixed', { calibrated: 'Read at calibration', fixed: 'Fixed number' })}${pr.start === 'calibrated' ? '' : `<input type="number" step="1" data-k="progress.start" value="${esc(pr.start)}" style="width:110px">`}</div>`, 'Calibrated = whatever the metric reads while the person holds the start pose. Use it unless the start pose varies between people in a way that matters.')}
            ${field('Target value', `<div class="row"><input type="number" step="1" data-k="progress.targetNum" value="${esc(typeof pr.target === 'number' ? pr.target : (romOpt ? romOpt.default : ''))}" style="width:110px" ${romOpt ? 'disabled' : ''}><span class="muted">${esc((SPEC.KINDS[pr.metric.kind] || {}).unit || '')}</span></div>`, pr.start === 'calibrated' ? (pr.targetIsDelta ? 'Interpreted as a change from the calibrated start.' : 'Absolute value the metric must reach.') : '')}
            ${pr.start === 'calibrated' ? field('Target is', chips('progress.targetIsDelta', [false, true], !!pr.targetIsDelta, { false: 'An absolute value', true: 'A change from the start' })) : ''}
            ${pr.start === 'calibrated' && pr.targetIsDelta ? field('During the rep the reading', chips('progress.delta', [1, -1], pr.delta === -1 ? -1 : 1, { 1: 'rises', '-1': 'falls (a knee angle closing)' })) : ''}
            ${pr.start === 'calibrated' ? field('Treat the start as at least / at most', `<div class="row"><input type="number" step="1" data-k="progress.startMin" value="${pr.startMin ?? ''}" placeholder="min" style="width:90px"><input type="number" step="1" data-k="progress.startMax" value="${pr.startMax ?? ''}" placeholder="max" style="width:90px"></div>`, 'A knee that calibrates at 150° can be treated as 160°. Leave empty for no clamp.') : ''}
            ${field('Live readout', `<div class="row"><input type="text" data-k="display.label" value="${esc((s.display || {}).label || '')}" placeholder="bend" style="width:120px"><input type="text" data-k="display.unit" value="${esc((s.display || {}).unit || '')}" placeholder="°" style="width:60px">${chips('display.from', ['start', 'abs'], (s.display || {}).from === 'abs' ? 'abs' : 'start', { start: 'change from the start', abs: 'raw reading' })}</div>`, 'What the person sees during the set: “62° / 90° bend”.')}
            ${field('Let the user choose the target?', `<div class="row">${chips('romMode', [false, true], !!romOpt, { false: 'No, one target', true: 'Yes — a “range” option' })}${romOpt ? `<input type="text" data-k="romValues" value="${esc(romOpt.values.join(', '))}" placeholder="45, 60, 75, 90" style="width:160px">` : ''}</div>`, romOpt ? 'The last value is the default. Rehab moves usually want this — early weeks aim lower.' : '')}
            <button class="btn ghost small" id="suggest" ${noTakes ? 'disabled' : ''}>Suggest start and target from clean takes</button>
          </div></div>
          <div class="card"><h3>Which landmark to highlight</h3>${chips('focus', ['', ...new Set(pr.metric.pts)], s.focus || '', { '': 'Last point of the metric' })}<p class="muted" style="font-size:.85rem;margin-top:6px">Drawn as the pink dot on the person during a set.</p></div>
        </div></div>
        <div class="row"><button class="btn ghost" id="back">← Record</button><span class="spacer"></span><button class="btn primary" id="next">Faults →</button></div></div>`;
    }
    /* holds */
    const conds = s.hold.conditions;
    return head + `<p class="lead">A hold is "in position" while every condition below is true. Give each one a window. The coach counts seconds in position and cues when one falls out.</p>
      <div class="st-grid wide-left"><div class="stack">${conds.map((c, i) => `<div class="card"><div class="row"><h3>Condition ${i + 1}</h3><span class="spacer"></span>${conds.length > 1 ? `<button class="btn ghost small" data-delc="${i}">Remove</button>` : ''}</div>${metricEditor(`hold.conditions.${i}.metric`, c.metric)}
        <div class="fields two" style="margin-top:10px">${field('At least', `<input type="number" step="1" data-k="hold.conditions.${i}.min" value="${c.min ?? ''}">`)}${field('At most', `<input type="number" step="1" data-k="hold.conditions.${i}.max" value="${c.max ?? ''}">`)}</div>
        ${field('Measured as', chips(`hold.conditions.${i}.rel`, ['abs', 'change'], c.rel || 'abs', { abs: 'Absolute value', change: 'Change from the calibrated start' }))}
        ${(s.options || []).some((o) => Array.isArray(o.values) && o.values.length) ? field('Only for', `<select data-cw="${i}"><option value="">every option value</option>${(s.options || []).filter((o) => Array.isArray(o.values) && o.values.length).flatMap((o) => o.values.map((v) => `<option value="${esc(o.key + '=' + v)}" ${c.when && c.when[0] && c.when[0].option === o.key && String(c.when[0].is) === String(v) ? 'selected' : ''}>${esc(o.label)} = ${esc((o.labels || {})[v] || v)}</option>`)).join('')}</select>`, 'A condition that applies only for one option value — a straight knee for the calf stretch, a bent one for the soleus.') : ''}
        ${state.takes.length ? `<canvas class="chart" id="chart-c${i}" style="margin-top:10px"></canvas>` : ''}</div>`).join('')}
        <button class="btn ghost" id="addc">Add a condition</button></div>
        <div class="stack"><div class="card"><h3>Seconds the coach would count</h3>${state.takes.length ? `<div class="fires">${state.takes.map((t) => { const sim = state.sims[t.id]; return `<span class="${!sim || sim.error ? '' : (labelOf(t) === 'clean' ? (sim.holdMs > 0.7 * sim.durationMs ? 'ok' : 'warn') : '')}">${esc(LABELS[t.label] || t.label.replace('fault:', 'fault: '))}: ${sim && !sim.error ? (sim.holdMs / 1000).toFixed(1) + ' / ' + (sim.durationMs / 1000).toFixed(1) + ' s' : '—'}</span>`; }).join('')}</div>${legend()}` : '<p class="muted">Record a take first.</p>'}</div>
        <div class="card"><h3>Which landmark to highlight</h3>${chips('focus', ['', ...new Set(conds.flatMap((c) => c.metric.pts))], s.focus || '', { '': 'First point of the first condition' })}</div>
        <div class="card"><div class="fields">${field('Live readout', `<div class="row"><select data-k="display.condition">${conds.map((c, i) => `<option value="${i}" ${((s.display || {}).condition || 0) === i ? 'selected' : ''}>condition ${i + 1}</option>`).join('')}</select><input type="text" data-k="display.label" value="${esc((s.display || {}).label || '')}" placeholder="knee" style="width:110px"><input type="text" data-k="display.aim" value="${esc((s.display || {}).aim || '')}" placeholder="90°" style="width:80px"></div>`, 'What the person sees: “97° knee · aim 90°”.')}
          ${field('When out of position, the coach says', text('enterCue', s.enterCue || '', 'Slide down the wall until your knees are at ninety'), 'Spoken after a few seconds out of position, instead of silence.')}</div></div></div></div>
      <div class="row"><button class="btn ghost" id="back">← Record</button><span class="spacer"></span><button class="btn primary" id="next">Faults →</button></div></div>`;
  }
  function wireMeasure(s) {
    const root = $('main'); const rerender = () => { resim(); render(); };
    bind(root, s, (k) => {
      if (k === 'progress.startMode') { s.progress.start = document.querySelector('[data-chips="progress.startMode"] .chip[aria-pressed="true"]').dataset.v === 'calibrated' ? 'calibrated' : (Number.isFinite(s.progress.start) ? s.progress.start : 0); delete s.progress.startMode; rerender(); return; }
      if (k === 'progress.targetNum') { const v = s.progress.targetNum; delete s.progress.targetNum; if (Number.isFinite(v)) { s.progress.target = v; resim(); drawMeasureCharts(s); } return; }
      if (k === 'romMode') { const on = document.querySelector('[data-chips="romMode"] .chip[aria-pressed="true"]').dataset.v === 'true'; delete s.romMode; s.options = (s.options || []).filter((o) => o.key !== 'rom'); if (on) { const vals = [45, 60, 75, 90]; s.options.push({ key: 'rom', label: 'Range target', values: vals, unit: (SPEC.KINDS[s.progress.metric.kind] || {}).unit || '', default: vals[vals.length - 1] }); s.progress.target = 'opt:rom'; } else if (typeof s.progress.target === 'string') s.progress.target = 90; rerender(); return; }
      if (k === 'romValues') { const o = s.options.find((x) => x.key === 'rom'); const vals = s.romValues.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n)); delete s.romValues; if (o && vals.length) { o.values = vals; o.default = vals[vals.length - 1]; resim(); drawMeasureCharts(s); } return; }
      if (k === 'progress.delta') { s.progress.delta = document.querySelector('[data-chips="progress.delta"] .chip[aria-pressed="true"]').dataset.v === '-1' ? -1 : 1; if (s.progress.delta === 1) delete s.progress.delta; resim(); drawMeasureCharts(s); return; }
      if (k === 'progress.startMin' || k === 'progress.startMax') { if (!Number.isFinite(s.progress[k.slice(9)])) delete s.progress[k.slice(9)]; resim(); drawMeasureCharts(s); return; }
      if (k === 'enterCue') { if (!s.enterCue) delete s.enterCue; saveState(); return; }
      if (k.startsWith('display.')) { s.display = s.display || {}; if (k === 'display.condition') s.display.condition = +s.display.condition; if (k === 'display.from') s.display.from = document.querySelector('[data-chips="display.from"] .chip[aria-pressed="true"]').dataset.v; for (const kk of Object.keys(s.display)) if (s.display[kk] === '' || s.display[kk] === 'start') delete s.display[kk]; if (!Object.keys(s.display).length) delete s.display; saveState(); return; }
      if (k === 'progress.targetIsDelta' || k === 'focus' || k.startsWith('hold.conditions')) { if (k.endsWith('.rel') || k === 'progress.targetIsDelta' || k === 'focus') rerender(); else { resim(); drawMeasureCharts(s); } return; }
    });
    wireMetricEditors(root, s, rerender);
    if ($('suggest')) $('suggest').onclick = () => {
      const clean = state.takes.filter((t) => t.label === 'clean'); if (!clean.length) return toast('Record a clean take first');
      const vals = clean.flatMap((t) => trace(s.progress.metric, t, t.side).filter((x) => x[0] >= (t.calT ?? 1200)).map((x) => x[1]));
      const lo = pct(vals, 0.08), hi = pct(vals, 0.92); const cal = clean.map((t) => { const d = trace(s.progress.metric, t, t.side); const c = d.find((x) => x[0] >= (t.calT ?? 1200)); return c ? c[1] : NaN; }).filter(Number.isFinite);
      const startV = median(cal); const goesUp = Math.abs(hi - startV) >= Math.abs(lo - startV); const target = goesUp ? hi : lo;
      if (s.progress.start === 'calibrated') { s.progress.targetIsDelta = false; }
      const r5 = (v) => Math.round(v / 5) * 5;
      s.progress.target = typeof s.progress.target === 'string' ? s.progress.target : r5(target);
      if (typeof s.progress.target === 'string') { const o = s.options.find((x) => x.key === 'rom'); if (o) { const T = r5(target); o.values = [...new Set([r5(T * 0.5), r5(T * 0.67), r5(T * 0.83), T])].sort((a, b) => a - b); o.default = T; } }
      if (s.progress.start !== 'calibrated') s.progress.start = r5(startV);
      toast(`Start ≈ ${startV.toFixed(0)}, clean takes reach ≈ ${target.toFixed(0)}`); saveState(); rerender();
    };
    root.querySelectorAll('[data-delc]').forEach((b) => { b.onclick = () => { s.hold.conditions.splice(+b.dataset.delc, 1); saveState(); rerender(); }; });
    root.querySelectorAll('[data-cw]').forEach((el) => { el.onchange = () => { const c = s.hold.conditions[+el.dataset.cw]; if (!el.value) delete c.when; else { const [option, when] = el.value.split('='); const o = (s.options || []).find((x) => x.key === option); const v = o && o.values.find((x) => String(x) === when); c.when = [{ option, is: v === undefined ? when : v }]; } saveState(); rerender(); }; });
    if ($('addc')) $('addc').onclick = () => { s.hold.conditions.push({ metric: { kind: 'angle', pts: [] }, min: null, max: null, rel: 'abs' }); saveState(); render(); };
    $('back').onclick = () => go('record'); $('next').onclick = () => go('faults');
    drawMeasureCharts(s);
  }
  function drawMeasureCharts(s) {
    if (!state.takes.length) return;
    if (s.type === 'reps') {
      const pr = s.progress; const n = (SPEC.KINDS[pr.metric.kind] || {}).n; if (pr.metric.pts.length < n) return;
      const series = takeSeries(pr.metric, 'abs'); const lines = [];
      const first = state.sims[state.takes[0].id]; const ref = first && first.session ? first.session.ref : null;
      if (ref) { lines.push({ y: ref.start, label: 'start', color: '#7a3fb8' }, { y: ref.target, label: 'target', color: '#ff2e88' }); }
      if ($('chart-metric')) drawChart($('chart-metric'), series, { lines, yLabel: (SPEC.KINDS[pr.metric.kind] || {}).unit });
      if ($('chart-p')) drawChart($('chart-p'), state.takes.map((t) => ({ data: (state.sims[t.id] && state.sims[t.id].p) || [], color: COLORS[labelOf(t)] || COLORS.other })), { lines: [{ y: E.FULL, label: 'full', color: '#4f9a1e' }, { y: E.ATTEMPT, label: 'attempt', color: '#ffb830' }, { y: E.REST, label: 'rest', color: '#7a3fb8' }], y0: 0, y1: 1, marks: state.takes.flatMap((t) => ((state.sims[t.id] && state.sims[t.id].reps) || []).map((r) => ({ t: r.t, y: r.full ? 1 : 0.5, color: r.full ? '#4f9a1e' : '#ffb830' }))) });
    } else {
      s.hold.conditions.forEach((c, i) => { const n = (SPEC.KINDS[c.metric.kind] || {}).n; if (c.metric.pts.length < n || !$('chart-c' + i)) return; drawChart($('chart-c' + i), takeSeries(c.metric, c.rel), { lines: [{ y: c.min, label: 'min', color: '#7a3fb8' }, { y: c.max, label: 'max', color: '#ff2e88' }], yLabel: (SPEC.KINDS[c.metric.kind] || {}).unit }); });
    }
  }

  /* ===================== 5 · faults ===================== */
  const wc = (t) => (t || '').trim() ? t.trim().split(/\s+/).length : 0;
  function fireReport(f) {
    const groups = {}; for (const t of state.takes) { const sim = state.sims[t.id]; if (!sim || sim.error) continue; const g = t.label === 'fault:' + f.id ? 'this fault' : labelOf(t); const fired = f.rule ? (sim.repFaults[f.id] || 0) > 0 : !!(sim.faultSpans[f.id] && sim.faultSpans[f.id].length); groups[g] = groups[g] || [0, 0]; groups[g][1]++; if (fired) groups[g][0]++; }
    const order = ['clean', 'this fault', 'borderline', 'fault', 'setup', 'other'];
    return `<div class="fires">${order.filter((g) => groups[g]).map((g) => { const [a, b] = groups[g]; const cls = g === 'clean' ? (a === 0 ? 'ok' : 'bad') : g === 'this fault' ? (a === b ? 'ok' : 'bad') : ''; return `<span class="${cls}">fires on ${a}/${b} ${g === 'fault' ? 'other-fault' : g} takes</span>`; }).join('') || '<span>no takes yet</span>'}</div>`;
  }
  /* "Only when": option values, another measurement's comparison, in / out of the held position; and a
     threshold that grows with another reading. */
  function gatesEditor(s, f, i) {
    const opts = (s.options || []).filter((o) => Array.isArray(o.values) && o.values.length);
    const gates = f.when || [];
    const row = (w, j) => {
      const del = `<button type="button" class="btn ghost small" data-delw="${i}.${j}">✕</button>`;
      if (typeof w === 'string') return `<div class="row gate"><span>${w === 'inPosition' ? 'while in the held position' : 'while out of the held position'}</span>${del}</div>`;
      if (w.option !== undefined) { const o = opts.find((x) => x.key === w.option) || { values: [], labels: {} }; return `<div class="row gate"><span>${esc(w.option)} is</span><select data-wv="${i}.${j}">${o.values.map((v) => `<option value="${esc(v)}" ${String(v) === String(w.is) ? 'selected' : ''}>${esc((o.labels || {})[v] || v)}</option>`).join('')}</select>${del}</div>`; }
      return `<div class="gate">${metricEditor(`faults.${i}.when.${j}.metric`, w.metric)}<div class="row">${chips(`faults.${i}.when.${j}.rel`, ['abs', 'change'], w.rel || 'abs', { abs: 'Absolute', change: 'Change from start' })}${chips(`faults.${i}.when.${j}.op`, ['>', '<'], w.op || '>', { '>': 'More than', '<': 'Less than' })}<input type="number" step="0.5" data-k="faults.${i}.when.${j}.threshold" value="${w.threshold ?? ''}" style="width:100px">${del}</div></div>`;
    };
    const sc = f.scale;
    return `<div class="gates"><div class="row" style="align-items:center;gap:8px"><b style="font-size:.85rem">Only when</b>${gates.length ? '' : '<span class="muted" style="font-size:.85rem">always</span>'}<span class="spacer"></span>
        ${opts.length ? `<button type="button" class="btn ghost small" data-addw="${i}.option">+ option value</button>` : ''}<button type="button" class="btn ghost small" data-addw="${i}.metric">+ measurement</button>${s.type === 'hold' ? `<button type="button" class="btn ghost small" data-addw="${i}.inPosition">+ in position</button><button type="button" class="btn ghost small" data-addw="${i}.notInPosition">+ out of position</button>` : ''}</div>
      ${gates.map(row).join('')}
      ${s.type === 'reps' ? `<div class="row" style="gap:10px;margin-top:6px"><span style="font-size:.85rem"><b>Threshold grows</b> with the progress reading ×</span><input type="number" step="0.05" data-k="faults.${i}.scaleTimes" value="${sc ? sc.times : ''}" placeholder="0" style="width:90px"><span class="muted" style="font-size:.8rem">e.g. 0.35: a hip hike of 12 + 0.35 × the raise</span></div>` : ''}</div>`;
  }
  function faultCard(s, f, i) {
    const isRule = ['shallow', 'fast', 'return'].includes(f.rule);
    return `<div class="fault-card" data-fi="${i}">
      <div class="head"><input type="text" data-k="faults.${i}.label" value="${esc(f.label)}" placeholder="Fault name, e.g. Hip hiking"><span class="muted" style="font-size:.8rem">id ${esc(f.id)}</span><span class="spacer"></span>${chips(`faults.${i}.severity`, [1, 2, 3], f.severity || 2, { 1: 'Sev 1', 2: 'Sev 2', 3: 'Sev 3' })}<button class="btn ghost small" data-delf="${i}">✕</button></div>
      <div class="fields two">
        ${field('Spoken cue <span class="wc ' + (wc(f.cue) > 6 ? 'over' : '') + '" id="wc-' + i + '">' + wc(f.cue) + '/6 words</span>', text(`faults.${i}.cue`, f.cue, 'Hip down'), 'Said mid-rep. Six words or fewer, imperative, no clinical terms.')}
        ${field('Written tip (read after the set)', area(`faults.${i}.tip`, f.tip, 'If the pelvis lifts on the working side the leg is being hitched, not lifted. Keep both hip bones level and accept a smaller raise.', 2))}
      </div>
      ${isRule ? '' : field('Watched by', chips(`faults.${i}.listed`, [false, true], !!f.listed, { false: 'The camera — measured below', true: 'The person — listed on the page only' }))}
      ${isRule ? `<p class="notice">${f.rule === 'shallow' ? 'Built-in rule: the rep did not reach the target (peak between the attempt and full thresholds). No measurement needed.' : f.rule === 'return' ? `Built-in rule: the rep ended above <input type="number" step="0.05" data-k="faults.${i}.threshold" value="${f.threshold ?? 0.25}" style="width:90px;display:inline-block;min-height:32px;padding:4px 8px"> of the way to the target — it did not come all the way back.` : `Built-in rule: the rep took less than <input type="number" data-k="faults.${i}.minMs" value="${f.minMs || 2000}" style="width:90px;display:inline-block;min-height:32px;padding:4px 8px"> ms.`}</p>`
        : f.listed ? '<p class="notice">Listed under “what goes wrong” for the person to watch; the camera does not check it.</p>' : `${metricEditor(`faults.${i}.metric`, f.metric)}
        <div class="row" style="gap:14px">${field('Measured as', chips(`faults.${i}.rel`, ['abs', 'change'], f.rel || 'abs', { abs: 'Absolute', change: 'Change from start' }))}${field('Fault when', `<div class="row">${chips(`faults.${i}.op`, ['>', '<'], f.op || '>', { '>': 'More than', '<': 'Less than' })}<input type="number" step="0.5" data-k="faults.${i}.threshold" value="${f.threshold ?? ''}" style="width:100px"><span class="muted">${esc((SPEC.KINDS[f.metric.kind] || {}).unit || '')}</span><button class="btn ghost small" data-suggest="${i}">Suggest</button></div>`)}</div>
        <div class="row" style="gap:14px">${s.type === 'reps' ? field('Only once the rep is', chips(`faults.${i}.minP`, [0, 0.2, 0.3, 0.5], f.minP ?? 0.3, { 0: 'any time', 0.2: '20% under way', 0.3: '30% under way', 0.5: 'half way' })) : field('Watch it', chips(`faults.${i}.phase`, ['hold', 'any'], f.phase === 'any' ? 'any' : 'hold', { hold: 'while in position', any: 'any time — even out of position' }))}${field('Must persist', chips(`faults.${i}.persist`, [250, 400, 600, 900], f.persist || 400, { 250: '¼ s', 400: '0.4 s', 600: '0.6 s', 900: '0.9 s' }))}${field('Invalidates the rep', chips(`faults.${i}.invalidates`, [false, true], !!f.invalidates, { false: 'No', true: 'Yes' }))}</div>
        ${gatesEditor(s, f, i)}
        ${state.takes.length ? `<canvas class="chart" id="chart-f${i}"></canvas>` : ''}`}
      ${fireReport(f)}
    </div>`;
  }
  function faultsPanel(s) {
    return `<div class="stack"><h2>5 · Faults, as numbers</h2><p class="lead">The faults named in step 2, each with what the camera measures and how much is too much (a fault marked <i>Person</i> in step 2 needs no number). Then look at the strip below each one — it must fire on the exaggerated take and stay quiet on the clean ones. If a threshold from a textbook fires on every clean rep, the recordings are right and the textbook is not.</p>
      <div class="stack" id="faults">${s.faults.map((f, i) => faultCard(s, f, i)).join('') || '<p class="muted">No faults yet. Most moves need three to five.</p>'}</div>
      <div class="row"><button class="btn secondary" id="addf">Add a measured fault</button>${s.type === 'reps' ? `<button class="btn ghost" id="add-shallow" ${s.faults.some((f) => f.rule === 'shallow') ? 'disabled' : ''}>Add “not reaching the target”</button><button class="btn ghost" id="add-fast" ${s.faults.some((f) => f.rule === 'fast') ? 'disabled' : ''}>Add “too fast”</button><button class="btn ghost" id="add-return" ${s.faults.some((f) => f.rule === 'return') ? 'disabled' : ''}>Add “not returning fully”</button>` : ''}</div>
      <div class="row"><button class="btn ghost" id="back">← Measure</button><span class="spacer"></span><button class="btn primary" id="next">Guide →</button></div></div>`;
  }
  function wireFaults(s) {
    const root = $('main'); const rerender = () => { resim(); render(); };
    ['faults.*.severity', 'faults.*.minP', 'faults.*.persist', 'faults.*.threshold', 'faults.*.minMs'].forEach(() => { });
    root.querySelectorAll('[data-chips]').forEach((g) => { if (/severity|minP|persist$/.test(g.dataset.chips)) g.dataset.num = ''; });
    bind(root, s, (k) => {
      const m = k.match(/^faults\.(\d+)\.(\w+)$/) || k.match(/^faults\.(\d+)\.(when\.\d+\.\w+)$/); if (!m) return; const i = +m[1], f = s.faults[i], key = m[2];
      if (key === 'label' && !f.idTouched) { f.id = f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'fault' + i; root.querySelector(`[data-fi="${i}"] .muted`).textContent = 'id ' + f.id; }
      if (key === 'cue') { const el = $('wc-' + i); el.textContent = wc(f.cue) + '/6 words'; el.classList.toggle('over', wc(f.cue) > 6); }
      if (key === 'listed' || key === 'phase') return rerender();
      if (key === 'scaleTimes') { const v = f.scaleTimes; delete f.scaleTimes; if (Number.isFinite(v) && v) f.scale = { metric: 'progress', times: v }; else delete f.scale; resim(); drawFaultCharts(s); return; }
      if (/^when\./.test(key) || m[0].includes('.when.')) { resim(); drawFaultCharts(s); return; }
      if (['threshold', 'minMs', 'op', 'rel', 'minP', 'persist', 'invalidates', 'severity'].includes(key)) { resim(); if (key === 'rel') return rerender(); drawFaultCharts(s); const card = root.querySelector(`[data-fi="${i}"]`); card.querySelector('.fires').outerHTML = fireReport(f); }
    });
    wireMetricEditors(root, s, rerender);
    root.querySelectorAll('[data-delf]').forEach((b) => { b.onclick = () => { if (!confirm('Remove this fault?')) return; s.faults.splice(+b.dataset.delf, 1); saveState(); rerender(); }; });
    root.querySelectorAll('[data-addw]').forEach((b) => { b.onclick = () => { const [i, kind] = b.dataset.addw.split('.'); const f = s.faults[+i]; f.when = f.when || [];
      if (kind === 'option') { const o = (s.options || []).find((x) => Array.isArray(x.values) && x.values.length); f.when.push({ option: o.key, is: o.values[0] }); }
      else if (kind === 'metric') f.when.push({ metric: { kind: 'angle', pts: [] }, rel: 'abs', op: '>', threshold: null });
      else f.when.push(kind);
      saveState(); rerender(); }; });
    root.querySelectorAll('[data-delw]').forEach((b) => { b.onclick = () => { const [i, j] = b.dataset.delw.split('.').map(Number); s.faults[i].when.splice(j, 1); if (!s.faults[i].when.length) delete s.faults[i].when; saveState(); rerender(); }; });
    root.querySelectorAll('[data-wv]').forEach((el) => { el.onchange = () => { const [i, j] = el.dataset.wv.split('.').map(Number); const w = s.faults[i].when[j]; const o = (s.options || []).find((x) => x.key === w.option); const v = o && o.values.find((x) => String(x) === el.value); w.is = v === undefined ? el.value : v; saveState(); resim(); drawFaultCharts(s); }; });
    root.querySelectorAll('[data-suggest]').forEach((b) => { b.onclick = () => suggestThreshold(s, s.faults[+b.dataset.suggest]); });
    if ($('add-return')) $('add-return').onclick = () => { s.faults.push({ id: 'return', rule: 'return', label: 'Not returning fully', cue: 'All the way back', tip: 'Finish each rep back at the start so the muscle works through its whole range.', severity: 1, threshold: 0.25 }); saveState(); render(); };
    $('addf').onclick = () => { s.faults.push({ id: 'fault' + (s.faults.length + 1), label: '', cue: '', tip: '', severity: 2, metric: { kind: 'angle', pts: [] }, rel: 'change', op: '>', threshold: null, minP: s.type === 'reps' ? 0.3 : 0, persist: 400, invalidates: false }); saveState(); render(); };
    if ($('add-shallow')) $('add-shallow').onclick = () => { s.faults.push({ id: 'shallow', rule: 'shallow', label: 'Not reaching the target', cue: 'A little further', tip: 'Aim for the full target without compensating; if it hurts before then, lower the target.', severity: 1 }); saveState(); render(); };
    if ($('add-fast')) $('add-fast').onclick = () => { s.faults.push({ id: 'fast', rule: 'fast', label: 'Too fast', cue: 'Slower — two up, three down', tip: 'Swinging lets momentum do the work. Two seconds out, a pause, three seconds back.', severity: 1, minMs: 2000 }); saveState(); render(); };
    $('back').onclick = () => go('measure'); $('next').onclick = () => go('guide');
    drawFaultCharts(s);
  }
  function drawFaultCharts(s) {
    s.faults.forEach((f, i) => {
      const c = $('chart-f' + i); if (!c || f.rule) return; const n = (SPEC.KINDS[f.metric.kind] || {}).n; if (f.metric.pts.length < n) return;
      const spans = state.takes.flatMap((t) => ((state.sims[t.id] && state.sims[t.id].faultSpans[f.id]) || []).map(([t0, t1]) => ({ t0, t1, color: t.label === 'fault:' + f.id ? 'rgba(255,46,136,.22)' : labelOf(t) === 'clean' ? 'rgba(209,32,107,.35)' : 'rgba(255,184,48,.25)' })));
      drawChart(c, takeSeries(f.metric, f.rel), { lines: [{ y: f.threshold, label: 'threshold', color: '#ff2e88' }], spans, yLabel: (SPEC.KINDS[f.metric.kind] || {}).unit });
    });
  }
  function suggestThreshold(s, f) {
    const n = (SPEC.KINDS[f.metric.kind] || {}).n; if (f.metric.pts.length < n) return toast('Pick the landmarks first');
    const clean = state.takes.filter((t) => t.label === 'clean'), bad = state.takes.filter((t) => t.label === 'fault:' + f.id);
    if (!clean.length) return toast('Record a clean take first');
    const vals = (takes) => takeSeries(f.metric, f.rel).filter((x) => takes.includes(x.take)).flatMap((x) => x.data.filter((p) => p[0] >= (x.take.calT ?? 1200)).map((p) => p[1]));
    const cv = vals(clean), bv = bad.length ? vals(bad) : null;
    let thr;
    if (bv) { const cEdge = f.op === '>' ? pct(cv, 0.97) : pct(cv, 0.03); const bMid = f.op === '>' ? pct(bv, 0.7) : pct(bv, 0.3); thr = (cEdge + bMid) / 2; if ((f.op === '>' && bMid <= cEdge) || (f.op === '<' && bMid >= cEdge)) toast('The fault take does not separate from the clean ones on this measurement — try another metric, or exaggerate the fault more', 6000); }
    else { thr = f.op === '>' ? pct(cv, 0.97) + Math.abs(pct(cv, 0.97) - pct(cv, 0.5)) * 0.5 : pct(cv, 0.03) - Math.abs(pct(cv, 0.5) - pct(cv, 0.03)) * 0.5; toast('No take labelled with this fault yet — set just outside the clean range. Record one to do better.', 5000); }
    f.threshold = Math.round(thr * 2) / 2; saveState(); resim(); render();
  }
  function builtinFaults() {
    const ex = builtin(state.current);
    return `<div class="stack"><h2>${esc(ex.name)} — how its rules fire on your takes</h2><p class="lead">This move is defined in code, so its rules cannot be edited here. Record takes, and this shows which faults fire on which. Send the session file to the build side with what should change.</p>
      <div class="stack">${ex.faults.map((f) => `<div class="fault-card"><div class="head"><b>${esc(f.label)}</b><span class="muted" style="font-size:.85rem">“${esc(f.cue)}”</span><span class="spacer"></span><span class="muted" style="font-size:.8rem">weight ${f.weight}${f.onRep ? ' · per rep' : ''}</span></div>${fireReport(f)}</div>`).join('')}</div>
      <div class="card"><h3>Reps / seconds counted</h3><div class="fires">${state.takes.map((t) => { const sim = state.sims[t.id]; return `<span>${esc(LABELS[t.label] || t.label.replace('fault:', 'fault: '))}: ${sim && !sim.error ? (ex.type === 'reps' ? sim.full + ' reps' : (sim.holdMs / 1000).toFixed(1) + ' s') : (sim && sim.error ? esc(sim.error) : '—')}</span>`; }).join('') || '<span>no takes</span>'}</div></div>
      <div class="row"><button class="btn ghost" id="back">← Record</button></div></div>`;
  }

  /* ===================== 6 · guide ===================== */
  function guidePanel(s) {
    const g = s.guide;
    return `<div class="stack"><h2>6 · The guide</h2><p class="lead">What the exercise page shows. Every line is marked <b>camera</b> (the coach checks it) or <b>you</b> (the person checks it themselves). The "cannot see" line is required — it is the honest part.</p>
      <div class="st-grid"><div class="stack">
        <div class="card"><div class="fields">
          ${field('Surface / set-up', area('guide.surface', g.surface, 'Standing on a firm floor, shoes on, a wall or chair within reach but not held.', 2))}
          ${field('What the camera cannot see', area('guide.cannotSee', g.cannotSee, 'Whether the foot is turned out, or the band is anchored securely.', 2), 'Shown to the user so they know what to check themselves.')}
          ${field('Stop if', area('guide.stop', g.stop, 'Sharp pain in the groin, or pain that lingers after the set.', 2))}
        </div></div>
        <div class="card"><h3>Form points by region</h3><div class="stack" id="regions">${g.regions.map((r, ri) => `<div class="region" data-ri="${ri}"><div class="row"><input type="text" data-k="guide.regions.${ri}.name" value="${esc(r.name)}" placeholder="Region, e.g. Trunk & pelvis" style="flex:1"><button class="btn ghost small" data-delr="${ri}">✕</button></div>
          ${r.points.map((p, pi) => `<div class="pt"><button type="button" class="chip small ${p.tracked ? 'good' : ''}" data-tr="${ri}.${pi}" aria-pressed="true">${p.tracked ? 'camera' : 'you'}</button><input type="text" data-k="guide.regions.${ri}.points.${pi}.t" value="${esc(p.t)}" placeholder="One form point, in the user’s words"><button class="btn ghost small" data-delp="${ri}.${pi}">✕</button></div>`).join('')}
          <button class="btn ghost small" data-addp="${ri}">Add a point</button></div>`).join('')}</div><button class="btn ghost small" id="addr" style="margin-top:8px">Add a region</button></div>
      </div><div class="stack">
        <div class="card"><div class="fields">
          ${field('Tempo', text('tempo', s.tempo, 'Up 2 s, hold 1 s, down 3 s'))}
          ${field('Dosage (sets × reps or seconds, days per week)', text('dosage', s.dosage, '3 × 10, daily'))}
          ${field('Make it harder', text('progression', s.progression, 'Next band colour; add a 2-second pause at the top'))}
          ${field('Make it easier', text('regression', s.regression, 'No band; smaller range; hold the chair'))}
          ${field('Do not do this if', text('contraindications', s.contraindications, 'Sharp pain in the joint; swelling that grows during the session'))}
          ${field('Equipment', area('equipmentText', s.equipmentText, 'none\nor one item per line: chair, band', 2), 'One item per line (an item may contain a comma). “(optional)” after an item says so.')}
          ${field('Muscles — main', text('muscleNames.primaryText', listText((s.muscleNames || {}).primary), 'quadriceps, gluteus maximus'), 'Plain names, comma-separated. Shown in the details panel.')}
          ${field('Muscles — also', text('muscleNames.secondaryText', listText((s.muscleNames || {}).secondary), 'hamstrings'))}
          ${field('Sources', area('sourcesText', s.sourcesText, 'E3 Rehab — knee pain | https://…', 2), 'One per line: name | url. Added to the file’s own sources.')}
        </div></div>
        <div class="card"><h3>Muscles the figure should light up</h3><p class="muted" style="font-size:.85rem;margin-bottom:8px">Tap to cycle: off → some → most.</p><div class="muscles">${ANAT.regions.map((r) => `<button type="button" class="chip small" data-mus="${r}" aria-pressed="${(s.muscles[r] || 0) > 0}">${r}${s.muscles[r] ? ' · ' + (s.muscles[r] >= 1 ? 'most' : 'some') : ''}</button>`).join('')}</div></div>
        <div class="card"><h3>Demo figure</h3><p class="muted" style="font-size:.85rem">Built from a clean take: the start pose and the peak of the best rep become the two keyframes.</p>
          <div class="row" style="margin:8px 0"><button class="btn secondary small" id="build-fig" ${state.takes.some((t) => t.label === 'clean') ? '' : 'disabled'}>Build from the best clean take</button>${s.figure ? '<span class="muted" style="font-size:.85rem">built ✓</span>' : ''}</div>
          ${s.figure ? (ANAT.register(s.id || 'draft', s.figure), ANAT.demo(s.id || 'draft')) : ''}</div>
      </div></div>
      <div class="row"><button class="btn ghost" id="back">← Faults</button><span class="spacer"></span><button class="btn primary" id="next">Check &amp; export →</button></div></div>`;
  }
  function wireGuide(s) {
    const root = $('main'); bind(root, s, (k) => {
      if (k === 'muscleNames.primaryText' || k === 'muscleNames.secondaryText') { const which = k.includes('primary') ? 'primary' : 'secondary'; s.muscleNames = s.muscleNames || { primary: [], secondary: [] }; s.muscleNames[which] = listFrom(s.muscleNames[which + 'Text']); delete s.muscleNames[which + 'Text']; saveState(); }
    });
    root.querySelectorAll('[data-tr]').forEach((b) => { b.onclick = () => { const [ri, pi] = b.dataset.tr.split('.').map(Number); const p = s.guide.regions[ri].points[pi]; p.tracked = !p.tracked; saveState(); render(); }; });
    root.querySelectorAll('[data-delp]').forEach((b) => { b.onclick = () => { const [ri, pi] = b.dataset.delp.split('.').map(Number); s.guide.regions[ri].points.splice(pi, 1); saveState(); render(); }; });
    root.querySelectorAll('[data-addp]').forEach((b) => { b.onclick = () => { s.guide.regions[+b.dataset.addp].points.push({ t: '', tracked: false }); saveState(); render(); const inputs = root.querySelectorAll(`[data-ri="${b.dataset.addp}"] input[type=text]`); }; });
    root.querySelectorAll('[data-delr]').forEach((b) => { b.onclick = () => { s.guide.regions.splice(+b.dataset.delr, 1); saveState(); render(); }; });
    $('addr').onclick = () => { s.guide.regions.push({ name: '', points: [] }); saveState(); render(); };
    root.querySelectorAll('[data-mus]').forEach((b) => { b.onclick = () => { const r = b.dataset.mus; const v = s.muscles[r] || 0; s.muscles[r] = v === 0 ? 0.5 : v < 1 ? 1 : 0; if (!s.muscles[r]) delete s.muscles[r]; if (s.figure) s.figure.w = { ...s.muscles }; saveState(); render(); }; });
    $('build-fig').onclick = () => { try { s.figure = buildFigure(s); saveState(); toast('Figure built'); render(); } catch (e) { toast('Could not build: ' + e.message, 5000); } };
    if (s.figure) { ANAT.register(s.id || 'draft', s.figure); ANAT.mountAll(root); }
    $('back').onclick = () => go('faults'); $('next').onclick = () => go('export');
  }
  /* Two keyframes for the anatomical figure, lifted straight out of a clean take. */
  function buildFigure(s) {
    const clean = state.takes.filter((t) => t.label === 'clean' && state.sims[t.id] && !state.sims[t.id].error);
    if (!clean.length) throw new Error('no clean take');
    const take = clean.sort((a, b) => (state.sims[b.id].full || 0) - (state.sims[a.id].full || 0))[0]; const sim = state.sims[take.id];
    const aspect = take.aspect || 16 / 9;
    const frameAt = (t) => { let best = take.frames[0]; for (const f of take.frames) if (f[1] && Math.abs(f[0] - t) < Math.abs(best[0] - t)) best = f; return best[1]; };
    const tA = sim.calT ?? 1200;
    let tB;
    if (s.type === 'reps') { const rep = sim.reps.filter((r) => r.full)[0]; tB = rep ? rep.rep.t - rep.rep.tUp : (sim.p.length ? sim.p.reduce((b, x) => x[1] > b[1] ? x : b)[0] : tA + 1500); }
    else tB = tA + Math.max(1500, (sim.durationMs - tA) * 0.6);
    const A = frameAt(tA), B = frameAt(tB); if (!A || !B) throw new Error('no pose in the frames');
    const P = (lm, i) => ({ x: lm[i][0] * aspect, y: lm[i][1] });
    const ptsA = A.map((l) => ({ x: l[0] * aspect, y: l[1], v: l[3] })), near = E.nearSide(ptsA);
    const map = (lm) => {
      const o = {};
      if (s.view === 'front') {
        const L = P(lm, 11).x < P(lm, 12).x ? 'L' : 'R', R = L === 'L' ? 'R' : 'L'; const j = (side, k) => P(lm, E.SIDE[side][k]);
        o.h = { x: (P(lm, 7).x + P(lm, 8).x) / 2, y: (P(lm, 7).y + P(lm, 8).y) / 2 };
        o.shL = j(L, 'SH'); o.shR = j(R, 'SH'); o.elL = j(L, 'EL'); o.elR = j(R, 'EL'); o.wrL = j(L, 'WR'); o.wrR = j(R, 'WR'); o.hipL = j(L, 'HIP'); o.hipR = j(R, 'HIP'); o.knL = j(L, 'KNEE'); o.knR = j(R, 'KNEE'); o.anL = j(L, 'ANK'); o.anR = j(R, 'ANK');
      } else {
        const N = near, F = near === 'L' ? 'R' : 'L'; const j = (side, k) => P(lm, E.SIDE[side][k]);
        o.h = { x: (P(lm, 7).x + P(lm, 8).x) / 2, y: (P(lm, 7).y + P(lm, 8).y) / 2 };
        o.sh = j(N, 'SH'); o.hip = j(N, 'HIP'); o.kn = j(N, 'KNEE'); o.an = j(N, 'ANK'); o.ft = j(N, 'FOOT'); o.el = j(N, 'EL'); o.wr = j(N, 'WR');
        o.knF = j(F, 'KNEE'); o.anF = j(F, 'ANK'); o.ftF = j(F, 'FOOT'); o.elF = j(F, 'EL'); o.wrF = j(F, 'WR');
      }
      return o;
    };
    const mA = map(A), mB = map(B);
    const all = [...Object.values(mA), ...Object.values(mB)];
    const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x)), minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
    const sc = Math.min(122 / Math.max(0.01, maxY - minY), 160 / Math.max(0.01, maxX - minX));
    const cx = (minX + maxX) / 2; const fit = (o) => { const r = {}; for (const k in o) r[k] = [Math.round(306 + (o[k].x - cx) * sc), Math.round(161 - (maxY - o[k].y) * sc)]; return r; };
    const fA = fit(mA), fB = fit(mB);
    const flip = s.view === 'side' ? fA.ft[0] < fA.an[0] : false;
    return { view: s.view, A: fA, B: fB, hold: s.type === 'hold', side: 'both', flip, w: { ...s.muscles }, from: { take: take.id, tA, tB } };
  }

  /* ===================== 7 · check & export ===================== */
  function moveFileSource(s) {
    const clean = JSON.parse(JSON.stringify(s)); for (const k of ['_key', '_file', '_replaces', '_target', '_inherited', '_fileCamera', '_tuned', 'idTouched', 'screen', 'created', 'targetsText', 'romValues', 'equipmentText', 'sourcesText', 'muscleNames']) delete clean[k]; for (const f of clean.faults) if (f.listed) { delete f.listed; delete f.metric; delete f.op; delete f.threshold; } for (const f of clean.faults) delete f.idTouched;
    const credit = state.pt.name ? ` Authored with ${state.pt.name}.` : '';
    return `/* ${s.name} — written in Grooveform Studio.${credit}
   A declarative move: no code, only measurements and thresholds. It is compiled by
   coach/spec.js into the same shape as the hand-written moves. Edit the numbers here
   or re-open the Studio session file; see docs/STUDIO.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports) ? require('../exercise-library.js') : root.ExerciseLibrary;
  const spec = (typeof module !== 'undefined' && module.exports) ? require('../spec.js') : root.MoveSpec;
  const SPEC = ${JSON.stringify(clean, null, 2).replace(/^/gm, '  ').trim()};
  lib.define((k) => spec.compile(SPEC, k));
})(typeof window !== 'undefined' ? window : globalThis);
`;
  }
  let devSave = null;   // null = not asked yet, false = not available (static site), { files } = the dev server will write files
  async function probeDevSave() { if (devSave !== null) return devSave; try { const r = await fetch('../api/dev/catalog', { cache: 'no-store' }); devSave = r.ok ? await r.json() : false; } catch { devSave = false; } return devSave; }
  function exportPanel(s) {
    const name = s._target || targetFileName(s);
    const problems = catalogProblems(s, name);
    const warn = [];
    if (!state.takes.some((t) => t.label === 'clean')) warn.push('No clean take recorded — thresholds are guesses.');
    for (const f of s.faults) if (!f.rule && !f.listed && !state.takes.some((t) => t.label === 'fault:' + f.id)) warn.push(`No take showing “${f.label}” — its threshold has not been checked against a real fault.`);
    for (const t of state.takes.filter((t) => t.label === 'clean')) { const sim = state.sims[t.id]; if (sim && !sim.error) { const fired = Object.keys(sim.faultSpans); if (fired.length) warn.push(`A clean take still fires: ${fired.join(', ')}.`); if (s.type === 'reps' && s.tracking !== 'none' && sim.full < 2) warn.push('A clean take counts fewer than 2 reps — check the start/target or the calibration window.'); } }
    if (!state.takes.some((t) => t.label === 'borderline')) warn.push('No borderline take — the most valuable kind.');
    if (!s.figure && !s.pose) warn.push('No demo figure — the page will show nothing in “The move”. Build one in step 6.');
    if (!Object.keys(s.muscles).length) warn.push('No muscles chosen for the figure.');
    const tune = tuningReport(s);
    let preview = ''; try { preview = C.format(fileWith(s, name).entry); } catch (e) { preview = e.message; }
    const ready = !problems.length;
    return `<div class="stack"><h2>7 · Check &amp; save</h2>
      <div class="st-grid"><div class="card"><h3>${ready ? 'Ready to ship' : 'Not ready'}</h3><ul class="problems" style="margin:0;padding-left:18px">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}${ready ? '<li class="ok">Checked exactly as the app loads it: every field name, every measurement, the library’s own rules.</li>' : ''}</ul>
        ${warn.length ? `<h3 style="margin-top:12px">Worth fixing</h3><ul style="margin:0;padding-left:18px;font-size:.9rem">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>
      <div class="card"><h3>Into the library</h3><p style="font-size:.92rem">The move becomes one entry in <code>client/data/moves/&lt;file&gt;.json</code>${s._replaces ? `, replacing <b>${esc(s._replaces)}</b>` : ''}. Every move in that file is the same kind of editable data.</p>
        <div class="fields" style="margin-top:8px">${field('File', `<select data-k="_target">${fileNames().map((f) => `<option value="${esc(f)}" ${f === name ? 'selected' : ''}>${esc(f)}.json</option>`).join('')}</select>`)}</div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="save-project" ${ready ? '' : 'disabled'} hidden>Save into the project</button><button class="btn primary" id="dl-file" ${ready ? '' : 'disabled'}>Download ${esc(name)}.json</button><span class="muted" id="save-note" style="font-size:.85rem"></span></div>
        <div class="row" style="margin-top:10px"><button class="btn secondary" id="try">Try it in the app</button><span class="muted" style="font-size:.85rem">Opens the app with this move added, in this browser only.</span></div>
        <div class="row" style="margin-top:10px"><button class="btn ghost small" id="copy-entry">Copy the entry</button><button class="btn ghost small" id="dl-js">Download as code (.js)</button><button class="btn ghost small" id="dl-json">Download session spec</button></div></div></div>
      <div class="card"><div class="row" style="align-items:baseline"><h3>Tuning</h3><span class="spacer"></span><span class="${tune.pass ? 'ok' : 'muted'}" style="font-weight:800">${tune.pass ? 'passes — every live fault behaves on the takes' : tune.reason}</span></div>
        <p class="muted" style="font-size:.85rem">The rule for every move: two clean takes, a take per live fault, and each fault quiet on the clean takes and firing on its own. Same numbers as the coach runs.</p>
        <table class="tune"><thead><tr><th>fault</th><th>clean</th><th>its own takes</th><th>borderline</th><th></th></tr></thead><tbody>${tune.rows.map((r) => `<tr class="${r.ok ? 'ok' : 'bad'}"><td>${esc(r.label)}</td><td>${r.clean}</td><td>${r.own}</td><td>${r.border}</td><td>${r.ok ? '✓' : esc(r.why)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">no live faults</td></tr>'}</tbody></table>
        <div class="row" style="margin-top:10px;align-items:center;gap:10px">${field('Vetted', chips('vetted', [false, true], !!s.vetted, { false: 'Not yet', true: 'Yes — checked against these takes' }))}${s._tuned ? `<span class="muted" style="font-size:.85rem">tuned ${esc(s._tuned.date)}${s._tuned.by ? ' by ' + esc(s._tuned.by) : ''} on ${s._tuned.takes} takes</span>` : ''}</div>
        ${!tune.pass ? '<p class="muted" style="font-size:.85rem">Vetted can only be set once the rule passes.</p>' : ''}</div>
      <div class="card"><h3>The entry, as it will be written</h3><pre class="code">${esc(preview)}</pre></div>
      <div class="row"><button class="btn ghost" id="back">← Guide</button></div></div>`;
  }
  function download(name, content, type = 'application/octet-stream') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  /* Every live fault against the takes: quiet on clean, firing on its own — the same rule for every move. */
  function tuningReport(s) {
    const clean = state.takes.filter((t) => t.label === 'clean'), rows = [];
    const live = (s.faults || []).filter((f) => !f.rule && !f.listed && f.metric && f.metric.pts.length);
    const count = (f, takes) => { let n = 0; for (const t of takes) { const sim = state.sims[t.id]; if (!sim || sim.error) continue; const fired = f.rule ? (sim.repFaults[f.id] || 0) > 0 : !!(sim.faultSpans[f.id] && sim.faultSpans[f.id].length); if (fired) n++; } return n; };
    for (const f of live) {
      const own = state.takes.filter((t) => t.label === 'fault:' + f.id), border = state.takes.filter((t) => t.label === 'borderline');
      const c = count(f, clean), o = count(f, own), b = count(f, border);
      const ok = clean.length >= 2 && own.length >= 1 && c === 0 && o === own.length;
      rows.push({ id: f.id, label: f.label, clean: `${c}/${clean.length}`, own: `${o}/${own.length}`, border: `${b}/${border.length}`, ok, why: clean.length < 2 ? 'needs 2 clean takes' : !own.length ? 'no take of this fault' : c ? 'fires on a clean take' : 'misses its own take' });
    }
    const pass = rows.length > 0 && rows.every((r) => r.ok) && clean.length >= 2;
    return { rows, pass, reason: !rows.length ? 'no live fault to tune' : clean.length < 2 ? 'record two clean takes' : 'not yet — see the rows in red' };
  }
  function wireExport(s) {
    const name = s._target || targetFileName(s);
    bind($('main'), s, (k) => {
      if (k === '_target') render();
      if (k === 'vetted') { const on = document.querySelector('[data-chips="vetted"] .chip[aria-pressed="true"]').dataset.v === 'true'; const t = tuningReport(s);
        if (on && !t.pass) { s.vetted = false; toast('Vetted only once every live fault behaves on the takes', 5000); render(); return; }
        s.vetted = on; if (on) s._tuned = { date: new Date().toISOString().slice(0, 10), by: state.pt.name || undefined, takes: state.takes.length, faults: t.rows.map((r) => r.id) }; else delete s._tuned; saveState(); render(); }
    });
    probeDevSave().then((d) => { if (d && $('save-project')) { $('save-project').hidden = false; $('save-note').textContent = 'Local server running — saving writes client/data/moves/' + name + '.json'; } });
    $('save-project').onclick = async () => {
      const { rel, json } = fileWith(s, name);
      try {
        const r = await fetch('../api/dev/catalog/' + name, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: JSON.stringify(json) });
        const d = await r.json();
        if (!r.ok) { toast((d.problems || [d.error]).join(' · '), 8000); return; }
        const f = C.data.files.find((x) => x.name === rel); if (f) f.json = json; else { C.data.files.push({ name: rel, json }); C.data.manifest.moves.push(rel); }
        s._file = rel; s._replaces = s.id; saveState();
        $('save-note').textContent = `Saved — ${d.moves} moves in ${rel}, ${d.library} in the library. Reload the app to see it; commit the file to keep it.`; toast('Saved into the project');
      } catch (e) { toast('Save failed: ' + e.message, 6000); }
    };
    $('dl-file').onclick = () => { const { json } = fileWith(s, name); download(name + '.json', C.format(json) + '\n', 'application/json'); $('save-note').textContent = 'Drop it over client/data/moves/' + name + '.json and commit.'; };
    $('copy-entry').onclick = async () => { try { await navigator.clipboard.writeText(C.format(fileWith(s, name).entry)); toast('Copied'); } catch { toast('Copy failed — use download'); } };
    $('dl-js').onclick = () => download(`${s.id}.js`, moveFileSource(s), 'text/javascript');
    $('dl-json').onclick = () => download(`${s.id || 'move'}.spec.json`, JSON.stringify(s, null, 2), 'application/json');
    $('try').onclick = () => { try { const drafts = JSON.parse(localStorage.getItem('grooveform.drafts') || '{}'); const { json, entry } = fileWith(s, name); const grp = {}; for (const k of Object.keys(json)) if (k !== 'moves' && !k.startsWith('_')) grp[k] = json[k]; drafts[s.id] = { entry, group: grp }; localStorage.setItem('grooveform.drafts', JSON.stringify(drafts)); window.open('../#/exercise/' + s.id, '_blank'); } catch (e) { toast(e.message); } };
    $('back').onclick = () => go('guide');
  }

  /* ---------- session file: every move and take, in one JSON ---------- */
  async function saveBundle() {
    const takes = await idb.all();
    const blobToB64 = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(b); });
    const includeVideo = takes.some((t) => t.video) && confirm('Include the videos? Landmark streams are always included; videos make the file much larger but let the build side see what happened.');
    const out = { app: 'grooveform-studio', version: 1, exported: new Date().toISOString(), pt: state.pt, moves: state.moves, takes: [] };
    for (const t of takes) { const c = { ...t }; if (c.video) { c.videoType = c.video.type; c.video = includeVideo ? await blobToB64(c.video) : null; } out.takes.push(c); }
    download(`grooveform-session-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out), 'application/json'); toast(`Saved ${Object.keys(state.moves).length} moves, ${takes.length} takes`);
  }
  async function importBundle(file) {
    const text = await file.text(); let data; try { data = JSON.parse(text); } catch { return toast('Not a JSON file'); }
    if (data.app === 'grooveform-studio') {
      Object.assign(state.moves, data.moves || {}); if (data.pt && data.pt.name && !state.pt.name) state.pt = data.pt;
      for (const t of data.takes || []) { if (typeof t.video === 'string') { const bin = atob(t.video); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); t.video = new Blob([arr], { type: t.videoType || 'video/webm' }); } await idb.put(t); }
      toast(`Imported ${Object.keys(data.moves || {}).length} moves, ${(data.takes || []).length} takes`);
    } else if (data.id && data.faults) { const key = data._key || ('draft_' + uid()); data._key = key; state.moves[key] = data; state.current = key; toast('Imported move ' + data.name); }
    else return toast('Unrecognised file');
    saveState(); await loadTakes(); render();
  }
  $('btn-bundle').onclick = saveBundle;
  $('btn-import').onclick = () => $('import-input').click();
  $('import-input').onchange = () => { const f = $('import-input').files[0]; $('import-input').value = ''; if (f) importBundle(f); };

  /* ---------- boot ---------- */
  (async () => {
    try { await C.load('..'); }
    catch (e) { $('main').innerHTML = `<div class="card"><h2>The exercise files did not load</h2><p class="problems">${esc(e.message)}</p><p class="muted">Fix the file under <code>client/data/</code> and reload.</p></div>`; console.error(e); return; }
    await loadTakes(); render();
  })();
  window.GrooveformStudio = { state, simulate, trace, buildFigure, moveFileSource, render, entryToSpec, specToEntry, fileWith, catalogProblems, editCopy };
})();
