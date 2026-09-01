import crypto from 'node:crypto'
import sharp from 'sharp'
import { HttpError } from './http.mjs'
import { assertPublicHttpUrl } from './public-url.mjs'

const MAX_ICON_BYTES = 768 * 1024
const MAX_PAGE_BYTES = 256 * 1024
const MAX_MANIFEST_BYTES = 128 * 1024
const MIN_FULL_TILE_SIZE = 64
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'])
const GENERATED_PALETTES = [
  ['#3156d8', '#142660'],
  ['#b43b68', '#4b1630'],
  ['#168c79', '#073f3a'],
  ['#b76a27', '#542812'],
  ['#7357d8', '#302264'],
  ['#31768c', '#123641'],
  ['#9d4545', '#431b21'],
  ['#56722e', '#243713'],
]

function detectedImageMime(content, declaredMime) {
  if (ALLOWED_MIME.has(declaredMime)) return declaredMime
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(content.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (content.length >= 4 && content[0] === 0 && content[1] === 0 && content[2] === 1 && content[3] === 0) return 'image/x-icon'
  if (content.subarray(4, 12).toString('ascii').startsWith('ftypavi')) return 'image/avif'
  const text = content.subarray(0, Math.min(content.length, 512)).toString('utf8').trimStart().toLowerCase()
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'image/svg+xml'
  return null
}

function attributesFromTag(tag) {
  const attributes = {}
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let match
  while ((match = pattern.exec(tag))) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  return attributes
}

function declaredSize(value) {
  if (String(value || '').toLowerCase().split(/\s+/).includes('any')) return Number.POSITIVE_INFINITY
  return Math.max(0, ...[...String(value || '').matchAll(/(\d+)x(\d+)/gi)].map((match) => Math.min(Number(match[1]), Number(match[2]))))
}

function pageIconCandidates(html, pageUrl) {
  const candidates = []
  let manifestUrl = null
  for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const attributes = attributesFromTag(tag)
    const rel = String(attributes.rel || '').toLowerCase().split(/\s+/)
    if (rel.includes('manifest') && attributes.href) manifestUrl = new URL(attributes.href, pageUrl).toString()
    if ((!rel.includes('icon') && !rel.some((value) => value.startsWith('apple-touch-icon'))) || !attributes.href) continue
    candidates.push({
      url: new URL(attributes.href, pageUrl).toString(),
      declaredSize: declaredSize(attributes.sizes),
      vector: String(attributes.type || '').toLowerCase() === 'image/svg+xml' || /\.svg(?:$|[?#])/i.test(attributes.href),
      source: rel.some((value) => value.startsWith('apple-touch-icon')) ? 'apple-touch-icon' : 'page-icon',
    })
  }
  return { candidates, manifestUrl }
}

async function readLimitedResponse(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > maxBytes) throw new Error('Resource is too large')
  const content = Buffer.from(await response.arrayBuffer())
  if (content.length > maxBytes) throw new Error('Resource is too large')
  return content
}

async function fetchPublicResource(source, { accept, maxBytes }) {
  let current = source
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const url = await assertPublicHttpUrl(current)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    let response
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'VStart2/0.1 shortcut-icon-resolver', accept },
      })
    } finally {
      clearTimeout(timeout)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Resource redirect has no location')
      current = new URL(location, url).toString()
      continue
    }
    if (!response.ok) throw new Error(`Resource returned ${response.status}`)
    return { sourceUrl: url.toString(), response, content: await readLimitedResponse(response, maxBytes) }
  }
  throw new Error('Too many resource redirects')
}

async function imageMetrics(content, mimeType) {
  if (mimeType === 'image/x-icon' || mimeType === 'image/vnd.microsoft.icon') {
    if (content.length < 22) return { vector: false, width: 0, height: 0, quality: 0 }
    const count = Math.min(content.readUInt16LE(4), Math.floor((content.length - 6) / 16))
    const sizes = Array.from({ length: count }, (_, index) => {
      const offset = 6 + index * 16
      return Math.min(content[offset] || 256, content[offset + 1] || 256)
    })
    const quality = Math.max(0, ...sizes)
    return { vector: false, width: quality, height: quality, quality, markLike: quality >= 32 }
  }
  try {
    const pipeline = sharp(content, { animated: true })
    const [metadata, stats] = await Promise.all([pipeline.metadata(), sharp(content, { animated: true }).stats()])
    const width = Number(metadata.width) || 0
    const height = Number(metadata.pageHeight || metadata.height) || 0
    const alpha = stats.channels[3]
    const visualCoverage = alpha ? alpha.mean / 255 : 1
    const vector = mimeType === 'image/svg+xml'
    return {
      vector,
      width: vector ? null : width,
      height: vector ? null : height,
      quality: vector ? Number.POSITIVE_INFINITY : Math.min(width, height),
      visualCoverage,
      markLike: Boolean(alpha && visualCoverage < 0.9),
    }
  } catch {
    return { vector: mimeType === 'image/svg+xml', width: 0, height: 0, quality: 0, visualCoverage: 1, markLike: false }
  }
}

