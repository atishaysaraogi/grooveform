'use strict';
// All configuration comes from environment variables. See .env.example for the full list.
const path = require('node:path');
const crypto = require('node:crypto');

function env(name, fallback) { const v = process.env[name]; return v === undefined || v === '' ? fallback : v; }

const NODE_ENV = env('NODE_ENV', 'development');
const isProd = NODE_ENV === 'production';

const config = {
  nodeEnv: NODE_ENV,
  isProd,
  port: Number(env('PORT', 8080)),
  host: env('HOST', '0.0.0.0'),
  // Where the SQLite file lives. On Fly.io this is the mounted volume (/data).
  dbPath: env('DB_PATH', path.join(process.cwd(), 'data', 'fyzio.sqlite')),
  // 32-byte hex key for AES-256-GCM field encryption. REQUIRED in production.
  dataKey: env('DATA_KEY', ''),
  // Secret for hashing OTPs, session tokens and identifiers (HMAC). REQUIRED in production.
  appSecret: env('APP_SECRET', ''),
  // Public origin, e.g. https://fyzio-demo.fly.dev — used for cookies and links.
  publicUrl: env('PUBLIC_URL', `http://localhost:${env('PORT', 8080)}`),
  // Platform admin: this identifier is promoted to admin on first sign-in (and at boot if it already exists).
  adminIdentifier: env('ADMIN_IDENTIFIER', ''),
  appName: env('APP_NAME', 'Grooveform'),
  // Solo mode (default on for now): no accounts, plans, curators or prices are shown; everything runs anonymously on-device.
  soloMode: env('SOLO_MODE', 'true') === 'true',
  // Exercise tiers: these exercise ids are free for everyone (no account needed); the rest need Pro or a curator-sent routine.
  freeExercises: env('FREE_EXERCISES', 'all').split(',').map(s => s.trim()).filter(Boolean),   // 'all' = every exercise free
  // Payments: mock (dev/test: instant activation) | razorpay
  paymentProvider: env('PAYMENT_PROVIDER', 'mock'),
  razorpayKeyId: env('RAZORPAY_KEY_ID', ''),
  razorpayKeySecret: env('RAZORPAY_KEY_SECRET', ''),
  razorpayWebhookSecret: env('RAZORPAY_WEBHOOK_SECRET', ''),
  // Plans (paise). Change prices here; the client reads them from /api/plans.
  plans: {
    pro_monthly: { title: 'Pro', period: 'month', days: 31, amountPaise: Number(env('PRICE_PRO_MONTHLY', 29900)), grants: 'pro' },
    pro_yearly: { title: 'Pro', period: 'year', days: 366, amountPaise: Number(env('PRICE_PRO_YEARLY', 199900)), grants: 'pro' },
    curator_monthly: { title: 'Curator', period: 'month', days: 31, amountPaise: Number(env('PRICE_CURATOR_MONTHLY', 99900)), grants: 'curator' },
    curator_yearly: { title: 'Curator', period: 'year', days: 366, amountPaise: Number(env('PRICE_CURATOR_YEARLY', 799900)), grants: 'curator' },
  },
  // OTP delivery: console (dev; prints/returns the code), msg91, twilio, resend
  notifyProvider: env('NOTIFY_PROVIDER', 'console'),
  msg91AuthKey: env('MSG91_AUTHKEY', ''),
  msg91TemplateId: env('MSG91_TEMPLATE_ID', ''),
  twilioSid: env('TWILIO_ACCOUNT_SID', ''),
  twilioToken: env('TWILIO_AUTH_TOKEN', ''),
  twilioFrom: env('TWILIO_FROM', ''),
  resendApiKey: env('RESEND_API_KEY', ''),
  emailFrom: env('EMAIL_FROM', 'Groove <no-reply@example.com>'),
  // Sessions & OTP
  otpTtlMs: Number(env('OTP_TTL_MINUTES', 5)) * 60_000,
  otpMaxAttempts: 5,
  otpPerIdentifierPer15m: 5,
  otpPerIpPer15m: 20,
  sessionTtlMs: Number(env('SESSION_TTL_DAYS', 30)) * 86_400_000,
  // Data retention (DPDP: delete when purpose served; logs kept ≥ 1 year)
  retentionDaysAfterErasureRequest: Number(env('ERASURE_GRACE_DAYS', 7)),
  auditRetentionDays: Number(env('AUDIT_RETENTION_DAYS', 400)),
  // Privacy notice version shown to users; bump when the notice text changes
  consentVersion: env('CONSENT_VERSION', '2026-09-2'),
  grievanceContact: env('GRIEVANCE_CONTACT', 'privacy@example.com'),
  // Whether patients' raw keypoint diagnostics are stored (they are never video). Default on, per-patient consent toggle in the app.
  storeDiagnosticsDefault: env('STORE_DIAGNOSTICS', 'true') === 'true',
  trustProxy: env('TRUST_PROXY', isProd ? 'true' : 'false') === 'true',
};

// Development conveniences: generate ephemeral secrets so `npm start` just works, but refuse to run production without real ones.
if (!config.dataKey) { if (isProd) throw new Error('DATA_KEY is required in production (32-byte hex). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'); config.dataKey = crypto.createHash('sha256').update('dev-data-key').digest('hex'); }
if (!config.appSecret) { if (isProd) throw new Error('APP_SECRET is required in production.'); config.appSecret = 'dev-app-secret-not-for-production'; }
if (!/^[0-9a-f]{64}$/i.test(config.dataKey)) throw new Error('DATA_KEY must be 64 hex characters (32 bytes).');
if (isProd && config.paymentProvider === 'mock') console.warn('[config] PAYMENT_PROVIDER=mock in production: subscriptions activate without payment. Set PAYMENT_PROVIDER=razorpay.');
if (isProd && config.notifyProvider === 'console') console.warn('[config] NOTIFY_PROVIDER=console in production: OTP codes will only be printed to the server log.');

module.exports = config;
