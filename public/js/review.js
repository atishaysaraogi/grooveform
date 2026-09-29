/* ---------------------------------------------------------------------------
   The Review page: a recording judged after the fact, the numbers tuned against
   it, and the move's animation edited by hand.

   Recordings. A video is read once by the pose model, frame by frame, into a
   trace (trace.js). Every band edge is then a slider: move one and the whole
   recording is judged again at once, lanes redrawn, cues relisted. Traces are
   tagged as takes — clean, or showing one fault — and held to the tuning rule.
   The tuned numbers go into the coach's own settings on this device, or into a
   file to carry into the move's defaults.

   Animation. The muscle figure from the OnTrack build (anatomy.js) drawn at
   either keyframe with the joints as handles to drag, the muscles' effort as
   sliders, and the animated preview beside it. Saved as the JSON a move carries.
   --------------------------------------------------------------------------- */
Moves.ready.then(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  /* the builder's draft, kept in this browser, stands in the library here too */
  try { const d = JSON.parse(localStorage.getItem('ontrack.draft') || 'null'); if (d) Moves.draft(d); } catch { }
  $('move').innerHTML = Moves.list.map((m) => `<option value="${m.id}">${m.name}${m.draft ? ' (draft)' : ''}</option>`).join('');
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = { good: '#35d07f', warn: '#ffb545', bad: '#ff5c6c', ink: '#e8edf4', dim: 'rgba(232,237,244,.45)', line: '#263040', accent: '#5aa9ff', edge: '#e879f9' };
  const A = window.OnTrackAnatomy;

  let move = Moves.bridge || Moves.list[0], tuned = {}, trace = null, result = null, takes = [];
  const video = $('clip'), overlay = $('overlay'), lanes = $('lanes');

  /* ---------- the move and its numbers ---------- */
  function refreshMoves() { $('move').innerHTML = Moves.list.map((m) => `<option value="${m.id}">${m.name}${m.draft ? ' (draft)' : ''}</option>`).join(''); if (move) $('move').value = move.id; }
  /* `keep` holds the tuned numbers and the trace where they are: the builder
     re-laying its draft over the library is not a change of exercise */
  function pickMove(id, keep) {
    const same = keep && move && move.id === id;
    move = Moves[id] || Moves.bridge || Moves.list[0]; $('move').value = move.id;
    if (!same) tuned = {};
    $('tuned-to-draft').hidden = !move.draft;
    buildSliders(); buildTags(); rerun();
    /* the editor follows the exercise unless the builder has a draft, whose figure it holds */
    if (!same && !(window.__builder && window.__builder.draft)) animLoad();
  }
  function buildSliders() {
    const host = $('sliders'); host.innerHTML = '';
    const d = Trace.defaults(move);
    for (const s of Trace.settingsOf(move)) {
      const v = tuned[s.key] != null ? tuned[s.key] : d[s.key];
      const lab = el('label', null, `<span>${esc(s.label)} <b id="val-${s.key}">${v}</b></span>` +
        `<input type="range" id="cfg-${s.key}" min="${s.min}" max="${s.max}" step="1" value="${v}">`);
      host.appendChild(lab);
      lab.querySelector('input').oninput = (e) => { setTuned(s.key, Number(e.target.value)); };
    }
    $('tuned-note').textContent = '';
  }
  function setTuned(key, value) {
    tuned[key] = value;
    const v = $('val-' + key); if (v) v.textContent = value;
    const i = $('cfg-' + key); if (i && Number(i.value) !== value) i.value = value;
    const d = Trace.defaults(move), changed = Object.keys(tuned).filter((k) => tuned[k] !== d[k]);
    $('tuned-note').textContent = changed.length ? `${changed.length} changed from the defaults` : '';
    rerun();
  }
  $('reset').onclick = () => { tuned = {}; buildSliders(); rerun(); $('apply-note').textContent = ''; };

  /* the coach on this device keeps its numbers per move in the browser; the tuned
     ones go in beside whatever else is there, under the same version */
  $('apply').onclick = () => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('wallsit') || '{}') || {}; } catch { saved = {}; }
    if (saved.v !== Core.SETTINGS_V) saved = { v: Core.SETTINGS_V, move: move.id, common: {}, bands: {} };
    saved.bands = saved.bands || {};
    const mine = Object.assign({}, saved.bands[move.id] || {}, { stamp: Core.stampOf(move) });
    const d = Trace.defaults(move);
    for (const s of Trace.settingsOf(move)) mine[s.key] = String(tuned[s.key] != null ? tuned[s.key] : d[s.key]);
    saved.bands[move.id] = mine;
    try { localStorage.setItem('wallsit', JSON.stringify(saved)); $('apply-note').textContent = `Saved for the ${move.name} on this device. Open the coach and it uses them.`; }
    catch (e) { $('apply-note').textContent = 'Could not save: ' + (e.message || e); }
  };
  $('download-numbers').onclick = () => {
    const d = Trace.defaults(move), out = {};
    for (const s of Trace.settingsOf(move)) out[s.key] = tuned[s.key] != null ? tuned[s.key] : d[s.key];
    save(new Blob([JSON.stringify({ move: move.id, defaults: out }, null, 2)], { type: 'application/json' }), `${move.id}-numbers.json`);
  };
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
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      try { inline = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
      catch { inline = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
      return inline;
    })();
    return inlineLoad;
  }
  let workerFailed = null;
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
  const seekTo = (t) => new Promise((res) => { const done = () => { video.removeEventListener('seeked', done); res(); }; video.addEventListener('seeked', done); video.currentTime = t; });

  async function loadVideo(file) {
    const note = (t) => { $('progress').textContent = t; $('progress').hidden = !t; };
    note('Opening the video…');
    video.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('the video would not open')); });
    const aspect = video.videoWidth / video.videoHeight, dur = video.duration;
    const fps = Math.max(5, Math.min(30, Number($('fps').value) || 15));
    const frames = [];
    try {
      for (let t = 0; t < dur; t += 1 / fps) {
        await seekTo(Math.min(t, dur - 0.001));
        const lm = await poseFor(video, Math.round(t * 1000));
        frames.push({ t: Math.round(t * 1000), lm });
        if (frames.length % 5 === 0) note(`Reading the video… ${Math.round((t / dur) * 100)}% (${frames.length} frames)`);
      }
    } catch (e) { note('Could not read the video: ' + (e.message || e)); return; }
    note('');
    trace = { frames, aspect, name: file.name, source: 'video', fps, duration: dur * 1000, file };
    $('render-demo').disabled = false;
    await seekTo(0);
    sizeOverlay();
    rerun();
  }
  $('video-file').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) loadVideo(f).catch((err) => { $('progress').textContent = String(err.message || err); $('progress').hidden = false; }); };
  $('trace-file').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const { meta, frames } = Trace.unpack(await f.text());
      trace = { frames, aspect: meta.aspect || 16 / 9, name: f.name, source: 'trace', duration: frames.length ? frames[frames.length - 1].t : 0 };
      if (meta.move && Moves[meta.move]) pickMove(meta.move); else rerun();
    } catch (err) { $('progress').textContent = 'Not a trace: ' + (err.message || err); $('progress').hidden = false; }
  };
  $('export-trace').onclick = () => {
    if (!trace) return;
    save(new Blob([JSON.stringify(Trace.pack({ move: move.id, aspect: trace.aspect, name: trace.name, source: trace.source, fps: trace.fps || null }, trace.frames))], { type: 'application/json' }),
      `${move.id}-trace-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  };

  /* ---------- judging, and the lanes ---------- */
  let pending = 0;
  function rerun() {
    if (pending) return; pending = requestAnimationFrame(() => { pending = 0; judge(); });
  }
  function judge() {
    result = trace ? Trace.run(move, tuned, trace.frames, trace.aspect) : null;
    $('export-trace').disabled = !trace; $('add-take').disabled = !trace;
    const edgeMs = result ? result.rows.reduce((a, r, i) => a + (r.reading && r.reading.edge && i ? r.t - result.rows[i - 1].t : 0), 0) : 0;
    $('trace-note').textContent = trace ? `${trace.name} · ${trace.frames.length} frames · ${(trace.duration / 1000).toFixed(1)} s` + (result ? ` · ${result.cues.length} cues` + (move.reps ? `, ${result.summary.reps} reps` : '') + (edgeMs ? ` · ${(edgeMs / 1000).toFixed(1)} s with a point at the picture's edge` : '') : '') : 'no recording yet';
    drawLanes(); drawOverlay(); listCues(); renderReps(); renderVerdicts();
  }
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
    if (!result) { host.innerHTML = ''; $('reps-note').textContent = ''; return; }
    const reps = Trace.reps(result, move), misses = move.reps ? Trace.misses(result, move) : [];
    const label = (id) => (move.cues[id] && move.cues[id].label) || id;
    const counted = reps.filter((r) => r.counted).length;
    $('reps-note').textContent = move.reps ? `${counted} counted${reps.length > counted ? `, ${reps.length - counted} not` : ''}${misses.length ? `, ${misses.length} short of a rep` : ''}` : `${reps.length} stretch${reps.length === 1 ? '' : 'es'} held`;
    const faultLine = (f) => `<b>${esc(label(f.id))}</b> ${f.stretches.map((s) => s.t0 === s.t1 ? sec(s.t0) : sec(s.t0) + '–' + sec(s.t1)).join(', ')}` +
      (f.said.length ? ` <span class="said">said at ${f.said.map(sec).join(', ')}</span>` : ' <span class="muted">not said</span>');
    const items = reps.map((r, i) => ({ t: r.t0, html: (() => {
      const head = move.reps ? (r.counted ? `Rep ${r.n}` : (r.open ? 'Under way at the end' : 'Attempt, not counted')) : `Hold ${r.n}`;
      const meta = [`${sec(r.t0)} to ${sec(r.t1)}`, r.holdMs ? `held ${sec(r.holdMs)}` : null, r.lowerMs != null ? `lowered over ${sec(r.lowerMs)}` : null].filter(Boolean).join(' · ');
      const why = move.reps ? `<div class="rep-why">${whyOf(r)}</div>` : '';
      const before = r.before.faults.length ? `<div class="rep-before">before it: ${r.before.faults.map(faultLine).join('; ')}</div>` : '';
      const inside = r.faults.length ? `<ul>${r.faults.map((f) => `<li>${faultLine(f)}</li>`).join('')}</ul>` : '<div class="clean">clean</div>';
      return `<li class="rep${r.counted ? '' : ' not'}${focusRep === i ? ' focus' : ''}" data-i="${i}"><div class="rep-head"><b>${head}</b> <span class="muted">${meta}</span></div>${why}${before}${inside}</li>`;
    })() })).concat(misses.map((m) => ({ t: m.t0, html: `<li class="miss" data-t="${m.tPeak}"><div class="rep-head"><b>Short of a rep</b> <span class="muted">${sec(m.t0)} to ${sec(m.t1)}</span></div><div class="rep-why">reached ${fmtV(m.peak, m.unit)} at ${sec(m.tPeak)}, ${Math.round(m.share * 100)}% of the way to the ${fmtV(m.raiseAt, m.unit)} a rep starts at — nothing began</div></li>` })));
    items.sort((x, y) => x.t - y.t);
    const readyAt = result.rows.find((r) => r.out && r.out.ready);
    const setup = move.reps ? `<li class="setup"><div class="rep-head"><b>Before the coaching</b> <span class="muted">${readyAt ? `${sec(result.rows[0].t)} to ${sec(readyAt.t)}` : 'the whole recording'}</span></div><div class="rep-why">${readyAt ? `the start position was held for ${sec(result.cfg.readyMs)} and the coaching began` : `the start position was never held for ${sec(result.cfg.readyMs)} — no rep can begin until it is`}</div></li>` : '';
    host.innerHTML = setup + (items.map((x) => x.html).join('') || (move.reps ? '' : '<li class="muted">No stretch held yet.</li>'));
    if (move.reps && !items.length) host.insertAdjacentHTML('beforeend', '<li class="muted">No attempt at a rep seen.</li>');
    host.querySelectorAll('li.rep[data-i]').forEach((li) => { li.onclick = () => { const i = Number(li.dataset.i); focusRep = i; const r = reps[i]; if (video.duration) video.currentTime = r.t0 / 1000; else drawOverlay(r.t0); drawLanes(); renderReps(); }; });
    host.querySelectorAll('li.miss[data-t]').forEach((li) => { li.onclick = () => { const t = Number(li.dataset.t); if (video.duration) video.currentTime = t / 1000; else { drawOverlay(t); drawLanes(); } }; });
    lanesReps = reps; lanesMisses = misses;
  }
  let lanesReps = [], lanesMisses = [];
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
    if (!result) { ctx.fillStyle = C.dim; ctx.fillText('Load a video or a trace', 8, 8); return; }
    const rows = result.rows, dur = Math.max(1, trace.duration || rows[rows.length - 1].t);
    const c = result.cfg, left = 74, span = W - left;
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
      ctx.fillStyle = C.dim; ctx.fillText(P.label.slice(0, 12), 6, 18); ctx.fillText(`${fmtV(s1, P.unit)}`, 6, 32); ctx.fillText(`${fmtV(s0, P.unit)}`, 6, progH - 14);
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
      ctx.fillStyle = C.dim; ctx.fillText(`${Math.round(lo)}–${Math.round(hi)}`, 6, y0 + 18);
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
      ctx.save(); ctx.translate(px + 4, yb + 36); ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'; ctx.fillText(words.slice(0, 16), 0, 0); ctx.restore();
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
  lanes.onclick = (e) => {
    if (!result) return;
    const rect = lanes.getBoundingClientRect(), left = 74, W = rect.width;
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
      move, cfg: Object.assign({}, Trace.defaults(move), tuned, { mirror: false, angles: true, setCount: 1, showPoints: allPoints() }),
      reading: r.reading, verdict: r.verdict, out: r.out, setNo: 1, points: f ? f.lm : null,
      banner: Overlay.bannerAt(result.cues, t, isCorrection), now: t, rec: false, cues: move.cues,
    });
  }
  if ($('all-points')) $('all-points').addEventListener('change', () => drawOverlay());
  video.addEventListener('timeupdate', () => { drawOverlay(); drawLanes(); });
  video.addEventListener('seeked', () => { drawOverlay(); drawLanes(); });
  window.addEventListener('resize', () => { sizeOverlay(); drawOverlay(); drawLanes(); });

  /* ---------- takes and the rule ---------- */
  function buildTags() {
    const sel = $('take-tag'); sel.innerHTML = '<option value="clean">a clean set</option>';
    for (const id of Trace.faultIds(move)) sel.appendChild(el('option', null, esc((move.cues[id] && (move.cues[id].label || move.cues[id].text)) || id))).value = id;
  }
  $('add-take').onclick = () => {
    if (!trace) return;
    const tag = $('take-tag').value, name = $('take-name').value.trim() || trace.name || `take ${takes.length + 1}`;
    takes.push({ name, tag, move: move.id, frames: trace.frames, aspect: trace.aspect });
    $('take-name').value = '';
    renderVerdicts();
  };
  function renderVerdicts() {
    const mine = takes.filter((t) => t.move === move.id);
    $('export-takes').disabled = !takes.length;
    $('takes').innerHTML = mine.map((t, i) => `<li><b>${esc(t.name)}</b> — ${t.tag === 'clean' ? 'clean' : esc((move.cues[t.tag] && move.cues[t.tag].label) || t.tag)} · ${t.frames.length} frames <button class="btn tiny-btn" data-i="${i}">remove</button></li>`).join('') || '<li class="muted">No takes yet for this exercise.</li>';
    $('takes').querySelectorAll('button[data-i]').forEach((b) => { b.onclick = () => { const t = mine[Number(b.dataset.i)]; takes = takes.filter((x) => x !== t); renderVerdicts(); }; });
    const table = $('verdicts');
    if (!mine.length) { table.innerHTML = ''; return; }
    const v = Trace.verdicts(move, tuned, mine);
    table.innerHTML = '<tr><th>fault</th><th>quiet on clean takes</th><th>fires on its takes</th><th>verdict</th></tr>' + v.table.map((r) => {
      const label = (move.cues[r.id] && move.cues[r.id].label) || r.id;
      const verdict = r.pass == null ? '<span class="muted">no take of it</span>' : r.pass ? '<span class="ok">passes</span>' : '<span class="no">fails</span>';
      return `<tr><td>${esc(label)}</td><td>${r.cleanTotal - r.cleanFired} of ${r.cleanTotal}</td><td>${r.faultFired} of ${r.faultTotal}</td><td>${verdict}</td></tr>`;
    }).join('');
  }
  $('export-takes').onclick = () => {
    const out = { v: 1, kind: 'takes', takes: takes.map((t) => Trace.pack({ move: t.move, aspect: t.aspect, name: t.name, tag: t.tag }, t.frames)) };
    save(new Blob([JSON.stringify(out)], { type: 'application/json' }), `takes-${new Date().toISOString().slice(0, 10)}.json`);
  };
  $('takes-file').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || d.kind !== 'takes' || !Array.isArray(d.takes)) throw new Error('not a takes file');
      for (const tk of d.takes) { const { meta, frames } = Trace.unpack(tk); takes.push({ name: meta.name || 'take', tag: meta.tag || 'clean', move: meta.move || move.id, frames, aspect: meta.aspect || 16 / 9 }); }
      renderVerdicts();
    } catch (err) { $('progress').textContent = String(err.message || err); $('progress').hidden = false; }
  };

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
  const fig = { view: 'side', A: null, B: null, hold: false, flip: false, side: 'both', wall: null, w: {} };
  const KEYS = () => KEYS_BY[fig.view] || KEYS_BY.side;
  let kf = 'A', drag = null, quiet = false, orig = null;
  const descendants = (k) => { const P = PARENT[fig.view] || PARENT.side; return KEYS().filter((c) => { let x = c; while (x) { if (x === k) return true; x = P[x]; } return false; }); };
  const edit = $('anim-edit');
  const copyK = (K, keys) => { const o = {}; for (const k of keys) if (K && K[k]) o[k] = [K[k][0], K[k][1]]; return o; };
  /* a figure given as points (a file's figure.points, or the builder's draft) into the editor */
  function setFig(f) {
    if (!f || !f.A) return;
    fig.view = f.view === 'front' && f.A.hipL ? 'front' : 'side';
    fig.A = copyK(f.A, KEYS()); fig.B = copyK(f.B || f.A, KEYS());
    fig.hold = !!f.hold; fig.flip = !!f.flip; fig.side = f.side || 'both'; fig.wall = f.wall != null ? f.wall : null; fig.w = Object.assign({}, f.w || {});
    orig = JSON.stringify({ A: fig.A, B: fig.B });   // for "Undo my edits"
    $('anim-hold').value = fig.hold ? 'yes' : 'no'; $('anim-flip').value = fig.flip ? 'yes' : 'no'; $('anim-side').value = fig.side; $('anim-wall').value = fig.wall == null ? '' : fig.wall;
    buildWeights(); quiet = true; animChanged(); quiet = false;
  }
  /* the selected exercise's figure into the editor */
  function animLoad() {
    const f = window.Figure ? Figure.figureOf(move) : null;
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
  const figureJson = () => ({ view: fig.view, A: fig.A, B: fig.hold ? undefined : fig.B, hold: fig.hold, side: fig.side, flip: fig.flip, w: fig.w, ...(fig.wall != null ? { wall: fig.wall } : {}) });
  function animChanged() {
    drawEditor();
    const j = figureJson();
    $('anim-json').value = JSON.stringify(j);
    A.register('edit', Object.assign({}, j, { B: j.B || j.A }));
    A.mountAll($('fig-editor'));
    /* the builder's draft carries the figure: every drag goes to it */
    if (!quiet && window.__builder && window.__builder.figChanged) window.__builder.figChanged(j);
  }
  /* the editor's canvas: the keyframe drawn as the muscle figure, the joints as handles */
  function fitBox() {
    const xs = [216, 400], ys = [26, 168];
    for (const K of [fig.A, fig.B]) for (const k in K || {}) { xs.push(K[k][0]); ys.push(K[k][1]); }
    if (fig.wall != null) xs.push(fig.wall);
    const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, y0 = Math.min(...ys) - 16;
    return { x: x0, y: y0, w: x1 - x0, h: 168 - y0 };
  }
  function editTransform() {
    const r = edit.getBoundingClientRect(), box = fitBox();
    const s = Math.min(r.width / box.w, r.height / box.h) * 0.94;
    return { s, tx: r.width / 2 - (box.x + box.w / 2) * s, ty: r.height / 2 - (box.y + box.h / 2) * s, w: r.width, h: r.height };
  }
  function drawEditor() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), r = edit.getBoundingClientRect();
    if (!r.width) return;
    edit.width = Math.round(r.width * dpr); edit.height = Math.round(r.height * dpr);
    const ctx = edit.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
    const K = fig[kf]; if (!K) return;   // nothing to draw until a figure is set
    const T = editTransform();
    ctx.save(); ctx.translate(T.tx, T.ty); ctx.scale(T.s, T.s);
    ctx.strokeStyle = C.line; ctx.lineWidth = 2 / T.s; ctx.beginPath(); ctx.moveTo(216, 164); ctx.lineTo(400, 164); ctx.stroke();
    if (fig.wall != null) { ctx.lineWidth = 3 / T.s; ctx.beginPath(); ctx.moveTo(fig.wall, 34); ctx.lineTo(fig.wall, 164); ctx.stroke(); }
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
    try { A.drawFigure(ctx, A.unify(K, fig.view), P, heats, fig.view, { hold: fig.hold, side: fig.side, flip: fig.flip, w: fig.w }); } catch { }
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
  function toFig(e) { const T = editTransform(), r = edit.getBoundingClientRect(); return [(e.clientX - r.left - T.tx) / T.s, (e.clientY - r.top - T.ty) / T.s]; }
  edit.addEventListener('pointerdown', (e) => {
    const [x, y] = toFig(e), K = fig[kf];
    let best = null, bd = 12;
    for (const k of KEYS()) { const p = K[k]; if (!p) continue; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = k; } }
    /* a root (the hip) drags the whole body; shift swaps turning for stretching for this one drag */
    const roots = ROOTS[fig.view] || ROOTS.side, stretch = $('anim-stretch') ? $('anim-stretch').checked : false;
    drag = { key: best && roots.includes(best) ? '*' : best, last: [x, y], stretch: e.shiftKey ? !stretch : stretch };
    if (drag.key) { edit.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  edit.addEventListener('pointermove', (e) => {
    if (!drag || !drag.key) return;
    const [x, y] = toFig(e), K = fig[kf], dx = x - drag.last[0], dy = y - drag.last[1];
    const P = PARENT[fig.view] || PARENT.side, par = drag.key === '*' ? null : P[drag.key];
    if (drag.key === '*') { for (const k in K) { K[k][0] += dx; K[k][1] += dy; } }
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
  const rounded = () => { for (const K of [fig.A, fig.B]) for (const k in K || {}) { K[k][0] = Math.round(K[k][0]); K[k][1] = Math.round(K[k][1]); } };
  const drop = () => { if (drag) { drag = null; rounded(); animChanged(); } };
  edit.addEventListener('pointerup', drop); edit.addEventListener('pointercancel', drop);
  $('kf-A').onclick = () => { kf = 'A'; $('kf-A').setAttribute('aria-pressed', 'true'); $('kf-B').setAttribute('aria-pressed', 'false'); drawEditor(); };
  $('kf-B').onclick = () => { kf = 'B'; $('kf-B').setAttribute('aria-pressed', 'true'); $('kf-A').setAttribute('aria-pressed', 'false'); drawEditor(); };
  $('anim-load').onclick = animLoad;
  $('anim-copy-ab').onclick = () => { fig[kf === 'A' ? 'B' : 'A'] = JSON.parse(JSON.stringify(fig[kf])); animChanged(); };
  $('anim-undo').onclick = () => { if (!orig) return; const o = JSON.parse(orig); fig.A = o.A; fig.B = o.B; animChanged(); };
  $('anim-hold').onchange = (e) => { fig.hold = e.target.value === 'yes'; animChanged(); };
  $('anim-flip').onchange = (e) => { fig.flip = e.target.value === 'yes'; animChanged(); };
  $('anim-side').onchange = (e) => { fig.side = e.target.value; animChanged(); };
  $('anim-wall').onchange = (e) => { fig.wall = e.target.value === '' ? null : Number(e.target.value); animChanged(); };
  $('anim-download').onclick = () => save(new Blob([JSON.stringify(figureJson(), null, 2)], { type: 'application/json' }), `${move.id}-figure.json`);
  $('anim-copy').onclick = async () => { try { await navigator.clipboard.writeText($('anim-json').value); $('anim-copy').textContent = 'Copied'; setTimeout(() => { $('anim-copy').textContent = 'Copy as JSON'; }, 1500); } catch { $('anim-json').select(); } };

  /* ---------- tabs and wiring ---------- */
  function showTab(which) {
    if (which === 'anim') which = 'build';   // the animation editor lives in the Build tab now
    for (const t of ['build', 'review']) { $('pane-' + t).hidden = which !== t; $('tab-' + t).setAttribute('aria-selected', String(which === t)); }
    if (which === 'build') animChanged(); else if (which === 'review') { sizeOverlay(); drawLanes(); drawOverlay(); }
    try { history.replaceState(null, '', location.pathname + '?tab=' + which + (move ? '&move=' + move.id : '')); } catch { }
  }
  $('tab-build').onclick = () => showTab('build');
  $('tab-review').onclick = () => showTab('review');
  $('move').onchange = () => pickMove($('move').value);

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
      const cfg = Object.assign({}, Trace.defaults(move), tuned, { mirror: false, angles: false, setCount: 1, showPoints: allPoints() });
      let n = 0;
      for (let t = 0; t < dur; t += 1 / fps, n++) {
        await seekTo(Math.min(t, dur - 0.001));
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
    finally { btn.disabled = false; try { await seekTo(0); } catch { } }
  }
  $('render-demo').onclick = renderDemo;

  window.__review = {
    get demo() { return demo; },
    get trace() { return trace; }, get result() { return result; }, get takes() { return takes; }, get tuned() { return tuned; },
    get fig() { return figureJson(); }, get move() { return move; }, pickMove, refreshMoves, setTuned, showTab, setFig, animLoad, animChanged,
    loadTrace(frames, aspect, name) { trace = { frames, aspect, name: name || 'trace', source: 'test', duration: frames.length ? frames[frames.length - 1].t : 0 }; judge(); },
  };
  const q = new URLSearchParams(location.search);
  pickMove(q.get('move') || 'bridge');
  if (q.get('tab')) showTab(q.get('tab'));
});
