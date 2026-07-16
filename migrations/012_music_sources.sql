UPDATE app_settings
SET document = jsonb_set(
      document,
      '{music}',
      COALESCE(document->'music', '{}'::jsonb) || '{
        "activeSourceId": "youtube-music-local",
        "sources": [
          {
            "id": "youtube-music-local",
            "name": "YouTube Music",
            "adapter": "youtube-music-desktop",
            "baseUrl": "http://127.0.0.1:26538",
            "enabled": true
          }
        ]
      }'::jsonb,
      true
    ),
    version = version + 1,
    updated_at = now()
WHERE id = 'default'
  AND NOT (document ? 'music');
