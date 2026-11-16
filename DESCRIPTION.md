# Gestion Pharmacie — description du projet

Plateforme complète de gestion de pharmacies : **site web** (back-office, caisse, espace client, espace chauffeur), **application mobile** (Android / iOS), **API REST** et **réseau multi-pharmacies** (plusieurs pays, plusieurs établissements, une seule installation).

Adresse de production : https://pharmacie.jtconsultingcg.com · Dépôt : `Stonycodeur/gestion-pharmacie-v1`

---

## 1. À quoi ça sert

| Pour qui | Ce que l'application permet |
|---|---|
| **Pharmacien / personnel** | Caisse, ventes, stock par lots (FEFO), achats, inventaires, ordonnances, clients, commandes, rapports, comptabilité, prévisions de stock |
| **Administrateur de pharmacie** | Tout ce qui précède + utilisateurs, rôles et droits, paramètres, chauffeurs, finance (abonnements, KYC, API) |
| **Super-administrateur** | Contrôle global du réseau : établissements, pays, comptes, moyens de paiement, commissions, versements, droits, journal d'audit |
| **Client** | Recherche d'un médicament dans toutes les pharmacies, réservation, ordonnance en ligne, paiement, reçus, livraison, rendez-vous, abonnements |
| **Chauffeur** | Courses proposées, acceptation ou contre-prix, carte en temps réel, messagerie, profil (photo, pièce d'identité) |
| **Médecin** | Espace dédié (ordonnances, rendez-vous) |

Règles fondatrices : **une ordonnance n'est jamais validée automatiquement** (toujours un humain) ; aucune donnée de démonstration n'est affichée tant que vous ne la demandez pas ; aucun code PIN, mot de passe ou numéro de carte n'est jamais collecté ni stocké pour un paiement.

---

## 2. Fonctionnalités principales

**Pharmacie** — catalogue et prix (historique), stock par lots avec péremption, quarantaine, rappels de lot, chaîne du froid, inventaires en aveugle, transferts entre pharmacies, retours fournisseurs, demandes de prix (RFQ), clôture de période.

**Caisse et clients** — remises plafonnées, multi-paiements, vente à crédit, acomptes, fidélité, consentement/anonymisation, tickets et PDF.

**Réseau** — pays (drapeaux), villes, établissements localisés, recherche globale d'un médicament, mode invité, centre d'aide, rendez-vous avec pièces jointes, corbeille réversible.

**Paiements** — catalogue mondial de moyens (cartes, Mobile Money, portefeuilles, virements, crypto…), multi-devises, commissions (pourcentage + fixe), détection de fraude, **reçus signés** (QR de vérification publique, PDF avec **logo de la pharmacie**, e-mail), remboursements **exécutés chez le prestataire** (Stripe, passerelle HTTP configurable), versements aux établissements avec **KYC**, **abonnements** (paiements récurrents), **SMS**, **API externe** (clés + webhooks signés), exports PDF/Excel/CSV.

**Comptabilité** — plan comptable, écritures automatiques, journal, grand livre, balance, compte de résultat, bilan, TVA, **flux de trésorerie, comparatif N/N-1, encaissements en ligne, échéances impayées**.

**Livraison et chauffeurs** — voir §3.

**Sécurité** — mots de passe scrypt, JWT court + refresh rotatif, double authentification TOTP, verrouillage progressif, limitation de débit, cloisonnement par établissement, journal d'audit en ajout seul, chiffrement des clés et sauvegardes (AES-256-GCM), **antivirus intégré** sur tous les fichiers reçus (+ ClamAV en option), en-têtes CSP stricts.

**Confort** — interface adaptative (téléphone → grand écran), icônes SVG, thème clair/sombre/auto, couleur et densité personnalisables, **mode hors connexion** (lecture en cache + file d'attente des actions rejouée au retour du réseau), installation PWA, notifications (cloche, push, e-mail, SMS) qui **disparaissent une fois lues**.

---

## 3. Livraison : chauffeurs, courses et carte

1. L'administrateur crée le **compte chauffeur** et l'affecte à **une ou plusieurs pharmacies** (livraisons uniquement). Pour chaque pharmacie il fixe le **lieu de départ** : position de la pharmacie, ou lieu choisi / recherché sur **Google Maps**.
2. Le client demande une livraison. Le **prix = frais de base + prix au kilomètre** (fixés par l'administrateur ; le chauffeur ne peut pas les modifier) est affiché au client et au chauffeur.
3. Les chauffeurs disponibles voient la **course proposée**. Ils peuvent **accepter au prix du tarif** (affectation immédiate) ou **proposer leur prix** (utile aux heures tardives) : la pharmacie de départ, son administrateur et les super-administrateurs sont alertés ; le client choisit parmi les offres.
4. Le client peut aussi **choisir son chauffeur** parmi ceux qui sont disponibles, avec photo, note et prix.
5. La pharmacie clique sur **Lancer** quand toutes les informations sont renseignées et que le chauffeur a accepté. Le chauffeur clique sur **« Produit récupéré »** : cela enclenche le départ s'il n'a pas déjà été lancé.
6. **Vraie carte** (OpenStreetMap par défaut, Google Maps si la clé est renseignée) : points nommés pour la pharmacie (départ), le chauffeur et le client, position du chauffeur en temps réel et **ligne du trajet routier** (chauffeur → pharmacie → client avant la prise du produit, puis chauffeur → client).
7. Dès le départ : **profils partagés** (photo, nom, matricule, véhicule) pour savoir qui apporte le produit et à qui le remettre ; **messagerie avec pièces jointes**, **appel**, **note** et **signalement** (avec pièces jointes) dans les deux sens. **Une fois la livraison terminée, la conversation est fermée** (plus d'écriture ni d'appel, ni côté client ni côté chauffeur) : seul l'historique reste consultable.
8. La pharmacie a une **vue en lecture seule** (profils, offres, conversation). Seuls l'**administrateur et le super-administrateur** modifient les chauffeurs ; la pièce d'identité n'est visible que d'eux (consultation journalisée).

---

## 4. Technologies utilisées

| Couche | Technologie |
|---|---|
| **Serveur** | **Node.js 22** — aucune dépendance npm (modules natifs `node:http`, `node:sqlite`, `node:crypto`, `node:zlib`) |
| **Base de données** | **SQLite** (développement, tests) · **MariaDB 10.6+** (production) via `mysql2` optionnel et un pont synchrone en *worker thread* ; schéma et migrations générés (`tools/gen-mariadb.js`) ; reconnexion automatique |
| **Interface web** | **JavaScript natif (ES modules)**, sans framework ni étape de compilation · CSS maison · icônes **SVG** · **PWA** (Service Worker, manifeste) |
| **Hors connexion** | Service Worker + cache de lecture + file d'attente d'actions (IndexedDB / stockage local) |
| **Mobile** | **Expo / React Native** (SDK 52) : coque `react-native-webview` qui charge l'application, notifications push (`expo-notifications`), géolocalisation (`expo-location`), état réseau (`netinfo`) — mêmes fonctions que le web |
| **Cartes** | **OpenStreetMap par défaut** (sans clé ni carte bancaire) : moteur de tuiles maison, recherche d'adresse Nominatim et itinéraire OSRM via le serveur · **Google Maps** (Maps, Places, Directions, Geocoding) dès que `GOOGLE_MAPS_API_KEY` est renseignée · schéma SVG hors connexion |
| **Documents** | Générateur **PDF** maison (texte, QR, images JPEG/PNG avec transparence) · **XLSX** maison · **CSV** · **QR Code** maison |
| **Paiements** | Stripe, Konnect, Mobile Money & agrégateurs via **passerelle HTTP configurable**, bac à sable intégré ; webhooks signés HMAC-SHA256 |
| **Messagerie** | SMTP (e-mail), passerelle HTTP (SMS), notifications push Expo, flux temps réel **SSE** |
| **Sécurité** | scrypt, JWT, TOTP, AES-256-GCM, CSP, antivirus intégré + ClamAV optionnel |
| **Déploiement** | **Docker** (image `node:22-alpine`), **Render** (offre gratuite, sans disque : fichiers stockés en base), **Hostinger** (MariaDB), domaine `pharmacie.jtconsultingcg.com`, `docker-compose` (MariaDB + application + Caddy TLS) |
| **Qualité** | **Tests d'intégration Node** (`node --test`, plus de 100 scénarios), contrôle de dialecte SQLite/MariaDB, audits navigateur Playwright |

---

## 5. Organisation du dépôt

```
server/            API (index.js, routes/*.js), base (db.js, migrations/*.sql), paiements, reçus, PDF, antivirus, SMS…
web/               Application web : index.html, css/, js/ (pages/*.js, api.js, offline.js, gmap.js…), sw.js, manifest
mobile/            Application Expo / React Native (coque WebView + push + géolocalisation)
database/mariadb/  Schéma MariaDB généré + migrations
tests/             Tests d'intégration
tools/             Génération MariaDB, sauvegarde, diagnostic, contrôle de dialecte
docs/              Guides : démarrage, MariaDB, déploiement Render, mise en ligne, hors connexion
deploy/            Modèles de variables d'environnement et blueprint Render
Dockerfile · docker-compose*.yml · render.yaml · Caddyfile
```

## 6. Démarrer

```bash
npm run dev          # http://localhost:3000 (Node ≥ 22.13, aucune installation de paquets)
npm test             # tous les tests
npm run demo         # données fictives (efface la base)
```
Au premier lancement la base est vide : l'écran « Première configuration » crée l'établissement et le compte super-administrateur. Variables d'environnement : voir `.env.example` (base, secrets, SMTP, **GOOGLE_MAPS_API_KEY**, SMS…). Mise en ligne : `docs/MISE_EN_LIGNE.md` et `docs/DEPLOIEMENT_RENDER.md`.

## 7. Limites honnêtes

* **Cartes** : sans clé, l'application utilise les serveurs publics gratuits d'OpenStreetMap (tuiles, Nominatim, OSRM), soumis à des limites d'usage ; pour un fort trafic, héberger ses propres serveurs (`OSM_TILE_URL`, `NOMINATIM_URL`, `OSRM_URL`) ou renseigner `GOOGLE_MAPS_API_KEY` (compte de facturation Google requis).
* **Position du chauffeur** : envoyée tant que l'application reste ouverte au premier plan (pas de suivi en arrière-plan écran verrouillé).
* **Paiements réels, MariaDB Hostinger, notifications push, SMS** : codés et testés avec des simulateurs ; à valider avec vos vrais comptes.
* **Reçus** : « sceau électronique » HMAC (authenticité vérifiable), pas une signature électronique qualifiée au sens légal.
* **Antivirus** intégré (EICAR, scripts cachés, PDF actifs, exécutables…) : ce n'est pas un moteur à signatures complet ; ClamAV s'y branche pour une couverture complète.
* **Prélèvement automatique** des abonnements : l'application génère les échéances et relance ; elle ne conserve jamais de carte (le règlement se fait par un moyen de paiement ou en caisse).
* **PDF** : pas de glyphes arabes ; **logos** WebP non intégrés au PDF (JPEG/PNG oui).

## Ajouts de novembre 2026 (v-suivante)
- Réglages de paiement en langage clair (message au client, champs à demander, pays/devises en listes) ; code de confirmation SMS à usage unique avec chrono réglable par l'administrateur (jamais de PIN/mot de passe dans l'application).
- Contre-prix chauffeur : le client accepte ou refuse depuis sa livraison ; la pharmacie voit prix de base et prix du chauffeur (lecture seule) ; un chauffeur qui masque une course disparaît aussi du choix du client.
- Annulation de commande tant que la livraison n'est pas en cours ; relance de livraison (accord de la pharmacie si annulation client) ; démasquer une course.
- Notes de livraison uniques, validées par l'administrateur avant d'entrer dans la moyenne ; notes sur les clients visibles de la pharmacie et du super-administrateur seulement.
- Livraison terminée : plus d'itinéraire ni d'appel, seulement Historique / Noter / Signaler.
- Recherche instantanée dans toutes les listes de 6 lignes ou plus ; historiques grisés.
- Langues : français, anglais, arabe, espagnol, portugais, allemand, italien, turc + toute langue ajoutée par le super-administrateur (Paramètres → Langues & traductions, export/import JSON). Sonnerie personnelle importée depuis l'appareil (Personnaliser).
- Migrations 016 (relance), 017 (code SMS de paiement), 018 (validation des notes).

## Ajouts (suite) — contrôle total du super-administrateur, audit, exports, documents
- **Super-administrateur** : possède toutes les permissions (hors espaces personnels client/chauffeur/médecin) et les attribue aux autres rôles ou individuellement ; il supervise toutes les livraisons de toutes les pharmacies (case « Toutes les pharmacies »), leurs messages client↔chauffeur (lecture seule), notes, signalements.
- **Journal d'audit** : vraie adresse IP (derrière Render/Nginx/Cloudflare via en-têtes ; variable `TRUSTED_PROXY`), lieu approximatif (ville/région/pays/opérateur via ipwho.is, mis en cache dans `ip_geo`) et appareil (type, système, navigateur). La localisation par IP est approximative (ville, pas l'adresse exacte). Les adresses locales s'affichent « Réseau local ».
- **Exports partout** : chaque liste/tableau propose CSV, Excel (.xls), JSON, texte et PDF/impression des lignes affichées (après recherche).
- **Sonnerie personnelle** : Personnaliser → « Sonnerie des notifications » → « Choisir un son sur mon appareil » ; tout fichier audio (MP3, MPEG, WAV, OGG, M4A, AAC, FLAC…) jusqu’à 7 Mo, stocké dans l’appareil (IndexedDB) ; les formats en flux sont conservés coupés à 2 Mo, les conteneurs (M4A/MP4/WEBM) entiers ; lecture limitée à 10 s.
- **Historique** : bouton Masquer/Afficher l'historique (mémorisé) pour livraisons, courses et commandes.
- **Documents** (menu Fichiers → « Mes documents ») : dossiers et fichiers (images, PDF, texte, CSV, Word/Excel/PowerPoint, ODF, ZIP ≤ 8 Mo, analysés par l'antivirus), créer, renommer, déplacer, copier, supprimer, télécharger/aperçu, partager (lecture ou modification) avec un utilisateur ou un établissement entier, transférer la propriété ; le super-administrateur voit tout (« Tous les documents »). Tables `fm_nodes`, `fm_shares`.
- Migrations 019 (origine audit), 020 (gestionnaire de documents).

## Ajouts (suite) — pays, devises, modes de paiement par pharmacie, notifications ciblées
- **Pays du client** : l'inscription exige le pays et n'est possible que s'il existe une pharmacie active dans ce pays (liste filtrée `GET /countries?with_pharmacy=1`). Le client (et l'invité, qui choisit son pays) ne voit et ne peut choisir que les pharmacies de son pays : liste (`/portal/pharmacies`), recherche de médicaments, catalogue, commandes, livraisons, rendez-vous (contrôle central dans `activePharmacy`). Le super-administrateur peut, sur le profil du client (Utilisateurs → Modifier), changer son pays et cocher « Autoriser à voir les pharmacies de tous les pays » ; l'administrateur de pharmacie ne le peut pas.
- **Devises par pays** : chaque pays porte la liste de ses devises (pré-remplie pour ~190 pays, modifiable dans Établissements & pays). À la création/modification d'une pharmacie, les devises sont obligatoires et doivent appartenir au pays (le formulaire se met à jour quand on change de pays ; la première est la devise principale).
- **Modes de paiement propres à chaque pharmacie** (table `pharmacy_payment_methods`) : à la création d'une pharmacie — et pour les pharmacies existantes, à la première lecture — chaque mode reçoit des valeurs par défaut (espèces : caisse + livraison ; carte TPE : caisse + livraison ; paiement à la livraison : livraison ; chèque : caisse ; modes en ligne selon l'activation globale). Réglage : Paramètres → « Modes de paiement de la pharmacie » (cases Proposé / À la caisse / À la livraison / En ligne ; le super-administrateur choisit la pharmacie). Le paiement en ligne exige aussi que le mode soit activé en ligne par le super-administrateur et compatible avec le pays/la devise de la pharmacie. Cela corrige le message « Aucun mode de paiement n'est proposé » (les modes en ligne n'étaient filtrés que globalement par pays/devise).
- **Parcours de paiement client** : d'abord « Souhaitez-vous être livré ? » (Oui/Non). Non → « Payer en ligne » ou « Payer à la caisse ». Oui → « Espèces à la livraison », « Carte à la livraison », autre moyen à la livraison, ou « Payer en ligne ». Les modes affichés sont ceux de la pharmacie pour ce choix. Caisse/livraison enregistrent le mode (`POST /portal/orders/:id/pay-later`) et préviennent la pharmacie ; en ligne : code SMS et page sécurisée du prestataire comme avant (jamais de PIN/mot de passe/carte dans l'application).
- **Notifications** : compteur rouge sur chaque entrée du menu (barre latérale, onglets mobiles et feuille « Plus ») = notifications non lues dont le lien pointe vers cette page. Un clic sur la notification ouvre la page ET l'élément visé (`#/orders?id=…` : ligne mise en évidence et ouverte ; livraisons, ordonnances, espace client…). Sans page associée, le message s'affiche dans une fenêtre. Les alertes de stock/péremption/chaîne du froid/transferts renvoient vers Stock.
- Migration 021 (pays/devises/modes par pharmacie, pays du client, droit « toutes les pharmacies »).

