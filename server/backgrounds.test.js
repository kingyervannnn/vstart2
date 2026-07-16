import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createBackgroundPreview } from './backgrounds.mjs'

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

describe('background previews', () => {
  it('creates a small static WebP thumbnail', async () => {
    const preview = await createBackgroundPreview(tinyPng)
    expect(preview?.mimeType).toBe('image/webp')
    const metadata = await sharp(preview.content).metadata()
    expect(metadata.width).toBe(480)
    expect(metadata.height).toBe(320)
    expect(preview.content.length).toBeLessThan(100_000)
  })

  it('rejects data that is not a readable image', async () => {
    await expect(createBackgroundPreview(Buffer.from('not an image'))).resolves.toBeNull()
  })
})
