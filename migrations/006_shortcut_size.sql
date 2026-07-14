UPDATE app_settings
SET document = jsonb_set(document, '{speedDial,shortcutSize}', '78'::jsonb, true),
    version = version + 1,
    updated_at = now()
WHERE id = 'default'
  AND document #> '{speedDial,shortcutSize}' IS NULL;
