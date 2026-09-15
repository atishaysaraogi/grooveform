'use strict';
// OTP delivery providers. All use fetch(); none need npm packages.
//   console — development: logs the code and returns it to the API (only outside production).
//   msg91   — Indian SMS (DLT-registered template required). https://docs.msg91.com/
//   twilio  — international SMS.
//   resend  — email OTP. https://resend.com/docs
const config = require('./config');

async function sendOtp(identifier, code) {
  const { kind, value } = identifier;
  const provider = kind === 'email' ? (config.notifyProvider === 'resend' || config.resendApiKey ? 'resend' : 'console') : config.notifyProvider;
  const text = `${code} is your OnTrack login code. It expires in ${Math.round(config.otpTtlMs / 60000)} minutes. Do not share it.`;
  switch (provider) {
    case 'console':
      console.log(`[otp] ${value}: ${code}`);
      return { delivered: 'console', devCode: config.isProd ? undefined : code };
    case 'msg91': {
      if (!config.msg91AuthKey || !config.msg91TemplateId) throw new Error('MSG91_AUTHKEY and MSG91_TEMPLATE_ID are required');
      const mobile = value.replace('+', '');
      const r = await fetch(`https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(config.msg91TemplateId)}&mobile=${mobile}&otp=${code}&otp_expiry=${Math.round(config.otpTtlMs / 60000)}`, { method: 'POST', headers: { authkey: config.msg91AuthKey, 'content-type': 'application/json' }, body: JSON.stringify({ OTP: code }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.type === 'error') throw new Error('MSG91 send failed: ' + (j.message || r.status));
      return { delivered: 'sms' };
    }
    case 'twilio': {
      if (!config.twilioSid || !config.twilioToken || !config.twilioFrom) throw new Error('TWILIO_* settings are required');
      const body = new URLSearchParams({ To: value, From: config.twilioFrom, Body: text });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' }, body });
      if (!r.ok) throw new Error('Twilio send failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return { delivered: 'sms' };
    }
    case 'resend': {
      if (!config.resendApiKey) throw new Error('RESEND_API_KEY is required');
      if (kind !== 'email') throw new Error('Resend can only deliver to email addresses; set NOTIFY_PROVIDER=msg91 or twilio for phone numbers');
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + config.resendApiKey, 'content-type': 'application/json' }, body: JSON.stringify({ from: config.emailFrom, to: [value], subject: `${code} is your OnTrack login code`, text }) });
      if (!r.ok) throw new Error('Resend send failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return { delivered: 'email' };
    }
    default: throw new Error('Unknown NOTIFY_PROVIDER ' + provider);
  }
}
module.exports = { sendOtp };
