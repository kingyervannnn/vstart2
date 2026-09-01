export const WORKSPACE_URL_PREVIEW_MS = 650

export function shouldHoldBaseWorkspaceUrl(pathname, enabled) {
  return enabled === true && pathname === '/'
}

export function shouldReturnWorkspaceUrlToBase({ enabled, agentMode = false, currentWorkspaceId, nextWorkspaceId }) {
  return enabled === true
    && agentMode !== true
    && Boolean(currentWorkspaceId)
    && Boolean(nextWorkspaceId)
    && currentWorkspaceId !== nextWorkspaceId
}

export function withActiveWorkspaceState(bootstrap, workspaceId) {
  if (!bootstrap || !workspaceId) return bootstrap
  const current = bootstrap.state?.last_active_workspace_id || {}
  if (current.value === workspaceId) return bootstrap
  return {
    ...bootstrap,
    state: {
      ...bootstrap.state,
      last_active_workspace_id: { ...current, value: workspaceId },
    },
  }
}
