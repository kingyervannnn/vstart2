import { assertPublicHttpUrl } from './public-url.mjs'

const MAX_PAGE_BYTES = 256 * 1024
const ENTITY_VALUES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match } catch { return match }
    }
    return ENTITY_VALUES[entity.toLowerCase()] ?? match
  })
}

function cleanTitle(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function attributesFromTag(tag) {
  const attributes = {}
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let match
  while ((match = pattern.exec(tag))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

export function titleFromHtml(html) {
  const metadata = [...String(html).matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributesFromTag(tag))
  const findMeta = (attribute, value) => metadata.find((entry) => entry[attribute]?.toLowerCase() === value)?.content
  const titleTag = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return cleanTitle(
    findMeta('property', 'og:site_name') ||
    findMeta('name', 'application-name') ||
    findMeta('property', 'og:title') ||
    findMeta('name', 'twitter:title') ||
    titleTag,
  )
}

export function titleFromUrl(value) {
  const { hostname } = new URL(value)
  const withoutWww = hostname.replace(/^www\./i, '')
  if (withoutWww === 'localhost') return 'Localhost'
  const label = withoutWww.split('.')[0] || withoutWww
  return cleanTitle(label.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()))
}

async function readLimitedText(response) {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_PAGE_BYTES) throw new Error('Page is too large')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel()
      throw new Error('Page is too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
}

async function fetchPageTitle(source) {
  let current = source
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const url = await assertPublicHttpUrl(current)
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'VStart2/0.1 shortcut-title-resolver',
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Page redirect has no location')
      current = new URL(location, url).toString()
      continue
    }
    if (!response.ok) throw new Error(`Page returned ${response.status}`)
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('Destination did not return a webpage')
    }
    return titleFromHtml(await readLimitedText(response))
  }
  throw new Error('Too many page redirects')
}

export async function predictShortcutTitle(value) {
  const fallback = titleFromUrl(value)
  try {
    return { title: await fetchPageTitle(value) || fallback, source: 'page' }
  } catch {
    return { title: fallback, source: 'hostname' }
  }
}
