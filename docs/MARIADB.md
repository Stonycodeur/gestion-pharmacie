# MariaDB

`DB_DRIVER=mariadb` bascule le serveur sur MariaDB ≥ 10.6 (InnoDB, utf8mb4). Variables : `MARIADB_HOST`, `MARIADB_PORT`, `MARIADB_USER`, `MARIADB_PASSWORD`, `MARIADB_DATABASE` (défaut `Gestion_pharmacie`), `MARIADB_SSL=true`.

**Conception** : le code métier est synchrone (transactions par points de sauvegarde). Le pilote exécute `mysql2` dans un *worker thread* et attend la réponse via `Atomics.wait` + `receiveMessageOnPort`. Les requêtes écrites en SQLite sont traduites (`server/sql-dialect.js` : `datetime('now')`, `INSERT OR IGNORE`, `LIMIT`, etc.) ; `npm run check:dialect` analyse les 264 requêtes distinctes du code.

**Schéma** : `database/mariadb/Gestion_pharmacie.sql` est généré (`npm run gen:mariadb`) depuis `schema.sql` + `migrations/`.

**Vérifier sur un vrai serveur** (jamais fait dans l'environnement de génération) :
```
docker compose -f docker-compose.mariadb-test.yml up -d --wait
npm run test:mariadb
```
Les 45 tests tournent alors sur MariaDB. Corriger les écarts éventuels avant toute mise en ligne.

**Points d'attention**
* Triggers d'audit en ajout seul : si l'utilisateur n'est pas SUPER, activer `log_bin_trust_function_creators=1` (déjà dans `docker-compose.yml`).
* Chaque future migration doit fournir une variante `mariadb` (voir `server/db.js`, `MIGRATIONS`).
* Une seule instance de l'application (le temps réel SSE et le pont synchrone ne sont pas répartis).
* Divisions : le `/` de MariaDB renvoie un décimal (entier en SQLite) : contrôler les rapports de montants lors de `test:mariadb`.
* Sauvegarde : `npm run backup` (mysqldump chiffré AES-256-GCM) et `npm run backup:verify`.
