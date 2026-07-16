UPDATE app_settings
SET document = jsonb_set(
  document,
  '{widgets}',
  COALESCE(document->'widgets', '{}'::jsonb) || '{
    "primaryLocationId": "new-york",
    "secondaryLocationIds": ["yerevan", "vienna"],
    "activeWeatherLocationId": "new-york",
    "twentyFourHour": false,
    "celsius": false
  }'::jsonb,
  true
)
WHERE id = 'default';
