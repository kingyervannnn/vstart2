export function backgroundRotationInterval(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return 15
  return Math.max(1, Math.min(1440, Math.round(minutes)))
}

export function backgroundRotationSettings(settings, workspaceId) {
  const backgrounds = settings?.backgrounds || {}
  const rotation = backgrounds.rotation || {}
  if (!backgrounds.workspaceSpecific || !workspaceId) return rotation
  const workspaceRotation = rotation.workspaceSettings?.[workspaceId] || {}
  return {
    enabled: false,
    intervalMinutes: 15,
    scope: 'all',
    collectionId: null,
    ...workspaceRotation,
    workspacePools: rotation.workspacePools || {},
  }
}

export function backgroundRotationCandidates({ settings, assets, collections, workspaceId }) {
  const backgrounds = settings?.backgrounds || {}
  const rotation = backgroundRotationSettings(settings, workspaceId)
  const available = new Set((assets || []).map((asset) => asset.id))
  let ids

  if (rotation.scope === 'folder') {
    ids = (collections || []).find((collection) => collection.id === rotation.collectionId)?.assetIds || []
  } else if (rotation.scope === 'loose') {
    const collected = new Set((collections || []).flatMap((collection) => collection.assetIds || []))
    ids = (assets || []).filter((asset) => !collected.has(asset.id)).map((asset) => asset.id)
  } else if (rotation.scope === 'workspace') {
    if (!backgrounds.workspaceSpecific || !workspaceId) return []
    ids = rotation.workspacePools?.[workspaceId] || []
  } else {
    ids = (assets || []).map((asset) => asset.id)
  }

  return [...new Set(ids)].filter((id) => available.has(id))
}

export function nextBackgroundId(candidates, currentId) {
  if (!candidates?.length) return null
  const index = candidates.indexOf(currentId)
  return candidates[(index + 1 + candidates.length) % candidates.length]
}

export function scheduledBackgroundId(candidates, intervalMinutes, now = Date.now()) {
  if (!candidates?.length) return null
  const timestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(timestamp)) return candidates[0]
  const intervalMs = backgroundRotationInterval(intervalMinutes) * 60_000
  const slot = Math.floor(timestamp / intervalMs)
  return candidates[((slot % candidates.length) + candidates.length) % candidates.length]
}

export function millisecondsUntilNextBackgroundSlot(intervalMinutes, now = Date.now()) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now)
  const intervalMs = backgroundRotationInterval(intervalMinutes) * 60_000
  if (!Number.isFinite(timestamp)) return intervalMs
  const elapsed = ((timestamp % intervalMs) + intervalMs) % intervalMs
  return elapsed === 0 ? intervalMs : intervalMs - elapsed
}
