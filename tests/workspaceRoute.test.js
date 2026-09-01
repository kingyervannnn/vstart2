import { describe, expect, it } from 'vitest'

import { shouldHoldBaseWorkspaceUrl, shouldReturnWorkspaceUrlToBase, withActiveWorkspaceState, WORKSPACE_URL_PREVIEW_MS } from '../src/lib/workspaceRoute.js'

describe('workspace route confirmation', () => {
  it('holds only the exact base URL while the option is enabled', () => {
    expect(shouldHoldBaseWorkspaceUrl('/', true)).toBe(true)
    expect(shouldHoldBaseWorkspaceUrl('/', false)).toBe(false)
    expect(shouldHoldBaseWorkspaceUrl('/w/home', true)).toBe(false)
    expect(shouldHoldBaseWorkspaceUrl('/w/home/agent/new', true)).toBe(false)
  })

  it('returns switched workspaces to the base URL but keeps explicit confirmation routes', () => {
    expect(WORKSPACE_URL_PREVIEW_MS).toBeGreaterThan(0)
    expect(shouldReturnWorkspaceUrlToBase({ enabled: true, currentWorkspaceId: 'home', nextWorkspaceId: 'work' })).toBe(true)
    expect(shouldReturnWorkspaceUrlToBase({ enabled: true, currentWorkspaceId: 'home', nextWorkspaceId: 'home' })).toBe(false)
    expect(shouldReturnWorkspaceUrlToBase({ enabled: false, currentWorkspaceId: 'home', nextWorkspaceId: 'work' })).toBe(false)
    expect(shouldReturnWorkspaceUrlToBase({ enabled: true, agentMode: true, currentWorkspaceId: 'home', nextWorkspaceId: 'work' })).toBe(false)
  })

  it('keeps the switched workspace active when the route returns to the base URL', () => {
    const bootstrap = { state: { last_active_workspace_id: { value: 'home', version: 3 } } }
    expect(withActiveWorkspaceState(bootstrap, 'work')).toEqual({
      state: { last_active_workspace_id: { value: 'work', version: 3 } },
    })
    expect(withActiveWorkspaceState(bootstrap, 'home')).toBe(bootstrap)
  })
})
