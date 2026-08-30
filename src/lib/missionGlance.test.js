import { describe, expect, it } from 'vitest'

import { isRecentCommit, normalizeMissionGlancePaths, relativeCommitTime, truncateCommitSubject } from './missionGlance.js'

describe('Mission Glance helpers', () => {
  it('preserves absolute paths containing spaces while removing invalid duplicates', () => {
    expect(normalizeMissionGlancePaths([
      ' /Users/vbitzx/SS/trucking saas ',
      '/Users/vbitzx/SS/PAYMENT WATCH',
      'relative/path',
      '/Users/vbitzx/SS/trucking saas',
    ])).toEqual(['/Users/vbitzx/SS/trucking saas', '/Users/vbitzx/SS/PAYMENT WATCH'])
  })

  it('formats relative commit ages and recognizes only the last 24 hours as recent', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z')
    expect(relativeCommitTime('2026-08-29T09:00:00.000Z', now)).toBe('3h ago')
    expect(relativeCommitTime('2026-08-27T12:00:00.000Z', now)).toBe('2d ago')
    expect(isRecentCommit('2026-08-28T12:00:01.000Z', now)).toBe(true)
    expect(isRecentCommit('2026-08-28T12:00:00.000Z', now)).toBe(false)
  })

  it('bounds long commit subjects with an ellipsis', () => {
    expect(truncateCommitSubject('A very long commit subject', 12)).toBe('A very long…')
    expect(truncateCommitSubject('Short', 12)).toBe('Short')
  })
})