## Ajouts (suite) — livraison : 4 modes, tarifs réglables, courses programmées
- **Demande de livraison conditionnée** : possible uniquement si la commande est au minimum « En préparation » (ou prête) **et** qu'au moins un chauffeur est disponible dans le secteur ; sinon le bouton « Livraison » reste masqué côté client (le serveur refuse aussi : `BAD_STATE` / `NO_DRIVER`). L'état est actualisé toutes les 30 s.
- **4 modes** : Économique (prix le plus bas, délai long, un chauffeur déjà occupé dans la zone peut l'accepter), Standard (recommandé, sélectionné par défaut), Express (priorité, aucune autre mission pendant la course), Programmée (date et heure choisies ≥ 20 min et ≤ 60 jours, demande réservée, rappel automatique 1 h avant au client, à la pharmacie et au chauffeur). Le client voit les 4 prix et délais en même temps, une carte (pharmacie, sa position, chauffeurs proches) et la liste des chauffeurs disponibles (nom, minutes et distance jusqu'à la pharmacie, distance de chez lui, statut, note).
- **Tarif** = (tarif de base du mode + coût au km × distance pharmacie → client, facteur routier 1,3), majoré du pourcentage Express. Réglages dans Paramètres → « Livraison : modes et tarifs » (par pharmacie) : tarifs de base des 4 modes, coût au km, distance maximale (au-delà : refus `TOO_FAR`), délai de chaque mode, majoration Express, autorisation de négocier, marge maximale de négociation. Route `GET/PUT /delivery-config`.
- **Contre-prix du chauffeur** : borné par la marge réglée (±x % du tarif) ; désactivable ; le message « Le champ prix doit être entre 0 et … » n'existe plus (message clair avec la fourchette autorisée). Le chauffeur voit le mode, le prix, le client, le départ, l'adresse et la distance.
- **Courses passées** : section repliable dans Livraisons (recherche, dates, pharmacie, chauffeur, statut) ; les courses terminées n'apparaissent plus dans les livraisons actives.
- Migration 022 (mode, date programmée, rappel).
- Non modifié : le démarrage de la course (la pharmacie lance, le chauffeur clique « Produit récupéré », le suivi GPS démarre ; « Produit livré » clôture) fonctionne comme avant.
- **Boutons « Prêt pour la livraison » / « Prêt »** (fiche commande, côté pharmacie) : si une livraison est demandée pour la commande, le bouton s'appelle « Prêt pour la livraison » ; sinon « Prêt » (retrait). Avec livraison : la livraison passe à « reçue », le chauffeur affecté est notifié (« Commande prête : rendez-vous à la pharmacie »), l'événement « Chauffeur en route vers la pharmacie » apparaît chez le client, qui reçoit « prête pour la livraison ». Sans livraison : « prête au retrait ». Si la livraison est demandée alors que la commande est déjà prête, le départ du chauffeur est déclenché automatiquement.

