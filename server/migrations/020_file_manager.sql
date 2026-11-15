-- Gestionnaire de documents : dossiers et fichiers, partage entre utilisateurs et établissements.
CREATE TABLE fm_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pharmacy_id INTEGER REFERENCES pharmacies(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES fm_nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('folder','file')),
  name TEXT NOT NULL,
  stored_name TEXT,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fm_nodes_parent ON fm_nodes(parent_id);
CREATE INDEX idx_fm_nodes_owner ON fm_nodes(owner_user_id);
CREATE TABLE fm_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES fm_nodes(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user','pharmacy')),
  target_id INTEGER NOT NULL,
  can_edit INTEGER NOT NULL DEFAULT 0,
  shared_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (node_id, target_type, target_id)
);
