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
  const C = Overlay.C;   // the colours, shared with the drawing (overlay.js)

  const $ = (id) => document.getElementById(id);
  /* an element a page from before it existed may not have: setting a field on
     nothing is nothing, and reading one gives undefined */
  const opt = (id) => document.getElementById(id) || {};
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
  let setsMeta = [];                      // per set: when it began (wall clock) and its opening words, for voicing the film after
  let audio = null;                       // WebAudio graph: speakers + a track for the recording
  let t0 = 0;

  /* ---------- settings ----------
     Remembered in the browser, but a band the app itself has changed its mind
     about is not the person's setting — it is a stale default. The version is
     bumped whenever a default moves, and a store written under an older one is
     dropped rather than silently holding the old band on a page that says it
     uses the new one. */
  const SETTINGS_V = Core.SETTINGS_V;
  const COMMON_KEYS = ['cool', 'model', 'mirror', 'rotate', 'angles', 'voice'];
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
    c.angles = opt('cfg-angles').value === 'on';
    c.voice = voice.kind;
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
    buildSettings(); buildReads(); syncBands(); buildPicker(); showMove();
  }

  /* ---------- the page around the coach ----------
     The exercises as cards — what each is, which way the phone goes, what a set
     is, what works — and, once one is picked, how to set up: where the phone
     goes and what position to take, in words, before the camera is asked for.
     None of this touches what is measured or said; that is the moves' own. */
  const placement = (m) => m.camera === 'wide'
    ? 'Lay the phone on its side on the floor, two or three metres away, side on to where you will be.'
    : 'Stand the phone up on the floor, leaning on something, two or three metres away, side on to where you will be.';
  const setWords = (m) => {
    const d = Object.assign({}, Core.COMMON, m.defaults);
    return m.reps ? `${d.repCount} reps × ${d.setCount} sets, ${d.holdTargetSec} s at the top` : `hold ${d.holdTargetSec} s × ${d.setCount} sets`;
  };
  const muscleWords = (m) => Object.entries(m.muscles || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => MUSCLE[k] || k).join(', ');
  const MUSCLE = { thigh: 'thighs', calf: 'calves', glute: 'glutes', abs: 'abs', oblique: 'obliques', shoulder: 'shoulders', back: 'back', ham: 'hamstrings', chest: 'chest', arm: 'arms', forearm: 'forearms', neck: 'neck' };
  function buildPicker() {
    const host = opt('picker'); if (!host.appendChild) return;
    host.innerHTML = '';
    for (const m of Moves.list) {
      const card = el('button', 'card', `<h3>${esc(m.name)}</h3><p class="what">${esc(m.position || m.hint || '')}</p>` +
        `<div class="badges"><span class="badge accent">${m.camera === 'wide' ? 'phone on its side' : 'phone stood up'}</span><span class="badge">${esc(setWords(m))}</span></div>` +
        (m.muscles ? `<p class="muscles"><b>Works</b> ${esc(muscleWords(m))}</p>` : ''));
      card.type = 'button'; card.dataset.move = m.id;
      card.onclick = () => { if (move.id === m.id) { $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } $('move').value = m.id; $('move').dispatchEvent(new Event('change')); };
      host.appendChild(card);
    }
  }
  /* the picked exercise, everywhere the page names it */
  function showMove() {
    document.querySelectorAll('#picker .card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.move === move.id)));
    document.querySelectorAll('#about p[data-move]').forEach((pp) => pp.classList.toggle('on', pp.dataset.move === move.id));
    opt('setup-place').textContent = placement(move);
    opt('setup-position').textContent = move.position || move.hint || '';
    $('veil-title').textContent = move.name;
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
    $('veil-text').textContent = 'The camera never leaves this device. The video you download is made here, cues and all.';
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
  const bandText = Overlay.bandText;
  const pct = (v, lo, hi) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

  /* ---------- voice ----------
     A coach that is sometimes silent is worse than one that is never heard, so
     the three ways a browser quietly swallows speech are all handled here rather
     than left to chance. */
  const voice = {
    on: true, pick: null, ok: 'speechSynthesis' in window, primed: false,
    /* the coach's own voice (see speech.js): made by the page as sound, so it
       goes through the page's graph and onto the film. The phone's own engine
       cannot be recorded, so it is the choice for someone who would rather have
       the natural voice than the cues on the film, and the fallback while the
       engine is loading or where it cannot load. */
    engine: null, loading: null, current: null, spoken: [], seq: 0,
    get kind() { const e = opt('cfg-voice'); return e && e.value === 'phone' ? 'phone' : 'own'; },
    get own() { return this.kind === 'own' && !!(this.engine && this.engine.ready); },
    load() {
      if (this.loading || typeof Speech === 'undefined') return this.loading;
      this.loading = Speech.load('js/vendor/mespeak/', Core.VER, 'js/speech-worker.js').then((e) => { this.engine = e; this.warm(); return e; })
        .catch((e) => { this.engine = null; this.why = e; return null; });
      return this.loading;
    },
    /* the move's cues made before they are needed, in the voice's own thread */
    warm() { if (this.engine && this.engine.ready) this.engine.warm(Speech.texts(move, cfg(), Core.SHARED_CUES)); },
    /* how long a text takes to say: the made sound's length when it is to hand,
       otherwise a reading-speed guess */
    durationOf(text) {
      const pcm = this.own && this.engine.get(text);
      if (pcm) return Math.round((pcm.data.length / pcm.rate) * 1000);
      return Math.min(12000, 350 + String(text).length * 62);
    },
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
      if (!this.on) return;
      if (this.own) { this.spoken.push({ text, via: 'own', t: performance.now() }); this.sayOwn(text); return; }
      if (!this.ok) return;
      this.spoken.push({ text, via: 'phone', t: performance.now() });
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
    /* the page's own voice: the text as samples, played into the graph — the
       speaker and the film's bus alike — with the microphone turned down on the
       bus while it plays, so the film carries the voice once and not the voice
       and the room's echo of it a few milliseconds behind */
    sayOwn(text) {
      const a = initAudio(); if (!a) return;
      if (a.ac.state === 'suspended') a.ac.resume();
      this.stopOwn();
      const seq = ++this.seq;
      const made = this.engine.get(text);
      if (made) this.play(made);
      /* not made yet: played when it arrives, unless something else has been said since */
      else this.engine.synth(text).then((pcm) => { if (pcm && this.seq === seq) this.play(pcm); });
    },
    play(pcm) {
      const a = initAudio(); if (!a) return;
      const buf = a.ac.createBuffer(1, pcm.data.length, pcm.rate);
      buf.copyToChannel(pcm.data, 0);
      const src = a.ac.createBufferSource(); src.buffer = buf; src.connect(a.speech);
      const t = a.ac.currentTime, dur = buf.duration;
      a.micGain.gain.cancelScheduledValues(t);
      a.micGain.gain.setTargetAtTime(0.1, t, 0.015);
      a.micGain.gain.setTargetAtTime(1, t + dur + 0.1, 0.05);
      src.onended = () => { if (this.current === src) this.current = null; };
      src.start(t); this.current = src;
      if (rec && rec.live) rec.voiced = true;
    },
    stopOwn() { if (this.current) { try { this.current.stop(); } catch { } this.current = null; } },
  };
  if (voice.ok) { voice.ready(); speechSynthesis.onvoiceschanged = () => voice.ready(); }

  /* ---------- tones ----------
     Every cue also gets a short tone: something to hear from across the room
     that is not words, at the moment the words start. The graph here is what
     the film hears: the tones, the coach's own voice, and the microphone. */
  function initAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const ac = new AC();
    const out = ac.createGain(); out.gain.value = 0.18; out.connect(ac.destination);
    /* the bus is what the film hears: the tones, and the microphone once there is one.
       It goes to a stream (for the browser's own recorder) and is read as samples
       (for the encoder); it never goes to the speaker */
    const bus = ac.createGain(); bus.gain.value = 1; out.connect(bus);
    /* the coach's own voice, at full volume, to the speaker and the bus alike */
    const speech = ac.createGain(); speech.gain.value = 1; speech.connect(ac.destination); speech.connect(bus);
    /* the microphone reaches the bus through a gain of its own, turned down while the voice plays */
    const micGain = ac.createGain(); micGain.gain.value = 1; micGain.connect(bus);
    const dest = ac.createMediaStreamDestination(); bus.connect(dest);
    audio = { ac, out, bus, speech, micGain, dest, mic: null, micTrack: null };
    return audio;
  }
  /* the camera's stream came with a microphone track: put it on the bus */
  function hearMic() {
    const a = initAudio(); if (!a || !stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track || track === a.micTrack) return;
    if (a.mic) { try { a.mic.disconnect(); } catch { } }
    try { a.mic = a.ac.createMediaStreamSource(new MediaStream([track])); a.mic.connect(a.micGain); a.micTrack = track; }
    catch { a.mic = null; a.micTrack = null; }
  }
  function tone(seq) {
    const a = initAudio(); if (!a || !voice.on) return;
    if (a.ac.state === 'suspended') a.ac.resume();
    Sound.tone(a.ac, a.out, seq, a.ac.currentTime);
  }
  const toneFor = Sound.toneFor;

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
  /* the whole picture, drawn by overlay.js — the same drawing the Review page
     renders a film with after the fact, so the two can never differ */
  function drawFrame(reading, verdict, out) {
    painted++;
    const q = quarterTurn(), t = turned(q), c = cfg();
    Overlay.draw(ctx, {
      W: canvas.width, H: canvas.height,
      source: { image: video, w: t.w, h: t.h, quarter: q, mirror: c.mirror },
      move, cfg: c, reading, verdict, out, setNo, banner, now: performance.now(),
      rec: !!(rec && rec.live), cues: coach ? coach.cues : {},
    });
  }

  const faultWords = (out) => Overlay.faultWords(out, coach && coach.cues);
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

  /* a correction — one of the move's faults, a rep dropped early, or a count
     carrying the slow-down remark — is the one thing shown in red; the prompts,
     the counts, the time calls and the rest are neutral */
  const isCorrection = (cue) => Overlay.isCorrection(cue, move);
  function fire(cue) {
    const bad = isCorrection(cue);
    banner = { text: cue.text, colour: bad ? C.bad : C.ink, at: performance.now() };
    voice.say(cue.text); tone(toneFor(cue.id));
    const e = $('cue'); e.textContent = cue.text;
    e.className = 'cue' + (bad ? ' bad' : '');
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

    opt('faults').textContent = faultWords(out);
    const chip = $('state');
    if (out.done) { chip.textContent = 'Done'; chip.className = 'chip good'; }
    else if (!live) { chip.textContent = 'Can’t see you'; chip.className = 'chip warn'; }
    else if (out.holding) { chip.textContent = `${Math.ceil(leftSec)} s left`; chip.className = 'chip good'; }
    else if (out.ready === false) { chip.textContent = 'Getting set'; chip.className = 'chip'; }
    else if (v.inPosition) { chip.textContent = 'Settling'; chip.className = 'chip good'; }
    else if (move.reps && out.phase !== 'up') { chip.textContent = `Rep ${out.reps + 1} of ${out.repTarget}`; chip.className = 'chip'; }
    else {
      /* the chip names the first band that is out, which is the one being coached */
      const bad = move.bands.find((b) => !v.good[b.key]);
      chip.textContent = bad ? bad.hud + ' off' : 'Adjust';
      chip.className = 'chip bad';
    }
  }
  const PHASE = { setup: 'getting set', down: 'ready', up: 'holding', lower: 'lower slowly', done: 'set done' };

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
  const pickCodec = (w, h) => Codec.pickCodec(w, h, REC_FPS);
  function pickMime() {
    const want = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const m of want) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  const bytesOf = Codec.bytesOf;
  /* The sound for the film the page writes itself: the bus (microphone and tones)
     read as samples and handed to an AAC encoder, stamped on the same clock as
     the picture. Where the browser has no AAC encoder the film is silent, and
     says so. */
  const pickSound = Codec.pickSound;
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
    const film = { live: true, kind: '', taken: 0, dropped: 0, blob: null, why: null, mime: '', sound: false, voiced: false };
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
      film.kind = 'codec'; film.mime = 'video/mp4'; start = performance.now(); film.startAt = start;
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
          /* the picture is kept, so the same film can be written again with another sound track */
          film.video = { width: w, height: h, codec: pick.kind, description: desc, codecString: pick.codec, samples };
          film.durationSec = (samples[samples.length - 1].ts / 1e6) + 1 / REC_FPS;
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
    if (fresh) { setNo = 1; setsDone = []; setsMeta = []; $('result').hidden = true; $('log').innerHTML = ''; }
    else setNo += 1;
    between = false;
    $('cue').textContent = ''; opt('faults').textContent = '';
    coach = new Core.Coach(move, cfg()); smoother = new Core.Smoother();
    banner = null; t0 = performance.now(); state = null;
    voice.warm();
    initAudio(); if (audio && audio.ac.state === 'suspended') audio.ac.resume();
    /* one call, not two: `fire` both says it and puts it on the picture, and a
       second `say` would cancel the first mid-word */
    const opening = fresh ? move.start
      : `Set ${setNo} of ${cfg().setCount}${move.alternate ? ' \u2014 the other leg' : ''}. ${move.reps ? 'When you are ready.' : 'Into position when you are ready.'}`;
    fire({ id: 'start', text: opening, t: 0 });
    setsMeta.push({ t0Abs: t0, opening });
    /* nothing else is said over the opening words */
    coach.quiet(voice.durationOf(opening) + 400);
    if (fresh) { rec = startRecording(); inSet = true; stayAwake(); }
    /* the cards are for choosing; once a set is under way the picture comes first */
    document.body.classList.add('running');
    pageMode = false;
    if (!raf) schedule();
    $('rec-note').textContent = rec ? '' : 'The camera has not given a picture yet, so there is nothing to film.';
    buttons();
  }
  /* what the buttons say: end this set, go on to the next, or finish */
  function buttons() {
    const last = setNo >= cfg().setCount;
    $('startstop').disabled = false;
    if (!inSet) { $('startstop').textContent = 'Start another session'; $('startstop').className = 'btn primary'; opt('endall').hidden = true; opt('finish-full').textContent = 'Start'; opt('endall-full').hidden = true; }
    else if (between) { $('startstop').textContent = 'Next set'; $('startstop').className = 'btn primary'; opt('endall').hidden = false; opt('finish-full').textContent = 'Next set'; opt('endall-full').hidden = false; }
    else { $('startstop').textContent = last ? 'End the last set' : 'End this set'; $('startstop').className = 'btn stop'; opt('endall').hidden = true; opt('finish-full').textContent = last ? 'End the last set' : 'End this set'; opt('endall-full').hidden = true; }
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
    opt('faults').textContent = '';
    if ('speechSynthesis' in window && !s.reachedTarget) speechSynthesis.cancel();
    if (setNo >= cfg().setCount) { endSession(); return; }
    buttons();
  }

  /* The session is over: the film stops, the sets are added up, the results show. */
  async function endSession() {
    if (!inSet) return;
    if (!between) setsDone.push(coach.summary());
    inSet = false; between = false; letSleep(); applyFull();
    document.body.classList.remove('running');
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
    voicedOffer();
    $('rec-note').textContent = blob
      ? `${(blob.size / 1e6).toFixed(1)} MB · ${blob.type.split(';')[0]} · ${rec.kind === 'codec' ? (rec.sound ? (rec.voiced ? 'with the cues spoken and what the microphone heard' : 'with what the microphone heard — the phone\'s own voice is not on it') : 'silent — this browser cannot encode sound') : 'the cues are on it as tones'}, and every cue written on the picture.`
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
    voice.prime(); voice.load();
    const a = initAudio(); if (a && a.ac.state === 'suspended') a.ac.resume();
    begin();
  };
  $('startstop').onclick = () => (!inSet || between ? startSet() : finishSet());
  $('finish-full').onclick = () => (!inSet || between ? startSet() : finishSet());
  opt('endall').onclick = () => endSession();
  opt('endall-full').onclick = () => endSession();
  $('page-btn').onclick = () => { pageMode = true; applyFull(); };
  $('full-btn').onclick = () => { pageMode = false; applyFull(); };
  $('move').onchange = async () => {
    move = Moves[$('move').value] || Moves.wallsit;
    buildSettings(); buildReads(); saveSettings(); showMove();
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
  if (!voice.ok && typeof Speech === 'undefined') { $('mute').textContent = 'No voice here'; $('mute').disabled = true; }
  $('mute').onclick = (e) => {
    voice.on = !voice.on; e.target.setAttribute('aria-pressed', String(!voice.on));
    e.target.textContent = voice.on ? 'Voice on' : 'Voice off';
    if (!voice.on) { voice.stopOwn(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
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
  /* ---------- the film with the cues voiced ----------
     The phone's own voice can never be on a film, and the microphone hears it by
     luck at best. So the film can be written again after the set with every cue
     the coach said — the same words at the same moments, from the log — spoken
     by the coach's own voice, over what the microphone heard, turned down while
     the voice speaks. The picture is the film's own. */
  let voiced = null;
  function voicedOffer() {
    const can = !!(rec && rec.blob && rec.video && rec.kind === 'codec');
    opt('dl-voiced').hidden = !can;
    opt('voiced-note').textContent = !can ? '' : rec.voiced
      ? 'The coach\u2019s voice is already on the video above. This writes it again from the log, if that one did not come out.'
      : 'The phone\u2019s voice is not on a film. This writes the video again with every cue spoken by the coach\u2019s own voice, at the moments they were said.';
  }
  async function voicedFilm() {
    const note = (t) => { opt('voiced-note').textContent = t; };
    if (!rec || !rec.blob || !rec.video) return;
    const btn = $('dl-voiced'); btn.disabled = true; voiced = null;
    try {
      /* every cue of every set, on the film's clock: the opening words the page said, then the coach's */
      const cues = [];
      setsDone.forEach((s, i) => {
        const meta = setsMeta[i]; if (!meta) return;
        /* the opening words begin a few milliseconds before the film's first frame: they go at its start */
        const off = Math.max(0, meta.t0Abs - (rec.startAt || meta.t0Abs));
        cues.push({ id: 'start', text: meta.opening, t: off });
        for (const c of s.log) cues.push({ id: c.id, text: c.text, t: off + c.t });
      });
      note('Making the voice\u2026');
      const client = await voice.load();
      const sr = 44100;
      const mix = await Mixdown.render({ cues, durationSec: rec.durationSec, sampleRate: sr, original: await rec.blob.arrayBuffer(), client,
        tones: !rec.sound, onProgress: (n, of) => note(`Making the voice\u2026 ${n} of ${of}`) });
      note('Writing the file\u2026');
      let audio = null;
      try { audio = await Codec.encodeAudio(mix.pcm, sr); } catch { audio = null; }
      const file = Mp4.write(Object.assign({ created: new Date(), audio }, rec.video));
      const blob = new Blob([file], { type: 'video/mp4' });
      voiced = { blob, frames: rec.video.samples.length, sound: !!audio, voiced: mix.voiced, cues: mix.cues, original: mix.original, rms: cues.slice(0, 3).map((c) => Mixdown.rmsAt(mix.pcm, sr, c.t / 1000, 1.5)) };
      save(blob, `${move.id}-${stamp()}-voiced.mp4`);
      note(`${(blob.size / 1e6).toFixed(1)} MB \u00b7 ${audio ? `${mix.voiced} of ${mix.cues} cues spoken by the coach\u2019s voice` : 'silent \u2014 this browser cannot encode sound'}${mix.original ? ', over what the microphone heard' : ''}.`);
    } catch (e) { note('Could not write it: ' + (e && e.message || e)); voiced = { why: String(e && e.message || e) }; }
    finally { btn.disabled = false; }
  }
  opt('dl-voiced').onclick = voicedFilm;
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

  /* A page kept from before the scripts changed is missing what the scripts
     expect; the scripts carry a version and so does the page, and if they do not
     agree the page is fetched again, once. */
  if (document.documentElement.dataset.v !== Core.VER) {
    let done = false;
    try { done = sessionStorage.getItem('reloaded') === Core.VER; sessionStorage.setItem('reloaded', Core.VER); } catch { }
    if (!done) location.reload();
  }
  loadSettings();
  $('veil-title').textContent = move.name;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('veil-title').textContent = 'No camera here';
    $('veil-text').textContent = 'This needs a browser with camera access, served over https.';
    $('go').disabled = true;
  }
  window.__app = { get coach() { return coach; }, get move() { return move; }, get state() { return state; },
    get blob() { return rec && rec.blob; }, get rec() { return rec; }, get cameraRequest() { return lastCameraRequest; },
    get worker() { return !!worker; }, get session() { return { setNo, between, inSet, sets: setsDone.slice() }; }, get voice() { return voice; }, get audio() { return audio; }, get banner() { return banner; }, get voiced() { return voiced; }, cfg, fire, drawFrame, paintUi, isCorrection };
})();
