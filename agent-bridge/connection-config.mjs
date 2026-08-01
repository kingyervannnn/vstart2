import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const DEFAULT_PATH = join(homedir(), 'Library/Application Support/VStart2/agent-bridge-connection.json')

export function connectionConfigPath(explicit = '') {
  return explicit || process.env.VSTART_AGENT_CONNECTION_FILE || DEFAULT_PATH
}

export function normalizeRemoteUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) throw new Error('Remote Hermes URL is required')
  let parsed
  try {
    parsed = new URL(value)
  } catch (error) {
    throw new Error(`Remote Hermes URL is not valid: ${error.message}`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Remote Hermes URL must be http:// or https://')
  }
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString().replace(/\/+$/, '')
}

export async function loadConnectionConfig(path = connectionConfigPath()) {
  const fromEnvMode = String(process.env.VSTART_AGENT_BACKEND || '').trim().toLowerCase()
  const fromEnvUrl = String(process.env.VSTART_AGENT_WEBUI_URL || '').trim()
  const fromEnvPassword = process.env.VSTART_AGENT_WEBUI_PASSWORD
  let file = null
  try {
    file = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    file = null
  }

  const mode = (fromEnvMode || file?.mode || 'local').toLowerCase()
  const remoteUrl = fromEnvUrl || file?.remoteUrl || ''
  const password = typeof fromEnvPassword === 'string' && fromEnvPassword
    ? fromEnvPassword
    : (typeof file?.password === 'string' ? file.password : '')

  return {
    mode: mode === 'webui' || mode === 'remote' ? 'webui' : 'local',
    remoteUrl: remoteUrl ? normalizeRemoteUrl(remoteUrl) : '',
    password,
    path,
    source: fromEnvMode || fromEnvUrl || fromEnvPassword != null ? 'env' : file ? 'file' : 'default',
  }
}

export async function saveConnectionConfig(next, path = connectionConfigPath()) {
  const mode = next.mode === 'webui' || next.mode === 'remote' ? 'webui' : 'local'
  const remoteUrl = mode === 'webui' ? normalizeRemoteUrl(next.remoteUrl || '') : ''
  const password = mode === 'webui' ? String(next.password || '') : ''
  if (mode === 'webui' && !password) throw new Error('Password is required for Hermes WebUI connection')

  const payload = {
    mode,
    remoteUrl,
    // Password stays host-local in this file (mode 0600). It is never written to Postgres.
    password,
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  try {
    await chmod(path, 0o600)
  } catch {
    // Best effort on platforms that ignore mode bits.
  }
  return {
    mode: payload.mode,
    remoteUrl: payload.remoteUrl,
    hasPassword: Boolean(payload.password),
    updatedAt: payload.updatedAt,
    path,
  }
}

export function publicConnectionView(config) {
  return {
    mode: config.mode,
    remoteUrl: config.remoteUrl || '',
    hasPassword: Boolean(config.password),
    source: config.source,
  }
}
