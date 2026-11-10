# Mise en ligne — Render (+ domaine Hostinger) — SQLite ou MariaDB

Domaine : https://pharmacie.jtconsultingcg.com · Code : dépôt GitHub **privé**.

## 0. Avant tout
1. Gmail : le mot de passe d'application a été écrit dans une conversation → **le révoquer** (compte Google → Sécurité → Mots de passe d'application) et en créer un nouveau. Ne jamais le mettre dans GitHub : il se saisit uniquement dans Render (`SMTP_PASS`) ou dans le `.env` local.
2. `.env` reste à la racine du projet (à côté de `package.json`), jamais commité. Render n'utilise pas ce fichier : on saisit les variables dans son tableau de bord.

## 1. GitHub
```
git init && git add . && git commit -m "init" && git branch -M main
git remote add origin https://github.com/VOTRE_COMPTE/gestion-pharmacie.git && git push -u origin main
```
Vérifier que `.env` et `data/` n'apparaissent pas dans le dépôt.

## 1bis. Vérifier la base MariaDB AVANT de déployer (recommandé)
Dans le dossier du projet : `npm install`, remplir `MARIADB_HOST/USER/PASSWORD/DATABASE` dans `.env`, puis :
```
npm run check:mariadb
```
Ce diagnostic se connecte à votre base et vérifie, sans toucher à vos données (une table temporaire est créée puis supprimée) : connexion et droits d'accès, version, `max_allowed_packet`, création de tables, écriture/lecture binaire (fichiers), gros fichier de 5 Mo, triggers. Chaque échec indique quoi demander à l'hébergeur. Ensuite `npm start` démarre l'application sur cette base (le schéma se crée seul).

Triggers : s'ils sont refusés, l'application démarre quand même avec un avertissement (journal d'audit non protégé contre une modification directe en base). `MARIADB_REQUIRE_TRIGGERS=true` impose leur présence.

## 2. Render GRATUIT + MariaDB Hostinger (recommandé, sans disque)
**Tout est stocké dans la base MariaDB** : données, mais aussi ordonnances, pièces jointes, photos de profil et logos (table `stored_files`). Le service Render peut donc être redémarré ou redéployé sans rien perdre ; aucun disque payant n'est nécessaire.
1. Render → **New → Blueprint** → dépôt GitHub → il lit `render.yaml` (offre gratuite, service Docker, secrets générés).
2. Renseigner quand Render le demande : `SMTP_PASS`, `MARIADB_HOST`, `MARIADB_USER`, `MARIADB_PASSWORD`, `MARIADB_DATABASE`.
3. hPanel Hostinger → Bases de données → créer la base et l'utilisateur.
4. **Connexion distante** : hPanel → *MySQL distant* : autoriser l'adresse IP de sortie de Render (Dashboard → service → Connect → Outbound). L'hébergement mutualisé n'autorise parfois pas l'accès distant : à confirmer chez Hostinger.
5. **Risque connu** : au premier démarrage l'application crée les tables **et 6 triggers**. Sur un mutualisé, l'utilisateur peut ne pas avoir le droit TRIGGER (ou le serveur exige `log_bin_trust_function_creators`). Si le démarrage échoue sur `CREATE TRIGGER`, demander l'activation à Hostinger ou passer à un VPS.
6. **Taille des fichiers** : ordonnances ≤ 3 Mo, autres pièces ≤ 5 Mo, photos ≤ 1 Mo. Le paramètre MariaDB `max_allowed_packet` doit être d'au moins 16 Mo (valeur par défaut courante) ; la taille de la base est limitée par votre offre Hostinger.
7. phpMyAdmin sert à consulter la base. Ne pas importer le fichier SQL à la main : l'application crée et migre le schéma.
8. Render gratuit s'endort après ~15 min sans visite : premier chargement lent (30 à 50 s), puis normal. Les notifications temps réel ne fonctionnent que service éveillé. La base est distante : chaque requête traverse Internet.
9. Alternative SQLite + disque payant : `deploy/render.sqlite-disque.yaml` (non recommandé).

## 3. Domaine
1. Render → service → Settings → Custom Domains → ajouter `pharmacie.jtconsultingcg.com`.
2. Hostinger → DNS du domaine jtconsultingcg.com : enregistrement **CNAME**, nom `pharmacie`, valeur = adresse `xxxx.onrender.com` indiquée par Render. Supprimer tout autre enregistrement A/AAAA/CNAME du même nom.
3. Attendre la vérification : Render émet le certificat HTTPS tout seul.
4. Le `Caddyfile` n'est utilisé que sur un VPS.

## 4. Premier lancement
1. Ouvrir https://pharmacie.jtconsultingcg.com/health → `{"status":"ok"}`.
2. Ouvrir le site → configuration initiale → saisir `SETUP_TOKEN` → créer le super-admin principal.
3. Réseau → Pays, puis créer les établissements. Tester « mot de passe oublié » et l'e-mail de bienvenue.
4. Audit : vérifier que les adresses IP du journal diffèrent d'un utilisateur à l'autre. Sinon, mettre `TRUSTED_PROXY=false`.

## 5. Autres hébergeurs
* **VPS** (Hostinger VPS, Hetzner, OVH…) avec Docker : SQLite → `docker compose -f docker-compose.sqlite.yml up -d --build` ; MariaDB → `docker compose up -d --build` (MariaDB incluse). DNS : enregistrement A vers l'IP. Caddy gère le HTTPS.
* Railway / Fly.io / Koyeb : même `Dockerfile`, mêmes variables (`deploy/env.render-*.txt`), volume sur `/app/data`.

## 6. Application mobile (voir 6bis)
Compilée avec `EXPO_PUBLIC_APP_URL=https://pharmacie.jtconsultingcg.com` (dans `mobile/`), puis `eas build`. L'application charge le site complet : tous les écrans, fonctions et modules du web (invité, chauffeur, aide, caisse, comptabilité, etc.) y sont présents, à l'identique. Voir `mobile/README.md`.

## 7. Sauvegardes
MariaDB (fichiers inclus, puisqu'ils sont dans la base) : sauvegardes Hostinger + export phpMyAdmin régulier + `npm run backup`.

## 6bis. Application mobile = coque du site
Voir `mobile/README.md`. Elle charge `https://pharmacie.jtconsultingcg.com` : tout ce que fait le site est disponible à l'identique. Le site propose aussi l'installation d'un raccourci (PWA) avec le nom de l'établissement.

## 8. Dépannage : erreurs 500 sur le site en ligne
1. Render → Logs : cherchez les lignes `[ERR]` (elles contiennent l'erreur exacte) et `[ATTENTION]`.
2. Ouvrez `https://pharmacie.jtconsultingcg.com/health?token=VOTRE_SETUP_TOKEN` : le diagnostic indique le pilote de base utilisé (sqlite ou mariadb), la base visée (sans mot de passe), et le résultat de chaque contrôle (connexion, table users, migrations appliquées, pays). Le message d'erreur MariaDB y est affiché tel quel.
3. Causes fréquentes :
   * `DB_DRIVER` absent ou erroné dans Render → l'application n'utilise pas MariaDB.
   * Adresse IP de Render non autorisée dans hPanel → *MySQL distant* (erreur ETIMEDOUT / Access denied).
   * Base déjà remplie par une ancienne version : les scripts d'évolution (`database/mariadb/migrations/`) la mettent à jour au démarrage ; une erreur sur l'un d'eux apparaît dans les Logs.
   * Hôte `localhost` utilisé depuis Render : il faut l'hôte d'accès distant donné par Hostinger.
