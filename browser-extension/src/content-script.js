/* global chrome */
(() => {
  'use strict'

  const EVENTS = Object.freeze({
    statusRequest: 'vstart-multitool:status-request',
    statusResponse: 'vstart-multitool:status-response',
    activateRequest: 'vstart-multitool:iframe-activate-request',
    activateResponse: 'vstart-multitool:iframe-activate-response',
    deactivateRequest: 'vstart-multitool:iframe-deactivate-request',
    deactivateResponse: 'vstart-multitool:iframe-deactivate-response',
  })

  document.documentElement.dataset.vstartMultitool = chrome.runtime.getManifest().version

  function requestDetail(event) {
    const detail = event?.detail
    if (!detail || typeof detail !== 'object' || typeof detail.requestId !== 'string') return null
    return { ...detail, requestId: detail.requestId.slice(0, 160) }
  }

  function respond(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail }))
  }

  window.addEventListener(EVENTS.statusRequest, (event) => {
    const detail = requestDetail(event)
    if (!detail) return
    void chrome.runtime.sendMessage({ type: 'vstartMultitool.status' })
      .then((result) => respond(EVENTS.statusResponse, { requestId: detail.requestId, ...result }))
      .catch(() => respond(EVENTS.statusResponse, { requestId: detail.requestId, installed: false }))
  })

  window.addEventListener(EVENTS.activateRequest, (event) => {
    const detail = requestDetail(event)
    if (!detail || typeof detail.url !== 'string') return
    void chrome.runtime.sendMessage({ type: 'vstartMultitool.iframe.activate', url: detail.url })
      .then((result) => respond(EVENTS.activateResponse, { requestId: detail.requestId, ...result }))
      .catch(() => respond(EVENTS.activateResponse, { requestId: detail.requestId, ok: false, errorCode: 'EXTENSION_UNAVAILABLE' }))
  })

  window.addEventListener(EVENTS.deactivateRequest, (event) => {
    const detail = requestDetail(event)
    if (!detail || !Number.isInteger(detail.ruleId)) return
    void chrome.runtime.sendMessage({ type: 'vstartMultitool.iframe.deactivate', ruleId: detail.ruleId })
      .then((result) => respond(EVENTS.deactivateResponse, { requestId: detail.requestId, ...result }))
      .catch(() => respond(EVENTS.deactivateResponse, { requestId: detail.requestId, ok: false }))
  })
})()
