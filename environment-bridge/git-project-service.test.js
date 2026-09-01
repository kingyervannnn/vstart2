import { describe, expect, it, vi } from 'vitest'

import { EnvironmentBridgeError } from './light-cli-service.mjs'
import { GitProjectService, gitDirtyFileCount } from './git-project-service.mjs'

function projectRunner({ branch = 'feat/mission-glance-widget\n', status = '', commit = '1787932800\0Add Mission Glance\n' } = {}) {
  const calls = []
  const run = vi.fn(async (path, args) => {
    calls.push([path, args])
    if (args[0] === 'branch') return { stdout: branch, stderr: '' }
    if (args[0] === 'status') return { stdout: status, stderr: '' }
    return { stdout: commit, stderr: '' }
  })
  return { run, calls }
}

describe('GitProjectService', () => {
  it('passes paths with spaces as one argument and returns typed Git state', async () => {
    const fake = projectRunner({ status: ' M src/App.jsx\0?? new file.md\0' })
    const service = new GitProjectService({ runner: fake.run })
    const path = '/Users/vbitzx/SS/PAYMENT WATCH'

    await expect(service.snapshot([path])).resolves.toEqual({
      projects: [{
        path,
        name: 'PAYMENT WATCH',
        available: true,
        branch: 'feat/mission-glance-widget',
        dirtyCount: 2,
        lastCommit: { committedAt: '2026-08-28T16:00:00.000Z', subject: 'Add Mission Glance' },
      }],
    })
    expect(fake.calls).toEqual([
      [path, ['branch', '--show-current']],
      [path, ['status', '--porcelain=v1', '-z']],
      [path, ['log', '-1', '--format=%ct%x00%s']],
    ])
  })

  it('reports detached HEAD and counts a renamed path once', async () => {
    const fake = projectRunner({ branch: '', status: 'R  new-name\0old-name\0 M tracked\0' })
    const service = new GitProjectService({ runner: fake.run })
    const result = await service.snapshot(['/tmp/project'])
    expect(result.projects[0]).toMatchObject({ branch: 'detached', dirtyCount: 2 })
    expect(gitDirtyFileCount('C  copied\0source\0?? untracked\0')).toBe(2)
  })

  it('renders command failures as unavailable for only that project', async () => {
    const service = new GitProjectService({ runner: async (path) => {
      if (path === '/tmp/missing') throw new Error('not a repository')
      return { stdout: path.endsWith('ok') ? 'main\n' : '', stderr: '' }
    } })
    service.runner = async (path, args) => {
      if (path === '/tmp/missing') throw new Error('not a repository')
      if (args[0] === 'branch') return { stdout: 'main\n', stderr: '' }
      if (args[0] === 'status') return { stdout: '', stderr: '' }
      return { stdout: '1787932800\0Ready\n', stderr: '' }
    }
    const result = await service.snapshot(['/tmp/ok', '/tmp/missing'])
    expect(result.projects[0].available).toBe(true)
    expect(result.projects[1]).toEqual({ path: '/tmp/missing', name: 'missing', available: false })
  })

  it('uses a short per-project cache and refreshes after expiry', async () => {
    let now = 1_000
    const fake = projectRunner()
    const service = new GitProjectService({ runner: fake.run, cacheMs: 50, now: () => now })
    await service.snapshot(['/tmp/project'])
    await service.snapshot(['/tmp/project'])
    expect(fake.run).toHaveBeenCalledTimes(3)
    now = 1_051
    await service.snapshot(['/tmp/project'])
    expect(fake.run).toHaveBeenCalledTimes(6)
  })

  it('rejects malformed or non-absolute project lists', async () => {
    const service = new GitProjectService({ runner: vi.fn() })
    await expect(service.snapshot(['relative/project'])).rejects.toBeInstanceOf(EnvironmentBridgeError)
    await expect(service.snapshot('not-an-array')).rejects.toMatchObject({ code: 'project_paths_invalid' })
  })
})
