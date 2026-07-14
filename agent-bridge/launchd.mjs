#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const LABEL = 'com.vstart.agent-bridge'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entrypoint = join(projectRoot, 'agent-bridge/index.mjs')
const launchAgentsDir = join(homedir(), 'Library/LaunchAgents')
const plistPath = join(launchAgentsDir, `${LABEL}.plist`)
const logDir = join(homedir(), 'Library/Logs/VStart2')
const stdoutLog = join(logDir, 'agent-bridge.log')
const stderrLog = join(logDir, 'agent-bridge.error.log')
const domain = `gui/${process.getuid()}`
const serviceTarget = `${domain}/${LABEL}`

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
  <string>${xml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(entrypoint)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VSTART_AGENT_DEFAULT_CWD</key>
    <string>${xml(projectRoot)}</string>
    <key>VSTART_AGENT_BRIDGE_PORT</key>
    <string>3120</string>
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

async function isLoaded() {
  const result = await run('/bin/launchctl', ['print', serviceTarget], { allowFailure: true })
  return result.code === 0
}

async function install() {
  await mkdir(launchAgentsDir, { recursive: true })
  await mkdir(logDir, { recursive: true })
  await writeFile(plistPath, plist(), { encoding: 'utf8', mode: 0o600 })
  await chmod(plistPath, 0o600)
  if (await isLoaded()) await run('/bin/launchctl', ['bootout', serviceTarget], { allowFailure: true })
  await run('/bin/launchctl', ['bootstrap', domain, plistPath])
  process.stdout.write(`Installed and started ${LABEL}\n`)
  process.stdout.write(`Logs: ${stdoutLog}\n`)
}

async function start() {
  try {
    await readFile(plistPath)
  } catch {
    throw new Error(`Agent Bridge is not installed. Run: npm run agent:bridge:manage -- install`)
  }
  if (!(await isLoaded())) await run('/bin/launchctl', ['bootstrap', domain, plistPath])
  else await run('/bin/launchctl', ['kickstart', '-k', serviceTarget])
  process.stdout.write(`Started ${LABEL}\n`)
}

async function stop() {
  if (await isLoaded()) await run('/bin/launchctl', ['bootout', serviceTarget])
  process.stdout.write(`Stopped ${LABEL}\n`)
}

async function restart() {
  try {
    await readFile(plistPath)
  } catch {
    throw new Error(`Agent Bridge is not installed. Run: npm run agent:bridge:manage -- install`)
  }
  if (await isLoaded()) await run('/bin/launchctl', ['kickstart', '-k', serviceTarget])
  else await run('/bin/launchctl', ['bootstrap', domain, plistPath])
  process.stdout.write(`Restarted ${LABEL}\n`)
}

async function uninstall() {
  if (await isLoaded()) await run('/bin/launchctl', ['bootout', serviceTarget], { allowFailure: true })
  try {
    await unlink(plistPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  process.stdout.write(`Uninstalled ${LABEL}; logs were retained in ${logDir}\n`)
}

async function status() {
  const loaded = await isLoaded()
  let installed = true
  try {
    await readFile(plistPath)
  } catch {
    installed = false
  }
  process.stdout.write(JSON.stringify({ label: LABEL, installed, loaded, plistPath, logDir }, null, 2) + '\n')
  process.exitCode = loaded ? 0 : 1
}

async function logs(follow) {
  await mkdir(logDir, { recursive: true })
  await run('/usr/bin/tail', [follow ? '-f' : '-n', follow ? stdoutLog : '100', ...(follow ? [] : [stdoutLog, stderrLog])], {
    inherit: true,
    allowFailure: true,
  })
}

function help() {
  process.stdout.write(`Usage: node agent-bridge/launchd.mjs <command>\n\n`)
  process.stdout.write(`Commands: install, start, stop, restart, status, logs, logs-follow, print-plist, uninstall\n`)
}

const command = process.argv[2]
if (command === 'install') await install()
else if (command === 'start') await start()
else if (command === 'stop') await stop()
else if (command === 'restart') await restart()
else if (command === 'status') await status()
else if (command === 'logs') await logs(false)
else if (command === 'logs-follow') await logs(true)
else if (command === 'print-plist') process.stdout.write(plist())
else if (command === 'uninstall') await uninstall()
else help()
