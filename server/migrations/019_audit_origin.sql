-- Origine des actions : appareil (user-agent) et localisation approximative des adresses IP (mise en cache).
ALTER TABLE audit_logs ADD COLUMN user_agent TEXT;
CREATE TABLE ip_geo (
  ip TEXT PRIMARY KEY,
  country TEXT,
  region TEXT,
  city TEXT,
  isp TEXT,
  lat REAL,
  lng REAL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
