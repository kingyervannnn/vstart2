UPDATE app_settings
SET document = jsonb_set(document, '{appearance,headerScrollSpeed}', '100'::jsonb, true)
WHERE document #> '{appearance,headerScrollSpeed}' IS NULL;
