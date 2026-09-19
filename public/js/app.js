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
  const cfgEl = { min: $('cfg-min'), max: $('cfg-max'), tilt: $('cfg-tilt'), cool: $('cfg-cool'), model: $('cfg-model'), mirror: $('cfg-mirror') };

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
    const n = (el, d) => { const v = Number(el.value); return Number.isFinite(v) ? v : d; };
    return {
      kneeMin: n(cfgEl.min, 85), kneeMax: n(cfgEl.max, 110), backTilt: n(cfgEl.tilt, 12),
      cooldownMs: n(cfgEl.cool, 4) * 1000,
      model: cfgEl.model.value, mirror: cfgEl.mirror.value === 'on',
    };
  }
  function loadSettings() {
    const s = store.get();
    for (const k of ['min', 'max', 'tilt', 'cool', 'model', 'mirror']) if (s[k] != null) cfgEl[k].value = s[k];
    syncBands();
  }
  function saveSettings() {
    const s = {}; for (const k of ['min', 'max', 'tilt', 'cool', 'model', 'mirror']) s[k] = cfgEl[k].value;
    store.set(s); syncBands();
    if (coach) Object.assign(coach.cfg, cfg());
  }
  function syncBands() {
    const c = cfg();
    $('knee-band').textContent = `${c.kneeMin}–${c.kneeMax}`;
    $('back-band').textContent = `±${c.backTilt}`;
    /* the green stretch on each meter, drawn on the scale each meter uses */
    $('meter-ok').style.left = pct(c.kneeMin, 50, 150) + '%';
    $('meter-ok').style.width = (pct(c.kneeMax, 50, 150) - pct(c.kneeMin, 50, 150)) + '%';
    $('bmeter-ok').style.left = pct(-c.backTilt, -40, 40) + '%';
    $('bmeter-ok').style.width = (pct(c.backTilt, -40, 40) - pct(-c.backTilt, -40, 40)) + '%';
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
    hold: [[880, 0.09], [1175, 0.13]],
    lost: [[350, 0.08]],
  };

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

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = colour; ctx.lineWidth = s * 1.6;
    ctx.shadowColor = C.shadow; ctx.shadowBlur = s * 2;
    for (const [a, b] of WallSit.BONES) {
      const p = r.points[a], q = r.points[b]; if (!p || !q) continue;
      /* the back gets its own colour, because it has its own verdict */
      ctx.strokeStyle = (a === 'shoulder' && b === 'hip') ? (v.back === 'good' ? C.good : C.bad) : colour;
      ctx.beginPath(); ctx.moveTo(...at(p)); ctx.lineTo(...at(q)); ctx.stroke();
    }
    /* the plumb line the back is judged against */
    const hp = at(r.points.hip);
    ctx.setLineDash([s * 1.5, s * 2]); ctx.lineWidth = s * 0.8; ctx.strokeStyle = C.dim;
    ctx.beginPath(); ctx.moveTo(hp[0], hp[1]); ctx.lineTo(hp[0], hp[1] - H * 0.3); ctx.stroke();
    ctx.setLineDash([]);

    ctx.shadowBlur = 0; ctx.fillStyle = colour;
    for (const k of ['shoulder', 'hip', 'knee', 'ankle', 'heel']) {
      const p = r.points[k]; if (!p) continue; const [x, y] = at(p);
      ctx.beginPath(); ctx.arc(x, y, s * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    /* the measured angle, drawn where it is measured */
    if (r.knee != null) {
      const [kx, ky] = at(r.points.knee);
      const ang = (p) => { const [x, y] = at(p); return Math.atan2(y - ky, x - kx); };
      const rad = Math.max(18, W * 0.045);
      ctx.strokeStyle = v.depth === 'good' ? C.good : C.bad; ctx.lineWidth = s * 1.1;
      ctx.beginPath(); ctx.arc(kx, ky, rad, ang(r.points.hip), ang(r.points.ankle), needsCCW(r, ang)); ctx.stroke();
      /* the number sits on the bisector, just outside the arc, so it reads as that arc's label */
      const a0 = ang(r.points.hip);
      let d = ang(r.points.ankle) - a0;
      while (d < -Math.PI) d += Math.PI * 2; while (d > Math.PI) d -= Math.PI * 2;
      const mid = a0 + d / 2, out = rad * 1.75;
      label(`${Math.round(r.knee)}°`, kx + Math.cos(mid) * out, ky + Math.sin(mid) * out,
        Math.max(14, W * 0.032), v.depth === 'good' ? C.good : C.bad, cfg().mirror);
    }
  }
  /* the short way round between the two limbs, so the arc is the angle and not its reflex */
  function needsCCW(r, ang) {
    let d = ang(r.points.ankle) - ang(r.points.hip);
    while (d < -Math.PI) d += Math.PI * 2; while (d > Math.PI) d -= Math.PI * 2;
    return d < 0;
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
    const edge = !r || !r.ok ? C.dim : v.inPosition ? C.good : C.bad;
    ctx.strokeStyle = edge; ctx.lineWidth = Math.max(3, W * 0.006);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);

    const c = cfg();
    const line = (text, x, y, size, colour, align) => {
      ctx.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'top'; ctx.textAlign = align || 'left';
      ctx.lineWidth = size * 0.26; ctx.strokeStyle = C.shadow; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y);
    };
    const knee = r && r.ok && r.knee != null ? `${Math.round(r.knee)}°` : '—';
    const back = r && r.ok && r.tilt != null ? `${Math.round(r.tilt)}°` : '—';
    line(`KNEE ${knee}`, pad, pad, fs, r && r.ok ? (v.depth === 'good' ? C.good : C.bad) : C.dim);
    line(`target ${c.kneeMin}–${c.kneeMax}`, pad, pad + fs * 1.15, fs * 0.62, C.dim);
    line(`BACK ${back}`, pad, pad + fs * 2.05, fs, r && r.ok ? (v.back === 'good' ? C.good : C.bad) : C.dim);
    line(`vertical ±${c.backTilt}`, pad, pad + fs * 3.2, fs * 0.62, C.dim);

    const secs = (out.holdMs / 1000).toFixed(1);
    line(`${secs}s`, W - pad, pad, fs * 1.5, out.holding ? C.good : C.ink, 'right');
    line('held', W - pad, pad + fs * 1.75, fs * 0.62, C.dim, 'right');

    /* the cue, kept on screen a moment after it was said so the recording shows it */
    if (banner && performance.now() - banner.at < 2600) {
      const bh = fs * 2.2, y = H - bh - pad;
      ctx.fillStyle = 'rgba(13,17,23,.82)';
      const bw = Math.min(W - pad * 2, ctx.measureText(banner.text).width + fs * 8);
      ctx.beginPath(); ctx.roundRect((W - bw) / 2, y, bw, bh, bh / 2); ctx.fill();
      ctx.strokeStyle = banner.colour; ctx.lineWidth = Math.max(2, W * 0.003); ctx.stroke();
      ctx.font = `800 ${fs}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = banner.colour; ctx.fillText(banner.text, W / 2, y + bh / 2);
    }
    if (rec && rec.mr && rec.mr.state === 'recording') {
      ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(W - pad - fs * 0.4, pad + fs * 2.9, fs * 0.32, 0, Math.PI * 2); ctx.fill();
      line('REC', W - pad - fs, pad + fs * 2.55, fs * 0.66, C.bad, 'right');
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
    const colour = cue.id === 'hold' ? C.good : cue.id === 'lost' ? C.warn : C.bad;
    banner = { text: cue.text, colour, at: performance.now() };
    voice.say(cue.text); tone(TONES[cue.id] || TONES.lost);
    const el = $('cue'); el.textContent = cue.text;
    el.className = 'cue ' + (cue.id === 'hold' ? 'good' : cue.id === 'lost' ? 'warn' : 'bad');
  }

  function paintUi(r, v, out) {
    const c = cfg();
    const kneeOk = r && r.ok && v.depth === 'good', backOk = r && r.ok && v.back === 'good';
    $('knee-v').textContent = r && r.ok && r.knee != null ? Math.round(r.knee) : '—';
    $('back-v').textContent = r && r.ok && r.tilt != null ? Math.round(r.tilt) : '—';
    $('read-knee').className = 'read ' + (!r || !r.ok ? '' : kneeOk ? 'good' : 'bad');
    $('read-back').className = 'read ' + (!r || !r.ok ? '' : backOk ? 'good' : 'bad');
    if (r && r.ok && r.knee != null) $('meter-pin').style.left = pct(r.knee, 50, 150) + '%';
    if (r && r.ok && r.tilt != null) $('bmeter-pin').style.left = pct(r.tilt, -40, 40) + '%';
    $('hold-v').textContent = (out.holdMs / 1000).toFixed(1);
    $('best-v').textContent = `best ${(out.bestMs / 1000).toFixed(1)} s`;
    const chip = $('state');
    if (!r || !r.ok) { chip.textContent = 'Can’t see you'; chip.className = 'chip warn'; }
    else if (out.holding) { chip.textContent = 'Holding'; chip.className = 'chip good'; }
    else if (v.inPosition) { chip.textContent = 'Settling'; chip.className = 'chip good'; }
    else { chip.textContent = v.depth !== 'good' ? (v.depth === 'high' ? 'Too high' : 'Too deep') : 'Back'; chip.className = 'chip bad'; }
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
    $('r-cues').textContent = Object.values(s.cues).reduce((a, b) => a + b, 0);
    $('log').innerHTML = s.log.map((c) => `<li><b>${(c.t / 1000).toFixed(1)}s</b> — ${esc(c.text)}</li>`).join('') ||
      '<li>Nothing needed saying.</li>';
    $('dl-video').disabled = !blob;
    if (blob) $('rec-note').textContent = `${(blob.size / 1e6).toFixed(1)} MB · ${blob.type.split(';')[0]} · the spoken cues are on it as tones and as text on the picture.`;
    $('result').hidden = false;
    $('startstop').textContent = 'Start the set'; $('startstop').className = 'btn primary';
    voice.say(s.bestSec >= 1 ? `Set done. Longest hold ${Math.round(s.bestSec)} seconds.` : 'Set done.');
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
  for (const k of ['min', 'max', 'tilt', 'cool', 'mirror']) cfgEl[k].onchange = saveSettings;
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
    const body = [`Wall sit — ${new Date().toLocaleString()}`,
      `knee band ${cfg().kneeMin}-${cfg().kneeMax}°, back within ${cfg().backTilt}° of vertical`,
      `in position ${s.holdSec}s, longest hold ${s.bestSec}s`, '',
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
