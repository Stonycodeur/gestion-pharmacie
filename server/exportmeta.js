// Métadonnées communes à TOUS les exports (PDF, Excel) : page + vue (sous-titre), pharmacie, logo (repli : icône de l'application), date, auteur, période.
import { readFileSync } from 'node:fs';
import { get } from './db.js';
import { readPublic } from './files.js';
import { parseImage } from './pdfimage.js';

// [page, vue] : « Stock » › « Lots », « Rapports » › « Ventes »…
export const EXPORT_VIEWS = {
  ventes: ['Rapports', 'Ventes'], paiements: ['Rapports', 'Paiements'], top_produits: ['Rapports', 'Meilleures ventes'], peremptions: ['Rapports', 'Péremptions'], pertes: ['Rapports', 'Pertes et casse'],
  caisses: ['Rapports', 'Sessions de caisse'], taxes: ['Rapports', 'TVA collectée'], z_report: ['Rapports', 'Rapport Z'], valorisation_stock: ['Stock', 'Valorisation du stock'],
  journal: ['Comptabilité', 'Journal'], grand_livre: ['Comptabilité', 'Grand livre'], balance_comptable: ['Comptabilité', 'Balance'], bilan: ['Comptabilité', 'Bilan'], compte_resultat: ['Comptabilité', 'Compte de résultat'],
  flux_tresorerie: ['Comptabilité', 'Flux de trésorerie'], comparatif: ['Comptabilité', 'Comparatif'], encaissements: ['Comptabilité', 'Encaissements'], echeances_impayees: ['Comptabilité', 'Échéances impayées'],
  creances_clients: ['Clients', 'Créances clients'], soldes_fournisseurs: ['Achats', 'Soldes fournisseurs'], previsions: ['Prévisions', 'Réapprovisionnement'],
};
let dflt; // icône de l'application (favicon), version raster pour PDF/Excel
const defaultLogo = () => {
  if (dflt !== undefined) return dflt;
  try { const buf = readFileSync(new URL('../web/assets/icon-192.png', import.meta.url)); dflt = { buf, ext: 'png', ...parseImage(buf) }; } catch { dflt = null; }
  return dflt;
};
const kind = (b) => (b?.[0] === 0x89 && b[1] === 0x50 ? 'png' : b?.[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : null);
// Logo de la pharmacie, ou à défaut l'icône de l'application
export function logoOf(phId) {
  try {
    const lp = phId && get('SELECT logo_path FROM pharmacies WHERE id=?', phId)?.logo_path, b = lp && readPublic(lp), k = kind(b), img = k && parseImage(b);
    if (img) return { buf: b, ext: k, ...img };
  } catch { /* logo illisible : icône par défaut */ }
  return defaultLogo();
}
const stamp = (tz) => { try { return new Intl.DateTimeFormat('fr-FR', { timeZone: tz || 'UTC', dateStyle: 'short', timeStyle: 'short' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 16).replace('T', ' '); } };
export function exportMeta(ctx, { page, view, period } = {}) {
  const phId = ctx.ph || ctx.user?.pharmacy_id || null, ph = phId ? get('SELECT name,currency,timezone FROM pharmacies WHERE id=?', phId) : null;
  const q = ctx.query || {}, per = period ?? (q.from ? `du ${q.from} au ${String(q.to || '').slice(0, 10) || "ce jour"}` : '');
  return { title: page, subtitle: view || '', pharmacy: ph?.name || 'Gestion pharmacie', currency: ph?.currency || '', by: ctx.user?.name || '', at: stamp(ph?.timezone), period: per || '', logo: logoOf(phId) };
}
