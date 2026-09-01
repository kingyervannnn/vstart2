/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/missionGlance.js', async (importOriginal) => ({
  ...await importOriginal(),
  missionGlanceApi: { snapshot: vi.fn() },
}))

import { missionGlanceApi } from '../lib/missionGlance.js'
import { MissionGlanceWidget } from './MissionGlanceWidget.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('MissionGlanceWidget', () => {
  it('shows live branch, dirty count, relative commit, recent dot, and a truncated subject', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-29T12:00:00.000Z'))
    const longSubject = 'Add a deliberately long Mission Glance commit subject that cannot overrun the narrow widget rail'
    missionGlanceApi.snapshot.mockResolvedValue({ projects: [{
      path: '/Users/vbitzx/SS/trucking saas',
      name: 'trucking saas',
      available: true,
      branch: 'feat/dispatch-board',
      dirtyCount: 3,
      lastCommit: { committedAt: '2026-08-29T09:00:00.000Z', subject: longSubject },
    }] })

    render(<MissionGlanceWidget paths={['/Users/vbitzx/SS/trucking saas']} />)

    expect(await screen.findByText('feat/dispatch-board')).toBeInTheDocument()
    expect(screen.getByText('3 changes')).toBeInTheDocument()
    expect(screen.getByText('3h ago')).toBeInTheDocument()
    expect(screen.getByLabelText('Committed in the last 24 hours')).toBeInTheDocument()
    const subject = screen.getByTitle(longSubject)
    expect(subject.textContent.endsWith('…')).toBe(true)
    expect(subject.textContent.length).toBeLessThanOrEqual(72)
    expect(missionGlanceApi.snapshot).toHaveBeenCalledWith(['/Users/vbitzx/SS/trucking saas'], expect.any(AbortSignal))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders each missing or failed project as unavailable without fake values', async () => {
    missionGlanceApi.snapshot.mockResolvedValue({ projects: [
      { path: '/tmp/ready', name: 'ready', available: true, branch: 'main', dirtyCount: 0, lastCommit: { committedAt: '2026-08-20T12:00:00.000Z', subject: 'Ready' } },
      { path: '/tmp/missing', name: 'missing', available: false },
    ] })
    render(<MissionGlanceWidget paths={['/tmp/ready', '/tmp/missing']} />)

    expect(await screen.findByText('clean')).toBeInTheDocument()
    expect(screen.getByText('missing')).toBeInTheDocument()
    expect(screen.getAllByText('unavailable')).toHaveLength(1)
  })

  it('marks every configured project unavailable when the bridge cannot be reached', async () => {
    missionGlanceApi.snapshot.mockRejectedValue(new Error('bridge down'))
    render(<MissionGlanceWidget paths={['/tmp/one', '/tmp/two']} />)

    expect(await screen.findByText('one')).toBeInTheDocument()
    expect(screen.getByText('two')).toBeInTheDocument()
    expect(screen.getAllByText('unavailable')).toHaveLength(2)
  })
})
