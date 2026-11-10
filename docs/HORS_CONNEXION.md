# Mode hors connexion (web)

**Coque applicative** : un service worker (`/sw.js`, généré par le serveur avec l'empreinte des fichiers) met l'interface en cache ; l'application s'ouvre sans réseau et se met à jour seule quand les fichiers changent. Nécessite HTTPS en production (localhost accepté en dev).

**Lecture** : chaque page consultée est conservée dans IndexedDB, par utilisateur. Hors connexion, une page déjà vue s'affiche avec ses dernières données ; une page jamais vue indique qu'elle n'est pas disponible.

**Déverrouillage** : à la connexion, l'appareil retient un *vérificateur* PBKDF2 (150 000 itérations, sel aléatoire) du mot de passe — jamais le mot de passe. Sans réseau, l'écran « Mode hors connexion » demande e-mail + mot de passe et rouvre la session avec les droits mémorisés.

**Caisse hors ligne** : le catalogue complet (`/pos/snapshot`) est conservé ; recherche locale, panier, encaissement. La vente est stockée dans une file d'attente locale avec : clé d'idempotence, date réelle (`offline_at`) et total attendu. Un ticket **provisoire** (numéro `HORS-LIGNE-…`) est imprimable. Au retour du réseau, envoi automatique dans l'ordre ; le serveur rejoue sans doublon, recontrôle prix/stock/ordonnance et refuse si le total diffère (`TOTAL_MISMATCH`).

**Conflits** (stock épuisé entre-temps, caisse fermée, prix modifié…) : la vente passe en « conflit » dans *Synchronisation* (puce en haut) ; on peut réessayer ou l'abandonner. Rien n'est supprimé sans action.

**Limites assumées** : vente à crédit et remboursement indisponibles hors ligne ; le stock affiché est celui du dernier instantané diminué des ventes locales (autres caisses non vues) ; une vente hors ligne est comptabilisée à la synchronisation (date réelle conservée) — une période déjà clôturée la refuserait ; **sur un poste partagé**, utiliser *Déconnexion* (efface cache et vérificateur sauf ventes non synchronisées) ou *Vider le cache*.
