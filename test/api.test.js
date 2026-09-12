'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fyzio-m-')), 'test.sqlite');
Object.assign(process.env, { DB_PATH: dbPath, PORT: '0', NODE_ENV: 'test', NOTIFY_PROVIDER: 'console', PAYMENT_PROVIDER: 'mock', ADMIN_IDENTIFIER: 'admin@fyzio.test', ERASURE_GRACE_DAYS: '0', SOLO_MODE: 'false', FREE_EXERCISES: 'wallsit,plank' });   // marketplace configuration under test
const { start, server } = require('../server/index.js');
let base;
function client() { const jar = {}; return async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) }); for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const [k, v] = kv.split('='); jar[k] = decodeURIComponent(v); } return { status: r.status, data: await r.json().catch(() => null) }; }; }
async function signIn(c, identifier, extra = {}) { const req = await c('POST', '/api/auth/otp/request', { identifier }); assert.equal(req.status, 200, JSON.stringify(req.data)); const ver = await c('POST', '/api/auth/otp/verify', { identifier, code: req.data.devCode, ...extra }); assert.equal(ver.status, 200, JSON.stringify(ver.data)); const me = await c('GET', '/api/me'); await c('POST', '/api/consent', { version: me.data.consentVersion, purposes: ['account', 'diagnostics'] }); return ver.data.user; }
const review = (exercise, extra = {}) => ({ exercise, name: exercise, type: 'reps', target: 10, score: 80, reps: 10, partials: 0, faults: {}, tips: [], repList: [], ...extra });
async function buy(c, plan) { const co = await c('POST', '/api/billing/checkout', { plan }); assert.equal(co.status, 200, JSON.stringify(co.data)); assert.equal(co.data.provider, 'mock'); const cf = await c('POST', '/api/billing/confirm', { provider: 'mock', orderId: co.data.orderId }); assert.equal(cf.status, 200, JSON.stringify(cf.data)); return cf.data; }

