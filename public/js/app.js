/* ---------------------------------------------------------------------------
   Wall Sit Coach — camera, drawing, voice, recording.

   The measuring and the deciding live in wallsit.js and are tested there. This
   file is the part that cannot be tested without a camera: getting frames,
   putting the picture together, saying the words and writing the file.

   One rule shapes the drawing: the canvas IS the recording. Everything worth
   keeping — the camera frame, the skeleton, the angle, the timer, the cue —
   is painted onto it, so the video that downloads is the video you watched.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  const MP = '0.10.21';
  const MODELS = {
    full: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task`,
    lite: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`,
  };
  const C = { good: '#35d07f', warn: '#ffb545', bad: '#ff5c6c', ink: '#e8edf4', dim: 'rgba(232,237,244,.45)', shadow: 'rgba(0,0,0,.55)' };

  const $ = (id) => document.getElementById(id);
  const video = $('cam'), canvas = $('view'), ctx = canvas.getContext('2d');
  const cfgEl = { min: $('cfg-min'), max: $('cfg-max'), tilt: $('cfg-tilt'), cool: $('cfg-cool'),
    shinmin: $('cfg-shinmin'), shinmax: $('cfg-shinmax'), target: $('cfg-target'), calls: $('cfg-calls'),
    model: $('cfg-model'), mirror: $('cfg-mirror') };
  const KEYS = ['min', 'max', 'tilt', 'cool', 'shinmin', 'shinmax', 'target', 'calls', 'model', 'mirror'];

  let vision = null, landmarker = null, loadedModel = null;
  let stream = null, facing = 'environment';
  let running = false, raf = 0, lastTs = 0;
  let coach = null, smoother = null, state = null;
  let banner = null;                      // the cue painted on the frame, and when it appeared
  let rec = null, inSet = false;          // MediaRecorder + its chunks, and whether a set is under way
  let audio = null;                       // WebAudio graph: speakers + a track for the recording
  let t0 = 0;

  /* ---------- settings ---------- */
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('wallsit') || '{}'); } catch { return {}; } },
    set(v) { try { localStorage.setItem('wallsit', JSON.stringify(v)); } catch { } },
  };
  function cfg() {
    const n = (el, d) => { const v = Number(el.value); return Number.isFinite(v) && el.value !== '' ? v : d; };
    /* the time calls are typed as a list, so anything unreadable falls back rather than
       silently leaving the set with no calls in it */
    const calls = String(cfgEl.calls.value).split(/[^\d]+/).map(Number).filter((x) => x > 0);
    return {
      kneeMin: n(cfgEl.min, 85), kneeMax: n(cfgEl.max, 110), backTilt: n(cfgEl.tilt, 12),
      shinMin: n(cfgEl.shinmin, 80), shinMax: n(cfgEl.shinmax, 100),
      holdTargetSec: Math.max(1, n(cfgEl.target, 60)),
      callAtSec: (calls.length ? calls : [45, 30, 10, 5]).sort((a, b) => b - a),
      cooldownMs: n(cfgEl.cool, 4) * 1000,
      model: cfgEl.model.value, mirror: cfgEl.mirror.value === 'on',
    };
  }
  function loadSettings() {
    const s = store.get();
    for (const k of KEYS) if (s[k] != null) cfgEl[k].value = s[k];
    syncBands();
  }
  function saveSettings() {
    const s = {}; for (const k of KEYS) s[k] = cfgEl[k].value;
    store.set(s); syncBands();
    if (coach) Object.assign(coach.cfg, cfg());
  }
  function syncBands() {
    const c = cfg();
    $('knee-band').textContent = `${c.kneeMin}–${c.kneeMax}`;
    $('back-band').textContent = `±${c.backTilt}`;
    $('shin-band').textContent = `${c.shinMin}–${c.shinMax}`;
    /* the green stretch on each meter, drawn on the scale each meter uses */
    $('meter-ok').style.left = pct(c.kneeMin, 50, 150) + '%';
    $('meter-ok').style.width = (pct(c.kneeMax, 50, 150) - pct(c.kneeMin, 50, 150)) + '%';
    $('bmeter-ok').style.left = pct(-c.backTilt, -40, 40) + '%';
    $('bmeter-ok').style.width = (pct(c.backTilt, -40, 40) - pct(-c.backTilt, -40, 40)) + '%';
    $('smeter-ok').style.left = pct(c.shinMin, 40, 140) + '%';
    $('smeter-ok').style.width = (pct(c.shinMax, 40, 140) - pct(c.shinMin, 40, 140)) + '%';
    $('hmeter-ok').style.width = '100%';
    if (!coach) { $('hold-v').textContent = c.holdTargetSec.toFixed(1); $('hold-k').textContent = `left of ${c.holdTargetSec} s`; }
    $('r-target').textContent = `of ${c.holdTargetSec}`;
  }
  const pct = (v, lo, hi) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

  /* ---------- voice ---------- */
  const voice = {
    on: true, pick: null,
    ready() {
      if (!('speechSynthesis' in window)) { this.on = false; return; }
      const vs = speechSynthesis.getVoices();
      /* anything but the buzzy fallbacks, and an English one if there is one */
      const good = vs.filter((v) => /^en/i.test(v.lang) && !/espeak|compact|pico/i.test(v.name));
      this.pick = good.find((v) => /natural|neural|premium|enhanced|google|samantha|daniel/i.test(v.name)) || good[0] || vs[0] || null;
    },
    say(text) {
      if (!this.on || !('speechSynthesis' in window)) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (this.pick) u.voice = this.pick;
        u.rate = 1.03; u.pitch = 1;
        speechSynthesis.speak(u);
      } catch { }
    },
  };
  if ('speechSynthesis' in window) { voice.ready(); speechSynthesis.onvoiceschanged = () => voice.ready(); }

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
  const TONES = {
    high: [[660, 0.1], [440, 0.14]],      // going down: get lower
    low: [[440, 0.1], [660, 0.14]],       // going up: come up
    forward: [[300, 0.16]], back: [[300, 0.16]],
    feetback: [[520, 0.09], [392, 0.09], [330, 0.13]],   // walking back: a falling run
    feetfwd: [[330, 0.09], [392, 0.09], [520, 0.13]],    // walking out: the same run, rising
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
    catch { note('No GPU here — using the processor…'); landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    loadedModel = want;
  }

  /* ---------- camera ---------- */
  async function startCamera() {
    stopCamera();
    const want = { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false };
    try { stream = await navigator.mediaDevices.getUserMedia(want); }
    catch { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => (video.videoWidth ? r() : (video.onloadedmetadata = r)));
    canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720;
    $('stage').style.aspectRatio = `${canvas.width}/${canvas.height}`;
  }
  function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } video.srcObject = null; }

  /* ---------- drawing ---------- */
  function drawFrame(reading, verdict, out) {
    const W = canvas.width, H = canvas.height, m = cfg().mirror;
    ctx.save();
    if (m) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, W, H);
    if (reading && reading.ok) drawBody(reading, verdict, W, H);
    ctx.restore();
    drawHud(reading, verdict, out, W, H);
  }

  /* points come back in square space (x already × aspect), so undo that to paint */
  function drawBody(r, v, W, H) {
    const A = W / H;
    const at = (p) => [(p.x / A) * W, p.y * H];
    const colour = !v.ok ? C.dim : v.inPosition ? C.good : C.bad;
    const s = Math.max(2, W / 320);
    const cDepth = v.depth === 'good' ? C.good : C.bad;
    const cBack = v.back === 'good' ? C.good : C.bad;
    const cFeet = v.feet === 'good' ? C.good : C.bad;

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = s * 1.6;
    ctx.shadowColor = C.shadow; ctx.shadowBlur = s * 2;
    for (const [a, b] of WallSit.BONES) {
      const p = r.points[a], q = r.points[b]; if (!p || !q) continue;
      /* each part is drawn in the colour of the verdict that is about it: the torso
         carries the back, the shin and foot carry where the feet are */
      ctx.strokeStyle = !v.ok ? C.dim
        : (a === 'shoulder' && b === 'hip') ? cBack
          : (a === 'knee' || a === 'ankle' || a === 'heel') ? cFeet
            : colour;
      ctx.beginPath(); ctx.moveTo(...at(p)); ctx.lineTo(...at(q)); ctx.stroke();
    }
    /* the plumb line the back is judged against */
    const hp = at(r.points.hip);
    ctx.setLineDash([s * 1.5, s * 2]); ctx.lineWidth = s * 0.8; ctx.strokeStyle = C.dim;
    ctx.beginPath(); ctx.moveTo(hp[0], hp[1]); ctx.lineTo(hp[0], hp[1] - H * 0.3); ctx.stroke();

    /* the floor the shin is judged against, through whichever foot point was used */
    const footKey = r.shinFoot || 'heel';
    const fp = at(r.points[footKey]);
    if (r.shin != null) {
      ctx.beginPath(); ctx.moveTo(fp[0] - r.facing * W * 0.05, fp[1]); ctx.lineTo(fp[0] + r.facing * W * 0.11, fp[1]); ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.shadowBlur = 0; ctx.fillStyle = colour;
    for (const k of ['shoulder', 'hip', 'knee', 'ankle', 'heel']) {
      const p = r.points[k]; if (!p) continue; const [x, y] = at(p);
      ctx.beginPath(); ctx.arc(x, y, s * 1.5, 0, Math.PI * 2); ctx.fill();
    }

    const rad = Math.max(18, W * 0.045);
    /* the knee angle, drawn where it is measured */
    if (r.knee != null) {
      const [kx, ky] = at(r.points.knee);
      const ang = (p) => { const [x, y] = at(p); return Math.atan2(y - ky, x - kx); };
      sweep(kx, ky, rad, ang(r.points.hip), ang(r.points.ankle), cDepth, s, `${Math.round(r.knee)}°`, W);
    }
    /* the shin against the floor, drawn at the foot where the floor is. Measured
       from the floor going forward, away from the wall, so the number on the
       picture is the number being judged: past 90° the knee is behind the heel. */
    if (r.shin != null) {
      const a0 = r.facing > 0 ? 0 : Math.PI;
      const [kx, ky] = at(r.points.knee);
      const a1 = Math.atan2(ky - fp[1], kx - fp[0]);
      sweep(fp[0], fp[1], rad * 0.8, a0, a1, cFeet, s, `${Math.round(r.shin)}°`, W);
    }
  }

  /* An arc the short way round between two directions, with its number set on the
     bisector just outside it — so the number is plainly the label of that arc and
     the arc is plainly the angle, not its reflex. */
  function sweep(cx, cy, rad, a0, a1, colour, s, text, W) {
    let d = a1 - a0;
    while (d < -Math.PI) d += Math.PI * 2; while (d > Math.PI) d -= Math.PI * 2;
    ctx.strokeStyle = colour; ctx.lineWidth = s * 1.1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a1, d < 0); ctx.stroke();
    const mid = a0 + d / 2, out = rad + Math.max(14, W * 0.032) * 0.95;
    label(text, cx + Math.cos(mid) * out, cy + Math.sin(mid) * out, Math.max(14, W * 0.032), colour, cfg().mirror);
  }

  /* The body is drawn under a mirror when mirroring, which would write the text backwards.
     Flipping about the label's own x un-mirrors the glyphs and leaves the anchor where it is,
     so the same (x, y) means the same place on screen either way — and centred text needs no
     side-swap to go with it. */
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
    const num = (x, u) => (live && x != null ? `${Math.round(x)}°` : '—');
    const L = stack(pad, 'left');
    L(`KNEE ${num(r && r.knee)}`, `target ${c.kneeMin}–${c.kneeMax}`, live ? (v.depth === 'good' ? C.good : C.bad) : C.dim);
    L(`SHIN ${num(r && r.shin)}`, `floor ${c.shinMin}–${c.shinMax}`, live ? (v.feet === 'good' ? C.good : C.bad) : C.dim);
    L(`BACK ${num(r && r.tilt)}`, `vertical ±${c.backTilt}`, live ? (v.back === 'good' ? C.good : C.bad) : C.dim);

    /* the countdown, which is what the set is */
    const R = stack(W - pad, 'right');
    const left = (out.leftMs / 1000).toFixed(1), target = out.targetMs / 1000;
    let ry = R(out.done ? 'DONE' : `${left}s`, out.done ? `${target} s held` : `left of ${target} s`,
      out.done ? C.good : out.holding ? C.good : C.ink, 1.5);
    if (rec && rec.mr && rec.mr.state === 'recording') {
      line('REC', W - pad - fs * 0.9, ry, fs * 0.66, C.bad, 'right');
      ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(W - pad - fs * 0.33, ry + fs * 0.33, fs * 0.3, 0, Math.PI * 2); ctx.fill();
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

  /* ---------- the loop ---------- */
  function tick() {
    if (!running) return;
    schedule();
    const now = performance.now();
    let lm = null;
    /* `__poseSource` stands in for the model: the smoke test drives the whole picture-and-cue
       path with landmarks it made up, which is the only way to check the drawing, the voice and
       the recorder without a person and a wall. Unset in normal use. */
    if (window.__poseSource) lm = window.__poseSource(now - t0);
    else {
      if (!landmarker || video.readyState < 2) return;
      const ts = Math.max(now, lastTs + 1); lastTs = ts;
      try { const res = landmarker.detectForVideo(video, ts); lm = res.landmarks && res.landmarks[0] ? res.landmarks[0] : null; }
      catch { return; }
    }

    const aspect = canvas.width / canvas.height;
    const reading = smoother.apply(WallSit.read(lm, aspect, coach.cfg));
    const out = coach.step(reading, now - t0);
    const v = out.verdict;
    if (out.cue) fire(out.cue);
    drawFrame(reading, v, out);
    paintUi(reading, v, out);
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

  function fire(cue) {
    const good = cue.id === 'hold' || cue.id === 'done' || /^call\d/.test(cue.id);
    const colour = good ? C.good : cue.id === 'lost' ? C.warn : C.bad;
    banner = { text: cue.text, colour, at: performance.now() };
    voice.say(cue.text); tone(toneFor(cue.id));
    const el = $('cue'); el.textContent = cue.text;
    el.className = 'cue ' + (good ? 'good' : cue.id === 'lost' ? 'warn' : 'bad');
  }

  function paintUi(r, v, out) {
    const c = cfg(), live = r && r.ok;
    const ok = { knee: live && v.depth === 'good', back: live && v.back === 'good', shin: live && v.feet === 'good' };
    $('knee-v').textContent = live && r.knee != null ? Math.round(r.knee) : '—';
    $('back-v').textContent = live && r.tilt != null ? Math.round(r.tilt) : '—';
    $('shin-v').textContent = live && r.shin != null ? Math.round(r.shin) : '—';
    $('read-knee').className = 'read ' + (!live ? '' : ok.knee ? 'good' : 'bad');
    $('read-back').className = 'read ' + (!live ? '' : ok.back ? 'good' : 'bad');
    $('read-shin').className = 'read ' + (!live ? '' : ok.shin ? 'good' : 'bad');
    if (live && r.knee != null) $('meter-pin').style.left = pct(r.knee, 50, 150) + '%';
    if (live && r.tilt != null) $('bmeter-pin').style.left = pct(r.tilt, -40, 40) + '%';
    if (live && r.shin != null) $('smeter-pin').style.left = pct(r.shin, 40, 140) + '%';

    /* the countdown: what is left, how much is banked, and how far along the bar is */
    const leftSec = out.leftMs / 1000, target = out.targetMs / 1000;
    $('hold-v').textContent = leftSec.toFixed(1);
    $('hold-k').textContent = out.done ? `${target} s done` : `left of ${target} s`;
    $('best-v').textContent = `held ${(out.holdMs / 1000).toFixed(1)} s · best ${(out.bestMs / 1000).toFixed(1)} s`;
    $('read-hold').className = 'read wide' + (out.done ? ' good' : out.holding ? ' good' : '');
    $('hmeter-pin').style.left = pct(out.holdMs, 0, out.targetMs) + '%';

    const chip = $('state');
    if (out.done) { chip.textContent = 'Done'; chip.className = 'chip good'; }
    else if (!live) { chip.textContent = 'Can’t see you'; chip.className = 'chip warn'; }
    else if (out.holding) { chip.textContent = `${Math.ceil(leftSec)} s left`; chip.className = 'chip good'; }
    else if (v.inPosition) { chip.textContent = 'Settling'; chip.className = 'chip good'; }
    else {
      /* the chip names the same fault the cue would, in two words */
      chip.textContent = v.depth !== 'good' ? (v.depth === 'high' ? 'Too high' : 'Too deep')
        : v.feet !== 'good' ? (v.feet === 'out' ? 'Feet out' : 'Feet in') : 'Back';
      chip.className = 'chip bad';
    }
  }

  /* ---------- recording ---------- */
  function pickMime() {
    const want = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const m of want) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  function startRecording() {
    if (!window.MediaRecorder || !canvas.captureStream) return null;
    try {
      const a = initAudio();
      const s = canvas.captureStream(30);
      if (a) for (const t of a.dest.stream.getAudioTracks()) s.addTrack(t);
      const mimeType = pickMime();
      const mr = new MediaRecorder(s, mimeType ? { mimeType, videoBitsPerSecond: 3.5e6 } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.start(1000);
      return { mr, chunks, mimeType: mimeType || 'video/webm' };
    } catch { return null; }
  }
  function stopRecording() {
    return new Promise((res) => {
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
    $('startstop').disabled = false; $('flip').disabled = false;
    coach = new WallSit.Coach(cfg()); smoother = new WallSit.Smoother();
    running = true; t0 = performance.now(); schedule();
    $('state').textContent = 'Find your position'; $('state').className = 'chip';
  }

  function startSet() {
    $('result').hidden = true; $('log').innerHTML = ''; $('cue').textContent = '';
    coach = new WallSit.Coach(cfg()); smoother = new WallSit.Smoother();
    banner = null; t0 = performance.now();
    initAudio(); if (audio && audio.ac.state === 'suspended') audio.ac.resume();
    voice.say('Get into your wall sit');
    rec = startRecording(); inSet = true;
    $('rec-note').textContent = rec ? '' : 'This browser will not record from a canvas, so there is no video to download.';
    $('startstop').textContent = 'Finish the set'; $('startstop').className = 'btn stop';
  }

  async function endSet() {
    inSet = false;
    const blob = await stopRecording();
    rec = rec ? Object.assign(rec, { blob }) : null;
    const s = coach.summary();
    $('r-hold').textContent = s.holdSec; $('r-best').textContent = s.bestSec;
    $('r-target').textContent = `of ${s.targetSec}`;
    $('r-cues').textContent = Object.values(s.cues).reduce((a, b) => a + b, 0);
    $('log').innerHTML = s.log.map((c) => `<li><b>${(c.t / 1000).toFixed(1)}s</b> — ${esc(c.text)}</li>`).join('') ||
      '<li>Nothing needed saying.</li>';
    $('dl-video').disabled = !blob;
    if (blob) $('rec-note').textContent = `${(blob.size / 1e6).toFixed(1)} MB · ${blob.type.split(';')[0]} · the spoken cues are on it as tones and as text on the picture.`;
    $('result').hidden = false;
    $('startstop').textContent = 'Start the set'; $('startstop').className = 'btn primary';
    voice.say(s.reachedTarget ? `Set done. You held the full ${s.targetSec} seconds.`
      : s.holdSec >= 1 ? `Set done. ${Math.round(s.holdSec)} of ${s.targetSec} seconds in position.` : 'Set done.');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- wiring ---------- */
  $('go').onclick = begin;
  $('startstop').onclick = () => (inSet ? endSet() : startSet());
  $('flip').onclick = async () => {
    facing = facing === 'user' ? 'environment' : 'user';
    unschedule(); try { await startCamera(); } catch { } if (running) schedule();
  };
  $('mute').onclick = (e) => {
    voice.on = !voice.on; e.target.setAttribute('aria-pressed', String(!voice.on));
    e.target.textContent = voice.on ? 'Voice on' : 'Voice off';
    if (!voice.on && 'speechSynthesis' in window) speechSynthesis.cancel();
  };
  $('settings-btn').onclick = (e) => {
    const p = $('settings'); p.hidden = !p.hidden; e.target.setAttribute('aria-expanded', String(!p.hidden));
  };
  for (const k of KEYS) if (k !== 'model') cfgEl[k].onchange = saveSettings;
  cfgEl.model.onchange = async () => {
    saveSettings();
    if (!landmarker) return;
    unschedule(); $('state').textContent = 'Swapping model…';
    try { await loadModel(cfg().model, () => { }); } catch { }
    if (running) schedule();
  };
  $('dl-video').onclick = () => {
    if (!rec || !rec.blob) return;
    save(rec.blob, `wall-sit-${stamp()}.${rec.blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  };
  $('dl-log').onclick = () => {
    const s = coach ? coach.summary() : { log: [] };
    const c = cfg();
    const body = [`Wall sit — ${new Date().toLocaleString()}`,
      `knee band ${c.kneeMin}-${c.kneeMax}°, shin ${c.shinMin}-${c.shinMax}° off the floor, back within ${c.backTilt}° of vertical`,
      `target ${s.targetSec}s — in position ${s.holdSec}s${s.reachedTarget ? ' (reached)' : ''}, longest hold ${s.bestSec}s`, '',
      ...s.log.map((c) => `${(c.t / 1000).toFixed(1)}s\t${c.text}`)].join('\n');
    save(new Blob([body], { type: 'text/plain' }), `wall-sit-${stamp()}.txt`);
  };
  window.addEventListener('pagehide', () => { unschedule(); stopCamera(); });

  loadSettings();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('veil-title').textContent = 'No camera here';
    $('veil-text').textContent = 'This needs a browser with camera access, served over https.';
    $('go').disabled = true;
  }

  /* a hook for the smoke test: it drives the loop with made-up landmarks */
  window.__wallsit = { get coach() { return coach; }, get state() { return state; }, cfg, fire, drawFrame, paintUi };
})();
