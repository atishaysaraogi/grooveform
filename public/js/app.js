/* ---------------------------------------------------------------------------
   Camera, drawing, voice, recording.

   What is measured and what is said live in core.js and moves.js and are tested
   there. This file is the part that cannot be tested without a camera: getting
   frames, putting the picture together, saying the words and writing the file.

   One rule shapes the drawing: the canvas IS the recording. Everything worth
   keeping — the camera frame, the skeleton, the angles, the countdown, the cue —
   is painted onto it, so the video that downloads is the video you watched.

   Nothing here knows what a wall sit or a plank is. The readouts, the settings,
   the heads-up display and the skeleton's colours are all built from the move's
   own description of itself, so a new move is a new entry in moves.js.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  const MP = '0.10.21';
  const MODELS = {
    full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
    lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  };
  const C = { good: '#35d07f', warn: '#ffb545', bad: '#ff5c6c', ink: '#e8edf4', dim: 'rgba(232,237,244,.45)', shadow: 'rgba(0,0,0,.55)' };

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const video = $('cam'), canvas = $('view'), ctx = canvas.getContext('2d');

  let move = Moves.wallsit;
  let vision = null, landmarker = null, loadedModel = null;
  let stream = null, camFacing = 'user';   // the front camera: it is the one you can see while you set the phone down
  let running = false, raf = 0, lastTs = 0;
  let coach = null, smoother = null, state = null;
  let banner = null;                      // the cue painted on the frame, and when it appeared
  let rec = null, inSet = false;          // MediaRecorder + its chunks, and whether a set is under way
  let audio = null;                       // WebAudio graph: speakers + a track for the recording
  let t0 = 0;

  /* ---------- settings ----------
     Remembered in the browser, but a band the app itself has changed its mind
     about is not the person's setting — it is a stale default. The version is
     bumped whenever a default moves, and a store written under an older one is
     dropped rather than silently holding the old band on a page that says it
     uses the new one. */
  const SETTINGS_V = 6;
  const COMMON_KEYS = ['cool', 'model', 'mirror', 'rotate'];
  /* One input each, but the value belongs to the exercise: a plank is held for a
     minute and a knee raise for ten seconds a rep, and neither should inherit the
     other's clock just because they share a box on the settings panel. */
  const PER_MOVE = ['target', 'calls'];
  const store = {
    get() {
      try { const v = JSON.parse(localStorage.getItem('wallsit') || '{}'); return v && v.v === SETTINGS_V ? v : {}; }
      catch { return {}; }
    },
    set(v) { try { localStorage.setItem('wallsit', JSON.stringify(Object.assign({ v: SETTINGS_V }, v))); } catch { } },
  };
  let saved = { move: 'wallsit', common: {}, bands: {} };

  const num = (id, d) => { const e = $(id); if (!e) return d; const v = Number(e.value); return Number.isFinite(v) && e.value !== '' ? v : d; };

  function cfg() {
    const c = Object.assign({}, Core.COMMON, move.defaults);
    for (const s of settingsOf(move)) c[s.key] = num('cfg-' + s.key, move.defaults[s.key]);
    /* the time calls are typed as a list, so anything unreadable falls back
       rather than silently leaving the set with no calls in it */
    const calls = String(($('cfg-calls') || {}).value || '').split(/[^\d]+/).map(Number).filter((x) => x > 0);
    c.cooldownMs = num('cfg-cool', 4) * 1000;
    c.holdTargetSec = Math.max(1, num('cfg-target', c.holdTargetSec));
    c.callAtSec = (calls.length ? calls : c.callAtSec).sort((a, b) => b - a);
    c.model = $('cfg-model').value;
    c.mirror = $('cfg-mirror').value === 'on';
    c.rotate = $('cfg-rotate').value;
    return c;
  }

  /* every number a move owns: the band edges, plus anything else it declares */
  const settingsOf = (m) => m.bands.reduce((a, b) => a.concat(b.set), []).concat(m.extra || []);

  /* those inputs belong to the move, so they are built when the move changes */
  function buildSettings() {
    const host = $('band-settings'); host.innerHTML = '';
    const mine = saved.bands[move.id] || {};
    const fallback = Object.assign({}, Core.COMMON, move.defaults);
    $('cfg-target').value = mine.target != null ? mine.target : fallback.holdTargetSec;
    $('cfg-calls').value = mine.calls != null ? mine.calls : fallback.callAtSec.join(', ');
    for (const s of settingsOf(move)) {
      const lab = el('label', null, `${s.label}<input type="number" id="cfg-${s.key}" min="${s.min}" max="${s.max}" step="1">`);
      host.appendChild(lab);
      const input = lab.querySelector('input');
      input.value = mine[s.key] != null ? mine[s.key] : move.defaults[s.key];
      input.onchange = saveSettings;
    }
  }
  /* and so do the readouts: one card per band, plus the clock */
  function buildReads() {
    const host = $('reads'); host.innerHTML = '';
    for (const b of move.bands) {
      host.appendChild(el('div', 'read', `<div class="v"><span id="v-${b.key}">—</span><i>°</i></div>` +
        `<div class="k">${b.label}<span class="band" id="band-${b.key}"></span></div>` +
        `<div class="meter"><span class="ok" id="ok-${b.key}"></span><b id="pin-${b.key}"></b></div>`));
      host.lastChild.id = 'read-' + b.key;
    }
    if (move.reps) {
      host.appendChild(el('div', 'read', `<div class="v"><span id="rep-v">0</span><i>/${cfg().repCount}</i></div>` +
        `<div class="k">reps<span class="band" id="rep-k">standing</span></div>` +
        `<div class="meter"><span class="ok" style="width:100%"></span><b id="rep-pin"></b></div>`));
      host.lastChild.id = 'read-reps';
    }
    host.appendChild(el('div', 'read wide', `<div class="v"><span id="hold-v">60.0</span><i>s</i></div>` +
      `<div class="k"><span id="hold-k">left of 60 s</span><span class="band" id="best-v">held 0.0 s · best 0.0 s</span></div>` +
      `<div class="meter"><span class="ok" style="width:100%"></span><b id="hold-pin"></b></div>`));
    host.lastChild.id = 'read-hold';
  }

  function loadSettings() {
    saved = Object.assign({ move: 'wallsit', common: {}, bands: {} }, store.get());
    move = Moves[saved.move] || Moves.wallsit;
    $('move').value = move.id;
    for (const k of COMMON_KEYS) if (saved.common[k] != null) $('cfg-' + k).value = saved.common[k];
    buildSettings(); buildReads(); syncBands();
  }
  function saveSettings() {
    saved.move = move.id;
    for (const k of COMMON_KEYS) saved.common[k] = $('cfg-' + k).value;
    const mine = saved.bands[move.id] = {};
    for (const s of settingsOf(move)) mine[s.key] = $('cfg-' + s.key).value;
    for (const k of PER_MOVE) mine[k] = $('cfg-' + k).value;
    store.set(saved); syncBands();
    if (coach) Object.assign(coach.cfg, cfg());
  }
  /* the band shown beside each reading, and the green stretch on its meter */
  function syncBands() {
    const c = cfg();
    for (const b of move.bands) {
      const lo = b.sym ? -c[b.sym] : c[b.lo], hi = b.sym ? c[b.sym] : c[b.hi];
      $('band-' + b.key).textContent = bandText(b, c);
      $('ok-' + b.key).style.left = pct(lo, b.scale[0], b.scale[1]) + '%';
      $('ok-' + b.key).style.width = (pct(hi, b.scale[0], b.scale[1]) - pct(lo, b.scale[0], b.scale[1])) + '%';
    }
    /* between sets the clock shows the whole of whatever this exercise asks for */
    if (!inSet) { $('hold-v').textContent = c.holdTargetSec.toFixed(1); $('hold-k').textContent = `left of ${c.holdTargetSec} s`; }
    $('target-label').textContent = move.holdLabel || 'Hold the set for';
    $('r-target').textContent = `of ${c.holdTargetSec}`;
    $('veil-text').textContent = move.hint + ' The camera never leaves this device.';
  }
  /* "-5–15" reads as a subtraction, so a band that starts below zero is spelt out */
  function bandText(b, c) {
    if (b.sym) return `±${c[b.sym]}`;
    return c[b.lo] < 0 ? `${c[b.lo]} to ${c[b.hi]}` : `${c[b.lo]}–${c[b.hi]}`;
  }
  const pct = (v, lo, hi) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

  /* ---------- voice ----------
     A coach that is sometimes silent is worse than one that is never heard, so
     the three ways a browser quietly swallows speech are all handled here rather
     than left to chance. */
  const voice = {
    on: true, pick: null, ok: 'speechSynthesis' in window, primed: false,
    ready() {
      if (!this.ok) return;
      const vs = speechSynthesis.getVoices();
      /* anything but the buzzy fallbacks, and an English one if there is one */
      const good = vs.filter((v) => /^en/i.test(v.lang) && !/espeak|compact|pico/i.test(v.name));
      this.pick = good.find((v) => /natural|neural|premium|enhanced|google|samantha|daniel/i.test(v.name)) || good[0] || vs[0] || null;
    },
    /* Safari will only begin speaking from inside a user gesture, and once it has
       begun once everything after is allowed. The camera and the model are awaited
       before the first cue, and by then the gesture is long gone — so the engine is
       woken here, silently, on the tap itself. */
    prime() {
      if (!this.ok || this.primed) return;
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0; speechSynthesis.speak(u); this.primed = true;
      } catch { }
    },
    say(text) {
      if (!this.on || !this.ok) return;
      try {
        speechSynthesis.cancel();
        /* Chrome drops an utterance queued in the same turn as a cancel, and after
           a spell of silence leaves the engine paused; a tick's delay and a resume
           cost nothing and cover both. */
        setTimeout(() => {
          try {
            speechSynthesis.resume();
            const u = new SpeechSynthesisUtterance(text);
            if (this.pick) u.voice = this.pick;
            u.rate = 1.03; u.pitch = 1; u.volume = 1;
            speechSynthesis.speak(u);
          } catch { }
        }, 0);
      } catch { }
    },
  };
  if (voice.ok) { voice.ready(); speechSynthesis.onvoiceschanged = () => voice.ready(); }

  /* ---------- tones ----------
     Spoken words cannot be captured into a MediaRecorder from the browser's
     speech engine, so every cue also gets a short tone, and that tone is mixed
     into the recording. The downloaded file is audible as well as readable. */
  function initAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const ac = new AC();
    const out = ac.createGain(); out.gain.value = 0.18; out.connect(ac.destination);
    const dest = ac.createMediaStreamDestination(); out.connect(dest);
    audio = { ac, out, dest };
    return audio;
  }
  function tone(seq) {
    const a = initAudio(); if (!a || !voice.on) return;
    if (a.ac.state === 'suspended') a.ac.resume();
    let at = a.ac.currentTime;
    for (const [hz, dur] of seq) {
      const o = a.ac.createOscillator(), g = a.ac.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + 0.012);
      g.gain.setValueAtTime(1, at + dur - 0.03); g.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(g); g.connect(a.out); o.start(at); o.stop(at + dur);
      at += dur + 0.02;
    }
  }
  const DOWN = [[660, 0.1], [440, 0.14]], UP = [[440, 0.1], [660, 0.14]];
  const TONES = {
    high: DOWN, low: UP, hipup: DOWN, hipdown: UP,
    forward: [[300, 0.16]], back: [[300, 0.16]],
    feetback: [[520, 0.09], [392, 0.09], [330, 0.13]],   // walking back: a falling run
    feetfwd: [[330, 0.09], [392, 0.09], [520, 0.13]],    // walking out: the same run, rising
    stackback: [[330, 0.09], [392, 0.09], [520, 0.13]],
    stackfwd: [[520, 0.09], [392, 0.09], [330, 0.13]],
    hold: [[880, 0.09], [1175, 0.13]],
    call: [[988, 0.07], [988, 0.09]],                    // the clock, twice, out of the way
    done: [[784, 0.1], [988, 0.1], [1319, 0.22]],
    lost: [[350, 0.08]],
  };
  /* every call shares one tone, so `call30` and `call5` do not each need an entry */
  const toneFor = (id) => TONES[id] || (/^call\d/.test(id) ? TONES.call : TONES.lost);

  /* ---------- the pose model ---------- */
  async function loadModel(want, note) {
    if (landmarker && loadedModel === want) return;
    note('Loading the pose engine…');
    if (!vision) vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP}/wasm`);
    note(`Loading the ${want} pose model…`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODELS[want], delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    if (landmarker) { try { landmarker.close(); } catch { } landmarker = null; }
    try { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    loadedModel = want; note('');
  }

  /* ---------- camera ---------- */
  /* A phone stood on its end does not always hand over a frame stored that way up:
     some browsers give the sensor's own landscape frame and leave the turning to
     whoever displays it. Then a standing body arrives lying down, and every angle
     taken against vertical or the floor is ninety degrees wrong. So the frame is
     turned here, before anything is read from it.

     `auto` turns it only when the shape the move asked for is not the shape that
     came, and guesses the direction from the screen's own orientation. A guess can
     be wrong, which shows up immediately as an upside-down picture, so the other
     direction is one setting away. */
  function quarterTurn() {
    const w = video.videoWidth, h = video.videoHeight, want = move.camera;
    const pick = cfg().rotate;
    if (pick === 'right') return 1;
    if (pick === 'left') return 3;
    if (pick !== 'auto' || !want || !w || !h) return 0;
    if ((want === 'wide') === (w > h)) return 0;          // already the right way round
    const a = (window.screen && screen.orientation && screen.orientation.angle) || 0;
    return a === 90 ? 3 : 1;
  }
  /* the frame's size once it has been turned */
  const turned = (q) => (q % 2
    ? { w: video.videoHeight || 720, h: video.videoWidth || 1280 }
    : { w: video.videoWidth || 1280, h: video.videoHeight || 720 });

  let camShape = null;              // the frame shape the running camera was asked for
  async function startCamera() {
    stopCamera();
    camShape = move.camera || null;
    const box = camShape === 'tall' ? { width: { ideal: 720 }, height: { ideal: 1280 }, aspectRatio: { ideal: 9 / 16 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } };
    const want = { video: Object.assign({ facingMode: camFacing }, box), audio: false };
    try { stream = await navigator.mediaDevices.getUserMedia(want); }
    catch { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => (video.videoWidth ? r() : (video.onloadedmetadata = r)));
    sizeCanvas(true);
  }

  /* The canvas is the recording, so its size is chosen once and then left alone
     while a set is running: a file that changes shape halfway through is not one
     most players will take. Between sets it follows the camera, which is how
     turning the phone over takes effect. */
  function sizeCanvas(force) {
    const t = turned(quarterTurn());
    const want = Core.canvasSize(move.camera, t.w, t.h);
    if (!want) return;
    if (!force && rec && rec.mr && rec.mr.state === 'recording') return;
    if (canvas.width === want.w && canvas.height === want.h) return;
    canvas.width = want.w; canvas.height = want.h;
    $('stage').style.aspectRatio = `${want.w}/${want.h}`;
  }
  function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } video.srcObject = null; }

  /* ---------- drawing ---------- */
  function drawFrame(reading, verdict, out) {
    const W = canvas.width, H = canvas.height, m = cfg().mirror;
    const q = quarterTurn(), t = turned(q);
    /* All of the picture, none of it stretched. A squashed body reads squashed
       angles, and every threshold in this app is an angle, so filling the canvas
       by distorting the frame would quietly corrupt every number on the screen.
       Bars at the sides are the honest answer. */
    const fit = Core.fitRect(t.w, t.h, W, H);
    ctx.save();
    if (m) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (q) {
      /* turned about the middle of where it is going: after the turn the frame's
         own width runs down the rectangle and its height across it */
      ctx.save();
      ctx.translate(fit.x + fit.w / 2, fit.y + fit.h / 2);
      ctx.rotate((q * Math.PI) / 2);
      ctx.drawImage(video, -fit.h / 2, -fit.w / 2, fit.h, fit.w);
      ctx.restore();
    } else {
      ctx.drawImage(video, fit.x, fit.y, fit.w, fit.h);
    }
    if (reading && reading.ok) drawBody(reading, verdict, t.w / t.h, fit);
    ctx.restore();
    drawHud(reading, verdict, out, W, H);
  }

  /* The points are in the VIDEO's square space (x already × the video's aspect),
     and the video occupies `fit` inside the canvas — so they are painted into that
     rectangle, not the whole canvas. Sizes scale with the picture rather than the
     canvas too, so a pillarboxed frame gets a skeleton that fits it. */
  function drawBody(r, v, A, fit) {
    const at = (p) => [fit.x + (p.x / A) * fit.w, fit.y + p.y * fit.h];
    const W = fit.w, H = fit.h;
    const s = Math.max(2, W / 320);
    const rad = Math.max(18, W * 0.045);
    const fs = Math.max(14, W * 0.032);
    const tone = (ok) => (ok == null ? C.dim : ok ? C.good : C.bad);
    const whole = !v.ok ? C.dim : v.inPosition ? C.good : C.bad;

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = C.shadow; ctx.shadowBlur = s * 2;
    ctx.lineWidth = s * 1.6; ctx.setLineDash([]);
    for (const [a, b] of move.bones) {
      const p = r.points[a], q = r.points[b]; if (!p || !q) continue;
      /* each part is drawn in the colour of the verdict that is about it */
      const owner = move.limb[a + '|' + b];
      ctx.strokeStyle = !v.ok ? C.dim : owner ? tone(v.good[owner]) : whole;
      ctx.beginPath(); ctx.moveTo(...at(p)); ctx.lineTo(...at(q)); ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.fillStyle = whole;
    for (const k of move.dots) {
      const p = r.points[k]; if (!p) continue; const [x, y] = at(p);
      ctx.beginPath(); ctx.arc(x, y, s * 1.5, 0, Math.PI * 2); ctx.fill();
    }

    /* what the move asks to be drawn, in terms that say nothing about which move it is */
    move.draw({
      /* a dashed line straight up (or down, for a negative share) from a point */
      plumb(p, share) {
        const [x, y] = at(p);
        ctx.setLineDash([s * 1.5, s * 2]); ctx.lineWidth = s * 0.8; ctx.strokeStyle = C.dim;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - fit.h * share); ctx.stroke(); ctx.setLineDash([]);
      },
      /* a dashed floor line through a point */
      floor(p) {
        const [x, y] = at(p);
        ctx.setLineDash([s * 1.5, s * 2]); ctx.lineWidth = s * 0.8; ctx.strokeStyle = C.dim;
        ctx.beginPath(); ctx.moveTo(x - r.facing * fit.w * 0.05, y); ctx.lineTo(x + r.facing * fit.w * 0.11, y); ctx.stroke(); ctx.setLineDash([]);
      },
      /* the straight line a joint is judged against, drawn end to end */
      guide(a, b, ok) {
        const p = at(a), q = at(b);
        ctx.setLineDash([s * 2.5, s * 2.5]); ctx.lineWidth = s * 0.9; ctx.strokeStyle = ok ? C.dim : C.bad;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]);
      },
      /* the angle at b between a and c */
      angleAt(b, a, c, deg, ok, k) {
        const [cx, cy] = at(b);
        const ang = (p) => { const [x, y] = at(p); return Math.atan2(y - cy, x - cx); };
        sweep(cx, cy, rad * k, ang(a), ang(c), tone(ok), s, `${Math.round(deg)}°`, fs);
      },
      /* the angle at `from` between a reference direction and `to`: a floor ray
         when `dir` is a facing, straight up when it is 0 */
      angleTo(from, to, dir, deg, ok, k) {
        const [cx, cy] = at(from), [tx, ty] = at(to);
        const a0 = dir === 'down' ? Math.PI / 2 : dir ? (dir > 0 ? 0 : Math.PI) : -Math.PI / 2;
        sweep(cx, cy, rad * k, a0, Math.atan2(ty - cy, tx - cx), tone(ok), s, `${Math.round(deg)}°`, fs);
      },
      /* a bare number beside a point, pushed clear on the side it is signed toward */
      readout(p, deg, ok, side) {
        const [x, y] = at(p);
        label(`${deg > 0 ? '+' : ''}${Math.round(deg)}°`, x, y + side * fs * 1.6, fs, tone(ok), cfg().mirror);
      },
    }, r, v);
  }

  /* An arc the short way round between two directions, with its number set on the
     bisector just outside it — so the number is plainly the label of that arc and
     the arc is plainly the angle, not its reflex. */
  function sweep(cx, cy, rad, a0, a1, colour, s, text, fs) {
    let d = a1 - a0;
    while (d < -Math.PI) d += Math.PI * 2; while (d > Math.PI) d -= Math.PI * 2;
    ctx.strokeStyle = colour; ctx.lineWidth = s * 1.1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a1, d < 0); ctx.stroke();
    const mid = a0 + d / 2, out = rad + fs * 0.95;
    label(text, cx + Math.cos(mid) * out, cy + Math.sin(mid) * out, fs, colour, cfg().mirror);
  }

  /* The body is drawn under a mirror when mirroring, which would write the text
     backwards. Flipping about the label's own x un-mirrors the glyphs and leaves
     the anchor where it is, so the same (x, y) means the same place on screen
     either way — and centred text needs no side-swap to go with it. */
  function label(text, x, y, size, colour, mirrored) {
    ctx.save();
    if (mirrored) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.translate(-x, -y); }
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.lineWidth = size * 0.28; ctx.strokeStyle = C.shadow; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawHud(r, v, out, W, H) {
    const pad = Math.round(W * 0.022), fs = Math.max(15, Math.round(W * 0.028));
    const live = r && r.ok;
    const edge = out.done ? C.good : !live ? C.dim : v.inPosition ? C.good : C.bad;
    ctx.strokeStyle = edge; ctx.lineWidth = Math.max(3, W * 0.006);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);

    const c = cfg();
    const line = (text, x, y, size, colour, align) => {
      ctx.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
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
    for (const b of move.bands) {
      const val = live && r[b.of] != null ? `${Math.round(r[b.of])}°` : '—';
      L(`${b.hud} ${val}`, `${b.note} ${bandText(b, c)}`, live ? (v.good[b.key] ? C.good : C.bad) : C.dim);
    }

    /* the countdown, which is what the set is */
    const R = stack(W - pad, 'right');
    const left = (out.leftMs / 1000).toFixed(1), target = out.targetMs / 1000;
    const under = out.done ? (move.reps ? `${out.repTarget} reps` : `${target} s held`)
      : move.reps ? `rep ${Math.min(out.reps + 1, out.repTarget)} of ${out.repTarget}` : `left of ${target} s`;
    const ry = R(out.done ? 'DONE' : `${left}s`, under, out.done || out.holding ? C.good : C.ink, 1.5);
    if (rec && rec.mr && rec.mr.state === 'recording') {
      line('REC', W - pad - fs * 0.9, ry, fs * 0.66, C.bad, 'right');
      ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(W - pad - fs * 0.33, ry + fs * 0.33, fs * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    /* the move's name, so the recording says what it is a recording of. Top centre,
       between the two stacks, because the bottom of the frame belongs to the cue. */
    line(move.name, W / 2, pad, fs * 0.66, C.dim, 'center');

    /* the cue, kept on screen a moment after it was said so the recording shows it */
    if (banner && performance.now() - banner.at < 2600) {
      const bh = fs * 2.2, y = H - bh - pad;
      ctx.font = `800 ${fs}px ui-sans-serif, system-ui, sans-serif`;
      const bw = Math.min(W - pad * 2, ctx.measureText(banner.text).width + fs * 3);
      ctx.fillStyle = 'rgba(13,17,23,.82)';
      ctx.beginPath(); ctx.roundRect((W - bw) / 2, y, bw, bh, bh / 2); ctx.fill();
      ctx.strokeStyle = banner.colour; ctx.lineWidth = Math.max(2, W * 0.003); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = banner.colour; ctx.fillText(banner.text, W / 2, y + bh / 2);
    }
  }

  /* ---------- the loop ---------- */
  function tick() {
    if (!running) return;
    schedule();
    const now = performance.now();
    let lm = null;
    /* `__poseSource` stands in for the model: the smoke test drives the whole
       picture-and-cue path with landmarks it made up, which is the only way to
       check the drawing, the voice and the recorder without a person and a wall.
       Unset in normal use. */
    if (window.__poseSource) lm = window.__poseSource(now - t0);
    else {
      if (!landmarker || video.readyState < 2) return;
      const ts = Math.max(now, lastTs + 1); lastTs = ts;
      try { const res = landmarker.detectForVideo(video, ts); lm = res.landmarks && res.landmarks[0] ? res.landmarks[0] : null; }
      catch { return; }
    }
    sizeCanvas();
    showFraming();
    /* the landmarks are shares of the video frame, turned the same way the picture
       is, so that is the space an angle has to be worked out in — the canvas may be
       a different shape entirely */
    const q = quarterTurn(), t = turned(q);
    const reading = smoother.apply(move.read(Core.rotateLandmarks(lm, q), t.w / t.h, coach.cfg));
    const out = coach.step(reading, now - t0);
    if (out.cue) fire(out.cue);
    drawFrame(reading, out.verdict, out);
    paintUi(reading, out.verdict, out);
    state = out;
  }
  function schedule() {
    if (video.requestVideoFrameCallback) raf = video.requestVideoFrameCallback(() => tick());
    else raf = requestAnimationFrame(() => tick());
  }
  function unschedule() {
    if (video.cancelVideoFrameCallback && raf) { try { video.cancelVideoFrameCallback(raf); } catch { } }
    cancelAnimationFrame(raf); raf = 0;
  }

  let framingNote = null;
  function showFraming() {
    const t = turned(quarterTurn());
    const msg = Core.framing(move.camera, t.w, t.h);
    if (msg === framingNote) return;
    framingNote = msg;
    const e = $('orient');
    e.textContent = msg || ''; e.hidden = !msg;
    if (msg) voice.say(msg);
  }

  function fire(cue) {
    const good = cue.id === 'hold' || cue.id === 'done' || /^call\d/.test(cue.id);
    const colour = good ? C.good : cue.id === 'lost' ? C.warn : C.bad;
    banner = { text: cue.text, colour, at: performance.now() };
    voice.say(cue.text); tone(toneFor(cue.id));
    const e = $('cue'); e.textContent = cue.text;
    e.className = 'cue ' + (good ? 'good' : cue.id === 'lost' ? 'warn' : 'bad');
  }

  function paintUi(r, v, out) {
    const c = cfg(), live = r && r.ok;
    for (const b of move.bands) {
      const x = live ? r[b.of] : null;
      $('v-' + b.key).textContent = x != null ? Math.round(x) : '—';
      $('read-' + b.key).className = 'read ' + (!live ? '' : v.good[b.key] ? 'good' : 'bad');
      if (x != null) $('pin-' + b.key).style.left = pct(x, b.scale[0], b.scale[1]) + '%';
    }
    /* the countdown: what is left, how much is banked, and how far along the bar is */
    const leftSec = out.leftMs / 1000, target = out.targetMs / 1000;
    $('hold-v').textContent = leftSec.toFixed(1);
    $('hold-k').textContent = out.done ? `${target} s done` : `left of ${target} s`;
    $('best-v').textContent = `held ${(out.holdMs / 1000).toFixed(1)} s · best ${(out.bestMs / 1000).toFixed(1)} s`;
    $('read-hold').className = 'read wide' + (out.done || out.holding ? ' good' : '');
    $('hold-pin').style.left = pct(out.holdMs, 0, out.targetMs) + '%';

    if (move.reps) {
      $('rep-v').textContent = out.reps;
      $('rep-k').textContent = PHASE[out.phase] || '';
      $('rep-pin').style.left = pct(out.reps, 0, out.repTarget) + '%';
      $('read-reps').className = 'read' + (out.done ? ' good' : '');
    }

    const chip = $('state');
    if (out.done) { chip.textContent = 'Done'; chip.className = 'chip good'; }
    else if (!live) { chip.textContent = 'Can’t see you'; chip.className = 'chip warn'; }
    else if (out.holding) { chip.textContent = `${Math.ceil(leftSec)} s left`; chip.className = 'chip good'; }
    else if (v.inPosition) { chip.textContent = 'Settling'; chip.className = 'chip good'; }
    else if (move.reps && out.phase !== 'up') { chip.textContent = `Rep ${out.reps + 1} of ${out.repTarget}`; chip.className = 'chip'; }
    else {
      /* the chip names the first band that is out, which is the one being coached */
      const bad = move.bands.find((b) => !v.good[b.key]);
      chip.textContent = bad ? bad.hud + ' off' : 'Adjust';
      chip.className = 'chip bad';
    }
  }
  const PHASE = { down: 'ready', up: 'holding', lower: 'lower slowly', done: 'set done' };

  /* ---------- recording ---------- */
  function pickMime() {
    const want = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const m of want) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  /* Asking a canvas for a stream at some frame rate means asking it to be sampled
     that often. The pose model takes long enough that the canvas is not repainted
     anything like that often, and what an encoder does with the shortfall is its
     own business: some repeat the last frame and the film comes out the right
     length, some write the frames they were given at the spacing they were
     promised, and the set plays back at three times the speed it was done at.

     So the frames are asked for on a clock instead. `captureStream(0)` hands over
     nothing until it is asked, and it is asked thirty times a real second, whatever
     the model is doing. One frame per tick of real time is a film the length of the
     thing it filmed, on any engine. Where a browser cannot be asked, the stream is
     left to emit on its own as the canvas changes, which at least carries real
     timestamps. */
  const REC_FPS = 30;
  function startRecording() {
    if (!window.MediaRecorder || !canvas.captureStream) return null;
    try {
      const a = initAudio();
      let s = canvas.captureStream(0), pump = 0;
      const vt = s.getVideoTracks()[0];
      if (vt && typeof vt.requestFrame === 'function') {
        pump = setInterval(() => { try { vt.requestFrame(); } catch { } }, 1000 / REC_FPS);
      } else {
        s.getTracks().forEach((t) => { try { t.stop(); } catch { } });
        s = canvas.captureStream();
      }
      if (a) for (const t of a.dest.stream.getAudioTracks()) s.addTrack(t);
      const mimeType = pickMime();
      const mr = new MediaRecorder(s, mimeType ? { mimeType, videoBitsPerSecond: 3.5e6 } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      /* no timeslice: one recording, written once, rather than a run of fragments
         glued together and hoped over */
      mr.start();
      return { mr, chunks, pump, mimeType: mimeType || 'video/webm' };
    } catch { return null; }
  }
  function stopRecording() {
    return new Promise((res) => {
      if (rec && rec.pump) { clearInterval(rec.pump); rec.pump = 0; }
      if (!rec || !rec.mr || rec.mr.state === 'inactive') return res(null);
      rec.mr.onstop = () => res(new Blob(rec.chunks, { type: rec.mimeType }));
      try { rec.mr.stop(); } catch { res(null); }
    });
  }
  function save(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  /* ---------- the set ---------- */
  async function begin() {
    const note = (t) => { $('veil-note').textContent = t; };
    $('go').disabled = true;
    try {
      note('Asking for the camera…'); await startCamera();
      if (!window.__poseSource) await loadModel(cfg().model, note);
    } catch (e) {
      $('veil-title').textContent = 'Could not start';
      $('veil-text').textContent = String(e && e.message || e).slice(0, 160) +
        ' — allow the camera for this page, and check you are on https.';
      $('go').disabled = false; note(''); return;
    }
    $('veil').hidden = true; note('');
    $('flip').disabled = false;
    running = true;
    /* Starting the camera IS starting the set. Asking for a second tap is asking
       someone to walk back to a phone they have just put on the floor. */
    startSet();
  }

  function startSet() {
    $('result').hidden = true; $('log').innerHTML = ''; $('cue').textContent = '';
    coach = new Core.Coach(move, cfg()); smoother = new Core.Smoother();
    banner = null; t0 = performance.now(); state = null;
    initAudio(); if (audio && audio.ac.state === 'suspended') audio.ac.resume();
    /* one call, not two: `fire` both says it and puts it on the picture, and a
       second `say` would cancel the first mid-word */
    fire({ id: 'start', text: move.start, t: 0 });
    rec = startRecording(); inSet = true;
    if (!raf) schedule();
    $('rec-note').textContent = rec ? '' : 'This browser will not record from a canvas, so there is no video to download.';
    $('startstop').disabled = false;
    $('startstop').textContent = 'Finish the set'; $('startstop').className = 'btn stop';
  }

  async function endSet() {
    inSet = false;
    const blob = await stopRecording();
    rec = rec ? Object.assign(rec, { blob }) : null;
    const s = coach.summary();
    $('r-move').textContent = move.name;
    $('r-hold').textContent = s.holdSec; $('r-best').textContent = s.bestSec;
    $('r-target').textContent = move.reps ? `${s.reps} of ${s.repTarget} reps` : `of ${s.targetSec}`;
    $('r-reps').hidden = !move.reps;
    $('r-reps-v').textContent = move.reps ? `${s.reps}/${s.repTarget}` : '';
    $('r-cues').textContent = Object.values(s.cues).reduce((a, b) => a + b, 0);
    $('log').innerHTML = s.log.map((c) => `<li><b>${(c.t / 1000).toFixed(1)}s</b> — ${esc(c.text)}</li>`).join('') ||
      '<li>Nothing needed saying.</li>';
    $('dl-video').disabled = !blob;
    if (blob) $('rec-note').textContent = `${(blob.size / 1e6).toFixed(1)} MB · ${blob.type.split(';')[0]} · the spoken cues are on it as tones and as text on the picture.`;
    $('result').hidden = false;
    $('startstop').textContent = 'Start another set'; $('startstop').className = 'btn primary';
    voice.say(move.reps ? `Set done. ${s.reps} of ${s.repTarget} reps.`
      : s.reachedTarget ? `Set done. You held the full ${s.targetSec} seconds.`
        : s.holdSec >= 1 ? `Set done. ${Math.round(s.holdSec)} of ${s.targetSec} seconds in position.` : 'Set done.');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- wiring ---------- */
  $('go').onclick = () => {
    /* before any await: this is the only moment the browser counts as a gesture */
    voice.prime();
    const a = initAudio(); if (a && a.ac.state === 'suspended') a.ac.resume();
    begin();
  };
  $('startstop').onclick = () => (inSet ? endSet() : startSet());
  $('move').onchange = async () => {
    move = Moves[$('move').value] || Moves.wallsit;
    buildSettings(); buildReads(); saveSettings();
    $('veil-title').textContent = move.name;
    /* finish whatever was under way, then start again from this exercise's own
       coach — otherwise the readouts keep being painted by the last one, with its
       bands and its clock, until something else happens to replace it */
    if (inSet) await endSet();
    coach = new Core.Coach(move, cfg()); smoother = new Core.Smoother();
    banner = null; state = null; t0 = performance.now();
    syncBands();
    /* a move that wants a different shape of frame gets the camera asked again */
    if (running && (move.camera || null) !== camShape) {
      unschedule();
      try { await startCamera(); } catch { }
      framingNote = undefined;
      if (running) schedule();
    } else sizeCanvas(true);
  };
  $('flip').onclick = async () => {
    camFacing = camFacing === 'user' ? 'environment' : 'user';
    unschedule(); try { await startCamera(); } catch { } if (running) schedule();
  };
  if (!voice.ok) { $('mute').textContent = 'No voice here'; $('mute').disabled = true; }
  $('mute').onclick = (e) => {
    voice.on = !voice.on; e.target.setAttribute('aria-pressed', String(!voice.on));
    e.target.textContent = voice.on ? 'Voice on' : 'Voice off';
    if (!voice.on && 'speechSynthesis' in window) speechSynthesis.cancel();
  };
  $('settings-btn').onclick = (e) => {
    const p = $('settings'); p.hidden = !p.hidden; e.target.setAttribute('aria-expanded', String(!p.hidden));
  };
  for (const k of COMMON_KEYS.concat(PER_MOVE)) if (k !== 'model') $('cfg-' + k).onchange = saveSettings;
  $('cfg-rotate').onchange = () => { saveSettings(); sizeCanvas(true); framingNote = undefined; };
  $('cfg-model').onchange = async () => {
    saveSettings();
    if (!landmarker) return;
    unschedule(); $('state').textContent = 'Swapping model…';
    try { await loadModel(cfg().model, () => { }); } catch { }
    if (running) schedule();
  };
  $('dl-video').onclick = () => {
    if (!rec || !rec.blob) return;
    save(rec.blob, `${move.id}-${stamp()}.${rec.blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  };
  $('dl-log').onclick = () => {
    const s = coach ? coach.summary() : { log: [], targetSec: 0, holdSec: 0, bestSec: 0 };
    const c = cfg();
    const bands = move.bands.map((b) => `${b.label} ${bandText(b, c)}°`).join(', ');
    const body = [`${move.name} — ${new Date().toLocaleString()}`, bands,
      move.reps ? `${s.reps} of ${s.repTarget} reps, ${s.targetSec}s each — in position ${s.holdSec}s, longest hold ${s.bestSec}s`
        : `target ${s.targetSec}s — in position ${s.holdSec}s${s.reachedTarget ? ' (reached)' : ''}, longest hold ${s.bestSec}s`, '',
      ...s.log.map((c2) => `${(c2.t / 1000).toFixed(1)}s\t${c2.text}`)].join('\n');
    save(new Blob([body], { type: 'text/plain' }), `${move.id}-${stamp()}.txt`);
  };
  /* turning the phone over changes the frame the camera gives, and the browser
     reports it here rather than through any event on the stream */
  video.addEventListener('resize', () => { sizeCanvas(); framingNote = undefined; });
  window.addEventListener('orientationchange', () => setTimeout(() => { sizeCanvas(); framingNote = undefined; }, 300));
  window.addEventListener('pagehide', () => { unschedule(); stopCamera(); });

  loadSettings();
  $('veil-title').textContent = move.name;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('veil-title').textContent = 'No camera here';
    $('veil-text').textContent = 'This needs a browser with camera access, served over https.';
    $('go').disabled = true;
  }
  window.__app = { get coach() { return coach; }, get move() { return move; }, get state() { return state; },
    get blob() { return rec && rec.blob; }, cfg, fire, drawFrame, paintUi };
})();
