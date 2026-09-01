import { describe, expect, it } from 'vitest'

import { shouldHoldBaseWorkspaceUrl } from '../src/lib/workspaceRoute.js'

describe('workspace route confirmation', () => {
  it('holds only the exact base URL while the option is enabled', () => {
    expect(shouldHoldBaseWorkspaceUrl('/', true)).toBe(true)
    expect(shouldHoldBaseWorkspaceUrl('/', false)).toBe(false)
    expect(shouldHoldBaseWorkspaceUrl('/w/home', true)).toBe(false)
    expect(shouldHoldBaseWorkspaceUrl('/w/home/agent/new', true)).toBe(false)
  })
})
