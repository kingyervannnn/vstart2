import { describe, expect, it } from 'vitest'
import { clampDockGeometry, findShortcutMatches, parseShortcutSearch, shouldDropSuggestionsUp, shouldHideWorkspaceSwitcher } from '../src/lib/searchDock.js'

describe('search dock placement', () => {
  it('keeps the dock fully inside its normalized rail', () => {
    expect(clampDockGeometry({ x: 0, y: 1, width: 2 })).toEqual({ x: 0.47, y: 0.94, width: 0.94 })
  })

  it('drops suggestions down near the top and up near the bottom', () => {
    expect(shouldDropSuggestionsUp({ top: 100, bottom: 170 }, 900, 7)).toBe(false)
    expect(shouldDropSuggestionsUp({ top: 730, bottom: 800 }, 900, 7)).toBe(true)
  })

  it('hides workspace buttons only when suggestions open on the same side', () => {
    expect(shouldHideWorkspaceSwitcher('top', true, true)).toBe(true)
    expect(shouldHideWorkspaceSwitcher('top', false, true)).toBe(false)
    expect(shouldHideWorkspaceSwitcher('bottom', false, true)).toBe(true)
    expect(shouldHideWorkspaceSwitcher('bottom', true, true)).toBe(false)
    expect(shouldHideWorkspaceSwitcher('bottom', false, false)).toBe(false)
  })

  it('recognizes @ as a shortcut-only scope without changing ordinary queries', () => {
    expect(parseShortcutSearch('@ mail')).toEqual({ shortcutOnly: true, query: 'mail' })
    expect(parseShortcutSearch('mail')).toEqual({ shortcutOnly: false, query: 'mail' })
  })

  it('ranks current-workspace shortcuts first and includes folder and URL matches', () => {
    const workspaces = [{ id: 'home', name: 'Home' }, { id: 'work', name: 'Work' }]
    const items = [
      { id: 'folder', workspaceId: 'work', kind: 'folder', title: 'Communication' },
      { id: 'work-mail', workspaceId: 'work', parentFolderId: 'folder', kind: 'shortcut', title: 'Mail', url: 'https://mail.example.com' },
      { id: 'home-mail', workspaceId: 'home', kind: 'shortcut', title: 'Webmail', url: 'https://inbox.example.com' },
    ]

    expect(findShortcutMatches({ items, workspaces, activeWorkspaceId: 'home', query: 'mail' }).map((result) => result.item.id)).toEqual(['home-mail', 'work-mail'])
    expect(findShortcutMatches({ items, workspaces, activeWorkspaceId: 'home', query: 'communication' }).map((result) => result.item.id)).toEqual(['work-mail'])
    expect(findShortcutMatches({ items, workspaces, activeWorkspaceId: 'home', query: 'inbox' }).map((result) => result.item.id)).toEqual(['home-mail'])
  })
})
