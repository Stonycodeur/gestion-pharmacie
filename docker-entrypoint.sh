#!/bin/sh
# Démarrage du conteneur. Si un volume est monté (VPS), on donne les droits d'écriture à « node » ; sinon on lance simplement l'application.
D="${UPLOAD_DIR:-/app/data/uploads}"
mkdir -p "$D" 2>/dev/null || true
if [ "$(id -u)" = "0" ] && command -v su-exec >/dev/null 2>&1; then
  chown -R node:node /app/data 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
