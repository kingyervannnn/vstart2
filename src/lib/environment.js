async function request(path, options = {}) {
  const response = await fetch(`/environment-bridge${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  })
  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message || `Environment request failed (${response.status})`)
  return body
}

export const environmentApi = {
  snapshot: (signal) => request('/v1/environment', { signal }),
  setPower: (on) => request('/v1/lights/room-light/power', { method: 'POST', body: JSON.stringify({ on }) }),
  setLight: (channel, level) => request('/v1/lights/room-light/state', { method: 'POST', body: JSON.stringify({ channel, level }) }),
}
