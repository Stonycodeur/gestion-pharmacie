// Gestionnaire de documents : créer / renommer / déplacer / copier / supprimer des dossiers et fichiers,
// les partager (lecture ou modification) avec des utilisateurs ou des établissements, ou en transférer la propriété.
// Le super-administrateur voit et contrôle tout.
import { randomUUID } from 'node:crypto';
import { router, audit, notify } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { bad, forbidden, notFound, str, int } from '../util.js';
import { storeBlob, readPrivate, dropBlob } from '../files.js';
import { scanUpload } from '../scanner.js';

const MAX = 8 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods' };
const ZIPS = new Set(['application/zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods'].map((x) => x));
const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/gif': [0x47, 0x49, 0x46], 'application/pdf': [0x25, 0x50, 0x44, 0x46] };
const isSuper = (ctx) => ctx.user.role === 'super_admin';
const staffOnly = (ctx) => { if (ctx.user.role === 'customer') throw forbidden('Réservé au personnel'); };

// Droit sur un nœud : 'owner' | 'edit' | 'read' | null (hérité des dossiers parents ; un partage d'établissement vaut pour tout son personnel)
function accessOf(ctx, node) {
  if (isSuper(ctx) || node.owner_user_id === ctx.user.id) return 'owner';
  let best = null, cur = node, guard = 0;
  while (cur && guard++ < 40) {
    const sh = all("SELECT can_edit FROM fm_shares WHERE node_id=? AND ((target_type='user' AND target_id=?) OR (target_type='pharmacy' AND target_id=?))", cur.id, ctx.user.id, ctx.user.pharmacy_id ?? -1);
    for (const s of sh) { if (s.can_edit) return 'edit'; best = 'read'; }
    cur = cur.parent_id ? get('SELECT * FROM fm_nodes WHERE id=?', cur.parent_id) : null;
  }
  return best;
}
const load = (ctx, id, min = 'read') => {
  const n = get('SELECT * FROM fm_nodes WHERE id=?', int(id, 'id')); if (!n) throw notFound('Élément'); const a = accessOf(ctx, n); if (!a) throw notFound('Élément');
  if (min === 'edit' && a === 'read') throw forbidden('Vous pouvez seulement consulter cet élément'); if (min === 'owner' && a !== 'owner') throw forbidden('Réservé au propriétaire'); return { n, a };
};
const info = (ctx, n) => ({ id: n.id, kind: n.kind, name: n.name, mime: n.mime, size: n.size, parent_id: n.parent_id, owner_id: n.owner_user_id, owner_name: get('SELECT name FROM users WHERE id=?', n.owner_user_id)?.name, mine: n.owner_user_id === ctx.user.id, access: accessOf(ctx, n), shared: !!get('SELECT 1 FROM fm_shares WHERE node_id=?', n.id), updated_at: n.updated_at });
const uniqueName = (parent, owner, name, except) => { let base = name, i = 1; const taken = (nm) => get(`SELECT 1 FROM fm_nodes WHERE ${parent ? 'parent_id=?' : 'parent_id IS NULL AND owner_user_id=?'} AND name=? AND id<>?`, parent || owner, nm, except || 0); const dot = base.lastIndexOf('.'); const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : ''; let nm = name; while (taken(nm)) nm = `${stem} (${++i})${ext}`; return nm; };
const cleanName = (v) => str(v, 'nom', { required: true, max: 120 }).replace(/[\\/\0]/g, '-').trim();
const descendants = (id) => { const out = []; const walk = (p) => { for (const c of all('SELECT * FROM fm_nodes WHERE parent_id=?', p)) { out.push(c); if (c.kind === 'folder') walk(c.id); } }; walk(id); return out; };

