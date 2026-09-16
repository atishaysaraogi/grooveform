/* ============================================================
   Replay — watch a set back after it is done, and take it away.

   A set's recording (see coach.js record()) is landmarks per frame plus the
   events the coach raised: reps, cues, calibration. No video is kept, so what
   plays back is the skeleton the coach saw, with what it decided drawn under
   it as a timeline: each rep as a block (counted, cued, or partial), every
   fault as a span while it was active, and a tick where a cue was spoken.

   Three things come out of it, all from the same drawing code:
     mount()      — the player on the review screen: play, scrub, click the timeline
     record()     — the same playback rendered to a WebM file, when the browser can
     reportHtml() — a single self-contained HTML page: score, stats, faults, and
                    this player with the recording and this file's source inlined,
                    so it opens anywhere and needs nothing from the app

   timeline() is pure (no DOM), so Node tests can check what the bands say.
   This file loads nothing and is copied into the report, so it stays
   dependency-free — even the skeleton's bone list is repeated here rather
   than taken from engine.js.
   ============================================================ */
(function (root) {
  'use strict';

  const BONES = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
    [7, 11], [8, 12], [0, 7], [0, 8],
  ];
  const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const HEAD_LINKS = [[7, 11], [8, 12], [0, 7], [0, 8]];
  /* The head, in the style the set was recorded with. Deliberately repeated here rather than taken
     from engine.js: this file is inlined whole into the exported report, which loads nothing. */
  function headShape(lm) {
    const V = (p) => (p && (p[3] == null ? 1 : p[3]) >= 0.3 ? p : null);
    const g = (i) => V(lm[i]);
    const nose = g(0), eL = g(7), eR = g(8), sL = g(11), sR = g(12);
    if (!sL && !sR) return null;
    const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const neck = sL && sR ? m(sL, sR) : (sL || sR);
    const c = eL && eR ? m(eL, eR) : nose; if (!c) return null;
    return { c, neck, r: Math.max((eL && eR ? d(eL, eR) : 0) * 0.62, d(c, neck) * 0.42, 0.012) };
  }
  const C = { stage: '#14121a', bone: '#fff3e2', boneDim: 'rgba(255,243,226,0.45)', joint: '#b8f542', hot: '#ff2e88', good: '#b8f542', warn: '#ffb830', bad: '#ff2e88', ink: '#2b2233', line: 'rgba(43,34,51,0.18)', paper: '#fffaf3', cursor: '#7a3fb8', text: '#2b2233', muted: 'rgba(43,34,51,0.6)' };

  /* ---------- what the bands say: pure ---------- */
  function timeline(rec, opts = {}) {
    const frames = rec.frames || [], events = rec.events || [];
    const active = frames.filter((f) => f.s === 'active');
    const all = !!opts.all;
    const t0 = all || !active.length ? (frames.length ? frames[0].t : 0) : active[0].t;
    const t1 = frames.length ? frames[frames.length - 1].t : t0;
    /* reps: each rep event marks the end of one; it began where the previous one ended */
    const reps = []; let prev = t0;
    for (const e of events) if (e.type === 'rep') { reps.push({ n: e.n || 0, full: !!e.full, t0: prev, t1: e.t, peak: e.peak, duration: e.duration, faults: e.faults || [] }); prev = e.t; }
    /* fault spans: a fault is "on" across consecutive frames that list it */
    const spans = []; const open = {};
    for (const f of frames) {
      const ids = new Set(f.f || []);
      for (const id of ids) { if (open[id]) open[id].t1 = f.t; else open[id] = { id, t0: f.t, t1: f.t }; }
      for (const id of Object.keys(open)) if (!ids.has(id)) { spans.push(open[id]); delete open[id]; }
    }
    for (const id of Object.keys(open)) spans.push(open[id]);
    spans.sort((a, b) => a.t0 - b.t0);
    const cues = events.filter((e) => e.type === 'cue' || e.type === 'turned').map((e) => ({ t: e.t, id: e.fault || e.type, text: e.cue || '' }));
    const phases = [];
    for (const f of frames) { const last = phases[phases.length - 1]; if (last && last.s === f.s) last.t1 = f.t; else phases.push({ s: f.s, t0: f.t, t1: f.t }); }
    const curve = active.map((f) => [f.t, Number.isFinite(f.p) ? f.p : 0]);
    return { t0, t1, duration: Math.max(0, t1 - t0), reps, spans, cues, phases, curve, lost: frames.filter((f) => !f.lm).length, frames: frames.length };
  }

  /* the frame showing at time t: the last one at or before it */
  function frameAt(frames, t) {
    let lo = 0, hi = frames.length - 1;
    if (!frames.length || t <= frames[0].t) return frames[0] || null;
    if (t >= frames[hi].t) return frames[hi];
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m].t <= t) lo = m; else hi = m - 1; }
    return frames[lo];
  }

  /* ---------- the figure the person saw ----------
     The recording holds the model's raw landmarks; the coach drew them smoothed (FormEngine.PoseSmoother:
     a One Euro filter per joint, unsure joints held or smoothed harder, and each joint's "seen" call
     with hysteresis). The same filter is repeated here, deliberately, so the replay and the report draw
     the figure the person saw without needing anything from the app. Kept in step by test/replay.test.js. */
  function OneEuro(minCutoff, beta) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = 1; this.x = null; this.dx = 0; this.t = null; }
  OneEuro.alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
  OneEuro.prototype.filter = function (x, t) {
    if (this.x === null || this.t === null) { this.x = x; this.t = t; this.dx = 0; return x; }
    let dt = (t - this.t) / 1000; if (dt <= 0) dt = 1 / 30; this.t = t;
    const aD = OneEuro.alpha(this.dCutoff, dt); this.dx = aD * ((x - this.x) / dt) + (1 - aD) * this.dx;
    const a = OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x = a * x + (1 - a) * this.x; return this.x;
  };
  const PARENT = { 13: 11, 14: 12, 15: 13, 16: 14, 17: 15, 18: 16, 19: 15, 20: 16, 21: 15, 22: 16, 25: 23, 26: 24, 27: 25, 28: 26, 29: 27, 30: 28, 31: 27, 32: 28 };
  /* frames: [{lm:[[x,y,z,v],...]|null}] in recording order → per frame, the smoothed landmarks as
     [x, y, z, v, seen] (x back in 0..1), or null where there was no person */
  /* The same three extremity rules as engine.js PoseSmoother, kept identical: harder smoothing for
     hands and feet, a hold through an impossible change in a point's distance from its joint, and a
     lock on the landmarks the move says stay still. */
  const EXTREMITY_SCALE = { 17: 0.5, 18: 0.5, 19: 0.5, 20: 0.5, 21: 0.5, 22: 0.5, 29: 0.5, 30: 0.5, 31: 0.5, 32: 0.5 };
  const BONE = { 17: 15, 18: 16, 19: 15, 20: 16, 21: 15, 22: 16, 29: 27, 30: 28, 31: 27, 32: 28 };
  const BONE_TOL = 0.35, BONE_KEEP = 45, BONE_MIN = 15, BONE_HOLD = 4;
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const STILL_STEP = 0.004, STILL_FRAMES = 10, RELEASE_STEP = 0.025, RELEASE_FRAMES = 3;
  function smoothFrames(frames, { aspect = 16 / 9, minCutoff = 1.0, beta = 3.0, visFloor = 0.35, jumpLimit = 0.28, sureAt = 0.8, show = 0.5, stable = [] } = {}) {
    const filters = [], vis = [], holds = [], prev = [], seenF = [], bone = [], boneHold = [], lock = [], stillFor = [], awayFor = []; const still = new Set(stable);
    for (let i = 0; i < 33; i++) { filters.push([new OneEuro(minCutoff, beta), new OneEuro(minCutoff, beta), new OneEuro(minCutoff * 0.6, beta)]); vis.push(0); holds.push(0); prev.push(null); seenF.push(false); bone.push([]); boneHold.push(0); lock.push(null); stillFor.push(0); awayFor.push(0); }
    const out = [];
    for (const f of frames) {
      if (!f.lm) { out.push(null); continue; }
      const t = f.t, res = new Array(33);
      for (let i = 0; i < 33; i++) {
        const l = f.lm[i]; const v = l[3] == null ? 1 : l[3];
        vis[i] = 0.7 * vis[i] + 0.3 * v;
        seenF[i] = seenF[i] ? vis[i] >= show - 0.1 : vis[i] >= show;
        const p = prev[i]; const x = l[0] * aspect, y = l[1], z = l[2] || 0;
        let useRaw = true;
        if (p) {
          const jump = Math.hypot(x - p[0], y - p[1]);
          if (v < visFloor || (jump > jumpLimit && v < 0.75 && holds[i] < 4)) { useRaw = false; holds[i]++; } else holds[i] = 0;
        }
        const parent = BONE[i];
        if (useRaw && parent != null) {
          const pl = f.lm[parent]; const len = Math.hypot(x - pl[0] * aspect, y - pl[1]);
          const hist = bone[i]; const known = hist.length >= BONE_MIN ? median(hist) : null;
          if (known != null && Math.abs(len - known) > BONE_TOL * known && boneHold[i] < BONE_HOLD && p) { useRaw = false; boneHold[i]++; }
          else { if (boneHold[i] >= BONE_HOLD) hist.length = 0; boneHold[i] = 0; hist.push(len); if (hist.length > BONE_KEEP) hist.shift(); }
        }
        if (!useRaw) { res[i] = [p[0] / aspect, p[1], p[2], vis[i], seenF[i]]; continue; }
        const k = Math.min(1, Math.max(0.12, (vis[i] - visFloor) / Math.max(1e-3, sureAt - visFloor)));
        const c = minCutoff * k * k * (EXTREMITY_SCALE[i] || 1), b = beta * k; const fl = filters[i];
        fl[0].minCutoff = c; fl[1].minCutoff = c; fl[2].minCutoff = c * 0.6; fl[0].beta = fl[1].beta = fl[2].beta = b;
        const sx = fl[0].filter(x, t), sy = fl[1].filter(y, t), sz = fl[2].filter(z, t);
        let ox = sx, oy = sy;
        if (still.has(i)) {
          const L = lock[i];
          if (L) {
            const away = Math.hypot(x - L.x, y - L.y);
            awayFor[i] = away > RELEASE_STEP ? awayFor[i] + 1 : 0;
            if (awayFor[i] >= RELEASE_FRAMES) { lock[i] = null; stillFor[i] = 0; } else { ox = L.x; oy = L.y; }
          } else if (p) {
            const stepd = Math.hypot(sx - p[0], sy - p[1]);
            stillFor[i] = stepd < STILL_STEP ? stillFor[i] + 1 : 0;
            if (stillFor[i] >= STILL_FRAMES) { lock[i] = { x: sx, y: sy }; awayFor[i] = 0; ox = sx; oy = sy; }
          }
        }
        prev[i] = [sx, sy, sz]; res[i] = [ox / aspect, oy, sz, vis[i], seenF[i]];
      }
      out.push(res);
    }
    return out;
  }
  const smoothed = typeof WeakMap === 'function' ? new WeakMap() : null;
  function smoothedOf(rec, meta) {
    const cached = smoothed && smoothed.get(rec); if (cached) return cached;
    const sm = (meta && meta.smooth) || {};
    const out = smoothFrames(rec.frames || [], { aspect: rec.aspect || 16 / 9, minCutoff: sm.minCutoff, beta: sm.beta, show: meta && meta.show, stable: rec.lockable || [] });
    if (smoothed) smoothed.set(rec, out); return out;
  }
  function frameIndexAt(frames, t) {
    let lo = 0, hi = frames.length - 1;
    if (!frames.length || t <= frames[0].t) return frames.length ? 0 : -1;
    if (t >= frames[hi].t) return hi;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m].t <= t) lo = m; else hi = m - 1; }
    return lo;
  }

  /* ---------- drawing ---------- */
  /* lm: smoothed landmarks [x, y, z, v, seen] (raw [x, y, z, v] also draw, judged on v alone). A joint
     the model is unsure of stays off the picture, and so does everything hanging off it — no far foot
     floating without its leg; a fairly sure one draws faint (show / dim, from settings.json). */
  function drawSkeleton(ctx, lm, W, H, { hot = new Set(), mirror = false, alpha = 1, head = 'face', show = 0.5, dim = 0.7 } = {}) {
    if (!lm) return;
    const X = (p) => (mirror ? 1 - p[0] : p[0]) * W, Y = (p) => p[1] * H, V = (p) => (p[3] == null ? 1 : p[3]);
    const seenOne = (p) => !!p && (p[4] != null ? !!p[4] : V(p) >= show);
    const seen = (i) => { for (let j = i; j != null; j = PARENT[j]) if (!seenOne(lm[j])) return false; return true; };
    const sure = (i) => !!lm[i] && V(lm[i]) >= dim;
    ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, W / 320);
    const h = head === 'face' ? null : headShape(lm);
    if (h) {
      const r = Math.max(4, h.r * W), cx = X(h.c), cy = Y(h.c);
      ctx.strokeStyle = C.bone; ctx.fillStyle = C.bone;
      ctx.beginPath(); ctx.moveTo(X(h.neck), Y(h.neck)); ctx.lineTo(cx, cy); ctx.stroke();
      if (head === 'ball') { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
      else if (head === 'circle') { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      else if (head === 'dot') { ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, r * 0.42), 0, Math.PI * 2); ctx.fill(); }
    }
    for (const [a, b] of BONES) {
      if (h && HEAD_LINKS.some(([c, d]) => c === a && d === b)) continue;
      if (!seen(a) || !seen(b)) continue; const p = lm[a], q = lm[b];
      const isHot = hot.has(a) || hot.has(b);
      ctx.strokeStyle = isHot ? C.hot : (!sure(a) || !sure(b)) ? C.boneDim : C.bone;
      ctx.beginPath(); ctx.moveTo(X(p), Y(p)); ctx.lineTo(X(q), Y(q)); ctx.stroke();
    }
    const r = Math.max(4, W / 220);
    for (const i of JOINTS) {
      if (h && i === 0) continue;
      if (!seen(i)) continue; const p = lm[i];
      const isHot = hot.has(i); ctx.fillStyle = isHot ? C.hot : C.joint;
      ctx.beginPath(); ctx.arc(X(p), Y(p), isHot ? r * 1.6 : r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* where in the set's video a moment of the recording sits */
  const videoTimeOf = (rec, t) => (t + (rec.videoOffset || 0)) / 1000;
  /* one frame of the stage: the camera's own picture where there is one, then the skeleton over it,
     the rep count, the cue that was being said, the range bar */
  function drawStage(ctx, rec, meta, tl, t, W, H, videoEl) {
    ctx.fillStyle = C.stage; ctx.fillRect(0, 0, W, H);
    const fi = frameIndexAt(rec.frames, t); const f = fi < 0 ? null : rec.frames[fi]; if (!f) return;
    const lm = smoothedOf(rec, meta)[fi];
    const mirror = rec.facing === 'user';
    /* the landmarks are in the camera's own frame, so the picture is flipped with them or not at all */
    if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth) {
      ctx.save(); if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      try { ctx.drawImage(videoEl, 0, 0, W, H); } catch (e) { }
      ctx.restore();
      ctx.fillStyle = 'rgba(20,18,26,0.22)'; ctx.fillRect(0, 0, W, H);   /* the skeleton has to stay readable over it */
    }
    const hot = new Set(); for (const id of f.f || []) for (const i of ((meta.faults || {})[id] || {}).landmarks || []) hot.add(i);
    drawSkeleton(ctx, lm, W, H, { hot, mirror, alpha: f.lm ? 1 : 0.35, head: meta.head || 'face', show: meta.show, dim: meta.dim });
    const fs = Math.max(12, Math.round(H / 18)); ctx.font = `800 ${fs}px system-ui, sans-serif`; ctx.textBaseline = 'top';
    const done = tl.reps.filter((r) => r.t1 <= t && r.full).length;
    const label = meta.type === 'hold' ? `${Math.max(0, (t - tl.t0) / 1000).toFixed(0)} s` : `${done} / ${meta.target || '–'}`;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(10, 10, ctx.measureText(label).width + 20, fs + 12);
    ctx.fillStyle = C.bone; ctx.fillText(label, 20, 16);
    if (f.s && f.s !== 'active') { ctx.fillStyle = C.warn; ctx.font = `700 ${Math.round(fs * 0.8)}px system-ui, sans-serif`; ctx.fillText(f.s === 'countdown' ? 'Get ready' : 'Getting into position', 20, 16 + fs + 16); }
    const cue = [...tl.cues].reverse().find((c) => c.t <= t && t - c.t < 2600);
    if (cue && cue.text) {
      ctx.font = `800 ${fs}px system-ui, sans-serif`; const w = ctx.measureText(cue.text).width + 28;
      ctx.fillStyle = cue.id === 'turned' ? 'rgba(122,63,184,0.9)' : 'rgba(255,46,136,0.9)'; ctx.fillRect((W - w) / 2, H - fs - 30, w, fs + 16);
      ctx.fillStyle = '#fff'; ctx.fillText(cue.text, (W - w) / 2 + 14, H - fs - 22);
    }
    if (meta.type !== 'hold' && Number.isFinite(f.p)) {
      const bh = H * 0.5, bw = Math.max(8, W / 60), x = W - bw - 12, y = (H - bh) / 2, p = Math.max(0, Math.min(1.2, f.p));
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = p >= 0.85 ? C.good : p > 0.32 ? C.warn : 'rgba(255,243,226,0.5)'; ctx.fillRect(x, y + bh - bh * p / 1.2, bw, bh * p / 1.2);
    }
  }

  /* the timeline: reps on top, the range curve through the middle, faults and cues below */
  function drawTimeline(ctx, tl, meta, t, W, H) {
    const T = tl.duration || 1, x = (tt) => Math.max(0, Math.min(W, (tt - tl.t0) / T * W));
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    const repH = 18, curveTop = repH + 4, curveH = Math.max(18, H - repH - 4 - 22), faultTop = curveTop + curveH + 4;
    /* reps */
    for (const r of tl.reps) {
      const x0 = x(r.t0), x1 = x(r.t1); if (x1 - x0 < 1) continue;
      ctx.fillStyle = !r.full ? C.warn : r.faults.length ? C.bad : C.good; ctx.fillRect(x0 + 1, 0, x1 - x0 - 2, repH);
      if (x1 - x0 > 14 && r.full) { ctx.fillStyle = C.ink; ctx.font = '800 11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(String(r.n), x0 + 5, repH / 2); }
    }
    /* range curve, with the full-rep line */
    if (tl.curve.length > 1) {
      ctx.strokeStyle = C.line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, curveTop + curveH - 0.85 / 1.2 * curveH); ctx.lineTo(W, curveTop + curveH - 0.85 / 1.2 * curveH); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = C.cursor; ctx.lineWidth = 1.5; ctx.beginPath();
      tl.curve.forEach(([tt, p], i) => { const px = x(tt), py = curveTop + curveH - Math.max(0, Math.min(1.2, p)) / 1.2 * curveH; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.stroke();
    }
    /* faults while active, cues as ticks */
    for (const s of tl.spans) { ctx.fillStyle = 'rgba(255,46,136,0.75)'; ctx.fillRect(x(s.t0), faultTop, Math.max(2, x(s.t1) - x(s.t0)), 8); }
    for (const c of tl.cues) { ctx.fillStyle = c.id === 'turned' ? C.cursor : C.bad; ctx.beginPath(); ctx.moveTo(x(c.t), faultTop + 10); ctx.lineTo(x(c.t) - 4, faultTop + 18); ctx.lineTo(x(c.t) + 4, faultTop + 18); ctx.closePath(); ctx.fill(); }
    /* cursor */
    ctx.strokeStyle = C.cursor; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x(t), 0); ctx.lineTo(x(t), H); ctx.stroke();
  }

  /* ---------- the player ---------- */
  function mount(host, rec, meta, opts = {}) {
    const tl = timeline(rec, opts);
    const aspect = rec.aspect || 16 / 9;
    /* the set's own video, when one was kept: an off-screen element the canvas draws from, so the
       export and the report use exactly the same picture as the player */
    let videoEl = null, videoUrl = null;
    if (rec.video && typeof URL !== 'undefined' && URL.createObjectURL) {
      try {
        videoUrl = URL.createObjectURL(rec.video);
        videoEl = document.createElement('video'); videoEl.src = videoUrl; videoEl.muted = true; videoEl.playsInline = true; videoEl.preload = 'auto';
      } catch (e) { videoEl = null; }
    }
    host.innerHTML = `<div class="rp">
      <canvas class="rp-stage" aria-label="Replay of the set"></canvas>
      <div class="rp-bar"><button type="button" class="btn ghost small rp-play" aria-label="Play">▶ Play</button><input type="range" class="rp-seek" min="0" max="${Math.round(tl.duration)}" value="0" step="33" aria-label="Scrub"><span class="rp-time">0.0 s</span></div>
      <canvas class="rp-timeline" aria-label="Timeline: reps, range, faults and cues"></canvas>
      <div class="rp-legend"><span><i style="background:${C.good}"></i>Counted</span><span><i style="background:${C.bad}"></i>Counted, with a cue</span><span><i style="background:${C.warn}"></i>Partial</span><span><i style="background:rgba(255,46,136,0.75)"></i>Fault active</span><span><i class="tick"></i>Cue spoken</span></div>
    </div>`;
    const stage = host.querySelector('.rp-stage'), tlc = host.querySelector('.rp-timeline'), play = host.querySelector('.rp-play'), seek = host.querySelector('.rp-seek'), time = host.querySelector('.rp-time');
    const sctx = stage.getContext('2d'), tctx = tlc.getContext('2d');
    let t = tl.t0, playing = false, raf = 0, last = 0;
    function size() {
      const w = Math.max(200, host.clientWidth || 600), dpr = Math.min(2, root.devicePixelRatio || 1);
      stage.width = Math.round(w * dpr); stage.height = Math.round(w / aspect * dpr); stage.style.width = w + 'px'; stage.style.height = Math.round(w / aspect) + 'px';
      tlc.width = Math.round(w * dpr); tlc.height = Math.round(64 * dpr); tlc.style.width = w + 'px'; tlc.style.height = '64px';
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0); tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    }
    function render() {
      const w = stage.width / (Math.min(2, root.devicePixelRatio || 1));
      drawStage(sctx, rec, meta, tl, t, w, w / aspect, videoEl);
      drawTimeline(tctx, tl, meta, t, w, 64);
      seek.value = String(Math.round(t - tl.t0)); time.textContent = ((t - tl.t0) / 1000).toFixed(1) + ' s';
    }
    function tick(now) {
      if (!playing) return;
      const dt = last ? now - last : 0; last = now; t += dt;
      if (t >= tl.t1) { t = tl.t1; pause(); render(); return; }
      render(); raf = root.requestAnimationFrame(tick);
    }
    function seekVideo() { if (!videoEl) return; try { videoEl.currentTime = Math.max(0, videoTimeOf(rec, t)); } catch (e) { } }
    function start() { if (t >= tl.t1) t = tl.t0; playing = true; last = 0; play.textContent = '⏸ Pause'; if (videoEl) { seekVideo(); videoEl.play().catch(() => { }); } raf = root.requestAnimationFrame(tick); }
    function pause() { playing = false; root.cancelAnimationFrame(raf); play.textContent = '▶ Play'; if (videoEl) videoEl.pause(); }
    play.onclick = () => (playing ? pause() : start());
    const jump = () => { pause(); seekVideo(); if (videoEl) videoEl.addEventListener('seeked', render, { once: true }); render(); };
    seek.oninput = () => { t = tl.t0 + Number(seek.value); jump(); };
    tlc.onclick = (e) => { const r = tlc.getBoundingClientRect(); t = tl.t0 + (e.clientX - r.left) / r.width * tl.duration; jump(); };
    size(); if (videoEl) videoEl.addEventListener('loadeddata', render, { once: true });
    if (root.addEventListener) root.addEventListener('resize', size);
    return { play: start, pause, seek: (ms) => { t = tl.t0 + ms; render(); }, get t() { return t; }, timeline: tl, hasVideo: !!videoEl, destroy() { pause(); if (root.removeEventListener) root.removeEventListener('resize', size); if (videoUrl) URL.revokeObjectURL(videoUrl); host.innerHTML = ''; } };
  }

  /* ---------- the same playback as a video file ---------- */
  function canRecord() { return typeof root.MediaRecorder !== 'undefined' && typeof root.document !== 'undefined' && !!root.document.createElement('canvas').captureStream; }
  function record(rec, meta, { width = 960, fps = 30, onProgress = () => { } } = {}) {
    return new Promise((resolve, reject) => {
      if (!canRecord()) return reject(new Error('This browser cannot record a canvas to video.'));
      const tl = timeline(rec); const aspect = rec.aspect || 16 / 9; const W = width, SH = Math.round(W / aspect), TH = 64, H = SH + TH;
      const canvas = root.document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(fps);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => root.MediaRecorder.isTypeSupported && root.MediaRecorder.isTypeSupported(m)) || '';
      const mr = new root.MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined);
      const chunks = []; mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onerror = (e) => reject(e.error || new Error('Recording failed'));
      mr.onstop = () => resolve(new Blob(chunks, { type: mime || 'video/webm' }));
      let t = tl.t0; const step = 1000 / fps; const t0 = tl.t0, t1 = tl.t1;
      /* the set's own video, played in step with the render (which runs in real time anyway) */
      let videoEl = null, videoUrl = null;
      if (rec.video) { try { videoUrl = URL.createObjectURL(rec.video); videoEl = root.document.createElement('video'); videoEl.src = videoUrl; videoEl.muted = true; videoEl.playsInline = true; videoEl.currentTime = Math.max(0, videoTimeOf(rec, t)); videoEl.play().catch(() => { }); } catch (e) { videoEl = null; } }
      const done = () => { if (videoUrl) { try { videoEl.pause(); } catch (e) { } URL.revokeObjectURL(videoUrl); } };
      const draw = () => {
        drawStage(ctx, rec, meta, tl, t, W, SH, videoEl);
        ctx.save(); ctx.translate(0, SH); drawTimeline(ctx, tl, meta, t, W, TH); ctx.restore();
        if (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].requestFrame) stream.getVideoTracks()[0].requestFrame();
      };
      draw(); mr.start(250);
      /* real time: MediaRecorder stamps frames by the clock, so the file plays at the pace the set was done */
      const timer = setInterval(() => {
        t += step; draw(); onProgress(Math.min(1, (t - t0) / ((t1 - t0) || 1)));
        if (t >= t1 + 800) { clearInterval(timer); done(); setTimeout(() => mr.stop(), 300); }
      }, step);
    });
  }

  /* ---------- a page that carries the whole set ---------- */
  function reportHtml(rec, meta, review, source) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tl = timeline(rec);
    const when = rec.started ? new Date(rec.started).toLocaleString() : '';
    const stats = review.type === 'reps'
      ? [[`${review.reps} / ${review.target}`, 'reps counted'], [review.partials || 0, 'partial reps'], [review.avgTempo ? (review.avgTempo / 1000).toFixed(1) + ' s' : '—', 'avg rep time'], [Math.round((review.avgROM || 0) * 100) + '%', 'avg range']]
      : [[`${review.holdSec} s`, 'held'], [`${review.goodSec} s`, 'in good form'], [`${review.target} s`, 'target'], [Math.round(100 * (review.holdSec ? review.goodSec / review.holdSec : 0)) + '%', 'form quality']];
    const faults = Object.values(review.faults || {}).sort((a, b) => (b.n * (b.fault ? b.fault.weight : 1)) - (a.n * (a.fault ? a.fault.weight : 1)));
    const cam = rec.camera && (rec.camera.roll || rec.camera.yaw > 5) ? `<p class="muted">Phone: ${rec.camera.roll ? `rolled ${Math.round(Math.abs(rec.camera.roll))}° (levelled from the ${rec.camera.rollFrom})` : 'level'}${rec.camera.yaw > 5 ? ` · turned about ${Math.round(rec.camera.yaw)}° from the ideal view${rec.camera.stretch > 1.01 ? ', corrected' : ''}` : ''}.</p>` : '';
    /* the recording and the player both ride inside script tags; a "</script" in either would end
       the tag early. Inside JavaScript "<\/script" reads the same, so the escape is harmless. */
    const unclose = (txt) => String(txt).replace(/<\/script/gi, '<\\/script');
    const { video, videoMime, ...recNoVideo } = rec;   /* the video never leaves the device it was recorded on */
    const data = unclose(JSON.stringify({ rec: recNoVideo, meta, review: { ...review, faults: undefined } }));
    source = unclose(source);
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.name)} — ${esc(when)}</title>
<style>
  body{margin:0;background:#fffaf3;color:#2b2233;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:20px 16px}
  .wrap{max-width:760px;margin:0 auto;display:grid;gap:16px}
  h1{margin:0;font-size:1.6rem} h3{margin:0 0 8px;font-size:1rem} .muted{color:rgba(43,34,51,.65);margin:0}
  .panel{background:#fff;border:2px solid #2b2233;border-radius:20px;padding:16px;box-shadow:4px 4px 0 #2b2233}
  .head{display:flex;gap:16px;align-items:center} .ring{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:1.6rem;border:6px solid var(--c);flex:none}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px} .stat{background:#fff;border:2px solid #2b2233;border-radius:16px;padding:10px 12px} .stat .v{font-weight:900;font-size:1.3rem} .stat .k{font-size:.8rem;color:rgba(43,34,51,.65)}
  .fault{display:flex;gap:10px;padding:8px 0;border-top:1px solid rgba(43,34,51,.15)} .fault:first-child{border-top:0} .fault .n{font-weight:900;color:#ff2e88;min-width:36px} .fault .l{font-weight:800} .fault .t{font-size:.9rem;color:rgba(43,34,51,.7)}
  .btn{font:inherit;font-weight:800;border:2px solid #2b2233;background:#fff;border-radius:999px;padding:6px 14px;cursor:pointer}
  .rp{display:grid;gap:8px} .rp-stage{width:100%;border-radius:16px;display:block} .rp-bar{display:flex;gap:10px;align-items:center} .rp-seek{flex:1} .rp-time{font-variant-numeric:tabular-nums;min-width:52px;text-align:right} .rp-timeline{width:100%;height:64px;border:2px solid #2b2233;border-radius:12px;display:block}
  .rp-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:.8rem;color:rgba(43,34,51,.7)} .rp-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-2px} .rp-legend i.tick{width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:9px solid #ff2e88;border-radius:0}
</style></head><body><div class="wrap">
  <div class="panel head"><div class="ring" style="--c:${review.score >= 75 ? '#4f9a1e' : review.score >= 55 ? '#ffb830' : '#ff2e88'}">${esc(review.score == null ? '–' : review.score)}</div><div><h1>${esc(review.headline || meta.name)}</h1><p class="muted">${esc(meta.name)}${meta.side ? ' · ' + esc(meta.side) : ''} · ${esc(when)}</p>${cam}</div></div>
  <div class="stats">${stats.map(([v, k]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('')}</div>
  <div class="panel"><h3>Watch it back</h3><p class="muted" style="margin-bottom:8px">The skeleton the coach saw. ${rec.video ? 'The set&rsquo;s video stayed on the device it was recorded on, so this page carries the skeleton only.' : 'No video was kept.'} Reps along the top, range through the middle, faults and cues below. Click the timeline to jump.</p><div id="replay"></div></div>
  <div class="panel"><h3>Work on next</h3>${faults.length ? faults.map((fc) => `<div class="fault"><span class="n">×${fc.n}</span><span><span class="l">${esc(fc.fault ? fc.fault.label : fc.id)}</span><br><span class="t">${esc(fc.fault ? fc.fault.tip : '')}</span></span></div>`).join('') : '<p class="muted">No faults flagged.</p>'}</div>
  <div class="panel"><h3>Timeline</h3><p class="muted">${tl.reps.length ? tl.reps.map((r) => `${r.full ? 'Rep ' + r.n : 'Partial'} at ${((r.t1 - tl.t0) / 1000).toFixed(1)} s${r.faults.length ? ' — ' + r.faults.map((id) => (meta.faults[id] || {}).label || id).join(', ') : ''}`).join('<br>') : 'A hold: see the fault spans on the timeline.'}${tl.cues.length ? '<br><br>Cues: ' + tl.cues.map((c) => `${((c.t - tl.t0) / 1000).toFixed(1)} s “${esc(c.text)}”`).join(' · ') : ''}</p></div>
  <p class="muted" style="text-align:center">Made with OnTrack · the recording is inside this file (landmarks and events, never video)</p>
</div>
<script id="set-data" type="application/json">${data}</script>
<script>${source}</script>
<script>(function(){var d=JSON.parse(document.getElementById('set-data').textContent);Replay.mount(document.getElementById('replay'),d.rec,d.meta);})();</script>
</body></html>`;
  }

  const Replay = { timeline, frameAt, frameIndexAt, smoothFrames, drawSkeleton, drawStage, drawTimeline, videoTimeOf, mount, record, canRecord, reportHtml, headShape, BONES, HEAD_LINKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Replay; else root.Replay = Replay;
})(typeof window !== 'undefined' ? window : globalThis);
