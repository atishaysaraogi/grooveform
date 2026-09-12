'use strict';
// OTP login, sessions, rate limiting, role checks.
const config = require('./config');
const db = require('./db');
const c = require('./crypto');
const notify = require('./notify');
const { HttpError, parseCookies, clientIp, setCookie } = require('./http');
const audit = require('./audit');

const COOKIE = 'fz_session';

// Fixed-window rate limiter backed by SQLite (survives restarts, shared across workers).
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const row = db.q('SELECT count, window_start FROM rate_limits WHERE key = ?').get(key);
  if (!row || now - row.window_start > windowMs) { db.q('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES (?, 1, ?)').run(key, now); return; }
  if (row.count >= max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  db.q('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
}

function findUserByIdentifier(ident) {
  return db.q('SELECT * FROM users WHERE identifier_hash = ? AND status IN (\'active\',\'erasure_requested\')').get(c.hmac(ident.value)) || null;
}
function createUser({ role, name, ident, createdVia }) {
  const id = c.uuid(); const isAdmin = config.adminIdentifier && c.normalizeIdentifier(config.adminIdentifier)?.value === ident.value;
  db.q('INSERT INTO users(id, role, name_enc, identifier_kind, identifier_hash, identifier_enc, prefs_json, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, isAdmin ? 'admin' : role, c.encrypt(name || null), ident.kind, c.hmac(ident.value), c.encrypt(ident.value), JSON.stringify({ store_diagnostics: config.storeDiagnosticsDefault }), Date.now());
  if (role === 'curator' && !isAdmin) db.q('INSERT INTO curator_profiles(user_id, display_name, kind, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, name || 'New curator', 'trainer', Date.now(), Date.now());
  audit.log({ actorId: id, action: 'user.registered', targetType: 'user', targetId: id, meta: { role: isAdmin ? 'admin' : role, via: createdVia } });
  return db.q('SELECT * FROM users WHERE id = ?').get(id);
}

async function requestOtp(rawIdentifier, req) {
  const ident = c.normalizeIdentifier(rawIdentifier);
  if (!ident) throw new HttpError(400, 'Enter a valid mobile number (+91…) or email address.');
  const ip = clientIp(req);
  rateLimit('otp:ip:' + ip, config.otpPerIpPer15m, 15 * 60_000);
  rateLimit('otp:id:' + c.hmac(ident.value), config.otpPerIdentifierPer15m, 15 * 60_000);
  const user = findUserByIdentifier(ident);
  const disabled = !user && db.q('SELECT id FROM users WHERE identifier_hash = ?').get(c.hmac(ident.value));
  if (disabled) throw new HttpError(403, 'This account is disabled. Contact support.');
  // Anyone may request a code: unknown identifiers become new accounts when the code is verified.
  let devCode;
  {
    const code = c.otpCode();
    db.q('UPDATE otp_codes SET used_at = ? WHERE identifier_hash = ? AND used_at IS NULL').run(Date.now(), c.hmac(ident.value)); // one live code per identifier
    db.q('INSERT INTO otp_codes(id, identifier_hash, code_hash, purpose, expires_at, created_at, ip) VALUES (?,?,?,?,?,?,?)')
      .run(c.uuid(), c.hmac(ident.value), c.hmac(code + ':' + ident.value), 'login', Date.now() + config.otpTtlMs, Date.now(), ip);
    const r = await notify.sendOtp(ident, code); devCode = r.devCode;
    audit.log({ actorId: user ? user.id : null, action: user ? 'otp.requested' : 'otp.requested.new', targetType: 'user', targetId: user ? user.id : null, ip });
  }
  return { ok: true, kind: ident.kind, masked: mask(ident), existing: !!user, ...(devCode ? { devCode } : {}) };
}

function mask(ident) { return ident.kind === 'email' ? ident.value.replace(/^(.).*(@.*)$/, '$1***$2') : ident.value.replace(/^(\+\d{2})\d+(\d{2})$/, '$1******$2'); }

async function verifyOtp(rawIdentifier, code, req, res, { role = 'member', name = null } = {}) {
  const ident = c.normalizeIdentifier(rawIdentifier);
  if (!ident || !/^\d{6}$/.test(String(code || ''))) throw new HttpError(400, 'Enter the 6-digit code.');
  const ip = clientIp(req);
  rateLimit('verify:ip:' + ip, 60, 15 * 60_000);
  const row = db.q('SELECT * FROM otp_codes WHERE identifier_hash = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1').get(c.hmac(ident.value));
  const fail = () => { throw new HttpError(401, 'That code is not valid or has expired. Request a new one.'); };
  if (!row || row.expires_at < Date.now()) fail();
  if (row.attempts >= config.otpMaxAttempts) { db.q('UPDATE otp_codes SET used_at = ? WHERE id = ?').run(Date.now(), row.id); fail(); }
  if (!c.safeEqual(row.code_hash, c.hmac(code + ':' + ident.value))) { db.q('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id); fail(); }
  db.q('UPDATE otp_codes SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
  let user = findUserByIdentifier(ident); let created = false;
  if (!user) { user = createUser({ role: role === 'curator' ? 'curator' : 'member', name, ident, createdVia: 'otp' }); created = true; }
  else if (config.adminIdentifier && user.role !== 'admin' && c.normalizeIdentifier(config.adminIdentifier)?.value === ident.value) { db.q("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id); user = db.q('SELECT * FROM users WHERE id = ?').get(user.id); }
  const token = c.randomToken(32);
  db.q('INSERT INTO sessions(token_hash, user_id, created_at, expires_at, ua, ip) VALUES (?,?,?,?,?,?)').run(c.hmac(token), user.id, Date.now(), Date.now() + config.sessionTtlMs, String(req.headers['user-agent'] || '').slice(0, 200), ip);
  db.q('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  setCookie(res, COOKIE, token, { maxAgeMs: config.sessionTtlMs });
  audit.log({ actorId: user.id, action: 'login', targetType: 'user', targetId: user.id, ip, meta: { created } });
  return { ...publicUser(user), created };
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE]; if (!token) return null;
  const s = db.q('SELECT s.*, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?').get(c.hmac(token), Date.now());
  if (!s || s.status === 'disabled' || s.status === 'erased') return null;
  // sliding expiry: extend when more than a day has been used
  if (s.expires_at - Date.now() < config.sessionTtlMs - 86_400_000) db.q('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + config.sessionTtlMs, c.hmac(token));
  return s;
}
function logout(req, res) {
  const token = parseCookies(req)[COOKIE]; if (token) db.q('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').run(Date.now(), c.hmac(token));
  setCookie(res, COOKIE, '', { maxAgeMs: 0 });
}
function revokeAllSessions(userId) { db.q('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), userId); }

function publicUser(u) {
  return { id: u.id, role: u.role, name: c.decrypt(u.name_enc), identifier: c.decrypt(u.identifier_enc), identifierKind: u.identifier_kind,
    consentVersion: u.consent_version, consentRequired: u.consent_version !== config.consentVersion, prefs: JSON.parse(u.prefs_json || '{}'), status: u.status, createdAt: u.created_at };
}

// Middleware-style guards used by the API layer
function requireAuth(req) { const u = currentUser(req); if (!u) throw new HttpError(401, 'Please sign in.'); return u; }
function requireRole(req, ...roles) { const u = requireAuth(req); if (!roles.includes(u.role)) throw new HttpError(403, 'You do not have access to this.'); return u; }
function requireConsent(u) { if (u.consent_version !== config.consentVersion) throw new HttpError(428, 'Please review and accept the privacy notice first.', { consentRequired: true }); }

// Housekeeping: expired OTPs/sessions, old rate-limit rows, audit retention, and erasure grace period.
function housekeeping() {
  const now = Date.now();
  db.q('DELETE FROM otp_codes WHERE expires_at < ?').run(now - 86_400_000);
  db.q('DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?').run(now - 7 * 86_400_000, now - 7 * 86_400_000);
  db.q('DELETE FROM rate_limits WHERE window_start < ?').run(now - 3_600_000);
  db.q('DELETE FROM audit_log WHERE at < ?').run(now - config.auditRetentionDays * 86_400_000);
  db.q("UPDATE subscriptions SET status = 'expired' WHERE status = 'active' AND period_end < ?").run(now);
  const due = db.q('SELECT id FROM users WHERE status = \'erasure_requested\' AND erasure_requested_at < ?').all(now - config.retentionDaysAfterErasureRequest * 86_400_000);
  for (const u of due) require('./api').eraseUser(u.id, 'system');
}

module.exports = { requestOtp, verifyOtp, currentUser, logout, revokeAllSessions, publicUser, requireAuth, requireRole, requireConsent, housekeeping, COOKIE };
