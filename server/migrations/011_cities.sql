-- Villes par pays (gérées par le super-administrateur ; préremplies à partir de server/data/cities.json)
CREATE TABLE cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (country_id, name)
);
CREATE INDEX idx_cities_country ON cities(country_id);
