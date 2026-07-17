UPDATE app_settings
SET document = jsonb_set(
  document,
  '{appearance,glow}',
  '{"edgeIntensity":100,"elementIntensity":100}'::jsonb
    || COALESCE(document #> '{appearance,glow}', '{}'::jsonb),
  true
);
