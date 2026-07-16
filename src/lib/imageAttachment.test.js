// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import {
  prepareImageAttachment,
  uploadImageForLens,
  validateImageFile,
  visualSearchUrl,
} from './imageAttachment.js'

describe('search image attachments', () => {
  it('prepares an image for preview and local agent transport', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.png', { type: 'image/png' })
    const attachment = await prepareImageAttachment(file)

    expect(attachment).toMatchObject({ name: 'sample.png', mimeType: 'image/png', size: 3 })
    expect(attachment.dataUrl).toBe('data:image/png;base64,AQID')
    expect(attachment.data).toBe('AQID')
  })

  it('rejects unsupported and oversized files', () => {
    expect(() => validateImageFile(new File(['x'], 'vector.svg', { type: 'image/svg+xml' }))).toThrow('PNG, JPEG, WebP, or GIF')
    expect(() => validateImageFile({ name: 'huge.png', type: 'image/png', size: 8 * 1024 * 1024 + 1 })).toThrow('smaller than 8 MB')
  })

  it('uploads through the image service and builds a working reverse-image URL with context', async () => {
    const file = new File(['image'], 'sample.png', { type: 'image/png' })
    const attachment = { file, name: file.name }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, public: true, url: 'https://i.example/sample.png' }),
    })

    const publicUrl = await uploadImageForLens(attachment, fetchImpl)
    const target = new URL(visualSearchUrl(publicUrl, 'find this chair'))

    expect(fetchImpl).toHaveBeenCalledWith('/image-search/upload-for-lens', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }))
    expect(target.origin + target.pathname).toBe('https://yandex.com/images/search')
    expect(target.searchParams.get('rpt')).toBe('imageview')
    expect(target.searchParams.get('url')).toBe('https://i.example/sample.png')
    expect(target.searchParams.get('text')).toBe('find this chair')
  })

  it('explains when public visual-search hosting is unavailable', async () => {
    const file = new File(['image'], 'sample.png', { type: 'image/png' })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, needsPublicUrl: true, url: '/lens-image/local.png' }),
    })

    await expect(uploadImageForLens({ file, name: file.name }, fetchImpl)).rejects.toThrow('public image hosting')
  })
})
