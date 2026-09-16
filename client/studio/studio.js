/* ============================================================
   OnTrack Studio — where a physio turns a move into a spec.

   Screen → Describe → Record takes → pick the progress measure →
   write faults as numbers and see them fire on the takes → guide →
   export. Everything stays in the browser: specs in localStorage,
   takes (landmark streams + optional video) in IndexedDB. One
   "session file" carries a whole afternoon's work to the build side.
   ============================================================ */
(function () {
  'use strict';
  const E = window.FormEngine, LIB = window.ExerciseLibrary, SPEC = window.MoveSpec, ANAT = window.OnTrackAnatomy, C = window.OnTrackCatalog;
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
  /* Storage keys keep their old names on purpose: renaming them would throw away any Studio work
     and drafts already sitting in the browser. Only what a person sees or exchanges is renamed. */
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
      id: '', name: '', clinicalName: '', group: '', type: 'reps', view: 'front', ptType: 'A', sided: null, upperBody: false, icon: '', listed: undefined,
      screen: {}, camera: { height: 'chest', distance: '2.5 m' },
      summary: '', setup: '', brief: '', why: '', band: false, weight: false, repHold: 0, stable: [], cues: {}, options: [],
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      calibrationPose: '', showAsk: '',
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
    const grpCam = (C.data.files.find((f) => f.name === 'regions/' + ex.file) || { json: {} }).json.camera;
    Object.assign(s, {
      _fileCamera: grpCam ? { ...grpCam } : null,
      id: ex.id, name: ex.name, clinicalName: r.clinicalName || '', listed: r.listed, group: ex.group, type: ex.type, view: ex.view, sided: r.sided ? { ...r.sided } : null, upperBody: !!r.upperBody, icon: r.icon || '',
      camera: { ...(ex.camera || s.camera) }, summary: ex.summary, setup: ex.setup, brief: ex.brief || '', why: ex.why, calibrationPose: r.calibrationPose || '', showAsk: (raw.show && raw.show.ask) || '',
      band: r.band === undefined ? false : r.band, weight: r.weight === undefined ? false : r.weight, repHold: ex.type === 'reps' && r.repHold ? r.repHold : 0, options: (r.options || []).map((o) => ({ ...o })), targets: ex.targets.slice(), defaultTarget: ex.defaultTarget,
      tracking: ex.tracking, level: r.level || 'beginner', equipmentText: (ex.equipment || []).join('\n'), muscleNames: { primary: [...((r.muscles || {}).primary || [])], secondary: [...((r.muscles || {}).secondary || [])] },
      tempo: r.tempo || '', dosage: r.dosage || '', progression: r.progression || '', regression: r.regression || '', contraindications: r.contraindications || '',
      sourcesText: (raw.sources || []).map((x) => x.url ? x.name + ' | ' + x.url : x.name).join('\n'),
      muscles: { ...((raw.pose && raw.pose.work) || (raw.figure && raw.figure.w) || {}) }, pose: raw.pose ? JSON.parse(JSON.stringify(raw.pose)) : null, figure: raw.figure || null,
      minMs: r.minMs, focus: r.focus, order: raw.order, vetted: !!r.vetted,
      stable: (r.stable || []).slice(), cues: r.cues ? { ...r.cues } : {},
      _file: 'moves/' + ex.id + '.json', _region: regionOf(ex.file), _replaces: ex.id, _key: ex.id, created: Date.now(),
      _inherited: { camera: !raw.camera, targets: !raw.targets, cannotSee: !(raw.guide && raw.guide.cannotSee), level: !raw.level, equipment: !raw.equipment },
    });
    if (r.progress) { s.progress = { targetIsDelta: false, ...r.progress }; if ((r.progress.and || []).length) s.progress.and = r.progress.and.map((a) => ({ targetIsDelta: false, ...a })); else delete s.progress.and; }
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
    /* only written when it disagrees with what `vetted` would have said on its own */
    if (s.listed !== undefined && !!s.listed !== !!s.vetted) put('listed', !!s.listed);
    if (s.vetted) put('vetted', true);
    const inh = s._inherited || {}; const st = SETTINGS();
    if (!(inh.level && s.level === 'beginner')) put('level', s.level);
    if (!inh.equipment || linesFrom(s.equipmentText).length) put('equipment', linesFrom(s.equipmentText).length ? linesFrom(s.equipmentText) : ['none']);
    put('muscles', { primary: (s.muscleNames || {}).primary || [], secondary: (s.muscleNames || {}).secondary || [] });
    if (s.sided) put('sided', { limb: s.sided.limb, by: s.sided.by, ...(s.sided.auto ? { auto: true } : {}) });
    if (s.upperBody) put('upperBody', true);
    put('summary', s.summary); put('setup', s.setup); if (s.brief) put('brief', s.brief); put('why', s.why); put('calibrationPose', s.calibrationPose);
    if (!(inh.camera && s._fileCamera && same(s.camera, s._fileCamera))) put('camera', s.camera);
    const dt = st.targets[s.type] || {}; if (!(inh.targets && same(s.targets, dt.choices) && s.defaultTarget === dt.default)) { put('targets', s.targets); put('defaultTarget', s.defaultTarget); }
    put('icon', s.icon);
    if (s.options && s.options.length) put('options', s.options);
    if (s.band !== false && s.band !== undefined) put('band', s.band);
    if (s.weight !== false && s.weight !== undefined) put('weight', s.weight);
    if (s.type === 'reps' && s.repHold > 0) put('repHold', s.repHold);
    if ((s.stable || []).length) put('stable', s.stable.slice());
    if (s.cues && Object.keys(s.cues).length) put('cues', { ...s.cues });
    if (s.minMs) put('minMs', s.minMs); if (s.focus) put('focus', s.focus);
    const tracked = s.tracking !== 'none';
    if (tracked && s.type === 'reps' && s.progress && s.progress.metric.pts.length) { const p = { metric: foldMetric(s.progress.metric), start: s.progress.start }; if (Number.isFinite(s.progress.startMin)) p.startMin = s.progress.startMin; if (Number.isFinite(s.progress.startMax)) p.startMax = s.progress.startMax; p.target = s.progress.target; if (s.progress.targetIsDelta) p.targetIsDelta = true; if (s.progress.delta === -1) p.delta = -1;
      /* the further measurements, each written the same way as the first */
      const and = (s.progress.and || []).filter((a) => a && a.metric && a.metric.pts.length).map((a) => {
        const q = { metric: foldMetric(a.metric), start: a.start };
        if (Number.isFinite(a.startMin)) q.startMin = a.startMin;
        if (Number.isFinite(a.startMax)) q.startMax = a.startMax;
        q.target = a.target; if (a.targetIsDelta) q.targetIsDelta = true; if (a.delta === -1) q.delta = -1;
        return q;
      });
      if (and.length) { p.and = and; if (s.progress.combine && s.progress.combine !== 'min') p.combine = s.progress.combine; }
      put('progress', p); }
    if (s.showAsk && s.type === 'reps' && s.tracking !== 'none') put('show', { ask: s.showAsk });
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
  /* One exercise, one file: moves/<id>.json. A move still belongs to a region — that is where its
     defaults (camera, group, order, sources) come from, and which list puts it in order — so saving
     writes one move file and, for a move the region has not seen before, adds its id to that
     region's list. `regionWith` assembles the region as it would read with this draft in it, which
     is what the checks run against. */
  /* a region is named by its file — two of them (gym_lower, gym_upper) share the `region` field */
  const regionOf = (name) => String(name || '').replace(/^regions\//, '').replace(/\.json$/, '');
  const regionNames = () => (C.data ? C.data.files : []).map((f) => regionOf(f.name));
  function targetRegion(s) {
    const files = C.data ? C.data.files : [];
    if (s._region && files.some((f) => regionOf(f.name) === s._region)) return s._region;
    const holder = files.find((f) => f.json.moves.some((m) => m.id === (s._replaces || s.id)));
    if (holder) return regionOf(holder.name);
    const byGroup = files.find((f) => f.json.group === s.group);
    return regionOf(byGroup ? byGroup.name : (files[0] ? files[0].name : 'knee'));
  }
  function regionWith(s, region) {
    const files = C.data ? C.data.files : [];
    const file = files.find((f) => regionOf(f.name) === region) || files[0];
    const json = file ? JSON.parse(JSON.stringify(file.json)) : { region, group: s.group || region, order: 2000, camera: s.camera, sources: [], moves: [] };
    const entry = specToEntry(s);
    if (json.region) entry.region = json.region;
    if (s.group && s.group !== json.group) entry.group = s.group;
    const i = json.moves.findIndex((m) => m.id === (s._replaces || s.id) || m.id === s.id);
    if (i >= 0) json.moves[i] = entry; else json.moves.push(entry);
    return { rel: 'moves/' + s.id + '.json', name: file ? file.name : 'regions/' + region + '.json', json, entry, isNew: i < 0 };
  }
  function catalogProblems(s, region) {
    if (!C.data) return ['the library has not loaded'];
    try { const { name, json } = regionWith(s, region); const others = C.data.files.filter((f) => f.name !== name).flatMap((f) => f.json.moves.map((m) => m.id)); return C.checkFile(json, name, C.data, others); }
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
  const toPts = (lm) => lm.map((l) => ({ x: l[0], y: l[1], z: l[2], visibility: l[3] }));
  /* Where a take calibrates: the coach's positioning step (FormEngine.Settle) run over its frames —
     the first moment the body is seen, in the move's view and has been still for a second. A take
     recorded here starts after a count-in, so it is still from the top; a video from a phone starts
     wherever the phone did — walking in, lying down — and calibrating at a fixed moment there reads
     the wrong start position, after which the whole set looks like one long rep. */
  function settleAt(frames, aspect) {
    let ex = null; try { ex = currentExercise(); } catch { ex = null; }
    const settle = new E.Settle(ex || {}); const sm = new E.PoseSmoother();
    for (const [t, lm] of frames) { const pts = lm ? sm.update(toPts(lm), t, aspect) : null; const at = settle.step(pts, t, aspect); if (at != null) return at; }
    return null;
  }
  function simulate(ex, take) {
    if (!ex || !take || !take.frames.length) return null;
    const smoother = new E.PoseSmoother();
    const work = ex.sided && ex.sided.by === 'pick' ? take.side : null;
    const opts = { target: 999, work };
    for (const o of ex.options || []) if (opts[o.key] === undefined) opts[o.key] = o.default;
    const session = new E.SetSession(ex, opts);
    const aspect = take.aspect || 16 / 9;
    const out = { p: [], values: [], active: [], reps: [], faultSpans: {}, faultFrames: {}, startFired: [], calT: null, frames: 0, lost: 0 };
    const CAL_AT = take.calT ?? 1200;
    let calibrated = false; const open = {};
    for (const fr of take.frames) {
      const t = fr[0], lm = fr[1]; out.frames++;
      const pts = lm ? smoother.update(toPts(lm), t, aspect) : null;
      if (!pts) { out.lost++; continue; }
      if (!calibrated) {
        if (t < CAL_AT) continue;
        session.calibrate(pts, take.side || 'L'); calibrated = true; out.calT = t;
        /* the start position, judged before the set as the coach judges it */
        out.startFired = session.startCheck(pts, take.side || 'L').map((f) => f.id);
        if (out.startFired.length) session.noteStart(out.startFired, t);
      }
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
  /* What a take shows is a set, not one word: a rep can lean AND rush, and a threshold tuned as if
     it only leaned is tuned against the wrong evidence. `labels` is the set; `label` stays as its
     first entry so a session saved before this, and every count that only cares about one, still
     read. Clean, Not a rep and Not said yet are exclusive — nothing stacks on them. */
  const EXCLUSIVE = ['todo', 'clean', 'notrep'];
  const labelsOf = (t) => (Array.isArray(t.labels) && t.labels.length ? t.labels : [t.label]);
  const shows = (t, v) => labelsOf(t).includes(v);
  function setLabels(t, list) {
    let out = [...new Set(list.filter(Boolean))];
    const ex = out.filter((v) => EXCLUSIVE.includes(v));
    if (ex.length) out = [ex[ex.length - 1]];
    if (!out.length) out = ['todo'];
    const order = takeLabels().map(([v]) => v);
    out.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    t.labels = out; t.label = out[0];
    return out;
  }
  /* on: add it (dropping clean / not-a-rep / not-said, which cannot share a rep); off: take it away */
  const toggleLabel = (t, v) => setLabels(t, EXCLUSIVE.includes(v) ? [v] : shows(t, v) ? labelsOf(t).filter((x) => x !== v) : [...labelsOf(t).filter((x) => !EXCLUSIVE.includes(x)), v]);
  const labelText = (v) => (v.startsWith('fault:') ? 'Fault: ' + faultLabel(v.slice(6)) : LABELS[v] || v);
  const saidText = (t) => labelsOf(t).map(labelText).join(' + ');
  const labelOf = (t) => (shows(t, 'clean') ? 'clean' : labelsOf(t).some((v) => v.startsWith('fault:')) ? 'fault' : labelsOf(t)[0]);
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
  let mockT0 = 0, lastTs = 0;
  function detect(video, now) {
    if (MOCK) { if (!mockT0) mockT0 = now; return window.__mockPose ? window.__mockPose(now - mockT0) : null; }
    /* the model wants timestamps that only ever grow — a file is read on its own clock, and the
       camera after it must not step back behind where that clock ended */
    lastTs = Math.max(now, lastTs + 1);
    const res = landmarker.detectForVideo(video, lastTs);
    return res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
  }
  /* The head, in whichever style settings.json asks for (see FormEngine.headShape). Drawn with the
     same helper everywhere so the live camera, the replay and the Studio all show the same figure. */
  function drawHead(ctx, pts, X, Y, S, style, colour, lineW) {
    if (style === 'face') return false;                       // the nose-and-ear links are in CONNECTIONS already
    const h = E.headShape(pts.map((l) => ({ x: l.x, y: l.y, v: l.visibility ?? l.v ?? 1 }))); if (!h) return true;
    const r = Math.max(4, Math.abs(X({ x: h.x + h.r, y: h.y }) - X({ x: h.x, y: h.y })));
    ctx.save(); ctx.lineWidth = lineW; ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(h.neck), Y(h.neck)); ctx.lineTo(X(h), Y(h)); ctx.stroke();   // the neck, in every style but face
    if (style === 'ball') { ctx.beginPath(); ctx.arc(X(h), Y(h), r, 0, Math.PI * 2); ctx.fill(); }
    else if (style === 'circle') { ctx.beginPath(); ctx.arc(X(h), Y(h), r, 0, Math.PI * 2); ctx.stroke(); }
    else if (style === 'dot') { ctx.beginPath(); ctx.arc(X(h), Y(h), Math.max(3, r * 0.42), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    return true;                                              // the caller skips the head links and the face joints
  }
  /* The figure is drawn smoothed, as the coach draws it (FormEngine.PoseSmoother): the model's raw
     landmarks jitter, and the joints it is unsure of — the far arm and leg, side-on — jump about.
     The smoother scales x by the aspect; the drawing wants it back in 0..1. */
  const camSmoother = new E.PoseSmoother();
  function smoothedFor(sm, lm, t, aspect) {
    if (!lm) return null;
    return sm.update(lm.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility })), t, aspect).map((p) => ({ x: p.x / aspect, y: p.y, z: p.z, v: p.v, seen: p.seen }));
  }
  const smoothedTakes = new WeakMap();
  function smoothedTake(take) {
    let out = smoothedTakes.get(take); if (out) return out;
    const sm = new E.PoseSmoother(); const aspect = take.aspect || 16 / 9;
    out = take.frames.map(([t, lm]) => lm ? smoothedFor(sm, toPts(lm), t, aspect) : null);
    smoothedTakes.set(take, out); return out;
  }
  function drawSkeleton(ctx, lm, W, H, color = '#fff3e2', focus = []) {
    if (!lm) return;
    const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility ?? lm[i].v ?? 1 });
    ctx.lineWidth = Math.max(2, W / 320); ctx.strokeStyle = color; ctx.lineCap = 'round';
    const ownHead = drawHead(ctx, lm, (p) => p.x * W, (p) => p.y * H, null, (E.settings.skeleton || {}).head || 'face', color, ctx.lineWidth);
    /* joints the model is unsure of stay off the picture, fairly sure ones are drawn faint — the same call as the live coach (FormEngine.seen / sure) */
    const seen = (i) => E.seen(lm, i), sure = (i) => E.sure(lm, i);
    for (const [a, b] of E.CONNECTIONS) { if (ownHead && E.HEAD_LINKS.some(([c, d]) => c === a && d === b)) continue; if (!seen(a) || !seen(b)) continue; const p = P(a), q = P(b); ctx.globalAlpha = sure(a) && sure(b) ? 1 : 0.45; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    for (const i of [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { if (ownHead && (i === 0 || i === 7 || i === 8)) continue; if (!seen(i)) continue; const p = P(i); ctx.fillStyle = focus.includes(i) ? '#ff2e88' : color; ctx.beginPath(); ctx.arc(p.x, p.y, focus.includes(i) ? W / 90 : W / 160, 0, Math.PI * 2); ctx.fill(); }
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
      case 'record': return state.takes.some((t) => !shows(t, 'todo') && usable(t));
      case 'measure': return s.type === 'reps' ? (s.progress.metric.pts.length >= (SPEC.KINDS[s.progress.metric.kind] || {}).n) : s.hold.conditions.some((c) => c.metric.pts.length >= (SPEC.KINDS[c.metric.kind] || {}).n && (Number.isFinite(c.min) || Number.isFinite(c.max)));
      case 'faults': return s.faults.length > 0 && s.faults.every((f) => f.cue && f.tip);
      case 'guide': return !!(s.guide.surface && s.guide.stop && s.guide.cannotSee);
      case 'export': return catalogProblems(s, targetRegion(s)).length === 0;
    }
    return false;
  }

  /* ---------- move selector ----------
     A hundred and forty moves in the order they happen to be written is a list nobody can find
     anything in, so both groups are sorted by name and the search box above narrows them. The
     current move always stays in the list, whatever the search says, or picking it would lose it. */
  let moveQuery = '';
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  function refreshSelect() {
    const sel = $('move-select'); if (!sel) return;
    const q = moveQuery.trim().toLowerCase();
    const hit = (name, id) => !q || String(name || '').toLowerCase().includes(q) || String(id || '').toLowerCase().includes(q);
    const opt = (v, t, dis) => `<option value="${esc(v)}" ${dis ? 'disabled' : ''} ${state.current === v ? 'selected' : ''}>${esc(t)}</option>`;
    const mine = Object.entries(state.moves).map(([key, m]) => ({ key, name: m.name || 'Untitled', spec: m })).sort(byName)
      .filter((m) => m.key === state.current || hit(m.name, m.spec.id));
    const lib = LIB.all().filter((e) => !state.moves[e.id]).slice().sort(byName)
      .filter((e) => e.id === state.current || hit(e.name, e.id));
    const none = q && !mine.length && !lib.length;
    sel.innerHTML = opt('', Object.keys(state.moves).length ? 'Your moves' : '— New move to begin —', true)
      + mine.map((m) => opt(m.key, m.name + (SPEC.checkSpec(m.spec).length ? ' ·' : ' ✓'))).join('')
      + opt('', none ? `No move matches “${moveQuery}”` : 'Library moves — open one to edit a copy of it', true)
      + lib.map((e) => opt(e.id, e.name + (e.catalog ? '' : ' (code)'))).join('');
    sel.value = state.current || '';
  }
  if ($('move-search')) $('move-search').oninput = (e) => { moveQuery = e.target.value; refreshSelect(); };
  /* Picking a library move opens it as an editable copy. Looking without editing was the old
     default and it cost a click every time — nothing is written anywhere until step 7 saves it, so
     there is nothing to protect. A code move has no data to copy, so it stays read-only. */
  $('move-select').onchange = async (e) => {
    const id = e.target.value || null;
    const ex = id && !state.moves[id] ? builtin(id) : null;
    if (ex && ex.catalog) return editCopy(id);
    state.current = id; state.step = isBuiltin(state.current) ? 'record' : state.step; await loadTakes(); saveState(); render();
  };
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
      <div class="card"><div class="fields two">${field('Working name', text('name', s.name, 'e.g. Side leg raise'))}${field('Coach’s notes on why this move is in the programme', text('notes', s.notes, 'optional'))}</div></div>
      <div class="row"><span class="spacer"></span><button class="btn primary" id="next">Describe it →</button></div></div>`;
  }
  function wireScreen(s) { bind($('main'), s, (k) => { if (k.startsWith('screen')) { const v = verdictOf(s.screen); const el = $('verdict'); el.className = 'verdict ' + v.cls; el.textContent = v.text; } render(); }); $('next').onclick = () => go('describe'); }

  /* ===================== 2 · describe ===================== */
  const PT_TYPES = { A: 'A · Rep with a range target', B: 'B · Timed hold in a position', C: 'C · Stretch (timed, anchor must not move)', D: 'D · One-sided rep or hold', E: 'E · Isometric — timer only', F: 'F · Balance (not supported yet)', G: 'G · Functional cycle (not supported yet)', H: 'H · Rep with a hold at the top' };
  function describePanel(s) {
    const idHint = s.id ? (LIB.get(s.id) && !state.moves[s.id] ? 'That id is a built-in move — pick another.' : '') : 'Made from the name; letters, digits, underscores.';
    return `<div class="stack"><h2>2 · Describe it</h2><p class="lead">What the move is, what kind it is, and where the camera goes. The three text lines at the bottom appear on the exercise page word for word.</p>
      <div class="st-grid"><div class="card"><div class="fields">
        ${field('Name shown to the user', text('name', s.name, 'Side leg raise'), 'Consumer name. The clinical name goes below.')}
        ${field('Id', text('id', s.id, 'side_leg_raise'), idHint)}
        ${field('Group', text('group', s.group, 'Hip strength'), 'Shown as the eyebrow on the page. Reuse an existing one: ' + [...new Set(LIB.all().map((e) => e.group))].join(' · '))}
        ${field('Exercise type', `<select data-k="ptType">${Object.entries(PT_TYPES).map(([k, v]) => `<option value="${k}" ${s.ptType === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`, 'A and D count reps. H counts reps that must pause at the top. B, C count seconds in position. E is a plain timer. F and G need engine work — note them and move on.')}
        <div class="fields two">${field('Counts', chips('counts', ['reps', 'repHold', 'hold'], s.type === 'hold' ? 'hold' : (s.repHold > 0 ? 'repHold' : 'reps'), { reps: 'Reps', repHold: 'Reps with a hold', hold: 'Seconds held' }))}${field('Camera view', chips('view', ['front', 'side'], s.view, { front: 'Facing the camera', side: 'Side-on' }))}</div>
        ${s.type === 'reps' && s.repHold > 0 ? field('Hold at the top for', chips('repHold', [1, 2, 3, 5], s.repHold, { 1: '1 s', 2: '2 s', 3: '3 s', 5: '5 s' }), 'A rep only counts once the reading has stayed at the target this long; reach the top and come straight down and it is a partial, cued “Hold it there”.') : ''}
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
        ${field('Weight', chips('weight', [false, 'none', 1, 2, 5], s.weight, { false: 'No weight option', none: 'Optional, default none', 1: 'Default 1 kg', 2: 'Default 2 kg', 5: 'Default 5 kg' }), 'The alternative to a band: a hand weight in kilograms — 1, 2, 5 or one the person types. A move may offer both.')}
        ${field('Rep / second choices offered', text('targetsText', (s.targets || []).join(', '), '6, 8, 10, 12, 15'), 'Default: the one marked *')}
        ${field('Default', chips('defaultTarget', s.targets, s.defaultTarget))}
        ${s.type === 'reps' ? field('Ask them to show the end position (optional)', area('showAsk', s.showAsk, 'arms straight out to the sides, level with your shoulders, nothing in your hands', 2), 'Only when the target depends on the body or the camera angle, or the equipment hides the joints. The person holds this pose once before the set and what it reads becomes the target; the number in step 4 stays as the fallback.') : ''}
        ${field('Calibration pose (the first two seconds of every set)', area('calibrationPose', s.calibrationPose, 'Standing tall, arm hanging at the side, band slack.', 2), 'The coach reads its baselines from this still pose. Every take you record must start in it.')}
        ${field('Summary — one line on the tile', area('summary', s.summary, 'Straight-leg raise out to the side, checked for leaning and hip hiking.', 2))}
        ${field('Set-up — where the camera goes, in the user’s words', area('setup', s.setup, 'Stand facing the camera about 2.5 m away, camera at hip height, whole body in frame.', 3))}
        ${field('Spoken brief — what the coach says as the set starts: position, then movement. No camera talk, under ~35 words.', area('brief', s.brief, 'Stand tall, one hand on a chair. Lift the working leg straight out to the side, then lower it with control.', 3))}
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
      if (k === 'ptType') { if (s.ptType === 'A' || s.ptType === 'D') { s.type = 'reps'; s.repHold = 0; } if (s.ptType === 'H') { s.type = 'reps'; s.repHold = s.repHold || 2; } if (s.ptType === 'B' || s.ptType === 'C') s.type = 'hold'; }
      if (k === 'counts') { const v = s.counts; delete s.counts; s.type = v === 'hold' ? 'hold' : 'reps'; s.repHold = v === 'repHold' ? (s.repHold || 2) : 0; if (v === 'repHold' && !['H', 'D'].includes(s.ptType)) s.ptType = 'H'; }
      if (k === 'sided.auto' && s.sided && !s.sided.auto) delete s.sided.auto;
      const fm = k.match(/^faults\.(\d+)\.(\w+)$/);
      if (fm) { const f = s.faults[+fm[1]]; if (fm[2] === 'label' && !f.idTouched) f.id = f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'fault' + fm[1]; if (fm[2] === 'listed') { saveState(); render(); return; } saveState(); return; }
      if (['sidedKind', 'ptType', 'targetsText', 'type', 'counts', 'view', 'band', 'weight', 'upperBody', 'sided.by', 'tracking'].includes(k)) { saveState(); render(); }
      else saveState();
    });
    document.querySelectorAll('#fault-names [data-chips]').forEach((g) => { if (/severity$/.test(g.dataset.chips)) g.dataset.num = ''; });
    $('addf-name').onclick = () => { s.faults.push({ id: 'fault' + (s.faults.length + 1), label: '', cue: '', tip: '', severity: 2, listed: false, metric: { kind: 'angle', pts: [] }, rel: 'change', op: '>', threshold: null, minP: s.type === 'reps' ? 0.3 : 0, persist: 400, invalidates: false }); saveState(); render(); setTimeout(() => { const last = document.querySelector('#fault-names .fault-name:last-child input'); if (last) last.focus(); }, 0); };
    document.querySelectorAll('#fault-names [data-delf]').forEach((b) => { b.onclick = () => { s.faults.splice(+b.dataset.delf, 1); saveState(); render(); }; });
    document.querySelector('[data-chips="defaultTarget"]').dataset.num = '';
    document.querySelectorAll('[data-chips="repHold"], [data-chips="weight"]').forEach((g) => { g.dataset.num = ''; });
    $('back').onclick = () => go('screen'); $('next').onclick = () => go('record');
  }

  /* ===================== 3 · record ===================== */
  const LABELS = { clean: 'Clean', borderline: 'Borderline', notrep: 'Not a rep', setup: 'Awkward set-up', other: 'Other', todo: 'Not said yet' };
  /* a take that is not a rep at all — dead time between reps, a shuffle, a rest — is kept so the
     physio's call is on record, and counts for nothing: no chart, no threshold, no coverage */
  const usable = (t) => !shows(t, 'notrep');
  const rec = { on: false, frames: [], t0: 0, raf: 0, stream: null, label: 'clean', side: 'L', mirror: true, keepVideo: true, mr: null, chunks: [], countdown: 0, lastVideoT: -1, fileMode: false };
  /* what a take can be: clean, one of the move's faults, borderline, an awkward set-up, other */
  function faultLabel(id) { const s = cur(); const ex = s ? null : (state.current ? builtin(state.current) : null); const f = ((s ? s.faults : (ex ? ex.faults : [])) || []).find((x) => x.id === id); return f ? f.label : id; }
  function takeLabels() {
    const s = cur(); const ex = state.current ? (cur() ? null : builtin(state.current)) : null;
    const faultLabels = (s ? s.faults : (ex ? ex.faults : [])).map((f) => [`fault:${f.id}`, 'Fault: ' + f.label]);
    return [['todo', 'Not said yet'], ['clean', 'Clean'], ...faultLabels, ['borderline', 'Borderline'], ['notrep', 'Not a rep'], ['setup', 'Awkward set-up'], ['other', 'Other']];
  }
  function recordPanel() {
    const s = cur(); const ex = state.current ? (cur() ? null : builtin(state.current)) : null;
    const labels = takeLabels();
    const sided = s ? !!s.sided : !!(ex && ex.sided);
    return `<div class="stack"><h2>3 · Record takes</h2><p class="lead">${ex ? `<b>${esc(ex.name)}</b> is in the library. Record takes here and see how its current rules fire on them (step 5)${ex.catalog ? `, or <button type="button" class="btn secondary small" id="edit-copy">Edit a copy</button> to change its numbers and words and save it back to <code>moves/${esc(ex.id)}.json</code>.` : '. It is a hand-written code move, so its rules are changed in <code>client/coach/library/' + esc(ex.id) + '.js</code>.'}` : 'Recordings are where thresholds come from. Two clean takes, one exaggerated take per fault named in step 2, two borderline ones, the other side, one awkward set-up. Hold the start position still for the first two seconds of every take.'}</p>
        <p class="muted" style="font-size:.9rem"><b>The quick way:</b> one long video — or one long recording — with everything in it: a few clean reps, one deliberately showing each fault, a borderline one. <b>Upload a video…</b> and the Studio cuts it into its reps (the set-up before the first and the tail after the last are dropped), then you say what each rep shows from the list on its row. As many examples of each as you like. A brand-new move has nothing to find reps with yet, so it stays whole until the progress measure is set in step 4 — then <b>Split into reps</b> on its row.</p>
      <div class="st-grid wide-left"><div class="stack">
        <div class="stage ${rec.mirror ? 'mirror' : ''}" id="stage"><video id="cam" playsinline muted autoplay></video><canvas id="cam-canvas"></canvas><div class="status" id="cam-status">Camera off</div></div>
        <div class="row"><button class="btn primary" id="btn-cam">Start camera</button><button class="btn ghost" id="btn-flip" title="Mirror the preview">Mirror</button><button class="btn ghost" id="btn-file" title="One long video with several reps in it — the Studio cuts it into reps for you to describe">Upload a video…</button><input type="file" id="file-input" accept="video/*" hidden><span class="spacer"></span><label class="row" style="gap:6px;font-size:.9rem"><input type="checkbox" id="keep-video" ${rec.keepVideo ? 'checked' : ''}> keep video</label></div>
        <div class="card"><div class="row" style="align-items:baseline"><h3>Takes <span class="muted" style="font-weight:500">· ${state.takes.length}</span></h3><span class="spacer"></span>${state.takes.some((t) => shows(t, 'todo')) ? `<button class="btn secondary small" id="describe-reps" title="Plays each undescribed rep and waits for you to say what it shows">Play and describe ${state.takes.filter((t) => shows(t, 'todo')).length} reps</button>` : ''}</div><div class="takes" id="takes">${takesList()}</div></div>
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
      const canSplit = ex && ex.type === 'reps' && sim && !sim.error && sim.reps.length >= 2 && !t.origin;
      return `<div class="take" data-id="${t.id}"><button type="button" class="lbl ${labelOf(t)}" data-act="say" aria-label="What this take shows — tap to change">${esc(saidText(t))}</button>
        <div><div class="meta">${t.origin ? `rep ${t.origin.rep} of ${t.origin.of}${t.origin.full === false ? ' (partial)' : ''} · ` : ''}${t.side ? (t.side === 'L' ? 'left' : 'right') + ' · ' : ''}${(t.durationMs / 1000).toFixed(1)} s · ${t.frames.length} frames${t.video ? ' · video' : ''}${t.note ? ' · ' + esc(t.note) : ''}</div><div class="sim">${simText}${fired.length ? ` · fired: ${fired.map(esc).join(', ')}` : sim && !sim.error ? ' · no faults' : ''}</div></div>
        <div class="acts">${canSplit ? `<button class="btn secondary small" data-act="split" title="One take per rep, each labelled on its own">Split into ${sim.reps.length} reps</button>` : ''}<button class="btn ghost small" data-act="play">Play</button><button class="btn ghost small" data-act="note">Note</button><button class="btn ghost small" data-act="del">✕</button></div></div>`;
    }).join('');
  }
  /* How many of each kind of take there are. The numbers are a floor, not a quota: more examples
     make a better threshold, so a row that is past its target says how many there are and stops
     counting against anything. */
  function coverage() {
    const s = cur(); const ex = currentExercise(); const n = (fn) => state.takes.filter(fn).length;
    const todo = n((t) => shows(t, 'todo'));
    const rows = [['Clean', n((t) => shows(t, 'clean')), 2], ['Borderline', n((t) => shows(t, 'borderline')), 2], ['Awkward set-up', n((t) => shows(t, 'setup')), 1]];
    for (const f of (s ? s.faults : (ex ? ex.faults : []))) rows.push(['Fault: ' + f.label, n((t) => shows(t, 'fault:' + f.id)), 1]);
    if ((s && s.sided) || (ex && ex.sided)) rows.push(['Left', n((t) => t.side === 'L'), 1], ['Right', n((t) => t.side === 'R'), 1]);
    const cell = ([l, c, want]) => `<span class="${c >= want ? 'ok' : c ? 'warn' : ''}">${esc(l)} ${c >= want ? `${c} ✓` : `${c} of ${want}`}</span>`;
    return `<div class="fires">${todo ? `<span class="bad">${todo} rep${todo > 1 ? 's' : ''} not described yet</span>` : ''}${rows.map(cell).join('')}</div>`;
  }
  function editCopy(id) {
    const ex = builtin(id); if (!ex || !ex.catalog) return;
    try { const s = entryToSpec(ex); state.moves[s._key] = s; state.current = s._key; state.step = 'describe'; saveState(); loadTakes().then(render); toast('Editing ' + ex.name + ' — nothing is written until step 7 saves it'); }
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
    if ($('describe-reps')) $('describe-reps').onclick = () => reviewReps(state.takes.filter((t) => shows(t, 'todo')));
    $('takes').onclick = async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return; const id = b.closest('.take').dataset.id; const t = state.takes.find((x) => x.id === id);
      if (b.dataset.act === 'del') { if (!confirm('Delete this take?')) return; await idb.del(id); state.takes = state.takes.filter((x) => x.id !== id); resim(); render(); }
      if (b.dataset.act === 'note') { const n = prompt('Note for this take (what was different, what to look for):', t.note || ''); if (n !== null) { t.note = n; await idb.put(t); render(); } }
      if (b.dataset.act === 'play') openPlayer(t);
      if (b.dataset.act === 'say') sayOnTake(b, t);
      if (b.dataset.act === 'split') await splitTake(t);
    };

    if (rec.stream || MOCK) restoreCam();
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    if (!$('player').hidden) {   /* in the player: space plays, 1–9 say what the rep shows, S skips it */
      if (e.code === 'Space') { e.preventDefault(); playerPlay(!pl.playing); return; }
      if (pl.queue) {
        const btns = [...document.querySelectorAll('#pl-classify button[data-say]')]; const n = /^Digit([1-9])$/.exec(e.code);
        const b = n ? btns[+n[1] - 1] : e.code === 'KeyS' ? document.querySelector('#pl-classify [data-say-skip]') : e.code === 'Enter' ? document.querySelector('#pl-classify [data-next]') : null;
        if (b) { e.preventDefault(); b.click(); }
      }
      return;
    }
    if (state.step !== 'record') return;
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
      rec.fileMode = false; camSmoother.reset(); $('btn-cam').textContent = 'Stop camera'; $('btn-rec').disabled = false; status('Live — stand in the start position');
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
    drawSkeleton(ctx, smoothedFor(camSmoother, lm, now, W / H), W, H, rec.on ? '#ff2e88' : '#fff3e2');
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
  /* One long take with every rep in it → one take per rep. The rep boundaries are the ones the
     engine found (a rep ends when the progress reading drops back to rest), so this needs the
     progress measure from step 4. Each new take keeps the parent's still start in front of its
     rep, so it calibrates exactly as the parent did, and remembers where its rep sits in the
     parent's video. The parent is removed: its reps would otherwise be counted twice. */
  const PAD = 250;                                    // a moment either side of a rep, so nothing is clipped
  const STILL_KEEP = 1500;   // ms of the still hold kept in front of each rep cut out of a longer take
  /* Cut one long recording into its reps. The boundaries are the engine's own: a rep ends when the
     progress reading drops back to rest, and began one duration earlier — so each take holds the
     rep and nothing else. The lead-in before the first rep and the tail after the last are not
     reps and do not become takes; they are counted and reported as set-up and wind-down. Every
     rep keeps the parent's still start in front of it, so it calibrates exactly as the parent did,
     and remembers where it sits in the parent's video. */
  function repCuts(take, sim) {
    if (!sim || sim.error || !sim.reps || !sim.reps.length) return null;
    const calT = take.calT ?? 1200, last = take.durationMs;
    const cuts = sim.reps.map((r) => {
      const dur = (r.rep && r.rep.duration) || 0;
      return { t0: Math.max(calT, r.t - dur - PAD), t1: Math.min(last, r.t + PAD), full: !!r.full };
    }).filter((c) => c.t1 - c.t0 > 200);
    if (!cuts.length) return null;
    return { cuts, setupMs: Math.max(0, cuts[0].t0 - (sim.calT ?? calT)), tailMs: Math.max(0, last - cuts[cuts.length - 1].t1) };
  }
  async function splitTake(t, { quiet = false } = {}) {
    const sim = state.sims[t.id];
    const cut = repCuts(t, sim);
    if (!cut || cut.cuts.length < 2) { if (!quiet) toast(sim && sim.reps && sim.reps.length === 1 ? 'Only one rep found in this take' : 'No reps found yet — set the progress measure in step 4, then split'); return 0; }
    /* the still hold before the set (the last STILL_KEEP ms before calibration, not the walking-in
       before it) goes in front of every rep, re-timed to start at 0, so each calibrates as the set did */
    const calT = t.calT ?? 1200; const still = t.frames.filter((f) => f[0] < calT && f[0] >= calT - STILL_KEEP);
    if (!still.length) { if (!quiet) toast('This take has no still start to calibrate each rep from'); return 0; }
    const n = cut.cuts.length;
    if (!quiet && !confirm(`Split into ${n} reps? Each becomes its own take for you to describe; the ${(cut.setupMs / 1000).toFixed(1)} s of set-up before the first rep and ${(cut.tailMs / 1000).toFixed(1)} s after the last are dropped. The whole take is replaced.`)) return 0;
    const kids = cutKids(t, cut.cuts, still);
    if (!kids.length) { if (!quiet) toast('Could not cut the reps out of this take'); return 0; }
    for (const k of kids) await idb.put(k);
    await idb.del(t.id);
    state.takes = state.takes.filter((x) => x.id !== t.id).concat(kids).sort((a, b) => a.created - b.created);
    resim(); render();
    toast(`${kids.length} reps — now say what each one shows`, 4000);
    return kids.length;
  }
  /* one take per cut: the still hold, then the rep, re-timed to start at 0 and remembering where it
     sits in the parent's video */
  function cutKids(t, cuts, still) {
    const calT = t.calT ?? 1200, s0 = still[0][0], kidCal = calT - s0, n = cuts.length;
    return cuts.map((c, i) => {
      const seg = t.frames.filter((f) => f[0] >= c.t0 && f[0] <= c.t1);
      const frames = [...still.map((f) => [f[0] - s0, f[1]]), ...seg.map((f) => [kidCal + (f[0] - c.t0), f[1]])];
      /* a take that already said what it shows keeps saying it; one cut out of a mixed video does not
         pretend to be clean — "not said yet" is excluded from every count until the physio says */
      const labels = !shows(t, 'todo') && t.origin ? labelsOf(t) : (n > 1 ? ['todo'] : labelsOf(t));
      return { id: uid(), moveId: t.moveId, label: labels[0], labels, side: t.side, note: t.note || '', aspect: t.aspect, frames, video: t.video || null, videoT0: c.t0, videoS0: s0, source: t.source, created: t.created + i + 1, durationMs: frames[frames.length - 1][0], calT: kidCal, origin: { take: t.id, rep: i + 1, of: n, full: c.full } };
    }).filter((k) => k.frames.length > still.length + 4);
  }
  async function saveTake(frames, aspect, video, source = 'camera') {
    if (frames.length < 10) { toast('Too short — nothing saved'); return; }
    const settled = source === 'file' ? settleAt(frames, aspect) : null;
    if (source === 'file' && settled == null) toast('No still start found in this video — calibrating 1.2 s in. Hold the start position for a second before the first rep next time.', 6000);
    const take = { id: uid(), moveId: moveKey(), label: rec.label, labels: [rec.label], side: rec.side, note: '', aspect, frames, video, source, created: Date.now(), durationMs: frames[frames.length - 1][0], calT: settled ?? 1200 };
    await idb.put(take); state.takes.push(take); resim(); toast(`Saved ${LABELS[rec.label] || rec.label} take — ${(take.durationMs / 1000).toFixed(1)} s`); render();
    return take;
  }
  /* Run the pose model over a video file the physio recorded on a phone. The file is stepped
     through, one seek per frame, rather than played: played at its own pace, a phone that detects
     slower than the video runs skips most of the frames, and a set that is mostly gaps calibrates
     on the wrong moment and splits into the wrong reps. Every phone reads the same frames this way. */
  const FILE_STEP = 40;   // ms between the frames read from a file — 25 a second, about what the live camera gets
  /* Step through a video file with the pose model: one seek per frame, waited for, so every phone
     reads the same frames. preview: a canvas to draw the skeleton on as it goes; stop: asked each
     frame, true ends the read. Resolves to { frames, aspect } in the take format. */
  async function readVideoFrames(file, { status = () => { }, preview = null, stop = () => false } = {}) {
    await loadModel(status);
    const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.src = URL.createObjectURL(file);
    try {
      await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('Could not decode this video (try MP4/H.264).')); });
      const W = video.videoWidth, H = video.videoHeight; if (preview) { preview.width = W; preview.height = H; }
      const ctx = preview ? preview.getContext('2d') : null;
      const frames = []; const dur = video.duration; const clock0 = Math.ceil(performance.now()); const sm = new E.PoseSmoother();
      const seek = (t) => new Promise((res) => { if (Math.abs(video.currentTime - t) < 1e-3) return res(); const to = setTimeout(res, 1500); video.onseeked = () => { clearTimeout(to); res(); }; video.currentTime = t; });
      for (let t = 0.001; t < dur; t += FILE_STEP / 1000) {
        await seek(t);
        if (stop()) throw new Error('Analysis stopped');
        const ms = Math.round(video.currentTime * 1000);
        const lm = MOCK ? (window.__mockFile ? window.__mockFile(ms) : null) : detect(video, clock0 + ms);
        if (ctx) { ctx.clearRect(0, 0, W, H); drawSkeleton(ctx, smoothedFor(sm, lm, ms, W / H), W, H, '#ff2e88'); }
        frames.push([ms, lm ? lm.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.z ?? 0).toFixed(3), +(l.visibility ?? 1).toFixed(2)]) : null]);
        status(`Analyzing… ${video.currentTime.toFixed(1)} / ${dur.toFixed(1)} s`);
      }
      return { frames, aspect: W / H };
    } finally { URL.revokeObjectURL(video.src); video.removeAttribute('src'); video.load(); }
  }
  /* A video the physio recorded on a phone becomes takes: one long video is a set, not a rep, so if
     the move already knows what it measures it is cut into its reps and each is played for the
     physio to say what it shows; otherwise it stays whole and step 4 offers the cut once the
     measure is set. */
  async function analyzeFile(file) {
    const status = (t) => { const el = $('cam-status'); if (el) el.textContent = t; };
    try {
      stopCam(); rec.fileMode = true;
      const { frames, aspect } = await readVideoFrames(file, { status, preview: $('cam-canvas'), stop: () => !rec.fileMode });
      const take = await saveTake(frames, aspect, rec.keepVideo ? file : null, 'file');
      if (!take) { status('Camera off'); return; }
      const n = await splitTake(take, { quiet: true });
      status(n ? `Analysed — ${n} reps to describe` : 'Analysed — set the progress measure in step 4, then Split into reps');
      if (n > 1) reviewReps(state.takes.filter((t) => t.origin && t.origin.take === take.id && shows(t, 'todo')));
    } catch (e) { status('Failed: ' + e.message); toast(e.message, 5000); }
  }

  /* ---------- check: a video the takes have never seen, and what the coach would say about it ---------- */
  /* Nothing here is saved: the reps and their verdicts live in memory for this session, so a
     physio can throw a fresh video at the finished move and see whether the coach agrees with them. */
  const check = { name: '', whole: null, reps: [], busy: false, status: '' };
  const firedOf = (sim) => !sim || sim.error ? [] : [...new Set(Object.keys(sim.faultSpans || {}).filter((id) => sim.faultSpans[id].length).concat(Object.keys(sim.repFaults || {}).filter((id) => sim.repFaults[id] > 0)))];
  async function checkFile(file) {
    const status = (t) => { check.status = t; const el = $('check-status'); if (el) el.textContent = t; };
    const ex = currentExercise(); if (!ex) { toast('The move does not compile yet — fix the problems above first'); return; }
    try {
      check.busy = true; check.name = file.name; check.whole = null; check.reps = []; render();
      const { frames, aspect } = await readVideoFrames(file, { status });
      const settled = settleAt(frames, aspect);
      const whole = { id: 'check_' + uid(), moveId: moveKey(), label: 'check', side: rec.side, note: '', aspect, frames, video: file, source: 'check', created: Date.now(), durationMs: frames[frames.length - 1][0], calT: settled ?? 1200 };
      const sim = simulate(ex, whole);
      const cut = repCuts(whole, sim); const calT = whole.calT;
      const still = frames.filter((f) => f[0] < calT && f[0] >= calT - STILL_KEEP);
      const kids = cut && still.length ? cutKids(whole, cut.cuts, still) : [];
      check.whole = { take: whole, sim, settled: settled != null };
      check.reps = kids.map((k) => ({ take: k, sim: simulate(ex, k), say: { label: '', labels: [] } }));
      status(kids.length ? `${kids.length} reps found` : sim && sim.reps && sim.reps.length === 1 ? 'One rep found' : 'No reps found');
    } catch (e) { status('Failed: ' + e.message); toast(e.message, 5000); }
    finally { check.busy = false; render(); }
  }
  function checkPanel(s) {
    const faults = (s && s.faults) || []; const fl = (id) => { const f = faults.find((x) => x.id === id); return f ? f.label : id; };
    let body = '';
    if (check.whole) {
      const w = check.whole, sim = w.sim, rv = sim && sim.review;
      /* the coach agrees when it called every fault the physio named and nothing they did not:
         a rep said to lean and rush has to fire both, a clean one none, a non-rep should not count */
      const agree = (r) => {
        const said = labelsOf(r.say).filter(Boolean); if (!said.length) return null;
        const fired = firedOf(r.sim), want = said.filter((v) => v.startsWith('fault:')).map((v) => v.slice(6));
        if (said.includes('notrep')) return !(r.sim && r.sim.full);
        if (said.includes('clean')) return fired.length === 0;
        if (!want.length) return null;
        return want.every((id) => fired.includes(id)) && fired.every((id) => want.includes(id));
      };
      const judged = check.reps.filter((r) => agree(r) != null), agreed = judged.filter((r) => agree(r));
      body = `<p style="font-size:.92rem"><b>${esc(check.name)}</b> as one set: ${sim && !sim.error ? `<b>${sim.full}</b> rep${sim.full === 1 ? '' : 's'} counted${sim.partial ? `, ${sim.partial} partial` : ''}${rv ? ` · score ${rv.score} — ${esc(rv.headline)}` : ''}${rv && rv.faults && Object.keys(rv.faults).length ? ` · would cue: ${Object.values(rv.faults).map((f) => esc(f.fault.cue || f.fault.label)).join(', ')}` : ''}` : `<span class="muted">rule error: ${esc((sim && sim.error) || 'no simulation')}</span>`}${w.settled ? '' : ' · <span class="warn">no still start found — calibrated 1.2 s in</span>'}</p>
        ${check.reps.length ? `<table class="tune check"><thead><tr><th>rep</th><th>counted</th><th>the coach says</th><th>you say</th><th></th><th></th></tr></thead><tbody>${check.reps.map((r, i) => { const fired = firedOf(r.sim); const a = agree(r); return `<tr class="${a == null ? '' : a ? 'ok' : 'bad'}"><td>${i + 1}</td><td>${r.sim && !r.sim.error ? (r.sim.full ? 'full' : r.sim.partial ? 'partial' : '—') : '—'}</td><td>${fired.length ? fired.map(fl).map(esc).join(', ') : 'clean'}</td><td><button type="button" class="btn ghost small" data-check-say="${i}">${esc(labelsOf(r.say).filter(Boolean).map(labelText).join(' + ') || 'say…')}</button></td><td>${a == null ? '' : a ? '✓ agree' : labelsOf(r.say).includes('notrep') ? '✗ counted a non-rep' : '✗ disagree'}</td><td><button class="btn ghost small" data-check-play="${i}">Play</button></td></tr>`; }).join('')}</tbody></table>
        <p class="muted" style="font-size:.85rem">${judged.length ? `${agreed.length} of ${judged.length} agree with you.` : 'Say what each rep shows to see where the coach agrees with you.'} Nothing here is saved.</p>` : ''}`;
    }
    return `<div class="card"><h3>Check against another video</h3><p style="font-size:.92rem">Upload a video of the move the takes above have never seen — the Studio cuts it into reps and shows what the coach would say about each. Nothing is added to the takes.</p>
      <div class="row"><button class="btn secondary" id="check-btn" ${check.busy ? 'disabled' : ''}>Upload a video…</button><input type="file" id="check-file" accept="video/*" hidden><span class="muted" id="check-status" style="font-size:.9rem">${esc(check.status)}</span></div>
      <div id="check-out">${body}</div></div>`;
  }
  function wireCheck() {
    if (!$('check-btn')) return;
    $('check-btn').onclick = () => $('check-file').click();
    $('check-file').onchange = () => { const f = $('check-file').files[0]; $('check-file').value = ''; if (f) checkFile(f); };
    $('check-out').onclick = (e) => {
      const say = e.target.closest('button[data-check-say]');
      if (say) { const r = check.reps[+say.dataset.checkSay]; return openSayPop(say, r.say, (v) => { toggleLabel(r.say, v); if (r.say.label === 'todo') { r.say.label = ''; r.say.labels = []; } render(); }); }
      const b = e.target.closest('button[data-check-play]'); if (!b) return; const r = check.reps[+b.dataset.checkPlay]; state.sims[r.take.id] = r.sim; openPlayer(r.take, { play: true });
    };
  }

  /* What a rep shows, asked wherever it is listed: the same chips as the player's bar, as toggles,
     so a rep that leans AND rushes can say both. Clean, Not a rep and Not said yet clear the rest. */
  let sayPop = null;
  function closeSayPop() { sayPop = null; const el = $('say-pop'); if (el) { el.hidden = true; el.innerHTML = ''; } }
  function openSayPop(anchor, target, onChange) {
    const el = $('say-pop'); if (!el) return;
    sayPop = { target, onChange, anchorId: anchor.id || null };
    drawSayPop();
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth || 320, h = el.offsetHeight || 200;
    el.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left))) + 'px';
    el.style.top = Math.round(r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  }
  function drawSayPop() {
    const el = $('say-pop'); if (!el || !sayPop) return;
    const t = sayPop.target;
    el.innerHTML = `<div class="lm-pop-head"><b>What does this rep show?</b><button type="button" class="btn ghost small" data-say-close>Done</button></div>
      <div class="row say-chips">${takeLabels().map(([v, txt]) => `<button type="button" class="chip small ${v.startsWith('fault:') ? 'fault' : v}" data-say-v="${esc(v)}" aria-pressed="${shows(t, v)}">${esc(txt)}</button>`).join('')}</div>
      <p class="muted" style="font-size:.8rem;margin:6px 0 0">More than one fault is fine. Clean, Not a rep and Not said yet stand alone.</p>`;
    el.hidden = false;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sayPop) { e.preventDefault(); closeSayPop(); } });
  document.addEventListener('pointerdown', (e) => { if (sayPop && !e.target.closest('#say-pop') && !e.target.closest('[data-act="say"]') && !e.target.closest('[data-check-say]')) closeSayPop(); });
  document.addEventListener('click', (e) => {
    if (!sayPop) return;
    if (e.target.closest('[data-say-close]')) return closeSayPop();
    const b = e.target.closest('#say-pop [data-say-v]'); if (!b) return;
    sayPop.onChange(b.dataset.sayV); drawSayPop();
  });
  const sayOnTake = (btn, t) => openSayPop(btn, t, async (v) => { toggleLabel(t, v); await idb.put(t); render(); });

  /* ---------- player: scrub a take with the skeleton and the live metric readout ---------- */
  const pl = { take: null, raf: 0, playing: false, t: 0, url: null, queue: null, done: 0, total: 0 };
  function openPlayer(take, { play = false } = {}) {
    pl.take = take; pl.t = 0; pl.playing = false; $('player').hidden = false;
    $('pl-title').textContent = pl.queue ? `Rep ${take.origin ? take.origin.rep : pl.done + 1} of ${take.origin ? take.origin.of : pl.total} — what does it show?` : `${saidText(take)} · ${(take.durationMs / 1000).toFixed(1)} s`;
    const v = $('pl-video'); if (pl.url) { URL.revokeObjectURL(pl.url); pl.url = null; }
    if (take.video) { pl.url = URL.createObjectURL(take.video); v.src = pl.url; v.hidden = false; } else { v.hidden = true; v.removeAttribute('src'); }
    $('pl-scrub').value = 0; $('pl-play').textContent = 'Play'; classifyBar(); drawPlayerFrame();
    if (play) playerPlay(true);
  }
  function closePlayer() { $('player').hidden = true; pl.playing = false; pl.queue = null; cancelAnimationFrame(pl.raf); const v = $('pl-video'); v.pause(); $('pl-classify').hidden = true; }
  $('pl-close').onclick = closePlayer; $('player').onclick = (e) => { if (e.target === $('player')) closePlayer(); };
  /* Describing reps one by one: each undescribed rep plays once and waits, paused on its last
     frame, until the physio says what it shows or skips it; then the next one plays. */
  function reviewReps(takes) {
    const todo = takes.filter((t) => shows(t, 'todo')); if (!todo.length) { toast('Every rep has been described'); return; }
    pl.queue = todo.map((t) => t.id); pl.done = 0; pl.total = todo.length; nextInQueue();
  }
  function nextInQueue() {
    while (pl.queue && pl.queue.length) { const id = pl.queue.shift(); const t = state.takes.find((x) => x.id === id); if (t) { openPlayer(t, { play: true }); return; } }
    const left = state.takes.filter((t) => shows(t, 'todo')).length;
    closePlayer(); toast(left ? `${left} rep${left > 1 ? 's' : ''} still not said — Play and describe when you are ready` : 'Every rep described', 4000);
  }
  /* The bar under the paused rep. Every label is a toggle, because one rep can lean and rush at
     once; Clean and Not a rep stand alone, so they answer and move on in a single tap. Anything
     else waits for "Next rep" (or Enter), which is what makes a second fault possible. */
  function classifyBar() {
    const bar = $('pl-classify'); if (!pl.queue) { bar.hidden = true; bar.innerHTML = ''; return; }
    const t = state.takes.find((x) => x.id === pl.take.id) || pl.take;
    const labels = takeLabels().filter(([v]) => v !== 'todo');
    const said = labelsOf(t).filter((v) => v !== 'todo');
    bar.innerHTML = labels.map(([v, txt], i) => `<button class="chip small ${v.startsWith('fault:') ? 'fault' : v}" data-say="${esc(v)}" aria-pressed="${said.includes(v)}" title="key ${i + 1}">${esc(txt)}</button>`).join('')
      + `<span class="spacer"></span><span class="muted" id="pl-said">${said.length ? esc(said.map(labelText).join(' + ')) : 'nothing said yet'}</span>`
      + `<button class="btn ${said.length ? 'primary' : 'ghost'} small" data-next title="Enter">Next rep →</button><button class="btn ghost small" data-say-skip title="key S">Skip</button>`;
    bar.hidden = false;
  }
  $('pl-classify').onclick = async (e) => {
    if (!pl.take) return;
    if (e.target.closest('[data-say-skip]')) return nextInQueue();
    if (e.target.closest('[data-next]')) { const t = state.takes.find((x) => x.id === pl.take.id); if (t && !shows(t, 'todo')) pl.done++; return nextInQueue(); }
    const b = e.target.closest('button[data-say]'); if (!b) return;
    const t = state.takes.find((x) => x.id === pl.take.id); if (!t) return;
    const v = b.dataset.say; toggleLabel(t, v);
    /* the chips are updated in place rather than rebuilt: a bar that replaces itself between two
       taps swallows the second one, which is the whole point of letting a rep say two things */
    refreshSayBar(t); await idb.put(t); render();
    if (EXCLUSIVE.includes(v)) { pl.done++; nextInQueue(); }   /* nothing shares a rep with these two */
  };
  function refreshSayBar(t) {
    const bar = $('pl-classify'); if (!bar || bar.hidden) return;
    const said = labelsOf(t).filter((v) => v !== 'todo');
    bar.querySelectorAll('button[data-say]').forEach((c) => c.setAttribute('aria-pressed', said.includes(c.dataset.say)));
    const txt = $('pl-said'); if (txt) txt.textContent = said.length ? said.map(labelText).join(' + ') : 'nothing said yet';
    const next = bar.querySelector('[data-next]'); if (next) { next.classList.toggle('primary', !!said.length); next.classList.toggle('ghost', !said.length); }
  }
  function playerPlay(on) {
    if (on === pl.playing) return;
    pl.playing = on; $('pl-play').textContent = on ? 'Pause' : 'Play'; const v = $('pl-video');
    if (on) { if (pl.t >= pl.take.durationMs) pl.t = 0; pl.wall = performance.now() - pl.t; if (!v.hidden) { v.currentTime = videoTime(pl.take, pl.t) / 1000; v.play().catch(() => { }); } pl.raf = requestAnimationFrame(playTick); }
    else { v.pause(); cancelAnimationFrame(pl.raf); }
  }
  /* a take cut out of a longer recording keeps that recording's video: its still start is the video's
     start, and its rep sits at videoT0 */
  /* where a moment of a take sits in its video: a rep cut out of a longer video keeps the parent's
     still hold in front of it (from videoS0) and its own frames from videoT0 */
  const videoTime = (take, t) => { const calT = take.calT ?? 1200; return take.videoT0 == null ? t : t < calT ? t + (take.videoS0 || 0) : t - calT + take.videoT0; };
  $('pl-scrub').oninput = (e) => { pl.t = (+e.target.value / 1000) * pl.take.durationMs; pl.playing = false; const v = $('pl-video'); if (!v.hidden) { v.pause(); v.currentTime = videoTime(pl.take, pl.t) / 1000; } drawPlayerFrame(); };
  $('pl-play').onclick = () => playerPlay(!pl.playing);
  function playTick(now) { if (!pl.playing) return; pl.t = now - pl.wall; const calT = pl.take.calT ?? 1200; const v = $('pl-video'); if (pl.take.videoT0 != null && !v.hidden && pl.t >= calT && pl.t - 40 < calT) v.currentTime = videoTime(pl.take, pl.t) / 1000;   /* jump from the still start to the rep */ if (pl.t >= pl.take.durationMs) { pl.t = pl.take.durationMs; pl.playing = false; $('pl-play').textContent = 'Play'; v.pause(); } $('pl-scrub').value = Math.round(1000 * pl.t / pl.take.durationMs); drawPlayerFrame(); if (pl.playing) pl.raf = requestAnimationFrame(playTick); }
  function drawPlayerFrame() {
    const take = pl.take; const c = $('pl-canvas'); const aspect = take.aspect || 16 / 9; const W = 960, H = Math.round(960 / aspect); if (c.width !== W) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, W, H);
    let i = 0; while (i < take.frames.length - 1 && take.frames[i + 1][0] <= pl.t) i++;
    const lm = smoothedTake(take)[i]; const sim = state.sims[take.id]; const ex = currentExercise();
    let focus = []; if (ex && sim && sim.session && sim.session.m && sim.session.m.focus) focus = sim.session.m.focus;
    if (!take.video) { ctx.fillStyle = '#7a3fb8'; ctx.fillRect(0, 0, W, H); }
    drawSkeleton(ctx, lm, W, H, '#fff3e2', focus);
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
      <div class="lms">${Array.from({ length: n }, (_, i) => { const what = m.kind === 'offset' && i === 2 ? 'point' : m.kind === 'angle' && i === 1 ? 'joint' : 'point ' + (i + 1); return `<button type="button" class="slot ${m.pts[i] ? 'filled' : ''}" data-slot="${i}" data-what="Which ${esc(what)}?" aria-pressed="false">${m.pts[i] ? esc(lmWord(m.pts[i])) : esc(m.kind === 'offset' && i === 2 ? 'point' : m.kind === 'angle' && i === 1 ? 'joint' : 'pick…')}</button>`; }).join('')}</div></div>
      <div class="help">${esc(kind.help)}</div>
      ${metricExtras(m)}
    </div>`;
  }
  /* Which joint goes in a slot is asked for when the slot is clicked, not before: the list of
     every landmark standing open under a measurement that is already filled in is noise, and on a
     phone it pushes the chart off the screen. One popover, moved to whichever slot is being
     filled, and it walks itself on to the next empty slot so a three-point angle is three taps. */
  const lmPop = { path: null, slot: 0 };
  function closeLmPop() { lmPop.path = null; const el = $('lm-pop'); if (el) { el.hidden = true; el.innerHTML = ''; } }
  function openLmPop(box, slotBtn) {
    const el = $('lm-pop'); if (!el) return;
    lmPop.path = box.dataset.mpath; lmPop.slot = +slotBtn.dataset.slot;
    el.innerHTML = `<div class="lm-pop-head"><b>${esc(slotBtn.dataset.what || 'Which point?')}</b><button type="button" class="btn ghost small" data-lm-close>Close</button></div>
      <div class="lm-pick">${LM_GROUPS.map(([h, names]) => `<div><div class="col-h">${h}</div>${names.map((nm) => `<button type="button" data-lm="${nm}">${esc(lmWord(nm))}</button>`).join('')}</div>`).join('')}</div>`;
    el.hidden = false;
    const r = slotBtn.getBoundingClientRect(), w = el.offsetWidth || 320, h = el.offsetHeight || 260;
    el.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left))) + 'px';
    el.style.top = Math.round(r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    box.querySelectorAll('.slot').forEach((c) => c.setAttribute('aria-pressed', c === slotBtn));
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lmPop.path) { e.preventDefault(); closeLmPop(); } });
  document.addEventListener('pointerdown', (e) => { if (lmPop.path && !e.target.closest('#lm-pop') && !e.target.closest('.slot')) closeLmPop(); });
  const SEGMENTS = [['torso', 'torso'], ['height', 'their height'], ['SH-EL', 'upper arm'], ['EL-WR', 'forearm'], ['HIP-KNEE', 'thigh'], ['KNEE-ANK', 'shin'], ['SH-oSH', 'shoulder width'], ['HIP-oHIP', 'hip width'], ['EAR-oEAR', 'ear to ear'], ['SH-HIP', 'trunk']];
  const PCT = ['dist', 'rise', 'height', 'ratio', 'gap', 'rotation', 'near'];
  /* the measurement's extras: what a % is of, which way is +, ignore the sign, negate for an option value */
  function metricExtras(m) {
    const spec = cur(); const opts = (spec && spec.options || []).filter((o) => Array.isArray(o.values) && o.values.length);
    const per = Array.isArray(m.per) ? m.per.join('-') : (m.per === 'height' ? 'height' : 'torso');
    const parts = [];
    if (PCT.includes(m.kind)) parts.push(`<label class="mini">% of <select data-mk="per">${SEGMENTS.map(([v, l]) => `<option value="${v}" ${v === per ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`);
    /* a share of the person's height can be read as a real length, using the height they set in the app */
    if (PCT.includes(m.kind) && per === 'height') parts.push(`<label class="mini">read in <select data-mk="unit"><option value="" ${!m.unit ? 'selected' : ''}>% of height</option><option value="in" ${m.unit === 'in' ? 'selected' : ''}>inches</option><option value="cm" ${m.unit === 'cm' ? 'selected' : ''}>centimetres</option></select></label>`);
    if (['gap', 'rotation', 'lean'].includes(m.kind)) parts.push(`<label class="mini">+ is <select data-mk="sign"><option value="outward" ${m.sign !== 'forward' ? 'selected' : ''}>away from the midline (front view)</option><option value="forward" ${m.sign === 'forward' ? 'selected' : ''}>the way the toes point (side view)</option></select></label>`);
    if (!['angle', 'ratio', 'dist', 'near', 'rise'].includes(m.kind)) parts.push(`<label class="mini"><input type="checkbox" data-mk="abs" ${m.abs ? 'checked' : ''}> ignore the sign</label>`);
    if (opts.length) parts.push(`<label class="mini">negate when <select data-mk="flip"><option value="">never</option>${opts.flatMap((o) => o.values.map((v) => `<option value="${esc(o.key + '=' + v)}" ${m.flip && m.flip.option === o.key && String(m.flip.when) === String(v) ? 'selected' : ''}>${esc(o.label)} = ${esc((o.labels || {})[v] || v)}</option>`)).join('')}</select></label>`);
    return parts.length ? `<div class="row extras">${parts.join('')}</div>` : '';
  }
  function wireMetricEditors(root, s, after) {
    root.querySelectorAll('[data-mpath]').forEach((box) => {
      const get = () => box.dataset.mpath.split('.').reduce((o, k) => o[k], s);
      box.querySelectorAll('[data-mk]').forEach((el) => { el.onchange = () => { const m = get(); const k = el.dataset.mk;
        if (k === 'per') { if (el.value === 'torso') delete m.per; else if (el.value === 'height') m.per = 'height'; else m.per = el.value.split('-'); if (m.per !== 'height') delete m.unit; }
        if (k === 'unit') { if (!el.value) delete m.unit; else m.unit = el.value; }
        if (k === 'sign') { if (el.value === 'outward') delete m.sign; else m.sign = el.value; }
        if (k === 'abs') { if (el.checked) m.abs = true; else delete m.abs; }
        if (k === 'flip') { if (!el.value) delete m.flip; else { const [option, when] = el.value.split('='); const o = (s.options || []).find((x) => x.key === option); const v = o && o.values.find((x) => String(x) === when); m.flip = { option, when: v === undefined ? when : v }; } }
        saveState(); after(); }; });
      box.querySelector('[data-mkind]').onchange = (e) => { const m = get(); m.kind = e.target.value; m.pts = m.pts.slice(0, SPEC.KINDS[m.kind].n); closeLmPop(); saveState(); after(); };
      box.querySelectorAll('.slot').forEach((b) => { b.onclick = () => (lmPop.path === box.dataset.mpath && lmPop.slot === +b.dataset.slot ? closeLmPop() : openLmPop(box, b)); });
      /* the picker is one element outside the panel, so it survives the re-render a pick causes */
      if (lmPop.path === box.dataset.mpath) { const b = box.querySelector(`.slot[data-slot="${lmPop.slot}"]`); if (b) openLmPop(box, b); else closeLmPop(); }
    });
    const pop = $('lm-pop'); if (!pop) return;
    pop.onclick = (e) => {
      if (e.target.closest('[data-lm-close]')) return closeLmPop();
      const b = e.target.closest('[data-lm]'); if (!b || !lmPop.path) return;
      const box = root.querySelector(`[data-mpath="${lmPop.path}"]`); if (!box) return closeLmPop();
      const m = lmPop.path.split('.').reduce((o, k) => o[k], s); const n = SPEC.KINDS[m.kind].n;
      m.pts[lmPop.slot] = b.dataset.lm; m.pts = m.pts.slice(0, n);
      /* on to the next point that still needs one; when they are all filled the picker is done */
      let next = -1; for (let i = 0; i < n; i++) { const j = (lmPop.slot + 1 + i) % n; if (!m.pts[j]) { next = j; break; } }
      if (next < 0) closeLmPop(); else lmPop.slot = next;
      saveState(); after();
    };
  }
  function takeSeries(metric, rel) {
    return state.takes.filter(usable).map((t) => { let d = trace(metric, t, t.side); if (rel === 'change') { const c = d.find((x) => x[0] >= (t.calT ?? 1200)); const base = c ? c[1] : 0; d = d.map(([tt, v]) => [tt, v - base]); } return { take: t, data: d, color: COLORS[labelOf(t)] || COLORS.other, alpha: labelOf(t) === 'clean' ? 1 : 0.75 }; });
  }
  const legend = () => `<div class="legend"><span><i style="background:${COLORS.clean}"></i>clean</span><span><i style="background:${COLORS.fault}"></i>fault takes</span><span><i style="background:${COLORS.borderline}"></i>borderline</span><span><i style="background:${COLORS.setup}"></i>awkward set-up</span></div>`;

  /* ---------- the limbs that stay put ----------
     The target line drawn over the camera has to know which end of the movement is the anchor. It
     can work that out by watching — but not on the first rep, and not when both ends move a little.
     Told outright, it is right from the first frame. */
  const STABLE_PTS = ['SH', 'EL', 'WR', 'HIP', 'KNEE', 'ANK', 'HEEL', 'FOOT', 'oSH', 'oHIP', 'oKNEE', 'oANK'];
  function stableCard(s) {
    const on = new Set(s.stable || []);
    return `<div class="card"><h3>Which parts stay still</h3>
      <p class="muted" style="font-size:.85rem;margin-bottom:8px">The points the person is resting on, that do not travel during the movement — the shoulder and knee in a bridge, the hip in a knee extension. The target line is pinned to them. Leave it empty and the coach works it out by watching.</p>
      <div class="opts" id="stable-pts">${STABLE_PTS.map((n) => `<button type="button" class="chip small" data-st="${n}" aria-pressed="${on.has(n)}">${esc(LM_WORDS[n] || LM_WORDS[n.slice(1)] && ('other ' + LM_WORDS[n.slice(1)]) || n)}</button>`).join('')}</div></div>`;
  }
  function wireStable(s, root) {
    root.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => {
      const n = b.dataset.st; const on = new Set(s.stable || []);
      if (on.has(n)) on.delete(n); else on.add(n);
      s.stable = STABLE_PTS.filter((x) => on.has(x)); saveState(); render();
    }; });
  }
  /* ---------- what the coach says, and when ----------
     Every moment the coach speaks on its own account. A move may keep the usual words, put its own
     in their place, or have it say nothing there at all. */
  const STAGE_WORDS = [
    ['opening', 'The opening brief', 'as the camera opens'],
    ['position', 'Get into frame', 'while they are not in shot'],
    ['start', 'Start-position faults', 'before the count-in'],
    ['show', 'Asking for the end position', 'only if the move asks for one'],
    ['countIn', 'The count-in', '3, 2, 1'],
    ['go', 'Go', 'as the set begins'],
    ['count', 'The rep number', 'after each full rep'],
    ['praise', 'The word for a clean rep', 'a list to draw from'],
    ['partial', 'A rep that did not count', ''],
    ['fault', 'The live fault cues', 'the cues written on step 5'],
    ['mark', 'A hold’s seconds', 'halfway, then the last few'],
    ['enter', 'Get into the hold position', ''],
    ['finish', 'The summary', 'at the end of the set'],
    ['lost', 'Cannot see you', ''],
    ['turn', 'Turn back to the camera', ''],
  ];
  const LISTY = { praise: 'Nice, Good rep, Clean', mark: '10, 5, 3, 2, 1' };
  function cuesCard(s) {
    const c = s.cues || {};
    const rows = STAGE_WORDS.filter(([k]) => {
      if (s.type === 'reps') return k !== 'mark' && k !== 'enter';
      return k !== 'count' && k !== 'praise' && k !== 'partial' && k !== 'countIn';
    }).map(([k, label, hint]) => {
      const v = c[k]; const off = v === false;
      const words = typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : '';
      return `<div class="cue-row" data-cue="${k}"><div class="row" style="gap:8px;align-items:baseline">
        <button type="button" class="chip small" data-cueon="${k}" aria-pressed="${!off}">${off ? 'silent' : 'says it'}</button>
        <strong style="font-size:.9rem">${esc(label)}</strong>${hint ? `<span class="muted" style="font-size:.8rem">${esc(hint)}</span>` : ''}</div>
        ${off ? '' : `<input type="text" data-cuetext="${k}" value="${esc(words)}" placeholder="${esc(LISTY[k] ? LISTY[k] : 'the usual words')}" style="margin-top:4px">`}</div>`;
    }).join('');
    return `<div class="card"><h3>What the coach says, and when</h3>
      <p class="muted" style="font-size:.85rem;margin-bottom:8px">Every moment the coach speaks for itself, besides the faults. Leave a box empty for the usual words, type your own to replace them, or turn the moment off. ${s.type === 'reps' ? 'A set of twenty rarely wants every rep counted aloud.' : 'A slow stretch rarely wants a countdown.'}</p>
      <div class="stack cue-rows">${rows}</div></div>`;
  }
  function wireCues(s, root) {
    root.querySelectorAll('[data-cueon]').forEach((b) => { b.onclick = () => {
      const k = b.dataset.cueon; s.cues = s.cues || {};
      if (s.cues[k] === false) delete s.cues[k]; else s.cues[k] = false;
      saveState(); render();
    }; });
    root.querySelectorAll('[data-cuetext]').forEach((el) => { el.oninput = () => {
      const k = el.dataset.cuetext; s.cues = s.cues || {};
      const t = el.value.trim();
      if (!t) delete s.cues[k];
      else if (LISTY[k]) s.cues[k] = k === 'mark' ? t.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0) : t.split(/\s*,\s*/).filter(Boolean);
      else s.cues[k] = t;
      if (LISTY[k] && !(s.cues[k] || []).length) delete s.cues[k];
      saveState();
    }; });
  }

  /* ===================== 4 · measure ===================== */
  function measurePanel(s) {
    const noTakes = !state.takes.length;
    const head = `<div class="stack"><h2>4 · ${s.type === 'reps' ? 'The one number that is progress' : 'What counts as being in position'}</h2>`;
    if (s.type === 'reps') {
      const pr = s.progress; const romOpt = (s.options || []).find((o) => o.key === 'rom');
      return head + `<p class="lead">Pick the joint angle or distance that goes from its start value to a target on every good rep. Measure it from the segment that <i>defines</i> the movement: for a shoulder raise that is shoulder→elbow, not shoulder→wrist, or a bent elbow reads as a lower raise.</p>
        <div class="st-grid wide-left"><div class="stack">
          <div class="card"><h3>Measurement</h3>${metricEditor('progress.metric', pr.metric)}
            ${(pr.and || []).map((a, i) => `<div class="also" data-ai="${i}"><div class="row" style="align-items:baseline"><h4 style="margin:10px 0 4px">And</h4><span class="spacer"></span><button class="btn ghost small" data-delalso="${i}">✕</button></div>
              ${metricEditor(`progress.and.${i}.metric`, a.metric)}
              <div class="row" style="gap:10px;margin-top:6px">${field('Start value', chips(`progress.and.${i}.startMode`, ['calibrated', 'fixed'], a.start === 'calibrated' ? 'calibrated' : 'fixed', { calibrated: 'Read at calibration', fixed: 'Fixed' }))}${field('Target', `<input type="number" step="1" data-k="progress.and.${i}.targetNum" value="${esc(typeof a.target === 'number' ? a.target : '')}" style="width:100px">`)}</div></div>`).join('')}
            <div class="row" style="margin-top:10px"><button class="btn ghost small" id="add-also">Add another measurement</button>${(pr.and || []).length ? field('A rep is through when', chips('progress.combine', ['min', 'mean', 'max'], pr.combine || 'min', { min: 'every measurement is', mean: 'they average out', max: 'any one of them is' })) : ''}</div>
            <p class="muted" style="font-size:.85rem;margin-top:6px">A movement is not always one angle. A squat is the knee bending <b>and</b> the hip folding, and a rep that does one without the other is not the exercise. Each measurement gets its own start and target; “every measurement is” means the rep is only as deep as its shallowest part.</p></div>
          <div class="card"><h3>Across the takes</h3>${noTakes ? '<p class="muted">Record a take first and the metric appears here.</p>' : `<canvas class="chart" id="chart-metric"></canvas>${legend()}`}</div>
          <div class="card"><h3>Reps the coach would count</h3>${noTakes ? '<p class="muted">—</p>' : `<canvas class="chart" id="chart-p"></canvas><p class="muted" style="font-size:.85rem;margin-top:6px">Progress 0 = start, 1 = target. A rep counts when it passes 0.85 and returns below 0.15. Dots mark counted reps.</p><div class="fires" style="margin-top:8px">${state.takes.filter(usable).map((t) => { const sim = state.sims[t.id]; return `<span class="${!sim || sim.error ? '' : (labelOf(t) === 'clean' ? (sim.full >= 3 ? 'ok' : 'warn') : '')}">${esc(saidText(t))}: ${sim && !sim.error ? sim.full + (sim.partial ? ` (+${sim.partial} partial)` : '') : '—'}</span>`; }).join('')}</div>`}</div>
        </div><div class="stack">
          <div class="card"><div class="fields">
            ${field('Start value', `<div class="row">${chips('progress.startMode', ['calibrated', 'fixed'], pr.start === 'calibrated' ? 'calibrated' : 'fixed', { calibrated: 'Read at calibration', fixed: 'Fixed number' })}${pr.start === 'calibrated' ? '' : `<input type="number" step="1" data-k="progress.start" value="${esc(pr.start)}" style="width:110px">`}</div>`, 'Calibrated = whatever the metric reads while the person holds the start pose. Use it unless the start pose varies between people in a way that matters.')}
            ${field('Target value', `<div class="row"><input type="number" step="1" data-k="progress.targetNum" value="${esc(typeof pr.target === 'number' ? pr.target : (romOpt ? romOpt.default : ''))}" style="width:110px" ${romOpt ? 'disabled' : ''}><span class="muted">${esc(SPEC.unitOf(pr.metric) || '')}</span></div>`, pr.start === 'calibrated' ? (pr.targetIsDelta ? 'Interpreted as a change from the calibrated start.' : 'Absolute value the metric must reach.') : '')}
            ${pr.start === 'calibrated' ? field('Target is', chips('progress.targetIsDelta', [false, true], !!pr.targetIsDelta, { false: 'An absolute value', true: 'A change from the start' })) : ''}
            ${pr.start === 'calibrated' && pr.targetIsDelta ? field('During the rep the reading', chips('progress.delta', [1, -1], pr.delta === -1 ? -1 : 1, { 1: 'rises', '-1': 'falls (a knee angle closing)' })) : ''}
            ${pr.start === 'calibrated' ? field('Treat the start as at least / at most', `<div class="row"><input type="number" step="1" data-k="progress.startMin" value="${pr.startMin ?? ''}" placeholder="min" style="width:90px"><input type="number" step="1" data-k="progress.startMax" value="${pr.startMax ?? ''}" placeholder="max" style="width:90px"></div>`, 'A knee that calibrates at 150° can be treated as 160°. Leave empty for no clamp.') : ''}
            ${field('Live readout', `<div class="row"><input type="text" data-k="display.label" value="${esc((s.display || {}).label || '')}" placeholder="bend" style="width:120px"><input type="text" data-k="display.unit" value="${esc((s.display || {}).unit || '')}" placeholder="°" style="width:60px">${chips('display.from', ['start', 'abs'], (s.display || {}).from === 'abs' ? 'abs' : 'start', { start: 'change from the start', abs: 'raw reading' })}</div>`, 'What the person sees during the set: “62° / 90° bend”.')}
            ${field('Let the user choose the target?', `<div class="row">${chips('romMode', [false, true], !!romOpt, { false: 'No, one target', true: 'Yes — a “range” option' })}${romOpt ? `<input type="text" data-k="romValues" value="${esc(romOpt.values.join(', '))}" placeholder="45, 60, 75, 90" style="width:160px">` : ''}</div>`, romOpt ? 'The last value is the default. Rehab moves usually want this — early weeks aim lower.' : '')}
            <button class="btn ghost small" id="suggest" ${noTakes ? 'disabled' : ''}>Suggest start and target from clean takes</button>
          </div></div>
          ${stableCard(s)}
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
        <div class="stack"><div class="card"><h3>Seconds the coach would count</h3>${state.takes.length ? `<div class="fires">${state.takes.filter(usable).map((t) => { const sim = state.sims[t.id]; return `<span class="${!sim || sim.error ? '' : (labelOf(t) === 'clean' ? (sim.holdMs > 0.7 * sim.durationMs ? 'ok' : 'warn') : '')}">${esc(saidText(t))}: ${sim && !sim.error ? (sim.holdMs / 1000).toFixed(1) + ' / ' + (sim.durationMs / 1000).toFixed(1) + ' s' : '—'}</span>`; }).join('')}</div>${legend()}` : '<p class="muted">Record a take first.</p>'}</div>
        ${stableCard(s)}
        <div class="card"><h3>Which landmark to highlight</h3>${chips('focus', ['', ...new Set(conds.flatMap((c) => c.metric.pts))], s.focus || '', { '': 'First point of the first condition' })}</div>
        <div class="card"><div class="fields">${field('Live readout', `<div class="row"><select data-k="display.condition">${conds.map((c, i) => `<option value="${i}" ${((s.display || {}).condition || 0) === i ? 'selected' : ''}>condition ${i + 1}</option>`).join('')}</select><input type="text" data-k="display.label" value="${esc((s.display || {}).label || '')}" placeholder="knee" style="width:110px"><input type="text" data-k="display.aim" value="${esc((s.display || {}).aim || '')}" placeholder="90°" style="width:80px"></div>`, 'What the person sees: “97° knee · aim 90°”.')}
          ${field('When out of position, the coach says', text('enterCue', s.enterCue || '', 'Slide down the wall until your knees are at ninety'), 'Spoken after a few seconds out of position, instead of silence.')}</div></div></div></div>
      <div class="row"><button class="btn ghost" id="back">← Record</button><span class="spacer"></span><button class="btn primary" id="next">Faults →</button></div></div>`;
  }
  function wireMeasure(s) {
    const root = $('main'); const rerender = () => { resim(); render(); };
    wireStable(s, root);
    bind(root, s, (k) => {
      if (k === 'progress.startMode') { s.progress.start = document.querySelector('[data-chips="progress.startMode"] .chip[aria-pressed="true"]').dataset.v === 'calibrated' ? 'calibrated' : (Number.isFinite(s.progress.start) ? s.progress.start : 0); delete s.progress.startMode; rerender(); return; }
      if (k === 'progress.targetNum') { const v = s.progress.targetNum; delete s.progress.targetNum; if (Number.isFinite(v)) { s.progress.target = v; resim(); drawMeasureCharts(s); } return; }
      if (k === 'romMode') { const on = document.querySelector('[data-chips="romMode"] .chip[aria-pressed="true"]').dataset.v === 'true'; delete s.romMode; s.options = (s.options || []).filter((o) => o.key !== 'rom'); if (on) { const vals = [45, 60, 75, 90]; s.options.push({ key: 'rom', label: 'Range target', values: vals, unit: SPEC.unitOf(s.progress.metric) || '', default: vals[vals.length - 1] }); s.progress.target = 'opt:rom'; } else if (typeof s.progress.target === 'string') s.progress.target = 90; rerender(); return; }
      if (k === 'romValues') { const o = s.options.find((x) => x.key === 'rom'); const vals = s.romValues.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n)); delete s.romValues; if (o && vals.length) { o.values = vals; o.default = vals[vals.length - 1]; resim(); drawMeasureCharts(s); } return; }
      if (k === 'progress.delta') { s.progress.delta = document.querySelector('[data-chips="progress.delta"] .chip[aria-pressed="true"]').dataset.v === '-1' ? -1 : 1; if (s.progress.delta === 1) delete s.progress.delta; resim(); drawMeasureCharts(s); return; }
      if (k === 'progress.startMin' || k === 'progress.startMax') { if (!Number.isFinite(s.progress[k.slice(9)])) delete s.progress[k.slice(9)]; resim(); drawMeasureCharts(s); return; }
      /* the further measurements: same fields, one level down */
      if (k.startsWith('progress.and.')) {
        const [, , i, field] = k.split('.'); const a = (s.progress.and || [])[+i]; if (!a) return;
        if (field === 'startMode') { a.start = document.querySelector(`[data-chips="progress.and.${i}.startMode"] .chip[aria-pressed="true"]`).dataset.v === 'calibrated' ? 'calibrated' : (Number.isFinite(a.start) ? a.start : 0); return rerender(); }
        if (field === 'targetNum') { const v = a.targetNum; delete a.targetNum; if (Number.isFinite(v)) a.target = v; resim(); drawMeasureCharts(s); saveState(); return; }
        return rerender();
      }
      if (k === 'progress.combine') { s.progress.combine = document.querySelector('[data-chips="progress.combine"] .chip[aria-pressed="true"]').dataset.v; return rerender(); }
      if (k === 'enterCue') { if (!s.enterCue) delete s.enterCue; saveState(); return; }
      if (k.startsWith('display.')) { s.display = s.display || {}; if (k === 'display.condition') s.display.condition = +s.display.condition; if (k === 'display.from') s.display.from = document.querySelector('[data-chips="display.from"] .chip[aria-pressed="true"]').dataset.v; for (const kk of Object.keys(s.display)) if (s.display[kk] === '' || s.display[kk] === 'start') delete s.display[kk]; if (!Object.keys(s.display).length) delete s.display; saveState(); return; }
      if (k === 'progress.targetIsDelta' || k === 'focus' || k.startsWith('hold.conditions')) { if (k.endsWith('.rel') || k === 'progress.targetIsDelta' || k === 'focus') rerender(); else { resim(); drawMeasureCharts(s); } return; }
    });
    wireMetricEditors(root, s, rerender);
    if ($('add-also')) $('add-also').onclick = () => { s.progress.and = (s.progress.and || []).concat([{ metric: { kind: 'angle', pts: [] }, start: 'calibrated', target: 90, targetIsDelta: false }]); saveState(); rerender(); };
    root.querySelectorAll('[data-delalso]').forEach((b) => { b.onclick = () => { s.progress.and.splice(+b.dataset.delalso, 1); if (!s.progress.and.length) delete s.progress.and; saveState(); rerender(); }; });
    if ($('suggest')) $('suggest').onclick = () => {
      const clean = state.takes.filter((t) => shows(t, 'clean')); if (!clean.length) return toast('Record a clean take first');
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
      if ($('chart-metric')) drawChart($('chart-metric'), series, { lines, yLabel: SPEC.unitOf(pr.metric) });
      if ($('chart-p')) drawChart($('chart-p'), state.takes.filter(usable).map((t) => ({ data: (state.sims[t.id] && state.sims[t.id].p) || [], color: COLORS[labelOf(t)] || COLORS.other })), { lines: [{ y: E.FULL, label: 'full', color: '#4f9a1e' }, { y: E.ATTEMPT, label: 'attempt', color: '#ffb830' }, { y: E.REST, label: 'rest', color: '#7a3fb8' }], y0: 0, y1: 1, marks: state.takes.filter(usable).flatMap((t) => ((state.sims[t.id] && state.sims[t.id].reps) || []).map((r) => ({ t: r.t, y: r.full ? 1 : 0.5, color: r.full ? '#4f9a1e' : '#ffb830' }))) });
    } else {
      s.hold.conditions.forEach((c, i) => { const n = (SPEC.KINDS[c.metric.kind] || {}).n; if (c.metric.pts.length < n || !$('chart-c' + i)) return; drawChart($('chart-c' + i), takeSeries(c.metric, c.rel), { lines: [{ y: c.min, label: 'min', color: '#7a3fb8' }, { y: c.max, label: 'max', color: '#ff2e88' }], yLabel: SPEC.unitOf(c.metric) }); });
    }
  }

  /* ===================== 5 · faults ===================== */
  const wc = (t) => (t || '').trim() ? t.trim().split(/\s+/).length : 0;
  const START_HELP = 'A start check is read once, on the position being held, and said while it can still be fixed — heels too far away, knee already bent, the band already taut. It cannot measure the change from the start, because that is the position it is judging.';
  function fireReport(f) {
    const groups = {}; for (const t of state.takes.filter(usable)) { const sim = state.sims[t.id]; if (!sim || sim.error) continue; const g = shows(t, 'fault:' + f.id) ? 'this fault' : labelOf(t); const fired = f.phase === 'start' ? (sim.startFired || []).includes(f.id) : f.rule ? (sim.repFaults[f.id] || 0) > 0 : !!(sim.faultSpans[f.id] && sim.faultSpans[f.id].length); groups[g] = groups[g] || [0, 0]; groups[g][1]++; if (fired) groups[g][0]++; }
    const order = ['clean', 'this fault', 'borderline', 'fault', 'setup', 'other'];
    return `<div class="fires">${order.filter((g) => groups[g]).map((g) => { const [a, b] = groups[g]; const cls = g === 'clean' ? (a === 0 ? 'ok' : 'bad') : g === 'this fault' ? (a === b ? 'ok' : 'bad') : ''; return `<span class="${cls}">fires on ${a}/${b} ${g === 'fault' ? 'other-fault' : g} takes</span>`; }).join('') || '<span>no takes yet</span>'}${f.phase === 'start' ? '<span>judged on the start position</span>' : ''}</div>`;
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
        <div class="row" style="gap:14px">${field('Measured as', chips(`faults.${i}.rel`, ['abs', 'change'], f.rel || 'abs', { abs: 'Absolute', change: 'Change from start' }))}${field('Fault when', `<div class="row">${chips(`faults.${i}.op`, ['>', '<'], f.op || '>', { '>': 'More than', '<': 'Less than' })}<input type="number" step="0.5" data-k="faults.${i}.threshold" value="${f.threshold ?? ''}" style="width:100px"><span class="muted">${esc(SPEC.unitOf(f.metric))}</span><button class="btn ghost small" data-suggest="${i}">Suggest</button></div>`)}</div>
        <div class="row" style="gap:14px">${s.type === 'reps'
          ? field('Check it', chips(`faults.${i}.phase`, ['', 'start'], f.phase === 'start' ? 'start' : '', { '': 'during the set', start: 'at the start position, before the set' }), START_HELP)
          : field('Watch it', chips(`faults.${i}.phase`, ['hold', 'any', 'start'], f.phase === 'start' ? 'start' : f.phase === 'any' ? 'any' : 'hold', { hold: 'while in position', any: 'any time — even out of position', start: 'at the start position, before the hold' }), START_HELP)}
        ${f.phase === 'start' || s.type !== 'reps' ? '' : field('Only once the rep is', chips(`faults.${i}.minP`, [0, 0.2, 0.3, 0.5], f.minP ?? 0.3, { 0: 'any time', 0.2: '20% under way', 0.3: '30% under way', 0.5: 'half way' }))}${field('Must persist', chips(`faults.${i}.persist`, [250, 400, 600, 900], f.persist || 400, { 250: '¼ s', 400: '0.4 s', 600: '0.6 s', 900: '0.9 s' }))}${field('Invalidates the rep', chips(`faults.${i}.invalidates`, [false, true], !!f.invalidates, { false: 'No', true: 'Yes' }))}</div>
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
      const spans = state.takes.filter(usable).flatMap((t) => ((state.sims[t.id] && state.sims[t.id].faultSpans[f.id]) || []).map(([t0, t1]) => ({ t0, t1, color: shows(t, 'fault:' + f.id) ? 'rgba(255,46,136,.22)' : labelOf(t) === 'clean' ? 'rgba(209,32,107,.35)' : 'rgba(255,184,48,.25)' })));
      drawChart(c, takeSeries(f.metric, f.rel), { lines: [{ y: f.threshold, label: 'threshold', color: '#ff2e88' }], spans, yLabel: SPEC.unitOf(f.metric) });
    });
  }
  function suggestThreshold(s, f) {
    const n = (SPEC.KINDS[f.metric.kind] || {}).n; if (f.metric.pts.length < n) return toast('Pick the landmarks first');
    const clean = state.takes.filter((t) => shows(t, 'clean')), bad = state.takes.filter((t) => shows(t, 'fault:' + f.id));
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
      <div class="card"><h3>Reps / seconds counted</h3><div class="fires">${state.takes.map((t) => { const sim = state.sims[t.id]; return `<span>${esc(saidText(t))}: ${sim && !sim.error ? (ex.type === 'reps' ? sim.full + ' reps' : (sim.holdMs / 1000).toFixed(1) + ' s') : (sim && sim.error ? esc(sim.error) : '—')}</span>`; }).join('') || '<span>no takes</span>'}</div></div>
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
        ${cuesCard(s)}
        <div class="card"><h3>Muscles the figure should light up</h3><p class="muted" style="font-size:.85rem;margin-bottom:8px">Tap to cycle: off → some → most.</p><div class="muscles">${ANAT.regions.map((r) => `<button type="button" class="chip small" data-mus="${r}" aria-pressed="${(s.muscles[r] || 0) > 0}">${r}${s.muscles[r] ? ' · ' + (s.muscles[r] >= 1 ? 'most' : 'some') : ''}</button>`).join('')}</div></div>
        <div class="card"><h3>Demo figure</h3><p class="muted" style="font-size:.85rem">Two keyframes — the start position and the end of the movement. Built from a clean take, written from preset angles, or dragged into shape by hand.</p>
          <div class="row" style="margin:8px 0;flex-wrap:wrap"><button class="btn secondary small" id="build-fig" ${state.takes.some((t) => shows(t, 'clean')) ? '' : 'disabled'}>${s.figure ? 'Rebuild' : 'Build'} from the best clean take</button>
            ${s.figure ? '<button class="btn secondary small" id="edit-fig">Edit the poses</button>' : s.pose ? '<button class="btn ghost small" id="pose-to-fig" title="The preset angles become plain joint positions you can drag — the move stops being preset-driven">Edit these poses by hand…</button>' : ''}
            ${s.figure || s.pose ? '<button class="btn ghost small" id="note-fig">Notes on the animation</button>' : ''}${s.figure && s.figure.from ? '<span class="muted" style="font-size:.85rem">built from a take ✓</span>' : s.figure ? '<span class="muted" style="font-size:.85rem">edited by hand</span>' : ''}</div>
          ${figNotes(s).length ? `<p class="muted" style="font-size:.85rem;margin:0 0 6px">${figNotes(s).length} note${figNotes(s).length > 1 ? 's' : ''}: ${esc(figNotes(s).map((n) => n.text).filter(Boolean).join(' · '))}</p>` : ''}
          ${s.figure ? (ANAT.register(s.id || 'draft', s.figure), ANAT.demo(s.id || 'draft')) : s.pose ? (function () { try { ANAT.register(s.id || 'draft', figureFromPose(s)); return ANAT.demo(s.id || 'draft'); } catch (e) { return ''; } })() : ''}</div>
      </div></div>
      <div class="row"><button class="btn ghost" id="back">← Faults</button><span class="spacer"></span><button class="btn primary" id="next">Check &amp; export →</button></div></div>`;
  }
  function wireGuide(s) {
    const root = $('main'); wireCues(s, root); bind(root, s, (k) => {
      if (k === 'muscleNames.primaryText' || k === 'muscleNames.secondaryText') { const which = k.includes('primary') ? 'primary' : 'secondary'; s.muscleNames = s.muscleNames || { primary: [], secondary: [] }; s.muscleNames[which] = listFrom(s.muscleNames[which + 'Text']); delete s.muscleNames[which + 'Text']; saveState(); }
    });
    root.querySelectorAll('[data-tr]').forEach((b) => { b.onclick = () => { const [ri, pi] = b.dataset.tr.split('.').map(Number); const p = s.guide.regions[ri].points[pi]; p.tracked = !p.tracked; saveState(); render(); }; });
    root.querySelectorAll('[data-delp]').forEach((b) => { b.onclick = () => { const [ri, pi] = b.dataset.delp.split('.').map(Number); s.guide.regions[ri].points.splice(pi, 1); saveState(); render(); }; });
    root.querySelectorAll('[data-addp]').forEach((b) => { b.onclick = () => { s.guide.regions[+b.dataset.addp].points.push({ t: '', tracked: false }); saveState(); render(); const inputs = root.querySelectorAll(`[data-ri="${b.dataset.addp}"] input[type=text]`); }; });
    root.querySelectorAll('[data-delr]').forEach((b) => { b.onclick = () => { s.guide.regions.splice(+b.dataset.delr, 1); saveState(); render(); }; });
    $('addr').onclick = () => { s.guide.regions.push({ name: '', points: [] }); saveState(); render(); };
    root.querySelectorAll('[data-mus]').forEach((b) => { b.onclick = () => { const r = b.dataset.mus; const v = s.muscles[r] || 0; s.muscles[r] = v === 0 ? 0.5 : v < 1 ? 1 : 0; if (!s.muscles[r]) delete s.muscles[r]; if (s.figure) s.figure.w = { ...s.muscles }; saveState(); render(); }; });
    $('build-fig').onclick = () => { try { const notes = figNotes(s); s.figure = buildFigure(s); if (notes.length) s.figure.notes = notes; s.pose = null; saveState(); toast('Figure built'); render(); } catch (e) { toast('Could not build: ' + e.message, 5000); } };
    if ($('edit-fig')) $('edit-fig').onclick = () => openFigBuilder();
    if ($('pose-to-fig')) $('pose-to-fig').onclick = () => {
      if (!confirm('Turn the preset angles into joint positions you can drag? The move keeps the same two poses, but stops being written in presets.')) return;
      try { s.figure = figureFromPose(s); s.pose = null; saveState(); render(); openFigBuilder(); } catch (e) { toast('Could not convert: ' + e.message, 5000); }
    };
    /* a move written in presets is annotated without being converted: its notes ride on the pose */
    if ($('note-fig')) $('note-fig').onclick = () => openFigBuilder(s.figure ? 'poses' : 'notes');
    if (s.figure) { ANAT.register(s.id || 'draft', s.figure); ANAT.mountAll(root); }
    else if (s.pose) { try { ANAT.register(s.id || 'draft', figureFromPose(s)); ANAT.mountAll(root); } catch (e) { } }
    $('back').onclick = () => go('faults'); $('next').onclick = () => go('export');
  }
  /* Two keyframes for the anatomical figure, lifted straight out of a clean take. */
  function buildFigure(s) {
    const clean = state.takes.filter((t) => shows(t, 'clean') && state.sims[t.id] && !state.sims[t.id].error);
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


  /* ===================== the figure builder =====================
     The demo figure is two keyframes. Built from a clean take it is usually right in outline and
     wrong in a detail — a foot through the floor, an arm the model guessed at — and a move written
     from presets may want a hand-made variation. Here the physio drags a joint: the bone above it
     turns, keeping its length, and everything below comes with it, so the figure stays a body.
     Notes pinned to a joint are the other half — "the knee drifts in here" — and they ride on the
     move, preset poses included, to be drawn on the animation the person sees. */
  const FIG_VIEW = { x: 196, y: 14, w: 212, h: 160 };          // the slice of the 400×175 diagram space the builder shows
  const FIG_PARENT = {
    side: { sh: 'hip', h: 'sh', el: 'sh', wr: 'el', elF: 'sh', wrF: 'elF', kn: 'hip', an: 'kn', ft: 'an', knF: 'hip', anF: 'knF', ftF: 'anF' },
    front: { shL: 'hipL', shR: 'hipR', h: 'shL', elL: 'shL', wrL: 'elL', elR: 'shR', wrR: 'elR', knL: 'hipL', anL: 'knL', knR: 'hipR', anR: 'knR' },
  };
  const FIG_WORDS = { h: 'head', sh: 'shoulder', hip: 'hip', el: 'elbow', wr: 'wrist', kn: 'knee', an: 'ankle', ft: 'toes', elF: 'far elbow', wrF: 'far wrist', knF: 'far knee', anF: 'far ankle', ftF: 'far toes', shL: 'left shoulder', shR: 'right shoulder', elL: 'left elbow', elR: 'right elbow', wrL: 'left wrist', wrR: 'right wrist', hipL: 'left hip', hipR: 'right hip', knL: 'left knee', knR: 'right knee', anL: 'left ankle', anR: 'right ankle' };
  const FIG_JOINTS = {
    side: ['h', 'sh', 'hip', 'el', 'wr', 'kn', 'an', 'ft', 'elF', 'wrF', 'knF', 'anF', 'ftF'],
    front: ['h', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR'],
  };
  /* the same lines the exercise page draws (coach.js profilePath / frontPath2), as bone pairs */
  const FIG_BONES = {
    side: { near: [['sh', 'hip'], ['hip', 'kn'], ['kn', 'an'], ['an', 'ft'], ['sh', 'el'], ['el', 'wr']], far: [['hip', 'knF'], ['knF', 'anF'], ['anF', 'ftF'], ['sh', 'elF'], ['elF', 'wrF']] },
    front: { near: [['shL', 'shR'], ['shL', 'hipL'], ['hipL', 'hipR'], ['hipR', 'shR'], ['hipL', 'knL'], ['knL', 'anL'], ['hipR', 'knR'], ['knR', 'anR'], ['shL', 'elL'], ['elL', 'wrL'], ['shR', 'elR'], ['elR', 'wrR']], far: [] },
  };
  const figJoints = (view) => FIG_JOINTS[view] || FIG_JOINTS.side;
  const figWord = (k) => FIG_WORDS[k] || k;
  /* Notes live with whichever shape the move keeps: a preset pose stays a preset pose. */
  function figNotes(s, make) { const home = s.pose || s.figure; if (!home) return []; if (!home.notes && make) home.notes = []; return home.notes || []; }
  /* `stretch` decides what a drag does to the bone above the joint. Off (the default) it turns and
     keeps its length, which is what a body does. On, the bone lengthens or shortens to follow the
     pointer — because a figure is a drawing, not a person: a leg seen at an angle is drawn shorter,
     a child's proportions are not an adult's, and the keyframes built from a take inherit whatever
     length the pose model guessed. Either way everything below the joint comes with it. */
  const fb = { kf: 'A', drag: null, before: null, stretch: false };
  /* poses: the whole builder. notes: the same sheet with the canvas put away, which is all a move
     written in preset angles needs — its notes ride on the pose and the presets stay presets. */
  function openFigBuilder(mode) {
    const s = cur(); if (!s) return;
    const poses = mode !== 'notes' && !!s.figure;
    $('fb-stage').hidden = !poses; $('fb-kf').hidden = !poses; $('fb-tools').hidden = !poses;
    $('fb-hint').hidden = !poses;
    if (poses) { fb.kf = 'A'; fb.before = JSON.stringify({ A: s.figure.A, B: s.figure.B }); }
    $('figbuild').hidden = false;
    wireFigBuilder();
    if (poses) drawFigBuilder();
    else { $('fb-title').textContent = 'Notes on the animation'; $('fb-notes').innerHTML = figNotesEditor(s, s.view); }
  }
  function closeFigBuilder() { $('figbuild').hidden = true; fb.drag = null; render(); }
  const figPose = (s, kf) => s.figure[kf] || s.figure.A;
  /* every joint that hangs off this one, itself included */
  function figKin(view, k) {
    const P = FIG_PARENT[view] || {}; const out = [k];
    for (const j of figJoints(view)) { for (let n = P[j]; n; n = P[n]) if (n === k) { out.push(j); break; } }
    return [...new Set(out)];
  }
  function drawFigBuilder() {
    const s = cur(); if (!s || !s.figure) return;
    const view = (s.figure.view || s.view) === 'front' ? 'front' : 'side';
    const c = $('fb-canvas'); const W = 900, H = Math.round(900 * FIG_VIEW.h / FIG_VIEW.w);
    if (c.width !== W) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d'); const k = W / FIG_VIEW.w;
    const X = (x) => (x - FIG_VIEW.x) * k, Y = (y) => (y - FIG_VIEW.y) * k;
    const cs = getComputedStyle(document.body), v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    const ink = v('--text', '#2b1546'), faint = v('--muted', '#5a3f78'), line = v('--line', '#e9d6bf'), hot = v('--pink', '#ff2e88'), paper = v('--surface', '#fffaf2');
    ctx.clearRect(0, 0, W, H); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, Y(164)); ctx.lineTo(W, Y(164)); ctx.stroke();
    /* the same stick figure the exercise page animates, one keyframe at a time */
    const stick = (F, colour, width, alpha) => {
      ctx.strokeStyle = colour; ctx.lineWidth = width;
      for (const set of ['far', 'near']) for (const [a, b] of FIG_BONES[view][set]) {
        const p = F[a], q = F[b]; if (!p || !q) continue;
        ctx.globalAlpha = alpha * (set === 'far' ? 0.45 : 1);
        ctx.beginPath(); ctx.moveTo(X(p[0]), Y(p[1])); ctx.lineTo(X(q[0]), Y(q[1])); ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      const neck = view === 'front' ? (F.shL && F.shR ? [(F.shL[0] + F.shR[0]) / 2, F.shL[1]] : null) : F.sh;
      if (F.h && neck) { ctx.beginPath(); ctx.moveTo(X(neck[0]), Y(neck[1])); ctx.lineTo(X(F.h[0]), Y(F.h[1])); ctx.stroke(); }
      if (F.h) { ctx.beginPath(); ctx.arc(X(F.h[0]), Y(F.h[1]), 10 * k, 0, 7); ctx.stroke(); }
      ctx.globalAlpha = 1;
    };
    const other = fb.kf === 'A' ? 'B' : 'A';
    if (s.figure[other]) stick(s.figure[other], faint, 2.5 * k, 0.3);   /* where the body was, behind */
    const F = figPose(s, fb.kf);
    stick(F, ink, 3.5 * k, 1);
    for (const n of figNotes(s)) {
      if (!n.text || (n.kf && n.kf !== fb.kf)) continue;
      const p = F[n.at]; if (!p) continue;
      const hipX = view === 'front' ? ((F.hipL || [306])[0] + (F.hipR || [306])[0]) / 2 : (F.hip || [306])[0];
      const dir = p[0] < hipX ? -1 : 1;
      ctx.font = `700 ${Math.round(10 * k)}px system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = dir < 0 ? 'right' : 'left';
      const lx = X(p[0] + dir * 12), ly = Y(p[1] - 9);
      ctx.strokeStyle = hot; ctx.lineWidth = 1.4 * k; ctx.beginPath(); ctx.moveTo(X(p[0]), Y(p[1])); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 2.6 * k, 0, 7); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = paper; ctx.strokeText(n.text, lx + dir * 3 * k, ly);
      ctx.fillStyle = ink; ctx.fillText(n.text, lx + dir * 3 * k, ly);
    }
    ctx.textAlign = 'left';
    for (const j of figJoints(view)) {
      const p = F[j]; if (!p) continue;
      const on = fb.drag === j;
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), on ? 11 : 8, 0, 7);
      ctx.fillStyle = on ? hot : paper; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = hot; ctx.stroke();
    }
    $('fb-title').textContent = `Demo figure — ${fb.kf === 'A' ? 'the start position' : 'the end of the movement'}`;
    $('figbuild').querySelectorAll('[data-fbkf]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.fbkf === fb.kf));
    $('fb-stretch').setAttribute('aria-pressed', fb.stretch ? 'true' : 'false');
    $('fb-hint').textContent = fb.stretch
      ? 'Stretching: a joint follows the pointer exactly, so the bone above it gets longer or shorter. Everything below comes with it. Hold Shift to bend instead.'
      : 'Bending: dragging a joint turns the bone above it and everything below comes with it, so every limb keeps its length. Drag a hip to move the whole body. Hold Shift to stretch instead.';
    $('fb-notes').innerHTML = figNotesEditor(s, view);
  }
  function figNotesEditor(s, view) {
    const notes = figNotes(s);
    return `<h4 style="margin:10px 0 6px">Notes on the animation</h4>
      <p class="muted" style="font-size:.85rem;margin:0 0 6px">Pinned to a joint and shown on the exercise page — what to look at, or what a fault looks like here.</p>
      ${notes.map((n, i) => `<div class="row fb-note" style="gap:6px;margin-bottom:6px"><input type="text" data-fbn="${i}" value="${esc(n.text)}" placeholder="Knee drifts in over the big toe" style="flex:1">
        <select data-fbat="${i}" aria-label="Pinned to">${figJoints(view).map((j) => `<option value="${j}" ${n.at === j ? 'selected' : ''}>${esc(figWord(j))}</option>`).join('')}</select>
        <select data-fbkfn="${i}" aria-label="When"><option value="" ${!n.kf ? 'selected' : ''}>throughout</option><option value="A" ${n.kf === 'A' ? 'selected' : ''}>at the start</option><option value="B" ${n.kf === 'B' ? 'selected' : ''}>at the end</option></select>
        <button class="btn ghost small" data-fbdel="${i}">✕</button></div>`).join('')}
      <button class="btn ghost small" id="fb-addnote">Add a note</button>`;
  }
  function wireFigBuilder() {
    const c = $('fb-canvas'); if (!c || c.dataset.wired) return; c.dataset.wired = '1';
    const redraw = () => { const s = cur(); if (s && s.figure && !$('fb-stage').hidden) drawFigBuilder(); else $('fb-notes').innerHTML = figNotesEditor(s, (s.figure && s.figure.view) || s.view); };
    /* the canvas is drawn with object-fit: contain, so a pointer maps through the letterboxed
       picture rather than the element box — otherwise every joint sits a little left of the grab */
    const at = (e) => {
      const s = cur(), view = ((s.figure || {}).view || s.view) === 'front' ? 'front' : 'side';
      const r = c.getBoundingClientRect(), ar = c.width / c.height;
      let dw = r.width, dh = r.width / ar; if (dh > r.height) { dh = r.height; dw = r.height * ar; }
      const k = FIG_VIEW.w / dw;
      return { x: FIG_VIEW.x + (e.clientX - r.left - (r.width - dw) / 2) * k, y: FIG_VIEW.y + (e.clientY - r.top - (r.height - dh) / 2) * k, view, s };
    };
    c.onpointerdown = (e) => {
      const { x, y, view, s } = at(e); if (!s || !s.figure) return;
      const F = figPose(s, fb.kf); let best = null, bd = 9;
      for (const j of figJoints(view)) { const p = F[j]; if (!p) continue; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = j; } }
      if (!best) return;
      fb.drag = best; c.setPointerCapture(e.pointerId); drawFigBuilder();
    };
    c.onpointermove = (e) => {
      if (!fb.drag) return;
      const { x, y, view, s } = at(e); const F = s.figure[fb.kf]; const P = FIG_PARENT[view] || {};
      const clamp = (p) => [Math.round(Math.max(200, Math.min(404, p[0]))), Math.round(Math.max(18, Math.min(172, p[1])))];
      const parent = P[fb.drag] && F[P[fb.drag]] ? F[P[fb.drag]] : null;
      const kin = figKin(view, fb.drag);
      if (!parent) { const d = [x - F[fb.drag][0], y - F[fb.drag][1]]; for (const j of Object.keys(F)) if (Array.isArray(F[j])) F[j] = clamp([F[j][0] + d[0], F[j][1] + d[1]]); }
      else if (fb.stretch) {
        /* the bone follows the pointer outright: it turns AND changes length, and everything below
           is carried rigidly so only this one bone's length changes */
        const d = [x - F[fb.drag][0], y - F[fb.drag][1]];
        for (const j of kin) { const p = F[j]; if (!Array.isArray(p)) continue; F[j] = clamp([p[0] + d[0], p[1] + d[1]]); }
      } else {
        /* turn the bone above this joint and carry everything below it round with the same angle,
           so every bone keeps the length it was drawn with */
        const a0 = Math.atan2(F[fb.drag][1] - parent[1], F[fb.drag][0] - parent[0]), a1 = Math.atan2(y - parent[1], x - parent[0]);
        const d = a1 - a0, co = Math.cos(d), si = Math.sin(d);
        for (const j of kin) { const p = F[j]; if (!Array.isArray(p)) continue; const dx = p[0] - parent[0], dy = p[1] - parent[1]; F[j] = clamp([parent[0] + dx * co - dy * si, parent[1] + dx * si + dy * co]); }
      }
      drawFigBuilder();
    };
    const drop = () => { if (!fb.drag) return; fb.drag = null; delete cur().figure.from; saveState(); drawFigBuilder(); };
    c.onpointerup = drop; c.onpointercancel = drop;
    $('figbuild').onclick = (e) => { if (e.target === $('figbuild')) closeFigBuilder(); };
    $('fb-close').onclick = closeFigBuilder;
    $('figbuild').querySelectorAll('[data-fbkf]').forEach((b) => { b.onclick = () => { fb.kf = b.dataset.fbkf; drawFigBuilder(); }; });
    $('fb-stretch').onclick = () => { fb.stretch = !fb.stretch; drawFigBuilder(); };
    /* held down, Shift is the other mode for one drag — the usual way a drawing tool does this */
    const shift = (e) => { if (e.key !== 'Shift') return; const on = e.type === 'keydown'; if (fb.shiftOn === on) return; fb.shiftOn = on; fb.stretch = !fb.stretch; drawFigBuilder(); };
    window.addEventListener('keydown', (e) => { if (!$('figbuild').hidden) shift(e); });
    window.addEventListener('keyup', (e) => { if (!$('figbuild').hidden) shift(e); });
    $('fb-copy').onclick = () => { const s = cur(); s.figure[fb.kf === 'A' ? 'B' : 'A'] = JSON.parse(JSON.stringify(s.figure[fb.kf])); saveState(); drawFigBuilder(); toast('Copied to the other keyframe'); };
    $('fb-revert').onclick = () => { const s = cur(); if (!fb.before) return; Object.assign(s.figure, JSON.parse(fb.before)); saveState(); drawFigBuilder(); toast('Back to where this was opened'); };
    $('fb-notes').onclick = (e) => {
      const s = cur();
      if (e.target.id === 'fb-addnote') { const view = (s.figure && s.figure.view) || s.view; figNotes(s, true).push({ at: figJoints(view)[0], text: '' }); saveState(); return redraw(); }
      const d = e.target.closest('[data-fbdel]'); if (d) { figNotes(s).splice(+d.dataset.fbdel, 1); saveState(); redraw(); }
    };
    $('fb-notes').oninput = (e) => { const i = e.target.dataset.fbn; if (i === undefined) return; figNotes(cur())[+i].text = e.target.value; saveState(); };
    $('fb-notes').onchange = (e) => {
      const s = cur(), notes = figNotes(s);
      if (e.target.dataset.fbat !== undefined) { notes[+e.target.dataset.fbat].at = e.target.value; saveState(); redraw(); }
      if (e.target.dataset.fbkfn !== undefined) { const n = notes[+e.target.dataset.fbkfn]; if (e.target.value) n.kf = e.target.value; else delete n.kf; saveState(); redraw(); }
    };
  }
  /* A move written from preset angles has no points to drag. Converting gives the physio the same
     two keyframes as explicit joints — and the move stops being preset-driven, which is the trade. */
  function figureFromPose(s) {
    const fig = C.poseToFigure(s.view, JSON.parse(JSON.stringify(s.pose)), { hold: s.type === 'hold', posture: (s.camera || {}).posture, side: s.pose.side || 'both' });
    return { view: fig.view, A: fig.A, B: fig.B, hold: fig.hold, side: fig.side, flip: fig.flip, w: { ...s.muscles }, wall: s.pose.wall || undefined, notes: (s.pose.notes || []).map((n) => ({ ...n })) };
  }

  /* ===================== 7 · check & export ===================== */
  function moveFileSource(s) {
    const clean = JSON.parse(JSON.stringify(s)); for (const k of ['_key', '_file', '_region', '_replaces', '_inherited', '_fileCamera', '_tuned', 'idTouched', 'screen', 'created', 'targetsText', 'romValues', 'equipmentText', 'sourcesText', 'muscleNames']) delete clean[k]; for (const f of clean.faults) if (f.listed) { delete f.listed; delete f.metric; delete f.op; delete f.threshold; } for (const f of clean.faults) delete f.idTouched;
    const credit = state.pt.name ? ` Authored with ${state.pt.name}.` : '';
    return `/* ${s.name} — written in OnTrack Studio.${credit}
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
    const region = targetRegion(s);
    const problems = catalogProblems(s, region);
    const warn = [];
    const todo = state.takes.filter((t) => shows(t, 'todo')).length;
    if (todo) warn.push(`${todo} rep${todo > 1 ? 's have' : ' has'} not been described yet — say what each one shows, or it counts for nothing.`);
    if (!state.takes.some((t) => shows(t, 'clean'))) warn.push('No clean take recorded — thresholds are guesses.');
    for (const f of s.faults) if (!f.rule && !f.listed && !state.takes.some((t) => shows(t, 'fault:' + f.id))) warn.push(`No take showing “${f.label}” — its threshold has not been checked against a real fault.`);
    for (const t of state.takes.filter((t) => shows(t, 'clean'))) { const sim = state.sims[t.id]; if (sim && !sim.error) { const fired = Object.keys(sim.faultSpans); if (fired.length) warn.push(`A clean take still fires: ${fired.join(', ')}.`); if (s.type === 'reps' && s.tracking !== 'none' && sim.full < 2) warn.push('A clean take counts fewer than 2 reps — check the start/target or the calibration window.'); } }
    if (!state.takes.some((t) => shows(t, 'borderline'))) warn.push('No borderline take — the most valuable kind.');
    if (!s.figure && !s.pose) warn.push('No demo figure — the page will show nothing in “The move”. Build one in step 6.');
    if (!Object.keys(s.muscles).length) warn.push('No muscles chosen for the figure.');
    const tune = tuningReport(s);
    let preview = ''; try { preview = C.format(regionWith(s, region).entry); } catch (e) { preview = e.message; }
    const ready = !problems.length;
    return `<div class="stack"><h2>7 · Check &amp; save</h2>
      <div class="st-grid"><div class="card"><h3>${ready ? 'Ready to ship' : 'Not ready'}</h3><ul class="problems" style="margin:0;padding-left:18px">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}${ready ? '<li class="ok">Checked exactly as the app loads it: every field name, every measurement, the library’s own rules.</li>' : ''}</ul>
        ${warn.length ? `<h3 style="margin-top:12px">Worth fixing</h3><ul style="margin:0;padding-left:18px;font-size:.9rem">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>
      <div class="card"><h3>Into the library</h3><p style="font-size:.92rem">The move is one file of its own — <code>client/data/moves/${esc(s.id || 'id')}.json</code>${s._replaces && s._replaces !== s.id ? `, replacing <b>${esc(s._replaces)}</b>` : ''}. Its region supplies the defaults it does not state (camera, group, order, sources) and puts it in order in the list; nothing else in the library is touched.</p>
        <div class="fields" style="margin-top:8px">${field('Region', `<select data-k="_region">${regionNames().map((r) => `<option value="${esc(r)}" ${r === region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`, 'Where its defaults come from, and where it sits in the list.')}</div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="save-project" ${ready ? '' : 'disabled'} hidden>Save into the project</button><button class="btn primary" id="dl-file" ${ready ? '' : 'disabled'}>Download ${esc(s.id || 'move')}.json</button><span class="muted" id="save-note" style="font-size:.85rem"></span></div>
        <div class="row" style="margin-top:10px"><button class="btn secondary" id="try">Try it in the app</button><span class="muted" style="font-size:.85rem">Opens the app with this move added, in this browser only.</span></div>
        <div class="row" style="margin-top:10px"><button class="btn ghost small" id="copy-entry">Copy the entry</button><button class="btn ghost small" id="dl-js">Download as code (.js)</button><button class="btn ghost small" id="dl-json">Download session spec</button></div></div></div>
      <div class="card"><div class="row" style="align-items:baseline"><h3>Tuning</h3><span class="spacer"></span><span class="${tune.pass ? 'ok' : 'muted'}" style="font-weight:800">${tune.pass ? 'passes — every live fault behaves on the takes' : tune.reason}</span></div>
        <p class="muted" style="font-size:.85rem">The rule for every move: two clean takes, a take per live fault, and each fault quiet on the clean takes and firing on its own. Same numbers as the coach runs.</p>
        <table class="tune"><thead><tr><th>fault</th><th>clean</th><th>its own takes</th><th>borderline</th><th></th></tr></thead><tbody>${tune.rows.map((r) => `<tr class="${r.ok ? 'ok' : 'bad'}"><td>${esc(r.label)}</td><td>${r.clean}</td><td>${r.own}</td><td>${r.border}</td><td>${r.ok ? '✓' : esc(r.why)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">no live faults</td></tr>'}</tbody></table>
        <div class="row" style="margin-top:10px;align-items:center;gap:10px">${field('Vetted', chips('vetted', [false, true], !!s.vetted, { false: 'Not yet', true: 'Yes — checked against these takes' }))}${field('On the home page', chips('listed', ['auto', 'yes', 'no'], s.listed === undefined ? 'auto' : (s.listed ? 'yes' : 'no'), { auto: `Follow vetted (${s.vetted ? 'shown' : 'hidden'})`, yes: 'Always shown', no: 'Hidden' }), 'A hidden move still runs — a routine that names it, or a link to it, works. It is only kept out of the lists people browse.')}${s._tuned ? `<span class="muted" style="font-size:.85rem">tuned ${esc(s._tuned.date)}${s._tuned.by ? ' by ' + esc(s._tuned.by) : ''} on ${s._tuned.takes} takes</span>` : ''}</div>
        ${!tune.pass ? '<p class="muted" style="font-size:.85rem">Vetted can only be set once the rule passes.</p>' : ''}</div>
      ${checkPanel(s)}
      <div class="card"><h3>The entry, as it will be written</h3><pre class="code">${esc(preview)}</pre></div>
      <div class="row"><button class="btn ghost" id="back">← Guide</button></div></div>`;
  }
  function download(name, content, type = 'application/octet-stream') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  /* Every live fault against the takes: quiet on clean, firing on its own — the same rule for every move. */
  function tuningReport(s) {
    const clean = state.takes.filter((t) => shows(t, 'clean')), rows = [];
    const live = (s.faults || []).filter((f) => !f.rule && !f.listed && f.metric && f.metric.pts.length);
    const count = (f, takes) => { let n = 0; for (const t of takes) { const sim = state.sims[t.id]; if (!sim || sim.error) continue; const fired = f.rule ? (sim.repFaults[f.id] || 0) > 0 : !!(sim.faultSpans[f.id] && sim.faultSpans[f.id].length); if (fired) n++; } return n; };
    for (const f of live) {
      const own = state.takes.filter((t) => shows(t, 'fault:' + f.id)), border = state.takes.filter((t) => shows(t, 'borderline'));
      const c = count(f, clean), o = count(f, own), b = count(f, border);
      const ok = clean.length >= 2 && own.length >= 1 && c === 0 && o === own.length;
      rows.push({ id: f.id, label: f.label, clean: `${c}/${clean.length}`, own: `${o}/${own.length}`, border: `${b}/${border.length}`, ok, why: clean.length < 2 ? 'needs 2 clean takes' : !own.length ? 'no take of this fault' : c ? 'fires on a clean take' : 'misses its own take' });
    }
    const pass = rows.length > 0 && rows.every((r) => r.ok) && clean.length >= 2;
    return { rows, pass, reason: !rows.length ? 'no live fault to tune' : clean.length < 2 ? 'record two clean takes' : 'not yet — see the rows in red' };
  }
  function wireExport(s) {
    const region = targetRegion(s);
    wireCheck();
    bind($('main'), s, (k) => {
      if (k === '_region') render();
      if (k === 'listed') { const v = document.querySelector('[data-chips="listed"] .chip[aria-pressed="true"]').dataset.v; s.listed = v === 'auto' ? undefined : v === 'yes'; saveState(); render(); return; }
      if (k === 'vetted') { const on = document.querySelector('[data-chips="vetted"] .chip[aria-pressed="true"]').dataset.v === 'true'; const t = tuningReport(s);
        /* Vetted is the author's call. When the tuning report still fails it is said, and the
           failing faults are written into the tuning record, so the override is on the file. */
        const failing = on && !t.pass ? (t.rows.some((r) => !r.ok) ? t.rows.filter((r) => !r.ok).map((r) => r.id) : [t.reason]) : [];
        if (failing.length) toast('Vetted anyway — ' + (t.rows.some((r) => !r.ok) ? failing.join(', ') + ' still misbehave' + (failing.length === 1 ? 's' : '') + ' on the takes' : t.reason) + '; that is noted in the tuning record', 6000);
        s.vetted = on; if (on) s._tuned = { date: new Date().toISOString().slice(0, 10), by: state.pt.name || undefined, takes: state.takes.length, faults: t.rows.map((r) => r.id), ...(failing.length ? { override: failing } : {}) }; else delete s._tuned; saveState(); render(); }
    });
    probeDevSave().then((d) => { if (d && $('save-project')) { $('save-project').hidden = false; $('save-note').textContent = 'Local server running — saving writes client/data/moves/' + (s.id || 'id') + '.json'; } });
    $('save-project').onclick = async () => {
      const { rel, name, json, entry, isNew } = regionWith(s, region);
      try {
        const r = await fetch('../api/dev/catalog/' + s.id, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: JSON.stringify({ region, move: entry }) });
        const d = await r.json();
        if (!r.ok) { toast((d.problems || [d.error]).join(' · '), 8000); return; }
        const f = C.data.files.find((x) => x.name === name); if (f) f.json = json;
        s._file = rel; s._region = region; s._replaces = s.id; saveState();
        $('save-note').textContent = `Saved ${rel}${isNew ? ` and listed it in ${d.region}` : ''} — ${d.library} moves in the library. Reload the app to see it; commit the file to keep it.`; toast('Saved into the project');
      } catch (e) { toast('Save failed: ' + e.message, 6000); }
    };
    $('dl-file').onclick = () => { const { entry } = regionWith(s, region); download(s.id + '.json', C.format(entry) + '\n', 'application/json'); $('save-note').textContent = `Drop it in as client/data/moves/${s.id}.json${regionWith(s, region).isNew ? `, and add "${s.id}" to client/data/regions/${region}.json` : ''}, then commit.`; };
    $('copy-entry').onclick = async () => { try { await navigator.clipboard.writeText(C.format(regionWith(s, region).entry)); toast('Copied'); } catch { toast('Copy failed — use download'); } };
    $('dl-js').onclick = () => download(`${s.id}.js`, moveFileSource(s), 'text/javascript');
    $('dl-json').onclick = () => download(`${s.id || 'move'}.spec.json`, JSON.stringify(s, null, 2), 'application/json');
    $('try').onclick = () => { try { const drafts = JSON.parse(localStorage.getItem('grooveform.drafts') || '{}'); const { json, entry } = regionWith(s, region); const grp = {}; for (const k of Object.keys(json)) if (k !== 'moves' && !k.startsWith('_')) grp[k] = json[k]; drafts[s.id] = { entry, group: grp }; localStorage.setItem('grooveform.drafts', JSON.stringify(drafts)); window.open('../#/exercise/' + s.id, '_blank'); } catch (e) { toast(e.message); } };
    $('back').onclick = () => go('guide');
  }

  /* ---------- session file: every move and take, in one JSON ---------- */
  async function saveBundle() {
    const takes = await idb.all();
    const blobToB64 = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(b); });
    const includeVideo = takes.some((t) => t.video) && confirm('Include the videos? Landmark streams are always included; videos make the file much larger but let the build side see what happened.');
    const out = { app: 'ontrack-studio', version: 1, exported: new Date().toISOString(), pt: state.pt, moves: state.moves, takes: [] };
    for (const t of takes) { const c = { ...t }; if (c.video) { c.videoType = c.video.type; c.video = includeVideo ? await blobToB64(c.video) : null; } out.takes.push(c); }
    download(`ontrack-session-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out), 'application/json'); toast(`Saved ${Object.keys(state.moves).length} moves, ${takes.length} takes`);
  }
  async function importBundle(file) {
    const text = await file.text(); let data; try { data = JSON.parse(text); } catch { return toast('Not a JSON file'); }
    if (data.app === 'ontrack-studio' || data.app === 'grooveform-studio') {   /* sessions saved before the rename still open */
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
  window.OnTrackStudio = { state, simulate, trace, buildFigure, moveFileSource, render, entryToSpec, specToEntry, regionWith, catalogProblems, editCopy };
})();
