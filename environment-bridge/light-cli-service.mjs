import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_CLI_PATH = join(homedir(), '.local/bin/room-light')
const DEFAULT_TIMEOUT_MS = 8_000
const CAPABILITY_CACHE_MS = 5_000
const KNOWN_SWATCHES = {
  warm_white: '#ffd6a3',
  soft_white: '#fff0cf',
  salmon: '#ff8b76',
  red: '#ff5757',
  blue: '#6f9dff',
  green: '#62d98a',
}

export class EnvironmentBridgeError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function execute(command, args, { allowFailure = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new EnvironmentBridgeError(504, 'cli_timeout', 'The environment CLI timed out'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new EnvironmentBridgeError(503, 'cli_unavailable', error.message))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const result = { code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }
      if (result.code === 0 || allowFailure) resolve(result)
      else reject(new EnvironmentBridgeError(502, 'cli_failed', result.stderr || 'The environment CLI command failed'))
    })
  })
}

function parseJson(result, code) {
  try {
    return JSON.parse(result.stdout || '{}')
  } catch {
    throw new EnvironmentBridgeError(502, code, 'The environment CLI returned invalid JSON')
  }
}

function titleCase(value) {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function fallbackSwatch(channel) {
  let hash = 0
  for (const character of channel) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 68% 64%)`
}

function stateFromStatus(status = {}) {
  const action = String(status.action || '')
  if (/^OFF\b/i.test(action)) return { power: false, channel: null, level: 0, updatedAt: status.at || null, healthy: status.ok !== false }
  const channelMatch = action.match(/^([a-z][a-z0-9_]*)\s+(\d+)$/i)
  if (channelMatch) return { power: true, channel: channelMatch[1].toLowerCase(), level: Number(channelMatch[2]), updatedAt: status.at || null, healthy: status.ok !== false }
  const presetMatch = action.match(/^Preset\s+([a-z][a-z0-9_]*)_(\d+)$/i)
  if (presetMatch) return { power: true, channel: presetMatch[1].toLowerCase(), level: Number(presetMatch[2]), updatedAt: status.at || null, healthy: status.ok !== false }
  return { power: null, channel: null, level: null, updatedAt: status.at || null, healthy: status.ok !== false }
}

export class LightCliService {
  constructor({ cliPath = process.env.VSTART_LIGHT_CLI_PATH || DEFAULT_CLI_PATH, runner } = {}) {
    this.cliPath = cliPath
    this.runner = runner || ((args, options) => execute(this.cliPath, args, options))
    this.capabilityCache = null
    this.queue = Promise.resolve()
  }

  async capabilities({ force = false } = {}) {
    if (!force && this.capabilityCache && Date.now() - this.capabilityCache.at < CAPABILITY_CACHE_MS) return this.capabilityCache.value
    const config = parseJson(await this.runner(['config', '--json']), 'capabilities_invalid')
    const configuredColors = config.ui?.channel_colors || {}
    const channels = Object.entries(config.channels || {}).map(([id, value]) => ({
      id,
      name: config.ui?.channel_labels?.[id] || titleCase(id),
      levels: [...new Set((value?.levels || []).map(Number).filter((level) => Number.isFinite(level) && level > 0))].sort((a, b) => a - b),
      swatch: configuredColors[id] || KNOWN_SWATCHES[id] || fallbackSwatch(id),
    })).filter((channel) => channel.levels.length)
    const defaultChannel = channels.some((channel) => channel.id === config.ui?.default_channel)
      ? config.ui.default_channel
      : channels[0]?.id || null
    const value = { power: true, defaultChannel, channels }
    this.capabilityCache = { at: Date.now(), value }
    return value
  }

  async state() {
    const result = await this.runner(['status', '--json'], { allowFailure: true })
    if (!result.stdout) return { power: null, channel: null, level: null, updatedAt: null, healthy: false }
    return stateFromStatus(parseJson(result, 'status_invalid'))
  }

  async snapshot() {
    const [capabilities, state] = await Promise.all([this.capabilities(), this.state()])
    return { devices: [{ id: 'room-light', name: 'Room Light', kind: 'light', capabilities, state }] }
  }

  setPower(on) {
    return this.#enqueue(async () => {
      await this.runner([on ? 'on' : 'off', '--json'])
      return this.snapshot()
    })
  }

  setLight(channelId, level) {
    return this.#enqueue(async () => {
      const capabilities = await this.capabilities({ force: true })
      const channel = capabilities.channels.find((candidate) => candidate.id === channelId)
      if (!channel) throw new EnvironmentBridgeError(400, 'channel_unavailable', 'That light color is not available')
      const numericLevel = Number(level)
      if (!channel.levels.includes(numericLevel)) throw new EnvironmentBridgeError(400, 'level_unavailable', 'That intensity is not available for this color')
      await this.runner([channel.id, String(numericLevel), '--json'])
      return this.snapshot()
    })
  }

  #enqueue(action) {
    const next = this.queue.catch(() => {}).then(action)
    this.queue = next
    return next
  }
}

export const lightStateFromStatus = stateFromStatus
