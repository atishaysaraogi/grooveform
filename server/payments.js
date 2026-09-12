'use strict';
// Subscriptions and payments. Two providers:
//   mock     — development/test: the order is "paid" as soon as the client confirms it (no money moves).
//   razorpay — India: server creates an Order, the browser opens Razorpay Checkout, the client posts the signed result back,
//              and Razorpay's webhook confirms independently. Both paths verify the HMAC signature before granting access.
// Subscriptions are prepaid periods (monthly/yearly), not auto-renewing mandates: simpler, no recurring-payment compliance burden,
// and the user re-buys when the period ends (the app reminds them).
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');
const c = require('./crypto');
const audit = require('./audit');
const { HttpError } = require('./http');

const now = () => Date.now();
function plan(id) { const p = config.plans[id]; if (!p) throw new HttpError(400, 'Unknown plan'); return { id, ...p }; }
function planList() { return Object.entries(config.plans).map(([id, p]) => ({ id, ...p })); }

function activeSubscription(userId, grants) {
  const rows = db.q("SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active','cancelled') AND period_end > ? ORDER BY period_end DESC").all(userId, now());
  return rows.find(r => (config.plans[r.plan] || {}).grants === grants) || null;
}
function subscriptionsOf(userId) { return db.q('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(subView); }
function subView(s) { const p = config.plans[s.plan] || {}; return { id: s.id, plan: s.plan, title: p.title, period: p.period, grants: p.grants, status: s.period_end < now() ? 'expired' : s.status, active: s.period_end > now(), startedAt: s.started_at, periodEnd: s.period_end, cancelledAt: s.cancelled_at, provider: s.provider, amountPaise: s.amount_paise }; }

// Grant (or extend) a subscription after a verified payment. Extends from the current period end if one is active.
function grant(userId, planId, provider, ref, amountPaise) {
  const p = plan(planId); const current = activeSubscription(userId, p.grants);
  const start = current ? current.period_end : now(); const end = start + p.days * 86_400_000;
  const id = c.uuid();
  db.q('INSERT INTO subscriptions(id, user_id, plan, status, started_at, period_end, provider, provider_ref, amount_paise, currency, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, userId, planId, 'active', start, end, provider, ref, amountPaise, 'INR', now());
  audit.log({ actorId: userId, action: 'subscription.granted', targetType: 'subscription', targetId: id, meta: { plan: planId, provider, periodEnd: end } });
  return db.q('SELECT * FROM subscriptions WHERE id = ?').get(id);
}

/* ---- checkout ---- */
async function createCheckout(user, planId) {
  const p = plan(planId);
  if (p.grants === 'curator' && user.role !== 'curator') throw new HttpError(400, 'Curator plans are for curator accounts. Switch your account type in Account settings first.');
  const id = c.uuid();
  if (config.paymentProvider === 'razorpay') {
    if (!config.razorpayKeyId || !config.razorpayKeySecret) throw new HttpError(500, 'Razorpay is not configured.');
    const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(config.razorpayKeyId + ':' + config.razorpayKeySecret).toString('base64'), 'content-type': 'application/json' },
      body: JSON.stringify({ amount: p.amountPaise, currency: 'INR', receipt: id, notes: { user_id: user.id, plan: planId } }) });
    const order = await r.json(); if (!r.ok) throw new HttpError(502, 'Payment provider error: ' + (order.error && order.error.description || r.status));
    db.q('INSERT INTO payments(id, user_id, plan, amount_paise, currency, provider, order_id, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, user.id, planId, p.amountPaise, 'INR', 'razorpay', order.id, 'created', now());
    return { provider: 'razorpay', orderId: order.id, keyId: config.razorpayKeyId, amountPaise: p.amountPaise, currency: 'INR', name: config.appName, description: `${p.title} · 1 ${p.period}`, prefill: { contact: user.identifier_kind === 'phone' ? c.decrypt(user.identifier_enc) : undefined, email: user.identifier_kind === 'email' ? c.decrypt(user.identifier_enc) : undefined } };
  }
  const orderId = 'mock_' + id;
  db.q('INSERT INTO payments(id, user_id, plan, amount_paise, currency, provider, order_id, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, user.id, planId, p.amountPaise, 'INR', 'mock', orderId, 'created', now());
  return { provider: 'mock', orderId, amountPaise: p.amountPaise, currency: 'INR', description: `${p.title} · 1 ${p.period}` };
}

// Client-side confirmation after Razorpay Checkout: verify HMAC(order_id|payment_id) with the key secret.
function confirmRazorpay(user, { orderId, paymentId, signature }) {
  const pay = db.q('SELECT * FROM payments WHERE order_id = ? AND user_id = ?').get(orderId, user.id); if (!pay) throw new HttpError(404, 'Order not found.');
  const expected = crypto.createHmac('sha256', config.razorpayKeySecret).update(orderId + '|' + paymentId).digest('hex');
  if (!c.safeEqual(expected, String(signature || ''))) { db.q("UPDATE payments SET status = 'failed' WHERE id = ?").run(pay.id); audit.log({ actorId: user.id, action: 'payment.signature_invalid', targetType: 'payment', targetId: pay.id }); throw new HttpError(400, 'Payment could not be verified.'); }
  return settle(pay, paymentId);
}
// Webhook from Razorpay (payment.captured / order.paid). Verified with the webhook secret. Idempotent.
function razorpayWebhook(rawBody, signature) {
  if (!config.razorpayWebhookSecret) throw new HttpError(500, 'RAZORPAY_WEBHOOK_SECRET not set');
  const expected = crypto.createHmac('sha256', config.razorpayWebhookSecret).update(rawBody).digest('hex');
  if (!c.safeEqual(expected, String(signature || ''))) throw new HttpError(400, 'Bad signature');
  const ev = JSON.parse(rawBody); const ent = ev.payload && ev.payload.payment && ev.payload.payment.entity; if (!ent) return { ignored: true };
  if (!['payment.captured', 'order.paid'].includes(ev.event)) return { ignored: ev.event };
  const pay = db.q('SELECT * FROM payments WHERE order_id = ?').get(ent.order_id); if (!pay) return { ignored: 'unknown order' };
  settle(pay, ent.id); return { ok: true };
}
function confirmMock(user, { orderId }) {
  if (config.paymentProvider !== 'mock') throw new HttpError(400, 'Mock payments are disabled.');
  const pay = db.q('SELECT * FROM payments WHERE order_id = ? AND user_id = ?').get(orderId, user.id); if (!pay) throw new HttpError(404, 'Order not found.');
  return settle(pay, 'mockpay_' + c.uuid().slice(0, 8));
}
function settle(pay, paymentId) {
  if (pay.status === 'paid') return db.q('SELECT * FROM subscriptions WHERE provider_ref = ?').get(pay.order_id);
  return db.tx(() => {
    db.q("UPDATE payments SET status = 'paid', payment_id = ?, paid_at = ? WHERE id = ?").run(paymentId, now(), pay.id);
    audit.log({ actorId: pay.user_id, action: 'payment.paid', targetType: 'payment', targetId: pay.id, meta: { plan: pay.plan, provider: pay.provider } });
    return grant(pay.user_id, pay.plan, pay.provider, pay.order_id, pay.amount_paise);
  });
}
function cancel(user, subId) {
  const s = db.q('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?').get(subId, user.id); if (!s) throw new HttpError(404, 'Subscription not found.');
  db.q("UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(now(), s.id);   // access continues to period_end
  audit.log({ actorId: user.id, action: 'subscription.cancelled', targetType: 'subscription', targetId: s.id });
}
module.exports = { planList, plan, activeSubscription, subscriptionsOf, subView, createCheckout, confirmRazorpay, confirmMock, razorpayWebhook, cancel, grant };
