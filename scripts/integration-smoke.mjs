import assert from 'node:assert/strict'

const base = process.env.VSTART2_API_BASE || 'http://127.0.0.1:3110/api'
const runId = `smoke-${Date.now()}`
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

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

const initial = (await call('/bootstrap')).body
const workspace = initial.workspaces[0]
assert.ok(workspace, 'default workspace exists')

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

const returned = await mutation(`/items/${folderId}`, 'DELETE', { action: 'returnChildren' }, `${runId}:return`)
assert.equal(returned.response.status, 200)
assert.equal(returned.body.bootstrap.items.filter((item) => [first.body.itemId, second.body.itemId].includes(item.id) && !item.parentFolderId).length, 2)

for (const itemId of [first.body.itemId, second.body.itemId]) {
  const deleted = await mutation(`/items/${itemId}`, 'DELETE', { action: 'deleteChildren' }, `${runId}:delete:${itemId}`)
  assert.equal(deleted.response.status, 200)
}

let settingsBootstrap = (await call('/bootstrap')).body
const labelsOff = await mutation('/settings', 'PATCH', {
  version: settingsBootstrap.settings.version,
  patch: { speedDial: { alwaysShowNames: false } },
}, `${runId}:labels-off`)
assert.equal(labelsOff.body.bootstrap.settings.document.speedDial.alwaysShowNames, false)
settingsBootstrap = (await call('/bootstrap')).body
const labelsOn = await mutation('/settings', 'PATCH', {
  version: settingsBootstrap.settings.version,
  patch: { speedDial: { alwaysShowNames: true } },
}, `${runId}:labels-on`)
assert.equal(labelsOn.body.bootstrap.settings.document.speedDial.alwaysShowNames, true)

console.log('V Start 2 integration smoke passed: persistence, idempotency, collision, move, folder, delete, and settings.')
