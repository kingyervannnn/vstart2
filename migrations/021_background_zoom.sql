UPDATE app_settings
SET document = jsonb_set(document, '{backgrounds,zoomPercent}', '100'::jsonb, true)
WHERE document #> '{backgrounds,zoomPercent}' IS NULL;
