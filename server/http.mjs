export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  })
  response.end(payload)
}

export function sendEmpty(response, status = 204) {
  response.writeHead(status, { 'cache-control': 'no-store' })
  response.end()
}

export async function readJson(request, maxBytes = 1_048_576) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new HttpError(413, 'Request body is too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON')
  }
}

export async function readBuffer(request, maxBytes) {
  const declaredLength = Number(request.headers['content-length'] || 0)
  if (declaredLength > maxBytes) throw new HttpError(413, `Individual backgrounds must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB`)
  if (declaredLength > 0) {
    const content = Buffer.allocUnsafe(declaredLength)
    let offset = 0
    for await (const chunk of request) {
      offset += chunk.length
      if (offset > maxBytes || offset > declaredLength) throw new HttpError(413, 'Request body is too large')
      chunk.copy(content, offset - chunk.length)
    }
    return content.subarray(0, offset)
  }

  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new HttpError(413, `Individual backgrounds must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

export function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern)
  return match ? match.slice(1).map(decodeURIComponent) : null
}

export function handleError(response, error) {
  if (response.headersSent) return response.end()
  if (error?.status) {
    return sendJson(response, error.status, {
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    })
  }
  if (error?.code === '23P01') {
    return sendJson(response, 409, {
      error: 'That placement overlaps another shortcut or folder.',
      code: 'PLACEMENT_COLLISION',
    })
  }
  if (error?.code === '23505') {
    return sendJson(response, 409, { error: 'That value already exists.', code: 'CONFLICT' })
  }
  if (error?.code === '23503' || error?.code === '23514') {
    return sendJson(response, 400, { error: 'The requested change is not valid.', code: 'INVALID_MUTATION' })
  }
  console.error(error)
  return sendJson(response, 500, { error: 'Unexpected server error' })
}
