import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) },
}))

import { generatedShortcutSvg, resolveShortcutIcon, serviceIconSlugs } from './icons.mjs'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M0 0h128v128H0z"/></svg>')
const tinyIco = Buffer.alloc(22)
tinyIco.writeUInt16LE(1, 2)
tinyIco.writeUInt16LE(1, 4)
tinyIco[6] = 16
tinyIco[7] = 16

function client() {
  return { query: vi.fn(async () => ({ rows: [{ id: 'asset-1' }] })) }
}

afterEach(() => vi.unstubAllGlobals())

describe('shortcut image URL resolution', () => {
  it('uses the override webpage favicon before falling back to the destination', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === 'https://alternate.example/logo-page') {
        return new Response('<html><head><link rel="icon" type="image/svg+xml" sizes="any" href="/brand.svg"></head></html>', { status: 200, headers: { 'content-type': 'text/html' } })
      }
      if (String(url) === 'https://alternate.example/brand.svg') {
        return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveShortcutIcon(client(), 'https://destination.example/app', 'https://alternate.example/logo-page')

    expect(result).toEqual({ iconAssetId: 'asset-1', faviconUrl: 'https://alternate.example/brand.svg', warning: null })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('recognizes image bytes when a host returns a generic MIME type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(png, { status: 200, headers: { 'content-type': 'application/octet-stream' } })))
    const database = client()

    const result = await resolveShortcutIcon(database, 'https://destination.example/app', 'https://images.example/icon')

    expect(result.faviconUrl).toBe('https://images.example/icon')
    expect(database.query.mock.calls[0][1][1]).toBe('image/png')
  })

  it('generates stable, distinct SVG previews from shortcut identity', () => {
    const first = generatedShortcutSvg('Local Admin', 'http://localhost:4010/admin').toString('utf8')
    const repeated = generatedShortcutSvg('Local Admin', 'http://localhost:4010/admin').toString('utf8')
    const other = generatedShortcutSvg('Local Admin', 'http://localhost:4020/admin').toString('utf8')

    expect(first).toBe(repeated)
    expect(first).not.toBe(other)
    expect(first).toContain('>LA</text>')
    expect(first).toContain('viewBox="0 0 256 256"')
  })

  it('derives curated-catalog slugs from service titles and local paths', () => {
    expect(serviceIconSlugs('YouTube - Videos', 'https://www.youtube.com/watch')).toEqual(['youtube'])
    expect(serviceIconSlugs('Dashboard', 'http://localhost:3001/immich/photos')).toEqual(['immich'])
  })

  it('stores a generated database asset when a private service has no catalog icon', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })))
    const database = client()

    const result = await resolveShortcutIcon(database, 'http://localhost:4317/admin', null, { title: 'Local Admin' })

    expect(result.faviconUrl).toBeNull()
    expect(database.query.mock.calls[0][1][1]).toBe('image/svg+xml')
    expect(database.query.mock.calls[0][1][4].toString('utf8')).toContain('>LA</text>')
  })

  it('does not stretch a tiny discovered favicon across the shortcut tile', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === 'https://small.example/app') {
        return new Response('<link rel="icon" sizes="16x16" href="/favicon.ico">', { status: 200, headers: { 'content-type': 'text/html' } })
      }
      if (String(url) === 'https://small.example/favicon.ico') {
        return new Response(tinyIco, { status: 200, headers: { 'content-type': 'image/x-icon' } })
      }
      return new Response('missing', { status: 404 })
    }))
    const database = client()

    const result = await resolveShortcutIcon(database, 'https://small.example/app', null, { title: 'Small Service' })

    expect(result.faviconUrl).toBeNull()
    expect(database.query.mock.calls[0][1][1]).toBe('image/svg+xml')
  })

  it('replaces legacy Google favicon override URLs with a higher-quality catalog match', async () => {
    const legacy = 'https://www.google.com/s2/favicons?domain=github.com&sz=64'
    const catalog = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/github.svg'
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === catalog) return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
      throw new Error(`Unavailable: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveShortcutIcon(client(), 'https://github.com/', legacy, { title: 'GitHub' })

    expect(result.faviconUrl).toBe(catalog)
    expect(fetchMock.mock.calls.some(([url]) => String(url) === legacy)).toBe(false)
  })
})
