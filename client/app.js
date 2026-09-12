/* Fyzio — public site, member area, curator area and admin. No framework, no build step. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const view = $('view');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDay = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const rupees = (paise) => '₹' + (paise / 100).toLocaleString('en-IN');
  let me = null, ent = null, notice = null, env = {}, exercises = null, specialties = [];
  const solo = () => !!env.solo && !me;   // solo mode: no accounts, plans or curators shown

  /* ---------- API ---------- */
  async function api(method, path, body) {
    const r = await fetch(path.replace(/^\//, ''), { method,   /* relative, so the same build runs at / on the server and under /<repo>/ on GitHub Pages */ headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    let data = null; try { data = await r.json(); } catch { }
    if (!r.ok) { const e = new Error((data && data.error) || `Request failed (${r.status})`); e.status = r.status; e.data = data; if (r.status === 401 && me) { me = null; ent = null; route(); } if (r.status === 428) location.hash = '#/consent'; if (r.status === 402) e.upgrade = true; throw e; }
    return data;
  }
  async function refreshMe() { const d = await api('GET', '/api/me'); me = d.user; ent = d.entitlements; notice = d.notice; env = d.env; exercises = null; return d; }
  function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
  async function loadExercises() { if (!exercises) { const d = await api('GET', '/api/exercises'); exercises = d.exercises; specialties = d.specialties; } return exercises; }
  const exById = (id) => (exercises || []).find(e => e.id === id);
  const coachEx = (id) => FyzioCoach.exercises.find(e => e.id === id);

  /* ---------- first-run intro ---------- */
  const SEEN_INTRO = 'fyzio.seenIntro';
  const seenIntro = () => { try { return localStorage.getItem(SEEN_INTRO) === '1'; } catch { return true; } };
  /* force=true replays it from Settings; otherwise it shows once, to a new user. */
  function showIntro(force) {
    if (!force && seenIntro()) return;
    const el = $('intro'); if (!el) return;
    el.hidden = false;
    const close = () => { el.hidden = true; try { localStorage.setItem(SEEN_INTRO, '1'); } catch { } document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    $('intro-go').onclick = close;
    el.onclick = (e) => { if (e.target === el) close(); };      // tapping the backdrop dismisses
    document.addEventListener('keydown', onKey);
    $('intro-go').focus();
  }
  /* view is never replaced, only its contents, so this is wired once for every settings page. */
  view.addEventListener('click', (e) => { if (e.target.closest('#cs-intro')) showIntro(true); });

  /* ---------- routing ---------- */
  function nav(items) { $('topnav').innerHTML = items.map(([href, label]) => `<a href="${href}" class="${(href === '#/' ? location.hash === '#/' || !location.hash : location.hash.startsWith(href)) ? 'active' : ''}">${label}</a>`).join(''); }
  function render(html) { view.innerHTML = html; window.scrollTo(0, 0); $('topbar').classList.remove('at-home'); if (window.FyzioAnatomy) FyzioAnatomy.mountAll(view); }
  function requireLogin(next) { if (me) return true; sessionStorage.setItem('fz.next', next || location.hash); location.hash = '#/login'; return false; }
  async function route() {
    const hash = location.hash || '#/'; const [, p1, p2, p3] = hash.split('?')[0].split('/');
    $('topbar').hidden = false; $('btn-logout').hidden = !me; $('top-user').textContent = me ? (me.name || me.identifier) : ''; $('top-role').textContent = me ? (me.role === 'admin' ? 'admin' : ent.tier) : '';
    $('btn-login').hidden = !!me || !!env.solo;
    if (me && me.consentRequired && hash !== '#/consent') { location.hash = '#/consent'; return; }
    const pub = [['#/', 'Home'], ['#/exercises', 'Exercises'], ['#/routines', 'Routines'], ['#/curators', 'Find a curator'], ['#/pricing', 'Pricing']];
    if (solo()) nav([['#/settings', 'Settings']]);
    else if (!me) nav(pub);
    else if (me.role === 'curator') nav([['#/curator', 'My members'], ['#/build', 'My routines'], ['#/exercises', 'Exercises'], ['#/curators', 'Directory'], ['#/curator-profile', 'My listing'], ['#/account', 'Account']]);
    else if (me.role === 'admin') nav([['#/admin', 'Admin'], ['#/exercises', 'Exercises'], ['#/routines', 'Routines'], ['#/curators', 'Curators'], ['#/account', 'Account']]);
    else nav([['#/dashboard', 'My plan'], ['#/exercises', 'Exercises'], ['#/routines', 'Routines'], ['#/curators', 'Find a curator'], ['#/history', 'History'], ['#/notes', 'Notes'], ['#/account', 'Account']]);
    try {
      switch (p1 || '') {
        case '': return me && me.role === 'member' ? renderDashboard() : me && me.role === 'curator' ? renderCuratorHome() : me && me.role === 'admin' ? renderAdmin() : renderHome();
        case 'login': return solo() ? renderHome() : renderLogin(p2);
        case 'consent': return me ? renderConsent() : renderLogin();
        case 'exercises': return renderExercises();
        case 'exercise': return renderExercise(p2, p3);
        case 'routines': return renderRoutines();
        case 'routine': return renderRoutine(p2);
        case 'curators': return solo() ? renderHome() : renderCurators();
        case 'curator': return p2 ? renderCuratorPublic(p2) : renderCuratorHome();
        case 'pricing': return solo() ? renderHome() : renderPricing();
        case 'dashboard': return requireLogin() && renderDashboard();
        case 'history': return requireLogin() && renderHistory();
        case 'notes': return requireLogin() && renderNotes();
        case 'build': return requireLogin() && (p2 ? renderBuilder(p2) : renderMyRoutines());
        case 'connections': return requireLogin() && renderConnections();
        case 'account': return requireLogin() && renderAccount();
        case 'settings': return renderSettings();
        case 'curator-profile': return requireLogin() && renderCuratorProfileEditor();
        case 'curator-member': return requireLogin() && renderCuratorMember(p2);
        case 'admin': return requireLogin() && renderAdmin();
        default: return renderHome();
      }
    } catch (e) { render(`<div class="card"><h3>Something went wrong</h3><p class="error">${esc(e.message)}</p></div>`); }
  }
  window.addEventListener('hashchange', route);
  $('btn-logout').onclick = async () => { await api('POST', '/api/auth/logout', {}); await refreshMe(); location.hash = '#/'; route(); };
  $('btn-login').onclick = () => { location.hash = '#/login'; };

  /* ---------- shared UI bits ---------- */
  const lockBadge = (locked) => locked ? '<span class="badge warn">Pro</span>' : '<span class="badge good">Free</span>';
  const optLabel = (o, vv) => o.swatches ? `<i class="swatch big" title="${esc((o.labels && o.labels[vv]) || vv)}" aria-label="${esc((o.labels && o.labels[vv]) || vv)}" style="background:${o.swatches[vv]}${vv === 'none' ? ';border:2px dashed var(--muted)' : ''}">${vv === 'none' ? '<span class="x">✕</span>' : ''}</i>` : esc((o.labels && o.labels[vv]) || (vv + (o.unit || '')));
  const tierBadge = (ex) => ex.tier === 'pro' ? `<span class="badge ${ex.locked ? 'warn' : 'accent'}">Pro</span>` : '<span class="badge good">Free</span>';
  const SIDE_WORD = { left: 'left', right: 'right' };
  /* "left leg" / "right arm" / "left side" — the limb word comes from the move. */
  function sideLabel(ex, side) {
    const w = SIDE_WORD[side]; if (!w || !ex || !ex.sided) return '';
    return ex.sided.limb === 'side' ? `${w} side` : `${w} ${ex.sided.limb}`;
  }
  function optionSummary(ex, o) { const parts = [ex.type === 'reps' ? `${o.target} reps` : `${o.target} s hold`]; if (o.rom) parts.push(`${o.rom}° target`); if (o.variant) { const vo = (ex.options || []).find(x => x.key === 'variant'); parts.push((vo && vo.labels && vo.labels[o.variant]) || o.variant); } if (o.band && o.band !== 'none') parts.push(o.band + ' band'); else if (o.band === 'none' && (ex.options || []).some(x => x.key === 'band' && x.default !== 'none')) parts.push('no band'); if (o.side) parts.push(o.side === 'both' ? 'both sides' : (sideLabel(ex, o.side) || o.side + ' side')); if (o.sets > 1) parts.push(`${o.sets} sets${o.rest ? ', ' + o.rest + ' s rest' : ''}`); return parts.join(' · '); }
  function upgradeCard(reason) { return `<div class="card upgrade"><h3>${esc(reason || 'This needs Pro')}</h3><p class="muted">Pro unlocks every exercise and lets you build your own routines. Or connect with a curator — routines they send you are unlocked at no cost.</p><div class="row" style="margin-top:10px"><a class="btn primary small" href="#/pricing">See plans</a><a class="btn ghost small" href="#/curators">Find a curator</a></div></div>`; }
  function faultsSummary(rv) { const f = rv.faults || {}; const k = Object.keys(f); return k.length ? k.map(x => `${esc(f[x].label || x)} ×${f[x].n}`).join(', ') : 'no faults'; }
  function sessionCard(s, { extra = '' } = {}) { const rv = s.review || {}; const cls = rv.score >= 75 ? 'good' : rv.score >= 55 ? 'warn' : 'bad';
    return `<div class="card link" data-sid="${s.id}"><div class="item-row"><span class="score-pill" style="color:var(--${cls})">${rv.score ?? '—'}</span><span><strong>${esc(s.exerciseName)}</strong><br><span class="meta">${fmtDate(s.finishedAt)} · ${rv.type === 'reps' ? `${rv.reps}/${rv.target} reps` : `${rv.holdSec}s / ${rv.target}s`} · ${faultsSummary(rv)}${s.effort != null ? ` · effort ${s.effort}/10` : ''}</span>${s.note ? `<br><span class="meta">📝 ${esc(s.note)}</span>` : ''}</span><span>${s.curatorComment ? '<span class="badge accent">curator replied</span>' : ''}</span></div>${s.curatorComment ? `<p class="notice" style="margin-top:8px">Curator: ${esc(s.curatorComment)}</p>` : ''}<div class="session-detail" hidden>${extra}</div></div>`; }
  function sessionDetailHtml(s) { const rv = s.review || {}; const strip = (rv.repList || []).map(r => `<i class="${!r.full ? 'partial' : (r.faults || []).length ? 'fault' : ''}" style="height:${Math.round(Math.min(r.peak || 0, 1.2) / 1.2 * 100)}%"></i>`).join('');
    const stats = rv.type === 'reps' ? [[`${rv.reps} / ${rv.target}`, 'reps'], [rv.partials, 'partial'], [rv.avgTempo ? (rv.avgTempo / 1000).toFixed(1) + ' s' : '—', 'avg rep'], [Math.round((rv.avgROM || 0) * 100) + '%', 'avg range']] : [[rv.holdSec + ' s', 'held'], [rv.goodSec + ' s', 'good form'], [rv.target + ' s', 'target'], [Math.round(100 * (rv.holdSec ? rv.goodSec / rv.holdSec : 0)) + '%', 'quality']];
    return `<div class="stats">${stats.map(([v, k]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${k}</div></div>`).join('')}</div>${strip ? `<div class="mini-strip">${strip}</div>` : ''}${Object.keys(rv.faults || {}).length ? `<div class="fault-list">${Object.values(rv.faults).map(f => `<div class="fault"><span class="n">×${f.n}</span><span><span class="l">${esc(f.label)}</span></span></div>`).join('')}</div>` : '<p class="muted">No faults flagged.</p>'}${(rv.tips || []).length ? `<div class="notice">${rv.tips.map(t => `<strong>${esc(t.label)}:</strong> ${esc(t.tip)}`).join('<br>')}</div>` : ''}`; }
  function wireSessionCards(container, byId, extraFn, wireFn) { container.querySelectorAll('.card[data-sid]').forEach(card => card.addEventListener('click', (e) => { if (e.target.closest('button, textarea, input, a')) return; const det = card.querySelector('.session-detail'); if (!det.hidden) { det.hidden = true; return; } const s = byId[card.dataset.sid]; det.innerHTML = sessionDetailHtml(s) + (extraFn ? extraFn(s) : ''); det.hidden = false; if (wireFn) wireFn(det, s); })); }

  /* The brand wordmark at hero scale. Same artwork as the topbar mark, so the homepage
     leads with the logo itself rather than repeating a small copy of it. */
  const heroMark = () => `<svg class="hero-logo" viewBox="0 0 340 92" role="img" aria-label="Grooveform">
      <text x="4" y="52" font-size="56" fill="currentColor" style="font-family:var(--font-display)">Grooveform</text>
      <rect x="4" y="62" width="300" height="6" fill="#ff2e88"/><rect x="4" y="70.5" width="300" height="6" fill="#ffb830"/><rect x="4" y="79" width="300" height="6" fill="#b8f542"/>
      <circle cx="318" cy="18" r="13" fill="#ff2e88"/><circle cx="318" cy="18" r="5.8" fill="#b8f542"/></svg>`;

  /* ================= PUBLIC ================= */
  async function renderHome() {
    await refreshMe(); await loadExercises(); const pre = (await api('GET', '/api/routines/prebuilt')).routines;
    const free = exercises.filter(e => e.tier === 'free'); const order = (t) => t === 'free' ? 0 : 1;
    const exs = [...exercises].sort((a, b) => order(a.tier) - order(b.tier)); const rtFree = r => r.items.every(i => i.exercise && i.exercise.tier === 'free'); const rts = [...pre].sort((a, b) => (rtFree(a) ? 0 : 1) - (rtFree(b) ? 0 : 1));
    render(`<div class="stack">
      <section class="hero"><div class="hero-brand">${heroMark()}<span class="hero-tag">camera form coach</span></div>
        <h1><span class="l1">Sweat.</span> <span class="l2">Count.</span> <span class="l3">Repeat.</span></h1>
        <p class="hero-copy">Your camera counts the reps and cheers the good ones. Out loud. Like a coach who actually likes you.${solo() ? '' : ' Free moves need no sign-up; the Pass unlocks every move — or a coach sends you a playlist.'}</p>
        <div class="row"><a class="btn primary" href="#/exercise/${free[0] ? free[0].id : exs[0].id}">Try ${esc(free[0] ? free[0].name : exs[0].name)}</a>${solo() ? '' : '<a class="btn secondary" href="#/curators">Find a coach</a>'}</div></section>
      <section class="home-sec"><h2>Moves</h2><p class="muted">Pick one, put the phone down, follow the voice.</p><div class="tiles wide">${exs.map(exTile).join('')}</div></section>
      <section class="home-sec"><h2>Playlists</h2><p class="muted">Ready-made routines. Each move runs with its own reps, sets and rest.</p><div class="playlists">${rts.map(rtRow).join('')}${ent && ent.canBuild ? `<a class="playlist build" href="#/build/new"><span class="count">+</span><span class="body"><span class="title">Build your own</span><span class="tracks">custom playlist</span></span></a>` : ''}</div></section>
      <div class="card"><h3>How it works</h3><p class="muted">The pose model runs on your device — video never leaves your phone. The coach counts the reps, times the holds, checks your angles against a target and says what to fix. ${solo() ? '' : 'Coaches are independent professionals; '}${esc(env.appName || 'Grooveform')} is a fitness tool, not a medical service.</p></div>
    </div>`);
    /* The hero carries the wordmark on this page, so the topbar does not repeat it. */
    $('topbar').classList.add('at-home');
  }
  function rtRow(r) { const names = r.items.map(i => i.exercise ? i.exercise.name : '').filter(Boolean); const tone = ['tangerine', 'lime', 'pink'][Math.abs(hash(r.title)) % 3];
    return `<a class="playlist ${tone}" href="#/routine/${r.id}"><span class="count">${r.items.length}</span><span class="body"><span class="title">${esc(r.title)}</span><span class="desc">${esc(r.description || '')}</span><span class="tracks">${names.map(esc).join(' · ')}</span></span>${allFree() ? '' : r.items.every(i => i.exercise && i.exercise.tier === 'free') ? '<span class="badge good">Free</span>' : `<span class="badge ${r.locked ? 'warn' : 'accent'}">Pass</span>`}</a>`; }
  function hash(str) { let h = 0; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
  const allFree = () => (exercises || []).every(e => e.tier === 'free');
  function exTile(ex) { return `<a class="tile" href="#/exercise/${ex.id}"><span class="glyph">${FyzioCoach.thumb(coachEx(ex.id))}</span><span class="name">${esc(ex.name)}</span><span class="meta">${ex.type === 'reps' ? 'reps' : 'timed hold'} · ${ex.view === 'front' ? 'face camera' : 'side-on'}</span>${allFree() ? '' : tierBadge(ex)}</a>`; }
  function rtTile(r) { const names = r.items.map(i => i.exercise ? i.exercise.name : '').filter(Boolean); return `<a class="tile routine" href="#/routine/${r.id}"><span class="glyph"><span class="rt-count">${r.items.length}</span></span><span class="name">${esc(r.title)}</span><span class="meta">${esc(names.slice(0, 3).join(' · '))}${names.length > 3 ? ' …' : ''}</span>${allFree() ? '' : r.items.every(i => i.exercise && i.exercise.tier === 'free') ? '<span class="badge good">Free</span>' : `<span class="badge ${r.locked ? 'warn' : 'accent'}">Pro</span>`}</a>`; }

  function exCard(ex) { return `<a class="ex-card" href="#/exercise/${ex.id}"><span class="glyph">${FyzioCoach.thumb(coachEx(ex.id))}</span><span><span class="name">${esc(ex.name)}</span><br><span class="sum">${esc(ex.summary)}</span></span>${tierBadge(ex)}</a>`; }
  function routineCard(r) { return `<a class="card link" href="#/routine/${r.id}" style="text-decoration:none;color:inherit"><div class="row"><strong>${esc(r.title)}</strong>${r.kind === 'prebuilt' ? lockBadge(r.locked) : r.ownerName ? `<span class="badge accent">from ${esc(r.ownerName)}</span>` : '<span class="badge">mine</span>'}<div class="spacer"></div><span class="meta">${r.items.length} exercises</span></div><p class="meta" style="margin-top:4px">${esc(r.description || '')}</p><p class="meta">${r.items.map(i => i.exercise ? i.exercise.name : i.exerciseId).join(' · ')}</p></a>`; }
  async function renderExercises() { await refreshMe(); await loadExercises(); /* entitlements can change between views (purchase, curator send) */ render(`<div class="stack"><h1>Moves</h1><p class="muted">${allFree() ? 'Pick one, put the phone down, follow the voice.' : ent && ent.tier !== 'anon' && ent.tier !== 'free' ? 'Everything is unlocked on your plan.' : 'Free ones need no account. Pro ones unlock with a subscription or a curator-sent routine.'}</p><div class="tiles wide">${exercises.map(exTile).join('')}</div>${ent && !ent.pro && !allFree() ? upgradeCard('Unlock the full library') : ''}</div>`); }
  async function renderExercise(id, sub) {
    await refreshMe(); await loadExercises(); /* entitlements can change between views (purchase, curator send) */ const cat = exById(id); if (!cat) return renderHome(); const ex = coachEx(id); const g = cat.guide;
    let itemCtx = null; if (sub && sub.startsWith('item-')) { try { const [rid, iid] = sub.slice(5).split('_'); const r = (await api('GET', '/api/routines/' + rid)).routine; itemCtx = { routine: r, item: r.items.find(i => i.id === iid) }; if (!itemCtx.item) itemCtx = null; } catch { } }
    const opts = itemCtx ? { rest: 60, ...itemCtx.item.options } : { target: cat.defaultTarget, sets: 1, rest: 60, ...Object.fromEntries(cat.options.map(o => [o.key, o.default])) };
    render(`<div class="stack">
      <div class="row"><a class="btn ghost small" href="${itemCtx ? '#/routine/' + itemCtx.routine.id : '#/'}">← ${itemCtx ? esc(itemCtx.routine.title) : 'All moves'}</a></div>
      <div class="ex-head"><div><span class="eyebrow">${esc(cat.group)} · ${cat.type === 'reps' ? 'reps' : 'timed hold'}</span><h1>${esc(cat.name)} ${allFree() ? '' : tierBadge(cat)}</h1></div>
        ${cat.locked ? '' : `<div class="row ex-actions"><button class="btn primary" id="do-start">▶ Start camera</button><button class="btn ghost" id="do-file">Analyze a video…</button><input type="file" id="do-file-input" accept="video/*" hidden></div>`}</div>
      <p class="muted">${esc(cat.summary)}${me || cat.locked || solo() ? '' : ' You can do this without an account — <a href="#/login">sign in</a> to save history.'}</p>
      ${cat.locked ? upgradeCard(`${cat.name} is a Pro exercise`) : ''}
      <div class="ex-grid">
        <div class="stack">
          <div class="card"><h3>The move</h3>${FyzioAnatomy.demo(cat)}</div>
          <div class="card"><h3>Where to put the phone</h3>${FyzioCoach.cameraDiagram(ex)}<p style="margin-top:8px">${esc(cat.setup)}</p><p class="muted" style="margin-top:6px;font-size:.9rem">${esc(cat.why)}</p></div>
        </div>
        <div class="stack">
          ${itemCtx ? `<div class="card"><h3>From “${esc(itemCtx.routine.title)}”</h3><p><strong>${esc(optionSummary(cat, opts))}</strong></p>${itemCtx.item.notes ? `<p class="notice" style="margin-top:8px">${esc(itemCtx.item.notes)}</p>` : ''}</div>` : `<div class="card config">${configBlock(cat, opts)}</div>`}
        </div>
      </div>
      ${g ? `<div class="card guide"><div class="row" style="align-items:baseline;gap:12px;flex-wrap:wrap"><h3>Set-up and form</h3><span class="guide-key"><span class="tag cam">camera checks</span><span class="tag you">you check</span></span></div><p class="muted" style="font-size:.9rem;margin:6px 0 10px">${esc(g.surface)}</p><div class="guide-cols">${g.regions.map(r => `<div class="guide-region"><div class="guide-name">${esc(r.name)}</div>${r.points.map(pt => `<p class="gp ${pt.tracked ? 'cam' : 'you'}"><span class="tag ${pt.tracked ? 'cam' : 'you'}">${pt.tracked ? 'camera' : 'you'}</span>${esc(pt.t)}</p>`).join('')}</div>`).join('')}</div><p class="muted" style="font-size:.88rem;margin-top:10px"><strong>Stop if:</strong> ${esc(g.stop)}</p></div>` : ''}
    </div>`);
    wireChips(view, {}, opts);
    if (cat.locked) return;
    const begin = (file) => runCoach(ex, opts, itemCtx, file);
    $('do-start').onclick = () => begin(null); $('do-file').onclick = () => $('do-file-input').click(); $('do-file-input').onchange = () => { const f = $('do-file-input').files[0]; $('do-file-input').value = ''; if (f) begin(f); };
  }

  /* ---------- option chips (shared by the exercise page and the routine page) ---------- */
  function optChips(opts, key, values, fmt) {
    return `<div class="opts" data-optkey="${key}">${values.map(vv => `<button class="chip" data-opt="${esc(vv)}" aria-pressed="${opts[key] === vv}">${fmt(vv)}</button>`).join('')}</div>`;
  }
  /* Every knob for one exercise: reps/hold, sets, rest, plus whatever that move defines (band, side, range…). */
  function configBlock(cat, opts) {
    return `<h3>${cat.type === 'reps' ? 'Reps per set' : 'Hold time'}</h3>${optChips(opts, 'target', cat.targets, t => t + (cat.type === 'hold' ? ' s' : ''))}<h3>Sets</h3>${optChips(opts, 'sets', [1, 2, 3, 4, 5], n => n)}<h3>Rest between sets</h3>${optChips(opts, 'rest', [30, 45, 60, 90, 120], n => n + ' s')}${cat.options.map(o => `<h3>${esc(o.label)}</h3>${optChips(opts, o.key, o.values, vv => optLabel(o, vv))}`).join('')}`;
  }
  /* Chip rows inside a [data-item] host write to bags[thatId]; loose rows write to `loose`. */
  function wireChips(root, bags, loose, onChange) {
    root.querySelectorAll('[data-optkey]').forEach(row => {
      const host = row.closest('[data-item]'); const bag = host ? bags[host.dataset.item] : loose;
      if (!bag) return;
      row.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
        const vv = b.dataset.opt; bag[row.dataset.optkey] = isNaN(vv) ? vv : Number(vv);
        row.querySelectorAll('[data-opt]').forEach(x => x.setAttribute('aria-pressed', x === b));
        if (onChange) onChange(host, bag);
      });
    });
  }

  function runCoach(ex, opts, itemCtx, file) {
    runSequence([{ ex, opts, itemId: itemCtx ? itemCtx.item.id : undefined }], { file, back: itemCtx ? '#/routine/' + itemCtx.routine.id : '#/exercise/' + ex.id });
  }

  /* A one-sided move set to "both" runs as two halves: every set on one side, a prompt to
     switch, then the same on the other. Everything downstream just sees two ordinary steps. */
  function expandSides(steps) {
    const out = [];
    for (const st of steps) {
      if (st.ex && st.ex.sided && (st.opts.side || 'both') === 'both') {
        out.push({ ...st, opts: { ...st.opts, side: 'left' }, half: 1 });
        out.push({ ...st, opts: { ...st.opts, side: 'right' }, half: 2 });
      } else out.push(st);
    }
    return out;
  }

  /* Runs one or more exercises back to back: each step's sets, a rest, then the next step.
     A single exercise is a sequence of one, so both paths share the rest / review / save flow. */
  function runSequence(rawSteps, { file = null, back = '#/' } = {}) {
    const steps = expandSides(rawSteps);
    const coach = $('coach'); coach.hidden = false; document.body.style.overflow = 'hidden';
    const portal = coach.querySelector('#rv-portal');
    const close = () => { clearInterval(restTimer); coach.hidden = true; document.body.style.overflow = ''; coach.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); };
    const results = []; let restTimer = null, si = -1, step = null, total = 1, rest = 60, target = null, o = {}, setNo = 0;
    const showLive = () => { coach.querySelector('#screen-live').classList.add('active'); coach.querySelector('#screen-review').classList.remove('active'); portal.innerHTML = ''; };
    const showReview = () => { coach.querySelector('#screen-live').classList.remove('active'); coach.querySelector('#screen-review').classList.add('active'); };
    const beginStep = () => {
      si++; step = steps[si]; setNo = 0;
      total = file ? 1 : Math.max(1, Math.min(10, Number(step.opts.sets) || 1)); rest = Math.max(10, Math.min(600, Number(step.opts.rest) || 60));
      o = { ...step.opts }; target = o.target; delete o.target; delete o.sets; delete o.rest; o.sets = total;
      startSet();
    };
    const startSet = () => {
      setNo++; showLive();
      const more = setNo < total || si < steps.length - 1;   // keep the camera up for the rest
      FyzioCoach.start({ exercise: step.ex, target, options: { ...o, set: setNo }, file, keepCameraAfter: more, exit: (dest) => { close(); location.hash = dest || back; }, done: onDone });
    };
    const onDone = ({ review, rec, opts: usedOpts, startedAt, cameraHeld }) => {
      results.push({ review, opts: { ...usedOpts, set: setNo, sets: total }, diagnostics: rec, startedAt, source: file ? 'file' : 'camera', routineItemId: step.itemId });
      if (setNo >= total && si >= steps.length - 1) { showReview(); savePanel(); return; }
      if (!cameraHeld) showReview();          // a video-file run has no camera to hold open
      if (setNo < total) restScreen(review, cameraHeld); else nextStepPanel(review, cameraHeld);
    };
    /* What to fix next set, from the set just finished. */
    const coaching = (rv) => {
      const tips = (rv && rv.tips) || [];
      const did = rv.type === 'reps' ? `${rv.reps} of ${rv.target} reps${rv.partials ? `, ${rv.partials} partial` : ''}` : `held ${Math.round(rv.holdSec)} s of ${rv.target}`;
      if (!tips.length) return { did, text: `${did} — nothing to correct. Same again.`, checks: [] };
      return { did, text: `${tips[0].label}: ${tips[0].tip}`, checks: tips.slice(0, 3).map((t) => ({ label: `${t.label} ×${t.n}`, ok: false })) };
    };
    /* Rest with the camera, skeleton and your last count still on screen. */
    const restOnCamera = ({ title, review, note, goLabel, onGo }) => {
      let left = rest; const c = coaching(review);
      const stop = () => { clearInterval(restTimer); FyzioCoach.endRest(); showReview(); savePanel(); };
      const go = () => { clearInterval(restTimer); onGo(); };
      const paint = () => FyzioCoach.restOverlay({ title, text: c.text, checks: c.checks, count: left, note, actions: [{ label: goLabel, fn: go }, { label: 'Stop here', cls: 'ghost', fn: stop }] });
      paint();
      restTimer = setInterval(() => { left--; paint(); if (left <= 3 && left > 0) FyzioCoach.voice.beep(660, 0.06); if (left <= 0) go(); }, 1000);
    };
    const restScreen = (review, held) => {
      FyzioCoach.voice.say(`Set ${setNo} done. Rest ${rest} seconds.`, { priority: 2 });
      if (held) return restOnCamera({ title: `Set ${setNo} of ${total} done · ${coaching(review).did}`, review, note: `Set ${setNo + 1} starts by itself — get back into position.`, goLabel: `Start set ${setNo + 1}`, onGo: startSet });
      let left = rest;
      portal.innerHTML = `<div class="panel stack rest"><h3>Set ${setNo} of ${total} done</h3><div class="rest-clock"><span id="rest-left">${left}</span><span class="unit">s rest</span></div><p class="muted">Set ${setNo + 1} starts by itself — get back into position.</p><div class="row"><button class="btn primary" id="rest-go">Start set ${setNo + 1} now</button><button class="btn ghost" id="rest-stop">Stop here</button></div></div>`;
      const go = () => { clearInterval(restTimer); startSet(); };
      restTimer = setInterval(() => { left--; const el = portal.querySelector('#rest-left'); if (el) el.textContent = left; if (left <= 3 && left > 0) FyzioCoach.voice.beep(660, 0.06); if (left <= 0) go(); }, 1000);
      portal.querySelector('#rest-go').onclick = go; portal.querySelector('#rest-stop').onclick = () => { clearInterval(restTimer); savePanel(); };
    };
    /* Between two exercises of a routine: same rest clock, but it rolls into the next move. */
    const nextStepPanel = (review, held) => {
      const next = steps[si + 1]; let left = rest;
      /* Two halves of one move read as "switch sides", not as a new exercise. */
      const switching = next.half === 2 && next.ex.id === step.ex.id;
      const nextSide = sideLabel(next.ex, next.opts.side);
      const title = switching ? `Switch sides — now your ${nextSide}` : `Next up: ${next.ex.name}`;
      const goLabel = switching ? `Start ${nextSide}` : `Start ${next.ex.name} now`;
      FyzioCoach.voice.say(switching ? `Now the other side. ${nextSide}. Rest ${rest} seconds.` : `${step.ex.name} done. Next up, ${next.ex.name}. Rest ${rest} seconds.`, { priority: 2 });
      if (held) return restOnCamera({ title, review, note: (switching ? 'Swap over — ' : '') + optionSummary(exById(next.ex.id) || next.ex, next.opts), goLabel, onGo: beginStep });
      portal.innerHTML = `<div class="panel stack rest"><span class="eyebrow">${si + 1} of ${steps.length} done</span><h3>${esc(title)}</h3><div class="rest-clock"><span id="rest-left">${left}</span><span class="unit">s rest</span></div><p class="muted">${esc(optionSummary(exById(next.ex.id) || next.ex, next.opts))}</p><div class="row"><button class="btn primary" id="rest-go">${esc(goLabel)}</button><button class="btn ghost" id="rest-stop">Finish here</button></div></div>`;
      const go = () => { clearInterval(restTimer); beginStep(); };
      restTimer = setInterval(() => { left--; const el = portal.querySelector('#rest-left'); if (el) el.textContent = left; if (left <= 3 && left > 0) FyzioCoach.voice.beep(660, 0.06); if (left <= 0) go(); }, 1000);
      portal.querySelector('#rest-go').onclick = go; portal.querySelector('#rest-stop').onclick = () => { clearInterval(restTimer); savePanel(); };
    };
    const savePanel = () => {
      const n = results.length; const label = n > 1 ? `these ${n} sets` : 'this set';
      if (!me && env.solo) { portal.innerHTML = `<div class="panel stack"><div class="row"><button class="btn primary" id="rv-discard">Done</button></div></div>`; portal.querySelector('#rv-discard').onclick = () => { close(); location.hash = back; }; return; }
      if (!me) { portal.innerHTML = `<div class="panel stack"><h3>Save ${label}?</h3><p class="muted">Sign in (free) to keep your history, take notes and track progress over time.</p><div class="row"><button class="btn primary" id="rv-login">Sign in to save</button><button class="btn ghost" id="rv-discard">Done</button></div></div>`;
        portal.querySelector('#rv-discard').onclick = () => { close(); location.hash = back; }; portal.querySelector('#rv-login').onclick = () => { try { sessionStorage.setItem('fz.pending', JSON.stringify(results.map(r => ({ ...r, diagnostics: undefined })))); } catch { } close(); requireLogin(back); }; return; }
      let effort = null;
      portal.innerHTML = `<div class="panel stack"><h3>Save ${label}</h3><div><span class="muted" style="font-size:.9rem">How hard was it? (0 easy – 10 max)</span><div class="pain" id="effort">${Array.from({ length: 11 }, (_, i) => `<button type="button" data-v="${i}">${i}</button>`).join('')}</div></div><label class="field"><span>Note (optional)</span><textarea id="rv-note" maxlength="1000" placeholder="e.g. left knee clicked on rep 4"></textarea></label><div class="row"><button class="btn primary" id="rv-submit">Save</button><button class="btn ghost" id="rv-discard">Discard</button></div><p class="error" id="rv-err"></p></div>`;
      portal.querySelectorAll('#effort button').forEach(b => b.onclick = () => { effort = Number(b.dataset.v); portal.querySelectorAll('#effort button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
      portal.querySelector('#rv-discard').onclick = () => { close(); location.hash = back; };
      portal.querySelector('#rv-submit').onclick = async () => { const btn = portal.querySelector('#rv-submit'); btn.disabled = true; try {
          for (const r of results) await api('POST', '/api/sessions', { routineItemId: r.routineItemId, review: r.review, opts: r.opts, diagnostics: me.prefs.store_diagnostics !== false ? r.diagnostics : undefined, effort, note: portal.querySelector('#rv-note').value, startedAt: r.startedAt, source: r.source });
          close(); toast(n > 1 ? `${n} sets saved` : 'Saved'); location.hash = back; } catch (err) { portal.querySelector('#rv-err').textContent = err.message; btn.disabled = false; } };
    };
    beginStep();
  }

  async function renderRoutines() { await loadExercises(); const pre = (await api('GET', '/api/routines/prebuilt')).routines; render(`<div class="stack"><h1>Playlists</h1><p class="muted">${allFree() ? 'Ready-made plans. Each exercise runs with its own reps, sets and rest.' : 'Ready-made plans. Free ones work without an account; Pro ones unlock with a subscription or when a curator sends them to you.'}${ent && ent.canBuild ? ' You can copy any of these into <a href="#/build">My routines</a> and edit them.' : ''}</p><div class="playlists">${pre.map(rtRow).join('')}</div>${me && me.role === 'member' ? `<a class="btn ghost small" href="#/dashboard">My plan →</a>` : ''}</div>`); }
  async function renderRoutine(id) {
    await refreshMe(); await loadExercises(); /* entitlements can change between views (purchase, curator send) */ let r; try { r = (await api('GET', '/api/routines/' + id)).routine; } catch (e) { return render(`<div class="card"><h3>Routine not found</h3></div>`); }
    /* One editable option set per item, seeded from the routine's saved options. */
    const plan = {}; for (const it of r.items) { const cat = exById(it.exerciseId); if (cat) plan[it.id] = { target: cat.defaultTarget, sets: 1, rest: 60, ...Object.fromEntries(cat.options.map(o => [o.key, o.default])), ...it.options }; }
    const runnable = r.items.filter(it => !it.locked && exById(it.exerciseId));
    const startBar = runnable.length ? `<div class="row rt-start-bar"><button class="btn primary rt-start">▶ Start routine</button><span class="muted">${runnable.length} move${runnable.length > 1 ? 's' : ''} back to back, with rests</span></div>` : '';
    render(`<div class="stack"><div class="row"><a class="btn ghost small" href="#/routines">← Routines</a></div>
      <div><span class="eyebrow">${r.kind === 'prebuilt' ? 'prebuilt' : r.ownerName ? 'from ' + esc(r.ownerName) : 'my routine'}${r.tags.length ? ' · ' + r.tags.map(esc).join(', ') : ''}</span><h1>${esc(r.title)} ${r.kind === 'prebuilt' && !allFree() ? lockBadge(r.locked) : ''}</h1><p class="muted">${esc(r.description || '')}</p></div>
      ${r.locked ? upgradeCard('Some exercises in this routine are Pro') : ''}
      ${startBar}
      <p class="muted" style="font-size:.9rem">Tune any move below — the routine runs with whatever you pick here.</p>
      <div class="list">${r.items.map((it, i) => { const cat = exById(it.exerciseId); if (!cat) return '';
        return `<div class="card rt-item" data-item="${esc(it.id)}"><div class="item-row"><span class="glyph">${FyzioCoach.thumb(coachEx(cat.id))}</span><span><span class="eyebrow">${i + 1} of ${r.items.length}</span><br><strong>${esc(cat.name)}</strong> ${it.locked ? '<span class="badge warn">Pro</span>' : ''}<br><span class="meta" data-summary>${esc(optionSummary(cat, plan[it.id]))}</span>${it.notes ? `<br><span class="meta">📝 ${esc(it.notes)}</span>` : ''}</span>${it.locked ? '<a class="btn ghost small" href="#/pricing">Unlock</a>' : ''}</div>${it.locked ? '' : `<div class="rt-config">${configBlock(cat, plan[it.id])}</div>`}</div>`; }).join('')}</div>
      <div class="row">${ent && ent.canBuild && !solo() ? `<button class="btn ghost small" id="rt-copy">Copy to my routines</button>` : ''}${me && me.role === 'curator' && (r.ownerId === me.id || r.kind === 'prebuilt') ? `<a class="btn ghost small" href="#/curator">Send to a member →</a>` : ''}</div></div>`);
    /* Keep each item's one-line summary in step with its chips. */
    wireChips(view, plan, null, (host, bag) => { const it = r.items.find(x => x.id === host.dataset.item); const el = host.querySelector('[data-summary]'); if (it && el) el.textContent = optionSummary(exById(it.exerciseId), bag); });
    view.querySelectorAll('.rt-start').forEach(b => b.onclick = () => runSequence(runnable.map(it => ({ ex: coachEx(it.exerciseId), opts: plan[it.id], itemId: it.id })), { back: '#/routine/' + r.id }));
    const cp = $('rt-copy'); if (cp) cp.onclick = async () => { try { const d = await api('POST', `/api/routines/${r.id}/copy`); location.hash = '#/build/' + d.routine.id; } catch (e) { toast(e.message); } };
  }
  async function renderCurators() {
    await loadExercises(); const url = new URLSearchParams((location.hash.split('?')[1] || '')); const q = url.get('q') || '', spec = url.get('specialty') || '', kind = url.get('kind') || '', city = url.get('city') || '';
    const d = await api('GET', `/api/curators?q=${encodeURIComponent(q)}&specialty=${encodeURIComponent(spec)}&kind=${encodeURIComponent(kind)}&city=${encodeURIComponent(city)}`);
    render(`<div class="stack"><div><span class="eyebrow">Directory</span><h1>Find a curator</h1><p class="muted">Physiotherapists and trainers who build routines in ${esc(env.appName || 'Fyzio')} and coach through it. Request a connection; once they accept, routines they send you are unlocked at no extra cost, and they can see how your sets went.</p></div>
      <form class="card form" id="f-cur"><div class="cols"><label class="field"><span>Search</span><input type="text" name="q" value="${esc(q)}" placeholder="name, condition, keyword"></label><label class="field"><span>Specialty</span><select name="specialty"><option value="">Any</option>${d.specialties.map(s => `<option ${s === spec ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label><label class="field"><span>Type</span><select name="kind"><option value="">Any</option>${['physiotherapist', 'trainer', 'coach', 'other'].map(k => `<option value="${k}" ${k === kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label><label class="field"><span>City</span><input type="text" name="city" value="${esc(city)}"></label></div><button class="btn primary small" type="submit" style="justify-self:start">Search</button></form>
      ${d.curators.length ? `<div class="list">${d.curators.map(cu => `<a class="card link" href="#/curator/${cu.id}" style="text-decoration:none;color:inherit"><div class="row"><strong>${esc(cu.displayName)}</strong>${cu.verified ? '<span class="badge good">verified</span>' : ''}<span class="badge">${esc(cu.kind)}</span><div class="spacer"></div><span class="meta">${esc(cu.city || '')}</span></div><p style="margin-top:4px">${esc(cu.headline || '')}</p><p class="meta">${cu.specialties.map(esc).join(' · ')}${cu.rateText ? ' · ' + esc(cu.rateText) : ''} · ${cu.routinesShared} members coached</p></a>`).join('')}</div>` : '<div class="card"><h3>No curators match</h3><p class="muted">Try fewer filters. Are you a physio or trainer? <a href="#/login/curator">List yourself</a>.</p></div>'}
      <div class="card"><h3>Are you a physiotherapist or trainer?</h3><p class="muted">A Curator plan lists you here, lets you build routines with per-exercise targets and notes, send them to your clients, and see every set they complete. <a href="#/pricing">See the Curator plan</a>.</p></div></div>`);
    $('f-cur').onsubmit = (e) => { e.preventDefault(); const fd = new FormData(e.target); location.hash = '#/curators?' + new URLSearchParams(Object.fromEntries([...fd.entries()].filter(([, v]) => v))).toString(); };
  }
  async function renderCuratorPublic(id) {
    let d; try { d = await api('GET', '/api/curators/' + id); } catch (e) { return render('<div class="card"><h3>Curator not found</h3></div>'); } const cu = d.curator, cn = d.connection;
    render(`<div class="stack" style="max-width:720px"><div class="row"><a class="btn ghost small" href="#/curators">← Directory</a></div>
      <div><span class="eyebrow">${esc(cu.kind)}${cu.city ? ' · ' + esc(cu.city) : ''}</span><h1>${esc(cu.displayName)} ${cu.verified ? '<span class="badge good">verified</span>' : '<span class="badge">self-declared credentials</span>'}</h1><p>${esc(cu.headline || '')}</p></div>
      <div class="card"><dl class="kv"><dt>Credentials</dt><dd>${esc(cu.credentials || '—')}</dd><dt>Specialties</dt><dd>${cu.specialties.map(esc).join(', ') || '—'}</dd><dt>Languages</dt><dd>${cu.languages.map(esc).join(', ') || '—'}</dd><dt>Rate</dt><dd>${esc(cu.rateText || 'Ask')}</dd>${cu.website ? `<dt>Website</dt><dd><a href="${esc(cu.website)}" rel="noopener" target="_blank">${esc(cu.website)}</a></dd>` : ''}${cu.publicContact ? `<dt>Contact</dt><dd>${esc(cu.publicContact)}</dd>` : ''}<dt>Coached</dt><dd>${cu.routinesShared} members through ${esc(env.appName || 'Fyzio')}</dd></dl></div>
      ${cu.bio ? `<div class="card"><p style="white-space:pre-wrap">${esc(cu.bio)}</p></div>` : ''}
      ${!cu.listedNow ? '<p class="notice">This curator is not currently accepting connections.</p>' : cn && cn.status === 'accepted' ? '<div class="card"><strong>You are connected.</strong> <a href="#/dashboard">See routines they sent you →</a></div>' : cn && cn.status === 'requested' ? '<div class="card"><strong>Request sent.</strong> <span class="muted">They will see it in their member list.</span></div>' : `<div class="card"><h3>Request a connection</h3><p class="muted" style="font-size:.9rem">Tell them briefly what you need. Once accepted they can send you routines and see your completed sets for those routines — nothing else.</p><form class="form" id="f-conn" style="margin-top:8px"><textarea name="message" maxlength="500" placeholder="e.g. 6 weeks post ACL repair, cleared for home exercises"></textarea><button class="btn primary small" type="submit" style="justify-self:start">${me ? 'Send request' : 'Sign in to request'}</button><p class="error" id="cn-err"></p></form></div>`}
      <p class="muted" style="font-size:.85rem">${esc(env.appName || 'Fyzio')} does not employ curators or verify treatment; a verified badge means we checked a registration number, nothing more. Fees, if any, are agreed between you and the curator.</p></div>`);
    const f = $('f-conn'); if (f) f.onsubmit = async (e) => { e.preventDefault(); if (!requireLogin()) return; try { await api('POST', '/api/connections', { curatorId: cu.id, message: f.message.value }); toast('Request sent'); route(); } catch (err) { $('cn-err').textContent = err.message; } };
  }
  async function renderPricing() {
    const d = await api('GET', '/api/plans'); const P = Object.fromEntries(d.plans.map(p => [p.id, p]));
    const proSub = me && me.subscriptions.find(s => s.grants === 'pro' && s.active), curSub = me && me.subscriptions.find(s => s.grants === 'curator' && s.active);
    render(`<div class="stack"><div><span class="eyebrow">Pricing</span><h1>Free, Pro, Curator</h1><p class="muted">Prepaid periods, no auto-renewal — you'll be reminded before it ends. Prices in INR, GST included.</p></div>
      <div class="plans">
        <div class="card plan"><h3>Free</h3><div class="price">₹0</div><ul class="checklist"><li>Free exercises with the full camera coach</li><li>Free prebuilt routines</li><li>History and notes when signed in</li><li>Connect with a curator — routines they send are unlocked</li></ul>${me ? '' : '<a class="btn ghost" href="#/login">Create a free account</a>'}</div>
        <div class="card plan featured"><h3>Pro</h3><div class="price">${rupees(P.pro_monthly.amountPaise)}<span class="muted">/month</span></div><p class="meta">or ${rupees(P.pro_yearly.amountPaise)}/year</p><ul class="checklist"><li>Every exercise</li><li>Every prebuilt routine</li><li>Build and edit your own routines</li><li>Everything in Free</li></ul>${proSub ? `<p class="notice">Active until ${fmtDay(proSub.periodEnd)}</p>` : ''}<div class="row"><button class="btn primary" data-buy="pro_monthly">${proSub ? 'Extend a month' : 'Get Pro monthly'}</button><button class="btn ghost" data-buy="pro_yearly">${proSub ? 'Extend a year' : 'Yearly'}</button></div></div>
        <div class="card plan"><h3>Curator</h3><div class="price">${rupees(P.curator_monthly.amountPaise)}<span class="muted">/month</span></div><p class="meta">or ${rupees(P.curator_yearly.amountPaise)}/year · for physiotherapists & trainers</p><ul class="checklist"><li>Listed in Find a curator</li><li>Build routines with targets and notes</li><li>Send routines to clients — unlocked for them at no cost</li><li>See clients' completed sets, leave comments</li><li>Everything in Pro for your own training</li></ul>${curSub ? `<p class="notice">Active until ${fmtDay(curSub.periodEnd)}</p>` : ''}<div class="row"><button class="btn primary" data-buy="curator_monthly">${curSub ? 'Extend a month' : me && me.role === 'curator' ? 'Get Curator monthly' : 'Become a curator'}</button><button class="btn ghost" data-buy="curator_yearly">Yearly</button></div></div>
      </div>
      <p class="muted" style="font-size:.85rem">Payments are processed by Razorpay; ${esc(env.appName || 'Fyzio')} never sees your card details. ${env.payments === 'mock' ? '<strong>Test mode:</strong> no money moves — the plan activates immediately.' : ''}</p></div>`);
    view.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buy(b.dataset.buy));
  }
  async function buy(plan) {
    if (!requireLogin('#/pricing')) return;
    if (plan.startsWith('curator') && me.role !== 'curator') { if (!confirm('Curator plans are for physiotherapists and trainers. Switch your account to a curator account? (Your history stays; you get a listing profile.)')) return; await api('PATCH', '/api/me', { role: 'curator' }); await refreshMe(); }
    let co; try { co = await api('POST', '/api/billing/checkout', { plan }); } catch (e) { return toast(e.message); }
    if (co.provider === 'mock') { if (!confirm(`Test mode: activate ${co.description} for ${rupees(co.amountPaise)} without paying?`)) return; try { await api('POST', '/api/billing/confirm', { provider: 'mock', orderId: co.orderId }); await refreshMe(); toast('Plan activated'); location.hash = me.role === 'curator' ? '#/curator-profile' : '#/dashboard'; } catch (e) { toast(e.message); } return; }
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    const rzp = new window.Razorpay({ key: co.keyId, amount: co.amountPaise, currency: co.currency, name: co.name, description: co.description, order_id: co.orderId, prefill: co.prefill, theme: { color: '#0E8F6B' },
      handler: async (resp) => { try { await api('POST', '/api/billing/confirm', { provider: 'razorpay', orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }); await refreshMe(); toast('Payment received — plan activated'); location.hash = me.role === 'curator' ? '#/curator-profile' : '#/dashboard'; } catch (e) { toast('Payment could not be verified: ' + e.message, 6000); } } });
    rzp.on('payment.failed', (r) => toast('Payment failed: ' + (r.error && r.error.description || ''), 6000)); rzp.open();
  }
  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load payment page')); document.head.appendChild(s); }); }

  /* ---------- login / consent ---------- */
  function renderLogin(roleHint) {
    let role = roleHint === 'curator' ? 'curator' : 'member';
    render(`<div class="stack" style="max-width:440px;margin:24px auto"><div class="brand"><span class="mark" style="font-size:1.6rem">${esc(env.appName || 'Fyzio')}</span></div><h1>Sign in or create an account</h1><p class="muted">Enter your mobile number or email. We'll send a one-time code — no password. New numbers become new accounts.</p>
      <form class="form" id="f-login"><label class="field"><span>Mobile number or email</span><input type="text" id="l-id" inputmode="email" autocomplete="username" placeholder="+91 98765 43210" required autofocus></label><button class="btn primary" type="submit" id="l-send">Send code</button><p class="error" id="l-err"></p></form>
      <form class="form" id="f-code" hidden><p class="muted" id="l-sent"></p><label class="field"><span>6-digit code</span><input type="text" id="l-code" class="otp-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
        <div id="l-new" hidden class="form"><label class="field"><span>Your name</span><input type="text" id="l-name" maxlength="120" placeholder="What should we call you?"></label><div><span class="muted" style="font-size:.9rem">I am a…</span><div class="opts" style="margin-top:6px"><button type="button" class="chip" data-role="member" aria-pressed="${role === 'member'}">Person exercising</button><button type="button" class="chip" data-role="curator" aria-pressed="${role === 'curator'}">Physio / trainer (curator)</button></div></div></div>
        <button class="btn primary" type="submit">Continue</button><button class="btn ghost" type="button" id="l-back">Use a different number</button><p class="error" id="l-err2"></p></form>
      <p class="muted" style="font-size:.85rem">Camera video is processed on your device and never uploaded. By continuing you'll be shown our privacy notice.</p></div>`);
    view.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { role = b.dataset.role; view.querySelectorAll('[data-role]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    $('f-login').onsubmit = async (e) => { e.preventDefault(); $('l-err').textContent = ''; $('l-send').disabled = true; try { const r = await api('POST', '/api/auth/otp/request', { identifier: $('l-id').value }); $('f-login').hidden = true; $('f-code').hidden = false; $('l-new').hidden = r.existing; $('l-sent').textContent = (r.existing ? 'Welcome back. ' : 'New here — ') + `code sent to ${r.masked}.` + (r.devCode ? ` (Dev mode — your code is ${r.devCode})` : ''); if (r.devCode) $('l-code').value = r.devCode; (r.existing ? $('l-code') : $('l-name')).focus(); } catch (err) { $('l-err').textContent = err.message; } finally { $('l-send').disabled = false; } };
    $('f-code').onsubmit = async (e) => { e.preventDefault(); $('l-err2').textContent = ''; try { await api('POST', '/api/auth/otp/verify', { identifier: $('l-id').value, code: $('l-code').value, role, name: $('l-name').value || undefined }); await refreshMe(); const next = sessionStorage.getItem('fz.next'); sessionStorage.removeItem('fz.next'); location.hash = me.consentRequired ? '#/consent' : (next && next !== '#/login' ? next : '#/'); route(); } catch (err) { $('l-err2').textContent = err.message; } };
    $('l-back').onclick = () => { $('f-code').hidden = true; $('f-login').hidden = false; };
  }
  function renderConsent() {
    const n = notice;
    render(`<div class="stack" style="max-width:640px"><span class="eyebrow">Privacy notice · version ${esc(n.version)}</span><h1>Before you continue</h1><p>${esc(n.text)}</p>
      <form class="form" id="f-consent">${n.purposes.map(p => `<label class="card" style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;cursor:pointer"><input type="checkbox" name="p" value="${p.id}" ${p.required ? 'checked disabled' : 'checked'} style="margin-top:4px"><span><strong>${esc(p.title)}</strong> ${p.required ? '<span class="badge">required</span>' : '<span class="badge accent">optional</span>'}<br><span class="muted">${esc(p.text)}</span></span></label>`).join('')}
        <p class="muted" style="font-size:.88rem">Grievance officer: ${esc(n.grievanceContact)}. Withdraw consent or delete your account any time from Account.</p><button class="btn primary" type="submit">I understand and agree</button><p class="error" id="c-err"></p></form></div>`);
    $('f-consent').onsubmit = async (e) => { e.preventDefault(); const purposes = [...document.querySelectorAll('input[name=p]:checked')].map(i => i.value); try { await api('POST', '/api/consent', { version: n.version, purposes }); await refreshMe(); await flushPending(); const next = sessionStorage.getItem('fz.next'); sessionStorage.removeItem('fz.next'); location.hash = next && next !== '#/login' ? next : '#/'; route(); } catch (err) { $('c-err').textContent = err.message; } };
  }
  async function flushPending() { let p = null; try { p = JSON.parse(sessionStorage.getItem('fz.pending') || 'null'); sessionStorage.removeItem('fz.pending'); } catch { } if (p && me) { const list = Array.isArray(p) ? p : [p]; try { for (const r of list) await api('POST', '/api/sessions', r); toast(list.length > 1 ? `${list.length} sets saved` : 'Your set was saved'); } catch { } } }

  /* ================= MEMBER ================= */
  async function renderDashboard() {
    await refreshMe(); await loadExercises(); /* entitlements can change between views (purchase, curator send) */ const d = await api('GET', '/api/routines'); const hist = (await api('GET', '/api/sessions')).sessions.slice(0, 5); const conns = (await api('GET', '/api/connections')).connections;
    const pending = conns.filter(c => c.status === 'requested' && c.requestedBy !== me.id);
    render(`<div class="stack"><div><span class="eyebrow">${ent.tier === 'pro' ? 'Pro member' : 'Free member'} · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span><h1>Hello${me.name ? ', ' + esc(me.name.split(' ')[0]) : ''}</h1></div>
      ${pending.length ? `<div class="card"><h3>Curator invitations</h3>${pending.map(c => `<div class="row" style="margin-top:6px"><span><strong>${esc(c.curatorName)}</strong> ${c.curatorVerified ? '<span class="badge good">verified</span>' : ''}<br><span class="meta">${esc(c.message || '')}</span></span><div class="spacer"></div><button class="btn primary small" data-accept="${c.id}">Accept</button><button class="btn ghost small" data-decline="${c.id}">Decline</button></div>`).join('')}</div>` : ''}
      ${d.sent.length ? `<h2>From your curator${d.sent.length > 1 ? 's' : ''}</h2><div class="list">${d.sent.map(s => `<div class="card"><div class="row"><strong>${esc(s.routine.title)}</strong><span class="badge accent">from ${esc(s.curatorName)}</span><div class="spacer"></div><span class="meta">${fmtDay(s.sentAt)}</span></div>${s.message ? `<p class="notice" style="margin-top:6px">${esc(s.message)}</p>` : ''}<div class="list" style="margin-top:8px">${s.routine.items.map(it => { const cat = exById(it.exerciseId); return `<div class="item-row"><span class="glyph"></span><span><strong>${esc(cat.name)}</strong><br><span class="meta">${esc(optionSummary(cat, it.options))}${it.notes ? ' · 📝 ' + esc(it.notes) : ''}</span></span><a class="btn primary small" href="#/exercise/${it.exerciseId}/item-${s.routine.id}_${it.id}">Start</a></div>`; }).join('')}</div></div>`).join('')}</div>` : ''}
      ${d.mine.length ? `<h2>My routines</h2><div class="list">${d.mine.map(routineCard).join('')}</div>` : ''}
      ${!d.sent.length && !d.mine.length ? `<div class="card"><h3>No routine yet</h3><p class="muted">Pick a <a href="#/routines">prebuilt routine</a>, ${ent.canBuild ? '<a href="#/build">build your own</a>' : 'go Pro to build your own'}, or <a href="#/curators">find a curator</a> to send you one.</p></div>` : ''}
      ${ent.canBuild ? '<a class="btn ghost small" href="#/build" style="justify-self:start">Build a routine</a>' : upgradeCard('Want your own routine?')}
      <h2>Recent sets</h2>${hist.length ? `<div class="list">${hist.map(s => sessionCard(s)).join('')}</div><a class="btn ghost small" href="#/history" style="justify-self:start">Full history →</a>` : '<p class="muted">Nothing yet. Start any exercise and save it.</p>'}</div>`);
    wireSessionCards(view, Object.fromEntries(hist.map(s => [s.id, s])));
    view.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => { await api('PATCH', '/api/connections/' + b.dataset.accept, { status: 'accepted' }); toast('Connected'); route(); });
    view.querySelectorAll('[data-decline]').forEach(b => b.onclick = async () => { await api('PATCH', '/api/connections/' + b.dataset.decline, { status: 'declined' }); route(); });
  }
  async function renderHistory() {
    await loadExercises(); const url = new URLSearchParams(location.hash.split('?')[1] || ''); const exf = url.get('exercise') || '';
    const d = await api('GET', '/api/sessions' + (exf ? '?exercise=' + exf : '')); const byId = Object.fromEntries(d.sessions.map(s => [s.id, s]));
    const done = {}; d.sessions.forEach(s => done[s.exerciseId] = (done[s.exerciseId] || 0) + 1);
    render(`<div class="stack"><h1>History</h1><div class="tabs"><button aria-pressed="${!exf}" data-ex="">All</button>${Object.keys(done).map(id => `<button aria-pressed="${exf === id}" data-ex="${id}">${esc((exById(id) || {}).name || id)} (${done[id]})</button>`).join('')}</div>
      ${d.sessions.length ? progressChart(d.sessions) + `<div class="list">${d.sessions.map(s => sessionCard(s)).join('')}</div>` : '<p class="muted">No saved sets yet.</p>'}</div>`);
    view.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { location.hash = '#/history' + (b.dataset.ex ? '?exercise=' + b.dataset.ex : ''); });
    wireSessionCards(view, byId, (s) => `<div class="form" style="margin-top:8px"><label class="field"><span>Note</span><textarea class="h-note" maxlength="1000">${esc(s.note || '')}</textarea></label><button class="btn ghost small h-save" style="justify-self:start">Save note</button></div>`, (det, s) => { det.querySelector('.h-save').onclick = async () => { await api('PATCH', '/api/sessions/' + s.id, { note: det.querySelector('.h-note').value }); toast('Saved'); route(); }; });
  }
  function progressChart(sessions) {
    const pts = sessions.slice(0, 30).reverse(); if (pts.length < 2) return '';
    const W = 600, H = 120, pad = 8; const xs = pts.map((_, i) => pad + i * (W - 2 * pad) / (pts.length - 1)); const ys = pts.map(s => H - pad - ((s.review.score || 0) / 100) * (H - 2 * pad));
    return `<div class="card"><h3>Form score, last ${pts.length} sets</h3><svg class="trace" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:120px"><line x1="0" y1="${H - pad - 0.75 * (H - 2 * pad)}" x2="${W}" y2="${H - pad - 0.75 * (H - 2 * pad)}"></line><path d="${xs.map((x, i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ')}"></path>${xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="3" fill="var(--accent)"></circle>`).join('')}</svg><p class="meta">Dotted line = 75 (good). Newest on the right.</p></div>`;
  }
  async function renderNotes() {
    await loadExercises(); const d = await api('GET', '/api/notes');
    render(`<div class="stack"><h1>Notes</h1><div class="card"><form class="form" id="f-note"><label class="field"><span>New note</span><textarea name="text" maxlength="4000" required placeholder="How the knee felt, what the physio said, what to try next…"></textarea></label><div class="cols"><label class="field"><span>About (optional)</span><select name="exerciseId"><option value="">General</option>${exercises.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label></div><button class="btn primary small" type="submit" style="justify-self:start">Add note</button></form></div>
      ${d.notes.length ? `<div class="list">${d.notes.map(n => `<div class="card" data-nid="${n.id}"><div class="row"><span class="meta">${fmtDate(n.updatedAt)}${n.exerciseName ? ' · ' + esc(n.exerciseName) : ''}</span><div class="spacer"></div><button class="btn ghost tiny n-edit">Edit</button><button class="btn ghost tiny n-del">Delete</button></div><p style="white-space:pre-wrap;margin-top:6px" class="n-text">${esc(n.text)}</p></div>`).join('')}</div>` : '<p class="muted">No notes yet.</p>'}</div>`);
    $('f-note').onsubmit = async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target).entries()); try { await api('POST', '/api/notes', { text: fd.text, exerciseId: fd.exerciseId || undefined }); route(); } catch (err) { toast(err.message); } };
    view.querySelectorAll('[data-nid]').forEach(card => { const id = card.dataset.nid; card.querySelector('.n-del').onclick = async () => { if (confirm('Delete this note?')) { await api('DELETE', '/api/notes/' + id); route(); } };
      card.querySelector('.n-edit').onclick = () => { const p = card.querySelector('.n-text'); const ta = document.createElement('textarea'); ta.value = p.textContent; ta.maxLength = 4000; p.replaceWith(ta); const b = card.querySelector('.n-edit'); b.textContent = 'Save'; b.onclick = async () => { await api('PATCH', '/api/notes/' + id, { text: ta.value }); route(); }; }; });
  }
  async function renderMyRoutines() {
    if (!ent.canBuild) return render(`<div class="stack"><h1>My routines</h1>${upgradeCard('Building routines needs Pro or Curator')}</div>`);
    await loadExercises(); const d = await api('GET', '/api/routines');
    render(`<div class="stack"><div class="row"><h1>My routines</h1><div class="spacer"></div><a class="btn primary small" href="#/build/new">+ New routine</a></div>${d.mine.length ? `<div class="list">${d.mine.map(r => `<div class="card"><div class="row"><a href="#/routine/${r.id}" style="font-weight:600;color:inherit;text-decoration:none">${esc(r.title)}</a><span class="meta">${r.items.length} exercises · updated ${fmtDay(r.updatedAt)}</span><div class="spacer"></div><a class="btn ghost small" href="#/build/${r.id}">Edit</a>${me.role === 'curator' ? `<a class="btn ghost small" href="#/curator?send=${r.id}">Send</a>` : ''}</div></div>`).join('')}</div>` : '<p class="muted">Nothing built yet. Start from scratch or copy a <a href="#/routines">prebuilt routine</a>.</p>'}</div>`);
  }
  async function renderBuilder(id) {
    if (!ent.canBuild) return render(`<div class="stack">${upgradeCard('Building routines needs Pro or Curator')}</div>`);
    await loadExercises(); let r = null; if (id !== 'new') { try { r = (await api('GET', '/api/routines/' + id)).routine; if (r.ownerId !== me.id) r = null; } catch { } if (!r) return render('<div class="card"><h3>Routine not found</h3></div>'); }
    let items = r ? r.items.map(i => ({ ...i })) : []; let title = r ? r.title : '', description = r ? r.description || '' : '';
    const draw = () => {
      render(`<div class="stack"><div class="row"><a class="btn ghost small" href="#/build">← My routines</a></div><h1>${r ? 'Edit routine' : 'New routine'}</h1>
        <div class="card form"><div class="cols"><label class="field"><span>Title</span><input type="text" id="rb-title" value="${esc(title)}" maxlength="120" placeholder="e.g. Knee week 3"></label></div><label class="field"><span>Description / instructions</span><textarea id="rb-desc" maxlength="2000">${esc(description)}</textarea></label></div>
        <div class="list" id="rb-items">${items.length ? items.map((it, i) => itemEditorHtml(it, i, items.length)).join('') : '<p class="muted">Add exercises below.</p>'}</div>
        <div class="card"><h3>Add exercise</h3><div class="row">${exercises.map(ex => `<button class="btn ghost small" data-add="${ex.id}">${esc(ex.name)}</button>`).join('')}</div></div>
        <div class="row"><button class="btn primary" id="rb-save">${r ? 'Save' : 'Create routine'}</button>${r ? '<button class="btn ghost" id="rb-archive">Delete</button>' : ''}</div><p class="error" id="rb-err"></p></div>`);
      $('rb-title').oninput = (e) => title = e.target.value; $('rb-desc').oninput = (e) => description = e.target.value;   // keep text across redraws
      view.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const ex = exById(b.dataset.add); const o = { target: ex.defaultTarget, sets: 1 }; ex.options.forEach(op => o[op.key] = op.default); items.push({ exerciseId: ex.id, options: o, notes: '' }); draw(); });
      view.querySelectorAll('[data-i]').forEach(node => { const i = Number(node.dataset.i); const it = items[i];
        node.querySelectorAll('[data-target]').forEach(c => c.onclick = () => { it.options.target = Number(c.dataset.target); draw(); });
        node.querySelectorAll('[data-opt]').forEach(c => c.onclick = () => { const [k, vv] = c.dataset.opt.split(':'); it.options[k] = isNaN(vv) ? vv : Number(vv); draw(); });
        node.querySelector('.it-sets').onchange = (e) => it.options.sets = Math.max(1, Math.min(10, Number(e.target.value) || 1));
        node.querySelector('.it-rest').onchange = (e) => it.options.rest = Number(e.target.value);
        node.querySelector('.it-notes').oninput = (e) => it.notes = e.target.value;
        const ct = node.querySelector('.it-custom'); if (ct) ct.onchange = (e) => { const n = Number(e.target.value); if (n > 0) { it.options.target = n; draw(); } };
        node.querySelector('.it-up').onclick = () => { if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }; node.querySelector('.it-down').onclick = () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } }; node.querySelector('.it-remove').onclick = () => { items.splice(i, 1); draw(); }; });
      $('rb-save').onclick = async () => { title = $('rb-title').value; description = $('rb-desc').value; $('rb-err').textContent = ''; const payload = { title, description, items: items.map(it => ({ id: it.id, exerciseId: it.exerciseId, options: it.options, notes: it.notes })) };
        try { const d = r ? await api('PATCH', '/api/routines/' + r.id, payload) : await api('POST', '/api/routines', payload); toast(r ? 'Saved' : 'Routine created'); location.hash = '#/routine/' + d.routine.id; } catch (err) { $('rb-err').textContent = err.message; } };
      const del = $('rb-archive'); if (del) del.onclick = async () => { if (confirm('Delete this routine?')) { await api('PATCH', '/api/routines/' + r.id, { archived: true }); location.hash = '#/build'; } };
    };
    draw();
  }
  function itemEditorHtml(it, i, n) {
    const ex = exById(it.exerciseId); const o = it.options;
    return `<div class="card editor-item" data-i="${i}"><div class="head"><h3>${esc(ex.name)}</h3><span class="badge">${ex.type === 'reps' ? 'reps' : 'hold'} · ${ex.view === 'front' ? 'face camera' : 'side-on'}</span><button class="btn ghost tiny it-up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn ghost tiny it-down" ${i === n - 1 ? 'disabled' : ''}>↓</button><button class="btn ghost tiny it-remove">Remove</button></div>
      <div><span class="meta">${ex.type === 'reps' ? 'Reps per set' : 'Hold seconds'}</span><div class="opts">${ex.targets.map(t => `<button class="chip" data-target="${t}" aria-pressed="${o.target === t}">${t}${ex.type === 'hold' ? ' s' : ''}</button>`).join('')}<input class="it-custom" type="number" min="1" max="600" placeholder="custom" style="width:110px;min-height:40px" value="${ex.targets.includes(o.target) ? '' : o.target}"></div></div>
      ${ex.options.map(op => `<div><span class="meta">${esc(op.label)}</span><div class="opts">${op.values.map(vv => `<button class="chip" data-opt="${op.key}:${vv}" aria-pressed="${o[op.key] === vv}">${optLabel(op, vv)}</button>`).join('')}</div></div>`).join('')}
      <div style="display:grid;grid-template-columns:90px 110px 1fr;gap:12px;align-items:start"><label class="field"><span>Sets</span><input class="it-sets" type="number" min="1" max="10" value="${o.sets || 1}"></label><label class="field"><span>Rest</span><select class="it-rest">${[30, 45, 60, 90, 120].map(r => `<option value="${r}" ${(o.rest || 60) === r ? 'selected' : ''}>${r} s</option>`).join('')}</select></label><label class="field"><span>Notes / watch-outs</span><textarea class="it-notes" maxlength="1000" placeholder="e.g. only to 75° this week">${esc(it.notes || '')}</textarea></label></div></div>`;
  }
  async function renderConnections() {
    const d = await api('GET', '/api/connections');
    render(`<div class="stack"><h1>Curators</h1>${d.connections.length ? `<div class="list">${d.connections.map(c => `<div class="card"><div class="row"><strong>${esc(c.curatorName)}</strong>${c.curatorVerified ? '<span class="badge good">verified</span>' : ''}<span class="badge ${c.status === 'accepted' ? 'good' : c.status === 'requested' ? 'warn' : ''}">${c.status}</span><div class="spacer"></div>${c.status === 'requested' && c.requestedBy !== me.id ? `<button class="btn primary small" data-accept="${c.id}">Accept</button>` : ''}${c.status !== 'ended' && c.status !== 'declined' ? `<button class="btn ghost small" data-end="${c.id}">${c.status === 'requested' ? 'Withdraw' : 'End'}</button>` : ''}</div>${c.message ? `<p class="meta" style="margin-top:4px">${esc(c.message)}</p>` : ''}</div>`).join('')}</div>` : '<p class="muted">No connections yet. <a href="#/curators">Find a curator</a>.</p>'}</div>`);
    view.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => { await api('PATCH', '/api/connections/' + b.dataset.accept, { status: 'accepted' }); route(); }); view.querySelectorAll('[data-end]').forEach(b => b.onclick = async () => { if (confirm('End this connection? Routines they sent will be archived.')) { await api('PATCH', '/api/connections/' + b.dataset.end, { status: 'ended' }); route(); } });
  }
  async function renderAccount() {
    const subs = me.subscriptions;
    render(`<div class="stack" style="max-width:640px"><h1>Account</h1>
      <div class="card"><form class="form" id="f-acc"><div class="cols"><label class="field"><span>Name</span><input type="text" name="name" value="${esc(me.name || '')}" maxlength="120"></label><label class="field"><span>Sign-in</span><input type="text" value="${esc(me.identifier)}" disabled></label></div><button class="btn primary small" type="submit" style="justify-self:start">Save</button></form></div>
      <div class="card"><h3>Plan</h3><p><strong>${esc(ent.tier === 'anon' ? 'Free' : ent.tier)}</strong>${subs.filter(s => s.active).map(s => ` · ${esc(s.title)} until ${fmtDay(s.periodEnd)}${s.status === 'cancelled' ? ' (not renewing)' : ''}`).join('')}</p><div class="row" style="margin-top:8px"><a class="btn ghost small" href="#/pricing">${subs.some(s => s.active) ? 'Extend or change plan' : 'See plans'}</a>${subs.filter(s => s.active && s.status === 'active').map(s => `<button class="btn ghost small" data-cancel="${s.id}">Cancel ${esc(s.title)}</button>`).join('')}</div>${subs.length ? `<table class="plain" style="margin-top:10px"><thead><tr><th>Plan</th><th>Status</th><th>Until</th><th>Paid</th></tr></thead><tbody>${subs.map(s => `<tr><td>${esc(s.title)} (${esc(s.period)})</td><td>${esc(s.status)}</td><td>${fmtDay(s.periodEnd)}</td><td>${rupees(s.amountPaise)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
      ${me.role === 'member' ? `<div class="card"><h3>Are you a physio or trainer?</h3><p class="muted" style="font-size:.9rem">Switch to a curator account to get a listing and send routines to clients. Your history stays.</p><button class="btn ghost small" id="acc-curator" style="margin-top:8px">Switch to curator account</button></div>` : ''}
      <div class="card"><h3>Coach settings (this device)</h3><div class="form cols"><label class="field"><span>Pose model</span><select id="cs-model"><option value="lite">Lite (fast)</option><option value="full">Full (precise)</option></select></label><label class="field"><span>Smoothing</span><select id="cs-smooth"><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></select></label><label class="field"><span>Voice cues</span><select id="cs-voice"><option value="on">On</option><option value="off">Off</option></select></label><label class="field"><span>Voice</span><select id="cs-voicename"><option value="auto">Auto (most natural available)</option></select></label></div><div class="row" style="margin-top:8px"><button class="btn ghost small" id="cs-test">Hear a sample</button></div></div>
      <div class="card"><h3>How it works</h3><p class="muted">The three steps of a session: position the camera, follow the voice, review the set.</p><div class="row" style="margin-top:8px"><button class="btn ghost small" id="cs-intro">Show me again</button></div></div>
      <div class="card"><h3>Privacy</h3><label class="row"><input type="checkbox" id="acc-diag" ${me.prefs.store_diagnostics !== false ? 'checked' : ''}> <span>Store movement keypoints (never video) to improve the coach</span></label><div class="row" style="margin-top:10px"><a class="btn ghost small" href="/api/me/export" download="fyzio-my-data.json">Download my data</a>${me.status === 'erasure_requested' ? '<button class="btn ghost small" id="acc-cancel-erase">Cancel deletion</button>' : '<button class="btn danger small" id="acc-erase">Delete my account</button>'}</div><p class="meta" style="margin-top:8px">Grievances: ${esc(notice.grievanceContact)} · Notice v${esc(me.consentVersion || '')}</p></div></div>`);
    $('f-acc').onsubmit = async (e) => { e.preventDefault(); await api('PATCH', '/api/me', { name: e.target.name.value }); await refreshMe(); toast('Saved'); route(); };
    wireCoachSettings();
    $('acc-diag').onchange = async () => { await api('PATCH', '/api/me', { prefs: { store_diagnostics: $('acc-diag').checked } }); await refreshMe(); toast('Saved'); };
    view.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => { if (confirm('Cancel? You keep access until the period ends.')) { await api('POST', '/api/billing/cancel', { subscriptionId: b.dataset.cancel }); await refreshMe(); route(); } });
    const ac = $('acc-curator'); if (ac) ac.onclick = async () => { if (confirm('Switch to a curator account?')) { await api('PATCH', '/api/me', { role: 'curator' }); await refreshMe(); location.hash = '#/curator-profile'; } };
    if ($('acc-erase')) $('acc-erase').onclick = async () => { if (confirm('Request deletion of your account and all data? It is erased after the grace period unless you cancel.')) { await api('POST', '/api/me/erasure', {}); await refreshMe(); route(); } };
    if ($('acc-cancel-erase')) $('acc-cancel-erase').onclick = async () => { await api('POST', '/api/me/erasure', { cancel: true }); await refreshMe(); route(); };
  }

  function renderSettings() {
    render(`<div class="stack" style="max-width:640px"><h1>Settings</h1>
      <div class="card"><h3>Coach (this device)</h3><div class="form cols"><label class="field"><span>Pose model</span><select id="cs-model"><option value="lite">Lite (fast)</option><option value="full">Full (precise)</option></select></label><label class="field"><span>Smoothing</span><select id="cs-smooth"><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></select></label><label class="field"><span>Voice cues</span><select id="cs-voice"><option value="on">On</option><option value="off">Off</option></select></label><label class="field"><span>Voice</span><select id="cs-voicename"><option value="auto">Auto</option></select></label></div><div class="row" style="margin-top:8px"><button class="btn ghost small" id="cs-test">Hear a sample</button></div></div>
      <div class="card"><h3>How it works</h3><p class="muted">The three steps of a session: position the camera, follow the voice, review the set.</p><div class="row" style="margin-top:8px"><button class="btn ghost small" id="cs-intro">Show me again</button></div></div>
      <div class="card"><h3>Privacy</h3><p class="muted">Camera video is processed on this device and never uploaded. Nothing is stored anywhere but this browser.</p></div></div>`);
    wireCoachSettings();
  }
  function wireCoachSettings() {
    for (const k of ['model', 'smooth', 'voice']) { const el = $('cs-' + k); el.value = FyzioCoach.settings[k]; el.onchange = () => FyzioCoach.setSetting(k, el.value); }
    const fillVoices = () => { const sel = $('cs-voicename'); if (!sel) return; const cur = FyzioCoach.settings.voiceName || 'auto'; const auto = FyzioCoach.pickVoice(); sel.innerHTML = `<option value="auto">Auto${auto ? ' — ' + esc(auto.name) : ''}</option>` + FyzioCoach.listVoices().map(v => `<option value="${esc(v.name)}" ${v.name === cur ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join(''); sel.value = cur; };
    fillVoices(); setTimeout(fillVoices, 800); $('cs-voicename').onchange = () => FyzioCoach.setSetting('voiceName', $('cs-voicename').value);
    $('cs-test').onclick = () => { FyzioCoach.voice.unlock(); FyzioCoach.voice.muted = false; FyzioCoach.voice.say('Nice and slow. Keep the elbow at your side. Three, four, five.', { priority: 2 }); FyzioCoach.voice.muted = FyzioCoach.settings.voice === 'off'; };
  }
  /* ================= CURATOR ================= */
  async function renderCuratorHome() {
    if (me.role !== 'curator' && me.role !== 'admin') return renderDashboard();
    await loadExercises(); const conns = (await api('GET', '/api/connections')).connections; const mine = (await api('GET', '/api/routines')).mine; const pre = (await api('GET', '/api/routines/prebuilt')).routines;
    const url = new URLSearchParams(location.hash.split('?')[1] || ''); const sendId = url.get('send');
    const requests = conns.filter(c => c.status === 'requested' && c.requestedBy !== me.id), members = conns.filter(c => c.status === 'accepted'), sentReq = conns.filter(c => c.status === 'requested' && c.requestedBy === me.id);
    render(`<div class="stack"><div><span class="eyebrow">Curator</span><h1>My members</h1>${ent.curator ? '' : `<div class="card upgrade"><h3>Your Curator plan is not active</h3><p class="muted">You can build routines for yourself, but listing, accepting members and sending routines need the Curator plan.</p><a class="btn primary small" href="#/pricing" style="margin-top:8px">Activate</a></div>`}</div>
      ${requests.length ? `<div class="card"><h3>Requests (${requests.length})</h3>${requests.map(c => `<div class="row" style="margin-top:8px"><span><strong>${esc(c.memberName)}</strong><br><span class="meta">${esc(c.message || '')}</span></span><div class="spacer"></div><button class="btn primary small" data-accept="${c.id}">Accept</button><button class="btn ghost small" data-decline="${c.id}">Decline</button></div>`).join('')}</div>` : ''}
      <div class="card"><h3>Invite a member</h3><p class="muted" style="font-size:.9rem">They need a ${esc(env.appName || 'Fyzio')} account first (free). Enter the mobile number or email they signed up with.</p><form class="form" id="f-invite" style="margin-top:8px"><div class="cols"><input type="text" name="memberIdentifier" placeholder="+91 … or email" required><input type="text" name="message" placeholder="Message (optional)" maxlength="500"></div><button class="btn ghost small" type="submit" style="justify-self:start">Send invitation</button><p class="error" id="inv-err"></p></form>${sentReq.length ? `<p class="meta" style="margin-top:8px">Pending: ${sentReq.map(c => esc(c.memberName)).join(', ')}</p>` : ''}</div>
      <h2>Members (${members.length})</h2>${members.length ? `<div class="list">${members.map(c => `<div class="card"><div class="row"><a href="#/curator-member/${c.memberId}" style="font-weight:600;color:inherit;text-decoration:none">${esc(c.memberName)}</a><span class="meta">${c.memberSessionsThisWeek} sets this week · since ${fmtDay(c.updatedAt)}</span><div class="spacer"></div><button class="btn primary small" data-send="${c.memberId}" data-name="${esc(c.memberName)}">Send routine</button><a class="btn ghost small" href="#/curator-member/${c.memberId}">Sessions</a></div><div class="send-slot"></div></div>`).join('')}</div>` : '<p class="muted">No members yet. Accept requests from your <a href="#/curator-profile">listing</a> or invite someone above.</p>'}</div>`);
    view.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => { try { await api('PATCH', '/api/connections/' + b.dataset.accept, { status: 'accepted' }); toast('Accepted'); route(); } catch (e) { toast(e.message, 5000); if (e.upgrade) location.hash = '#/pricing'; } });
    view.querySelectorAll('[data-decline]').forEach(b => b.onclick = async () => { await api('PATCH', '/api/connections/' + b.dataset.decline, { status: 'declined' }); route(); });
    $('f-invite').onsubmit = async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target).entries()); try { await api('POST', '/api/connections', fd); toast('Invitation sent'); route(); } catch (err) { $('inv-err').textContent = err.message; } };
    const options = [...mine.map(r => ({ id: r.id, label: r.title + ' (mine)' })), ...pre.map(r => ({ id: r.id, label: r.title + ' (prebuilt)' }))];
    view.querySelectorAll('[data-send]').forEach(b => b.onclick = () => { const slot = b.closest('.card').querySelector('.send-slot'); slot.innerHTML = `<form class="form" style="margin-top:10px"><div class="cols"><label class="field"><span>Routine</span><select name="routineId">${options.map(o => `<option value="${o.id}" ${o.id === sendId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label><label class="field"><span>Message to ${esc(b.dataset.name)}</span><input type="text" name="message" maxlength="1000" placeholder="e.g. twice a day this week"></label></div><div class="row"><button class="btn primary small" type="submit">Send</button><button class="btn ghost small" type="button" class="cancel">Cancel</button></div><p class="error"></p></form>`;
      const f = slot.querySelector('form'); f.querySelector('button[type=button]').onclick = () => slot.innerHTML = ''; f.onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/api/curator/send', { routineId: f.routineId.value, memberId: b.dataset.send, message: f.message.value }); toast('Routine sent'); slot.innerHTML = '<p class="ok">Sent.</p>'; } catch (err) { f.querySelector('.error').textContent = err.message; } }; });
  }
  async function renderCuratorMember(id) {
    await loadExercises(); let d; try { d = await api('GET', '/api/curator/members/' + id); } catch (e) { return render(`<div class="card"><h3>${esc(e.message)}</h3></div>`); } const byId = Object.fromEntries(d.sessions.map(s => [s.id, s]));
    render(`<div class="stack"><div class="row"><a class="btn ghost small" href="#/curator">← My members</a></div><h1>${esc(d.member.name)}</h1><p class="muted">Connected since ${fmtDay(d.member.connectedSince)}. You see sets from routines you sent; nothing else.</p>
      <h2>Routines sent</h2>${d.assignments.length ? `<div class="list">${d.assignments.map(a => `<div class="card"><div class="row"><a href="#/routine/${a.routineId}" style="font-weight:600;color:inherit;text-decoration:none">${esc(a.title)}</a><span class="badge ${a.status === 'active' ? 'good' : ''}">${a.status}</span><span class="meta">${fmtDay(a.sentAt)}</span><div class="spacer"></div>${a.status === 'active' ? `<button class="btn ghost tiny" data-archive="${a.id}">Archive</button>` : ''}</div>${a.message ? `<p class="meta">${esc(a.message)}</p>` : ''}</div>`).join('')}</div>` : '<p class="muted">None yet — send one from My members.</p>'}
      <h2>Sessions (${d.sessions.length})</h2>${d.sessions.length ? progressChart(d.sessions) + `<div class="list">${d.sessions.map(s => sessionCard(s)).join('')}</div>` : '<p class="muted">No sets completed yet.</p>'}</div>`);
    view.querySelectorAll('[data-archive]').forEach(b => b.onclick = async () => { await api('PATCH', '/api/curator/assignments/' + b.dataset.archive, { status: 'archived' }); route(); });
    wireSessionCards(view, byId, (s) => `<div class="form" style="margin-top:8px"><label class="field"><span>Comment to ${esc(d.member.name)}</span><textarea class="cm-c" maxlength="2000">${esc(s.curatorComment || '')}</textarea></label><button class="btn primary small cm-save" style="justify-self:start">Send comment</button><p class="error cm-err"></p></div>`, (det, s) => { det.querySelector('.cm-save').onclick = async () => { try { await api('PATCH', `/api/curator/sessions/${s.id}/comment`, { comment: det.querySelector('.cm-c').value }); toast('Sent'); route(); } catch (err) { det.querySelector('.cm-err').textContent = err.message; } }; });
  }
  async function renderCuratorProfileEditor() {
    if (me.role !== 'curator' && me.role !== 'admin') return renderAccount();
    const d = await api('GET', '/api/curator/profile'); const p = d.profile || {};
    render(`<div class="stack" style="max-width:720px"><h1>My listing</h1><p class="muted">${d.listedNow ? (p.listed ? 'You are listed in Find a curator.' : 'Your plan is active — tick "Show my listing" below to appear in the directory.') : 'Activate the Curator plan to appear in the directory and accept members. You can fill this in now.'}</p>
      <form class="card form" id="f-cp"><div class="cols"><label class="field"><span>Display name</span><input type="text" name="displayName" value="${esc(p.displayName || '')}" required maxlength="80"></label><label class="field"><span>Type</span><select name="kind">${['physiotherapist', 'trainer', 'coach', 'other'].map(k => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label><label class="field"><span>Headline</span><input type="text" name="headline" value="${esc(p.headline || '')}" maxlength="120" placeholder="e.g. Sports physio — knees, runners"></label><label class="field"><span>City</span><input type="text" name="city" value="${esc(p.city || '')}" maxlength="60"></label><label class="field"><span>Credentials (self-declared)</span><input type="text" name="credentials" value="${esc(p.credentials || '')}" maxlength="300" placeholder="e.g. BPT, MPT (Sports), IAP reg. no."></label><label class="field"><span>Languages (comma-separated)</span><input type="text" name="languages" value="${esc((p.languages || []).join(', '))}"></label><label class="field"><span>Rate / how you charge</span><input type="text" name="rateText" value="${esc(p.rateText || '')}" maxlength="120" placeholder="e.g. ₹1,200/month or free for clinic patients"></label><label class="field"><span>Website</span><input type="text" name="website" value="${esc(p.website || '')}" maxlength="200"></label><label class="field"><span>Public contact (optional)</span><input type="text" name="publicContact" value="${esc(p.publicContact || '')}" maxlength="120" placeholder="shown on your listing"></label></div>
        <div><span class="meta">Specialties (up to 6)</span><div class="opts" style="margin-top:6px">${d.specialties.map(s => `<label class="chip" style="cursor:pointer"><input type="checkbox" name="spec" value="${esc(s)}" ${(p.specialties || []).includes(s) ? 'checked' : ''} style="margin-right:6px">${esc(s)}</label>`).join('')}</div></div>
        <label class="field"><span>About you</span><textarea name="bio" maxlength="2000">${esc(p.bio || '')}</textarea></label>
        <label class="row"><input type="checkbox" name="listed" ${p.listed ? 'checked' : ''}> <span>Show my listing in Find a curator${d.listedNow ? '' : ' (needs an active Curator plan)'}</span></label>
        <div class="row"><button class="btn primary" type="submit">Save listing</button><a class="btn ghost" href="#/curator/${me.id}">Preview</a>${d.listedNow ? '' : '<a class="btn ghost" href="#/pricing">Activate Curator plan</a>'}</div><p class="error" id="cp-err"></p></form>
      <p class="muted" style="font-size:.85rem">Credentials are shown as self-declared until an admin verifies them (${p.verified ? '<strong>verified</strong>' : 'not yet verified'}). Do not claim to treat or diagnose through the app; it is a fitness tool.</p></div>`);
    $('f-cp').onsubmit = async (e) => { e.preventDefault(); const f = e.target; const body = { displayName: f.displayName.value, kind: f.kind.value, headline: f.headline.value, city: f.city.value, credentials: f.credentials.value, languages: f.languages.value.split(',').map(s => s.trim()).filter(Boolean), rateText: f.rateText.value, website: f.website.value, publicContact: f.publicContact.value, specialties: [...f.querySelectorAll('input[name=spec]:checked')].map(i => i.value), bio: f.bio.value, listed: f.listed.checked }; try { await api('PATCH', '/api/curator/profile', body); await refreshMe(); toast('Listing saved'); route(); } catch (err) { $('cp-err').textContent = err.message; } };
  }

  /* ================= ADMIN ================= */
  async function renderAdmin() {
    if (me.role !== 'admin') return renderDashboard(); const d = await api('GET', '/api/admin/overview');
    render(`<div class="stack"><h1>Admin</h1><div class="stats">${[[d.stats.members, 'members'], [d.stats.curators, 'curators'], [d.stats.activeSubs, 'active plans'], [d.stats.sessions7d, 'sets, 7 days'], [rupees(d.stats.revenuePaise30d), 'paid, 30 days']].map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div>
      <h2>Curators</h2><div class="tw"><table class="plain"><thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Plan</th><th>Listed</th><th>Verified</th><th></th></tr></thead><tbody>${d.curators.map(cu => `<tr data-cid="${cu.id}"><td><a href="#/curator/${cu.id}">${esc(cu.displayName)}</a><br><span class="meta">${esc(cu.credentials || '')}</span></td><td>${esc(cu.kind)}</td><td class="meta">${esc(cu.identifier)}</td><td>${cu.subscribed ? '<span class="badge good">active</span>' : '<span class="badge">none</span>'}</td><td>${cu.listed ? 'yes' : 'no'}</td><td>${cu.verified ? '<span class="badge good">verified</span>' : '—'}<br><span class="meta">${esc(cu.verifiedNote || '')}</span></td><td><button class="btn ghost tiny a-verify" data-v="${cu.verified ? 0 : 1}">${cu.verified ? 'Unverify' : 'Verify'}</button> <button class="btn ghost tiny a-list" data-v="${cu.listed ? 0 : 1}">${cu.listed ? 'Unlist' : 'List'}</button></td></tr>`).join('')}</tbody></table></div>
      <h2>Audit log</h2><div class="tw"><table class="plain"><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Actor</th></tr></thead><tbody>${d.audit.map(e => `<tr><td>${fmtDate(e.at)}</td><td>${esc(e.action)}</td><td class="meta">${esc(e.target_type || '')} ${esc((e.target_id || '').slice(0, 8))}</td><td class="meta">${esc((e.actor_id || '').slice(0, 8))}</td></tr>`).join('')}</tbody></table></div></div>`);
    view.querySelectorAll('.a-verify').forEach(b => b.onclick = async () => { const note = b.dataset.v === '1' ? prompt('Verification note (what you checked):') : null; await api('PATCH', '/api/admin/curators/' + b.closest('tr').dataset.cid, { verified: b.dataset.v === '1', note }); route(); });
    view.querySelectorAll('.a-list').forEach(b => b.onclick = async () => { await api('PATCH', '/api/admin/curators/' + b.closest('tr').dataset.cid, { listed: b.dataset.v === '1' }); route(); });
  }

  /* ---------- boot ---------- */
  (async () => { try { await refreshMe(); if (me && !me.consentRequired) await flushPending(); } catch (e) { console.error(e); } route(); showIntro(false); })();
  window.__portal = { get me() { return me; }, get ent() { return ent; }, api, route, refreshMe };
})();
