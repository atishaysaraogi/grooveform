#!/usr/bin/env node
'use strict';
/* The offline way to work on the exercise library (client/data/). No server needed.

     node scripts/catalog.js check              every file: parse, field names, names in shared.json, the library's own rules
     node scripts/catalog.js list [file]        ids and names, per file
     node scripts/catalog.js new <file> <id>    append a template move to moves/<file>.json, placeholders to replace
     node scripts/catalog.js remove <id>        delete a move from whichever file has it
     node scripts/catalog.js format             rewrite every data file in the shared style (short things on one line)
     node scripts/catalog.js sync-docs [file]   copy the _about field guide from one moves file (default: the first) to all the others

   The same checks run when the app loads and in `npm test`, so nothing here is optional — it is just
   faster to hear about a problem before pushing. */
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'client', 'data');
const engine = require(path.join(ROOT, 'client', 'coach', 'engine.js'));   // loads settings + every move; throws on the first bad file
const library = require(path.join(ROOT, 'client', 'coach', 'exercise-library.js'));
const catalog = require(path.join(ROOT, 'client', 'coach', 'catalog.js'));

const [cmd, ...args] = process.argv.slice(2);
const write = (rel, json) => fs.writeFileSync(path.join(DATA, rel), catalog.format(json) + '\n');
const fileRel = (name) => { const rel = name.endsWith('.json') ? name : `moves/${name}.json`; return rel.startsWith('moves/') ? rel : `moves/${rel}`; };
const data = () => catalog.readDataSync(DATA);

function check() {
  const d = data(); let problems = [];
  const all = d.files.flatMap((f) => f.json.moves.map((m) => m.id));
  for (const f of d.files) {
    const others = d.files.filter((x) => x !== f).flatMap((x) => x.json.moves.map((m) => m.id));
    problems.push(...catalog.checkFile(f.json, f.name, d, others));
    const text = fs.readFileSync(path.join(DATA, f.name), 'utf8');
    if (text !== catalog.format(f.json) + '\n') problems.push(`${f.name}: not in the shared style — run: node scripts/catalog.js format`);
  }
  const guides = d.files.map((f) => JSON.stringify((f.json._about || {}).fields));
  if (new Set(guides).size > 1) problems.push('the _about field guide differs between moves files — run: node scripts/catalog.js sync-docs');
  const tiers = {}; for (const e of engine.EXERCISES) tiers[e.tracking] = (tiers[e.tracking] || 0) + 1;
  if (problems.length) { console.error(problems.map((p) => '✗ ' + p).join('\n')); process.exit(1); }
  console.log(`✓ ${all.length} catalogue moves in ${d.files.length} files, ${d.manifest.code.length} code moves; ${engine.EXERCISES.length} in the library (${Object.entries(tiers).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}
function list(name) {
  const d = data();
  for (const f of d.files) {
    if (name && f.name !== fileRel(name)) continue;
    console.log(`${f.name}  —  ${f.json.group} (${f.json.moves.length})`);
    for (const m of f.json.moves) console.log(`  ${m.id.padEnd(24)} ${(m.tracking || 'none').padEnd(5)} ${m.type || 'reps'}/${m.view || 'front'}  ${m.name}`);
  }
}
function template(id, grp) {
  return {
    id, name: 'Name shown to the user', type: 'reps', view: 'side', tracking: 'none', level: 'beginner', equipment: ['none'],
    muscles: { primary: ['quadriceps'], secondary: [] },
    summary: 'One line for the list.',
    setup: 'Where the phone goes and how to start, in the user\'s words.',
    why: 'Why this camera angle can measure it (or why it cannot, if tracking is none).',
    camera: grp.camera || { height: 'hip', distance: '2 m', posture: 'standing' },
    tempo: 'Up 2 s, down 3 s.', dosage: '3 × 10.', progression: 'How to make it harder.', regression: 'How to make it easier.',
    contraindications: 'When not to do it.',
    faults: [
      { id: 'fault_one', label: 'What goes wrong', cue: 'What to do instead (≤ 8 words)', tip: 'Why it matters, one or two sentences.', severity: 2 },
      { id: 'fault_two', label: 'Second thing that goes wrong', cue: 'Short spoken cue', tip: 'Written explanation.', severity: 1 },
    ],
    guide: { surface: 'What to stand or lie on.', stop: 'When to stop.', cannotSee: 'What the person must check themselves.',
      regions: [{ name: 'Trunk', points: [{ t: 'One form point.', tracked: false }] }, { name: 'Working leg', points: [{ t: 'Another form point.', tracked: false }] }] },
    pose: { A: { preset: 'standing' }, B: { preset: 'standing', thigh: 30, shin: 30 }, work: { thigh: 1 } },
    _todo: 'Replace every placeholder above, then delete this note. To let the camera count, add progress: { "metric": "knee", "start": "calibrated", "target": 172 } and set tracking to "reps"; to let it judge, give a fault a metric, op and threshold and set tracking to "form".',
  };
}
function add(name, id) {
  if (!name || !id) { console.error('usage: node scripts/catalog.js new <file> <id>'); process.exit(2); }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) { console.error('id: lower-case letters, digits and underscores, e.g. seated_knee_ext'); process.exit(2); }
  if (library.get(id)) { console.error(`id "${id}" is already in use`); process.exit(1); }
  const rel = fileRel(name), file = path.join(DATA, rel);
  if (!fs.existsSync(file)) { console.error(`${rel} does not exist — the files are: ${data().manifest.moves.join(', ')}`); process.exit(1); }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.moves.push(template(id, json));
  write(rel, json);
  console.log(`added ${id} to ${rel} — it is the last move in the file. Replace the placeholders, then: node scripts/catalog.js check`);
}
function remove(id) {
  if (!id) { console.error('usage: node scripts/catalog.js remove <id>'); process.exit(2); }
  const d = data();
  for (const f of d.files) {
    const i = f.json.moves.findIndex((m) => m.id === id);
    if (i < 0) continue;
    f.json.moves.splice(i, 1); write(f.name, f.json);
    console.log(`removed ${id} from ${f.name}`); return;
  }
  console.error(`no catalogue move with id "${id}"` + (library.get(id) ? ' — it is a hand-written code move under client/coach/library/' : '')); process.exit(1);
}
function format() {
  const d = data();
  for (const rel of ['manifest.json', d.manifest.settings, d.manifest.shared, ...d.manifest.moves]) write(rel, JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8')));
  console.log('formatted every data file');
}
function syncDocs(name) {
  const d = data();
  const src = name ? d.files.find((f) => f.name === fileRel(name)) : d.files[0];
  if (!src) { console.error('no such moves file'); process.exit(1); }
  const fields = src.json._about.fields;
  for (const f of d.files) { if (f === src) continue; f.json._about = { ...f.json._about, fields }; write(f.name, f.json); }
  console.log(`field guide copied from ${src.name} to ${d.files.length - 1} files`);
}

const commands = { check, list, new: add, remove, format, 'sync-docs': syncDocs };
if (!commands[cmd]) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 12).join('\n')); process.exit(cmd ? 2 : 0); }
commands[cmd](...args);
