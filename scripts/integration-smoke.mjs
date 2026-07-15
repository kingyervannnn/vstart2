import assert from 'node:assert/strict'

const base = process.env.VSTART2_API_BASE || 'http://127.0.0.1:3110/api'
const runId = `smoke-${Date.now()}`
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const canvases = {
  wide: { width: 1600, height: 1000, tileWidth: 128, tileHeight: 128 },
  compact: { width: 820, height: 1000, tileWidth: 104, tileHeight: 104 },
}

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  })
  const body = await response.json().catch(() => null)
  return { response, body }
}

function mutation(path, method, body, id) {
  return call(path, {
    method,
    headers: { 'idempotency-key': id },
    body: JSON.stringify({ ...body, mutationId: id }),
  })
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function openPlacements(bootstrap, workspaceId, preferredItemId = null, containerKey = 'root') {
  return Object.fromEntries(Object.entries(canvases).map(([profile, canvas]) => {
    const occupied = bootstrap.placements.filter((value) => value.workspaceId === workspaceId && value.profile === profile && value.containerKey === containerKey)
    const source = preferredItemId ? bootstrap.placements.find((value) => value.itemId === preferredItemId && value.profile === profile) : null
    const width = canvas.tileWidth
    const height = canvas.tileHeight
    const candidates = []
    if (source) candidates.push({ x: Math.min(source.x, canvas.width - width), y: Math.min(source.y, canvas.height - height), width, height })
    for (let y = 40; y + height <= canvas.height; y += 24) {
      for (let x = 40; x + width <= canvas.width; x += 24) candidates.push({ x, y, width, height })
    }
    const result = candidates.find((candidate) => !occupied.some((value) => intersects(candidate, value)))
    assert.ok(result, `open ${profile} placement exists in ${workspaceId}`)
    return [profile, result]
  }))
}

const initial = (await call('/bootstrap')).body
assert.ok(initial.workspaces[0], 'default workspace exists')
const backgroundName = `Integration ${runId}.png`
const background = await mutation('/assets', 'POST', {
  kind: 'background',
  mimeType: 'image/png',
  data: tinyPng,
  originalName: backgroundName,
}, `${runId}:background-create`)
assert.equal(background.response.status, 201)
let backgroundBootstrap = (await call('/bootstrap')).body
const backgroundMetadata = backgroundBootstrap.backgroundAssets.find((asset) => asset.id === background.body.assetId)
assert.equal(backgroundMetadata.originalName, backgroundName, 'background metadata is available without loading binary content')
const backgroundContent = await fetch(`${base}/assets/${background.body.assetId}`)
assert.equal(backgroundContent.status, 200)
assert.equal(backgroundContent.headers.get('content-type'), 'image/png')
const backgroundDeleted = await mutation(`/assets/${background.body.assetId}`, 'DELETE', {}, `${runId}:background-delete`)
assert.equal(backgroundDeleted.response.status, 200)
assert.ok(!backgroundDeleted.body.bootstrap.backgroundAssets.some((asset) => asset.id === background.body.assetId), 'unused backgrounds can be removed cleanly')
const createdWorkspace = await mutation('/workspaces', 'POST', { name: `Smoke ${runId}`, icon: 'Briefcase' }, `${runId}:workspace-a`)
assert.equal(createdWorkspace.response.status, 201)
const workspace = createdWorkspace.body.bootstrap.workspaces.find((value) => value.id === createdWorkspace.body.workspaceId)
assert.ok(workspace, 'isolated smoke workspace exists')
assert.equal(workspace.icon, 'Briefcase', 'workspace glyph is persisted')

const emptyFolder = await mutation('/folders', 'POST', {
  workspaceId: workspace.id,
  title: 'Smoke empty folder',
  placements: openPlacements(createdWorkspace.body.bootstrap, workspace.id),
}, `${runId}:empty-folder`)
assert.equal(emptyFolder.response.status, 201)
const emptyFolderItem = emptyFolder.body.bootstrap.items.find((item) => item.id === emptyFolder.body.folderId)
assert.equal(emptyFolderItem.kind, 'folder', 'an empty folder can be created directly')
assert.equal(emptyFolder.body.bootstrap.items.filter((item) => item.parentFolderId === emptyFolder.body.folderId).length, 0)
assert.equal(emptyFolder.body.bootstrap.placements.filter((value) => value.itemId === emptyFolder.body.folderId && value.containerKey === 'root').length, 2)
const emptyFolderDeleted = await mutation(`/items/${emptyFolder.body.folderId}`, 'DELETE', { action: 'deleteChildren' }, `${runId}:delete-empty-folder`)
assert.equal(emptyFolderDeleted.response.status, 200)

const makeShortcut = (title, x, compactX) => ({
  workspaceId: workspace.id,
  title,
  url: 'https://example.com',
  iconData: tinyPng,
  iconMimeType: 'image/png',
  placements: {
    wide: { x, y: 70, width: 128, height: 128 },
    compact: { x: compactX, y: 70, width: 104, height: 104 },
  },
})

const firstIdempotencyKey = `${runId}:create-a`
const first = await mutation('/shortcuts', 'POST', makeShortcut('Smoke A', 70, 50), firstIdempotencyKey)
assert.equal(first.response.status, 201)
const firstRetry = await mutation('/shortcuts', 'POST', makeShortcut('Smoke A', 70, 50), firstIdempotencyKey)
assert.equal(firstRetry.response.status, 201)
assert.equal(firstRetry.body.itemId, first.body.itemId, 'idempotent retry returns the same item')

const collision = await mutation('/shortcuts', 'POST', makeShortcut('Collision', 70, 50), `${runId}:collision`)
assert.equal(collision.response.status, 409, 'database rejects overlapping placement')
assert.equal(collision.body.code, 'PLACEMENT_COLLISION')

const second = await mutation('/shortcuts', 'POST', makeShortcut('Smoke B', 300, 240), `${runId}:create-b`)
assert.equal(second.response.status, 201)

const loaded = (await call('/bootstrap')).body
assert.ok(loaded.items.some((item) => item.id === first.body.itemId), 'shortcut survives a fresh bootstrap')
const firstWide = loaded.placements.find((value) => value.itemId === first.body.itemId && value.profile === 'wide')
const moved = await mutation(`/items/${first.body.itemId}/placement`, 'PUT', {
  profile: 'wide', x: 80, y: 300, version: firstWide.version,
}, `${runId}:move-a`)
assert.equal(moved.response.status, 200)

const merged = await mutation('/folders/merge', 'POST', {
  sourceId: first.body.itemId,
  targetId: second.body.itemId,
  title: 'Smoke Folder',
}, `${runId}:merge`)
assert.equal(merged.response.status, 201)
const folderId = merged.body.folderId
assert.equal(merged.body.bootstrap.items.filter((item) => item.parentFolderId === folderId).length, 2)

const nested = await mutation('/shortcuts', 'POST', {
  workspaceId: workspace.id,
  parentFolderId: folderId,
  title: 'Smoke created in folder',
  url: 'https://example.com/nested',
  iconData: tinyPng,
  iconMimeType: 'image/png',
  placements: openPlacements(merged.body.bootstrap, workspace.id, null, folderId),
}, `${runId}:create-in-folder`)
assert.equal(nested.response.status, 201)
const nestedItem = nested.body.bootstrap.items.find((item) => item.id === nested.body.itemId)
assert.equal(nestedItem.parentFolderId, folderId, 'shortcut is created directly inside a folder')
assert.ok(nested.body.bootstrap.placements.filter((value) => value.itemId === nested.body.itemId).every((value) => value.containerKey === folderId), 'nested shortcut placements use the folder container')
const nestedDeleted = await mutation(`/items/${nested.body.itemId}`, 'DELETE', { action: 'deleteChildren' }, `${runId}:delete-nested`)
assert.equal(nestedDeleted.response.status, 200)

const returned = await mutation(`/items/${folderId}`, 'DELETE', { action: 'returnChildren' }, `${runId}:return`)
assert.equal(returned.response.status, 200)
assert.equal(returned.body.bootstrap.items.filter((item) => [first.body.itemId, second.body.itemId].includes(item.id) && !item.parentFolderId).length, 2)

for (const itemId of [first.body.itemId, second.body.itemId]) {
  const deleted = await mutation(`/items/${itemId}`, 'DELETE', { action: 'deleteChildren' }, `${runId}:delete:${itemId}`)
  assert.equal(deleted.response.status, 200)
}

const createdDestination = await mutation('/workspaces', 'POST', { name: `Smoke destination ${runId}` }, `${runId}:workspace-b`)
assert.equal(createdDestination.response.status, 201)
const destinationWorkspaceId = createdDestination.body.workspaceId

const pinCandidate = await mutation('/shortcuts', 'POST', makeShortcut('Smoke pinned', 560, 440), `${runId}:create-pin`)
assert.equal(pinCandidate.response.status, 201)
let pinBootstrap = pinCandidate.body.bootstrap
let pinItem = pinBootstrap.items.find((item) => item.id === pinCandidate.body.itemId)
const pinDestinations = pinBootstrap.workspaces
  .filter((value) => value.id !== workspace.id)
  .map((value) => ({ workspaceId: value.id, placements: openPlacements(pinBootstrap, value.id, pinItem.id) }))
const pinned = await mutation(`/items/${pinItem.id}/pin`, 'POST', {
  version: pinItem.version,
  destinations: pinDestinations,
}, `${runId}:pin`)
assert.equal(pinned.response.status, 200)
pinBootstrap = pinned.body.bootstrap
pinItem = pinBootstrap.items.find((item) => item.id === pinCandidate.body.itemId)
assert.ok(pinItem.pinGroupId, 'pin group is persisted')
assert.equal(pinBootstrap.items.filter((item) => item.pinGroupId === pinItem.pinGroupId).length, pinBootstrap.workspaces.length, 'one synchronized copy exists in every workspace')

const renamed = await mutation(`/items/${pinItem.id}`, 'PATCH', {
  title: 'Smoke pinned renamed',
  version: pinItem.version,
}, `${runId}:rename-pin`)
assert.equal(renamed.response.status, 200)
pinBootstrap = renamed.body.bootstrap
pinItem = pinBootstrap.items.find((item) => item.id === pinCandidate.body.itemId)
assert.ok(pinBootstrap.items.filter((item) => item.pinGroupId === pinItem.pinGroupId).every((item) => item.title === 'Smoke pinned renamed'), 'pinned metadata stays synchronized')

const unpinned = await mutation(`/items/${pinItem.id}/pin`, 'DELETE', { version: pinItem.version }, `${runId}:unpin`)
assert.equal(unpinned.response.status, 200)
pinBootstrap = unpinned.body.bootstrap
pinItem = pinBootstrap.items.find((item) => item.id === pinCandidate.body.itemId)
assert.equal(pinItem.pinGroupId, null)
assert.equal(pinBootstrap.items.filter((item) => item.title === 'Smoke pinned renamed').length, 1, 'unpin keeps only the current-workspace copy')

const movedWorkspace = await mutation(`/items/${pinItem.id}/workspace`, 'PUT', {
  destinationWorkspaceId,
  placements: openPlacements(pinBootstrap, destinationWorkspaceId, pinItem.id),
  version: pinItem.version,
}, `${runId}:move-workspace`)
assert.equal(movedWorkspace.response.status, 200)
assert.equal(movedWorkspace.body.bootstrap.items.find((item) => item.id === pinItem.id).workspaceId, destinationWorkspaceId)
const movedDeleted = await mutation(`/items/${pinItem.id}`, 'DELETE', { action: 'deleteChildren' }, `${runId}:delete-moved`)
assert.equal(movedDeleted.response.status, 200)

let settingsBootstrap = (await call('/bootstrap')).body
const originalLabels = settingsBootstrap.settings.document.speedDial.alwaysShowNames !== false
const labelsChanged = await mutation('/settings', 'PATCH', {
  version: settingsBootstrap.settings.version,
  patch: { speedDial: { alwaysShowNames: !originalLabels } },
}, `${runId}:labels-change`)
assert.equal(labelsChanged.body.bootstrap.settings.document.speedDial.alwaysShowNames, !originalLabels)
settingsBootstrap = (await call('/bootstrap')).body
const labelsRestored = await mutation('/settings', 'PATCH', {
  version: settingsBootstrap.settings.version,
  patch: { speedDial: { alwaysShowNames: originalLabels } },
}, `${runId}:labels-restore`)
assert.equal(labelsRestored.body.bootstrap.settings.document.speedDial.alwaysShowNames, originalLabels)

const agentPreferences = await mutation(`/workspaces/${workspace.id}/agent-preferences`, 'PUT', {
  cwd: '/tmp/vstart2-agent-smoke',
  provider: 'fixture-provider',
  model: 'fixture-model',
  version: 0,
}, `${runId}:agent-preferences`)
assert.equal(agentPreferences.response.status, 200)
assert.deepEqual(
  agentPreferences.body.bootstrap.agentPreferences.find((value) => value.workspaceId === workspace.id),
  expectAgentPreferences(workspace.id),
  'agent workspace preferences persist in PostgreSQL',
)

const linkedAgentSession = await mutation('/agent/sessions', 'POST', {
  workspaceId: workspace.id,
  hermesSessionId: `hermes-${runId}`,
}, `${runId}:agent-session-link`)
assert.equal(linkedAgentSession.response.status, 200)
let agentSession = linkedAgentSession.body.bootstrap.agentSessions.find((value) => value.id === linkedAgentSession.body.agentSessionLinkId)
assert.ok(agentSession, 'Hermes session link is returned in bootstrap')

const updatedAgentSession = await mutation(`/agent/sessions/${agentSession.id}`, 'PATCH', {
  pinned: true,
  titleOverride: 'Smoke Hermes session',
  version: agentSession.version,
}, `${runId}:agent-session-update`)
assert.equal(updatedAgentSession.response.status, 200)
agentSession = updatedAgentSession.body.bootstrap.agentSessions.find((value) => value.id === agentSession.id)
assert.equal(agentSession.pinned, true)
assert.equal(agentSession.titleOverride, 'Smoke Hermes session')

const unlinkedAgentSession = await mutation(`/agent/sessions/${agentSession.id}`, 'DELETE', {
  version: agentSession.version,
}, `${runId}:agent-session-unlink`)
assert.equal(unlinkedAgentSession.response.status, 200)
assert.ok(!unlinkedAgentSession.body.bootstrap.agentSessions.some((value) => value.id === agentSession.id), 'unlink keeps Hermes history out of PostgreSQL while removing the V Start link')

for (const workspaceId of [destinationWorkspaceId, workspace.id]) {
  const deleted = await mutation(`/workspaces/${workspaceId}`, 'DELETE', {}, `${runId}:delete-workspace:${workspaceId}`)
  assert.equal(deleted.response.status, 200)
}

console.log('V Start 2 integration smoke passed: persistence, background assets, idempotency, collision, free placement, folders, workspace moves, synchronized pinning, Agent Mode links/preferences, deletion, and settings.')

function expectAgentPreferences(workspaceId) {
  return {
    workspaceId,
    cwd: '/tmp/vstart2-agent-smoke',
    provider: 'fixture-provider',
    model: 'fixture-model',
    version: 1,
    updatedAt: agentPreferences.body.bootstrap.agentPreferences.find((value) => value.workspaceId === workspaceId).updatedAt,
  }
}
