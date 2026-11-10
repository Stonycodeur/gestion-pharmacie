# Application mobile - Pharmacie (Expo)

**Principe : une coque native qui charge le site complet.** Les pages, les droits, les rôles (client, invité, personnel, chauffeur, médecin, super-admin), le mode hors connexion et la personnalisation sont **exactement ceux du web**, à chaque mise à jour du site, sans republier l'application. Le natif ajoute : notifications push, ouverture de la bonne page en touchant une notification, bouton Retour Android, liens externes (tel:, mailto:, WhatsApp) hors de l'application, écran « Connexion impossible » avec réessai automatique, appareil photo/galerie pour les ordonnances, position pour « pharmacie la plus proche » et suivi chauffeur.

L'ancien code d'écrans natifs est conservé dans `_ancien-natif/` (non utilisé).

## Tester (Android ou iPhone)
```bash
cd mobile && npm install
EXPO_PUBLIC_APP_URL=https://pharmacie.jtconsultingcg.com npx expo start
```
Scanner le QR code avec **Expo Go**. (Le push demande une vraie compilation : voir ci-dessous.)

## Publier
```bash
npm i -g eas-cli && eas login && eas init
eas build -p android --profile preview      # APK à installer directement pour les premiers essais
eas build -p android --profile production   # AAB pour Google Play (compte développeur payant)
eas build -p ios --profile production       # compte Apple Developer payant
```
* Les identifiants `com.jtconsultingcg.pharmacie` (app.json) sont à adapter si besoin.
* Push : `eas init` crée le `projectId` ; Android demande aussi un compte Firebase (FCM) relié à Expo ; iOS une clé APNs (EAS la gère). Côté serveur : `PUSH_ENABLED=true`.
* Icône et écran de démarrage : générés depuis l'icône du site ; remplacez `assets/` par votre logo (icon 1024×1024).

## Notifications : fenêtre, page concernée et sonnerie
Toucher une notification (dans la cloche, en bandeau, ou la notification du téléphone) ouvre la page concernée ; sans page associée, le message complet s'affiche. Chaque utilisateur peut choisir une sonnerie **depuis son appareil** (Personnaliser → Sonnerie → « Choisir un son sur mon appareil », fichier audio ≤ 1,5 Mo) : elle sonne quand l'application ou le site est ouvert. Les notifications push reçues application fermée utilisent le son système du téléphone (Android : réglable dans Paramètres → Applications → Pharmacie → Notifications).

## Limites à connaître
* **Hors connexion** : sur Android le site garde son cache et sa file d'attente comme dans Chrome. Sur **iPhone**, une application WebView ne peut pas utiliser le service worker : le hors connexion complet n'y est pas garanti (à tester) ; la version « Ajouter à l'écran d'accueil » via Safari le gère mieux.
* **GPS chauffeur** : la position est envoyée tant que l'application est ouverte et l'écran allumé ; pas de suivi en arrière-plan.
* **Exports/impressions** : les téléchargements de fichiers générés par le navigateur (PDF, CSV) peuvent ne pas fonctionner dans une WebView ; à tester.
* **Apple** peut refuser une application qui n'est qu'un site web : les fonctions natives (push, caméra, position) aident, sans garantie.
* Jamais exécuté sur un téléphone dans cet environnement de développement (pas de SDK mobile) : à tester avant diffusion.

## Sans l'application : raccourci sur l'écran d'accueil (PWA)
Le site propose un bouton « Installer l'application » (écran de connexion et menu du compte). Android/Chrome : invite d'installation ; iPhone : Safari → Partager → « Sur l'écran d'accueil ». Le raccourci porte le nom personnalisé de l'établissement (Paramètres → identité visuelle), l'icône du site et ouvre l'application en plein écran.
