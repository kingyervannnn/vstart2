CREATE TABLE IF NOT EXISTS map_search_cache (
  cache_key text PRIMARY KEY,
  query text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS map_search_cache_expires_at_idx
  ON map_search_cache(expires_at);
