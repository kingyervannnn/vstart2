import crypto from 'node:crypto'
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
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'https://alternate.example/brand.svg')).toBe(true)
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

  it('treats legacy Google favicon URLs as explicit overrides too', async () => {
    const legacy = 'https://www.google.com/s2/favicons?domain=github.com&sz=64'
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === legacy) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
      throw new Error(`Unavailable: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveShortcutIcon(client(), 'https://github.com/', legacy, { title: 'GitHub' })

    expect(result.faviconUrl).toBe(legacy)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('finds a genuinely different automatic candidate when the current source and bytes are excluded', async () => {
    const first = 'https://variants.example/current.svg'
    const second = 'https://variants.example/alternate.svg'
    const currentBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>')
    const alternateBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>')
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === 'https://variants.example/app') {
        return new Response(`<link rel="icon" type="image/svg+xml" href="${first}"><link rel="icon" type="image/svg+xml" href="${second}">`, { status: 200, headers: { 'content-type': 'text/html' } })
      }
      if (String(url) === second) return new Response(alternateBytes, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveShortcutIcon(client(), 'https://variants.example/app', null, {
      title: 'Variants',
      excludeSourceUrls: [first],
      excludeContentSha256: crypto.createHash('sha256').update(currentBytes).digest('hex'),
      allowGeneratedFallback: false,
    })

    expect(result.faviconUrl).toBe(second)
    expect(fetchMock.mock.calls.some(([url]) => String(url) === first)).toBe(false)
  })

  it('prefers a transparent brand mark over an opaque app-card icon', async () => {
    const opaque = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="#fff"/><path d="M32 32h64v64H32z" fill="#06c"/></svg>')
    const mark = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M24 64 64 24l40 40-40 40z" fill="#06c"/></svg>')
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === 'https://www.chase.com/') return new Response('<link rel="icon" type="image/svg+xml" href="/app-card.svg">', { status: 200, headers: { 'content-type': 'text/html' } })
      if (String(url) === 'https://www.chase.com/app-card.svg') return new Response(opaque, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
      if (String(url) === 'https://cdn.simpleicons.org/chase') return new Response(mark, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
      return new Response('missing', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveShortcutIcon(client(), 'https://www.chase.com/', null, { title: 'Chase' })

    expect(result.faviconUrl).toBe('https://cdn.simpleicons.org/chase')
  })
})
