/* ---------------------------------------------------------------------------
   The studio's right-hand side: recordings read into reps and judged with the
   exercise as it stands, the reps classified, the numbers recommended, and the
   measures not yet built that would tell the marked reps from the clean ones.
   builder.js owns the exercise (the draft, its cards, its numbers) and tells this
   file which compiled move to judge with (setMove); this file owns the recordings,
   the stage, the lanes, the rep list and the figure editor's canvas.

   Recordings. A video is read once by the pose model, frame by frame, into a
   trace; several can be loaded and all are judged together. One is on the stage
   at a time; the reps of every one are listed, grouped; a verdict on a rep is
   kept by its time, per recording, in this browser and in the trace file.
   Every number the builder changes judges every recording again at once.
   --------------------------------------------------------------------------- */
Moves.ready.then(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = { good: '#35d07f', warn: '#ffb545', bad: '#ff5c6c', ink: '#e8edf4', dim: 'rgba(232,237,244,.45)', line: '#263040', accent: '#5aa9ff', edge: '#e879f9' };
  const A = window.OnTrackAnatomy;
  const W = Spec.words;

  /* the move the recordings are judged with: the builder sets it — the draft laid over the
     library when it is whole, the library's own exercise otherwise */
  let move = Moves.bridge || Moves.list[0];
  const cfgNow = () => Trace.defaults(move);
  /* the recordings, in load order; `shown` is the one on the stage. `trace` and `result`
     name the shown recording and its run for the drawing code below, which reads them */
  const recordings = []; let shown = null, trace = null, result = null, recSeq = 0;
  const video = $('clip'), overlay = $('overlay'), lanes = $('lanes'), reader = $('reader');

  /* ---------- the person's verdicts, per recording ----------
     kept by time, with the recording, under the exercise it was judged as (the library
     exercise a draft came from, so renaming a draft keeps them), in this browser and in the
     trace file when it is saved */
  const LABELS = 'ontrack.labels';
  const lineage = () => (window.__builder && window.__builder.source) || move.id;
  const labelKey = (rec) => `${lineage()}|${rec.name}|${rec.frames.length}`;
  function loadLabels(rec) {
    rec.labels = [];
    try { const all = JSON.parse(localStorage.getItem(LABELS) || '{}'); if (Array.isArray(all[labelKey(rec)])) rec.labels = all[labelKey(rec)]; } catch { }
    if (!rec.labels.length && Array.isArray(rec.fileLabels) && rec.fileLabels.length) rec.labels = rec.fileLabels.slice();
  }
  function saveLabels(rec) {
    try {
      const all = JSON.parse(localStorage.getItem(LABELS) || '{}'), k = labelKey(rec);
      if (rec.labels.length) all[k] = rec.labels; else delete all[k];
      const keys = Object.keys(all); for (const old of keys.slice(0, Math.max(0, keys.length - 60))) delete all[old];
      localStorage.setItem(LABELS, JSON.stringify(all));
    } catch { }
  }
  /* a rep's label replaced whole, since a label is by time */
  function setLabel(rec, seg, fn) {
    const cur = Trace.labelOf(rec.labels, seg);
    const next = fn(cur ? Object.assign({}, cur, { faults: (cur.faults || []).slice() }) : { t0: seg.t0, t1: seg.t1, tag: 'clean', faults: [] });
    rec.labels = rec.labels.filter((l) => l !== cur);
    if (next) { next.t0 = seg.t0; next.t1 = seg.t1; delete next.provisional; rec.labels.push(next); }
    saveLabels(rec); renderReps(); renderRecommend(); renderSuggest();
  }
  function clearLabels(id) { const rec = recordings.find((r) => r.id === id); if (!rec) return; rec.labels = []; saveLabels(rec); renderReps(); renderRecommend(); renderSuggest(); }
  /* the faults named on the spot, '+' and the words: offered as chips on every rep of this exercise */
  const otherFaults = () => { const s = new Set(); for (const r of recordings) for (const l of r.labels) for (const f of l.faults || []) if (f[0] === '+') s.add(f); return [...s]; };

  /* ---------- the exercise's list in the bar ---------- */
  function refreshMoves() { const cur = $('move').value; $('move').innerHTML = Moves.list.map((m) => `<option value="${m.id}">${esc(m.name)}${m.draft ? ' (draft)' : ''}</option>`).join(''); $('move').value = Moves[cur] ? cur : move.id; }
  /* the builder hands over the compiled move to judge with; every recording is judged again */
  let lastLineage = null;
  function setMove(m) {
    move = m || move; $('move').value = move.id;
    if (lineage() !== lastLineage) { lastLineage = lineage(); for (const r of recordings) loadLabels(r); }
    rerun();
  }
  function save(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------- reading a video into a trace ---------- */
  const MODELS = {
    full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  };
  let worker = null, ready = null, seq = 0; const waiting = new Map();
  function ensureWorker() {
    if (ready) return ready;
    ready = new Promise((res, rej) => {
      let w;
      try { w = new Worker('js/pose-worker.js?v=' + Core.VER, { type: 'module' }); } catch (e) { return rej(e); }
      const giveUp = setTimeout(() => rej(new Error('the pose model did not load')), 60000);
      w.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'ready') { clearTimeout(giveUp); worker = w; res(w); }
        else if (m.type === 'error') { clearTimeout(giveUp); rej(new Error(m.message || 'the pose model failed')); }
        else if (m.type === 'pose') { const cb = waiting.get(m.seq); if (cb) { waiting.delete(m.seq); cb(m.lm || null); } }
      };
      w.onerror = (e) => { clearTimeout(giveUp); rej(new Error(e.message || 'the pose worker failed')); };
      w.postMessage({ type: 'load', model: 'full' });
    });
    return ready;
  }
  /* where the worker cannot be had, the model on the page's thread, as the coach does */
  let inline = null, inlineLoad = null, lastTs = 0;
  function ensureInline() {
    if (inlineLoad) return inlineLoad;
    inlineLoad = (async () => {
      const MP = '0.10.21';
      const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP}/wasm`);
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODELS.full, delegate }, runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.7, minTrackingConfidence: 0.7 });
      try { inline = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
      catch { inline = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
      return inline;
    })();
    return inlineLoad;
  }
  let workerFailed = null;
  /* the light and the background of a frame, from a 64 × 36 thumbnail: kept with the trace */
  let thumb = null;
  function sceneOf(v, lm) {
    try {
      if (!thumb) { thumb = document.createElement('canvas'); thumb.width = 64; thumb.height = 36; }
      const ctx = thumb.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, 64, 36);
      return Core.scene(ctx.getImageData(0, 0, 64, 36).data, 64, 36, lm, cfgNow().vis);
    } catch { return null; }
  }
  async function poseFor(v, ts) {
    /* the model stood in for, as the browser suite does */
    if (window.__reviewPose) return window.__reviewPose(ts, v);
    if (!workerFailed) {
      try {
        const w = await ensureWorker();
        const bitmap = await createImageBitmap(v);
        const id = ++seq;
        return await new Promise((res) => { waiting.set(id, res); w.postMessage({ type: 'frame', bitmap, ts, seq: id }, [bitmap]); });
      } catch (e) { workerFailed = e; $('progress').textContent = `The model's own thread failed (${e.message || e}); reading on the page instead…`; }
    }
    const lmk = await ensureInline();
    const t = Math.max(ts, lastTs + 1); lastTs = t;
    const res = lmk.detectForVideo(v, t);
    return res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
  }
  const seekTo = (v, t) => new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = t; });

  /* a video, or several, read one after another through the hidden reader, so the stage is
     free to play what is already there */
  const note = (t) => { $('progress').textContent = t; $('progress').hidden = !t; };
  async function loadVideo(file, which) {
    note(`${which ? which + ' — ' : ''}Opening ${file.name}…`);
    reader.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { reader.onloadedmetadata = res; reader.onerror = () => rej(new Error('the video would not open')); });
    const aspect = reader.videoWidth / reader.videoHeight, dur = reader.duration;
    const fps = Math.max(5, Math.min(30, Number($('fps').value) || 15));
    const frames = [];
    for (let t = 0; t < dur; t += 1 / fps) {
      await seekTo(reader, Math.min(t, dur - 0.001));
      const lm = await poseFor(reader, Math.round(t * 1000));
      frames.push({ t: Math.round(t * 1000), lm, scene: sceneOf(reader, lm) });
      if (frames.length % 5 === 0) note(`${which ? which + ' — ' : ''}Reading ${file.name}… ${Math.round((t / dur) * 100)}% (${frames.length} frames)`);
    }
    URL.revokeObjectURL(reader.src); reader.removeAttribute('src');
    const rec = addRecording({ frames, aspect, name: file.name, source: 'video', fps, duration: dur * 1000, file });
    if (shown !== rec) show(rec);   // a video just read is what the person wants to see
    return rec;
  }
  async function loadVideos(files) {
    const list = [...files];
    for (let i = 0; i < list.length; i++) {
      try { await loadVideo(list[i], list.length > 1 ? `${i + 1} of ${list.length}` : ''); }
      catch (e) { note(`Could not read ${list[i].name}: ${e.message || e}`); return; }
    }
    note('');
  }
  $('video-file').onchange = (e) => { if (e.target.files && e.target.files.length) loadVideos(e.target.files); e.target.value = ''; };
  /* a trace file, a takes file (the old Takes and the rule), or a bundle of traces: each becomes a recording */
  function takeIn(packed, fallbackName) {
    const { meta, frames } = Trace.unpack(packed);
    if (meta.move && Moves[meta.move] && meta.move !== move.id && !recordings.length && window.__builder) window.__builder.open(meta.move);
    return addRecording({ frames, aspect: meta.aspect || 16 / 9, name: meta.name || fallbackName || 'trace', source: 'trace', fps: meta.fps || null, duration: frames.length ? frames[frames.length - 1].t : 0, fileLabels: Array.isArray(meta.labels) ? meta.labels : [], tag: meta.tag || null });
  }
  function loadTakes(d) {
    if (!d || !Array.isArray(d.takes)) throw new Error('not a takes file');
    return d.takes.map((tk, i) => takeIn(tk, `take ${i + 1}`));
  }
  $('trace-file').onchange = async (e) => {
    for (const f of [...(e.target.files || [])]) {
      try { const d = JSON.parse(await f.text()); if (d && Array.isArray(d.takes)) loadTakes(d); else takeIn(d, f.name); }
      catch (err) { note(`Not a trace: ${f.name} (${err.message || err})`); }
    }
    e.target.value = '';
  };
  const packed = (rec) => Trace.pack({ move: move.id, aspect: rec.aspect, name: rec.name, source: rec.source, fps: rec.fps || null, labels: rec.labels, tag: rec.tag || undefined }, rec.frames);
  function saveTrace(rec) { save(new Blob([JSON.stringify(packed(rec))], { type: 'application/json' }), `${move.id}-${String(rec.name).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_')}-trace.json`); }
  $('save-all').onclick = () => {
    if (!recordings.length) return;
    const out = { v: 1, kind: 'takes', move: move.id, saved: new Date().toISOString(), draft: window.__builder && window.__builder.touched ? window.__builder.fileOf() : undefined, takes: recordings.map(packed) };
    save(new Blob([JSON.stringify(out)], { type: 'application/json' }), `${move.id}-recordings-${new Date().toISOString().slice(0, 10)}.json`);
  };

  /* ---------- the recordings: added, judged, shown ---------- */
  function addRecording(rec) {
    rec.id = 'r' + (++recSeq); rec.labels = []; rec.result = null; rec.reps = []; rec.misses = [];
    recordings.push(rec);
    loadLabels(rec);
    judgeOne(rec);
    /* an old takes file tagged the whole take: its reps start with that verdict, dashed, until a tap confirms it */
    if (rec.tag && !rec.labels.length) { for (const r of rec.reps) rec.labels.push({ t0: r.t0, t1: r.t1, tag: rec.tag === 'clean' ? 'clean' : 'faults', faults: rec.tag === 'clean' ? [] : [rec.tag], provisional: true }); saveLabels(rec); }
    $('save-all').disabled = false;
    if (!shown) show(rec); else { renderRecList(); renderReps(); renderRecommend(); renderSuggest(); }
    return rec;
  }
  /* the whole recording's verdict: every rep without a verdict of its own starts with it, dashed, until a tap confirms it */
  function setTag(rec, tag) {
    rec.tag = tag;
    rec.labels = rec.labels.filter((l) => !l.provisional);
    if (tag) for (const r of rec.reps) if (!Trace.labelOf(rec.labels, r)) rec.labels.push({ t0: r.t0, t1: r.t1, tag: tag === 'clean' ? 'clean' : 'faults', faults: tag === 'clean' ? [] : [tag], provisional: true });
    saveLabels(rec); renderRecList(); renderReps(); renderRecommend(); renderSuggest();
  }
  function removeRecording(id) {
    const i = recordings.findIndex((r) => r.id === id); if (i < 0) return;
    const rec = recordings[i]; recordings.splice(i, 1);
    rec.frames = null; rec.result = null;
    if (shown === rec) { shown = null; trace = null; result = null; if (recordings.length) show(recordings[Math.min(i, recordings.length - 1)]); else { if (video.src) URL.revokeObjectURL(video.src); video.removeAttribute('src'); video.load(); renderAll(); } }
    else { renderRecList(); renderReps(); renderRecommend(); renderSuggest(); }
    $('save-all').disabled = !recordings.length;
  }
  function judgeOne(rec) {
    let fig = null; try { fig = window.Figure ? Figure.figureOf(move) : null; } catch { fig = null; }
    const edge = cfgNow().edge;
    const room = fig && fig.A && fig.B ? (r) => Core.roomOf(fig.A, fig.B, r, rec.aspect, edge) : null;
    rec.result = Trace.run(move, {}, rec.frames, rec.aspect, room ? { room } : undefined);
    rec.reps = Trace.reps(rec.result, move);
    rec.misses = move.reps ? Trace.misses(rec.result, move) : [];
  }
  let pending = 0;
  function rerun() { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; judgeAll(); }); }
  function judgeAll() { for (const r of recordings) judgeOne(r); if (shown) { trace = shown; result = shown.result; } renderAll(); }
  function renderAll() {
    const total = recordings.reduce((a, r) => a + r.frames.length, 0), secs = recordings.reduce((a, r) => a + r.duration, 0) / 1000;
    $('trace-note').textContent = recordings.length ? `${recordings.length} recording${recordings.length === 1 ? '' : 's'} · ${total} frames · ${secs.toFixed(1)} s` : 'none yet';
    renderRecList(); sizeOverlay(); drawLanes(); drawOverlay(); listCues(); renderTracked(); renderReps(); renderRecommend(); renderSuggest(); renderStageBar();
  }
  let shownUrl = null;
  function show(rec) {
    shown = rec; trace = rec; result = rec.result; focusRep = null;
    if (shownUrl) { URL.revokeObjectURL(shownUrl); shownUrl = null; }
    if (rec.file) { shownUrl = URL.createObjectURL(rec.file); video.src = shownUrl; } else { video.removeAttribute('src'); video.load(); }
    $('render-demo').disabled = !rec.file;
    renderAll();
  }
  function renderRecList() {
    const host = $('rec-list'); if (!host) return;
    host.innerHTML = recordings.map((r) => {
      const n = r.reps.length, counted = r.reps.filter((x) => x.counted).length, labelled = r.reps.filter((x) => Trace.labelOf(r.labels, x)).length;
      const meta = `${(r.duration / 1000).toFixed(1)} s · ${move.reps ? `${counted} rep${counted === 1 ? '' : 's'}${n > counted ? `, ${n - counted} not counted` : ''}` : `${n} hold${n === 1 ? '' : 's'}`} · ${labelled} of ${n} classified`;
      const tag = `<select class="tag" title="What the whole recording shows: its reps start with that verdict until you confirm or change each"><option value="">shows: —</option><option value="clean"${r.tag === 'clean' ? ' selected' : ''}>a clean set</option>${Trace.faultIds(move).map((id) => `<option value="${esc(id)}"${r.tag === id ? ' selected' : ''}>${esc((move.cues[id] && move.cues[id].label) || id)}</option>`).join('')}</select>`;
      return `<li data-rec="${r.id}" aria-current="${shown === r}"><b>${esc(r.name)}</b><span class="meta">${meta}</span>${tag}${shown === r ? '' : '<button class="btn tiny-btn" type="button" data-act="show">Show</button>'}<button class="btn tiny-btn" type="button" data-act="save">Save the trace</button><button class="btn tiny-btn" type="button" data-act="remove" title="Remove this recording">✕</button></li>`;
    }).join('');
    host.querySelectorAll('button[data-act]').forEach((b) => { b.onclick = () => { const rec = recordings.find((r) => r.id === b.closest('li').dataset.rec); if (!rec) return; if (b.dataset.act === 'show') show(rec); else if (b.dataset.act === 'save') saveTrace(rec); else removeRecording(rec.id); }; });
    host.querySelectorAll('select.tag').forEach((sel) => { sel.onchange = () => { const rec = recordings.find((r) => r.id === sel.closest('li').dataset.rec); if (rec) setTag(rec, sel.value || null); }; });
  }
  /* under the stage: which recording, which rep, and the chips for the rep in focus */
  function renderStageBar() {
    $('stage-name').textContent = shown ? shown.name : 'No recording on the stage';
    const reps = shown ? shown.reps : [];
    $('stage-rep').textContent = focusRep != null && reps[focusRep] ? `${repName(reps[focusRep], shown)} of ${reps.length}` : reps.length ? `${reps.length} rep${reps.length === 1 ? '' : 's'}` : '';
    $('prev-rep').disabled = !reps.length; $('next-rep').disabled = !reps.length;
    const host = $('stage-verdict');
    host.innerHTML = focusRep != null && reps[focusRep] ? labelRow(shown, focusRep, Trace.labelOf(shown.labels, reps[focusRep]), 'rep') : '';
  }
  const repName = (r, rec) => (move.reps ? (r.counted ? `Rep ${r.n}` : (r.open ? 'Under way at the end' : 'Attempt, not counted')) : `Hold ${r.n}`);
  function focusOn(rec, i) {
    if (rec !== shown) show(rec);
    focusRep = i; const r = rec.reps[i]; if (!r) return;
    if (video.duration) video.currentTime = r.t0 / 1000; else { drawOverlay(r.t0); }
    drawLanes(); renderReps(); renderStageBar();
    if (window.innerWidth < 900) $('stage-wrap').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  $('prev-rep').onclick = () => { if (shown && shown.reps.length) focusOn(shown, focusRep == null ? 0 : Math.max(0, focusRep - 1)); };
  $('next-rep').onclick = () => { if (shown && shown.reps.length) focusOn(shown, focusRep == null ? 0 : Math.min(shown.reps.length - 1, focusRep + 1)); };

  /* ---------- the reps, one by one ---------- */
  let focusRep = null;
  const sec = (ms) => (ms / 1000).toFixed(1) + 's';
  const fmtV = (v, u) => (v == null ? '—' : (Math.abs(v) >= 100 || u === '°' ? Math.round(v) : +v.toFixed(1)) + (u || ''));
  /* why an attempt did or did not count, in words, from the numbers Trace kept */
  function whyOf(r) {
    const w = r.why; if (!w) return '';
    const up = w.dir > 0, past = up ? '≥' : '≤';
    const parts = [];
    parts.push(`reached ${fmtV(w.peak, w.unit)} (a rep starts ${past} ${fmtV(w.raiseAt, w.unit)}` + (w.top ? `, the top is ${fmtV(w.top.lo, w.unit)}–${fmtV(w.top.hi, w.unit)}` : '') + ')');
    if (w.targetMs > 0) parts.push(`the hold clock ran ${sec(r.holdMs)} of the ${sec(w.targetMs)} asked` + (w.inPosMs < w.targetMs + w.settleMs && !r.counted ? ` — it runs only once every band has been right for ${sec(w.settleMs)}, and was in position ${sec(w.inPosMs)} in all` : ''));
    const bad = Object.entries(w.bad).filter(([, ms]) => ms > 0).sort((x, y) => y[1] - x[1]);
    if (bad.length) parts.push('out of its band at the top: ' + bad.map(([k, ms]) => `${esc((move.bands.find((b) => b.key === k) || {}).label || k)} for ${sec(ms)}`).join(', '));
    if (w.unseenMs > 300) parts.push(`not trusted for ${sec(w.unseenMs)}` + (w.edgeMs ? ' \u2014 ' + Object.entries(w.edgeParts).map(([part, ms]) => `the ${part} at the edge of the picture for ${sec(ms)}`).join(', ') : ''));
    if (!r.counted && !r.open) parts.push(r.early ? `back at the start (${past === '≥' ? '≤' : '≥'} ${fmtV(w.downAt, w.unit)} for ${sec(w.returnMs)}) before the hold was done — not counted` : 'not counted');
    if (r.counted && w.targetMs === 0) parts.push('counted on reaching the top and coming back — no hold asked');
    return parts.join(' · ');
  }
  function renderReps() {
    const host = $('reps');
    if (!recordings.length) { host.innerHTML = '<li class="muted">Load a video or a trace.</li>'; $('reps-note').textContent = ''; lanesReps = []; lanesMisses = []; return; }
    const label = (id) => (id[0] === '+' ? id.slice(1) : (move.cues[id] && move.cues[id].label) || id);
    let counted = 0, all = 0, classified = 0, provisional = 0, misses = 0;
    const groups = recordings.map((rec) => {
      const reps = rec.reps, ms = rec.misses;
      counted += reps.filter((r) => r.counted).length; all += reps.length; misses += ms.length;
      for (const r of reps) { const lb = Trace.labelOf(rec.labels, r); if (lb) { classified += 1; if (lb.provisional) provisional += 1; } }
      const faultLine = (f) => `<b>${esc(label(f.id))}</b> ${f.stretches.map((s) => s.t0 === s.t1 ? sec(s.t0) : sec(s.t0) + '–' + sec(s.t1)).join(', ')}` + (f.said.length ? ` <span class="said">said at ${f.said.map(sec).join(', ')}</span>` : ' <span class="muted">not said</span>');
      const items = reps.map((r, i) => ({ t: r.t0, html: (() => {
        const meta = [`${sec(r.t0)} to ${sec(r.t1)}`, r.holdMs ? `held ${sec(r.holdMs)}` : null, r.lowerMs != null ? `lowered over ${sec(r.lowerMs)}` : null].filter(Boolean).join(' · ');
        const why = move.reps ? `<div class="rep-why">${whyOf(r)}</div>` : '';
        const before = r.before.faults.length ? `<div class="rep-before">before it: ${r.before.faults.map(faultLine).join('; ')}</div>` : '';
        const inside = r.faults.length ? `<ul>${r.faults.map((f) => `<li>${faultLine(f)}</li>`).join('')}</ul>` : '<div class="clean">clean</div>';
        const lb = Trace.labelOf(rec.labels, r);
        return `<li class="rep${r.counted ? '' : ' not'}${rec === shown && focusRep === i ? ' focus' : ''}${lb && lb.tag === 'skip' ? ' skipped' : ''}" data-rec="${rec.id}" data-i="${i}"><div class="rep-head"><b>${repName(r, rec)}</b> <span class="muted">${meta}</span></div>${why}${before}${inside}${labelRow(rec, i, lb, 'rep')}</li>`;
      })() })).concat(ms.map((m, j) => ({ t: m.t0, html: `<li class="miss" data-rec="${rec.id}" data-t="${m.tPeak}" data-j="${j}"><div class="rep-head"><b>Short of a rep</b> <span class="muted">${sec(m.t0)} to ${sec(m.t1)}</span></div><div class="rep-why">reached ${fmtV(m.peak, m.unit)} at ${sec(m.tPeak)}, ${Math.round(m.share * 100)}% of the way to the ${fmtV(m.raiseAt, m.unit)} a rep starts at — nothing began</div>${labelRow(rec, j, Trace.labelOf(rec.labels, m), 'miss')}</li>` })));
      items.sort((x, y) => x.t - y.t);
      const readyAt = rec.result.rows.find((x) => x.out && x.out.ready);
      const setup = move.reps ? `<li class="setup"><div class="rep-head"><b>Before the coaching</b> <span class="muted">${readyAt ? `${sec(rec.result.rows[0].t)} to ${sec(readyAt.t)}` : 'the whole recording'}</span></div><div class="rep-why">${readyAt ? `the start position was held for ${sec(rec.result.cfg.readyMs)} and the coaching began` : `the start position was never held for ${sec(rec.result.cfg.readyMs)} — no rep can begin until it is`}</div></li>` : '';
      const empty = !items.length ? (move.reps ? '<li class="muted">No attempt at a rep seen.</li>' : '<li class="muted">No stretch held.</li>') : '';
      const n = reps.length, c = reps.filter((r) => r.counted).length, lab = reps.filter((r) => Trace.labelOf(rec.labels, r)).length;
      return `<li class="rec-group" data-rec="${rec.id}" data-shown="${rec === shown}"><div class="group-head"><b>${esc(rec.name)}</b><span class="meta">${move.reps ? `${c} counted${n > c ? `, ${n - c} not` : ''}` : `${n} held`}${ms.length ? `, ${ms.length} short of a rep` : ''} · ${lab} of ${n} classified</span>${rec === shown ? '' : '<button class="btn tiny-btn" type="button" data-act="show">Show</button>'}</div><ol>${setup}${items.map((x) => x.html).join('')}${empty}</ol></li>`;
    });
    host.innerHTML = groups.join('');
    $('reps-note').textContent = `${move.reps ? `${counted} counted${all > counted ? `, ${all - counted} not` : ''}` : `${all} held`}${misses ? `, ${misses} short of a rep` : ''} · ${classified} classified${provisional ? ` (${provisional} from a take's tag, not confirmed)` : ''}, ${all - classified} not yet`;
    host.querySelectorAll('.group-head button[data-act="show"]').forEach((b) => { b.onclick = () => { const rec = recordings.find((r) => r.id === b.closest('.rec-group').dataset.rec); if (rec) show(rec); }; });
    host.querySelectorAll('li.rep[data-i]').forEach((li) => { li.onclick = () => { const rec = recordings.find((r) => r.id === li.dataset.rec); if (rec) focusOn(rec, Number(li.dataset.i)); }; });
    host.querySelectorAll('li.miss[data-t]').forEach((li) => { li.onclick = () => { const rec = recordings.find((r) => r.id === li.dataset.rec); if (!rec) return; if (rec !== shown) show(rec); const t = Number(li.dataset.t); if (video.duration) video.currentTime = t / 1000; else { drawOverlay(t); drawLanes(); } }; });
    lanesReps = shown ? shown.reps : []; lanesMisses = shown ? shown.misses : [];
    renderStageBar();
  }
  /* the chips under a rep: clean, each fault the exercise knows, a fault named on the spot, not a rep;
     under a short movement: this was a rep. A tap classifies and does not open the rep. */
  function labelRow(rec, i, lb, kind) {
    const label = (id) => (id[0] === '+' ? id.slice(1) : (move.cues[id] && move.cues[id].label) || id);
    const prov = lb && lb.provisional ? ' provisional' : '';
    const pressed = (on) => ` aria-pressed="${on ? 'true' : 'false'}"`;
    if (kind === 'miss') return `<div class="rep-label" data-kind="miss" data-rec="${rec.id}" data-i="${i}"><span class="lbl">Your verdict</span><button class="btn clean${prov}" type="button" data-v="rep"${pressed(lb && lb.tag === 'rep')}>This was a rep</button></div>`;
    const ids = Trace.faultIds(move).concat(otherFaults());
    const faults = ids.map((id) => `<button class="btn ${id[0] === '+' ? 'other' : 'fault'}${prov}" type="button" data-v="${esc(id)}"${pressed(lb && lb.tag === 'faults' && lb.faults.includes(id))}>${esc(label(id))}</button>`).join('');
    return `<div class="rep-label" data-kind="rep" data-rec="${rec.id}" data-i="${i}"><span class="lbl">Your verdict</span><button class="btn clean${prov}" type="button" data-v="clean"${pressed(lb && lb.tag === 'clean')}>Clean</button>${faults}<button class="btn other" type="button" data-v="+" title="A fault the exercise does not know yet: name it, and the studio looks for a measure that tells it apart">+ another fault…</button><button class="btn${prov}" type="button" data-v="skip"${pressed(lb && lb.tag === 'skip')}>Not a rep</button>${lb ? (lb.provisional ? '<span class="tiny">from the take\'s tag — tap to confirm</span>' : '') : '<span class="tiny">not yet classified</span>'}</div>`;
  }
  /* one listener for every chip row, in the list and under the stage */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.rep-label .btn'); if (!b) return;
    e.stopPropagation(); e.preventDefault();
    const row = b.closest('.rep-label'), rec = recordings.find((r) => r.id === row.dataset.rec); if (!rec) return;
    const seg = row.dataset.kind === 'rep' ? rec.reps[Number(row.dataset.i)] : rec.misses[Number(row.dataset.i)]; if (!seg) return;
    let v = b.dataset.v;
    if (v === '+') { const words = window.prompt('What did you see? A few words for the fault — they become its name.'); if (!words || !words.trim()) return; v = '+' + words.trim().replace(/\s+/g, ' ').slice(0, 40); }
    setLabel(rec, seg, (l) => {
      if (v === 'clean') return { tag: 'clean', faults: [] };
      if (v === 'skip') return l.tag === 'skip' && !l.provisional ? null : { tag: 'skip', faults: [] };
      if (v === 'rep') return l.tag === 'rep' && !l.provisional ? null : { tag: 'rep', faults: [] };
      const set = new Set(l.tag === 'faults' ? l.faults : []);
      if (l.provisional) { /* a tap on the take's own verdict confirms it rather than undoing it */ if (!set.has(v)) set.add(v); }
      else if (set.has(v)) set.delete(v); else set.add(v);
      return set.size ? { tag: 'faults', faults: [...set] } : { tag: 'clean', faults: [] };
    });
  }, true);

  /* ---------- the numbers recommended from the verdicts, pooled over every recording ---------- */
  const runs = () => recordings.filter((r) => r.result).map((r) => ({ result: r.result, reps: r.reps, misses: r.misses, labels: r.labels, name: r.name, rec: r.id }));
  function recommendNow() { return recordings.length ? Trace.recommend(move, runs()) : null; }
  function renderRecommend() {
    const table = $('recommend'), note = $('recommend-note'), all = $('recommend-all'); if (!table) return;
    const rec = recommendNow();
    const hand = (r) => { if (window.__builder && window.__builder.showRecommendations) window.__builder.showRecommendations(r); };
    if (!rec) { table.innerHTML = ''; note.textContent = ''; all.style.display = 'none'; hand(null); return; }
    const reps = recordings.reduce((a, r) => a + r.reps.length, 0);
    const words = (f) => f.status === 'fine' ? 'fine as it is' : f.status === 'move' ? `move to ${fmtV(f.value, f.unit)}` : `best cut ${fmtV(f.value, f.unit)} — ${f.afterFalse + f.afterMiss} rep${f.afterFalse + f.afterMiss === 1 ? '' : 's'} still on the wrong side`;
    const range = (x, u) => (x.n ? `${x.n}: ${x.lo === x.hi ? fmtV(x.lo, u) : fmtV(x.lo, u) + ' to ' + fmtV(x.hi, u)}` : '—');
    if (!rec.labelled) { table.innerHTML = ''; note.textContent = reps ? `nothing classified yet — ${reps} rep${reps === 1 ? '' : 's'} to look at` : ''; all.style.display = 'none'; hand(rec); return; }
    const moves = rec.faults.filter((f) => f.status !== 'fine').concat(rec.lines.filter((l) => l.status !== 'fine'));
    note.textContent = `from ${rec.labelled} classified rep${rec.labelled === 1 ? '' : 's'} in ${recordings.length} recording${recordings.length === 1 ? '' : 's'}${rec.unlabelled ? `, ${rec.unlabelled} not yet` : ''}${rec.skipped ? `, ${rec.skipped} left out` : ''}: ${moves.length ? `${moves.length} number${moves.length === 1 ? '' : 's'} to move` : 'every number agrees with your verdicts'}`;
    const rows = rec.faults.map((f) => `<tr><td><b>${esc(f.label)}</b><br><span class="range">${esc(W.settingWords(move.spec, f.key) || f.setting)}</span></td><td>${fmtV(f.now, f.unit)}</td><td class="range">${range(f.clean, f.unit)}</td><td class="range">${range(f.bad, f.unit)}</td><td class="range">${f.nowFalse} false alarm${f.nowFalse === 1 ? '' : 's'}, ${f.nowMiss} missed</td><td class="${f.status}">${words(f)}</td><td>${f.status === 'fine' ? '' : `<button class="btn tiny-btn" data-key="${esc(f.key)}" data-value="${f.value}">Apply</button>`}</td></tr>`)
      .concat(rec.lines.map((l) => `<tr><td><b>A rep starts past</b><br><span class="range">${esc(l.setting)}</span></td><td>${fmtV(l.now, l.unit)}</td><td class="range" colspan="2">the reps you called reps reach ${fmtV(l.nearest, l.unit)} at the least (${l.n})</td><td class="range">${l.status === 'move' ? 'one falls short of the line' : 'all cross it'}</td><td class="${l.status}">${l.status === 'fine' ? 'fine as it is' : `move to ${fmtV(l.value, l.unit)}`}</td><td>${l.status === 'fine' ? '' : `<button class="btn tiny-btn" data-key="${esc(l.key)}" data-value="${l.value}">Apply</button>`}</td></tr>`));
    table.innerHTML = rows.length ? '<tr><th>fault · its number</th><th>now</th><th>clean reps reach</th><th>marked reps reach</th><th>now</th><th>recommended</th><th></th></tr>' + rows.join('') : '<tr><td class="muted">No fault\'s edge can be read from these labels yet.</td></tr>';
    all.style.display = moves.length < 2 ? 'none' : '';   // the button's own display rule would override `hidden`
    const setNumber = (k, v) => { if (window.__builder) window.__builder.setNumber(k, v); };
    table.querySelectorAll('button[data-key]').forEach((b) => { b.onclick = () => setNumber(b.dataset.key, Number(b.dataset.value)); });
    all.onclick = () => { if (window.__builder) window.__builder.setNumbers(Object.fromEntries(moves.map((m) => [m.key, m.value]))); };
    hand(rec);
  }

  /* ---------- measures not yet built that tell the marked reps from the clean ones ---------- */
  let suggestTimer = 0, lastDiscovery = null;
  function renderSuggest() { clearTimeout(suggestTimer); suggestTimer = setTimeout(discoverNow, 250); }
  function discoverNow() {
    const host = $('suggest'), noteEl = $('suggest-note'); if (!host) return;
    if (!Trace.discover || !recordings.length) { host.innerHTML = `<p class="tiny muted">${recordings.length ? '' : 'Load a recording and classify its reps; anything that tells the reps you mark apart is suggested here.'}</p>`; noteEl.textContent = ''; lastDiscovery = null; return; }
    let d;
    try { d = Trace.discover(move, runs(), { describe: (m) => W.describe(m, move.spec) }); } catch (e) { host.innerHTML = `<p class="tiny muted">Could not look: ${esc(e.message || e)}</p>`; return; }
    lastDiscovery = d;
    const groups = (d.groups || []).filter((g) => g.id !== '*' || g.rows.length);
    const tried = d.candidates ? `${d.candidates.kept || d.candidates.total || 0} measures tried` : '';
    noteEl.textContent = d.labelled ? `from ${d.labelled} classified rep${d.labelled === 1 ? '' : 's'}${tried ? ' · ' + tried : ''}` : '';
    if (!groups.length) { host.innerHTML = '<p class="tiny muted">Classify reps on the right — clean ones and ones with a fault — and anything that tells them apart is suggested here.</p>'; return; }
    const fmtU = (v, u) => (v == null ? '—' : (Math.abs(v) >= 100 ? Math.round(v) : +Number(v).toFixed(Math.abs(v) < 10 ? 1 : 0)) + (u || ''));
    const rangeOf = (x, u) => (x && x.n ? (Math.abs(x.lo - x.hi) < 0.05 ? fmtU(x.lo, u) : `${fmtU(x.lo, u)}–${fmtU(x.hi, u)}`) : '—');
    const dots = (row) => {
      const vals = row.values || []; if (!vals.length) return '';
      const lo = Math.min(...vals.map((v) => v.v), row.edge), hi = Math.max(...vals.map((v) => v.v), row.edge), span = (hi - lo) || 1;
      const x = (v) => 8 + ((v - lo) / span) * 344;
      return `<svg class="dots" viewBox="0 0 360 22" aria-label="each rep's value"><line x1="8" y1="11" x2="352" y2="11" stroke="rgba(232,237,244,.25)"/><line x1="${x(row.edge)}" y1="2" x2="${x(row.edge)}" y2="20" stroke="#ffb545" stroke-width="2"/>${vals.map((v) => `<circle cx="${x(v.v)}" cy="11" r="5" fill="${v.marked ? '#ff5c6c' : '#35d07f'}" data-t="${v.t0}" data-take="${esc(v.take || '')}"><title>${esc(v.take || '')} ${v.n ? 'rep ' + v.n : ''}: ${fmtU(v.v, row.unit)} ${v.marked ? '(marked)' : '(clean)'}</title></circle>`).join('')}</svg>`;
    };
    host.innerHTML = groups.map((g, gi) => {
      const head = `<h3>For ‘${esc(g.label)}’ <span class="tiny">${g.n ? `${g.n.marked} marked, ${g.n.clean} clean` : ''}${g.when ? ` · judged ${esc(W.whenWords(move.spec, g.when))}` : ''}${g.luck != null && g.luck >= 1 ? ` · about ${Math.round(g.luck)} of the measures would split these reps by luck alone — the gap is what counts` : ''}</span></h3>`;
      if (!g.rows || !g.rows.length) return `<div class="suggest-group" data-id="${esc(g.id)}">${head}<p class="tiny muted">${esc(g.note || 'Nothing separates them yet.')}</p></div>`;
      return `<div class="suggest-group" data-id="${esc(g.id)}">${head}` + g.rows.map((row, ri) => {
        const w = row.words || {};
        const sentence = w.sentence || `${w.what || row.measurement.key} — clean reps ${rangeOf(row.clean, row.unit)}, marked reps ${rangeOf(row.marked, row.unit)} · suggest ${row.side === 'above' ? 'at most' : 'at least'} ${fmtU(row.edge, row.unit)}`;
        const act = row.status === 'existing' && row.existing
          ? (row.existing.hasFault ? `<span class="tiny">already built as <b>${esc(row.existing.label || row.existing.key)}</b> — its number is tuned in its card above</span>` : `<button class="btn tiny-btn" type="button" data-act="fault" data-g="${gi}" data-r="${ri}">Add a fault on ‘${esc(row.existing.label || row.existing.key)}’</button>`)
          : `<button class="btn tiny-btn" type="button" data-act="add" data-g="${gi}" data-r="${ri}">Add this measure and a fault</button>`;
        const also = row.also && row.also.length ? `<span class="tiny"> · moves with: ${row.also.slice(0, 3).map((a) => esc((a.words && a.words.what) || (a.measurement && a.measurement.key) || '')).join(', ')}${row.also.length > 3 ? ` and ${row.also.length - 3} more` : ''}</span>` : '';
        return `<div class="suggest-row${row.status === 'existing' ? ' existing' : ''}"><div><b>${esc(sentence)}</b></div>${dots(row)}<div class="why">${esc(w.meaning || '')}${w.meaning ? ' ' : ''}${esc(row.why || '')}${also}</div><div class="row">${act}</div></div>`;
      }).join('') + '</div>';
    }).join('');
    host.querySelectorAll('button[data-act]').forEach((b) => { b.onclick = () => { const g = groups[Number(b.dataset.g)], row = g.rows[Number(b.dataset.r)]; if (!window.__builder) return; if (b.dataset.act === 'add') window.__builder.addDiscovered(row, g); else window.__builder.addFaultOn(row, g); }; });
    host.querySelectorAll('circle[data-t]').forEach((c) => { c.onclick = () => { const rec = recordings.find((r) => r.name === c.dataset.take) || shown; if (!rec) return; if (rec !== shown) show(rec); const t = Number(c.dataset.t); if (video.duration) video.currentTime = t / 1000; else { drawOverlay(t); drawLanes(); } }; });
  }
  /* a fault named on the spot that the builder has now built: the labels follow the new id */
  function renameFault(from, to) { for (const r of recordings) { let changed = false; for (const l of r.labels) { const i = (l.faults || []).indexOf(from); if (i >= 0) { l.faults[i] = to; changed = true; } } if (changed) saveLabels(r); } renderReps(); }

  let lanesReps = [], lanesMisses = [], lanesGeom = null;
  const bandColour = (ok) => (ok == null ? C.dim : ok ? C.good : C.bad);
  const PH = { setup: 'rgba(232,237,244,.10)', down: 'rgba(90,169,255,.18)', up: 'rgba(53,208,127,.30)', lower: 'rgba(255,181,69,.30)', done: 'rgba(53,208,127,.5)' };
  function drawLanes() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const P = result && Trace.progressOf(move, result.cfg);
    const W = lanes.clientWidth || 600, laneH = 56, gap = 6, bottom = 54, progH = P ? 150 : 0;
    const bands = move.bands.filter((b) => !P || b.key !== P.key);
    const H = progH + (P ? gap : 0) + bands.length * (laneH + gap) + bottom;
    lanes.width = Math.round(W * dpr); lanes.height = Math.round(H * dpr); lanes.style.height = H + 'px';
    const ctx = lanes.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'; ctx.textBaseline = 'top';
    lanesGeom = null;
    if (!result) { ctx.fillStyle = C.dim; ctx.fillText('Load a video or a trace', 8, 8); return; }
    const rows = result.rows, dur = Math.max(1, trace.duration || rows[rows.length - 1].t);
    const c = result.cfg, left = 92, span = W - left;
    lanesGeom = { left, span, dur, progH, P, bands, laneH, gap, yBands: progH + (P ? gap : 0), yb: progH + (P ? gap : 0) + bands.length * (laneH + gap), c };
    const x = (t) => left + (t / dur) * span, fw = Math.max(1, span / rows.length);
    const line = (Kf, y0, h, key, colour, width) => { ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath(); let pen = false; for (const r of rows) { const v = r.reading && r.reading.ok ? r.reading[key] : null; if (v == null) { pen = false; continue; } const px = x(r.t), py = Kf(v); if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py); } ctx.stroke(); };
    /* the rep lane: the reading a rep is judged on, its lines, its top, and the coach's phases behind it */
    if (P) {
      const vals = rows.map((r) => (r.reading && r.reading.ok ? r.reading[P.of] : null)).filter((v) => v != null);
      const marks = [P.raiseAt, P.downAt].concat(P.band ? Object.values(Trace.bandRange(P.band, c)) : []);
      let s0 = Math.min(...marks, ...(vals.length ? [Math.min(...vals)] : [])), s1 = Math.max(...marks, ...(vals.length ? [Math.max(...vals)] : []));
      const pad = Math.max(2, (s1 - s0) * 0.08); s0 -= pad; s1 += pad;
      const y = (v) => 14 + (progH - 14) - ((Math.max(s0, Math.min(s1, v)) - s0) / (s1 - s0)) * (progH - 14);
      ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(left, 0, span, progH);
      /* phases: grey before the coaching, blue between reps, green up, amber lowering */
      const TINT = { setup: 'rgba(232,237,244,.09)', down: 'rgba(90,169,255,.09)', up: 'rgba(53,208,127,.16)', lower: 'rgba(255,181,69,.18)', done: 'rgba(90,169,255,.09)' };
      for (const r of rows) { const o = r.out; const ph = o ? (o.between ? 'done' : o.phase) : null; if (ph && TINT[ph]) { ctx.fillStyle = TINT[ph]; ctx.fillRect(x(r.t), 0, fw, progH); } }
      /* the top: the band it must be inside to hold */
      if (P.band) { const { lo, hi } = Trace.bandRange(P.band, c); ctx.fillStyle = 'rgba(53,208,127,.28)'; ctx.fillRect(left, y(hi), span, y(lo) - y(hi)); }
      /* the two lines */
      const backed = (words, px, py, colour, align) => { ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'; const w = ctx.measureText(words).width + 6; const x0 = align === 'right' ? px - w : px; ctx.fillStyle = 'rgba(11,15,22,.8)'; ctx.fillRect(x0, py - 1, w, 13); ctx.fillStyle = colour; ctx.fillText(words, x0 + 3, py); };
      const dashed = (v, colour, words) => { ctx.strokeStyle = colour; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(W, y(v)); ctx.stroke(); ctx.setLineDash([]); backed(words, W - 2, y(v) + (P.dir > 0 === (v === P.raiseAt) ? -14 : 3), colour, 'right'); };
      dashed(P.raiseAt, C.accent, `a rep starts ${P.dir > 0 ? 'above' : 'below'} ${fmtV(P.raiseAt, P.unit)}`);
      dashed(P.downAt, C.warn, `back at the start ${P.dir > 0 ? 'below' : 'above'} ${fmtV(P.downAt, P.unit)}`);
      /* the reading, and over it the moments the hold clock ran */
      line(y, 0, progH, P.of, C.ink, 2);
      ctx.strokeStyle = C.good; ctx.lineWidth = 4; ctx.beginPath(); let pen = false;
      for (const r of rows) { const on = r.out && r.out.holding, v = r.reading && r.reading.ok ? r.reading[P.of] : null; if (!on || v == null) { pen = false; continue; } const px = x(r.t), py = y(v); if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py); } ctx.stroke();
      /* frames the top band was out */
      if (P.band) { ctx.fillStyle = 'rgba(255,92,108,.55)'; for (const r of rows) if (r.verdict && r.verdict.ok && r.verdict.good && r.verdict.good[P.key] === false) ctx.fillRect(x(r.t), progH - 4, fw, 4); }
      /* frames not trusted because a needed point was at the picture's edge */
      ctx.fillStyle = C.edge; for (const r of rows) if (r.reading && r.reading.edge) ctx.fillRect(x(r.t), 0, fw, 4);
      ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = C.ink; ctx.fillText('THE REP', 6, 4);
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = C.dim; ctx.fillText(P.label.slice(0, 13), 6, 18); ctx.fillText(`${fmtV(s1, P.unit)} top`, 6, 32); ctx.fillText(`${fmtV(s0, P.unit)} bottom`, 6, progH - 14);
      /* the stretch before the coaching, said in words once */
      const readyAt = rows.find((r) => r.out && r.out.ready);
      if (!readyAt || readyAt.t > dur * 0.06) backed(readyAt ? 'waiting for the start position' : 'the start position was never held', left + 3, progH / 2, C.dim);
      /* movements that fell short of a rep */
      ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
      for (const m of lanesMisses) { const px = x(m.tPeak), py = y(m.peak); ctx.fillStyle = C.warn; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillText('?', px + 6, Math.max(2, py - 14)); }
    }
    const yBands = progH + (P ? gap : 0);
    bands.forEach((b, i) => {
      const y0 = yBands + i * (laneH + gap), { lo, hi } = Trace.bandRange(b, c), [t0, t1] = b.scale;
      const y = (v) => y0 + laneH - ((Math.max(t0, Math.min(t1, v)) - t0) / (t1 - t0)) * laneH;
      ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(left, y0, span, laneH);
      ctx.fillStyle = 'rgba(53,208,127,.22)'; ctx.fillRect(left, y(hi), span, y(lo) - y(hi));
      ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = C.ink; ctx.fillText(b.hud, 6, y0 + 4);
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = C.dim;
      ctx.fillText((b.label || '').slice(0, 13), 6, y0 + 17);
      ctx.fillText(`band ${Math.round(lo)}–${Math.round(hi)}${unitOf(b.key)}`, 6, y0 + 29);
      ctx.fillText(`${t1}${unitOf(b.key)} to ${t0}${unitOf(b.key)}`, 6, y0 + 41);
      line(y, y0, laneH, b.of, C.ink, 1.5);
      /* frames where this band was out */
      ctx.fillStyle = 'rgba(255,92,108,.55)';
      for (const r of rows) if (r.verdict && r.verdict.ok && r.verdict.good && r.verdict.good[b.key] === false) ctx.fillRect(x(r.t), y0 + laneH - 4, fw, 4);
    });
    /* the coach: phases and cues */
    const yb = yBands + bands.length * (laneH + gap);
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = C.ink; ctx.fillText('COACH', 6, yb + 4);
    for (const r of rows) {
      const ph = r.out && (r.out.between ? 'done' : r.out.phase);
      const col = ph ? PH[ph] : (r.out && r.out.holding ? PH.up : (r.verdict && r.verdict.inPosition ? PH.down : null));
      if (col) { ctx.fillStyle = col; ctx.fillRect(x(r.t), yb, fw, 18); }
    }
    for (const cue of result.cues) {
      const px = x(cue.t);
      const good = cue.id === 'hold' || cue.id === 'done' || /^call\d|^count\d/.test(cue.id) || cue.id === 'start';
      ctx.fillStyle = good ? C.good : cue.id === 'raise' || cue.id === 'lower' ? C.accent : cue.id === 'edge' || cue.id === 'framing' ? C.edge : C.bad;
      ctx.fillRect(px, yb + 20, 2, 14);
      const words = (move.cues[cue.id] && move.cues[cue.id].label) || cue.id;
      const rowN = result.cues.indexOf(cue) % 2;   // the words on two rows in turn, so neighbours do not run into each other
      ctx.save(); ctx.translate(px + 4, yb + 34 + rowN * 11); ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'; ctx.fillText(words.slice(0, 14), 0, 0); ctx.restore();
    }
    /* the reps, marked off */
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    lanesReps.forEach((r, i) => {
      const x0 = x(r.t0), x1 = x(r.t1);
      if (focusRep === i) { ctx.fillStyle = 'rgba(90,169,255,.10)'; ctx.fillRect(x0, 0, x1 - x0, H); }
      ctx.strokeStyle = r.counted ? 'rgba(232,237,244,.35)' : 'rgba(255,181,69,.5)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, H); ctx.stroke(); ctx.setLineDash([]);
      const words = r.counted ? `rep ${r.n}` : '× not counted'; ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif'; const w = ctx.measureText(words).width + 6; ctx.fillStyle = 'rgba(11,15,22,.8)'; ctx.fillRect(x0 + 1, 1, w, 13); ctx.fillStyle = r.counted ? C.good : C.warn; ctx.fillText(words, x0 + 4, 2);
    });
    /* the playhead */
    if (video.duration) { const px = x(video.currentTime * 1000); ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); }
  }
  /* ---------- the graph under the pointer: what a line or a red mark is, in words ---------- */
  const lanesTip = document.createElement('div'); lanesTip.className = 'lanes-tip'; lanesTip.hidden = true; document.body.appendChild(lanesTip);
  const PHASE_WORDS = { setup: 'waiting for the start position', down: 'at the start, between reps', up: 'on the way up / at the top', lower: 'lowering', done: 'set done' };
  /* the faults on a measurement, and which of them a reading this far out would be */
  function faultsFor(key, value, lo, hi) {
    const side = value == null ? null : value > hi ? 'above' : value < lo ? 'below' : null;
    return (move.spec.faults || []).filter((f) => f.measure === key && (!side || f.side === side));
  }
  function faultLine(f, o) {
    const id = f.id, label = (move.cues[id] && move.cues[id].label) || f.label || id;
    const when = (move.when && move.when[id]) || f.when || 'top';
    const on = o && o.active && o.active.includes(id);
    return `<span class="bad">‘${esc(label)}’</span> ${on ? '<b>— on now</b>' : `<span class="dim">— judged ${esc(W.whenWords(move.spec, when))}${o && o.phase ? ', not at this moment' : ''}</span>`}`;
  }
  function lanesHover(e) {
    const g = lanesGeom; if (!g || !result) { lanesTip.hidden = true; return; }
    const rect = lanes.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (px < g.left) { lanesTip.hidden = true; return; }
    const t = Math.max(0, ((px - g.left) / g.span) * g.dur), r = rowAt(t), rd = r && r.reading, v = r && r.verdict, o = r && r.out;
    const out = [`<b>${sec(t)}</b>${o ? ` <span class="dim">· ${esc(o.between ? 'set done' : PHASE_WORDS[o.phase] || '')}${o.holding ? ' · hold clock running' : ''}</span>` : ''}`];
    if (!rd || !rd.ok) out.push('<span class="dim">no reading here: the body was not seen well enough</span>');
    else if (g.P && py < g.progH) {
      const P = g.P, val = rd[P.of];
      out.push(`${esc(P.label)}: <b>${fmtV(val, P.unit)}</b> <span class="dim">· a rep starts ${P.dir > 0 ? 'above' : 'below'} ${fmtV(P.raiseAt, P.unit)}, back at the start ${P.dir > 0 ? 'below' : 'above'} ${fmtV(P.downAt, P.unit)}</span>`);
      if (P.band) {
        const { lo, hi } = Trace.bandRange(P.band, g.c), bad = v && v.good && v.good[P.key] === false;
        out.push(bad ? `<span class="bad">red: outside the top band ${fmtV(lo, P.unit)} to ${fmtV(hi, P.unit)}</span>` : `<span class="dim">top band ${fmtV(lo, P.unit)} to ${fmtV(hi, P.unit)}</span>`);
        if (bad) for (const f of faultsFor(P.key, val, lo, hi)) out.push(faultLine(f, o));
      }
    } else if (py < g.yb) {
      const i = Math.floor((py - g.yBands) / (g.laneH + g.gap)), b = g.bands[i];
      if (b) {
        const { lo, hi } = Trace.bandRange(b, g.c), val = rd[b.of], u = unitOf(b.key), bad = v && v.good && v.good[b.key] === false;
        out.push(`${esc(b.label || b.hud)}: <b>${fmtV(val, u)}</b> <span class="dim">· allowed ${fmtV(lo, u)} to ${fmtV(hi, u)}</span>`);
        if (bad) { out.push('<span class="bad">red: outside what is allowed</span>'); for (const f of faultsFor(b.key, val, lo, hi)) out.push(faultLine(f, o)); }
        else out.push('<span class="good">inside what is allowed</span>');
      }
    } else {
      /* the coach's lane: the cue nearest the pointer, if one is close */
      let best = null; for (const cue of result.cues) { const d = Math.abs(g.left + (cue.t / g.dur) * g.span - px); if (d < 8 && (!best || d < best.d)) best = { cue, d }; }
      if (best) {
        const cue = best.cue, label = move.cues[cue.id] && move.cues[cue.id].label;
        out.push(`<span class="${isCorrection(cue) ? 'bad' : 'good'}">said at ${sec(cue.t)}: “${esc(cue.text)}”</span>${label && label !== cue.text ? ` <span class="dim">(${esc(label)})</span>` : ''}`);
      } else out.push('<span class="dim">no cue here</span>');
    }
    if (o && o.active && o.active.length) out.push(`faults on now: <span class="bad">${esc(Overlay.faultWords(o, move.cues))}</span>`);
    lanesTip.innerHTML = out.join('<br>'); lanesTip.hidden = false;
    const tw = lanesTip.offsetWidth, th = lanesTip.offsetHeight;
    lanesTip.style.left = Math.min(window.innerWidth - tw - 8, e.clientX + 14) + 'px';
    lanesTip.style.top = (e.clientY + 14 + th > window.innerHeight ? e.clientY - th - 10 : e.clientY + 14) + 'px';
  }
  lanes.onmousemove = lanesHover;
  lanes.onmouseleave = () => { lanesTip.hidden = true; };
  lanes.onclick = (e) => {
    if (!result) return;
    const rect = lanes.getBoundingClientRect(), left = 92, W = rect.width;
    const t = Math.max(0, (e.clientX - rect.left - left) / (W - left)) * (trace.duration || 1);
    if (video.duration) video.currentTime = Math.min(video.duration, t / 1000);
    else { drawOverlay(t); drawLanes(); }
  };
  function listCues() {
    $('cue-log').innerHTML = result ? (result.cues.map((c) => `<li><b>${(c.t / 1000).toFixed(1)}s</b> — ${esc(c.text)}</li>`).join('') || '<li>Nothing would have been said.</li>') : '';
  }

  /* ---------- the skeleton over the video, at the moment shown ---------- */
  function sizeOverlay() {
    const r = video.getBoundingClientRect(); overlay.width = Math.round(r.width); overlay.height = Math.round(r.height);
  }
  /* the model's raw landmarks nearest a moment, for the review aid that draws them all */
  function frameAt(tMs) {
    if (!trace) return null;
    let best = null; for (const f of trace.frames) { if (!best || Math.abs(f.t - tMs) < Math.abs(best.t - tMs)) best = f; }
    return best;
  }
  const allPoints = () => !!($('all-points') && $('all-points').checked);
  function rowAt(tMs) {
    if (!result) return null;
    let best = null; for (const r of result.rows) { if (!best || Math.abs(r.t - tMs) < Math.abs(best.t - tMs)) best = r; }
    return best;
  }
  /* the picture at this moment, drawn by the same drawing the coach's page uses,
     over the video: the skeleton, the readings, the counters, the cue as it was */
  const isCorrection = (cue) => Overlay.isCorrection(cue, move);
  function drawOverlay(atMs) {
    const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
    const t = atMs != null ? atMs : video.currentTime * 1000;
    const r = rowAt(t);
    if (!r || !trace) return;
    const f = frameAt(t);
    Overlay.draw(ctx, {
      W: overlay.width, H: overlay.height, source: null, aspect: trace.aspect,
      move, cfg: Object.assign({}, Trace.defaults(move), { mirror: false, angles: true, setCount: 1, showPoints: allPoints() }),
      reading: r.reading, verdict: r.verdict, out: r.out, setNo: 1, points: f ? f.lm : null,
      banner: Overlay.bannerAt(result.cues, t, isCorrection), now: t, rec: false, cues: move.cues, noCue: true,
    });
    stageCue(t, r);
    renderTracked(t);
  }
  /* the cue and the faults of the moment, under the picture rather than over the body */
  function stageCue(t, r) {
    const host = $('stage-cue'); if (!host) return;
    const b = result && Overlay.bannerAt(result.cues, t, isCorrection), o = r && r.out;
    const said = host.querySelector('.said'), faults = host.querySelector('.faults');
    said.textContent = b ? b.text : '';
    said.classList.toggle('bad', !!b && b.colour === Overlay.C.bad);
    faults.textContent = o && !o.between ? Overlay.faultWords(o, move.cues) : '';
  }
  /* ---------- beside the video: what is tracked, at the playhead, and the take in numbers ---------- */
  const unitOf = (key) => { const m = (move.measurements || []).find((q) => q.key === key); const kind = m ? m.kind : 'angle'; return ['angle', 'tilt', 'floor', 'down', 'bend'].includes(kind) ? '\u00b0' : kind === 'distance' ? '%' : ''; };
  function renderTracked(atMs) {
    const host = $('tracked'); if (!host) return;
    const body = host.tBodies[0] || host.appendChild(document.createElement('tbody'));
    if (!result) { body.innerHTML = '<tr><td class="muted" colspan="4">Load a video or a trace.</td></tr>'; $('take-stats').textContent = ''; $('tracked-at').textContent = ''; return; }
    const t = atMs != null ? atMs : video.currentTime * 1000, r = rowAt(t), rd = r && r.reading, v = r && r.verdict, o = r && r.out, c = result.cfg;
    $('tracked-at').textContent = `at ${sec(t)}`;
    const rows = [], P = Trace.progressOf(move, c);
    for (const b of move.bands) {
      const val = rd && rd.ok ? rd[b.of] : null, { lo, hi } = Trace.bandRange(b, c), ok = v && v.ok && v.good ? v.good[b.key] : null;
      rows.push(`<tr class="${ok === false ? 'out' : ok ? 'in' : ''}"><th>${esc(b.hud)}</th><td class="v">${val == null ? '\u2014' : fmtV(val, unitOf(b.key))}</td><td class="muted">${Math.round(lo)}\u2013${Math.round(hi)}${P && P.key === b.key ? ' \u00b7 the rep' : ''}</td><td>${ok === false ? 'out' : ok ? 'in' : ''}</td></tr>`);
    }
    if (P && !move.bands.some((b) => b.key === P.key)) { const val = rd && rd.ok ? rd[P.of] : null; rows.push(`<tr><th>REP</th><td class="v">${fmtV(val, P.unit)}</td><td class="muted">starts ${P.dir > 0 ? '\u2265' : '\u2264'} ${fmtV(P.raiseAt, P.unit)}</td><td></td></tr>`); }
    const phase = o ? (o.ready ? (o.phase || (o.holding ? 'holding' : 'in position')) : 'set-up wait') : '\u2014';
    rows.push(`<tr><th>coach</th><td colspan="3">${esc(phase)}${o && o.reps != null ? ` \u00b7 rep ${o.reps} of ${o.repTarget}` : ''}${o && o.holdMs ? ` \u00b7 held ${sec(o.holdMs)}` : ''}</td></tr>`);
    const seen = rd ? (rd.ok ? `the ${rd.side === 'L' ? 'left' : 'right'} side` : (rd.why || 'not seen')) : 'no frame';
    const needed = move.needed || [], cert = rd && rd.ok && rd.points ? Math.round((100 * needed.reduce((a, k) => a + ((rd.points[k] && rd.points[k].v) || 0), 0)) / Math.max(1, needed.length)) : null;
    rows.push(`<tr class="${rd && rd.ok ? '' : 'out'}"><th>seen</th><td colspan="3">${esc(seen)}${cert != null ? ` \u00b7 needed points ${cert}% sure` : ''}${r && r.held ? ` \u00b7 ${r.held} joint${r.held === 1 ? '' : 's'} held` : ''}</td></tr>`);
    const s = r && r.scene;
    if (s) { const cue = Core.sceneCue(s); rows.push(`<tr class="${cue ? 'out' : ''}"><th>light</th><td colspan="3">brightness ${s.luma}${s.body != null ? ` \u00b7 you ${s.body} vs background ${s.bg}, colour ${s.colour}` : ''}${cue ? ` \u00b7 <b>${esc((move.cues[cue] && move.cues[cue].text) || cue)}</b>` : ''}</td></tr>`); }
    body.innerHTML = rows.join('');
    const all = result.rows, dur = trace.duration || 0;
    const edgeMs = all.reduce((a, x, i) => a + (x.reading && x.reading.edge && i ? x.t - all[i - 1].t : 0), 0), heldFrames = all.filter((x) => x.held).length, unseen = all.filter((x) => !x.verdict || !x.verdict.ok).length;
    const scenes = all.map((x) => x.scene).filter(Boolean), avg = (k) => (scenes.reduce((a, q) => a + (q[k] || 0), 0) / scenes.length).toFixed(2);
    const saidScene = result.cues.filter((q) => ['dark', 'backlit', 'blend'].includes(q.id)).map((q) => q.id);
    $('take-stats').innerHTML = `<b>The take</b> \u00b7 ${trace.frames.length} frames, ${(dur / 1000).toFixed(1)} s${trace.fps ? `, ${trace.fps} a second` : ''} \u00b7 ${result.cues.length} cues${move.reps ? ` \u00b7 ${result.summary.reps} reps` : ` \u00b7 held ${result.summary.holdSec} s`} \u00b7 ${unseen} frame${unseen === 1 ? '' : 's'} not trusted${edgeMs ? ` (${(edgeMs / 1000).toFixed(1)} s at the edge)` : ''}${heldFrames ? ` \u00b7 a joint held in ${heldFrames}` : ''}${scenes.length ? ` \u00b7 light ${avg('luma')}, you ${avg('body')} vs background ${avg('bg')}${saidScene.length ? `, said: ${saidScene.join(', ')}` : ''}` : ''}`;
  }
  if ($('all-points')) $('all-points').addEventListener('change', () => drawOverlay());
  video.addEventListener('timeupdate', () => { drawOverlay(); drawLanes(); });
  video.addEventListener('seeked', () => { drawOverlay(); drawLanes(); });
  window.addEventListener('resize', () => { sizeOverlay(); drawOverlay(); drawLanes(); });

  /* ---------- the animation editor: the muscle figure, by hand ---------- */
  /* the points of a figure, by view: a side view has one limb near and one far; a
     front view (a body lying on its side facing the camera) has a left and a right */
  const KEYS_BY = { side: ['h', 'sh', 'hip', 'kn', 'an', 'he', 'ft', 'el', 'wr', 'knF', 'anF', 'heF', 'ftF', 'elF', 'wrF'], front: ['h', 'shL', 'shR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'heL', 'heR', 'toL', 'toR', 'elL', 'wrL', 'elR', 'wrR'] };
  const FAR = new Set(['knF', 'anF', 'heF', 'ftF', 'elF', 'wrF']);
  /* the bone above each joint: a drag turns that bone and carries everything below it round,
     so every limb keeps its length — a hip drags the whole body */
  const PARENT = {
    side: { h: 'sh', sh: 'hip', el: 'sh', wr: 'el', elF: 'sh', wrF: 'elF', kn: 'hip', an: 'kn', he: 'an', ft: 'an', knF: 'hip', anF: 'knF', heF: 'anF', ftF: 'anF' },
    front: { h: 'shR', shL: 'hipL', shR: 'hipR', elL: 'shL', wrL: 'elL', elR: 'shR', wrR: 'elR', knL: 'hipL', anL: 'knL', heL: 'anL', toL: 'anL', knR: 'hipR', anR: 'knR', heR: 'anR', toR: 'anR' },
  };
  const ROOTS = { side: ['hip'], front: ['hipL', 'hipR'] };
  const GHOST_CHAINS = { side: [['sh', 'hip', 'kn', 'an', 'ft'], ['sh', 'el', 'wr'], ['hip', 'knF', 'anF', 'ftF'], ['sh', 'elF', 'wrF'], ['an', 'he'], ['anF', 'heF']], front: [['shL', 'hipL', 'knL', 'anL'], ['shR', 'hipR', 'knR', 'anR'], ['shL', 'shR'], ['hipL', 'hipR'], ['shL', 'elL', 'wrL'], ['shR', 'elR', 'wrR'], ['anL', 'heL', 'toL'], ['anR', 'heR', 'toR']] };
  const fig = { view: 'side', A: null, B: null, hold: false, flip: false, side: 'both', wall: null, w: {}, second: null, belly: null };
  /* the editor's viewpoint: the camera's (editable, the muscle figure), from above (editable in
     depth only), isometric (a look) */
  let ev = 'camera';
  const pr = (p, k) => Figure.project(p, k, ev);
  const KEYS = () => KEYS_BY[fig.view] || KEYS_BY.side;
  let kf = 'A', drag = null, quiet = false, orig = null;
  const descendants = (k) => { const P = PARENT[fig.view] || PARENT.side; return KEYS().filter((c) => { let x = c; while (x) { if (x === k) return true; x = P[x]; } return false; }); };
  const edit = $('anim-edit');
  const copyK = (K, keys) => { const o = {}; for (const k of keys) if (K && K[k]) o[k] = typeof K[k][2] === 'number' ? [K[k][0], K[k][1], K[k][2]] : [K[k][0], K[k][1]]; return o; };
  /* a figure given as points (a file's figure.points, or the builder's draft) into the editor */
  function setFig(f) {
    if (!f || !f.A) return;
    fig.view = f.view === 'front' && f.A.hipL ? 'front' : 'side';
    fig.A = copyK(f.A, KEYS()); fig.B = copyK(f.B || f.A, KEYS());
    fig.hold = !!f.hold; fig.flip = !!f.flip; fig.side = f.side || 'both'; fig.wall = f.wall != null ? f.wall : null; fig.w = Object.assign({}, f.w || {}); fig.second = Figure.VIEWS.includes(f.second) && f.second !== 'camera' ? f.second : null;
    fig.belly = f.belly === 1 || f.belly === -1 ? f.belly : null;
    orig = JSON.stringify({ A: fig.A, B: fig.B });   // for "Undo my edits"
    $('anim-hold').value = fig.hold ? 'yes' : 'no'; $('anim-flip').value = fig.flip ? 'yes' : 'no'; $('anim-side').value = fig.side; $('anim-wall').value = fig.wall == null ? '' : fig.wall; $('anim-second').value = fig.second || '';
    $('anim-belly').value = fig.belly == null ? 'auto' : String(fig.belly);
    buildWeights(); quiet = true; animChanged(); quiet = false;
  }
  /* the selected exercise's figure into the editor */
  function animLoad() {
    const lib = (Moves.library && Moves.library[move.id]) || move;
    const f = window.Figure ? Figure.figureOf(lib) : null;
    const base = f || Object.assign(Figure.fromAngles({ A: { torso: 0 } }), { view: 'side' });
    setFig(Object.assign({}, base, { view: base.view || (move.figure && move.figure.view) || 'side', flip: !!(move.figure && move.figure.flip) || !!(move.pose && move.pose.A && move.pose.A.face === 'left'), side: (move.figure && move.figure.side) || 'both', w: move.muscles || (move.figure && move.figure.w) || {} }));
  }
  function buildWeights() {
    const host = $('weights'); host.innerHTML = '';
    for (const k of A.regions) {
      const v = fig.w[k] || 0;
      const lab = el('label', null, `<span>${k} <b id="w-${k}">${v.toFixed(2)}</b></span><input type="range" id="wt-${k}" min="0" max="100" step="5" value="${Math.round(v * 100)}">`);
      host.appendChild(lab);
      lab.querySelector('input').oninput = (e) => { fig.w[k] = Number(e.target.value) / 100; $('w-' + k).textContent = fig.w[k].toFixed(2); if (!fig.w[k]) delete fig.w[k]; animChanged(); };
    }
  }
  const figureJson = () => ({ view: fig.view, A: fig.A, B: fig.hold ? undefined : fig.B, hold: fig.hold, side: fig.side, flip: fig.flip, w: fig.w, ...(fig.wall != null ? { wall: fig.wall } : {}), ...(fig.second ? { second: fig.second } : {}), ...(fig.belly != null ? { belly: fig.belly } : {}) });
  /* The front of the body, in a side view: which side of the hip→shoulder line the belly is on. The
     figure's own sign when it has one, otherwise the pose's (the knee leads), decided once for both
     keyframes. The select says each side in the picture's terms at A — down toward the floor, up,
     left, right — since a sign on a line means nothing to the eye. */
  const bellyAuto = () => (fig.A ? A.bellyOf(A.unify(fig.A, fig.view), A.unify(fig.B || fig.A, fig.view)) : 1);
  const bellyNow = () => (fig.belly != null ? fig.belly : bellyAuto());
  function bellyWords() {
    const sel = $('anim-belly'); if (!sel || !fig.A || fig.view !== 'side' || !fig.A.hip || !fig.A.sh) return;
    const tdx = fig.A.sh[0] - fig.A.hip[0], tdy = fig.A.sh[1] - fig.A.hip[1], L = Math.hypot(tdx, tdy) || 1e-6, vx = -tdy / L, vy = tdx / L;
    const dir = (sgn) => { const x = vx * sgn, y = vy * sgn; return Math.abs(y) >= Math.abs(x) ? (y > 0 ? 'down, toward the floor' : 'up, away from the floor') : (x > 0 ? 'to the right' : 'to the left'); };
    for (const o of sel.options) o.textContent = o.value === 'auto' ? `From the pose — the knee leads the front (now ${dir(bellyAuto())})` : `Facing ${dir(Number(o.value))}`;
  }
  function animChanged() {
    bellyWords();
    drawEditor();
    const j = figureJson();
    $('anim-json').value = JSON.stringify(j);
    A.register('edit', Object.assign({}, j, { B: j.B || j.A }));
    A.mountAll($('fig-panel'));
    /* the builder's draft carries the figure: every drag goes to it */
    if (!quiet && window.__builder && window.__builder.figChanged) window.__builder.figChanged(j);
  }
  /* the editor's canvas: the keyframe drawn as the muscle figure, the joints as handles */
  function fitBox() {
    const xs = [216, 400], ys = ev === 'top' ? [Figure.TOP_Y - 40, Figure.TOP_Y + 34] : [26, 168];
    for (const K of [fig.A, fig.B]) for (const k in K || {}) { const p = pr(K[k], k); xs.push(p[0]); ys.push(p[1]); }
    if (fig.wall != null && ev !== 'top') xs.push(fig.wall);
    if (ev === 'iso') { xs.push(400 + Figure.ISO[0] * 60); ys.push(168 + Figure.ISO[1] * 60); }
    const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, y0 = Math.min(...ys) - 16, y1 = Math.max(...ys) + (ev === 'top' ? 10 : 0);
    return { x: x0, y: y0, w: x1 - x0, h: (ev === 'top' ? y1 : 168) - y0 };
  }
  function editTransform() {
    const r = edit.getBoundingClientRect(), box = fitBox();
    const s = Math.min(r.width / box.w, r.height / box.h) * 0.94;
    return { s, tx: r.width / 2 - (box.x + box.w / 2) * s, ty: r.height / 2 - (box.y + box.h / 2) * s, w: r.width, h: r.height };
  }
  /* the wall reaches above the figure's highest point, so a hand walking up it stays on it */
  function wallTopOf() { let top = 164; for (const K of [fig.A, fig.B]) for (const k in K || {}) if (Array.isArray(K[k])) top = Math.min(top, K[k][1]); return Math.min(34, top - 10); }
  function drawEditor() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), r = edit.getBoundingClientRect();
    if (!r.width) return;
    edit.width = Math.round(r.width * dpr); edit.height = Math.round(r.height * dpr);
    const ctx = edit.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
    const K = fig[kf]; if (!K) return;   // nothing to draw until a figure is set
    const T = editTransform();
    ctx.save(); ctx.translate(T.tx, T.ty); ctx.scale(T.s, T.s);
    if (ev !== 'camera') { drawOtherView(ctx, K, T); ctx.restore(); ctx.fillStyle = C.dim; ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.fillText((kf === 'A' ? 'A \u2014 the start' : 'B \u2014 the end') + (ev === 'top' ? ' \u00b7 from above: drag down toward the camera, up away' : ' \u00b7 isometric: a look, not editable'), 8, 8); return; }
    ctx.strokeStyle = C.line; ctx.lineWidth = 2 / T.s; ctx.beginPath(); ctx.moveTo(216, 164); ctx.lineTo(400, 164); ctx.stroke();
    if (fig.wall != null) { ctx.lineWidth = 3 / T.s; ctx.beginPath(); ctx.moveTo(fig.wall, wallTopOf()); ctx.lineTo(fig.wall, 164); ctx.stroke(); }
    /* the other keyframe sits behind, faint, so an edit is seen against where the body was */
    const other = fig[kf === 'A' ? 'B' : 'A'];
    if (other && !fig.hold) {
      ctx.strokeStyle = 'rgba(90,169,255,.22)'; ctx.lineWidth = 3 / T.s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const c of GHOST_CHAINS[fig.view] || GHOST_CHAINS.side) { const pts = c.filter((k) => other[k]); if (pts.length < 2) continue; ctx.beginPath(); pts.forEach((k, i) => { if (i) ctx.lineTo(other[k][0], other[k][1]); else ctx.moveTo(other[k][0], other[k][1]); }); ctx.stroke(); }
    }
    const P = {
      skin: cssVar('--fig-skin', '#46295f'), skinline: cssVar('--fig-line', '#7658a0'), muscle: cssVar('--fig-muscle', '#55367a'),
      far: cssVar('--fig-far', '#38215a'), farline: cssVar('--fig-farline', '#4d3178'), warm: cssVar('--tangerine', '#ffb545'), hot: cssVar('--pink', '#ff5c8a'), floor: C.line, prop: '#1d2430',
    };
    const drive = kf === 'B' || fig.hold ? 1 : 0.25, heats = {};
    for (const k of A.regions) heats[k] = 0.07 + (fig.w[k] || 0) * drive * 0.93;
    try { A.drawFigure(ctx, A.unify(K, fig.view), P, heats, fig.view, { hold: fig.hold, side: fig.side, flip: fig.flip, belly: bellyNow(), w: fig.w }); } catch { }
    /* the feet, which the muscle figure does not draw: ankle to heel to toe */
    ctx.strokeStyle = 'rgba(232,237,244,.5)'; ctx.lineWidth = 2 / T.s;
    for (const [a, b] of fig.view === 'front' ? [['anL', 'heL'], ['heL', 'toL'], ['anR', 'heR'], ['heR', 'toR']] : [['an', 'he'], ['he', 'ft'], ['anF', 'heF'], ['heF', 'ftF']]) { if (K[a] && K[b]) { ctx.beginPath(); ctx.moveTo(K[a][0], K[a][1]); ctx.lineTo(K[b][0], K[b][1]); ctx.stroke(); } }
    /* the handles */
    for (const k of KEYS()) {
      const p = K[k]; if (!p) continue;
      ctx.beginPath(); ctx.arc(p[0], p[1], 4 / T.s, 0, Math.PI * 2);
      ctx.fillStyle = FAR.has(k) ? 'rgba(90,169,255,.55)' : C.accent; ctx.fill();
      ctx.strokeStyle = '#06121f'; ctx.lineWidth = 1 / T.s; ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = C.dim; ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText(kf === 'A' ? 'A — the start' : 'B — the end', 8, 8);
  }
  const cssVar = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  /* from above or isometric: the chains as lines, the far limbs dimmer, the other keyframe faint,
     the camera's mark or the floor as a slab; handles from above only */
  function drawOtherView(ctx, K, T) {
    const chains = GHOST_CHAINS[fig.view] || GHOST_CHAINS.side;
    const line = (Kf, colour, width) => { ctx.strokeStyle = colour; ctx.lineWidth = width / T.s; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (const c of chains) { const pts = c.filter((k) => Kf[k]); if (pts.length < 2) continue; const far = FAR.has(pts[pts.length - 1]); ctx.globalAlpha = far ? 0.4 : 1; ctx.beginPath(); pts.forEach((k, i) => { const p = pr(Kf[k], k); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke(); } ctx.globalAlpha = 1; if (Kf.h) { const p = pr(Kf.h, 'h'); ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.fill(); } };
    ctx.strokeStyle = C.line; ctx.lineWidth = 2 / T.s;
    if (ev === 'top') {
      ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(180, Figure.TOP_Y); ctx.lineTo(440, Figure.TOP_Y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.dim; ctx.beginPath(); ctx.moveTo(300, Figure.TOP_Y + 26); ctx.lineTo(318, Figure.TOP_Y + 26); ctx.lineTo(313, Figure.TOP_Y + 17); ctx.lineTo(305, Figure.TOP_Y + 17); ctx.closePath(); ctx.fill();
      ctx.font = `${11 / T.s}px ui-sans-serif, system-ui, sans-serif`; ctx.fillText('camera', 324, Figure.TOP_Y + 27);
    } else {
      const [dx, dy] = [Figure.ISO[0] * 60, Figure.ISO[1] * 60], nx = Figure.ISO[0] * -12, ny = Figure.ISO[1] * -12;
      ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.beginPath(); ctx.moveTo(216 + nx, 164 + ny); ctx.lineTo(400 + nx, 164 + ny); ctx.lineTo(400 + dx, 164 + dy); ctx.lineTo(216 + dx, 164 + dy); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (fig.wall != null) { ctx.lineWidth = 3 / T.s; ctx.beginPath(); ctx.moveTo(fig.wall, wallTopOf()); ctx.lineTo(fig.wall, 164); ctx.stroke(); }
    }
    const other = fig[kf === 'A' ? 'B' : 'A'];
    if (other && !fig.hold) line(other, 'rgba(90,169,255,.22)', 3);
    line(K, C.ink, 4);
    if (ev !== 'top') return;
    for (const k of KEYS()) { const p = K[k]; if (!p) continue; const q = pr(p, k); ctx.beginPath(); ctx.arc(q[0], q[1], 4 / T.s, 0, Math.PI * 2); ctx.fillStyle = FAR.has(k) ? 'rgba(90,169,255,.55)' : C.accent; ctx.fill(); ctx.strokeStyle = '#06121f'; ctx.lineWidth = 1 / T.s; ctx.stroke(); }
  }
  function toFig(e) { const T = editTransform(), r = edit.getBoundingClientRect(); return [(e.clientX - r.left - T.tx) / T.s, (e.clientY - r.top - T.ty) / T.s]; }
  edit.addEventListener('pointerdown', (e) => {
    if (ev === 'iso') return;   // a look, not editable
    const [x, y] = toFig(e), K = fig[kf];
    let best = null, bd = 12;
    for (const k of KEYS()) { const p = K[k]; if (!p) continue; const q = pr(p, k); const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = k; } }
    /* a root (the hip) drags the whole body; shift swaps turning for stretching for this one drag */
    const roots = ROOTS[fig.view] || ROOTS.side, stretch = $('anim-stretch') ? $('anim-stretch').checked : false;
    drag = { key: best && roots.includes(best) ? '*' : best, last: [x, y], stretch: e.shiftKey ? !stretch : stretch };
    if (drag.key) { edit.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  edit.addEventListener('pointermove', (e) => {
    if (!drag || !drag.key) return;
    const [x, y] = toFig(e), K = fig[kf], dx = x - drag.last[0], dy = y - drag.last[1];
    const P = PARENT[fig.view] || PARENT.side, par = drag.key === '*' ? null : P[drag.key];
    if (ev === 'top') {
      /* from above only the depth moves: down the page is toward the camera; what hangs off the joint comes along */
      const keys = drag.key === '*' ? Object.keys(K) : descendants(drag.key);
      for (const k of keys) if (K[k]) K[k][2] = Figure.zOf(K[k], k) - dy;
    } else if (drag.key === '*') { for (const k in K) { K[k][0] += dx; K[k][1] += dy; } }
    else if (drag.stretch || !par || !K[par]) {
      /* the bone follows the pointer and changes length; everything below comes along unchanged */
      for (const k of descendants(drag.key)) if (K[k]) { K[k][0] += dx; K[k][1] += dy; }
    } else {
      /* the bone above the joint turns about its top; everything below turns with it, every length kept */
      const o = K[par], a0 = Math.atan2(drag.last[1] - o[1], drag.last[0] - o[0]), a1 = Math.atan2(y - o[1], x - o[0]), d = a1 - a0, cs = Math.cos(d), sn = Math.sin(d);
      for (const k of descendants(drag.key)) if (K[k]) { const px = K[k][0] - o[0], py = K[k][1] - o[1]; K[k][0] = o[0] + px * cs - py * sn; K[k][1] = o[1] + px * sn + py * cs; }
    }
    drag.last = [x, y];
    animChanged();
  });
  const rounded = () => { for (const K of [fig.A, fig.B]) for (const k in K || {}) { K[k][0] = Math.round(K[k][0]); K[k][1] = Math.round(K[k][1]); if (typeof K[k][2] === 'number') { K[k][2] = Math.round(K[k][2]); if (K[k][2] === Figure.zOf([0, 0], k)) K[k].length = 2; } } };
  const drop = () => { if (drag) { drag = null; rounded(); animChanged(); } };
  edit.addEventListener('pointerup', drop); edit.addEventListener('pointercancel', drop);
  $('kf-A').onclick = () => { kf = 'A'; $('kf-A').setAttribute('aria-pressed', 'true'); $('kf-B').setAttribute('aria-pressed', 'false'); drawEditor(); };
  $('kf-B').onclick = () => { kf = 'B'; $('kf-B').setAttribute('aria-pressed', 'true'); $('kf-A').setAttribute('aria-pressed', 'false'); drawEditor(); };
  $('anim-load').onclick = animLoad;
  for (const v of Figure.VIEWS) $('ev-' + v).onclick = () => { ev = v; for (const w of Figure.VIEWS) $('ev-' + w).setAttribute('aria-pressed', String(w === v)); drawEditor(); };
  $('anim-second').onchange = (e) => { fig.second = e.target.value || null; animChanged(); };
  $('anim-copy-ab').onclick = () => { fig[kf === 'A' ? 'B' : 'A'] = JSON.parse(JSON.stringify(fig[kf])); animChanged(); };
  $('anim-undo').onclick = () => { if (!orig) return; const o = JSON.parse(orig); fig.A = o.A; fig.B = o.B; animChanged(); };
  $('anim-hold').onchange = (e) => { fig.hold = e.target.value === 'yes'; animChanged(); };
  $('anim-flip').onchange = (e) => { fig.flip = e.target.value === 'yes'; animChanged(); };
  $('anim-belly').onchange = (e) => { fig.belly = e.target.value === 'auto' ? null : Number(e.target.value); animChanged(); };
  $('anim-side').onchange = (e) => { fig.side = e.target.value; animChanged(); };
  $('anim-wall').onchange = (e) => { fig.wall = e.target.value === '' ? null : Number(e.target.value); animChanged(); };
  $('anim-download').onclick = () => save(new Blob([JSON.stringify(figureJson(), null, 2)], { type: 'application/json' }), `${move.id}-figure.json`);
  $('anim-copy').onclick = async () => { try { await navigator.clipboard.writeText($('anim-json').value); $('anim-copy').textContent = 'Copied'; setTimeout(() => { $('anim-copy').textContent = 'Copy as JSON'; }, 1500); } catch { $('anim-json').select(); } };

  /* ---------- a demo film: the clip drawn over and voiced, after the fact ----------
     The same drawing the coach's page makes (overlay.js) on every frame of the
     clip, and the same sounds — the coach's own voice for each cue at its moment
     and the tone the app plays with it — mixed the way the page's own graph mixes
     them, over the clip's own sound where it has one, with that turned down while
     the voice speaks. The picture is encoded frame by frame and the sound as one
     track, into the same MP4 the coach writes. */
  let speech = null, demo = null;
  function loadSpeech() {
    if (!speech) speech = (window.Speech ? Speech.load('js/vendor/mespeak/', Core.VER, 'js/speech-worker.js', 'voice/') : Promise.reject(new Error('no voice'))).catch(() => null);
    return speech;
  }
  const rmsAround = (pcm, sr, cues) => cues.slice(0, 3).map((c) => Mixdown.rmsAt(pcm, sr, c.t / 1000, 1));
  async function renderDemo() {
    const note = (t) => { $('demo-note').textContent = t; };
    if (!trace || !result || trace.source !== 'video' || !trace.file || !video.videoWidth) { note('Load a video first: a trace alone has no picture to draw on.'); return; }
    const btn = $('render-demo'); btn.disabled = true;
    const overlayOn = $('demo-overlay').checked;
    demo = null;
    try {
      const dur = trace.duration / 1000, fps = 24, sr = 44100;
      let W = video.videoWidth, H = video.videoHeight;
      if (W > 1280) { H = Math.round((H * 1280) / W); W = 1280; }
      W -= W % 2; H -= H % 2;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const cues = result.cues;

      /* the sound: rendered offline, in one go */
      note('Making the voice\u2026');
      const client = await loadSpeech();
      const mix = await Mixdown.render({ cues, durationSec: dur, sampleRate: sr, original: await trace.file.arrayBuffer(), client,
        onProgress: (n, of) => note(`Making the voice\u2026 ${n} of ${of}`) });
      const pcmAll = mix.pcm, voiced = mix.voiced, original = mix.original;

      /* the picture: every frame drawn fresh at the film's rate */
      const pick = await Codec.pickCodec(W, H, fps, false);
      if (!pick) throw new Error('this browser cannot encode video');
      const samples = []; let desc = null, why = null;
      const enc = new VideoEncoder({
        output: (chunk, meta) => {
          const dc = meta && meta.decoderConfig;
          if (dc && dc.description && !desc) desc = Codec.bytesOf(dc.description);
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          samples.push({ data, ts: chunk.timestamp, key: chunk.type === 'key' });
        },
        error: (e) => { why = why || e; },
      });
      enc.configure(pick.config);
      const cfg = Object.assign({}, Trace.defaults(move), { mirror: false, angles: false, setCount: 1, showPoints: allPoints() });
      let n = 0;
      for (let t = 0; t < dur; t += 1 / fps, n++) {
        await seekTo(video, Math.min(t, dur - 0.001));
        const row = rowAt(t * 1000);
        if (overlayOn) {
          Overlay.draw(ctx, { W, H, source: { image: video, w: video.videoWidth, h: video.videoHeight, quarter: 0, mirror: false },
            move, cfg, reading: row && row.reading, verdict: row && row.verdict, out: row && row.out, setNo: 1,
            points: (frameAt(t * 1000) || {}).lm || null,
            banner: Overlay.bannerAt(cues, t * 1000, isCorrection), now: t * 1000, rec: false, cues: move.cues });
        } else ctx.drawImage(video, 0, 0, W, H);
        while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
        const f = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6) });
        try { enc.encode(f, { keyFrame: n % (fps * 2) === 0 }); } finally { f.close(); }
        if (why) throw why;
        if (n % 12 === 0) note(`Drawing the film\u2026 ${Math.round((t / dur) * 100)}%`);
      }
      await enc.flush(); enc.close();
      if (!samples.length) throw new Error('the encoder gave nothing back');

      note('Encoding the sound\u2026');
      let audio = null;
      try { audio = await Codec.encodeAudio(pcmAll, sr); } catch { audio = null; }
      const file = Mp4.write({ width: W, height: H, codec: pick.kind, description: desc, codecString: pick.codec, samples, created: new Date(), audio });
      const blob = new Blob([file], { type: 'video/mp4' });
      demo = { blob, frames: samples.length, sound: !!audio, voiced, cues: cues.length, original, overlay: overlayOn, rms: rmsAround(pcmAll, sr, cues), width: W, height: H };
      save(blob, `${String(trace.name || 'clip').replace(/\.[^.]+$/, '')}-demo.mp4`);
      note(`${(blob.size / 1e6).toFixed(1)} MB \u00b7 ${samples.length} frames \u00b7 ${audio ? `the voice on ${voiced} of ${cues.length} cues and every tone` : 'silent \u2014 this browser cannot encode sound'}${original ? ', over the clip\u2019s own sound' : ''}${overlayOn ? ', the coaching drawn on every frame' : ', the picture as it was'}.`);
    } catch (e) { note('Could not render: ' + (e.message || e)); demo = { why: String(e && e.message || e) }; }
    finally { btn.disabled = false; try { await seekTo(video, 0); } catch { } }
  }
  $('render-demo').onclick = renderDemo;

  $('move').onchange = () => { if (window.__builder) window.__builder.open($('move').value); };
  $('fig-edit').addEventListener('toggle', () => { if ($('fig-edit').open) requestAnimationFrame(() => animChanged()); });
  window.addEventListener('resize', () => { if ($('fig-edit').open) drawEditor(); });

  window.__review = {
    get demo() { return demo; },
    get recordings() { return recordings; }, get shown() { return shown; }, get trace() { return trace; }, get result() { return result; }, get move() { return move; },
    get labels() { return shown ? shown.labels : []; },
    get fig() { return figureJson(); }, get ev() { return ev; }, editBox: fitBox, editTransform, setFig, animLoad, animChanged, refreshMoves, setMove, rerun, judgeAll,
    /* a trace handed in by a test, or by the builder's own tools: it becomes a recording and is shown */
    loadTrace(frames, aspect, name) { return addRecording({ frames, aspect, name: name || 'trace', source: 'test', duration: frames.length ? frames[frames.length - 1].t : 0 }); },
    loadTakes, show(id) { const r = recordings.find((x) => x.id === id); if (r) show(r); }, remove: removeRecording, focus: (id, i) => { const r = recordings.find((x) => x.id === id); if (r) focusOn(r, i); },
    runs, recommend: recommendNow, discover() { discoverNow(); return lastDiscovery; }, get discovery() { return lastDiscovery; },
    setLabel, clearLabels, renameFault, saveTrace, setTag(id, tag) { const r = recordings.find((x) => x.id === id); if (r) setTag(r, tag); },
  };
  window.__studio = window.__review;
});
