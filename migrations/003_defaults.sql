INSERT INTO app_settings (id, schema_version, document)
VALUES (
  'default',
  1,
  '{
    "general": {
      "openLinksInNewTab": true,
      "autofocusSearch": true,
      "mirrorLayout": false,
      "innerOutline": true
    },
    "speedDial": {
      "alwaysShowNames": true,
      "showFolderLabels": true,
      "wheelResistance": 1
    },
    "search": {
      "engine": "google",
      "inlineEnabled": true,
      "imageSearchEnabled": true,
      "shortcuts": { "focus": "/", "inline": "mod+enter" },
      "dock": {
        "wide": { "x": 0.5, "y": 0.82, "width": 0.58 },
        "compact": { "x": 0.5, "y": 0.8, "width": 0.82 }
      }
    },
    "appearance": {
      "fontFamily": "Inter, system-ui, sans-serif",
      "textColor": "#f4f6ff",
      "accentColor": "#8ba6ff",
      "edgeEffect": true,
      "edgeGlow": false,
      "animatedOverlay": false
    },
    "backgrounds": {
      "workspaceSpecific": false,
      "globalAssetId": null
    },
    "workspaces": {
      "individualTypography": false,
      "individualBackgrounds": false
    },
    "widgets": {
      "clock": true,
      "weather": true,
      "notes": true,
      "email": true,
      "music": true,
      "musicBlur": 18
    }
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, name, slug, sort_order, icon)
VALUES ('0194f5c0-0000-7000-8000-000000000001', 'Home', 'home', 0, 'layers')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app_state (key, value)
VALUES (
  'last_active_workspace_id',
  '"0194f5c0-0000-7000-8000-000000000001"'::jsonb
)
ON CONFLICT (key) DO NOTHING;
