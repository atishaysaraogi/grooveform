'use strict';
// REST API for the consumer + curator marketplace. Every route: authenticate → entitle/authorise → validate → act → audit.
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const c = require('./crypto');
const auth = require('./auth');
const audit = require('./audit');
const pay = require('./payments');
const { Router, HttpError, readJson, send, clientIp, v } = require('./http');

// engine.js loads every move — the ten code moves plus client/data/moves/*.json — and exposes them as EXERCISES.
const engine = require(path.join(__dirname, '..', 'client', 'coach', 'engine.js'));
const catalog = require(path.join(__dirname, '..', 'client', 'coach', 'catalog.js'));
const exerciseView = (e) => ({ id: e.id, name: e.name, clinicalName: e.clinicalName || null, group: e.group, type: e.type, view: e.view, icon: e.icon, sided: e.sided || null, summary: e.summary, setup: e.setup, why: e.why, calibrationPose: e.calibrationPose || null, defaultTarget: e.defaultTarget, targets: e.targets, options: e.options || [], faults: e.faults.map(f => ({ id: f.id, label: f.label, cue: f.cue, tip: f.tip, tracked: f.tracked !== false && typeof f.check === 'function' })), guide: e.guide, tracking: e.tracking, vetted: !!e.vetted, listed: e.listed !== false, repHold: e.repHold || 0, equipment: e.equipment || [], muscles: e.muscles || null, level: e.level || null, camera: e.camera || null, sources: e.sources || [], tempo: e.tempo || null, dosage: e.dosage || null, progression: e.progression || null, regression: e.regression || null, contraindications: e.contraindications || null, region: e.region || null, tier: config.freeExercises.includes('all') || config.freeExercises.includes(e.id) ? 'free' : 'pro' });
let EXERCISES = [];
const EX_BY_ID = {};
function refreshExercises() { EXERCISES = engine.EXERCISES.map(exerciseView); for (const k of Object.keys(EX_BY_ID)) delete EX_BY_ID[k]; for (const e of EXERCISES) EX_BY_ID[e.id] = e; return EXERCISES.length; }
refreshExercises();
const SPECIALTIES = ['Knee rehab', 'Hip & glutes', 'Shoulder & neck', 'Back pain', 'Post-surgery', 'Runners', 'Seniors & balance', 'Strength', 'Mobility', 'Desk & posture', 'Sports'];
const router = new Router();
const now = () => Date.now();
const J = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/* ---------------- entitlements ---------------- */
// What a user may do. Anonymous: free exercises only. Member: history/notes on what they can access. Pro: everything + custom routines.
// A member who has been SENT a routine by a curator can do every exercise in that routine while the assignment is active.
function entitlements(u) {
  if (!u) return { tier: 'anon', pro: false, curator: false, exercises: EXERCISES.filter(e => e.tier === 'free').map(e => e.id), canBuild: false, grantedBy: [] };
  const pro = !!pay.activeSubscription(u.id, 'pro'); const curator = u.role === 'curator' && !!pay.activeSubscription(u.id, 'curator'); const admin = u.role === 'admin';
  const granted = new Set(); const grantedBy = [];
  if (!pro && !admin) for (const a of db.q("SELECT a.id, a.routine_id, r.title FROM routine_assignments a JOIN routines r ON r.id = a.routine_id WHERE a.member_id = ? AND a.status = 'active'").all(u.id)) {
    const items = db.q('SELECT exercise_id FROM routine_items WHERE routine_id = ?').all(a.routine_id); items.forEach(i => granted.add(i.exercise_id)); grantedBy.push({ assignmentId: a.id, title: a.title, exercises: items.map(i => i.exercise_id) });
  }
  const exercises = EXERCISES.filter(e => e.tier === 'free' || pro || admin || curator || granted.has(e.id)).map(e => e.id);
  return { tier: admin ? 'admin' : curator ? 'curator' : pro ? 'pro' : 'free', pro: pro || admin || curator, curator, admin, exercises, canBuild: pro || admin || curator, grantedBy };
}
function canDo(u, exerciseId) { return entitlements(u).exercises.includes(exerciseId); }

/* ---------------- views ---------------- */
function itemView(it) { const ex = EX_BY_ID[it.exercise_id]; return { id: it.id, routineId: it.routine_id, exerciseId: it.exercise_id, exercise: ex ? { name: ex.name, type: ex.type, icon: ex.icon, view: ex.view, tier: ex.tier } : null, position: it.position, options: J(it.options_json, {}), notes: it.notes }; }
function routineView(r, { items = true, viewer = null } = {}) {
  const out = { id: r.id, ownerId: r.owner_id, title: r.title, description: r.description, tier: r.tier, kind: r.kind, tags: J(r.tags_json, []), archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at };
  if (r.owner_id) { const o = db.q('SELECT cp.display_name FROM curator_profiles cp WHERE cp.user_id = ?').get(r.owner_id); out.ownerName = o ? o.display_name : null; }
  if (items) { const its = db.q('SELECT * FROM routine_items WHERE routine_id = ? ORDER BY position').all(r.id).map(itemView); const ent = entitlements(viewer); out.items = its.map(i => ({ ...i, locked: !ent.exercises.includes(i.exerciseId) })); out.locked = out.items.some(i => i.locked); }
  return out;
}
function curatorPublic(cp, u) { return { id: cp.user_id, displayName: cp.display_name, headline: cp.headline, bio: cp.bio, credentials: cp.credentials, kind: cp.kind, specialties: J(cp.specialties_json, []), city: cp.city, languages: J(cp.languages_json, []), rateText: cp.rate_text, website: cp.website, publicContact: cp.public_contact, verified: !!cp.verified, listed: !!cp.listed, memberSince: u ? u.created_at : cp.created_at, routinesShared: db.q('SELECT COUNT(DISTINCT member_id) n FROM routine_assignments WHERE curator_id = ?').get(cp.user_id).n }; }
function sessionView(s, { withDiagnostics = false } = {}) {
  const out = { id: s.id, userId: s.user_id, exerciseId: s.exercise_id, exerciseName: (EX_BY_ID[s.exercise_id] || {}).name || s.exercise_id, routineId: s.routine_id, routineItemId: s.routine_item_id, assignmentId: s.assignment_id, startedAt: s.started_at, finishedAt: s.finished_at, source: s.source,
    review: J(s.review_json, {}), effort: s.effort, note: c.decrypt(s.note_enc), curatorComment: c.decrypt(s.curator_comment_enc), curatorCommentedAt: s.curator_commented_at, hasDiagnostics: !!s.diagnostics_enc };
  if (withDiagnostics && s.diagnostics_enc) out.diagnostics = J(c.decrypt(s.diagnostics_enc));
  return out;
}
function userRow(id) { return db.q('SELECT * FROM users WHERE id = ?').get(id); }
function validateOptions(exId, options) {
  const ex = EX_BY_ID[exId]; if (!ex) throw new HttpError(400, 'Unknown exercise ' + exId);
  const o = { target: v.int(options.target ?? ex.defaultTarget, { min: 1, max: 600, name: 'target' }) };
  for (const opt of ex.options) { if (options[opt.key] !== undefined && options[opt.key] !== null) { const v = options[opt.key]; const typed = opt.custom && Number.isFinite(+v) && +v > 0 && +v <= 500; if (!opt.values.includes(v) && !typed) throw new HttpError(400, `${opt.label} must be one of ${opt.values.join(', ')}`); o[opt.key] = typed && !opt.values.includes(v) ? +v : v; } else o[opt.key] = opt.default; }
  o.sets = v.int(options.sets ?? 1, { min: 1, max: 10, name: 'sets' }); o.rest = v.int(options.rest ?? 60, { min: 10, max: 600, name: 'rest' });
  if (options.side) o.side = v.oneOf(options.side, ['left', 'right', 'both'], 'side');
  return o;
}
function meView(u) { return { ...auth.publicUser(u), entitlements: entitlements(u), subscriptions: pay.subscriptionsOf(u.id), curatorProfile: u.role === 'curator' ? curatorPublic(db.q('SELECT * FROM curator_profiles WHERE user_id = ?').get(u.id), u) : null }; }

