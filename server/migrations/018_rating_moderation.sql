-- Les notes de livraison sont validées par un administrateur avant d'entrer dans la moyenne d'étoiles.
ALTER TABLE delivery_ratings ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE delivery_ratings ADD COLUMN reviewed_by INTEGER;
ALTER TABLE delivery_ratings ADD COLUMN reviewed_at TEXT;
UPDATE delivery_ratings SET status='approved';
