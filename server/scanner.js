// Antivirus intégré (sans dépendance) : analyse de TOUT fichier reçu par l'application, avant stockage.
// Il ne remplace pas un moteur à signatures complet : il bloque les cas courants (EICAR, exécutables et scripts déguisés en images/PDF,
// PDF actifs, fichiers « polyglottes », empreintes interdites). ClamAV (CLAMD_HOST) s'y ajoute quand il est configuré (voir antivirus.js).
import { createHash } from 'node:crypto';
import { run } from './db.js';

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const BAD_HASHES = new Set(String(process.env.MALWARE_SHA256 || '').toLowerCase().split(/[\s,;]+/).filter(Boolean));
const SIGNS = [
  [/<\?php/i, 'Script PHP intégré'], [/<script[\s>]/i, 'Script HTML/JavaScript intégré'], [/<%[@=\s]/, 'Script serveur intégré'],
  [/powershell(\.exe)?\s+-/i, 'Commande PowerShell'], [/cmd(\.exe)?\s+\/c\s/i, 'Commande Windows'], [/\/bin\/(ba)?sh\b.{0,40}-c\b/s, 'Commande shell'],
  [/eval\s*\(\s*(base64_decode|atob|String\.fromCharCode)/i, 'Code obfusqué'], [/WScript\.Shell|Scripting\.FileSystemObject/i, 'Script Windows (WSH)'],
  [/Auto_?Open|Document_?Open|VBA_PROJECT|vbaProject\.bin/i, 'Macro Office'],
];
const EXEC = [[[0x4d, 0x5a], 'Exécutable Windows (MZ)'], [[0x7f, 0x45, 0x4c, 0x46], 'Exécutable Linux (ELF)'], [[0xca, 0xfe, 0xba, 0xbe], 'Exécutable Java/Mach-O'], [[0xcf, 0xfa, 0xed, 0xfe], 'Exécutable macOS'], [[0x23, 0x21], 'Script avec shebang'], [[0x50, 0x4b, 0x03, 0x04], 'Archive ZIP (non autorisée ici)'], [[0xd0, 0xcf, 0x11, 0xe0], 'Document Office ancien (macros possibles)']];
const startsWith = (b, sig) => sig.every((x, i) => b[i] === x);

export function scanBuiltin(buf, mime = '') {
  const sha = createHash('sha256').update(buf).digest('hex');
  const hit = (reason) => ({ infected: true, reason, sha256: sha, engine: 'builtin' });
  if (BAD_HASHES.has(sha)) return hit('Empreinte de fichier malveillant connue');
  if (buf.includes(EICAR)) return hit('Fichier de test antivirus (EICAR)');
  for (const [sig, why] of EXEC) if (startsWith(buf, sig)) return hit(why);
  // Les formats acceptés (JPEG, PNG, WebP, PDF) ne contiennent pas de code : on cherche du code caché à l'intérieur ou à la suite.
  const text = buf.toString('latin1');
  const limit = mime === 'application/pdf' ? text : text.slice(0, 5_000_000);
  for (const [re, why] of SIGNS) if (re.test(limit)) return hit(why);
  if (mime === 'application/pdf') {
    if (/\/(JavaScript|JS)\b/.test(text)) return hit('PDF contenant du JavaScript');
    if (/\/Launch\b/.test(text)) return hit('PDF avec action de lancement de programme');
    if (/\/EmbeddedFile\b/.test(text)) return hit('PDF contenant un fichier incorporé');
    if (/\/OpenAction[\s\S]{0,200}\/(URI|GoToR|SubmitForm)/.test(text)) return hit('PDF avec action automatique suspecte');
  }
  if (mime === 'image/png') { const i = buf.lastIndexOf(Buffer.from('IEND')); if (i > 0 && buf.length - (i + 8) > 16) return hit('Données cachées après la fin de l\'image PNG'); }
  if (mime === 'image/jpeg') { const i = buf.lastIndexOf(Buffer.from([0xff, 0xd9])); if (i > 0 && buf.length - (i + 2) > 16) return hit('Données cachées après la fin de l\'image JPEG'); }
  return { infected: false, sha256: sha, engine: 'builtin' };
}
// Analyse + journal (table file_scans). Retourne le verdict ; l'appelant refuse le fichier si `infected`.
export function scanUpload(buf, mime, name, who = {}) {
  const r = scanBuiltin(buf, mime);
  try { run('INSERT INTO file_scans(name,mime,size,sha256,verdict,reason,engine,user_id,ip) VALUES (?,?,?,?,?,?,?,?,?)', String(name || '').slice(0, 120), mime, buf.length, r.sha256, r.infected ? 'infected' : 'clean', r.reason || null, r.engine, who.userId ?? null, who.ip ?? null); } catch { /* journal best-effort */ }
  return r;
}
