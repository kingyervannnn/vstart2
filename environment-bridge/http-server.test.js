import { afterEach, describe, expect, it } from 'vitest'

import { EnvironmentBridgeHttpServer } from './http-server.mjs'

const servers = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.stop())))

async function start(service) {
  const server = new EnvironmentBridgeHttpServer({ service, port: 0 })
  servers.push(server)
  await server.start()
  return `http://127.0.0.1:${server.port}`
}

const origin = 'http://127.0.0.1:3000'

describe('EnvironmentBridgeHttpServer', () => {
  it('publishes a versioned capability snapshot', async () => {
    const base = await start({ snapshot: async () => ({ devices: [{ id: 'room-light' }] }) })
    const response = await fetch(`${base}/v1/environment`, { headers: { origin } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ protocolVersion: 1, devices: [{ id: 'room-light' }] })
  })

  it('accepts only narrow validated light controls', async () => {
    const calls = []
    const base = await start({
      setPower: async (on) => { calls.push(['power', on]); return { devices: [] } },
      setLight: async (channel, level) => { calls.push(['state', channel, level]); return { devices: [] } },
    })
    const power = await fetch(`${base}/v1/lights/room-light/power`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) })
    const state = await fetch(`${base}/v1/lights/room-light/state`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'red', level: 50 }) })
    expect(power.status).toBe(200)
    expect(state.status).toBe(200)
    expect(calls).toEqual([['power', true], ['state', 'red', 50]])
  })

  it('rejects unapproved origins', async () => {
    const base = await start({ snapshot: async () => ({ devices: [] }) })
    const response = await fetch(`${base}/v1/environment`, { headers: { origin: 'https://example.com' } })
    expect(response.status).toBe(403)
  })
})
