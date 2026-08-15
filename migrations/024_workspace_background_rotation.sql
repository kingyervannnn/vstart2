UPDATE app_settings AS settings
SET document = jsonb_set(
  settings.document,
  '{backgrounds,rotation,workspaceSettings}',
  COALESCE((
    SELECT jsonb_object_agg(
      workspace.id::text,
      jsonb_build_object(
        'enabled', COALESCE((settings.document #>> '{backgrounds,rotation,enabled}')::boolean, false),
        'intervalMinutes', COALESCE((settings.document #>> '{backgrounds,rotation,intervalMinutes}')::int, 15),
        'scope', COALESCE(settings.document #>> '{backgrounds,rotation,scope}', 'all'),
        'collectionId', settings.document #>> '{backgrounds,rotation,collectionId}'
      )
    )
    FROM workspaces AS workspace
  ), '{}'::jsonb),
  true
)
WHERE settings.id = 'default'
  AND settings.document #> '{backgrounds,rotation,workspaceSettings}' IS NULL;
