import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentBridgeService } from './bridge-service.mjs'

afterEach(() => {
  vi.useRealTimers()
})

describe('AgentBridgeService recovery', () => {
  it('keeps retrying a WebUI connection after a transient startup failure', async () => {
    vi.useFakeTimers()
    let clientsCreated = 0
    let stoppedClients = 0
    const service = new AgentBridgeService({
      connection: {
        mode: 'webui',
        remoteUrl: 'http://127.0.0.1:8788',
        password: 'test-password',
        source: 'injected',
      },
      maxRestartAttempts: 0,
      webuiFactory: () => {
        clientsCreated += 1
        const attempt = clientsCreated
        return {
          async start() {
            if (attempt === 1) throw new Error('temporary DNS failure')
          },
          async stop() {
            stoppedClients += 1
          },
        }
      },
    })

    await service.start()
    expect(service.health()).toMatchObject({ status: 'degraded', backend: 'webui', restartAttempts: 1 })

    await vi.advanceTimersByTimeAsync(1_000)

    expect(clientsCreated).toBe(2)
    expect(stoppedClients).toBe(1)
    expect(service.health()).toMatchObject({ status: 'ready', safe: true, backend: 'webui', restartAttempts: 0 })
    await service.stop()
  })
})
