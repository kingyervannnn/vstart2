import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Selectively ported from V Start 1. This copy is independently owned by V Start 2.
const PORT = process.env.NOTES_PORT ? Number(process.env.NOTES_PORT) : 3410
const BIND_HOST = path.resolve(process.env.NOTES_BIND_HOST || os.homedir() || '/Users/vbitzx')
const BIND_CONTAINER = path.resolve(process.env.NOTES_BIND_CONTAINER || '/host')
const DEFAULT_HOST_ROOT = process.env.NOTES_ROOT_HOST
  || process.env.VSTART2_NOTES_ROOT
  || path.join(BIND_HOST, 'SYNC', 'Vaults')

// Legacy single-mount mode: NOTES_ROOT points at the vault inside the container.
const LEGACY_ROOT = process.env.NOTES_ROOT ? path.resolve(process.env.NOTES_ROOT) : null
const USE_HOST_BIND = !LEGACY_ROOT || process.env.NOTES_USE_HOST_BIND === '1' || Boolean(process.env.NOTES_BIND_HOST || process.env.NOTES_ROOT_HOST)

let rootHost = DEFAULT_HOST_ROOT

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    ...headers,
  })
  res.end(payload)
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) } catch { resolve({}) }
    })
  })
}

function sanitizeId(value) {
  const v = String(value || '').trim()
  if (!v) return null
  return v.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

function sanitizeFolderPath(value) {
  try {
    const raw = String(value || '').trim()
    if (!raw) return ''
    // Normalize separators and strip leading/trailing slashes
    let normalized = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!normalized) return ''
    // Remove any parent directory segments to keep paths inside ROOT
    const safeSegments = normalized
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
    return safeSegments.join('/')
  } catch {
    return ''
  }
}

function normalizeHostPath(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('Vault path is required')
  if (raw.includes('\0')) throw new Error('Invalid vault path')
  // Expand a leading ~/ only for host-style paths.
  const expanded = raw.startsWith('~/')
    ? path.join(BIND_HOST, raw.slice(2))
    : raw === '~'
      ? BIND_HOST
      : raw
  const resolved = path.resolve(expanded)
  if (resolved !== BIND_HOST && !resolved.startsWith(BIND_HOST + path.sep)) {
    throw new Error(`Vault path must stay inside ${BIND_HOST}`)
  }
  return resolved
}

function toContainerPath(hostPath) {
  if (!USE_HOST_BIND && LEGACY_ROOT) return LEGACY_ROOT
  const normalized = normalizeHostPath(hostPath)
  const relative = path.relative(BIND_HOST, normalized)
  return relative ? path.join(BIND_CONTAINER, relative) : BIND_CONTAINER
}

function makeVaultDir() {
  return USE_HOST_BIND || !LEGACY_ROOT ? toContainerPath(rootHost) : LEGACY_ROOT
}

function currentHostPath() {
  if (USE_HOST_BIND || !LEGACY_ROOT) return normalizeHostPath(rootHost)
  return LEGACY_ROOT
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function readText(file, fallback = '') {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return fallback
  }
}

async function writeText(file, text) {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, text, 'utf8')
}

async function pathStatus(containerPath) {
  try {
    const stat = await fs.stat(containerPath)
    if (!stat.isDirectory()) {
      return { exists: true, writable: false, error: 'Vault path is not a directory' }
    }
  } catch {
    return { exists: false, writable: false, error: 'Vault path does not exist' }
  }
  const probe = path.join(containerPath, `.vstart2-write-test-${process.pid}`)
  try {
    await fs.writeFile(probe, 'ok', 'utf8')
    await fs.unlink(probe)
    return { exists: true, writable: true, error: '' }
  } catch (error) {
    return { exists: true, writable: false, error: String(error?.message || error) }
  }
}

function parseFrontmatter(text) {
  try {
    const src = String(text || '')
    if (!src.startsWith('---')) {
      return { meta: {}, body: src }
    }
    const end = src.indexOf('\n---', 3)
    if (end === -1) {
      return { meta: {}, body: src }
    }
    const header = src.slice(3, end).split(/\r?\n/)
    const meta = {}
    for (const line of header) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim()
      if (!key) continue
      meta[key] = value
    }
    const body = src.slice(end + 4).replace(/^\r?\n/, '')
    return { meta, body }
  } catch {
    return { meta: {}, body: String(text || '') }
  }
}

