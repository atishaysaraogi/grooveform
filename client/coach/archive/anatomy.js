/* ============================================================
   Anatomical demo figure. Draws the move with muscle on the bones:
   each muscle is pinned to a bone in that bone's own frame and warms
   up as the movement progresses. No labels, no legend.

   Poses are two keyframes per move. In-between frames interpolate
   JOINT ANGLES rather than point positions, so limbs keep their
   length through the arc. Side views carry both limbs — the far one
   drawn behind in a cooler tone.
   ============================================================ */
(function (root) {
  'use strict';

  /* ---- keyframes, in the 400x175 diagram space (floor y = 163) ----
     side view:  h head · sh shoulder · hip · kn/an/ft near leg · el/wr near arm
                 knF/anF/ftF far leg · elF/wrF far arm
     front view: h · shL/shR · elL/elR · wrL/wrR · hipL/hipR · knL/knR · anL/anR   */
  var SIDE = {
    wallsit: { wall: 340,
      A: { h: [334, 50], sh: [334, 74], hip: [336, 116], kn: [292, 114], an: [292, 160], ft: [276, 161],
           el: [328, 98], wr: [322, 120], knF: [297, 119], anF: [297, 160], ftF: [282, 161], elF: [333, 100], wrF: [328, 122] },
      B: { h: [334, 53], sh: [334, 77], hip: [336, 119], kn: [290, 118], an: [290, 160], ft: [274, 161],
           el: [328, 101], wr: [322, 123], knF: [295, 123], anF: [295, 160], ftF: [280, 161], elF: [333, 103], wrF: [328, 125] } },
    plank: {
      A: { h: [248, 112], sh: [266, 120], hip: [310, 131], kn: [338, 142], an: [364, 152], ft: [368, 162],
           el: [266, 158], wr: [244, 161], knF: [336, 146], anF: [362, 156], ftF: [366, 162], elF: [268, 160], wrF: [248, 162] },
      B: { h: [248, 110], sh: [266, 118], hip: [310, 126], kn: [338, 139], an: [364, 151], ft: [368, 162],
           el: [266, 158], wr: [244, 161], knF: [336, 143], anF: [362, 155], ftF: [366, 162], elF: [268, 160], wrF: [248, 162] } },
    heelslide: {
      A: { h: [236, 148], sh: [256, 150], hip: [302, 153], kn: [332, 153], an: [360, 154], ft: [362, 143],
           el: [280, 158], wr: [302, 161], knF: [328, 142], anF: [352, 156], ftF: [355, 146], elF: [280, 161], wrF: [302, 163] },
      B: { h: [236, 148], sh: [256, 150], hip: [302, 153], kn: [320, 118], an: [338, 152], ft: [348, 146],
           el: [280, 158], wr: [302, 161], knF: [328, 142], anF: [352, 156], ftF: [355, 146], elF: [280, 161], wrF: [302, 163] } },
    band_row: { wall: 388,
      A: { h: [300, 44], sh: [300, 68], hip: [300, 112], kn: [300, 138], an: [300, 161], ft: [316, 162],
           el: [330, 74], wr: [358, 78], knF: [295, 138], anF: [295, 161], ftF: [310, 162], elF: [327, 79], wrF: [355, 83] },
      B: { h: [300, 44], sh: [300, 68], hip: [300, 112], kn: [300, 138], an: [300, 161], ft: [316, 162],
           el: [286, 92], wr: [318, 96], knF: [295, 138], anF: [295, 161], ftF: [310, 162], elF: [284, 96], wrF: [315, 100] } },
    calfstretch: { wall: 364,
      A: { h: [316, 48], sh: [320, 70], hip: [308, 112], kn: [298, 138], an: [290, 161], ft: [304, 162],
           el: [344, 74], wr: [362, 78], knF: [330, 132], anF: [334, 161], ftF: [348, 162], elF: [342, 79], wrF: [360, 83] },
      B: { h: [326, 48], sh: [330, 70], hip: [318, 112], kn: [296, 139], an: [280, 161], ft: [294, 162],
           el: [350, 76], wr: [364, 80], knF: [338, 136], anF: [340, 161], ftF: [354, 162], elF: [348, 81], wrF: [362, 85] } }
  };
  var FRONTP = {
    hipabd:       { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [262, 96], elR: [326, 92], wrL: [258, 118], wrR: [330, 114] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [326, 130], anL: [285, 161], anR: [341, 152], elL: [262, 96], elR: [326, 92], wrL: [258, 118], wrR: [330, 114] } },
    shoulder_er:  { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [276, 92], elR: [322, 92], wrL: [270, 112], wrR: [300, 96] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [276, 92], elR: [322, 92], wrL: [270, 112], wrR: [348, 92] } },
    shoulder_abd: { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [276, 92], elR: [322, 92], wrL: [272, 114], wrR: [326, 114] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [276, 92], elR: [346, 66], wrL: [272, 114], wrR: [372, 66] } },
    pullapart:    { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [276, 70], elR: [324, 70], wrL: [272, 74], wrR: [328, 74] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [254, 66], elR: [346, 66], wrL: [228, 66], wrR: [372, 66] } },
    trapstretch:  { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [274, 92], elR: [326, 92], wrL: [290, 112], wrR: [324, 114] },
                    B: { h: [288, 50], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 161], anR: [315, 161], elL: [274, 92], elR: [332, 62], wrL: [290, 112], wrR: [300, 42] } }
  };

  /* ---- which regions do the work, and how hard. flip = which way the body faces in a side view ---- */
  var WORK = {
    heelslide:    { hold: false, side: 'both', flip: true,  w: { thigh: .85, ham: .5, calf: .3, abs: .35 } },
    hipabd:       { hold: false, side: 'R',    w: { thigh: .8, oblique: .5, calf: .3, glute: .8 } },
    wallsit:      { hold: true,  side: 'both', flip: true,  w: { thigh: 1, calf: .45, glute: .55, abs: .3 } },
    plank:        { hold: true,  side: 'both', flip: false, w: { abs: 1, oblique: .8, shoulder: .55, thigh: .45, back: .3 } },
    calfstretch:  { hold: true,  side: 'both', flip: false, w: { calf: 1, ham: .4, shoulder: .25 } },
    shoulder_er:  { hold: false, side: 'R',    w: { shoulder: .85, forearm: .5, back: .35 } },
    shoulder_abd: { hold: false, side: 'R',    w: { shoulder: 1, neck: .3, forearm: .45 } },
    band_row:     { hold: false, side: 'both', flip: true,  w: { back: .95, shoulder: .6, arm: .6, forearm: .45 } },
    pullapart:    { hold: false, side: 'both', w: { back: .9, shoulder: .8, forearm: .35, chest: .25 } },
    trapstretch:  { hold: true,  side: 'R',    w: { neck: 1, shoulder: .3 } }
  };

  /* ---- muscle outlines: [along the bone 0..1, across it] ---- */
  var SHAPES = {
    shoulder: [[-.18, -.30], [.14, -.36], [.40, -.22], [.36, .18], [.06, .30], [-.14, .10]],
    arm:      [[.20, -.26], [.62, -.24], [.72, .10], [.24, .18]],
    forearm:  [[.06, -.28], [.48, -.24], [.74, -.08], [.70, .16], [.16, .26]],
    thigh:    [[.06, -.32], [.52, -.28], [.74, -.10], [.70, .18], [.10, .32]],
    ham:      [[.08, .16], [.54, .20], [.72, .10], [.66, -.06], [.12, -.08]],
    calf:     [[.04, -.28], [.42, -.32], [.60, -.10], [.56, .18], [.06, .26]]
  };
  /* ---- torso-local: [along hip→shoulder 0..1, across] ---- */
  var TORSO_SHAPES = {
    chest:   [[.62, .06], [.90, .10], [.96, .36], [.66, .40]],
    back:    [[.60, .06], [.92, .10], [.98, .38], [.64, .42]],
    abs:     [[.18, .04], [.54, .05], [.56, .26], [.20, .24]],        /* front: the rectus, either side of the midline */
    oblique: [[.16, .24], [.52, .26], [.54, .46], [.18, .44]],        /* front: the flanks, outside it */
    neck:    [[.95, .04], [1.22, .12], [1.14, .40], [.92, .32]],
    glute:   [[-.06, .10], [.16, .12], [.18, .44], [-.04, .42]]
  };
  /* Edge-on the abdominal wall stacks the other way round: the oblique is the broad sheet over the
     flank and the rectus the narrow strip at the very front of it. Reusing the front-view pair here
     drew the rectus behind the obliques, which is what made a plank look inside-out. */
  var SIDE_TORSO = {
    abs:     [[.10, .31], [.58, .29], [.60, .17], [.12, .19]],
    oblique: [[.12, .19], [.58, .17], [.60, -.03], [.14, .01]]
  };
  /* Which side of the hip→shoulder line the front of the body is on, for a figure that carries no
     belly sign of its own: in almost every side-on exercise the knee leads the front. The foot
     stands in when the leg is straight under the hip and the knee says nothing. */
  function bellySide(J, tvx, tvy) {
    var pts = [J.kn, J.ft, J.an];
    for (var i = 0; i < pts.length; i++) {
      if (!pts[i] || !J.hip) continue;
      var d = (pts[i].x - J.hip.x) * tvx + (pts[i].y - J.hip.y) * tvy;
      if (Math.abs(d) > 1e-3) return d > 0 ? 1 : -1;
    }
    return 1;
  }
  var REGIONS = ['shoulder','arm','forearm','thigh','ham','calf','chest','back','abs','oblique','neck','glute'];
  var REST = 0.07;

  /* ---- geometry ---- */
  function V(a) { return { x: a[0], y: a[1] }; }
  function ang(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  function len(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function shortest(a, b) { var d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function at(a, angle, l) { return { x: a.x + Math.cos(angle) * l, y: a.y + Math.sin(angle) * l }; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function lerpP(a, b, k) { return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }; }

  var JOINTS = {
    front: ['h','shL','shR','elL','elR','wrL','wrR','hipL','hipR','knL','knR','anL','anR'],
    side:  ['h','sh','hip','el','wr','kn','an','ft','elF','wrF','knF','anF','ftF']
  };
  var CHAINS = {
    front: [['shL','hipL'], ['shR','hipR'], ['elL','shL'], ['wrL','elL'], ['elR','shR'], ['wrR','elR'],
            ['knL','hipL'], ['anL','knL'], ['knR','hipR'], ['anR','knR']],
    side:  [['sh','hip'], ['el','sh'], ['wr','el'], ['elF','sh'], ['wrF','elF'],
            ['kn','hip'], ['an','kn'], ['ft','an'], ['knF','hip'], ['anF','knF'], ['ftF','anF']]
  };
  var ROOTS = { front: ['hipL','hipR'], side: ['hip'] };

  function unify(pose, view) {
    var out = {};
    JOINTS[view].forEach(function (k) { if (pose[k]) out[k] = V(pose[k]); });
    out.head = out.h; delete out.h;
    return out;
  }
  // Rebuild the pose at k by interpolating each bone's angle and length, not its endpoints.
  function tween(A, B, k, view) {
    if (!B || k <= 0) return A;
    var out = {};
    ROOTS[view].forEach(function (r) { out[r] = lerpP(A[r], B[r], k); });
    out.head = B.head ? lerpP(A.head, B.head, k) : A.head;
    CHAINS[view].forEach(function (c) {
      var child = c[0], parent = c[1];
      if (!A[child] || !A[parent]) return;
      var a0 = ang(A[parent], A[child]), l0 = len(A[parent], A[child]);
      var a1 = (B[child] && B[parent]) ? ang(B[parent], B[child]) : a0;
      var l1 = (B[child] && B[parent]) ? len(B[parent], B[child]) : l0;
      out[child] = at(out[parent] || A[parent], a0 + shortest(a0, a1) * k, lerp(l0, l1, k));
    });
    return out;
  }

  /* ---- colour ---- */
  function cssVar(el, name, fallback) { var v = getComputedStyle(el).getPropertyValue(name).trim(); return v || fallback; }
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
  function heat(P, a) { a = Math.max(0, Math.min(1, a)); return a < 0.5 ? mix(P.muscle, P.warm, a * 2) : mix(P.warm, P.hot, (a - 0.5) * 2); }

  /* ---- shapes ---- */
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
    var ux = dx / L, uy = dy / L, f = flip ? -1 : 1, vx = -uy * f, vy = ux * f, w = width * 0.95;
    return shape.map(function (s) { return { x: a.x + ux * s[0] * L + vx * s[1] * w, y: a.y + uy * s[0] * L + vy * s[1] * w }; });
  }

  function drawFigure(ctx, J, P, heats, view, cfg) {
    var scale = view === 'side' ? len(J.hip, J.sh) : len(J.hipL, J.shL);
    var LIMB = scale * 0.30, FORELIMB = scale * 0.24, LEG = scale * 0.36, SHIN = scale * 0.28;
    var flip = !!cfg.flip, working = cfg.side || 'both';

    function capsule(a, b, w, col) {
      if (!a || !b) return;
      ctx.strokeStyle = col || P.skin; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = col ? P.farline : P.skinline; ctx.lineWidth = 1.1; ctx.stroke();
    }
    function muscle(a, b, shape, h, width, f) {
      if (!a || !b || h == null) return;
      blob(ctx, onBone(a, b, shape, f, width));
      ctx.fillStyle = heat(P, h); ctx.fill(); ctx.strokeStyle = P.skinline; ctx.lineWidth = 1; ctx.stroke();
    }
    // hands: a circle at the wrist. feet: an oval along ankle→foot (side view) or under the ankle (front view).
    function hand(p, col, line) {
      if (!p) return;
      ctx.beginPath(); ctx.arc(p.x, p.y, FORELIMB * 0.34, 0, 7);
      ctx.fillStyle = col || P.skin; ctx.fill(); ctx.strokeStyle = line || P.skinline; ctx.lineWidth = 1.1; ctx.stroke();
    }
    function foot(an, ft, col, line) {
      if (!an) return;
      var cx, cy, rx, ry, rot;
      if (ft) { cx = (an.x + ft.x) / 2; cy = (an.y + ft.y) / 2; rx = len(an, ft) / 2 + SHIN * 0.16; ry = SHIN * 0.20; rot = ang(an, ft); }
      else { cx = an.x; cy = an.y + SHIN * 0.14; rx = SHIN * 0.30; ry = SHIN * 0.15; rot = 0; }
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot, 0, 7);
      ctx.fillStyle = col || P.skin; ctx.fill(); ctx.strokeStyle = line || P.skinline; ctx.lineWidth = 1.1; ctx.stroke();
    }

    var shMid, hipMid, corners, near, far;
    if (view === 'side') {
      var tAng = ang(J.hip, J.sh), across = tAng + Math.PI / 2, d = len(J.hip, J.sh) * 0.30;
      shMid = J.sh; hipMid = J.hip;
      corners = [at(J.sh, across, -d), at(J.sh, across, d), at(J.hip, across, d), at(J.hip, across, -d)];
      far = { sh: J.sh, el: J.elF, wr: J.wrF, hip: J.hip, kn: J.knF, an: J.anF, ft: J.ftF };
      near = [{ sh: J.sh, el: J.el, wr: J.wr, hip: J.hip, kn: J.kn, an: J.an, ft: J.ft, flip: flip, dim: 1 }];
    } else {
      shMid = lerpP(J.shL, J.shR, .5); hipMid = lerpP(J.hipL, J.hipR, .5);
      corners = [J.shL, J.shR, J.hipR, J.hipL];
      far = null;
      near = [{ sh: J.shL, el: J.elL, wr: J.wrL, hip: J.hipL, kn: J.knL, an: J.anL, flip: true, dim: working === 'R' ? 0.3 : 1 },
              { sh: J.shR, el: J.elR, wr: J.wrR, hip: J.hipR, kn: J.knR, an: J.anR, flip: false, dim: working === 'L' ? 0.3 : 1 }];
    }

    // far limbs first, behind everything
    if (far) {
      capsule(far.hip, far.kn, LEG * 0.92, P.far); capsule(far.kn, far.an, SHIN * 0.92, P.far);
      foot(far.an, far.ft, P.far, P.farline);
      capsule(far.sh, far.el, LIMB * 0.92, P.far); capsule(far.el, far.wr, FORELIMB * 0.92, P.far); hand(far.wr, P.far, P.farline);
    } else {
      near.forEach(function (L) { capsule(L.hip, L.kn, LEG); capsule(L.kn, L.an, SHIN); foot(L.an, null); });
    }
    if (view === 'side') { capsule(near[0].hip, near[0].kn, LEG); capsule(near[0].kn, near[0].an, SHIN); foot(near[0].an, near[0].ft); }

    // neck, torso
    capsule(J.head, shMid, scale * 0.20);
    blob(ctx, corners); ctx.fillStyle = P.skin; ctx.fill(); ctx.strokeStyle = P.skinline; ctx.lineWidth = 1.3; ctx.stroke();

    // torso muscles, in the hip→shoulder frame
    var tdx = shMid.x - hipMid.x, tdy = shMid.y - hipMid.y, tL = Math.hypot(tdx, tdy) || 1e-6;
    var tux = tdx / tL, tuy = tdy / tL, tvx = -tuy, tvy = tux;
    var halfW = len(corners[0], corners[1]) / 2 / tL;
    function torsoBlob(shape, sgn, h) {
      if (h == null) return;
      blob(ctx, shape.map(function (s) {
        var a = s[1] * 2 * halfW * sgn;
        return { x: hipMid.x + tux * s[0] * tL + tvx * a * tL, y: hipMid.y + tuy * s[0] * tL + tvy * a * tL };
      }));
      ctx.fillStyle = heat(P, h); ctx.fill(); ctx.strokeStyle = P.skinline; ctx.lineWidth = 1; ctx.stroke();
    }
    if (view === 'side') {
      /* One body, two halves: the spine side and the belly side. Which is which comes from the move
         when it says so, and from the pose itself when it does not. */
      var belly = cfg.belly != null ? cfg.belly : bellySide(J, tvx, tvy);
      torsoBlob(TORSO_SHAPES.back, -belly, heats.back);
      torsoBlob(TORSO_SHAPES.chest, belly, heats.chest);
      torsoBlob(SIDE_TORSO.oblique, belly, heats.oblique);
      torsoBlob(SIDE_TORSO.abs, belly, heats.abs);             /* last: the rectus is the layer nearest the camera */
      torsoBlob(TORSO_SHAPES.glute, -belly, heats.glute);
      torsoBlob(TORSO_SHAPES.neck, belly, heats.neck);
    } else {
      [1, -1].forEach(function (sgn) {
        torsoBlob(TORSO_SHAPES.chest, sgn, Math.max(heats.chest, heats.back * 0.6));
        torsoBlob(TORSO_SHAPES.glute, sgn, heats.glute);
        torsoBlob(TORSO_SHAPES.abs, sgn, heats.abs);
        torsoBlob(TORSO_SHAPES.oblique, sgn, heats.oblique);
        torsoBlob(TORSO_SHAPES.neck, sgn, heats.neck);
      });
    }

    // near limbs with muscle
    near.forEach(function (L) {
      var dim = L.dim;
      capsule(L.sh, L.el, LIMB); capsule(L.el, L.wr, FORELIMB); hand(L.wr);
      muscle(L.sh, L.el, SHAPES.shoulder, heats.shoulder * dim, LIMB, L.flip);
      muscle(L.sh, L.el, SHAPES.arm, heats.arm * dim, LIMB, L.flip);
      muscle(L.el, L.wr, SHAPES.forearm, heats.forearm * dim, FORELIMB, L.flip);
      muscle(L.hip, L.kn, SHAPES.thigh, heats.thigh * dim, LEG, L.flip);
      muscle(L.hip, L.kn, SHAPES.ham, heats.ham * dim, LEG, L.flip);
      muscle(L.kn, L.an, SHAPES.calf, heats.calf * dim, SHIN, L.flip);
    });

    ctx.beginPath(); ctx.arc(J.head.x, J.head.y, scale * 0.23, 0, 7);
    ctx.fillStyle = P.skin; ctx.fill(); ctx.strokeStyle = P.skinline; ctx.lineWidth = 1.3; ctx.stroke();
  }

  /* ---- moves defined by a spec (Studio) register their own keyframes here ----
     fig = { view: 'front'|'side', A, B, hold, side, flip, w: {region: weight}, wall } */
  var REGISTERED = {};
  function register(id, fig) { if (id && fig && fig.A) REGISTERED[id] = fig; }
  (root.__pendingFigures || []).forEach(function (e) { register(e[0], e[1]); }); root.__pendingFigures = [];

  /* ---- mounting ---- */
  var running = [];
  function stopAll() {
    running.forEach(function (r) { cancelAnimationFrame(r.raf); if (r.io) r.io.disconnect(); if (r.onResize) window.removeEventListener('resize', r.onResize); });
    running = [];
  }
  function mount(canvas) {
    var id = canvas.getAttribute('data-anat'); if (!id) return;
    var reg = REGISTERED[id];
    var cfg = reg ? { hold: !!reg.hold, side: reg.side || 'both', flip: !!reg.flip, belly: reg.belly, w: reg.w || {} } : (WORK[id] || { hold: false, side: 'both', w: {} });
    var view = reg ? reg.view : (FRONTP[id] ? 'front' : 'side'), data = reg || FRONTP[id] || SIDE[id];
    if (!data || !data.A) return;
    var A = unify(data.A, view), B = data.B ? unify(data.B, view) : null;
    var wall = data.wall || null, props = data.props || [], ctx = canvas.getContext('2d');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var rec = { raf: 0, io: null, visible: true, t: reduce ? 1.4 : 0, last: null };

    function palette() {
      return {
        skin: cssVar(canvas, '--fig-skin', '#f6e3c8'), skinline: cssVar(canvas, '--fig-line', '#c9a878'),
        muscle: cssVar(canvas, '--fig-muscle', '#e7cda9'), far: cssVar(canvas, '--fig-far', '#efe0c8'),
        farline: cssVar(canvas, '--fig-farline', '#dcc6a4'),
        warm: cssVar(canvas, '--tangerine', '#ffb830'), hot: cssVar(canvas, '--pink', '#ff2e88'),
        floor: cssVar(canvas, '--line', '#e9d6bf'), prop: cssVar(canvas, '--surface-2', '#fbe9d2')
      };
    }
    function size() {
      var dpr = Math.min(2, window.devicePixelRatio || 1), r = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, Math.round(r.width * dpr)); canvas.height = Math.max(2, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: r.width, h: r.height };
    }
    var dims = size();
    /* The view fits the figure's two keyframes plus any equipment; the floor line stays in it. */
    var fitBox = (function () {
      var xs = [216, 400], ys = [26, 168];
      [A, B].forEach(function (K) { if (!K) return; Object.keys(K).forEach(function (k) { if (K[k] && typeof K[k].x === 'number') { xs.push(K[k].x); ys.push(K[k].y); } }); });
      props.forEach(function (p) { if (p.kind === 'box') { xs.push(p.x, p.x + p.w); ys.push(p.y); } else if (p.kind === 'bar') { xs.push(p.x1, p.x2); ys.push(p.y); } else if (p.kind === 'disc') { ys.push(p.y - p.r); } });
      var x0 = Math.min.apply(null, xs) - 10, x1 = Math.max.apply(null, xs) + 10, y0 = Math.min.apply(null, ys) - 16;
      return { x: x0, y: y0, w: x1 - x0, h: 168 - y0 };
    })();

    function frame(now) {
      rec.raf = requestAnimationFrame(frame);
      if (!rec.visible) { rec.last = now; return; }
      if (rec.last !== null && !reduce) rec.t += Math.min(0.05, (now - rec.last) / 1000);
      rec.last = now;
      var CYCLE = cfg.hold ? 5.4 : 6.6, u = rec.t % CYCLE, p;
      if (cfg.hold) p = 0.5 - 0.5 * Math.cos(2 * Math.PI * u / CYCLE);
      else if (u < 2) p = 1 - Math.pow(1 - u / 2, 3);
      else if (u < 3) p = 1;
      else if (u < 6) { var k = (u - 3) / 3; p = 1 - (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); }
      else p = 0;

      var pose = tween(A, B, p, view);
      var drive = cfg.hold ? 0.72 + 0.28 * p : Math.pow(p, 0.75);
      var heats = {};
      REGIONS.forEach(function (k) { heats[k] = REST + (cfg.w[k] || 0) * drive * 0.93; });

      var P = palette(), w = dims.w, h = dims.h;
      ctx.clearRect(0, 0, w, h);
      var box = fitBox;
      var s = Math.min(w / box.w, h / box.h) * 0.94;
      ctx.save();
      ctx.translate(w / 2 - (box.x + box.w / 2) * s, h / 2 - (box.y + box.h / 2) * s);
      ctx.scale(s, s);
      ctx.strokeStyle = P.floor; ctx.lineWidth = 2 / s; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(216, 164); ctx.lineTo(400, 164); ctx.stroke();
      if (wall) { ctx.lineWidth = 3 / s; ctx.beginPath(); ctx.moveTo(wall, 34); ctx.lineTo(wall, 164); ctx.stroke(); }
      drawProps(ctx, props, P, s);
      drawFigure(ctx, pose, P, heats, view, cfg);
      ctx.restore();
    }
    rec.raf = requestAnimationFrame(frame);
    if ('IntersectionObserver' in window) {
      rec.io = new IntersectionObserver(function (es) { rec.visible = es[0].isIntersecting; });
      rec.io.observe(canvas);
    }
    rec.onResize = function () { dims = size(); };
    window.addEventListener('resize', rec.onResize);
    running.push(rec);
  }

  /* Equipment behind the figure: a box/bench/step to the floor, a bar, a roller, a band to the wall. */
  function drawProps(ctx, props, P, s) {
    props.forEach(function (p) {
      ctx.strokeStyle = P.floor; ctx.fillStyle = P.prop; ctx.lineWidth = 2.5 / s; ctx.lineCap = 'round';
      if (p.kind === 'box') { ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.fill(); ctx.stroke(); }
      else if (p.kind === 'bar') { ctx.lineWidth = 4 / s; ctx.beginPath(); ctx.moveTo(p.x1, p.y); ctx.lineTo(p.x2, p.y); ctx.stroke(); }
      else if (p.kind === 'disc') { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); ctx.stroke(); }
      else if (p.kind === 'band') { ctx.strokeStyle = P.hot; ctx.lineWidth = 2 / s; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke(); ctx.setLineDash([]); }
    });
  }
  function demo(ex) {
    var id = typeof ex === 'string' ? ex : ex.id;
    var name = typeof ex === 'string' ? id : ex.name;
    return '<canvas class="demo-fig" data-anat="' + id + '" role="img" aria-label="' + name + ', animated"></canvas>';
  }
  function mountAll(rootEl) {
    stopAll();
    Array.prototype.forEach.call((rootEl || document).querySelectorAll('canvas[data-anat]'), mount);
  }
  root.OnTrackAnatomy = { demo: demo, mountAll: mountAll, stopAll: stopAll, work: WORK, register: register, figure: function (id) { return REGISTERED[id] || null; }, regions: REGIONS, tween: tween, unify: unify, drawFigure: drawFigure };
})(typeof window !== 'undefined' ? window : globalThis);
