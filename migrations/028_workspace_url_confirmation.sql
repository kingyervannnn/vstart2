UPDATE app_settings
SET document = jsonb_set(document, '{general,holdBaseUrlUntilWorkspaceConfirmed}', 'false'::jsonb, true),
    version = version + 1,
    updated_at = now()
WHERE id = 'default'
  AND document #> '{general,holdBaseUrlUntilWorkspaceConfirmed}' IS NULL;
