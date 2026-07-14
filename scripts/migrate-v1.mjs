import crypto from 'node:crypto'
import { Client } from 'pg'

const sourceUrl = process.env.VSTART1_STATE_URL || 'http://localhost:3100/vstart/state'
const databaseUrl = process.env.DATABASE_URL || 'postgres://vstart2:vstart2-local-password@127.0.0.1:55432/vstart2'

const PROFILES = {
  wide: { width: 1600, height: 1000, tileWidth: 128, tileHeight: 128, x: 60, y: 80, columnGap: 180, rowGap: 160 },
  compact: { width: 820, height: 1000, tileWidth: 104, tileHeight: 104, x: 30, y: 60, columnGap: 150, rowGap: 140 },
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'workspace'
}

function text(value, fallback, maxLength) {
  return String(value || '').trim().slice(0, maxLength) || fallback
}

function httpUrl(value) {
  try {
    const parsed = new URL(String(value || ''))
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

function rootPlacement(tile, profileName) {
  const profile = PROFILES[profileName]
  const column = Math.max(0, Number(tile.gridX) || 0)
  const pageRow = Math.max(0, Number(tile.gridY) || 0) + (Math.max(0, Number(tile.page) || 0) * 6)
  const value = {
    x: profile.x + (column * profile.columnGap),
    y: profile.y + (pageRow * profile.rowGap),
    width: profile.tileWidth,
    height: profile.tileHeight,
  }
  if (value.x + value.width > profile.width || value.y + value.height > profile.height) {
    throw new Error(`V1 item ${tile.id || tile.title || 'unknown'} does not fit the ${profileName} migration canvas`)
  }
  return value
}

function childPlacement(index, profileName) {
  const profile = PROFILES[profileName]
  return {
    x: 24 + (index * (profile.tileWidth + 56)),
    y: 24,
    width: profile.tileWidth,
    height: profile.tileHeight,
  }
}

async function insertPlacements(client, itemId, workspaceId, containerKey, byProfile) {
  for (const [profileName, value] of Object.entries(byProfile)) {
    await client.query(`
      INSERT INTO item_placements(item_id, workspace_id, container_key, profile, x, y, width, height)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [itemId, workspaceId, containerKey, profileName, value.x, value.y, value.width, value.height])
  }
}

async function insertShortcut(client, workspaceId, tile, parentFolderId, placements) {
  const destination = httpUrl(tile.url)
  if (!destination) throw new Error(`V1 shortcut ${tile.id || tile.title || 'unknown'} has no HTTP(S) destination`)
  const id = crypto.randomUUID()
  const iconOverride = httpUrl(tile.favicon)
  await client.query(`
    INSERT INTO shortcut_items(
      id, workspace_id, parent_folder_id, kind, title, url, icon_override_url, favicon_url
    ) VALUES ($1, $2, $3, 'shortcut', $4, $5, $6, $6)
  `, [id, workspaceId, parentFolderId, text(tile.title, 'Shortcut', 120), destination, iconOverride])
  await insertPlacements(client, id, workspaceId, parentFolderId || 'root', placements)
  return id
}

async function insertFolder(client, workspaceId, tile) {
  const id = crypto.randomUUID()
  await client.query(`
    INSERT INTO shortcut_items(id, workspace_id, kind, title)
    VALUES ($1, $2, 'folder', $3)
  `, [id, workspaceId, text(tile.title, 'Folder', 120)])
  await insertPlacements(client, id, workspaceId, 'root', {
    wide: rootPlacement(tile, 'wide'),
    compact: rootPlacement(tile, 'compact'),
  })
  return id
}

async function loadSource() {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`V Start 1 state API returned ${response.status}`)
  const source = await response.json()
  if (!Array.isArray(source.workspaces) || !source.speedDials || typeof source.speedDials !== 'object') {
    throw new Error('V Start 1 returned an unsupported state document')
  }
  return source
}

async function main() {
  const source = await loadSource()
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  let shortcutCount = 0
  let folderCount = 0

  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE workspaces, shortcut_items, item_placements IN SHARE ROW EXCLUSIVE MODE')
    await client.query('SET CONSTRAINTS item_placements_no_overlap DEFERRED')

    const targetCount = await client.query('SELECT count(*)::int AS count FROM shortcut_items')
    if (Number(targetCount.rows[0].count) > 0) {
      throw new Error('V Start 2 already contains shortcuts; refusing to create duplicates')
    }

    await client.query('UPDATE workspaces SET sort_order = sort_order + 1000')
    const workspaceIds = new Map()

    for (let index = 0; index < source.workspaces.length; index += 1) {
      const workspace = source.workspaces[index]
      const slug = slugify(workspace.slug || workspace.name || workspace.id)
      const result = await client.query(`
        INSERT INTO workspaces(id, name, slug, sort_order, icon)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          sort_order = EXCLUDED.sort_order,
          icon = COALESCE(EXCLUDED.icon, workspaces.icon),
          version = workspaces.version + 1,
          updated_at = now()
        RETURNING id
      `, [crypto.randomUUID(), text(workspace.name, 'Workspace', 80), slug, 2000 + index, workspace.icon || null])
      workspaceIds.set(workspace.id, result.rows[0].id)
    }

    const desiredIds = source.workspaces.map((workspace) => workspaceIds.get(workspace.id))
    const extras = await client.query('SELECT id FROM workspaces WHERE NOT (id = ANY($1::uuid[])) ORDER BY sort_order', [desiredIds])
    const finalIds = [...desiredIds, ...extras.rows.map((row) => row.id)]
    await client.query('UPDATE workspaces SET sort_order = sort_order + 4000')
    for (let index = 0; index < finalIds.length; index += 1) {
      await client.query('UPDATE workspaces SET sort_order = $2 WHERE id = $1', [finalIds[index], index])
    }

    for (const workspace of source.workspaces) {
      const workspaceId = workspaceIds.get(workspace.id)
      const tiles = Array.isArray(source.speedDials[workspace.id]) ? source.speedDials[workspace.id] : []
      for (const tile of tiles) {
        if (tile.type === 'folder' || Array.isArray(tile.children)) {
          const folderId = await insertFolder(client, workspaceId, tile)
          folderCount += 1
          const children = Array.isArray(tile.children) ? tile.children : []
          for (let index = 0; index < children.length; index += 1) {
            await insertShortcut(client, workspaceId, children[index], folderId, {
              wide: childPlacement(index, 'wide'),
              compact: childPlacement(index, 'compact'),
            })
            shortcutCount += 1
          }
        } else {
          await insertShortcut(client, workspaceId, tile, null, {
            wide: rootPlacement(tile, 'wide'),
            compact: rootPlacement(tile, 'compact'),
          })
          shortcutCount += 1
        }
      }
    }

    const activeWorkspaceId = workspaceIds.get(source.activeWorkspaceId) || desiredIds[0]
    if (activeWorkspaceId) {
      await client.query(`
        INSERT INTO app_state(key, value)
        VALUES ('last_active_workspace_id', to_jsonb($1::text))
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          version = app_state.version + 1,
          updated_at = now()
      `, [activeWorkspaceId])
    }

    await client.query('COMMIT')
    console.log(`Migrated ${source.workspaces.length} workspaces, ${shortcutCount} shortcuts, and ${folderCount} folder from V Start 1.`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

await main()
