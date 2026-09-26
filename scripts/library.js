#!/usr/bin/env node
/* The exercise library on the command line.
     node scripts/library.js index    write public/exercises/index.json from the files in the folder
     node scripts/library.js check    read every file, report every problem, exit 1 on an error
     node scripts/library.js list     the exercises, in the order the app shows them
   `npm test` runs `index` first, and the Pages workflow runs the tests before it
   publishes, so a file dropped into the folder is in the index by the time it is
   deployed. The dev server (scripts/serve.js) lists the folder itself. */
'use strict';
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'exercises');
const Spec = require('../public/js/spec.js');

const files = () => fs.readdirSync(DIR).filter((f) => /\.json$/.test(f) && f !== 'index.json').sort();
function index() {
  const list = files();
  const out = { v: 1, files: list, written: new Date().toISOString().slice(0, 10) };
  const file = path.join(DIR, 'index.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const after = JSON.stringify(out, null, 2) + '\n';
  /* only the list matters: the date is not a reason to rewrite the file */
  const same = before && (() => { try { return JSON.stringify(JSON.parse(before).files) === JSON.stringify(list); } catch { return false; } })();
  if (!same) fs.writeFileSync(file, after);
  return list;
}
function check() {
  let bad = 0;
  for (const f of files()) {
    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
    catch (e) { console.log(`${f}: not JSON — ${e.message}`); bad += 1; continue; }
    const problems = Spec.check(json);
    if (json.id && f !== json.id + '.json') problems.push({ level: 'warn', at: 'id', message: `the file is ${f} but the id is ${json.id}; name the file after the id` });
    for (const p of problems) console.log(`${f}: ${p.level === 'error' ? 'ERROR' : 'warn '} ${p.at ? p.at + ' — ' : ''}${p.message}`);
    if (problems.some((p) => p.level === 'error')) bad += 1;
    else console.log(`${f}: ok${problems.length ? ` (${problems.length} to look at)` : ''}`);
  }
  return bad;
}
function list() {
  const Moves = require('../public/js/moves.js');
  for (const m of Moves.list) console.log(`${String(m.order).padStart(3)}  ${m.id.padEnd(12)} ${m.name.padEnd(16)} ${m.reps ? 'reps' : 'hold'}  ${m.camera}  ${m.bands.length} measurements, ${m.faults.length - 1 - m.prompts.length} faults${m.status !== 'ready' ? '  [' + m.status + ']' : ''}`);
  for (const p of Moves.problems) console.log(`  ! ${p.file}: ${p.error}`);
}

const cmd = process.argv[2] || 'index';
if (cmd === 'index') { const l = index(); console.log(`index.json: ${l.length} exercise${l.length === 1 ? '' : 's'} — ${l.join(', ')}`); }
else if (cmd === 'check') { const bad = check(); if (bad) { console.log(`${bad} file${bad === 1 ? '' : 's'} with errors`); process.exit(1); } }
else if (cmd === 'list') list();
else { console.log('usage: node scripts/library.js index | check | list'); process.exit(2); }
