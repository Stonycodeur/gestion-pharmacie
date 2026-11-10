// Tests de l'administration complète des comptes par le super-administrateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-acct-'));
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
const Y = new Date().getUTCFullYear(); const today = new Date().toISOString().slice(0, 10);
test('comptabilité : une vente + règlement génèrent des écritures équilibrées (TVA, caisse, coût)', async () => {
  const cs = await login('caissier'), ad = await login('admin'), co = await login('comptable');
  const reg = (await call('POST', '/cash/registers', { name: 'CA1' }, ad)).body.id; assert.equal((await call('POST', '/cash/open', { register_id: reg, opening_float: 1000 }, cs)).status, 201);
  const p = (await call('GET', '/products?limit=1&q=PARA', null, ad)).body.data[0];
  const before = (await call('GET', `/accounting/trial-balance?from=${Y}-01-01&to=${today}`, null, co)).body;
  const s = await call('POST', '/sales', { lines: [{ product_id: p.id, qty: 3 }], payments: [{ method: 'cash', amount: 100000 }] }, cs); assert.equal(s.status, 201, JSON.stringify(s.body));
  const tb = (await call('GET', `/accounting/trial-balance?from=${Y}-01-01&to=${today}`, null, co)).body; assert.equal(tb.balanced, true);
  const bal = (b, c) => b.data.find((x) => x.code === c)?.balance || 0;
  assert.equal(bal(tb, '707') - bal(before, '707') + bal(tb, '4457') - bal(before, '4457'), s.body.total); // ventes HT + TVA = total TTC
  assert.equal(bal(tb, '531') - bal(before, '531'), s.body.total); // encaissé en espèces
  assert.equal(bal(tb, '411') - bal(before, '411'), 0); // pas de créance restante
  assert.ok(bal(tb, '607') - bal(before, '607') > 0); // coût des marchandises vendues
  const is = (await call('GET', `/accounting/income-statement?from=${Y}-01-01&to=${today}`, null, co)).body; assert.equal(is.result, is.total_income - is.total_expense);
  const bs = (await call('GET', `/accounting/balance-sheet?to=${today}`, null, co)).body; assert.equal(bs.balanced, true);
  const lg = (await call('GET', `/accounting/ledger?account=531&from=${Y}-01-01&to=${today}`, null, co)).body; assert.equal(lg.closing, bal(tb, '531'));
  const csv = await call('GET', `/accounting/journal?from=${Y}-01-01&to=${today}&format=csv`, null, co); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /csv/);
});
test('comptabilité : écritures manuelles contrôlées, extourne, verrouillage, droits', async () => {
  const co = await login('comptable'), cs = await login('caissier'), ad = await login('admin');
  assert.equal((await call('GET', '/accounting/journal', null, cs)).status, 403);
  const e = (lines, extra = {}) => call('POST', '/accounting/entries', { date: today, label: 'Loyer du mois', lines, ...extra }, co);
  assert.equal((await e([{ account_code: '613', debit: 50000 }, { account_code: '512', credit: 40000 }])).body.error.code, 'UNBALANCED');
  assert.equal((await e([{ account_code: '999', debit: 1 }, { account_code: '512', credit: 1 }])).status, 400);
  assert.equal((await e([{ account_code: '613', debit: 10, credit: 10 }, { account_code: '512', credit: 0 }])).status, 400);
  const ok = await e([{ account_code: '613', debit: 50000 }, { account_code: '512', credit: 50000 }]); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const t1 = (await call('GET', `/accounting/trial-balance?from=${Y}-01-01&to=${today}`, null, co)).body; assert.equal(t1.data.find((x) => x.code === '613').balance, 50000);
  assert.equal((await call('POST', `/accounting/entries/${ok.body.id}/reverse`, {}, co)).status, 201); assert.equal((await call('POST', `/accounting/entries/${ok.body.id}/reverse`, {}, co)).status, 409);
  const t2 = (await call('GET', `/accounting/trial-balance?from=${Y}-01-01&to=${today}`, null, co)).body; assert.equal(t2.data.find((x) => x.code === '613').balance, 0); assert.equal(t2.balanced, true);
  assert.equal((await call('POST', '/accounting/entries', { date: today, label: 'x y z', lines: [{ account_code: '613', debit: 1 }, { account_code: '512', credit: 1 }] }, cs)).status, 403);
  const yest = new Date(Date.now() - 86400e3).toISOString().slice(0, 10); run("INSERT INTO period_locks(pharmacy_id,locked_until) VALUES (1,?)", yest);
  assert.equal((await call('POST', '/accounting/entries', { date: yest, label: 'Rétroactive', lines: [{ account_code: '613', debit: 1 }, { account_code: '512', credit: 1 }] }, co)).body.error.code, 'PERIOD_LOCKED');
  void ad;
});
