import { Client } from 'pg'
import { inspectIconQuality, resolveShortcutIcon, shortcutIconPreference } from '../server/icons.mjs'

const databaseUrl = process.env.DATABASE_URL || 'postgres://vstart2:vstart2-local-password@127.0.0.1:55432/vstart2'
const client = new Client({ connectionString: databaseUrl })
await client.connect()
const refreshWeak = process.argv.includes('--weak')

let stored = 0
let unavailable = 0
let generated = 0

try {
  const result = await client.query(`
    SELECT s.id, s.title, s.url, s.icon_override_url, s.icon_asset_id, s.favicon_url,
           a.mime_type AS icon_mime_type, a.content AS icon_content, a.sha256 AS icon_sha256
    FROM shortcut_items s
    LEFT JOIN assets a ON a.id = s.icon_asset_id
    WHERE s.kind = 'shortcut'
      AND (
        s.icon_asset_id IS NULL
        OR ($1::boolean AND s.favicon_url IS NOT NULL)
      )
    ORDER BY s.created_at, s.id
  `, [refreshWeak])

  for (const row of result.rows) {
    let currentQuality = null
    if (row.icon_asset_id && refreshWeak) {
      if (row.icon_override_url) continue
      currentQuality = await inspectIconQuality(row.icon_content, row.icon_mime_type)
    }
    const icon = await resolveShortcutIcon(client, row.url, row.icon_override_url, {
      title: row.title,
      excludeSourceUrls: currentQuality ? [row.favicon_url] : [],
      excludeContentSha256: currentQuality ? row.icon_sha256 : null,
      allowGeneratedFallback: !currentQuality,
      minimumPreference: currentQuality ? shortcutIconPreference(currentQuality) : Number.NEGATIVE_INFINITY,
    })
    if (!icon?.iconAssetId) {
      unavailable += 1
      continue
    }
    await client.query(`
      UPDATE shortcut_items
      SET icon_asset_id = $2,
          favicon_url = $3,
          version = version + 1,
          updated_at = now()
      WHERE id = $1
    `, [row.id, icon.iconAssetId, icon.faviconUrl])
    stored += 1
    if (!icon.faviconUrl) generated += 1
  }
} finally {
  await client.end()
}

console.log(`Stored ${stored} shortcut icons in PostgreSQL (${generated} generated); ${unavailable} shortcuts could not be updated.`)
