/* ---------------------------------------------------------------------------
   Plans: exercises bundled for a condition, and a person's own.

   A bundle is one JSON file in public/bundles — a name, who it is for, a few
   notes, its sources, and the items: an exercise by id with what a coach or a
   physio would change for one person: the sets, the reps or the hold, the range
   of motion (a percent of the full movement, scaled from the return line —
   see Core.adjust), the faults to leave alone, a setting by name, a note. The
   library's bundles are read like the exercises (bundles/index.json, then the
   files; in node, the folder). A person's own plans live in this browser
   (localStorage 'ontrack.plans'): a copy of a bundle to change, or one built
   from the exercise pages. A plan travels as a link (#/plan/~<code>, the plan
   itself in the address) or as a file.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const fs = require('fs'), path = require('path');
    module.exports = factory(require('./core.js'), { fs, path, dir: path.join(__dirname, '..', 'bundles') });
  } else root.Plans = factory(root.Core, null);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, node) {
  'use strict';
  const KEY = 'ontrack.plans';
  const Plans = { list: [], mine: [], shared: null, problems: [], ready: null };

  /* an item, whole: the exercise and what is changed for it */
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  function cleanItem(it) {
    if (!it || typeof it !== 'object' || typeof it.move !== 'string') return null;
    const o = { move: it.move };
    const sets = num(it.sets, 1, 20), reps = num(it.reps, 1, 100), hold = num(it.hold, 0, 600), rom = num(it.rom, 20, 150);
    if (sets != null) o.sets = Math.round(sets);
    if (reps != null) o.reps = Math.round(reps);
    if (hold != null) o.hold = hold;
    if (rom != null && rom !== 100) o.rom = Math.round(rom);
    if (Array.isArray(it.ignore)) { const ig = it.ignore.filter((x) => typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9]*$/.test(x)); if (ig.length) o.ignore = ig; }
    if (it.settings && typeof it.settings === 'object') { const s = {}; for (const [k, v] of Object.entries(it.settings)) if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(k) && typeof v === 'number' && Number.isFinite(v)) s[k] = v; if (Object.keys(s).length) o.settings = s; }
    if (typeof it.note === 'string' && it.note.trim()) o.note = it.note.trim().slice(0, 200);
    return o;
  }
  function clean(p, custom) {
    if (!p || typeof p !== 'object') return null;
    const items = (Array.isArray(p.items) ? p.items : []).map(cleanItem).filter(Boolean);
    const o = { v: 1, id: typeof p.id === 'string' && p.id ? p.id : 'my-' + Date.now().toString(36), name: String(p.name || 'My plan').slice(0, 80), for: String(p.for || '').slice(0, 200), blurb: String(p.blurb || '').slice(0, 600),
      notes: (Array.isArray(p.notes) ? p.notes : []).filter((n) => typeof n === 'string').slice(0, 12), sources: (Array.isArray(p.sources) ? p.sources : []).filter((s) => s && typeof s.url === 'string').map((s) => ({ title: String(s.title || s.url), url: s.url })).slice(0, 8),
      items, custom: !!custom };
    if (typeof p.order === 'number') o.order = p.order;
    return o;
  }
  /* the adjustments of an item, as Core.adjust takes them */
  const adjustOf = (it, o) => ({ rom: it && it.rom != null ? it.rom : 100, ignore: (it && it.ignore) || [], settings: (it && it.settings) || {},
    ...(o && o.counts === false ? {} : { reps: it && it.reps, sets: it && it.sets, hold: it && it.hold }) });

  /* what an item asks for, in words: "3 × 10 · hold 2 s · range 70% · leaving alone: toes pointing away" */
  function words(it, move) {
    const bits = [];
    const reps = move && move.reps;
    const d = Object.assign({}, Core.COMMON, move ? move.defaults : {});
    const sets = it.sets || d.setCount;
    if (reps) bits.push(`${sets} × ${it.reps || d.repCount}` + (it.hold != null ? ` · hold ${it.hold} s` : ''));
    else bits.push(`${sets} × ${it.hold != null ? it.hold : d.holdTargetSec} s`);
    if (it.rom != null && it.rom !== 100) bits.push(`range ${it.rom}%`);
    if (it.ignore && it.ignore.length) bits.push('leaving alone: ' + it.ignore.map((id) => (move && move.cues[id] && move.cues[id].label) || id).join(', '));
    if (it.settings && Object.keys(it.settings).length) bits.push(Object.entries(it.settings).map(([k, v]) => `${k} ${v}`).join(', '));
    return bits.join(' · ');
  }

  /* the problems with a bundle against the library: an exercise it names that is not there,
     a fault or a setting the exercise does not have, a number out of range */
  function check(p, Moves) {
    const out = [];
    const err = (at, message) => out.push({ level: 'error', at, message });
    if (!p || typeof p !== 'object') { err('', 'not a plan'); return out; }
    if (!p.name) err('name', 'the plan needs a name');
    if (!Array.isArray(p.items) || !p.items.length) err('items', 'at least one exercise');
    (p.items || []).forEach((it, i) => {
      const at = `items[${i}]`;
      const m = Moves && Moves[it.move];
      if (!m) { err(at + '.move', 'not an exercise in the library: ' + it.move); return; }
      for (const id of it.ignore || []) if (!m.faults.includes(id) || m.prompts.includes(id) || id === 'lost') err(at + '.ignore', `${it.move} has no fault ${id}`);
      for (const k of Object.keys(it.settings || {})) if (typeof m.defaults[k] !== 'number') err(at + '.settings', `${it.move} has no setting ${k}`);
      if (it.rom != null && !(it.rom >= 20 && it.rom <= 150)) err(at + '.rom', 'the range of motion is a percent, 20 to 150');
      if (it.rom != null && it.rom !== 100 && !m.reps) err(at + '.rom', `${it.move} is a hold: it has no range to scale`);
      if (it.reps != null && !m.reps) err(at + '.reps', `${it.move} is a hold: give it a hold, not reps`);
      for (const [k, lo, hi] of [['sets', 1, 20], ['reps', 1, 100], ['hold', 0, 600]]) if (it[k] != null && !(it[k] >= lo && it[k] <= hi)) err(`${at}.${k}`, `${k}: ${lo} to ${hi}`);
    });
    return out;
  }

  /* ---- a person's own plans, in this browser ---- */
  function load() {
    if (node) return;
    try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); Plans.mine = d && Array.isArray(d.plans) ? d.plans.map((p) => clean(p, true)).filter(Boolean) : []; }
    catch (e) { Plans.mine = []; }
  }
  function save() { if (node) return; try { localStorage.setItem(KEY, JSON.stringify({ v: 1, plans: Plans.mine })); } catch (e) { /* storage full or off */ } }
  /* a plan the page was handed from elsewhere (the care layer's assigned plan) is found by id too */
  Plans.extra = [];
  function get(id) { return Plans.mine.find((p) => p.id === id) || Plans.list.find((p) => p.id === id) || Plans.extra.find((p) => p.id === id) || (Plans.shared && Plans.shared.id === id ? Plans.shared : null); }
  function create(p) { const o = clean(Object.assign({}, p, { id: 'my-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }), true); Plans.mine.push(o); save(); return o; }
  function copy(p) { return create({ name: p.custom ? p.name + ' (copy)' : p.name + ' — my copy', for: p.for, blurb: p.blurb, notes: p.notes, sources: p.sources, items: JSON.parse(JSON.stringify(p.items)) }); }
  function remove(id) { const n = Plans.mine.length; Plans.mine = Plans.mine.filter((p) => p.id !== id); if (Plans.mine.length !== n) save(); }
  const all = () => Plans.list.concat(Plans.mine);

  /* ---- a plan in a link: the plan itself, as base64url JSON, after #/plan/~ ---- */
  const b64 = { enc: (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); return typeof atob === 'function' ? decodeURIComponent(escape(atob(t))) : Buffer.from(t, 'base64').toString('utf8'); } };
  function encode(p) { const o = clean(p, false); return b64.enc(JSON.stringify({ v: 1, name: o.name, for: o.for, blurb: o.blurb, notes: o.notes, items: o.items })); }
  function decode(code) {
    try { const p = JSON.parse(b64.dec(String(code || ''))); const o = clean(p, false); if (!o || !o.items.length) return null; o.id = '~' + code; o.shared = true; return o; }
    catch (e) { return null; }
  }
  const sortList = () => { Plans.list.sort((a, b) => ((a.order == null ? 99 : a.order) - (b.order == null ? 99 : b.order)) || a.name.localeCompare(b.name)); };

  Object.assign(Plans, { clean, cleanItem, adjustOf, words, check, load, save, get, create, copy, remove, all, encode, decode });

  if (node) {
    const { fs, path, dir } = node;
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.json$/.test(f) && f !== 'index.json').sort() : [];
    for (const f of files) {
      try { const p = clean(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), false); if (p) Plans.list.push(p); }
      catch (e) { Plans.problems.push({ file: f, error: e.message }); }
    }
    sortList();
    Plans.ready = Promise.resolve(Plans);
  } else {
    load();
    Plans.ready = (async () => {
      const bust = '?v=' + (Core.VER || '');
      try {
        const idx = await (await fetch('bundles/index.json' + bust, { cache: 'no-cache' })).json();
        await Promise.all((Array.isArray(idx.files) ? idx.files : []).map(async (f) => {
          try { const p = clean(await (await fetch('bundles/' + f + bust, { cache: 'no-cache' })).json(), false); if (p) Plans.list.push(p); }
          catch (e) { Plans.problems.push({ file: f, error: e.message || String(e) }); }
        }));
      } catch (e) { Plans.problems.push({ file: 'index.json', error: e.message || String(e) }); }
      sortList();
      return Plans;
    })();
  }
  return Plans;
});
