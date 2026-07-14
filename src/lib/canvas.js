export const CANVASES = Object.freeze({
  wide: Object.freeze({ width: 1600, height: 1000, tileWidth: 128, tileHeight: 128 }),
  compact: Object.freeze({ width: 820, height: 1000, tileWidth: 104, tileHeight: 104 }),
})

export function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y
}

export function clampPlacement(value, profile) {
  const canvas = CANVASES[profile]
  return {
    ...value,
    x: Math.max(0, Math.min(canvas.width - value.width, value.x)),
    y: Math.max(0, Math.min(canvas.height - value.height, value.y)),
  }
}

export function collides(candidate, placements, ignoredItemId = null) {
  return placements.some((placement) => placement.itemId !== ignoredItemId && intersects(candidate, placement))
}

export function findOpenPlacement(placements, profile, preferred = {}) {
  const canvas = CANVASES[profile]
  const width = preferred.width || canvas.tileWidth
  const height = preferred.height || canvas.tileHeight
  const first = clampPlacement({ x: preferred.x ?? 80, y: preferred.y ?? 120, width, height }, profile)
  if (!collides(first, placements)) return first
  for (let y = 40; y + height <= canvas.height; y += 24) {
    for (let x = 40; x + width <= canvas.width; x += 24) {
      const candidate = { x, y, width, height }
      if (!collides(candidate, placements)) return candidate
    }
  }
  return null
}

export function projectPlacement(value, fromProfile, toProfile) {
  const from = CANVASES[fromProfile]
  const to = CANVASES[toProfile]
  const width = to.tileWidth
  const height = to.tileHeight
  return clampPlacement({
    x: (value.x / Math.max(1, from.width - value.width)) * (to.width - width),
    y: (value.y / Math.max(1, from.height - value.height)) * (to.height - height),
    width,
    height,
  }, toProfile)
}

export function pointToLogical(clientX, clientY, bounds, profile) {
  const canvas = CANVASES[profile]
  return {
    x: ((clientX - bounds.left) / Math.max(1, bounds.width)) * canvas.width,
    y: ((clientY - bounds.top) / Math.max(1, bounds.height)) * canvas.height,
  }
}

export function placementStyle(value, profile) {
  const canvas = CANVASES[profile]
  return {
    left: `${(value.x / canvas.width) * 100}%`,
    top: `${(value.y / canvas.height) * 100}%`,
    width: `${(value.width / canvas.width) * 100}%`,
    height: `${(value.height / canvas.height) * 100}%`,
  }
}
