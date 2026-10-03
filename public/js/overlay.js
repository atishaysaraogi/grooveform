/* ---------------------------------------------------------------------------
   What is drawn over the picture: the skeleton in the colours of the verdict,
   the angles and guides when asked for, the set and the reps, the clock, the
   fault words, the cue, the mark. One drawing for the coach's live canvas and
   for a film rendered after the fact on the Review page, so the two can never
   differ: the same frame, the same state, the same picture.

   draw(ctx, state) with
     W, H          the canvas
     source        { image, w, h, quarter, mirror } — the picture to draw first
                   (image drawable; w, h its size after the quarter turn), or
                   null to draw only what goes over a picture already there
     move, cfg     the exercise and its numbers (cfg.angles, cfg.mirror, cfg.setCount)
     reading, verdict, out   this frame's, from the coach
     setNo         which set, 0 for none yet
     banner        { text, colour, at } the cue on screen, or null
     now           the clock the banner's `at` is on
     rec           whether a film is being taken (the REC mark)
     cues          the coach's cue table, for the fault words
     points        the model's raw landmarks this frame (all 33, or null), drawn with their
                   certainty when cfg.showPoints is on — a review aid
     noCue         leave the cue and the fault words off the picture (the studio writes
                   them under it instead)
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./core.js'));
  else root.Overlay = factory(root.Core);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const C = { good: '#35d07f', warn: '#ffb545', bad: '#ff5c6c', ink: '#e8edf4', dim: 'rgba(232,237,244,.45)', shadow: 'rgba(0,0,0,.55)' };
  const FONT = 'ui-sans-serif, system-ui, sans-serif';
  const BANNER_MS = 2600;   // how long a cue stays on the picture

  function bandText(b, c) {
    if (b.sym) return `±${c[b.sym]}`;
    if (b.min) return `≥ ${c[b.min]}`;
    if (b.max) return `≤ ${c[b.max]}`;
    return c[b.lo] < 0 ? `${c[b.lo]} to ${c[b.hi]}` : `${c[b.lo]}–${c[b.hi]}`;
  }
  /* the faults present this frame, as short words joined by dots */
  function faultWords(out, cues) {
    if (!out || !out.active || !out.active.length) return '';
    return out.active.map((id) => { const c = cues && cues[id]; return (c && (c.label || c.text)) || id; }).join('  ·  ');
  }

  /* The body is drawn under a mirror when mirroring, which would write the text
     backwards. Flipping about the label's own x un-mirrors the glyphs and leaves
     the anchor where it is. */
  function label(ctx, text, x, y, size, colour, mirrored) {
    ctx.save();
    if (mirrored) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.translate(-x, -y); }
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.lineWidth = size * 0.28; ctx.strokeStyle = C.shadow; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y);
    ctx.restore();
  }
  /* An arc the short way round between two directions, with its number set on
     the bisector just outside it. */
  function sweep(ctx, cx, cy, rad, a0, a1, colour, s, text, fs, mirrored) {
    let d = a1 - a0;
    while (d < -Math.PI) d += Math.PI * 2; while (d > Math.PI) d -= Math.PI * 2;
    ctx.strokeStyle = colour; ctx.lineWidth = s * 1.1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a1, d < 0); ctx.stroke();
    const mid = a0 + d / 2, out = rad + fs * 0.95;
    label(ctx, text, cx + Math.cos(mid) * out, cy + Math.sin(mid) * out, fs, colour, mirrored);
  }

  /* The points are in the VIDEO's square space (x already × the video's aspect),
     and the video occupies `fit` inside the canvas — so they are painted into
     that rectangle, not the whole canvas. Sizes scale with the picture rather
     than the canvas too, so a pillarboxed frame gets a skeleton that fits it. */
  function drawBody(ctx, move, cfg, r, v, A, fit) {
    const at = (p) => [fit.x + (p.x / A) * fit.w, fit.y + p.y * fit.h];
    const W = fit.w;
    const s = Math.max(2, W / 320);
    const rad = Math.max(18, W * 0.045);
    const fs = Math.max(14, W * 0.032);
    const tone = (ok) => (ok == null ? C.dim : ok ? C.good : C.bad);
    const whole = !v.ok ? C.dim : v.inPosition ? C.good : C.bad;
    const mirrored = !!cfg.mirror;

    /* thick enough to read from across the room, see-through enough to leave the
       body visible under it */
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = C.shadow; ctx.shadowBlur = s * 2;
    ctx.lineWidth = s * 3.2; ctx.setLineDash([]);
    ctx.globalAlpha = 0.55;
    for (const [a, b] of move.bones) {
      const p = r.points[a], q = r.points[b]; if (!p || !q) continue;
      const owner = move.limb[a + '|' + b];
      ctx.strokeStyle = !v.ok ? C.dim : owner ? tone(v.good[owner]) : whole;
      ctx.beginPath(); ctx.moveTo(...at(p)); ctx.lineTo(...at(q)); ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.fillStyle = whole;
    for (const k of move.dots) {
      const p = r.points[k]; if (!p) continue; const [x, y] = at(p);
      ctx.beginPath(); ctx.arc(x, y, s * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* what the move asks to be drawn — the angles, arcs and guide lines — only
       when asked for: the skeleton's colour says what is off, and the words do */
    if (cfg.angles && move.draw) move.draw({
      plumb(p, share) {
        const [x, y] = at(p);
        ctx.setLineDash([s * 1.5, s * 2]); ctx.lineWidth = s * 0.8; ctx.strokeStyle = C.dim;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - fit.h * share); ctx.stroke(); ctx.setLineDash([]);
      },
      floor(p, dir) {
        const [x, y] = at(p), f = r.facing * (dir || 1);
        ctx.setLineDash([s * 1.5, s * 2]); ctx.lineWidth = s * 0.8; ctx.strokeStyle = C.dim;
        ctx.beginPath(); ctx.moveTo(x - f * fit.w * 0.05, y); ctx.lineTo(x + f * fit.w * 0.11, y); ctx.stroke(); ctx.setLineDash([]);
      },
      guide(a, b, ok) {
        const p = at(a), q = at(b);
        ctx.setLineDash([s * 2.5, s * 2.5]); ctx.lineWidth = s * 0.9; ctx.strokeStyle = ok ? C.dim : C.bad;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]);
      },
      angleAt(b, a, c, deg, ok, k) {
        const [cx, cy] = at(b);
        const ang = (p) => { const [x, y] = at(p); return Math.atan2(y - cy, x - cx); };
        sweep(ctx, cx, cy, rad * k, ang(a), ang(c), tone(ok), s, `${Math.round(deg)}°`, fs, mirrored);
      },
      angleTo(from, to, dir, deg, ok, k) {
        const [cx, cy] = at(from), [tx, ty] = at(to);
        const a0 = dir === 'down' ? Math.PI / 2 : dir ? (dir > 0 ? 0 : Math.PI) : -Math.PI / 2;
        sweep(ctx, cx, cy, rad * k, a0, Math.atan2(ty - cy, tx - cx), tone(ok), s, `${Math.round(deg)}°`, fs, mirrored);
      },
      readout(p, deg, ok, side) {
        const [x, y] = at(p);
        label(ctx, `${deg > 0 ? '+' : ''}${Math.round(deg)}°`, x, y + side * fs * 1.6, fs, tone(ok), mirrored);
      },
    }, r, v);
  }

  /* the frame's edge, the corners, the words, the cue and the mark */
  function drawHud(ctx, st) {
    const { W, H, move, cfg, out } = st, r = st.reading, v = st.verdict;
    const pad = Math.round(W * 0.022), fs = Math.max(15, Math.round(W * 0.028));
    const live = r && r.ok;
    const edge = out.done ? C.good : !live ? C.dim : v.inPosition ? C.good : C.bad;
    ctx.strokeStyle = edge; ctx.lineWidth = Math.max(3, W * 0.006);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);

    const line = (text, x, y, size, colour, align) => {
      ctx.font = `800 ${size}px ${FONT}`;
      ctx.textBaseline = 'top'; ctx.textAlign = align || 'left';
      ctx.lineWidth = size * 0.26; ctx.strokeStyle = C.shadow; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y);
    };
    /* one cursor down each side, so no two lines can ever be laid on top of each other */
    const stack = (x, align) => {
      let y = pad;
      return (big, small, colour, scale) => {
        const sz = fs * (scale || 1);
        line(big, x, y, sz, colour, align); y += sz * 1.12;
        line(small, x, y, fs * 0.62, C.dim, align); y += fs * 0.95;
        return y;
      };
    };
    const L = stack(pad, 'left');
    let leftEnd = pad;
    if (cfg.angles) for (const b of move.bands) {
      const val = live && r[b.of] != null ? `${Math.round(r[b.of])}°` : '—';
      leftEnd = L(`${b.hud} ${val}`, `${b.note} ${bandText(b, cfg)}`, live ? (v.good[b.key] ? C.good : C.bad) : C.dim);
    }
    /* which set this is, and under it the reps counted so far */
    const setNo = st.setNo || 0, setCount = cfg.setCount || 1;
    if (setNo) leftEnd = L(setNo > setCount ? `SET ${setNo}` : `SET ${setNo} of ${setCount}`, out.between ? 'done' : '', C.ink);
    /* the studio counts on past the set's number: then the count alone, and what a set is under it */
    const past = out.reps > out.repTarget;
    if (setNo && move.reps) leftEnd = L(past ? `REP ${out.reps}` : `REP ${out.reps} of ${out.repTarget}`, out.done ? 'done' : past ? `a set is ${out.repTarget}` : '', C.ink);

    /* the countdown, which is what the set is: the hold, or the hold at the top of a rep */
    const R = stack(W - pad, 'right');
    const left = (out.leftMs / 1000).toFixed(1), target = out.targetMs / 1000;
    const under = out.done ? (move.reps ? `${out.repTarget} reps` : `${target} s held`)
      : move.reps ? `of ${target} s at the top` : `left of ${target} s`;
    const ry = R(out.done || out.between ? 'DONE' : `${left}s`, under, C.ink, 1.5);
    if (st.rec) {
      line('REC', W - pad - fs * 0.9, ry, fs * 0.66, C.bad, 'right');
      ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(W - pad - fs * 0.33, ry + fs * 0.33, fs * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    /* the move's name, so the recording says what it is a recording of */
    line(move.name, W / 2, pad, fs * 0.66, C.dim, 'center');

    /* the mark, bottom right, on every frame of the film */
    const wmSize = Math.round(fs * 0.62);
    ctx.save(); ctx.globalAlpha = 0.72;
    line('OnTrack', W - pad, H - pad - wmSize, wmSize, C.ink, 'right');
    ctx.restore();
    if (st.noCue) return;
    const measure = (str) => ctx.measureText(str).width;

    /* the cue, kept on screen a moment after it was said so the recording shows
       it. Wrapped to the frame, never past its edge: a long instruction takes
       two or three lines, and shrinks a little rather than take four. */
    const banner = st.banner && st.now - st.banner.at < BANNER_MS ? st.banner : null;
    let bl = null;
    if (banner) {
      const maxW = W - pad * 2 - fs * 1.6;
      let size = fs, lines;
      for (;;) {
        ctx.font = `800 ${size}px ${FONT}`;
        lines = Core.wrapWords(banner.text, maxW, measure);
        if (lines.length <= 3 || size <= fs * 0.62) break;
        size = Math.round(size * 0.88);
      }
      const lh = size * 1.22, bh = lh * lines.length + size;
      bl = { lines, size, lh, bh, bw: Math.min(W - pad * 2, Math.max(...lines.map(measure)) + fs * 1.6) };
    }
    /* every fault present right now, in words, with the cue: the voice keeps to
       one thing at a time, the picture need not. Faults are the one thing in red. */
    const words = out.between ? (setNo >= setCount ? 'All sets done' : `Set ${setNo} done — tap Next set when you are ready`) : faultWords(out, st.cues);
    const ws = fs * 0.62;
    let wl = [];
    if (words) { ctx.font = `700 ${ws}px ${FONT}`; wl = Core.wrapWords(words, W - pad * 2, measure); }
    const need = (bl ? bl.bh + fs * 0.4 : 0) + wl.length * ws * 1.2;
    if (!need) return;

    /* where they go: at the foot of the frame, unless the body is there and the
       top is clearer — someone lying on the floor fills the bottom of the picture */
    const floor = H - pad - wmSize - fs * 0.5;
    const ceiling = Math.max(leftEnd, ry + (st.rec ? fs * 0.8 : 0), pad + fs * 0.9) + fs * 0.3;
    const body = st.bodyBox;
    const overlap = (a0, a1) => (body ? Math.max(0, Math.min(a1, body.bottom) - Math.max(a0, body.top)) : 0);
    const atTop = !!body && ceiling + need <= floor && overlap(ceiling, ceiling + need) < overlap(floor - need, floor);

    const drawBanner = (y) => {
      ctx.font = `800 ${bl.size}px ${FONT}`;
      ctx.fillStyle = 'rgba(13,17,23,.82)';
      ctx.beginPath(); ctx.roundRect((W - bl.bw) / 2, y, bl.bw, bl.bh, Math.min(bl.bh / 2, fs * 1.1)); ctx.fill();
      ctx.strokeStyle = banner.colour; ctx.lineWidth = Math.max(2, W * 0.003); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = banner.colour;
      bl.lines.forEach((str, k) => ctx.fillText(str, W / 2, y + bl.size * 0.5 + bl.lh * (k + 0.5)));
      banner.lines = bl.lines; banner.size = bl.size; banner.width = bl.bw; banner.frame = W; banner.top = y;
    };
    const drawWords = (y0) => {
      ctx.font = `700 ${ws}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs * 0.18; ctx.strokeStyle = C.shadow; ctx.lineJoin = 'round';
      ctx.fillStyle = out.between ? C.ink : C.bad;
      wl.forEach((str, k) => { const y = y0 + ws * 1.2 * (k + 0.5); ctx.strokeText(str, W / 2, y); ctx.fillText(str, W / 2, y); });
    };
    if (atTop) {
      /* the cue first, under the counters, and the fault words under it */
      let y = ceiling;
      if (bl) { drawBanner(y); y += bl.bh + fs * 0.4; }
      if (wl.length) drawWords(y);
    } else {
      /* the cue at the foot, and the fault words above it */
      let y = floor;
      if (bl) { y -= bl.bh; drawBanner(y); y -= fs * 0.4; }
      if (wl.length) drawWords(y - wl.length * ws * 1.2);
    }
  }

  /* ---- every point the model returns, with how sure it is: a review aid ----
     Drawn only when asked for (cfg.showPoints), over whatever the exercise draws:
     all thirty-three points, named where they are joints, each in the colour of
     the model's certainty in it (green sure, amber under the trust bar's reach,
     red not trusted), joined by the model's own skeleton; the points the exercise
     is measuring are ringed. The table at the left edge is the same numbers for
     the eighteen joints, left against right, so it can be seen what the model had
     when a frame was "lost" and which limbs it only sometimes sees. A tool for
     settling the exercises, to be taken out afterwards. */
  const POINT_NAMES = ['nose', 'L eye in', 'L eye', 'L eye out', 'R eye in', 'R eye', 'R eye out', 'L ear', 'R ear', 'L mouth', 'R mouth',
    'L shoulder', 'R shoulder', 'L elbow', 'R elbow', 'L wrist', 'R wrist', 'L pinky', 'R pinky', 'L index', 'R index', 'L thumb', 'R thumb',
    'L hip', 'R hip', 'L knee', 'R knee', 'L ankle', 'R ankle', 'L heel', 'R heel', 'L toe', 'R toe'];
  const POINT_LINES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
    [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 17], [15, 19], [15, 21], [17, 19], [16, 18], [16, 20], [16, 22], [18, 20],
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10]];
  const JOINT_ROWS = ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe'];
  const LABELLED = new Set([7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
  const sureOf = (p) => (!p ? 0 : p.visibility != null ? p.visibility : p.v != null ? p.v : 0);
  const sureColour = (c, bar) => (c >= 0.8 ? C.good : c >= bar ? C.warn : C.bad);
  function drawPoints(ctx, lm, A, fit, cfg, move, r) {
    if (!lm || !lm.length) return;
    const at = (p) => [fit.x + (p.x / A) * fit.w, fit.y + p.y * fit.h];
    const s = Math.max(2, fit.w / 320), fs = Math.max(11, fit.w * 0.022), bar = cfg.vis == null ? 0.5 : cfg.vis;
    const mirrored = !!cfg.mirror;
    ctx.save();
    ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.shadowBlur = 0;
    /* the margin: a needed point nearer the edge than this is not trusted (cfg.edge) */
    const m = cfg.edge == null ? 0.03 : cfg.edge;
    if (m > 0) { ctx.setLineDash([6, 4]); ctx.lineWidth = Math.max(1, s * 0.5); ctx.strokeStyle = 'rgba(232,121,249,.7)'; ctx.strokeRect(fit.x + m * fit.w, fit.y + m * fit.h, fit.w * (1 - 2 * m), fit.h * (1 - 2 * m)); ctx.setLineDash([]); }
    for (const [a, b] of POINT_LINES) {
      const p = lm[a], q = lm[b]; if (!p || !q) continue;
      const c = Math.min(sureOf(p), sureOf(q));
      ctx.globalAlpha = 0.25 + 0.55 * c; ctx.lineWidth = s * 1.1; ctx.strokeStyle = sureColour(c, bar);
      ctx.beginPath(); ctx.moveTo(...at(p)); ctx.lineTo(...at(q)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    /* the exercise's own points, on the side it is measuring, are ringed */
    const own = new Set();
    if (r && r.ok && r.side && Core.SIDE[r.side]) for (const k of (move && move.joints) || []) { const i = Core.SIDE[r.side][k]; if (i != null) own.add(i); }
    lm.forEach((p, i) => {
      if (!p) return;
      const [x, y] = at(p), c = sureOf(p), big = i === 0 || i >= 7, right = i > 0 && i % 2 === 0;
      ctx.fillStyle = sureColour(c, bar); ctx.globalAlpha = 0.35 + 0.65 * c;
      ctx.beginPath(); ctx.arc(x, y, s * (big ? 2.6 : 1.6), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      if (own.has(i)) { ctx.lineWidth = s * 0.9; ctx.strokeStyle = C.ink; ctx.beginPath(); ctx.arc(x, y, s * 4.4, 0, Math.PI * 2); ctx.stroke(); }
      /* a joint at or past the margin: ringed in the margin's colour, whatever its certainty */
      if (LABELLED.has(i) && Math.min(p.x / A, 1 - p.x / A, p.y, 1 - p.y) < m) { ctx.lineWidth = s * 1.2; ctx.strokeStyle = 'rgba(232,121,249,.95)'; ctx.beginPath(); ctx.arc(x, y, s * 6, 0, Math.PI * 2); ctx.stroke(); }
      if (LABELLED.has(i)) label(ctx, `${POINT_NAMES[i]} ${Math.round(c * 100)}`, x, y + (right ? 1 : -1) * fs * 1.1, fs, sureColour(c, bar), mirrored);
    });
    ctx.restore();
  }
  /* the table at the left edge: the eighteen joints, left against right, and which side is being measured */
  function drawPointTable(ctx, lm, W, H, cfg, r) {
    const L = lm || [];
    const fs = Math.max(11, Math.min(W, H) * 0.028), lh = fs * 1.25, bar = cfg.vis == null ? 0.5 : cfg.vis;
    const rows = JOINT_ROWS.map((k) => [k, sureOf(L[Core.SIDE.L[k]]), sureOf(L[Core.SIDE.R[k]])]);
    const seen = L.filter((p) => sureOf(p) >= bar).length;
    /* at the right edge, mid-height: clear of the readouts on the left, the clock above and the mark below */
    const w = fs * 11.5, h = lh * (rows.length + 2.8), x = W - w - fs * 0.6, y = H / 2 - h / 2, colL = x + w - fs * 3.6, colR = x + w - fs * 0.5;
    const pct = (c) => (L.length ? String(Math.round(c * 100)) : '\u2013');
    ctx.save();
    ctx.globalAlpha = 0.72; ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.font = `700 ${fs}px ${FONT}`; ctx.textBaseline = 'top';
    ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.fillText(L.length ? `${seen}/33 sure` : 'no one found', x + fs * 0.5, y + lh * 0.3);
    ctx.textAlign = 'right'; ctx.fillText('L', colL, y + lh * 0.3); ctx.fillText('R', colR, y + lh * 0.3);
    rows.forEach(([k, l, rr], i) => {
      const yy = y + lh * (i + 1.5);
      ctx.textAlign = 'left'; ctx.fillStyle = C.ink; ctx.fillText(k, x + fs * 0.5, yy);
      ctx.textAlign = 'right';
      ctx.fillStyle = sureColour(l, bar); ctx.fillText(pct(l), colL, yy);
      ctx.fillStyle = sureColour(rr, bar); ctx.fillText(pct(rr), colR, yy);
    });
    const foot = r && r.ok && r.side ? `measuring ${r.side === 'L' ? 'left' : 'right'}` : L.length ? 'frame lost' : '';
    ctx.font = `600 ${fs * 0.85}px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = r && r.ok ? C.ink : C.bad;
    ctx.fillText(foot, x + fs * 0.5, y + lh * (rows.length + 1.7));
    ctx.restore();
  }

  /* the body's height on the canvas, from the points the exercise draws: where the
     cue must not go */
  function bodyBox(st, A, fit) {
    const r = st.reading; if (!r || !r.ok || !r.points) return null;
    let top = Infinity, bottom = -Infinity;
    for (const k of Object.keys(r.points)) { const p = r.points[k]; if (!p) continue; const y = fit.y + p.y * fit.h; top = Math.min(top, y); bottom = Math.max(bottom, y); }
    if (!isFinite(top)) return null;
    const m = fit.h * 0.06;   // the head above the ear, the hand past the wrist
    return { top: top - m, bottom: bottom + m };
  }

  /* the whole frame: the picture, all of it and none of it stretched (a squashed
     body reads squashed angles), the body over it, the HUD over that */
  function draw(ctx, st) {
    const { W, H, source } = st;
    const A = source ? source.w / source.h : (st.aspect || 16 / 9);
    const fit = Core.fitRect(A, 1, W, H);
    ctx.save();
    if (st.cfg.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    if (source && source.image) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (source.quarter) {
        ctx.save();
        ctx.translate(fit.x + fit.w / 2, fit.y + fit.h / 2);
        ctx.rotate((source.quarter * Math.PI) / 2);
        ctx.drawImage(source.image, -fit.h / 2, -fit.w / 2, fit.h, fit.w);
        ctx.restore();
      } else ctx.drawImage(source.image, fit.x, fit.y, fit.w, fit.h);
    }
    if (st.reading && st.reading.ok && st.verdict) drawBody(ctx, st.move, st.cfg, st.reading, st.verdict, A, fit);
    if (st.cfg.showPoints) drawPoints(ctx, st.points || null, A, fit, st.cfg, st.move, st.reading);
    ctx.restore();
    if (st.cfg.showPoints) drawPointTable(ctx, st.points || null, W, H, st.cfg, st.reading);
    if (st.out) drawHud(ctx, Object.assign({}, st, { bodyBox: bodyBox(st, A, fit) }));
    return fit;
  }

  /* the cue on screen at a moment, from a log of cues: the last one said, if it
     was said within the banner's time */
  function bannerAt(cues, tMs, isCorrection) {
    let last = null;
    for (const c of cues) { if (c.t <= tMs) last = c; else break; }
    if (!last || tMs - last.t >= BANNER_MS) return null;
    return { text: last.text, colour: isCorrection && isCorrection(last) ? C.bad : C.ink, at: last.t, id: last.id };
  }

  /* a correction — one of the move's faults, a rep dropped early, or a count
     carrying the slow-down remark — is the one thing shown in red; the prompts,
     the counts, the time calls and the rest are neutral */
  function isCorrection(cue, move) {
    const id = cue.id, prompts = move.prompts || [];
    if (id === 'early') return true;
    if (move.faults.includes(id) && id !== 'lost' && !prompts.includes(id)) return true;
    return /^(count\d+|done)$/.test(id) && !!cue.text && cue.text.includes(Core.SHARED_CUES.fast.text);
  }

  return { C, FONT, BANNER_MS, bandText, faultWords, draw, drawBody, drawHud, bannerAt, isCorrection, label, sweep , POINT_NAMES, POINT_LINES };
});
