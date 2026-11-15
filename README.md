# Gestion_pharmacie — plateforme de gestion pharmaceutique (version DEV)

> Description détaillée du projet et des technologies : [`DESCRIPTION.md`](DESCRIPTION.md).

Application web (back-office, caisse, espace client) + application mobile + API REST, d'après le *Cahier de demande – plateforme de gestion pharmaceutique*.
**État : mode développement, testé** (56 tests d'intégration + audits navigateur : aucun débordement de 320 à 1440 px, parcours hors ligne). Voir [`docs/MISE_EN_LIGNE.md`](docs/MISE_EN_LIGNE.md) avant production.

## Démarrer

Prérequis : **Node.js ≥ 22.13** (aucune dépendance npm pour le serveur et le web). Pas à pas VS Code : [`docs/DEMARRAGE_VSCODE.md`](docs/DEMARRAGE_VSCODE.md).

```bash
npm run dev        # http://localhost:3000 — API : /api/v1 — doc : /api-docs
npm test           # 45 tests
```

**Premier lancement : base vide, aucune donnée de démonstration.** L'écran « Première configuration » crée votre établissement et le compte super-administrateur ; vous créez ensuite les vrais comptes dans *Administration → Utilisateurs*.

Données fictives pour explorer (facultatif, **efface la base**) : `npm run demo` — comptes `superadmin@`, `admin@`, `responsable@`, `pharmacien@`, `preparateur@`, `caissier@`, `stock@`, `comptable@`, `auditeur@`, `client@demo.local`, mot de passe `Demo#Pharma2026`. `npm run db:wipe` revient à une base vide.

## Interface web et mobile

* **Adaptative** : barre latérale (≥ 1100 px), rail d'icônes (tablette), **barre d'onglets + feuille « Plus » façon application mobile** (< 760 px). Tableaux en cartes sur mobile, fenêtres en feuilles basses, zones tactiles ≥ 40 px, zones sûres (encoche) respectées. Contrôle automatisé : aucun débordement horizontal sur 18 pages × 5 tailles.
* **Icônes SVG** partout (aucun emoji) ; effets : transitions de page, ondes sur boutons, squelettes de chargement, survol/pression, barres animées, flou translucide ; réductibles (préférence « Animations »).
* **Personnalisation** (menu du compte → *Personnaliser*) : mode auto/clair/sombre, couleur d'accent (palette + sélecteur libre), densité, arrondis, taille du texte, menu en icônes, contraste élevé, animations, langue FR/EN/AR (RTL). L'administrateur fixe la couleur et le nom de l'établissement (*Paramètres → Identité visuelle*), affichés dès l'écran de connexion.
* **Hors connexion** : voir [`docs/HORS_CONNEXION.md`](docs/HORS_CONNEXION.md).
* **Application mobile** (`mobile/`, Expo/React Native) : stock, alertes, ordonnances, commandes, espace client, icônes SVG, cache de lecture hors ligne, couleur de l'établissement. **Non exécutée ici** (pas de npm/Expo) : `cd mobile && npm install && npx expo start`.

## Couverture du cahier

| Domaine | État |
|---|---|
| **Gestion des comptes par le super-admin** (personnel **et clients**) : créer, modifier (nom, e-mail, établissement, rôle), suspendre (durée ou illimitée, avec motif, réactivation automatique), désactiver, réactiver, déverrouiller, réinitialiser MFA / mot de passe, fermer les sessions, historique de connexions, **supprimer** (définitif si aucune trace, sinon anonymisé), actions groupées, protections (dernier super-admin, soi-même) ; établissements (désactiver/supprimer), rôles personnalisés, catégories, fabricants, fournisseurs, caisses | ✅ |
| **Mot de passe oublié** (lien e-mail à usage unique, 1 h), **e-mail SMTP / SMS (webhook)** pour les notifications clients, **antivirus ClamAV** optionnel | ✅ (nécessite vos identifiants SMTP/SMS/clamd) |
| Authentification scrypt, JWT 15 min, refresh rotatif (détection de réutilisation), verrouillage progressif, limitation de débit, **MFA TOTP** | ✅ |
| RBAC (10 rôles, 49 permissions modifiables), cloisonnement par établissement, séparation des tâches | ✅ |
| Multi-établissements, paramètres, numérotation, **transferts inter-pharmacies** | ✅ |
| Catalogue, prix + historique, import/export CSV, alternatives soumises au pharmacien, recherche tolérante | ✅ |
| Stock : lots, FEFO/FIFO, quarantaine/casse, mouvements en ajout seul, alertes, rappel de lot, traçabilité, inventaires en aveugle, chaîne du froid | ✅ |
| Achats : bons de commande, approbation, réception avec lots, écarts de prix, **retours/avoirs fournisseurs, règlements et soldes, relevés** | ✅ (demandes de prix : non) |
| Caisse : remises plafonnées, multi-paiements, **vente à crédit / reste à payer**, **acomptes de commande**, encaissement de soldes clients, tickets + **PDF**, remboursements motivés, idempotence, **vente hors ligne** | ✅ |
| Ordonnances : dépôt contrôlé, workflow, checklist pharmacien, reliquats — **aucune validation automatique/OCR** | ✅ |
| Clients, fidélité, consentement, anonymisation ; commandes/réservations FEFO ; espace client | ✅ |
| Rapports ventes/marge/paiements/péremptions/pertes/taxes en **CSV, Excel, PDF** (tracé) | ✅ (PDF : pas de glyphes arabes) |
| **Clôture de périodes** (rapport Z, jours passés uniquement, irréversible) | ✅ (comptabilité/ERP complète : non) |
| Audit en ajout seul ; sauvegarde AES-256-GCM + restauration vérifiée (SQLite et MariaDB) | ✅ |
| **MariaDB** : schéma généré, pilote synchrone, traduction de dialecte, `docker-compose.yml` (mariadb + app + Caddy TLS) | ✅ codé et testé avec serveur simulé — **jamais exécuté sur un vrai MariaDB** ([`docs/MARIADB.md`](docs/MARIADB.md)) |
| **Paiements** configurés par le super-admin (espèces, TPE, virement, portefeuille, **Stripe**, **Konnect**, bac à sable) : clés chiffrées AES-256-GCM, webhooks signés/revérifiés, **paiement en ligne** depuis le portail (acompte crédité uniquement après confirmation du prestataire), confirmation manuelle par le personnel | ✅ testé avec prestataires simulés — **à valider en réel avec vos clés** |
| **Livraison à domicile** : chauffeurs (nom + **matricule**), n° de livraison, étapes *émise → reçue → en cours → livrée* (+ échec/annulation), **suivi temps réel** côté client (SSE) avec nom et matricule du chauffeur, historique, notifications | ✅ |
| **Demandes de prix fournisseurs** : brouillon, envoi e-mail, saisie des devis, comparatif (meilleur prix), attribution → bons de commande, création depuis les prévisions | ✅ |
| **Comptabilité** : plan comptable, écritures **automatiques** (ventes, encaissements, retours, achats, règlements, acomptes, pertes) + **écritures manuelles** équilibrées/extournables/verrouillables, grand livre, balance, compte de résultat, bilan, TVA, exports CSV/Excel/PDF | ✅ (TVA déductible sur achats : saisie manuelle ; voir limites) |
| **Prévisions avancées** : Holt amorti + saisonnalité hebdomadaire, stock de sécurité 95 %, point de commande, quantité suggérée, date de rupture, risque de péremption FEFO, ABC | ✅ |
| **Dispatch des courses** : chauffeurs multi-pharmacies, lieu de départ (pharmacie ou Google Maps), courses proposées, prix base + km, contre-prix alerté (pharmacie, admin, super-admins), choix du chauffeur par le client, « produit récupéré », **vraie carte** (OpenStreetMap par défaut, sans clé ; Google Maps si `GOOGLE_MAPS_API_KEY` est renseignée), profils partagés, messagerie/appel/note/signalement avec pièces jointes, vue pharmacie en lecture seule | ✅ testé (simulé) ; **tuiles et itinéraires réels non testés ici (pas d'accès réseau)** |
| **Finance ouverte** : logo dans le PDF, remboursement exécuté chez Stripe / passerelle HTTP, abonnements, KYC, SMS configurable, clés d'API + webhooks signés, rapports comptables détaillés | ✅ testé avec simulateurs |
| **Notifications push** mobiles (Expo) + préférences de notification par client (cloche, push, e-mail, SMS) | ✅ code + test serveur ; **jamais testé sur un vrai téléphone** |
| **Espace client personnalisable** (blocs d'accueil, ordre, thème, notifications) **synchronisé** entre appareils | ✅ |
| **Super-admin** : permissions individuelles et par rôle, gestion complète des comptes, usurpation d'identité tracée (30 min) | ✅ |
| Sécurité : suite d'**intrusion automatisée** (`tests/security.test.js` : injection SQL, JWT forgés, IDOR inter-pharmacies/clients, élévation de privilèges, XSS/CSP, traversée de chemin, téléversements, rejeu de refresh, CORS/CSRF, webhooks falsifiés…) | ✅ — **a révélé et corrigé 2 failles** (révocation de session non validée, usurpation de l'IP via X-Forwarded-For) |
| Non inclus | OCR (exclu volontairement : aucune validation automatique d'ordonnance), application chauffeur dédiée (les statuts sont saisis par le personnel), TVA déductible automatique, transferts inter-pharmacies en comptabilité, assistant IA |

## Écarts assumés (à valider)

* **Stack** : le cahier demande React + NestJS + MariaDB ; ici Node 22 natif + SQLite (dev) / MariaDB (prod) + web JS modulaire sans build, faute de npm/Docker dans l'environnement de génération. API, modèle de données et règles métier restent portables.
* **Valeurs réglementaires par défaut** (TND/3 décimales, ordonnances 90 j, taxes 0/7/19 %, 2–8 °C) = démonstration : à confirmer pour votre pays (§17).
* Hachage scrypt (Argon2id absent de Node 22).

## Structure

```
server/    API (http.js, routes/*, sales.js, stock.js, export.js, drivers SQLite/MariaDB, migrations/)
web/       interface (js/pages/*, icons.js, theme.js, offline.js, sw.js, css/app.css)
mobile/    application Expo / React Native
database/mariadb/   schéma de production (npm run gen:mariadb)
tools/     backup.js, gen-mariadb.js, check-dialect.js, test-mariadb.js, wipe.js
tests/     tests d'intégration
docs/      DEMARRAGE_VSCODE, MISE_EN_LIGNE, MARIADB, HORS_CONNEXION
```

## Réseau d'établissements
Pays et drapeaux, téléphone avec indicatif, mode invité, recherche de médicament et de pharmacie la plus proche, aide/réclamations, échanges entre pharmacies, fichiers avec aperçu et validation, demandes de prix, chauffeurs avec suivi GPS, rendez-vous médecin, corbeille 90 jours. Détails : `docs/MISE_EN_LIGNE.md`.
