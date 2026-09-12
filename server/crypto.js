'use strict';
// Field-level encryption (AES-256-GCM) for personal and clinical data at rest, plus keyed hashes for lookups.
const crypto = require('node:crypto');
const config = require('./config');

const KEY = Buffer.from(config.dataKey, 'hex');

function encrypt(text) {
  if (text === null || text === undefined || text === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1.' + Buffer.concat([iv, tag, enc]).toString('base64');
}
function decrypt(blob) {
  if (!blob) return null;
  const [v, b64] = String(blob).split('.'); if (v !== 'v1') throw new Error('unknown ciphertext version');
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
// Deterministic keyed hash for looking up a phone/email without storing it in the clear.
function hmac(value) { return crypto.createHmac('sha256', config.appSecret).update(String(value)).digest('hex'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function otpCode() { return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); }
function uuid() { return crypto.randomUUID(); }
function safeEqual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

// Identifier normalisation: Indian mobiles → +91XXXXXXXXXX; emails → lowercase.
function normalizeIdentifier(raw) {
  const s = String(raw || '').trim();
  if (s.includes('@')) { const e = s.toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null; return { kind: 'email', value: e }; }
  let d = s.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  if (!/^\d{11,15}$/.test(d)) return null;
  return { kind: 'phone', value: '+' + d };
}

module.exports = { encrypt, decrypt, hmac, randomToken, otpCode, uuid, safeEqual, normalizeIdentifier };
