import { describe, expect, it } from 'vitest'

import { normalizeRemoteUrl, publicConnectionView } from './connection-config.mjs'

describe('connection-config', () => {
  it('normalizes tailnet https urls', () => {
    expect(normalizeRemoteUrl('https://vahagns-macbook-pro.tail030d61.ts.net:8788/')).toBe(
      'https://vahagns-macbook-pro.tail030d61.ts.net:8788',
    )
  })

  it('rejects non-http schemes', () => {
    expect(() => normalizeRemoteUrl('ftp://example')).toThrow(/http/)
  })

  it('never exposes password in public view', () => {
    expect(publicConnectionView({
      mode: 'webui',
      remoteUrl: 'https://example.ts.net:8788',
      password: 'secret',
      source: 'file',
    })).toEqual({
      mode: 'webui',
      remoteUrl: 'https://example.ts.net:8788',
      hasPassword: true,
      source: 'file',
    })
  })
})
