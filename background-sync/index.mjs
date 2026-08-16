#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { backgroundRotationCandidates, backgroundRotationSettings, millisecondsUntilNextBackgroundSlot, scheduledBackgroundId } from '../src/lib/backgroundRotation.js'

const serviceRoot = dirname(fileURLToPath(import.meta.url))
const wallpaperHelper = join(serviceRoot, 'set-wallpaper')
const baseUrl = (process.env.VSTART_BACKGROUND_SYNC_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const workspaceSlug = process.env.VSTART_BACKGROUND_SYNC_WORKSPACE || 'home'
const backgroundDirectory = resolve(process.env.VSTART_BACKGROUND_SYNC_DIRECTORY || join(homedir(), 'SS', 'backgrounds'))
const retryDelayMs = 15_000
const prepareLeadMs = 2_000

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectRun)
    child.on('exit', (code) => code === 0
      ? resolveRun({ stdout, stderr })
      : rejectRun(new Error(stderr.trim() || `${command} exited with ${code}`)))
  })
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...options,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(body?.error || `V Start returned ${response.status}`)
    error.status = response.status
    throw error
  }
  return body
}

async function updateWorkspaceBackground(workspace, backgroundAssetId) {
  if (workspace.backgroundAssetId === backgroundAssetId) return false
  const mutationId = `background-sync:${crypto.randomUUID()}`
  try {
    await request(`/api/workspaces/${workspace.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': mutationId,
      },
      body: JSON.stringify({ version: workspace.version, backgroundAssetId, mutationId }),
    })
    return true
  } catch (error) {
    if (error.status !== 409) throw error
    const latest = await request('/api/bootstrap')
    const current = latest.workspaces?.find((candidate) => candidate.id === workspace.id)
    if (current?.backgroundAssetId !== backgroundAssetId) throw error
    return false
  }
}

async function resolveWallpaperPath(asset) {
  const originalName = asset?.originalName || ''
  if (!originalName || basename(originalName) !== originalName) throw new Error('Selected background has no safe source filename')
  const root = await realpath(backgroundDirectory)
  const candidate = await realpath(join(root, originalName))
  if (dirname(candidate) !== root) throw new Error('Selected background is outside the synchronized folder')
  await access(candidate)
  return candidate
}

export async function prepareBackground(now = Date.now()) {
  const bootstrap = await request('/api/bootstrap')
  const workspace = bootstrap.workspaces?.find((candidate) => candidate.slug === workspaceSlug)
  if (!workspace) throw new Error(`Workspace /w/${workspaceSlug} does not exist`)

  const settings = bootstrap.settings?.document || {}
  if (settings.backgrounds?.macDesktopSync?.enabled !== true) {
    return { enabled: false, workspace: workspace.name, intervalMinutes: 1 }
  }
  const rotation = backgroundRotationSettings(settings, workspace.id)
  if (rotation.enabled !== true) throw new Error(`Background rotation is disabled for ${workspace.name}`)
  if (rotation.scope !== 'folder') throw new Error(`Background rotation for ${workspace.name} must use Imported folder`)

  const candidates = backgroundRotationCandidates({
    settings,
    assets: bootstrap.backgroundAssets || [],
    collections: bootstrap.backgroundCollections || [],
    workspaceId: workspace.id,
  })
  if (candidates.length < 2) throw new Error('The synchronized background folder needs at least two database assets')

  const backgroundAssetId = scheduledBackgroundId(candidates, rotation.intervalMinutes, now)
  const asset = bootstrap.backgroundAssets.find((candidate) => candidate.id === backgroundAssetId)
  const wallpaperPath = await resolveWallpaperPath(asset)
  return {
    enabled: true,
    workspace,
    intervalMinutes: rotation.intervalMinutes,
    backgroundAssetId,
    originalName: asset.originalName,
    wallpaperPath,
  }
}

export async function applyPreparedBackground(prepared) {
  if (!prepared.enabled) return prepared
  const [databaseChanged] = await Promise.all([
    updateWorkspaceBackground(prepared.workspace, prepared.backgroundAssetId),
    run(wallpaperHelper, [prepared.wallpaperPath]),
  ])

  return {
    ...prepared,
    workspace: prepared.workspace.name,
    databaseChanged,
  }
}

export async function syncBackground(now = Date.now()) {
  return applyPreparedBackground(await prepareBackground(now))
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}

async function main() {
  let result = null
  while (true) {
    try {
      if (!result) {
        result = await syncBackground()
        process.stdout.write(`${new Date().toISOString()} ${JSON.stringify(result)}\n`)
      }
      if (!result.enabled) {
        await wait(60_000)
        result = null
        continue
      }

      const nextBoundary = Date.now() + millisecondsUntilNextBackgroundSlot(result.intervalMinutes)
      await wait(Math.max(0, nextBoundary - Date.now() - prepareLeadMs))
      const prepared = await prepareBackground(nextBoundary + 1)
      await wait(Math.max(0, nextBoundary - Date.now()))
      result = await applyPreparedBackground(prepared)
      process.stdout.write(`${new Date().toISOString()} ${JSON.stringify(result)}\n`)
    } catch (error) {
      process.stderr.write(`${new Date().toISOString()} ${error.message}\n`)
      result = null
      await wait(retryDelayMs)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--once')) {
    process.stdout.write(`${JSON.stringify(await syncBackground(), null, 2)}\n`)
  } else {
    await main()
  }
}
