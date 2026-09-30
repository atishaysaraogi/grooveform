/* ---------------------------------------------------------------------------
   The move, drawn: a stick figure that goes from the start of the exercise to
   its end and back, so the person sees the shape before the camera does.

   Brought over from the OnTrack build (archive/ontrack). A move gives its two
   keyframes as joint ANGLES — far easier to write by hand than pixel points, and
   unable to produce a limb of the wrong length — and this turns them into points
   in a 400×175 drawing space, plants the foot that stays on the floor so it does
   not slide between the keyframes, and writes the SVG with the animation on it.
   A move can instead give the points outright (the bridge's came from a recorded
   take), and those are drawn as they are.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Figure = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const D = Math.PI / 180;
  const L = { torso: 44, head: 22, thigh: 30, shin: 30, foot: 14, uarm: 26, farm: 24 };

  /* ---- side view, the hip as the root; angles in degrees ----
       torso  from vertical, + = leaning the way the body faces
       thigh, shin  from straight down, + = forward (knee / ankle the way the body faces)
       foot   from horizontal-forward, + = toes lifted
       uarm, farm  from straight down, + = forward
       *F  the far limb (defaults to the near one, set a few pixels back so it shows behind)
       face  'right' (default) or 'left' — which way the body faces on screen */
  function sidePose(a) {
    const dir = a.face === 'left' ? -1 : 1;
    const g = (k, d) => (a[k] === undefined ? d : a[k]);
    const t = g('torso', 0), th = g('thigh', 0), sh = g('shin', 0), ft = g('foot', 0), ua = g('uarm', 0), fa = g('farm', 0);
    const thF = g('thighF', th), shF = g('shinF', sh), ftF = g('footF', ft), uaF = g('uarmF', ua), faF = g('farmF', fa);
    const hip = { x: 0, y: 0 };
    const at = (p, ang, len, fromDown) => fromDown
      ? { x: p.x + Math.sin(ang * D) * dir * len, y: p.y + Math.cos(ang * D) * len }
      : { x: p.x + Math.sin(ang * D) * dir * len, y: p.y - Math.cos(ang * D) * len };
    const shoulder = at(hip, t, L.torso, false);
    const head = at(shoulder, t + g('neck', 0), L.head, false);
    const kn = at(hip, th, L.thigh, true), an = at(kn, sh, L.shin, true);
    const foot = { x: an.x + Math.cos(ft * D) * dir * L.foot, y: an.y - Math.sin(ft * D) * L.foot };
    const el = at(shoulder, ua, L.uarm, true), wr = at(el, fa, L.farm, true);
    const back = { x: -4 * dir, y: 3 };
    const knF = at(hip, thF, L.thigh, true), anF = at(knF, shF, L.shin, true);
    const footF = { x: anF.x + Math.cos(ftF * D) * dir * L.foot, y: anF.y - Math.sin(ftF * D) * L.foot };
    const elF = at(shoulder, uaF, L.uarm, true), wrF = at(elF, faF, L.farm, true);
    const sameF = thF === th && shF === sh && uaF === ua && faF === fa;
    const off = (p) => (sameF ? { x: p.x + back.x, y: p.y + back.y } : p);
    return { h: head, sh: shoulder, hip, kn, an, ft: foot, el, wr, knF: off(knF), anF: off(anF), ftF: off(footF), elF: off(elF), wrF: off(wrF), dir, sameF };
  }

  const FLOOR_Y = 161, CENTRE_X = 306;
  const isPt = (p) => p && typeof p.x === 'number';
  const ptKeys = (pose) => Object.keys(pose).filter((k) => isPt(pose[k]));
  const shift = (pose, dx, dy) => { const o = {}; ptKeys(pose).forEach((k) => { o[k] = { x: pose[k].x + dx, y: pose[k].y + dy }; }); return o; };
  const maxY = (pose) => Math.max(...ptKeys(pose).map((k) => pose[k].y));
  /* the joint held still between the keyframes: the first that touches the floor
     in both — the near foot, then the far one, then hands, knees */
  const ANCHOR_ORDER = ['ft', 'an', 'ftF', 'anF', 'kn', 'knF', 'wr', 'wrF', 'h'];
  function plantedKey(A, B) {
    const fa = maxY(A), fb = maxY(B);
    return ANCHOR_ORDER.find((k) => isPt(A[k]) && isPt(B[k]) && A[k].y > fa - 3 && B[k].y > fb - 3) || null;
  }
  /* Both keyframes placed in the drawing with ONE transform, so a limb that does
     not move stays put: B is shifted so its planted joint sits where A's does,
     then the pair is floored and centred together. */
  function placePair(A, B, pose) {
    const anchor = pose.anchor === undefined ? plantedKey(A, B) : pose.anchor;
    let Bs = shift(B, 0, 0);
    if (anchor && isPt(A[anchor]) && isPt(B[anchor])) Bs = shift(Bs, A[anchor].x - B[anchor].x, A[anchor].y - B[anchor].y);
    const all = [...ptKeys(A).map((k) => A[k]), ...ptKeys(Bs).map((k) => Bs[k])];
    const my = Math.max(...all.map((p) => p.y)), xs = all.map((p) => p.x), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const fix = (p) => { const o = {}; ptKeys(p).forEach((k) => { o[k] = [Math.round(CENTRE_X + p[k].x - cx), Math.round(FLOOR_Y - (my - p[k].y))]; }); return o; };
    return { A: fix(A), B: fix(Bs), anchor };
  }

  /* pose: { A: angles, B: angles, wall: 'behind'|'ahead'|null, hold } → the keyframes as points */
  function fromAngles(pose) {
    const rawA = sidePose(pose.A || {}), rawB = sidePose(pose.B || pose.A || {});
    const { A, B, anchor } = placePair(rawA, rawB, pose);
    let wall = null;
    if (pose.wall) {
      const xs = [...Object.values(A), ...Object.values(B)].map((p) => p[0]);
      const behindIsLeft = (rawA.dir || 1) > 0;
      wall = (pose.wall === 'behind') === behindIsLeft ? Math.min(...xs) - 6 : Math.max(...xs) + 6;
    }
    return { A, B, wall, anchor, hold: !!pose.hold };
  }
  /* what a move gives: angles, or points outright */
  function figureOf(move) {
    if (!move) return null;
    if (move.figure && move.figure.A) return Object.assign({ hold: !!move.figure.hold, wall: move.figure.wall || null }, move.figure);
    if (move.pose && move.pose.A) return fromAngles(Object.assign({ hold: !!move.hold }, move.pose));
    return null;
  }

  /* ---- depth: a point may carry a third number, how far from the camera, + away ----
     The camera's view is x, y. A view from above is x against depth, the camera at the
     bottom of the picture, nearer lower; an isometric view is the camera's, each point
     slid up and to the right by its depth. A point without a depth is at the camera's
     own plane, except a far limb, which sits a little behind. */
  const FAR_KEYS = new Set(['knF', 'anF', 'heF', 'ftF', 'elF', 'wrF']);
  const FAR_Z = 16, TOP_Y = 150, ISO = [0.55, -0.32];
  const VIEWS = ['camera', 'top', 'iso'];
  const zOf = (p, k) => (Array.isArray(p) && typeof p[2] === 'number' ? p[2] : FAR_KEYS.has(k) ? FAR_Z : 0);
  function project(p, k, view) {
    if (!Array.isArray(p)) return p;
    if (view === 'top') return [p[0], TOP_Y - zOf(p, k)];
    if (view === 'iso') { const z = zOf(p, k); return [p[0] + ISO[0] * z, p[1] + ISO[1] * z]; }
    return [p[0], p[1]];
  }
  const projectAll = (K, view) => { const o = {}; for (const k of Object.keys(K || {})) if (Array.isArray(K[k])) o[k] = project(K[k], k, view); return o; };

  /* ---- the drawing ---- */
  const P = (...pts) => 'M' + pts.map((p) => p.join(' ')).join(' L ');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const profilePath = (j) => P(j.sh, j.hip, j.kn, j.an, j.ft) + ' ' + P(j.sh, j.el, j.wr);
  const farPath = (j) => (j.knF ? P(j.hip, j.knF, j.anF, j.ftF) : '') + (j.elF ? ' ' + P(j.sh, j.elF, j.wrF) : '');
  const still = (r) => r.hold || !r.B || JSON.stringify(r.A) === JSON.stringify(r.B);
  const EASE = 'calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" keyTimes="0;0.5;1"';
  function animPath(a, b, cls) {
    if (!b || a === b) return `<path class="${cls}" d="${a}"/>`;
    return `<path class="${cls}" d="${a}"><animate attributeName="d" values="${a};${b};${a}" dur="3.2s" repeatCount="indefinite" ${EASE}/></path>`;
  }
  function animHead(a, b) {
    const an = (attr, v0, v1) => (b && v0 !== v1) ? `<animate attributeName="${attr}" values="${v0};${v1};${v0}" dur="3.2s" repeatCount="indefinite" ${EASE}/>` : '';
    return `<circle class="ink" cx="${a[0]}" cy="${a[1]}" r="10">${an('cx', a[0], b && b[0])}${an('cy', a[1], b && b[1])}</circle>`;
  }
  /* the drawing's extent: both keyframes, the wall, the floor always in view — in the
     camera's view and the isometric one; from above, the points and the camera below them */
  function box(r, view) {
    const v = view || 'camera';
    const pts = [...Object.values(projectAll(r.A, v)), ...Object.values(projectAll(r.B || {}, v))];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (v === 'top') { const y0 = Math.min(...ys) - 20, y1 = Math.max(TOP_Y + 8, Math.max(...ys)) + 30; const x0 = Math.min(210, Math.min(...xs) - 14), x1 = Math.max(400, Math.max(...xs) + 14); return { x0, y0, w: x1 - x0, h: y1 - y0 }; }
    if (r.wall != null) xs.push(r.wall);
    if (v === 'iso') { xs.push(400 + ISO[0] * 60); ys.push(161 + ISO[1] * 60); }
    const x0 = Math.min(210, Math.min(...xs) - 14), x1 = Math.max(400, Math.max(...xs) + 14), y0 = Math.min(...ys) - 20;
    return { x0, y0, w: x1 - x0, h: 168 - y0 };
  }
  /* the ground of each view: the floor line, the camera's mark, or the floor as a slab */
  function ground(r, v, b) {
    if (v === 'top') { const cx = (b.x0 + b.w / 2); return `<line class="floor" x1="${b.x0}" y1="${TOP_Y}" x2="${b.x0 + b.w}" y2="${TOP_Y}" stroke-dasharray="6 5"/><path class="cam" d="M${cx - 9} ${TOP_Y + 26} h18 l-5 -9 h-8 z"/>`; }
    if (v === 'iso') { const [dx, dy] = [ISO[0] * 60, ISO[1] * 60], nx = ISO[0] * -12, ny = ISO[1] * -12; return `<path class="floor" d="M${210 + nx} ${161 + ny} L ${400 + nx} ${161 + ny} L ${400 + dx} ${161 + dy} L ${210 + dx} ${161 + dy} Z"/>` + (r.wall != null ? `<line class="floor" x1="${r.wall}" y1="30" x2="${r.wall}" y2="162" stroke-width="4"/>` : ''); }
    return `<line class="floor" x1="${b.x0}" y1="162" x2="${b.x0 + b.w}" y2="162"/>` + (r.wall != null ? `<line class="floor" x1="${r.wall}" y1="30" x2="${r.wall}" y2="162" stroke-width="4"/>` : '');
  }
  const FRONT_CHAINS = [['shL', 'hipL', 'knL', 'anL'], ['shR', 'hipR', 'knR', 'anR'], ['shL', 'shR'], ['hipL', 'hipR'], ['shL', 'elL', 'wrL'], ['shR', 'elR', 'wrR']];
  const frontPath = (K) => FRONT_CHAINS.filter((c) => c.every((k) => K[k])).map((c) => P(...c.map((k) => K[k]))).join(' ');
  /* the figure as an SVG: from the camera (the default), from above, or isometric;
     opts.still draws the start alone, for a list */
  function svg(move, label, view, opts) {
    const r = figureOf(move);
    if (!r) return '';
    const v = VIEWS.includes(view) ? view : 'camera', o = opts || {};
    const A = projectAll(r.A, v), B = o.still || still(r) ? null : projectAll(r.B, v), b = box(r, v);
    const words = label != null ? label : (still(r) ? 'hold still' : 'repeat slowly');
    const open = `<svg class="demo-fig stick view-${v}${b.h < 100 ? ' lying' : ''}" viewBox="${b.x0} ${b.y0} ${b.w} ${b.h}" role="img" aria-label="${esc(move.name)}: ${esc(words)}">` + ground(r, v, b);
    /* a figure seen from the front (a body lying on its side, facing the camera): its chains, plainly */
    if (r.view === 'front' && r.A.hipL) {
      return open + animPath(frontPath(A), B && frontPath(B), 'ink') + animHead(A.h, B && B.h) +
        `<text x="${b.x0 + 10}" y="${b.y0 + 12}" text-anchor="start" class="lbl">${esc(words)}</text></svg>`;
    }
    let body = '';
    if (A.knF || A.elF) body += animPath(farPath(A), B && farPath(B), 'ink far');
    body += animPath(profilePath(A), B && profilePath(B), 'ink') + animHead(A.h, B && B.h);
    return open + body +
      /* the caption goes in the top corner away from the head */
      (A.h[0] > b.x0 + b.w / 2
        ? `<text x="${b.x0 + 10}" y="${b.y0 + 12}" text-anchor="start" class="lbl">${esc(words)}</text>`
        : `<text x="${b.x0 + b.w - 10}" y="${b.y0 + 12}" text-anchor="end" class="lbl">${esc(words)}</text>`) + '</svg>';
  }

  return { L, sidePose, fromAngles, figureOf, plantedKey, box, svg, project, projectAll, zOf, VIEWS, FAR_Z, TOP_Y, ISO };
});
