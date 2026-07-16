UPDATE app_settings
SET document = jsonb_set(document, '{agent,bridgeUrl}', '"/agent-bridge"'::jsonb, true),
    version = version + 1,
    updated_at = now()
WHERE id = 'default'
  AND COALESCE(document #>> '{agent,bridgeUrl}', '') IN (
    '',
    'http://127.0.0.1:3120',
    'http://localhost:3120'
  );
