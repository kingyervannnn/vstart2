UPDATE app_settings
SET document = jsonb_set(
  document,
  '{appearance,glow}',
  jsonb_build_object(
    'color', COALESCE(document #>> '{appearance,accentColor}', '#8ba6ff'),
    'adaptToBackground', false,
    'workspaceSpecific', false,
    'workspaceColors', '{}'::jsonb
  ),
  true
)
WHERE document #> '{appearance,glow}' IS NULL;
