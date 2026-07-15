#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const LABEL = 'com.vstart.mail-bridge'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entrypoint = join(projectRoot, 'mail-bridge/index.mjs')
const launchAgentsDir = join(homedir(), 'Library/LaunchAgents')
const plistPath = join(launchAgentsDir, `${LABEL}.plist`)
const logDir = join(homedir(), 'Library/Logs/VStart2')
const stdoutLog = join(logDir, 'mail-bridge.log')
const stderrLog = join(logDir, 'mail-bridge.error.log')
const domain = `gui/${process.getuid()}`
const serviceTarget = `${domain}/${LABEL}`

const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(LABEL)}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(entrypoint)}</string></array>
  <key>WorkingDirectory</key><string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>VSTART_MAIL_BRIDGE_PORT</key><string>3130</string>
    <key>VSTART_MAILCTL_PATH</key><string>/Users/vbitzx/SS/TOOLS/bin/mailctl</string>
    <key>PATH</key><string>${xml(`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(stdoutLog)}</string>
  <key>StandardErrorPath</key><string>${xml(stderrLog)}</string>
</dict></plist>
`
}

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      const result = { code: code ?? 1, stdout, stderr }
      if (result.code === 0 || allowFailure) resolveRun(result)
      else rejectRun(new Error(stderr.trim() || `${command} exited with ${result.code}`))
    })
  })
}

async function isLoaded() {
  return (await run('/bin/launchctl', ['print', serviceTarget], { allowFailure: true })).code === 0
}

async function bootstrap() {
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await run('/bin/launchctl', ['bootstrap', domain, plistPath])
      return
    } catch (error) {
      lastError = error
      await new Promise((resolveWait) => setTimeout(resolveWait, 250 * (attempt + 1)))
    }
  }
  throw lastError
}

async function install() {
  await mkdir(launchAgentsDir, { recursive: true })
  await mkdir(logDir, { recursive: true })
  await writeFile(plistPath, plist(), { encoding: 'utf8', mode: 0o600 })
  await chmod(plistPath, 0o600)
  if (await isLoaded()) await run('/bin/launchctl', ['bootout', serviceTarget], { allowFailure: true })
  await bootstrap()
  process.stdout.write(`Installed and started ${LABEL}\n`)
}

async function start({ restart = false } = {}) {
  try { await readFile(plistPath) } catch { throw new Error('Mail Bridge is not installed. Run: npm run mail:bridge:manage -- install') }
  if (!(await isLoaded())) await bootstrap()
  else if (restart) await run('/bin/launchctl', ['kickstart', '-k', serviceTarget])
  process.stdout.write(`${restart ? 'Restarted' : 'Started'} ${LABEL}\n`)
}

async function stop() {
  if (await isLoaded()) await run('/bin/launchctl', ['bootout', serviceTarget])
  process.stdout.write(`Stopped ${LABEL}\n`)
}

async function uninstall() {
  if (await isLoaded()) await run('/bin/launchctl', ['bootout', serviceTarget], { allowFailure: true })
  try { await unlink(plistPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  process.stdout.write(`Uninstalled ${LABEL}\n`)
}

async function status() {
  let installed = true
  try { await readFile(plistPath) } catch { installed = false }
  const loaded = await isLoaded()
  process.stdout.write(`${JSON.stringify({ label: LABEL, installed, loaded, plistPath, logDir }, null, 2)}\n`)
  process.exitCode = loaded ? 0 : 1
}

const command = process.argv[2]
if (command === 'install') await install()
else if (command === 'start') await start()
else if (command === 'restart') await start({ restart: true })
else if (command === 'stop') await stop()
else if (command === 'status') await status()
else if (command === 'print-plist') process.stdout.write(plist())
else if (command === 'uninstall') await uninstall()
else process.stdout.write('Usage: node mail-bridge/launchd.mjs <install|start|restart|stop|status|print-plist|uninstall>\n')
