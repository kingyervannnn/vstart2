CREATE TABLE IF NOT EXISTS background_collections (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS background_collection_assets (
  collection_id uuid NOT NULL REFERENCES background_collections(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, asset_id)
);

CREATE INDEX IF NOT EXISTS background_collection_assets_asset_idx
  ON background_collection_assets(asset_id);

UPDATE app_settings
SET document = jsonb_set(
  document,
  '{backgrounds}',
  COALESCE(document->'backgrounds', '{}'::jsonb) || '{
    "rotation": {
      "enabled": false,
      "intervalMinutes": 15,
      "scope": "all",
      "collectionId": null,
      "workspacePools": {}
    }
  }'::jsonb,
  true
)
WHERE document #> '{backgrounds,rotation}' IS NULL;
