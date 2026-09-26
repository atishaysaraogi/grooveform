/* ---------------------------------------------------------------------------
   The exercises: the library, loaded from its files.

   Every exercise is one JSON file in public/exercises — what it measures, what
   counts as right, what it says and in what order, how it is drawn, the words
   around it (docs/exercise-file.md). spec.js turns a file into a move; this
   finds the files and keeps the moves: `Moves.list` in the order the files
   ask for, `Moves[id]` for each.

   In node the folder is read as this file is required, so the tests and the
   scripts see the library at once. In the browser the folder's index
   (exercises/index.json, written by `node scripts/library.js index`, and by
   the dev server on the fly) is fetched and the files after it; `Moves.ready`
   is the promise the pages wait on. A draft from the builder, kept in the
   browser, can be laid over the library for a trial run (`Moves.draft`).
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const fs = require('fs'), path = require('path');
    module.exports = factory(require('./core.js'), require('./spec.js'), { fs, path, dir: path.join(__dirname, '..', 'exercises') });
  } else root.Moves = factory(root.Core, root.Spec, null);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Spec, node) {
  'use strict';
  const Moves = { list: [], files: {}, problems: [], ready: null };
  const KEEP = new Set(['list', 'files', 'problems', 'ready', 'add', 'remove', 'draft', 'load', 'base', 'library']);

  function order() {
    Moves.list = Object.keys(Moves).filter((k) => !KEEP.has(k) && Moves[k] && Moves[k].id === k).map((k) => Moves[k])
      .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
  }
  /* a file's contents → the move, kept under its id; an id already there is replaced */
  function add(json, extra) {
    const errors = Spec.check(json).filter((p) => p.level === 'error');
    if (errors.length) throw new Error(errors.map((p) => (p.at ? p.at + ': ' : '') + p.message).join('; '));
    const m = Spec.compile(json, Core);
    Object.assign(m, extra || {});
    Moves[m.id] = m;
    order();
    return m;
  }
  function remove(id) { if (Moves[id] && !KEEP.has(id)) { delete Moves[id]; delete Moves.files[id]; order(); } }
  /* the builder's draft laid over the library: a trial run of a file not yet in
     the folder. It replaces a library move of the same id until it is dropped. */
  const library = {};
  function draft(json) {
    if (!json) {
      for (const m of Moves.list.slice()) if (m.draft) remove(m.id);
      for (const id of Object.keys(library)) { Moves[id] = library[id]; delete library[id]; }
      order(); return null;
    }
    if (Moves[json.id] && !Moves[json.id].draft) library[json.id] = Moves[json.id];
    return add(json, { draft: true });
  }
  Moves.add = add; Moves.remove = remove; Moves.draft = draft; Moves.library = library;

  if (node) {
    const { fs, path, dir } = node;
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.json$/.test(f) && f !== 'index.json').sort() : [];
    for (const f of files) {
      try { const m = add(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); Moves.files[m.id] = f; }
      catch (e) { Moves.problems.push({ file: f, error: e.message }); }
    }
    Moves.ready = Promise.resolve(Moves);
  } else {
    Moves.base = 'exercises/';
    Moves.load = async function (base) {
      base = base || Moves.base; Moves.base = base;
      const bust = '?v=' + (Core.VER || '');
      const idx = await (await fetch(base + 'index.json' + bust, { cache: 'no-cache' })).json();
      const files = Array.isArray(idx.files) ? idx.files : [];
      await Promise.all(files.map(async (f) => {
        try { const m = add(await (await fetch(base + f + bust, { cache: 'no-cache' })).json()); Moves.files[m.id] = f; }
        catch (e) { Moves.problems.push({ file: f, error: e.message || String(e) }); }
      }));
      return Moves;
    };
    Moves.ready = Moves.load().catch((e) => { Moves.problems.push({ file: 'index.json', error: e.message || String(e) }); return Moves; });
  }
  return Moves;
});
