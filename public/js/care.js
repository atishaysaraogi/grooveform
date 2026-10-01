/* ---------------------------------------------------------------------------
   Care: the layer on care.html.

   The app underneath is untouched: it coaches, counts and films exactly as on
   index.html. This file adds the people around a session — an account by
   phone number, a physio who assigns and modifies a plan, a patient who does
   it and sends a rep for review, the physio's verdict and reply, the visit
   interval and its reminders, the one-tap report, the person's own data.

   It talks to the server through CareApi (care-api.js): the care server when
   the page is served by it, else the same logic run inside this browser, a
   sandbox on one phone where one person can be every role in turn.

   Routes: #/care (home for the role), #/care/signin, #/care/profile,
   #/care/link/<id>, #/care/plan, #/care/history, #/care/reviews,
   #/care/review/<id>, #/care/patient/<id>, #/care/queue, #/care/reminders,
   #/care/data, #/care/admin. The app's own routes stay; this layer adds a
   panel to its home and to the end of a session, and a button to a step.
   --------------------------------------------------------------------------- */
Moves.ready.then(() => Plans.ready).then(function () {
  'use strict';
  if (!window.CareApi || !window.CareCore || !window.__app) return;
  const api = CareApi.make(window.CARE);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const when = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  const day = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const device = () => (navigator.userAgent.match(/Android [\d.]+|iPhone OS [\d_]+|Windows|Mac OS X [\d_]+|Linux/) || [''])[0].replace(/_/g, '.') + ' · ' + ((navigator.userAgent.match(/(Chrome|Safari|Firefox|SamsungBrowser)\/[\d.]+/) || [''])[0]);
  const moveName = (id) => (Moves[id] && Moves[id].name) || id;
  const faultLabel = (mid, fid) => { const m = Moves[mid]; const c = m && m.cues[fid]; return (c && (c.label || c.text)) || fid; };
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const PHYSIO_WORD = 'physio';

  let me = null;             // the person signed in, as the server sees them (me())
  const isPhysio = () => !!me && (me.user.role === 'physio' || me.user.role === 'admin');
  const linkedPhysios = () => (me ? me.links.filter((l) => l.state === 'accepted' && l.physio && l.physio.id !== me.user.id) : []);
  async function refresh() {
    if (!api.token) { me = null; applyPlan(); return; }
    try { me = await api.call('me'); } catch (e) { if (e.status === 401) { api.token = null; } me = null; }
    applyPlan();
    if (api.mode === 'local' && me) { try { await api.tick(); } catch { } }
    api.flush().catch(() => { });
  }
  /* the assigned plan stands in the app as a plan it can open by id: #/plan/asg-<id>/<n> */
  function applyPlan() {
    Plans.extra = me && me.plan ? [Object.assign({}, me.plan.plan, { custom: false, assigned: true, physioName: me.plan.physio ? me.plan.physio.name : '', v: me.plan.v, assignedAt: me.plan.at, assignNote: me.plan.note })] : [];
    topbar();
  }

  /* ---------- the screen, the bar, the sheet ---------- */
  const main = document.querySelector('main');
  const sec = h('<section class="screen" id="screen-care" hidden></section>'); main.appendChild(sec);
  const bar = h('<a class="iconbtn" id="care-me" href="#/care" aria-label="My care page" title="My care page">☺</a>');
  const rep = h('<button class="iconbtn" id="care-report-btn" aria-label="Something is wrong" title="Something is wrong">!</button>');
  const how = $('btn-how'); how.parentNode.insertBefore(bar, how); how.parentNode.insertBefore(rep, how);
  /* Back on a care screen goes to the care home, and from there to the app's */
  const appBack = $('nav-back').onclick;
  $('nav-back').onclick = (e) => { const hsh = location.hash || '#/'; if (/^#\/care\/./.test(hsh)) location.hash = '#/care'; else if (hsh === '#/care') location.hash = '#/'; else if (appBack) appBack(e); };
  function topbar() { bar.textContent = me ? (me.user.name || '☺').slice(0, 1).toUpperCase() : '☺'; bar.title = me ? `${me.user.name || me.user.phone} — my care page` : 'Sign in'; rep.hidden = !me; }
  const SCREEN = { title: '' };
  function render(title, html) { sec.hidden = false; sec.innerHTML = html; $('nav-title').textContent = title; SCREEN.title = title; window.scrollTo(0, 0); return sec; }
  const note = (id, text, bad) => { const e = typeof id === 'string' ? $(id) : id; if (e) { e.textContent = text || ''; e.className = bad ? 'care-err' : text ? 'care-ok' : 'care-note'; } };
  const fail = (e) => (e && e.message) || String(e);
  const wa = (phone, text) => `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

  /* ---------- routes ---------- */
  function route() {
    const hsh = location.hash || '#/';
    const m = hsh.match(/^#\/care(?:\/([a-z]+))?(?:\/([^/]+))?/);
    if (!m) { sec.hidden = true; afterApp(hsh); return; }
    const page = m[1] || 'home', arg = m[2] ? decodeURIComponent(m[2]) : null;
    if (!me && page !== 'signin' && page !== 'link') { sessionStorage.setItem('ontrack.care.after', hsh); location.hash = '#/care/signin'; return; }
    const fn = PAGES[page] || PAGES.home;
    /* every care screen starts from what the server has now: a plan assigned a minute ago, a reply just sent */
    (me && page !== 'signin' ? refresh() : Promise.resolve()).then(() => (me || page === 'signin' || page === 'link' || page === 'notice' ? fn(arg) : PAGES.signin())).catch((e) => render('Care', `<section class="panel"><p class="care-err">${esc(fail(e))}</p><p><a class="btn" href="#/care">Back</a></p></section>`));
  }
  const PAGES = {};

  /* ---- sign in: the number, the code ---- */
  PAGES.signin = () => {
    render('Sign in', `
      <section class="panel">
        <h2>Your phone number</h2>
        <p class="muted">A code comes by SMS${api.local ? '' : ' (or WhatsApp if the SMS is late)'}. No password, nothing to remember.</p>
        <form class="care-form" id="care-phone-form">
          <label>Phone number<input type="tel" id="care-phone" inputmode="tel" autocomplete="tel" placeholder="98765 43210" required></label>
          <div class="row"><button class="btn primary" type="submit" id="care-send">Send me a code</button><span id="care-signin-note" class="care-note"></span></div>
        </form>
        <form class="care-form" id="care-code-form" hidden>
          <label>The six-digit code<input class="code" id="care-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required></label>
          <div class="row"><button class="btn primary" type="submit">Sign in</button><button class="btn" type="button" id="care-resend">Send it again</button><span id="care-code-note" class="care-note"></span></div>
        </form>
        ${api.local ? `<p class="tiny">This page is running on its own, on this phone: a sandbox. Any number works, the code is always <b>${esc(api.demoCode)}</b>, and the same phone can sign in as the physio and as the patient in turn. With the care server behind it, the code arrives by SMS.</p>` : ''}
        <p class="tiny">By signing in you agree to the <a href="#/care/notice">privacy notice</a>: what is kept, why, for how long, who sees it.</p>
      </section>`);
    let phone = '';
    const sendCode = async () => {
      phone = $('care-phone').value; note('care-signin-note', 'Sending…');
      try { const r = await api.call('requestCode', { phone }); phone = r.phone; note('care-signin-note', r.demoCode ? `Code: ${r.demoCode}` : `Sent to ${r.phone}.`); $('care-code-form').hidden = false; $('care-code').focus(); if (r.demoCode) $('care-code').value = r.demoCode; }
      catch (e) { note('care-signin-note', fail(e), true); }
    };
    $('care-phone-form').onsubmit = (e) => { e.preventDefault(); sendCode(); };
    $('care-resend').onclick = sendCode;
    $('care-code-form').onsubmit = async (e) => {
      e.preventDefault(); note('care-code-note', 'Checking…');
      try {
        const r = await api.call('verify', { phone, code: $('care-code').value, device: device() });
        api.token = r.token; await refresh();
        const after = sessionStorage.getItem('ontrack.care.after'); sessionStorage.removeItem('ontrack.care.after');
        location.hash = r.isNew ? '#/care/profile' : (after && !/signin/.test(after) ? after : '#/care');
      } catch (e2) { note('care-code-note', fail(e2), true); }
    };
  };
  PAGES.notice = () => render('Privacy notice', `<section class="panel"><h2>What OnTrack Care keeps, and why</h2>
    <p><b>Your number</b>, to sign you in. <b>Your name, year of birth and condition</b>, so your physio knows whose exercises these are and the app can set sensible defaults. <b>Your sessions</b> (counts, holds, what the coach said, how it felt), so you and your physio can see how it is going. <b>A clip and the skeleton of a rep</b>, only when you tap <i>Review with my physio</i>, so they can look at it; the clip is deleted after 180 days. <b>The skeleton with your physio's verdict</b> is kept to improve the app only if you tick that box, and you can untick it any time.</p>
    <p>Your physio sees your sessions, how it felt, the reps you send, and notes they write; only while the link you accepted stands. Nobody else sees any of it. You can export everything and delete your account from <a href="#/care/data">My data</a>. Questions: hello@ at this site's address.</p>
    <p class="tiny">Notice version ${CareCore.NOTICE_V}. Data is kept in India${api.local ? ' — in this sandbox, on this phone only' : ''}.</p><p><a class="btn" href="#/care">Back</a></p></section>`);

  /* ---- the profile ---- */
  PAGES.profile = () => {
    const u = me.user;
    render('About you', `
      <section class="panel"><h2>About you</h2>
        <form class="care-form" id="care-profile">
          <label>Your name<input id="cp-name" maxlength="80" value="${esc(u.name)}" required></label>
          <div class="grid tight">
            <label>Year of birth<input id="cp-born" inputmode="numeric" maxlength="4" value="${u.born || ''}" placeholder="1968"></label>
            <label>Sex<select id="cp-sex"><option value="">—</option><option value="f"${u.sex === 'f' ? ' selected' : ''}>Female</option><option value="m"${u.sex === 'm' ? ' selected' : ''}>Male</option><option value="x"${u.sex === 'x' ? ' selected' : ''}>Other</option></select></label>
            <label>Language<select id="cp-lang"><option value="en">English</option><option value="hi"${u.language === 'hi' ? ' selected' : ''}>Hindi (voice coming)</option></select></label>
          </div>
          <label>What you are working on<input id="cp-cond" maxlength="200" value="${esc(u.condition)}" placeholder="knee replacement, left, 3 weeks ago"></label>
          <label class="check"><input type="checkbox" id="cp-research"${me.consents.research ? ' checked' : ''}> The app may keep the skeleton of my reviewed reps, without my name, to get better at spotting faults</label>
          <div class="row"><button class="btn primary" type="submit">Save</button><span id="cp-note" class="care-note"></span></div>
        </form>
      </section>
      <section class="panel"><h2>Are you a physio?</h2>
        ${u.role === 'physio' ? `<p class="care-ok">Yes — your account is a physio's.</p>` : `<p class="muted">Tell us your registration number and clinic; we check it and turn the physio's screens on.${api.local ? ' In this sandbox you can turn them on yourself.' : ''}</p>
        <form class="care-form" id="care-physio"><div class="grid tight"><label>Registration number<input id="cp-reg" maxlength="60" value="${esc(u.registration || '')}"></label><label>Clinic<input id="cp-clinic" maxlength="120" value="${esc(u.clinic)}"></label></div>
        <div class="row"><button class="btn" type="submit">Ask to be a physio</button>${api.local ? '<button class="btn primary" type="button" id="cp-be-physio">Make me the physio (sandbox)</button>' : ''}<span id="cp-pnote" class="care-note"></span></div></form>`}
        ${api.local && u.role !== 'patient' ? '<p class="tiny"><button class="linkbtn" id="cp-be-patient" type="button">Make me a patient again (sandbox)</button></p>' : ''}
      </section>
      <p class="row"><a class="btn" href="#/care">Done</a><button class="btn" id="cp-signout" type="button">Sign out</button></p>`);
    $('care-profile').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.call('updateProfile', { name: $('cp-name').value, born: $('cp-born').value ? Number($('cp-born').value) : undefined, sex: $('cp-sex').value, language: $('cp-lang').value, condition: $('cp-cond').value });
        if (!!$('cp-research').checked !== !!me.consents.research) await api.call('consent', { purpose: 'research', on: $('cp-research').checked });
        await refresh(); note('cp-note', 'Saved.');
      } catch (e2) { note('cp-note', fail(e2), true); }
    };
    const form = $('care-physio');
    if (form) form.onsubmit = async (e) => { e.preventDefault(); try { const r = await api.call('requestPhysio', { registration: $('cp-reg').value, clinic: $('cp-clinic').value }); note('cp-pnote', r.pending ? 'Asked. We will call you.' : 'Done.'); } catch (e2) { note('cp-pnote', fail(e2), true); } };
    const be = $('cp-be-physio'); if (be) be.onclick = async () => { try { await api.call('updateProfile', { clinic: $('cp-clinic').value, registration: $('cp-reg').value }); await api.call('setRole', { role: 'physio' }); await refresh(); location.hash = '#/care'; } catch (e2) { note('cp-pnote', fail(e2), true); } };
    const bp = $('cp-be-patient'); if (bp) bp.onclick = async () => { await api.call('setRole', { role: 'patient' }); await refresh(); PAGES.profile(); };
    $('cp-signout').onclick = async () => { await api.signOut(); me = null; applyPlan(); location.hash = '#/'; };
  };

  /* ---- the invitation ---- */
  PAGES.link = async (id) => {
    if (!me) { sessionStorage.setItem('ontrack.care.after', '#/care/link/' + id); location.hash = '#/care/signin'; return; }
    let info; try { info = await api.call('linkInfo', { linkId: id }); } catch (e) { return render('Invitation', `<section class="panel"><p class="care-err">${esc(fail(e))}</p><p class="muted">The invitation was sent to another number, or it has ended.</p><p><a class="btn" href="#/care">Back</a></p></section>`); }
    if (!info.mine || info.state !== 'pending') { location.hash = '#/care'; return; }
    const p = info.physio;
    render('An invitation', `<section class="panel"><h2>${esc(p.name || 'A physio')}${p.clinic ? ' at ' + esc(p.clinic) : ''} wants to add you</h2>
      <p>If you accept, ${esc(p.name || 'they')} will set your exercises in this app and see:</p>
      <ul class="ticks"><li>your sessions: counts, holds, what the coach said</li><li>how each session felt, and any pain you report</li><li>the reps you choose to send for review, with their clip</li><li>notes they write about you (the ones they share)</li></ul>
      <p class="muted">Nothing from before today. You can end the link any time from My data; what was shared while it stood stays with them.</p>
      <div class="row"><button class="btn primary" id="care-accept">Accept</button><a class="btn" href="#/care">Not now</a><span id="care-link-note" class="care-note"></span></div></section>`);
    $('care-accept').onclick = async () => { try { await api.call('acceptLink', { linkId: id }); await refresh(); location.hash = '#/care'; } catch (e) { note('care-link-note', fail(e), true); } };
  };

  /* ---- home, by role ---- */
  PAGES.home = async () => {
    if (!me.user.name) { location.hash = '#/care/profile'; return; }
    if (isPhysio()) return physioHome();
    return patientHome();
  };
  const weekBar = (sessions) => {
    const d = new Date(); const days = [];
    for (let i = 6; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i); const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; days.push({ key, label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][x.getDay()], on: sessions.some((s) => localDate(s.at) === key), today: i === 0 }); }
    return `<div class="care-week">${days.map((x) => `<span class="${x.on ? 'on' : ''}${x.today ? ' today' : ''}" title="${x.key}">${x.label}</span>`).join('')}</div>`;
  };
  const localDate = (ms) => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  async function patientHome() {
    const [ss, rv, notes] = await Promise.all([api.call('sessions', { limit: 60 }), api.call('myReviews'), api.call('myNotes')]);
    const sessions = ss.sessions, plan = me.plan, pend = me.links.filter((l) => l.state === 'pending' && l.patient && l.patient.id === me.user.id);
    const doneToday = new Set(sessions.filter((s) => localDate(s.at) === today()).map((s) => `${s.planId}/${s.step}`));
    const visits = me.links.filter((l) => l.state === 'accepted' && l.visit && l.visit.next && l.patient.id === me.user.id).map((l) => ({ l, v: l.visit, days: CareCore.daysBetween(today(), l.visit.next) }));
    const replies = rv.reviews.filter((r) => r.state === 'answered').slice(0, 3);
    render('My care', `
      ${pend.map((l) => `<section class="care-panel"><h2>An invitation</h2><p>${esc(l.physio.name || 'A physio')}${l.physio.clinic ? ' at ' + esc(l.physio.clinic) : ''} wants to add you.</p><p><a class="btn primary" href="#/care/link/${l.id}">See it</a></p></section>`).join('')}
      <section class="care-panel"><h2>Today ${plan ? `<span class="tiny">${esc(plan.plan.name)} · from ${esc(plan.physio ? plan.physio.name : 'your physio')}</span>` : ''}</h2>
        ${plan ? `<ol class="care-list">${plan.plan.items.map((it, i) => { const m = Moves[it.move]; const done = doneToday.has(`${plan.plan.id}/${i}`); return `<li><span><span class="name">${done ? '✓ ' : ''}${esc(m ? m.name : it.move)}</span><span class="sub">${m ? esc(Plans.words(it, m)) : 'not in this app'}${it.note ? ' — ' + esc(it.note) : ''}</span></span>${m ? `<a class="btn ${done ? '' : 'primary'} small" href="#/plan/${esc(plan.plan.id)}/${i + 1}">${done ? 'Again' : 'Start'}</a>` : ''}</li>`; }).join('')}</ol>
          ${plan.note ? `<p class="tiny">${esc(plan.physio ? plan.physio.name : 'Your physio')}: “${esc(plan.note)}”</p>` : ''}
          <p class="tiny">${weekBar(sessions)}Days with a session, this week.</p>`
        : `<p class="muted">No plan from a physio yet. ${linkedPhysios().length ? 'They will set one.' : 'When your physio adds you, their invitation shows here. Until then the <a href="#/">exercises and programmes</a> are yours to use.'}</p>`}
      </section>
      ${visits.map(({ l, v, days }) => `<section class="care-panel"><h2>Next visit</h2><p>${esc(l.physio.name || 'Your physio')} would like to see you ${days < 0 ? `<b class="care-err">${-days} day${-days === 1 ? '' : 's'} ago</b>` : days === 0 ? '<b>today</b>' : `in <b>${days} day${days === 1 ? '' : 's'}</b>`} (${esc(v.next)})${v.state === 'booked' ? ' — <span class="care-ok">booked</span>' : v.state === 'snoozed' ? ' — reminder snoozed' : ''}.</p>
        ${v.state !== 'booked' ? `<div class="row"><button class="btn primary small" data-visit="booked" data-link="${l.id}">Booked</button><button class="btn small" data-visit="snooze" data-link="${l.id}">Remind me in 3 days</button>${l.clinicPhone ? `<a class="btn small" href="tel:${esc(l.clinicPhone)}">Call the clinic</a>` : ''}</div>` : ''}</section>`).join('')}
      ${replies.length ? `<section class="care-panel"><h2>From your ${PHYSIO_WORD}</h2>${replies.map((r) => `<div class="care-reply"><div class="who">${esc(r.physio ? r.physio.name : '')} on your ${esc(moveName(r.move))}, ${day(r.answeredAt)}</div>${esc(verdictWords(r))}${r.message ? `<br>“${esc(r.message)}”` : ''} <a href="#/care/review/${r.id}">See it</a></div>`).join('')}<p><a href="#/care/reviews">All reviews</a></p></section>` : ''}
      ${notes.notes.length ? `<section class="care-panel"><h2>Notes for you</h2>${notes.notes.slice(0, 3).map((n) => `<div class="care-reply"><div class="who">${esc(n.byName)}, ${day(n.at)}</div>${esc(n.text)}</div>`).join('')}</section>` : ''}
      ${me.replies.length ? `<section class="care-panel"><h2>About what you reported</h2>${me.replies.map((r) => `<div class="care-reply"><div class="who">you said: ${esc(r.text)}</div>${esc(r.reply)} <button class="linkbtn" data-seen="${r.id}">ok</button></div>`).join('')}</section>` : ''}
      <section class="care-panel"><h2>You</h2>
        <p class="muted">${esc(me.user.name)} · ${esc(me.user.phone)}${linkedPhysios().length ? ' · with ' + esc(linkedPhysios().map((l) => l.physio.name).join(', ')) : ''}</p>
        <div class="care-tabs"><a href="#/care/history">History</a><a href="#/care/reviews">Reviews${me.unreadReviews ? ' (' + me.unreadReviews + ')' : ''}</a><a href="#/care/reminders">Reminders${me.reminders && me.reminders.on ? ' · ' + esc(me.reminders.time) : ' · off'}</a><a href="#/care/profile">About you</a><a href="#/care/data">My data</a><a href="#/">All exercises</a></div>
        ${api.pending() ? `<p class="tiny">${api.pending()} thing${api.pending() === 1 ? '' : 's'} waiting to be sent when there is a connection.</p>` : ''}
      </section>`);
    sec.querySelectorAll('[data-visit]').forEach((b) => { b.onclick = async () => { try { await api.call('visitAction', { linkId: b.dataset.link, action: b.dataset.visit }); await refresh(); patientHome(); } catch (e) { alert(fail(e)); } }; });
    sec.querySelectorAll('[data-seen]').forEach((b) => { b.onclick = async () => { await api.call('seenReply', { id: b.dataset.seen }); await refresh(); patientHome(); }; });
  }
  const verdictWords = (r) => { const ls = r.labels || []; if (!ls.length) return 'Looked at.'; if (ls.every((l) => l.verdict === 'fine')) return 'Looks fine.'; const names = ls.filter((l) => l.verdict !== 'fine').map((l) => l.label || faultLabel(r.move, l.faultId)); return 'To work on: ' + names.filter((x, i) => names.indexOf(x) === i).join(', ') + '.'; };

  async function physioHome() {
    const r = await api.call('patients');
    render('My patients', `
      <section class="care-panel"><h2>Waiting for you ${r.queue ? `<span class="count">${r.queue}</span>` : ''}</h2>
        <p class="muted">${r.queue ? `${r.queue} review${r.queue === 1 ? '' : 's'} to look at.` : 'Nothing to look at right now.'} ${r.due.length ? `${r.due.length} visit${r.due.length === 1 ? '' : 's'} due this week.` : ''}</p>
        <div class="care-tabs"><a href="#/care/queue" class="${r.queue ? 'on' : ''}">The queue</a><a href="#/care/profile">About you</a><a href="#/">Exercises and programmes</a>${me.user.role === 'admin' ? '<a href="#/care/admin">Admin</a>' : ''}</div>
      </section>
      <section class="care-panel"><h2>Patients</h2>
        <ul class="care-list">${r.patients.map((p) => `<li><span><span class="name">${esc(p.patient.name || p.patient.phone)}${p.state === 'pending' ? ' <span class="badge">invited</span>' : ''}</span>
          <span class="sub">${p.state === 'pending' ? 'has not accepted yet · ' + esc(p.patient.phone) : `${p.plan ? esc(p.plan.name) : 'no plan yet'} · ${p.week ? `${p.week.daysDone} of ${p.week.daysPlanned} days this week` : ''}${p.week && p.week.last ? ` · last ${day(p.week.last.at)}` : ''}${p.visit ? ` · visit ${p.visit.next}${p.visit.state === 'booked' ? ' (booked)' : ''}` : ''}${p.reviewsWaiting ? ` · ${p.reviewsWaiting} to review` : ''}`}</span>
          ${p.flags.length ? `<span class="flags">${p.flags.map((f) => esc(f.text)).join(' · ')}</span>` : ''}</span>
          ${p.state === 'accepted' ? `<a class="btn small primary" href="#/care/patient/${p.patient.id}">Open</a>` : `<button class="btn small" data-reinvite="${esc(p.patient.phone)}" data-name="${esc(p.patient.name)}">Invite again</button>`}</li>`).join('') || '<li><span class="sub">Nobody yet. Add a patient below.</span></li>'}</ul>
      </section>
      <section class="care-panel"><h2>Add a patient</h2>
        <form class="care-form" id="care-add"><div class="grid tight"><label>Their phone number<input type="tel" id="ca-phone" inputmode="tel" required placeholder="98765 43210"></label><label>Their name<input id="ca-name" maxlength="80" placeholder="Sunita"></label></div>
        <div class="row"><button class="btn primary" type="submit">Send the invitation</button><span id="ca-note" class="care-note"></span></div></form>
        <div id="ca-out" hidden></div>
      </section>`);
    const invite = async (phone, name) => {
      note('ca-note', 'Sending…');
      try {
        const r2 = await api.call('addPatient', { phone, name });
        note('ca-note', '');
        const out = $('ca-out'); out.hidden = false;
        out.innerHTML = `<p class="care-ok">Invitation sent to ${esc(r2.link.patient.phone)}.</p><p class="muted">${api.local ? 'In this sandbox no message goes out: open the link yourself, signed in as that number.' : 'It went by SMS. You can also send it on WhatsApp:'}</p>
          <div class="row"><a class="btn small" href="${esc(r2.url)}">Open the invitation</a><a class="btn small" target="_blank" rel="noopener" href="${wa(r2.link.patient.phone, r2.message)}">Send on WhatsApp</a><button class="btn small" id="ca-copy" type="button">Copy the message</button></div><p class="tiny" id="ca-msg">${esc(r2.message)}</p>`;
        $('ca-copy').onclick = async () => { try { await navigator.clipboard.writeText(r2.message); note('ca-note', 'Copied.'); } catch { } };
        await refresh();
      } catch (e) { note('ca-note', fail(e), true); }
    };
    $('care-add').onsubmit = (e) => { e.preventDefault(); invite($('ca-phone').value, $('ca-name').value); };
    sec.querySelectorAll('[data-reinvite]').forEach((b) => { b.onclick = () => invite(b.dataset.reinvite, b.dataset.name); });
  }

  /* ---- a patient, for the physio ---- */
  PAGES.patient = async (id) => {
    const r = await api.call('patient', { id });
    const p = r.patient, plan = r.plan, link = r.link, v = link && link.visit;
    render(p.name || p.phone, `
      <section class="care-panel"><h2>${esc(p.name || p.phone)} <span class="tiny">${esc(p.phone)}${p.born ? ' · born ' + p.born : ''}${p.condition ? ' · ' + esc(p.condition) : ''}</span></h2>
        <p class="tiny">${weekBar(r.sessions)}${r.week.daysDone} of ${r.week.daysPlanned} days this week.${r.week.flags.length ? ' <b class="care-err">' + esc(r.week.flags.map((f) => f.text).join(' · ')) + '</b>' : ''}</p>
        <div class="row"><a class="btn small" href="tel:${esc(p.phone)}">Call</a><a class="btn small" target="_blank" rel="noopener" href="${wa(p.phone, 'Hello ' + (p.name || '') + ', ')}">WhatsApp</a>${r.reviews.some((x) => x.state !== 'answered') ? '<a class="btn small primary" href="#/care/queue">Reviews waiting</a>' : ''}</div>
      </section>
      <section class="care-panel"><h2>The plan</h2>
        ${plan ? `<p class="muted"><b>${esc(plan.plan.name)}</b> · version ${plan.v}, set ${day(plan.at)}${plan.note ? ' — ' + esc(plan.note) : ''}</p>
          <ol class="care-list">${plan.plan.items.map((it, i) => { const m = Moves[it.move]; return `<li><span><span class="name">${i + 1}. ${esc(m ? m.name : it.move)}</span><span class="sub">${m ? esc(Plans.words(it, m)) : ''}${it.note ? ' — ' + esc(it.note) : ''}</span></span></li>`; }).join('')}</ol>
          <div class="row"><button class="btn primary small" id="cpp-modify">Modify this plan</button></div>` : '<p class="muted">No plan yet.</p>'}
        <form class="care-form" id="cpp-assign"><label>${plan ? 'Or start again from a programme' : 'Assign a programme'}<select id="cpp-bundle">${Plans.list.map((b) => `<option value="${esc(b.id)}">${esc(b.name)} — ${b.items.length} exercises</option>`).join('')}${Plans.mine.length ? Plans.mine.map((b) => `<option value="${esc(b.id)}">My plan: ${esc(b.name)}</option>`).join('') : ''}</select></label>
          <label>A line for ${esc(p.name || 'them')}<input id="cpp-anote" maxlength="300" placeholder="Twice a day; ice after."></label>
          <div class="row"><button class="btn ${plan ? '' : 'primary'}" type="submit">${plan ? 'Replace the plan' : 'Assign'}</button><span id="cpp-note" class="care-note"></span></div></form>
        <p class="tiny">Modify copies the plan to your own plans on this phone, where every step's sets, reps, hold, range, faults to leave alone and note can be changed; then Assign on that page sends it to ${esc(p.name || 'them')} as a new version.</p>
      </section>
      <section class="care-panel"><h2>Visits</h2>
        <form class="care-form" id="cpp-visit"><div class="grid tight">
          <label>See them every<select id="cpp-weeks"><option value="">no reminder</option>${[1, 2, 3, 4, 6, 8, 12].map((w) => `<option value="${w}"${v && v.weeks === w ? ' selected' : ''}>${w} week${w === 1 ? '' : 's'}</option>`).join('')}</select></label>
          <label>Last visit<input type="date" id="cpp-last" value="${v ? esc(v.last) : today()}"></label>
          <label>Clinic phone, for the reminder<input type="tel" id="cpp-clinic" value="${esc(link ? link.clinicPhone || '' : '')}"></label></div>
          <div class="row"><button class="btn" type="submit">Save</button>${v ? `<button class="btn primary" type="button" id="cpp-visited">Visited today</button>` : ''}<span id="cpp-vnote" class="care-note">${v ? `Next: ${esc(v.next)}${v.state === 'booked' ? ' (booked)' : v.overdue ? ' — overdue' : ''}` : ''}</span></div>
          ${v ? `<div class="grid tight"><label>A clinic measurement today<input id="cpp-mwhat" placeholder="knee flexion"></label><label>Value<input id="cpp-mval" inputmode="decimal" placeholder="95"></label><label>Unit<input id="cpp-munit" value="°"></label></div>` : ''}
        </form>
      </section>
      <section class="care-panel"><h2>Reminders</h2>
        <form class="care-form" id="cpp-rem"><label class="check"><input type="checkbox" id="cpp-remoff"${link && link.remindersOff ? ' checked' : ''}> No exercise reminders for ${esc(p.name || 'them')} (family reminds them)</label>
        <label>A line in every reminder<input id="cpp-remline" maxlength="120" value="${esc(link ? link.reminderLine || '' : '')}" placeholder="Ice after, Sunita."></label>
        <div class="row"><button class="btn" type="submit">Save</button><span id="cpp-rnote" class="care-note"></span></div></form>
      </section>
      <section class="care-panel"><h2>Notes</h2>
        <form class="care-form" id="cpp-noteform"><textarea id="cpp-ntext" rows="2" maxlength="1000" placeholder="For your own record, or shared with the patient"></textarea>
        <div class="row"><button class="btn" type="submit">Keep</button><label class="check"><input type="checkbox" id="cpp-nshare"> share with ${esc(p.name || 'them')}</label></div></form>
        ${r.notes.map((n) => `<div class="care-reply"><div class="who">${day(n.at)}${n.shared ? ' · shared' : ''}</div>${esc(n.text)}</div>`).join('')}
      </section>
      <section class="care-panel"><h2>Sessions</h2>
        <ul class="care-list">${r.sessions.slice(0, 30).map((s) => `<li><span><span class="name">${esc(moveName(s.move))}</span><span class="sub">${when(s.at)} · ${sessionWords(s)}${s.feel ? ' · ' + esc(feelWords(s.feel)) : ''}${s.reviewed ? ' · reviewed' : ''}</span></span></li>`).join('') || '<li><span class="sub">None yet.</span></li>'}</ul>
      </section>
      <section class="care-panel"><h2>Reviews</h2>
        <ul class="care-list">${r.reviews.map((x) => `<li><span><span class="name">${esc(moveName(x.move))} · ${x.reps.length} rep${x.reps.length === 1 ? '' : 's'}</span><span class="sub">${when(x.sentAt)} · ${x.state}${x.line ? ' · “' + esc(x.line) + '”' : ''}</span></span><a class="btn small" href="#/care/review/${x.id}">${x.state === 'answered' ? 'See' : 'Judge'}</a></li>`).join('') || '<li><span class="sub">Nothing sent yet.</span></li>'}</ul>
      </section>`);
    $('cpp-assign').onsubmit = async (e) => {
      e.preventDefault(); const b = Plans.get($('cpp-bundle').value); if (!b) return;
      try { await api.call('assignPlan', { patientId: id, plan: Plans.clean(b, false), note: $('cpp-anote').value }); note('cpp-note', 'Sent.'); PAGES.patient(id); } catch (e2) { note('cpp-note', fail(e2), true); }
    };
    const mod = $('cpp-modify'); if (mod) mod.onclick = () => {
      const c = Plans.create({ name: plan.plan.name, for: plan.plan.for, blurb: plan.plan.blurb, notes: plan.plan.notes, sources: plan.plan.sources, items: JSON.parse(JSON.stringify(plan.plan.items)) });
      sessionStorage.setItem('ontrack.care.assign', JSON.stringify({ patientId: id, name: p.name || p.phone, planId: c.id }));
      __app.buildPlansHome(); location.hash = '#/plan/' + encodeURIComponent(c.id);
    };
    $('cpp-visit').onsubmit = async (e) => { e.preventDefault(); try { const r2 = await api.call('setVisit', { patientId: id, weeks: Number($('cpp-weeks').value) || 0, last: $('cpp-last').value, clinicPhone: $('cpp-clinic').value }); note('cpp-vnote', r2.visit ? 'Next: ' + r2.visit.next : 'No reminder.'); PAGES.patient(id); } catch (e2) { note('cpp-vnote', fail(e2), true); } };
    const vis = $('cpp-visited'); if (vis) vis.onclick = async () => { try { const m = $('cpp-mwhat').value ? { what: $('cpp-mwhat').value, value: Number($('cpp-mval').value), unit: $('cpp-munit').value } : null; await api.call('markVisited', { patientId: id, date: today(), measurement: m }); PAGES.patient(id); } catch (e2) { note('cpp-vnote', fail(e2), true); } };
    $('cpp-rem').onsubmit = async (e) => { e.preventDefault(); try { await api.call('setPatientReminders', { patientId: id, off: $('cpp-remoff').checked, line: $('cpp-remline').value }); note('cpp-rnote', 'Saved.'); } catch (e2) { note('cpp-rnote', fail(e2), true); } };
    $('cpp-noteform').onsubmit = async (e) => { e.preventDefault(); try { await api.call('addNote', { patientId: id, text: $('cpp-ntext').value, shared: $('cpp-nshare').checked }); PAGES.patient(id); } catch (e2) { alert(fail(e2)); } };
  };
  const sessionWords = (s) => { const sets = s.sets || []; return Moves[s.move] && Moves[s.move].reps ? `${sets.map((x) => x.reps).join(' + ')} reps in ${sets.length} set${sets.length === 1 ? '' : 's'}` : `${sets.reduce((a, x) => a + x.holdSec, 0).toFixed(0)} s in position`; };
  const feelWords = (f) => [f.effort && { easy: 'easy', right: 'about right', hard: 'hard' }[f.effort], f.pain === 'some' ? 'a little pain' : f.pain === 'stop' ? 'stopped for pain' : '', f.note ? '“' + f.note + '”' : ''].filter(Boolean).join(', ');

  /* ---- the queue ---- */
  PAGES.queue = async () => {
    const r = await api.call('queue');
    const row = (x, verb) => `<li><span><span class="name">${esc(x.patient ? x.patient.name || x.patient.phone : '')} · ${esc(moveName(x.move))}</span><span class="sub">${x.reps.length} rep${x.reps.length === 1 ? '' : 's'} · ${when(x.sentAt)}${x.overdue ? ' · <b class="care-err">overdue</b>' : ''}${x.line ? ' · “' + esc(x.line) + '”' : ''}${x.verdicts && x.verdicts.length ? ' · the app: ' + esc(appWords(x)) : ''}</span></span><a class="btn small ${verb === 'Judge' ? 'primary' : ''}" href="#/care/review/${x.id}">${verb}</a></li>`;
    render('Reviews to look at', `<section class="care-panel"><h2>Waiting ${r.queue.length ? `<span class="count">${r.queue.length}</span>` : ''}</h2><ul class="care-list">${r.queue.map((x) => row(x, 'Judge')).join('') || '<li><span class="sub">Nothing waiting. Reviews patients send land here, oldest first.</span></li>'}</ul></section>
      <section class="care-panel"><h2>Answered</h2><ul class="care-list">${r.answered.map((x) => row(x, 'See')).join('') || '<li><span class="sub">None yet.</span></li>'}</ul></section>`);
  };
  const appWords = (x) => { const c = {}; for (const v of x.verdicts || []) for (const f of v.faults || []) c[f] = (c[f] || 0) + 1; const bits = Object.entries(c).map(([f, n]) => `${faultLabel(x.move, f)} ×${n}`); return bits.length ? bits.join(', ') : 'nothing called'; };

  /* ---- a review: the clip with the skeleton over it, the app's calls, the physio's verdict ---- */
  PAGES.review = async (id) => {
    const r = await api.call('review', { id });
    const rv = r.review, mine = !!me && rv.patient && rv.patient.id === me.user.id, judging = isPhysio() && !mine && rv.state !== 'answered';
    const reps = rv.reps.length ? rv.reps : [1];
    render(`${esc(moveName(rv.move))} — ${mine ? 'your review' : esc(rv.patient ? rv.patient.name || rv.patient.phone : '')}`, `
      <section class="panel">
        <p class="muted">${mine ? 'Sent' : esc(rv.patient ? rv.patient.name || '' : '') + ' sent this'} ${when(rv.sentAt)} · ${reps.length === 1 ? 'rep ' + reps[0] : 'reps ' + reps.join(', ')} of set ${rv.setNo}${rv.line ? ' · “' + esc(rv.line) + '”' : ''}</p>
        <div class="care-player" id="cr-player">${rv.clip ? '<video id="cr-video" playsinline controls></video><canvas id="cr-canvas"></canvas>' : '<p class="muted" style="padding:20px;color:#fff">No clip came with this review (the phone could not film).</p>'}</div>
        <div class="care-strip" id="cr-strip" title="where the app called a fault (red), the reps (green)"></div>
        <div class="care-reads" id="cr-reads"></div>
        <div class="row" style="margin-top:6px"><button class="btn small" id="cr-slow" type="button">Half speed</button><button class="btn small" id="cr-skel" type="button" aria-pressed="true">Skeleton on</button><span class="tiny" id="cr-note"></span></div>
        <h2 class="gap">What the app said</h2>
        <ul class="ticks">${(rv.verdicts || []).map((v) => `<li>Rep ${v.rep}: ${v.counted === false ? 'not counted' : 'counted'}${v.faults && v.faults.length ? ' — ' + esc(v.faults.map((f) => faultLabel(rv.move, f)).join(', ')) : ' — nothing called'}${v.holdSec ? ` · held ${v.holdSec} s` : ''}</li>`).join('') || '<li>Nothing recorded per rep.</li>'}</ul>
      </section>
      ${rv.state === 'answered' ? `<section class="care-panel"><h2>${mine ? (rv.physio ? esc(rv.physio.name) + ' says' : 'Your physio says') : 'Your verdict'}</h2>
        <ul class="ticks">${(rv.labels || []).map((l) => `<li>${l.rep == null ? 'The set' : 'Rep ' + l.rep}: ${l.verdict === 'fine' ? 'looks fine' : esc(l.label || faultLabel(rv.move, l.faultId)) + (l.severity && l.severity !== 'clear' ? ' (' + l.severity + ')' : '')}${l.note ? ' — ' + esc(l.note) : ''}</li>`).join('') || '<li>Looked at.</li>'}</ul>
        ${rv.message ? `<p>“${esc(rv.message)}”</p>` : ''}${rv.change ? `<p class="care-ok">The step was changed: ${esc(rv.change.what)}${rv.change.reason ? ' — ' + esc(rv.change.reason) : ''}</p>` : ''}
        <p class="tiny">Answered ${when(rv.answeredAt)}.</p></section>` : ''}
      ${judging ? judgeForm(rv, r.faults, r.newFaults, reps) : ''}
      ${mine && rv.state === 'sent' ? `<p class="row"><button class="btn" id="cr-withdraw" type="button">Take it back</button><span class="tiny">Not opened yet.</span></p>` : ''}
      <p><a class="btn" href="${mine ? '#/care/reviews' : '#/care/queue'}">Back</a></p>`);
    const wd = $('cr-withdraw'); if (wd) wd.onclick = async () => { if (confirm('Take this review back?')) { await api.call('withdraw', { id }); location.hash = '#/care/reviews'; } };
    await player(rv);
    if (judging) wireJudge(rv, reps);
  };
  /* the clip plays; the skeleton from the pose record is drawn over it at the frame the clip is at */
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [27, 31], [29, 31], [24, 26], [26, 28], [28, 30], [28, 32], [30, 32]];
  async function player(rv) {
    const video = $('cr-video'), canvas = $('cr-canvas'), strip = $('cr-strip'), reads = $('cr-reads');
    let record = null;
    try { const f = rv.record ? await api.fileBytes(rv.record) : null; if (f) record = JSON.parse(await inflate(f.bytes, /gzip/.test(f.type) || /\.gz$/.test(rv.record))); } catch (e) { note('cr-note', 'The pose record could not be read: ' + fail(e), true); }
    if (video && rv.clip) { try { video.src = await api.fileUrl(rv.clip); } catch (e) { note('cr-note', 'The clip could not be fetched: ' + fail(e), true); } if (rv.whole && rv.clipFrom) video.addEventListener('loadedmetadata', () => { video.currentTime = rv.clipFrom / 1000; }, { once: true }); }
    if (!record) { if (strip) strip.hidden = true; return; }
    const frames = record.frames || [], t0 = record.clipStartMs || 0, span = Math.max(1, (frames.length ? frames[frames.length - 1].t : t0 + 1000) - t0);
    /* the strip: the reps in green, the app's faults in red */
    let html = '';
    for (const rp of record.reps || []) html += `<s style="left:${((rp.t0 - t0) / span * 100).toFixed(1)}%;width:${((rp.t1 - rp.t0) / span * 100).toFixed(1)}%"></s>`;
    let open = null; for (const f of frames) { const on = f.f && f.f.length; if (on && !open) open = f.t; if (!on && open != null) { html += `<i style="left:${((open - t0) / span * 100).toFixed(1)}%;width:${Math.max(0.4, (f.t - open) / span * 100).toFixed(1)}%"></i>`; open = null; } }
    if (open != null && frames.length) html += `<i style="left:${((open - t0) / span * 100).toFixed(1)}%;width:${Math.max(0.4, (frames[frames.length - 1].t - open) / span * 100).toFixed(1)}%"></i>`;
    strip.innerHTML = html + '<b id="cr-cursor" style="left:0"></b>';
    const bands = record.bands || [];
    let skel = true; $('cr-skel').onclick = (e) => { skel = !skel; e.target.setAttribute('aria-pressed', String(skel)); e.target.textContent = skel ? 'Skeleton on' : 'Skeleton off'; };
    $('cr-slow').onclick = (e) => { if (!video) return; video.playbackRate = video.playbackRate === 1 ? 0.5 : 1; e.target.textContent = video.playbackRate === 1 ? 'Half speed' : 'Full speed'; };
    const frameAt = (t) => { let lo = 0, hi = frames.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (frames[mid].t < t) lo = mid + 1; else hi = mid; } return frames[lo]; };
    const draw = () => {
      if (!video || !canvas) return;
      const t = t0 + (video.currentTime * 1000 - (rv.whole ? rv.clipFrom || 0 : 0)) + (record.clipStartMs != null && !rv.whole ? 0 : 0);
      const f = frameAt(t); const cur = $('cr-cursor'); if (cur) cur.style.left = ((t - t0) / span * 100).toFixed(1) + '%';
      if (f) reads.innerHTML = bands.map((b, i) => `<span>${esc(b.label)} ${f.m && f.m[i] != null ? Math.round(f.m[i]) + '°' : '—'}</span>`).join('') + (f.p ? `<span>${esc(f.p)}</span>` : '') + (f.f && f.f.length ? `<span class="care-err">${esc(f.f.map((x) => faultLabel(rv.move, x)).join(', '))}</span>` : '');
      const W = canvas.width = canvas.clientWidth || 640, H = canvas.height = canvas.clientHeight || 360; const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, W, H);
      if (!skel || !f || !f.lm) return;
      /* the landmarks are shares of the frame the camera gave; the film is that frame */
      const fw = record.w || 16, fh = record.h || 9, sc = Math.min(W / fw, H / fh), ox = (W - fw * sc) / 2, oy = (H - fh * sc) / 2;
      const at = (i) => [ox + f.lm[i * 4] * fw * sc, oy + f.lm[i * 4 + 1] * fh * sc, f.lm[i * 4 + 3]];
      ctx.lineWidth = Math.max(2, W / 200); ctx.lineCap = 'round'; ctx.strokeStyle = f.f && f.f.length ? 'rgba(255,46,136,.85)' : 'rgba(184,245,66,.85)';
      for (const [a, b] of BONES) { const p = at(a), q = at(b); if (p[2] < 0.5 || q[2] < 0.5) continue; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
      ctx.fillStyle = '#fff'; for (let i = 11; i < 33; i++) { const p = at(i); if (p[2] < 0.5) continue; ctx.beginPath(); ctx.arc(p[0], p[1], ctx.lineWidth, 0, Math.PI * 2); ctx.fill(); }
    };
    if (video) { video.addEventListener('timeupdate', draw); video.addEventListener('seeked', draw); video.addEventListener('loadeddata', draw); let raf = 0; const loop = () => { if (!video.paused && !video.ended) draw(); raf = requestAnimationFrame(loop); }; loop(); video.addEventListener('emptied', () => cancelAnimationFrame(raf)); }
  }
  async function inflate(bytes, gz) {
    if (!gz) return new TextDecoder().decode(bytes);
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unzip');
    const ds = new DecompressionStream('gzip'); const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Response(ds.readable).text();
  }
  function judgeForm(rv, faults, newFaults, reps) {
    const one = (rep) => `<div class="care-judge" data-rep="${rep == null ? '' : rep}"><b>${rep == null ? 'The set' : 'Rep ' + rep}</b>
      <div class="seg" role="radiogroup"><button class="btn small" type="button" data-v="fine" aria-pressed="true">Looks fine</button><button class="btn small" type="button" data-v="fault" aria-pressed="false">A fault the app knows</button><button class="btn small" type="button" data-v="new" aria-pressed="false">Something else</button></div>
      <div class="j-fault" hidden>${faults.map((f) => `<label class="check"><input type="checkbox" value="${esc(f.id)}"> ${esc(f.label)}</label>`).join('')}</div>
      <div class="j-new care-form" hidden><label>Name it<input class="j-name" maxlength="80" list="j-known" placeholder="Hip hiking"></label><datalist id="j-known">${newFaults.map((f) => `<option value="${esc(f.label)}">`).join('')}</datalist><label>What you see<input class="j-desc" maxlength="400" placeholder="the pelvis lifts with the leg"></label><label>Where<input class="j-part" maxlength="40" placeholder="hip"></label></div>
      <div class="seg j-sev" hidden><span class="tiny">How much:</span><button class="btn small" type="button" data-s="slight" aria-pressed="false">slight</button><button class="btn small" type="button" data-s="clear" aria-pressed="true">clear</button><button class="btn small" type="button" data-s="stop" aria-pressed="false">stop doing it</button></div></div>`;
    const m = Moves[rv.move];
    return `<section class="care-panel"><h2>Your verdict</h2>
      <p class="tiny"><label class="check"><input type="checkbox" id="j-whole"> One verdict for the whole set</label></p>
      <div id="j-reps">${reps.map((rp) => one(rp)).join('')}</div><div id="j-set" hidden>${one(null)}</div>
      <form class="care-form" id="j-form"><label>A message to ${esc(rv.patient ? rv.patient.name || 'them' : 'them')}<textarea id="j-msg" rows="2" maxlength="1000" placeholder="Good. Keep the hip down on the way up."></textarea></label>
        <details><summary class="tiny">Change this step of the plan</summary><div class="grid tight">
          ${m && m.reps && m.spec && m.spec.progress ? '<label>Range of motion, %<input id="j-rom" inputmode="numeric" placeholder="100"></label>' : ''}
          <label>Sets<input id="j-sets" inputmode="numeric" placeholder="as is"></label>${m && m.reps ? '<label>Reps<input id="j-reps-n" inputmode="numeric" placeholder="as is"></label>' : ''}<label>Hold, s<input id="j-hold" inputmode="numeric" placeholder="as is"></label>
          <label class="wide">Faults to leave alone<select id="j-ignore" multiple size="3">${faults.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</select></label>
          <label class="wide">A note on the step<input id="j-snote" maxlength="200"></label><label class="wide">Why (the patient sees this)<input id="j-why" maxlength="300"></label></div></details>
        <div class="row"><button class="btn primary" type="submit">Send</button><span id="j-note" class="care-note"></span></div></form></section>`;
  }
  function wireJudge(rv, reps) {
    const whole = $('j-whole'); whole.onchange = () => { $('j-reps').hidden = whole.checked; $('j-set').hidden = !whole.checked; };
    sec.querySelectorAll('.care-judge').forEach((j) => {
      j.querySelectorAll('.seg[role=radiogroup] .btn').forEach((b) => { b.onclick = () => { j.querySelectorAll('.seg[role=radiogroup] .btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); j.querySelector('.j-fault').hidden = b.dataset.v !== 'fault'; j.querySelector('.j-new').hidden = b.dataset.v !== 'new'; j.querySelector('.j-sev').hidden = b.dataset.v === 'fine'; }; });
      j.querySelectorAll('.j-sev .btn').forEach((b) => { b.onclick = () => j.querySelectorAll('.j-sev .btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
    });
    $('j-form').onsubmit = async (e) => {
      e.preventDefault();
      const labels = [];
      const blocks = whole.checked ? [$('j-set').querySelector('.care-judge')] : [...$('j-reps').querySelectorAll('.care-judge')];
      for (const j of blocks) {
        const rep = j.dataset.rep === '' ? null : Number(j.dataset.rep);
        const v = j.querySelector('.seg[role=radiogroup] .btn[aria-pressed=true]').dataset.v;
        const sev = (j.querySelector('.j-sev .btn[aria-pressed=true]') || {}).dataset ? j.querySelector('.j-sev .btn[aria-pressed=true]').dataset.s : 'clear';
        if (v === 'fine') labels.push({ rep, verdict: 'fine' });
        else if (v === 'fault') { const ids = [...j.querySelectorAll('.j-fault input:checked')].map((i) => i.value); if (!ids.length) { note('j-note', `Pick the fault for ${rep == null ? 'the set' : 'rep ' + rep}.`, true); return; } for (const fid of ids) labels.push({ rep, verdict: 'fault', faultId: fid, severity: sev }); }
        else { const name = j.querySelector('.j-name').value.trim(); if (!name) { note('j-note', `Name what you see on ${rep == null ? 'the set' : 'rep ' + rep}.`, true); return; } labels.push({ rep, verdict: 'new', newFault: { name, desc: j.querySelector('.j-desc').value, part: j.querySelector('.j-part').value }, severity: sev }); }
      }
      const num = (id) => { const el = $(id); if (!el || el.value === '') return undefined; const n = Number(el.value); return Number.isFinite(n) ? n : undefined; };
      const change = {}; if (num('j-rom') != null) change.rom = num('j-rom'); if (num('j-sets') != null) change.sets = num('j-sets'); if (num('j-reps-n') != null) change.reps = num('j-reps-n'); if (num('j-hold') != null) change.hold = num('j-hold');
      const ign = $('j-ignore') ? [...$('j-ignore').selectedOptions].map((o) => o.value) : []; if (ign.length) change.ignore = ign;
      if ($('j-snote').value.trim()) change.note = $('j-snote').value.trim(); if ($('j-why').value.trim()) change.reason = $('j-why').value.trim();
      note('j-note', 'Sending…');
      try { await api.call('judge', { id: rv.id, labels, message: $('j-msg').value, change: Object.keys(change).length ? change : null }); location.hash = '#/care/queue'; }
      catch (e2) { note('j-note', fail(e2), true); }
    };
  }

  /* ---- the patient's own lists ---- */
  PAGES.reviews = async () => {
    const r = await api.call('myReviews'); await refresh();
    render('My reviews', `<section class="care-panel"><h2>Sent to your ${PHYSIO_WORD}</h2><ul class="care-list">${r.reviews.map((x) => `<li><span><span class="name">${esc(moveName(x.move))} · ${x.reps.length} rep${x.reps.length === 1 ? '' : 's'}</span><span class="sub">${when(x.sentAt)} · ${x.state === 'answered' ? esc(verdictWords(x)) : x.state === 'opened' ? 'being looked at' : 'waiting'}</span></span><a class="btn small" href="#/care/review/${x.id}">${x.state === 'answered' ? 'See' : 'Open'}</a></li>`).join('') || '<li><span class="sub">Nothing sent yet. After a set, tick a rep and tap Review with my physio.</span></li>'}</ul></section><p><a class="btn" href="#/care">Back</a></p>`);
  };
  PAGES.history = async () => {
    const r = await api.call('sessions', { limit: 100 });
    render('History', `<section class="care-panel"><h2>Your sessions</h2><p class="tiny">${weekBar(r.sessions)}</p><ul class="care-list">${r.sessions.map((s) => `<li><span><span class="name">${esc(moveName(s.move))}</span><span class="sub">${when(s.at)} · ${sessionWords(s)}${s.feel ? ' · ' + esc(feelWords(s.feel)) : ''}${s.reviewed ? ' · sent for review' : ''}</span></span></li>`).join('') || '<li><span class="sub">No sessions yet.</span></li>'}</ul></section><p><a class="btn" href="#/care">Back</a></p>`);
  };
  PAGES.plan = () => { if (me.plan) location.hash = '#/plan/' + encodeURIComponent(me.plan.plan.id); else location.hash = '#/care'; };

  /* ---- reminders ---- */
  PAGES.reminders = () => {
    const r = me.reminders || {};
    render('Reminders', `<section class="care-panel"><h2>A reminder to do the exercises</h2>
      <form class="care-form" id="care-rem">
        <label class="check"><input type="checkbox" id="rm-on"${r.on ? ' checked' : ''}> Remind me</label>
        <label>At<input type="time" id="rm-time" value="${esc(r.time || '19:00')}"></label>
        <div class="seg" id="rm-days">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label class="check"><input type="checkbox" value="${i}"${(r.days || []).includes(i) ? ' checked' : ''}> ${d}</label>`).join('')}</div>
        <label>How<select id="rm-chan"><option value="auto"${r.channel === 'auto' ? ' selected' : ''}>Whichever reaches you (app, WhatsApp, SMS)</option><option value="push"${r.channel === 'push' ? ' selected' : ''}>This app only</option><option value="whatsapp"${r.channel === 'whatsapp' ? ' selected' : ''}>WhatsApp</option><option value="sms"${r.channel === 'sms' ? ' selected' : ''}>SMS</option></select></label>
        <div class="row"><button class="btn primary" type="submit">Save</button>${'Notification' in window ? '<button class="btn" type="button" id="rm-push">Allow notifications on this phone</button>' : ''}<span id="rm-note" class="care-note"></span></div>
        <p class="tiny">Nothing between 10 pm and 7 am. No reminder on a day you have already done a session. ${api.local ? 'In this sandbox reminders are worked out when the page opens and listed under My data.' : ''}</p>
      </form></section><p><a class="btn" href="#/care">Back</a></p>`);
    $('care-rem').onsubmit = async (e) => { e.preventDefault(); try { await api.call('setReminders', { on: $('rm-on').checked, time: $('rm-time').value, days: [...sec.querySelectorAll('#rm-days input:checked')].map((i) => Number(i.value)), channel: $('rm-chan').value }); await refresh(); note('rm-note', 'Saved.'); } catch (e2) { note('rm-note', fail(e2), true); } };
    const pb = $('rm-push'); if (pb) pb.onclick = async () => { try { const p = await Notification.requestPermission(); note('rm-note', p === 'granted' ? 'Allowed. (Push arrives with the installed app; until then WhatsApp or SMS.)' : 'Not allowed.'); if (p === 'granted') await api.call('setPush', { subscription: { kind: 'notification-permission', ua: navigator.userAgent.slice(0, 80) } }); } catch (e2) { note('rm-note', fail(e2), true); } };
  };

  /* ---- my data ---- */
  PAGES.data = async () => {
    const [au, dv] = await Promise.all([api.call('myAudit'), api.call('devices')]);
    let outbox = null; if (api.mode === 'local') { try { outbox = (api.store.data.outbox || []).slice(-20).reverse(); } catch { } }
    render('My data', `<section class="care-panel"><h2>What is kept, and who did what</h2>
      <p class="muted">Everything about you, as a file: your profile, consents, links, plans, sessions, reviews (the clips are listed and fetched separately), notes shared with you, reports, and this log.</p>
      <div class="row"><button class="btn" id="md-export" type="button">Download everything</button><a class="btn" href="#/care/notice">The privacy notice</a></div>
      <h2 class="gap">Consents</h2>
      <label class="check"><input type="checkbox" id="md-research"${me.consents.research ? ' checked' : ''}> The app may keep the skeleton of my reviewed reps, without my name, to get better at spotting faults</label>
      <p class="tiny">Untick it and those records leave the training set within a day.</p>
      <h2 class="gap">Links</h2><ul class="care-list">${me.links.filter((l) => l.state !== 'ended').map((l) => `<li><span><span class="name">${esc(l.physio && l.physio.id !== me.user.id ? l.physio.name : l.patient ? l.patient.name || l.patient.phone : '')}</span><span class="sub">${l.state}${l.acceptedAt ? ' since ' + day(l.acceptedAt) : ''}</span></span><button class="btn small" data-end="${l.id}" type="button">End the link</button></li>`).join('') || '<li><span class="sub">No links.</span></li>'}</ul>
      <h2 class="gap">Signed in on</h2><ul class="care-list">${dv.map((d) => `<li><span><span class="sub">${esc(d.device || 'a device')} · since ${day(d.since)} · last ${day(d.last)}</span></span></li>`).join('')}</ul><p><button class="btn small" id="md-signout-all" type="button">Sign out everywhere</button></p>
      <h2 class="gap">The log</h2><ul class="care-list">${au.audit.map((x) => `<li><span><span class="sub">${when(x.at)} · ${esc(x.whoName || (x.who === me.user.id ? 'you' : ''))} · ${esc(x.what)}</span></span></li>`).join('') || '<li><span class="sub">Nothing yet.</span></li>'}</ul>
      ${outbox ? `<h2 class="gap">Messages this sandbox would have sent</h2><ul class="care-list">${outbox.map((m) => `<li><span><span class="sub">${when(m.at)} · ${esc(m.channel)} to ${esc(m.to)} · ${esc(m.text)}</span></span></li>`).join('') || '<li><span class="sub">None.</span></li>'}</ul>` : ''}
      </section>
      <section class="panel"><h2>Delete my account</h2><p class="muted">Everything above goes, the clips at once. If you ticked the research box, the skeleton records stay without your name; untick it first if you want them gone too.</p><button class="btn stop" id="md-delete" type="button">Delete my account</button></section>
      <p><a class="btn" href="#/care">Back</a></p>`);
    $('md-export').onclick = async () => { const ex = await api.call('exportData'); const blob = new Blob([JSON.stringify(ex, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ontrack-my-data.json'; a.click(); };
    $('md-research').onchange = async (e) => { await api.call('consent', { purpose: 'research', on: e.target.checked }); await refresh(); };
    sec.querySelectorAll('[data-end]').forEach((b) => { b.onclick = async () => { if (confirm('End this link? They keep what was shared while it stood, and get nothing new.')) { await api.call('endLink', { linkId: b.dataset.end }); await refresh(); PAGES.data(); } }; });
    $('md-signout-all').onclick = async () => { await api.call('signOutAll'); api.token = null; me = null; applyPlan(); location.hash = '#/'; };
    $('md-delete').onclick = async () => { if (confirm('Delete your account and everything in it? This cannot be undone.') && confirm('Really delete?')) { await api.call('deleteAccount'); api.token = null; me = null; applyPlan(); location.hash = '#/'; } };
  };

  /* ---- admin ---- */
  PAGES.admin = async (tab) => {
    tab = tab || 'stats';
    const tabs = ['stats', 'users', 'reports', 'outbox', 'alarms'].map((t) => `<a href="#/care/admin/${t}" class="${t === tab ? 'on' : ''}">${t}</a>`).join('');
    let body = '';
    if (tab === 'stats') { const s = await api.call('stats'); body = Object.entries(s).map(([k, v]) => `<span class="care-stat">${v}<small>${esc(k)}</small></span>`).join('') + `<p class="row"><button class="btn small" id="ad-export" type="button">Download the training record</button><button class="btn small" id="ad-tick" type="button">Run the reminders now</button><button class="btn small" id="ad-night" type="button">Run the night's housekeeping</button><span id="ad-note" class="care-note"></span></p>`; }
    if (tab === 'users') { const r = await api.call('users'); body = `<ul class="care-list">${r.users.map((u) => `<li><span><span class="name">${esc(u.name || u.phone)}</span><span class="sub">${esc(u.phone)} · ${u.role}${u.invited ? ' · invited, not signed in' : ''}${u.physioRequest ? ` · <b>asks to be a physio</b>: ${esc(u.physioRequest.registration)} at ${esc(u.physioRequest.clinic)}` : ''}</span></span><span class="row"><select data-role="${u.id}"><option value="patient"${u.role === 'patient' ? ' selected' : ''}>patient</option><option value="physio"${u.role === 'physio' ? ' selected' : ''}>physio</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>admin</option></select></span></li>`).join('')}</ul>`; }
    if (tab === 'reports') { const r = await api.call('reports'); body = `<ul class="care-list">${r.reports.map((x) => `<li><span><span class="name">${esc(x.kind)} · ${esc(x.who ? x.who.name || x.who.phone : '(deleted)')}</span><span class="sub">${when(x.at)} · ${esc(x.screen)} · ${esc(x.device)} · v${esc(x.appV)}<br>${esc(x.text)}${x.log && x.log.length ? `<details><summary>log</summary><div class="care-pre">${esc(x.log.join('\n'))}</div></details>` : ''}${x.reply ? `<br><b>you:</b> ${esc(x.reply)}` : ''}</span></span>${!x.reply && x.who ? `<button class="btn small" data-reply="${x.id}" type="button">Reply</button>` : ''}</li>`).join('') || '<li><span class="sub">None.</span></li>'}</ul>`; }
    if (tab === 'outbox') { const r = await api.call('outbox'); body = `<ul class="care-list">${r.outbox.map((m) => `<li><span><span class="sub">${when(m.at)} · ${esc(m.kind)} · ${esc(m.channel)} → ${esc(m.to)}<br>${esc(m.text)}</span></span></li>`).join('') || '<li><span class="sub">Nothing sent.</span></li>'}</ul>`; }
    if (tab === 'alarms') { const r = await api.call('falseAlarms'); body = r.exercises.map((e) => `<h2 class="gap">${esc(moveName(e.exercise))} <span class="tiny">${e.reps} reps judged</span></h2><ul class="ticks">${e.faults.map((f) => `<li>${esc(f.label)}: called and fine <b>${f.falseAlarm}</b>, confirmed ${f.confirmed}, missed ${f.missed}</li>`).join('') || '<li>no faults called</li>'}</ul>`).join('') || '<p class="muted">No reviews judged yet.</p>'; }
    render('Admin', `<section class="care-panel"><div class="care-tabs">${tabs}</div>${body}</section><p><a class="btn" href="#/care">Back</a></p>`);
    sec.querySelectorAll('[data-role]').forEach((s) => { s.onchange = async () => { try { await api.call('setRole', { userId: s.dataset.role, role: s.value }); } catch (e) { alert(fail(e)); } }; });
    sec.querySelectorAll('[data-reply]').forEach((b) => { b.onclick = async () => { const t = prompt('Your reply:'); if (t) { await api.call('replyReport', { id: b.dataset.reply, text: t }); PAGES.admin('reports'); } }; });
    const ex = $('ad-export'); if (ex) ex.onclick = async () => { const r = await api.call('trainingExport'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.rows.map((x) => JSON.stringify(x)).join('\n')], { type: 'application/x-ndjson' })); a.download = 'ontrack-training.jsonl'; a.click(); };
    const tk = $('ad-tick'); if (tk) tk.onclick = async () => { const r = await api.call('tick'); note('ad-note', `${r.sent.length} sent`); };
    const ng = $('ad-night'); if (ng) ng.onclick = async () => { const r = await api.call('nightly'); note('ad-note', JSON.stringify(r)); };
  };

  /* ---------- the sheet: something is wrong, from any screen ---------- */
  const sheet = h(`<div class="modal care-sheet" id="care-sheet" hidden><div class="modal-in" role="dialog" aria-modal="true" aria-labelledby="cs-title"><button class="iconbtn close" id="cs-close" aria-label="Close">✕</button><h2 id="cs-title">Something is wrong?</h2>
    <form class="care-form" id="cs-form"><label>What happened<textarea id="cs-text" rows="3" maxlength="2000" placeholder="It kept saying I was out of the picture, with the phone on the floor two metres away." required></textarea></label>
    <p class="tiny">We attach the phone and browser, the app version, the exercise and the last minute of what the coach said and measured — never the camera.</p>
    <div class="row"><button class="btn primary" type="submit">Send</button><button class="btn" type="button" id="cs-wrong">The app called the wrong fault</button><span id="cs-note" class="care-note"></span></div></form></div></div>`);
  document.body.appendChild(sheet);
  const openSheet = (on) => { sheet.hidden = !on; if (on) $('cs-text').focus(); };
  rep.onclick = () => openSheet(true); $('cs-close').onclick = () => openSheet(false); sheet.onclick = (e) => { if (e.target === sheet) openSheet(false); };
  const LOG = [];   // the last minute of cues and readings, for a report
  const logLine = (s) => { LOG.push(`${new Date().toISOString().slice(11, 19)} ${s}`); if (LOG.length > 80) LOG.shift(); };
  const sendReport = async (kind, text) => {
    const screen = (location.hash || '#/').slice(1);
    return api.later('report', { kind, screen, text, device: device(), appV: Core.VER, spec: __app.move ? Core.stampOf(__app.move) : '', sessionId: current.sessionId || '', log: LOG.slice(-60) });
  };
  $('cs-form').onsubmit = async (e) => { e.preventDefault(); note('cs-note', 'Sending…'); try { await sendReport('problem', $('cs-text').value); note('cs-note', 'Thanks, we read every one.'); $('cs-text').value = ''; setTimeout(() => openSheet(false), 1200); } catch (e2) { note('cs-note', fail(e2), true); } };
  $('cs-wrong').onclick = async () => { note('cs-note', 'Sending…'); try { await sendReport('wrongFault', $('cs-text').value || 'the app called the wrong fault'); note('cs-note', 'Noted. Send the rep for review from the end of the set and your physio can say what it was.'); } catch (e2) { note('cs-note', fail(e2), true); } };

  /* ---------- the pose record, kept while a set runs ---------- */
  const current = { sessionId: null, record: null, saved: false };
  /* every measurement the exercise makes, by the name the reading carries it under (not only the ones with a readout card) */
  const measuresOf = (m) => (m && m.spec && Array.isArray(m.spec.measurements) ? m.spec.measurements.map((x) => ({ key: x.of || x.key, label: x.label || x.key })) : (m ? m.bands.map((b) => ({ key: b.key, label: b.label })) : []));
  const newRecord = () => ({ move: __app.move ? __app.move.id : '', sets: {}, bands: measuresOf(__app.move) });
  let lastPhase = {}, lastReps = {};
  window.__careFrame = function (lm, reading, out, t, setNo) {
    if (!current.record) current.record = newRecord();
    const R = current.record; const S = R.sets[setNo] || (R.sets[setNo] = { frames: [], reps: [], open: null, attempts: 0 });
    const faults = out && out.verdict && out.verdict.faults ? Object.keys(out.verdict.faults) : [];
    const f = { t: Math.round(t), p: out && out.between ? 'between' : (out && out.phase) || (out && out.holding ? 'hold' : ''), h: !!(out && out.holding), f: faults, m: R.bands.map((b) => (reading && typeof reading[b.key] === 'number' ? Math.round(reading[b.key] * 10) / 10 : null)) };
    if (lm && lm.length === 33) { const a = new Array(132); for (let i = 0; i < 33; i++) { const p = lm[i]; a[i * 4] = Math.round(p.x * 1000) / 1000; a[i * 4 + 1] = Math.round(p.y * 1000) / 1000; a[i * 4 + 2] = Math.round((p.z || 0) * 1000) / 1000; a[i * 4 + 3] = Math.round((p.visibility == null ? 1 : p.visibility) * 100) / 100; } f.lm = a; }
    /* at most twenty frames a second kept: enough to draw, a quarter of the size */
    const last = S.frames[S.frames.length - 1];
    if (!last || f.t - last.t >= 50 || (out && out.cue)) S.frames.push(f);
    if (out && out.cue) logLine(`set ${setNo} ${(t / 1000).toFixed(1)}s cue ${out.cue.id}: ${out.cue.text}`);
    /* the reps: from the phase, as the coach runs it */
    const phase = out && !out.between ? out.phase : null, prev = lastPhase[setNo];
    const move = __app.move;
    if (move && move.reps) {
      if (prev && prev !== 'up' && phase === 'up') { S.open = { set: setNo, t0: Math.round(t), faults: new Set(), peak: null }; S.attempts += 1; }
      if (S.open) { for (const x of faults) S.open.faults.add(x); if (out && out.cue && move.faults.includes(out.cue.id)) S.open.faults.add(out.cue.id); const prog = move.spec && move.spec.progress && reading ? reading[move.spec.progress.measure] : null; if (typeof prog === 'number') S.open.peak = S.open.peak == null ? prog : Math.max(S.open.peak, prog); }
      const reps = out && !out.between ? out.reps : lastReps[setNo];
      if (S.open && prev === 'lower' && (phase === 'down' || phase === 'done')) { S.reps.push({ set: setNo, n: reps, counted: true, t0: S.open.t0, t1: Math.round(t), faults: [...S.open.faults], peak: S.open.peak }); S.open = null; }
      else if (S.open && prev === 'up' && phase === 'down') { S.reps.push({ set: setNo, n: null, counted: false, t0: S.open.t0, t1: Math.round(t), faults: [...S.open.faults], peak: S.open.peak }); S.open = null; }
      if (out && !out.between) lastReps[setNo] = out.reps;
    } else if (out && !out.between) {
      /* a hold: one item for the set, the faults as they came */
      S.hold = S.hold || { set: setNo, n: 1, counted: true, hold: true, t0: 0, t1: 0, faults: new Set(), holdMs: 0 };
      S.hold.t1 = Math.round(t); for (const x of faults) S.hold.faults.add(x); if (out.holding) S.hold.holdMs += 50;
    }
    if (phase != null) lastPhase[setNo] = phase;
  };
  /* the reps of the record, and a held set as one item with the seconds the coach counted */
  const repsOf = (R) => { const out = []; const sets = (__app.session && __app.session.sets) || []; for (const k of Object.keys(R.sets)) { const S = R.sets[k]; if (S.hold) { const sm = sets[Number(k) - 1]; out.push(Object.assign({}, S.hold, { faults: [...S.hold.faults], holdSec: sm ? sm.holdSec : Math.round(S.hold.holdMs / 100) / 10 })); } for (const r of S.reps) out.push(r); } return out; };

  /* ---------- after a session: save it, and the review panel ---------- */
  function sessionPayload(feel) {
    const s = __app.session, m = __app.move, pc = __app.planCtx; const plan = pc && pc.plan && pc.plan.assigned ? pc.plan : null;
    const reps = current.record ? repsOf(current.record).map((r) => ({ set: r.set, n: r.n, counted: r.counted, t0: r.t0, t1: r.t1, faults: r.faults, peak: r.peak })) : [];
    return { id: current.sessionId, at: Date.now(), move: m.id, planId: plan ? plan.id : null, planV: plan ? plan.v : null, step: plan ? pc.i : null,
      sets: s.sets.map((x) => ({ reps: x.reps, repTarget: x.repTarget, holdSec: x.holdSec, bestSec: x.bestSec, targetSec: x.targetSec, reachedTarget: x.reachedTarget, cues: x.cues })), feel: feel || undefined, reps, appV: Core.VER, device: device(), spec: Core.stampOf(m) };
  }
  async function onDone() {
    if (!me) return;
    if (!current.sessionId) current.sessionId = randomId();
    try { await api.later('saveSession', sessionPayload(null)); current.saved = true; } catch (e) { logLine('session not saved: ' + fail(e)); }
    donePanel();
  }
  $('feel-save').addEventListener('click', async () => { if (!me || !current.sessionId) return; try { await api.later('saveSession', sessionPayload(__app.feel)); } catch { } });
  function donePanel() {
    const old = $('care-done'); if (old) old.remove();
    const R = current.record, m = __app.move, physios = linkedPhysios();
    const reps = R ? repsOf(R) : [];
    const panel = h(`<section class="panel" id="care-done"><h2>Review with my ${PHYSIO_WORD}</h2>
      ${physios.length ? `<p class="muted">Tick what ${esc(physios[0].physio.name || 'your physio')} should look at. The clip of those reps and the skeleton go with it; nothing else does.</p>
      <ul class="care-reps">${reps.map((r, i) => `<li><input type="checkbox" id="cd-rep-${i}" data-i="${i}"><label class="what" for="cd-rep-${i}"><b>${r.hold ? 'The hold' : r.n != null ? `Rep ${r.n}` : 'An attempt'}${reps.length > 1 && Object.keys(R.sets).length > 1 ? ` (set ${r.set})` : ''}${r.holdSec != null ? ` · held ${r.holdSec} s` : ''}${!r.counted ? ' · not counted' : ''}</b>${r.faults.length ? `<span class="faults">${esc(r.faults.map((f) => faultLabel(m.id, f)).join(', '))}</span>` : '<span class="ok">nothing called</span>'}</label></li>`).join('') || '<li><span class="what">No reps were recorded in this session.</span></li>'}</ul>
      <div class="row"><button class="btn small" id="cd-all" type="button">All</button><button class="btn small" id="cd-flagged" type="button">Only the ones with a fault</button></div>
      <textarea id="cd-line" rows="2" maxlength="500" placeholder="Anything to say — where it hurt, what felt odd"></textarea>
      <div class="row"><button class="btn primary" id="cd-send" type="button">Review with my ${PHYSIO_WORD}</button><span id="cd-note" class="care-note"></span></div>`
      : `<p class="muted">When a ${PHYSIO_WORD} has added you, a rep can be sent to them from here. ${current.saved ? 'This session is saved to your history.' : ''}</p>`}
      <h2 class="gap">Was the coaching right?</h2><div class="row"><button class="btn small" id="cd-up" type="button">👍 Yes</button><button class="btn small" id="cd-down" type="button">👎 No</button><input id="cd-thumb-line" maxlength="300" placeholder="what was off" style="flex:1;min-width:120px"><span id="cd-tnote" class="care-note"></span></div>
    </section>`);
    const watch = $('watch-panel'); watch.parentNode.insertBefore(panel, watch.nextSibling);
    const boxes = () => [...panel.querySelectorAll('.care-reps input')];
    const all = $('cd-all'); if (all) { all.onclick = () => boxes().forEach((b) => { b.checked = true; }); $('cd-flagged').onclick = () => boxes().forEach((b) => { b.checked = reps[Number(b.dataset.i)].faults.length > 0; }); }
    const thumbs = async (up) => { note('cd-tnote', '…'); try { await api.later('thumbs', { sessionId: current.sessionId, up, line: $('cd-thumb-line').value }); note('cd-tnote', 'Thanks.'); } catch (e) { note('cd-tnote', fail(e), true); } };
    $('cd-up').onclick = () => thumbs(true); $('cd-down').onclick = () => thumbs(false);
    const send = $('cd-send'); if (send) send.onclick = async () => {
      const picked = boxes().filter((b) => b.checked).map((b) => reps[Number(b.dataset.i)]);
      if (!picked.length) { note('cd-note', 'Tick a rep first.', true); return; }
      send.disabled = true; note('cd-note', 'Making the clip…');
      try {
        const { clip, record, clipFrom, whole } = await clipFor(picked);
        /* a browser without its own encoder can only offer the whole film; past a size it is not sent */
        if (clip && clip.size > 25e6) { note('cd-note', `The film is ${(clip.size / 1e6).toFixed(0)} MB, too big to send from this browser; the skeleton goes without it.`); }
        note('cd-note', 'Sending…');
        const r = await api.call('sendReview', { sessionId: current.sessionId, setNo: picked[0].set, reps: picked.map((x) => x.n == null ? 0 : x.n), line: $('cd-line').value, verdicts: picked.map((x) => ({ rep: x.n == null ? 0 : x.n, counted: x.counted, faults: x.faults, peak: x.peak, holdSec: x.holdSec })),
          clip: clip && clip.size <= 25e6 ? { b64: await b64(clip), type: clip.type } : null, record: record ? { b64: await b64(record), type: record.type } : null, specHash: Core.stampOf(m), appV: Core.VER, device: device(), clipFrom, whole });
        note('cd-note', `Sent to ${r.reviews.map((x) => x.physio.name || 'your physio').join(', ')}. The reply shows under Reviews.`);
        boxes().forEach((b) => { b.disabled = true; });
      } catch (e) { note('cd-note', fail(e), true); send.disabled = false; }
    };
  }
  const b64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  /* the clip: the ticked reps plus a second either side, cut from the session's film without
     re-encoding where the page encoded it itself (every two seconds is a keyframe); where the
     browser's recorder made the film, the whole film goes with the time to seek to */
  async function clipFor(picked) {
    const rec = __app.rec, R = current.record, meta = __app.session.meta;
    const setNo = picked[0].set, inSet = picked.filter((p) => p.set === setNo);
    const t0 = Math.max(0, Math.min(...inSet.map((p) => p.t0)) - 1000), t1 = Math.max(...inSet.map((p) => p.t1)) + 1000;
    /* the record of those moments */
    const S = R && R.sets[setNo]; const frames = S ? S.frames.filter((f) => f.t >= t0 && f.t <= t1) : [];
    const cam = $('cam'); const W = cam && cam.videoWidth ? cam.videoWidth : 16, H = cam && cam.videoHeight ? cam.videoHeight : 9;
    const recordObj = { v: 1, move: R ? R.move : __app.move.id, specHash: Core.stampOf(__app.move), appV: Core.VER, w: W, h: H, bands: R ? R.bands : [], setNo, clipStartMs: t0, frames, reps: inSet.map((p) => ({ n: p.n, t0: p.t0, t1: p.t1, counted: p.counted, faults: p.faults })) };
    let record = new Blob([JSON.stringify(recordObj)], { type: 'application/json' });
    if (typeof CompressionStream !== 'undefined') { try { const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(JSON.stringify(recordObj))); w.close(); record = new Blob([await new Response(cs.readable).arrayBuffer()], { type: 'application/gzip' }); } catch { } }
    if (!rec || !rec.blob) return { clip: null, record, clipFrom: 0, whole: false };
    const m = meta && meta[setNo - 1]; const offset = m && rec.startAt ? m.t0Abs - rec.startAt : 0;
    if (rec.kind === 'codec' && rec.video && rec.video.samples && rec.video.samples.length) {
      const us0 = (offset + t0) * 1000, us1 = (offset + t1) * 1000, S2 = rec.video.samples;
      let i0 = 0; for (let i = 0; i < S2.length; i++) { if (S2[i].ts <= us0 && S2[i].key) i0 = i; if (S2[i].ts > us0) break; }
      let i1 = S2.length - 1; for (let i = i0; i < S2.length; i++) { if (S2[i].ts > us1) { i1 = i; break; } }
      const base = S2[i0].ts; const samples = S2.slice(i0, i1 + 1).map((s) => ({ data: s.data, ts: s.ts - base, key: s.key }));
      try { const file = Mp4.write({ width: rec.video.width, height: rec.video.height, codec: rec.video.codec, description: rec.video.description, codecString: rec.video.codecString, samples, created: new Date(), audio: null }); return { clip: new Blob([file], { type: 'video/mp4' }), record, clipFrom: Math.round(base / 1000 - offset), whole: false }; }
      catch (e) { logLine('clip not cut: ' + fail(e)); }
    }
    return { clip: rec.blob, record, clipFrom: Math.round(offset + t0), whole: true };
  }

  /* ---------- the app's own screens, with the layer's additions ---------- */
  let wasLive = false;
  function afterApp(hsh) {
    if (hsh === '#/live') { if (!wasLive) { current.sessionId = null; current.record = null; current.saved = false; lastPhase = {}; lastReps = {}; } wasLive = true; }
    else if (wasLive && hsh !== '#/done') wasLive = false;
    if (hsh === '#/done') { wasLive = false; onDone(); }
    if (hsh === '#/' || hsh === '') homePanel();
    if (/^#\/plan\//.test(hsh)) planPage();
    if (/^#\/ex\//.test(hsh) || /^#\/plan\/[^/]+\/\d+$/.test(hsh)) stepPage();
  }
  function homePanel() {
    const old = $('care-home'); if (old) old.remove();
    const host = $('plans-home'); if (!host) return;
    let html;
    if (!me) html = `<section class="care-panel" id="care-home"><h2>OnTrack Care</h2><p class="muted">Your physio's exercises on your phone, coached by the camera; a rep sent to them for review, answered here. Sign in with your phone number.</p><p class="row"><a class="btn primary" href="#/care/signin">Sign in</a><a class="btn" href="#/care/notice">What is kept</a></p></section>`;
    else if (isPhysio()) html = `<section class="care-panel" id="care-home"><h2>${esc(me.user.name || 'Physio')}</h2><p class="muted">Your patients, the reviews waiting for you, and who is due for a visit.</p><p class="row"><a class="btn primary" href="#/care">My patients</a><a class="btn" href="#/care/queue">The queue</a></p></section>`;
    else html = `<section class="care-panel" id="care-home"><h2>${esc(me.user.name || 'You')}</h2><p class="muted">${me.plan ? `Your plan from ${esc(me.plan.physio ? me.plan.physio.name : 'your physio')}: ${esc(me.plan.plan.name)}.` : 'No plan from a physio yet.'}${me.unreadReviews ? ` <b>${me.unreadReviews} review${me.unreadReviews === 1 ? '' : 's'} answered.</b>` : ''}</p><p class="row"><a class="btn primary" href="#/care">Today</a>${me.plan ? `<a class="btn" href="#/plan/${esc(me.plan.plan.id)}">The plan</a>` : ''}</p></section>`;
    host.parentNode.insertBefore(h(html), host);
  }
  /* the plan page: an assigned plan says who set it; a physio's own plan offers Assign */
  function planPage() {
    const id = decodeURIComponent((location.hash.match(/^#\/plan\/([^/]+)$/) || [])[1] || ''); if (!id) return;
    const p = Plans.get(id); if (!p) return;
    const kind = $('plan-kind');
    if (p.assigned) { kind.textContent = `Set by ${p.physioName || 'your physio'} on ${day(p.assignedAt)} (version ${p.v}).${p.assignNote ? ' “' + p.assignNote + '”' : ''}`; }
    const old = $('care-assign'); if (old) old.remove();
    if (!isPhysio() || !p.custom) return;
    let target = null; try { target = JSON.parse(sessionStorage.getItem('ontrack.care.assign') || 'null'); } catch { }
    const row = h(`<div class="row" id="care-assign">${target ? `<button class="btn primary" type="button" id="care-assign-go">Assign to ${esc(target.name)} as a new version</button>` : ''}<span class="tiny" id="care-assign-note">${target ? '' : 'To send this plan to a patient, open them from My patients and pick it there.'}</span></div>`);
    $('plan-actions').appendChild(row);
    const go = $('care-assign-go'); if (go) go.onclick = async () => { try { await api.call('assignPlan', { patientId: target.patientId, plan: Plans.clean(p, false), note: '' }); sessionStorage.removeItem('ontrack.care.assign'); location.hash = '#/care/patient/' + target.patientId; } catch (e) { note('care-assign-note', fail(e), true); } };
  }
  /* a step of the assigned plan: too hard today */
  function stepPage() {
    const old = $('care-ease'); if (old) old.remove();
    const pc = __app.planCtx; if (!me || !pc || !pc.plan.assigned) return;
    const b = h(`<p class="tiny center care-ease" id="care-ease"><button class="linkbtn" type="button">Too hard today? Ease this step one notch</button> <span></span></p>`);
    $('go-note').parentNode.insertBefore(b, $('go-note').nextSibling);
    /* eased: the plan is a new version, and the step is entered again so the page carries its numbers */
    b.querySelector('button').onclick = async () => { try { await api.call('easeStep', { step: pc.i }); await refresh(); dispatchEvent(new HashChangeEvent('hashchange')); const b2 = $('care-ease'); if (b2) b2.querySelector('span').textContent = 'Eased. Your physio sees it.'; } catch (e) { b.querySelector('span').textContent = fail(e); } };
  }

  /* ---------- go ---------- */
  window.addEventListener('hashchange', route);
  refresh().then(() => { route(); if (me && !me.user.name && !/care\/(profile|signin)/.test(location.hash)) location.hash = '#/care/profile'; });
  window.__care = { api, get me() { return me; }, refresh, get current() { return current; }, repsOf, clipFor };
});
