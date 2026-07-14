ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_sha256_key;
CREATE UNIQUE INDEX IF NOT EXISTS assets_kind_sha256_idx ON assets(kind, sha256);
