import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const extensionRoot = new URL('../browser-extension/', import.meta.url)
const readExtensionFile = (path) => readFile(new URL(path, extensionRoot), 'utf8')

describe('V Start Multi-Tool extension contract', () => {
  it('ships a narrowly scoped Manifest V3 companion', async () => {
    const manifest = JSON.parse(await readExtensionFile('manifest.json'))
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'alarms', 'declarativeNetRequest'])
    expect(manifest.permissions).not.toContain('cookies')
    expect(manifest.permissions).not.toContain('history')
    expect(manifest.permissions).not.toContain('tabs')
    expect(manifest.permissions).not.toContain('webRequest')
    expect(manifest.background.type).toBe('module')
    expect(manifest.action.default_popup).toBe('popup/popup.html')
    expect(manifest.content_scripts[0].matches).toEqual([
      'http://localhost:3000/*',
      'http://127.0.0.1:3000/*',
    ])
  })

  it('captures only the user-activated current tab through the V Start API', async () => {
    const worker = await readExtensionFile('src/service-worker.js')
    const popup = await readExtensionFile('popup/popup.js')
    expect(worker).toContain("chrome.tabs.query({ active: true, currentWindow: true })")
    expect(worker).toContain("'/api/bootstrap'")
    expect(worker).toContain("'/api/shortcuts'")
    expect(worker).toContain("message?.type === 'vstartMultitool.capture.add'")
    expect(popup).toContain("type: 'vstartMultitool.capture.context'")
    expect(popup).toContain('pinAcross: pinInput.checked')
  })

  it('uses expiring destination and initiator-scoped subframe rules', async () => {
    const worker = await readExtensionFile('src/service-worker.js')
    expect(worker).toContain('updateSessionRules')
    expect(worker).toContain("requestDomains: [destinationDomain]")
    expect(worker).toContain("initiatorDomains: [initiatorDomain]")
    expect(worker).toContain("resourceTypes: ['sub_frame']")
    expect(worker).toContain("header: 'x-frame-options'")
    expect(worker).toContain("header: 'content-security-policy'")
    expect(worker).toContain('RULE_TTL_MS')
    expect(worker).not.toContain('document.cookie')
  })
})
