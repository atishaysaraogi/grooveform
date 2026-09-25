/* ---------------------------------------------------------------------------
   The pose model, in a thread of its own.

   Running it on the page's thread means the page stops for as long as each
   frame takes to read — long enough on a phone that the canvas is repainted
   only when the model lets it, seven or eight times a second. The recording
   then has each real frame three or four times over, which plays back as a
   judder. Here the page's thread only ever draws, at the camera's own rate,
   and the model reads whichever frame was most recently handed to it.

   Messages in: { type: 'load', model }   load or swap the model
                { type: 'frame', bitmap, ts, seq }   one frame to read
                { type: 'ping' }
                { type: 'probe', url }   load a script the old way, to prove that works here
   Messages out: { type: 'ready', model } | { type: 'error', message }
                 { type: 'pose', lm, ts, seq } | { type: 'pong' }
                 { type: 'probed', ok, value, message }

   This is a module worker, because the model's bundle is an ES module. But the
   model's own loader pulls in its WebAssembly glue the old way, with
   importScripts(), which a module worker refuses: "Module scripts don't support
   importScripts()". Every set on a phone hit that, and the coach quietly fell
   back to running the model on the page's thread. So importScripts is given
   back here, done the way it always was underneath: the script fetched in one
   go and run as global code, so the `var` it declares lands on the global scope
   where the loader looks for it.
   --------------------------------------------------------------------------- */
self.importScripts = function (...urls) {
  for (const url of urls) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', String(url), false);
    xhr.send();
    if (xhr.status && (xhr.status < 200 || xhr.status >= 400)) throw new Error(`importScripts: ${url} answered ${xhr.status}`);
    (0, eval)(xhr.responseText + `\n//# sourceURL=${url}`);
  }
};
const MP = '0.10.21';
const MODELS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
};
let vision = null, landmarker = null;

async function load(model) {
  if (!vision) vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP}/wasm`);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODELS[model] || MODELS.full, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  if (landmarker) { try { landmarker.close(); } catch { } landmarker = null; }
  try { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
}

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'ping') { self.postMessage({ type: 'pong' }); return; }
  if (m.type === 'probe') {
    try { self.importScripts(m.url); self.postMessage({ type: 'probed', ok: true, value: self.__probe }); }
    catch (err) { self.postMessage({ type: 'probed', ok: false, message: String(err && err.message || err) }); }
    return;
  }
  if (m.type === 'load') {
    try { await load(m.model); self.postMessage({ type: 'ready', model: m.model }); }
    catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
    return;
  }
  if (m.type === 'frame') {
    let lm = null;
    try {
      if (landmarker) { const res = landmarker.detectForVideo(m.bitmap, m.ts); lm = res.landmarks && res.landmarks[0] ? res.landmarks[0] : null; }
    } catch { }
    try { m.bitmap.close(); } catch { }
    self.postMessage({ type: 'pose', lm, ts: m.ts, seq: m.seq });
  }
};
