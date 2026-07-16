export function backgroundRotationInterval(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return 15
  return Math.max(1, Math.min(1440, Math.round(minutes)))
}

export function backgroundRotationCandidates({ settings, assets, collections, workspaceId }) {
  const backgrounds = settings?.backgrounds || {}
  const rotation = backgrounds.rotation || {}
  const available = new Set((assets || []).map((asset) => asset.id))
  let ids

  if (rotation.scope === 'folder') {
    ids = (collections || []).find((collection) => collection.id === rotation.collectionId)?.assetIds || []
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
