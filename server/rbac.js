// Rôles et permissions (RBAC). Les associations sont semées en base puis modifiables par le super-admin.
import { all, run, get } from './db.js';

export const PERMISSIONS = {
  'dashboard.view': 'Voir le tableau de bord',
  'products.view': 'Consulter le catalogue', 'products.manage': 'Gérer le catalogue', 'prices.manage': 'Gérer les prix',
  'suppliers.view': 'Consulter les fournisseurs', 'suppliers.manage': 'Gérer les fournisseurs',
  'stock.view': 'Consulter le stock', 'stock.adjust': 'Corriger/mouvementer le stock', 'stock.block_batch': 'Bloquer/rappeler un lot',
  'inventory.manage': 'Saisir un inventaire', 'inventory.validate': 'Valider un inventaire',
  'purchases.view': 'Consulter les achats', 'purchases.manage': 'Créer des commandes fournisseur', 'purchases.approve': 'Valider des commandes fournisseur',
  'receipts.create': 'Réceptionner des livraisons',
  'sales.view': 'Consulter les ventes', 'sales.create': 'Vendre au comptoir', 'sales.discount': 'Accorder des remises',
  'sales.refund': 'Rembourser / retour client', 'sales.refund_approve': 'Approuver un remboursement élevé',
  'sales.dispense_rx': 'Délivrer sur ordonnance', 'sales.dispense_controlled': 'Délivrer des produits contrôlés',
  'cash.use': 'Ouvrir/fermer sa caisse', 'cash.view_all': 'Voir toutes les caisses',
  'customers.view': 'Consulter les clients', 'customers.manage': 'Gérer les clients', 'customers.history': 'Voir l\'historique d\'achats (sensible)',
  'prescriptions.view': 'Consulter les ordonnances', 'prescriptions.create': 'Enregistrer une ordonnance', 'prescriptions.review': 'Vérifier/valider une ordonnance',
  'orders.view': 'Consulter les commandes clients', 'orders.manage': 'Gérer commandes et réservations',
  'reports.view': 'Voir les rapports', 'reports.export': 'Exporter les rapports', 'accounting.view': 'Voir la comptabilité',
  'users.manage': 'Gérer les utilisateurs', 'roles.manage': 'Gérer rôles et permissions',
  'audit.view': 'Consulter le journal d\'audit', 'settings.manage': 'Gérer les paramètres', 'pharmacies.manage': 'Gérer les établissements',
  'temperature.manage': 'Relevés de température', 'portal.use': 'Espace client', 'portal.browse': 'Parcourir les pharmacies et chercher un médicament', 'portal.guest': 'Mode invité (sans historique)', 'users.delete': 'Supprimer des comptes', 'help.view': 'Centre d\'aide : voir les demandes', 'help.reply': 'Centre d\'aide : répondre', 'files.view': 'Centre de fichiers', 'inter.search': 'Chercher dans les autres pharmacies et les contacter', 'driver.use': 'Espace chauffeur', 'doctor.use': 'Espace médecin (créneaux)', 'trash.manage': 'Corbeille : restaurer / supprimer définitivement',
  'transfers.manage': 'Créer/expédier des transferts', 'transfers.receive': 'Réceptionner des transferts', 'supplier_returns.manage': 'Retours et avoirs fournisseur', 'supplier_payments.manage': 'Paiements fournisseurs',
  'sales.credit': 'Vente à crédit / reste à payer', 'sales.deposit': 'Acomptes sur commandes', 'accounting.lock': 'Clôturer / verrouiller une période',
  'deliveries.view': 'Voir les livraisons', 'deliveries.manage': 'Gérer les livraisons (lancer, affecter)', 'drivers.admin': 'Créer et modifier les chauffeurs (comptes, tarifs, affectations)', 'finance.admin': 'Abonnements, KYC, clés API, webhooks et SMS (paramétrage financier)', 'rfq.manage': 'Demandes de prix fournisseurs', 'accounting.manage': 'Saisir des écritures comptables', 'forecast.view': 'Prévisions et analyses de stock',
};
const P = Object.keys(PERMISSIONS);
const SPECIAL = ['portal.use', 'portal.browse', 'portal.guest', 'driver.use', 'doctor.use'];
const except = (...x) => P.filter((p) => !x.includes(p) && !SPECIAL.includes(p));