router.get('/fm', { anyPerm: ['files.view'], needsPharmacy: false }, (ctx) => {
  staffOnly(ctx); const view = ctx.query.view || 'mine', parent = ctx.query.parent ? int(ctx.query.parent, 'dossier') : null;
  let rows, crumbs = [];
  if (parent) { const { n } = load(ctx, parent); if (n.kind !== 'folder') throw bad('VALIDATION', 'Ce n\'est pas un dossier'); rows = all('SELECT * FROM fm_nodes WHERE parent_id=? ORDER BY kind DESC, name', n.id); let c = n, g = 0; while (c && g++ < 40) { crumbs.unshift({ id: c.id, name: c.name }); c = c.parent_id ? get('SELECT * FROM fm_nodes WHERE id=?', c.parent_id) : null; } }
  else if (view === 'shared') rows = all("SELECT n.* FROM fm_nodes n JOIN fm_shares s ON s.node_id=n.id WHERE n.owner_user_id<>? AND ((s.target_type='user' AND s.target_id=?) OR (s.target_type='pharmacy' AND s.target_id=?)) GROUP BY n.id ORDER BY n.kind, n.name", ctx.user.id, ctx.user.id, ctx.user.pharmacy_id ?? -1);
  else if (view === 'all' && isSuper(ctx)) rows = all('SELECT * FROM fm_nodes WHERE parent_id IS NULL ORDER BY owner_user_id, kind, name');
  else rows = all('SELECT * FROM fm_nodes WHERE parent_id IS NULL AND owner_user_id=? ORDER BY kind DESC, name', ctx.user.id);
  return { crumbs, data: rows.map((n) => info(ctx, n)) };
});
router.post('/fm/folders', { perm: 'files.view', needsPharmacy: false }, (ctx) => {
  staffOnly(ctx); const parent = ctx.body.parent_id ? load(ctx, ctx.body.parent_id, 'edit').n : null; if (parent && parent.kind !== 'folder') throw bad('VALIDATION', 'Ce n\'est pas un dossier');
  const name = uniqueName(parent?.id, ctx.user.id, cleanName(ctx.body.name)); const id = insert("INSERT INTO fm_nodes(owner_user_id,pharmacy_id,parent_id,kind,name) VALUES (?,?,?,'folder',?)", parent ? parent.owner_user_id : ctx.user.id, ctx.user.pharmacy_id ?? null, parent?.id ?? null, name);
  audit(ctx, 'fm.folder_create', 'fm', id, undefined, { name }); return { id, name };
});
router.post('/fm/files', { perm: 'files.view', needsPharmacy: false, bodyLimit: 13e6 }, (ctx) => {
  staffOnly(ctx); const parent = ctx.body.parent_id ? load(ctx, ctx.body.parent_id, 'edit').n : null; if (parent && parent.kind !== 'folder') throw bad('VALIDATION', 'Ce n\'est pas un dossier');
  const mime = String(ctx.body.mime || ''), ext = TYPES[mime]; if (!ext) throw bad('FILE_TYPE', 'Type de fichier non autorisé (images, PDF, texte, CSV, Word, Excel, PowerPoint, ODF, ZIP)');
  const buf = Buffer.from(String(ctx.body.data_base64 || ''), 'base64'); if (!buf.length || buf.length > MAX) throw bad('FILE_SIZE', 'Fichier vide ou supérieur à 8 Mo');
  const okMagic = MAGIC[mime] ? MAGIC[mime].every((b, i) => buf[i] === b) : mime === 'image/webp' ? buf.subarray(0, 4).toString() === 'RIFF' : ZIPS.has(mime) || ZIPS.has(ext) ? buf[0] === 0x50 && buf[1] === 0x4b : !buf.includes(0);
  if (!okMagic) throw bad('FILE_TYPE', 'Le contenu du fichier ne correspond pas à son type');
  const name = cleanName(ctx.body.name || 'fichier.' + ext); const av = scanUpload(buf, mime, name); if (av.infected) throw bad('MALWARE', `Fichier refusé par l'antivirus : ${av.reason}`);
  return tx(() => { const stored = storeBlob(buf, mime, ext, false); const nm = uniqueName(parent?.id, ctx.user.id, name); const id = insert("INSERT INTO fm_nodes(owner_user_id,pharmacy_id,parent_id,kind,name,stored_name,mime,size) VALUES (?,?,?,'file',?,?,?,?)", parent ? parent.owner_user_id : ctx.user.id, ctx.user.pharmacy_id ?? null, parent?.id ?? null, nm, stored, mime, buf.length); audit(ctx, 'fm.file_upload', 'fm', id, undefined, { name: nm, size: buf.length }); return { id, name: nm }; });
});
router.get('/fm/:id/content', { perm: 'files.view', needsPharmacy: false }, (ctx) => {
  const { n } = load(ctx, ctx.params.id); if (n.kind !== 'file') throw bad('VALIDATION', 'Ce n\'est pas un fichier'); const buf = readPrivate(n.stored_name); if (!buf) throw notFound('Contenu');
  const inline = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(n.mime);
  ctx.res.writeHead(200, { 'Content-Type': n.mime, 'Content-Length': buf.length, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(n.name)}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store' }); ctx.res.end(buf);
  audit(ctx, 'fm.download', 'fm', n.id);
});
router.put('/fm/:id', { perm: 'files.view', needsPharmacy: false, ok200: true }, (ctx) => { // renommer
  const { n } = load(ctx, ctx.params.id, 'edit'); const name = uniqueName(n.parent_id, n.owner_user_id, cleanName(ctx.body.name), n.id); run("UPDATE fm_nodes SET name=?, updated_at=datetime('now') WHERE id=?", name, n.id); audit(ctx, 'fm.rename', 'fm', n.id, { name: n.name }, { name }); return { ok: true, name };
});
router.post('/fm/:id/move', { perm: 'files.view', needsPharmacy: false, ok200: true }, (ctx) => { // déplacer (vers un dossier ou la racine)
  const { n } = load(ctx, ctx.params.id, 'edit'); const to = ctx.body.parent_id ? load(ctx, ctx.body.parent_id, 'edit').n : null;
  if (to && (to.kind !== 'folder' || to.id === n.id || descendants(n.id).some((d) => d.id === to.id))) throw bad('VALIDATION', 'Déplacement impossible');
  const name = uniqueName(to?.id, n.owner_user_id, n.name, n.id); run("UPDATE fm_nodes SET parent_id=?, name=?, updated_at=datetime('now') WHERE id=?", to?.id ?? null, name, n.id); audit(ctx, 'fm.move', 'fm', n.id, { parent: n.parent_id }, { parent: to?.id ?? null }); return { ok: true };
});
router.post('/fm/:id/copy', { perm: 'files.view', needsPharmacy: false }, (ctx) => tx(() => { // copier (fichier ou dossier entier) chez soi
  const { n } = load(ctx, ctx.params.id); const to = ctx.body.parent_id ? load(ctx, ctx.body.parent_id, 'edit').n : null;
  const dup = (src, parent) => { const id = insert('INSERT INTO fm_nodes(owner_user_id,pharmacy_id,parent_id,kind,name,stored_name,mime,size) VALUES (?,?,?,?,?,?,?,?)', ctx.user.id, ctx.user.pharmacy_id ?? null, parent, src.kind, uniqueName(parent, ctx.user.id, src.kind === 'file' && parent === (to?.id ?? null) && src.id === n.id ? 'Copie de ' + src.name : src.name), src.kind === 'file' ? (() => { const b = readPrivate(src.stored_name); return b ? storeBlob(b, src.mime, TYPES[src.mime] || 'bin', false) : null; })() : null, src.mime, src.size); if (src.kind === 'folder') for (const c of all('SELECT * FROM fm_nodes WHERE parent_id=?', src.id)) dup(c, id); return id; };
  const id = dup(n, to?.id ?? null); audit(ctx, 'fm.copy', 'fm', id, undefined, { from: n.id }); return { id };
}));
router.delete('/fm/:id', { perm: 'files.view', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const { n, a } = load(ctx, ctx.params.id, 'edit'); if (a === 'edit' && n.owner_user_id !== ctx.user.id && !n.parent_id) throw forbidden('Seul le propriétaire supprime un élément partagé à la racine');
  const all_ = [n, ...descendants(n.id)]; for (const x of all_) if (x.stored_name) dropBlob(x.stored_name); run('DELETE FROM fm_nodes WHERE id=?', n.id); audit(ctx, 'fm.delete', 'fm', n.id, { name: n.name, items: all_.length }); return { ok: true, deleted: all_.length };
}));
// Partage
router.get('/fm/:id/shares', { perm: 'files.view', needsPharmacy: false }, (ctx) => { load(ctx, ctx.params.id, 'owner'); return all("SELECT s.id,s.target_type,s.target_id,s.can_edit,CASE s.target_type WHEN 'user' THEN (SELECT name FROM users WHERE id=s.target_id) ELSE (SELECT name FROM pharmacies WHERE id=s.target_id) END AS target_name FROM fm_shares s WHERE s.node_id=?", ctx.params.id); });
router.post('/fm/:id/share', { perm: 'files.view', needsPharmacy: false, ok200: true }, (ctx) => {
  const { n } = load(ctx, ctx.params.id, 'owner'); const type = ctx.body.target_type === 'pharmacy' ? 'pharmacy' : 'user', tid = int(ctx.body.target_id, 'destinataire');
  if (type === 'user') { const u = get("SELECT id,name FROM users WHERE id=? AND status='active' AND role_code NOT IN ('customer','driver','doctor')", tid); if (!u || u.id === ctx.user.id) throw bad('VALIDATION', 'Destinataire invalide'); } else if (!get('SELECT 1 FROM pharmacies WHERE id=?', tid)) throw bad('VALIDATION', 'Établissement introuvable');
  run('DELETE FROM fm_shares WHERE node_id=? AND target_type=? AND target_id=?', n.id, type, tid); insert('INSERT INTO fm_shares(node_id,target_type,target_id,can_edit,shared_by) VALUES (?,?,?,?,?)', n.id, type, tid, ctx.body.can_edit ? 1 : 0, ctx.user.id);
  const title = `${ctx.user.name || ctx.user.email} a partagé « ${n.name} » avec vous`; if (type === 'user') notify({ pharmacyId: ctx.user.pharmacy_id ?? null, userId: tid, kind: 'files', title, link: '#/files' }); else notify({ pharmacyId: tid, audience: 'staff', kind: 'files', title, link: '#/files' });
  audit(ctx, 'fm.share', 'fm', n.id, undefined, { type, tid, edit: !!ctx.body.can_edit }); return { ok: true };
});
router.delete('/fm/:id/share/:sid', { perm: 'files.view', needsPharmacy: false, ok200: true }, (ctx) => { const { n } = load(ctx, ctx.params.id, 'owner'); run('DELETE FROM fm_shares WHERE id=? AND node_id=?', ctx.params.sid, n.id); audit(ctx, 'fm.unshare', 'fm', n.id); return { ok: true }; });
// Transfert de propriété (dossier entier compris)
router.post('/fm/:id/transfer', { perm: 'files.view', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const { n } = load(ctx, ctx.params.id, 'owner'); const u = get("SELECT id,pharmacy_id FROM users WHERE id=? AND status='active' AND role_code NOT IN ('customer','driver','doctor')", int(ctx.body.user_id, 'destinataire')); if (!u) throw bad('VALIDATION', 'Destinataire invalide');
  for (const x of [n, ...descendants(n.id)]) run("UPDATE fm_nodes SET owner_user_id=?, pharmacy_id=?, updated_at=datetime('now') WHERE id=?", u.id, u.pharmacy_id, x.id);
  run("UPDATE fm_nodes SET parent_id=NULL, name=? WHERE id=?", uniqueName(null, u.id, n.name, n.id), n.id); run('DELETE FROM fm_shares WHERE node_id=? AND target_type=? AND target_id=?', n.id, 'user', u.id);
  notify({ pharmacyId: u.pharmacy_id, userId: u.id, kind: 'files', title: `« ${n.name} » vous a été transféré`, link: '#/files' }); audit(ctx, 'fm.transfer', 'fm', n.id, { owner: n.owner_user_id }, { owner: u.id }); return { ok: true };
}));
// Annuaire de partage : personnel actif et établissements
router.get('/fm/targets', { perm: 'files.view', needsPharmacy: false }, (ctx) => { staffOnly(ctx); return { users: all("SELECT u.id,u.name,u.email,u.role_code role,p.name pharmacy FROM users u LEFT JOIN pharmacies p ON p.id=u.pharmacy_id WHERE u.status='active' AND u.role_code NOT IN ('customer','driver','doctor') AND u.id<>? ORDER BY u.name LIMIT 500", ctx.user.id), pharmacies: all("SELECT id,name FROM pharmacies WHERE status='active' ORDER BY name") }; });
// Liste à plat des dossiers que l'on peut modifier (pour « Déplacer vers… » / « Copier vers… »), avec leur chemin
router.get('/fm/folders', { perm: 'files.view', needsPharmacy: false }, (ctx) => {
  staffOnly(ctx); const rows = isSuper(ctx) ? all("SELECT * FROM fm_nodes WHERE kind='folder' ORDER BY name LIMIT 1000") : all("SELECT * FROM fm_nodes WHERE kind='folder' AND owner_user_id=? ORDER BY name LIMIT 1000", ctx.user.id);
  const byId = new Map(rows.map((r) => [r.id, r])); const path = (r) => { const p = []; let c = r, g = 0; while (c && g++ < 30) { p.unshift(c.name); c = byId.get(c.parent_id); } return '/ ' + p.join(' / '); };
  return rows.map((r) => ({ id: r.id, path: path(r) })).sort((a, b) => a.path.localeCompare(b.path));
});
