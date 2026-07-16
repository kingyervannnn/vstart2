import { describe, expect, it } from 'vitest'
import {
  chooseWorkspace,
  defaultShortcutTitle,
  findOpenPlacement,
  normalizedHttpUrl,
  placementsForShortcut,
} from './shortcut-utils.js'

const workspaces = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Personal', slug: 'personal' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Work', slug: 'work' },
]

describe('extension shortcut capture helpers', () => {
  it('prefers matching Vivaldi workspace metadata', () => {
    const bootstrap = {
      workspaces,
      state: { last_active_workspace_id: { value: workspaces[0].id } },
    }
    expect(chooseWorkspace(bootstrap, { workspaceName: 'Work' })).toEqual({
      workspace: workspaces[1],
      source: 'vivaldi',
    })
  })

  it('falls back to the database-backed active workspace', () => {
    const bootstrap = {
      workspaces,
      state: { last_active_workspace_id: { value: workspaces[1].id } },
    }
    expect(chooseWorkspace(bootstrap, { url: 'https://example.com/' })).toEqual({
      workspace: workspaces[1],
      source: 'vstart-state',
    })
  })

  it('recognizes a V Start workspace URL', () => {
    expect(chooseWorkspace({ workspaces, state: {} }, { url: 'http://localhost:3000/w/work/mail' })).toEqual({
      workspace: workspaces[1],
      source: 'vstart-tab',
    })
  })

  it('normalizes supported page URLs and removes fragments', () => {
    expect(normalizedHttpUrl('https://example.com/page#section')).toBe('https://example.com/page')
    expect(normalizedHttpUrl('vivaldi://settings/')).toBeNull()
  })

  it('uses the active tab title with a hostname fallback', () => {
    expect(defaultShortcutTitle({ title: 'A useful page' }, 'https://example.com')).toBe('A useful page')
    expect(defaultShortcutTitle({}, 'https://www.example.com/path')).toBe('example.com')
  })

  it('finds free placements independently for both layouts', () => {
    const occupied = [{
      itemId: 'taken', workspaceId: workspaces[0].id, containerKey: 'root', profile: 'wide',
      x: 736, y: 340, width: 128, height: 128,
    }]
    const result = placementsForShortcut({ placements: occupied }, workspaces[0].id)
    expect(result.wide).not.toEqual(expect.objectContaining({ x: 736, y: 340 }))
    expect(result.compact).toEqual(expect.objectContaining({ width: 104, height: 104 }))
    expect(findOpenPlacement([], 'wide')).toEqual({ x: 80, y: 120, width: 128, height: 128 })
  })
})
