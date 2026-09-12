'use strict';
const db = require('./db');
function log({ actorId = null, action, targetType = null, targetId = null, ip = null, meta = null }) {
  try { db.q('INSERT INTO audit_log(at, actor_id, action, target_type, target_id, ip, meta_json) VALUES (?,?,?,?,?,?,?)').run(Date.now(), actorId, action, targetType, targetId, ip, meta ? JSON.stringify(meta) : null); }
  catch (e) { console.error('[audit] failed', e.message); }
}
function list({ limit = 200, before = null } = {}) { return before ? db.q('SELECT * FROM audit_log WHERE at < ? ORDER BY at DESC LIMIT ?').all(before, limit) : db.q('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?').all(limit); }
module.exports = { log, list };