export const ROLES = {
  super_admin: { label: 'Super-administrateur', privileged: 1, perms: except() },
  pharmacy_admin: { label: 'Administrateur de pharmacie', privileged: 1, perms: except('pharmacies.manage', 'roles.manage') },
  pharmacist_in_charge: { label: 'Pharmacien responsable', privileged: 1, perms: except('pharmacies.manage', 'roles.manage', 'users.manage', 'settings.manage') },
  pharmacist: {
    label: 'Pharmacien', privileged: 0,
    perms: ['trash.manage', 'help.view', 'help.reply', 'files.view', 'inter.search', 'deliveries.view', 'deliveries.manage', 'forecast.view', 'transfers.manage', 'transfers.receive', 'supplier_returns.manage', 'sales.credit', 'sales.deposit', 'dashboard.view', 'products.view', 'suppliers.view', 'stock.view', 'stock.adjust', 'stock.block_batch', 'inventory.manage', 'inventory.validate', 'purchases.view', 'receipts.create', 'sales.view', 'sales.create', 'sales.discount', 'sales.refund', 'sales.refund_approve', 'sales.dispense_rx', 'sales.dispense_controlled', 'cash.use', 'customers.view', 'customers.manage', 'customers.history', 'prescriptions.view', 'prescriptions.create', 'prescriptions.review', 'orders.view', 'orders.manage', 'reports.view', 'temperature.manage'],
  },
  assistant: {
    label: 'Préparateur / assistant', privileged: 0,
    perms: ['help.view', 'files.view', 'deliveries.view', 'sales.deposit', 'dashboard.view', 'products.view', 'stock.view', 'sales.view', 'sales.create', 'sales.dispense_rx', 'cash.use', 'customers.view', 'customers.manage', 'prescriptions.view', 'prescriptions.create', 'orders.view', 'orders.manage', 'temperature.manage'],
  },
  cashier: {
    label: 'Caissier', privileged: 0,
    perms: ['sales.deposit', 'dashboard.view', 'products.view', 'stock.view', 'sales.view', 'sales.create', 'cash.use', 'customers.view', 'customers.manage', 'orders.view'],
  },
  stock_manager: {
    label: 'Gestionnaire de stock / acheteur', privileged: 0,
    perms: ['rfq.manage', 'forecast.view', 'transfers.manage', 'transfers.receive', 'supplier_returns.manage', 'dashboard.view', 'products.view', 'products.manage', 'suppliers.view', 'suppliers.manage', 'stock.view', 'stock.adjust', 'inventory.manage', 'purchases.view', 'purchases.manage', 'receipts.create', 'reports.view', 'temperature.manage'],
  },
  accountant: {
    label: 'Comptable', privileged: 0,
    perms: ['accounting.manage', 'forecast.view', 'rfq.manage', 'supplier_payments.manage', 'accounting.lock', 'dashboard.view', 'products.view', 'suppliers.view', 'purchases.view', 'sales.view', 'cash.view_all', 'reports.view', 'reports.export', 'accounting.view'],
  },
  auditor: {
    label: 'Auditeur', privileged: 0,
    perms: ['deliveries.view', 'forecast.view', 'dashboard.view', 'products.view', 'suppliers.view', 'stock.view', 'purchases.view', 'sales.view', 'cash.view_all', 'prescriptions.view', 'reports.view', 'reports.export', 'accounting.view', 'audit.view'],
  },
  customer: { label: 'Client', privileged: 0, perms: ['portal.use', 'portal.browse'] },
  guest: { label: 'Invité', privileged: 0, perms: ['portal.browse', 'portal.guest'] },
  support: { label: 'Centre d\'aide', privileged: 0, perms: ['help.view', 'help.reply', 'files.view', 'inter.search'] },
  driver: { label: 'Chauffeur', privileged: 0, perms: ['driver.use'] },
  doctor: { label: 'Médecin', privileged: 0, perms: ['doctor.use'] },
};

