// Catalogue mondial de moyens de paiement : le super-administrateur les ajoute en un clic (créés INACTIFS, à configurer puis activer).
// family = regroupement d'affichage ; kind = famille comptable ; fields = infos demandées au client (jamais de PIN, mot de passe ni CVV).
const phone = (label) => [{ name: 'phone', label, type: 'tel', required: true }];
const mm = (code, label, countries, cur) => ({ code, label, kind: 'mobile', family: 'mobile_money', countries, currencies: cur, fields: phone(`Numéro ${label}`) });
export const CATALOG = [
  mm('airtel_money', 'Airtel Money', 'CG,CD,GA,NE,TD,MW,ZM,KE,UG,TZ,RW,MG,SC,NG', 'XAF,CDF,XOF,KES,UGX,TZS,RWF,MWK,ZMW'),
  mm('orange_money', 'Orange Money', 'SN,CI,ML,BF,NE,GN,CM,CD,CF,MG,MA,TN,JO', 'XOF,XAF,GNF,CDF,MGA,MAD,EUR'),
  mm('mtn_momo', 'MTN Mobile Money', 'CM,CI,GH,BJ,CG,GN,UG,RW,ZA,NG,ZM', 'XAF,XOF,GHS,UGX,RWF,ZAR,NGN,ZMW'),
  mm('moov_money', 'Moov Money', 'BJ,TG,CI,BF,NE,ML,CF,GA', 'XOF,XAF'),
  mm('mpesa', 'M-Pesa', 'KE,TZ,CD,MZ,LS,GH,EG,ET', 'KES,TZS,CDF,MZN,GHS'),
  mm('free_money', 'Free Money', 'SN', 'XOF'),
  mm('flooz', 'Flooz', 'TG,BJ', 'XOF'),
  mm('tmoney', 'TMoney', 'TG', 'XOF'),
  mm('wave', 'Wave', 'SN,CI,ML,BF,GM,UG', 'XOF,GMD,UGX'),
  mm('local_wallet', 'Autre solution locale (portefeuille mobile)', '', ''),
  { code: 'visa', label: 'Visa', kind: 'card', family: 'card', fields: [], hosted: true },
  { code: 'mastercard', label: 'Mastercard', kind: 'card', family: 'card', fields: [], hosted: true },
  { code: 'amex', label: 'American Express', kind: 'card', family: 'card', fields: [], hosted: true },
  { code: 'discover', label: 'Discover', kind: 'card', family: 'card', fields: [], hosted: true },
  { code: 'unionpay', label: 'UnionPay', kind: 'card', family: 'card', fields: [], hosted: true },
  { code: 'paypal', label: 'PayPal', kind: 'wallet', family: 'wallet', fields: [] },
  { code: 'apple_pay', label: 'Apple Pay', kind: 'wallet', family: 'wallet', fields: [] },
  { code: 'google_pay', label: 'Google Pay', kind: 'wallet', family: 'wallet', fields: [] },
  { code: 'samsung_pay', label: 'Samsung Pay', kind: 'wallet', family: 'wallet', fields: [] },
  { code: 'amazon_pay', label: 'Amazon Pay', kind: 'wallet', family: 'wallet', fields: [] },
  { code: 'bank_transfer', label: 'Virement bancaire', kind: 'transfer', family: 'bank', fields: [{ name: 'payer_ref', label: 'Référence ou nom de l\'ordre de virement', type: 'text', required: false }] },
  { code: 'open_banking', label: 'Open Banking', kind: 'transfer', family: 'bank', fields: [] },
  { code: 'sepa', label: 'Virement SEPA', kind: 'transfer', family: 'bank', countries: 'FR,DE,ES,IT,PT,BE,NL,LU,IE,AT,FI,GR,SK,SI,EE,LV,LT,MT,CY,HR', currencies: 'EUR', fields: [] },
  { code: 'swift', label: 'Virement international SWIFT', kind: 'transfer', family: 'bank', fields: [{ name: 'payer_ref', label: 'Référence du virement', type: 'text' }] },
  { code: 'crypto_btc', label: 'Bitcoin (BTC)', kind: 'wallet', family: 'crypto', fields: [] },
  { code: 'crypto_eth', label: 'Ethereum (ETH)', kind: 'wallet', family: 'crypto', fields: [] },
  { code: 'crypto_usdt', label: 'USDT (Tether)', kind: 'wallet', family: 'crypto', fields: [] },
  { code: 'crypto_other', label: 'Autre cryptomonnaie autorisée', kind: 'wallet', family: 'crypto', fields: [] },
];
