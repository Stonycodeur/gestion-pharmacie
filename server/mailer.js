// Envoi e-mail (SMTP, sans dépendance) et SMS (webhook HTTP vers votre prestataire). Désactivés tant que non configurés.
//   SMTP_HOST, SMTP_PORT (587 STARTTLS | 465 TLS implicite | 25), SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE=true (TLS implicite), SMTP_TLS_REJECT_UNAUTHORIZED=false (tests)
//   SMS_WEBHOOK_URL, SMS_WEBHOOK_TOKEN : POST JSON { to, text } (Authorization: Bearer …)
import net from 'node:net';
import tls from 'node:tls';

export const mailEnabled = () => !!process.env.SMTP_HOST || process.env.MAIL_SINK === 'memory';
export const smsEnabled = () => !!process.env.SMS_WEBHOOK_URL;
const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export function sendMail({ to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    if (!mailEnabled()) return reject(new Error('SMTP non configuré'));
    if (process.env.MAIL_SINK === 'memory') { (globalThis.__mails ||= []).push({ to, subject, text, html }); return resolve(true); } // tests
    const host = process.env.SMTP_HOST, port = Number(process.env.SMTP_PORT) || 587, secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@localhost'; const rcpt = clean(to);
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(rcpt)) return reject(new Error('Destinataire invalide'));
    const opts = { host, port, servername: host, rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' };
    let sock = secure ? tls.connect(opts) : net.connect({ host, port }); let buf = '', step = 'greet', started = false, upgraded = secure, done = false;
    const fin = (err) => { if (done) return; done = true; try { sock.end(); } catch {} err ? reject(err) : resolve(true); };
    sock.setTimeout(20000, () => fin(new Error('SMTP : délai dépassé'))); sock.on('error', fin);
    const send = (l) => sock.write(l + '\r\n');
    const wrap = (b) => (b64(String(b)).match(/.{1,76}/g) || []);
    const head = [`From: ${from}`, `To: ${rcpt}`, `Subject: ${encHeader(clean(subject))}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0'];
    const bnd = '=_gp_' + Math.random().toString(36).slice(2);
    const msg = html
      ? [...head, `Content-Type: multipart/alternative; boundary="${bnd}"`, '', `--${bnd}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', ...wrap(text), `--${bnd}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', ...wrap(html), `--${bnd}--`].join('\r\n')
      : [...head, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', ...wrap(text)].join('\r\n');
    const onLine = (code, lines) => {
      if (code >= 400) return fin(new Error(`SMTP ${lines.join(' ')}`));
      const caps = lines.join('\n');
      switch (step) {
        case 'greet': step = 'ehlo'; return send('EHLO gestion-pharmacie');
        case 'ehlo':
          if (!upgraded && /STARTTLS/i.test(caps)) { step = 'starttls'; return send('STARTTLS'); }
          if (process.env.SMTP_USER && !started) { started = true; step = 'auth'; return send('AUTH PLAIN ' + b64(`\0${process.env.SMTP_USER}\0${process.env.SMTP_PASS || ''}`)); }
          step = 'from'; return send(`MAIL FROM:<${from.replace(/^.*<|>.*$/g, '')}>`);
        case 'starttls': sock.removeAllListeners('data'); sock = tls.connect({ ...opts, socket: sock }); sock.on('error', fin); sock.on('data', onData); upgraded = true; step = 'ehlo'; buf = ''; return send('EHLO gestion-pharmacie');
        case 'auth': step = 'from'; return send(`MAIL FROM:<${from.replace(/^.*<|>.*$/g, '')}>`);
        case 'from': step = 'rcpt'; return send(`RCPT TO:<${rcpt}>`);
        case 'rcpt': step = 'data'; return send('DATA');
        case 'data': step = 'body'; return sock.write(msg.replace(/^\./gm, '..') + '\r\n.\r\n');
        case 'body': step = 'quit'; send('QUIT'); return fin();
      }
    };
    const onData = (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); (onData.acc ||= []).push(line.slice(4)); if (line[3] === ' ' || line.length === 3) { const code = Number(line.slice(0, 3)); const acc = onData.acc; onData.acc = null; onLine(code, acc); } } };
    sock.on('data', onData);
  });
}
export async function sendSms({ to, text }) {
  if (!smsEnabled()) throw new Error('SMS non configuré');
  const r = await fetch(process.env.SMS_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.SMS_WEBHOOK_TOKEN ? { authorization: 'Bearer ' + process.env.SMS_WEBHOOK_TOKEN } : {}) }, body: JSON.stringify({ to: clean(to), text: String(text).slice(0, 480) }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('SMS : HTTP ' + r.status); return true;
}
