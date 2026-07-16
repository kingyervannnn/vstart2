import { describe, expect, it } from 'vitest'

import { deriveVoiceWaveform, QUIET_VOICE_LEVEL, quietVoiceWaveform } from './voiceWaveform.js'

describe('voice waveform sampling', () => {
  it('stays flat for a silent microphone signal', () => {
    const levels = deriveVoiceWaveform(new Uint8Array(128).fill(128), quietVoiceWaveform(), 8)
    expect(levels).toEqual(Array(8).fill(QUIET_VOICE_LEVEL))
  })

  it('responds to measured time-domain amplitude rather than random values', () => {
    const samples = new Uint8Array([128, 132, 138, 148, 170, 148, 138, 132])
    const first = deriveVoiceWaveform(samples, quietVoiceWaveform(8), 8)
    const second = deriveVoiceWaveform(samples, first, 8)

    expect(first[0]).toBe(QUIET_VOICE_LEVEL)
    expect(first[4]).toBeGreaterThan(first[2])
    expect(second[4]).toBeGreaterThan(first[4])
  })

  it('smoothly decays to quiet after speech stops', () => {
    const loud = deriveVoiceWaveform(new Uint8Array(8).fill(255), quietVoiceWaveform(8), 8)
    const decaying = deriveVoiceWaveform(new Uint8Array(8).fill(128), loud, 8)

    expect(decaying[0]).toBeLessThan(loud[0])
    expect(decaying[0]).toBeGreaterThan(QUIET_VOICE_LEVEL)
  })
})
