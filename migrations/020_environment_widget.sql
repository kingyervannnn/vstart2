UPDATE app_settings
SET document = jsonb_set(document, '{widgets,environment}', 'true'::jsonb, true)
WHERE document #> '{widgets,environment}' IS NULL;
