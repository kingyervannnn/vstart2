import { describe, expect, it, vi } from 'vitest'
import { backgroundImageLayers, bootstrapBackgroundId, preloadBootstrapBackground, startupBackgroundUrl } from './backgroundStartup.js'

const bootstrap = {
  settings: { document: { backgrounds: { workspaceSpecific: true, globalAssetId: 'global' } } },
  state: { last_active_workspace_id: { value: 'home-id' } },
  workspaces: [
    { id: 'home-id', slug: 'home', backgroundAssetId: 'home-background' },
    { id: 'work-id', slug: 'work', backgroundAssetId: 'work-background' },
  ],
}

describe('background startup', () => {
  it('resolves the routed workspace before the last active workspace', () => {
    expect(bootstrapBackgroundId(bootstrap, '/w/work')).toBe('work-background')
    expect(bootstrapBackgroundId(bootstrap, '/')).toBe('home-background')
  })

  it('layers the full image over its lightweight preview', () => {
    expect(backgroundImageLayers('asset-id')).toBe('url(/api/assets/asset-id), url(/api/assets/asset-id/preview)')
    expect(startupBackgroundUrl('/w/work')).toBe('/api/backgrounds/startup?path=%2Fw%2Fwork')
  })

  it('waits for the preview before revealing the app', async () => {
    class FakeImage {
      set src(value) {
        expect(value).toBe('/api/assets/work-background/preview')
        queueMicrotask(() => this.onload())
      }
    }
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    await expect(preloadBootstrapBackground(bootstrap, '/w/work', FakeImage, 50)).resolves.toBe('work-background')
    expect(timeoutSpy).toHaveBeenCalled()
    timeoutSpy.mockRestore()
  })
})
