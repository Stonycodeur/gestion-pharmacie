# Installer et démarrer dans VS Code

1. **Installer Node.js 22 LTS ou plus** (https://nodejs.org). Vérifier dans un terminal : `node -v` → `v22.x` ou supérieur.
2. **Décompresser** `gestion-pharmacie-dev.zip`, puis dans VS Code : *Fichier → Ouvrir le dossier…* → choisir `pharmacie`.
3. Ouvrir le terminal intégré (`Ctrl+ù` ou *Terminal → Nouveau terminal*) et lancer :
   ```
   npm run dev       # démarre le serveur (base vide au premier lancement)
   ```
   Aucun `npm install` n'est nécessaire (zéro dépendance).
4. Ouvrir **http://localhost:3000** : l'écran « Première configuration » crée votre pharmacie et le compte super-administrateur ; créez ensuite vos vrais comptes dans *Administration → Utilisateurs*. (Pour explorer avec des données fictives : `npm run demo`, comptes dans le README.)
5. **Tests** : `npm test` → doit afficher `# pass 45`.
6. **Débogage** : onglet *Exécuter et déboguer* → « Démarrer l'API + web (dev) » (F5), points d'arrêt possibles dans `server/`.
7. **Recommencer à zéro** : `npm run db:wipe`. **Changer de port** : `PORT=4000 npm run dev` (Windows PowerShell : `$env:PORT=4000; npm run dev`).

Problèmes courants : `node:sqlite` introuvable → Node < 22.13 ; port occupé → changer `PORT` ; page blanche → vider le cache (Ctrl+F5).

**Critères avant la mise en production** : parcourir les scénarios du README, puis suivre `docs/MISE_EN_LIGNE.md` (MariaDB, secrets, MFA, TLS, sauvegardes).

**Tester sur téléphone** : ouvrir `http://<IP-du-PC>:3000` sur le même Wi-Fi (l'installation « Ajouter à l'écran d'accueil » et le mode hors ligne exigent HTTPS hors localhost). Application native : voir `mobile/README.md`.
