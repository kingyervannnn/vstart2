import { describe, expect, it } from 'vitest'
import { backgroundRotationCandidates, backgroundRotationInterval, backgroundRotationSettings, nextBackgroundId } from './backgroundRotation.js'

const assets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const collections = [{ id: 'folder-1', name: 'Landscapes', assetIds: ['b', 'c', 'missing'] }]

describe('background rotation', () => {
  it('supports broad and folder-specific candidate pools', () => {
    expect(backgroundRotationCandidates({ settings: {}, assets, collections })).toEqual(['a', 'b', 'c'])
    expect(backgroundRotationCandidates({ settings: { backgrounds: { rotation: { scope: 'folder', collectionId: 'folder-1' } } }, assets, collections })).toEqual(['b', 'c'])
  })

  it('uses a workspace pool only when workspace backgrounds are enabled', () => {
    const rotation = { workspaceSettings: { home: { scope: 'workspace' } }, workspacePools: { home: ['c', 'a', 'missing'] } }
    expect(backgroundRotationCandidates({ settings: { backgrounds: { workspaceSpecific: true, rotation } }, assets, collections, workspaceId: 'home' })).toEqual(['c', 'a'])
    expect(backgroundRotationCandidates({ settings: { backgrounds: { workspaceSpecific: false, rotation: { ...rotation, scope: 'workspace' } } }, assets, collections, workspaceId: 'home' })).toEqual([])
  })

  it('resolves independent rotation settings for every workspace', () => {
    const settings = {
      backgrounds: {
        workspaceSpecific: true,
        rotation: {
          enabled: true,
          scope: 'folder',
          intervalMinutes: 60,
          workspaceSettings: {
            home: { enabled: false, scope: 'all', intervalMinutes: 5 },
            work: { enabled: true, scope: 'workspace', intervalMinutes: 30 },
          },
          workspacePools: { work: ['a', 'b'] },
        },
      },
    }

    expect(backgroundRotationSettings(settings, 'home')).toMatchObject({ enabled: false, scope: 'all', intervalMinutes: 5 })
    expect(backgroundRotationSettings(settings, 'work')).toMatchObject({ enabled: true, scope: 'workspace', intervalMinutes: 30 })
    expect(backgroundRotationSettings(settings, 'new-workspace')).toMatchObject({ enabled: false, scope: 'all', intervalMinutes: 15 })
    expect(backgroundRotationSettings(settings)).toMatchObject({ enabled: true, scope: 'folder', intervalMinutes: 60 })
  })

  it('advances cyclically and clamps user intervals', () => {
    expect(nextBackgroundId(['a', 'b', 'c'], 'b')).toBe('c')
    expect(nextBackgroundId(['a', 'b', 'c'], 'c')).toBe('a')
    expect(nextBackgroundId(['a', 'b'], 'missing')).toBe('a')
    expect(backgroundRotationInterval(0)).toBe(1)
    expect(backgroundRotationInterval('30')).toBe(30)
    expect(backgroundRotationInterval(9999)).toBe(1440)
  })
})
