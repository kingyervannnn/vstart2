import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) },
}))

import { resolveShortcutIcon } from './icons.mjs'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function client() {
  return { query: vi.fn(async () => ({ rows: [{ id: 'asset-1' }] })) }
}

afterEach(() => vi.unstubAllGlobals())

describe('shortcut image URL resolution', () => {
  it('uses the override webpage favicon before falling back to the destination', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === 'https://alternate.example/logo-page') {
        return new Response('<html><body>Not an image</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
      }
      if (String(url) === 'https://alternate.example/favicon.ico') {
        return new Response(png, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveShortcutIcon(client(), 'https://destination.example/app', 'https://alternate.example/logo-page')

    expect(result).toEqual({ iconAssetId: 'asset-1', faviconUrl: 'https://alternate.example/favicon.ico', warning: null })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('recognizes image bytes when a host returns a generic MIME type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(png, { status: 200, headers: { 'content-type': 'application/octet-stream' } })))
    const database = client()

    const result = await resolveShortcutIcon(database, 'https://destination.example/app', 'https://images.example/icon')

    expect(result.faviconUrl).toBe('https://images.example/icon')
    expect(database.query.mock.calls[0][1][1]).toBe('image/png')
  })
})
