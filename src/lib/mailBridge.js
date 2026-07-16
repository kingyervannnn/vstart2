// Keep native mailctl and its credentials on macOS loopback. Browser clients,
// including phones connected through Tailscale, reach it through V Start's
// same-origin nginx route instead of treating 127.0.0.1 as the client device.
const MAIL_BRIDGE_URL = '/mail-bridge/v1'
const DEFAULT_QUERY = 'in:inbox'
const DEFAULT_MAX_AGE_MS = 45_000
const cache = {
  accounts: null,
  accountsUpdatedAt: 0,
  inboxes: new Map(),
  contacts: new Map(),
  contactPromises: new Map(),
  preloadPromise: null,
}

async function mailRequest(path, { signal, method = 'GET', body } = {}) {
  const response = await fetch(`${MAIL_BRIDGE_URL}${path}`, {
    signal,
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || 'Local mail service is unavailable')
  return payload
}

function inboxKey(account, query) {
  return `${account}\u0000${query}`
}

function timestamp(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rememberInbox(account, query, messages) {
  const snapshot = { messages, updatedAt: Date.now() }
  cache.inboxes.set(inboxKey(account, query), snapshot)
  return snapshot
}

function peekInbox({ account = 'all', query = DEFAULT_QUERY, max = 30 } = {}) {
  const inbox = cache.inboxes.get(inboxKey(account, query))
  if (!cache.accounts || !inbox) return null
  return {
    accounts: cache.accounts,
    messages: inbox.messages.slice(0, max),
    updatedAt: inbox.updatedAt,
  }
}

async function loadAccounts({ force = false, signal } = {}) {
  if (!force && cache.accounts) return { accounts: cache.accounts, updatedAt: cache.accountsUpdatedAt, fromCache: true }
  const payload = await mailRequest('/accounts', { signal })
  cache.accounts = payload.accounts || []
  cache.accountsUpdatedAt = Date.now()
  return { ...payload, updatedAt: cache.accountsUpdatedAt, fromCache: false }
}

async function loadInbox({ account = 'all', query = DEFAULT_QUERY, max = 30, force = false, maxAgeMs = DEFAULT_MAX_AGE_MS, signal } = {}) {
  const cached = peekInbox({ account, query, max })
  if (!force && cached && Date.now() - cached.updatedAt <= maxAgeMs) return { ...cached, fromCache: true }
  const accountData = await loadAccounts({ signal })
  const params = new URLSearchParams({ account, query, max: String(max) })
  const payload = await mailRequest(`/messages?${params}`, { signal })
  const inbox = rememberInbox(account, query, payload.messages || [])
  return { accounts: accountData.accounts || [], messages: inbox.messages.slice(0, max), updatedAt: inbox.updatedAt, fromCache: false }
}

async function preload({ force = false, query = DEFAULT_QUERY, maxPerAccount = 30 } = {}) {
  const current = peekInbox({ account: 'all', query, max: maxPerAccount })
  if (!force && current && Date.now() - current.updatedAt <= DEFAULT_MAX_AGE_MS) return current
  if (cache.preloadPromise) return cache.preloadPromise
  cache.preloadPromise = (async () => {
    const accountData = await loadAccounts({ force })
    const batches = await Promise.all((accountData.accounts || []).map(async (account) => {
      const params = new URLSearchParams({ account: account.alias, query, max: String(maxPerAccount) })
      const payload = await mailRequest(`/messages?${params}`)
      const messages = payload.messages || []
      rememberInbox(account.alias, query, messages)
      return messages
    }))
    const combined = batches.flat().sort((left, right) => timestamp(right.date) - timestamp(left.date))
    const inbox = rememberInbox('all', query, combined)
    return { accounts: accountData.accounts || [], messages: inbox.messages.slice(0, maxPerAccount), updatedAt: inbox.updatedAt }
  })().finally(() => { cache.preloadPromise = null })
  return cache.preloadPromise
}

async function loadContacts({ account, max = 80, force = false, maxAgeMs = 5 * 60_000, signal } = {}) {
  const cached = cache.contacts.get(account)
  if (!force && cached && Date.now() - cached.updatedAt <= maxAgeMs) {
    return { contacts: cached.contacts.slice(0, max), updatedAt: cached.updatedAt, fromCache: true }
  }
  if (!force && cache.contactPromises.has(account)) {
    const pending = await cache.contactPromises.get(account)
    return { ...pending, contacts: pending.contacts.slice(0, max), fromCache: true }
  }
  const request = (async () => {
    const params = new URLSearchParams({ account, max: String(Math.max(80, Math.min(100, max))) })
    const payload = await mailRequest(`/contacts?${params}`, { signal })
    const snapshot = { contacts: payload.contacts || [], updatedAt: Date.now() }
    cache.contacts.set(account, snapshot)
    return snapshot
  })()
  cache.contactPromises.set(account, request)
  try {
    const snapshot = await request
    return { ...snapshot, contacts: snapshot.contacts.slice(0, max), fromCache: false }
  } finally {
    if (cache.contactPromises.get(account) === request) cache.contactPromises.delete(account)
  }
}

function clearCache() {
  cache.accounts = null
  cache.accountsUpdatedAt = 0
  cache.inboxes.clear()
  cache.contacts.clear()
  cache.contactPromises.clear()
  cache.preloadPromise = null
}

function removeCachedMessage(account, id) {
  for (const inbox of cache.inboxes.values()) {
    inbox.messages = inbox.messages.filter((message) => !(message.account === account && message.id === id))
  }
}

function updateCachedMessage(account, id, patch) {
  for (const inbox of cache.inboxes.values()) {
    inbox.messages = inbox.messages.map((message) => message.account === account && message.id === id ? { ...message, ...patch } : message)
  }
}

export const mailBridge = {
  health: (options) => mailRequest('/health', options),
  accounts: loadAccounts,
  peekAccounts: () => cache.accounts || [],
  peekInbox,
  loadInbox,
  preload,
  contacts: loadContacts,
  clearCache,
  removeCachedMessage,
  updateCachedMessage,
  messages: ({ account = 'all', query = 'in:inbox', max = 30, signal } = {}) => {
    const params = new URLSearchParams({ account, query, max: String(max) })
    return mailRequest(`/messages?${params}`, { signal })
  },
  message: (account, id, options) => mailRequest(`/messages/${encodeURIComponent(account)}/${encodeURIComponent(id)}`, options),
  trashMessage: (account, id, options) => mailRequest(`/messages/${encodeURIComponent(account)}/${encodeURIComponent(id)}/trash`, { ...options, method: 'POST', body: { confirmTrash: true } }),
  starMessage: (account, id, starred, options) => mailRequest(`/messages/${encodeURIComponent(account)}/${encodeURIComponent(id)}/star`, { ...options, method: 'POST', body: { starred } }),
  drafts: (account, options) => mailRequest(`/drafts?${new URLSearchParams({ account, max: '30' })}`, options),
  createDraft: (draft, options) => mailRequest('/drafts', { ...options, method: 'POST', body: draft }),
  sendDraft: (account, draftId, options) => mailRequest(`/drafts/${encodeURIComponent(account)}/${encodeURIComponent(draftId)}/send`, { ...options, method: 'POST', body: { confirmSend: true } }),
}
