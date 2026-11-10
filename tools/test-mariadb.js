// Lance TOUTE la suite de tests sur un vrai serveur MariaDB (chaque fichier de test crée puis supprime sa propre base `gp_t_xxxx`).
//   docker compose -f docker-compose.mariadb-test.yml up -d --wait && npm run test:mariadb
import { spawnSync } from 'node:child_process';
const env = { MARIADB_HOST: '127.0.0.1', MARIADB_PORT: '3307', MARIADB_USER: 'root', MARIADB_PASSWORD: 'test', ...process.env, DB_DRIVER: 'mariadb' };
try { await import('mysql2/promise'); } catch { console.error('Installer le pilote : npm install mysql2'); process.exit(1); }
const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', 'tests/api.test.js', 'tests/features.test.js', 'tests/setup.test.js'], { env, stdio: 'inherit' });
process.exit(r.status ?? 1);