## Ajouts (suite) — vues actuelles/passées, repère de page, tarifs chauffeur, fuseaux automatiques
- **Correctif MariaDB** : `GET /payments/stats` échouait (« dec » est un mot réservé MariaDB) ; l'alias SQL devient `cdec`. `tools/check-dialect.js` détecte désormais cet alias.
- **Actuel / passé séparés pour tous les rôles** : commandes (back-office et client), livraisons (client, back-office) et courses (chauffeur). Les éléments terminés sont dans un bloc repliable **▶** (« Commandes passées », « Livraisons passées », « Courses passées ») avec recherche, dates et statut. Back-office : `GET /orders?scope=current|past`.
- **Repère de page/vue** : l'onglet actif est marqué (fond + trait + `aria-current`) et l'en-tête affiche « Page › Vue » (ex. « Mon espace › Mes commandes ») ainsi que le titre de l'onglet du navigateur.
- **Mes tarifs (chauffeur)** : n'affiche plus de tarif propre ; il montre les **4 modes** réglés par l'administrateur de chaque pharmacie (frais de base, délai, km, distance max., Express %, marge de négociation) via `GET /driver/tariffs`. Les champs « frais de base / prix par km » ont disparu du formulaire chauffeur côté admin.
- **Fuseau horaire automatique** : plus de saisie libre. `GET /countries/:id/timezones?lat&lng` renvoie les fuseaux du pays et le plus proche de la position ; le formulaire d'établissement et les paramètres proposent une liste, présélectionnée ; le serveur impose un fuseau du pays (`server/timezones.js`, données IANA `server/data/timezones.json`).

