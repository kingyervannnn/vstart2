#!/usr/bin/env node

import { EnvironmentBridgeHttpServer } from './http-server.mjs'

const port = Number(process.env.VSTART_ENVIRONMENT_BRIDGE_PORT || 3140)
const server = new EnvironmentBridgeHttpServer({ port })
await server.start()
process.stdout.write(`Environment Bridge listening on 127.0.0.1:${server.port}\n`)

const stop = async () => {
  await server.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