/* ---------------- public ---------------- */
router.get('/api/me', (req, res) => { const u = auth.currentUser(req); send(res, 200, { user: u ? meView(u) : null, entitlements: entitlements(u), consentVersion: config.consentVersion, notice: privacyNotice(), env: { otp: config.notifyProvider, payments: config.paymentProvider, isProd: config.isProd, appName: config.appName, solo: config.soloMode } }); });
router.get('/api/exercises', (req, res) => { const u = auth.currentUser(req); const ent = entitlements(u); send(res, 200, { exercises: EXERCISES.map(e => ({ ...e, locked: !ent.exercises.includes(e.id) })), specialties: SPECIALTIES }); });
/* ---------------- development only: the Studio writes catalogue files straight into the project ----------------
   Off unless NODE_ENV=development and the request comes from this machine. The file is checked the way the app
   would load it; nothing is written unless it checks clean, and the running server re-reads the library. */
const devOnly = (req) => { if (config.nodeEnv !== 'development' || config.isProd) throw new HttpError(404, 'Not found'); const ip = clientIp(req); if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) throw new HttpError(403, 'Local only'); };
router.get('/api/dev/catalog', (req, res) => { devOnly(req); const d = catalog.readDataSync(engine.DATA_DIR); send(res, 200, { regions: d.manifest.regions, dir: engine.DATA_DIR }); });
/* One exercise, one file: the body is the move itself and `region` says which region lists it. The
   move is checked the way the app loads it — inside its region, against every other id — and only
   then written; a move that is new to the region is appended to that region's list. */
