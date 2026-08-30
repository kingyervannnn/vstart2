import { spawn } from 'node:child_process'
import { isAbsolute, basename } from 'node:path'

import { EnvironmentBridgeError } from './light-cli-service.mjs'

const DEFAULT_GIT_PATH = '/usr/bin/git'
const DEFAULT_CACHE_MS = 10_000
const GIT_TIMEOUT_MS = 2_000
const MAX_OUTPUT_BYTES = 128 * 1_024
const MAX_PROJECTS = 20
const MAX_PATH_LENGTH = 4_096

function execute(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const append = (target, chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finish(reject, new EnvironmentBridgeError(502, 'git_output_too_large', 'Git returned too much data'))
        return target
      }
      return target + chunk.toString('utf8')
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(reject, new EnvironmentBridgeError(504, 'git_timeout', 'Git status timed out'))
    }, GIT_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.on('error', (error) => finish(reject, new EnvironmentBridgeError(503, 'git_unavailable', error.message)))
    child.on('close', (code) => {
      if (code === 0) finish(resolve, { stdout, stderr })
      else finish(reject, new EnvironmentBridgeError(502, 'git_failed', stderr.trim() || 'Git status failed'))
    })
  })
}

function dirtyFileCount(output) {
  const records = String(output || '').split('\0')
  let count = 0
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    count += 1
    const status = record.slice(0, 2)
    if (status.includes('R') || status.includes('C')) index += 1
  }
  return count
}

function unavailableProject(path) {
  return { path, name: basename(path) || path, available: false }
}

export class GitProjectService {
  constructor({ gitPath = process.env.VSTART_GIT_PATH || DEFAULT_GIT_PATH, runner, cacheMs = DEFAULT_CACHE_MS, now = () => Date.now() } = {}) {
    this.gitPath = gitPath
    this.runner = runner || ((projectPath, args) => execute(this.gitPath, ['-C', projectPath, ...args]))
    this.cacheMs = cacheMs
    this.now = now
    this.cache = new Map()
  }

  async snapshot(projectPaths) {
    const paths = this.#validatePaths(projectPaths)
    return { projects: await Promise.all(paths.map((path) => this.#cachedProject(path))) }
  }

  #validatePaths(projectPaths) {
    if (!Array.isArray(projectPaths) || projectPaths.length > MAX_PROJECTS) {
      throw new EnvironmentBridgeError(400, 'project_paths_invalid', `Project paths must be an array of at most ${MAX_PROJECTS} entries`)
    }
    return projectPaths.map((value) => {
      if (typeof value !== 'string') throw new EnvironmentBridgeError(400, 'project_path_invalid', 'Every project path must be a string')
      const path = value.trim()
      if (!path || path.length > MAX_PATH_LENGTH || path.includes('\0') || !isAbsolute(path)) {
        throw new EnvironmentBridgeError(400, 'project_path_invalid', 'Every project path must be an absolute path')
      }
      return path
    })
  }

  #cachedProject(path) {
    const cached = this.cache.get(path)
    if (cached && cached.expiresAt > this.now()) return cached.value
    const value = this.#readProject(path).catch(() => unavailableProject(path))
    this.cache.set(path, { expiresAt: this.now() + this.cacheMs, value })
    return value
  }

  async #readProject(path) {
    const [branchResult, statusResult, commitResult] = await Promise.all([
      this.runner(path, ['branch', '--show-current']),
      this.runner(path, ['status', '--porcelain=v1', '-z']),
      this.runner(path, ['log', '-1', '--format=%ct%x00%s']),
    ])
    const separator = commitResult.stdout.indexOf('\0')
    const committedSeconds = Number(commitResult.stdout.slice(0, separator))
    if (separator < 1 || !Number.isFinite(committedSeconds) || committedSeconds <= 0) throw new Error('Last commit is unavailable')
    return {
      path,
      name: basename(path) || path,
      available: true,
      branch: branchResult.stdout.trim() || 'detached',
      dirtyCount: dirtyFileCount(statusResult.stdout),
      lastCommit: {
        committedAt: new Date(committedSeconds * 1_000).toISOString(),
        subject: commitResult.stdout.slice(separator + 1).trim().slice(0, 240),
      },
    }
  }
}

export const gitDirtyFileCount = dirtyFileCount