## Ajouts (suite) — paiement avec livraison, notifications ciblées, liens cliqués
- **Livraison déjà demandée** : si une course existe pour la commande (hors annulée), le bouton « Payer » ne repose plus « Souhaitez-vous être livré ? » : il affiche « Livraison demandée · mode » et propose directement espèces/carte à la livraison ou paiement en ligne (le retrait à la caisse est refusé : `DELIVERY_REQUESTED`).
- **Total = commande + livraison**, recalculé à chaque ouverture (`GET /portal/orders/:id/payment-options` : `goods_total`, `delivery_fee`, `total`, `due`). Il suit les contre-propositions acceptées et repasse à la commande seule si la course est annulée. Le paiement en ligne encaisse ce total. Le message « Vous réglerez (espèces) au livreur… » détaille commande + livraison + montant total à payer.
- **Notifications → endroit exact** : chaque notification client mène à l'onglet concerné et fait défiler/surligner l'élément (`&id=`) : commandes, livraisons, ordonnances, rendez-vous, abonnements ; les éléments rangés dans un bloc « passées » (▶) sont ouverts automatiquement ; un second clic sur le même lien re-focalise.
- **Soulignement dynamique** : un seul élément est souligné à la fois — la vue courante (menu latéral, barre du bas, onglets horizontaux) ; il passe de l'un à l'autre au clic. Les onglets de l'espace client reprennent la logique et le fond du menu (dégradé de marque + barre). Correctif : `aria-selected` était écrit vide (`""`) au lieu de `true`, ce qui empêchait tout marquage d'onglet.
- **Photo de profil bien cadrée** : à l'envoi, la photo est recadrée en carré 512 px (centrée sur le visage si le navigateur sait le détecter, sinon cadrée vers le haut) avec aperçu en cercle et curseurs horizontal/vertical ; les photos de téléphone jusqu'à 15 Mo sont acceptées. Les photos déjà enregistrées s'affichent cadrées vers le haut (`object-position`).
- **Actuel / passé** : les sections sont nettement espacées (« Commandes passées » ne colle plus au tableau).
- **Photo à fond transparent** : une photo détourée (PNG avec transparence) est détectée à l'envoi (cadrage sur la personne, transparence conservée, PNG < 1 Mo) et à l'affichage (photos déjà enregistrées comprises) : seule la personne apparaît, sans cadre, fond, ombre ni rognage rond (profil, en-tête, cartes chauffeur). Les photos opaques restent en cercle.
- **Onglets** : un seul marqueur, la barre épaisse ; le trait fin sous le texte est retiré.

