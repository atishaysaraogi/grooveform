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
    if (cfg.angles) for (const b of move.bands) {
      const val = live && r[b.of] != null ? `${Math.round(r[b.of])}°` : '—';
      L(`${b.hud} ${val}`, `${b.note} ${bandText(b, cfg)}`, live ? (v.good[b.key] ? C.good : C.bad) : C.dim);
    }
    /* which set this is, and under it the reps counted so far */
    const setNo = st.setNo || 0, setCount = cfg.setCount || 1;
    if (setNo) L(`SET ${setNo} of ${setCount}`, out.between ? 'done' : '', C.ink);
    if (setNo && move.reps) L(`REP ${out.reps} of ${out.repTarget}`, out.done ? 'done' : '', C.ink);

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
    let floor = H - pad - wmSize - fs * 0.5;

    /* the cue, kept on screen a moment after it was said so the recording shows
       it. Wrapped to the frame, never past its edge: a long instruction takes
       two or three lines, and shrinks a little rather than take four. */
    const measure = (str) => ctx.measureText(str).width;
    const banner = st.banner;
    if (banner && st.now - banner.at < BANNER_MS) {
      const maxW = W - pad * 2 - fs * 1.6;
      let size = fs, lines;
      for (;;) {
        ctx.font = `800 ${size}px ${FONT}`;
        lines = Core.wrapWords(banner.text, maxW, measure);
        if (lines.length <= 3 || size <= fs * 0.62) break;
        size = Math.round(size * 0.88);
      }
      const lh = size * 1.22, bh = lh * lines.length + size;
      const bw = Math.min(W - pad * 2, Math.max(...lines.map(measure)) + fs * 1.6);
      const y = floor - bh;
      ctx.fillStyle = 'rgba(13,17,23,.82)';
      ctx.beginPath(); ctx.roundRect((W - bw) / 2, y, bw, bh, Math.min(bh / 2, fs * 1.1)); ctx.fill();
      ctx.strokeStyle = banner.colour; ctx.lineWidth = Math.max(2, W * 0.003); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = banner.colour;
      lines.forEach((str, i) => ctx.fillText(str, W / 2, y + size * 0.5 + lh * (i + 0.5)));
      banner.lines = lines; banner.size = size; banner.width = bw; banner.frame = W;
      floor = y - fs * 0.4;
    }
    /* every fault present right now, in words, above the cue: the voice keeps to
       one thing at a time, the picture need not. Faults are the one thing in red. */
    const words = out.between ? (setNo >= setCount ? 'All sets done' : `Set ${setNo} done — tap Next set when you are ready`) : faultWords(out, st.cues);
    if (words) {
      const ws = fs * 0.62;
      ctx.font = `700 ${ws}px ${FONT}`;
      const wl = Core.wrapWords(words, W - pad * 2, measure);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs * 0.18; ctx.strokeStyle = C.shadow; ctx.lineJoin = 'round';
      ctx.fillStyle = out.between ? C.ink : C.bad;
      wl.forEach((str, i) => { const y = floor - ws * 1.2 * (wl.length - i - 0.5); ctx.strokeText(str, W / 2, y); ctx.fillText(str, W / 2, y); });
    }
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
    ctx.restore();
    if (st.out) drawHud(ctx, st);
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

  return { C, FONT, BANNER_MS, bandText, faultWords, draw, drawBody, drawHud, bannerAt, isCorrection, label, sweep };
});
