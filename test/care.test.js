'use strict';
/* The care server's logic, run in node with a fake clock, a fake file store and
   the messages caught: sign-in by code, a physio linked to a patient, a plan
   assigned, sessions, a review judged with a new fault and a change to the step,
   the visit interval and its reminders, the false-alarm report, export, deletion.
   Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');
const Plans = require('../public/js/plans.js');
const { CareServer, normPhone, addDays } = require('../public/js/care-core.js');

/* a server with everything fake and visible */
function rig(o) {
  const clock = { t: Date.parse('2026-10-05T04:30:00Z') };   // 10:00 in Kolkata, a Monday
  const sent = [], files = {};
  const store = { data: {}, saves: 0, save() { this.saves += 1; } };
  const srv = CareServer(store, Object.assign({ now: () => clock.t, demoCode: '123456', send: (m) => sent.push(m), Plans, Moves, baseUrl: 'https://x.test/',
    files: { async put(p, b, t) { files[p] = { bytes: b, type: t }; }, async get(p) { return files[p] || null; }, async del(p) { delete files[p]; } } }, o || {}));
  const call = (m, t, a) => srv.call(m, t, a);
  /* sign in: the code, the token */
  const signIn = async (phone, device) => { await call('requestCode', null, { phone }); return (await call('verify', null, { phone, code: '123456', device: device || 'test' })).token; };
  return { srv, call, signIn, clock, sent, files, store, D: store.data };
}

