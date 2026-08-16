#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const label = 'com.vstart.background-sync'
const serviceRoot = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(serviceRoot, '..')
const entrypoint = join(serviceRoot, 'index.mjs')
const helperSource = join(serviceRoot, 'set-wallpaper.swift')
const helperBinary = join(serviceRoot, 'set-wallpaper')
const launchAgentsDirectory = join(homedir(), 'Library', 'LaunchAgents')
const plistPath = join(launchAgentsDirectory, `${label}.plist`)
const logDirectory = join(homedir(), 'Library', 'Logs', 'VStart2')
const stdoutLog = join(logDirectory, 'background-sync.log')
const stderrLog = join(logDirectory, 'background-sync.error.log')
const backgroundDirectory = resolve(process.env.VSTART_BACKGROUND_SYNC_DIRECTORY || join(homedir(), 'SS', 'backgrounds'))
const domain = `gui/${process.getuid()}`
const serviceTarget = `${domain}/${label}`

const xml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(entrypoint)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VSTART_BACKGROUND_SYNC_URL</key>
    <string>http://127.0.0.1:3000</string>
    <key>VSTART_BACKGROUND_SYNC_WORKSPACE</key>
    <string>home</string>
    <key>VSTART_BACKGROUND_SYNC_DIRECTORY</key>
    <string>${xml(backgroundDirectory)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrLog)}</string>
</dict>
</plist>
`
}

function run(command, args, { inherit = false, allowFailure = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      const result = { code: code ?? 1, stdout, stderr }
      if (result.code === 0 || allowFailure) resolveRun(result)
      else rejectRun(new Error(stderr.trim() || `${command} exited with ${result.code}`))
    })
  })
}

async function loaded() {
  return (await run('/bin/launchctl', ['print', serviceTarget], { allowFailure: true })).code === 0
}

async function compileHelper() {
  await run('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'AppKit', '-o', helperBinary, helperSource], { inherit: true })
}

async function install() {
  await mkdir(launchAgentsDirectory, { recursive: true })
  await mkdir(logDirectory, { recursive: true })
  await compileHelper()
  await writeFile(plistPath, plist(), { encoding: 'utf8', mode: 0o600 })
  await chmod(plistPath, 0o600)
  if (await loaded()) await run('/bin/launchctl', ['bootout', serviceTarget], { allowFailure: true })
  await run('/bin/launchctl', ['bootstrap', domain, plistPath])
  process.stdout.write(`Installed and started ${label}\nLogs: ${stdoutLog}\n`)
}

async function restart() {
  await readFile(plistPath)
  await compileHelper()
  if (await loaded()) await run('/bin/launchctl', ['kickstart', '-k', serviceTarget])
  else await run('/bin/launchctl', ['bootstrap', domain, plistPath])
  process.stdout.write(`Restarted ${label}\n`)
}

async function stop() {
  if (await loaded()) await run('/bin/launchctl', ['bootout', serviceTarget])
  process.stdout.write(`Stopped ${label}\n`)
}

async function uninstall() {
  if (await loaded()) await run('/bin/launchctl', ['bootout', serviceTarget], { allowFailure: true })
  try { await unlink(plistPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await unlink(helperBinary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  process.stdout.write(`Uninstalled ${label}; logs were retained in ${logDirectory}\n`)
}

async function status() {
  let installed = true
  try { await readFile(plistPath) } catch { installed = false }
  const isLoaded = await loaded()
  process.stdout.write(`${JSON.stringify({ label, installed, loaded: isLoaded, plistPath, logDirectory }, null, 2)}\n`)
  process.exitCode = isLoaded ? 0 : 1
}

const command = process.argv[2]
if (command === 'install') await install()
else if (command === 'restart') await restart()
else if (command === 'stop') await stop()
else if (command === 'status') await status()
else if (command === 'sync-now') await run(process.execPath, [entrypoint, '--once'], { inherit: true })
else if (command === 'logs') await run('/usr/bin/tail', ['-n', '100', stdoutLog, stderrLog], { inherit: true, allowFailure: true })
else if (command === 'print-plist') process.stdout.write(plist())
else if (command === 'uninstall') await uninstall()
else process.stdout.write('Usage: node background-sync/launchd.mjs <install|restart|stop|status|sync-now|logs|print-plist|uninstall>\n')
