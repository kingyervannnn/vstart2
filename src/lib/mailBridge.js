const MAIL_BRIDGE_URL = 'http://127.0.0.1:3130/v1'

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

export const mailBridge = {
  health: (options) => mailRequest('/health', options),
  accounts: (options) => mailRequest('/accounts', options),
  messages: ({ account = 'all', query = 'in:inbox', max = 30, signal } = {}) => {
    const params = new URLSearchParams({ account, query, max: String(max) })
    return mailRequest(`/messages?${params}`, { signal })
  },
  message: (account, id, options) => mailRequest(`/messages/${encodeURIComponent(account)}/${encodeURIComponent(id)}`, options),
  drafts: (account, options) => mailRequest(`/drafts?${new URLSearchParams({ account, max: '30' })}`, options),
  createDraft: (draft, options) => mailRequest('/drafts', { ...options, method: 'POST', body: draft }),
  sendDraft: (account, draftId, options) => mailRequest(`/drafts/${encodeURIComponent(account)}/${encodeURIComponent(draftId)}/send`, { ...options, method: 'POST', body: { confirmSend: true } }),
}
