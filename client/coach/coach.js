/* ============================================================
   OnTrack Form Coach — app layer: camera, pose model, drawing,
   calibration flow, voice cues, review & history.
   ============================================================ */
(function () {
  'use strict';
  const E = window.FormEngine;
  /* The Studio loads this file for the figures and has none of the coach's screen; a missing
     element resolves to a detached div so the wiring below is harmless there. */
  const detached = {};
  const $ = id => document.getElementById(id) || (detached[id] = detached[id] || document.createElement('canvas'));
  const MP_VER = '0.10.21';
  const MODEL_URLS = {
    lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
    full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'
  };
  const SMOOTH = { low: [2.2, 4], med: [1.0, 3], high: [0.5, 2] };
  const params = new URLSearchParams(location.search);
  const MOCK = params.get('mock') === '1';

  /* ---------- settings (per device) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fyzio.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fyzio.' + k, JSON.stringify(v)); } catch { } }
  };
  const settings = Object.assign({ model: 'lite', smooth: 'med', voice: 'on', voiceName: 'auto', voiceRate: 'normal', figure: 'lines', mirror: 'auto', fps: 'off', video: 'on', head: '', heightIn: 71 }, store.get('settings', {}));
  function saveSettings() { store.set('settings', settings); }
  function setSetting(k, val) { settings[k] = val; saveSettings(); if (k === 'smooth') applySmoothing(); if (k === 'voice') { voice.muted = val === 'off'; if (typeof applyVoiceButton === 'function') applyVoiceButton(); } if (k === 'voiceName') voiceCache = null; }
  function show() { /* screens are managed by the portal */ }
  const current = { ex: null, target: null, opts: {} };
  let onDone = null, onExit = null;

  /* ---------- demo figures: every move registers its two keyframes (built by coach/catalog.js from the
     joint angles in its data entry); nothing is drawn from per-move code here ---------- */
  const P = (...pts) => 'M' + pts.map(p => p.join(' ')).join(' L ');
  const escT = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function profilePath(j) { return P(j.sh, j.hip, j.kn, j.an, j.ft) + ' ' + P(j.sh, j.el, j.wr); }
  function frontPath(j) { return P(j.h, [(j.shL[0] + j.shR[0]) / 2, j.shL[1]]) + ' ' + P(j.shL, j.shR) + ' ' + P(j.shL, j.hipL, j.hipR, j.shR) + ' ' + P(j.hipL, j.knL, j.anL) + ' ' + P(j.hipR, j.knR, j.anR) + ' ' + P(j.shL, j.elL, [j.elL[0] - 12, j.elL[1] + 4]) + ' ' + P(j.shR, j.elR); }
  function frontPath2(j) { return P(j.h, [(j.shL[0] + j.shR[0]) / 2, j.shL[1]]) + ' ' + P(j.shL, j.shR) + ' ' + P(j.shL, j.hipL, j.hipR, j.shR) + ' ' + P(j.hipL, j.knL, j.anL) + ' ' + P(j.hipR, j.knR, j.anR) + ' ' + P(j.shL, j.elL, j.wrL) + ' ' + P(j.shR, j.elR, j.wrR); }
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animPath(a, b, cls = 'ink') {
    if (!b || reduceMotion) return `<path class="${cls}" d="${a}"/>`;
    return `<path class="${cls}" d="${a}"><animate attributeName="d" values="${a};${b};${a}" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" keyTimes="0;0.5;1"/></path>`;
  }
  function animHead(a, b) {
    const an = (attr, v0, v1) => (b && !reduceMotion && v0 !== v1) ? `<animate attributeName="${attr}" values="${v0};${v1};${v0}" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" keyTimes="0;0.5;1"/>` : '';
    return `<circle class="ink" cx="${a[0]}" cy="${a[1]}" r="10">${an('cx', a[0], b && b[0])}${an('cy', a[1], b && b[1])}</circle>`;
  }
  /* Catalogue and Studio moves register their two keyframes (built from joint angles or a
     recorded take); they are drawn with the same animated stick figure as the hand-written ones. */
  const REGISTERED = {};
  function registerFigure(id, fig) { if (!id || !fig || !fig.A) return; REGISTERED[id] = fig; if (muscleFig) try { muscleFig.register(id, fig); } catch (e) { } }
  (window.__pendingFigures || []).forEach((e) => registerFigure(e[0], e[1])); window.__pendingFigures = [];
  const MUSCLE_REGIONS = ['shoulder', 'arm', 'forearm', 'thigh', 'ham', 'calf', 'chest', 'back', 'abs', 'oblique', 'neck', 'glute'];
  const farPath = (j) => (j.knF ? P(j.hip, j.knF, j.anF, j.ftF) : '') + (j.elF ? ' ' + P(j.sh, j.elF, j.wrF) : '');
  const propSvg = (p) => p.kind === 'box' ? `<rect class="prop" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/>`
    : p.kind === 'bar' ? `<line class="floor" x1="${p.x1}" y1="${p.y}" x2="${p.x2}" y2="${p.y}" stroke-width="4"/>`
    : p.kind === 'disc' ? `<circle class="prop" cx="${p.x}" cy="${p.y}" r="${p.r}"/>`
    : p.kind === 'band' ? `<line class="band" x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"/>` : '';
  /* Notes the physio pinned to a joint: { at: 'kn', kf: 'A'|'B'|undefined, text }. A line from the
     joint to a few words — "the knee drifts in here" — so what to look at is on the picture rather
     than only in the prose below it. The label travels with its joint, and a note tied to one
     keyframe fades in as the figure reaches it: "at the top, the back arches" appears at the top. */
  const NOTE_CHAR = 4.3, NOTE_GAP = 12;
  function noteAt(r, n, kf) { const K = kf === 'B' ? (r.B || r.A) : r.A; return K && K[n.at] ? K[n.at] : null; }
  function noteSide(r, n) { const p = noteAt(r, n, 'A'); const hips = r.view === 'front' ? [r.A.hipL, r.A.hipR] : [r.A.hip]; const cx = hips.filter(Boolean).reduce((a, h) => a + h[0], 0) / Math.max(1, hips.filter(Boolean).length); return p && p[0] < cx ? -1 : 1; }
  function noteSvg(r) {
    return (r.notes || []).filter((n) => n && n.text && noteAt(r, n, 'A')).map((n) => {
      const a = noteAt(r, n, 'A'), b = noteAt(r, n, 'B') || a, dir = noteSide(r, n);
      const lx = a[0] + dir * NOTE_GAP, ly = a[1] - 9;
      const move = (!r.B || reduceMotion || (a[0] === b[0] && a[1] === b[1])) ? ''
        : `<animateTransform attributeName="transform" type="translate" values="0 0;${b[0] - a[0]} ${b[1] - a[1]};0 0" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" keyTimes="0;0.5;1"/>`;
      const fade = !n.kf || reduceMotion ? '' : `<animate attributeName="opacity" values="${n.kf === 'A' ? '1;0;1' : '0;1;0'}" dur="3.2s" repeatCount="indefinite" keyTimes="0;0.5;1"/>`;
      return `<g class="note" opacity="${n.kf === 'B' && !reduceMotion ? 0 : 1}">${fade}${move}<line class="note-l" x1="${a[0]}" y1="${a[1]}" x2="${lx}" y2="${ly}"/><circle class="note-d" cx="${a[0]}" cy="${a[1]}" r="2.6"/>
        <text class="note-t" x="${lx + dir * 3}" y="${ly}" text-anchor="${dir < 0 ? 'end' : 'start'}">${escT(n.text)}</text></g>`;
    }).join('');
  }
  /* The drawing's extent: the two keyframes and any equipment, floor always in view. */
  function figureBox(r) {
    const pts = [...Object.values(r.A), ...Object.values(r.B || {})];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    (r.props || []).forEach((p) => { if (p.kind === 'box') { xs.push(p.x, p.x + p.w); ys.push(p.y); } else if (p.kind === 'bar') { xs.push(p.x1, p.x2); ys.push(p.y); } else if (p.kind === 'disc') ys.push(p.y - p.r); });
    /* a note's words stick out past the body, and a clipped note is worse than none */
    (r.notes || []).forEach((n) => { const a = noteAt(r, n, 'A'); if (!a || !n.text) return; const dir = noteSide(r, n), w = NOTE_GAP + 6 + n.text.length * NOTE_CHAR; xs.push(a[0] + dir * w); ys.push(a[1] - 16); });
    if (r.wall) xs.push(r.wall);
    const x0 = Math.min(210, Math.min(...xs) - 14), x1 = Math.max(400, Math.max(...xs) + 14), y0 = Math.min(...ys) - 20;
    return { x0, y0, w: x1 - x0, h: 168 - y0 };
  }
  // What the figure does (animated), shown big — no camera in it.
  function figureFor(ex) {
    const r = REGISTERED[ex.id]; let figure = '';
    if (!r) return figure;
    if (r.wall) figure += `<line class="floor" x1="${r.wall}" y1="30" x2="${r.wall}" y2="160" stroke-width="4"/>`;
    figure += (r.props || []).map(propSvg).join('');
    if (r.view === 'front') figure += animPath(frontPath2(r.A), r.B && frontPath2(r.B)) + animHead(r.A.h, r.B && r.B.h);
    else {
      if (r.A.knF || r.A.elF) figure += animPath(farPath(r.A), r.B && farPath(r.B), 'ink far');
      figure += animPath(profilePath(r.A), r.B && profilePath(r.B)) + animHead(r.A.h, r.B && r.B.h);
    }
    return figure + noteSvg(r);
  }
  /* ---------- the other figure ----------
     Before the stick figure there was an anatomical one: the same two keyframes, drawn as a body
     with muscle laid on the bones, warming up through the movement. It reads better for "what is
     this working" and worse for "what shape am I making", so it was set aside rather than deleted.
     It is still here, loaded only if asked for (settings.figure = 'muscles'), and it keeps its own
     copy of every registered keyframe. */
  const COACH_SRC = (document.currentScript && document.currentScript.src) || 'coach/coach.js';
  let muscleFig = null, muscleLoad = null;
  function loadMuscleFigures() {
    if (muscleFig) return Promise.resolve(muscleFig);
    if (muscleLoad) return muscleLoad;
    muscleLoad = new Promise((res, rej) => {
      const mine = window.OnTrackAnatomy;                       /* the archived file claims the same global */
      const sc = document.createElement('script');
      sc.src = new URL('archive/anatomy.js', COACH_SRC).href;
      sc.onload = () => {
        muscleFig = window.OnTrackAnatomy; window.OnTrackAnatomy = mine;
        for (const id in REGISTERED) { try { muscleFig.register(id, REGISTERED[id]); } catch (e) { } }
        res(muscleFig);
      };
      sc.onerror = () => { muscleLoad = null; rej(new Error('the muscle figure could not be loaded')); };
      document.head.appendChild(sc);
    });
    return muscleLoad;
  }
  const muscleStyle = () => settings.figure === 'muscles';
  /* Called after the page has put a figure on screen: the stick figure is SVG and needs nothing,
     the muscle one is a canvas that has to be found and started. */
  function mountFigures(root) {
    if (!muscleStyle()) { if (muscleFig) try { muscleFig.stopAll(); } catch (e) { } return Promise.resolve(); }
    return loadMuscleFigures().then((a) => a.mountAll(root || document)).catch(() => { });
  }
  function demo(ex) {
    if (typeof ex === 'string') ex = E.EXERCISES.find((x) => x.id === ex) || { id: ex, name: ex, type: (REGISTERED[ex] && REGISTERED[ex].hold) ? 'hold' : 'reps' };
    if (muscleStyle() && REGISTERED[ex.id]) {
      loadMuscleFigures().then(() => mountFigures(document)).catch(() => { });
      return `<canvas class="demo-fig muscle" data-anat="${escT(ex.id)}" role="img" aria-label="${escT(ex.name)}, animated"></canvas>`;
    }
    const r = REGISTERED[ex.id];
    const b = r ? figureBox(r) : { x0: 210, y0: 22, w: 190, h: 145 };
    return `<svg class="demo-fig${b.h < 100 ? ' lying' : ''}" viewBox="${b.x0} ${b.y0} ${b.w} ${b.h}" role="img" aria-label="${escT(ex.name)}: ${ex.type === 'hold' ? 'timed hold' : 'repetitions'}">
      <line class="floor" x1="${b.x0}" y1="162" x2="${b.x0 + b.w}" y2="162"/>${figureFor(ex)}
      <text x="${b.x0 + 10}" y="${b.y0 + 12}" text-anchor="start" class="lbl">${ex.type === 'hold' ? 'hold still' : 'repeat slowly'}</text></svg>`;
  }
  /* Where to put the phone. Two pictures, both of a person — not a top-down map, which read as a
     puzzle. Left: what the phone should see (front-on, side-on, or lying), framed as its screen.
     Right: how high it sits and how far away, marked against a standing body. Driven by the
     move's `camera` field; the ten hand-written moves carry theirs, anything else gets a default. */
  const HEIGHT_Y = { floor: 138, knee: 112, hip: 84, chest: 56, eye: 34 };
  const HEIGHT_WORD = { floor: 'on the floor', knee: 'at knee height', hip: 'at hip height', chest: 'at chest height', eye: 'at eye level' };
  function silhouette(kind, cx, cy, sc) {
    const g = (inner) => `<g transform="translate(${cx} ${cy}) scale(${sc})">${inner}</g>`;
    if (kind === 'front') return g(`<circle class="sil" cx="0" cy="-34" r="8"/><rect class="sil" x="-13" y="-24" width="26" height="30" rx="7"/>
      <line class="sil-l" x1="-13" y1="-20" x2="-22" y2="6" stroke-width="7"/><line class="sil-l" x1="13" y1="-20" x2="22" y2="6" stroke-width="7"/>
      <line class="sil-l" x1="-6" y1="6" x2="-8" y2="38" stroke-width="9"/><line class="sil-l" x1="6" y1="6" x2="8" y2="38" stroke-width="9"/>`);
    if (kind === 'side') return g(`<circle class="sil" cx="2" cy="-34" r="8"/><rect class="sil" x="-7" y="-24" width="14" height="30" rx="6"/>
      <line class="sil-l" x1="0" y1="-18" x2="6" y2="6" stroke-width="7"/><line class="sil-l" x1="0" y1="6" x2="1" y2="38" stroke-width="10"/><line class="sil-l" x1="1" y1="38" x2="9" y2="38" stroke-width="7"/>`);
    /* lying: on the back, feet to the right, seen side-on */
    return g(`<circle class="sil" cx="-36" cy="-3" r="8"/><rect class="sil" x="-28" y="-9" width="30" height="14" rx="6"/>
      <line class="sil-l" x1="-20" y1="-4" x2="6" y2="2" stroke-width="6"/><line class="sil-l" x1="2" y1="-1" x2="40" y2="-1" stroke-width="10"/><line class="sil-l" x1="40" y1="-1" x2="40" y2="-9" stroke-width="7"/>`);
  }
  /* One sentence, matching the figure above it: which way the phone should see you, how high, how far. */
  function cameraDiagram(ex) {
    const c = ex.camera || { height: ex.view === 'front' ? 'chest' : 'hip', distance: '2 m', posture: 'standing' };
    const front = ex.view === 'front';
    const lying = ['lying', 'prone', 'sidelying'].includes(c.posture);
    const seesWord = lying ? 'you lying down, from the side' : front ? 'you from the front' : 'you from the side';
    return `<p class="cam-sentence">The phone should see <strong>${seesWord}</strong>${front ? ' (chest facing it)' : lying ? '' : ' (turn 90° from it)'}, placed <strong>${HEIGHT_WORD[c.height] || escT(c.height)}</strong>, about <strong>${escT(c.distance)}</strong> away.</p>`;
  }
  /* Option D: the phone itself, its screen showing the framing to match — whole body front-on,
     side-on, or lying across a landscape screen — with the height and distance under it. Sits in
     the top-right corner of the move panel. */
  function phoneInset(ex) {
    const c = ex.camera || { height: ex.view === 'front' ? 'chest' : 'hip', distance: '2 m', posture: 'standing' };
    const lying = ['lying', 'prone', 'sidelying'].includes(c.posture), front = ex.view === 'front';
    const cap = `${escT(c.height)} · ${escT(c.distance)}`;
    const way = lying ? 'lying' : front ? 'front-on' : 'side-on';
    const label = lying ? 'lying down, from the side' : front ? 'from the front' : 'from the side';
    if (lying) return `<svg class="phone-inset wide" viewBox="0 0 100 86" role="img" aria-label="Phone on the floor, seeing you ${label}, ${escT(c.distance)} away">
      <rect class="ph" x="2" y="2" width="96" height="52" rx="9"/><rect class="scr" x="8" y="7" width="84" height="42" rx="4"/>
      <g class="ink"><circle cx="24" cy="34" r="4.5"/><path d="M28.5 34h30M58.5 34l9-11M67.5 23l6 11"/></g><line class="floor" x1="12" y1="41" x2="88" y2="41"/>
      <text class="lbl way" x="50" y="68" text-anchor="middle">${way}</text><text class="lbl" x="50" y="81" text-anchor="middle">${cap}</text></svg>`;
    const body = front ? `<circle cx="30" cy="22" r="5"/><path d="M30 27v22M20 34l10-4 10 4M30 49l-7 24M30 49l7 24"/>` : `<circle cx="30" cy="22" r="5"/><path d="M30 27v22M30 35l6 10M30 49l-3 24M30 49l5 24"/>`;
    return `<svg class="phone-inset" viewBox="0 0 90 130" role="img" aria-label="Phone at ${escT(c.height)} height, seeing you ${label}, ${escT(c.distance)} away">
      <g transform="translate(15 0)"><rect class="ph" x="2" y="2" width="56" height="96" rx="9"/><rect class="scr" x="7" y="8" width="46" height="84" rx="4"/>
      <g class="ink">${body}</g><line class="floor" x1="12" y1="78" x2="48" y2="78"/></g>
      <text class="lbl way" x="45" y="112" text-anchor="middle">${way}</text><text class="lbl" x="45" y="125" text-anchor="middle">${cap}</text></svg>`;
  }
  function cameraDiagramPicture(ex) {
    const c = ex.camera || { height: ex.view === 'front' ? 'chest' : 'hip', distance: '2 m', posture: 'standing' };
    const front = ex.view === 'front';
    const lying = ['lying', 'prone', 'sidelying'].includes(c.posture);
    const sees = lying ? 'lying' : front ? 'front' : 'side';
    const seesWord = lying ? 'you lying down, side-on' : front ? 'your whole front' : 'your side';
    const hy = HEIGHT_Y[c.height] || HEIGHT_Y.hip;
    return `<div class="cam-diagram-wrap">
      <svg class="cam-diagram two" viewBox="0 0 400 152" role="img" aria-label="Phone ${HEIGHT_WORD[c.height] || c.height}, ${escT(c.distance)} away, seeing ${seesWord}">
        <rect class="phone" x="22" y="8" width="122" height="132" rx="12"/><rect class="screen" x="30" y="16" width="106" height="116" rx="6"/>
        ${silhouette(sees, 83, lying ? 98 : 78, lying ? 1.1 : 1.1)}
        <line class="floor" x1="34" y1="${lying ? 110 : 120}" x2="132" y2="${lying ? 110 : 120}"/>
        <text x="83" y="150" text-anchor="middle" class="lbl">what the phone should see</text>
        <line class="floor" x1="190" y1="140" x2="392" y2="140"/>
        ${silhouette('side', 352, 100, 1.35)}
        ${['eye', 'chest', 'hip', 'knee', 'floor'].map((h) => `<line class="tick${h === c.height ? ' on' : ''}" x1="300" y1="${HEIGHT_Y[h]}" x2="318" y2="${HEIGHT_Y[h]}"/>`).join('')}
        <rect class="cam" x="212" y="${hy - 12}" width="12" height="24" rx="3"/><rect class="lens" x="223" y="${hy - 4}" width="3" height="8" rx="1"/>
        <line class="dim" x1="230" y1="${hy}" x2="326" y2="${hy}"/>
        <text x="278" y="${hy - 6}" text-anchor="middle" class="lbl strong">${escT(c.distance)}</text>
        <text x="218" y="${Math.min(hy + 28, 150)}" text-anchor="middle" class="lbl">${c.height}</text>
      </svg>
      <p class="cam-sentence">Phone <strong>${HEIGHT_WORD[c.height] || c.height}</strong>, about <strong>${escT(c.distance)}</strong> away. It should see <strong>${seesWord}</strong>${front ? ' — chest facing it' : lying ? '' : ' — turn 90° from it'}.</p>
    </div>`;
  }
  // Small static figure for tiles (start pose only, no animation, no camera).
  function thumb(ex) {
    if (!ex) return '';
    let fig = '', box = '215 24 180 142';
    /* every move registers its keyframes with the figure renderer; draw the end pose from those */
    const r = REGISTERED[ex.id];
    if (r) { const j = r.B || r.A; const props = (r.props || []).map((p) => p.kind === 'box' ? `<rect class="prop" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/>` : p.kind === 'bar' ? `<line class="floor" x1="${p.x1}" y1="${p.y}" x2="${p.x2}" y2="${p.y}" stroke-width="4"/>` : '').join('');
      fig = (r.wall ? `<line class="floor" x1="${r.wall}" y1="30" x2="${r.wall}" y2="160" stroke-width="4"/>` : '') + props + `<path class="ink" d="${r.view === 'front' ? frontPath2(j) : profilePath(j)}"/><circle class="ink" cx="${j.h[0]}" cy="${j.h[1]}" r="10"/>`;
      const pts = Object.values(j); const ys = pts.map((p) => p[1]), xs = pts.map((p) => p[0]);
      const top = Math.min(24, Math.min(...ys) - 14), left = Math.min(215, Math.min(...xs) - 12), right = Math.max(395, Math.max(...xs) + 12);
      box = `${left} ${top} ${right - left} ${166 - top}`; }
    return `<svg class="thumb-fig" viewBox="${box}" aria-hidden="true"><line class="floor" x1="215" y1="162" x2="395" y2="162"/>${fig}</svg>`;
  }

  const diagram = cameraDiagram;

  /* ---------- voice & sound ---------- */
  /* ---------- the voice ----------
     Every device ships a different set of voices and the one the browser hands out by default is
     usually the oldest and most robotic of them (eSpeak on Linux, the SAPI5 pair on Windows,
     Android's "English (United Kingdom)" formant voice). Two problems follow: a coach that sounds
     like a 1998 satnav, and a coach that sounds like a different person on every phone.

     So the voice is chosen rather than accepted, in tiers, and the same tiers on every platform:
     a modern neural voice if there is one, then the good classic voices by name, and the known-bad
     families are pushed below everything else and only used if nothing else exists. getVoices() is
     also asynchronous on Chrome and Android — it returns nothing on the first call — so the first
     line of a set would be spoken by the default voice before the list arrived. It is now held
     until the list is in. */
  const VOICE_BAD = /espeak|compact|pico|flite|robot|Microsoft (David|Zira|Mark|Hazel|Susan)\b|eloquence/i;
  const VOICE_GOOD = /\b(Samantha|Karen|Moira|Tessa|Serena|Daniel|Fiona|Alex|Ava|Allison|Susan|Veena|Rishi)\b/i;
  const VOICE_NEURAL = /natural|neural|enhanced|premium|siri|wavenet|journey|studio/i;
  /* how fast each family wants to be read: the neural voices are clear at speed, the classic
     concatenative ones turn to mush above about 0.95 */
  const VOICE_RATE = [[VOICE_NEURAL, 1.02], [/^Google/i, 0.96], [VOICE_GOOD, 0.98]];
  const RATE_ADJ = { slow: -0.12, normal: 0, fast: 0.12 };
  let voiceCache = null, voicesReady = false, voiceWaiters = [];
  function allVoices() { try { return speechSynthesis.getVoices() || []; } catch { return []; } }
  function voiceScore(v) {
    const n = v.name || ''; let sc = 0;
    if (VOICE_NEURAL.test(n)) sc += 100;                     // Edge/Windows "Natural", iOS/macOS Enhanced & Premium, Siri
    else if (/^Google/i.test(n)) sc += 70;                   // Chrome and Android's modern set
    else if (VOICE_GOOD.test(n)) sc += 45;                   // the good classic Apple voices
    if (VOICE_BAD.test(n)) sc -= 500;                        // below everything: used only if it is all there is
    const lang = (v.lang || '').replace('_', '-');
    if (/^en-IN/i.test(lang)) sc += 14; else if (/^en-GB/i.test(lang)) sc += 10; else if (/^en-AU|^en-IE/i.test(lang)) sc += 8; else if (/^en-US/i.test(lang)) sc += 6;
    /* a local voice keeps working on a phone with no signal, which a coach mid-set needs; among
       voices of the same quality that decides it */
    if (v.localService) sc += 5;
    if (v.default) sc += 1;
    return sc;
  }
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const all = allVoices(); if (!all.length) return null;
    if (settings.voiceName && settings.voiceName !== 'auto') { const v = all.find((x) => x.name === settings.voiceName); if (v) return v; }
    if (voiceCache && all.includes(voiceCache)) return voiceCache;
    const en = all.filter((v) => /^en[-_]/i.test(v.lang || ''));
    voiceCache = (en.length ? en : all).slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null;
    return voiceCache;
  }
  /* The rate this voice is clearest at, nudged by the person's own preference. */
  function voiceRate(v) {
    const base = (v && (VOICE_RATE.find(([re]) => re.test(v.name || '')) || [])[1]) || 0.95;
    return Math.max(0.6, Math.min(1.6, base + (RATE_ADJ[settings.voiceRate] || 0)));
  }
  /* getVoices() fills in asynchronously; until it has, nothing is spoken by the default voice. */
  function whenVoices() {
    if (voicesReady || !('speechSynthesis' in window)) return Promise.resolve();
    if (allVoices().length) { voicesReady = true; return Promise.resolve(); }
    return new Promise((res) => { voiceWaiters.push(res); });
  }
  function voicesArrived() {
    voiceCache = null; voicesReady = true;
    const w = voiceWaiters; voiceWaiters = []; w.forEach((f) => f());
  }
  if ('speechSynthesis' in window) {
    try {
      speechSynthesis.onvoiceschanged = voicesArrived;
      if (allVoices().length) voicesReady = true;
      /* Safari never fires the event when the list is already warm, and some Android builds fire it
         once, early, before the engine has registered its own voices — so it is also polled, briefly. */
      let tries = 0;
      const poll = setInterval(() => { if (voicesReady || allVoices().length) { clearInterval(poll); voicesArrived(); } else if (++tries > 20) clearInterval(poll); }, 150);
    } catch { }
  }
  function listVoices() { try { return allVoices().filter((v) => /^en[-_]/i.test(v.lang || '')).map((v) => ({ name: v.name, lang: v.lang, local: !!v.localService, good: voiceScore(v) >= 45 })).sort((a, b) => Number(b.good) - Number(a.good)); } catch { return []; } }
  /* Degrees and arrows are written for the eye; read aloud they become "degree sign" or nothing. */
  function sayable(text) {
    return String(text == null ? '' : text)
      .replace(/(\d)\s*°/g, '$1 degrees').replace(/°/g, ' degrees')
      .replace(/(\d)\s*[×x]\s*(\d)/g, '$1 by $2')
      .replace(/\s*[—–]\s*/g, ', ').replace(/[→←↑↓]/g, ' ')
      .replace(/\s{2,}/g, ' ').trim();
  }
  const voice = {
    ctx: null, muted: settings.voice === 'off', lastCue: 0, speaking: false,
    unlock() { try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); } catch { } if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(''); speechSynthesis.speak(u); } catch { } } },
    beep(freq = 880, dur = 0.08, gain = 0.15) {
      if (!this.ctx) return; try { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = freq; o.type = 'sine'; g.gain.value = gain; o.connect(g); g.connect(this.ctx.destination); const t = this.ctx.currentTime; o.start(t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.stop(t + dur + 0.02); } catch { }
    },
    say(text, { priority = 1, minGap = 1500 } = {}) {
      const now = performance.now();
      if (this.muted || !('speechSynthesis' in window)) return false;
      if (priority < 2 && now - this.lastCue < minGap) return false;
      this.lastCue = now;
      /* Before the voice list has arrived, speaking would use whatever the browser calls default —
         the robotic one. A cue is worth nothing a second late, so a count-in number is dropped
         rather than queued, but the opening line and the summary wait for a real voice. */
      if (!voicesReady) { whenVoices().then(() => { if (priority >= 2 && !this.muted) this.utter(text, priority); }); return true; }
      return this.utter(text, priority);
    },
    utter(text, priority) {
      const said = sayable(text); if (!said) return false;
      try {
        if (priority >= 2 || !speechSynthesis.speaking) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(said);
        const v = pickVoice();
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-IN';
        u.rate = voiceRate(v); u.pitch = 1; u.volume = 1;
        u.onstart = () => { this.speaking = true; this.lastStart = performance.now(); };
        u.onend = u.onerror = () => { this.speaking = false; };
        /* Chrome drops an utterance spoken in the same tick as cancel(); a tick's delay is
           inaudible and is the difference between a coach that talks and one that does not. */
        if (this.needsTick === undefined) this.needsTick = /Chrome|CriOS|Android/i.test(navigator.userAgent) && !/Edg|OPR/i.test(navigator.userAgent);
        if (this.needsTick) setTimeout(() => { try { speechSynthesis.speak(u); } catch { } }, 0);
        else speechSynthesis.speak(u);
        return true;
      } catch { return false; }
    },
    /* Settings plays this so the person hears the voice before a set, not during one. */
    preview(text = 'Nice and slow. Three more to go.') { this.unlock(); voiceCache = null; return whenVoices().then(() => this.utter(text, 2)); },
    stop() { try { speechSynthesis.cancel(); } catch { } }
  };
  function applyVoiceButton() { const b = $('btn-mute'); b.textContent = voice.muted ? '🔇' : '🔊'; b.setAttribute('aria-label', voice.muted ? 'Voice off — tap to turn on' : 'Voice on — tap to turn off'); b.classList.toggle('off', voice.muted); }
  $('btn-mute').onclick = () => { voice.muted = !voice.muted; setSetting('voice', voice.muted ? 'off' : 'on'); if (voice.muted) voice.stop(); else { voice.unlock(); voice.say('Voice on', { priority: 2 }); } applyVoiceButton(); };

  /* ---------- pose model ---------- */
  let landmarker = null, landmarkerModel = null, vision = null;
  async function loadModel(onProgress) {
    if (MOCK) return;
    if (landmarker && landmarkerModel === settings.model) return;
    onProgress('Loading pose engine…', 0.1);
    if (!vision) {
      try { vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`); }
      catch (e) { vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs'); }
    }
    onProgress('Loading pose engine…', 0.35);
    const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`);
    onProgress(`Loading ${settings.model} pose model…`, 0.6);
    const opts = delegate => ({ baseOptions: { modelAssetPath: MODEL_URLS[settings.model], delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5, outputSegmentationMasks: false });
    if (landmarker) { try { landmarker.close(); } catch { } landmarker = null; }
    try { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (e) { onProgress('GPU unavailable, using CPU…', 0.8); landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    landmarkerModel = settings.model; onProgress('Ready', 1);
  }

  /* ---------- camera ---------- */
  const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d'), stage = $('stage');
  let stream = null, facing = store.get('facing', 'user');
  let streamFacing = null;   // which camera the open stream is, so a held stream is only reused when it matches
  async function startCamera() {
    if (MOCK) { video.width = 640; video.height = 360; return; }
    /* The camera is held open through a rest between sets. Reuse that stream rather than
       tearing it down and re-acquiring it, which flashes black and drops a second of video. */
    if (stream && streamFacing === facing && video.srcObject === stream && stream.getVideoTracks().some((t) => t.readyState === 'live')) {
      try { await video.play(); } catch { }
      return;
    }
    stopCamera();
    const tryGet = c => navigator.mediaDevices.getUserMedia({ video: c, audio: false });
    const base = { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    try { stream = await tryGet(base); } catch (e) { stream = await tryGet({ facingMode: facing }); }
    streamFacing = facing; video.srcObject = stream; await video.play();
    await new Promise(r => { if (video.videoWidth) r(); else video.onloadedmetadata = () => r(); });
  }
  function stopCamera() { stopVideoCapture(); streamFacing = null; if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } video.srcObject = null; if (video.src) { try { URL.revokeObjectURL(video.src); } catch { } video.removeAttribute('src'); video.load(); } }
  async function startFile(file) {
    stopCamera();
    video.src = URL.createObjectURL(file); video.loop = false; video.muted = true; video.playbackRate = 1;
    await new Promise((res, rej) => { video.onloadedmetadata = () => res(); video.onerror = () => rej(new Error('Could not decode this video. Try an MP4 (H.264).')); });
    video.onended = () => { if (live && live.state === 'active') finishSet(true); else if (live) { overlay('Video ended before the set started', 'The person was never in the calibration position — check the exercise, view and framing match the video.', { actions: [{ label: 'Back', cls: 'ghost', fn: exitLive }] }); } };
    await video.play();
  }
  $('btn-flip').onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; store.set('facing', facing); try { await startCamera(); applyMirror(); } catch (e) { facing = facing === 'user' ? 'environment' : 'user'; } };
  function applyMirror() { const m = settings.mirror === 'on' || (settings.mirror === 'auto' && facing === 'user' && current.ex && current.ex.view === 'front'); stage.classList.toggle('mirror', m); }
  let wakeLock = null;
  async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { } }

  /* ---------- live session ---------- */
  const smoother = new E.PoseSmoother();

  /* ---------- phone roll from the motion sensor ----------
     A phone propped crooked rolls the whole picture, and every "vertical" reading with it. The
     accelerometer gives gravity in the phone's own frame; projected onto the screen and turned
     by the screen's orientation it says where "down" is in the video, as an angle from straight
     down (the engine's roll convention). Only the roll about the lens axis matters: tilting the
     phone back or forward changes perspective, not which way is down. iOS asks once, on a tap. */
  const levelSensor = {
    roll: null, seen: 0, asked: false,
    request() {
      if (this.asked || typeof DeviceMotionEvent === 'undefined') return; this.asked = true;
      const listen = () => window.addEventListener('devicemotion', (e) => this.onMotion(e), { passive: true });
      try { if (typeof DeviceMotionEvent.requestPermission === 'function') DeviceMotionEvent.requestPermission().then((r) => { if (r === 'granted') listen(); }).catch(() => { }); else listen(); } catch (e) { }
    },
    onMotion(e) {
      const g = e.accelerationIncludingGravity; if (!g || g.x == null || g.y == null) return;
      /* gravity's reaction points up, so "down" on the screen is (-x, -y); the video has y downward */
      let roll = Math.atan2(-g.x, g.y) * 180 / Math.PI;
      const a = (screen.orientation && Number.isFinite(screen.orientation.angle)) ? screen.orientation.angle : (Number(window.orientation) || 0);
      roll -= a; roll = ((roll + 540) % 360) - 180;
      /* 180° means the picture is upside down (phone held the other way up) — not a roll to fix */
      if (Math.abs(roll) > 90) roll = roll > 0 ? roll - 180 : roll + 180;
      this.roll = this.roll == null ? roll : this.roll + 0.2 * (roll - this.roll); this.seen++;
    },
  };
  /* What to correct this set by, decided at calibration and updated a little each frame. */
  function cameraCorrection(ptsRaw) {
    const cam = E.settings.camera || {}, ex = live.ex, posture = (ex.camera || {}).posture;
    const body = cam.level === 'off' || cam.level === 'sensor' ? null : E.Camera.rollFromBody(ptsRaw, posture);
    const sensor = cam.level === 'off' || cam.level === 'body' || live.file || levelSensor.seen < 5 ? null : levelSensor.roll;
    /* the sensor is exact when the screen-to-picture mapping is right; if the body disagrees with it
       by more than a few degrees, that mapping is suspect on this device and the body wins */
    let roll = null, from = null;
    if (sensor != null && Math.abs(sensor) <= (cam.maxRoll || 25) && (body == null || Math.abs(sensor - body) <= 8)) { roll = sensor; from = 'sensor'; }
    else if (body != null && Math.abs(body) <= (cam.maxRoll || 25)) { roll = body; from = 'body'; }
    const levelled = roll ? E.Camera.rotatePts(ptsRaw, roll, E.mid(ptsRaw[23], ptsRaw[24]).x, E.mid(ptsRaw[23], ptsRaw[24]).y) : ptsRaw;
    /* at calibration the person has just passed the view check, so a guessed yaw starts at zero and
       is read as change from here; a measured one (depth present) is taken as it is */
    const yaw = E.Camera.yawOf(levelled, ex.view, cam, E.orientation(levelled).ratio);
    const stretch = yaw && (cam.unforeshorten === 'always' || (cam.unforeshorten !== 'off' && yaw.measured)) ? 1 / Math.max(0.5, Math.cos(yaw.deg * Math.PI / 180)) : 1;
    return { roll: roll || 0, rollFrom: from, sensorRoll: sensor, bodyRoll: body, yaw: yaw ? yaw.deg : 0, yawMeasured: !!(yaw && yaw.measured), ratio0: yaw ? yaw.ratio : null, stretch, tolerance: Number.isFinite((ex.camera || {}).tolerance) ? ex.camera.tolerance : (cam.tolerance || 25) };
  }
  /* The person turning mid-set: re-read the yaw each frame (smoothed), keep the stretch honest,
     and say so once it has held past the tolerance. Returns the current yaw for the record. */
  function watchYaw(ptsRaw, now) {
    const c = live.corr; if (!c) return;
    const cam = E.settings.camera || {};
    const y = E.Camera.yawOf(ptsRaw, live.ex.view, cam, c.ratio0); if (!y) return;
    c.yaw += 0.1 * (y.deg - c.yaw);
    if (c.yawMeasured && cam.unforeshorten !== 'off') c.stretch = 1 / Math.max(0.5, Math.cos(c.yaw * Math.PI / 180));
    if (c.yaw > c.tolerance) {
      if (!live.turnedSince) live.turnedSince = now;
      if (now - live.turnedSince > (cam.yawPersist || 1500) && now - (live.lastTurnCue || 0) > 6000) {
        live.lastTurnCue = now; const cue = live.ex.view === 'front' ? 'Turn to face the camera' : 'Turn side-on to the camera';
        if (voice.say(cue, { priority: 1, minGap: 1500 }) || voice.muted) { showCue(cue, 'info'); recEvent('turned', { yaw: Math.round(c.yaw), cue }); }
      }
    } else live.turnedSince = 0;
  }
  function applySmoothing() { const [c, b] = SMOOTH[settings.smooth] || SMOOTH.med; smoother.setSmoothing(c, b); }
  applySmoothing();
  let live = null; // { ex, target, session, state, ... }
  let rafId = 0, lastVideoTime = -1, fpsCount = 0, fpsT = 0, fps = 0;

  const ov = { el: $('overlay-msg'), title: $('ov-title'), text: $('ov-text'), checks: $('ov-checks'), prog: $('ov-progress'), bar: $('ov-bar'), note: $('ov-note'), count: $('countdown'), actions: $('ov-actions') };
  function overlay(title, text, { checks = null, progress = null, note = '', count = null, actions = null } = {}) {
    ov.el.hidden = false; ov.title.textContent = title; ov.text.textContent = text; ov.note.textContent = note;
    ov.prog.hidden = progress === null; if (progress !== null) ov.bar.style.width = Math.round(progress * 100) + '%';
    ov.count.hidden = count === null; ov.count.textContent = count ?? '';
    ov.checks.innerHTML = checks ? checks.map(c => `<span class="check ${c.ok === null ? '' : c.ok ? 'ok' : 'bad'}">${c.label}</span>`).join('') : '';
    /* The positioning overlay re-renders every animation frame. Rebuilding the buttons each time
       would replace the node between mousedown and mouseup, so a tap never lands — only rebuild
       when the set of labels actually changes, and just refresh the handlers otherwise. */
    const sig = actions ? actions.map(a => a.label).join('|') : '';
    if (sig !== ov.sig) {
      ov.sig = sig; ov.actions.innerHTML = '';
      if (actions) for (const a of actions) { const b = document.createElement('button'); b.className = 'btn ' + (a.cls || 'primary'); b.textContent = a.label; b.onclick = a.fn; ov.actions.appendChild(b); }
    } else if (actions) actions.forEach((a, i) => { const b = ov.actions.children[i]; if (b) b.onclick = a.fn; });
  }
  function hideOverlay() { ov.el.hidden = true; ov.sig = null; ov.actions.innerHTML = ''; }

  async function startLive(ex, target, file = null) {
    current.ex = ex; current.target = target; mockT = 0;   /* mock clock restarts per set */
    voice.unlock();
    if (!file) levelSensor.request();   /* same tap as the voice unlock: iOS wants a gesture for both */
    show('screen-live');
    $('live-name').textContent = ex.name + (current.opts.rom ? ' · ' + current.opts.rom + '°' : '') + (current.opts.variant ? ' · ' + ((((ex.options || []).find((o) => o.key === 'variant') || {}).labels || {})[current.opts.variant] || current.opts.variant.toUpperCase()).split(' (')[0] : '') + (current.opts.band && current.opts.band !== 'none' ? ' · ' + current.opts.band + ' band' : '') + (current.opts.weight && current.opts.weight !== 'none' && current.opts.weight !== 'custom' ? ' · ' + current.opts.weight + ' kg' : '') + (current.opts.sets > 1 ? ` · set ${current.opts.set}/${current.opts.sets}` : ''); $('count').textContent = ex.type === 'reps' ? '0' : '0s'; $('count-of').textContent = ex.type === 'reps' ? '/ ' + target : '/ ' + target + ' s';
    /* The side was picked before the set, so name it on screen from the start — not only once
       calibration has run. */
    if (ex.sided && SIDE_CODE[current.opts.side]) $('live-name').textContent += ` · ${sideName(SIDE_CODE[current.opts.side])} ${limbWord(ex)}`;
    $('phase').textContent = ''; $('cue').className = 'cue'; $('btn-mute').textContent = voice.muted ? '🔇' : '🔊';
    $('hud-side').style.display = ex.type === 'reps' ? '' : 'none'; $('btn-flip').style.display = file ? 'none' : '';
    setStatus('warn', 'Starting'); setFrame(''); applyVoiceButton();
    /* A one-sided move used to ask you to lift the limb you were about to work. The side is
       now chosen up front: for a 'pick' move that choice IS the working limb; for a 'camera'
       move the limb nearest the lens is the one being worked, so the pose decides and the
       choice only tells you how to lie or stand (checked during positioning). */
    current.opts.work = ex.sided && ex.sided.by === 'pick' ? SIDE_CODE[current.opts.side] || null : null;
    live = { ex, target, file, session: new E.SetSession(ex, { target, ...current.opts, heightIn: settings.heightIn }), state: 'loading', rec: { version: 1, exercise: ex.id, spec: ex.spec || null, target, opts: { ...current.opts }, source: file ? { name: file.name, size: file.size, type: file.type } : 'camera', settings: { ...settings }, facing, ua: navigator.userAgent, started: new Date().toISOString(), t0: 0, aspect: 0, frames: [], events: [] }, steadySince: 0, badSince: 0, countdownAt: 0, lastCountSpoken: 0, holdSpoken: {}, lastPoseT: 0, cueTimer: 0, lastP: 0, corr: null, turnedSince: 0, lastTurnCue: 0, sideSwitched: 0, shownDone: false, showPts: null, ghost: null, startAt: 0, startBad: [], startSince: 0, lastStartCue: 0, startSkip: false };
    smoother.reset();
    try {
      if (file) { overlay('Opening video…', file.name, { progress: 0.05 }); await startFile(file); stage.classList.remove('mirror'); }
      else { overlay('Starting camera…', 'Allow camera access when your browser asks.', { progress: 0.05 }); await startCamera(); applyMirror(); keepAwake(); }
      await loadModel((msg, p) => overlay('Getting ready', msg, { progress: p, note: 'Pose model runs on this device — no video leaves it.' }));
    } catch (err) {
      console.error(err);
      const msg = String(err && (err.name + ' ' + err.message)); const camErr = /NotAllowed|Permission|NotFound|NotReadable|getUserMedia/i.test(msg); const vidErr = /decode this video/i.test(msg);
      overlay(camErr ? 'Camera unavailable' : vidErr ? 'Couldn\'t play that video' : 'Couldn\'t load the pose model',
        camErr ? 'Allow camera access for this page and try again. On a phone, use the front camera at first.' : vidErr ? 'This browser could not decode the file. MP4 (H.264) and WebM both work in Chrome; re-export the clip if needed.' : 'The pose engine downloads from the MediaPipe CDN the first time. Check the connection, or if this page is embedded somewhere that blocks downloads, open the standalone file directly in your browser.',
        { actions: [{ label: 'Try again', fn: () => startLive(ex, target) }, { label: 'Back', cls: 'ghost', fn: exitLive }], note: String(err && err.message || err).slice(0, 140) });
      return;
    }
    live.state = 'position';
    if (!file) startVideoCapture();
    /* Spoken now rather than at "Go": it plays while they are getting into position, and the
       three-second count-in stays clear. */
    const opening = openingLine(ex, target, current.opts);
    if (opening) { voice.say(opening, { priority: 2 }); recEvent('opening', { text: opening }); }
    lastVideoTime = -1;
    cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop);
  }
  $('btn-exit').onclick = exitLive;
  $('btn-finish').onclick = () => finishSet();

  function setStatus(kind, text) { const s = $('track-status'); s.className = 'status ' + kind; $('track-text').textContent = text; }
  // Coloured outline around the camera view: green = person in frame / form good, red = not in position or a fault is active.
  function setFrame(kind) { const st = $('stage'); if (st.dataset.frame === kind) return; st.dataset.frame = kind; st.classList.toggle('frame-ok', kind === 'ok'); st.classList.toggle('frame-bad', kind === 'bad'); }
  function showCue(text, kind = 'warn', ms = 2600) { const c = $('cue'); c.textContent = text; c.className = 'cue show ' + (kind === 'good' ? 'good' : kind === 'info' ? 'info' : ''); clearTimeout(live?.cueTimer); if (live) live.cueTimer = setTimeout(() => c.classList.remove('show'), ms); }

  /* ---------- pose source (real or mock) ---------- */
  let mockT = 0;
  function detect(now) {
    if (MOCK) { if (!mockT) mockT = now; return window.__mockPose ? window.__mockPose(now - mockT) : null; }
    if (!landmarker || video.readyState < 2) return undefined;
    if (video.currentTime === lastVideoTime) return undefined; // no new frame yet
    lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, now);
    return res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
  }

  /* ---------- diagnostics recording ---------- */
  /* ---------- the set's own video ----------
     The skeleton alone is hard to read back: you cannot see the hand on the wall, the band, or the
     face. So the camera's own frames are recorded alongside the landmarks and played under the
     skeleton in the review. It is held in memory on this device for as long as the review is open,
     is never uploaded and is never part of the diagnostics JSON — that stays landmarks only. A
     video file being analysed needs none of this: it already is the video. */
  const vid = { mr: null, chunks: [], startedAt: 0, mime: '' };
  function startVideoCapture() {
    stopVideoCapture();
    if (settings.video === 'off' || !stream || typeof MediaRecorder === 'undefined') return;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
    try {
      vid.mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2000000 } : undefined);
      vid.chunks = []; vid.mime = mime || 'video/webm';
      vid.mr.ondataavailable = (e) => { if (e.data && e.data.size) vid.chunks.push(e.data); };
      vid.mr.start(500); vid.startedAt = performance.now();
    } catch (e) { vid.mr = null; }
  }
  function stopVideoCapture() { if (vid.mr && vid.mr.state !== 'inactive') { try { vid.mr.stop(); } catch (e) { } } vid.mr = null; vid.chunks = []; }
  /* Hand the finished video to a recording once the recorder has flushed, and refresh the review. */
  function finishVideoCapture(rec) {
    const mr = vid.mr; if (!mr || !rec) { stopVideoCapture(); return; }
    vid.mr = null; const chunks = vid.chunks, mime = vid.mime; vid.chunks = [];
    mr.onstop = () => {
      if (!chunks.length) return;
      rec.video = new Blob(chunks, { type: mime }); rec.videoMime = mime;
      if (lastRec === rec && !$('screen-review').hidden && rec.review) renderReplay(rec.review);
    };
    try { mr.stop(); } catch (e) { }
  }

  let lastRec = null;
  function record(raw, now, aspect) {
    const rec = live.rec; if (!rec) return;
    if (!rec.t0) { rec.t0 = now; rec.videoOffset = vid.mr ? Math.max(0, Math.round(now - vid.startedAt)) : 0; }   /* where rec time 0 sits in the video */
    const f = { t: Math.round(now - rec.t0), s: live.state, lm: raw ? raw.map(l => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.z ?? 0).toFixed(3), +(l.visibility ?? 1).toFixed(2)]) : null };
    if (live.state === 'active' && live.session.m) { f.p = +(live.session.m.p ?? 0).toFixed(3); if (live.session.counter) f.rs = live.session.counter.state; if (live.session.faults.active.size) f.f = [...live.session.faults.active]; }
    rec.frames.push(f); rec.aspect = aspect;
  }
  function recEvent(type, data) { if (live && live.rec) live.rec.events.push({ t: Math.round(performance.now() - (live.rec.t0 || performance.now())), type, ...data }); }

  /* ---------- main loop ---------- */
  function loop(now) {
    if (!live) return;
    rafId = requestAnimationFrame(loop);
    const W = MOCK ? 640 : video.videoWidth, H = MOCK ? 360 : video.videoHeight; if (!W || !H) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const aspect = W / H;
    const raw = detect(now);
    if (raw === undefined) return; // no new frame
    fpsCount++; if (now - fpsT > 1000) { fps = fpsCount; fpsCount = 0; fpsT = now; }
    const pts = raw ? smoother.update(raw, now, aspect) : null;
    if (raw) live.lastPoseT = now;
    record(raw, now, aspect);
    const lost = now - live.lastPoseT > 400;
    /* The skeleton and the framing checks belong on the picture as it is; the move measures a
       levelled, un-squashed copy (see cameraCorrection) so a crooked or off-axis phone reads true. */
    draw(pts, aspect, W, H, lost);
    if (live.state === 'position') positionStep(pts, aspect, now, lost);
    else if (live.state === 'show') showStep(lost ? null : pts, now, lost);
    else if (live.state === 'countdown') countdownStep(pts, now);
    else if (live.state === 'active') { if (pts && !lost) watchYaw(pts, now); activeStep(lost ? null : E.Camera.correctPts(pts, live.corr), now, lost); }
  }

  const SIDE_CODE = { left: 'L', right: 'R' };            // 'both' and undefined -> null (auto)
  const sideName = (c) => (c === 'L' ? 'left' : c === 'R' ? 'right' : '');
  /* Which limb this set is working, as 'L' | 'R' | null when it is not yet known. */
  function wantedSide() {
    if (!live || !live.ex.sided) return null;
    return SIDE_CODE[live.session.opts.side] || null;
  }
  function limbWord(ex) { return ex.sided ? (ex.sided.limb === 'side' ? 'side' : ex.sided.limb) : ''; }

  /* ---------- the spoken opening ----------
     Said once as the set comes up, while the person is still getting into position:
     which side (a "both" run is two halves, so it matters which one is first), what the
     move is, and the goal. The words come from the move's own "brief" in its data file —
     no move has a script here. Later sets of the same step only get the short version. */
  function sideLine(ex, opts, first) {
    const side = sideName(SIDE_CODE[opts.side]); if (!ex.sided || !side) return '';
    const limb = limbWord(ex), what = limb && limb !== 'side' ? `${side} ${limb}` : `${side} side`;
    const Cap = what[0].toUpperCase() + what.slice(1);
    /* "first" / "now the other" only make sense on the opening set of each half of a both-sides run. */
    if (!first || !opts.half) return Cap + '.';
    return opts.half === 1 ? `${Cap} first.` : `Now the ${what}.`;
  }
  function goalLine(ex, target) { return ex.type === 'reps' ? `${target} reps.` : `${target} seconds.`; }
  function openingLine(ex, target, opts) {
    const first = !(opts.set > 1);
    return [sideLine(ex, opts, first), first ? ex.brief : '', first ? goalLine(ex, target) : `Set ${opts.set} of ${opts.sets}.`].filter(Boolean).join(' ');
  }

  function checksFor(pts, aspect) {
    const ex = live.ex; const out = []; let ok = true;
    if (!pts) return { ok: false, checks: [{ label: 'No person detected', ok: false }], msg: 'Step into view so your whole body is in frame.' };
    /* the checks themselves live in the engine (FormEngine.positionCheck) so the Studio can run
       the same ones over a recording; here they get their words */
    const { visOk, frameOk, edges, orientOk, sizeOk } = E.positionCheck(pts, ex, aspect);
    out.push({ label: visOk ? (ex.upperBody ? 'Head to hips visible' : 'Body visible') : (ex.upperBody ? 'Head to hips hidden' : 'Body partly hidden'), ok: visOk });
    out.push({ label: frameOk ? 'In frame' : 'Cut off: ' + edges.join(', '), ok: frameOk });
    out.push({ label: orientOk ? (ex.view === 'front' ? 'Facing camera' : 'Side-on') : (ex.view === 'front' ? 'Turn to face the camera' : 'Turn side-on'), ok: orientOk });
    out.push({ label: sizeOk ? 'Good distance' : 'Come closer', ok: sizeOk });
    /* On a camera-side move the working limb is whichever one the lens can see, so the person
       has to be lying or standing the right way round for the side they picked. */
    const want = ex.sided && ex.sided.by === 'camera' ? wantedSide() : null;
    const seen = want ? E.nearSide(pts) : null;
    const sideOk = !want || seen === want;
    /* The working limb IS whichever one the lens can see, so lying the other way round is not a
       mistake to correct: the set runs on that limb and the check says which. */
    if (want) out.push({ label: sideOk ? `${sideName(want)} ${limbWord(ex)} nearest the camera` : `Working your ${sideName(seen)} ${limbWord(ex)} — the one the camera can see`, ok: true });
    ok = visOk && frameOk && orientOk && sizeOk;
    let msg = '';
    if (!visOk) msg = 'Some joints are hidden — make sure ' + (ex.upperBody ? 'your head, both arms and your hips' : ex.view === 'side' ? 'the whole side of your body' : 'both legs and both arms') + ' can be seen.';
    else if (!frameOk) msg = 'You\'re cut off at the ' + edges.join(' and ') + '. Move the camera back or reposition.';
    else if (!orientOk) msg = ex.view === 'front' ? 'Turn so your chest faces the camera.' : 'Turn 90° so the camera sees your side.';
    else if (!sizeOk) msg = 'Move a little closer to the camera.';
    return { ok, checks: out, msg };
  }

  /* The move's "start" faults, checked on the position being held. They are read a few times a
     second rather than every frame — the check calibrates a throwaway reference each time — and
     what they find is spoken once, then repeated on the usual cooldown. */
  const START_SKIP = [{ label: 'Start anyway', cls: 'ghost', fn: () => { if (live) { live.startSkip = true; live.startBad = []; } } }];
  function startStep(pts, now, held) {
    const none = { bad: [], checks: [], actions: null };
    if (!live || live.startSkip || !live.session || !live.ex.faults.some((f) => f.atStart)) return none;
    if (!live.startAt || now - live.startAt > 250) {
      live.startAt = now;
      live.startBad = live.session.startCheck(E.Camera.correctPts(pts, live.corr || cameraCorrection(pts)), wantedSide() || E.nearSide(pts));
    }
    const bad = live.startBad || [];
    if (!bad.length) { live.startSince = 0; return { bad, checks: live.ex.faults.filter((f) => f.atStart).length ? [{ label: 'Start position looks right', ok: true }] : [], actions: null }; }
    if (!live.startSince) live.startSince = now;
    const top = bad.slice().sort((a, b) => b.weight - a.weight)[0];
    if (now - (live.lastStartCue || 0) > 5000) { live.lastStartCue = now; voice.say(top.cue, { priority: 1 }); recEvent('startFault', { id: top.id, cue: top.cue }); }
    return { bad: [top, ...bad.filter((f) => f !== top)], checks: bad.map((f) => ({ label: f.label, ok: false })), actions: now - live.startSince > 6000 ? START_SKIP : null };
  }
  /* Stable array identity: overlay() diffs on the labels, so this must not be rebuilt per frame. */
  const POSITION_EXITS = [
    { label: '← Back to setup', cls: 'ghost', fn: () => exitLive() },
    { label: 'Home', cls: 'ghost', fn: () => exitLive('#/') },
  ];

  function positionStep(pts, aspect, now, lost) {
    const c = checksFor(lost ? null : pts, aspect);
    setStatus(c.ok ? 'ok' : 'warn', c.ok ? 'Tracking' : 'Positioning'); setFrame(c.ok ? 'ok' : 'bad');
    if (c.ok) {
      // must also be still: mid-hip speed
      const hip = E.mid(pts[23], pts[24]);
      const moving = live.prevHip && E.dist(hip, live.prevHip) > (live.file ? 0.03 : 0.012); live.prevHip = hip;
      if (moving) live.steadySince = now; else if (!live.steadySince) live.steadySince = now;
      const held = now - live.steadySince;
      /* The start position itself, judged by the move's own "start" faults: heels too far away,
         knee already bent, band already taut. Said here, where it can still be fixed, rather than
         counted against every rep of the set. The set waits for it — but never forever: after a
         few seconds there is a way past, because a threshold can be wrong and the person cannot
         argue with it. */
      const start = startStep(pts, now, held);
      const tilt = !live.file && levelSensor.seen >= 5 && levelSensor.roll != null && Math.abs(levelSensor.roll) >= 3 && Math.abs(levelSensor.roll) <= ((E.settings.camera || {}).maxRoll || 25) ? ` · phone tilted ${Math.round(Math.abs(levelSensor.roll))}°, corrected` : '';
      overlay(start.bad.length ? 'Fix the start position' : 'Hold your start position',
        start.bad.length ? start.bad[0].cue : live.ex.type === 'reps' ? 'Stay still for a moment — the coach is measuring your start position.' : 'Get into position and hold still.',
        { checks: c.checks.concat(start.checks), progress: Math.min(1, held / 1200), note: (live.ex.upperBody ? 'Head to hips visible · ' : 'Whole body visible · ') + (live.ex.view === 'front' ? 'facing the camera' : 'side-on') + tilt, actions: start.actions });
      if (held > (live.file ? 400 : 1200) && !start.bad.length) {
        /* Some moves ask for the end of the range once, before the set, so the target is measured on
           this body rather than assumed (see showStep). Asked once per exercise, not once per set. */
        if (live.ex.show && !live.shownDone && !live.file && current.shownFor !== live.ex.id) { live.state = 'show'; live.showAt = now; live.showSteady = 0; live.showHip = null; live.showSpoken = false; return; }
        /* The side was chosen before the set, so there is nothing to identify — start counting in. */
        live.state = 'countdown'; live.countdownAt = now - (live.file ? 2000 : 0); live.lastCountSpoken = 0;
      }
    } else {
      live.steadySince = 0;
      if (now - (live.lastPosCue || 0) > 6000 && c.msg) { live.lastPosCue = now; voice.say(c.msg, { priority: 1 }); }
      /* Always offer a way out: if the camera cannot see the whole body the set never starts,
         and without these the overlay is a dead end. */
      overlay('Get into position', c.msg, { checks: c.checks, note: (live.ex.upperBody ? 'Head to hips visible · ' : 'Whole body visible · ') + (live.ex.view === 'front' ? 'facing the camera' : 'side-on'), actions: POSITION_EXITS });
    }
  }
  /* ---------- "show me what that looks like on you" ----------
     A target written as a number — arms out at shoulder height, hands this far apart — reads
     differently on every body and from every angle, and the band or dumbbell that makes the move
     hard to judge is often the thing hiding the landmarks. So the move asks for the end position
     once, held still, with the equipment slack, and measures it. What was demonstrated becomes the
     target for the set; the file's number stays as the fallback if the pose cannot be read. */
  const SHOW_EXITS = [
    { label: 'Skip — use the usual target', cls: 'ghost', fn: () => { if (!live) return; live.shownDone = true; live.showPts = null; live.state = 'position'; live.steadySince = 0; } },
    { label: '← Back to setup', cls: 'ghost', fn: () => exitLive() },
  ];
  function showStep(pts, now, lost) {
    const ask = live.ex.show.ask;
    if (!live.showSpoken) { live.showSpoken = true; voice.say(`First, show me: ${ask}. Hold it there.`, { priority: 2 }); }
    const note = 'No band or weight for this — the coach is measuring what the end of the range looks like on you.';
    if (lost || !pts) { live.showSteady = 0; overlay('Show me the end position', ask, { note, actions: SHOW_EXITS }); return; }
    const hip = E.mid(pts[23], pts[24]);
    const moving = live.showHip && E.dist(hip, live.showHip) > 0.014; live.showHip = hip;
    if (moving) live.showSteady = 0; else if (!live.showSteady) live.showSteady = now;
    const held = live.showSteady ? now - live.showSteady : 0, waited = now - live.showAt;
    overlay('Show me the end position', ask, { progress: Math.min(1, waited < 2500 ? 0 : held / 1200), note, actions: SHOW_EXITS });
    /* a couple of seconds to get there, then a moment held still */
    if (waited > 2500 && held > 1200) {
      live.showPts = pts.map((p) => ({ ...p })); live.shownDone = true;
      live.state = 'position'; live.steadySince = 0; live.prevHip = null;
      voice.say('Got it. Back to the start position.', { priority: 2 });
    }
  }
  function countdownStep(pts, now) {
    const elapsed = now - live.countdownAt; const n = 3 - Math.floor(elapsed / 1000);
    if (n !== live.lastCountSpoken && n > 0) { live.lastCountSpoken = n; voice.say(String(n), { priority: 2 }); voice.beep(660, 0.06); }
    overlay('', 'Get ready…', { count: n > 0 ? n : 'GO' });
    if (elapsed >= 3000) {
      /* A 'pick' move works the limb the person chose; otherwise the side the lens can see. */
      const want = live.ex.sided && live.ex.sided.by === 'pick' ? wantedSide() : null;
      const side = want || E.nearSide(pts);
      /* On a camera-side move the visible limb IS the working one, so record it for the review. */
      if (live.ex.sided && live.ex.sided.by === 'camera') live.session.opts.work = side;
      live.corr = cameraCorrection(pts); live.rec.camera = { ...live.corr };
      live.session.calibrate(E.Camera.correctPts(pts, live.corr), side);
      /* a set-up fault the person chose to start with is still a fault of this set */
      const startBad = live.session.startCheck(E.Camera.correctPts(pts, live.corr), side);
      if (startBad.length) { live.session.noteStart(startBad.map((f) => f.id), now); recEvent('startFaults', { ids: startBad.map((f) => f.id) }); }
      /* the demonstrated end position, levelled the same way as the start pose, becomes the target;
         a later set of the same move reuses the one already shown */
      const shownPts = live.showPts || (current.shownFor === live.ex.id ? current.shownPts : null);
      if (shownPts && live.ex.showTarget) {
        const v = live.ex.showTarget(E.Camera.correctPts(shownPts, live.corr), live.session.ref);
        recEvent('shown', { value: v == null ? null : Math.round(v), target: Math.round(live.session.ref.target) });
        if (v == null) { if (live.showPts) voice.say('I could not read that pose — using the usual target.', { priority: 2 }); current.shownFor = null; current.shownPts = null; }
        else { current.shownFor = live.ex.id; current.shownPts = shownPts; }
      } recEvent('calibrate', { side, work: live.session.opts.work || null, ref: live.session.ref, camera: live.rec.camera });
      if (live.session.opts.work) $('live-name').textContent = `${live.ex.name} · ${sideName(live.session.opts.work)} ${limbWord(live.ex)}`;
      live.state = 'active'; hideOverlay(); voice.say('Go', { priority: 2 }); voice.beep(990, 0.12);
      showCue(live.ex.type === 'reps' ? 'Go — the coach is counting' : 'Hold it — timer running', 'good');
      live.startedAt = now;
    }
  }
  function activeStep(pts, now, lost) {
    const s = live.session, ex = live.ex;
    setStatus(lost ? 'bad' : 'ok', lost ? 'Lost you' : (settings.fps === 'on' ? fps + ' fps' : 'Tracking'));
    if (lost && now - (live.lastLostCue || 0) > 5000) { live.lastLostCue = now; showCue('Can\'t see you — step back into frame', 'info'); }
    const r = s.step(pts, now);
    /* the start position was read again where the person actually settled (see SetSession.rebaseIfSettled):
       the target line and the readout follow the new baselines, and the file says it happened */
    if (r.rebased) { live.ghost = null; showCue('Start position read again', 'info'); recEvent('recalibrate', { side: s.side, ref: { base: s.ref.base, start: s.ref.start, target: s.ref.target } }); }
    /* the engine followed the limb that was actually moving: say so, and record it, so the review
       and the history name the limb that did the work */
    if (s.ref && s.ref.switched && s.ref.switched !== live.sideSwitched) {
      live.sideSwitched = s.ref.switched; s.opts.work = s.ref.work;
      const w = `${sideName(s.ref.work)} ${limbWord(ex)}`;
      $('live-name').textContent = `${ex.name} · ${w}`;
      voice.say(`Following your ${w}`, { priority: 2 }); showCue(`Switched to your ${w}`, 'info');
      recEvent('side', { work: s.ref.work });
    }
    setFrame(lost ? 'bad' : s.faults.active.size ? 'bad' : (ex.type === 'hold' && r.m && !r.m.inPosition) ? 'bad' : 'ok');
    if (!r.m) return;
    let said = null;                       // the cue already spoken on this frame, if a rep just landed
    if (ex.type === 'reps') {
      const p = E.clamp(r.m.p, 0, 1.2); live.lastP = p;
      $('rom-fill').style.height = Math.round(p / 1.2 * 100) + '%';
      $('rom-fill').style.background = p >= E.FULL ? '#b8f542' : p > E.ATTEMPT ? '#ffb830' : 'rgba(255,243,226,.5)';
      $('phase').textContent = s.counter.state === 'rest' ? 'ready' : s.counter.state === 'out' ? ((ex.display && ex.display.label) || 'lift') : 'return';
      /* a rep with a hold: at the top the phase word counts the hold down, and a chime says it is up */
      if (ex.repHold && r.holding !== null) { const left = ex.repHold * 1000 - r.holding; $('phase').textContent = left > 0 ? 'hold ' + (Math.ceil(left / 100) / 10).toFixed(1) + 's' : 'held ✓'; }
      if (r.held) { voice.beep(1100, 0.1); recEvent('held', { ms: r.held.ms }); }
      if (r.repEvent) {
        const rep = r.repEvent.rep; recEvent('rep', { full: r.repEvent.full, n: rep.n, peak: +rep.peak.toFixed(3), duration: Math.round(rep.duration), faults: rep.faults });
        /* One cue per rep. A live fault (leaning) and a rep rule (too fast) can both be due at the
           same moment: on a full rep the heavier one is said, on a half rep the rep rule wins
           because it is the reason the rep did not count. Whichever loses keeps its turn and is
           said on a later frame rather than being dropped. */
        const pick = r.repEvent.full
          ? [r.cues[0], r.repCues[0]].filter(Boolean).sort((a, b) => b.weight - a.weight)[0]
          : (r.repCues[0] || r.cues[0]);
        if (r.repEvent.full) {
          $('count').textContent = s.counter.count; voice.beep(880, 0.1);
          voice.say(s.counter.count + (pick ? '. ' + pick.cue : ''), { priority: 2 });
          showCue(pick ? pick.cue : ['Nice', 'Good rep', 'Clean', 'Keep going'][s.counter.count % 4], pick ? 'warn' : 'good');
        } else {
          voice.beep(330, 0.15);
          const cue = pick ? pick.cue : 'Doesn\'t count — full range';
          voice.say(cue, { priority: 2 }); showCue(cue, 'warn');
        }
        /* Start its cooldown, so the same cue is not repeated on the next rep. */
        if (pick) { said = pick; s.ackCue(pick.id, now); live.lastCueFault = pick.id; recEvent('cue', { fault: pick.id, cue: pick.cue }); }
      }
    } else {
      const sec = s.holdMs / 1000; $('count').textContent = Math.floor(sec) + 's';
      $('phase').textContent = r.m.inPosition ? (s.faults.active.size ? 'fix it' : 'holding') : 'get in position';
      const remaining = live.target - sec;
      for (const mark of [Math.round(live.target / 2), 5, 4, 3, 2, 1]) {
        if (remaining <= mark && !live.holdSpoken[mark] && remaining > mark - 1) { live.holdSpoken[mark] = true; voice.say(mark === Math.round(live.target / 2) && mark > 5 ? 'Halfway' : String(mark), { priority: 2 }); }
      }
    }
    updateReadout(ex, r.m, s);
    if (r.cues.length && !said) {
      const f = r.cues[0]; const spoken = voice.say(f.cue, { priority: 1, minGap: 1500 });
      if (spoken || voice.muted || !('speechSynthesis' in window)) { s.ackCue(f.id, now); showCue(f.cue, 'warn'); voice.beep(440, 0.08); live.lastCueFault = f.id; recEvent('cue', { fault: f.id, cue: f.cue }); }
    } else if (!said && ex.type === 'hold' && !r.m.inPosition && ex.enterCue) {
      // holding exercise but not in the hold position: tell them how to get there instead of going quiet
      if (!live.outSince) live.outSince = now;
      if (now - live.outSince > 2500 && now - (live.lastEnterCue || 0) > 6000 && (now - live.startedAt) > 3000) { if (voice.say(ex.enterCue, { priority: 1, minGap: 1500 }) || voice.muted) { live.lastEnterCue = now; showCue(ex.enterCue, 'info'); recEvent('cue', { fault: 'enter', cue: ex.enterCue }); } }
    }
    if (ex.type === 'hold' && r.m.inPosition) live.outSince = 0;
    if (r.done) finishSet(true);
  }

  /* ---------- what the live panel shows: read from the move's own measurements ----------
     reps: the progress reading (as a change from the start, or raw) against its target;
     holds: the hold condition the move's display names, with its aim. No move has its own code here. */
  const kindUnit = (metric) => ((window.MoveSpec && MoveSpec.KINDS[metric.kind]) || {}).unit || '';
  function readoutFor(ex, m, s) {
    const d = ex.display || {}, ref = s.ref, act = s.faults.active; let val = '', tgt = '', state = '';
    if (ex.type === 'reps' && ex.iProg >= 0 && ref) {
      const metric = ex.metrics[ex.iProg], unit = d.unit ?? kindUnit(metric); const raw = d.from === 'abs';
      const v = raw ? m.value : Math.abs(m.value - ref.start), t = raw ? ref.target : Math.abs(ref.target - ref.start);
      val = Math.round(Math.max(raw ? -Infinity : 0, v)) + unit; tgt = '/ ' + Math.round(t) + unit + (d.label ? ' ' + d.label : ''); state = m.p >= E.FULL ? 'good' : '';
      const extra = [...act].map((id) => ex.faults.find((f) => f.id === id)).filter((f) => f && !f.onRep).map((f) => f.label.toLowerCase())[0];
      if (extra) tgt += ' · ' + extra;
    } else if (ex.type === 'hold' && ex.holdConds && ex.holdConds.length && m.h) {
      const ci = Math.min(d.condition ?? 0, ex.holdConds.length - 1), c = ex.holdConds[ci], unit = d.unit ?? kindUnit(c.metric);
      val = Math.round(m.h[ci]) + unit;
      const aim = d.aim || (Number.isFinite(c.min) && Number.isFinite(c.max) ? `${c.min}–${c.max}${unit}` : Number.isFinite(c.min) ? `≥ ${c.min}${unit}` : Number.isFinite(c.max) ? `≤ ${c.max}${unit}` : '');
      tgt = (d.label || '') + (aim ? ' · aim ' + aim : ''); state = m.inPosition && !act.size ? 'good' : '';
    }
    return { val, tgt, state };
  }
  function updateReadout(ex, m, s) {
    const ro = $('readout'), v = $('ro-val'), t = $('ro-tgt');
    const r = readoutFor(ex, m, s);
    v.textContent = r.val; t.textContent = r.tgt; ro.className = 'readout ' + (s.faults.active.size ? 'bad' : r.state);
  }
  function finishSet(auto = false) {
    if (!live || live.state !== 'active') { if (live && live.state !== 'active') exitLive(); return; }
    const review = live.session.review();
    live.state = 'done'; recEvent('finish', { auto }); finishVideoCapture(live.rec); live.rec.review = { score: review.score, reps: review.reps, partials: review.partials, holdSec: review.holdSec, faults: Object.fromEntries(Object.entries(review.faults).map(([k, v]) => [k, v.n])) }; lastRec = live.rec;
    /* When another set follows, the camera, skeleton and the count you just posted stay on
       screen through the rest — you can see yourself reset while the coach says what to fix.
       Only the last set of the last move tears the camera down and shows the full review. */
    const keep = !!current.keepCameraAfter;
    if (!keep) { cancelAnimationFrame(rafId); stopCamera(); try { wakeLock?.release(); } catch { } }
    voice.beep(990, 0.1); setTimeout(() => voice.beep(1320, 0.15), 120);
    if (!keep) renderReview(review);
    const summary = spokenSummary(review); setTimeout(() => voice.say(summary, { priority: 2 }), 500);
    const rec = live.rec;
    /* A stub keeps the frame loop alive so the video and skeleton keep drawing; it carries no
       session, so record() and the step handlers all no-op. */
    live = keep ? { ex: live.ex, target: live.target, file: null, state: 'rest', session: null, rec: null, lastPoseT: performance.now() } : null;
    if (onDone) onDone({ review, rec, opts: { ...current.opts, ...(rec.opts || {}) }, startedAt: Date.parse(rec.started), cameraHeld: keep });
  }

  /* ---------- drawing ---------- */
  /* The head, in whichever style settings.json asks for (see FormEngine.headShape). Drawn with the
     same helper everywhere so the live camera, the replay and the Studio all show the same figure. */
  function drawHead(ctx, pts, X, Y, S, style, colour, lineW) {
    if (style === 'face') return false;                       // the nose-and-ear links are in CONNECTIONS already
    const h = E.headShape(pts); if (!h) return true;
    const r = Math.max(4, Math.abs(X({ x: h.x + h.r, y: h.y }) - X({ x: h.x, y: h.y })));
    ctx.save(); ctx.lineWidth = lineW; ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(h.neck), Y(h.neck)); ctx.lineTo(X(h), Y(h)); ctx.stroke();   // the neck, in every style but face
    if (style === 'ball') { ctx.beginPath(); ctx.arc(X(h), Y(h), r, 0, Math.PI * 2); ctx.fill(); }
    else if (style === 'circle') { ctx.beginPath(); ctx.arc(X(h), Y(h), r, 0, Math.PI * 2); ctx.stroke(); }
    else if (style === 'dot') { ctx.beginPath(); ctx.arc(X(h), Y(h), Math.max(3, r * 0.42), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    return true;                                              // the caller skips the head links and the face joints
  }
  function draw(pts, aspect, W, H, lost) {
    ctx.clearRect(0, 0, W, H);
    if (!pts) return;
    const X = p => p.x / aspect * W, Y = p => p.y * H;
    const focus = new Set(live?.session?.m?.focus || []);
    const faulty = live?.state === 'active' && live.session.faults.active.size > 0;
    const alpha = lost ? 0.35 : 1;
    if (live?.state === 'active' && live.session.m) drawGhost(pts, X, Y, W, H);
    ctx.lineWidth = Math.max(3, W / 320); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha;
    const headStyle = settings.head || (E.settings.skeleton || {}).head || 'face';
    const ownHead = drawHead(ctx, pts, X, Y, null, headStyle, lost ? 'rgba(255,243,226,0.45)' : '#fff3e2', ctx.lineWidth = Math.max(3, W / 320));
    // bones
    /* a joint the model is not sure of (the far arm or leg, side-on) is left off rather than drawn
       where it guesses; a fairly sure one is drawn faint (settings.json skeleton.show / dim) */
    for (const [a, b] of E.CONNECTIONS) {
      if (ownHead && E.HEAD_LINKS.some(([c, d]) => c === a && d === b)) continue;
      if (!E.seen(pts, a) || !E.seen(pts, b)) continue;
      const p = pts[a], q = pts[b];
      const hot = faulty && (focus.has(a) || focus.has(b));
      ctx.strokeStyle = hot ? '#ff2e88' : (!E.sure(pts, a) || !E.sure(pts, b)) ? 'rgba(255,243,226,0.45)' : '#fff3e2';
      ctx.beginPath(); ctx.moveTo(X(p), Y(p)); ctx.lineTo(X(q), Y(q)); ctx.stroke();
    }
    // joints
    const r = Math.max(4, W / 220);
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      if (ownHead && i === 0) continue;
      if (!E.seen(pts, i)) continue; const p = pts[i];
      const hot = faulty && focus.has(i);
      ctx.fillStyle = hot ? '#ff2e88' : '#b8f542'; ctx.beginPath(); ctx.arc(X(p), Y(p), hot ? r * 1.6 : r, 0, Math.PI * 2); ctx.fill();
      if (focus.has(i)) { ctx.strokeStyle = hot ? '#ff2e88' : '#b8f542'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(p), Y(p), r * 2.4, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = Math.max(3, W / 320); }
    }
    // guided correction: ideal lines, targets and arrows on the video
    if (live?.state === 'active' && live.session.m) drawGuides(pts, X, Y, W, H);
    // angle readouts at focus joints (drawn un-mirrored)
    const m = live?.session?.m;
    if (m && live.state === 'active') {
      const label = angleLabel(live.ex, m); if (label) {
        const j = pts[[...focus][0]]; if (j && j.v > 0.3) {
          const mirrored = stage.classList.contains('mirror'); ctx.save(); if (mirrored) { ctx.translate(W, 0); ctx.scale(-1, 1); }
          const x = mirrored ? W - X(j) : X(j), y = Y(j);
          ctx.font = `600 ${Math.max(14, W / 48)}px "Nunito", sans-serif`; ctx.textBaseline = 'middle';
          const tw = ctx.measureText(label).width + 14; ctx.fillStyle = 'rgba(11,16,20,0.75)';
          ctx.beginPath(); ctx.roundRect(x - tw / 2, y + 22, tw, 28, 8); ctx.fill();
          ctx.fillStyle = faulty ? '#ff2e88' : '#fff3e2'; ctx.fillText(label, x - tw / 2 + 7, y + 36);
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;
  }


  /* ---------- ghost target pose: where the limb should be, readable from across the room ---------- */
  function ghostPath(points, X, Y, state) {
    const W = canvas.width; const color = state === 'good' ? 'rgba(184,245,66,0.85)' : state === 'bad' ? 'rgba(255,46,136,0.75)' : 'rgba(255,243,226,0.35)';
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(10, W / 60); ctx.beginPath();
    points.forEach((p, i) => { const x = X(p), y = Y(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    // end marker
    const e = points[points.length - 1]; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(e), Y(e), Math.max(9, W / 70), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  /* the landmarks a measurement reads, resolved on this frame for the working side */
  function metricPoints(metric, pts, S) { try { return (metric.pts || []).map((n) => MoveSpec.resolve(n, pts, S, E)); } catch { return null; } }
  /* A target pose for the measurement that defines the move: the limb drawn where it should be at
     the target (reps) or the aim (holds). Works from the measurement's geometry, so any move gets it. */
  /* Per-set memory for the target line: where each arm of the angle started, how far each has
     swung, and which way the joint bends. Reset with the set, keyed by the measurement. */
  function ghostState(metric, ref, S) {
    if (!live || !ref || !ref.pts0 || !window.MoveSpec) return null;
    const key = metric.pts.join('-') + ':' + S;
    if (live.ghost && live.ghost.key === key) return live.ghost;
    let q; try { q = metric.pts.map((n) => MoveSpec.resolve(n, ref.pts0, S, E)); } catch (e) { return null; }
    if (!q || q.some((p) => !p)) return null;
    const bear = (p, o) => Math.atan2(p.y - o.y, p.x - o.x);
    live.ghost = { key, a0: bear(q[0], q[1]), c0: bear(q[2], q[1]), a: 0, c: 0, cross: 0, sense: 1, q0: q, dA: 0, dB: 0, dC: 0, vcross: 0, vsense: 1 };
    return live.ghost;
  }
  function ghostFor(ex, m, ref, pts) {
    const S = m.side || ref.side || 'L';
    let metric, target;
    if (ex.type === 'reps' && ex.iProg >= 0) { metric = ex.metrics[ex.iProg]; target = ref.target; }
    else if (ex.holdConds && ex.holdConds.length) {
      const d = ex.display || {}; const c = ex.holdConds[Math.min(d.condition ?? 0, ex.holdConds.length - 1)]; metric = c.metric;
      const both = Number.isFinite(c.min) && Number.isFinite(c.max);
      target = both ? (c.min + c.max) / 2 : Number.isFinite(c.min) ? (metric.kind === 'angle' ? 180 : c.min) : (metric.kind === 'tilt' ? 0 : c.max);
      if (c.rel === 'change') target += (m.base && m.base[c.i]) || 0;
    }
    if (!metric || !Number.isFinite(target)) return null;
    const P = metricPoints(metric, pts, S); if (!P || P.some((p) => !p || p.v < 0.3)) return null;
    const rad = (a) => a * Math.PI / 180;
    if (metric.kind === 'angle') {
      /* An angle has two arms and the target can be drawn on either of them. Swinging the far arm
         off the near one — which is what this did — makes the line follow the near arm, so in a
         squat the target sweeps through eighty degrees as the thigh comes down and never sits
         still. The arm that is actually moving is the one to draw the target for; the still arm is
         the reference. Which is which is not a property of the move but of what the person is
         doing, so it is measured: each arm's bearing about the joint, against the calibration pose,
         and the larger swing so far wins. A running maximum cannot flip back and forth. */
      const [A, B, C] = P; const g = ghostState(metric, ref, S);
      const bear = (p, q) => Math.atan2(p.y - q.y, p.x - q.x);
      const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      if (g) {
        g.a = Math.max(g.a, Math.abs(wrap(bear(A, B) - g.a0)));
        g.c = Math.max(g.c, Math.abs(wrap(bear(C, B) - g.c0)));
        g.dA = Math.max(g.dA, E.dist(A, g.q0[0])); g.dB = Math.max(g.dB, E.dist(B, g.q0[1])); g.dC = Math.max(g.dC, E.dist(C, g.q0[2]));
      }
      /* In a bridge the joint itself is what travels: the hip rises between a shoulder and a knee
         that stay put, so a target drawn from the hip travels with it. When the joint has moved
         further than either end, the ends are the reference: the joint's place at the target
         angle is found from them (two sides and the angle between fix the triangle) and the target
         is drawn end to joint to end. Which side of the line the joint bends to is latched from
         the frame where it was clearest, like the sense below. */
      if (g && g.dB > 0.02 && g.dB > 1.3 * Math.max(g.dA, g.dC)) {
        const [S1, S2] = g.dA <= g.dC ? [A, C] : [C, A];
        const L = E.dist(S1, B), D = E.dist(S1, S2), th = rad(target);
        const vc = (S2.x - S1.x) * (B.y - S1.y) - (S2.y - S1.y) * (B.x - S1.x);
        if (Math.abs(vc) > g.vcross) { g.vcross = Math.abs(vc); g.vsense = vc >= 0 ? 1 : -1; }
        const disc = D * D - L * L * Math.sin(th) * Math.sin(th);
        if (L > 1e-3 && D > 1e-3 && disc >= 0) {
          const b = L * Math.cos(th) + Math.sqrt(disc);
          const alpha = Math.acos(E.clamp((L * L + D * D - b * b) / (2 * L * D), -1, 1));
          const a = bear(S2, S1) + g.vsense * alpha;
          return [S1, { x: S1.x + Math.cos(a) * L, y: S1.y + Math.sin(a) * L }, S2];
        }
      }
      /* the sense is which way round the joint bends; near lock-out the cross product is ~0 and its
         sign is noise, so the one from the most open frame so far is kept */
      const cross = (A.x - B.x) * (C.y - B.y) - (A.y - B.y) * (C.x - B.x);
      if (g && Math.abs(cross) > g.cross) { g.cross = Math.abs(cross); g.sense = cross >= 0 ? 1 : -1; }
      const sense = g ? g.sense : (cross >= 0 ? 1 : -1);
      const swingA = !!g && g.a > g.c;                       /* the hip end moves in a squat, the ankle end in a knee extension */
      const [still, moving] = swingA ? [C, A] : [A, C];
      const L = E.dist(B, moving);
      const a = bear(still, B) + (swingA ? -sense : sense) * rad(target);
      return [still, B, { x: B.x + Math.cos(a) * L, y: B.y + Math.sin(a) * L }];
    }
    if (metric.kind === 'vertical' || metric.kind === 'tilt') {   /* the segment at the target angle, on the side it already points to */
      const [A, B] = P; const L = E.dist(A, B); const dir = Math.sign(B.x - A.x) || 1;
      const a = metric.kind === 'vertical' ? rad(target) : rad(90 - target);
      return [A, { x: A.x + Math.sin(a) * dir * L, y: A.y + Math.cos(a) * L }];
    }
    if (metric.kind === 'rotation') {                    /* forearm swung out to the target, drawn flat */
      const [Pt, Q] = P; const L = E.dist(Pt, Q); const outward = metric.sign === 'forward' ? (ref.fwd ? ref.fwd[S] : 1) : E.outward(pts, S);
      const t = target + (metric.flip && ref.opts && [].concat(metric.flip.when).includes(ref.opts[metric.flip.option]) ? 0 : 0);
      return [Q, { x: Q.x + Math.sin(rad(t)) * outward * Math.max(L, 0.05), y: Q.y + 0.02 }];
    }
    return null;
  }
  function drawGhost(pts, X, Y, W, H) {
    const ex = live.ex, m = live.session.m, ref = live.session.ref, act = live.session.faults.active;
    const state = act.size ? 'bad' : (ex.type === 'reps' ? (m.p >= E.FULL ? 'good' : 'target') : (m.inPosition ? 'good' : 'target'));
    const g = ghostFor(ex, m, ref, pts); if (g) ghostPath(g, X, Y, state);
  }
  /* ---------- on-video guides (ideal lines, targets, arrows) ---------- */
  const GUIDE = { ok: 'rgba(78,225,193,0.55)', warn: '#FFB454', bad: '#FF5C6C' };
  function dashed(ax, ay, bx, by, color, w = Math.max(3, canvas.width / 200)) { ctx.save(); ctx.setLineDash([10, 8]); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.restore(); }
  function arrow(x, y, dx, dy, color, len = 40) {
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n; const ex = x + dx * len, ey = y + dy * len;
    const s = Math.max(1, canvas.width / 640); ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 6 * s; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex + dx * 16 * s, ey + dy * 16 * s); ctx.lineTo(ex - dy * 11 * s, ey + dx * 11 * s); ctx.lineTo(ex + dy * 11 * s, ey - dx * 11 * s); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function pulse() { return 0.6 + 0.4 * Math.sin(performance.now() / 180); }
  function label(x, y, text) {
    const mirrored = stage.classList.contains('mirror'); ctx.save(); if (mirrored) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); x = canvas.width - x; }
    ctx.font = `600 ${Math.max(14, canvas.width / 40)}px "Nunito", sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = mirrored ? 'right' : 'left'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(11,16,20,0.8)'; ctx.strokeText(text, x, y); ctx.fillStyle = 'rgba(232,238,242,0.95)'; ctx.fillText(text, x, y); ctx.restore();
  }
  /* Guides come from the faults' own measurements: a "rise" fault draws the height its point started
     at, an "offset" or "near" fault draws its reference line, and every active fault gets an arrow at
     its first landmark pointing the way to fix it — derived from the kind and the comparison. */
  function arrowDir(kind, op, P, pts, S) {
    const over = op === '>';
    const toward = (a, b) => ({ dx: b.x - a.x, dy: b.y - a.y });
    const away = (a, b) => ({ dx: a.x - b.x, dy: a.y - b.y });
    switch (kind) {
      case 'rise': case 'height': return over ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 };
      case 'gap': case 'dist': case 'near': return over ? toward(P[0], P[1]) : away(P[0], P[1]);
      case 'angle': { const mid = { x: (P[0].x + P[2].x) / 2, y: (P[0].y + P[2].y) / 2 }; return over ? toward(P[1], mid) : away(P[1], mid); }
      case 'vertical': case 'tilt': return over ? toward(P[1], P[0]) : away(P[1], P[0]);
      case 'offset': return over ? { dx: 0, dy: -1 } : { dx: 0, dy: 1 };
      case 'lean': case 'headTilt': return { dx: (over ? -1 : 1) * E.outward(pts, S), dy: 0 };
      case 'pelvis': return over ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 };
      default: return null;
    }
  }
  function drawGuides(pts, X, Y, W, H) {
    const ex = live.ex, m = live.session.m, ref = live.session.ref, act = live.session.faults.active, S = m.side || live.session.side;
    const L = Math.max(30, W / 16);
    ctx.save(); ctx.globalAlpha = 0.95;
    const spec = ex.spec || {}; const liveFaults = (spec.faults || []).filter((f) => f.metric && !f.rule);
    for (const f of liveFaults) {
      const metric = f.metric; const P = metricPoints(metric, pts, S); if (!P || P.some((p) => !p || p.v < 0.3)) continue;
      const on = act.has(f.id); const color = on ? GUIDE.bad : GUIDE.ok;
      if (metric.kind === 'rise' && ref && ref.pts0) {           /* the height the point started at */
        const p0 = MoveSpec.resolve(metric.pts[0], ref.pts0, S, E); dashed(X(P[0]) - L, Y(p0), X(P[0]) + L * 1.5, Y(p0), color);
        if (on) label(X(P[0]) + L * 1.5 + 6, Y(p0), f.label.toLowerCase());
      }
      if (metric.kind === 'offset' || metric.kind === 'near') dashed(X(P[1]), Y(P[1]), X(P[2]), Y(P[2]), color);
      if (metric.kind === 'pelvis') dashed(X(pts[23]) - L, (pts[23].y + pts[24].y) / 2 * H, X(pts[24]) + L, (pts[23].y + pts[24].y) / 2 * H, color);
      if (!on) continue;
      const d = arrowDir(metric.kind, f.op, P, pts, S); if (!d) continue;
      let at = P[0]; if (metric.kind === 'angle') at = P[1]; if (metric.kind === 'vertical' || metric.kind === 'tilt') at = P[1];
      if (metric.kind === 'lean') at = E.mid(pts[11], pts[12]); if (metric.kind === 'headTilt') at = pts[0]; if (metric.kind === 'pelvis') at = MoveSpec.resolve('HIP', pts, S, E);
      arrow(X(at), Y(at), d.dx * (stage.classList.contains('mirror') ? 1 : 1), d.dy, GUIDE.bad, L * 0.8);
    }
    /* the target itself, for a reps move: a dashed line to where the moving point should reach */
    const g = ghostFor(ex, m, ref, pts);
    if (g && ex.type === 'reps' && ex.iProg >= 0) { const a = g[g.length - 2], b = g[g.length - 1]; dashed(X(a), Y(a), X(b), Y(b), m.p >= E.FULL ? GUIDE.ok : GUIDE.warn); const r = readoutFor(ex, m, live.session); label(X(b) + 6, Y(b), r.tgt.replace(/^\/ /, '').split(' · ')[0]); }
    ctx.restore();
  }
  function angleLabel(ex, m) {
    if (!live || !live.session.ref) return '';
    const r = readoutFor(ex, m, live.session); if (!r.val) return '';
    const d = ex.display || {};
    return r.val + (d.label ? ' ' + d.label : '');
  }

  /* ---------- review ---------- */
  /* Hand a file to the person. On claude.ai the viewer mediates saves through its downloads
     capability; elsewhere a plain download link works. `st` is where to say what happened. */
  async function saveFile(name, data, type, st, orElse = '') {
    let dl = null; try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename: name, data }); if (st) st.textContent = 'Saved as ' + name + '.'; return true; }
      catch (e) { if (st) st.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'Download unavailable here' + (orElse ? ' — ' + orElse : '') + '.'; return false; }
    }
    try {
      const blob = data instanceof Blob ? data : new Blob([data], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); if (st) st.textContent = 'Saved as ' + name + '.'; return true;
    } catch (e) { if (st) st.textContent = 'Download blocked here' + (orElse ? ' — ' + orElse : '') + '.'; return false; }
  }
  /* the recording as a file: landmarks and events only — the set's video stays on this device */
  const recJson = () => JSON.stringify(lastRec, (k, v) => (k === 'video' || k === 'videoMime' ? undefined : v));
  const recName = (ext) => `ontrack-${lastRec.exercise}-${String(lastRec.started || '').replace(/[:.]/g, '-')}.${ext}`;

  /* ---------- watch it back ----------
     What the replay needs to know about the move, without the move's code: its name, what each
     fault is called and which joints it watches (so they light up while the fault is on). */
  function replayMeta(ex, rv) {
    const S = (lastRec.events.find((e) => e.type === 'calibrate') || {}).side || 'L';
    const faults = {};
    for (const f of ex.faults) {
      const raw = ((ex.spec && ex.spec.faults) || []).find((x) => x.id === f.id);
      let landmarks = [];
      try { const m = raw && raw.metric ? raw.metric : ex.spec && ex.spec.progress ? ex.spec.progress.metric : null; if (m && window.MoveSpec) landmarks = MoveSpec.metricLandmarks(m, S, E); } catch (e) { landmarks = []; }
      faults[f.id] = { label: f.label, cue: f.cue, tip: f.tip, landmarks };
    }
    const side = lastRec.opts && lastRec.opts.work ? `${sideName(lastRec.opts.work)} ${limbWord(ex)}` : lastRec.opts && SIDE_CODE[lastRec.opts.side] ? `${lastRec.opts.side} ${limbWord(ex)}` : '';
    const sk = E.settings.skeleton || {}; const [minCutoff, beta] = SMOOTH[settings.smooth] || SMOOTH.med;
    return { name: ex.name, type: ex.type, target: rv.target, side, faults, head: settings.head || sk.head || 'face', show: sk.show, dim: sk.dim, smooth: { minCutoff, beta } };
  }
  let replayer = null;
  function renderReplay(rv) {
    const panel = $('rv-replay'); if (!panel) return;
    const ex = (live && live.ex) || current.ex;
    if (!lastRec || !window.Replay || !ex || !lastRec.frames.some((f) => f.s === 'active' && f.lm)) { panel.hidden = true; return; }
    panel.hidden = false; if (replayer) replayer.destroy();
    const meta = replayMeta(ex, rv); const st = $('rv-replay-status'); st.textContent = '';
    replayer = Replay.mount($('rv-replay-host'), lastRec, meta);
    const note = $('rv-replay-note');
    if (note) note.textContent = replayer.hasVideo
      ? 'Your camera\u2019s own video, with the skeleton over it. It stays on this device — it is not uploaded, and the downloadable report carries the skeleton only.'
      : (lastRec.source === 'camera' && settings.video === 'off' ? 'The skeleton the coach saw. Turn on “Keep the set’s video” in Settings to watch the real thing back.' : 'The skeleton the coach saw — no video was kept.');
    $('btn-report').onclick = async () => {
      st.textContent = 'Building the report…';
      let src = ''; try { src = await (await fetch('coach/replay.js')).text(); } catch (e) { src = ''; }
      if (!src) { st.textContent = 'Could not load the player for the report — try again online.'; return; }
      const review = { ...rv, faults: Object.fromEntries(Object.entries(rv.faults).map(([k, v]) => [k, { n: v.n, fault: { label: v.fault.label, tip: v.fault.tip, weight: v.fault.weight } }])) };
      saveFile(recName('html'), Replay.reportHtml(lastRec, meta, review, src), 'text/html', st);
    };
    const bv = $('btn-video'); bv.hidden = !Replay.canRecord();
    bv.onclick = async () => {
      bv.disabled = true; const tl = replayer.timeline; const secs = Math.round(tl.duration / 1000);
      st.textContent = `Recording the replay — about ${secs} s, it renders in real time…`;
      try {
        const blob = await Replay.record(lastRec, meta, { onProgress: (p) => { st.textContent = `Recording the replay… ${Math.round(p * 100)}%`; } });
        await saveFile(recName(blob.type.includes('mp4') ? 'mp4' : 'webm'), blob, blob.type, st);
      } catch (e) { st.textContent = 'Could not record here: ' + (e && e.message || e); }
      bv.disabled = false;
    };
  }
  function fmtTempo(ms) { return ms ? (ms / 1000).toFixed(1) + ' s' : '—'; }
  /* What is said at the end of a set. The screen already carries the counts, the score and the
     rep-by-rep detail; spoken back they are noise. So: the set is done, and the one thing to try
     next — the heaviest fault's cue, which is already written as what TO do. The counts are spoken
     only when the set ended short, where the number is news rather than routine. */
  function spokenSummary(rv) {
    const o = current.opts || {};
    const which = o.set ? (o.sets > 1 ? `Set ${o.set} of ${o.sets}` : `Set ${o.set}`) : 'Set';
    const short = rv.type === 'reps' ? rv.reps < rv.target : rv.holdSec < rv.target - 1;
    let s = short
      ? `${which} done — ${rv.type === 'reps' ? `${rv.reps} of ${rv.target} reps` : `${Math.round(rv.holdSec)} of ${rv.target} seconds`}. `
      : `${which} complete. `;
    /* Every suggestion worth hearing, not just the first — reading the screen is the thing this
       is meant to replace. "Major" is a severity weight from settings.json, heaviest first, capped
       so it cannot become a paragraph; a set with only light faults still gets the heaviest one. */
    const sc = (E.settings.score || {}), minW = sc.speakWeight ?? 2, max = sc.speakMax ?? 4;
    const sorted = Object.values(rv.faults || {}).sort((a, b) => b.fault.weight * b.n - a.fault.weight * a.n);
    const major = sorted.filter((fc) => fc.fault.weight >= minW).slice(0, max);
    const fixes = (major.length ? major : sorted.slice(0, 1)).map((fc) => String(fc.fault.cue || fc.fault.label)).map((c) => c[0].toLowerCase() + c.slice(1));
    const list = fixes.length < 2 ? fixes[0] : fixes.slice(0, -1).join(', ') + ' and ' + fixes[fixes.length - 1];
    s += fixes.length ? `Next set: ${list}.` : 'Nothing to fix — same again.';
    return s;
  }
  function renderReview(rv) {
    const ring = $('ring-val'); const circ = 326.7; ring.style.strokeDashoffset = circ; requestAnimationFrame(() => setTimeout(() => ring.style.strokeDashoffset = circ * (1 - rv.score / 100), 50));
    ring.style.stroke = rv.score >= 75 ? 'var(--good)' : rv.score >= 55 ? 'var(--warn)' : 'var(--bad)';
    $('ring-text').textContent = rv.score;
    $('rv-headline').textContent = rv.headline;
    $('rv-sub').textContent = rv.name + (lastRec && lastRec.source && lastRec.source.name ? ' · from ' + lastRec.source.name : '') + ' · ' + new Date(rv.date).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + (rv.trackingLossPct > 10 ? ` · tracking lost ${rv.trackingLossPct}% of the time — check camera placement` : '');
    const stats = rv.type === 'reps'
      ? [[rv.reps + ' / ' + rv.target, 'reps counted'], [rv.partials, 'partial reps'], [fmtTempo(rv.avgTempo), 'avg rep time'], [Math.round(rv.avgROM * 100) + '%', 'avg range']]
      : [[rv.holdSec + ' s', 'held'], [rv.goodSec + ' s', 'in good form'], [rv.target + ' s', 'target'], [Math.round(100 * (rv.holdSec ? rv.goodSec / rv.holdSec : 0)) + '%', 'form quality']];
    $('rv-stats').innerHTML = stats.map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
    const wrap = $('rv-reps-wrap');
    if (rv.type === 'reps' && rv.repList && rv.repList.length) {
      wrap.hidden = false;
      $('rv-reps').innerHTML = rv.repList.map(r => `<div class="bar ${!r.full ? 'partial' : r.faults.length ? 'fault' : ''}" style="height:${Math.round(E.clamp(r.peak, 0.1, 1.2) / 1.2 * 100)}%" title="Rep ${r.n || '–'}: ${Math.round(r.peak * 100)}% range, ${(r.duration / 1000).toFixed(1)}s${r.faults.length ? ', ' + r.faults.join(', ') : ''}"></div>`).join('');
      const rl = $('rv-replist'); if (rl) { const F = Object.fromEntries(live && live.ex ? live.ex.faults.map(f => [f.id, f]) : (current.ex ? current.ex.faults.map(f => [f.id, f]) : []));
        rl.innerHTML = rv.repList.map((r, i) => `<details class="rep"><summary><span class="n">${r.n ? 'Rep ' + r.n : 'Not counted'}</span><span class="pill ${!r.full ? 'partial' : r.faults.length ? 'fault' : 'clean'}">${!r.full ? 'not counted' : r.faults.length ? 'counted, with a cue' : 'counted'}</span><span class="meta">${Math.round(r.peak * 100)}% range · ${(r.duration / 1000).toFixed(1)} s</span></summary><div class="rep-body"><div class="stats small"><div class="stat"><div class="v">${Math.round(r.peak * 100)}%</div><div class="k">of target range</div></div><div class="stat"><div class="v">${(r.tDown / 1000).toFixed(1)} s</div><div class="k">out</div></div><div class="stat"><div class="v">${(r.tUp / 1000).toFixed(1)} s</div><div class="k">back</div></div><div class="stat"><div class="v">${Math.round((r.endP || 0) * 100)}%</div><div class="k">left at the end</div></div></div>${r.faults.length ? `<ul class="rep-faults">${r.faults.map(id => `<li><strong>${F[id] ? F[id].label : id}</strong>${F[id] ? ' — ' + F[id].tip : ''}</li>`).join('')}</ul>` : `<p class="muted">${!r.full ? 'Turned around before reaching the target range, so it was not counted.' : 'Nothing to fix on this one.'}</p>`}</div></details>`).join(''); }
      const tr = rv.trace; const T = tr.length ? tr[tr.length - 1][0] : 1;
      const path = tr.map((p, i) => (i ? 'L' : 'M') + (p[0] / T * 600).toFixed(1) + ' ' + (85 - E.clamp(p[1], 0, 1.2) / 1.2 * 80).toFixed(1)).join(' ');
      $('rv-trace').innerHTML = `<line x1="0" y1="${85 - E.FULL / 1.2 * 80}" x2="600" y2="${85 - E.FULL / 1.2 * 80}"></line><path d="${path}"></path>`;
    } else wrap.hidden = true;
    /* Advice, not diagnosis: the cue says what to do ("Slow it down"), the label only names what
       went wrong ("Too fast"). Heaviest first, so the top line is the one worth fixing. */
    const fl = $('rv-faults');
    const items = Object.values(rv.faults).sort((a, b) => b.fault.weight * b.n - a.fault.weight * a.n);
    fl.innerHTML = items.length
      ? items.map((fc) => `<li><span class="n">×${fc.n}</span><span class="s">${escT(fc.fault.cue || fc.fault.label)}</span><span class="t">${escT(fc.fault.tip)}</span></li>`).join('')
      : '<li class="empty">Nothing to fix. Same again next set — or add a couple of reps.</li>';
    const spk = $('btn-speak-review'); if (spk) spk.onclick = () => { voice.unlock(); voice.say(spokenSummary(rv), { priority: 2 }); };
    renderReplay(rv);
    const dg = $('rv-diag'); if (!dg) return; dg.hidden = !lastRec;
    if (lastRec) {
      $('rv-diag-info').textContent = `${lastRec.frames.length} frames · ${(recJson().length / 1024).toFixed(0)} KB · landmarks + metrics, no video`;
      $('btn-diag-download').onclick = () => saveFile(recName('json'), recJson(), 'application/json', $('rv-diag-status'), 'use Copy JSON instead');
      $('btn-diag-copy').onclick = async () => {
        const txt = recJson();
        try { await navigator.clipboard.writeText(txt); $('rv-diag-status').textContent = 'Copied — paste it into a .json file or straight into the chat.'; }
        catch (e) { const ta = $('rv-diag-text'); ta.hidden = false; ta.value = txt; ta.select(); $('rv-diag-status').textContent = 'Clipboard unavailable — select the text below and copy it.'; }
      };
    }
  }
  /* ---------- portal API ---------- */
  /* dest: optional hash to land on instead of the caller's default (used by the "Home" escape). */
  function exitLive(dest) { cancelAnimationFrame(rafId); voice.stop(); stopCamera(); try { wakeLock?.release(); } catch { } live = null; hideOverlay(); if (onExit) onExit(typeof dest === 'string' ? dest : undefined); }
  function start({ exercise, target, options = {}, file = null, done, exit, keepCameraAfter = false }) {
    current.keepCameraAfter = keepCameraAfter && !file;
    current.ex = exercise; current.target = target || exercise.defaultTarget; current.opts = { ...options }; onDone = done; onExit = exit; lastRec = null;
    return startLive(exercise, current.target, file);
  }
  /* Shown over the live camera between sets. app.js owns the clock and calls this each tick. */
  function restOverlay(opts) { if (live && live.state === 'rest') overlay(opts.title || '', opts.text || '', opts); }
  function restActive() { return !!live && live.state === 'rest'; }
  /* Tear down a held-open camera when the person stops instead of starting the next set. */
  function endRest() { if (live && live.state === 'rest') { cancelAnimationFrame(rafId); stopCamera(); try { wakeLock?.release(); } catch { } live = null; hideOverlay(); } }

  /* The anatomical figure lives in coach/archive/; this keeps its small API for the Studio and the catalogue. */
  window.OnTrackAnatomy = { demo, register: registerFigure, figure: (id) => REGISTERED[id] || null, mountAll: mountFigures, stopAll() { if (muscleFig) try { muscleFig.stopAll(); } catch (e) { } }, regions: MUSCLE_REGIONS, noteSvg, figureBox };
  window.OnTrackCoach = { start, exitLive, restOverlay, restActive, endRest, diagram, demo, cameraDiagram, phoneInset, thumb, registerFigure, listVoices, pickVoice, voiceRate, applyVoiceButton, mountFigures, exercises: E.EXERCISES, settings, setSetting, get live() { return live; }, get lastRec() { return lastRec; }, recJson, finishSet, renderReview, spokenSummary, voice };
})();
