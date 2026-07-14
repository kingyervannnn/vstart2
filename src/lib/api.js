function mutationId(prefix) {
  return `${prefix}:${crypto.randomUUID()}`
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed (${response.status})`)
    error.status = response.status
    error.code = body?.code || body?.details?.code
    error.details = body?.details
    throw error
  }
  return body
}

function mutation(path, method, body, prefix) {
  const id = mutationId(prefix)
  return request(path, {
    method,
    headers: { 'idempotency-key': id },
    body: JSON.stringify({ ...body, mutationId: id }),
  })
}

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  patchSettings: (version, patch) => mutation('/api/settings', 'PATCH', { version, patch }, 'settings'),
  createWorkspace: (name, slug) => mutation('/api/workspaces', 'POST', { name, slug }, 'workspace-create'),
  updateWorkspace: (id, changes) => mutation(`/api/workspaces/${id}`, 'PATCH', changes, 'workspace-update'),
  deleteWorkspace: (id) => mutation(`/api/workspaces/${id}`, 'DELETE', {}, 'workspace-delete'),
  reorderWorkspaces: (ids) => mutation('/api/workspaces/reorder', 'PUT', { ids }, 'workspace-reorder'),
  setActiveWorkspace: (workspaceId) => mutation('/api/state/active-workspace', 'PUT', { workspaceId }, 'active-workspace'),
  createShortcut: (values) => mutation('/api/shortcuts', 'POST', values, 'shortcut-create'),
  updateItem: (id, values) => mutation(`/api/items/${id}`, 'PATCH', values, 'item-update'),
  deleteItem: (id, action = 'deleteChildren') => mutation(`/api/items/${id}`, 'DELETE', { action }, 'item-delete'),
  movePlacement: (id, values) => mutation(`/api/items/${id}/placement`, 'PUT', values, 'placement'),
  moveContainer: (id, values) => mutation(`/api/items/${id}/container`, 'PUT', values, 'container'),
  mergeFolder: (sourceId, targetId, title = 'New Folder') => mutation('/api/folders/merge', 'POST', { sourceId, targetId, title }, 'folder-merge'),
  uploadAsset: (kind, mimeType, data) => mutation('/api/assets', 'POST', { kind, mimeType, data }, 'asset-create'),
  search: (query) => request(`/api/search?q=${encodeURIComponent(query)}`),
  suggestions: (query) => request(`/api/suggestions?q=${encodeURIComponent(query)}`),
}
