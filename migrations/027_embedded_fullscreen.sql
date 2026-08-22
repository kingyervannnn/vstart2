UPDATE app_settings
SET document = jsonb_set(document, '{search,allowEmbeddedFullscreen}', 'true'::jsonb, true),
    version = version + 1,
    updated_at = now()
WHERE id = 'default'
  AND document #> '{search,allowEmbeddedFullscreen}' IS NULL;
