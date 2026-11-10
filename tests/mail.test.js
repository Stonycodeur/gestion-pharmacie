// Tests : mot de passe oublié, client SMTP, notifications externes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-mail-'));
process.env.DB_FILE = join(dir, 'test.sqlite'); process.env.UPLOAD_DIR = join(dir, 'uploads'); process.env.NODE_ENV = 'test';
if (process.env.DB_DRIVER === 'mariadb') process.env.MARIADB_DATABASE = 'gp_t_' + Math.random().toString(36).slice(2, 10);
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/seed.js'], { env: process.env, stdio: 'pipe' });
const { createApp } = await import('../server/index.js');
const { run } = await import('../server/db.js');

let server, base; const PW = 'Demo#Pharma2026'; const tokens = {};
before(async () => { server = createApp(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.close(); (await import('../server/db.js')).dropDatabase(); rmSync(dir, { recursive: true, force: true }); });
async function call(method, path, body, token, headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: r.status, body: json, raw: buf, headers: r.headers };
}
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }
const pid = async (sku) => (await call('GET', `/products?q=${sku}`, null, await login('admin'))).body.data.find((p) => p.sku === sku).id;
const avail = async (id, ph = 1) => (await call('GET', `/stock?q=${(await call('GET', '/products/' + id, null, await login('admin'))).body.sku}`, null, await login('superadmin'), { 'x-pharmacy-id': String(ph) })).body.data.find((s) => s.id === id)?.available ?? 0;
const regs = {};
async function openCash(who) {
  const t = await login(who); const cur = await call('GET', '/cash/current', null, t); if (cur.body) return;
  regs[who] ||= (await call('POST', '/cash/registers', { name: 'C-' + who }, await login('admin'))).body.id;
  assert.equal((await call('POST', '/cash/open', { register_id: regs[who], opening_float: 100000 }, t)).status, 201);
}

import net from 'node:net';
const raw = (email, password) => call('POST', '/auth/login', { email, password });

test('mot de passe oublié : réponse neutre, jeton à usage unique, sessions révoquées', async () => {
  process.env.MAIL_SINK = 'memory'; globalThis.__mails = [];
  const unknown = await call('POST', '/auth/forgot', { email: 'inconnu@nulle.part' }); const known = await call('POST', '/auth/forgot', { email: 'caissier@demo.local' });
  assert.equal(unknown.status, 200); assert.deepEqual(unknown.body, known.body, 'aucune énumération de comptes');
  assert.equal(globalThis.__mails.length, 1); assert.equal(globalThis.__mails[0].to, 'caissier@demo.local');
  const token = globalThis.__mails[0].text.match(/token=([\w-]+)/)[1];
  assert.equal((await call('POST', '/auth/reset', { token, password: 'faible' })).status, 400);
  assert.equal((await call('POST', '/auth/reset', { token: 'x'.repeat(40), password: 'Nouveau#Pass2026' })).body.error.code, 'INVALID_TOKEN');
  assert.equal((await call('POST', '/auth/reset', { token, password: 'Nouveau#Pass2026' })).status, 200);
  assert.equal((await raw('caissier@demo.local', 'Nouveau#Pass2026')).status, 200);
  assert.equal((await call('POST', '/auth/reset', { token, password: 'Autre#Pass2026x' })).status, 400, 'jeton déjà utilisé');
  for (let i = 0; i < 4; i++) await call('POST', '/auth/forgot', { email: 'stock@demo.local' }); assert.equal((await call('POST', '/auth/forgot', { email: 'stock@demo.local' })).status, 429);
});
test('client SMTP : EHLO, AUTH, MAIL/RCPT/DATA contre un serveur simulé', async () => {
  const got = []; const srv = net.createServer((s) => {
    s.write('220 fake ESMTP\r\n'); let data = false, buf = '';
    s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (l === '.') { data = false; s.write('250 queued\r\n'); } else got.push(l); continue; } got.push(l);
      if (/^EHLO/.test(l)) s.write('250-fake\r\n250 AUTH PLAIN\r\n'); else if (/^AUTH/.test(l)) s.write('235 ok\r\n'); else if (/^DATA/.test(l)) { data = true; s.write('354 go\r\n'); } else if (/^QUIT/.test(l)) { s.write('221 bye\r\n'); s.end(); } else s.write('250 ok\r\n'); } });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const save = { ...process.env }; Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'Pharmacie <noreply@pharma.test>' }); delete process.env.MAIL_SINK;
  try {
    const { sendMail } = await import('../server/mailer.js'); assert.equal(await sendMail({ to: 'client@x.test', subject: 'Commande prête é', text: 'Bonjour\n.point seul\nfin' }), true);
    assert.ok(got.some((l) => l.startsWith('AUTH PLAIN'))); assert.ok(got.includes('MAIL FROM:<noreply@pharma.test>')); assert.ok(got.includes('RCPT TO:<client@x.test>'));
    assert.ok(got.some((l) => /^Subject: =\?UTF-8\?B\?/.test(l)), 'sujet accentué encodé');
    await assert.rejects(sendMail({ to: 'pas un mail', subject: 's', text: 't' }));
  } finally { Object.assign(process.env, save); srv.close(); }
});
test('notification client → e-mail', async () => {
  process.env.MAIL_SINK = 'memory'; globalThis.__mails = [];
  const { notify } = await import('../server/http.js'); const cu = (await call('GET', '/users?kind=customer&q=client@demo.local', null, await login('superadmin'))).body.data[0];
  notify({ pharmacyId: 1, userId: cu.id, kind: 'order_ready', title: 'Votre commande est prête', body: 'Retrait en pharmacie' });
  await new Promise((r) => setTimeout(r, 50)); assert.equal(globalThis.__mails.at(-1)?.to, 'client@demo.local');
  const st = (await call('GET', '/users?q=stock@demo.local', null, await login('superadmin'))).body.data[0]; const n = globalThis.__mails.length;
  notify({ pharmacyId: 1, userId: st.id, kind: 'x', title: 'Alerte interne' }); await new Promise((r) => setTimeout(r, 50)); assert.equal(globalThis.__mails.length, n, 'le personnel n\'est pas notifié par e-mail');
});
test('antivirus clamd (INSTREAM) : détecte et laisse passer', async () => {
  const mk = (verdict) => net.createServer((s) => { const chunks = []; s.on('data', (d) => { chunks.push(d); const b = Buffer.concat(chunks); if (b.length >= 4 && b.subarray(b.length - 4).equals(Buffer.alloc(4)) && b.includes('zINSTREAM')) s.end(verdict); }); });
  for (const [v, infected] of [['stream: OK\0', false], ['stream: Eicar-Test-Signature FOUND\0', true]]) {
    const srv = mk(v); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); Object.assign(process.env, { CLAMD_HOST: '127.0.0.1', CLAMD_PORT: String(srv.address().port) });
    try { const { scanBuffer } = await import('../server/antivirus.js'); const r = await scanBuffer(Buffer.from('%PDF-contenu')); assert.equal(r.infected, infected); if (infected) assert.match(r.signature, /Eicar/); } finally { srv.close(); delete process.env.CLAMD_HOST; delete process.env.CLAMD_PORT; }
  }
});
