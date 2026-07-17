export const DEFAULT_EDGE_GLOW_INTENSITY = 100
export const DEFAULT_ELEMENT_GLOW_INTENSITY = 100

export function normalizeGlowIntensity(value, fallback = 100) {
  const numeric = Number(value)
  const normalizedFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 100
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(numeric) ? numeric : normalizedFallback)))
}

export function glowStrength(value, fallback = 100) {
  return normalizeGlowIntensity(value, fallback) / 100
}
