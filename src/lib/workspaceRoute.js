export function shouldHoldBaseWorkspaceUrl(pathname, enabled) {
  return enabled === true && pathname === '/'
}
