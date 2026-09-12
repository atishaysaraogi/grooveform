/* ============================================================
   Anatomical demo figure. Draws the move on a canvas with muscle
   on the bones: each muscle is pinned to a bone in that bone's own
   frame, and warms up with the movement. No labels, no legend —
   the colour is the whole message.

   Poses reuse the two keyframes already authored for the placement
   diagrams, but are rebuilt by interpolating JOINT ANGLES rather
   than point positions, so limbs keep their length through the arc.
   ============================================================ */
(function (root) {
  'use strict';

  /* ---- keyframes, in the 400x175 diagram space ---- */
  var SIDE = {
    wallsit:     { wall: 338, A: { h: [336, 54], sh: [336, 72], hip: [336, 114], kn: [290, 114], an: [290, 160], ft: [276, 160], el: [336, 94], wr: [336, 112] } },
    plank:       { A: { h: [258, 96], sh: [272, 106], hip: [312, 122], kn: [336, 134], an: [356, 148], ft: [362, 160], el: [272, 160], wr: [248, 160] } },
    heelslide:   { far: [[318, 130], [332, 158]], A: { h: [238, 150], sh: [254, 152], hip: [300, 152], kn: [330, 153], an: [360, 154], ft: [362, 144], el: [278, 156], wr: [300, 158] },
                   B: { h: [238, 150], sh: [254, 152], hip: [300, 152], kn: [318, 118], an: [336, 152], ft: [346, 148], el: [278, 156], wr: [300, 158] } },
    band_row:    { wall: 386, A: { h: [300, 46], sh: [300, 66], hip: [300, 110], kn: [300, 136], an: [300, 160], ft: [312, 160], el: [330, 70], wr: [358, 74] },
                   B: { h: [300, 46], sh: [300, 66], hip: [300, 110], kn: [300, 136], an: [300, 160], ft: [312, 160], el: [288, 92], wr: [318, 96] } },
    calfstretch: { wall: 362, front: [[326, 136], [330, 160]], A: { h: [318, 52], sh: [322, 70], hip: [306, 112], kn: [290, 138], an: [274, 160], ft: [288, 160], el: [346, 78], wr: [362, 84] } }
  };
  var FRONTP = {
    hipabd:       { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [262, 96], elR: [326, 92], wrL: [258, 118], wrR: [330, 114] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [326, 130], anL: [285, 160], anR: [341, 152], elL: [262, 96], elR: [326, 92], wrL: [258, 118], wrR: [330, 114] } },
    shoulder_er:  { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 92], elR: [322, 92], wrL: [270, 112], wrR: [300, 96] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 92], elR: [322, 92], wrL: [270, 112], wrR: [348, 92] } },
    shoulder_abd: { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 92], elR: [322, 92], wrL: [272, 114], wrR: [326, 114] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 92], elR: [346, 66], wrL: [272, 114], wrR: [372, 66] } },
    pullapart:    { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 70], elR: [324, 70], wrL: [272, 74], wrR: [328, 74] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [254, 66], elR: [346, 66], wrL: [228, 66], wrR: [372, 66] } },
    trapstretch:  { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [274, 92], elR: [326, 92], wrL: [290, 112], wrR: [324, 114] },
                    B: { h: [288, 50], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [274, 92], elR: [332, 62], wrL: [290, 112], wrR: [300, 42] } }
  };

  /* ---- which regions do the work, and how hard (0–1 at full effort) ---- */
  var WORK = {
    heelslide:    { hold: false, side: 'both', flip: true,  w: { thigh: .85, ham: .55, calf: .3, abs: .35 } },
    hipabd:       { hold: false, side: 'R',    w: { thigh: .8, oblique: .5, calf: .3, glute: .8 } },
    wallsit:      { hold: true,  side: 'both', flip: true,  w: { thigh: 1, calf: .45, glute: .55, abs: .3 } },
    plank:        { hold: true,  side: 'both', flip: false, w: { abs: 1, oblique: .8, shoulder: .55, thigh: .45, chest: .3 } },
    calfstretch:  { hold: true,  side: 'both', flip: false, w: { calf: 1, ham: .4, shoulder: .25 } },
    shoulder_er:  { hold: false, side: 'R',    w: { shoulder: .85, forearm: .5, back: .35 } },
    shoulder_abd: { hold: false, side: 'R',    w: { shoulder: 1, neck: .3, forearm: .45 } },
    band_row:     { hold: false, side: 'both', flip: false, w: { back: .95, shoulder: .6, arm: .6, forearm: .45 } },
    pullapart:    { hold: false, side: 'both', w: { back: .9, shoulder: .8, forearm: .35, chest: .25 } },
    trapstretch:  { hold: true,  side: 'R',    w: { neck: 1, shoulder: .3 } }
  };

  /* ---- muscle outlines in bone-local coordinates [along 0..1, across] ---- */
  var SHAPES = {
    shoulder: [[-.18, -.30], [.14, -.36], [.40, -.22], [.36, .18], [.06, .30], [-.14, .10]],
    arm:      [[.20, -.26], [.62, -.24], [.72, .10], [.24, .18]],
    forearm:  [[.06, -.28], [.48, -.24], [.74, -.08], [.70, .16], [.16, .26]],
    thigh:    [[.06, -.32], [.52, -.28], [.74, -.10], [.70, .18], [.10, .32]],
    ham:      [[.08, .16], [.54, .20], [.72, .10], [.66, -.06], [.12, -.08]],
    calf:     [[.04, -.28], [.42, -.32], [.60, -.10], [.56, .18], [.06, .26]]
  };
  /* ---- torso-local coordinates: [along hip→shoulder 0..1, across] ---- */
  var TORSO_SHAPES = {
    chest:    [[.62, .06], [.90, .10], [.96, .36], [.66, .40]],
    back:     [[.60, .06], [.92, .10], [.98, .38], [.64, .42]],
    abs:      [[.18, .04], [.54, .05], [.56, .26], [.20, .24]],
    oblique:  [[.16, .24], [.52, .26], [.54, .46], [.18, .44]],
    neck:     [[.95, .04], [1.22, .12], [1.14, .40], [.92, .32]],
    glute:    [[-.06, .10], [.16, .12], [.18, .44], [-.04, .42]]
  };

  /* ---- geometry helpers ---- */
  function V(a) { return { x: a[0], y: a[1] }; }
  function ang(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  function len(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function shortest(a, b) { var d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function pt(a, angle, l) { return { x: a.x + Math.cos(angle) * l, y: a.y + Math.sin(angle) * l }; }
  function lerp(a, b, k) { return a + (b - a) * k; }

  // Unified skeleton: every pose becomes L (near / working) and R joints plus head.
  function unify(pose, view) {
    if (view === 'front') {
      var f = {};
      ['shL','shR','hipL','hipR','knL','knR','anL','anR','elL','elR','wrL','wrR'].forEach(function (k) { f[k] = V(pose[k]); });
      f.head = V(pose.h);
      return f;
    }
    var sh = V(pose.sh), hip = V(pose.hip), kn = V(pose.kn), an = V(pose.an), el = V(pose.el), wr = V(pose.wr);
    var trunk = ang(hip, sh), across = trunk + Math.PI / 2, d = len(hip, sh) * 0.30;
    return {
      head: V(pose.h), ft: V(pose.ft),
      shL: pt(sh, across, -d), shR: pt(sh, across, d), hipL: pt(hip, across, -d), hipR: pt(hip, across, d),
      elL: el, elR: el, wrL: wr, wrR: wr, knL: kn, knR: kn, anL: an, anR: an
    };
  }
  var CHAIN = [['shL','hipL'], ['shR','hipR'], ['elL','shL'], ['wrL','elL'], ['elR','shR'], ['wrR','elR'],
               ['knL','hipL'], ['anL','knL'], ['knR','hipR'], ['anR','knR'], ['ft','anL']];
  // Rebuild a pose at k between A and B by interpolating each bone's ANGLE (not its endpoints).
  function tween(A, B, k) {
    if (!B) return A;
    var out = { hipL: { x: lerp(A.hipL.x, B.hipL.x, k), y: lerp(A.hipL.y, B.hipL.y, k) } };
    out.hipR = { x: lerp(A.hipR.x, B.hipR.x, k), y: lerp(A.hipR.y, B.hipR.y, k) };
    out.head = B.head ? { x: lerp(A.head.x, B.head.x, k), y: lerp(A.head.y, B.head.y, k) } : A.head;
    CHAIN.forEach(function (c) {
      var child = c[0], parent = c[1];
      if (!A[child] || !A[parent]) return;
      var a0 = ang(A[parent], A[child]), a1 = B[child] && B[parent] ? ang(B[parent], B[child]) : a0;
      var l0 = len(A[parent], A[child]), l1 = B[child] && B[parent] ? len(B[parent], B[child]) : l0;
      out[child] = pt(out[parent] || A[parent], a0 + shortest(a0, a1) * k, lerp(l0, l1, k));
    });
    return out;
  }

  /* ---- painting ---- */
  function css(el, name, fallback) {
    var v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  }
  function hex(c) {
    c = c.trim();
    if (c.charAt(0) !== '#') { var m = c.match(/\d+/g); return m ? [+m[0], +m[1], +m[2]] : [200, 180, 150]; }
    c = c.slice(1); if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  }
  function mix(a, b, k) {
    var A = hex(a), B = hex(b);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * k) + ',' + Math.round(A[1] + (B[1] - A[1]) * k) + ',' + Math.round(A[2] + (B[2] - A[2]) * k) + ')';
  }
  function blob(ctx, pts) {
    var n = pts.length;
    ctx.beginPath();
    ctx.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
    for (var i = 0; i < n; i++) {
      var cur = pts[i], nxt = pts[(i + 1) % n];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
    }
    ctx.closePath();
  }
  function onBone(a, b, shape, flip, width) {
    var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-6;
    var ux = dx / L, uy = dy / L, vx = -uy * (flip ? -1 : 1), vy = ux * (flip ? -1 : 1);
    var w = (width || L * 0.3) * 1.55;
    return shape.map(function (s) { return { x: a.x + ux * s[0] * L + vx * s[1] * w, y: a.y + uy * s[0] * L + vy * s[1] * w }; });
  }

  function drawFigure(ctx, S, P, heats, view, extras) {
    var skin = P.skin, edge = P.skinline;
    function capsule(a, b, w, col) {
      if (!a || !b) return;
      ctx.strokeStyle = col || skin; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (!col) { ctx.strokeStyle = edge; ctx.lineWidth = 1.1; ctx.stroke(); }
    }
    function muscle(a, b, shape, flip, h, width) {
      if (!a || !b || h == null) return;
      blob(ctx, onBone(a, b, shape, flip, width));
      ctx.fillStyle = heat(P, h); ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    }
    var scale = len(S.hipL, S.shL) || 40;
    var LIMB = scale * 0.34, FORELIMB = scale * 0.28, LEG = scale * 0.42, SHIN = scale * 0.34;

    if (extras && extras.far) { extras.far.forEach(function (seg) { capsule(seg[0], seg[1], LEG * 0.8, P.far); }); }


    // limbs behind the torso first
    if (view !== 'side') { capsule(S.hipR, S.knR, LEG); capsule(S.knR, S.anR, SHIN); }
    capsule(S.hipL, S.knL, LEG); capsule(S.knL, S.anL, SHIN);
    if (S.ft) capsule(S.anL, S.ft, SHIN * 0.6);

    var shMid0 = { x: (S.shL.x + S.shR.x) / 2, y: (S.shL.y + S.shR.y) / 2 };
    capsule(S.head, shMid0, scale * 0.26);
    // torso
    var torso = [S.shL, S.shR, S.hipR, S.hipL];
    blob(ctx, torso); ctx.fillStyle = skin; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 1.3; ctx.stroke();

    // torso-local muscles: frame runs hip-mid -> shoulder-mid, across the body width
    var hipM = { x: (S.hipL.x + S.hipR.x) / 2, y: (S.hipL.y + S.hipR.y) / 2 };
    var shM = { x: (S.shL.x + S.shR.x) / 2, y: (S.shL.y + S.shR.y) / 2 };
    var tdx = shM.x - hipM.x, tdy = shM.y - hipM.y, tL = Math.hypot(tdx, tdy) || 1e-6;
    var tux = tdx / tL, tuy = tdy / tL, tvx = -tuy, tvy = tux;
    var halfW = len(S.shL, S.shR) / 2 / tL;
    function torsoBlob(shape, sgn, h) {
      if (h == null) return;
      blob(ctx, shape.map(function (s) {
        var across = s[1] * 2 * halfW * sgn;
        return { x: hipM.x + tux * s[0] * tL + tvx * across * tL, y: hipM.y + tuy * s[0] * tL + tvy * across * tL };
      }));
      ctx.fillStyle = heat(P, h); ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    }
    var sides = view === 'side' ? [FLIP ? -1 : 1] : [1, -1];
    sides.forEach(function (sgn) {
      torsoBlob(TORSO_SHAPES[view === 'side' ? 'back' : 'chest'], sgn, view === 'side' ? heats.back : Math.max(heats.chest, heats.back * 0.6));
      torsoBlob(TORSO_SHAPES.abs, sgn, heats.abs);
      torsoBlob(TORSO_SHAPES.oblique, sgn, heats.oblique);
      torsoBlob(TORSO_SHAPES.glute, sgn, heats.glute);
      torsoBlob(TORSO_SHAPES.neck, sgn, heats.neck);
    });

    // near arm and leg muscles (front view mirrors to both sides)
    var pairs = view === 'side' ? [['L', FLIP]] : [['L', true], ['R', false]];
    pairs.forEach(function (pr) {
      var s = pr[0], flip = pr[1], dim = (WORKING && WORKING !== 'both' && s !== WORKING) ? 0.28 : 1;
      var sh = S['sh' + s], el = S['el' + s], wr = S['wr' + s], hip = S['hip' + s], kn = S['kn' + s], an = S['an' + s];
      capsule(sh, el, LIMB); capsule(el, wr, FORELIMB);
      muscle(sh, el, SHAPES.shoulder, flip, scaled(heats.shoulder, dim), LIMB);
      muscle(sh, el, SHAPES.arm, flip, scaled(heats.arm, dim), LIMB);
      muscle(el, wr, SHAPES.forearm, flip, scaled(heats.forearm, dim), FORELIMB);
      muscle(hip, kn, SHAPES.thigh, flip, scaled(heats.thigh, dim), LEG);
      muscle(hip, kn, SHAPES.ham, flip, scaled(heats.ham, dim), LEG);
      muscle(kn, an, SHAPES.calf, flip, scaled(heats.calf, dim), SHIN);
    });

    // head last
    ctx.beginPath(); ctx.arc(S.head.x, S.head.y, scale * 0.23, 0, 7);
    ctx.fillStyle = skin; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 1.3; ctx.stroke();
  }
  var WORKING = 'both', FLIP = false;
  var REGIONS = ['shoulder','arm','forearm','thigh','ham','calf','chest','back','abs','oblique','neck','glute'];
  var REST = 0.07;
  function scaled(v, k) { return v == null ? null : Math.max(0.06, v * k); }
  function heat(P, a) {
    a = Math.max(0, Math.min(1, a));
    return a < 0.5 ? mix(P.muscle, P.warm, a * 2) : mix(P.warm, P.hot, (a - 0.5) * 2);
  }

  /* ---- the loop ---- */
  var running = [];
  function stopAll() { running.forEach(function (r) { cancelAnimationFrame(r.raf); if (r.io) r.io.disconnect(); }); running = []; }

  function mount(canvas) {
    var id = canvas.getAttribute('data-anat'); if (!id) return;
    var cfg = WORK[id] || { hold: false, side: 'both', w: {} };
    var src = FRONTP[id] ? { view: 'front', data: FRONTP[id] } : { view: 'side', data: SIDE[id] };
    if (!src.data) return;
    var view = src.view;
    var A = unify(src.data.A, view), B = src.data.B ? unify(src.data.B, view) : null;
    var extras = null;
    if (view === 'side' && (src.data.far || src.data.front)) {
      var seg = src.data.far || src.data.front;
      extras = { far: [[V(src.data.A.hip), V(seg[0])], [V(seg[0]), V(seg[1])]] };
    }
    var wall = src.data.wall || null;
    var ctx = canvas.getContext('2d');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var rec = { raf: 0, io: null, visible: true, t: reduce ? 1.4 : 0, last: null };

    function palette() {
      return {
        skin: css(canvas, '--fig-skin', '#f6e3c8'), skinline: css(canvas, '--fig-line', '#c7a678'),
        muscle: css(canvas, '--fig-muscle', '#e7cda9'), warm: css(canvas, '--tangerine', '#ffb830'),
        hot: css(canvas, '--pink', '#ff2e88'), far: css(canvas, '--fig-far', '#ead9bf'),
        floor: css(canvas, '--line', '#e9d6bf')
      };
    }
    function size() {
      var dpr = Math.min(2, window.devicePixelRatio || 1), r = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, Math.round(r.width * dpr)); canvas.height = Math.max(2, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: r.width, h: r.height };
    }
    var dims = size();

    function frame(now) {
      rec.raf = requestAnimationFrame(frame);
      if (!rec.visible) { rec.last = now; return; }
      if (rec.last !== null && !reduce) rec.t += Math.min(0.05, (now - rec.last) / 1000);
      rec.last = now;
      var CYCLE = cfg.hold ? 5 : 6.6, u = rec.t % CYCLE, p;
      if (cfg.hold) { p = 0.72 + 0.28 * (0.5 - 0.5 * Math.cos(2 * Math.PI * u / CYCLE)); }
      else {
        var UPT = 2, HOLDT = 1, DOWNT = 3;
        if (u < UPT) p = 1 - Math.pow(1 - u / UPT, 3);
        else if (u < UPT + HOLDT) p = 1;
        else if (u < UPT + HOLDT + DOWNT) { var k = (u - UPT - HOLDT) / DOWNT; p = 1 - (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); }
        else p = 0;
      }
      var pose = tween(A, B, cfg.hold ? 1 : p);
      var heats = {}, drive = cfg.hold ? p : Math.pow(p, 0.75);
      REGIONS.forEach(function (k) { heats[k] = REST + (cfg.w[k] || 0) * drive * 0.93; });
      WORKING = cfg.side; FLIP = !!cfg.flip;

      var P = palette();
      var w = dims.w, h = dims.h;
      ctx.clearRect(0, 0, w, h);
      // fit the 400x175 pose space into the canvas
      var box = { x: 205, y: 18, w: 200, h: 152 };
      var s = Math.min(w / box.w, h / box.h) * 0.92;
      ctx.save();
      ctx.translate(w / 2 - (box.x + box.w / 2) * s, h / 2 - (box.y + box.h / 2) * s);
      ctx.scale(s, s);
      // floor and wall, drawn in the same space
      ctx.strokeStyle = P.floor; ctx.lineWidth = 2 / s;
      ctx.beginPath(); ctx.moveTo(210, 163); ctx.lineTo(400, 163); ctx.stroke();
      if (wall) { ctx.lineWidth = 3 / s; ctx.beginPath(); ctx.moveTo(wall, 34); ctx.lineTo(wall, 163); ctx.stroke(); }
      drawFigure(ctx, pose, P, heats, view, extras);
      ctx.restore();
    }
    rec.raf = requestAnimationFrame(frame);
    if ('IntersectionObserver' in window) {
      rec.io = new IntersectionObserver(function (es) { rec.visible = es[0].isIntersecting; });
      rec.io.observe(canvas);
    }
    var onResize = function () { dims = size(); };
    window.addEventListener('resize', onResize);
    running.push(rec);
  }

  function demo(ex) {
    var id = typeof ex === 'string' ? ex : ex.id;
    return '<canvas class="demo-fig" data-anat="' + id + '" role="img" aria-label="' +
      (typeof ex === 'string' ? id : ex.name) + ', animated"></canvas>';
  }
  function mountAll(rootEl) {
    stopAll();
    var list = (rootEl || document).querySelectorAll('canvas[data-anat]');
    Array.prototype.forEach.call(list, mount);
  }

  root.FyzioAnatomy = { demo: demo, mountAll: mountAll, stopAll: stopAll, work: WORK };
})(typeof window !== 'undefined' ? window : globalThis);
