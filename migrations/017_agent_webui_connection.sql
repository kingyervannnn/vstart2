-- Agent Hermes connection mode metadata (URL only; password stays on host bridge).
UPDATE app_settings
SET document = jsonb_set(
      jsonb_set(
        jsonb_set(document, '{agent,connectionMode}', '"local"'::jsonb, true),
        '{agent,remoteUrl}',
        '""'::jsonb,
        true
      ),
      '{agent,remoteConfigured}',
      'false'::jsonb,
      true
    ),
    schema_version = GREATEST(schema_version, 2),
    version = version + 1,
    updated_at = now()
WHERE id = 'default'
  AND COALESCE(document #>> '{agent,connectionMode}', '') = '';
