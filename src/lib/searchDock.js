export function clampDockGeometry(value) {
  const requestedWidth = Number(value.width)
  const requestedX = Number(value.x)
  const requestedY = Number(value.y)
  const width = Math.max(0.28, Math.min(0.94, Number.isFinite(requestedWidth) ? requestedWidth : 0.58))
  return {
    width,
    x: Math.max(width / 2, Math.min(1 - width / 2, Number.isFinite(requestedX) ? requestedX : 0.5)),
    y: Math.max(0.16, Math.min(0.94, Number.isFinite(requestedY) ? requestedY : 0.82)),
  }
}

export function shouldDropSuggestionsUp(rect, viewportHeight, suggestionCount = 7) {
  if (!rect || !Number.isFinite(viewportHeight)) return false
  const estimatedHeight = Math.min(286, Math.max(52, suggestionCount * 36 + 12))
  const spaceAbove = Math.max(0, rect.top - 8)
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - 8)
  if (spaceBelow >= estimatedHeight) return false
  if (spaceAbove >= estimatedHeight) return true
  return spaceAbove > spaceBelow
}

export function shouldHideWorkspaceSwitcher(side, suggestionsDropUp, suggestionsVisible) {
  if (!suggestionsVisible) return false
  return (side === 'top' && suggestionsDropUp) || (side === 'bottom' && !suggestionsDropUp)
}

const normalizeSearchText = (value) => String(value || '').trim().toLocaleLowerCase()

export function parseShortcutSearch(value) {
  const text = String(value || '').trimStart()
  const shortcutOnly = text.startsWith('@')
  return {
    shortcutOnly,
    query: (shortcutOnly ? text.slice(1) : text).trim(),
  }
}

function shortcutMatchScore(item, folder, query) {
  if (!query) return 0
  const title = normalizeSearchText(item.title)
  const folderTitle = normalizeSearchText(folder?.title)
  const url = normalizeSearchText(item.url)
  if (title === query) return 0
  if (title.startsWith(query)) return 10
  if (title.split(/\s+/).some((word) => word.startsWith(query))) return 20
  if (title.includes(query)) return 30
  if (folderTitle.includes(query)) return 40
  if (url.includes(query)) return 50
  return null
}

export function findShortcutMatches({ items = [], workspaces = [], activeWorkspaceId = '', query = '' } = {}) {
  const normalizedQuery = normalizeSearchText(query)
  const folders = new Map(items.filter((item) => item.kind === 'folder').map((folder) => [folder.id, folder]))
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  return items
    .filter((item) => item.kind === 'shortcut' && item.url)
    .map((item) => {
      const folder = item.parentFolderId ? folders.get(item.parentFolderId) || null : null
      const score = shortcutMatchScore(item, folder, normalizedQuery)
      return score === null ? null : {
        item,
        folder,
        workspace: workspaceById.get(item.workspaceId) || null,
        score,
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftCurrent = left.item.workspaceId === activeWorkspaceId ? 0 : 1
      const rightCurrent = right.item.workspaceId === activeWorkspaceId ? 0 : 1
      return leftCurrent - rightCurrent
        || left.score - right.score
        || left.item.title.localeCompare(right.item.title)
    })
}
