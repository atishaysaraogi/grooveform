/* ============================================================
   Fyzio Form Coach — app layer: camera, pose model, drawing,
   calibration flow, voice cues, review & history.
   ============================================================ */
(function () {
  'use strict';
  const E = window.FormEngine;
  const $ = id => document.getElementById(id);
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
  const settings = Object.assign({ model: 'lite', smooth: 'med', voice: 'on', voiceName: 'auto', mirror: 'auto', fps: 'off' }, store.get('settings', {}));
  function saveSettings() { store.set('settings', settings); }
  function setSetting(k, val) { settings[k] = val; saveSettings(); if (k === 'smooth') applySmoothing(); if (k === 'voice') { voice.muted = val === 'off'; if (typeof applyVoiceButton === 'function') applyVoiceButton(); } if (k === 'voiceName') voiceCache = null; }
  function show() { /* screens are managed by the portal */ }
  const current = { ex: null, target: null, opts: {} };
  let onDone = null, onExit = null;

  /* ---------- camera-placement diagrams: each figure performs the exercise ---------- */
  // Poses are joint coordinates in a 400×175 box (floor y=160, camera on the left). A→B→A animates.
  const FIG = {
    // profile figures: h head, sh shoulder, hip, kn knee, an ankle, ft foot, el elbow, wr wrist (+ far: far leg [knee, ankle])
    wallsit:     { cam: 'hip', wall: 338, A: { h: [336, 54], sh: [336, 72], hip: [336, 114], kn: [290, 114], an: [290, 160], ft: [276, 160], el: [336, 94], wr: [336, 112] } },
    plank:       { cam: 'floor', A: { h: [258, 96], sh: [272, 106], hip: [312, 122], kn: [336, 134], an: [356, 148], ft: [362, 160], el: [272, 160], wr: [248, 160] } },
    heelslide:   { cam: 'floor', far: [[318, 130], [332, 158]], A: { h: [238, 150], sh: [254, 152], hip: [300, 152], kn: [330, 153], an: [360, 154], ft: [362, 144], el: [278, 156], wr: [300, 158] },
                   B: { h: [238, 150], sh: [254, 152], hip: [300, 152], kn: [318, 118], an: [336, 152], ft: [346, 148], el: [278, 156], wr: [300, 158] } },
    band_row:    { cam: 'chest', wall: 386, A: { h: [300, 46], sh: [300, 66], hip: [300, 110], kn: [300, 136], an: [300, 160], ft: [312, 160], el: [330, 70], wr: [358, 74] },
                   B: { h: [300, 46], sh: [300, 66], hip: [300, 110], kn: [300, 136], an: [300, 160], ft: [312, 160], el: [288, 92], wr: [318, 96] } },
    calfstretch: { cam: 'hip', wall: 362, A: { h: [318, 52], sh: [322, 70], hip: [306, 112], kn: [290, 138], an: [274, 160], ft: [288, 160], el: [346, 78], wr: [362, 84] }, front: [[326, 136], [330, 160]] },
  };
  const FRONT = { // standing hip abduction, facing the camera: right leg lifts out to the side
    A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [262, 96], elR: [326, 92] },
    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [326, 130], anL: [285, 160], anR: [341, 152], elL: [262, 96], elR: [326, 92] },
  };
  // front-facing upper-body figures (shoulder & neck): both arms drawn shoulder→elbow→wrist
  const FRONTS = {
    shoulder_er:  { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 92], elR: [322, 92], wrL: [270, 112], wrR: [300, 96] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 92], elR: [322, 92], wrL: [270, 112], wrR: [348, 92] } },
    shoulder_abd: { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 92], elR: [322, 92], wrL: [272, 114], wrR: [326, 114] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 92], elR: [346, 66], wrL: [272, 114], wrR: [372, 66] } },
    pullapart:    { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [276, 70], elR: [324, 70], wrL: [272, 74], wrR: [328, 74] },
                    B: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [254, 66], elR: [346, 66], wrL: [228, 66], wrR: [372, 66] } },
    trapstretch:  { A: { h: [300, 46], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [274, 92], elR: [326, 92], wrL: [290, 112], wrR: [324, 114] },
                    B: { h: [288, 50], shL: [282, 66], shR: [318, 66], hipL: [289, 108], hipR: [311, 108], knL: [287, 136], knR: [313, 136], anL: [285, 160], anR: [315, 160], elL: [274, 92], elR: [332, 62], wrL: [290, 112], wrR: [300, 42] } },
  };
  const P = (...pts) => 'M' + pts.map(p => p.join(' ')).join(' L ');
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
  // What the figure does (animated), shown big — no camera in it.
  function figureFor(ex) {
    const f = FIG[ex.id], ff = FRONTS[ex.id]; let figure = '';
    if (ff) figure = (ex.id === 'shoulder_er' ? `<line class="floor" x1="366" y1="60" x2="366" y2="160" stroke-width="3"/><line class="floor" x1="348" y1="92" x2="366" y2="92" stroke-dasharray="3 3"/>` : '') + animPath(frontPath2(ff.A), frontPath2(ff.B)) + animHead(ff.A.h, ff.B.h);
    else if (ex.id === 'hipabd') figure = `<line class="floor" x1="258" y1="100" x2="258" y2="160" stroke-width="3"/>` + animPath(frontPath(FRONT.A), frontPath(FRONT.B)) + animHead(FRONT.A.h, FRONT.B.h);
    else if (f) {
      if (f.wall) figure += `<line class="floor" x1="${f.wall}" y1="30" x2="${f.wall}" y2="160" stroke-width="4"/>`;
      if (f.far) figure += `<path class="ink far" d="${P(f.A.hip, f.far[0], f.far[1])}"/>`;
      if (f.front) figure += `<path class="ink far" d="${P(f.A.hip, f.front[0], f.front[1])}"/>`;
      figure += animPath(profilePath(f.A), f.B && profilePath(f.B)) + animHead(f.A.h, f.B && f.B.h);
    }
    return figure;
  }
  function demo(ex) {
    const lying = ex.id === 'heelslide' || ex.id === 'plank';
    return `<svg class="demo-fig${lying ? ' lying' : ''}" viewBox="${lying ? '210 78 190 92' : '210 22 190 145'}" role="img" aria-label="${ex.name}: ${ex.type === 'hold' ? 'timed hold' : 'repetitions'}">
      <line class="floor" x1="210" y1="162" x2="400" y2="162"/>${figureFor(ex)}
      <text x="305" y="${lying ? 90 : 34}" text-anchor="middle" class="lbl">${ex.type === 'hold' ? 'hold still' : 'repeat slowly'}</text></svg>`;
  }
  /* Where to put the phone. Two pictures, both of a person — not a top-down map, which read as a
     puzzle. Left: what the phone should see (front-on, side-on, or lying), framed as its screen.
     Right: how high it sits and how far away, marked against a standing body. Driven by the
     move's `camera` field; the ten hand-written moves carry theirs, anything else gets a default. */
  const HEIGHT_Y = { floor: 138, knee: 112, hip: 84, chest: 56, eye: 34 };
  const HEIGHT_WORD = { floor: 'on the floor', knee: 'at knee height', hip: 'at hip height', chest: 'at chest height', eye: 'at eye level' };
  const escT = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
  function cameraDiagram(ex) {
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
    const f = FIG[ex.id], ff = FRONTS[ex.id]; let fig = '';
    if (ff) fig = `<path class="ink" d="${frontPath2(ff.B || ff.A)}"/><circle class="ink" cx="${(ff.B || ff.A).h[0]}" cy="${(ff.B || ff.A).h[1]}" r="10"/>`;
    else if (ex.id === 'hipabd') fig = `<path class="ink" d="${frontPath(FRONT.B)}"/><circle class="ink" cx="${FRONT.B.h[0]}" cy="${FRONT.B.h[1]}" r="10"/>`;
    else if (f) { const j = f.B || f.A; fig = (f.wall ? `<line class="floor" x1="${f.wall}" y1="30" x2="${f.wall}" y2="160" stroke-width="4"/>` : '') + `<path class="ink" d="${profilePath(j)}"/><circle class="ink" cx="${j.h[0]}" cy="${j.h[1]}" r="10"/>`; }
    else {
      /* Catalogue and Studio moves register their keyframes with the anatomy figure; draw the end pose from those. */
      const r = window.FyzioAnatomy && FyzioAnatomy.figure && FyzioAnatomy.figure(ex.id);
      if (r) { const j = r.B || r.A; fig = (r.wall ? `<line class="floor" x1="${r.wall}" y1="30" x2="${r.wall}" y2="160" stroke-width="4"/>` : '') + `<path class="ink" d="${r.view === 'front' ? frontPath2(j) : profilePath(j)}"/><circle class="ink" cx="${j.h[0]}" cy="${j.h[1]}" r="10"/>`; }
    }
    return `<svg class="thumb-fig" viewBox="215 24 180 142" aria-hidden="true"><line class="floor" x1="215" y1="162" x2="395" y2="162"/>${fig}</svg>`;
  }
  const diagram = cameraDiagram;
  /* ---------- voice & sound ---------- */
  /* Pick the most natural-sounding English voice the device offers. Neural/"Natural"/"Enhanced"/"Premium" voices first (Edge, iOS, macOS),
     then Google's cloud voices (Chrome), preferring Indian English, then UK/US. The user can pin one in Settings → Voice. */
  let voiceCache = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const all = speechSynthesis.getVoices(); if (!all.length) return null;
    if (settings.voiceName && settings.voiceName !== 'auto') { const v = all.find(x => x.name === settings.voiceName); if (v) return v; }
    if (voiceCache && all.includes(voiceCache)) return voiceCache;
    const en = all.filter(v => /^en[-_]/i.test(v.lang));
    const score = v => { const n = v.name; let sc = 0;
      if (/natural|neural|enhanced|premium|online/i.test(n)) sc += 40;
      if (/^Google/.test(n)) sc += 25;
      if (/Siri|Samantha|Karen|Daniel|Moira|Tessa|Ava|Allison|Serena|Aria|Jenny|Sonia|Libby|Neerja|Prabhat|Ryan|Guy/i.test(n)) sc += 15;
      if (/en[-_]IN/i.test(v.lang)) sc += 12; else if (/en[-_](GB|AU)/i.test(v.lang)) sc += 8; else if (/en[-_]US/i.test(v.lang)) sc += 6;
      if (/compact|espeak|robot/i.test(n)) sc -= 30;
      if (!v.localService) sc += 3;   // cloud voices are usually the neural ones
      return sc; };
    voiceCache = (en.length ? en : all).sort((a, b) => score(b) - score(a))[0] || null; return voiceCache;
  }
  if ('speechSynthesis' in window) { try { speechSynthesis.onvoiceschanged = () => { voiceCache = null; pickVoice(); }; speechSynthesis.getVoices(); } catch { } }
  function listVoices() { try { return speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang)).map(v => ({ name: v.name, lang: v.lang })); } catch { return []; } }
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
      try {
        if (priority >= 2 || !speechSynthesis.speaking) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text); u.rate = 0.98; u.pitch = 1; const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-IN';
        u.onstart = () => this.speaking = true; u.onend = () => this.speaking = false;
        speechSynthesis.speak(u); this.lastCue = now; return true;
      } catch { return false; }
    },
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
  function stopCamera() { streamFacing = null; if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } video.srcObject = null; if (video.src) { try { URL.revokeObjectURL(video.src); } catch { } video.removeAttribute('src'); video.load(); } }
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
    show('screen-live');
    $('live-name').textContent = ex.name + (current.opts.rom ? ' · ' + current.opts.rom + '°' : '') + (current.opts.variant && ex.id === 'calfstretch' ? ' · ' + current.opts.variant + ' knee' : current.opts.variant ? ' · ' + current.opts.variant.toUpperCase() : '') + (current.opts.band && current.opts.band !== 'none' ? ' · ' + current.opts.band + ' band' : '') + (current.opts.sets > 1 ? ` · set ${current.opts.set}/${current.opts.sets}` : ''); $('count').textContent = ex.type === 'reps' ? '0' : '0s'; $('count-of').textContent = ex.type === 'reps' ? '/ ' + target : '/ ' + target + ' s';
    $('phase').textContent = ''; $('cue').className = 'cue'; $('btn-mute').textContent = voice.muted ? '🔇' : '🔊';
    $('hud-side').style.display = ex.type === 'reps' ? '' : 'none'; $('btn-flip').style.display = file ? 'none' : '';
    setStatus('warn', 'Starting'); setFrame(''); applyVoiceButton();
    /* A one-sided move used to ask you to lift the limb you were about to work. The side is
       now chosen up front: for a 'pick' move that choice IS the working limb; for a 'camera'
       move the limb nearest the lens is the one being worked, so the pose decides and the
       choice only tells you how to lie or stand (checked during positioning). */
    current.opts.work = ex.sided && ex.sided.by === 'pick' ? SIDE_CODE[current.opts.side] || null : null;
    live = { ex, target, file, session: new E.SetSession(ex, { target, ...current.opts }), state: 'loading', rec: { version: 1, exercise: ex.id, target, opts: { ...current.opts }, source: file ? { name: file.name, size: file.size, type: file.type } : 'camera', settings: { ...settings }, facing, ua: navigator.userAgent, started: new Date().toISOString(), t0: 0, aspect: 0, frames: [], events: [] }, steadySince: 0, badSince: 0, countdownAt: 0, lastCountSpoken: 0, holdSpoken: {}, lastPoseT: 0, cueTimer: 0, lastP: 0 };
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
  let lastRec = null;
  function record(raw, now, aspect) {
    const rec = live.rec; if (!rec) return;
    if (!rec.t0) rec.t0 = now;
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
    draw(pts, aspect, W, H, lost);
    if (live.state === 'position') positionStep(pts, aspect, now, lost);
    else if (live.state === 'countdown') countdownStep(pts, now);
    else if (live.state === 'active') activeStep(lost ? null : pts, now, lost);
  }

  const SIDE_CODE = { left: 'L', right: 'R' };            // 'both' and undefined -> null (auto)
  const sideName = (c) => (c === 'L' ? 'left' : c === 'R' ? 'right' : '');
  /* Which limb this set is working, as 'L' | 'R' | null when it is not yet known. */
  function wantedSide() {
    if (!live || !live.ex.sided) return null;
    return SIDE_CODE[live.session.opts.side] || null;
  }
  function limbWord(ex) { return ex.sided ? (ex.sided.limb === 'side' ? 'side' : ex.sided.limb) : ''; }

  function checksFor(pts, aspect) {
    const ex = live.ex; const out = []; let ok = true;
    if (!pts) return { ok: false, checks: [{ label: 'No person detected', ok: false }], msg: 'Step into view so your whole body is in frame.' };
    const vis = E.visOf(pts, ex.required); const visOk = vis > 0.55; out.push({ label: visOk ? (ex.upperBody ? 'Head to hips visible' : 'Body visible') : (ex.upperBody ? 'Head to hips hidden' : 'Body partly hidden'), ok: visOk });
    const edges = E.framing(pts, ex.required, aspect); const frameOk = edges.length === 0; out.push({ label: frameOk ? 'In frame' : 'Cut off: ' + edges.join(', '), ok: frameOk });
    const o = E.orientation(pts);
    const accept = ex.id === 'sidelying' ? ['front', 'unclear'] : [ex.view];
    const orientOk = accept.includes(o.view); out.push({ label: orientOk ? (ex.view === 'front' ? 'Facing camera' : 'Side-on') : (ex.view === 'front' ? 'Turn to face the camera' : 'Turn side-on'), ok: orientOk });
    const size = ex.upperBody ? E.dist(pts[0], E.mid(pts[23], pts[24])) : E.bodyHeight(pts); const sizeOk = size > (ex.upperBody ? 0.28 : 0.22); out.push({ label: sizeOk ? 'Good distance' : 'Come closer', ok: sizeOk });
    /* On a camera-side move the working limb is whichever one the lens can see, so the person
       has to be lying or standing the right way round for the side they picked. */
    const want = ex.sided && ex.sided.by === 'camera' ? wantedSide() : null;
    const seen = want ? E.nearSide(pts) : null;
    const sideOk = !want || seen === want;
    if (want) out.push({ label: sideOk ? `${sideName(want)} ${limbWord(ex)} nearest the camera` : `Turn: ${sideName(want)} ${limbWord(ex)} should be nearest the camera`, ok: sideOk });
    ok = visOk && frameOk && orientOk && sizeOk && sideOk;
    let msg = '';
    if (!visOk) msg = 'Some joints are hidden — make sure ' + (ex.upperBody ? 'your head, both arms and your hips' : ex.view === 'side' ? 'the whole side of your body' : 'both legs and both arms') + ' can be seen.';
    else if (!frameOk) msg = 'You\'re cut off at the ' + edges.join(' and ') + '. Move the camera back or reposition.';
    else if (!orientOk) msg = ex.view === 'front' ? 'Turn so your chest faces the camera.' : 'Turn 90° so the camera sees your side.';
    else if (!sizeOk) msg = 'Move a little closer to the camera.';
    else if (!sideOk) msg = `You picked the ${sideName(want)} ${limbWord(ex)}, but the camera is on your ${sideName(seen)}. Turn around so it can see the ${sideName(want)} ${limbWord(ex)}.`;
    return { ok, checks: out, msg };
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
      overlay('Hold your start position', live.ex.type === 'reps' ? 'Stay still for a moment — the coach is measuring your start position.' : 'Get into position and hold still.', { checks: c.checks, progress: Math.min(1, held / 1200), note: (live.ex.upperBody ? 'Head to hips visible · ' : 'Whole body visible · ') + (live.ex.view === 'front' ? 'facing the camera' : 'side-on') });
      if (held > (live.file ? 400 : 1200)) {
        /* The side was chosen before the set, so there is nothing to identify — start counting in. */
        live.state = 'countdown'; live.countdownAt = now - (live.file ? 2000 : 0); live.lastCountSpoken = 0;
        live.legBase = { L: E.fromVertical(pts[23], pts[27]), R: E.fromVertical(pts[24], pts[28]) };
      }
    } else {
      live.steadySince = 0;
      if (now - (live.lastPosCue || 0) > 6000 && c.msg) { live.lastPosCue = now; voice.say(c.msg, { priority: 1 }); }
      /* Always offer a way out: if the camera cannot see the whole body the set never starts,
         and without these the overlay is a dead end. */
      overlay('Get into position', c.msg, { checks: c.checks, note: (live.ex.upperBody ? 'Head to hips visible · ' : 'Whole body visible · ') + (live.ex.view === 'front' ? 'facing the camera' : 'side-on'), actions: POSITION_EXITS });
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
      if (live.legBase) live.session.opts.legBase = live.legBase;
      /* On a camera-side move the visible limb IS the working one, so record it for the review. */
      if (live.ex.sided && live.ex.sided.by === 'camera') live.session.opts.work = side;
      live.session.calibrate(pts, side); recEvent('calibrate', { side, work: live.session.opts.work || null, ref: live.session.ref });
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
    setFrame(lost ? 'bad' : s.faults.active.size ? 'bad' : (ex.type === 'hold' && r.m && !r.m.inPosition) ? 'bad' : 'ok');
    if (!r.m) return;
    if (ex.type === 'reps') {
      const p = E.clamp(r.m.p, 0, 1.2); live.lastP = p;
      $('rom-fill').style.height = Math.round(p / 1.2 * 100) + '%';
      $('rom-fill').style.background = p >= E.FULL ? '#b8f542' : p > E.ATTEMPT ? '#ffb830' : 'rgba(255,243,226,.5)';
      $('phase').textContent = s.counter.state === 'rest' ? 'ready' : s.counter.state === 'out' ? (ex.id === 'heelslide' ? 'bend' : 'lift') : 'return';
      if (r.repEvent) {
        const rep = r.repEvent.rep; recEvent('rep', { full: r.repEvent.full, n: rep.n, peak: +rep.peak.toFixed(3), duration: Math.round(rep.duration), faults: rep.faults });
        if (r.repEvent.full) {
          $('count').textContent = s.counter.count; voice.beep(880, 0.1);
          const extra = r.repCues.length ? '. ' + r.repCues[0].cue : '';
          voice.say(s.counter.count + extra, { priority: 2 });
          showCue(r.repCues.length ? r.repCues[0].cue : ['Nice', 'Good rep', 'Clean', 'Keep going'][s.counter.count % 4], r.repCues.length ? 'warn' : 'good');
        } else {
          voice.beep(330, 0.15);
          const cue = r.repCues[0]?.cue || 'Doesn\'t count — full range';
          voice.say(cue, { priority: 2 }); showCue(cue, 'warn');
        }
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
    if (r.cues.length) {
      const f = r.cues[0]; const spoken = voice.say(f.cue, { priority: 1, minGap: 1500 });
      if (spoken || voice.muted || !('speechSynthesis' in window)) { s.ackCue(f.id, now); showCue(f.cue, 'warn'); voice.beep(440, 0.08); live.lastCueFault = f.id; recEvent('cue', { fault: f.id, cue: f.cue }); }
    } else if (ex.type === 'hold' && !r.m.inPosition && ex.enterCue) {
      // holding exercise but not in the hold position: tell them how to get there instead of going quiet
      if (!live.outSince) live.outSince = now;
      if (now - live.outSince > 2500 && now - (live.lastEnterCue || 0) > 6000 && (now - live.startedAt) > 3000) { if (voice.say(ex.enterCue, { priority: 1, minGap: 1500 }) || voice.muted) { live.lastEnterCue = now; showCue(ex.enterCue, 'info'); recEvent('cue', { fault: 'enter', cue: ex.enterCue }); } }
    }
    if (ex.type === 'hold' && r.m.inPosition) live.outSince = 0;
    if (r.done) finishSet(true);
  }

  function updateReadout(ex, m, s) {
    const ro = $('readout'), v = $('ro-val'), t = $('ro-tgt'); let val = '', tgt = '', state = '';
    const ref = s.ref, act = s.faults.active;
    switch (ex.id) {
      case 'heelslide': val = Math.round(Math.max(0, m.flexion)) + '°'; tgt = '/ ' + ref.rom + '° bend'; state = m.p >= E.FULL ? 'good' : ''; break;
      case 'hipabd': val = Math.round(Math.max(0, m.raise)) + '°'; tgt = '/ ' + ref.rom + '° raise' + (act.has('lean') ? ' · leaning ' + Math.round(m.leanAway) + '°' : act.has('hike') ? ' · hip up ' + Math.round(m.hike) + '°' : ''); state = m.p >= E.FULL ? 'good' : ''; break;
      case 'wallsit': val = Math.round(m.knee) + '°'; tgt = 'knee · aim 90°'; state = m.inPosition && !act.size ? 'good' : ''; break;
      case 'plank': val = Math.round(m.lineAng) + '°'; tgt = 'body line · aim 180°'; state = m.inPosition && !act.size ? 'good' : ''; break;
      case 'calfstretch': val = Math.round(Math.max(0, m.shinLean)) + '°'; tgt = 'lean · aim 10–20° · knee ' + Math.round(m.knee) + '°'; state = m.inPosition && !act.size ? 'good' : ''; break;
    }
    v.textContent = val; t.textContent = tgt; ro.className = 'readout ' + (act.size ? 'bad' : state);
  }
  function finishSet(auto = false) {
    if (!live || live.state !== 'active') { if (live && live.state !== 'active') exitLive(); return; }
    const review = live.session.review();
    live.state = 'done'; recEvent('finish', { auto }); live.rec.review = { score: review.score, reps: review.reps, partials: review.partials, holdSec: review.holdSec, faults: Object.fromEntries(Object.entries(review.faults).map(([k, v]) => [k, v.n])) }; lastRec = live.rec;
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
    // bones
    for (const [a, b] of E.CONNECTIONS) {
      const p = pts[a], q = pts[b]; if (p.v < 0.3 || q.v < 0.3) continue;
      const hot = faulty && (focus.has(a) || focus.has(b));
      ctx.strokeStyle = hot ? '#ff2e88' : (p.v < 0.6 || q.v < 0.6) ? 'rgba(255,243,226,0.45)' : '#fff3e2';
      ctx.beginPath(); ctx.moveTo(X(p), Y(p)); ctx.lineTo(X(q), Y(q)); ctx.stroke();
    }
    // joints
    const r = Math.max(4, W / 220);
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = pts[i]; if (p.v < 0.3) continue;
      const hot = faulty && focus.has(i);
      ctx.fillStyle = hot ? '#ff2e88' : '#b8f542'; ctx.beginPath(); ctx.arc(X(p), Y(p), hot ? r * 1.6 : r, 0, Math.PI * 2); ctx.fill();
      if (focus.has(i)) { ctx.strokeStyle = hot ? '#ff2e88' : '#b8f542'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(p), Y(p), r * 2.4, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = Math.max(3, W / 320); }
    }
    // guided correction: ideal lines, targets and arrows on the video
    if (live?.state === 'active' && live.session.m) drawGuides(pts, X, Y, W, H);
    // angle readouts at focus joints (drawn un-mirrored)
    const m = live?.session?.m;
    if (m && live.state === 'active') {
      const label = angleLabel(live.ex.id, m); if (label) {
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
  function drawGhost(pts, X, Y, W, H) {
    const ex = live.ex, m = live.session.m, ref = live.session.ref, act = live.session.faults.active, S = live.session.side;
    const j = E.SIDE[S]; const P = i => pts[i];
    const state = act.size ? 'bad' : (ex.type === 'reps' ? (m.p >= E.FULL ? 'good' : 'target') : (m.inPosition ? 'good' : 'target'));
    switch (ex.id) {
      case 'hipabd': {
        const hip = m.useL ? P(23) : P(24), stanceHip = m.useL ? P(24) : P(23), stanceAnk = m.useL ? P(28) : P(27);
        const legLen = E.dist(stanceHip, stanceAnk); const dir = -m.away;      // the working leg goes away from the stance leg
        const a = (ref.rom + (m.useL ? ref.legL : ref.legR)) * Math.PI / 180;
        ghostPath([hip, { x: hip.x + dir * Math.sin(a) * legLen, y: hip.y + Math.cos(a) * legLen }], X, Y, state);
        break;
      }
      case 'heelslide': {
        const hip = P(j.HIP), ank = P(j.ANK); const a = ref.thigh, b = ref.shin, K = (ref.kneeRest - ref.rom) * Math.PI / 180;
        const c = Math.sqrt(Math.max(1e-6, a * a + b * b - 2 * a * b * Math.cos(K)));            // hip→ankle distance at the target bend
        const alpha = Math.acos(Math.max(-1, Math.min(1, (a * a + c * c - b * b) / (2 * a * c))));   // angle at the hip
        const dir = Math.sign(ank.x - hip.x) || 1; const floorY = ref.ank0;
        const knee = { x: hip.x + dir * Math.cos(alpha) * a, y: floorY - Math.sin(alpha) * a };
        ghostPath([hip, knee, { x: hip.x + dir * c, y: floorY }], X, Y, state);
        break;
      }
      case 'wallsit': {
        const hip = P(j.HIP), knee = P(j.KNEE), ank = P(j.ANK); const dir = Math.sign(knee.x - hip.x) || 1;
        const t = E.dist(hip, knee), sh = E.dist(knee, ank);
        ghostPath([hip, { x: hip.x + dir * t, y: hip.y }, { x: hip.x + dir * t, y: hip.y + sh }], X, Y, state);
        break;
      }
      case 'plank': {
        ghostPath([P(j.SH), P(j.ANK)], X, Y, state); break;
      }
      case 'shoulder_er': {
        const s = m.side, jj = E.SIDE[s]; const el = P(jj.EL); const out = E.outward(pts, s);
        const phi0 = Math.asin(Math.max(-1, Math.min(1, ref['lat' + s] / ref['fore' + s]))); const phiT = phi0 + (ref.variant === 'ir' ? -1 : 1) * ref.rom * Math.PI / 180;
        ghostPath([el, { x: el.x + out * Math.sin(phiT) * ref['fore' + s], y: el.y + 0.02 }], X, Y, state); break;
      }
      case 'shoulder_abd': {
        const s = m.side, jj = E.SIDE[s]; const sh = P(jj.SH); const out = E.outward(pts, s); const L = E.dist(sh, P(jj.EL)) + E.dist(P(jj.EL), P(jj.WR));
        const a = (ref['arm' + s] + ref.rom) * Math.PI / 180;
        ghostPath([sh, { x: sh.x + out * Math.sin(a) * L, y: sh.y + Math.cos(a) * L }], X, Y, state); break;
      }
      case 'band_row': {
        const sh = P(j.SH); ghostPath([sh, { x: sh.x - ref.dir * ref.full * ref.upper, y: sh.y + 0.55 * ref.upper }], X, Y, state); break;
      }
      case 'pullapart': {
        const shL = P(11), shR = P(12); const reach = ref.arm * 0.92;
        ghostPath([{ x: shL.x + Math.sign(shL.x - shR.x) * reach, y: shL.y }, shL, shR, { x: shR.x + Math.sign(shR.x - shL.x) * reach, y: shR.y }], X, Y, state); break;
      }
      case 'calfstretch': {
        const ank = P(j.ANK), knee = P(j.KNEE), hip = P(j.HIP), wr = P(j.WR); const dir = Math.sign(wr.x - ank.x) || 1;
        const sh = E.dist(knee, ank), th = E.dist(hip, knee); const lean = 15 * Math.PI / 180, bend = m.bent ? 30 * Math.PI / 180 : 0;
        const k = { x: ank.x + dir * Math.sin(lean) * sh, y: ank.y - Math.cos(lean) * sh };
        const h = { x: k.x + dir * Math.sin(lean + bend) * th, y: k.y - Math.cos(lean + bend) * th };
        ghostPath([ank, k, h], X, Y, state); break;
      }
    }
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
  function drawGuides(pts, X, Y, W, H) {
    const ex = live.ex, m = live.session.m, ref = live.session.ref, act = live.session.faults.active, S = live.session.side;
    const j = E.SIDE[S]; const P = i => pts[i];
    const c = id => act.has(id) ? GUIDE.bad : GUIDE.ok;
    const L = Math.max(30, W / 16);
    ctx.save(); ctx.globalAlpha = 0.95;
    switch (ex.id) {
      case 'heelslide': {
        const heel = P(j.HEEL), hip = P(j.HIP), knee = P(j.KNEE), ank = P(j.ANK);
        // floor reference for the heel, and a target-angle marker at the knee
        dashed(X(heel) - L, ref.heel0 * H, X(heel) + L * 1.5, ref.heel0 * H, c('heel')); label(X(heel) + L * 1.5 + 6, ref.heel0 * H, 'heel line');
        if (act.has('heel')) arrow(X(heel), Y(heel) - 6, 0, 1, GUIDE.bad, L * 0.7);
        if (act.has('hip')) arrow(X(hip), Y(hip) - 6, 0, 1, GUIDE.bad, L * 0.7);
        // target: shin rotated to the target flexion from the straight line hip→knee
        const targetKnee = ref.kneeRest - ref.rom; const ang = Math.atan2(hip.y - knee.y, hip.x - knee.x) + (ank.x > hip.x ? -1 : 1) * targetKnee * Math.PI / 180;
        const tx = knee.x + Math.cos(ang) * ref.shin, ty = knee.y + Math.sin(ang) * ref.shin;
        dashed(X(knee), Y(knee), X({ x: tx }), Y({ y: ty }), m.p >= E.FULL ? GUIDE.ok : GUIDE.warn); label(X({ x: tx }) + 6, Y({ y: ty }), ref.rom + '° target');
        break;
      }
      case 'hipabd': {
        const hipI = m.useL ? 23 : 24, ankI = m.useL ? 27 : 28, kneeI = m.useL ? 25 : 26;
        const hip = P(hipI), ank = P(ankI), legLen = E.dist(hip, ank);
        // plumb line from the working hip and the target raise line
        dashed(X(hip), Y(hip), X(hip), Y(hip) + legLen * H * 0.95, GUIDE.ok);
        const dir = (ank.x >= hip.x) ? 1 : -1; const a = (ref.rom + (m.useL ? ref.legL : ref.legR)) * Math.PI / 180;
        const tx = hip.x + dir * Math.sin(a) * legLen, ty = hip.y + Math.cos(a) * legLen;
        dashed(X(hip), Y(hip), X({ x: tx }), Y({ y: ty }), m.p >= E.FULL ? GUIDE.ok : GUIDE.warn); label(X({ x: tx }) + 8 * dir, Y({ y: ty }), ref.rom + '°');
        // level-hips reference
        dashed(X(P(23)) - L, (P(23).y + P(24).y) / 2 * H, X(P(24)) + L, (P(23).y + P(24).y) / 2 * H, c('hike'));
        if (act.has('lean')) { const sh = E.mid(P(11), P(12)); arrow(X(sh), Y(sh), dir, 0, GUIDE.bad, L); }
        if (act.has('hike')) arrow(X(hip), Y(hip) - 4, 0, 1, GUIDE.bad, L * 0.7);
        if (act.has('bend')) { const kn = P(kneeI); arrow(X(kn), Y(kn), -(kn.x - (hip.x + ank.x) / 2), -(kn.y - (hip.y + ank.y) / 2), GUIDE.bad, L * 0.8); }
        break;
      }
      case 'wallsit': {
        const ank = P(j.ANK), knee = P(j.KNEE), hip = P(j.HIP);
        dashed(X(ank), Y(ank), X(ank), Y(knee) - L, c('shin')); if (act.has('shin')) arrow(X(knee), Y(knee), -(knee.x - ank.x), 0, GUIDE.bad, L);
        if (act.has('high')) arrow(X(hip), Y(hip), 0, 1, GUIDE.bad, L); if (act.has('low')) arrow(X(hip), Y(hip), 0, -1, GUIDE.bad, L);
        break;
      }
      case 'plank': {
        const sh = P(j.SH), ank = P(j.ANK), hip = P(j.HIP);
        const bad = act.has('sag') || act.has('pike');
        dashed(X(sh), Y(sh), X(ank), Y(ank), bad ? GUIDE.bad : GUIDE.ok); label((X(sh) + X(ank)) / 2, Math.min(Y(sh), Y(ank)) - 18, 'straight line');
        if (act.has('sag')) arrow(X(hip), Y(hip), 0, -1, GUIDE.bad, L); if (act.has('pike')) arrow(X(hip), Y(hip), 0, 1, GUIDE.bad, L);
        if (act.has('stack')) { const el = P(j.EL); dashed(X(el), Y(el), X(el), Y(sh) - L / 2, GUIDE.bad); arrow(X(sh), Y(sh), -(sh.x - el.x), 0, GUIDE.bad, L * 0.8); }
        if (act.has('neck')) { const ear = P(j.EAR); arrow(X(ear), Y(ear), 0, -1, GUIDE.warn, L * 0.7); }
        break;
      }
      case 'calfstretch': {
        const ank = P(j.ANK), knee = P(j.KNEE), heel = P(j.HEEL), hip = P(j.HIP), sh = P(j.SH);
        // plumb line at the ankle: shin should lean off it toward the wall; heel line on the floor
        dashed(X(ank), Y(ank), X(ank), Y(knee) - L / 2, act.has('lean') ? GUIDE.warn : GUIDE.ok);
        dashed(X(heel) - L, ref.heel0 * H, X(heel) + L, ref.heel0 * H, c('heel'));
        if (act.has('heel')) arrow(X(heel), Y(heel) - 6, 0, 1, GUIDE.bad, L * 0.7);
        if (act.has('lean')) arrow(X(hip), Y(hip), (P(j.WR).x - hip.x), 0, GUIDE.warn, L);
        if (act.has('kneebend') || act.has('kneestraight')) { arrow(X(knee), Y(knee), act.has('kneebend') ? -(knee.x - (hip.x + ank.x) / 2) : (knee.x - (hip.x + ank.x) / 2), 0, GUIDE.bad, L * 0.7); }
        if (act.has('hinge')) { dashed(X(sh), Y(sh), X(knee), Y(knee), GUIDE.bad); arrow(X(hip), Y(hip), (P(j.WR).x - hip.x), 0, GUIDE.bad, L * 0.8); }
        break;
      }
    }
    ctx.restore();
  }
  function angleLabel(id, m) {
    switch (id) {
      case 'heelslide': return Math.round(Math.max(0, m.flexion)) + '° bend';
      case 'hipabd': return Math.round(Math.max(0, m.raise)) + '° raise';
      case 'wallsit': return Math.round(m.knee) + '° knee';
      case 'plank': return (m.hipOff > 0.055 ? 'sag ' : m.hipOff < -0.075 ? 'pike ' : 'line ') + Math.round(m.lineAng) + '°';
      case 'calfstretch': return Math.round(m.shinLean) + '° lean · ' + Math.round(m.knee) + '° knee';
    }
    return '';
  }

  /* ---------- review ---------- */
  function fmtTempo(ms) { return ms ? (ms / 1000).toFixed(1) + ' s' : '—'; }
  function spokenSummary(rv) {
    let s = rv.headline + '. ';
    if (rv.type === 'reps') s += `${rv.reps} of ${rv.target} reps counted` + (rv.partials ? `, ${rv.partials} partial. ` : '. ');
    else s += `You held for ${Math.round(rv.holdSec)} seconds, ${Math.round(rv.goodSec)} of them in good form. `;
    if (rv.tips.length) s += 'Main thing to work on: ' + rv.tips[0].label.toLowerCase() + '. ' + rv.tips[0].tip;
    else s += 'Nothing to correct — same again next set.';
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
    const fl = $('rv-faults');
    const items = Object.values(rv.faults).sort((a, b) => b.fault.weight * b.n - a.fault.weight * a.n);
    fl.innerHTML = items.length ? items.map(fc => `<div class="fault"><span class="n">×${fc.n}</span><span><span class="l">${fc.fault.label}</span><br><span class="t">${fc.fault.tip}</span></span></div>`).join('') : '<p class="empty">No faults flagged. Same again next set — or add a couple of reps.</p>';
    const spk = $('btn-speak-review'); if (spk) spk.onclick = () => { voice.unlock(); voice.say(spokenSummary(rv), { priority: 2 }); };
    const dg = $('rv-diag'); if (!dg) return; dg.hidden = !lastRec;
    if (lastRec) {
      $('rv-diag-info').textContent = `${lastRec.frames.length} frames · ${(JSON.stringify(lastRec).length / 1024).toFixed(0)} KB · landmarks + metrics, no video`;
      $('btn-diag-download').onclick = async () => {
        const name = `grooveform-${lastRec.exercise}-${lastRec.started.replace(/[:.]/g, '-')}.json`;
        const txt = JSON.stringify(lastRec); const st = $('rv-diag-status');
        // On claude.ai the viewer mediates saves through the downloads capability; elsewhere a plain download link works.
        let dl = null; try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
        if (dl) {
          try { await dl.save({ filename: name, data: txt }); st.textContent = 'Saved as ' + name + '.'; }
          catch (e) { st.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'Download unavailable here — use Copy JSON instead.'; }
          return;
        }
        try { const blob = new Blob([txt], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); st.textContent = 'Saved as ' + name + '.'; }
        catch (e) { st.textContent = 'Download blocked here — use Copy JSON.'; }
      };
      $('btn-diag-copy').onclick = async () => {
        const txt = JSON.stringify(lastRec);
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

  window.FyzioCoach = { start, exitLive, restOverlay, restActive, endRest, diagram, demo, cameraDiagram, thumb, listVoices, pickVoice, applyVoiceButton, exercises: E.EXERCISES, settings, setSetting, get live() { return live; }, get lastRec() { return lastRec; }, finishSet, renderReview, spokenSummary, voice };
})();
