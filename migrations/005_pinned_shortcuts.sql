ALTER TABLE shortcut_items
  ADD COLUMN IF NOT EXISTS pin_group_id uuid;

CREATE INDEX IF NOT EXISTS shortcut_items_pin_group_idx
  ON shortcut_items(pin_group_id)
  WHERE pin_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shortcut_items_pin_group_workspace_idx
  ON shortcut_items(pin_group_id, workspace_id)
  WHERE pin_group_id IS NOT NULL;
