import dns from 'node:dns/promises'
import net from 'node:net'

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

export async function assertPublicHttpUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol')
  if (url.username || url.password) throw new Error('Credentials are not allowed in URLs')
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('URL resolves to a non-public address')
  }
  return url
}
