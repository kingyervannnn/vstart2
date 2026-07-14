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