async function walkNotes(dir, relDir, vaultId, folderFilter, out) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const absPath = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      const nextRelDir = relDir ? `${relDir}/${ent.name}` : ent.name
      await walkNotes(absPath, nextRelDir, vaultId, folderFilter, out)
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      const raw = await readText(absPath, '')
      const { meta, body } = parseFrontmatter(raw)
      const id = meta.id || ent.name.replace(/\.md$/, '')
      const noteVault = meta.vaultId || null
      // Treat the special "default" vaultId as an aggregate view that
      // includes all notes regardless of stored vaultId, so older notes
      // created under per-vault ids still show up.
      if (vaultId && vaultId !== 'default' && noteVault && noteVault !== vaultId) continue
      // Derive a single-level folder name from the filesystem path so that
      // we never expose nested folder hierarchies to the client.
      const safeRel = sanitizeFolderPath(relDir || '')
      const relFolder = safeRel ? safeRel.split('/')[0] : ''
      if (folderFilter && relFolder !== folderFilter) continue
      out.push({
        id,
        title: meta.title || '',
        content: body,
        updatedAt: Number(meta.updatedAt) || Date.now(),
        workspaceId: meta.workspaceId || null,
        vaultId: noteVault || vaultId || null,
        folder: relFolder,
      })
    }
  }
}

async function listNotes(vaultId, folder) {
  const dir = makeVaultDir()
  if (!dir) return []
  const out = []
  const folderFilter = sanitizeFolderPath(folder)
  await walkNotes(dir, '', vaultId, folderFilter || null, out)
  return out
}

async function saveNote(vaultId, noteId, payload) {
  const rootDir = makeVaultDir()
  if (!rootDir) throw new Error('Invalid vault id')
  const safeId = sanitizeId(noteId) || sanitizeId(payload.id) || sanitizeId(Date.now())
  const requestedFolder = sanitizeFolderPath(payload.folder || '')
  const dir = requestedFolder ? path.join(rootDir, requestedFolder) : rootDir
  const file = path.join(dir, `${safeId}.md`)
  const body = String(payload.content || '')
  // Write pure Markdown body only; note metadata (workspace, vault, etc.)
  // is tracked on the client side instead of inside the .md file to keep
  // Obsidian notes clean.
  await writeText(file, body)
  return {
    id: safeId,
    title: payload.title || '',
    content: body,
    updatedAt: Date.now(),
    workspaceId: payload.workspaceId || null,
    vaultId: vaultId || null,
    folder: requestedFolder,
  }
}

async function deleteNote(vaultId, noteId, folder) {
  const rootDir = makeVaultDir()
  if (!rootDir) return
  const safeId = sanitizeId(noteId)
  if (!safeId) return
  const folderPath = sanitizeFolderPath(folder || '')
  const dir = folderPath ? path.join(rootDir, folderPath) : rootDir
  const file = path.join(dir, `${safeId}.md`)
  try {
    await fs.unlink(file)
  } catch {
    // ignore
  }
}

