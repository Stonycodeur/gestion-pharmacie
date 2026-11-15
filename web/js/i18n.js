// Internationalisation FR / EN / AR (RTL). Les clés sont les libellés français : un libellé non traduit reste lisible.
const EN = {
  'Tableau de bord': 'Dashboard', 'Caisse / Vente': 'Point of sale', 'Ventes': 'Sales', 'Produits': 'Products', 'Stock': 'Stock', 'Achats': 'Purchasing', 'Inventaires': 'Inventories', 'Ordonnances': 'Prescriptions', 'Clients': 'Customers', 'Commandes': 'Orders',
  'Ma caisse': 'My cash drawer', 'Rapports': 'Reports', 'Utilisateurs': 'Users', 'Rôles & droits': 'Roles & permissions', 'Journal d\'audit': 'Audit log', 'Paramètres': 'Settings', 'Mon espace': 'My account', 'Sécurité': 'Security',
  'Connexion': 'Sign in', 'Se connecter': 'Sign in', 'E-mail': 'Email', 'Mot de passe': 'Password', 'Déconnexion': 'Sign out', 'Code de double authentification': 'Two-factor code',
  'Rechercher': 'Search', 'Nom': 'Name', 'Prix': 'Price', 'Quantité': 'Quantity', 'Total': 'Total', 'Date': 'Date', 'Statut': 'Status', 'Actions': 'Actions', 'Enregistrer': 'Save', 'Annuler': 'Cancel', 'Fermer': 'Close', 'Créer': 'Create', 'Modifier': 'Edit', 'Supprimer': 'Delete', 'Valider': 'Validate', 'Confirmer': 'Confirm',
  'Chiffre d\'affaires du jour': 'Today\'s revenue', 'Chiffre d\'affaires du mois': 'Month revenue', 'tickets': 'receipts', 'Ruptures': 'Out of stock', 'Stock critique': 'Critical stock', 'Stock bas': 'Low stock', 'Péremption proche': 'Expiring soon', 'Périmés en stock': 'Expired in stock', 'Ordonnances à vérifier': 'Prescriptions to check', 'Commandes en cours': 'Open orders',
  'Ventes sur 14 jours': 'Sales, last 14 days', 'Produits les plus vendus': 'Top products', 'Panier': 'Cart', 'Panier vide': 'Cart is empty', 'Encaisser': 'Pay', 'Espèces': 'Cash', 'Carte': 'Card', 'Mobile': 'Mobile', 'Virement': 'Transfer', 'Client': 'Customer', 'Sans client': 'No customer', 'Ordonnance': 'Prescription', 'Remise': 'Discount', 'Rendu': 'Change',
  'Rechercher un produit (nom, DCI, code-barres)…': 'Search a product (name, INN, barcode)…', 'Ouvrir la caisse': 'Open the cash drawer', 'Fond de caisse': 'Opening float', 'Fermer la caisse': 'Close the cash drawer', 'Ticket': 'Receipt', 'Imprimer': 'Print', 'Nouvelle vente': 'New sale',
  'Sur ordonnance': 'Prescription only', 'Produit contrôlé': 'Controlled', 'Libre': 'Free', 'Disponible': 'Available', 'Réservé': 'Reserved', 'Quarantaine': 'Quarantine', 'Lot': 'Batch', 'Péremption': 'Expiry', 'Fournisseur': 'Supplier', 'Fournisseurs': 'Suppliers', 'Réceptions': 'Goods receipts', 'Suggestions': 'Suggestions', 'Mouvements': 'Movements', 'Alertes': 'Alerts', 'Températures': 'Temperatures',
  'Nouveau': 'New', 'Importer CSV': 'Import CSV', 'Exporter CSV': 'Export CSV', 'Aucun résultat': 'No results', 'Chargement…': 'Loading…', 'Rembourser': 'Refund', 'Motif': 'Reason', 'Langue': 'Language', 'Thème': 'Theme', 'Notifications': 'Notifications', 'Tout marquer comme lu': 'Mark all read',
  'Reçue': 'Received', 'À vérifier': 'To verify', 'Complément demandé': 'More info requested', 'Validée': 'Validated', 'Partiellement délivrée': 'Partially dispensed', 'Délivrée': 'Dispensed', 'Refusée': 'Rejected',
  'En attente': 'Pending', 'Confirmée': 'Confirmed', 'En préparation': 'Preparing', 'Prête': 'Ready', 'Retirée': 'Picked up', 'Annulée': 'Cancelled', 'Expirée': 'Expired',
  'Changer le mot de passe': 'Change password', 'Activer la double authentification': 'Enable two-factor', 'Rôle': 'Role', 'Établissement': 'Pharmacy', 'Réservation': 'Reservation', 'Catalogue': 'Catalog', 'Mes commandes': 'My orders', 'Mes ordonnances': 'My prescriptions', 'Déposer une ordonnance': 'Upload a prescription',
};
const AR = {
  'Tableau de bord': 'لوحة القيادة', 'Caisse / Vente': 'نقطة البيع', 'Ventes': 'المبيعات', 'Produits': 'المنتجات', 'Stock': 'المخزون', 'Achats': 'المشتريات', 'Inventaires': 'الجرد', 'Ordonnances': 'الوصفات الطبية', 'Clients': 'العملاء', 'Commandes': 'الطلبات',
  'Ma caisse': 'صندوقي', 'Rapports': 'التقارير', 'Utilisateurs': 'المستخدمون', 'Rôles & droits': 'الأدوار والصلاحيات', 'Journal d\'audit': 'سجل التدقيق', 'Paramètres': 'الإعدادات', 'Mon espace': 'حسابي', 'Sécurité': 'الأمان',
  'Connexion': 'تسجيل الدخول', 'Se connecter': 'دخول', 'E-mail': 'البريد الإلكتروني', 'Mot de passe': 'كلمة المرور', 'Déconnexion': 'تسجيل الخروج', 'Code de double authentification': 'رمز التحقق الثنائي',
  'Rechercher': 'بحث', 'Nom': 'الاسم', 'Prix': 'السعر', 'Quantité': 'الكمية', 'Total': 'المجموع', 'Date': 'التاريخ', 'Statut': 'الحالة', 'Actions': 'إجراءات', 'Enregistrer': 'حفظ', 'Annuler': 'إلغاء', 'Fermer': 'إغلاق', 'Créer': 'إنشاء', 'Modifier': 'تعديل', 'Supprimer': 'حذف', 'Valider': 'تأكيد', 'Confirmer': 'تأكيد',
  'Chiffre d\'affaires du jour': 'رقم أعمال اليوم', 'Chiffre d\'affaires du mois': 'رقم أعمال الشهر', 'tickets': 'تذاكر', 'Ruptures': 'نفاد المخزون', 'Stock critique': 'مخزون حرج', 'Stock bas': 'مخزون منخفض', 'Péremption proche': 'قرب انتهاء الصلاحية', 'Périmés en stock': 'منتهية الصلاحية في المخزون', 'Ordonnances à vérifier': 'وصفات للمراجعة', 'Commandes en cours': 'طلبات جارية',
  'Ventes sur 14 jours': 'المبيعات خلال 14 يومًا', 'Produits les plus vendus': 'الأكثر مبيعًا', 'Panier': 'السلة', 'Panier vide': 'السلة فارغة', 'Encaisser': 'دفع', 'Espèces': 'نقدًا', 'Carte': 'بطاقة', 'Mobile': 'هاتف', 'Virement': 'تحويل', 'Client': 'العميل', 'Sans client': 'بدون عميل', 'Ordonnance': 'الوصفة', 'Remise': 'خصم', 'Rendu': 'الباقي',
  'Rechercher un produit (nom, DCI, code-barres)…': 'ابحث عن منتج (الاسم، المادة الفعالة، الباركود)…', 'Ouvrir la caisse': 'فتح الصندوق', 'Fond de caisse': 'رصيد الصندوق', 'Fermer la caisse': 'إغلاق الصندوق', 'Ticket': 'إيصال', 'Imprimer': 'طباعة', 'Nouvelle vente': 'بيع جديد',
  'Sur ordonnance': 'بوصفة طبية', 'Produit contrôlé': 'خاضع للرقابة', 'Libre': 'حر', 'Disponible': 'متوفر', 'Réservé': 'محجوز', 'Quarantaine': 'حجر', 'Lot': 'دفعة', 'Péremption': 'الصلاحية', 'Fournisseur': 'المورّد', 'Fournisseurs': 'الموردون', 'Réceptions': 'الاستلامات', 'Suggestions': 'اقتراحات', 'Mouvements': 'الحركات', 'Alertes': 'التنبيهات', 'Températures': 'درجات الحرارة',
  'Nouveau': 'جديد', 'Importer CSV': 'استيراد CSV', 'Exporter CSV': 'تصدير CSV', 'Aucun résultat': 'لا نتائج', 'Chargement…': 'جارٍ التحميل…', 'Rembourser': 'استرداد', 'Motif': 'السبب', 'Langue': 'اللغة', 'Thème': 'المظهر', 'Notifications': 'الإشعارات', 'Tout marquer comme lu': 'تعليم الكل كمقروء',
  'Reçue': 'مستلمة', 'À vérifier': 'للمراجعة', 'Complément demandé': 'مطلوب استكمال', 'Validée': 'مصادَق عليها', 'Partiellement délivrée': 'مسلّمة جزئيًا', 'Délivrée': 'مسلّمة', 'Refusée': 'مرفوضة',
  'En attente': 'قيد الانتظار', 'Confirmée': 'مؤكدة', 'En préparation': 'قيد التحضير', 'Prête': 'جاهزة', 'Retirée': 'تم الاستلام', 'Annulée': 'ملغاة', 'Expirée': 'منتهية',
  'Changer le mot de passe': 'تغيير كلمة المرور', 'Activer la double authentification': 'تفعيل التحقق الثنائي', 'Rôle': 'الدور', 'Établissement': 'المؤسسة', 'Réservation': 'حجز', 'Catalogue': 'الكتالوج', 'Mes commandes': 'طلباتي', 'Mes ordonnances': 'وصفاتي', 'Déposer une ordonnance': 'إيداع وصفة',
};
Object.assign(EN, { 'Plus': 'More', 'Personnaliser': 'Customize', 'Synchronisation': 'Sync', 'Synchronisation…': 'Syncing…', 'Hors ligne': 'Offline', 'En ligne': 'Online', 'Compte': 'Account', 'à envoyer': 'to send', 'conflit(s)': 'conflict(s)', 'Mode': 'Mode', 'Auto': 'Auto', 'Clair': 'Light', 'Sombre': 'Dark', 'Couleur d\'accent': 'Accent color', 'Densité': 'Density', 'Compacte': 'Compact', 'Confortable': 'Comfortable', 'Aérée': 'Spacious', 'Arrondis': 'Corners', 'Droits': 'Sharp', 'Normaux': 'Normal', 'Très ronds': 'Very round', 'Taille du texte': 'Text size', 'Menu latéral': 'Side menu', 'Adaptatif': 'Adaptive', 'Icônes seules': 'Icons only', 'Contraste': 'Contrast', 'Normal': 'Normal', 'Élevé': 'High', 'Animations': 'Animations', 'Activées': 'On', 'Réduites': 'Reduced', 'Réinitialiser': 'Reset', 'Terminé': 'Done', 'Aperçu': 'Preview', 'Rien à synchroniser': 'Nothing to sync', 'Conflit': 'Conflict', 'Réessayer': 'Retry', 'Vider le cache': 'Clear cache', 'Synchroniser maintenant': 'Sync now', 'Alerte': 'Alert', 'Secondaire': 'Secondary' });
Object.assign(AR, { 'Plus': 'المزيد', 'Personnaliser': 'تخصيص', 'Synchronisation': 'المزامنة', 'Synchronisation…': 'جارٍ المزامنة…', 'Hors ligne': 'غير متصل', 'En ligne': 'متصل', 'Compte': 'الحساب', 'à envoyer': 'للإرسال', 'conflit(s)': 'تعارض', 'Mode': 'الوضع', 'Auto': 'تلقائي', 'Clair': 'فاتح', 'Sombre': 'داكن', 'Couleur d\'accent': 'لون التمييز', 'Densité': 'الكثافة', 'Compacte': 'مدمجة', 'Confortable': 'مريحة', 'Aérée': 'واسعة', 'Arrondis': 'الزوايا', 'Taille du texte': 'حجم الخط', 'Menu latéral': 'القائمة الجانبية', 'Contraste': 'التباين', 'Animations': 'الحركات', 'Réinitialiser': 'إعادة ضبط', 'Terminé': 'تم', 'Aperçu': 'معاينة', 'Rien à synchroniser': 'لا شيء للمزامنة', 'Conflit': 'تعارض', 'Réessayer': 'إعادة المحاولة', 'Vider le cache': 'مسح الذاكرة المؤقتة', 'Synchroniser maintenant': 'زامن الآن', 'Alerte': 'تنبيه' });
import { MORE, MORE_NAMES } from './i18n_more.js';
const DICT = { fr: {}, en: EN, ar: AR, ...MORE };
const BUILTIN = [['fr', 'Français'], ['en', 'English'], ['ar', 'العربية'], ...Object.entries(MORE_NAMES)];
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'ku', 'sd']);
let custom = []; // langues ajoutées par le super-administrateur : [{code,name,rtl}]
export const languages = () => [...BUILTIN, ...custom.filter((c) => !BUILTIN.some(([k]) => k === c.code)).map((c) => [c.code, c.name])];
export const isRtl = (l) => RTL.has(l) || custom.some((c) => c.code === l && c.rtl);
export const seenKeys = new Set(); // libellés demandés pendant la session (alimente l'éditeur de traductions)
export let lang = (() => { try { return localStorage.getItem('lang') || 'fr'; } catch { return 'fr'; } })();
export const t = (s) => { if (typeof s === 'string' && s.length < 200) seenKeys.add(s); return DICT[lang]?.[s] ?? (lang !== 'fr' && lang !== 'ar' ? EN[s] : undefined) ?? s; };
export const knownKeys = () => [...new Set([...Object.keys(EN), ...seenKeys])].sort((a, b) => a.localeCompare(b));
export const dictOf = (l) => DICT[l] || {};
export function setLang(l) {
  lang = l; try { localStorage.setItem('lang', l); } catch {}
  document.documentElement.lang = l; document.documentElement.dir = isRtl(l) ? 'rtl' : 'ltr';
}
// Charge la liste des langues et le paquet de traductions personnalisé (serveur) ; sans réseau, les langues intégrées restent disponibles.
export async function loadLanguages() {
  try { const r = await fetch('/api/v1/i18n/languages'); if (r.ok) { custom = (await r.json()).custom || []; } } catch { /* hors ligne */ }
  if (!languages().some(([k]) => k === lang)) setLang('fr'); else setLang(lang);
  await loadPack(lang);
}
export async function loadPack(l) {
  if (['fr'].includes(l)) return;
  try { const r = await fetch('/api/v1/i18n/pack/' + encodeURIComponent(l)); if (r.ok) { const p = await r.json(); DICT[l] = { ...(DICT[l] || {}), ...(p.strings || {}) }; try { localStorage.setItem('i18n.' + l, JSON.stringify(p.strings || {})); } catch {} return; } } catch { /* hors ligne */ }
  try { const c = JSON.parse(localStorage.getItem('i18n.' + l) || 'null'); if (c) DICT[l] = { ...(DICT[l] || {}), ...c }; } catch { /* ignoré */ }
}
setLang(lang);
const LOC = { fr: 'fr-TN', en: 'en-GB', ar: 'ar-TN-u-nu-latn', es: 'es-ES', pt: 'pt-PT', de: 'de-DE', it: 'it-IT', tr: 'tr-TR' };
const loc = () => LOC[lang] || lang;
export const fmtDate = (s) => (s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + 'Z').toLocaleString(loc(), s.length <= 10 ? { dateStyle: 'medium' } : { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtNum = (n) => new Intl.NumberFormat(loc()).format(n);
