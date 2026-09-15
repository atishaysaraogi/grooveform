#!/usr/bin/env node
'use strict';
/* The offline way to work on the exercise library (client/data/). No server needed.

     node scripts/catalog.js check              every file: parse, field names, names in shared.json, the library's own rules
     node scripts/catalog.js list [region]      ids and names, per region
     node scripts/catalog.js new <region> <id>  write moves/<id>.json from a template and list it in that region
     node scripts/catalog.js remove <id>        delete moves/<id>.json and take it off its region's list
     node scripts/catalog.js format             rewrite every data file in the shared style (short things on one line)

   One exercise to a file: moves/<id>.json. regions/<name>.json holds the defaults its moves inherit
   and the ids it lists, in order; _about.json is the field guide, one copy for the whole library.

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
const regionRel = (name) => (name.includes('/') ? name : `regions/${name.replace(/\.json$/, '')}.json`);
const moveRel = (id) => `moves/${id}.json`;
const readRel = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const data = () => catalog.readDataSync(DATA);

function check() {
  const d = data(); let problems = [];
  const all = d.files.flatMap((f) => f.json.moves.map((m) => m.id));
  const styled = (rel, json) => { if (fs.readFileSync(path.join(DATA, rel), 'utf8') !== catalog.format(json) + '\n') problems.push(`${rel}: not in the shared style — run: node scripts/catalog.js format`); };
  for (const f of d.files) {
    const others = d.files.filter((x) => x !== f).flatMap((x) => x.json.moves.map((m) => m.id));
    problems.push(...catalog.checkFile(f.json, f.name, d, others));
    styled(f.name, readRel(f.name));
    for (const m of f.json.moves) {
      styled(moveRel(m.id), m);
      /* a move file says which region it belongs to, and that has to be the region listing it */
      if (m.region && m.region !== f.json.region) problems.push(`${moveRel(m.id)}: says region "${m.region}" but ${f.name} lists it`);
    }
  }
  /* every move file is listed by exactly one region — an orphan would never load */
  const listed = new Set(all);
  for (const f of fs.readdirSync(path.join(DATA, 'moves')).filter((x) => x.endsWith('.json'))) {
    const id = f.replace(/\.json$/, '');
    if (!listed.has(id)) problems.push(`moves/${f}: no region lists it — add "${id}" to a regions/*.json, or delete the file`);
  }
  styled('manifest.json', d.manifest); styled(d.manifest.about, d.about);
  const tiers = {}; for (const e of engine.EXERCISES) tiers[e.tracking] = (tiers[e.tracking] || 0) + 1;
  if (problems.length) { console.error(problems.map((p) => '✗ ' + p).join('\n')); process.exit(1); }
  console.log(`✓ ${all.length} catalogue moves, one file each, in ${d.files.length} regions; ${d.manifest.code.length} code moves; ${engine.EXERCISES.length} in the library (${Object.entries(tiers).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}
function list(name) {
  const d = data();
  for (const f of d.files) {
    if (name && f.name !== regionRel(name)) continue;
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
    region: grp.region,
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
  if (!name || !id) { console.error('usage: node scripts/catalog.js new <region> <id>'); process.exit(2); }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) { console.error('id: lower-case letters, digits and underscores, e.g. seated_knee_ext'); process.exit(2); }
  if (library.get(id)) { console.error(`id "${id}" is already in use`); process.exit(1); }
  const rel = regionRel(name);
  if (!fs.existsSync(path.join(DATA, rel))) { console.error(`${rel} does not exist — the regions are: ${data().manifest.regions.join(', ')}`); process.exit(1); }
  const region = readRel(rel);
  write(moveRel(id), template(id, region));
  region.moves.push(id); write(rel, region);
  console.log(`wrote ${moveRel(id)} and listed it last in ${rel}. Replace the placeholders, then: node scripts/catalog.js check`);
}
function remove(id) {
  if (!id) { console.error('usage: node scripts/catalog.js remove <id>'); process.exit(2); }
  const d = data();
  for (const rel of d.manifest.regions) {
    const region = readRel(rel); const i = (region.moves || []).indexOf(id);
    if (i < 0) continue;
    region.moves.splice(i, 1); write(rel, region);
    fs.unlinkSync(path.join(DATA, moveRel(id)));
    console.log(`deleted ${moveRel(id)} and took it off ${rel}`); return;
  }
  console.error(`no catalogue move with id "${id}"` + (library.get(id) ? ' — it is a hand-written code move under client/coach/library/' : '')); process.exit(1);
}
function format() {
  const d = data();
  const rels = ['manifest.json', d.manifest.settings, d.manifest.shared, d.manifest.about, ...d.manifest.regions,
    ...d.files.flatMap((f) => f.json.moves.map((m) => moveRel(m.id)))];
  for (const rel of rels) write(rel, readRel(rel));
  console.log(`formatted ${rels.length} data files`);
}

const commands = { check, list, new: add, remove, format };
if (!commands[cmd]) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 12).join('\n')); process.exit(cmd ? 2 : 0); }
commands[cmd](...args);
