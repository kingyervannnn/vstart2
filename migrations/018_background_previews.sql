ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS preview_mime_type text,
  ADD COLUMN IF NOT EXISTS preview_content bytea;

CREATE INDEX IF NOT EXISTS assets_background_preview_pending_idx
  ON assets(created_at)
  WHERE kind = 'background' AND preview_content IS NULL;