async function deleteFolderTree(folder) {
  const rootDir = makeVaultDir()
  if (!rootDir) return
  const safe = sanitizeFolderPath(folder || '')
  if (!safe) return
  const dir = path.join(rootDir, safe)
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

async function buildConfig() {
  let hostPath
  try {
    hostPath = currentHostPath()
  } catch (error) {
    return {
      ok: false,
      vaultPath: String(rootHost || ''),
      bindHost: BIND_HOST,
      exists: false,
      writable: false,
      noteCount: 0,
      error: String(error?.message || error),
    }
  }
  const containerPath = makeVaultDir()
  const status = await pathStatus(containerPath)
  let noteCount = 0
  if (status.exists) {
    try {
      noteCount = (await listNotes('default', '')).length
    } catch {
      noteCount = 0
    }
  }
  return {
    ok: status.exists && status.writable,
    vaultPath: hostPath,
    bindHost: BIND_HOST,
    exists: status.exists,
    writable: status.writable,
    noteCount,
    error: status.error || '',
  }
}

async function setVaultPath(nextPath) {
  const normalized = normalizeHostPath(nextPath)
  const containerPath = toContainerPath(normalized)
  const status = await pathStatus(containerPath)
  if (!status.exists) {
    // Create the vault root when the user points at a missing folder under the bind host.
    await ensureDir(containerPath)
  }
  const after = await pathStatus(containerPath)
  if (!after.exists) throw new Error(after.error || 'Vault path is unavailable')
  if (!after.writable) throw new Error(after.error || 'Vault path is not writable')
  rootHost = normalized
  return buildConfig()
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const p = url.pathname
    if (req.method === 'OPTIONS') {
      send(res, 204, '')
      return
    }
    if (req.method === 'GET' && (p === '/notes/health' || p === '/notes/api/v1/health')) {
      const config = await buildConfig()
      send(res, 200, { ok: true, ...config })
      return
    }

    if (req.method === 'GET' && p === '/notes/api/v1/config') {
      send(res, 200, await buildConfig())
      return
    }

    if (req.method === 'PUT' && p === '/notes/api/v1/config') {
      const body = await parseBody(req)
      try {
        const config = await setVaultPath(body.vaultPath || body.path || rootHost)
        send(res, 200, config)
      } catch (e) {
        send(res, 400, { error: String(e?.message || e) })
      }
      return
    }

    if (req.method === 'POST' && p === '/notes/api/v1/folders') {
      const body = await parseBody(req)
      const folders = Array.isArray(body.folders) ? body.folders : []
      try {
        const rootDir = makeVaultDir()
        if (!rootDir) throw new Error('No vault root')
        for (const raw of folders) {
          const safe = sanitizeFolderPath(raw)
          if (!safe) continue
          const dir = path.join(rootDir, safe)
          await ensureDir(dir)
        }
        send(res, 200, { ok: true })
      } catch (e) {
        send(res, 500, { error: String(e?.message || e) })
      }
      return
    }

    if (req.method === 'POST' && p === '/notes/api/v1/folders/delete') {
      const body = await parseBody(req)
      const folders = Array.isArray(body.folders) ? body.folders : []
      try {
        for (const raw of folders) {
          await deleteFolderTree(raw)
        }
        send(res, 200, { ok: true })
      } catch (e) {
        send(res, 500, { error: String(e?.message || e) })
      }
      return
    }

    const vaultMatch = p.match(/^\/notes\/api\/v1\/vault\/([^/]+)\/notes\/?$/)
    const noteMatch = p.match(/^\/notes\/api\/v1\/vault\/([^/]+)\/notes\/([^/]+)\/?$/)

    if (req.method === 'GET' && vaultMatch) {
      const vaultId = decodeURIComponent(vaultMatch[1])
      const folder = url.searchParams.get('folder') || ''
      const notes = await listNotes(vaultId, folder)
      send(res, 200, { vaultId, notes, vaultPath: currentHostPath() })
      return
    }

    if (req.method === 'PUT' && noteMatch) {
      const vaultId = decodeURIComponent(noteMatch[1])
      const noteId = decodeURIComponent(noteMatch[2])
      const body = await parseBody(req)
      try {
        const saved = await saveNote(vaultId, noteId, body || {})
        send(res, 200, saved)
      } catch (e) {
        send(res, 400, { error: String(e?.message || e) })
      }
      return
    }

    if (req.method === 'DELETE' && noteMatch) {
      const vaultId = decodeURIComponent(noteMatch[1])
      const noteId = decodeURIComponent(noteMatch[2])
      const folder = url.searchParams.get('folder') || ''
      await deleteNote(vaultId, noteId, folder)
      send(res, 200, { ok: true })
      return
    }

    send(res, 404, { error: 'Not found' })
  } catch (e) {
    send(res, 500, { error: String(e?.message || e) })
  }
})

// Initialize root from env; ignore invalid startup path until config is fixed.
try {
  rootHost = normalizeHostPath(DEFAULT_HOST_ROOT)
} catch {
  rootHost = DEFAULT_HOST_ROOT
}

server.listen(PORT, () => {
  console.log(`[notes-api] listening on port ${PORT}, bindHost=${BIND_HOST}, rootHost=${rootHost}, containerRoot=${makeVaultDir()}`)
})
