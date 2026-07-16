import crypto from 'node:crypto'
import sharp from 'sharp'

export const MAX_BACKGROUND_BYTES = 300 * 1024 * 1024
export const BACKGROUND_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

let previewQueue = Promise.resolve()
const previewJobs = new Map()

export async function createBackgroundPreview(content) {
  try {
    const preview = await sharp(content, { animated: false, page: 0, limitInputPixels: 400_000_000 })
      .rotate()
      .resize(480, 320, { fit: 'cover', position: 'centre' })
      .webp({ quality: 76, effort: 4 })
      .toBuffer()
    return { mimeType: 'image/webp', content: preview }
  } catch {
    return null
  }
}

export async function storeBackgroundAsset(client, { content, mimeType, originalName, collectionName, preview }) {
  const sha256 = crypto.createHash('sha256').update(content).digest('hex')
  const id = crypto.randomUUID()
  const asset = await client.query(`
    INSERT INTO assets(
      id, kind, mime_type, sha256, byte_length, content, original_name,
      preview_mime_type, preview_content
    )
    VALUES ($1, 'background', $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (kind, sha256) DO UPDATE SET
      original_name = COALESCE(assets.original_name, EXCLUDED.original_name),
      preview_mime_type = COALESCE(assets.preview_mime_type, EXCLUDED.preview_mime_type),
      preview_content = COALESCE(assets.preview_content, EXCLUDED.preview_content)
    RETURNING id
  `, [id, mimeType, sha256, content.length, content, originalName || null, preview?.mimeType || null, preview?.content || null])

  if (collectionName) {
    const collection = await client.query(`
      INSERT INTO background_collections(id, name)
      VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [crypto.randomUUID(), collectionName])
    await client.query(`
      INSERT INTO background_collection_assets(collection_id, asset_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [collection.rows[0].id, asset.rows[0].id])
  }

  return asset.rows[0].id
}

export function ensureBackgroundPreview(queryable, assetId) {
  if (previewJobs.has(assetId)) return previewJobs.get(assetId)
  const job = previewQueue.then(async () => {
    const result = await queryable.query(`
      SELECT kind, content, preview_mime_type, preview_content
      FROM assets
      WHERE id = $1
    `, [assetId])
    if (!result.rowCount || result.rows[0].kind !== 'background') return null
    const asset = result.rows[0]
    if (asset.preview_content) return { mimeType: asset.preview_mime_type, content: asset.preview_content }
    const preview = await createBackgroundPreview(asset.content)
    if (!preview) return null
    await queryable.query(`
      UPDATE assets
      SET preview_mime_type = $2, preview_content = $3
      WHERE id = $1 AND preview_content IS NULL
    `, [assetId, preview.mimeType, preview.content])
    return preview
  })
  previewQueue = job.catch(() => {})
  previewJobs.set(assetId, job)
  void job.finally(() => previewJobs.delete(assetId)).catch(() => {})
  return job
}

export async function warmBackgroundPreviews(queryable) {
  const pending = await queryable.query(`
    SELECT id FROM assets
    WHERE kind = 'background' AND preview_content IS NULL
    ORDER BY created_at
  `)
  let generated = 0
  for (const row of pending.rows) {
    if (await ensureBackgroundPreview(queryable, row.id)) generated += 1
  }
  return generated
}
