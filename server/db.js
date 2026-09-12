'use strict';
// SQLite via Node's built-in node:sqlite. One file, WAL mode, migrations applied on start.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('member','curator','admin')),
    name_enc TEXT, identifier_kind TEXT NOT NULL, identifier_hash TEXT NOT NULL UNIQUE, identifier_enc TEXT NOT NULL,
    prefs_json TEXT NOT NULL DEFAULT '{}',
    consent_version TEXT, consent_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active',            -- active | disabled | erasure_requested | erased
    erasure_requested_at INTEGER, created_at INTEGER NOT NULL, last_login_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS users_role ON users(role, status);
  CREATE TABLE IF NOT EXISTS curator_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    display_name TEXT NOT NULL, headline TEXT, bio TEXT, credentials TEXT, kind TEXT NOT NULL DEFAULT 'trainer',   -- physiotherapist | trainer | coach | other
    specialties_json TEXT NOT NULL DEFAULT '[]', city TEXT, languages_json TEXT NOT NULL DEFAULT '[]',
    rate_text TEXT, website TEXT, public_contact TEXT,                -- what the curator chooses to show publicly
    listed INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, verified_note TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS otp_codes (
    id TEXT PRIMARY KEY, identifier_hash TEXT NOT NULL, code_hash TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'login',
    expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used_at INTEGER, created_at INTEGER NOT NULL, ip TEXT
  );
  CREATE INDEX IF NOT EXISTS otp_ident ON otp_codes(identifier_hash, created_at);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT, ip TEXT, revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS consent_records (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), version TEXT NOT NULL, purposes_json TEXT NOT NULL, accepted_at INTEGER NOT NULL, withdrawn_at INTEGER, ip TEXT
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan TEXT NOT NULL,   -- pro_monthly | pro_yearly | curator_monthly | curator_yearly
    status TEXT NOT NULL DEFAULT 'active',            -- active | cancelled | expired
    started_at INTEGER NOT NULL, period_end INTEGER NOT NULL, cancelled_at INTEGER,
    provider TEXT NOT NULL, provider_ref TEXT, amount_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS subs_user ON subscriptions(user_id, status, period_end);
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan TEXT NOT NULL, amount_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
    provider TEXT NOT NULL, order_id TEXT NOT NULL UNIQUE, payment_id TEXT, status TEXT NOT NULL DEFAULT 'created',   -- created | paid | failed
    created_at INTEGER NOT NULL, paid_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id),           -- NULL owner = prebuilt (platform) routine
    title TEXT NOT NULL, description TEXT, tier TEXT NOT NULL DEFAULT 'free',   -- prebuilt routines: free | pro. Custom routines: 'custom'
    kind TEXT NOT NULL DEFAULT 'custom',                                -- prebuilt | custom
    tags_json TEXT NOT NULL DEFAULT '[]', archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS routines_owner ON routines(owner_id, archived);
  CREATE TABLE IF NOT EXISTS routine_items (
    id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, exercise_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    options_json TEXT NOT NULL DEFAULT '{}', notes TEXT
  );
  CREATE INDEX IF NOT EXISTS items_routine ON routine_items(routine_id, position);
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY, curator_id TEXT NOT NULL REFERENCES users(id), member_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'requested',         -- requested | accepted | declined | ended
    requested_by TEXT NOT NULL, message_enc TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(curator_id, member_id)
  );
  CREATE TABLE IF NOT EXISTS routine_assignments (
    id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id), curator_id TEXT NOT NULL REFERENCES users(id), member_id TEXT NOT NULL REFERENCES users(id),
    message_enc TEXT, status TEXT NOT NULL DEFAULT 'active',            -- active | archived
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assign_member ON routine_assignments(member_id, status);
  CREATE INDEX IF NOT EXISTS assign_curator ON routine_assignments(curator_id, status);
  CREATE TABLE IF NOT EXISTS exercise_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), exercise_id TEXT NOT NULL,
    routine_id TEXT, routine_item_id TEXT, assignment_id TEXT,
    started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'camera',
    review_json TEXT NOT NULL, diagnostics_enc TEXT, effort INTEGER, note_enc TEXT,
    curator_comment_enc TEXT, curator_commented_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sess_user_time ON exercise_sessions(user_id, finished_at);
  CREATE INDEX IF NOT EXISTS sess_assign ON exercise_sessions(assignment_id);
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), exercise_id TEXT, routine_id TEXT, text_enc TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notes_user ON notes(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_id TEXT, action TEXT NOT NULL, target_type TEXT, target_id TEXT, ip TEXT, meta_json TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_time ON audit_log(at);
  CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `,
];

let db;
function ensureMeta() { fs.mkdirSync(path.dirname(config.dbPath), { recursive: true }); const d = new DatabaseSync(config.dbPath); d.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);'); d.close(); }
function open() {
  if (db) return db;
  ensureMeta();
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const applied = Number((db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() || {}).value || 0) || 0;
  for (let i = applied; i < MIGRATIONS.length; i++) { db.exec('BEGIN'); db.exec(MIGRATIONS[i]); db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)").run(String(i + 1)); db.exec('COMMIT'); }
  return db;
}
function get() { return db || open(); }
const q = (sql) => get().prepare(sql);
function tx(fn) { const d = get(); d.exec('BEGIN'); try { const r = fn(d); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; } }
module.exports = { open, get, q, tx };
