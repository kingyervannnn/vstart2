import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) },
}))

import { predictShortcutTitle, titleFromHtml, titleFromUrl } from './shortcut-metadata.mjs'

afterEach(() => vi.unstubAllGlobals())

describe('shortcut title prediction', () => {
  it('prefers the concise site name and decodes HTML entities', () => {
    const html = '<html><head><title>Long Page Title</title><meta content="Acme &amp; Co" property="og:site_name"></head></html>'
    expect(titleFromHtml(html)).toBe('Acme & Co')
  })

  it('uses a readable hostname when page metadata cannot be retrieved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await predictShortcutTitle('https://my-useful-tool.example/path')).toEqual({ title: 'My Useful Tool', source: 'hostname' })
  })

  it('retrieves the page title when no site-name metadata exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<title>Example Dashboard</title>', { headers: { 'content-type': 'text/html' } })))
    expect(await predictShortcutTitle('https://example.com/dashboard')).toEqual({ title: 'Example Dashboard', source: 'page' })
  })

  it('turns host labels into shortcut names', () => {
    expect(titleFromUrl('https://www.digital-ocean.example')).toBe('Digital Ocean')
  })
})