router.put('/api/dev/catalog/:id', async (req, res) => {
  devOnly(req);
  const id = req.params.id; if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new HttpError(400, 'Move id: lower-case letters, digits, underscores');
  const body = await readJson(req, 8_000_000);
  const entry = body && body.move, regionName = body && body.region;
  if (!entry || typeof entry !== 'object') throw new HttpError(400, 'Send { region, move }');
  if (entry.id !== id) throw new HttpError(400, `The move says id "${entry.id}" but the address says "${id}"`);
  const d = catalog.readDataSync(engine.DATA_DIR);
  /* a named region has to exist — a typo must not quietly write the move into the one that holds it */
  const regionOf = (name) => name.replace(/^regions\//, '').replace(/\.json$/, '');
  const file = regionName ? d.files.find(f => regionOf(f.name) === regionName) : d.files.find(f => f.json.moves.some(m => m.id === id));
  if (!file) throw new HttpError(400, regionName ? `No such region "${regionName}" — the regions are: ${d.files.map(f => regionOf(f.name)).join(', ')}` : 'Send the region for a move the library does not have yet');
  const moves = file.json.moves.slice();
  const i = moves.findIndex(m => m.id === id);
  if (i >= 0) moves[i] = entry; else moves.push(entry);
  const others = d.files.filter(f => f !== file).flatMap(f => f.json.moves.map(m => m.id));
  const problems = catalog.checkFile({ ...file.json, moves }, file.name, d, others);
  if (problems.length) throw new HttpError(400, 'Not saved — fix these first', { problems });
  const fs = require('node:fs'); const rel = 'moves/' + id + '.json';
  fs.writeFileSync(path.join(engine.DATA_DIR, rel), catalog.format(entry) + '\n');
  if (i < 0) {
    const region = JSON.parse(fs.readFileSync(path.join(engine.DATA_DIR, file.name), 'utf8'));
    region.moves.push(id);
    fs.writeFileSync(path.join(engine.DATA_DIR, file.name), catalog.format(region) + '\n');
  }
  engine.reloadCatalog(); const n = refreshExercises();
  audit.log({ action: 'catalog.saved', targetType: 'move', targetId: id, ip: clientIp(req), meta: { region: regionOf(file.name), added: i < 0 } });
  send(res, 200, { saved: rel, region: regionOf(file.name), added: i < 0, library: n });
});
router.get('/api/plans', (req, res) => send(res, 200, { plans: pay.planList(), provider: config.paymentProvider }));
router.get('/api/routines/prebuilt', (req, res) => { const u = auth.currentUser(req); send(res, 200, { routines: db.q("SELECT * FROM routines WHERE kind = 'prebuilt' AND archived = 0 ORDER BY rowid").all().map(r => routineView(r, { viewer: u })) }); });
router.get('/api/curators', (req, res) => {
  const url = new URL(req.url, 'http://x'); const q = (url.searchParams.get('q') || '').toLowerCase(); const spec = url.searchParams.get('specialty'); const kind = url.searchParams.get('kind'); const city = (url.searchParams.get('city') || '').toLowerCase();
  let rows = db.q("SELECT cp.*, u.created_at AS u_created FROM curator_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.listed = 1 AND u.status = 'active'").all();
  rows = rows.filter(r => listedNow(r.user_id)).map(r => curatorPublic(r, { created_at: r.u_created }));
  if (q) rows = rows.filter(r => [r.displayName, r.headline, r.bio, r.credentials, r.city, ...(r.specialties || [])].join(' ').toLowerCase().includes(q));
  if (spec) rows = rows.filter(r => r.specialties.includes(spec)); if (kind) rows = rows.filter(r => r.kind === kind); if (city) rows = rows.filter(r => (r.city || '').toLowerCase().includes(city));
  rows.sort((a, b) => (b.verified - a.verified) || (b.routinesShared - a.routinesShared) || a.displayName.localeCompare(b.displayName));
  send(res, 200, { curators: rows, specialties: SPECIALTIES });
});
function listedNow(curatorId) { return !!pay.activeSubscription(curatorId, 'curator'); }   // listing requires an active curator subscription
router.get('/api/curators/:id', (req, res) => {
  const cp = db.q('SELECT * FROM curator_profiles WHERE user_id = ?').get(req.params.id); const u = cp && userRow(cp.user_id); if (!cp || !u || u.status !== 'active') throw new HttpError(404, 'Curator not found.');
  const viewer = auth.currentUser(req); const isSelf = viewer && viewer.id === cp.user_id;
  if (!cp.listed && !isSelf && !(viewer && viewer.role === 'admin')) throw new HttpError(404, 'Curator not found.');
  const conn = viewer ? db.q('SELECT * FROM connections WHERE curator_id = ? AND member_id = ?').get(cp.user_id, viewer.id) : null;
  send(res, 200, { curator: { ...curatorPublic(cp, u), listedNow: listedNow(cp.user_id) }, connection: conn ? { id: conn.id, status: conn.status } : null });
});
function privacyNotice() {
  return { version: config.consentVersion, grievanceContact: config.grievanceContact, purposes: [
    { id: 'account', required: true, title: 'Running your account', text: 'Your mobile number or email (for sign-in), the name you give us, the exercises you complete (rep counts, joint angles, form scores, effort ratings), your notes, routines you build, and your subscription status are stored so the app can show your history and, if you connect with a curator, share your completed sets from routines they sent you.' },
    { id: 'diagnostics', required: false, title: 'Storing movement keypoints to improve the coach', text: 'Optionally, the skeleton keypoints from your sessions (33 body points per frame — never video or images) are stored so we can check and improve the accuracy of the exercise coach. Switch this off any time in Account.' },
  ], text: `${config.appName} is a fitness and movement app, not a medical service. Curators listed in the app are independent professionals; their credentials are self-declared unless marked verified, and nothing in the app is a diagnosis or a substitute for care from a clinician. Camera video is processed on your device and never uploaded. Under the Digital Personal Data Protection Act, 2023 you can download or delete your data from Account, withdraw consent, and raise a grievance with the contact below.` };
}

/* ---------------- auth ---------------- */
router.post('/api/auth/otp/request', async (req, res) => { const b = await readJson(req); send(res, 200, await auth.requestOtp(b.identifier, req)); });
router.post('/api/auth/otp/verify', async (req, res) => { const b = await readJson(req); const user = await auth.verifyOtp(b.identifier, b.code, req, res, { role: b.role === 'curator' ? 'curator' : 'member', name: b.name ? v.str(b.name, { max: 120, name: 'name' }) : null }); send(res, 200, { user: { ...meView(userRow(user.id)), created: user.created } }); });
router.post('/api/auth/logout', (req, res) => { auth.logout(req, res); send(res, 200, { ok: true }); });
router.post('/api/consent', async (req, res) => {
  const u = auth.requireAuth(req); const b = await readJson(req);
  if (b.version !== config.consentVersion) throw new HttpError(400, 'Notice version mismatch — reload and try again.');
  const purposes = v.arr(b.purposes || [], 'purposes');
  db.q('INSERT INTO consent_records(id, user_id, version, purposes_json, accepted_at, ip) VALUES (?,?,?,?,?,?)').run(c.uuid(), u.id, b.version, JSON.stringify(purposes), now(), clientIp(req));
  db.q('UPDATE users SET consent_version = ?, consent_at = ? WHERE id = ?').run(b.version, now(), u.id);
  const prefs = { ...J(u.prefs_json, {}), store_diagnostics: purposes.includes('diagnostics') }; db.q('UPDATE users SET prefs_json = ? WHERE id = ?').run(JSON.stringify(prefs), u.id);
  audit.log({ actorId: u.id, action: 'consent.accepted', targetType: 'user', targetId: u.id, ip: clientIp(req), meta: { version: b.version } });
  send(res, 200, { ok: true });
});

/* ---------------- account ---------------- */
router.patch('/api/me', async (req, res) => {
  const u = auth.requireAuth(req); const b = await readJson(req);
  if (b.name !== undefined) db.q('UPDATE users SET name_enc = ? WHERE id = ?').run(c.encrypt(v.str(b.name, { min: 1, max: 120, name: 'name' })), u.id);
  if (b.prefs !== undefined) { const prefs = { ...J(u.prefs_json, {}) }; if (b.prefs.store_diagnostics !== undefined) prefs.store_diagnostics = !!b.prefs.store_diagnostics; db.q('UPDATE users SET prefs_json = ? WHERE id = ?').run(JSON.stringify(prefs), u.id); }
  if (b.role !== undefined && u.role !== 'admin') { // members can become curators (creates a profile); curators can go back to member only with no listing
    const role = v.oneOf(b.role, ['member', 'curator'], 'role');
    if (role === 'curator' && u.role !== 'curator') { db.q("UPDATE users SET role = 'curator' WHERE id = ?").run(u.id); if (!db.q('SELECT 1 FROM curator_profiles WHERE user_id = ?').get(u.id)) db.q('INSERT INTO curator_profiles(user_id, display_name, kind, created_at, updated_at) VALUES (?,?,?,?,?)').run(u.id, c.decrypt(u.name_enc) || 'New curator', 'trainer', now(), now()); }
    if (role === 'member' && u.role === 'curator') { db.q("UPDATE users SET role = 'member' WHERE id = ?").run(u.id); db.q('UPDATE curator_profiles SET listed = 0 WHERE user_id = ?').run(u.id); }
  }
  audit.log({ actorId: u.id, action: 'account.updated', targetType: 'user', targetId: u.id, meta: { fields: Object.keys(b) } });
  send(res, 200, { user: meView(userRow(u.id)) });
});
router.get('/api/me/export', (req, res) => {
  const u = auth.requireAuth(req);
  const out = { exportedAt: new Date().toISOString(), user: auth.publicUser(u), consents: db.q('SELECT version, purposes_json, accepted_at, withdrawn_at FROM consent_records WHERE user_id = ?').all(u.id).map(r => ({ version: r.version, purposes: J(r.purposes_json, []), acceptedAt: r.accepted_at, withdrawnAt: r.withdrawn_at })),
    subscriptions: pay.subscriptionsOf(u.id), routines: db.q('SELECT * FROM routines WHERE owner_id = ?').all(u.id).map(r => routineView(r, { viewer: u })), assignments: db.q('SELECT * FROM routine_assignments WHERE member_id = ? OR curator_id = ?').all(u.id, u.id),
    connections: db.q('SELECT id, curator_id, member_id, status, created_at FROM connections WHERE member_id = ? OR curator_id = ?').all(u.id, u.id), sessions: db.q('SELECT * FROM exercise_sessions WHERE user_id = ?').all(u.id).map(s => sessionView(s, { withDiagnostics: true })),
    notes: db.q('SELECT * FROM notes WHERE user_id = ?').all(u.id).map(n => ({ id: n.id, exerciseId: n.exercise_id, text: c.decrypt(n.text_enc), createdAt: n.created_at })), curatorProfile: u.role === 'curator' ? curatorPublic(db.q('SELECT * FROM curator_profiles WHERE user_id = ?').get(u.id), u) : null };
  audit.log({ actorId: u.id, action: 'data.exported', targetType: 'user', targetId: u.id, ip: clientIp(req) });
  send(res, 200, out, { 'content-disposition': 'attachment; filename="ontrack-my-data.json"' });
});
router.post('/api/me/erasure', async (req, res) => {
  const u = auth.requireAuth(req); const b = await readJson(req);
  if (b.cancel) { db.q("UPDATE users SET status = 'active', erasure_requested_at = NULL WHERE id = ? AND status = 'erasure_requested'").run(u.id); audit.log({ actorId: u.id, action: 'erasure.cancelled', targetType: 'user', targetId: u.id }); return send(res, 200, { ok: true, status: 'active' }); }
  db.q("UPDATE users SET status = 'erasure_requested', erasure_requested_at = ? WHERE id = ?").run(now(), u.id); audit.log({ actorId: u.id, action: 'erasure.requested', targetType: 'user', targetId: u.id, ip: clientIp(req) });
  send(res, 200, { ok: true, status: 'erasure_requested', erasesAfterDays: config.retentionDaysAfterErasureRequest });
});
function eraseUser(userId, actorId) {
  const u = userRow(userId); if (!u || u.status === 'erased') return;
  db.tx(() => {
    db.q('DELETE FROM exercise_sessions WHERE user_id = ?').run(userId); db.q('DELETE FROM notes WHERE user_id = ?').run(userId);
    db.q("UPDATE routine_assignments SET status = 'archived', message_enc = NULL, updated_at = ? WHERE member_id = ? OR curator_id = ?").run(now(), userId, userId);
    db.q("UPDATE connections SET status = 'ended', message_enc = NULL, updated_at = ? WHERE member_id = ? OR curator_id = ?").run(now(), userId, userId);
    for (const r of db.q('SELECT id FROM routines WHERE owner_id = ?').all(userId)) { db.q('DELETE FROM routine_items WHERE routine_id = ?').run(r.id); db.q('DELETE FROM routines WHERE id = ?').run(r.id); }
    db.q('DELETE FROM curator_profiles WHERE user_id = ?').run(userId); db.q('DELETE FROM sessions WHERE user_id = ?').run(userId); db.q('DELETE FROM otp_codes WHERE identifier_hash = ?').run(u.identifier_hash);
    db.q('UPDATE consent_records SET withdrawn_at = ? WHERE user_id = ? AND withdrawn_at IS NULL').run(now(), userId);
    db.q("UPDATE users SET name_enc = NULL, identifier_enc = ?, identifier_hash = ?, prefs_json = '{}', status = 'erased' WHERE id = ?").run(c.encrypt('erased'), 'erased:' + userId, userId);
  });
  audit.log({ actorId, action: 'user.erased', targetType: 'user', targetId: userId });
}

/* ---------------- billing ---------------- */
router.post('/api/billing/checkout', async (req, res) => { const u = auth.requireAuth(req); const b = await readJson(req); send(res, 200, await pay.createCheckout(u, v.str(b.plan, { max: 40, name: 'plan' }))); });
router.post('/api/billing/confirm', async (req, res) => { const u = auth.requireAuth(req); const b = await readJson(req); const sub = b.provider === 'razorpay' ? pay.confirmRazorpay(u, { orderId: b.orderId, paymentId: b.paymentId, signature: b.signature }) : pay.confirmMock(u, { orderId: b.orderId }); send(res, 200, { subscription: pay.subView(sub), user: meView(userRow(u.id)) }); });
router.post('/api/billing/cancel', async (req, res) => { const u = auth.requireAuth(req); const b = await readJson(req); pay.cancel(u, b.subscriptionId); send(res, 200, { user: meView(userRow(u.id)) }); });
// Razorpay webhook: raw body needed for the signature; no auth cookie, no CSRF header.
router.post('/api/billing/webhook/razorpay', (req, res) => new Promise((resolve, reject) => { const chunks = []; req.on('data', ch => chunks.push(ch)); req.on('end', () => { try { send(res, 200, pay.razorpayWebhook(Buffer.concat(chunks).toString('utf8'), req.headers['x-razorpay-signature'])); resolve(); } catch (e) { reject(e); } }); }));

/* ---------------- routines ---------------- */
router.get('/api/routines', (req, res) => {   // mine (built) + sent to me
  const u = auth.requireAuth(req);
  const mine = db.q('SELECT * FROM routines WHERE owner_id = ? AND archived = 0 ORDER BY updated_at DESC').all(u.id).map(r => routineView(r, { viewer: u }));
  const sent = db.q("SELECT a.*, r.* , a.id AS aid, a.created_at AS a_created FROM routine_assignments a JOIN routines r ON r.id = a.routine_id WHERE a.member_id = ? AND a.status = 'active' ORDER BY a.created_at DESC").all(u.id).map(row => { const cp = db.q('SELECT display_name FROM curator_profiles WHERE user_id = ?').get(row.curator_id); return { assignmentId: row.aid, curatorId: row.curator_id, curatorName: cp ? cp.display_name : 'Curator', message: c.decrypt(row.message_enc), sentAt: row.a_created, routine: routineView(db.q('SELECT * FROM routines WHERE id = ?').get(row.routine_id), { viewer: u }) }; });
  send(res, 200, { mine, sent });
});
router.get('/api/routines/:id', (req, res) => {
  const u = auth.currentUser(req); const r = db.q('SELECT * FROM routines WHERE id = ?').get(req.params.id); if (!r) throw new HttpError(404, 'Routine not found.');
  const isOwner = u && r.owner_id === u.id; const isSent = u && db.q("SELECT 1 FROM routine_assignments WHERE routine_id = ? AND member_id = ? AND status = 'active'").get(r.id, u.id);
  if (r.kind !== 'prebuilt' && !isOwner && !isSent && !(u && u.role === 'admin')) throw new HttpError(404, 'Routine not found.');
  send(res, 200, { routine: routineView(r, { viewer: u }) });
});
function requireBuilder(u) { const ent = entitlements(u); if (!ent.canBuild) throw new HttpError(402, 'Building custom routines needs a Pro or Curator subscription.', { upgrade: true }); return ent; }
router.post('/api/routines', async (req, res) => {
  const u = auth.requireAuth(req); auth.requireConsent(u); requireBuilder(u); const b = await readJson(req);
  const items = v.arr(b.items, 'items'); if (!items.length || items.length > 20) throw new HttpError(400, 'A routine has 1–20 exercises.');
  const id = c.uuid();
  db.tx(() => {
    db.q('INSERT INTO routines(id, owner_id, title, description, tier, kind, tags_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, u.id, v.str(b.title, { min: 1, max: 120, name: 'title' }), v.optStr(b.description, { max: 2000, name: 'description' }), 'custom', 'custom', JSON.stringify(v.arr(b.tags || [], 'tags').slice(0, 5).map(t => v.str(t, { max: 30 }))), now(), now());
    items.forEach((it, i) => db.q('INSERT INTO routine_items(id, routine_id, exercise_id, position, options_json, notes) VALUES (?,?,?,?,?,?)').run(c.uuid(), id, it.exerciseId, i, JSON.stringify(validateOptions(it.exerciseId, it.options || {})), v.optStr(it.notes, { max: 1000, name: 'notes' })));
  });
  audit.log({ actorId: u.id, action: 'routine.created', targetType: 'routine', targetId: id });
  send(res, 201, { routine: routineView(db.q('SELECT * FROM routines WHERE id = ?').get(id), { viewer: u }) });
});
router.patch('/api/routines/:id', async (req, res) => {
  const u = auth.requireAuth(req); const r = db.q('SELECT * FROM routines WHERE id = ? AND owner_id = ?').get(req.params.id, u.id); if (!r) throw new HttpError(404, 'Routine not found.'); requireBuilder(u); const b = await readJson(req);
  db.tx(() => {
    if (b.title !== undefined) db.q('UPDATE routines SET title = ?, updated_at = ? WHERE id = ?').run(v.str(b.title, { min: 1, max: 120, name: 'title' }), now(), r.id);
    if (b.description !== undefined) db.q('UPDATE routines SET description = ?, updated_at = ? WHERE id = ?').run(v.optStr(b.description, { max: 2000 }), now(), r.id);
    if (b.archived !== undefined) db.q('UPDATE routines SET archived = ?, updated_at = ? WHERE id = ?').run(b.archived ? 1 : 0, now(), r.id);
    if (b.items !== undefined) { const items = v.arr(b.items, 'items'); if (!items.length || items.length > 20) throw new HttpError(400, 'A routine has 1–20 exercises.'); const keep = new Set();
      items.forEach((it, i) => { const opts = JSON.stringify(validateOptions(it.exerciseId, it.options || {})); const notes = v.optStr(it.notes, { max: 1000 });
        if (it.id && db.q('SELECT 1 FROM routine_items WHERE id = ? AND routine_id = ?').get(it.id, r.id)) { db.q('UPDATE routine_items SET exercise_id = ?, position = ?, options_json = ?, notes = ? WHERE id = ?').run(it.exerciseId, i, opts, notes, it.id); keep.add(it.id); }
        else { const nid = c.uuid(); db.q('INSERT INTO routine_items(id, routine_id, exercise_id, position, options_json, notes) VALUES (?,?,?,?,?,?)').run(nid, r.id, it.exerciseId, i, opts, notes); keep.add(nid); } });
      for (const row of db.q('SELECT id FROM routine_items WHERE routine_id = ?').all(r.id)) if (!keep.has(row.id)) db.q('DELETE FROM routine_items WHERE id = ?').run(row.id);
      db.q('UPDATE routines SET updated_at = ? WHERE id = ?').run(now(), r.id); }
  });
  audit.log({ actorId: u.id, action: 'routine.updated', targetType: 'routine', targetId: r.id, meta: { fields: Object.keys(b) } });
  send(res, 200, { routine: routineView(db.q('SELECT * FROM routines WHERE id = ?').get(r.id), { viewer: u }) });
});
router.post('/api/routines/:id/copy', (req, res) => {   // Pro members can copy a prebuilt or sent routine into their own editable list
  const u = auth.requireAuth(req); requireBuilder(u); const r = db.q('SELECT * FROM routines WHERE id = ?').get(req.params.id); if (!r) throw new HttpError(404, 'Routine not found.');
  const allowed = r.kind === 'prebuilt' || r.owner_id === u.id || db.q("SELECT 1 FROM routine_assignments WHERE routine_id = ? AND member_id = ?").get(r.id, u.id); if (!allowed) throw new HttpError(404, 'Routine not found.');
  const id = c.uuid(); db.tx(() => { db.q('INSERT INTO routines(id, owner_id, title, description, tier, kind, tags_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, u.id, r.title + ' (copy)', r.description, 'custom', 'custom', r.tags_json, now(), now()); for (const it of db.q('SELECT * FROM routine_items WHERE routine_id = ? ORDER BY position').all(r.id)) db.q('INSERT INTO routine_items(id, routine_id, exercise_id, position, options_json, notes) VALUES (?,?,?,?,?,?)').run(c.uuid(), id, it.exercise_id, it.position, it.options_json, it.notes); });
  send(res, 201, { routine: routineView(db.q('SELECT * FROM routines WHERE id = ?').get(id), { viewer: u }) });
});

/* ---------------- sessions (history) & notes ---------------- */
router.post('/api/sessions', async (req, res) => {
  const u = auth.requireAuth(req); auth.requireConsent(u); const b = await readJson(req, 12_000_000);
  const review = b.review; if (!review || typeof review !== 'object' || !EX_BY_ID[review.exercise]) throw new HttpError(400, 'Missing exercise review.');
  let assignment = null, routine = null, item = null;
  if (b.routineItemId) { item = db.q('SELECT * FROM routine_items WHERE id = ?').get(b.routineItemId); if (!item) throw new HttpError(400, 'Unknown routine item.'); routine = db.q('SELECT * FROM routines WHERE id = ?').get(item.routine_id); assignment = db.q("SELECT * FROM routine_assignments WHERE routine_id = ? AND member_id = ? AND status = 'active'").get(item.routine_id, u.id); if (!assignment && routine.owner_id !== u.id && routine.kind !== 'prebuilt') throw new HttpError(403, 'That routine is not yours.'); }
  if (!canDo(u, review.exercise)) throw new HttpError(402, 'This exercise needs Pro, or a routine sent by a curator.', { upgrade: true });
  const prefs = J(u.prefs_json, {}); const storeDiag = prefs.store_diagnostics !== false && b.diagnostics && typeof b.diagnostics === 'object';
  const clean = { exercise: review.exercise, name: review.name, type: review.type, target: review.target, score: review.score, headline: review.headline, reps: review.reps, partials: review.partials, avgTempo: review.avgTempo, avgROM: review.avgROM, holdSec: review.holdSec, goodSec: review.goodSec, durationMs: review.durationMs, trackingLossPct: review.trackingLossPct,
    faults: Object.fromEntries(Object.entries(review.faults || {}).map(([k, x]) => [k, { n: x.n, label: (x.fault && x.fault.label) || x.label, ms: x.ms }])), tips: review.tips, repList: Array.isArray(review.repList) ? review.repList.map(r => ({ n: r.n, full: r.full, peak: r.peak, duration: r.duration, faults: r.faults })) : undefined, trace: Array.isArray(review.trace) ? review.trace.slice(0, 4000) : undefined, opts: b.opts || {} };
  const id = c.uuid();
  db.q('INSERT INTO exercise_sessions(id, user_id, exercise_id, routine_id, routine_item_id, assignment_id, started_at, finished_at, source, review_json, diagnostics_enc, effort, note_enc, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, u.id, review.exercise, routine ? routine.id : null, item ? item.id : null, assignment ? assignment.id : null, b.startedAt ? v.int(b.startedAt, { min: 0, max: 4e12 }) : now() - (review.durationMs || 0), now(), v.oneOf(b.source || 'camera', ['camera', 'file', 'manual'], 'source'), JSON.stringify(clean), storeDiag ? c.encrypt(JSON.stringify(b.diagnostics)) : null, b.effort == null ? null : v.int(b.effort, { min: 0, max: 10, name: 'effort' }), c.encrypt(v.optStr(b.note, { max: 1000, name: 'note' })), now());
  audit.log({ actorId: u.id, action: 'session.logged', targetType: 'session', targetId: id, meta: { exercise: review.exercise, score: review.score, viaCurator: !!assignment } });
  send(res, 201, { session: sessionView(db.q('SELECT * FROM exercise_sessions WHERE id = ?').get(id)) });
});
router.get('/api/sessions', (req, res) => { const u = auth.requireAuth(req); const url = new URL(req.url, 'http://x'); const ex = url.searchParams.get('exercise'); const rows = ex ? db.q('SELECT * FROM exercise_sessions WHERE user_id = ? AND exercise_id = ? ORDER BY finished_at DESC LIMIT 300').all(u.id, ex) : db.q('SELECT * FROM exercise_sessions WHERE user_id = ? ORDER BY finished_at DESC LIMIT 300').all(u.id); send(res, 200, { sessions: rows.map(s => sessionView(s)) }); });
router.patch('/api/sessions/:id', async (req, res) => { const u = auth.requireAuth(req); const s = db.q('SELECT * FROM exercise_sessions WHERE id = ? AND user_id = ?').get(req.params.id, u.id); if (!s) throw new HttpError(404, 'Session not found.'); const b = await readJson(req); if (b.note !== undefined) db.q('UPDATE exercise_sessions SET note_enc = ? WHERE id = ?').run(c.encrypt(v.optStr(b.note, { max: 1000 })), s.id); if (b.effort !== undefined) db.q('UPDATE exercise_sessions SET effort = ? WHERE id = ?').run(b.effort == null ? null : v.int(b.effort, { min: 0, max: 10 }), s.id); send(res, 200, { session: sessionView(db.q('SELECT * FROM exercise_sessions WHERE id = ?').get(s.id)) }); });
router.get('/api/notes', (req, res) => { const u = auth.requireAuth(req); send(res, 200, { notes: db.q('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500').all(u.id).map(n => ({ id: n.id, exerciseId: n.exercise_id, exerciseName: n.exercise_id ? (EX_BY_ID[n.exercise_id] || {}).name : null, routineId: n.routine_id, text: c.decrypt(n.text_enc), createdAt: n.created_at, updatedAt: n.updated_at })) }); });
router.post('/api/notes', async (req, res) => { const u = auth.requireAuth(req); auth.requireConsent(u); const b = await readJson(req); const id = c.uuid(); if (b.exerciseId && !EX_BY_ID[b.exerciseId]) throw new HttpError(400, 'Unknown exercise'); db.q('INSERT INTO notes(id, user_id, exercise_id, routine_id, text_enc, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(id, u.id, b.exerciseId || null, b.routineId || null, c.encrypt(v.str(b.text, { min: 1, max: 4000, name: 'note' })), now(), now()); send(res, 201, { id }); });
router.patch('/api/notes/:id', async (req, res) => { const u = auth.requireAuth(req); const b = await readJson(req); const r = db.q('UPDATE notes SET text_enc = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(c.encrypt(v.str(b.text, { min: 1, max: 4000, name: 'note' })), now(), req.params.id, u.id); if (!r.changes) throw new HttpError(404, 'Note not found.'); send(res, 200, { ok: true }); });
router.delete('/api/notes/:id', (req, res) => { const u = auth.requireAuth(req); db.q('DELETE FROM notes WHERE id = ? AND user_id = ?').run(req.params.id, u.id); send(res, 200, { ok: true }); });

/* ---------------- connections (member ⇄ curator) ---------------- */
function connView(cn, viewer) {
  const other = viewer.id === cn.curator_id ? userRow(cn.member_id) : userRow(cn.curator_id); const cp = db.q('SELECT display_name, kind, verified FROM curator_profiles WHERE user_id = ?').get(cn.curator_id);
  return { id: cn.id, curatorId: cn.curator_id, memberId: cn.member_id, status: cn.status, requestedBy: cn.requested_by, message: c.decrypt(cn.message_enc), createdAt: cn.created_at, updatedAt: cn.updated_at,
    curatorName: cp ? cp.display_name : 'Curator', curatorKind: cp ? cp.kind : null, curatorVerified: cp ? !!cp.verified : false, memberName: viewer.id === cn.curator_id ? (c.decrypt(userRow(cn.member_id).name_enc) || 'Member') : undefined,
    memberSessionsThisWeek: viewer.id === cn.curator_id ? db.q('SELECT COUNT(*) n FROM exercise_sessions s JOIN routine_assignments a ON a.id = s.assignment_id WHERE a.curator_id = ? AND s.user_id = ? AND s.finished_at > ?').get(cn.curator_id, cn.member_id, now() - 7 * 86_400_000).n : undefined };
}
router.get('/api/connections', (req, res) => { const u = auth.requireAuth(req); send(res, 200, { connections: db.q('SELECT * FROM connections WHERE member_id = ? OR curator_id = ? ORDER BY updated_at DESC').all(u.id, u.id).map(cn => connView(cn, u)) }); });
router.post('/api/connections', async (req, res) => {   // member requests a curator; curators may also invite a member by identifier
  const u = auth.requireAuth(req); auth.requireConsent(u); const b = await readJson(req);
  let curatorId, memberId;
  if (b.curatorId) { const cp = db.q('SELECT * FROM curator_profiles WHERE user_id = ? AND listed = 1').get(b.curatorId); if (!cp || !listedNow(cp.user_id)) throw new HttpError(404, 'Curator not found.'); curatorId = cp.user_id; memberId = u.id; if (curatorId === u.id) throw new HttpError(400, 'That is you.'); }
  else if (b.memberIdentifier) { if (u.role !== 'curator' || !listedNow(u.id)) throw new HttpError(402, 'Inviting members needs an active Curator subscription.', { upgrade: true }); const ident = c.normalizeIdentifier(b.memberIdentifier); if (!ident) throw new HttpError(400, 'Enter a valid mobile number or email.'); const m = db.q('SELECT * FROM users WHERE identifier_hash = ? AND status = \'active\'').get(c.hmac(ident.value)); if (!m) throw new HttpError(404, 'No account with that number/email yet. Ask them to sign up first, then invite them.'); curatorId = u.id; memberId = m.id; }
  else throw new HttpError(400, 'curatorId or memberIdentifier required');
  const existing = db.q('SELECT * FROM connections WHERE curator_id = ? AND member_id = ?').get(curatorId, memberId);
  const msg = c.encrypt(v.optStr(b.message, { max: 500, name: 'message' }));
  let id;
  if (existing) { if (existing.status === 'accepted') throw new HttpError(409, 'Already connected.'); id = existing.id; db.q("UPDATE connections SET status = 'requested', requested_by = ?, message_enc = ?, updated_at = ? WHERE id = ?").run(u.id, msg, now(), id); }
  else { id = c.uuid(); db.q('INSERT INTO connections(id, curator_id, member_id, status, requested_by, message_enc, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, curatorId, memberId, 'requested', u.id, msg, now(), now()); }
  audit.log({ actorId: u.id, action: 'connection.requested', targetType: 'connection', targetId: id });
  send(res, 201, { connection: connView(db.q('SELECT * FROM connections WHERE id = ?').get(id), u) });
});
router.patch('/api/connections/:id', async (req, res) => {
  const u = auth.requireAuth(req); const cn = db.q('SELECT * FROM connections WHERE id = ? AND (member_id = ? OR curator_id = ?)').get(req.params.id, u.id, u.id); if (!cn) throw new HttpError(404, 'Connection not found.'); const b = await readJson(req);
  const status = v.oneOf(b.status, ['accepted', 'declined', 'ended'], 'status');
  if (status !== 'ended' && cn.requested_by === u.id) throw new HttpError(400, 'The other party has to accept.');
  if (status === 'accepted' && u.id === cn.curator_id && !listedNow(u.id)) throw new HttpError(402, 'Accepting members needs an active Curator subscription.', { upgrade: true });
  db.q('UPDATE connections SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), cn.id);
  if (status === 'ended' || status === 'declined') db.q("UPDATE routine_assignments SET status = 'archived', updated_at = ? WHERE curator_id = ? AND member_id = ?").run(now(), cn.curator_id, cn.member_id);
  audit.log({ actorId: u.id, action: 'connection.' + status, targetType: 'connection', targetId: cn.id });
  send(res, 200, { connection: connView(db.q('SELECT * FROM connections WHERE id = ?').get(cn.id), u) });
});

/* ---------------- curator ---------------- */
function requireCurator(req) { const u = auth.requireRole(req, 'curator', 'admin'); return u; }
router.get('/api/curator/profile', (req, res) => { const u = requireCurator(req); const cp = db.q('SELECT * FROM curator_profiles WHERE user_id = ?').get(u.id); send(res, 200, { profile: cp ? curatorPublic(cp, u) : null, listedNow: listedNow(u.id), specialties: SPECIALTIES }); });
router.patch('/api/curator/profile', async (req, res) => {
  const u = requireCurator(req); const b = await readJson(req); if (!db.q('SELECT 1 FROM curator_profiles WHERE user_id = ?').get(u.id)) db.q('INSERT INTO curator_profiles(user_id, display_name, kind, created_at, updated_at) VALUES (?,?,?,?,?)').run(u.id, 'New curator', 'trainer', now(), now());
  const f = {};
  if (b.displayName !== undefined) f.display_name = v.str(b.displayName, { min: 2, max: 80, name: 'display name' });
  if (b.headline !== undefined) f.headline = v.optStr(b.headline, { max: 120, name: 'headline' });
  if (b.bio !== undefined) f.bio = v.optStr(b.bio, { max: 2000, name: 'bio' });
  if (b.credentials !== undefined) f.credentials = v.optStr(b.credentials, { max: 300, name: 'credentials' });
  if (b.kind !== undefined) f.kind = v.oneOf(b.kind, ['physiotherapist', 'trainer', 'coach', 'other'], 'kind');
  if (b.specialties !== undefined) f.specialties_json = JSON.stringify(v.arr(b.specialties, 'specialties').filter(s => SPECIALTIES.includes(s)).slice(0, 6));
  if (b.city !== undefined) f.city = v.optStr(b.city, { max: 60, name: 'city' });
  if (b.languages !== undefined) f.languages_json = JSON.stringify(v.arr(b.languages, 'languages').slice(0, 6).map(l => v.str(l, { max: 30 })));
  if (b.rateText !== undefined) f.rate_text = v.optStr(b.rateText, { max: 120, name: 'rate' });
  if (b.website !== undefined) f.website = v.optStr(b.website, { max: 200, name: 'website' });
  if (b.publicContact !== undefined) f.public_contact = v.optStr(b.publicContact, { max: 120, name: 'contact' });
  if (b.listed !== undefined) f.listed = b.listed ? 1 : 0;
  const keys = Object.keys(f); if (keys.length) db.q(`UPDATE curator_profiles SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ? WHERE user_id = ?`).run(...keys.map(k => f[k]), now(), u.id);
  audit.log({ actorId: u.id, action: 'curator.profile_updated', targetType: 'user', targetId: u.id, meta: { fields: keys } });
  send(res, 200, { profile: curatorPublic(db.q('SELECT * FROM curator_profiles WHERE user_id = ?').get(u.id), u), listedNow: listedNow(u.id) });
});
router.post('/api/curator/send', async (req, res) => {   // send a routine to a connected member
  const u = requireCurator(req); if (!listedNow(u.id) && u.role !== 'admin') throw new HttpError(402, 'Sending routines needs an active Curator subscription.', { upgrade: true }); const b = await readJson(req);
  const r = db.q('SELECT * FROM routines WHERE id = ? AND (owner_id = ? OR kind = \'prebuilt\')').get(b.routineId, u.id); if (!r) throw new HttpError(404, 'Routine not found.');
  const cn = db.q("SELECT * FROM connections WHERE curator_id = ? AND member_id = ? AND status = 'accepted'").get(u.id, b.memberId); if (!cn) throw new HttpError(400, 'You can only send routines to members who accepted your connection.');
  const existing = db.q("SELECT id FROM routine_assignments WHERE routine_id = ? AND member_id = ? AND status = 'active'").get(r.id, b.memberId);
  const id = existing ? existing.id : c.uuid(); const msg = c.encrypt(v.optStr(b.message, { max: 1000, name: 'message' }));
  if (existing) db.q('UPDATE routine_assignments SET message_enc = ?, updated_at = ? WHERE id = ?').run(msg, now(), id); else db.q('INSERT INTO routine_assignments(id, routine_id, curator_id, member_id, message_enc, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, r.id, u.id, b.memberId, msg, 'active', now(), now());
  audit.log({ actorId: u.id, action: 'routine.sent', targetType: 'assignment', targetId: id, meta: { routine: r.id, member: b.memberId } });
  send(res, 201, { assignmentId: id });
});
router.get('/api/curator/members/:id', (req, res) => {   // a connected member's sessions from routines this curator sent
  const u = requireCurator(req); const cn = db.q("SELECT * FROM connections WHERE curator_id = ? AND member_id = ? AND status = 'accepted'").get(u.id, req.params.id); if (!cn) throw new HttpError(404, 'Not connected.');
  const m = userRow(cn.member_id); const assignments = db.q("SELECT a.*, r.title FROM routine_assignments a JOIN routines r ON r.id = a.routine_id WHERE a.curator_id = ? AND a.member_id = ? ORDER BY a.created_at DESC").all(u.id, m.id).map(a => ({ id: a.id, routineId: a.routine_id, title: a.title, status: a.status, message: c.decrypt(a.message_enc), sentAt: a.created_at }));
  const sessions = db.q('SELECT s.* FROM exercise_sessions s JOIN routine_assignments a ON a.id = s.assignment_id WHERE a.curator_id = ? AND s.user_id = ? ORDER BY s.finished_at DESC LIMIT 200').all(u.id, m.id).map(s => sessionView(s));
  send(res, 200, { member: { id: m.id, name: c.decrypt(m.name_enc) || 'Member', connectedSince: cn.updated_at }, assignments, sessions });
});
router.patch('/api/curator/sessions/:id/comment', async (req, res) => {
  const u = requireCurator(req); const s = db.q('SELECT s.* FROM exercise_sessions s JOIN routine_assignments a ON a.id = s.assignment_id WHERE s.id = ? AND a.curator_id = ?').get(req.params.id, u.id); if (!s) throw new HttpError(404, 'Session not found.'); const b = await readJson(req);
  db.q('UPDATE exercise_sessions SET curator_comment_enc = ?, curator_commented_at = ? WHERE id = ?').run(c.encrypt(v.optStr(b.comment, { max: 2000, name: 'comment' })), now(), s.id); audit.log({ actorId: u.id, action: 'session.commented', targetType: 'session', targetId: s.id });
  send(res, 200, { session: sessionView(db.q('SELECT * FROM exercise_sessions WHERE id = ?').get(s.id)) });
});
router.patch('/api/curator/assignments/:id', async (req, res) => { const u = requireCurator(req); const b = await readJson(req); const r = db.q("UPDATE routine_assignments SET status = ?, updated_at = ? WHERE id = ? AND curator_id = ?").run(v.oneOf(b.status, ['active', 'archived'], 'status'), now(), req.params.id, u.id); if (!r.changes) throw new HttpError(404, 'Not found.'); send(res, 200, { ok: true }); });

/* ---------------- admin ---------------- */
router.get('/api/admin/overview', (req, res) => {
  auth.requireRole(req, 'admin'); const n = sql => db.q(sql).get().n;
  send(res, 200, { stats: { members: n("SELECT COUNT(*) n FROM users WHERE role='member' AND status='active'"), curators: n("SELECT COUNT(*) n FROM users WHERE role='curator' AND status='active'"), activeSubs: n(`SELECT COUNT(*) n FROM subscriptions WHERE status IN ('active','cancelled') AND period_end > ${now()}`), sessions7d: n(`SELECT COUNT(*) n FROM exercise_sessions WHERE finished_at > ${now() - 7 * 86_400_000}`), revenuePaise30d: db.q(`SELECT COALESCE(SUM(amount_paise),0) n FROM payments WHERE status='paid' AND paid_at > ${now() - 30 * 86_400_000}`).get().n },
    curators: db.q('SELECT cp.*, u.status, u.identifier_enc FROM curator_profiles cp JOIN users u ON u.id = cp.user_id ORDER BY cp.created_at DESC').all().map(cp => ({ ...curatorPublic(cp, null), status: cp.status, identifier: c.decrypt(cp.identifier_enc), subscribed: listedNow(cp.user_id), verifiedNote: cp.verified_note })),
    audit: audit.list({ limit: 100 }) });
});
router.patch('/api/admin/curators/:id', async (req, res) => { const u = auth.requireRole(req, 'admin'); const b = await readJson(req); if (b.verified !== undefined) db.q('UPDATE curator_profiles SET verified = ?, verified_note = ?, updated_at = ? WHERE user_id = ?').run(b.verified ? 1 : 0, v.optStr(b.note, { max: 300 }), now(), req.params.id); if (b.listed !== undefined) db.q('UPDATE curator_profiles SET listed = ?, updated_at = ? WHERE user_id = ?').run(b.listed ? 1 : 0, now(), req.params.id); audit.log({ actorId: u.id, action: 'admin.curator_updated', targetType: 'user', targetId: req.params.id, meta: b }); send(res, 200, { ok: true }); });
router.patch('/api/admin/users/:id', async (req, res) => { const u = auth.requireRole(req, 'admin'); const b = await readJson(req); const t = userRow(req.params.id); if (!t || t.id === u.id) throw new HttpError(404, 'User not found.'); if (b.status !== undefined) { db.q('UPDATE users SET status = ? WHERE id = ?').run(v.oneOf(b.status, ['active', 'disabled'], 'status'), t.id); if (b.status === 'disabled') auth.revokeAllSessions(t.id); } if (b.grantPlan) pay.grant(t.id, b.grantPlan, 'admin', 'comp_' + c.uuid().slice(0, 8), 0); audit.log({ actorId: u.id, action: 'admin.user_updated', targetType: 'user', targetId: t.id, meta: b }); send(res, 200, { ok: true }); });

/* ---------------- seed & dispatch ---------------- */
const PREBUILT = [
  { title: 'Core starter', tier: 'free', description: 'Two holds anyone can do on a mat: build the habit before adding load.', tags: ['beginner', 'core'], items: [{ exerciseId: 'plank', options: { target: 20, sets: 3, rest: 45 }, notes: 'Knees down is fine for the first week.' }, { exerciseId: 'wallsit', options: { target: 30, sets: 2, rest: 60 } }] },
  { title: 'Desk-day reset', tier: 'free', description: 'Ten minutes for neck and shoulders after a day of sitting: open the chest, wake up the upper back, release the traps.', tags: ['posture', 'quick'], items: [{ exerciseId: 'pullapart', options: { target: 15, band: 'yellow', sets: 2, rest: 30 } }, { exerciseId: 'band_row', options: { target: 12, band: 'red', sets: 2, rest: 45 }, notes: 'Elbows brush your ribs.' }, { exerciseId: 'trapstretch', options: { target: 20, side: 'both', sets: 2, rest: 20 } }] },
  { title: 'Knee comeback', tier: 'free', description: 'After a knee injury or surgery: rebuild range first, then strength. Progress the flexion target weekly.', tags: ['knee', 'rehab'], items: [{ exerciseId: 'heelslide', options: { target: 10, rom: 75, sets: 2, rest: 45 }, notes: 'Slow. Stop at a firm stretch, not pain.' }, { exerciseId: 'wallsit', options: { target: 20, sets: 2, rest: 60 } }, { exerciseId: 'calfstretch', options: { target: 30, variant: 'straight', sets: 2, rest: 20 } }] },
  { title: 'Runner\'s hips', tier: 'free', description: 'Glute medius and calves — the two things that keep knees tracking straight on the road.', tags: ['runners', 'hips'], items: [{ exerciseId: 'hipabd', options: { target: 12, rom: 30, side: 'both', band: 'none', sets: 2, rest: 45 }, notes: 'Both sides, no leaning. Add a band around the ankles when 15 clean reps are easy.' }, { exerciseId: 'calfstretch', options: { target: 45, variant: 'straight', sets: 1, rest: 20 } }, { exerciseId: 'calfstretch', options: { target: 45, variant: 'bent', sets: 1, rest: 20 } }] },
  { title: 'Shoulder & neck reset', tier: 'free', description: 'Rotator cuff, shoulder blades and the upper trapezius: the five band-and-stretch exercises from a typical shoulder home programme, coached rep by rep.', tags: ['shoulder', 'neck'], items: [{ exerciseId: 'shoulder_er', options: { target: 10, variant: 'er', rom: 60, band: 'yellow', side: 'both', sets: 2, rest: 45 }, notes: 'Light band. Elbow glued to the ribs.' }, { exerciseId: 'shoulder_er', options: { target: 10, variant: 'ir', rom: 60, band: 'yellow', side: 'both', sets: 2, rest: 45 } }, { exerciseId: 'shoulder_abd', options: { target: 10, rom: 90, band: 'yellow', side: 'both', sets: 2, rest: 45 }, notes: 'Thumb slightly up, stop at shoulder height.' }, { exerciseId: 'band_row', options: { target: 12, band: 'red', sets: 2, rest: 45 } }, { exerciseId: 'pullapart', options: { target: 15, band: 'yellow', sets: 2, rest: 30 } }, { exerciseId: 'trapstretch', options: { target: 20, side: 'both', sets: 2, rest: 20 }, notes: 'Hand behind the back, shoulder down.' }] },
  { title: 'Ankle & calf', tier: 'free', description: 'Plantar fascia and Achilles: daily stretching with the heel checked every second.', tags: ['ankle', 'stretch'], items: [{ exerciseId: 'calfstretch', options: { target: 45, variant: 'straight', sets: 3, rest: 20 } }, { exerciseId: 'calfstretch', options: { target: 45, variant: 'bent', sets: 3, rest: 20 } }] },

  /* ---- commonly prescribed programmes ---- */
  { title: 'Low back — the daily three', tier: 'free', description: 'The three exercises most back programmes are built on: a curl-up that keeps the spine still, a side plank, and a bird dog. Short holds, repeated — endurance, not heroics.', tags: ['back', 'core', 'daily'], items: [{ exerciseId: 'mcgill_curl_up', options: { target: 10, sets: 3, rest: 20 }, notes: 'Hands under the lower back. Six holds, then four, then two.' }, { exerciseId: 'side_plank', options: { target: 20, side: 'both', sets: 2, rest: 30 }, notes: 'Knees down if the full version is too much.' }, { exerciseId: 'bird_dog', options: { target: 8, side: 'both', sets: 2, rest: 30 } }] },
  { title: 'Heel pain first thing', tier: 'free', description: 'For plantar heel pain: loosen the calf, wake up the arch, then load the tendon. Morning and evening.', tags: ['foot', 'plantar', 'daily'], items: [{ exerciseId: 'calfstretch', options: { target: 45, variant: 'straight', sets: 2, rest: 20 }, notes: 'Before your first steps of the day.' }, { exerciseId: 'calfstretch', options: { target: 45, variant: 'bent', sets: 2, rest: 20 } }, { exerciseId: 'towel_curl', options: { target: 10, sets: 2, rest: 30 } }, { exerciseId: 'single_calf_raise', options: { target: 12, side: 'both', sets: 3, rest: 45 }, notes: 'Slow on the way down — that is the part that loads the tendon.' }] },
  { title: 'Tennis elbow', tier: 'free', description: 'Eccentric loading is what settles a stubborn tennis elbow: lower slowly, lift with the other hand. A mild ache during is expected.', tags: ['elbow', 'tendon'], items: [{ exerciseId: 'eccentric_wrist_ext', options: { target: 15, side: 'both', sets: 3, rest: 45 }, notes: 'Lower over four seconds; use the other hand to lift it back.' }, { exerciseId: 'tyler_twist', options: { target: 15, side: 'both', sets: 3, rest: 45 } }, { exerciseId: 'wrist_extensor_stretch', options: { target: 30, side: 'both', sets: 2, rest: 20 } }, { exerciseId: 'grip_squeeze', options: { target: 10, side: 'both', sets: 2, rest: 30 } }] },
  { title: 'Stiff shoulder — early days', tier: 'free', description: 'For a painful, stiff shoulder before strengthening starts: let it hang, move it with help, and open the front.', tags: ['shoulder', 'rehab', 'gentle'], items: [{ exerciseId: 'pendulum', options: { target: 60, side: 'both', sets: 2, rest: 30 }, notes: 'Let the body rock; the arm just follows.' }, { exerciseId: 'supine_flexion', options: { target: 10, side: 'both', sets: 2, rest: 30 }, notes: 'The good arm guides — it does not push.' }, { exerciseId: 'cross_body_stretch', options: { target: 30, side: 'both', sets: 2, rest: 20 } }, { exerciseId: 'doorway_pec_stretch', options: { target: 30, sets: 2, rest: 20 } }] },
  { title: 'Steady on your feet', tier: 'free', description: 'Balance and leg strength, the two things that prevent falls. Hold something at first; let go when it is easy.', tags: ['seniors', 'balance', 'daily'], items: [{ exerciseId: 'sit_to_stand', options: { target: 10, sets: 3, rest: 60 }, notes: 'Arms crossed if you can. A firm chair against a wall.' }, { exerciseId: 'calf_raise', options: { target: 15, sets: 2, rest: 45 } }, { exerciseId: 'single_leg_balance', options: { target: 30, side: 'both', sets: 2, rest: 30 }, notes: 'Fingertips on a worktop. Progress to no hands.' }, { exerciseId: 'tandem_stance', options: { target: 30, side: 'both', sets: 2, rest: 30 } }] },
  { title: 'Glute rebuild', tier: 'free', description: 'Four steps from lying to standing: the order a physio usually works through when the glutes are not firing.', tags: ['hips', 'glutes'], items: [{ exerciseId: 'glute_bridge', options: { target: 12, sets: 3, rest: 45 } }, { exerciseId: 'clamshell', options: { target: 15, side: 'both', sets: 2, rest: 30 } }, { exerciseId: 'sidelying_abd', options: { target: 12, side: 'both', sets: 2, rest: 30 } }, { exerciseId: 'monster_walk', options: { target: 10, sets: 3, rest: 45 }, notes: 'Stay low the whole way; keep the band tight.' }] },
  { title: 'Knee osteoarthritis', tier: 'free', description: 'Gentle quadriceps work for an arthritic knee: start with no movement at all, then add a little range as it settles.', tags: ['knee', 'arthritis', 'gentle'], items: [{ exerciseId: 'quad_set', options: { target: 10, side: 'both', sets: 2, rest: 30 }, notes: 'Squeeze five seconds. Several times a day is better than one long session.' }, { exerciseId: 'seated_knee_ext', options: { target: 12, side: 'both', sets: 2, rest: 45 } }, { exerciseId: 'sit_to_stand', options: { target: 8, sets: 2, rest: 60 } }, { exerciseId: 'standing_ham_curl', options: { target: 12, side: 'both', sets: 2, rest: 45 } }] },

  /* ---- dance ---- */
  { title: 'Bharatanatyam warm-up', tier: 'free', description: 'Neck, stance and the first adavu, then the cool-down that keeps the feet healthy. The half-sit is coached: depth and turnout, held.', tags: ['dance', 'bharatanatyam'], items: [{ exerciseId: 'dance_warmup_neck', options: { target: 10, sets: 2, rest: 20 } }, { exerciseId: 'aramandi', options: { target: 30, sets: 3, rest: 45 }, notes: 'Turnout from the hips, not the feet.' }, { exerciseId: 'tatta_adavu', options: { target: 16, side: 'both', sets: 3, rest: 45 }, notes: 'Stay down in the stance between strikes.' }, { exerciseId: 'dance_cooldown_calf', options: { target: 45, side: 'both', sets: 2, rest: 20 } }] },
  { title: 'Kathak practice', tier: 'free', description: 'Warm the neck, then footwork at one tempo, then chakkars — with the cool-down that Kathak feet need more than most.', tags: ['dance', 'kathak'], items: [{ exerciseId: 'dance_warmup_neck', options: { target: 10, sets: 2, rest: 20 } }, { exerciseId: 'kathak_tatkar', options: { target: 120, sets: 3, rest: 60 }, notes: 'Slow tempo first. Even beats before fast ones.' }, { exerciseId: 'kathak_chakkar', options: { target: 60, sets: 2, rest: 90 }, notes: 'Spot every turn. Stop if the dizziness lingers.' }, { exerciseId: 'dance_cooldown_calf', options: { target: 45, side: 'both', sets: 2, rest: 20 } }] },
  { title: 'Garba night ready', tier: 'free', description: 'Build the legs for a long night of Garba: the two- and three-clap steps, then calves and a stretch.', tags: ['dance', 'garba', 'cardio'], items: [{ exerciseId: 'garba_do_taali', options: { target: 32, sets: 3, rest: 45 }, notes: 'Soft landings — you have hours of this ahead.' }, { exerciseId: 'garba_tran_taali', options: { target: 16, sets: 3, rest: 60 }, notes: 'Bend the knees for the low clap, not the back.' }, { exerciseId: 'calf_raise', options: { target: 15, sets: 3, rest: 45 } }, { exerciseId: 'dance_cooldown_calf', options: { target: 45, side: 'both', sets: 2, rest: 20 } }] },
  { title: 'Bhangra energy', tier: 'free', description: 'Jhummar to warm up, dhamaal for the work, then the calves. High impact — land soft.', tags: ['dance', 'bhangra', 'cardio'], items: [{ exerciseId: 'bhangra_jhummar', options: { target: 120, sets: 1, rest: 30 }, notes: 'Flowing, not bouncing. This is the warm-up.' }, { exerciseId: 'bhangra_dhamaal', options: { target: 24, side: 'both', sets: 3, rest: 60 }, notes: 'Knee to hip height; land through the ball of the foot.' }, { exerciseId: 'dance_cooldown_calf', options: { target: 45, side: 'both', sets: 2, rest: 20 } }] },
];
function bootstrap() {
  const have = new Set(db.q("SELECT title FROM routines WHERE kind = 'prebuilt'").all().map(r => r.title));
  const missing = PREBUILT.filter(r => !have.has(r.title));
  if (missing.length) {
    db.tx(() => { for (const r of missing) { const id = c.uuid(); db.q('INSERT INTO routines(id, owner_id, title, description, tier, kind, tags_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, null, r.title, r.description, r.tier, 'prebuilt', JSON.stringify(r.tags), now(), now()); r.items.forEach((it, i) => db.q('INSERT INTO routine_items(id, routine_id, exercise_id, position, options_json, notes) VALUES (?,?,?,?,?,?)').run(c.uuid(), id, it.exerciseId, i, JSON.stringify(validateOptions(it.exerciseId, it.options)), it.notes || null)); } });
    console.log(`[bootstrap] seeded ${missing.length} prebuilt routines`);
  }
  if (config.adminIdentifier) { const ident = c.normalizeIdentifier(config.adminIdentifier); if (ident) { const u = db.q('SELECT id, role FROM users WHERE identifier_hash = ?').get(c.hmac(ident.value)); if (u && u.role !== 'admin') { db.q("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id); console.log('[bootstrap] promoted admin'); } } }
}
async function handle(req, res, pathname) {
  const m = router.match(req.method, pathname); if (!m) throw new HttpError(404, 'Not found');
  if (!['GET', 'HEAD'].includes(req.method) && !pathname.startsWith('/api/billing/webhook/') && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Missing X-Requested-With header');
  req.params = m.params; for (const h of m.handlers) await h(req, res);
}
module.exports = { handle, bootstrap, eraseUser, get EXERCISES() { return EXERCISES; }, entitlements };
