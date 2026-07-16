export const APP_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

export const CANVASES = Object.freeze({
  wide: Object.freeze({ width: 1600, height: 1000, tileWidth: 128, tileHeight: 128 }),
  compact: Object.freeze({ width: 820, height: 1000, tileWidth: 104, tileHeight: 104 }),
})

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y
}

function clampPlacement(value, profile) {
  const canvas = CANVASES[profile]
  return {
    ...value,
    x: Math.max(0, Math.min(canvas.width - value.width, value.x)),
    y: Math.max(0, Math.min(canvas.height - value.height, value.y)),
  }
}

export function findOpenPlacement(placements, profile, preferred = {}) {
  const canvas = CANVASES[profile]
  const width = preferred.width || canvas.tileWidth
  const height = preferred.height || canvas.tileHeight
  const first = clampPlacement({ x: preferred.x ?? 80, y: preferred.y ?? 120, width, height }, profile)
  if (!placements.some((placement) => intersects(first, placement))) return first
  for (let y = 40; y + height <= canvas.height; y += 24) {
    for (let x = 40; x + width <= canvas.width; x += 24) {
      const candidate = { x, y, width, height }
      if (!placements.some((placement) => intersects(candidate, placement))) return candidate
    }
  }
  return null
}

export function placementsForShortcut(bootstrap, workspaceId) {
  const result = {}
  for (const [profile, canvas] of Object.entries(CANVASES)) {
    const occupied = (bootstrap.placements || []).filter((placement) => (
      placement.workspaceId === workspaceId &&
      placement.profile === profile &&
      placement.containerKey === 'root'
    ))
    const open = findOpenPlacement(occupied, profile, {
      x: canvas.width * 0.46,
      y: canvas.height * 0.34,
    })
    if (!open) throw new Error(`No free space remains in the ${profile} layout.`)
    result[profile] = open
  }
  return result
}

export function normalizedHttpUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function comparable(value) {
  return String(value ?? '').trim().toLocaleLowerCase()
}

function workspaceFromSignal(workspaces, signal) {
  if (signal === undefined || signal === null || signal === '') return null
  const candidates = typeof signal === 'object'
    ? [signal.id, signal.workspaceId, signal.name, signal.title, signal.slug]
    : [signal]
  for (const candidate of candidates) {
    const target = comparable(candidate)
    if (!target) continue
    const match = workspaces.find((workspace) => (
      comparable(workspace.id) === target ||
      comparable(workspace.slug) === target ||
      comparable(workspace.name) === target
    ))
    if (match) return match
  }
  return null
}

export function chooseWorkspace(bootstrap, tab = {}) {
  const workspaces = bootstrap.workspaces || []
  if (!workspaces.length) return { workspace: null, source: 'none' }

  const vivaldiSignals = [
    tab.vivaldiWorkspaceId,
    tab.workspaceId,
    tab.workspaceName,
    tab.workspace,
  ]
  for (const signal of vivaldiSignals) {
    const match = workspaceFromSignal(workspaces, signal)
    if (match) return { workspace: match, source: 'vivaldi' }
  }

  try {
    const tabUrl = new URL(tab.url || '')
    if (APP_ORIGINS.includes(tabUrl.origin)) {
      const slug = tabUrl.pathname.match(/^\/w\/([^/]+)/)?.[1]
      const match = workspaceFromSignal(workspaces, slug && decodeURIComponent(slug))
      if (match) return { workspace: match, source: 'vstart-tab' }
    }
  } catch {
    // The active tab can be an internal browser page without a normal URL.
  }

  const activeId = bootstrap.state?.last_active_workspace_id?.value
  const active = workspaceFromSignal(workspaces, activeId)
  if (active) return { workspace: active, source: 'vstart-state' }
  return { workspace: workspaces[0], source: 'first-workspace' }
}

export function defaultShortcutTitle(tab, url) {
  const title = String(tab?.title || '').trim()
  if (title) return title.slice(0, 120)
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 120)
  } catch {
    return 'New shortcut'
  }
}
