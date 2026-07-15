const EVENTS = Object.freeze({
  statusRequest: 'vstart-multitool:status-request',
  statusResponse: 'vstart-multitool:status-response',
  activateRequest: 'vstart-multitool:iframe-activate-request',
  activateResponse: 'vstart-multitool:iframe-activate-response',
  deactivateRequest: 'vstart-multitool:iframe-deactivate-request',
  deactivateResponse: 'vstart-multitool:iframe-deactivate-response',
})

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `frame-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function extensionVersion() {
  return typeof document === 'undefined' ? null : document.documentElement.dataset.vstartMultitool || null
}

function request(eventName, responseName, detail, timeoutMs = 800) {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const id = requestId()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener(responseName, receive)
      resolve(null)
    }, timeoutMs)
    const receive = (event) => {
      if (event?.detail?.requestId !== id) return
      window.clearTimeout(timer)
      window.removeEventListener(responseName, receive)
      resolve(event.detail)
    }
    window.addEventListener(responseName, receive)
    window.dispatchEvent(new CustomEvent(eventName, { detail: { ...detail, requestId: id } }))
  })
}

export function frameAssistInstalled() {
  return Boolean(extensionVersion())
}

export async function frameAssistStatus() {
  const version = extensionVersion()
  if (!version) return { installed: false, iframeAssist: false, version: null }
  const result = await request(EVENTS.statusRequest, EVENTS.statusResponse, {})
  return result?.installed
    ? { installed: true, iframeAssist: result.iframeAssist === true, version: result.version || version }
    : { installed: false, iframeAssist: false, version: null }
}

export async function activateFrameAssist(url) {
  if (!frameAssistInstalled()) return { installed: false, ok: false, ruleId: null }
  const result = await request(EVENTS.activateRequest, EVENTS.activateResponse, { url })
  return {
    installed: true,
    ok: result?.ok === true,
    ruleId: Number.isInteger(result?.ruleId) ? result.ruleId : null,
    errorCode: typeof result?.errorCode === 'string' ? result.errorCode : null,
  }
}

export async function deactivateFrameAssist(ruleId) {
  if (!frameAssistInstalled() || !Number.isInteger(ruleId)) return false
  const result = await request(EVENTS.deactivateRequest, EVENTS.deactivateResponse, { ruleId }, 400)
  return result?.ok === true
}
