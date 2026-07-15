#!/usr/bin/env node

import process from 'node:process'

import { MailBridgeHttpServer } from './http-server.mjs'

const server = new MailBridgeHttpServer({ port: Number(process.env.VSTART_MAIL_BRIDGE_PORT || 3130) })
const address = await server.start()
process.stdout.write(`V Start Mail Bridge listening on http://127.0.0.1:${address.port} (mailctl)\n`)

let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await server.stop()
  process.exit(0)
}

process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
