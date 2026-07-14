CREATE TABLE IF NOT EXISTS app_settings (
  id text PRIMARY KEY,
  schema_version integer NOT NULL,
  document jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('background', 'shortcut_icon')),
  mime_type text NOT NULL,
  sha256 text NOT NULL UNIQUE,
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  width integer,
  height integer,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  sort_order integer NOT NULL,
  icon text,
  font_family text,
  text_color text,
  accent_color text,
  background_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sort_order)
);

CREATE TABLE IF NOT EXISTS shortcut_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_folder_id uuid REFERENCES shortcut_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('shortcut', 'folder')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  url text,
  icon_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  icon_override_url text,
  favicon_url text,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shortcut_url_shape CHECK (
    (kind = 'shortcut' AND url IS NOT NULL) OR
    (kind = 'folder' AND url IS NULL)
  ),
  CONSTRAINT folder_not_nested CHECK (kind = 'shortcut' OR parent_folder_id IS NULL)
);

CREATE TABLE IF NOT EXISTS item_placements (
  item_id uuid NOT NULL REFERENCES shortcut_items(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  container_key text NOT NULL,
  profile text NOT NULL CHECK (profile IN ('wide', 'compact')),
  x numeric(12,4) NOT NULL CHECK (x >= 0),
  y numeric(12,4) NOT NULL CHECK (y >= 0),
  width numeric(12,4) NOT NULL CHECK (width > 0),
  height numeric(12,4) NOT NULL CHECK (height > 0),
  x_span numrange GENERATED ALWAYS AS (numrange(x, x + width, '[)')) STORED,
  y_span numrange GENERATED ALWAYS AS (numrange(y, y + height, '[)')) STORED,
  canvas_version integer NOT NULL DEFAULT 1,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, profile),
  CONSTRAINT item_placements_no_overlap EXCLUDE USING gist (
    workspace_id WITH =,
    container_key WITH =,
    profile WITH =,
    x_span WITH &&,
    y_span WITH &&
  ) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS shortcut_items_workspace_idx
  ON shortcut_items(workspace_id, parent_folder_id);

CREATE TABLE IF NOT EXISTS mutation_log (
  mutation_id text PRIMARY KEY,
  operation text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
