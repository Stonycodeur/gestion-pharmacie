# Passage en production — ce qui reste à faire

L'état actuel est un **dev fonctionnel**. Voici l'écart honnête jusqu'à une mise en ligne, par ordre de priorité.

## 1. Décisions à prendre (cahier §17)
Pays d'exploitation et réglementation (ordonnances, produits contrôlés, conservation, taxes, facturation), pharmacie unique ou réseau, volumétrie, hors-ligne, prestataires SMS/e-mail/paiement, hébergement, matériel (scanners, imprimantes). Les paramètres de démonstration (devise, validité d'ordonnance, taxes) doivent être remplacés en conséquence.

## 2. Base de données : deux voies
* **Voie A — MariaDB (conforme au cahier)** : `database/mariadb/Gestion_pharmacie.sql` est généré depuis le schéma de dev. Étapes : (1) valider ce script sur une instance MariaDB 10.6+ de test ; (2) remplacer `server/db.js` par un adaptateur `mysql2/promise` (mêmes fonctions `get/all/run/insert/tx`, mais **asynchrones** : les appels dans `routes/*`, `sales.js`, `stock.js` passent à `await`) ; (3) transformer les transactions `BEGIN IMMEDIATE` en `START TRANSACTION` + verrous `SELECT … FOR UPDATE` sur `stock_levels` ; (4) remplacer les fonctions SQLite (`datetime('now')`, `julianday`, `strftime`, `date('now')`) par `NOW()`, `DATEDIFF`, `DATE_FORMAT`, `CURDATE()` ; (5) rejouer `npm test` contre MariaDB. Les 20 tests servent de filet de non-régression.
* **Voie B — SQLite durci (pharmacie unique, une seule instance)** : acceptable pour un site unique (WAL, sauvegardes chiffrées, un seul processus). Ne convient pas à un réseau multi-serveurs.

## 3. Sécurité avant exposition Internet
- Définir `NODE_ENV=production`, `JWT_SECRET` (≥ 32 car.), `MFA_REQUIRED_FOR_PRIVILEGED=true`, `BACKUP_KEY` ; **supprimer les comptes `@demo.local`** (ne jamais lancer `seed` en production).
- TLS : `docker-compose.yml` + `Caddyfile` fournis (HTTPS automatique). Vérifier l'en-tête `X-Forwarded-For` (déjà pris en compte en production derrière le proxy).
- Limiteur de débit et verrouillage sont en mémoire : à déplacer vers Redis si plusieurs instances.
- Fichiers d'ordonnances : types et signatures contrôlés, stockage privé, accès tracé ; antivirus **ClamAV** pris en charge (`CLAMD_HOST`, voir `.env.example`) ; prévoir le chiffrement au repos du volume.
- Faire un test d'intrusion / revue OWASP avant l'ouverture (critère de recette §16).
- E-mail (SMTP) et SMS (webhook) : renseigner `SMTP_*`, `SMS_WEBHOOK_URL`, `APP_URL` — sans eux, « mot de passe oublié » ne peut envoyer aucun lien en production (en développement le lien s'affiche dans la console du serveur). Notifications push mobiles : non incluses.
- Premier super-administrateur : l'écran de configuration l'exige avec `SETUP_TOKEN` en production. Créez **au moins deux** super-administrateurs (le dernier actif ne peut être ni supprimé ni désactivé) et activez leur MFA.

## 4. Exploitation
- Sauvegarde quotidienne : `BACKUP_KEY=… node tools/backup.js backup` (cron) puis copie hors site ; **test de restauration** : `node tools/backup.js verify fichier.enc`. Définir RPO/RTO.
- Supervision : `/health` pour la sonde ; journaliser stdout vers votre collecteur.
- Migrations : ajouter chaque évolution de schéma dans `MIGRATIONS` (`server/db.js`), jamais de modification manuelle.

## 5. Check-list de recette avant ouverture
1. `npm test` (86 tests) et `npm run check:dialect` ; **`npm run test:mariadb` sur un vrai MariaDB** (jamais exécuté dans l'environnement de génération).
2. `cd mobile && npm install && npx expo start` : application mobile jamais exécutée ici.
3. Test de restauration d'une sauvegarde, test d'intrusion/OWASP, vérification des valeurs réglementaires par défaut (devise, taxes, durées).
4. Essai réel : SMTP/SMS, HTTPS (le mode hors ligne et l'installation sur écran d'accueil l'exigent), 2 super-administrateurs avec MFA.

## 6. Hors périmètre actuel
Demandes de prix fournisseurs, livraison à domicile avec suivi, paiements en ligne (contrat prestataire), OCR/IA (toujours avec validation humaine), prévisions avancées, comptabilité/ERP complète, notifications push.


## Ajouts de cette version : à vérifier avant l'ouverture au public

1. **Proxy** : derrière nginx/Caddy, mettre `TRUSTED_PROXY=true` et écraser l'en-tête (`proxy_set_header X-Forwarded-For $remote_addr;`). Sinon l'IP du journal d'audit = celle du proxy.
2. **Paiements en ligne** : créer le mode (Paramètres → Modes de paiement), saisir les clés Stripe/Konnect, renseigner `API_PUBLIC_URL` (HTTPS), déclarer l'URL de webhook chez le prestataire (`/api/v1/payments/webhook/stripe` ou `/konnect`). Faire un **paiement réel de faible montant** puis un remboursement. Garder `PAYMENT_SANDBOX=false`.
3. **Push** : `PUSH_ENABLED=true`, compiler l'application avec EAS (projectId) et tester sur un vrai téléphone iOS et Android.
4. **Comptabilité** : saisir une écriture d'ouverture pour le stock initial (débit 31 / crédit 101) et le capital ; faire valider le plan comptable et le traitement de la TVA par votre expert-comptable.
5. **Livraison** : créer les chauffeurs (matricule) ; fixer les frais dans les paramètres (`delivery_fee`).
6. **Test d'intrusion indépendant** : la suite automatisée ne remplace pas un audit externe (scan réseau, durcissement serveur, revue de configuration TLS).

## Réseau d'établissements (pays, invités, chauffeurs, aide, corbeille)
- `APP_URL` doit être l'adresse publique (https) : elle sert aux logos et liens des e-mails (bienvenue, demandes de prix).
- Pays/indicatifs : gérés par le super-administrateur (Réseau → Pays). Les drapeaux sont dessinés en SVG intégré (pas de fichier externe) ; un pays sans drapeau dessiné s'affiche sans image.
- Super-administrateur principal : le premier créé ; seul lui peut accorder/retirer ce statut ; il ne peut pas supprimer son propre compte.
- Corbeille : utilisateurs, fournisseurs, produits et chauffeurs supprimés y restent 90 jours (restauration possible), puis purge automatique au démarrage et chaque jour. Les comptes invités expirent après 2 jours.
- Carte : plan SVG sans fond de carte (aucun service externe, fonctionne hors ligne). Position chauffeur : GPS du navigateur/du téléphone, envoi toutes les ~5 s, nécessite HTTPS.
- Non vérifié sur matériel réel : GPS chauffeur sur téléphones, MariaDB sur un vrai serveur, écrans mobiles Expo des nouvelles fonctions (le site web est, lui, adaptatif et utilisable sur téléphone).
