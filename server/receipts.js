// Reçus numériques : numérotation, sceau électronique (HMAC), vérification publique par QR code, PDF, e-mail, partage.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { get, all, run, insert, nextNumber } from './db.js';
import { config } from './http.js';
import { sendMail, mailEnabled } from './mailer.js';
import { pdfPaymentReceipt } from './export.js';
import { parseImage } from './pdfimage.js';
import { readPublic } from './files.js';
import { qrMatrix } from './qr.js';

export const publicBase = () => (process.env.API_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
export const verifyUrl = (code) => `${publicBase()}/api/v1/receipts/verify/${code}`;
const seal = (r) => createHmac('sha256', config.secret).update([r.number, r.code, r.pharmacy_id, r.amount, r.currency, r.reference || '', r.created_at].join('|')).digest('hex');
export function sealValid(r) { const a = Buffer.from(seal(r)), b = Buffer.from(String(r.signature || '')); return a.length === b.length && timingSafeEqual(a, b); }
const taxIn = (gross, rate) => gross - Math.round(gross / (1 + rate / 100));

// Appelé à l'intérieur de la transaction de markPaid : un reçu par paiement, jamais deux.
export function createReceipt(op, methodLabel) {
  const ex = get('SELECT * FROM receipts WHERE online_payment_id=?', op.id); if (ex) return ex;
  const ph = get('SELECT * FROM pharmacies WHERE id=?', op.pharmacy_id), o = get('SELECT number FROM customer_orders WHERE id=?', op.order_id), c = get('SELECT name FROM customers WHERE id=?', op.customer_id);
  const n = get('SELECT COUNT(*) n FROM order_lines WHERE order_id=?', op.order_id).n;
  const number = nextNumber(op.pharmacy_id, 'receipt', 'REC'), code = randomBytes(9).toString('hex').toUpperCase().replace(/(.{6})(?=.)/g, '$1-');
  const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const base = { number, code, pharmacy_id: op.pharmacy_id, amount: op.amount, currency: op.currency || ph.currency, reference: op.provider_ref || `OP-${op.id}`, created_at };
  const id = insert('INSERT INTO receipts(pharmacy_id,number,code,online_payment_id,order_id,customer_id,payer_name,service,amount,currency,decimals,method_label,reference,signature,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    op.pharmacy_id, number, code, op.id, op.order_id, op.customer_id, c?.name || null, `Commande ${o?.number || ''} (${n} article${n > 1 ? 's' : ''})`, op.amount, base.currency, ph.currency_decimals, methodLabel, base.reference, seal(base), created_at);
  return get('SELECT * FROM receipts WHERE id=?', id);
}
export function receiptView(id) {
  const r = get('SELECT * FROM receipts WHERE id=?', id); if (!r) return null;
  const ph = get('SELECT name,address,phone,email,legal_notice FROM pharmacies WHERE id=?', r.pharmacy_id);
  const lines = all('SELECT p.name label, l.qty, p.sale_price unit, p.tax_rate, l.qty*p.sale_price total FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=?', r.order_id);
  const tax = lines.reduce((a, l) => a + taxIn(l.total, l.tax_rate), 0);
  const total = lines.reduce((a, l) => a + l.total, 0), ratio = total ? Math.min(1, r.amount / total) : 1; // paiement partiel : taxes au prorata
  return { receipt: r, pharmacy: ph, lines, tax: Math.round(tax * ratio), verify_url: verifyUrl(r.code), valid: sealValid(r) };
}
export const receiptPdf = (id) => { const v = receiptView(id); if (!v) return null; let logo = null; try { const lp = get('SELECT logo_path FROM pharmacies WHERE id=?', v.receipt.pharmacy_id)?.logo_path; const b = lp && readPublic(lp); logo = b ? parseImage(b) : null; } catch { logo = null; } return pdfPaymentReceipt({ ...v, logo, matrix: qrMatrix(v.verify_url) }); };
export const receiptPublicPdfUrl = (code) => `${publicBase()}/api/v1/receipts/public/${code}/pdf`;

export async function emailReceipt(receiptId, to) {
  const v = receiptView(receiptId); if (!v || !to) return false; if (!mailEnabled()) return false;
  const r = v.receipt, amt = (r.amount / 10 ** r.decimals).toFixed(r.decimals) + ' ' + r.currency, pdf = receiptPublicPdfUrl(r.code);
  const text = `Bonjour ${r.payer_name || ''},\n\nVotre paiement de ${amt} à « ${v.pharmacy.name} » est confirmé.\n\nReçu n° ${r.number}\nRéférence : ${r.reference}\nMoyen de paiement : ${r.method_label}\nDate : ${r.created_at} UTC\n\nTélécharger le reçu (PDF) : ${pdf}\nVérifier l'authenticité : ${v.verify_url}\n\nMerci.`;
  const html = `<p>Bonjour ${esc(r.payer_name || '')},</p><p>Votre paiement de <b>${esc(amt)}</b> à « ${esc(v.pharmacy.name)} » est confirmé.</p><ul><li>Reçu n° <b>${esc(r.number)}</b></li><li>Référence : ${esc(r.reference)}</li><li>Moyen de paiement : ${esc(r.method_label)}</li><li>Date : ${esc(r.created_at)} UTC</li></ul><p><a href="${esc(pdf)}">Télécharger le reçu (PDF)</a> · <a href="${esc(v.verify_url)}">Vérifier l'authenticité</a></p>`;
  await sendMail({ to, subject: `Reçu de paiement ${r.number} — ${v.pharmacy.name}`, text, html });
  run("UPDATE receipts SET emailed_at=datetime('now') WHERE id=?", r.id); return true;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
