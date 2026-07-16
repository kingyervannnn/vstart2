export const BACKGROUND_ZOOM_MIN = 100
export const BACKGROUND_ZOOM_MAX = 120
export const BACKGROUND_ZOOM_DEFAULT = 100

export function normalizeBackgroundZoom(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return BACKGROUND_ZOOM_DEFAULT
  return Math.max(BACKGROUND_ZOOM_MIN, Math.min(BACKGROUND_ZOOM_MAX, Math.round(numeric)))
}

export function backgroundZoomScale(value) {
  return normalizeBackgroundZoom(value) / 100
}
