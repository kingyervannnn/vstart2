UPDATE app_settings
SET document = jsonb_set(
  document,
  '{mail}',
  '{"defaultAccount":"all","refreshSeconds":60,"workspaceAccounts":{}}'::jsonb
    || COALESCE(document -> 'mail', '{}'::jsonb),
  true
)
WHERE id = 'default';
