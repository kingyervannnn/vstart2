CREATE TABLE IF NOT EXISTS workspace_agent_preferences (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  cwd text CHECK (cwd IS NULL OR length(cwd) BETWEEN 1 AND 4096),
  provider text CHECK (provider IS NULL OR length(provider) BETWEEN 1 AND 100),
  model text CHECK (model IS NULL OR length(model) BETWEEN 1 AND 240),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_session_links (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hermes_session_id text NOT NULL CHECK (length(hermes_session_id) BETWEEN 1 AND 200),
  title_override text CHECK (title_override IS NULL OR length(btrim(title_override)) BETWEEN 1 AND 200),
  pinned boolean NOT NULL DEFAULT false,
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, hermes_session_id)
);

CREATE INDEX IF NOT EXISTS agent_session_links_workspace_idx
  ON agent_session_links(workspace_id, pinned DESC, last_opened_at DESC);

UPDATE app_settings
SET document = jsonb_set(
      document,
      '{agent}',
      '{
        "enabled": true,
        "bridgeUrl": "http://127.0.0.1:3120",
        "defaultReasoningEffort": "medium",
        "defaultFastMode": false,
        "showToolActivity": true,
        "showUsage": false,
        "workspaceDefaultsEnabled": true
      }'::jsonb || COALESCE(document -> 'agent', '{}'::jsonb),
      true
    ),
    schema_version = GREATEST(schema_version, 2),
    version = version + 1,
    updated_at = now()
WHERE id = 'default';
