UPDATE app_settings
SET document = jsonb_set(document, '{widgets,missionGlance}', 'true'::jsonb, true)
WHERE document #> '{widgets,missionGlance}' IS NULL;

UPDATE app_settings
SET document = jsonb_set(
  document,
  '{missionGlance}',
  COALESCE(document -> 'missionGlance', '{}'::jsonb) || '{
    "projectPaths": [
      "/Users/vbitzx/SS/trucking saas",
      "/Users/vbitzx/SS/DEV/dental-pms",
      "/Users/vbitzx/SS/APC-Universal-Compiler",
      "/Users/vbitzx/SS/PAYMENT WATCH",
      "/Users/vbitzx/SS/vstart2"
    ]
  }'::jsonb,
  true
)
WHERE document #> '{missionGlance,projectPaths}' IS NULL;
