ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS original_name text;

CREATE INDEX IF NOT EXISTS assets_background_created_idx
  ON assets(created_at DESC)
  WHERE kind = 'background';
