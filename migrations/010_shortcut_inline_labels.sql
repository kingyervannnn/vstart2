UPDATE app_settings
SET document = jsonb_set(document, '{speedDial,labelOpensInline}', 'false'::jsonb, true),
    version = version + 1,
    updated_at = now()
WHERE id = 'default'
  AND document #> '{speedDial,labelOpensInline}' IS NULL;
