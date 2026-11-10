-- Pièce jointe au motif d'un rendez-vous (ordonnance, analyse, photo…), stockée dans la base (table stored_files)
ALTER TABLE appointments ADD COLUMN file_path TEXT;
ALTER TABLE appointments ADD COLUMN file_name TEXT;
ALTER TABLE appointments ADD COLUMN file_mime TEXT;