export async function inspectIconQuality(content, mimeType) {
  return imageMetrics(content, mimeType)
}

async function fetchPublicImage(source) {
  const resource = await fetchPublicResource(source, { accept: 'image/*', maxBytes: MAX_ICON_BYTES })
  if (!resource.content.length) throw new Error('Icon is empty')
  const declaredMime = (resource.response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const mimeType = detectedImageMime(resource.content, declaredMime)
  if (!mimeType) throw new Error('Icon source did not return a supported image')
  return { sourceUrl: resource.sourceUrl, mimeType, content: resource.content, ...(await imageMetrics(resource.content, mimeType)) }
}

async function discoverPageIcons(source) {
  const page = await fetchPublicResource(source, { accept: 'text/html,application/xhtml+xml', maxBytes: MAX_PAGE_BYTES })
  const contentType = (page.response.headers.get('content-type') || '').toLowerCase()
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return []
  const discovered = pageIconCandidates(page.content.toString('utf8'), page.sourceUrl)
  const candidates = [...discovered.candidates]
  if (discovered.manifestUrl) {
    try {
      const manifest = await fetchPublicResource(discovered.manifestUrl, { accept: 'application/manifest+json,application/json', maxBytes: MAX_MANIFEST_BYTES })
      const parsed = JSON.parse(manifest.content.toString('utf8'))
      for (const icon of Array.isArray(parsed.icons) ? parsed.icons : []) {
        if (!icon?.src) continue
        candidates.push({
          url: new URL(icon.src, manifest.sourceUrl).toString(),
          declaredSize: declaredSize(icon.sizes),
          vector: String(icon.type || '').toLowerCase() === 'image/svg+xml' || /\.svg(?:$|[?#])/i.test(icon.src),
          source: 'manifest',
        })
      }
    } catch {
      // A broken or protected manifest should not prevent other icon sources.
    }
  }
  return candidates.sort((left, right) => Number(right.vector) - Number(left.vector) || right.declaredSize - left.declaredSize)
}

function slugifyIconName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export function serviceIconSlugs(title, destinationUrl) {
  const url = new URL(destinationUrl)
  const hostParts = url.hostname.toLowerCase().replace(/^www\./, '').split('.')
  const hostname = hostParts.length > 1 ? hostParts[hostParts.length - 2] : hostParts[0]
  const titleHead = String(title || '').split(/\s+[|–—:]\s+|\s+-\s+/)[0]
  const pathHead = ['localhost', '127', '0', '10', '192', '172'].includes(hostParts[0])
    ? url.pathname.split('/').filter(Boolean)[0]
    : ''
  return [...new Set([titleHead, hostname, pathHead].map(slugifyIconName).filter((value) => value && !['home', 'login', 'dashboard', 'localhost'].includes(value)))].slice(0, 2)
}

function catalogCandidates(title, destinationUrl) {
  const url = new URL(destinationUrl)
  const identity = `${String(title).toLowerCase()} ${url.hostname.toLowerCase()}`
  const aliases = []
  if (identity.includes('chase')) aliases.push('chase')
  if (identity.includes('outlook') || (identity.includes('microsoft') && identity.includes('mail'))) aliases.push('microsoft-outlook')
  if (identity.includes('entra')) aliases.push('microsoft-azure')
  return [...new Set([...aliases, ...serviceIconSlugs(title, destinationUrl)])].flatMap((slug) => [
    { url: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${slug}.svg`, source: 'dashboard-icons' },
    { url: `https://cdn.simpleicons.org/${slug.replaceAll('-', '')}`, source: 'simple-icons' },
  ])
}

function conventionalCandidates(value) {
  const url = new URL(value)
  return ['/favicon.svg', '/apple-touch-icon.png', '/favicon-192x192.png', '/favicon.png', '/favicon.ico']
    .map((path) => ({ url: new URL(path, url).toString(), source: 'conventional' }))
}

function googleCandidate(value) {
  return { url: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(new URL(value).toString())}&sz=256`, source: 'google' }
}

function isObviouslyPrivateDestination(value) {
  const hostname = new URL(value).hostname.toLowerCase()
  return hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal') ||
    /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname === '::1'
}

function escapeXml(value) {
  return [...String(value)].filter((character) => {
    const code = character.codePointAt(0)
    return code === 9 || code === 10 || code === 13 || code >= 32
  }).join('')
    .replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}

function generatedInitials(title, destinationUrl) {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toLocaleUpperCase()
  if (words[0]?.length >= 2 && words[0].toLowerCase() !== 'localhost') return words[0].slice(0, 2).toLocaleUpperCase()
  const url = new URL(destinationUrl)
  const path = url.pathname.split('/').filter(Boolean)[0]
  if (path?.length >= 2) return path.slice(0, 2).toLocaleUpperCase()
  const host = url.hostname.replace(/^www\./, '').split('.')[0]
  return (host.slice(0, 2) || '?').toLocaleUpperCase()
}

export function generatedShortcutSvg(title, destinationUrl) {
  const seed = crypto.createHash('sha256').update(`${String(title).trim()}\n${new URL(destinationUrl).toString()}`).digest()
  const [start, end] = GENERATED_PALETTES[seed[0] % GENERATED_PALETTES.length]
  const angle = 20 + (seed[1] % 7) * 20
  const initials = escapeXml(generatedInitials(title, destinationUrl))
  const motif = seed[2] % 3
  const decoration = motif === 0
    ? '<circle cx="214" cy="42" r="82" fill="white" opacity=".1"/><circle cx="28" cy="230" r="64" fill="white" opacity=".06"/>'
    : motif === 1
      ? '<path d="M-20 202L202-20h76L56 202z" fill="white" opacity=".075"/><path d="M72 276L276 72v70L142 276z" fill="white" opacity=".055"/>'
      : '<rect x="166" y="-18" width="112" height="112" rx="34" transform="rotate(18 222 38)" fill="white" opacity=".09"/><rect x="-26" y="178" width="104" height="104" rx="32" transform="rotate(-14 26 230)" fill="white" opacity=".055"/>'
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${angle} .5 .5)"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="256" height="256" rx="42" fill="url(#g)"/>${decoration}<rect x="14" y="14" width="228" height="228" rx="34" fill="none" stroke="white" stroke-opacity=".1" stroke-width="2"/><text x="128" y="151" text-anchor="middle" fill="white" font-family="ui-rounded, system-ui, -apple-system, sans-serif" font-size="92" font-weight="760" letter-spacing="-5">${initials}</text></svg>`)
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

async function storedResult(client, image, warning = null) {
  return { iconAssetId: await saveIcon(client, image), faviconUrl: image.sourceUrl || null, warning }
}

export async function generateShortcutIcon(client, title, destinationUrl) {
  return storedResult(client, { mimeType: 'image/svg+xml', content: generatedShortcutSvg(title, destinationUrl), sourceUrl: null })
}

function contentSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function candidateIsExcluded(image, excludedContentSha256) {
  return Boolean(excludedContentSha256 && contentSha256(image.content) === excludedContentSha256)
}

function usableTileImage(image) {
  return image.vector || image.quality >= MIN_FULL_TILE_SIZE || (image.markLike && image.quality >= 32)
}

export function shortcutIconPreference(image) {
  return Number(image.markLike) * 1_000_000 + Number(image.vector) * 100_000 + Math.min(Number(image.quality) || 0, 4096)
}

async function bestFetchedIcon(candidates, { excludedUrls = new Set(), excludedContentSha256 = null } = {}) {
  const unique = [...new Map(candidates
    .filter((candidate) => !excludedUrls.has(candidate.url))
    .map((candidate) => [candidate.url, candidate])).values()]
  let bestLowQuality = null
  for (const candidate of unique) {
    try {
      const image = await fetchPublicImage(candidate.url)
      if (candidateIsExcluded(image, excludedContentSha256)) continue
      image.source = candidate.source
      if (usableTileImage(image)) return { image, lowQuality: bestLowQuality }
      if (!bestLowQuality || image.quality > bestLowQuality.quality) bestLowQuality = image
    } catch {
      // Candidate failures are expected; continue through the resolver chain.
    }
  }
  return { image: null, lowQuality: bestLowQuality }
}

async function bestFetchedIconParallel(candidates, { excludedUrls = new Set(), excludedContentSha256 = null } = {}) {
  const unique = [...new Map(candidates
    .filter((candidate) => !excludedUrls.has(candidate.url))
    .map((candidate) => [candidate.url, candidate])).values()]
  const images = await Promise.all(unique.map(async (candidate) => {
    try {
      const image = await fetchPublicImage(candidate.url)
      if (candidateIsExcluded(image, excludedContentSha256)) return null
      return { ...image, source: candidate.source }
    } catch {
      return null
    }
  }))
  const available = images.filter(Boolean)
  const preferred = available.filter(usableTileImage).sort((left, right) => shortcutIconPreference(right) - shortcutIconPreference(left))[0] || null
  return {
    image: preferred,
    lowQuality: available.filter((image) => !usableTileImage(image))
      .sort((left, right) => right.quality - left.quality)[0] || null,
  }
}

async function resolveAutomaticIcon(destinationUrl, title, { excludeSourceUrls = [], excludeContentSha256 = null } = {}) {
  const excludedUrls = new Set(excludeSourceUrls.filter(Boolean))
  const exclusions = { excludedUrls, excludedContentSha256: excludeContentSha256 }
  let lowQuality = null
  let discoveredImage = null
  let privateDestination = isObviouslyPrivateDestination(destinationUrl)
  if (!privateDestination) {
    try {
      const discovered = await bestFetchedIconParallel(await discoverPageIcons(destinationUrl), exclusions)
      discoveredImage = discovered.image
      if (discoveredImage?.markLike) return discoveredImage
      lowQuality = discovered.lowQuality
    } catch (error) {
      privateDestination = String(error?.message || '').includes('non-public address')
      // Private hosts and pages that deny metadata requests use catalog or generated fallbacks.
    }
  }

  const catalog = await bestFetchedIconParallel(catalogCandidates(title, destinationUrl), exclusions)
  if (catalog.image && (!discoveredImage || shortcutIconPreference(catalog.image) > shortcutIconPreference(discoveredImage))) return catalog.image
  if (discoveredImage) return discoveredImage
  if (!lowQuality || (catalog.lowQuality?.quality || 0) > lowQuality.quality) lowQuality = catalog.lowQuality

  if (!privateDestination) {
    const conventional = await bestFetchedIconParallel(conventionalCandidates(destinationUrl), exclusions)
    if (conventional.image) return conventional.image
    if (!lowQuality || (conventional.lowQuality?.quality || 0) > lowQuality.quality) lowQuality = conventional.lowQuality

    const google = await bestFetchedIcon([googleCandidate(destinationUrl)], exclusions)
    if (google.image) return google.image
  }
  return lowQuality
}

export async function resolveShortcutIcon(client, destinationUrl, overrideUrl, {
  title = '',
  excludeSourceUrls = [],
  excludeContentSha256 = null,
  allowGeneratedFallback = true,
  minimumPreference = Number.NEGATIVE_INFINITY,
} = {}) {
  let warning = null
  if (overrideUrl) {
    try {
      const image = await fetchPublicImage(overrideUrl)
      return storedResult(client, image)
    } catch (error) {
      warning = `Shortcut image URL could not be used: ${error.message}`
    }
    try {
      const image = await resolveAutomaticIcon(overrideUrl, title)
      if (image) return storedResult(client, image)
    } catch {
      // Continue with the shortcut destination before generating a fallback.
    }
  }

  const image = await resolveAutomaticIcon(destinationUrl, title, { excludeSourceUrls, excludeContentSha256 })
  if (image && usableTileImage(image) && shortcutIconPreference(image) > minimumPreference) return storedResult(client, image, warning)
  if (!allowGeneratedFallback) return null
  return generateShortcutIcon(client, title, destinationUrl)
}

export async function insertUploadedIcon(client, mimeType, content) {
  if (!ALLOWED_MIME.has(mimeType)) throw new HttpError(400, 'Unsupported icon image type')
  if (!content.length || content.length > MAX_ICON_BYTES) throw new HttpError(400, 'Icon is empty or too large')
  return saveIcon(client, { mimeType, content })
}
