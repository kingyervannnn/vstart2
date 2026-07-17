import { describe, expect, it, vi } from 'vitest'
import { backgroundLayerVariables, bootstrapBackgroundId, preloadBackgroundAsset, preloadBootstrapBackground, startupBackgroundUrl } from './backgroundStartup.js'

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

  it('keeps the decoded preview visible until the full image is ready', () => {
    expect(backgroundLayerVariables('asset-id')).toEqual({
      '--app-background-image': 'url(/api/assets/asset-id/preview)',
      '--app-background-full-image': 'url(/api/assets/asset-id)',
      '--app-background-full-opacity': 0,
    })
    expect(backgroundLayerVariables('asset-id', { fullReady: true })['--app-background-full-opacity']).toBe(1)
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

  it('can preload a newly selected background before a crossfade', async () => {
    const loaded = []
    class FakeImage {
      set src(value) {
        loaded.push(value)
        this.onload()
      }
    }

    await expect(preloadBackgroundAsset('next-background', FakeImage)).resolves.toBe('next-background')
    expect(loaded).toEqual(['/api/assets/next-background/preview'])
  })

  it('can preload and decode the full image before a rotation crossfade', async () => {
    const loaded = []
    class FakeImage {
      decode() {
        loaded.push('decoded')
        return Promise.resolve()
      }

      set src(value) {
        loaded.push(value)
        this.onload()
      }
    }

    await expect(preloadBackgroundAsset('next-background', FakeImage, 50, { fullResolution: true })).resolves.toBe('next-background')
    expect(loaded).toEqual(['/api/assets/next-background', 'decoded'])
  })
})
