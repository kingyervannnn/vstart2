UPDATE app_settings
SET document = jsonb_set(
      document,
      '{search,workspaceSide}',
      jsonb_build_object('wide', 'top', 'compact', 'top')
        || COALESCE(document #> '{search,workspaceSide}', '{}'::jsonb),
      true
    ),
    version = version + 1,
    updated_at = now()
WHERE id = 'default';
