import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { HttpError } from './http.mjs'

const MAX_ICON_BYTES = 768 * 1024
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'])

function isPrivateV4(address) {
  const parts = address.split('.').map(Number)
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] >= 224)
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) return isPrivateV4(address)
  if (!net.isIPv6(address)) return true
  const normalized = address.toLowerCase()
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
    normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.')
}

async function assertPublicUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported image protocol')
  if (url.username || url.password) throw new Error('Credentials are not allowed in image URLs')
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Image URL resolves to a non-public address')
  }
  return url
}

async function fetchPublicImage(source) {
  let current = source
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const url = await assertPublicUrl(current)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    let response
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'VStart2/0.1 shortcut-icon-resolver', accept: 'image/*' },
      })
    } finally {
      clearTimeout(timeout)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Icon redirect has no location')
      current = new URL(location, url).toString()
      continue
    }
    if (!response.ok) throw new Error(`Icon source returned ${response.status}`)
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_ICON_BYTES) throw new Error('Icon is too large')
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_MIME.has(mimeType)) throw new Error('Icon source did not return a supported image')
    const content = Buffer.from(await response.arrayBuffer())
    if (!content.length || content.length > MAX_ICON_BYTES) throw new Error('Icon is empty or too large')
    return { sourceUrl: url.toString(), mimeType, content }
  }
  throw new Error('Too many icon redirects')
}

async function saveIcon(client, image) {
  const sha256 = crypto.createHash('sha256').update(image.content).digest('hex')
  const id = crypto.randomUUID()
  const result = await client.query(`
    INSERT INTO assets (id, kind, mime_type, sha256, byte_length, content)
    VALUES ($1, 'shortcut_icon', $2, $3, $4, $5)
    ON CONFLICT (kind, sha256) DO UPDATE SET sha256 = EXCLUDED.sha256
    RETURNING id
  `, [id, image.mimeType, sha256, image.content.length, image.content])
  return result.rows[0].id
}

export async function resolveShortcutIcon(client, destinationUrl, overrideUrl) {
  let warning = null
  if (overrideUrl) {
    try {
      const image = await fetchPublicImage(overrideUrl)
      return { iconAssetId: await saveIcon(client, image), faviconUrl: image.sourceUrl, warning }
    } catch (error) {
      warning = `Shortcut image URL could not be used: ${error.message}`
    }
  }

  const destination = new URL(destinationUrl)
  const candidates = [
    new URL('/favicon.ico', destination).toString(),
    `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(destination.toString())}&sz=128`,
  ]
  for (const candidate of candidates) {
    try {
      const image = await fetchPublicImage(candidate)
      return { iconAssetId: await saveIcon(client, image), faviconUrl: image.sourceUrl, warning }
    } catch {
      // The generated client fallback remains available when discovery fails.
    }
  }
  return { iconAssetId: null, faviconUrl: null, warning }
}

export async function insertUploadedIcon(client, mimeType, content) {
  if (!ALLOWED_MIME.has(mimeType)) throw new HttpError(400, 'Unsupported icon image type')
  if (!content.length || content.length > MAX_ICON_BYTES) throw new HttpError(400, 'Icon is empty or too large')
  return saveIcon(client, { mimeType, content })
}
