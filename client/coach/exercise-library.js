/* ============================================================
   Exercise library — the registry every move is added to.

   One file per move under coach/library/ holds everything about it:
   what it is, how the camera should be placed, what counts as a rep,
   how it is measured, the faults with their spoken cues and written
   tips, and the full set-up guide.

   Adding a move: drop a file in coach/library/, add one <script> tag
   in client/index.html. Nothing here or in engine.js needs editing.
   See docs/EXERCISE-LIBRARY.md. test/library.test.js enforces the
   shape below, so a half-filled move fails the build rather than
   reaching a user as a blank panel.
   ============================================================ */
(function (root) {
  'use strict';

  const TEXT = ['id', 'name', 'group', 'summary', 'setup', 'why'];
  const LIMBS = ['leg', 'arm', 'side'];
  /* How a one-sided move decides which limb is being worked:
       pick   — the person chooses, and that choice is the working limb (front-on moves)
       camera — the limb nearest the camera is the working one, so the pose decides and the
                choice only says how to set up (lying or standing side-on) */
  const SIDE_BY = ['pick', 'camera'];
  /* Every one-sided move offers the same choice, so it is added here rather than
     repeated in ten files. 'both' runs the sets on one side, then asks to switch. */
  const SIDE_OPTION = Object.freeze({
    key: 'side', label: 'Which side', values: ['left', 'right', 'both'], default: 'both',
    labels: Object.freeze({ left: 'Left', right: 'Right', both: 'Both (one then the other)' }),
  });
  const TYPES = ['reps', 'hold'];
  const VIEWS = ['front', 'side'];
  /* What the camera can do with a move:
       form — counts reps or times the hold AND judges form (every fault has a live check)
       reps — counts reps or times the hold; faults are listed for the person but not watched
       none — nothing to measure from one camera; the app shows the guide and logs the set by hand */
  const TRACKING = ['form', 'reps', 'none'];
  const LEVELS = ['beginner', 'intermediate', 'advanced'];
  const CAM_HEIGHTS = ['floor', 'knee', 'hip', 'chest', 'eye'];
  const POSTURES = ['standing', 'lying', 'sitting', 'kneeling', 'prone', 'sidelying'];

  const isFn = (v) => typeof v === 'function';
  const isStr = (v) => typeof v === 'string' && v.trim() !== '';
  const isArr = (v) => Array.isArray(v) && v.length > 0;

  function fail(id, msg) { throw new Error(`exercise "${id}": ${msg}`); }

  /* Rejects a move that is missing any of the detail the app renders. Every
     field here is read somewhere in the UI or the coach loop, so a missing one
     is a blank panel or a silent no-op rather than a cosmetic omission. */
  function validate(ex) {
    if (!ex || typeof ex !== 'object') throw new Error('exercise: definition must be an object');
    const id = ex.id || '(no id)';
    for (const k of TEXT) if (!isStr(ex[k])) fail(id, `${k} must be a non-empty string`);
    if (!/^[a-z][a-z0-9_]*$/.test(ex.id)) fail(id, 'id must be lower-case letters, digits and underscores');
    if (!TYPES.includes(ex.type)) fail(id, `type must be one of ${TYPES.join(' | ')}`);
    if (!VIEWS.includes(ex.view)) fail(id, `view must be one of ${VIEWS.join(' | ')}`);
    if (!isStr(ex.icon)) fail(id, 'icon must be a string');
    if (ex.sided !== undefined) {
      if (!ex.sided || typeof ex.sided !== 'object') fail(id, 'sided must be an object when present');
      if (!LIMBS.includes(ex.sided.limb)) fail(id, `sided.limb must be one of ${LIMBS.join(' | ')}`);
      if (!SIDE_BY.includes(ex.sided.by)) fail(id, `sided.by must be one of ${SIDE_BY.join(' | ')}`);
    }
    if (!TRACKING.includes(ex.tracking)) fail(id, `tracking must be one of ${TRACKING.join(' | ')}`);
    if (typeof ex.vetted !== 'boolean') fail(id, 'vetted must be true or false');
    /* Physio-facing fields. Optional, but checked for shape when present so an editor cannot save junk. */
    if (ex.equipment !== undefined && !(Array.isArray(ex.equipment) && ex.equipment.every(isStr))) fail(id, 'equipment must be an array of strings');
    if (ex.muscles !== undefined) {
      if (!ex.muscles || typeof ex.muscles !== 'object') fail(id, 'muscles must be { primary, secondary }');
      for (const k of ['primary', 'secondary']) if (ex.muscles[k] !== undefined && !(Array.isArray(ex.muscles[k]) && ex.muscles[k].every(isStr))) fail(id, `muscles.${k} must be an array of strings`);
    }
    if (ex.level !== undefined && !LEVELS.includes(ex.level)) fail(id, `level must be one of ${LEVELS.join(' | ')}`);
    if (ex.camera !== undefined) {
      if (!ex.camera || typeof ex.camera !== 'object') fail(id, 'camera must be an object');
      if (!CAM_HEIGHTS.includes(ex.camera.height)) fail(id, `camera.height must be one of ${CAM_HEIGHTS.join(' | ')}`);
      if (!isStr(ex.camera.distance)) fail(id, 'camera.distance must be a string like "2 m"');
      if (ex.camera.posture !== undefined && !POSTURES.includes(ex.camera.posture)) fail(id, `camera.posture must be one of ${POSTURES.join(' | ')}`);
    }
    if (ex.sources !== undefined && !(Array.isArray(ex.sources) && ex.sources.every((r) => r && isStr(r.name)))) fail(id, 'sources must be an array of { name, url? }');
    for (const k of ['tempo', 'dosage', 'progression', 'regression', 'contraindications']) if (ex[k] !== undefined && typeof ex[k] !== 'string') fail(id, `${k} must be a string`);
    if (!Number.isFinite(ex.order)) fail(id, 'order must be a number (it sets where the move appears in lists)');
    if (!Number.isFinite(ex.defaultTarget)) fail(id, 'defaultTarget must be a number');
    if (!isArr(ex.targets) || !ex.targets.every(Number.isFinite)) fail(id, 'targets must be a non-empty array of numbers');
    if (!ex.targets.includes(ex.defaultTarget)) fail(id, 'defaultTarget must be one of targets');
    if (!isArr(ex.required) || !ex.required.every(Number.isInteger)) fail(id, 'required must be a non-empty array of landmark indices');
    /* A move the camera cannot measure has nothing to calibrate; the other tiers must. */
    if (ex.tracking !== 'none') {
      if (!isFn(ex.calibrate)) fail(id, 'calibrate(pts, side, opts) must be a function');
      if (!isFn(ex.measure)) fail(id, 'measure(pts, side, ref) must be a function');
    }
    if (ex.options !== undefined && !Array.isArray(ex.options)) fail(id, 'options must be an array when present');
    for (const o of ex.options || []) {
      if (!isStr(o.key) || !isStr(o.label)) fail(id, 'each option needs a key and a label');
      if (!isArr(o.values)) fail(id, `option "${o.key}" needs values`);
      if (o.default === undefined) fail(id, `option "${o.key}" needs a default`);
      if (!o.values.includes(o.default)) fail(id, `option "${o.key}" default must be one of its values`);
    }

    /* Faults are the coaching. Each one needs a short spoken cue and a longer
       written tip: the cue is said mid-set, the tip is read afterwards. */
    if (!isArr(ex.faults)) fail(id, 'faults must be a non-empty array');
    const seen = new Set();
    for (const f of ex.faults) {
      if (!isStr(f.id)) fail(id, 'each fault needs an id');
      if (seen.has(f.id)) fail(id, `duplicate fault id "${f.id}"`);
      seen.add(f.id);
      if (!isStr(f.label)) fail(id, `fault "${f.id}" needs a label`);
      if (!isStr(f.cue)) fail(id, `fault "${f.id}" needs a spoken cue`);
      if (!isStr(f.tip)) fail(id, `fault "${f.id}" needs a written tip`);
      if (!Number.isFinite(f.weight)) fail(id, `fault "${f.id}" needs a numeric weight`);
      /* Only a form-tracked move must watch every fault. Elsewhere a fault may be listed for the
         person without a check (tracked: false); if a check is given it must be a function. */
      if (ex.tracking === 'form' && !isFn(f.check)) fail(id, `fault "${f.id}" needs a check function`);
      if (f.check !== undefined && !isFn(f.check)) fail(id, `fault "${f.id}" check must be a function`);
    }

    /* The guide is the good-form detail shown on the set-up page. */
    const g = ex.guide;
    if (!g || typeof g !== 'object') fail(id, 'guide is required');
    if (!isStr(g.surface)) fail(id, 'guide.surface must say what to lie or stand on');
    if (!isStr(g.stop)) fail(id, 'guide.stop must say when to stop');
    if (g.cannotSee !== undefined && typeof g.cannotSee !== 'string') fail(id, 'guide.cannotSee must be a string');
    if (!isArr(g.regions)) fail(id, 'guide.regions must be a non-empty array');
    for (const r of g.regions) {
      if (!isStr(r.name)) fail(id, 'each guide region needs a name');
      if (!isArr(r.points)) fail(id, `guide region "${r.name}" needs points`);
      for (const p of r.points) {
        if (!isStr(p.t)) fail(id, `guide region "${r.name}" has a point with no text`);
        if (typeof p.tracked !== 'boolean') fail(id, `guide point "${String(p.t).slice(0, 40)}…" must set tracked true/false`);
      }
    }
    return ex;
  }

  const list = [];                       // stable array: engine.js exposes this instance
  const index = Object.create(null);

  const library = {
    list,
    kinematics: null,                    // engine.js fills this in before any move loads

    /* define(factory) — factory receives the kinematics toolkit and returns the
       move. Taking a factory (rather than a plain object) means a move file can
       destructure just the helpers it uses and never touches engine internals. */
    define(factory) {
      if (!isFn(factory)) throw new Error('ExerciseLibrary.define expects a function');
      if (!library.kinematics) throw new Error('ExerciseLibrary: engine.js must load before any exercise');
      const ex = factory(library.kinematics);
      if (ex && ex.tracking === undefined) ex.tracking = 'form';   // the hand-written moves
      /* A one-sided move always offers Left / Right / Both. Adding it here keeps the
         choice identical everywhere and out of every move file. */
      if (ex && ex.sided && !(ex.options || []).some((o) => o.key === 'side')) {
        ex.options = [...(ex.options || []), SIDE_OPTION];
      }
      validate(ex);
      if (index[ex.id]) throw new Error(`exercise "${ex.id}" is already registered`);
      index[ex.id] = ex;
      /* Insert in `order`, so the catalogue reads the same however the files were
         loaded — <script> tags in the browser, readdir on the server. */
      let at = list.length;
      while (at > 0 && list[at - 1].order > ex.order) at--;
      list.splice(at, 0, ex);
      return ex;
    },

    SIDE_OPTION, TRACKING, LEVELS, CAM_HEIGHTS, POSTURES,
    all() { return list.slice(); },
    get(id) { return index[id] || null; },
    ids() { return list.map((e) => e.id); },
    validate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = library;
  else root.ExerciseLibrary = library;
})(typeof window !== 'undefined' ? window : globalThis);
