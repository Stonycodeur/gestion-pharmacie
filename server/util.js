// Utilitaires communs : erreurs HTTP, dates, validation, CSV, recherche floue.
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status; this.code = code; this.details = details;
  }
}
export const bad = (code, msg, d) => new HttpError(400, code, msg, d);
export const forbidden = (msg = 'Accès refusé', code = 'FORBIDDEN') => new HttpError(403, code, msg);
export const notFound = (what = 'Ressource') => new HttpError(404, 'NOT_FOUND', `${what} introuvable`);
export const conflict = (code, msg, d) => new HttpError(409, code, msg, d);

export const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
export const todaySql = () => new Date().toISOString().slice(0, 10);
export const addDays = (dateStr, n) => {
  const d = new Date(dateStr.length <= 10 ? dateStr + 'T00:00:00Z' : dateStr.replace(' ', 'T') + 'Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
export const addHours = (n) => new Date(Date.now() + n * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

// --- validation minimale (serveur = source de vérité) ---
export function str(v, name, { required = false, max = 255, min = 0 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad('VALIDATION', `Le champ « ${name} » est obligatoire`);
    return null;
  }
  if (typeof v !== 'string') throw bad('VALIDATION', `Le champ « ${name} » doit être du texte`);
  const s = v.trim();
  if (required && !s) throw bad('VALIDATION', `Le champ « ${name} » est obligatoire`);
  if (s.length > max) throw bad('VALIDATION', `Le champ « ${name} » est trop long (max ${max})`);
  if (s.length < min) throw bad('VALIDATION', `Le champ « ${name} » est trop court (min ${min})`);
  return s || null;
}
export function int(v, name, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad('VALIDATION', `Le champ « ${name} » est obligatoire`);
    return null;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isInteger(n)) throw bad('VALIDATION', `Le champ « ${name} » doit être un entier`);
  if (n < min || n > max) throw bad('VALIDATION', `Le champ « ${name} » doit être entre ${min} et ${max}`);
  return n;
}
export function num(v, name, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad('VALIDATION', `Le champ « ${name} » est obligatoire`);
    return null;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad('VALIDATION', `Le champ « ${name} » doit être un nombre`);
  if (n < min || n > max) throw bad('VALIDATION', `Le champ « ${name} » doit être entre ${min} et ${max}`);
  return n;
}
export function oneOf(v, name, list, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad('VALIDATION', `Le champ « ${name} » est obligatoire`);
    return null;
  }
  if (!list.includes(v)) throw bad('VALIDATION', `Valeur invalide pour « ${name} » (${list.join(', ')})`);
  return v;
}
export function date(v, name, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad('VALIDATION', `Le champ « ${name} » est obligatoire`);
    return null;
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)))
    throw bad('VALIDATION', `Le champ « ${name} » doit être une date AAAA-MM-JJ`);
  return v;
}
export function email(v, name, opts = {}) {
  const s = str(v, name, { ...opts, max: 190 });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('VALIDATION', `Adresse e-mail invalide (${name})`);
  return s ? s.toLowerCase() : s;
}
export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
export const arr = (v, name, { required = false, max = 500 } = {}) => {
  if (v === undefined || v === null) { if (required) throw bad('VALIDATION', `« ${name} » est obligatoire`); return []; }
  if (!Array.isArray(v)) throw bad('VALIDATION', `« ${name} » doit être une liste`);
  if (required && !v.length) throw bad('VALIDATION', `« ${name} » ne peut pas être vide`);
  if (v.length > max) throw bad('VALIDATION', `« ${name} » est trop long`);
  return v;
};

// --- pagination ---
export function paging(q) {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

// --- texte : normalisation, distance de Levenshtein (recherche tolérante aux fautes) ---
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function lev(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i; let rowMin = dp[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp; if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > max) return max + 1;
  }
  return dp[b.length];
}

// --- CSV ---
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += c;
    } else if (c === '"') inq = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
export function toCsv(rows, cols) {
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise l'injection de formules Excel
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
}
