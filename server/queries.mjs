export function normalizePlacement(row) {
  return {
    itemId: row.item_id,
    workspaceId: row.workspace_id,
    containerKey: row.container_key,
    profile: row.profile,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    canvasVersion: row.canvas_version,
    version: Number(row.version),
  }
}

export async function loadBootstrap(client) {
  // A transaction-bound pg Client executes sequentially. Keeping these reads ordered also
  // guarantees that every bootstrap mutation response observes one canonical transaction.
  const settings = await client.query("SELECT document, schema_version, version, updated_at FROM app_settings WHERE id = 'default'")
  const state = await client.query('SELECT key, value, version FROM app_state ORDER BY key')
  const workspaces = await client.query('SELECT * FROM workspaces ORDER BY sort_order, created_at')
  const items = await client.query(`
      SELECT id, workspace_id, parent_folder_id, kind, title, url, icon_asset_id,
             icon_override_url, favicon_url, version, created_at, updated_at
      FROM shortcut_items
      ORDER BY created_at
    `)
  const placements = await client.query('SELECT * FROM item_placements ORDER BY item_id, profile')
  const settingsRow = settings.rows[0]
  return {
    settings: settingsRow ? {
      document: settingsRow.document,
      schemaVersion: settingsRow.schema_version,
      version: Number(settingsRow.version),
      updatedAt: settingsRow.updated_at,
    } : null,
    state: Object.fromEntries(state.rows.map((row) => [row.key, { value: row.value, version: Number(row.version) }])),
    workspaces: workspaces.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      sortOrder: row.sort_order,
      icon: row.icon,
      fontFamily: row.font_family,
      textColor: row.text_color,
      accentColor: row.accent_color,
      backgroundAssetId: row.background_asset_id,
      version: Number(row.version),
    })),
    items: items.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      parentFolderId: row.parent_folder_id,
      kind: row.kind,
      title: row.title,
      url: row.url,
      iconAssetId: row.icon_asset_id,
      iconOverrideUrl: row.icon_override_url,
      faviconUrl: row.favicon_url,
      version: Number(row.version),
    })),
    placements: placements.rows.map(normalizePlacement),
  }
}
