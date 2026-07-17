export function bootstrapBackgroundId(bootstrap, pathname = '/') {
  const settings = bootstrap?.settings?.document || {}
  const workspaces = bootstrap?.workspaces || []
  const slugMatch = pathname.match(/^\/w\/([^/]+)/)
  const slug = slugMatch ? decodeURIComponent(slugMatch[1]) : ''
  const lastWorkspaceId = bootstrap?.state?.last_active_workspace_id?.value
  const workspace = workspaces.find((item) => item.slug === slug)
    || workspaces.find((item) => item.id === lastWorkspaceId)
    || workspaces[0]
  return settings.backgrounds?.workspaceSpecific && workspace?.backgroundAssetId
    ? workspace.backgroundAssetId
    : settings.backgrounds?.globalAssetId || null
}

export function backgroundLayerVariables(assetId, { fullReady = false } = {}) {
  if (!assetId) return {}
  return {
    '--app-background-image': `url(/api/assets/${assetId}/preview)`,
    '--app-background-full-image': `url(/api/assets/${assetId})`,
    '--app-background-full-opacity': fullReady ? 1 : 0,
  }
}

export function startupBackgroundUrl(pathname = '/') {
  return `/api/backgrounds/startup?path=${encodeURIComponent(pathname)}`
}

export function preloadBackgroundAsset(assetId, ImageClass = globalThis.Image, timeoutMs = 1200, { fullResolution = false } = {}) {
  if (!assetId || typeof ImageClass !== 'function') return Promise.resolve(assetId)
  return new Promise((resolve) => {
    let settled = false
    let timer
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(assetId)
    }
    const image = new ImageClass()
    image.onload = () => {
      if (typeof image.decode !== 'function') {
        finish()
        return
      }
      void image.decode().catch(() => {}).finally(finish)
    }
    image.onerror = finish
    image.decoding = 'async'
    if (fullResolution) image.fetchPriority = 'high'
    timer = setTimeout(finish, timeoutMs)
    image.src = `/api/assets/${assetId}${fullResolution ? '' : '/preview'}`
  })
}

export function preloadBootstrapBackground(bootstrap, pathname, ImageClass = globalThis.Image, timeoutMs = 1200) {
  const assetId = bootstrapBackgroundId(bootstrap, pathname)
  return preloadBackgroundAsset(assetId, ImageClass, timeoutMs)
}
