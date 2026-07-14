import { Client } from 'pg'
import { resolveShortcutIcon } from '../server/icons.mjs'

const databaseUrl = process.env.DATABASE_URL || 'postgres://vstart2:vstart2-local-password@127.0.0.1:55432/vstart2'
const client = new Client({ connectionString: databaseUrl })
await client.connect()

let stored = 0
let unavailable = 0

try {
  const result = await client.query(`
    SELECT id, url, icon_override_url
    FROM shortcut_items
    WHERE kind = 'shortcut' AND icon_asset_id IS NULL
    ORDER BY created_at, id
  `)

  for (const row of result.rows) {
    const icon = await resolveShortcutIcon(client, row.url, row.icon_override_url)
    if (!icon.iconAssetId) {
      unavailable += 1
      continue
    }
    await client.query(`
      UPDATE shortcut_items
      SET icon_asset_id = $2,
          favicon_url = $3,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND icon_asset_id IS NULL
    `, [row.id, icon.iconAssetId, icon.faviconUrl])
    stored += 1
  }
} finally {
  await client.end()
}

console.log(`Stored ${stored} shortcut icons in PostgreSQL; ${unavailable} shortcuts still use generated fallbacks.`)
