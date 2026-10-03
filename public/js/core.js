/* ---------------------------------------------------------------------------
   The parts that are true of any held position: reading landmarks into points,
   the geometry the measurements are built from, and the clock and the cue rules
   that turn a stream of verdicts into at most one thing said at a time.

   Nothing in here knows what a wall sit or a plank is. A move supplies its own
   read(), judge(), cue words and the order it wants faults corrected in; this
   file supplies everything that would otherwise be written twice.

   It is all pure: landmarks and a clock in, readings and a cue out. No DOM, no
   camera, no timers of its own. That is what makes it testable in node against
   bodies built to read a known angle, which is the only way to know a threshold
   does what it says.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* BlazePose landmark indices, per side. */
  const SIDE = {
    L: { ear: 7, shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
    R: { ear: 8, shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
  };

  /* Settings every move shares. A move's own defaults are laid over these. */
  const COMMON = {
    vis: 0.5,             // a landmark below this is not trusted
    edge: 0.03,           // a needed landmark nearer the picture's edge than this share of it, or past it, is not trusted: the model keeps guessing at a foot that has left the frame
    drop: 0.25,           // near the edge, a needed landmark whose certainty has fallen this far below its best of the last ten frames is not trusted either
    jump: 1.5,            // a landmark that moves faster than this many body-diagonals a second has snapped to the background: held where it was
    jumpHold: 2,          // for at most this many frames, after which the new place is believed
    smooth: 0.35,         // EMA on the angles; 1 = no smoothing
    persistMs: 500,       // how long a fault holds before it is worth saying
    cooldownMs: 4000,     // how long before the same cue may be said again
    gapMs: 1500,          // the least silence between any two cues
    settleMs: 700,        // how long in position before the hold clock starts
    returnMs: 400,        // how long back at the start before a rep is over: a frame or two of the model swapping the legs is not a return
    holdTargetSec: 60,    // the set: this many seconds in position
    restSec: 2,           // reps: the quiet after one is counted before the next is asked for
    readyMs: 3000,        // how long the start position is held, still, before the coaching begins: the picture is checked meanwhile
    lostEverySec: 15,     // how often "I can't see you" is said while nobody is in the frame
    setCount: 3,          // how many sets make the session
    callAtSec: [45, 30, 10, 5],   // seconds left at which the time is called
    deepAt: 18,           // degrees past the band at which the stronger words are used
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* Said about the picture, not the exercise: never one of the person's faults. */
  const SYSTEM = ['lost', 'edge', 'framing', 'dark', 'backlit', 'blend', 'notready', 'room'];
  const PART = { ear: 'head', shoulder: 'shoulder', elbow: 'elbow', wrist: 'hand', hip: 'hip', knee: 'knee', ankle: 'foot', heel: 'foot', toe: 'foot' };
  const partWords = (side, joint) => `${side === 'L' ? 'left ' : side === 'R' ? 'right ' : ''}${PART[joint] || joint}`;
  const fillPart = (text, side, joint) => String(text || '').replace(/\{joint\}/g, partWords(side, joint));
  /* every way a {joint} text can come out, for the voice pack */
  const PARTS = [...new Set(Object.values(PART))];
  const partTexts = (text) => (/\{joint\}/.test(text) ? [].concat(...['L', 'R'].map((sd) => PARTS.map((w) => String(text).replace(/\{joint\}/g, `${sd === 'L' ? 'left' : 'right'} ${w}`)))) : [text]);
  const DEG = 180 / Math.PI;

  /* Is a reading inside its band? A body posed to exactly the edge comes back a
     ten-thousandth of a degree under it, so a bare comparison rejects the very
     number the setting says is allowed. "Five degrees either way" has to include
     five degrees, so the comparison is given room for the arithmetic and none for
     anything else. */
  const EDGE = 1e-9;
  const inBand = (x, lo, hi) => x >= lo - EDGE && x <= hi + EDGE;
  const within = (x, lim) => Math.abs(x) <= lim + EDGE;

  /* The angle at b, between a and c, in degrees. Landmark x is a share of the
     frame's WIDTH and y a share of its HEIGHT, so x has to be scaled by the
     aspect before any angle taken from them means anything. */
  function angleAt(a, b, c) {
    const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    if (!m1 || !m2) return null;
    return Math.acos(clamp((v1x * v2x + v1y * v2y) / (m1 * m2), -1, 1)) * DEG;
  }

  /* How far the base→top line leans off straight up, in degrees.
     + = leaning the way `facing` points, − = the other way. */
  function tiltFromVertical(base, top, facing) {
    const dx = top.x - base.x, dy = top.y - base.y;
    if (!dx && !dy) return null;
    return Math.atan2(dx * facing, -dy) * DEG;
  }

  /* The angle a limb makes with the floor, taken from `at` to `to` and measured
     from the horizontal that points the opposite way to `facing`:

        90°   `to` is directly below `at`
       >90°   `to` is the way `facing` points
       <90°   `to` is the other way

     so the side of 90 it falls on is a direction, not just a size. The rise is
     taken as a magnitude, because a foot above a knee is not the position at all
     and reading it as a sign flip would send the correction the wrong way. */
  function fromFloor(at, to, facing) {
    const dx = (to.x - at.x) * facing, dy = Math.abs(to.y - at.y);
    if (!dx && !dy) return null;
    return Math.atan2(dy, -dx) * DEG;
  }

  /* How far b sits off the straight line from a to c, as the angle by which the
     line bends at b. 0 is straight. The sign says which side: + when b is above
     the line, − when it is below, with `facing` pointing from b toward a.

     The size is the bend at b rather than a distance, so it does not change with
     how far away the camera is — which is what lets one threshold in degrees
     mean the same thing on every body and at every range. */
  function lineBend(a, b, c, facing) {
    const straight = angleAt(a, b, c);
    if (straight == null) return null;
    const ux = c.x - a.x, uy = c.y - a.y;
    const cross = (b.x - a.x) * uy - (b.y - a.y) * ux;
    const s = Math.sign(cross * -facing) || 1;
    return s * (180 - straight);
  }

  /* How far b sits above a, as the angle the a→b line makes with the floor:
     + above, − below, 0 level. Signed, unlike fromFloor, because here the side
     matters: a hip above the knee is the fault and a hip below it is not. */
  function rise(a, b) {
    const dx = Math.abs(b.x - a.x), dy = a.y - b.y;
    if (!dx && !dy) return null;
    return Math.atan2(dy, dx) * DEG;
  }

  const visOf = (p) => (p && p.visibility === undefined ? 1 : p ? p.visibility : 0);

  /* Side-on, one limb hides the other and the pose model guesses at the far one.
     The side it is surer of over the joints that matter is the side to measure. */
  function pickSide(lm, joints) {
    const score = (s) => {
      const j = SIDE[s]; let sum = 0;
      for (const k of joints) sum += visOf(lm[j[k]]);
      return sum / joints.length;
    };
    const l = score('L'), r = score('R');
    return { side: r > l ? 'R' : 'L', vis: Math.max(l, r) };
  }

  /* One side's landmarks as points in square space, so that an angle is an angle.
     A move that has to look at both sides before deciding which one to measure
     builds them itself and chooses; everything else goes through `frame`. */
  function sidePoints(lm, aspect, side) {
    const j = SIDE[side], P = {};
    for (const k of Object.keys(j)) { const p = lm[j[k]]; if (!p) return null; P[k] = { x: p.x * aspect, y: p.y, v: visOf(p), d: Math.min(p.x, 1 - p.x, p.y, 1 - p.y) }; }   // d: how far inside the picture, in shares of it; negative outside
    return P;
  }
  /* trusted: seen clearly enough, and not at the picture's edge — the model goes on placing
     a foot that has left the frame, at 60–98% certainty in recorded takes, so certainty alone
     does not say it is gone */
  const trusted = (p, cfg) => !!p && p.v >= cfg.vis && (p.d == null || p.d >= (cfg.edge || 0));
  const seen = (P, needed, cfg) => needed.every((k) => trusted(P[k], cfg));

  /* Landmarks → the side worth measuring, by how clearly it can be seen. Returns
     null when the frame cannot be used at all, and `{ok:false}` when the body is
     there but not clearly enough to judge. */
  function frame(lm, aspect, cfg, joints, needed) {
    if (!lm || lm.length < 33) return null;
    const { side, vis } = pickSide(lm, joints);
    const P = sidePoints(lm, aspect, side);
    if (!P) return null;
    if (!seen(P, needed, cfg)) {
      const k = needed.find((n) => !trusted(P[n], cfg)), atEdge = P[k] && P[k].v >= cfg.vis;
      return Object.assign({ ok: false, side, vis, why: atEdge ? `Your ${partWords(side, k)} is at the edge of the picture` : 'Some of you is out of shot or hidden' }, atEdge ? { edge: { joint: k, side, how: 'edge' } } : {});
    }
    return { ok: true, side, vis, points: P };
  }

  /* The angle a limb makes with straight down: 0 hanging, 90 level, more than that
     above the horizontal. Unsigned, because it is a lift and there is only one way
     to lift. */
  function fromDown(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const m = Math.hypot(dx, dy);
    if (!m) return null;
    return Math.acos(clamp(dy / m, -1, 1)) * DEG;
  }

  /* A phone laid on the floor gives a frame the shape of however it is lying, and
     the shape has to suit the body. A plank is long and low: in a tall frame it
     either loses the feet or shrinks to a line across the middle, and either way
     the angles are read from a handful of pixels. A move says which way round it
     wants the phone; this says whether it has it, and what to do if not. */
  function framing(want, w, h) {
    if (!want || !w || !h) return null;
    const wide = w > h;
    const got = `the camera is giving a ${wide ? 'wide' : 'tall'} ${w}\u00d7${h} picture`;
    if (want === 'wide' && !wide) return `Turn the phone on its side \u2014 this one needs a wide picture, and ${got}`;
    if (want === 'tall' && wide) return `Stand the phone up \u2014 this one needs a tall picture, and ${got}`;
    return null;
  }

  /* Where to put a vw×vh picture inside a W×H canvas so that all of it shows and
     none of it is stretched. Stretching to fill is the one thing that must not
     happen: a squashed body reads squashed angles, and every threshold here is an
     angle. Bars at the sides are honest; a distorted picture is not. */
  function fitRect(vw, vh, W, H) {
    if (!vw || !vh || !W || !H) return { x: 0, y: 0, w: W || 0, h: H || 0 };
    const s = Math.min(W / vw, H / vh);
    const w = vw * s, h = vh * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  /* A quarter turn of the landmarks, for when the browser hands over a frame that
     is stored the other way round from the world it was taken in. Every joint angle
     survives a rotation untouched, but the ones taken against vertical or the floor
     do not — a shin is only plumb with respect to gravity — so the frame has to be
     put upright before any of them is read, not after.

     `quarter` is 1 for a turn clockwise and 3 for one anticlockwise, in the same
     sense the picture is turned. */
  function rotateLandmarks(lm, quarter) {
    const q = ((quarter % 4) + 4) % 4;
    if (!lm || !q) return lm;
    return lm.map((p) => {
      if (!p) return p;
      const x = p.x, y = p.y;
      const n = q === 1 ? { x: 1 - y, y: x } : q === 2 ? { x: 1 - x, y: 1 - y } : { x: y, y: 1 - x };
      return Object.assign({}, p, n);
    });
  }

  /* Said by every move, so they live here rather than in each one. */
  const SHARED_CUES = {
    hold: { text: 'That is it — hold' },
    lost: { text: 'I can\u2019t see you \u2014 step into the camera, side on' },
    edge: { text: 'Your {joint} is at the edge of the picture \u2014 move so all of you is in' },
    framing: { text: 'Your {joint} is close to the edge of the picture \u2014 move back a little, so there is room round you' },
    dark: { text: 'It\u2019s dark here \u2014 turn a light on, or face one' },
    backlit: { text: 'You\u2019re against the light \u2014 turn so the light falls on you' },
    blend: { text: 'You blend into the background \u2014 a plain wall behind you, or a different top, would help' },
    room: { text: 'Your {joint} will go out of the picture as you move \u2014 shuffle away from that edge, or move the phone back' },
    still: { text: 'Hold still in the start position for three seconds while I check the picture' },
    fast: { text: 'slower on the way down' },
  };

  /* ---- the picture's guardrails, before anything is measured ----
     A joint that leaps in one frame has snapped to something in the background, or the
     model has swapped the two legs; it has not moved. It is held where it was for up to
     `jumpHold` frames, after which the new place is believed. The allowance is `jump`
     body-diagonals a second, never under five percent of the diagonal a frame (the
     model's own wobble), so a slow movement is never held and a fast, real one is late
     by two frames at most. The body's diagonal is the box round the trusted points. */
  class JumpGate {
    constructor(cfg) { this.cfg = cfg || {}; this.prev = null; this.t = 0; this.count = []; this.held = []; }
    reset() { this.prev = null; this.count = []; this.held = []; }
    apply(lm, t) {
      const c = this.cfg, jump = c.jump == null ? 1.5 : c.jump, hold = c.jumpHold == null ? 2 : c.jumpHold, vis = c.vis == null ? 0.5 : c.vis;
      this.held = [];
      if (!lm || !lm.length || !(jump > 0)) { this.prev = null; return lm; }
      const dt = this.prev ? t - this.t : 0;
      if (!this.prev || !(dt > 0) || dt > 400) { this.prev = lm.slice(); this.t = t; this.count = []; return lm; }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
      for (const p of lm) { if (!p || visOf(p) < vis) continue; n++; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      if (n < 4) { this.prev = lm.slice(); this.t = t; this.count = []; return lm; }
      const diag = Math.hypot(x1 - x0, y1 - y0) || 1, allow = Math.max(0.05, (jump * dt) / 1000) * diag;
      const out = lm.slice();
      for (let i = 0; i < lm.length; i++) {
        const p = lm[i], q = this.prev[i]; if (!p || !q) continue;
        if (Math.hypot(p.x - q.x, p.y - q.y) > allow && (this.count[i] || 0) < hold) { out[i] = Object.assign({}, q, { visibility: visOf(p) }); this.count[i] = (this.count[i] || 0) + 1; this.held.push(i); }
        else this.count[i] = 0;
      }
      this.prev = out; this.t = t;
      return out;
    }
  }

  /* The light and the background, from a thumbnail of the frame (RGBA, w × h) and the
     landmarks in it: how bright the picture is, how much of it is crushed black or
     blown white, and how the body's box (the trusted points, padded) differs from the
     rest in brightness and in colour. Cheap enough to run every frame; sampled every so
     often during the set-up wait, where the words about it can still be acted on. */
  /* dark: the picture's mean brightness under `dark`, or over half of it crushed black.
     backlit: a window or a lamp behind — a good share of the picture blown white and the
     body dark. A dark top on a light wall is contrast, not backlighting, so brightness
     alone does not say it. blend: the body's box within `blend` of the rest in brightness
     and within `blendColour` in colour. */
  const SCENE = { dark: 0.22, darkShare: 0.5, backlitBody: 0.25, backlitBright: 0.15, blend: 0.07, blendColour: 0.08 };
  function scene(data, w, h, lm, vis) {
    if (!data || !w || !h) return null;
    const bar = vis == null ? 0.5 : vis;
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, n = 0;
    for (const p of lm || []) { if (!p || visOf(p) < bar) continue; n++; if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x; if (p.y < by0) by0 = p.y; if (p.y > by1) by1 = p.y; }
    /* the box round the trusted points, unpadded: the points sit inside the body, so the box is body and not much wall */
    const box = n >= 4 ? [Math.max(0, Math.floor(bx0 * w)), Math.max(0, Math.floor(by0 * h)), Math.min(w, Math.ceil(bx1 * w)), Math.min(h, Math.ceil(by1 * h))] : null;
    let sum = 0, dark = 0, bright = 0, total = 0;
    const inb = { r: 0, g: 0, b: 0, l: 0, n: 0 }, outb = { r: 0, g: 0, b: 0, l: 0, n: 0 };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255, l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += l; total++; if (l < 0.08) dark++; if (l > 0.95) bright++;
      const acc = box && x >= box[0] && x < box[2] && y >= box[1] && y < box[3] ? inb : outb;
      acc.r += r; acc.g += g; acc.b += b; acc.l += l; acc.n++;
    }
    const mean = (a) => (a.n ? { r: a.r / a.n, g: a.g / a.n, b: a.b / a.n, l: a.l / a.n } : null);
    const bi = mean(inb), bo = mean(outb);
    const out = { luma: +(sum / total).toFixed(3), dark: +(dark / total).toFixed(3), bright: +(bright / total).toFixed(3), body: null, bg: null, colour: null };
    if (bi && bo) { out.body = +bi.l.toFixed(3); out.bg = +bo.l.toFixed(3); out.colour = +(Math.hypot(bi.r - bo.r, bi.g - bo.g, bi.b - bo.b) / Math.sqrt(3)).toFixed(3); }
    return out;
  }
  /* what, if anything, the scene calls for: the one thing to say about it */
  function sceneCue(s) {
    if (!s) return null;
    if (s.luma < SCENE.dark || s.dark > SCENE.darkShare) return 'dark';
    if (s.body != null && s.body < SCENE.backlitBody && s.bright > SCENE.backlitBright) return 'backlit';
    if (s.body != null && Math.abs(s.bg - s.body) < SCENE.blend && s.colour != null && s.colour < SCENE.blendColour) return 'blend';
    return null;
  }

  /* Room for the movement. The figure says how far each joint travels from the start
     (A) to the end (B); scaled to the person's size (the torso, figure units to picture
     units) and turned the way they face, that is where each joint will be at the top.
     A joint that would land nearer the picture's edge than the margin, or past it, is
     the one to say — before the set, while there is time to move.
       figA, figB  the figure's points by its keys (sh, hip, kn, an, ft, el, wr, h, *F; or
                   shL/shR… for a front view)
       r           a reading: points (the measured side, square space), other, facing, side
       aspect, edge  the picture's shape and the margin, in shares of the picture */
  const FIG_KEY = { sh: 'shoulder', hip: 'hip', kn: 'knee', an: 'ankle', he: 'heel', ft: 'toe', el: 'elbow', wr: 'wrist', h: 'ear' };
  function roomOf(figA, figB, r, aspect, edge) {
    if (!figA || !figB || !r || !r.ok || !r.points) return null;
    const front = !!figA.hipL;
    const fPt = (K, k) => (Array.isArray(K[k]) ? { x: K[k][0], y: K[k][1] } : null);
    /* the figure's torso against the person's: figure units to picture units */
    const fSh = fPt(figA, front ? 'shR' : 'sh'), fHip = fPt(figA, front ? 'hipR' : 'hip');
    const pSh = r.points.shoulder, pHip = r.points.hip;
    if (!fSh || !fHip || !pSh || !pHip) return null;
    const fT = Math.hypot(fSh.x - fHip.x, fSh.y - fHip.y), pT = Math.hypot(pSh.x - pHip.x, pSh.y - pHip.y);
    if (!fT || !pT) return null;
    const s = pT / fT;
    /* which way the figure faces at A against which way the person faces */
    const fFace = front ? 1 : Math.sign(fSh.x - fHip.x) || 1, pFace = front ? 1 : (r.facing || 1);
    const flip = fFace === pFace ? 1 : -1;
    const m = (edge == null ? 0.03 : edge), x0 = m * aspect, x1 = aspect - m * aspect, y0 = m, y1 = 1 - m;
    let worst = null;
    for (const k of Object.keys(figB)) {
      const a = fPt(figA, k), b = fPt(figB, k); if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y; if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      let name, side, P;
      if (front) { const mm = /^(\w+?)([LR])$/.exec(k); if (!mm) continue; name = FIG_KEY[mm[1]]; side = mm[2]; P = side === r.side ? r.points : r.other; }
      else { const far = /F$/.test(k); name = FIG_KEY[far ? k.slice(0, -1) : k]; side = far ? (r.side === 'L' ? 'R' : 'L') : r.side; P = far ? r.other : r.points; }
      const p = P && name ? P[name] : null; if (!p || p.v != null && p.v < 0.5) continue;
      const x = p.x + dx * s * flip, y = p.y + dy * s;
      const over = Math.max(x0 - x, x - x1, y0 - y, y - y1);
      if (over > 0 && (!worst || over > worst.over)) worst = { joint: name, side, over, x, y };
    }
    return worst;
  }

  /* ---- what to say, and when ----
     A cue is an instruction, and an instruction given for a flicker is noise. So
     one is only offered when its condition has held for `persistMs`, the same one
     is not repeated inside `cooldownMs`, and no two are said inside `gapMs`.
     When several are wrong the move's own order decides, not their sizes. */
  class Coach {
    constructor(move, cfg) {
      this.move = move;
      this.cfg = Object.assign({}, COMMON, move.defaults, cfg);
      this.cues = Object.assign({}, SHARED_CUES, move.cues);
      this.since = {}; this.last = {}; this.said = {};
      this.inSince = 0; this.wasIn = false; this.holdDue = 0;
      this.holdMs = 0; this.bestMs = 0; this.runMs = 0; this.totalMs = 0;
      this.called = {};                 // which time calls have already been made
      this.lastSpoke = 0;               // when anything was last said, whatever it was
      this.reps = 0; this.phase = 'down'; this.repHoldMs = 0; this.downSince = 0;   // only a move with reps uses these
      this.lowerAt = 0;                 // when the lowering began, for a move that wants it slow
      this.countedAt = 0;               // when the last rep was counted, for the quiet after it
      this.ready = false; this.readySince = 0;   // the set-up wait, until the start position is held
      this.quietUntil = 0;              // nothing is said before this: the opening words are being said
      this.lostSince = 0; this.lastLost = 0;     // nobody in the frame: since when, and when it was last said
      this.nearSince = 0; this.lastNear = 0;     // a needed point close to the picture's edge during the set-up wait: since when, and when it was last said
      this.sceneId = null; this.sceneSince = 0; this.saidScene = {};   // the light and the background, as last sampled; each thing about it said once a set
      this.offSince = 0; this.lastNudge = 0;   // seen but not at the start position: since when, and when the file's words about it were last said
      this.roomAt = null; this.roomSince = 0; this.saidRoom = 0;   // a joint the movement would take out of the picture, as last checked
      this.lastT = null; this.log = [];
      this.base = null;                 // readings at the start position, for a move that measures change from it
      if (typeof move.reset === 'function') move.reset();   // the side the move held last session goes with it
    }
    reset() { const { move, cfg } = this; Object.assign(this, new Coach(move)); this.cfg = cfg; }

    /* Nothing is said before `untilMs` on the coach's clock: the opening words
       are being said, and a correction over them is two voices at once. */
    quiet(untilMs) { this.quietUntil = Math.max(this.quietUntil, untilMs); }

    /* One frame. `t` is a millisecond clock the caller owns. Returns the frame's
       verdict and, at most, one cue to speak. */
    step(r, t) {
      const dt = this.lastT == null ? 0 : Math.min(t - this.lastT, 250);
      this.lastT = t; this.totalMs += dt;
      this.relate(r);
      const v = this.move.judge(r, this.cfg);
      const held = this.gate(r, t, v);
      if (held) return held;
      return this.move.reps ? this.stepReps(r, t, v, dt) : this.stepHold(r, t, v, dt);
    }

    /* A reading taken against the start position. Until the set-up wait is over the
       baseline follows the person (so the reading is "no change" — at the start by
       definition, which is what lets the wait end); once the coaching begins it is
       frozen, and from then on the reading is the change from it, or the percent of it:
       a limb turning toward the camera shows shorter, and that shortening is the
       movement. */
    relate(r) {
      const fs = this.move.fromStart; if (!fs || !fs.length || !r || !r.ok) return;
      if (!this.ready || !this.base) { this.base = this.base || {}; for (const { key, how } of fs) if ((how !== 'peak' && how !== 'belowPeak') || this.base[key] == null) this.base[key] = r[key]; }   // before ready the reference is the reading itself: no change, so the start can be held
      for (const { key, how } of fs) {
        const raw = r[key];
        /* peak: against the most it has been in the set, which only climbs — a length that
           foreshortens as the limb turns out of the camera's plane reads under 100 */
        if ((how === 'peak' || how === 'belowPeak') && raw != null && (this.base[key] == null || raw > this.base[key])) this.base[key] = raw;
        const b = this.base[key];
        /* belowPeak: how far under the most it has been. rest: the change from the rest
           position, which the reference follows slowly, and only while the reading is near
           it — a lift leaves it where it was, a rest that settles as the set goes on carries
           it along, and one flat frame does not set a bar the rest then sits under */
        if (how === 'rest' && raw != null && b != null && this.ready && Math.abs(raw - b) < (this.cfg.restNear == null ? 6 : this.cfg.restNear)) this.base[key] = b + (raw - b) * 0.05;
        const bb = this.base[key];
        r[key] = raw == null || bb == null ? null : how === 'ratio' || how === 'peak' ? (bb ? (100 * raw) / bb : null) : raw - bb;
      }
    }

    /* Before the coaching, and whenever nobody is in the frame.

       The set-up wait: the opening words said where to go and how to start; until
       the person has been at the start position for `readyMs`, seen, nothing else
       is said, nothing is judged, and no clock runs — they are getting down onto
       the floor, and a correction shouted at that is noise. A move says what its
       start position is (`ready`); a rep move's is its start by default, a hold's
       is being seen.

       Nobody in the frame: "I can't see you" once the frame has been empty for a
       moment, and again every `lostEverySec` for as long as it stays so — not
       every few seconds like a correction. The clocks stop. A frame with nobody in
       it never counts toward being ready. */
    gate(r, t, v) {
      const cfg = this.cfg, reps = !!this.move.reps;
      const targetMs = cfg.holdTargetSec * 1000;
      const shape = (extra) => Object.assign({ reading: r, verdict: v, holding: false, cue: null, done: false, leftMs: targetMs, targetMs, active: [],
        ready: this.ready, holdMs: this.holdMs, runMs: this.runMs, bestMs: this.bestMs },
        reps ? { phase: this.ready ? this.phase : 'setup', resting: false, reps: this.reps, repTarget: cfg.repCount, done: this.phase === 'done',
          leftMs: Math.max(0, targetMs - this.repHoldMs) } : { done: this.holdMs >= targetMs, leftMs: Math.max(0, targetMs - this.holdMs) }, extra);
      if (!v.ok) {
        if (!this.lostSince) this.lostSince = t;
        this.readySince = 0;
        /* out of sight, the clocks stop and every fault's timer is let go */
        this.inSince = 0; this.runMs = 0; this.holdDue = 0; this.wasIn = false; this.since = {}; this.downSince = 0;
        let cue = null;
        if (t - this.lostSince >= cfg.persistMs && (!this.lastLost || t - this.lastLost >= (cfg.lostEverySec || 15) * 1000)) {
          /* a frame not trusted because a needed point is at the picture's edge is said as
             that, naming the part, rather than as nobody being there */
          const e = r && r.edge;
          cue = e && this.cues.edge ? this.offer('edge', t, fillPart(this.cues.edge.text, e.side, e.joint)) : this.offer('lost', t, this.cues.lost.text);
          if (cue) this.lastLost = t;
        }
        return shape({ cue });
      }
      this.lostSince = 0;
      if (!this.ready) {
        const at = this.move.ready ? !!this.move.ready(r, v, cfg) : reps ? !!v.atStart : true;
        if (at) { if (!this.readySince) this.readySince = t; if (t - this.readySince >= (cfg.readyMs || 0)) this.ready = true; }
        else this.readySince = 0;
        if (!this.ready) {
          /* seen, but not at the start position for a while: a move can say what the start
             needs (ready.nudge), once, then on the slow clock */
          if (at) this.offSince = 0; else if (!this.offSince) this.offSince = t;
          if (this.offSince && this.cues.notready && t - this.offSince >= (cfg.nudgeSec == null ? 6 : cfg.nudgeSec) * 1000 && (!this.lastNudge || t - this.lastNudge >= (cfg.lostEverySec || 15) * 1000)) {
            const cue = this.offer('notready', t, this.cues.notready.text);
            if (cue) { this.lastNudge = t; return shape({ cue }); }
          }
          /* the moment to fix the framing is now, before the set: a needed point close to
             the edge (inside it, still trusted) is said once, naming the part */
          const near = r && r.near && r.near.length ? r.near[0] : null;
          if (near) { if (!this.nearSince) this.nearSince = t; } else this.nearSince = 0;
          let cue = null;
          if (near && this.cues.framing && t - this.nearSince >= cfg.persistMs && (!this.lastNear || t - this.lastNear >= (cfg.lostEverySec || 15) * 1000)) {
            cue = this.offer('framing', t, fillPart(this.cues.framing.text, near.side, near.joint));
            if (cue) this.lastNear = t;
          }
          /* room for the movement: the joint the figure says will leave the picture, said once a set, once it has held */
          const rm = this.roomAt;
          if (rm) { if (!this.roomSince) this.roomSince = t; } else this.roomSince = 0;
          if (!cue && rm && this.cues.room && !this.saidRoom && t - this.roomSince >= cfg.persistMs) {
            cue = this.offer('room', t, fillPart(this.cues.room.text, rm.side, rm.joint));
            if (cue) this.saidRoom = t;
          }
          /* the light and the background: said once a set, once it has held */
          const sc = this.sceneId;
          if (sc) { if (!this.sceneSince) this.sceneSince = t; } else this.sceneSince = 0;
          if (!cue && sc && this.cues[sc] && !this.saidScene[sc] && t - this.sceneSince >= cfg.persistMs) {
            cue = this.offer(sc, t, this.cues[sc].text);
            if (cue) this.saidScene[sc] = t;
          }
          return shape({ cue });
        }
      }
      return null;
    }

    /* A position held once, for as long as the target says. */
    stepHold(r, t, v, dt) {
      const cfg = this.cfg, faults = this.move.faults;

      /* which faults are true this frame, and by how much */
      const on = v.faults;
      for (const id of faults) {
        if (on[id] != null) { if (!this.since[id]) this.since[id] = t; }
        else this.since[id] = 0;
      }

      /* the hold clock: it runs once the position has been right for a moment,
         and it stops the instant it is not */
      let holding = false;
      if (v.inPosition) {
        if (!this.inSince) this.inSince = t;
        if (t - this.inSince >= cfg.settleMs) { holding = true; this.holdMs += dt; this.runMs += dt; this.bestMs = Math.max(this.bestMs, this.runMs); }
      } else { this.inSince = 0; this.runMs = 0; }

      /* The countdown. It is spent from time IN position, not from the wall
         clock: coming out of the position stops it rather than running it down,
         so a minute means a minute of the exercise. */
      const targetMs = cfg.holdTargetSec * 1000;
      const leftMs = Math.max(0, targetMs - this.holdMs);
      const done = this.holdMs >= targetMs;

      /* the time called out, which jumps the queue: it is two words and it is
         only right at the moment it is true */
      let cue = null;
      if (this.holdMs > 0) {
        if (done && !this.called.done) {
          this.called.done = true;
          for (const n of cfg.callAtSec) this.called[n] = true;   // nothing left to count
          cue = this.offer('done', t, `${cfg.holdTargetSec} seconds — done`, true);
        } else if (!done) {
          /* a dropped frame can carry the clock past two marks at once; only the
             nearest is worth saying, and the ones skipped are spent */
          const passed = cfg.callAtSec.filter((n) => !this.called[n] && leftMs <= n * 1000);
          if (passed.length) {
            const n = Math.min(...passed);
            for (const m of passed) this.called[m] = true;
            cue = this.offer('call' + n, t, `${n} seconds left`, true);
          }
        }
      }

      /* Getting into position is worth one word. It happens on a single frame, so
         unlike a fault it cannot simply be re-offered until it lands — if the gap
         swallows that frame the word is gone. So the moment is remembered and
         retried, and given up on if it has not been said within a couple of gaps,
         by which time saying it would be a remark about the past. */
      if (holding && !this.wasIn) this.holdDue = t;
      if (!holding) this.holdDue = 0;
      this.wasIn = holding;
      if (!cue && this.holdDue) {
        if (t - this.holdDue > cfg.gapMs * 2) this.holdDue = 0;
        else { cue = this.offer('hold', t, this.cues.hold.text); if (cue) this.holdDue = 0; }
      }

      if (!cue) cue = this.correct(on, t);
      return { reading: r, verdict: v, holding, cue, done, leftMs, targetMs, ready: true,
        active: this.active(on),
        holdMs: this.holdMs, runMs: this.runMs, bestMs: this.bestMs };
    }

    /* The faults present this frame, in the move's order, whether or not any of
       them gets said: what the picture shows in words while the voice keeps to
       one thing at a time. Prompts and losing sight of the person are not faults. */
    active(on) {
      const prompts = this.move.prompts || [];
      return this.move.faults.filter((id) => on[id] != null && id !== 'lost' && !prompts.includes(id));
    }
    /* Whatever is wrong, the one earliest in the move's order is the one to say. */
    correct(on, t) {
      const cfg = this.cfg;
      for (const id of this.move.faults) {
        if (on[id] != null) { if (!this.since[id]) this.since[id] = t; }
        else this.since[id] = 0;
      }
      /* nobody in the frame is said by the gate, on its own clock, never here */
      const ready = this.move.faults.filter((id) => id !== 'lost' && on[id] != null && this.since[id] && t - this.since[id] >= cfg.persistMs);
      for (const id of ready) {
        const c = this.cues[id];
        const cue = this.offer(id, t, (on[id] > cfg.deepAt && c.deep) || c.text);
        if (cue) return cue;
      }
      return null;
    }

    /* Reps: come to the start, go to the position, hold it for the target, lower,
       and come back to the start. A rep is only counted on that last step — the
       lowering is part of the exercise, and a knee dropped from the top is not the
       same as one put down.

       The clock is the same clock as a held set, only per rep and reset at the top
       of each one, so the time calls, the settle and the one-at-a-time rule are all
       the shared ones rather than a second implementation that could drift. */
    stepReps(r, t, v, dt) {
      const cfg = this.cfg, C = this.cues;
      const targetMs = cfg.holdTargetSec * 1000, total = cfg.repCount;
      const raised = !!(v.ok && v.raised);
      /* the return has to hold for a moment: side on, the model now and then swaps the
         two legs for a frame or two, and one such frame read as the start would end a
         rep in the middle of its hold (a recorded take lost its first rep this way) */
      if (v.ok && v.atStart) { if (!this.downSince) this.downSince = t; } else this.downSince = 0;
      const atStart = !!this.downSince && t - this.downSince >= (cfg.returnMs || 0);

      let holding = false;
      if (v.inPosition && this.phase === 'up') {
        if (!this.inSince) this.inSince = t;
        if (t - this.inSince >= cfg.settleMs) {
          holding = true; this.repHoldMs += dt; this.holdMs += dt; this.runMs += dt;
          this.bestMs = Math.max(this.bestMs, this.runMs);
        }
      } else { this.inSince = 0; this.runMs = 0; }

      let cue = null;
      if (this.phase === 'down' && raised) {
        this.phase = 'up'; this.repHoldMs = 0; this.inSince = 0; this.called = {}; this.peak = null;
      } else if (this.phase === 'up') {
        if (this.repHoldMs >= targetMs) { this.phase = 'lower'; this.lowerAt = t; cue = this.offer('lower', t, C.lower.text, true); }
        else if (atStart) {
          /* back down before the hold was finished: nothing to count, and worth saying
             so, because the alternative is someone quietly doing ten half reps */
          this.phase = 'down'; this.repHoldMs = 0;
          cue = this.offer('early', t, C.early.text, true);
        }
      } else if (this.phase === 'lower' && atStart) {
        this.reps += 1; this.repHoldMs = 0;
        this.phase = this.reps >= total ? 'done' : 'down';
        /* "lower slowly" is judged, not just said: a move that names how long the
           lowering should take is told when it took less. The remark rides on the
           count rather than queueing behind it, so it lands on the rep it is about. */
        const fast = cfg.lowerSec > 0 && this.lowerAt && this.downSince - this.lowerAt < cfg.lowerSec * 1000;   // from the top to the moment the return began
        if (fast) this.fastReps = (this.fastReps || 0) + 1;
        this.countedAt = t;
        const tail = fast ? ` \u2014 ${C.fast.text}` : '';
        cue = this.phase === 'done'
          ? this.offer('done', t, `${total} reps \u2014 done${tail}`, true)
          : this.offer('count' + this.reps, t, String(this.reps) + tail, true);
      }

      const leftMs = Math.max(0, targetMs - this.repHoldMs);
      if (!cue && this.phase === 'up' && this.repHoldMs > 0) {
        const passed = cfg.callAtSec.filter((n) => !this.called[n] && leftMs <= n * 1000);
        if (passed.length) {
          const n = Math.min(...passed);
          for (const m of passed) this.called[m] = true;
          cue = this.offer('call' + n, t, `${n} seconds left`, true);
        }
      }

      if (holding && !this.wasIn) this.holdDue = t;
      if (!holding) this.holdDue = 0;
      this.wasIn = holding;
      if (!cue && this.holdDue) {
        if (t - this.holdDue > cfg.gapMs * 2) this.holdDue = 0;
        else { cue = this.offer('hold', t, C.hold.text); if (cue) this.holdDue = 0; }
      }

      /* only the position being worked on is coached: telling someone standing still
         to straighten a knee they have not lifted yet is noise. A move can name the
         faults that are about the set-up — where the feet are — and those are
         coached at the start too, before the rep is asked for, because they decide
         what the rep can be. */
      /* when each fault is judged (the file's `when`): at the top (while the rep is up —
         the default), through the rep (up and lowering), or at all times (between reps
         too, what `setup` used to say) */
      /* a rep on its way back down without having been held: what is wrong at the top is no
         longer worth saying ("higher" to someone lowering), only what is judged through the
         rep. The rep's own peak is the reference, so it is the same for every measure */
      const pg = v.progress;
      if (this.phase === 'up' && pg && pg.x != null && (this.peak == null || (pg.dir > 0 ? pg.x > this.peak : pg.x < this.peak))) this.peak = pg.x;
      const falling = this.phase === 'up' && pg && pg.x != null && this.peak != null && pg.downAt != null &&
        (pg.dir > 0 ? this.peak - pg.x : pg.x - this.peak) > 0.3 * Math.abs(this.peak - pg.downAt);
      const W = this.move.when || {}, setup = this.move.setup || [];
      const judged = (id) => { const w = W[id] || (setup.includes(id) ? 'always' : 'top'); return w === 'between' ? this.phase === 'down' : this.phase === 'up' ? !(falling && w === 'top') : this.phase === 'lower' ? w !== 'top' : this.phase === 'down' ? w === 'always' : false; };
      let on = {};
      if (this.phase === 'down') on.raise = 99;
      for (const id of Object.keys(v.faults || {})) if (judged(id)) on[id] = v.faults[id];
      /* the breath after a rep: for a moment after one is counted nothing is asked
         for and nothing is corrected, so the count is heard and the person can
         settle before the next is called */
      const resting = this.phase === 'down' && this.countedAt && t - this.countedAt < (cfg.restSec || 0) * 1000;
      if (!cue && !resting) cue = this.correct(on, t);

      return { reading: r, verdict: v, holding, cue, phase: this.phase, ready: true,
        done: this.phase === 'done', leftMs, targetMs, active: this.active(on), resting,
        reps: this.reps, repTarget: total,
        holdMs: this.holdMs, runMs: this.runMs, bestMs: this.bestMs };
    }

    /* A cue is handed over only if its own cooldown has run out AND nothing else
       has just been said. Two instructions a frame apart are worse than one: they
       talk over each other and the second wipes the first off the screen.

       A time call is `urgent` and takes no notice of the gap — "ten seconds left"
       said two seconds late is a lie. It still sets the clock, so the next
       correction waits rather than treading on it. */
    offer(id, t, text, urgent) {
      /* a correction waits for the opening words to finish; a count, a time call
         or the end of a set does not — those are true at one moment only */
      if (!urgent && t < this.quietUntil) return null;
      if (this.last[id] && t - this.last[id] < this.cfg.cooldownMs) return null;
      if (!urgent && this.lastSpoke && t - this.lastSpoke < this.cfg.gapMs) return null;
      this.last[id] = t; this.lastSpoke = t; this.said[id] = (this.said[id] || 0) + 1;
      const cue = { id, text, t };
      this.log.push(cue);
      return cue;
    }

    /* the page hands in the room check now and then: null, or the joint that would leave the picture */
    room(x) { this.roomAt = x || null; }
    /* the page hands in what it sees of the light and the background, now and then */
    scene(s) { const id = sceneCue(s); if (id !== this.sceneId) this.sceneSince = 0; this.sceneId = id; this.sceneLast = s || null; }

    summary() {
      const reps = !!this.move.reps;
      const s = { move: this.move.id, holdSec: +(this.holdMs / 1000).toFixed(1),
        bestSec: +(this.bestMs / 1000).toFixed(1), totalSec: +(this.totalMs / 1000).toFixed(1),
        targetSec: this.cfg.holdTargetSec, reps: this.reps, repTarget: reps ? this.cfg.repCount : 0,
        reachedTarget: reps ? this.reps >= this.cfg.repCount : this.holdMs >= this.cfg.holdTargetSec * 1000,
        cues: {} };
      /* a prompt is not a correction: being asked to start the next rep says nothing
         about how the last one was done */
      const prompts = this.move.prompts || [];
      for (const id of Object.keys(this.said)) if (this.move.faults.includes(id) && !prompts.includes(id)) s.cues[id] = this.said[id];
      s.log = this.log.slice();
      return s;
    }
  }

  /* A little exponential smoothing on the angles. The raw readings wobble a
     degree or two on a body that is not moving, and a threshold sitting inside
     that wobble fires on nothing. */
  class Smoother {
    constructor(alpha) { this.a = alpha == null ? COMMON.smooth : alpha; this.v = {}; this.raw = {}; }
    reset() { this.v = {}; this.raw = {}; }
    /* the median of the last three frames goes into the average, so a single wild frame
       — a knee read at 12° because the ankle jumped for one frame, which used to pull
       the smoothed value down by fifty and end a hold — never reaches the reading; the
       cost is one frame of delay */
    of(key, x) {
      if (x == null || !Number.isFinite(x)) return this.v[key] == null ? null : this.v[key];
      const r = this.raw[key] || (this.raw[key] = []);
      r.push(x); if (r.length > 3) r.shift();
      const m = r.length < 3 ? x : [r[0], r[1], r[2]].sort((p, q) => p - q)[1];
      this.v[key] = this.v[key] == null ? m : this.v[key] + this.a * (m - this.v[key]);
      return this.v[key];
    }
    /* smooth every angle on a reading in place, leaving the points alone. A reading
       the move lists in `nulls` (a gated one) that is null this frame stays null and
       forgets its past, so when it is read again it starts from what is seen then. */
    apply(r) {
      if (!r || !r.ok || !r.angles) return r;
      for (const k of r.angles) {
        if (r[k] == null && r.nulls && r.nulls.includes(k)) { delete this.v[k]; delete this.raw[k]; continue; }
        r[k] = this.of(k, r[k]);
      }
      return r;
    }
  }

  /* the shape of what the app remembers in the browser; the Review page writes
     tuned numbers into the same store, so both have to agree on it */
  /* A plan's adjustments laid over a cfg — what a coach or a physio changes for one
     person: the count, the sets, the hold, any setting by name, the faults to ignore,
     and the range of motion. The range is a percent of the full movement, measured
     from the return line (downAt, where a rep counts) to the top band and the
     under-way line: at 70% the top band and the under-way line sit seven tenths of the
     way out, so a lift seven tenths as far is the top and counts, and the far edge
     comes in with it, so going the full way is now too far. A hold's position is not
     scaled. `ignore` keeps only the ids the move has. The cfg keeps `rom` and `ignore`. */
  function adjust(move, cfg, adj) {
    const c = Object.assign({}, cfg);
    if (!adj) { c.ignore = []; c.rom = 100; return c; }
    if (typeof adj.reps === 'number' && adj.reps > 0) c.repCount = Math.round(adj.reps);
    if (typeof adj.sets === 'number' && adj.sets > 0) c.setCount = Math.round(adj.sets);
    if (typeof adj.hold === 'number' && adj.hold >= 0) c.holdTargetSec = adj.hold;
    for (const [k, v] of Object.entries(adj.settings || {})) if (typeof v === 'number' && Number.isFinite(v)) c[k] = v;
    c.ignore = (adj.ignore || []).filter((id) => move.faults.includes(id) && !(move.prompts || []).includes(id) && id !== 'lost');
    const rom = typeof adj.rom === 'number' && adj.rom > 0 ? adj.rom : 100;
    const p = move.reps && move.spec && move.spec.progress;
    if (p && rom !== 100) {
      const k = rom / 100, d = c[p.downAt], band = move.bands.find((b) => b.key === p.measure);
      const scale = (key) => { if (key && typeof c[key] === 'number' && typeof d === 'number') c[key] = Math.round((d + (c[key] - d) * k) * 10) / 10; };
      scale(p.raiseAt);
      if (band && !band.sym) for (const key of [band.lo, band.hi, band.min, band.max]) scale(key);
    }
    c.rom = rom;
    return c;
  }

  const SETTINGS_V = 7;
  /* Numbers a browser keeps for an exercise carry a stamp of the file they were kept
     under: its version and its defaults. A stamp that no longer matches drops them —
     an edge renamed, a threshold given a new meaning, a file re-cut. The coach's page
     and the Review page write and read the same stamp. */
  const stampOf = (m) => JSON.stringify([m.v == null ? 1 : m.v, m.defaults]);
  /* Stamped onto every script URL so a phone that cached the last version loads this one. Bumped with each release. */
  const VER = '2026-10-03a';

  /* Words laid into lines no wider than `maxWidth`, by `measure` (a string's
     width). A single word wider than the line is broken where it must be, so
     nothing is ever wider than the frame it is drawn in. */
  function wrapWords(text, maxWidth, measure) {
    const lines = []; let cur = '';
    const push = () => { if (cur) lines.push(cur); cur = ''; };
    for (const word of String(text == null ? '' : text).split(/\s+/).filter(Boolean)) {
      const tryLine = cur ? cur + ' ' + word : word;
      if (measure(tryLine) <= maxWidth) { cur = tryLine; continue; }
      push();
      if (measure(word) <= maxWidth) { cur = word; continue; }
      /* too wide on its own: as many characters as fit, then the rest */
      let piece = '';
      for (const ch of word) {
        if (measure(piece + ch) <= maxWidth || !piece) piece += ch;
        else { lines.push(piece); piece = ch; }
      }
      cur = piece;
    }
    push();
    return lines;
  }

  return { VER, SETTINGS_V, stampOf, adjust, SIDE, COMMON, SHARED_CUES, SYSTEM, partWords, fillPart, partTexts, PARTS, trusted, JumpGate, scene, sceneCue, SCENE, roomOf, DEG, clamp, angleAt, tiltFromVertical, fromFloor, wrapWords,
    lineBend, fromDown, rise, inBand, within, visOf, pickSide, sidePoints, frame, framing, fitRect, rotateLandmarks, Coach, Smoother };
});
