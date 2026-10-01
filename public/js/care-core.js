/* ---------------------------------------------------------------------------
   Care: the server's logic, written once.

   Accounts by phone number and a code, a physio linked to a patient by the
   patient's say-so, a plan assigned and modified, sessions saved, a rep or a
   set sent for review with its clip and its pose record, the physio's verdict
   and reply, the visit interval and its reminders, exercise reminders, the
   one-tap report, export and deletion, and the training record that pairs the
   pose output with the physio's labels.

   The same code runs in three places: in node behind scripts/care-server.js
   (the real thing, one JSON file as the store), in the browser as the "local"
   mode of care.html (a sandbox on one phone, every role on one device), and in
   the tests. It knows nothing of HTTP or of localStorage: it is handed a store
   ({ data, save }), a clock, a source of randomness, a message transport and a
   file store, and every call is `call(method, token, args)`.

   Nothing here is a screen. The words a person reads are in care.js.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CareCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NOTICE_V = 1;                 // the privacy notice's version, kept on every consent
  const CODE_MS = 5 * 60 * 1000;      // a code lives five minutes
  const CODE_TRIES = 5, LOCK_MS = 15 * 60 * 1000, CODES_AN_HOUR = 5;
  const TOKEN_MS = 90 * 24 * 3600 * 1000;   // signed in for ninety days without use
  const CLIP_DAYS = 180, REPORT_DAYS = 90;
  const OVERDUE_MS = 2 * 24 * 3600 * 1000;  // a review unanswered this long is overdue
  const PURPOSES = ['coach', 'research', 'reminders'];
  const ROLES = ['patient', 'physio', 'admin'];
  const DAY = 24 * 3600 * 1000;

  class CareError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const fail = (status, message) => { throw new CareError(status, message); };

  /* an Indian number as the world writes it: ten digits get +91 */
  function normPhone(s) {
    let d = String(s || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '0') d = d.slice(1);
    if (d.length === 10) d = '91' + d;
    if (d.length < 10 || d.length > 15) return null;
    return '+' + d;
  }
  const digits6 = (r) => String(parseInt(r(4), 16) % 1000000).padStart(6, '0');
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max || 200) : '');
  const year = (v) => { const n = Number(v); return Number.isInteger(n) && n > 1900 && n < 2100 ? n : null; };

  /* the local day and time in one place, since every reminder is about a person's evening, not UTC's */
  function localTime(ms, tz) {
    try {
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
      const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
      const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, day: days[p.weekday], hour: Number(p.hour === '24' ? 0 : p.hour) };
    } catch {
      const d = new Date(ms + 5.5 * 3600 * 1000);
      return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16), day: d.getUTCDay(), hour: d.getUTCHours() };
    }
  }
  const dateOf = (ms, tz) => localTime(ms, tz).date;
  const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

  function CareServer(store, opts) {
    opts = opts || {};
    const now = opts.now || (() => Date.now());
    const random = opts.random || ((n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0'); return s; });
    const send = opts.send || (() => { });
    const files = opts.files || { async put() { }, async get() { return null; }, async del() { } };
    const tz = opts.tz || 'Asia/Kolkata';
    const Plans = opts.Plans || null, Moves = opts.Moves || null;
    const baseUrl = opts.baseUrl || '';
    const D = store.data;
    for (const k of ['users', 'codes', 'tokens', 'orgs', 'links', 'plans', 'sessions', 'reviews', 'newFaults', 'notes', 'reports']) if (!D[k]) D[k] = {};
    for (const k of ['audit', 'outbox', 'sent']) if (!D[k]) D[k] = k === 'sent' ? {} : [];
    const id = () => random(6);

    /* ---- the pieces every method uses ---- */
    const audit = (who, what, about) => { D.audit.push({ at: now(), who, what, about: about || null }); if (D.audit.length > 20000) D.audit.splice(0, D.audit.length - 20000); };
    const message = (m) => { const row = Object.assign({ at: now(), id: id() }, m); D.outbox.push(row); if (D.outbox.length > 500) D.outbox.splice(0, D.outbox.length - 500); try { send(row); } catch { } return row; };
    const user = (token) => {
      const t = token && D.tokens[token]; if (!t) fail(401, 'not signed in');
      if (now() - t.lastAt > TOKEN_MS) { delete D.tokens[token]; fail(401, 'signed out: it has been a while'); }
      t.lastAt = now();
      const u = D.users[t.user]; if (!u) fail(401, 'no such account');
      return u;
    };
    const must = (u, role) => { if (role === 'admin' && u.role !== 'admin') fail(403, 'admin only'); if (role === 'physio' && u.role !== 'physio' && u.role !== 'admin') fail(403, 'for a physio'); return u; };
    const pub = (u) => u ? ({ id: u.id, name: u.name || '', phone: u.phone, born: u.born || null, sex: u.sex || '', language: u.language || 'en', condition: u.condition || '', role: u.role, clinic: u.clinic || '', createdAt: u.createdAt }) : null;
    const orgOf = (u) => (u.org && D.orgs[u.org]) || null;
    const ensureOrg = (u) => {
      if (orgOf(u)) return orgOf(u);
      const o = { id: id(), name: (u.clinic || (u.name ? u.name + "'s clinic" : 'A clinic')), owner: u.id, plan: 'pilot', subscription: { status: 'active', validUntil: null, provider: null, ref: null, seats: 1 }, switches: {}, createdAt: now() };
      D.orgs[o.id] = o; u.org = o.id; return o;
    };
    /* what a plan allows: everything, on the pilot; the gate every paid feature will read */
    const can = (o, feature) => { if (!o) return false; if (o.switches && o.switches[feature] != null) return !!o.switches[feature]; return o.plan === 'pilot' || o.plan === 'paid'; };
    const linksOf = (u) => Object.values(D.links).filter((l) => l.physio === u.id || l.patient === u.id);
    const acceptedLink = (physio, patient) => Object.values(D.links).find((l) => l.physio === physio && l.patient === patient && l.state === 'accepted') || null;
    const myPlanOf = (patientId) => { const vs = Object.values(D.plans).filter((p) => p.patient === patientId).sort((a, b) => b.v - a.v); return vs[0] || null; };
    const sessionsOf = (uid) => Object.values(D.sessions).filter((s) => s.user === uid).sort((a, b) => a.at - b.at);
    const findUserByPhone = (phone) => Object.values(D.users).find((u) => u.phone === phone) || null;
    const chan = (u) => { const r = u.reminders || {}; const c = r.channel || 'auto'; if (c !== 'auto') return c; return u.push ? 'push' : u.whatsapp === false ? 'sms' : 'whatsapp'; };
    const notify = (u, kind, text, extra) => message(Object.assign({ to: u.phone, user: u.id, channel: chan(u), kind, text, push: u.push || null }, extra || {}));
    const planWords = (p) => p ? `${p.plan.name} (${p.plan.items.length} exercise${p.plan.items.length === 1 ? '' : 's'})` : '';
    const faultLabel = (move, fid) => { const m = Moves && Moves[move]; const c = m && m.cues && m.cues[fid]; return (c && (c.label || c.text)) || fid; };

    /* ---- sign-in ---- */
    const M = {};
    M.requestCode = { auth: 'none', async run(_, a) {
      const phone = normPhone(a.phone); if (!phone) fail(400, 'that does not look like a phone number');
      const c = D.codes[phone] || (D.codes[phone] = { sent: [] });
      c.sent = (c.sent || []).filter((t) => now() - t < 3600 * 1000);
      if (c.sent.length >= CODES_AN_HOUR) fail(429, 'too many codes for this number; try again in an hour');
      if (c.lockedUntil && now() < c.lockedUntil) fail(429, 'too many wrong codes; try again in a quarter of an hour');
      c.code = opts.demoCode || digits6(random); c.expires = now() + CODE_MS; c.tries = 0; c.sent.push(now());
      const text = `Your OnTrack code is ${c.code}. It works for five minutes.`;
      message({ to: phone, channel: 'sms', kind: 'otp', text });
      const out = { sent: true, phone };
      if (opts.demoCode) out.demoCode = c.code;
      return out;
    } };
    M.verify = { auth: 'none', async run(_, a) {
      const phone = normPhone(a.phone); if (!phone) fail(400, 'that does not look like a phone number');
      const c = D.codes[phone];
      if (c && c.lockedUntil && now() < c.lockedUntil) fail(429, 'too many wrong codes; try again in a quarter of an hour');
      if (!c || !c.code) fail(400, 'ask for a code first');
      if (now() > c.expires) fail(400, 'that code has expired; ask for a new one');
      if (String(a.code || '').trim() !== c.code) {
        c.tries = (c.tries || 0) + 1;
        if (c.tries >= CODE_TRIES) { c.lockedUntil = now() + LOCK_MS; c.code = null; fail(429, 'too many wrong codes; try again in a quarter of an hour'); }
        fail(400, `wrong code (${CODE_TRIES - c.tries} tr${CODE_TRIES - c.tries === 1 ? 'y' : 'ies'} left)`);
      }
      c.code = null; c.tries = 0;
      let u = findUserByPhone(phone), isNew = false;
      if (!u) {
        isNew = true;
        u = { id: id(), phone, name: '', role: 'patient', createdAt: now(), consents: {}, consentLog: [], reminders: { on: false, days: [1, 2, 3, 4, 5, 6, 0], time: '19:00', channel: 'auto' } };
        if ((opts.adminPhones || []).includes(phone)) u.role = 'admin';
        D.users[u.id] = u;
      } else if (!u.createdAt) { isNew = true; u.createdAt = now(); }   // a shell the physio made by inviting the number
      if ((opts.adminPhones || []).includes(phone) && u.role !== 'admin') u.role = 'admin';
      const token = random(24);
      D.tokens[token] = { user: u.id, createdAt: now(), lastAt: now(), device: str(a.device, 120) };
      return { token, user: pub(u), isNew: isNew || !u.name };
    } };
    M.signOut = { auth: 'user', async run(u, a, token) { delete D.tokens[token]; return { ok: true }; } };
    M.signOutAll = { auth: 'user', async run(u) { for (const [t, v] of Object.entries(D.tokens)) if (v.user === u.id) delete D.tokens[t]; return { ok: true }; } };
    M.devices = { auth: 'user', async run(u) { return Object.values(D.tokens).filter((t) => t.user === u.id).map((t) => ({ device: t.device, since: t.createdAt, last: t.lastAt })); } };

    /* ---- the person ---- */
    M.me = { auth: 'user', async run(u) {
      const links = linksOf(u).map((l) => ({ id: l.id, state: l.state, physio: pub(D.users[l.physio]), patient: pub(D.users[l.patient]), visit: l.visit ? visitState(l, dateOf(now(), tz)) : null, clinicPhone: l.clinicPhone || '', invitedAt: l.invitedAt, acceptedAt: l.acceptedAt || null }));
      const plan = myPlanOf(u.id);
      const reviews = Object.values(D.reviews).filter((r) => r.patient === u.id);
      const unread = reviews.filter((r) => r.state === 'answered' && !r.seenAt).length;
      const replies = Object.values(D.reports).filter((r) => r.user === u.id && r.reply && !r.replySeen).map((r) => ({ id: r.id, text: r.text, reply: r.reply, at: r.repliedAt }));
      const org = orgOf(u);
      return { user: pub(u), consents: u.consents || {}, reminders: u.reminders, links, plan: plan ? { id: plan.id, v: plan.v, plan: plan.plan, physio: pub(D.users[plan.physio]), at: plan.at, note: plan.note || '' } : null,
        unreadReviews: unread, replies, org: org ? { id: org.id, name: org.name, plan: org.plan, can: { reviews: can(org, 'reviews'), hindi: can(org, 'hindi') } } : null, local: !!opts.local, noticeV: NOTICE_V };
    } };
    M.updateProfile = { auth: 'user', async run(u, a) {
      if (a.name != null) u.name = str(a.name, 80);
      if (a.born != null) { const y = year(a.born); if (!y) fail(400, 'the year of birth, four digits'); if (new Date(now()).getUTCFullYear() - y < 18) fail(400, 'OnTrack is for people over eighteen for now'); u.born = y; }
      if (a.sex != null) u.sex = ['f', 'm', 'x', ''].includes(a.sex) ? a.sex : '';
      if (a.language != null) u.language = ['en', 'hi'].includes(a.language) ? a.language : 'en';
      if (a.condition != null) u.condition = str(a.condition, 200);
      if (a.clinic != null) u.clinic = str(a.clinic, 120);
      if (a.registration != null) u.registration = str(a.registration, 60);
      if (a.whatsapp != null) u.whatsapp = !!a.whatsapp;
      return { user: pub(u) };
    } };
    M.consent = { auth: 'user', async run(u, a) {
      if (!PURPOSES.includes(a.purpose)) fail(400, 'no such purpose');
      u.consents[a.purpose] = !!a.on; u.consentLog.push({ purpose: a.purpose, on: !!a.on, at: now(), notice: NOTICE_V });
      if (a.purpose === 'research' && !a.on) for (const r of Object.values(D.reviews)) if (r.patient === u.id) r.research = false;
      if (a.purpose === 'research' && a.on) for (const r of Object.values(D.reviews)) if (r.patient === u.id) r.research = true;
      return { consents: u.consents };
    } };
    /* a role: set by the admin, or, in the sandbox on one phone, by the person themselves */
    M.setRole = { auth: 'user', async run(u, a) {
      const target = a.userId ? D.users[a.userId] : u; if (!target) fail(404, 'no such person');
      if (target !== u && u.role !== 'admin') fail(403, 'admin only');
      if (target === u && u.role !== 'admin' && !opts.local) fail(403, 'a physio\'s role is set after a look at the registration number; ask at hello@');
      if (!ROLES.includes(a.role)) fail(400, 'no such role');
      target.role = a.role; if (a.role === 'physio') ensureOrg(target);
      audit(u.id, 'role ' + a.role, target.id);
      return { user: pub(target) };
    } };
    M.requestPhysio = { auth: 'user', async run(u, a) { u.physioRequest = { registration: str(a.registration, 60), clinic: str(a.clinic, 120), at: now() }; u.clinic = str(a.clinic, 120); return { ok: true, pending: u.role !== 'physio' }; } };

    /* ---- the link between a physio and a patient ---- */
    M.addPatient = { auth: 'physio', async run(u, a) {
      const phone = normPhone(a.phone); if (!phone) fail(400, 'that does not look like a phone number');
      if (phone === u.phone) fail(400, 'that is your own number');
      let p = findUserByPhone(phone);
      if (!p) { p = { id: id(), phone, name: str(a.name, 80), role: 'patient', createdAt: null, invitedBy: u.id, consents: {}, consentLog: [], reminders: { on: false, days: [1, 2, 3, 4, 5, 6, 0], time: '19:00', channel: 'auto' } }; D.users[p.id] = p; }
      else if (!p.name && a.name) p.name = str(a.name, 80);
      let l = Object.values(D.links).find((x) => x.physio === u.id && x.patient === p.id && x.state !== 'ended');
      if (!l) { l = { id: id(), physio: u.id, patient: p.id, state: 'pending', invitedAt: now() }; D.links[l.id] = l; }
      const link = `${baseUrl}care.html#/care/link/${l.id}`;
      const text = `${u.name || 'Your physio'}${u.clinic ? ' at ' + u.clinic : ''} wants to add you on OnTrack, to set your exercises and see how they go. Open ${link} and sign in with this number.`;
      const msg = message({ to: phone, user: p.id, channel: 'sms', kind: 'invite', text, link });
      return { link: { id: l.id, state: l.state, patient: pub(p) }, message: msg.text, url: link };
    } };
    M.acceptLink = { auth: 'user', async run(u, a) {
      const l = D.links[a.linkId]; if (!l) fail(404, 'no such invitation');
      if (l.patient !== u.id) fail(403, 'this invitation is for another number');
      if (l.state === 'ended') fail(400, 'this link was ended');
      l.state = 'accepted'; l.acceptedAt = now();
      u.consents.coach = true; u.consentLog.push({ purpose: 'coach', on: true, at: now(), notice: NOTICE_V, link: l.id });
      audit(u.id, 'link accepted', l.physio);
      return { link: { id: l.id, state: l.state, physio: pub(D.users[l.physio]) } };
    } };
    M.linkInfo = { auth: 'user', async run(u, a) { const l = D.links[a.linkId]; if (!l) fail(404, 'no such invitation'); if (l.patient !== u.id && l.physio !== u.id) fail(403, 'not yours'); return { id: l.id, state: l.state, physio: pub(D.users[l.physio]), patient: pub(D.users[l.patient]), mine: l.patient === u.id }; } };
    M.endLink = { auth: 'user', async run(u, a) {
      const l = D.links[a.linkId]; if (!l) fail(404, 'no such link');
      if (l.patient !== u.id && l.physio !== u.id && u.role !== 'admin') fail(403, 'not yours');
      l.state = 'ended'; l.endedAt = now(); l.endedBy = u.id; audit(u.id, 'link ended', l.id);
      return { ok: true };
    } };
    /* the week as the physio reads it: days done of days planned, the last session, and what to worry about */
    function weekOf(p, plan, today) {
      const ss = sessionsOf(p.id);
      const days = new Set(ss.filter((s) => daysBetween(dateOf(s.at, tz), today) < 7 && daysBetween(dateOf(s.at, tz), today) >= 0).map((s) => dateOf(s.at, tz)));
      const last = ss[ss.length - 1] || null;
      const planned = plan ? Math.min(7, (plan.plan.days && plan.plan.days.length) || 7) : 0;
      const flags = [];
      const pain = ss.filter((s) => s.feel && s.feel.pain === 'stop' && now() - s.at < 7 * DAY);
      if (pain.length) flags.push({ kind: 'pain', text: `stopped for pain ${pain.length === 1 ? 'once' : pain.length + ' times'} this week` });
      if (plan && (!last || daysBetween(dateOf(last.at, tz), today) >= 3) && daysBetween(dateOf(plan.at, tz), today) >= 3) flags.push({ kind: 'missed', text: last ? `nothing for ${daysBetween(dateOf(last.at, tz), today)} days` : 'has not started' });
      return { daysDone: days.size, daysPlanned: planned, last: last ? { at: last.at, move: last.move, pain: last.feel && last.feel.pain } : null, flags };
    }
    function visitState(l, today) {
      const v = l.visit; if (!v || !v.next) return null;
      const d = daysBetween(today, v.next);
      let state = v.state || 'due';
      if (state === 'snoozed' && v.snoozedUntil && today >= v.snoozedUntil) state = 'due';
      return Object.assign({}, v, { state, daysLeft: d, overdue: d < 0 && state !== 'booked', soon: d >= 0 && d <= 7 && state !== 'booked' });
    }
    M.patients = { auth: 'physio', async run(u) {
      const today = dateOf(now(), tz);
      const rows = Object.values(D.links).filter((l) => l.physio === u.id && l.state !== 'ended').map((l) => {
        const p = D.users[l.patient], plan = myPlanOf(p.id);
        const week = l.state === 'accepted' ? weekOf(p, plan, today) : null;
        const visit = visitState(l, today);
        const reviews = Object.values(D.reviews).filter((r) => r.physio === u.id && r.patient === p.id && (r.state === 'sent' || r.state === 'opened'));
        const flags = week ? week.flags.slice() : [];
        if (visit && visit.overdue) flags.push({ kind: 'visit', text: `visit overdue by ${-visit.daysLeft} day${-visit.daysLeft === 1 ? '' : 's'}` });
        if (reviews.some((r) => now() - r.sentAt > OVERDUE_MS)) flags.push({ kind: 'review', text: 'a review waiting more than two days' });
        return { link: l.id, state: l.state, patient: pub(p), plan: plan ? { id: plan.id, v: plan.v, name: plan.plan.name, items: plan.plan.items.length, at: plan.at } : null, week, visit, reviewsWaiting: reviews.length, flags, invitedAt: l.invitedAt };
      });
      rows.sort((a, b) => (b.flags.length - a.flags.length) || ((b.week && b.week.last ? b.week.last.at : 0) - (a.week && a.week.last ? a.week.last.at : 0)));
      const queue = Object.values(D.reviews).filter((r) => r.physio === u.id && (r.state === 'sent' || r.state === 'opened')).length;
      return { patients: rows, queue, due: rows.filter((r) => r.visit && (r.visit.soon || r.visit.overdue)).map((r) => ({ link: r.link, patient: r.patient, visit: r.visit })) };
    } };
    M.patient = { auth: 'physio', async run(u, a) {
      const l = acceptedLink(u.id, a.id) || (u.role === 'admin' ? { patient: a.id } : null); if (!l) fail(403, 'not a patient of yours');
      const p = D.users[a.id]; if (!p) fail(404, 'no such person');
      const today = dateOf(now(), tz), plan = myPlanOf(p.id);
      return { patient: pub(p), link: l.id ? { id: l.id, state: l.state, acceptedAt: l.acceptedAt, visit: visitState(l, today), remindersOff: !!l.remindersOff, note: l.note || '' } : null,
        plan: plan ? { id: plan.id, v: plan.v, plan: plan.plan, at: plan.at, note: plan.note || '', versions: Object.values(D.plans).filter((x) => x.patient === p.id).length } : null,
        week: weekOf(p, plan, today), sessions: sessionsOf(p.id).slice(-60).reverse().map(sessionRow),
        notes: Object.values(D.notes).filter((n) => n.about === p.id && (n.by === u.id || n.shared)).sort((x, y) => y.at - x.at),
        reviews: Object.values(D.reviews).filter((r) => r.patient === p.id && r.physio === u.id).sort((x, y) => y.sentAt - x.sentAt).map(reviewRow),
        consents: { research: !!p.consents.research, reminders: !!p.consents.reminders } };
    } };
    M.addNote = { auth: 'physio', async run(u, a) {
      if (!acceptedLink(u.id, a.patientId) && u.role !== 'admin') fail(403, 'not a patient of yours');
      const n = { id: id(), by: u.id, about: a.patientId, text: str(a.text, 1000), shared: !!a.shared, at: now() }; if (!n.text) fail(400, 'an empty note');
      D.notes[n.id] = n; if (n.shared) notify(D.users[a.patientId], 'note', `${u.name || 'Your physio'} left you a note on OnTrack: ${n.text.slice(0, 120)}`);
      return { note: n };
    } };
    M.myNotes = { auth: 'user', async run(u) { return { notes: Object.values(D.notes).filter((n) => n.about === u.id && n.shared).sort((x, y) => y.at - x.at).map((n) => Object.assign({}, n, { byName: (D.users[n.by] || {}).name || '' })) }; } };

    /* ---- the plan: assigned by the physio, a new version on every change ---- */
    function cleanPlan(plan) {
      if (!plan || typeof plan !== 'object' || !Array.isArray(plan.items) || !plan.items.length) fail(400, 'a plan with at least one exercise');
      let p = Plans ? Plans.clean(plan, false) : JSON.parse(JSON.stringify(plan));
      if (!p) fail(400, 'not a plan');
      if (Plans && Moves) { const probs = Plans.check(p, Moves).filter((x) => x.level === 'error'); if (probs.length) fail(400, probs.map((x) => x.at + ': ' + x.message).join('; ')); }
      if (Array.isArray(plan.days)) p.days = plan.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).slice(0, 7);
      if (typeof plan.timesADay === 'number' && plan.timesADay >= 1 && plan.timesADay <= 4) p.timesADay = Math.round(plan.timesADay);
      delete p.custom;
      return p;
    }
    M.assignPlan = { auth: 'physio', async run(u, a) {
      const l = acceptedLink(u.id, a.patientId); if (!l) fail(403, 'not a patient of yours, or not yet accepted');
      const plan = cleanPlan(a.plan);
      const prev = myPlanOf(a.patientId);
      plan.id = 'asg-' + a.patientId; plan.assigned = true; plan.physio = u.name || ''; plan.v = prev ? prev.v + 1 : 1;
      const row = { id: id(), patient: a.patientId, physio: u.id, v: plan.v, plan, at: now(), note: str(a.note, 300) };
      D.plans[row.id] = row;
      const p = D.users[a.patientId];
      notify(p, 'plan', prev ? `${u.name || 'Your physio'} changed your plan on OnTrack${row.note ? ': ' + row.note : '.'}` : `${u.name || 'Your physio'} set your exercises on OnTrack: ${planWords(row)}. Open the app to start.`);
      return { plan: { id: row.id, v: row.v, plan: row.plan, at: row.at, note: row.note } };
    } };
    M.myPlan = { auth: 'user', async run(u) { const p = myPlanOf(u.id); return { plan: p ? { id: p.id, v: p.v, plan: p.plan, physio: pub(D.users[p.physio]), at: p.at, note: p.note || '' } : null }; } };
    /* "too hard today": the patient eases a step one notch, logged for the physio */
    M.easeStep = { auth: 'user', async run(u, a) {
      const prev = myPlanOf(u.id); if (!prev) fail(404, 'no plan');
      const plan = JSON.parse(JSON.stringify(prev.plan)); const it = plan.items[a.step]; if (!it) fail(400, 'no such step');
      const m = Moves && Moves[it.move]; const d = m ? Object.assign({}, m.defaults) : {};
      if (m && m.reps) { const reps = it.reps || d.repCount || 10; it.reps = Math.max(3, Math.round(reps * 0.7)); if (it.rom == null || it.rom > 70) it.rom = Math.max(50, (it.rom || 100) - 20); }
      else { const hold = it.hold != null ? it.hold : d.holdTargetSec || 30; it.hold = Math.max(5, Math.round(hold * 0.7)); }
      it.note = (it.note ? it.note + ' ' : '') + 'Eased by the patient.';
      plan.v = prev.v + 1;
      const row = { id: id(), patient: u.id, physio: prev.physio, v: plan.v, plan, at: now(), note: 'Eased one notch by the patient (too hard today).', easedBy: u.id };
      D.plans[row.id] = row;
      return { plan: { id: row.id, v: row.v, plan: row.plan, at: row.at, note: row.note } };
    } };

    /* ---- sessions ---- */
    const sessionRow = (s) => ({ id: s.id, at: s.at, move: s.move, planId: s.planId || null, planV: s.planV || null, step: s.step == null ? null : s.step, sets: s.sets, feel: s.feel || null, reps: s.reps || null, thumbs: s.thumbs || null, appV: s.appV, device: s.device, reviewed: Object.values(D.reviews).some((r) => r.session === s.id) });
    M.saveSession = { auth: 'user', async run(u, a) {
      const sid = str(a.id, 40) || id();
      const old = D.sessions[sid]; if (old && old.user !== u.id) fail(403, 'not yours');
      const sets = (Array.isArray(a.sets) ? a.sets : []).slice(0, 20).map((s) => ({ reps: Number(s.reps) || 0, repTarget: Number(s.repTarget) || 0, holdSec: Number(s.holdSec) || 0, bestSec: Number(s.bestSec) || 0, targetSec: Number(s.targetSec) || 0, reachedTarget: !!s.reachedTarget, cues: s.cues && typeof s.cues === 'object' ? s.cues : {} }));
      const s = Object.assign(old || { id: sid, user: u.id, createdAt: now() }, { at: Number(a.at) || now(), move: str(a.move, 40), planId: str(a.planId, 60) || null, planV: a.planV == null ? null : Number(a.planV), step: a.step == null ? null : Number(a.step), sets, appV: str(a.appV, 30), device: str(a.device, 120), spec: str(a.spec, 40) });
      if (a.feel) s.feel = { effort: str(a.feel.effort, 10), more: str(a.feel.more, 10), pain: str(a.feel.pain, 10), note: str(a.feel.note, 300) };
      if (Array.isArray(a.reps)) s.reps = a.reps.slice(0, 200).map((r) => ({ set: Number(r.set) || 1, n: Number(r.n) || 0, counted: !!r.counted, t0: Number(r.t0) || 0, t1: Number(r.t1) || 0, faults: Array.isArray(r.faults) ? r.faults.slice(0, 8) : [], peak: r.peak == null ? null : Number(r.peak) }));
      D.sessions[sid] = s;
      if (s.feel && s.feel.pain === 'stop') for (const l of Object.values(D.links)) if (l.patient === u.id && l.state === 'accepted') notify(D.users[l.physio], 'flag', `${u.name || u.phone} stopped ${Moves && Moves[s.move] ? Moves[s.move].name : s.move} for pain today.`);
      return { session: sessionRow(s) };
    } };
    M.sessions = { auth: 'user', async run(u, a) { return { sessions: sessionsOf(u.id).slice(-(a.limit || 100)).reverse().map(sessionRow) }; } };
    M.thumbs = { auth: 'user', async run(u, a) {
      const s = D.sessions[a.sessionId]; if (!s || s.user !== u.id) fail(404, 'no such session');
      s.thumbs = { up: !!a.up, line: str(a.line, 300), at: now() };
      const r = { id: id(), user: u.id, kind: 'thumbs', text: `${a.up ? 'thumbs up' : 'thumbs down'} on ${s.move}${s.thumbs.line ? ': ' + s.thumbs.line : ''}`, sessionId: s.id, screen: 'done', at: now(), state: 'new' };
      D.reports[r.id] = r;
      return { ok: true };
    } };

    /* ---- review with my physio ---- */
    const reviewRow = (r) => ({ id: r.id, patient: pub(D.users[r.patient]), physio: pub(D.users[r.physio]), session: r.session, move: r.move, setNo: r.setNo, reps: r.reps, line: r.line, verdicts: r.verdicts, state: r.state, sentAt: r.sentAt, openedAt: r.openedAt || null, answeredAt: r.answeredAt || null, seenAt: r.seenAt || null, labels: r.labels || [], message: r.message || '', change: r.change || null, clip: r.clipPath || null, record: r.recordPath || null, clipType: r.clipType || null, clipFrom: r.clipFrom || 0, overdue: (r.state === 'sent' || r.state === 'opened') && now() - r.sentAt > OVERDUE_MS, specHash: r.specHash, appV: r.appV, research: !!r.research, whole: !!r.whole });
    const bytesOf = (f) => { if (!f) return null; if (f.bytes) return f.bytes; if (f.b64) { const bin = typeof atob === 'function' ? atob(f.b64) : Buffer.from(f.b64, 'base64').toString('binary'); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; } return null; };
    M.sendReview = { auth: 'user', async run(u, a) {
      const physios = a.physioId ? [acceptedLink(a.physioId, u.id)].filter(Boolean) : Object.values(D.links).filter((l) => l.patient === u.id && l.state === 'accepted');
      if (!physios.length) fail(400, 'no physio is linked to you yet');
      const s = D.sessions[a.sessionId]; if (!s || s.user !== u.id) fail(404, 'save the session first');
      const reps = (Array.isArray(a.reps) ? a.reps : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 50);
      const out = [];
      for (const l of physios) {
        const r = { id: id(), patient: u.id, physio: l.physio, session: s.id, move: s.move, setNo: Number(a.setNo) || 1, reps, line: str(a.line, 500), verdicts: Array.isArray(a.verdicts) ? a.verdicts.slice(0, 50) : [], state: 'sent', sentAt: now(), specHash: str(a.specHash, 40), appV: str(a.appV, 30), device: str(a.device, 120), research: !!u.consents.research, clipFrom: Number(a.clipFrom) || 0, whole: !!a.whole };
        const clip = bytesOf(a.clip), rec = bytesOf(a.record);
        if (clip) { r.clipPath = `reviews/${r.id}/clip.${/mp4/.test(a.clip.type || '') ? 'mp4' : 'webm'}`; r.clipType = a.clip.type || 'video/mp4'; await files.put(r.clipPath, clip, r.clipType); }
        if (rec) { r.recordPath = `reviews/${r.id}/record.json${/gzip/.test(a.record.type || '') ? '.gz' : ''}`; r.recordType = a.record.type || 'application/json'; await files.put(r.recordPath, rec, r.recordType); }
        D.reviews[r.id] = r;
        notify(D.users[l.physio], 'review', `${u.name || u.phone} sent you ${reps.length === 1 ? 'a rep' : reps.length + ' reps'} of ${Moves && Moves[s.move] ? Moves[s.move].name : s.move} to look at on OnTrack.`);
        out.push(reviewRow(r));
      }
      return { reviews: out };
    } };
    M.myReviews = { auth: 'user', async run(u) { const rows = Object.values(D.reviews).filter((r) => r.patient === u.id).sort((x, y) => y.sentAt - x.sentAt); for (const r of rows) if (r.state === 'answered' && !r.seenAt) r.seenAt = now(); return { reviews: rows.map(reviewRow) }; } };
    M.withdraw = { auth: 'user', async run(u, a) { const r = D.reviews[a.id]; if (!r || r.patient !== u.id) fail(404, 'no such review'); if (r.state !== 'sent') fail(400, 'the physio has opened it already'); await dropReviewFiles(r); delete D.reviews[a.id]; return { ok: true }; } };
    M.queue = { auth: 'physio', async run(u) {
      const rows = Object.values(D.reviews).filter((r) => (r.physio === u.id || u.role === 'admin') && (r.state === 'sent' || r.state === 'opened')).sort((x, y) => x.sentAt - y.sentAt);
      const done = Object.values(D.reviews).filter((r) => r.physio === u.id && r.state === 'answered').sort((x, y) => y.answeredAt - x.answeredAt).slice(0, 30);
      return { queue: rows.map(reviewRow), answered: done.map(reviewRow) };
    } };
    M.review = { auth: 'user', async run(u, a) {
      const r = D.reviews[a.id]; if (!r) fail(404, 'no such review');
      const physio = r.physio === u.id || u.role === 'admin';
      if (!physio && r.patient !== u.id) fail(403, 'not yours');
      if (physio && r.state === 'sent') { r.state = 'opened'; r.openedAt = now(); }
      if (physio) audit(u.id, 'clip opened', r.id);
      const m = Moves && Moves[r.move];
      const faults = m ? m.faults.filter((f) => f !== 'lost' && !(m.prompts || []).includes(f)).map((f) => ({ id: f, label: faultLabel(r.move, f) })) : [];
      const newFaults = Object.values(D.newFaults).filter((f) => f.exercise === r.move).map((f) => ({ id: f.id, label: f.name, desc: f.desc, uses: f.uses }));
      const s = D.sessions[r.session];
      return { review: reviewRow(r), faults, newFaults, session: s ? sessionRow(s) : null, exercise: m ? { id: m.id, name: m.name, bands: m.bands.map((b) => ({ key: b.key, label: b.label })) } : { id: r.move, name: r.move, bands: [] } };
    } };
    M.judge = { auth: 'physio', async run(u, a) {
      const r = D.reviews[a.id]; if (!r) fail(404, 'no such review'); if (r.physio !== u.id && u.role !== 'admin') fail(403, 'not yours');
      const labels = [];
      for (const l of Array.isArray(a.labels) ? a.labels.slice(0, 60) : []) {
        const row = { rep: l.rep == null ? null : Number(l.rep), verdict: ['fine', 'fault', 'new'].includes(l.verdict) ? l.verdict : 'fine', severity: ['slight', 'clear', 'stop'].includes(l.severity) ? l.severity : 'clear', note: str(l.note, 300), judge: u.id, at: now() };
        if (row.verdict === 'fault') { row.faultId = str(l.faultId, 40); if (!row.faultId) fail(400, 'a fault needs its id'); }
        if (row.verdict === 'new') {
          const nf = l.newFault || {};
          let f = nf.id && D.newFaults[nf.id] && D.newFaults[nf.id].exercise === r.move ? D.newFaults[nf.id] : Object.values(D.newFaults).find((x) => x.exercise === r.move && x.name.toLowerCase() === str(nf.name, 80).toLowerCase());
          if (!f) { if (!str(nf.name, 80)) fail(400, 'a new fault needs a name'); f = { id: id(), exercise: r.move, name: str(nf.name, 80), desc: str(nf.desc, 400), part: str(nf.part, 40), measure: str(nf.measure, 40), by: u.id, at: now(), uses: 0 }; D.newFaults[f.id] = f; }
          f.uses += 1; row.newFaultId = f.id; row.faultId = 'new:' + f.id; row.label = f.name;
        } else if (row.verdict === 'fault') row.label = faultLabel(r.move, row.faultId);
        labels.push(row);
      }
      r.labels = labels; r.message = str(a.message, 1000); r.state = 'answered'; r.answeredAt = now();
      r.secondsTaken = r.openedAt ? Math.round((r.answeredAt - r.openedAt) / 1000) : null;
      r.change = null;
      /* a change to the step this rep was: a new version of the plan, with the reason */
      if (a.change && typeof a.change === 'object') {
        const s = D.sessions[r.session], prev = myPlanOf(r.patient);
        if (prev && s && s.step != null && prev.plan.items[s.step] && prev.plan.items[s.step].move === r.move) {
          const plan = JSON.parse(JSON.stringify(prev.plan)); const it = plan.items[s.step];
          const c = a.change, numv = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? v : null);
          if (numv(c.rom, 20, 150) != null) { if (c.rom === 100) delete it.rom; else it.rom = Math.round(c.rom); }
          if (numv(c.reps, 1, 100) != null) it.reps = Math.round(c.reps);
          if (numv(c.sets, 1, 20) != null) it.sets = Math.round(c.sets);
          if (numv(c.hold, 0, 600) != null) it.hold = c.hold;
          if (Array.isArray(c.ignore)) { it.ignore = c.ignore.filter((x) => typeof x === 'string'); if (!it.ignore.length) delete it.ignore; }
          if (c.note != null) { it.note = str(c.note, 200); if (!it.note) delete it.note; }
          plan.v = prev.v + 1;
          const row = { id: id(), patient: r.patient, physio: u.id, v: plan.v, plan, at: now(), note: str(a.change.reason || a.message, 300) || 'Changed from a review.' };
          D.plans[row.id] = row; r.change = { planV: row.v, step: s.step, what: Plans ? Plans.words(it, Moves && Moves[it.move]) : JSON.stringify(it), reason: row.note };
        }
      }
      audit(u.id, 'review answered', r.id);
      const p = D.users[r.patient];
      const fine = labels.every((l) => l.verdict === 'fine');
      notify(p, 'reply', `${u.name || 'Your physio'} looked at your ${Moves && Moves[r.move] ? Moves[r.move].name : r.move}: ${fine ? 'looks fine' : labels.filter((l) => l.verdict !== 'fine').map((l) => l.label).filter((x, i, arr) => arr.indexOf(x) === i).join(', ')}${r.message ? ' — ' + r.message.slice(0, 120) : ''}`);
      return { review: reviewRow(r) };
    } };
    M.newFaults = { auth: 'user', async run(u, a) { return { faults: Object.values(D.newFaults).filter((f) => !a.exercise || f.exercise === a.exercise).map((f) => ({ id: f.id, exercise: f.exercise, name: f.name, desc: f.desc, part: f.part, measure: f.measure, uses: f.uses, by: (D.users[f.by] || {}).name || '' })) }; } };
    async function dropReviewFiles(r) { for (const p of [r.clipPath, r.recordPath]) if (p) { try { await files.del(p); } catch { } } r.clipPath = null; r.recordPath = null; }

    /* ---- visits ---- */
    M.setVisit = { auth: 'physio', async run(u, a) {
      const l = acceptedLink(u.id, a.patientId); if (!l) fail(403, 'not a patient of yours');
      const weeks = Number(a.weeks); if (!(weeks >= 1 && weeks <= 26)) { l.visit = null; return { visit: null }; }
      const last = /^\d{4}-\d{2}-\d{2}$/.test(a.last || '') ? a.last : dateOf(now(), tz);
      l.visit = { weeks, last, next: addDays(last, Math.round(weeks * 7)), state: 'due', sent: [] };
      if (a.clinicPhone != null) l.clinicPhone = str(a.clinicPhone, 20);
      return { visit: visitState(l, dateOf(now(), tz)) };
    } };
    M.markVisited = { auth: 'physio', async run(u, a) {
      const l = acceptedLink(u.id, a.patientId); if (!l) fail(403, 'not a patient of yours');
      if (!l.visit) fail(400, 'no visit interval set');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : dateOf(now(), tz);
      l.visit.last = date; l.visit.next = addDays(date, Math.round(l.visit.weeks * 7)); l.visit.state = 'due'; l.visit.sent = []; l.visit.snoozedUntil = null;
      if (a.measurement) { const m = a.measurement; const row = { id: id(), by: u.id, about: l.patient, at: now(), date, what: str(m.what, 60), value: Number(m.value), unit: str(m.unit, 10) }; if (row.what && Number.isFinite(row.value)) { D.measurements = D.measurements || {}; D.measurements[row.id] = row; } }
      return { visit: visitState(l, dateOf(now(), tz)) };
    } };
    M.visitAction = { auth: 'user', async run(u, a) {
      const l = D.links[a.linkId]; if (!l || l.patient !== u.id) fail(404, 'no such link'); if (!l.visit) fail(400, 'no visit due');
      if (a.action === 'booked') { l.visit.state = 'booked'; l.visit.bookedAt = now(); if (/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) l.visit.next = a.date; notify(D.users[l.physio], 'visit', `${u.name || u.phone} booked their visit${a.date ? ' for ' + a.date : ''}.`); }
      else if (a.action === 'snooze') { l.visit.state = 'snoozed'; l.visit.snoozedUntil = addDays(dateOf(now(), tz), 3); }
      else fail(400, 'booked or snooze');
      return { visit: visitState(l, dateOf(now(), tz)) };
    } };
    M.setPatientReminders = { auth: 'physio', async run(u, a) { const l = acceptedLink(u.id, a.patientId); if (!l) fail(403, 'not a patient of yours'); l.remindersOff = !!a.off; if (a.line != null) l.reminderLine = str(a.line, 120); return { ok: true }; } };

    /* ---- reminders ---- */
    M.setReminders = { auth: 'user', async run(u, a) {
      const r = u.reminders || (u.reminders = {});
      if (a.on != null) r.on = !!a.on;
      if (Array.isArray(a.days)) r.days = a.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      if (a.time != null) { if (!/^\d{2}:\d{2}$/.test(a.time)) fail(400, 'a time as 19:00'); r.time = a.time; }
      if (a.channel != null) r.channel = ['auto', 'push', 'whatsapp', 'sms', 'off'].includes(a.channel) ? a.channel : 'auto';
      if (r.on) { u.consents.reminders = true; u.consentLog.push({ purpose: 'reminders', on: true, at: now(), notice: NOTICE_V }); }
      return { reminders: r };
    } };
    M.setPush = { auth: 'user', async run(u, a) { u.push = a.subscription && typeof a.subscription === 'object' ? a.subscription : null; return { ok: !!u.push }; } };
    /* every quarter of an hour: what is due now, sent once. Returns what went out. */
    M.tick = { auth: 'admin', async run(u, a) { return { sent: await tick(a && a.now) }; } };
    async function tick(at) {
      const t = at || now(), lt = localTime(t, tz), out = [];
      const once = (key, fn) => { if (D.sent[key]) return; D.sent[key] = t; out.push(fn()); };
      /* exercise reminders: the person's days and time, not in the night, not when the day's session is done */
      for (const p of Object.values(D.users)) {
        const r = p.reminders; if (!r || !r.on || r.channel === 'off' || !p.createdAt) continue;
        if (lt.hour >= 22 || lt.hour < 7) continue;
        if (!(r.days || []).includes(lt.day) || lt.hm < (r.time || '19:00')) continue;
        const plan = myPlanOf(p.id); if (!plan) continue;
        const link = Object.values(D.links).find((l) => l.patient === p.id && l.state === 'accepted' && l.physio === plan.physio);
        if (link && link.remindersOff) continue;
        if (sessionsOf(p.id).some((s) => dateOf(s.at, tz) === lt.date)) continue;
        const missed = (() => { let n = 0; for (let i = 1; i <= 3; i++) { if (sessionsOf(p.id).some((s) => dateOf(s.at, tz) === addDays(lt.date, -i))) break; n++; } return n; })();
        once(`ex:${p.id}:${lt.date}`, () => notify(p, 'exercise', (missed >= 2 ? 'Two minutes counts. ' : '') + `Time for your exercises: ${plan.plan.name}.` + (link && link.reminderLine ? ' ' + link.reminderLine : ''), { date: lt.date }));
      }
      /* visit reminders: a week before, two days before, and once when it is overdue */
      for (const l of Object.values(D.links)) {
        if (l.state !== 'accepted' || !l.visit || !l.visit.next || l.visit.state === 'booked') continue;
        if (lt.hour < 9 || lt.hour >= 21) continue;
        const p = D.users[l.patient], ph = D.users[l.physio]; const d = daysBetween(lt.date, l.visit.next);
        const v = visitState(l, lt.date); if (v.state === 'snoozed') continue;
        const text = (when) => `${ph.name || 'Your physio'} would like to see you ${when} (around ${l.visit.next}). Book a visit?${l.clinicPhone ? ' Call ' + l.clinicPhone + '.' : ''}`;
        if (d === 7) once(`visit:${l.id}:${l.visit.next}:7`, () => notify(p, 'visit', text('next week'), { link: l.id }));
        else if (d === 2) once(`visit:${l.id}:${l.visit.next}:2`, () => notify(p, 'visit', text('in two days'), { link: l.id }));
        else if (d < 0) once(`visit:${l.id}:${l.visit.next}:over`, () => notify(p, 'visit', `Your visit to ${ph.name || 'your physio'} was due on ${l.visit.next}. Book one when you can.${l.clinicPhone ? ' Call ' + l.clinicPhone + '.' : ''}`, { link: l.id }));
      }
      return out;
    }

    /* ---- reports: something is wrong, feedback, the weekly form ---- */
    M.report = { auth: 'user', async run(u, a) {
      const r = { id: id(), user: u.id, kind: ['problem', 'feedback', 'weekly', 'wrongFault'].includes(a.kind) ? a.kind : 'problem', screen: str(a.screen, 60), text: str(a.text, 2000), device: str(a.device, 200), appV: str(a.appV, 30), spec: str(a.spec, 40), sessionId: str(a.sessionId, 40), log: Array.isArray(a.log) ? a.log.slice(-60).map((x) => str(typeof x === 'string' ? x : JSON.stringify(x), 200)) : [], at: now(), state: 'new' };
      if (a.screenshot && a.screenshot.b64) { r.screenshotPath = `reports/${r.id}/screen.png`; await files.put(r.screenshotPath, bytesOf(a.screenshot), 'image/png'); }
      if (!r.text && r.kind !== 'wrongFault') fail(400, 'say what happened, in a line');
      D.reports[r.id] = r;
      message({ to: 'admin', channel: 'email', kind: 'report', text: `${r.kind} from ${u.name || u.phone} on ${r.screen}: ${r.text.slice(0, 200)}`, report: r.id });
      return { report: { id: r.id, at: r.at } };
    } };
    M.reports = { auth: 'admin', async run(u, a) { return { reports: Object.values(D.reports).sort((x, y) => y.at - x.at).slice(0, a.limit || 200).map((r) => Object.assign({}, r, { who: pub(D.users[r.user]) })) }; } };
    M.replyReport = { auth: 'admin', async run(u, a) { const r = D.reports[a.id]; if (!r) fail(404, 'no such report'); r.reply = str(a.text, 1000); r.repliedAt = now(); r.state = 'answered'; const p = D.users[r.user]; if (p) notify(p, 'reportReply', `About what you reported: ${r.reply.slice(0, 160)}`); return { ok: true }; } };
    M.seenReply = { auth: 'user', async run(u, a) { const r = D.reports[a.id]; if (r && r.user === u.id) r.replySeen = now(); return { ok: true }; } };

    /* ---- the person's data: export, delete; what was done with it ---- */
    M.exportData = { auth: 'user', async run(u) {
      audit(u.id, 'export', u.id);
      return { exported: now(), user: Object.assign(pub(u), { consents: u.consents, consentLog: u.consentLog, reminders: u.reminders }), links: linksOf(u).map((l) => Object.assign({}, l, { physio: pub(D.users[l.physio]), patient: pub(D.users[l.patient]) })),
        plans: Object.values(D.plans).filter((p) => p.patient === u.id), sessions: sessionsOf(u.id), reviews: Object.values(D.reviews).filter((r) => r.patient === u.id).map(reviewRow),
        notes: Object.values(D.notes).filter((n) => n.about === u.id && n.shared), reports: Object.values(D.reports).filter((r) => r.user === u.id), audit: D.audit.filter((x) => x.who === u.id || x.about === u.id),
        files: Object.values(D.reviews).filter((r) => r.patient === u.id).flatMap((r) => [r.clipPath, r.recordPath]).filter(Boolean) };
    } };
    M.myAudit = { auth: 'user', async run(u) { const mine = new Set(Object.values(D.reviews).filter((r) => r.patient === u.id).map((r) => r.id)); return { audit: D.audit.filter((x) => x.who === u.id || x.about === u.id || mine.has(x.about)).slice(-200).reverse().map((x) => Object.assign({}, x, { whoName: (D.users[x.who] || {}).name || '' })) }; } };
    M.deleteAccount = { auth: 'user', async run(u, a) {
      const target = a && a.userId && u.role === 'admin' ? D.users[a.userId] : u; if (!target) fail(404, 'no such person');
      for (const r of Object.values(D.reviews)) if (r.patient === target.id) {
        await dropReviewFiles(r);
        /* the labels stay in the training record only under the research consent, and without the person */
        if (r.research) { r.patient = null; r.anonymised = true; } else delete D.reviews[r.id];
      }
      for (const s of Object.values(D.sessions)) if (s.user === target.id) delete D.sessions[s.id];
      for (const p of Object.values(D.plans)) if (p.patient === target.id) delete D.plans[p.id];
      for (const n of Object.values(D.notes)) if (n.about === target.id || n.by === target.id) delete D.notes[n.id];
      for (const l of Object.values(D.links)) if (l.patient === target.id || l.physio === target.id) { l.state = 'ended'; l.endedAt = now(); l.patient = l.patient === target.id ? null : l.patient; l.physio = l.physio === target.id ? null : l.physio; }
      for (const r of Object.values(D.reports)) if (r.user === target.id) r.user = null;
      for (const [t, v] of Object.entries(D.tokens)) if (v.user === target.id) delete D.tokens[t];
      delete D.users[target.id];
      audit(u.id, 'account deleted', target.id);
      return { ok: true };
    } };

    /* ---- admin: the people, the false alarms, what went out, the training record ---- */
    M.users = { auth: 'admin', async run() { return { users: Object.values(D.users).map((x) => Object.assign(pub(x), { physioRequest: x.physioRequest || null, invited: !x.createdAt, org: x.org || null })) }; } };
    M.outbox = { auth: 'admin', async run(u, a) { return { outbox: D.outbox.slice(-(a.limit || 100)).reverse() }; } };
    M.stats = { auth: 'admin', async run() { const rs = Object.values(D.reviews); return { users: Object.keys(D.users).length, physios: Object.values(D.users).filter((x) => x.role === 'physio').length, links: Object.values(D.links).filter((l) => l.state === 'accepted').length, sessions: Object.keys(D.sessions).length, reviews: rs.length, answered: rs.filter((r) => r.state === 'answered').length, reports: Object.values(D.reports).filter((r) => r.state === 'new').length, outbox: D.outbox.length }; } };
    /* the app's call against the physio's, per exercise and fault: called and fine (a false alarm), called and confirmed, missed */
    M.falseAlarms = { auth: 'admin', async run() {
      const out = {};
      for (const r of Object.values(D.reviews)) {
        if (r.state !== 'answered') continue;
        const ex = out[r.move] || (out[r.move] = { exercise: r.move, reps: 0, faults: {} });
        const f = (fid) => ex.faults[fid] || (ex.faults[fid] = { id: fid, label: faultLabel(r.move, fid), falseAlarm: 0, confirmed: 0, missed: 0 });
        const byRep = {}; for (const l of r.labels || []) { const k = l.rep == null ? '*' : String(l.rep); (byRep[k] = byRep[k] || []).push(l); }
        for (const v of r.verdicts || []) {
          ex.reps += 1;
          const labels = byRep[String(v.rep)] || byRep['*'] || [];
          const said = new Set(labels.filter((l) => l.verdict === 'fault').map((l) => l.faultId));
          const fine = labels.length && labels.every((l) => l.verdict === 'fine');
          for (const fid of v.faults || []) { if (said.has(fid)) f(fid).confirmed += 1; else if (fine || labels.length) f(fid).falseAlarm += 1; }
          for (const fid of said) if (!(v.faults || []).includes(fid)) f(fid).missed += 1;
        }
      }
      return { exercises: Object.values(out).map((e) => Object.assign(e, { faults: Object.values(e.faults).sort((a, b) => b.falseAlarm - a.falseAlarm) })) };
    } };
    /* one row per labelled rep: the paths of the pose record and the clip, the app's call, the labels, the context; no name */
    M.trainingExport = { auth: 'admin', async run() {
      const rows = [];
      for (const r of Object.values(D.reviews)) {
        if (r.state !== 'answered' || !r.research) continue;
        const p = r.patient ? D.users[r.patient] : null;
        for (const v of r.verdicts || []) rows.push({ review: r.id, rep: v.rep, exercise: r.move, specHash: r.specHash, appV: r.appV, device: r.device, record: r.recordPath, clip: r.clipPath, app: v, labels: (r.labels || []).filter((l) => l.rep == null || l.rep === v.rep).map((l) => ({ verdict: l.verdict, faultId: l.faultId || null, label: l.label || null, severity: l.severity })), context: p ? { born: p.born, sex: p.sex, condition: p.condition } : null, sentAt: r.sentAt });
      }
      return { rows, written: now() };
    } };
    /* the night's housekeeping: clips past their days, reports past theirs */
    M.nightly = { auth: 'admin', async run(u, a) { return nightly(a && a.now); } };
    async function nightly(at) {
      const t = at || now(); let clips = 0, reports = 0;
      for (const r of Object.values(D.reviews)) if (r.clipPath && t - r.sentAt > CLIP_DAYS * DAY && !r.research) { await dropReviewFiles(r); clips += 1; }
      for (const r of Object.values(D.reviews)) if (r.clipPath && t - r.sentAt > CLIP_DAYS * DAY && r.research) { try { await files.del(r.clipPath); } catch { } r.clipPath = null; clips += 1; }
      for (const r of Object.values(D.reports)) if (t - r.at > REPORT_DAYS * DAY) { delete D.reports[r.id]; reports += 1; }
      for (const [k, v] of Object.entries(D.sent)) if (t - v > 60 * DAY) delete D.sent[k];
      for (const [k, v] of Object.entries(D.tokens)) if (t - v.lastAt > TOKEN_MS) delete D.tokens[k];
      return { clips, reports };
    }

    /* ---- the one door ---- */
    async function call(method, token, args, ctx) {
      const m = M[method]; if (!m) fail(404, 'no such call: ' + method);
      args = args || {};
      let u = null;
      if (m.auth !== 'none') u = must(user(token), m.auth);
      const out = await m.run(u, args, token, ctx || {});
      if (store.save) await store.save();
      return out;
    }
    return { call, tick, nightly, methods: Object.keys(M), auth: (m) => (M[m] ? M[m].auth : null), normPhone, localTime: (t) => localTime(t, tz), can, NOTICE_V };
  }

  return { CareServer, CareError, normPhone, localTime, addDays, daysBetween, NOTICE_V };
});
