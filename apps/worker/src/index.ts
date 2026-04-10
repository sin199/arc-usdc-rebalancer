import { createExecutionEngineFromEnv } from './engine'
import { createExecutionServer } from './server'

async function main() {
  const { engine, config } = await createExecutionEngineFromEnv()
  const port = Number(process.env.EXECUTION_API_PORT ?? 8787)

  const server = createExecutionServer(engine, config)

  await new Promise<void>((resolve) => {
    server.listen(port, resolve)
  })

  console.log(`[worker] listening on http://127.0.0.1:${port}`)
  console.log(`[worker] mode=${config.mode} balanceOverride=${config.balanceOverrideUsdc ?? 'chain'}`)

  const tickNow = async (triggerSource: 'schedule' | 'manual' | 'approval' | 'startup') => {
    try {
      await engine.refreshSnapshot(triggerSource)
    } catch (error) {
      console.error('[worker] tick failed', error)
    }
  }

  void tickNow('startup')
  const interval = setInterval(() => {
    void tickNow('schedule')
  }, config.pollIntervalMs)

  const shutdown = async () => {
    clearInterval(interval)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

void main().catch((error) => {
  console.error('[worker] fatal error', error)
  process.exit(1)
})
