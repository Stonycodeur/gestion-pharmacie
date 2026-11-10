// FR / EN / AR. Le passage à l'arabe (RTL) demande un redémarrage de l'application (limitation React Native).
import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
export type Lang = 'fr' | 'en' | 'ar';
let lang: Lang = 'fr';
const D: Record<string, Record<Lang, string>> = {
  home: { fr: 'Accueil', en: 'Home', ar: 'الرئيسية' }, stock: { fr: 'Stock', en: 'Stock', ar: 'المخزون' }, alerts: { fr: 'Alertes', en: 'Alerts', ar: 'تنبيهات' },
  orders: { fr: 'Commandes', en: 'Orders', ar: 'الطلبات' }, rx: { fr: 'Ordonnances', en: 'Prescriptions', ar: 'الوصفات' }, account: { fr: 'Compte', en: 'Account', ar: 'الحساب' },
  catalog: { fr: 'Catalogue', en: 'Catalog', ar: 'الكتالوج' }, myorders: { fr: 'Mes commandes', en: 'My orders', ar: 'طلباتي' }, myrx: { fr: 'Mes ordonnances', en: 'My prescriptions', ar: 'وصفاتي' },
  mydeliveries: { fr: 'Livraisons', en: 'Deliveries', ar: 'التوصيل' }, matricule: { fr: 'Matricule', en: 'Badge no.', ar: 'رقم التسجيل' },
  login: { fr: 'Connexion', en: 'Sign in', ar: 'تسجيل الدخول' }, email: { fr: 'E-mail', en: 'Email', ar: 'البريد الإلكتروني' }, password: { fr: 'Mot de passe', en: 'Password', ar: 'كلمة المرور' },
  otp: { fr: 'Code à 6 chiffres', en: '6-digit code', ar: 'رمز من 6 أرقام' }, search: { fr: 'Rechercher', en: 'Search', ar: 'بحث' }, scan: { fr: 'Scanner', en: 'Scan', ar: 'مسح' },
  logout: { fr: 'Déconnexion', en: 'Sign out', ar: 'تسجيل الخروج' }, reserve: { fr: 'Réserver', en: 'Reserve', ar: 'حجز' }, send_rx: { fr: 'Envoyer une ordonnance', en: 'Send a prescription', ar: 'إرسال وصفة' },
  empty: { fr: 'Aucun élément', en: 'Nothing here', ar: 'لا شيء' }, today: { fr: 'Aujourd\'hui', en: 'Today', ar: 'اليوم' }, month: { fr: 'Ce mois', en: 'This month', ar: 'هذا الشهر' }, language: { fr: 'Langue', en: 'Language', ar: 'اللغة' },
  restart: { fr: 'Redémarrez l\'application pour appliquer l\'arabe (droite→gauche).', en: 'Restart the app to apply Arabic (right-to-left).', ar: 'أعد تشغيل التطبيق لتطبيق اللغة العربية.' },
};
export const t = (k: string) => D[k]?.[lang] ?? k;
export const getLang = () => lang;
export async function loadLang() { const l = (await SecureStore.getItemAsync('gp_lang')) as Lang | null; if (l) lang = l; I18nManager.allowRTL(true); }
export async function setLang(l: Lang) { lang = l; await SecureStore.setItemAsync('gp_lang', l); I18nManager.forceRTL(l === 'ar'); }
