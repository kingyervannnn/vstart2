/* global chrome */
const TRUSTED_APP_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])
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
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'vstartMultitool.status') {
    sendResponse({ installed: true, version: chrome.runtime.getManifest().version, iframeAssist: true })
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
  return false
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(RULE_ALARM_PREFIX)) return
  const ruleId = Number(alarm.name.slice(RULE_ALARM_PREFIX.length))
  if (!Number.isInteger(ruleId) || ruleId <= 0) return
  void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] })
})
