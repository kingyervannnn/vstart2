export const DEFAULT_MISSION_GLANCE_PROJECT_PATHS = [
  '/Users/vbitzx/SS/trucking saas',
  '/Users/vbitzx/SS/DEV/dental-pms',
  '/Users/vbitzx/SS/APC-Universal-Compiler',
  '/Users/vbitzx/SS/PAYMENT WATCH',
  '/Users/vbitzx/SS/vstart2',
]

const MAX_PROJECTS = 20
const MAX_PATH_LENGTH = 4_096

export function normalizeMissionGlancePaths(value) {
  const source = Array.isArray(value) ? value : DEFAULT_MISSION_GLANCE_PROJECT_PATHS
  return [...new Set(source
    .filter((path) => typeof path === 'string')
    .map((path) => path.trim())
    .filter((path) => path.startsWith('/') && path.length <= MAX_PATH_LENGTH))]
    .slice(0, MAX_PROJECTS)
}

export function missionGlanceProjectName(path) {
  return String(path || '').replace(/\/+$/, '').split('/').at(-1) || String(path || '')
}

export function relativeCommitTime(value, now = Date.now()) {
  const committedAt = Date.parse(value)
  if (!Number.isFinite(committedAt)) return ''
  const difference = now - committedAt
  const seconds = Math.floor(Math.abs(difference) / 1_000)
  if (seconds < 60) return 'just now'
  const units = [
    ['y', 365 * 24 * 60 * 60],
    ['mo', 30 * 24 * 60 * 60],
    ['d', 24 * 60 * 60],
    ['h', 60 * 60],
    ['m', 60],
  ]
  const [label, size] = units.find(([, unitSize]) => seconds >= unitSize) || units.at(-1)
  const amount = Math.floor(seconds / size)
  return difference < 0 ? `in ${amount}${label}` : `${amount}${label} ago`
}

export function isRecentCommit(value, now = Date.now()) {
  const committedAt = Date.parse(value)
  const age = now - committedAt
  return Number.isFinite(committedAt) && age >= 0 && age < 24 * 60 * 60 * 1_000
}

export function truncateCommitSubject(value, maximumLength = 72) {
  const subject = String(value || '')
  if (subject.length <= maximumLength) return subject
  return `${subject.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`
}

async function request(path, options = {}) {
  const response = await fetch(`/environment-bridge${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message || `Mission Glance request failed (${response.status})`)
  return body
}

export const missionGlanceApi = {
  snapshot: (paths, signal) => request('/v1/projects/snapshot', { method: 'POST', body: JSON.stringify({ paths }), signal }),
}
