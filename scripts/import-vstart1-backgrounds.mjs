#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const DEFAULT_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../VSTART')
const DEFAULT_DATABASE_URL = 'postgres://vstart2:vstart2-local-password@127.0.0.1:55432/vstart2'
const MAX_BYTES = 256 * 1024 * 1024
const MIME_TYPES = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

function parseArgs(argv) {
  const options = {
    source: process.env.VSTART1_DIR || DEFAULT_SOURCE,
    databaseUrl: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    select: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--source') options.source = argv[++index] || options.source
    else if (value === '--database-url') options.databaseUrl = argv[++index] || options.databaseUrl
    else if (value === '--select') options.select = argv[++index] || ''
    else if (value === '--help') options.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return options
}

async function imageFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  return entries
    .filter((entry) => entry.isFile() && MIME_TYPES.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(directory, entry.name))
}

function displayName(filePath) {
  const name = path.basename(filePath)
  const extension = path.extname(name)
  return name
    .slice(0, -extension.length)
    .replace(/-[0-9a-f]{12,}$/i, '')
    .replaceAll('_', ' ')
    .trim() + extension.toLowerCase()
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write('Usage: npm run import:vstart1:backgrounds -- [--source PATH] [--select FILE] [--database-url URL]\n')
    return
  }

  const files = [
    ...(await imageFiles(path.join(options.source, 'src/assets'))),
    ...(await imageFiles(path.join(options.source, 'uploads/backgrounds'))),
  ]
  if (!files.length) throw new Error(`No V Start 1 backgrounds found below ${options.source}`)

  const client = new Client({ connectionString: options.databaseUrl })
  await client.connect()
  const imported = []
  try {
    await client.query('BEGIN')
    for (const filePath of files) {
      const extension = path.extname(filePath).toLowerCase()
      const content = await fs.readFile(filePath)
      if (!content.length || content.length > MAX_BYTES) {
        throw new Error(`${filePath} must be between 1 byte and ${MAX_BYTES / 1024 / 1024} MB`)
      }
      const sha256 = crypto.createHash('sha256').update(content).digest('hex')
      const id = crypto.randomUUID()
      const originalName = displayName(filePath)
      const result = await client.query(`
        INSERT INTO assets(id, kind, mime_type, sha256, byte_length, content, original_name)
        VALUES ($1, 'background', $2, $3, $4, $5, $6)
        ON CONFLICT (kind, sha256) DO UPDATE
          SET original_name = COALESCE(assets.original_name, EXCLUDED.original_name)
        RETURNING id
      `, [id, MIME_TYPES.get(extension), sha256, content.length, content, originalName])
      imported.push({ id: result.rows[0].id, filePath, originalName, bytes: content.length })
    }

    if (options.select) {
      const target = imported.find(({ filePath, originalName }) => (
        path.basename(filePath) === options.select || originalName === options.select
      ))
      if (!target) throw new Error(`Selected background was not imported: ${options.select}`)
      await client.query(`
        UPDATE app_settings
        SET document = jsonb_set(document, '{backgrounds,globalAssetId}', to_jsonb($1::text), true),
            version = version + 1,
            updated_at = now()
        WHERE id = 'default'
      `, [target.id])
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }

  for (const asset of imported) {
    process.stdout.write(`${asset.id}  ${asset.originalName}  ${Math.round(asset.bytes / 1024)} KiB\n`)
  }
  process.stdout.write(`Imported ${imported.length} V Start 1 backgrounds${options.select ? `; selected ${options.select}` : ''}.\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
