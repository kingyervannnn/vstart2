export const VOICE_WAVEFORM_BAR_COUNT = 28
export const QUIET_VOICE_LEVEL = 0.06

export function deriveVoiceWaveform(samples, previous = [], barCount = VOICE_WAVEFORM_BAR_COUNT) {
  if (!samples?.length || barCount < 1) return Array.from({ length: Math.max(0, barCount) }, () => QUIET_VOICE_LEVEL)
  return Array.from({ length: barCount }, (_, index) => {
    const sampleIndex = barCount === 1
      ? Math.floor(samples.length / 2)
      : Math.round((index / (barCount - 1)) * (samples.length - 1))
    const measured = Math.min(1, Math.abs(samples[sampleIndex] - 128) / 42)
    const prior = Number.isFinite(previous[index]) ? previous[index] : QUIET_VOICE_LEVEL
    return Math.max(QUIET_VOICE_LEVEL, prior * 0.52 + measured * 0.48)
  })
}

export function quietVoiceWaveform(barCount = VOICE_WAVEFORM_BAR_COUNT) {
  return Array.from({ length: barCount }, () => QUIET_VOICE_LEVEL)
}
