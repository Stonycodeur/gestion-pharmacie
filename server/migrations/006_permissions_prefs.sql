-- Permissions individuelles (accordées ou refusées, par-dessus le rôle), préférences synchronisées, jetons push mobiles.
CREATE TABLE user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  effect TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, permission_code)
);
CREATE TABLE user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE push_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  platform TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_push_user ON push_tokens(user_id);
