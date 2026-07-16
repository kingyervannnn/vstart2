async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  })
  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || `Music request failed (${response.status})`)
  return body
}

const sourceQuery = (sourceId) => sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ''

export const musicApi = {
  state: (sourceId, signal) => request(`/api/music/state${sourceQuery(sourceId)}`, { signal }),
  control: (sourceId, action) => request('/api/music/control', { method: 'POST', body: JSON.stringify({ sourceId, action }) }),
  queue: (sourceId, signal) => request(`/api/music/queue${sourceQuery(sourceId)}`, { signal }),
  selectQueueItem: (sourceId, index) => request('/api/music/queue', { method: 'PATCH', body: JSON.stringify({ sourceId, index }) }),
  addQueueItem: (sourceId, videoId, insertPosition = 'INSERT_AT_END') => request('/api/music/queue', { method: 'POST', body: JSON.stringify({ sourceId, videoId, insertPosition }) }),
  search: (sourceId, query, signal) => request('/api/music/search', { method: 'POST', body: JSON.stringify({ sourceId, query }), signal }),
}
