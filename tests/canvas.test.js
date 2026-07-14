import { describe, expect, it } from 'vitest'
import { clampPlacement, findOpenPlacement, intersects, projectPlacement } from '../src/lib/canvas.js'

describe('continuous placement canvas', () => {
  it('treats touching edges as non-overlapping', () => {
    expect(intersects({ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 0, width: 100, height: 100 })).toBe(false)
  })

  it('clamps a placement without applying gravity to valid coordinates', () => {
    expect(clampPlacement({ x: 333, y: 444, width: 128, height: 128 }, 'wide')).toEqual({ x: 333, y: 444, width: 128, height: 128 })
    expect(clampPlacement({ x: 1590, y: 990, width: 128, height: 128 }, 'wide')).toEqual({ x: 1472, y: 872, width: 128, height: 128 })
  })

  it('projects an inactive profile without mutating the original placement', () => {
    const wide = { x: 700, y: 450, width: 128, height: 128 }
    const compact = projectPlacement(wide, 'wide', 'compact')
    expect(wide).toEqual({ x: 700, y: 450, width: 128, height: 128 })
    expect(compact.width).toBe(104)
    expect(compact.x).toBeGreaterThan(0)
  })

  it('finds a collision-free location only for new item creation', () => {
    const occupied = [{ itemId: 'a', x: 80, y: 120, width: 128, height: 128 }]
    const open = findOpenPlacement(occupied, 'wide', { x: 80, y: 120 })
    expect(open).not.toBeNull()
    expect(intersects(open, occupied[0])).toBe(false)
  })
})