## Ajouts (suite) — historique complet, filtres avancés, rafraîchissement silencieux
- **Historique complet d'une commande** (bouton « Historique » du client) : chronologie unique et filtrable (Statuts / Paiements / Livraison / Messages) — envoi, confirmation, préparation, prête, retrait ou annulation ; messages à la pharmacie ; paiements et acomptes ; livraison demandée avec mode et frais, puis chaque étape de la course et le chauffeur. `GET /portal/orders/:id/timeline` (seul le propriétaire de la commande y accède).
- **Filtres des blocs « passées »** (commandes, livraisons, courses) : recherche sur tous les champs (n°, produit, pharmacie, message, statut, date, montant), dates, statut, pharmacie, paiement (payée / partielle / non payée), livraison (sans / livrée / non aboutie), mode, chauffeur, montant min/max, tri (récent, ancien, montant) et bouton Réinitialiser, avec compteur « résultats / total ».
- **Rafraîchissement silencieux** (`web/js/silent.js`) : une mise à jour temps réel ou périodique n'interrompt plus l'utilisateur. Elle est reportée tant qu'il tape, sélectionne du texte ou qu'une fenêtre est ouverte ; sinon la page est redessinée en conservant recherches, filtres, blocs ▶ ouverts, défilement (page et tableaux) sans saut. Appliqué aux commandes et livraisons du client, au chauffeur, à la file de livraisons et à l'aide.
- Les notifications de statut de commande sont désormais en français (plus de « preparing »).