test('a phone number is normalised the Indian way, and a code signs a person in with limits', async () => {
  assert.equal(normPhone('98765 43210'), '+919876543210');
  assert.equal(normPhone('09876543210'), '+919876543210');
  assert.equal(normPhone('+91 98765-43210'), '+919876543210');
  assert.equal(normPhone('12'), null);
  const R = rig();
  const r = await R.call('requestCode', null, { phone: '9876543210' });
  assert.equal(r.demoCode, '123456'); assert.equal(R.sent[0].kind, 'otp'); assert.match(R.sent[0].text, /123456/);
  await assert.rejects(R.call('verify', null, { phone: '9876543210', code: '000000' }), /wrong code \(4/);
  const v = await R.call('verify', null, { phone: '9876543210', code: '123456', device: 'a phone' });
  assert.ok(v.token && v.user.id && v.isNew);
  const me = await R.call('me', v.token);
  assert.equal(me.user.phone, '+919876543210'); assert.equal(me.user.role, 'patient');
  /* five codes an hour, no more */
  for (let i = 0; i < 4; i++) await R.call('requestCode', null, { phone: '9876543210' });
  await assert.rejects(R.call('requestCode', null, { phone: '9876543210' }), /too many codes/);
  R.clock.t += 3600 * 1000 + 1;
  await R.call('requestCode', null, { phone: '9876543210' });
  /* five wrong tries lock the number */
  for (let i = 0; i < 4; i++) await assert.rejects(R.call('verify', null, { phone: '9876543210', code: '1' }), /wrong code/);
  await assert.rejects(R.call('verify', null, { phone: '9876543210', code: '1' }), /too many wrong/);
  await assert.rejects(R.call('verify', null, { phone: '9876543210', code: '123456' }), /too many wrong/);
  /* a token outlives ninety idle days, not more */
  R.clock.t += 91 * 24 * 3600 * 1000;
  await assert.rejects(R.call('me', v.token), /signed out/);
  /* the admin's number is the admin */
  const A = rig({ adminPhones: ['+911111111111'] });
  const t = await A.signIn('1111111111');
  assert.equal((await A.call('me', t)).user.role, 'admin');
});

test('a profile, consents, and a role set only by the admin, or by oneself in the sandbox', async () => {
  const R = rig();
  const t = await R.signIn('9000000001');
  await assert.rejects(R.call('updateProfile', t, { born: 2015 }), /over eighteen/);
  const p = await R.call('updateProfile', t, { name: 'Sunita', born: 1968, sex: 'f', condition: 'knee replacement, left' });
  assert.equal(p.user.name, 'Sunita'); assert.equal(p.user.born, 1968);
  await R.call('consent', t, { purpose: 'research', on: true });
  assert.equal((await R.call('me', t)).consents.research, true);
  await assert.rejects(R.call('setRole', t, { role: 'physio' }), /registration/);
  const L = rig({ local: true });
  const tl = await L.signIn('9000000002');
  const r = await L.call('setRole', tl, { role: 'physio' });
  assert.equal(r.user.role, 'physio');
  assert.ok((await L.call('me', tl)).org, 'a physio has an organisation, on the pilot plan');
  assert.equal((await L.call('me', tl)).org.can.reviews, true);
});

/* the physio and the patient, linked, with a plan: the rig most tests start from */
async function clinic(o) {
  const R = rig(Object.assign({ adminPhones: ['+910000000000'] }, o || {}));
  const admin = await R.signIn('0000000000');
  const physio = await R.signIn('9000000010');
  await R.call('updateProfile', physio, { name: 'Dr. Meera', clinic: 'Rao Physio' });
  const pid = (await R.call('me', physio)).user.id;
  await R.call('setRole', admin, { userId: pid, role: 'physio' });
  const inv = await R.call('addPatient', physio, { phone: '9000000020', name: 'Sunita' });
  assert.match(inv.message, /Dr. Meera at Rao Physio wants to add you/); assert.match(inv.url, /care\.html#\/care\/link\//);
  const patient = await R.signIn('9000000020');
  await R.call('updateProfile', patient, { born: 1968 });
  const me = await R.call('me', patient);
  assert.equal(me.links.length, 1); assert.equal(me.links[0].state, 'pending');
  await R.call('acceptLink', patient, { linkId: me.links[0].id });
  return Object.assign(R, { admin, physio, patient, pid, patientId: me.user.id, linkId: me.links[0].id });
}

test('a physio adds a patient by number, the patient accepts, and a programme is assigned and modified as versions', async () => {
  const R = await clinic();
  const list = await R.call('patients', R.physio);
  assert.equal(list.patients.length, 1); assert.equal(list.patients[0].state, 'accepted'); assert.equal(list.patients[0].patient.name, 'Sunita');
  assert.ok(list.patients[0].week.flags.length === 0, 'no flags on day one: ' + JSON.stringify(list.patients[0].week.flags));
  /* a stranger cannot read her */
  const other = await R.signIn('9000000030');
  await assert.rejects(R.call('patient', other, { id: R.patientId }), /for a physio/);
  /* the library programme, with a step changed, assigned */
  const bundle = JSON.parse(JSON.stringify(Plans.list.find((p) => p.id === 'knee-early')));
  bundle.items[0].reps = 8; bundle.items[2].rom = 60;
  await assert.rejects(R.call('assignPlan', R.physio, { patientId: R.patientId, plan: { name: 'x', items: [{ move: 'nosuch' }] } }), /not an exercise/);
  const a1 = await R.call('assignPlan', R.physio, { patientId: R.patientId, plan: bundle, note: 'Start gently.' });
  assert.equal(a1.plan.v, 1); assert.equal(a1.plan.plan.id, 'asg-' + R.patientId); assert.equal(a1.plan.plan.items[0].reps, 8);
  assert.ok(R.sent.some((m) => m.kind === 'plan' && /set your exercises/.test(m.text)), 'the patient is told');
  const mine = await R.call('myPlan', R.patient);
  assert.equal(mine.plan.plan.name, 'Knee — early rehab'); assert.equal(mine.plan.physio.name, 'Dr. Meera'); assert.equal(mine.plan.plan.assigned, true);
  bundle.items[0].reps = 10;
  const a2 = await R.call('assignPlan', R.physio, { patientId: R.patientId, plan: bundle });
  assert.equal(a2.plan.v, 2);
  assert.equal((await R.call('myPlan', R.patient)).plan.v, 2, 'the latest version is the plan');
  /* too hard today: the patient eases the step a notch, logged */
  const e = await R.call('easeStep', R.patient, { step: 0 });
  assert.equal(e.plan.v, 3); assert.equal(e.plan.plan.items[0].reps, 7); assert.match(e.plan.plan.items[0].note, /Eased by the patient/);
  const pg = await R.call('patient', R.physio, { id: R.patientId });
  assert.equal(pg.plan.versions, 3); assert.match(pg.plan.note, /too hard today/);
});

test('sessions saved, the week read, pain flagged to the physio', async () => {
  const R = await clinic();
  await R.call('assignPlan', R.physio, { patientId: R.patientId, plan: Plans.list.find((p) => p.id === 'knee-early') });
  const s = await R.call('saveSession', R.patient, { id: 'sess-1', at: R.clock.t, move: 'quadset', planId: 'asg-' + R.patientId, planV: 1, step: 0, sets: [{ reps: 8, repTarget: 10, holdSec: 40, bestSec: 5, cues: { propLow: 2 } }], appV: '2026-10-01g', device: 'Android Chrome',
    reps: [{ set: 1, n: 1, counted: true, t0: 4000, t1: 9000, faults: [] }, { set: 1, n: 2, counted: true, t0: 9500, t1: 15000, faults: ['propLow'] }] });
  assert.equal(s.session.id, 'sess-1'); assert.equal(s.session.reps.length, 2);
  /* saved again with how it felt: the same row */
  await R.call('saveSession', R.patient, { id: 'sess-1', at: R.clock.t, move: 'quadset', sets: [{ reps: 8, repTarget: 10, holdSec: 40, bestSec: 5, cues: { propLow: 2 } }], feel: { effort: 'hard', more: 'less', pain: 'stop', note: 'the knee' } });
  assert.equal((await R.call('sessions', R.patient)).sessions.length, 1);
  assert.ok(R.sent.some((m) => m.kind === 'flag' && /stopped Static quads for pain/.test(m.text)), 'the physio hears of the pain: ' + R.sent.map((m) => m.kind));
  const list = await R.call('patients', R.physio);
  assert.deepEqual(list.patients[0].flags.map((f) => f.kind), ['pain']);
  assert.equal(list.patients[0].week.daysDone, 1);
  const pg = await R.call('patient', R.physio, { id: R.patientId });
  assert.equal(pg.sessions[0].feel.pain, 'stop');
  await R.call('thumbs', R.patient, { sessionId: 'sess-1', up: false, line: 'it kept saying prop the knee' });
  assert.equal((await R.call('reports', R.admin)).reports[0].kind, 'thumbs');
  /* nothing for three days: a flag */
  R.clock.t += 4 * 24 * 3600 * 1000;
  assert.ok((await R.call('patients', R.physio)).patients[0].flags.some((f) => f.kind === 'missed'));
});

test('a review: sent with its clip and record, queued, opened, judged with a known fault, a new fault and a change to the step; the training record follows', async () => {
  const R = await clinic();
  await R.call('assignPlan', R.physio, { patientId: R.patientId, plan: Plans.list.find((p) => p.id === 'knee-early') });
  await R.call('consent', R.patient, { purpose: 'research', on: true });
  await R.call('saveSession', R.patient, { id: 'sess-2', at: R.clock.t, move: 'quadset', planId: 'asg-' + R.patientId, planV: 1, step: 0, sets: [{ reps: 3, repTarget: 10, holdSec: 10, bestSec: 5, cues: { propLow: 1 } }] });
  const clipB64 = Buffer.from('not really an mp4').toString('base64');
  const sent = await R.call('sendReview', R.patient, { sessionId: 'sess-2', setNo: 1, reps: [1, 2], line: 'it hurts at the top', verdicts: [{ rep: 1, counted: true, faults: ['propLow'] }, { rep: 2, counted: true, faults: [] }],
    clip: { b64: clipB64, type: 'video/mp4' }, record: { b64: Buffer.from('{"frames":[]}').toString('base64'), type: 'application/json' }, specHash: 'abc', appV: '2026-10-01g' });
  assert.equal(sent.reviews.length, 1);
  const rid = sent.reviews[0].id;
  assert.equal(sent.reviews[0].state, 'sent'); assert.ok(R.files[sent.reviews[0].clip], 'the clip is in the file store'); assert.equal(R.files[sent.reviews[0].clip].type, 'video/mp4');
  assert.ok(R.sent.some((m) => m.kind === 'review' && /sent you 2 reps of Static quads/.test(m.text)));
  /* the queue, and the overdue mark after two working days */
  let q = await R.call('queue', R.physio);
  assert.equal(q.queue.length, 1); assert.equal(q.queue[0].overdue, false); assert.equal(q.queue[0].line, 'it hurts at the top');
  R.clock.t += 3 * 24 * 3600 * 1000;
  q = await R.call('queue', R.physio); assert.equal(q.queue[0].overdue, true);
  assert.ok((await R.call('patients', R.physio)).patients[0].flags.some((f) => f.kind === 'review'));
  /* opening it marks it and leaves an audit row the patient can see */
  const opened = await R.call('review', R.physio, { id: rid });
  assert.equal(opened.review.state, 'opened'); assert.ok(opened.faults.some((f) => f.id === 'propLow')); assert.equal(opened.exercise.name, 'Static quads');
  assert.ok((await R.call('myAudit', R.patient)).audit.some((x) => x.what === 'clip opened' && x.whoName === 'Dr. Meera'));
  /* a stranger cannot */
  const other = await R.signIn('9000000031');
  await assert.rejects(R.call('review', other, { id: rid }), /not yours/);
  /* judged: rep 1 fine (the app's propLow was a false alarm), rep 2 a new fault; the step eased */
  const j = await R.call('judge', R.physio, { id: rid, labels: [{ rep: 1, verdict: 'fine' }, { rep: 2, verdict: 'new', newFault: { name: 'Hip hiking', desc: 'the pelvis lifts with the leg', part: 'hip' }, severity: 'clear' }],
    message: 'Good. Keep the hip down on the way up.', change: { rom: 80, note: 'Smaller range this week.', reason: 'The hip lifts at the top.' } });
  assert.equal(j.review.state, 'answered'); assert.equal(j.review.labels[1].label, 'Hip hiking');
  assert.equal(j.review.change.planV, 2); assert.match(j.review.change.what, /range 80%/);
  assert.equal((await R.call('myPlan', R.patient)).plan.plan.items[0].rom, 80, 'the patient\'s plan carries the change');
  assert.ok(R.sent.some((m) => m.kind === 'reply' && /Hip hiking/.test(m.text) && /Keep the hip down/.test(m.text)));
  const nf = await R.call('newFaults', R.patient, { exercise: 'quadset' });
  assert.equal(nf.faults.length, 1); assert.equal(nf.faults[0].uses, 1);
  /* the same new fault named again is the same row */
  await R.call('saveSession', R.patient, { id: 'sess-3', at: R.clock.t, move: 'quadset', sets: [{ reps: 1, repTarget: 10, holdSec: 1, bestSec: 1, cues: {} }] });
  const r2 = (await R.call('sendReview', R.patient, { sessionId: 'sess-3', reps: [1], verdicts: [{ rep: 1, counted: true, faults: ['propLow'] }] })).reviews[0];
  await R.call('judge', R.physio, { id: r2.id, labels: [{ rep: 1, verdict: 'new', newFault: { name: 'hip hiking' } }, { rep: 1, verdict: 'fault', faultId: 'propLow' }] });
  assert.equal((await R.call('newFaults', R.patient, { exercise: 'quadset' })).faults[0].uses, 2);
  /* the patient sees the replies, once unread */
  assert.equal((await R.call('me', R.patient)).unreadReviews, 2);
  const mine = await R.call('myReviews', R.patient);
  assert.equal(mine.reviews.length, 2); assert.match(mine.reviews[1].message, /Keep the hip down/);
  assert.equal((await R.call('me', R.patient)).unreadReviews, 0);
  /* the false-alarm report and the training record */
  const fa = await R.call('falseAlarms', R.admin);
  const q2 = fa.exercises.find((e) => e.exercise === 'quadset');
  assert.equal(q2.reps, 3);
  const pl = q2.faults.find((f) => f.id === 'propLow');
  assert.equal(pl.falseAlarm, 1, 'rep 1: called, physio said fine'); assert.equal(pl.confirmed, 1, 'sess-3: called and confirmed');
  const tr = await R.call('trainingExport', R.admin);
  assert.equal(tr.rows.length, 3); assert.equal(tr.rows[0].context.born, 1968); assert.ok(!('name' in (tr.rows[0].context || {})));
  assert.deepEqual(tr.rows[1].labels.map((l) => l.label), ['Hip hiking']);
  /* withdrawn only before it is opened */
  await assert.rejects(R.call('withdraw', R.patient, { id: rid }), /opened it already/);
  await R.call('saveSession', R.patient, { id: 'sess-4', at: R.clock.t, move: 'quadset', sets: [] });
  const r3 = (await R.call('sendReview', R.patient, { sessionId: 'sess-4', reps: [1], clip: { b64: clipB64, type: 'video/mp4' } })).reviews[0];
  await R.call('withdraw', R.patient, { id: r3.id });
  assert.equal(R.files[r3.clip], undefined, 'the clip goes with it');
});

test('the visit interval: reminders a week and two days before, once each; booked, snoozed, visited; the due list', async () => {
  const R = await clinic();
  const v = await R.call('setVisit', R.physio, { patientId: R.patientId, weeks: 2, last: '2026-10-05', clinicPhone: '080 1234' });
  assert.equal(v.visit.next, '2026-10-19'); assert.equal(v.visit.daysLeft, 14);
  const at = (date, hm) => Date.parse(`${date}T${hm}:00+05:30`);
  const kinds = (arr) => arr.map((m) => m.kind + ':' + (m.text.match(/next week|in two days|was due/) || [''])[0]);
  /* fourteen days out: nothing; seven: once, however often the clock ticks */
  assert.deepEqual(await R.srv.tick(at('2026-10-05', '10:00')), []);
  assert.deepEqual(kinds(await R.srv.tick(at('2026-10-12', '10:00'))), ['visit:next week']);
  assert.deepEqual(await R.srv.tick(at('2026-10-12', '10:15')), []);
  assert.deepEqual(await R.srv.tick(at('2026-10-12', '03:00')), [], 'not in the night');
  assert.deepEqual(kinds(await R.srv.tick(at('2026-10-17', '10:00'))), ['visit:in two days']);
  R.clock.t = at('2026-10-17', '10:30');
  assert.ok((await R.call('patients', R.physio)).due.length === 1, 'on the physio\'s due list');
  /* snoozed: quiet for three days; booked: quiet for good */
  R.clock.t = at('2026-10-17', '11:00');
  await R.call('visitAction', R.patient, { linkId: R.linkId, action: 'snooze' });
  assert.deepEqual(await R.srv.tick(at('2026-10-19', '10:00')), [], 'the day itself, snoozed');
  assert.deepEqual(kinds(await R.srv.tick(at('2026-10-20', '10:00'))), ['visit:was due'], 'three days on, overdue');
  R.clock.t = at('2026-10-21', '11:00');
  assert.ok((await R.call('patients', R.physio)).patients[0].flags.some((f) => f.kind === 'visit'));
  await R.call('visitAction', R.patient, { linkId: R.linkId, action: 'booked', date: '2026-10-23' });
  assert.ok(R.sent.some((m) => m.kind === 'visit' && /booked their visit for 2026-10-23/.test(m.text)));
  assert.deepEqual(await R.srv.tick(at('2026-10-22', '10:00')), []);
  const mv = await R.call('markVisited', R.physio, { patientId: R.patientId, date: '2026-10-23', measurement: { what: 'knee flexion', value: 95, unit: '°' } });
  assert.equal(mv.visit.next, '2026-11-06'); assert.equal(mv.visit.state, 'due');
  assert.equal(Object.keys(R.D.measurements).length, 1);
});

test('exercise reminders at the person\'s time on their days, once, not after a session, with the physio\'s line', async () => {
  const R = await clinic();
  await R.call('assignPlan', R.physio, { patientId: R.patientId, plan: Plans.list.find((p) => p.id === 'knee-early') });
  await R.call('setReminders', R.patient, { on: true, days: [1, 3, 5], time: '19:00', channel: 'whatsapp' });
  await R.call('setPatientReminders', R.physio, { patientId: R.patientId, line: 'Ice after, Sunita.' });
  const at = (date, hm) => Date.parse(`${date}T${hm}:00+05:30`);
  assert.deepEqual(await R.srv.tick(at('2026-10-05', '18:45')), [], 'not yet');
  const m = await R.srv.tick(at('2026-10-05', '19:00'));
  assert.equal(m.length, 1); assert.equal(m[0].channel, 'whatsapp'); assert.match(m[0].text, /Time for your exercises: Knee — early rehab\. Ice after, Sunita\./);
  assert.deepEqual(await R.srv.tick(at('2026-10-05', '19:15')), [], 'once');
  assert.deepEqual(await R.srv.tick(at('2026-10-06', '19:15')), [], 'Tuesday is not a day');
  /* a session done that day: no reminder */
  await R.call('saveSession', R.patient, { id: 's', at: at('2026-10-07', '08:00'), move: 'quadset', sets: [] });
  assert.deepEqual(await R.srv.tick(at('2026-10-07', '19:15')), []);
  /* Friday: a reminder, plain words (only Thursday was missed); Monday after three empty days: the softer words */
  const m2 = await R.srv.tick(at('2026-10-09', '19:30'));
  assert.equal(m2.length, 1); assert.match(m2[0].text, /^Time for your exercises/);
  const m3 = await R.srv.tick(at('2026-10-12', '19:30'));
  assert.match(m3[0].text, /^Two minutes counts\. /);
  /* off at the physio's say-so */
  await R.call('setPatientReminders', R.physio, { patientId: R.patientId, off: true });
  assert.deepEqual(await R.srv.tick(at('2026-10-14', '19:30')), []);
});

test('a report lands with the admin and its reply with the person; export has everything; deletion leaves only the research labels, nameless', async () => {
  const R = await clinic();
  await R.call('consent', R.patient, { purpose: 'research', on: true });
  const rp = await R.call('report', R.patient, { kind: 'problem', screen: 'live', text: 'it could not see me', device: 'Android 11', appV: 'x', log: ['a', 'b'] });
  assert.ok(R.sent.some((m) => m.kind === 'report' && m.to === 'admin'));
  await R.call('replyReport', R.admin, { id: rp.report.id, text: 'Try more light behind the phone.' });
  const me = await R.call('me', R.patient);
  assert.equal(me.replies.length, 1); assert.match(me.replies[0].reply, /more light/);
  await R.call('seenReply', R.patient, { id: rp.report.id });
  assert.equal((await R.call('me', R.patient)).replies.length, 0);
  await R.call('saveSession', R.patient, { id: 's1', at: R.clock.t, move: 'quadset', sets: [] });
  const rv = (await R.call('sendReview', R.patient, { sessionId: 's1', reps: [1], verdicts: [{ rep: 1, faults: [] }], clip: { b64: Buffer.from('x').toString('base64'), type: 'video/mp4' } })).reviews[0];
  await R.call('judge', R.physio, { id: rv.id, labels: [{ rep: 1, verdict: 'fine' }] });
  const ex = await R.call('exportData', R.patient);
  assert.equal(ex.sessions.length, 1); assert.equal(ex.reviews.length, 1); assert.equal(ex.files.length, 1); assert.equal(ex.user.consents.research, true); assert.ok(ex.audit.some((x) => x.what === 'export'));
  await R.call('deleteAccount', R.patient);
  await assert.rejects(R.call('me', R.patient), /not signed in|no such/);
  assert.equal(Object.keys(R.files).length, 0, 'the clip is gone');
  const left = Object.values(R.D.reviews);
  assert.equal(left.length, 1); assert.equal(left[0].patient, null); assert.equal(left[0].anonymised, true);
  assert.equal((await R.call('patients', R.physio)).patients.length, 0, 'the link is ended');
  assert.equal((await R.call('trainingExport', R.admin)).rows.length, 1);
  /* without the research consent, deletion takes the labels too */
  const R2 = await clinic();
  await R2.call('saveSession', R2.patient, { id: 's1', at: R2.clock.t, move: 'quadset', sets: [] });
  const rv2 = (await R2.call('sendReview', R2.patient, { sessionId: 's1', reps: [1] })).reviews[0];
  await R2.call('judge', R2.physio, { id: rv2.id, labels: [] });
  await R2.call('deleteAccount', R2.patient);
  assert.equal(Object.keys(R2.D.reviews).length, 0);
});

test('the night\'s housekeeping: clips go at 180 days, the record stays under consent, reports go at 90', async () => {
  const R = await clinic();
  await R.call('consent', R.patient, { purpose: 'research', on: true });
  await R.call('saveSession', R.patient, { id: 's1', at: R.clock.t, move: 'quadset', sets: [] });
  const rv = (await R.call('sendReview', R.patient, { sessionId: 's1', reps: [1], clip: { b64: 'eA==', type: 'video/mp4' }, record: { b64: 'eA==', type: 'application/json' } })).reviews[0];
  await R.call('report', R.patient, { text: 'x' });
  const later = R.clock.t + 181 * 24 * 3600 * 1000;
  const n = await R.srv.nightly(later);
  assert.equal(n.clips, 1); assert.equal(n.reports, 1);
  assert.equal(R.files[rv.clip], undefined); assert.ok(R.files[rv.record], 'the pose record is kept under the research consent');
});

test('every call is behind the door, with its role', async () => {
  const R = await clinic();
  assert.equal(R.srv.auth('requestCode'), 'none'); assert.equal(R.srv.auth('judge'), 'physio'); assert.equal(R.srv.auth('reports'), 'admin'); assert.equal(R.srv.auth('nosuch'), null);
  await assert.rejects(R.call('nosuch', R.patient), /no such call/);
  await assert.rejects(R.call('queue', R.patient), /for a physio/);
  await assert.rejects(R.call('reports', R.physio), /admin only/);
  await assert.rejects(R.call('me', 'not-a-token'), /not signed in/);
  assert.ok(R.store.saves > 5, 'the store is saved after every call');
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
});
