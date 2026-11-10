// Efface la base de DÉVELOPPEMENT (SQLite) pour repartir d'un système vide. Refusé en production.
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
if (process.env.NODE_ENV === 'production') { console.error('Refus : interdit en production.'); process.exit(1); }
if (!process.argv.includes('--yes')) { console.error('Cela efface TOUTES les données de dev. Relancez avec : npm run db:wipe -- --yes'); process.exit(1); }
const f = resolve(process.cwd(), process.env.DB_FILE || './data/dev.sqlite');
for (const s of ['', '-wal', '-shm']) if (existsSync(f + s)) rmSync(f + s);
console.log('Base de dev effacée :', f);
