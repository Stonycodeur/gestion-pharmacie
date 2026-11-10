// Primitives de sécurité : hachage des mots de passe, JWT HS256, TOTP, limitation de débit.
import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';

// scrypt (fonction memory-hard native Node). Argon2id n'est pas dans Node 22 : à remplacer si la lib est disponible.
const SC = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, SC.keylen, { N: SC.N, r: SC.r, p: SC.p, maxmem: SC.maxmem });
  return `scrypt$${SC.N}$${SC.r}$${SC.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const exp = Buffer.from(hash, 'base64');
    const got = scryptSync(pw, Buffer.from(salt, 'base64'), exp.length, { N: +N, r: +r, p: +p, maxmem: SC.maxmem });
    return timingSafeEqual(exp, got);
  } catch { return false; }
}
export function passwordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Le mot de passe doit contenir majuscule, minuscule et chiffre';
  return null;
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => randomBytes(n).toString('base64url');

// ---- JWT HS256 ----
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function signJwt(payload, secret, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
export function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const sig = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (sig.length !== given.length || !timingSafeEqual(sig, given)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (head.alg !== 'HS256') return null;
    const body = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch { return null; }
}

// ---- TOTP (RFC 6238, SHA-1, 6 chiffres, 30 s) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newTotpSecret = () => { const b = randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
function b32dec(s) { let bits = ''; for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
export function totp(secret, t = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac('sha1', b32dec(secret)).update(counter).digest();
  const o = h[19] & 15;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6;
  return String(code).padStart(6, '0');
}
export const verifyTotp = (secret, code) => [-1, 0, 1].some((w) => totp(secret, Date.now() + w * 30000) === String(code).trim());

// ---- limitation de débit (mémoire locale ; utiliser Redis si plusieurs instances) ----
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return { ok: b.n <= max, retryAfter: Math.ceil((b.reset - now) / 1000) };
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 60000).unref();

// Chiffrement des secrets de configuration (clés de passerelles de paiement) : AES-256-GCM, clé dérivée de JWT_SECRET.
import { createCipheriv, createDecipheriv, scryptSync as _scrypt } from 'node:crypto';
const cfgKey = (secret) => _scrypt(secret, 'gp-config-v1', 32);
export function encryptJson(obj, secret) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', cfgKey(secret), iv); const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); }
export function decryptJson(s, secret) { if (!s) return {}; const b = Buffer.from(String(s).slice(3), 'base64'); const d = createDecipheriv('aes-256-gcm', cfgKey(secret), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')); }
