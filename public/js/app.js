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
  /* the model in its own thread: the frame most recently read, and whether one is
     out being read now */
  let worker = null, latestLm = null, inFlight = false, seq = 0;
  let stream = null, camFacing = 'user';   // the front camera: it is the one you can see while you set the phone down
  let running = false, raf = 0, lastTs = 0;
  let coach = null, smoother = null, state = null;
  let banner = null;                      // the cue painted on the frame, and when it appeared
  let rec = null, inSet = false;          // the film under way (see startRecording), and whether a session is
  /* the session: which set this is, the ones done, and whether the last one has
     ended with the next not yet begun — the camera and the film run on through
     that, the coaching does not */
  let setNo = 0, setsDone = [], between = false;
  let audio = null;                       // WebAudio graph: speakers + a track for the recording
  let t0 = 0;

  /* ---------- settings ----------
     Remembered in the browser, but a band the app itself has changed its mind
     about is not the person's setting — it is a stale default. The version is
     bumped whenever a default moves, and a store written under an older one is
     dropped rather than silently holding the old band on a page that says it
     uses the new one. */
  const SETTINGS_V = 7;
  const COMMON_KEYS = ['cool', 'model', 'mirror', 'rotate', 'angles'];
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
    const own = Object.assign({}, Core.COMMON, move.defaults);
    for (const s of settingsOf(move)) c[s.key] = num('cfg-' + s.key, own[s.key]);
    /* the time calls are typed as a list, so anything unreadable falls back
       rather than silently leaving the set with no calls in it */
    const calls = String(($('cfg-calls') || {}).value || '').split(/[^\d]+/).map(Number).filter((x) => x > 0);
    c.cooldownMs = num('cfg-cool', 4) * 1000;
    c.holdTargetSec = Math.max(1, num('cfg-target', c.holdTargetSec));
    c.callAtSec = (calls.length ? calls : c.callAtSec).sort((a, b) => b - a);
    c.model = $('cfg-model').value;
    c.mirror = $('cfg-mirror').value === 'on';
    c.rotate = $('cfg-rotate').value;
    c.angles = $('cfg-angles').value === 'on';
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
      input.value = mine[s.key] != null ? mine[s.key] : fallback[s.key];
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
      const { lo, hi } = bandRange(b, c);
      $('band-' + b.key).textContent = bandText(b, c);
      $('ok-' + b.key).style.left = pct(lo, b.scale[0], b.scale[1]) + '%';
      $('ok-' + b.key).style.width = (pct(hi, b.scale[0], b.scale[1]) - pct(lo, b.scale[0], b.scale[1])) + '%';
    }
    /* between sets the clock shows the whole of whatever this exercise asks for */
    if (!inSet) { $('hold-v').textContent = c.holdTargetSec.toFixed(1); $('hold-k').textContent = `left of ${c.holdTargetSec} s`; }
    $('target-label').textContent = move.holdLabel || 'Hold the set for';
    $('r-target').textContent = `of ${c.holdTargetSec}`;
    $('veil-text').textContent = move.hint + ' The camera never leaves this device.';
    /* the move, drawn: on the start screen and on the page */
    const fig = window.Figure ? Figure.svg(move) : '';
    $('veil-fig').innerHTML = fig; $('demo').innerHTML = fig ? `<h2>${move.name}</h2>${fig}` : '';
    $('demo').hidden = !fig;
  }
  /* A band is two edges (lo, hi), a symmetric one (sym), or one edge with the
     other end of the meter as the other (min: at least; max: at most). */
  function bandRange(b, c) {
    if (b.sym) return { lo: -c[b.sym], hi: c[b.sym] };
    if (b.min) return { lo: c[b.min], hi: b.scale[1] };
    if (b.max) return { lo: b.scale[0], hi: c[b.max] };
    return { lo: c[b.lo], hi: c[b.hi] };
  }
  /* "-5–15" reads as a subtraction, so a band that starts below zero is spelt out */
  function bandText(b, c) {
    if (b.sym) return `±${c[b.sym]}`;
    if (b.min) return `≥ ${c[b.min]}`;
    if (b.max) return `≤ ${c[b.max]}`;
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
     Every cue also gets a short tone: something to hear from across the room
     that is not words, at the moment the words start. Where the film is made by
     the browser's own recorder (see startRecording) the tones are mixed into it
     too, since it cannot capture the browser's speech; the film the page writes
     itself is silent, with the cues on the picture. */
  function initAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const ac = new AC();
    const out = ac.createGain(); out.gain.value = 0.18; out.connect(ac.destination);
    /* the bus is what the film hears: the tones, and the microphone once there is one.
       It goes to a stream (for the browser's own recorder) and is read as samples
       (for the encoder); it never goes to the speaker */
    const bus = ac.createGain(); bus.gain.value = 1; out.connect(bus);
    const dest = ac.createMediaStreamDestination(); bus.connect(dest);
    audio = { ac, out, bus, dest, mic: null, micTrack: null };
    return audio;
  }
  /* the camera's stream came with a microphone track: put it on the bus */
  function hearMic() {
    const a = initAudio(); if (!a || !stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track || track === a.micTrack) return;
    if (a.mic) { try { a.mic.disconnect(); } catch { } }
    try { a.mic = a.ac.createMediaStreamSource(new MediaStream([track])); a.mic.connect(a.bus); a.micTrack = track; }
    catch { a.mic = null; a.micTrack = null; }
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

  /* ---------- the pose model ----------
     In its own thread wherever the browser allows it, so that the page's thread
     only ever draws. On the page's own thread the model stops everything for as
     long as a frame takes to read, the canvas is repainted only when it is let,
     and the recording carries each real frame three or four times over. */
  async function loadModel(want, note) {
    if (loadedModel === want && (worker || landmarker)) return;
    if (await loadInWorker(want, note)) return;
    await loadInline(want, note);
  }
  function loadInWorker(want, note) {
    return new Promise((res) => {
      if (!window.Worker || !window.createImageBitmap) return res(false);
      note('Loading the pose engine…');
      let w = worker;
      try { if (!w) w = new Worker('js/pose-worker.js?v=' + Core.VER, { type: 'module' }); }
      catch { return res(false); }
      const giveUp = setTimeout(() => finish(false), 45000);
      const finish = (ok) => {
        clearTimeout(giveUp);
        if (ok) { worker = w; loadedModel = want; note(''); w.onmessage = onPose; }
        else { try { w.terminate(); } catch { } if (worker === w) worker = null; }
        res(ok);
      };
      w.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'ready') finish(true);
        else if (m.type === 'error') finish(false);
      };
      w.onerror = () => finish(false);
      note(`Loading the ${want} pose model…`);
      w.postMessage({ type: 'load', model: want });
    });
  }
  function onPose(e) {
    const m = e.data || {};
    if (m.type === 'pose') { latestLm = m.lm; inFlight = false; }
  }
  async function loadInline(want, note) {
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
  /* Almost every browser hands over the camera frame the way the phone is being
     held, and a picture that is already upright must not be turned — doing it on a
     hunch is how an app takes something correct and lays it on its side. So nothing
     is turned unless it is asked for. The few devices that really do give the
     sensor's own frame regardless of the phone get this setting, which also turns
     the landmarks, because an angle read off a sideways frame is a sideways angle. */
  function quarterTurn() {
    const pick = cfg().rotate;
    return pick === 'right' ? 1 : pick === 'left' ? 3 : 0;
  }
  /* the frame's size once it has been turned */
  const turned = (q) => (q % 2
    ? { w: video.videoHeight || 720, h: video.videoWidth || 1280 }
    : { w: video.videoWidth || 1280, h: video.videoHeight || 720 });

  let camShape = null;              // the frame shape the running camera was asked for
  /* The camera is asked for the same thing whatever the exercise: the sensor's own
     landscape resolution, and nothing about which way up.

     Width and height in a camera request describe the SENSOR's frame, before the
     phone turns it to match how it is being held. A phone stood on its end turns a
     1280×720 capture into a 720×1280 picture by itself. Ask it for 720×1280 instead
     and it obliges by cropping a tall strip out of the sensor — which it then turns,
     the same as always, into a wide band on screen with the head and feet gone.
     That is the landscape picture with the legs missing, and it was this request
     that caused it. So the shape is left to the phone: it knows which way up it is,
     and the exercise only says in words which way up it would like to be. */
  const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 } };
  let lastCameraRequest = null;
  async function startCamera() {
    stopCamera();
    camShape = move.camera || null;
    /* the microphone too, with the browser's clean-up turned off: echo cancellation
       is built to remove the phone's own speaker from the microphone, and the spoken
       cues come out of that speaker — they are the sound the film is for */
    const want = { video: Object.assign({ facingMode: camFacing }, CAMERA),
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
    lastCameraRequest = want;
    try { stream = await navigator.mediaDevices.getUserMedia(want); }
    catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: want.video, audio: false }); }
      catch { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
    }
    hearMic();
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => (video.videoWidth ? r() : (video.onloadedmetadata = r)));
    sizeCanvas(true);
  }

  /* The canvas is the frame the camera gave, the same way up. Nothing is forced
     into a shape it is not: a portrait frame makes a portrait canvas and fills it,
     and a move that wanted the other shape says so in words rather than by leaving
     the picture in a letterbox. The stage is given that shape and a width to match
     the height it is allowed, so the picture on screen is the picture exactly.

     The size is chosen once and then left alone while a set is running: a file that
     changes shape halfway through is not one most players will take. Between sets it
     follows the camera, which is how turning the phone over takes effect. */
  function sizeCanvas(force) {
    const t = turned(quarterTurn());
    if (!t.w || !t.h) return;
    if (!force && rec && rec.live) return;
    if (canvas.width === t.w && canvas.height === t.h) return;
    canvas.width = t.w; canvas.height = t.h;
    const stage = $('stage');
    stage.style.aspectRatio = `${t.w}/${t.h}`;
    stage.style.maxWidth = `calc(var(--stage-h) * ${t.w} / ${t.h})`;
  }
  function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } video.srcObject = null; }

  /* ---------- drawing ---------- */
  let painted = 0;                        // how many times the canvas has been drawn, so a film takes no frame twice
  function drawFrame(reading, verdict, out) {
    painted++;
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

    /* what the move asks to be drawn — the angles, arcs and guide lines — only
       when asked for: the skeleton's colour says what is off, and the words do */
    if (cfg().angles) move.draw({
      /* a dashed line straight up (or down, for a negative share) from a point */
      plumb(p, share) {
        const [x, y] = at(p);
        ctx.setLineDash([s * 1.5, s * 2]); ctx.lineWidth = s * 0.8; ctx.strokeStyle = C.dim;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - fit.h * share); ctx.stroke(); ctx.setLineDash([]);
      },
      /* a dashed floor line through a point, run mostly the way the body faces, or
         the other way for a negative `dir` */
      floor(p, dir) {
        const [x, y] = at(p), f = r.facing * (dir || 1);
        ctx.setLineDash([s * 1.5, s * 2]); ctx.lineWidth = s * 0.8; ctx.strokeStyle = C.dim;
        ctx.beginPath(); ctx.moveTo(x - f * fit.w * 0.05, y); ctx.lineTo(x + f * fit.w * 0.11, y); ctx.stroke(); ctx.setLineDash([]);
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
    if (c.angles) for (const b of move.bands) {
      const val = live && r[b.of] != null ? `${Math.round(r[b.of])}°` : '—';
      L(`${b.hud} ${val}`, `${b.note} ${bandText(b, c)}`, live ? (v.good[b.key] ? C.good : C.bad) : C.dim);
    }
    /* which set this is */
    if (setNo) L(`SET ${setNo} of ${c.setCount}`, out.between ? 'done' : '', out.between ? C.good : C.dim);

    /* the countdown, which is what the set is */
    const R = stack(W - pad, 'right');
    const left = (out.leftMs / 1000).toFixed(1), target = out.targetMs / 1000;
    const under = out.done ? (move.reps ? `${out.repTarget} reps` : `${target} s held`)
      : move.reps ? `rep ${Math.min(out.reps + 1, out.repTarget)} of ${out.repTarget}` : `left of ${target} s`;
    const ry = R(out.done || out.between ? 'DONE' : `${left}s`, under, out.done || out.between || out.holding ? C.good : C.ink, 1.5);
    if (rec && rec.live) {
      line('REC', W - pad - fs * 0.9, ry, fs * 0.66, C.bad, 'right');
      ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(W - pad - fs * 0.33, ry + fs * 0.33, fs * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    /* the move's name, so the recording says what it is a recording of. Top centre,
       between the two stacks, because the bottom of the frame belongs to the cue. */
    line(move.name, W / 2, pad, fs * 0.66, C.dim, 'center');

    /* every fault present right now, in words, above the cue: the voice keeps to
       one thing at a time, the picture need not */
    const words = out.between ? (setNo >= c.setCount ? 'All sets done' : `Set ${setNo} done \u2014 tap Next set when you are ready`) : faultWords(out);
    if (words) {
      ctx.font = `700 ${fs * 0.62}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const y = H - fs * 2.2 - pad - fs * 0.7;
      ctx.lineWidth = fs * 0.18; ctx.strokeStyle = C.shadow; ctx.lineJoin = 'round';
      ctx.strokeText(words, W / 2, y); ctx.fillStyle = out.between ? C.good : C.bad; ctx.fillText(words, W / 2, y);
    }
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

  /* the faults present this frame, as short words joined by dots */
  function faultWords(out) {
    if (!out || !out.active || !out.active.length || !coach) return '';
    return out.active.map((id) => { const c = coach.cues[id]; return (c && (c.label || c.text)) || id; }).join('  \u00b7  ');
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
    else if (worker) {
      if (video.readyState < 2) return;
      /* hand the model this frame if it is free, and draw with what it last said:
         the picture is painted at the camera's rate whatever the model is doing */
      if (!inFlight) {
        inFlight = true;
        const ts = Math.max(now, lastTs + 1); lastTs = ts;
        const n = ++seq;
        createImageBitmap(video)
          .then((bmp) => worker.postMessage({ type: 'frame', bitmap: bmp, ts, seq: n }, [bmp]))
          .catch(() => { inFlight = false; });
      }
      lm = latestLm;
    } else {
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
    let out;
    if (between) {
      /* the set is over and the next has not begun: the picture and the skeleton go
         on, nothing is judged and nothing is said */
      out = Object.assign({}, state || {}, { cue: null, active: [], holding: false, between: true, verdict: { ok: !!(reading && reading.ok), good: {}, faults: {}, inPosition: false } });
    } else {
      out = coach.step(reading, now - t0);
      if (out.cue) fire(out.cue);
    }
    drawFrame(reading, out.verdict, out);
    paintUi(reading, out.verdict, out);
    state = out;
    /* the target reached ends the set by itself */
    if (!between && out.done) finishSet();
  }
  /* paced by the camera where the browser allows, and held to about the camera's
     rate where it must fall back to the display's, which on a phone can be four
     times faster and has nothing new to show */
  let lastTick = 0;
  function schedule() {
    if (video.requestVideoFrameCallback) raf = video.requestVideoFrameCallback(() => tick());
    else raf = requestAnimationFrame((t) => {
      if (t - lastTick < 1000 / 32) { schedule(); return; }
      lastTick = t; tick();
    });
  }
  function unschedule() {
    if (video.cancelVideoFrameCallback && raf) { try { video.cancelVideoFrameCallback(raf); } catch { } }
    cancelAnimationFrame(raf); raf = 0;
  }

  let framingNote = null, framingMsg = null, pageMode = false;
  function showFraming() {
    const t = turned(quarterTurn());
    const msg = framingMsg = Core.framing(move.camera, t.w, t.h);
    applyFull();
    if (msg === framingNote) return;
    framingNote = msg;
    const e = $('orient');
    e.textContent = msg || ''; e.hidden = !msg;
    if (msg) voice.say(msg);
  }
  /* The right way round, with a set under way: the picture takes the screen. The
     page can be asked for back — to reach the settings, the voice, the other
     camera — and comes back to the picture on a tap, or at the next set. */
  function applyFull() {
    const can = inSet && running && !framingMsg;
    setFull(can && !pageMode);
    $('full-btn').hidden = !(can && pageMode);
  }
  function setFull(on) {
    if (document.body.classList.contains('full') === !!on) return;
    document.body.classList.toggle('full', !!on);
    if (on) window.scrollTo(0, 0);
  }
  /* The frame changed shape while a set was running — the phone was turned the way
     the exercise asked for. The canvas takes the new shape, and the film, which
     cannot change shape, is started again from here: what was filmed before was a
     phone being turned. */
  let refilm = Promise.resolve();
  function reshapeMidSet() {
    const t = turned(quarterTurn());
    if (!inSet || !t.w || !t.h || (canvas.width === t.w && canvas.height === t.h)) return;
    refilm = refilm.then(async () => {
      if (rec) { try { await rec.stop(); } catch { } }
      sizeCanvas(true);
      rec = inSet ? startRecording() : null;
    });
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

    $('faults').textContent = faultWords(out);
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

  /* ---------- recording ----------
     Two ways to make the film, tried in this order.

     1. The page encodes the frames itself. Thirty times a real second a frame is
        taken from the canvas, stamped with the clock's time and handed to a
        WebCodecs encoder; at the end the encoded frames are written into an MP4
        by mp4.js with those times as their durations. A recording of a real set
        on a phone showed why: the browser's own recorder was given distinct frames
        at thirty a second and wrote a hundred and thirty of them as two
        milliseconds apart, with the sound track stopping after a second — the
        frames were right and the recorder's clock was not. Here nothing but the
        page's clock times anything, and the file carries its length in its
        header, so a player shows it. It is silent: the cues are on the picture as
        text.

     2. Where the browser has no encoder to hand over, its MediaRecorder takes a
        stream from the canvas, fed one frame per tick of the same clock, with the
        cue tones mixed in. MP4 where it can write one, WebM where it cannot. */
  const REC_FPS = 30;
  /* H.264 first, for every player; the levels cover a phone's frame at thirty a
     second and a larger one. VP9 in MP4 where H.264 cannot be encoded, which is
     the open-source browser build the tests run in. */
  const CODECS = [
    ['avc1.42E01F', 'avc'], ['avc1.42E028', 'avc'], ['avc1.42E02A', 'avc'],
    ['avc1.4D401F', 'avc'], ['avc1.4D4028', 'avc'], ['avc1.64001F', 'avc'], ['avc1.640028', 'avc'], ['avc1.64002A', 'avc'],
    ['vp09.00.31.08', 'vp9'], ['vp09.00.40.08', 'vp9'], ['vp09.00.51.08', 'vp9'],
  ];
  async function pickCodec(w, h) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || !window.Mp4) return null;
    for (const [codec, kind] of CODECS) {
      const config = { codec, width: w, height: h, bitrate: 3.5e6, framerate: REC_FPS, latencyMode: 'realtime' };
      if (kind === 'avc') config.avc = { format: 'avc' };
      try { const r = await VideoEncoder.isConfigSupported(config); if (r && r.supported) return { config, kind, codec }; }
      catch { }
    }
    return null;
  }
  function pickMime() {
    const want = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const m of want) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  const bytesOf = (d) => d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));

  /* The sound for the film the page writes itself: the bus (microphone and tones)
     read as samples and handed to an AAC encoder, stamped on the same clock as
     the picture. Where the browser has no AAC encoder the film is silent, and
     says so. */
  async function pickSound(sampleRate) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
    const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 1, bitrate: 96000 };
    try { const r = await AudioEncoder.isConfigSupported(config); return r && r.supported ? config : null; }
    catch { return null; }
  }
  function startSound(start, film) {
    const a = initAudio(); if (!a) return null;
    const sr = a.ac.sampleRate, packets = []; let enc = null, desc = null, tap = null, sink = null, frames = 0, ts0 = null;
    const ready = (async () => {
      const config = await pickSound(sr);
      if (!config || !film.live) return;
      enc = new AudioEncoder({
        output: (chunk, meta) => {
          const dc = meta && meta.decoderConfig;
          if (dc && dc.description && !desc) desc = bytesOf(dc.description);
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          packets.push({ data, ts: chunk.timestamp, key: true });
        },
        error: (e) => { film.why = film.why || e; },
      });
      enc.configure(config);
      /* a script processor is the one way to read a graph as samples that every
         browser has; the sink it needs to run is silent */
      tap = a.ac.createScriptProcessor(4096, 1, 1);
      sink = a.ac.createGain(); sink.gain.value = 0; tap.connect(sink); sink.connect(a.ac.destination);
      tap.onaudioprocess = (e) => {
        if (!enc || enc.state !== 'configured') return;
        const ch = e.inputBuffer.getChannelData(0);
        const n = ch.length;
        /* the first buffer's samples were taken over the last buffer-length of
           time; every later buffer follows on by its own length, sample for sample */
        if (ts0 == null) ts0 = Math.max(0, Math.round((performance.now() - start) * 1000 - n * 1e6 / sr));
        const ts = ts0 + Math.round(frames * 1e6 / sr);
        try {
          const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 1, timestamp: ts, data: new Float32Array(ch) });
          enc.encode(ad); ad.close();
        } catch (err) { film.why = film.why || err; }
        frames += n;
      };
      a.bus.connect(tap);
      film.sound = true;
    })();
    return {
      ready,
      async stop() {
        await ready;
        if (tap) { try { a.bus.disconnect(tap); tap.disconnect(); sink.disconnect(); } catch { } tap.onaudioprocess = null; }
        if (!enc) return null;
        try { if (enc.state === 'configured') await enc.flush(); } catch (e) { film.why = film.why || e; }
        try { enc.close(); } catch { }
        return packets.length ? { sampleRate: sr, channels: 1, description: desc, samples: packets, bitrate: 96000 } : null;
      },
    };
  }

  /* The film under way. `live` while frames are being taken — the canvas keeps its
     shape for as long as that is so. `kind` is which of the two ways is making it,
     once that is known. `stop()` gives the file, or null with `why` saying what
     went wrong. */
  function startRecording() {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return null;
    const film = { live: true, kind: '', taken: 0, dropped: 0, blob: null, why: null, mime: '', sound: false };
    const samples = []; let enc = null, desc = null, pick = null, start = 0, pump = 0, lastPainted = -1, sound = null;
    let mr = null, recTrack = null; const chunks = [];

    /* one frame, now, at the clock's time — if the canvas has been drawn since the
       last one. A page stalled by the model fires its late timer ticks in a bunch
       when it comes back, and two ticks two milliseconds apart would put the same
       picture in the film twice, stamped as two frames; the frame before a stall
       covers the stall instead. The encoder is likewise left to catch up if it
       has fallen behind: a frame not taken is time the frame before it covers. */
    const snap = () => {
      if (!enc || enc.state !== 'configured' || painted === lastPainted) return;
      if (enc.encodeQueueSize > 3) { film.dropped++; return; }
      lastPainted = painted;
      let f = null;
      try {
        f = new VideoFrame(canvas, { timestamp: Math.round((performance.now() - start) * 1000) });
        enc.encode(f, { keyFrame: film.taken % (REC_FPS * 2) === 0 });
        film.taken++;
      } catch (e) { film.why = film.why || e; }
      finally { if (f) { try { f.close(); } catch { } } }
    };
    const viaRecorder = () => {
      if (!window.MediaRecorder || !canvas.captureStream) { film.why = new Error('no encoder and no recorder in this browser'); return; }
      try {
        const a = initAudio();
        let s = canvas.captureStream(0);
        const vt = s.getVideoTracks()[0];
        if (vt && typeof vt.requestFrame === 'function') {
          recTrack = vt;
          pump = setInterval(() => { try { recTrack.requestFrame(); } catch { } }, 1000 / REC_FPS);
        } else {
          s.getTracks().forEach((t) => { try { t.stop(); } catch { } });
          s = canvas.captureStream();
        }
        if (a) for (const t of a.dest.stream.getAudioTracks()) s.addTrack(t);
        const mimeType = pickMime();
        mr = new MediaRecorder(s, mimeType ? { mimeType, videoBitsPerSecond: 3.5e6 } : undefined);
        mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        /* no timeslice: one recording, written once, rather than a run of fragments
           glued together and hoped over */
        mr.start();
        film.kind = 'recorder'; film.mime = mimeType || 'video/webm';
      } catch (e) { film.why = e; mr = null; }
    };
    const ready = (async () => {
      try { pick = await pickCodec(w, h); } catch { pick = null; }
      if (!film.live) return;
      if (!pick) return viaRecorder();
      enc = new VideoEncoder({
        output: (chunk, meta) => {
          const dc = meta && meta.decoderConfig;
          if (dc && dc.description && !desc) desc = bytesOf(dc.description);
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          samples.push({ data, ts: chunk.timestamp, key: chunk.type === 'key' });
        },
        error: (e) => { film.why = film.why || e; },
      });
      enc.configure(pick.config);
      film.kind = 'codec'; film.mime = 'video/mp4'; start = performance.now();
      pump = setInterval(snap, 1000 / REC_FPS);
      sound = startSound(start, film);
    })();

    film.stop = async () => {
      film.live = false;
      if (pump) { clearInterval(pump); pump = 0; }
      recTrack = null;
      await ready;
      if (enc) {
        try { if (enc.state === 'configured') await enc.flush(); } catch (e) { film.why = film.why || e; }
        try { enc.close(); } catch { }
        let audioTrack = null;
        if (sound) { try { audioTrack = await sound.stop(); } catch (e) { film.why = film.why || e; } }
        film.sound = !!audioTrack;
        if (!samples.length) { film.why = film.why || new Error('the encoder gave nothing back'); return null; }
        try {
          const file = Mp4.write({ width: w, height: h, codec: pick.kind, description: desc, codecString: pick.codec, samples, created: new Date(), audio: audioTrack });
          return new Blob([file], { type: 'video/mp4' });
        } catch (e) { film.why = e; return null; }
      }
      if (mr && mr.state !== 'inactive') {
        return new Promise((res) => {
          mr.onstop = () => res(new Blob(chunks, { type: film.mime }));
          try { mr.stop(); } catch { res(null); }
        });
      }
      return null;
    };
    return film;
  }
  function save(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  /* ---------- keeping the screen on ----------
     A phone stood on the floor is not being touched, and a phone not being touched
     turns its screen off inside a minute. When it does, the page is hidden: nothing
     is drawn, the camera may be paused, and the film has nothing to take. A set
     ends by itself unseen. So a wake lock is held for as long as a set runs, and
     taken again if the page comes back into view with one still running. */
  let wake = null;
  async function stayAwake() {
    if (wake || !navigator.wakeLock) return;
    try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    catch { wake = null; }
  }
  function letSleep() { if (wake) { try { wake.release(); } catch { } wake = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (inSet) { stayAwake(); if (running && !raf) schedule(); }
      if (hidAt && inSet) fire({ id: 'lost', text: 'The screen went off — that part of the set was not seen', t: 0 });
      hidAt = 0;
    } else if (inSet) hidAt = performance.now();
  });
  let hidAt = 0;

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

  /* A session is a number of sets. The first set starts the film and the wake
     lock; each set after it is a fresh coach on the same film. */
  function startSet() {
    const fresh = !inSet;
    if (fresh) { setNo = 1; setsDone = []; $('result').hidden = true; $('log').innerHTML = ''; }
    else setNo += 1;
    between = false;
    $('cue').textContent = ''; $('faults').textContent = '';
    coach = new Core.Coach(move, cfg()); smoother = new Core.Smoother();
    banner = null; t0 = performance.now(); state = null;
    initAudio(); if (audio && audio.ac.state === 'suspended') audio.ac.resume();
    /* one call, not two: `fire` both says it and puts it on the picture, and a
       second `say` would cancel the first mid-word */
    fire({ id: 'start', text: fresh ? move.start
      : `Set ${setNo} of ${cfg().setCount}${move.alternate ? ' \u2014 the other leg' : ''}. ${move.reps ? 'When you are ready.' : 'Into position when you are ready.'}`, t: 0 });
    if (fresh) { rec = startRecording(); inSet = true; stayAwake(); }
    pageMode = false;
    if (!raf) schedule();
    $('rec-note').textContent = rec ? '' : 'The camera has not given a picture yet, so there is nothing to film.';
    buttons();
  }
  /* what the buttons say: end this set, go on to the next, or finish */
  function buttons() {
    const last = setNo >= cfg().setCount;
    $('startstop').disabled = false;
    if (!inSet) { $('startstop').textContent = 'Start another session'; $('startstop').className = 'btn primary'; $('endall').hidden = true; $('finish-full').textContent = 'Start'; $('endall-full').hidden = true; }
    else if (between) { $('startstop').textContent = 'Next set'; $('startstop').className = 'btn primary'; $('endall').hidden = false; $('finish-full').textContent = 'Next set'; $('endall-full').hidden = false; }
    else { $('startstop').textContent = last ? 'End the last set' : 'End this set'; $('startstop').className = 'btn stop'; $('endall').hidden = true; $('finish-full').textContent = last ? 'End the last set' : 'End this set'; $('endall-full').hidden = true; }
  }
  /* The set is over — the target reached, or ended by hand. Nothing is said from
     here until the next set begins: the count or the done call was the last word.
     After the last set the session finishes by itself. */
  function finishSet() {
    if (!inSet || between) return;
    const s = coach.summary();
    setsDone.push(s);
    /* the last word stays on screen; the faults do not */
    between = true;
    $('faults').textContent = '';
    if ('speechSynthesis' in window && !s.reachedTarget) speechSynthesis.cancel();
    if (setNo >= cfg().setCount) { endSession(); return; }
    buttons();
  }

  /* The session is over: the film stops, the sets are added up, the results show. */
  async function endSession() {
    if (!inSet) return;
    if (!between) setsDone.push(coach.summary());
    inSet = false; between = false; letSleep(); applyFull();
    await refilm;
    const blob = rec ? await rec.stop() : null;
    if (rec) rec.blob = blob;
    const sets = setsDone, n = sets.length;
    const sum = (k) => +sets.reduce((a, s) => a + s[k], 0).toFixed(1);
    $('r-move').textContent = `${move.name} — ${n} set${n === 1 ? '' : 's'}`;
    $('r-hold').textContent = sum('holdSec'); $('r-best').textContent = Math.max(0, ...sets.map((s) => s.bestSec));
    $('r-target').textContent = move.reps ? `of ${n * (sets[0] ? sets[0].repTarget : 0)} reps` : `of ${n} × ${sets[0] ? sets[0].targetSec : 0}`;
    $('r-reps').hidden = !move.reps;
    $('r-reps-v').textContent = move.reps ? sets.map((s) => `${s.reps}/${s.repTarget}`).join(' · ') : '';
    $('r-cues').textContent = sets.reduce((a, s) => a + Object.values(s.cues).reduce((x, y) => x + y, 0), 0);
    $('log').innerHTML = sets.map((s, i) => `<li class="set">Set ${i + 1}</li>` + (s.log.map((c) => `<li><b>${(c.t / 1000).toFixed(1)}s</b> — ${esc(c.text)}</li>`).join('') || '<li>Nothing needed saying.</li>')).join('');
    $('dl-video').disabled = !blob;
    $('rec-note').textContent = blob
      ? `${(blob.size / 1e6).toFixed(1)} MB · ${blob.type.split(';')[0]} · ${rec.kind === 'codec' ? (rec.sound ? 'with the sound the microphone heard' : 'silent — this browser cannot encode sound') : 'the cues are on it as tones'}, and every cue written on the picture.`
      : `No video came out of this set${rec && rec.why ? ': ' + (rec.why.message || rec.why) : ''}.`;
    $('result').hidden = false;
    buttons();
    const reps = sets.reduce((a, s) => a + s.reps, 0);
    voice.say(move.reps ? `All done. ${n} set${n === 1 ? '' : 's'}, ${reps} reps.`
      : `All done. ${n} set${n === 1 ? '' : 's'}, ${Math.round(sum('holdSec'))} seconds in position.`);
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
  $('startstop').onclick = () => (!inSet || between ? startSet() : finishSet());
  $('finish-full').onclick = () => (!inSet || between ? startSet() : finishSet());
  $('endall').onclick = () => endSession();
  $('endall-full').onclick = () => endSession();
  $('page-btn').onclick = () => { pageMode = true; applyFull(); };
  $('full-btn').onclick = () => { pageMode = false; applyFull(); };
  $('move').onchange = async () => {
    move = Moves[$('move').value] || Moves.wallsit;
    buildSettings(); buildReads(); saveSettings();
    $('veil-title').textContent = move.name;
    /* finish whatever was under way, then start again from this exercise's own
       coach — otherwise the readouts keep being painted by the last one, with its
       bands and its clock, until something else happens to replace it */
    if (inSet) await endSession();
    coach = new Core.Coach(move, cfg()); smoother = new Core.Smoother();
    banner = null; state = null; t0 = performance.now();
    syncBands();
    camShape = move.camera || null;
    framingNote = undefined;
    sizeCanvas(true);
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
    if (!landmarker && !worker) return;
    $('state').textContent = 'Swapping model…';
    try { await loadModel(cfg().model, () => { }); } catch { }
  };
  $('dl-video').onclick = () => {
    if (!rec || !rec.blob) return;
    save(rec.blob, `${move.id}-${stamp()}.${rec.blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  };
  $('dl-log').onclick = () => {
    const sets = setsDone.length ? setsDone : (coach ? [coach.summary()] : []);
    const c = cfg();
    const bands = move.bands.map((b) => `${b.label} ${bandText(b, c)}°`).join(', ');
    const lines = [`${move.name} — ${new Date().toLocaleString()}`, bands];
    sets.forEach((s, i) => {
      lines.push('', `Set ${i + 1}: ` + (move.reps ? `${s.reps} of ${s.repTarget} reps, ${s.targetSec}s each — in position ${s.holdSec}s, longest hold ${s.bestSec}s`
        : `target ${s.targetSec}s — in position ${s.holdSec}s${s.reachedTarget ? ' (reached)' : ''}, longest hold ${s.bestSec}s`));
      for (const c2 of s.log) lines.push(`${(c2.t / 1000).toFixed(1)}s\t${c2.text}`);
    });
    const body = lines.join('\n');
    save(new Blob([body], { type: 'text/plain' }), `${move.id}-${stamp()}.txt`);
  };
  /* turning the phone over changes the frame the camera gives, and the browser
     reports it here rather than through any event on the stream */
  video.addEventListener('resize', () => { sizeCanvas(); reshapeMidSet(); framingNote = undefined; });
  window.addEventListener('orientationchange', () => setTimeout(() => { sizeCanvas(); reshapeMidSet(); framingNote = undefined; }, 300));
  window.addEventListener('pagehide', () => { unschedule(); stopCamera(); });

  loadSettings();
  $('veil-title').textContent = move.name;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('veil-title').textContent = 'No camera here';
    $('veil-text').textContent = 'This needs a browser with camera access, served over https.';
    $('go').disabled = true;
  }
  window.__app = { get coach() { return coach; }, get move() { return move; }, get state() { return state; },
    get blob() { return rec && rec.blob; }, get rec() { return rec; }, get cameraRequest() { return lastCameraRequest; },
    get worker() { return !!worker; }, get session() { return { setNo, between, inSet, sets: setsDone.slice() }; }, cfg, fire, drawFrame, paintUi };
})();
