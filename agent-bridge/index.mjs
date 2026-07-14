#!/usr/bin/env node

import process from 'node:process'

import { AgentBridgeService } from './bridge-service.mjs'
import { AgentBridgeHttpServer } from './http-server.mjs'

const port = Number(process.env.VSTART_AGENT_BRIDGE_PORT || 3120)
const service = new AgentBridgeService({ defaultCwd: process.env.VSTART_AGENT_DEFAULT_CWD || process.cwd() })
const server = new AgentBridgeHttpServer({ service, port })

const address = await server.start()
const health = service.health()
process.stdout.write(`V Start Agent Bridge listening on http://127.0.0.1:${address.port} (${health.status})\n`)
if (!health.safe) {
  process.stdout.write('Agent execution is locked until Hermes approvals are enabled.\n')
}

let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await server.stop()
  process.exit(0)
}

process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
