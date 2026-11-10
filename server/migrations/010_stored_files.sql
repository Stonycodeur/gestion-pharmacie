-- Fichiers (ordonnances, pièces jointes, avatars, logos) stockés dans la base : aucun disque persistant requis.
CREATE TABLE stored_files (
  name TEXT PRIMARY KEY,
  is_public INTEGER NOT NULL DEFAULT 0,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