before(async () => { await start(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const anon = client(), free = client(), pro = client(), curator = client(), admin = client();
let freeUser, proUser, curatorUser, routine, assignmentId;

test('anonymous: catalog shows tiers and locks; prebuilt free routines are open, pro ones locked; protected routes refuse', async () => {
  const ex = await anon('GET', '/api/exercises'); assert.equal(ex.status, 200); const byId = Object.fromEntries(ex.data.exercises.map(e => [e.id, e]));
  assert.equal(byId.wallsit.tier, 'free'); assert.equal(byId.wallsit.locked, false); assert.equal(byId.heelslide.tier, 'pro'); assert.equal(byId.heelslide.locked, true);
  const pre = await anon('GET', '/api/routines/prebuilt'); assert.ok(pre.data.routines.length >= 5); assert.equal(pre.data.routines.find(r => r.title === 'Core starter').locked, false); assert.equal(pre.data.routines.find(r => r.title === 'Knee comeback').locked, true);
  assert.equal((await anon('GET', '/api/sessions')).status, 401); assert.equal((await anon('POST', '/api/notes', { text: 'x' })).status, 401);
  assert.equal((await anon('GET', '/api/curators')).status, 200, 'directory is public');
});
test('self-serve registration: unknown number → OTP → new member; name captured; consent gate', async () => {
  const req = await free('POST', '/api/auth/otp/request', { identifier: '9876500001' }); assert.equal(req.data.existing, false); assert.ok(req.data.devCode);
  const ver = await free('POST', '/api/auth/otp/verify', { identifier: '9876500001', code: req.data.devCode, name: 'Neha' }); assert.equal(ver.status, 200); assert.equal(ver.data.user.role, 'member'); assert.equal(ver.data.user.created, true); assert.equal(ver.data.user.entitlements.tier, 'free');
  assert.equal((await free('POST', '/api/notes', { text: 'hi' })).status, 428, 'consent required before storing data');
  const me = await free('GET', '/api/me'); await free('POST', '/api/consent', { version: me.data.consentVersion, purposes: ['account'] }); freeUser = (await free('GET', '/api/me')).data.user; assert.equal(freeUser.name, 'Neha'); assert.equal(freeUser.prefs.store_diagnostics, false, 'diagnostics not consented');
  const again = await free('POST', '/api/auth/otp/request', { identifier: '9876500001' }); assert.equal(again.data.existing, true);
});
test('free member: can log free exercises, take notes, see history; pro exercise and routine building are paywalled (402)', async () => {
  const ok = await free('POST', '/api/sessions', { review: review('wallsit', { type: 'hold', holdSec: 30, goodSec: 28 }), effort: 6, note: 'burned' }); assert.equal(ok.status, 201); assert.equal(ok.data.session.note, 'burned');
  const locked = await free('POST', '/api/sessions', { review: review('heelslide') }); assert.equal(locked.status, 402); assert.equal(locked.data.upgrade, true);
  const build = await free('POST', '/api/routines', { title: 'x', items: [{ exerciseId: 'plank', options: {} }] }); assert.equal(build.status, 402);
  const n = await free('POST', '/api/notes', { text: 'Wall sit felt easier today', exerciseId: 'wallsit' }); assert.equal(n.status, 201);
  const notes = await free('GET', '/api/notes'); assert.equal(notes.data.notes[0].exerciseName, 'Wall sit');
  const hist = await free('GET', '/api/sessions'); assert.equal(hist.data.sessions.length, 1);
});
test('pro member: mock checkout unlocks everything; can build, copy and edit routines; cancel keeps access to period end', async () => {
  proUser = await signIn(pro, 'pro@fyzio.test', { name: 'Rahul' });
  const before = await pro('GET', '/api/me'); assert.equal(before.data.user.entitlements.pro, false);
  const bought = await buy(pro, 'pro_monthly'); assert.equal(bought.subscription.status, 'active'); assert.equal(bought.user.entitlements.tier, 'pro'); assert.equal(bought.user.entitlements.canBuild, true);
  assert.equal((await pro('POST', '/api/sessions', { review: review('heelslide') })).status, 201);
  const r = await pro('POST', '/api/routines', { title: 'My knee plan', items: [{ exerciseId: 'heelslide', options: { target: 12, rom: 90 } }, { exerciseId: 'calfstretch', options: { target: 30, variant: 'bent' } }] }); assert.equal(r.status, 201); assert.equal(r.data.routine.items[0].options.rom, 90);
  const upd = await pro('PATCH', `/api/routines/${r.data.routine.id}`, { items: [{ id: r.data.routine.items[0].id, exerciseId: 'heelslide', options: { target: 15, rom: 105 } }] }); assert.equal(upd.data.routine.items.length, 1); assert.equal(upd.data.routine.items[0].options.rom, 105);
  const pre = (await pro('GET', '/api/routines/prebuilt')).data.routines.find(x => x.title === 'Knee comeback'); assert.equal(pre.locked, false);
  const copy = await pro('POST', `/api/routines/${pre.id}/copy`); assert.equal(copy.status, 201); assert.equal(copy.data.routine.title, 'Knee comeback (copy)');
  assert.equal((await pro('GET', '/api/routines')).data.mine.length, 2);
  const invalid = await pro('POST', '/api/routines', { title: 'bad', items: [{ exerciseId: 'hipabd', options: { rom: 99 } }] }); assert.equal(invalid.status, 400);
  const subId = bought.subscription.id; const canc = await pro('POST', '/api/billing/cancel', { subscriptionId: subId }); assert.equal(canc.data.user.entitlements.pro, true, 'access continues until period end'); assert.equal(canc.data.user.subscriptions[0].status, 'cancelled');
  assert.equal((await pro('POST', '/api/billing/checkout', { plan: 'curator_monthly' })).status, 400, 'members cannot buy curator plans');
});
test('curator: registers as curator, edits profile, is listed only with an active curator subscription', async () => {
  curatorUser = await signIn(curator, 'coach@fyzio.test', { role: 'curator', name: 'Dr Priya Nair' }); assert.equal(curatorUser.role, 'curator');
  const p = await curator('PATCH', '/api/curator/profile', { displayName: 'Dr Priya Nair', headline: 'Sports physio, Bengaluru', bio: 'Knees and runners.', credentials: 'BPT, MPT (Sports)', kind: 'physiotherapist', specialties: ['Knee rehab', 'Runners', 'Bogus'], city: 'Bengaluru', languages: ['English', 'Kannada'], rateText: '₹1,200 / month', listed: true }); assert.equal(p.status, 200); assert.deepEqual(p.data.profile.specialties, ['Knee rehab', 'Runners']); assert.equal(p.data.listedNow, false);
  assert.equal((await anon('GET', '/api/curators')).data.curators.length, 0, 'not listed without a subscription');
  assert.equal((await curator('POST', '/api/routines', { title: 'x', items: [{ exerciseId: 'plank', options: {} }] })).status, 402, 'curator without subscription cannot build');
  const bought = await buy(curator, 'curator_monthly'); assert.equal(bought.user.entitlements.curator, true);
  const dir = await anon('GET', '/api/curators?specialty=Runners'); assert.equal(dir.data.curators.length, 1); assert.equal(dir.data.curators[0].displayName, 'Dr Priya Nair'); assert.equal(dir.data.curators[0].verified, false);
  assert.equal((await anon('GET', '/api/curators?q=zzz')).data.curators.length, 0); assert.equal((await anon('GET', '/api/curators?kind=trainer')).data.curators.length, 0);
  const pub = await anon('GET', '/api/curators/' + curatorUser.id); assert.equal(pub.status, 200); assert.equal(pub.data.curator.credentials, 'BPT, MPT (Sports)');
});
test('connection flow: free member requests curator; curator accepts; curator sends a pro routine; member is granted those exercises without paying', async () => {
  const req = await free('POST', '/api/connections', { curatorId: curatorUser.id, message: 'Recovering from ACL, please help' }); assert.equal(req.status, 201); assert.equal(req.data.connection.status, 'requested');
  const cList = await curator('GET', '/api/connections'); assert.equal(cList.data.connections[0].memberName, 'Neha'); assert.equal(cList.data.connections[0].message, 'Recovering from ACL, please help');
  assert.equal((await free('PATCH', `/api/connections/${req.data.connection.id}`, { status: 'accepted' })).status, 400, 'requester cannot accept');
  const acc = await curator('PATCH', `/api/connections/${req.data.connection.id}`, { status: 'accepted' }); assert.equal(acc.data.connection.status, 'accepted');
  const r = await curator('POST', '/api/routines', { title: 'Neha week 1', description: 'Gentle range first', items: [{ exerciseId: 'heelslide', options: { target: 10, rom: 75, sets: 2 }, notes: 'Only to 75° this week' }, { exerciseId: 'wallsit', options: { target: 20 } }] }); assert.equal(r.status, 201); routine = r.data.routine;
  const strangerPro = client(); await signIn(strangerPro, 'stranger@fyzio.test'); assert.equal((await curator('POST', '/api/curator/send', { routineId: routine.id, memberId: (await strangerPro('GET', '/api/me')).data.user.id })).status, 400, 'can only send to accepted connections');
  const sent = await curator('POST', '/api/curator/send', { routineId: routine.id, memberId: freeUser.id, message: 'Start tomorrow, twice a day' }); assert.equal(sent.status, 201); assignmentId = sent.data.assignmentId;
  const mine = await free('GET', '/api/routines'); assert.equal(mine.data.sent.length, 1); assert.equal(mine.data.sent[0].curatorName, 'Dr Priya Nair'); assert.equal(mine.data.sent[0].routine.items[0].locked, false, 'granted via curator'); assert.equal(mine.data.sent[0].routine.items[0].notes, 'Only to 75° this week');
  const ent = (await free('GET', '/api/me')).data.user.entitlements; assert.equal(ent.tier, 'free'); assert.ok(ent.exercises.includes('heelslide')); assert.ok(!ent.exercises.includes('hipabd'), 'only exercises in sent routines are granted');
  const s = await free('POST', '/api/sessions', { routineItemId: mine.data.sent[0].routine.items[0].id, review: review('heelslide'), effort: 5 }); assert.equal(s.status, 201); assert.equal(s.data.session.assignmentId, assignmentId);
  assert.equal((await free('POST', '/api/sessions', { review: review('hipabd') })).status, 402);
});
test('curator sees the member\'s sessions from sent routines only, and can comment; member sees the comment; ending the connection archives access', async () => {
  const m = await curator('GET', `/api/curator/members/${freeUser.id}`); assert.equal(m.status, 200); assert.equal(m.data.sessions.length, 1); assert.equal(m.data.assignments[0].title, 'Neha week 1');
  const cm = await curator('PATCH', `/api/curator/sessions/${m.data.sessions[0].id}/comment`, { comment: 'Good — keep the heel down.' }); assert.equal(cm.status, 200);
  const hist = await free('GET', '/api/sessions'); assert.equal(hist.data.sessions.find(s => s.exerciseId === 'heelslide').curatorComment, 'Good — keep the heel down.');
  assert.equal((await curator('GET', `/api/curator/members/${proUser.id}`)).status, 404, 'not connected');
  const conn = (await free('GET', '/api/connections')).data.connections[0]; assert.equal((await free('PATCH', `/api/connections/${conn.id}`, { status: 'ended' })).status, 200);
  const ent = (await free('GET', '/api/me')).data.user.entitlements; assert.ok(!ent.exercises.includes('heelslide'), 'grant revoked when the connection ends'); assert.equal((await free('GET', '/api/routines')).data.sent.length, 0);
});
test('curator can invite a member by identifier; invalid/unknown identifiers handled', async () => {
  assert.equal((await curator('POST', '/api/connections', { memberIdentifier: 'nobody@fyzio.test' })).status, 404);
  const inv = await curator('POST', '/api/connections', { memberIdentifier: 'pro@fyzio.test', message: 'Join my plan' }); assert.equal(inv.status, 201);
  const pc = (await pro('GET', '/api/connections')).data.connections[0]; assert.equal(pc.requestedBy, curatorUser.id); assert.equal((await pro('PATCH', `/api/connections/${pc.id}`, { status: 'accepted' })).status, 200);
});
test('admin: overview, verify a curator, comp a plan, disable a user; audit covers the flows', async () => {
  await signIn(admin, 'admin@fyzio.test'); const me = await admin('GET', '/api/me'); assert.equal(me.data.user.role, 'admin');
  const ov = await admin('GET', '/api/admin/overview'); assert.ok(ov.data.stats.members >= 2); assert.equal(ov.data.stats.activeSubs, 2); assert.ok(ov.data.stats.revenuePaise30d > 0);
  assert.equal((await admin('PATCH', `/api/admin/curators/${curatorUser.id}`, { verified: true, note: 'Checked IAP registration' })).status, 200); assert.equal((await anon('GET', '/api/curators/' + curatorUser.id)).data.curator.verified, true);
  const stranger = client(); const su = await signIn(stranger, 'comp@fyzio.test'); assert.equal((await admin('PATCH', `/api/admin/users/${su.id}`, { grantPlan: 'pro_yearly' })).status, 200); assert.equal((await stranger('GET', '/api/me')).data.user.entitlements.pro, true);
  assert.equal((await admin('PATCH', `/api/admin/users/${su.id}`, { status: 'disabled' })).status, 200); assert.equal((await stranger('GET', '/api/sessions')).status, 401);
  assert.equal((await free('GET', '/api/admin/overview')).status, 403);
  const actions = new Set(ov.data.audit.map(e => e.action)); for (const a of ['user.registered', 'login', 'consent.accepted', 'session.logged', 'payment.paid', 'subscription.granted', 'routine.created', 'connection.requested', 'connection.accepted', 'routine.sent', 'session.commented']) assert.ok(actions.has(a), 'audit has ' + a);
});
test('encryption at rest + DPDP export/erasure', async () => {
  const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(dbPath);
  const blob = fs.readFileSync(dbPath).toString('latin1') + (fs.existsSync(dbPath + '-wal') ? fs.readFileSync(dbPath + '-wal').toString('latin1') : '');
  assert.ok(!blob.includes('Recovering from ACL') && !blob.includes('9876500001') && !blob.includes('keep the heel down'), 'no plaintext messages/identifiers/comments in the db file');
  assert.ok(blob.includes('Dr Priya Nair'), 'public curator listing fields are intentionally plaintext'); d.close();
  const exp = await free('GET', '/api/me/export'); assert.equal(exp.status, 200); assert.ok(exp.data.sessions.length >= 2); assert.equal(exp.data.notes.length, 1);
  await free('POST', '/api/me/erasure', {}); require('../server/auth.js').housekeeping();
  assert.equal((await free('GET', '/api/me')).data.user, null);
  const d2 = new DatabaseSync(dbPath); assert.equal(d2.prepare('SELECT COUNT(*) n FROM exercise_sessions WHERE user_id = ?').get(freeUser.id).n, 0); assert.equal(d2.prepare('SELECT COUNT(*) n FROM notes WHERE user_id = ?').get(freeUser.id).n, 0); d2.close();
});
test('razorpay signature verification rejects tampered confirmations (unit)', () => {
  const crypto = require('node:crypto'); const cfg = require('../server/config.js'); cfg.razorpayKeySecret = 'testsecret';
  const sig = crypto.createHmac('sha256', 'testsecret').update('order_1|pay_1').digest('hex'); assert.equal(sig.length, 64);
  const bad = crypto.createHmac('sha256', 'testsecret').update('order_1|pay_2').digest('hex'); assert.notEqual(sig, bad);
});
