/* global chrome */
import {
  APP_ORIGINS,
  chooseWorkspace,
  defaultShortcutTitle,
  normalizedHttpUrl,
  placementsForShortcut,
} from './shortcut-utils.js'

const TRUSTED_APP_ORIGINS = new Set(APP_ORIGINS)
const RULE_TTL_MS = 10 * 60 * 1000
const RULE_ALARM_PREFIX = 'vstartMultitool.iframe.expire.'

function senderOrigin(sender) {
  try {
    const origin = new URL(sender?.url || '').origin
    return TRUSTED_APP_ORIGINS.has(origin) ? origin : null
  } catch {
    return null
  }
}

function destination(value) {
  const href = normalizedHttpUrl(value)
  return href ? new URL(href) : null
}

function ruleIdFor(tabId, initiatorDomain, destinationDomain) {
  const value = `${tabId}:${initiatorDomain}>${destinationDomain}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return 10_000 + ((hash >>> 0) % 2_000_000_000)
}

function iframeRule(ruleId, initiatorDomain, destinationDomain) {
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' },
        { header: 'content-security-policy-report-only', operation: 'remove' },
      ],
    },
    condition: {
      requestDomains: [destinationDomain],
      initiatorDomains: [initiatorDomain],
      resourceTypes: ['sub_frame'],
    },
  }
}

async function activate(sender, value) {
  const initiatorOrigin = senderOrigin(sender)
  const target = destination(value)
  if (!initiatorOrigin) return { ok: false, errorCode: 'UNTRUSTED_INITIATOR' }
  if (!target) return { ok: false, errorCode: 'INVALID_DESTINATION' }
  const initiatorDomain = new URL(initiatorOrigin).hostname
  const ruleId = ruleIdFor(Number.isInteger(sender?.tab?.id) ? sender.tab.id : 0, initiatorDomain, target.hostname)
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [iframeRule(ruleId, initiatorDomain, target.hostname)],
  })
  const expiresAt = Date.now() + RULE_TTL_MS
  await chrome.alarms.create(`${RULE_ALARM_PREFIX}${ruleId}`, { when: expiresAt })
  return { ok: true, ruleId, expiresAt, destinationOrigin: target.origin }
}

async function deactivate(sender, ruleId) {
  if (!senderOrigin(sender)) return { ok: false, errorCode: 'UNTRUSTED_INITIATOR' }
  if (!Number.isInteger(ruleId) || ruleId <= 0) return { ok: false, errorCode: 'INVALID_RULE' }
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] })
  await chrome.alarms.clear(`${RULE_ALARM_PREFIX}${ruleId}`)
  return { ok: true }
}

async function appRequest(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || `V Start request failed (${response.status})`)
  return body
}

async function loadApp() {
  let lastError = null
  for (const origin of APP_ORIGINS) {
    try {
      return { origin, bootstrap: await appRequest(origin, '/api/bootstrap') }
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(lastError ? 'V Start is not reachable on port 3000.' : 'V Start is unavailable.')
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab || null
}

async function captureContext() {
  const tab = await activeTab()
  const url = normalizedHttpUrl(tab?.url)
  if (!url) return { ok: false, error: 'This browser page cannot be saved as a shortcut.' }
  const { origin, bootstrap } = await loadApp()
  const selection = chooseWorkspace(bootstrap, tab)
  return {
    ok: true,
    appOrigin: origin,
    page: {
      title: defaultShortcutTitle(tab, url),
      url,
      faviconUrl: normalizedHttpUrl(tab?.favIconUrl),
    },
    workspaces: bootstrap.workspaces,
    selectedWorkspaceId: selection.workspace?.id || null,
    detectionSource: selection.source,
  }
}

function mutationOptions(method, body, prefix) {
  const mutationId = `${prefix}:${crypto.randomUUID()}`
  return {
    method,
    headers: { 'idempotency-key': mutationId },
    body: JSON.stringify({ ...body, mutationId }),
  }
}

async function pinShortcut(origin, bootstrap, item, sourceWorkspaceId) {
  const destinations = bootstrap.workspaces
    .filter((workspace) => workspace.id !== sourceWorkspaceId)
    .map((workspace) => ({
      workspaceId: workspace.id,
      placements: placementsForShortcut(bootstrap, workspace.id),
    }))
  if (!destinations.length) return null
  return appRequest(
    origin,
    `/api/items/${encodeURIComponent(item.id)}/pin`,
    mutationOptions('POST', { version: item.version, destinations }, 'extension-shortcut-pin'),
  )
}

async function addCurrentPage(message) {
  const tab = await activeTab()
  const url = normalizedHttpUrl(message?.url || tab?.url)
  if (!url) throw new Error('This browser page cannot be saved as a shortcut.')
  const { origin, bootstrap } = await loadApp()
  const workspace = bootstrap.workspaces.find((value) => value.id === message.workspaceId)
  if (!workspace) throw new Error('Choose a workspace before adding the shortcut.')
  const title = String(message.title || defaultShortcutTitle(tab, url)).trim().slice(0, 120)
  if (!title) throw new Error('Enter a shortcut name.')

  const existing = bootstrap.items.find((item) => (
    item.kind === 'shortcut' &&
    item.workspaceId === workspace.id &&
    normalizedHttpUrl(item.url) === url
  ))
  if (existing) {
    if (message.pinAcross && !existing.pinGroupId) {
      await pinShortcut(origin, bootstrap, existing, workspace.id)
      return { ok: true, alreadyExists: true, pinned: true, workspaceName: workspace.name, title: existing.title }
    }
    return {
      ok: true,
      alreadyExists: true,
      pinned: Boolean(existing.pinGroupId),
      workspaceName: workspace.name,
      title: existing.title,
    }
  }

  const created = await appRequest(origin, '/api/shortcuts', mutationOptions('POST', {
    workspaceId: workspace.id,
    title,
    url,
    placements: placementsForShortcut(bootstrap, workspace.id),
  }, 'extension-shortcut-create'))

  let pinned = false
  if (message.pinAcross && created.bootstrap.workspaces.length > 1) {
    const item = created.bootstrap.items.find((value) => value.id === created.itemId)
    if (!item) throw new Error('The shortcut was added, but V Start could not pin it across workspaces.')
    await pinShortcut(origin, created.bootstrap, item, workspace.id)
    pinned = true
  }
  return { ok: true, alreadyExists: false, pinned, workspaceName: workspace.name, title }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'vstartMultitool.status') {
    sendResponse({ installed: true, version: chrome.runtime.getManifest().version, iframeAssist: true, shortcutCapture: true })
    return false
  }
  if (message?.type === 'vstartMultitool.iframe.activate') {
    void activate(sender, message.url).then(sendResponse).catch(() => sendResponse({ ok: false, errorCode: 'ACTIVATION_FAILED' }))
    return true
  }
  if (message?.type === 'vstartMultitool.iframe.deactivate') {
    void deactivate(sender, message.ruleId).then(sendResponse).catch(() => sendResponse({ ok: false, errorCode: 'DEACTIVATION_FAILED' }))
    return true
  }
  if (message?.type === 'vstartMultitool.capture.context') {
    void captureContext().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }))
    return true
  }
  if (message?.type === 'vstartMultitool.capture.add') {
    void addCurrentPage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }))
    return true
  }
  return false
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(RULE_ALARM_PREFIX)) return
  const ruleId = Number(alarm.name.slice(RULE_ALARM_PREFIX.length))
  if (!Number.isInteger(ruleId) || ruleId <= 0) return
  void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] })
})
