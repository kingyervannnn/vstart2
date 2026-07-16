export const HEADER_SCROLL_SPEED_DEFAULT = 100
export const HEADER_SCROLL_SPEED_MIN = 50
export const HEADER_SCROLL_SPEED_MAX = 200

export function normalizeHeaderScrollSpeed(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return HEADER_SCROLL_SPEED_DEFAULT
  return Math.max(HEADER_SCROLL_SPEED_MIN, Math.min(HEADER_SCROLL_SPEED_MAX, Math.round(numeric / 5) * 5))
}

export function headerScrollDuration(value) {
  return 32 / (normalizeHeaderScrollSpeed(value) / 100)
}
