import { describe, expect, it } from 'vitest'

import { EnvironmentBridgeError, LightCliService, lightStateFromStatus } from './light-cli-service.mjs'

function fakeRunner() {
  let action = 'OFF'
  const calls = []
  const run = async (args) => {
    calls.push(args)
    if (args[0] === 'config') return { code: 0, stdout: JSON.stringify({
      channels: { warm_white: { levels: [0, 20, 80] }, ultraviolet: { levels: [0, 35, 65] } },
      ui: { default_channel: 'warm_white', channel_labels: { ultraviolet: 'UV' }, channel_colors: { ultraviolet: '#b46cff' } },
    }), stderr: '' }
    if (args[0] === 'status') return { code: 0, stdout: JSON.stringify({ action, ok: true, at: '2026-07-16T00:00:00Z' }), stderr: '' }
    action = args[0] === 'off' ? 'OFF' : args[0] === 'on' ? 'warm_white 80' : `${args[0]} ${args[1]}`
    return { code: 0, stdout: JSON.stringify({ action, ok: true }), stderr: '' }
  }
  return { run, calls }
}

describe('LightCliService', () => {
  it('derives colors and exact intensities from live CLI capabilities', async () => {
    const fake = fakeRunner()
    const service = new LightCliService({ runner: fake.run })
    const snapshot = await service.snapshot()
    expect(snapshot.devices[0].capabilities.channels).toEqual([
      { id: 'warm_white', name: 'Warm White', levels: [20, 80], swatch: '#ffd6a3' },
      { id: 'ultraviolet', name: 'UV', levels: [35, 65], swatch: '#b46cff' },
    ])
  })

  it('validates commands against current capabilities', async () => {
    const fake = fakeRunner()
    const service = new LightCliService({ runner: fake.run })
    const result = await service.setLight('ultraviolet', 65)
    expect(fake.calls).toContainEqual(['ultraviolet', '65', '--json'])
    expect(result.devices[0].state).toMatchObject({ power: true, channel: 'ultraviolet', level: 65 })
    await expect(service.setLight('ultraviolet', 50)).rejects.toBeInstanceOf(EnvironmentBridgeError)
  })

  it('normalizes CLI status without exposing trigger details', () => {
    expect(lightStateFromStatus({ action: 'OFF', ok: true })).toMatchObject({ power: false, level: 0 })
    expect(lightStateFromStatus({ action: 'Preset blue_50', ok: true })).toMatchObject({ power: true, channel: 'blue', level: 50 })
  })
})
