# Programmes and plans

A **programme** is a bundle of exercises for a condition, with the numbers set
the way a physio would start someone. The library's programmes are JSON files
in `public/bundles` (one each, listed by `bundles/index.json`, which
`node scripts/library.js index` writes). A **plan** is the same thing in a
person's own hands: a programme copied and changed, or one built up from the
exercise pages, kept in that browser (`localStorage` `ontrack.plans`) and
shared as a link or a file.

## The file

```jsonc
{
  "v": 1,
  "id": "knee-early",                 // one word with dashes; the file is <id>.json
  "name": "Knee — early rehab",
  "for": "The first weeks after a knee injury or surgery …",
  "order": 3,                         // the home page's order
  "blurb": "Range of motion and the thigh muscle switched back on …",
  "notes": ["The first goal after surgery is …", "Ice after, if it swells."],
  "sources": [{ "title": "Range of motion after knee replacement", "url": "https://…" }],
  "items": [
    { "move": "quadset", "sets": 3, "reps": 10, "hold": 5 },
    { "move": "slr", "sets": 3, "reps": 10, "rom": 70, "ignore": ["toesDown"], "note": "A lower lift; the toes are left alone for now." },
    { "move": "kneechest", "sets": 3, "hold": 30 },
    { "move": "bridge", "settings": { "hipMin": 150 } }
  ]
}
```

Each item names an exercise by its id and carries what a coach or a physio
changes for one person. Everything but `move` is optional; the exercise's own
defaults stand where an item says nothing.

| field | what it does |
|---|---|
| `sets` | sets in the session (1–20) |
| `reps` | reps in a set, for a rep exercise (1–100) |
| `hold` | seconds: the hold at the top of each rep, or the hold of a held exercise (0–600) |
| `rom` | range of motion, a percent of the full movement (20–150; left out at 100). See below. |
| `ignore` | fault ids (the file's `faults[].id`) to leave alone: never called, and a measurement every fault of which is left alone no longer holds the position either — it is only shown |
| `settings` | any of the exercise's numbers by name (`defaults` keys), laid over before the range is applied |
| `note` | a line for whoever does it, shown on the plan and in the banner over the exercise (≤ 200 characters) |

`Plans.check(plan, Moves)` (in `public/js/plans.js`) finds an exercise, a
fault or a setting that is not there, a hold given reps or a range, and a
number out of its range; `npm test` runs it over every bundle.

## The range of motion

A rep exercise has a *progress* measurement with a return line (`downAt`,
where a rep counts), an under-way line (`raiseAt`) and a top band. The range
scales those from the return line: at 70% the under-way line and both edges of
the top band sit seven tenths of the way out, so a lift seven tenths as far is
the top and counts, and the far edge comes in with it — going the full way is
now too far. At 120% they sit further out. The return line itself stays, and
so does everything that is not the progress measurement. A held exercise has
no range to scale. `Core.adjust(move, cfg, adjustments)` does it and the
tests in `test/adjust.test.js` hold it.

## On the pages

- **Home** lists the programmes, then *My plans* (with *New plan* and *Load a
  plan file*), then every exercise.
- **A programme's page** lists its steps — the exercise, what the step asks for
  in words, its note — each with *Start*; the notes and sources; and *Copy to
  my plans and change it*, *Copy a link*, *Download the plan*.
- **A plan of the person's own** has the same page with the steps editable:
  *Adjust* on a step opens the sets, reps and hold, the range of motion, a
  checkbox per fault (unticked is left alone), the note and, under *Every
  number*, each of the exercise's settings by name; steps move up and down and
  go; an exercise is added from a list; the name, who it is for and the line
  about it are edited; *Delete this plan*.
- **A step opened** (`#/plan/<id>/<n>`) is the exercise's page with the plan's
  counts on the bubbles, the range and the faults applied (the bands on the
  page show the scaled edges; *What the camera coaches* strikes through what is
  left alone), and a banner naming the plan, the step, the changes and the next
  step. The session's end offers *Next: …*. A bubble tapped during a step of
  the person's own plan changes the plan too.
- **Adjust**, on every exercise page, sets the range and the faults for that
  person outside any plan (kept on the phone, for that exercise; the
  "Every number" panel below it still shows the file's own numbers, the range
  is applied on top) and *Add to a plan* puts the exercise, with the bubbles'
  counts and these adjustments, into one of the person's plans or a new one.
- **A link** (`#/plan/~<code>`) carries the plan itself, base64url JSON after
  the `~`: whoever opens it sees the plan, can do its steps, and *Save to my
  plans* keeps it. A **file** is the same JSON, downloaded from the plan's
  page and loaded from the home page.

## Writing a programme

Start from a copy on the page — copy a library programme or build one from
the exercise pages, adjust the steps, *Download the plan* — and drop the file
into `public/bundles` with an `id`, an `order`, `notes` and `sources`, then
`node scripts/library.js index`. The checker runs under `npm test`.
