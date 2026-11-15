// Fichiers téléversés : validation du type par signature, taille bornée, nom aléatoire.
// "public" = images d'avatar/logo servies sans authentification (noms non devinables) ; le reste reste privé.
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { bad, str } from './util.js';
import { get, run } from './db.js';
import { scanUpload } from './scanner.js';
export const UPLOAD_DIR = resolve(process.cwd(), process.env.UPLOAD_DIR || './data/uploads');
export const PUBLIC_DIR = resolve(UPLOAD_DIR, 'public');
const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/webp': null };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/webp': 'webp' };
export const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
export const DOCS = ['image/jpeg', 'image/png', 'application/pdf'];
export function decodeUpload(f, { mimes = DOCS, max = 3 * 1024 * 1024 } = {}) {
  if (!f || typeof f !== 'object') throw bad('VALIDATION', 'Fichier manquant');
  const mime = String(f.mime || ''); if (!mimes.includes(mime)) throw bad('FILE_TYPE', 'Type de fichier non autorisé');
  const buf = Buffer.from(String(f.data_base64 || ''), 'base64');
  if (!buf.length || buf.length > max) throw bad('FILE_SIZE', `Fichier vide ou > ${Math.round(max / 1048576)} Mo`);
  const ok = mime === 'image/webp' ? buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP' : MAGIC[mime].every((b, i) => buf[i] === b);
  if (!ok) throw bad('FILE_TYPE', 'Le contenu du fichier ne correspond pas à son type');
  const name = str(f.name, 'nom du fichier', { max: 120 }) || 'fichier.' + EXT[mime];
  const av = scanUpload(buf, mime, name); // antivirus intégré : tout fichier reçu est analysé avant stockage
  if (av.infected) throw bad('MALWARE', `Fichier refusé par l'antivirus : ${av.reason}`);
  return { buf, mime, ext: EXT[mime], name };
}
// Stockage en base (table stored_files) : survit aux redémarrages/redéploiements, sans disque. Lecture de repli sur l'ancien dossier si le fichier y existe encore.
export function storeBlob(buf, mime, ext, isPublic) {
  const name = `${randomUUID()}.${ext}`;
  run('INSERT INTO stored_files(name,is_public,mime,size,data) VALUES (?,?,?,?,?)', name, isPublic ? 1 : 0, mime, buf.length, buf); return name;
}
export const readBlob = (name, isPublic) => {
  const r = get('SELECT data FROM stored_files WHERE name=? AND is_public=?', String(name), isPublic ? 1 : 0); if (r) return Buffer.from(r.data);
  const dir = isPublic ? PUBLIC_DIR : UPLOAD_DIR, p = resolve(dir, String(name));
  return p.startsWith(dir + '/') && existsSync(p) ? readFileSync(p) : null; // anciens fichiers sur disque (installations antérieures)
};
export const dropBlob = (name) => { try { run('DELETE FROM stored_files WHERE name=?', String(name)); } catch {} };
export function savePublicImage(f, max = 1024 * 1024) { const d = decodeUpload(f, { mimes: IMAGES, max }); return storeBlob(d.buf, d.mime, d.ext, true); }
export function savePrivate(f, max = 5 * 1024 * 1024) { const d = decodeUpload(f, { max }); return { path: storeBlob(d.buf, d.mime, d.ext, false), mime: d.mime, name: d.name, size: d.buf.length }; }
export const readPublic = (name) => readBlob(name, true);
export const readPrivate = (name) => readBlob(name, false);
export const dropPublic = (name) => dropBlob(name);
export const mimeOfName = (n) => ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[String(n).split('.').pop()] || 'application/octet-stream');