## Correctif — plus de retour forcé à « Mes commandes », mises à jour instantanées et invisibles
- **Cause du bug** : la minuterie de « Mes commandes » (30 s) restait active quand on changeait d'onglet et rappelait l'affichage « Mes commandes », ce qui ramenait l'utilisateur sur cet onglet depuis Livraisons, Rendez-vous, etc. Elle est supprimée à chaque changement d'onglet et ne change plus jamais de vue.
- **Mises à jour sans rafraîchissement visible** : les données arrivent en temps réel (évènements serveur) ; la minuterie restante (60 s, filet de sécurité) ne fait rien si les données sont identiques (0 modification de l'écran, mesuré) et, sinon, met à jour sur place sans changer d'onglet, en conservant filtres, recherche, blocs ouverts et défilement. Les champs qui bougent en continu (GPS, distances, délais) ne déclenchent pas de redessin ; le suivi et la carte se mettent à jour séparément.
- Mêmes règles pour les livraisons du client, l'espace chauffeur (30 s), la file de livraisons et l'aide (rendu hors écran, remplacé seulement s'il diffère).

## Correctif — plus d'erreurs 401 / avertissement audio dans la console
- **Cause** : le jeton d'accès dure 15 min ; passé ce délai, le flux temps réel (`/events`) et l'enregistrement des préférences partaient avec un jeton expiré (401 répétés, puis renouvellement). Désormais le jeton est **renouvelé avant son expiration** (minuterie, retour sur l'onglet, retour du réseau, vérification avant chaque requête) et le flux temps réel se reconnecte aussitôt avec un jeton neuf. Testé avec des jetons de 1 min pendant 2 min : 0 réponse 401, 0 erreur console.
- **Avertissement « AudioContext was not allowed to start »** : le son n'est plus initialisé qu'après un vrai geste (clic, touche, toucher) ; avant cela la sonnerie reste silencieuse sans erreur.

## Session silencieuse, pièce d'identité, audio

- `GET /api/v1/auth/session` (public) → `{active}` : le client sonde avant tout rafraîchissement ; une visite neuve ne produit donc plus aucun 401 en console. Indice local `gp.session` ('0' = déconnecté).
- Renouvellement du jeton protégé par `navigator.locks` (`gp-refresh`) : plusieurs onglets ne déclenchent plus de rotation concurrente (qui révoquait la famille de jetons).
- Pièce d'identité du chauffeur : l'aperçu utilise le vrai type du fichier (PDF → iframe, image → img) ; visible par le chauffeur (« Voir ») et par l'admin (« Voir la pièce », audité).
- Audio : déverrouillé seulement après une vraie activation utilisateur (plus d'avertissement AudioContext).
- Test : `tests/views.test.js` (6 tests).

## Flux /events fiable et Rapports › Analyse

- `/events` (temps réel) est ouvert à tout compte connecté : les rôles sans droit « tableau de bord » (chauffeur, médecin…) recevaient un 403 relancé toutes les 5 s. Le client ne réessaie plus sur 403 et espace ses reconnexions (5 s → 60 s) après une coupure réseau/proxy (ex. `ERR_QUIC_PROTOCOL_ERROR`) ; le serveur envoie déjà un ping toutes les 25 s.
- Rapports : nouvel onglet **Analyse** (par défaut) via `GET /reports/analytics` : indicateurs (CA net, tickets, panier moyen, marge HT, remboursé) comparés à la période précédente, courbe/aires/barres avec période précédente en pointillé, heures de pointe, jours de la semaine, modes de paiement (anneau), meilleures ventes.
- Personnalisation (mémorisée sur le compte, préférence `reports_ui`) : blocs affichés et leur ordre, période (7/30/90 j/12 mois), regroupement jour/mois, indicateur, type de courbe, comparaison, réinitialisation.
- Test : `tests/views.test.js` (7 tests).

## 2FA par QR code, aide chauffeur, chauffeur multi-pharmacies, vues dans Rôles & droits

- **2FA** : `POST /auth/mfa/setup` renvoie aussi `qr_svg` (QR généré localement par `server/qr.js`, aucun service externe) ; la page Sécurité l'affiche (scan avec Google/Microsoft Authenticator, Aegis, FreeOTP…) avec repli « saisir la clé » et lien `otpauth://` pour mobile.
- **Centre d'aide ouvert au chauffeur** : le chauffeur écrit (message ou réclamation) aux pharmacies auxquelles il est rattaché, suit ses conversations et répond ; le serveur refuse toute autre pharmacie. `GET /driver/pharmacies` alimente la liste.
- **Chauffeur multi-pharmacies** : Utilisateurs › compte chauffeur › « Pharmacies rattachées… » (liste à cocher avec recherche). `GET/PUT /users/:id/driver-pharmacies` (super-admin et administrateur, droit `users.manage` ou `drivers.admin`) : le chauffeur voit et accepte les courses des clients de toutes ces pharmacies ; la pharmacie principale reste toujours rattachée ; chaque pharmacie ajoutée est prévenue (notification), le chauffeur aussi ; tout est audité.
- **Vues dans Rôles & droits** : une permission `view.<vue>` par entrée du menu (29 vues : tableau de bord, caisse, ventes… espace chauffeur/médecin/client). Un menu s'affiche si le rôle a la vue ET la fonction correspondante ; les fonctions restent contrôlées côté serveur. À la mise à jour, les vues sont accordées automatiquement aux rôles (même personnalisés) qui avaient déjà la fonction : aucun menu ne disparaît. La matrice est groupée « Vues » / « Fonctions ». Sécurité et Mon profil restent toujours accessibles (compte personnel).
- Tests : `tests/views.test.js` (8 tests).

## Correctif « Gestionnaire » d'établissement

- Réseau › Établissements › Gestionnaire : correction de l'erreur `filter is not a function` (la liste des rôles est lue dans `/roles` → `roles`).
- Si l'établissement a déjà un administrateur actif, la fenêtre le propose directement (mode « membre du personnel » présélectionné, rôle repris) : l'administrateur peut être le gestionnaire, aucun autre compte n'est nécessaire.
