import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const directory = path.dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = path.resolve(directory, '../migrations')

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://vstart2:vstart2-local-password@127.0.0.1:55432/vstart2',
  max: Number(process.env.PG_POOL_SIZE || 10),
  connectionTimeoutMillis: 4000,
})

pool.on('error', (error) => console.error('[database] idle client error', error))

export async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(87322191)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort()
    for (const name of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])
      if (exists.rowCount) continue
      const sql = await readFile(path.join(migrationsDirectory, name), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name])
        await client.query('COMMIT')
        console.log(`[database] applied ${name}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(87322191)').catch(() => {})
    client.release()
  }
}

export async function transaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