export const DEFAULT_SETTINGS = { expiry_warning_days: 90, stock_method: 'FEFO', max_discount_percent: 10, refund_approval_threshold: 50000, reservation_hours: 24, loyalty_points_per_unit: 1, prescription_validity_days: 90, min_days_before_expiry_sale: 0, temp_min: 2, temp_max: 8, credit_limit: 0, brand_color: '#0f766e', brand_name: '' };
export function seedRbac() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO settings(pharmacy_id,skey,svalue) VALUES (0,?,?)', k, String(v));
  const fresh = [];
  for (const [code, label] of Object.entries(PERMISSIONS)) { if (!get('SELECT 1 FROM permissions WHERE code=?', code)) fresh.push(code); run('INSERT OR IGNORE INTO permissions(code,label) VALUES (?,?)', code, label); }
  for (const [code, r] of Object.entries(ROLES)) {
    run('INSERT OR IGNORE INTO roles(code,label,privileged) VALUES (?,?,?)', code, r.label, r.privileged);
    if (!get('SELECT 1 FROM role_permissions WHERE role_code=? LIMIT 1', code))
      for (const p of r.perms) run('INSERT OR IGNORE INTO role_permissions(role_code,permission_code) VALUES (?,?)', code, p);
    else // mise à jour de version : les NOUVELLES permissions sont accordées aux rôles par défaut concernés, sans toucher aux réglages existants
      for (const p of r.perms) if (fresh.includes(p)) run('INSERT OR IGNORE INTO role_permissions(role_code,permission_code) VALUES (?,?)', code, p);
  }
  reloadPerms();
}

let cache = new Map(), ucache = new Map();
export function reloadPerms() {
  cache = new Map(); ucache = new Map();
  for (const r of all('SELECT role_code, permission_code FROM role_permissions')) {
    if (!cache.has(r.role_code)) cache.set(r.role_code, new Set());
    cache.get(r.role_code).add(r.permission_code);
  }
}
export const roleHas = (role, perm) => cache.get(role)?.has(perm) ?? false;
export const permsOf = (role) => [...(cache.get(role) ?? [])];
// Permissions individuelles : « refusé » l'emporte, « accordé » s'ajoute au rôle ; le super-administrateur a toujours tout.
const ov = (id) => { let o = ucache.get(id); if (!o) { o = { grant: new Set(), deny: new Set() }; for (const r of all('SELECT permission_code p, effect e FROM user_permissions WHERE user_id=?', id)) (r.e === 'grant' ? o.grant : o.deny).add(r.p); ucache.set(id, o); } return o; };
export const userHas = (id, role, perm) => { if (role === 'super_admin') return perm in PERMISSIONS && !SPECIAL.includes(perm); /* le super-administrateur a toujours tout (espaces personnels exceptés) */ const o = ov(id); return o.deny.has(perm) ? false : o.grant.has(perm) || roleHas(role, perm); };
export const userPerms = (id, role) => (role === 'super_admin' ? Object.keys(PERMISSIONS).filter((p) => !SPECIAL.includes(p)) : Object.keys(PERMISSIONS).filter((p) => userHas(id, role, p)));
export const overridesOf = (id) => { const o = ov(id); return { ...Object.fromEntries([...o.grant].map((p) => [p, 'grant'])), ...Object.fromEntries([...o.deny].map((p) => [p, 'deny'])) }; };
// Rôles qu'un administrateur peut attribuer (jamais plus élevé que le sien) — inclut les rôles personnalisés créés par le super-administrateur.
export const assignableRoles = (actorRole) => {
  const all_ = all('SELECT code FROM roles').map((r) => r.code);
  if (actorRole === 'super_admin') return all_;
  if (actorRole === 'pharmacy_admin') return all_.filter((r) => r !== 'super_admin');
  return [];
};
