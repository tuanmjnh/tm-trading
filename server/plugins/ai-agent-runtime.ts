import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  Embedded AI Agent runtime (roadmap §59.15 / §59.16 / ADR-002).
//
//  Drives the autonomous heartbeat and proposal cycle for all active AI agents
//  so that agents report live health, assess realtime market state, and generate
//  proposals without needing manual CLI execution.
// =============================================================================

const INTERVAL_MS = Math.max(15_000, Number(process.env.AI_AGENT_INTERVAL || 30_000) || 30_000)

interface AiWorkerLike {
  tick(): Promise<{ ok: boolean, error?: string, activeCount?: number, cycles?: unknown[] }>
  start(): void
  stop(): void
}

interface AiWorkerModule {
  createAiAgentWorker(opts?: { intervalMs?: number, log?: unknown }): AiWorkerLike
}

let workerModule: AiWorkerModule | null = null

async function loadAiWorker(): Promise<AiWorkerModule | null> {
  if (!workerModule) {
    const href = pathToFileURL(join(process.cwd(), 'services', 'aiAgentWorker.mjs')).href
    workerModule = (await import(/* @vite-ignore */ `${href}?t=${Date.now()}`)) as AiWorkerModule
  }
  return workerModule
}

export default defineNitroPlugin((nitro) => {
  // Opt out if explicitly disabled
  if (process.env.AI_AGENT_EMBEDDED === 'off') {
    console.log('[ai-agent-runtime] embedded AI agent runner disabled (AI_AGENT_EMBEDDED=off)')
    return
  }

  const log = {
    log: (...a: unknown[]) => console.log('[ai-agent-runtime]', ...a),
    warn: (...a: unknown[]) => console.warn('[ai-agent-runtime]', ...a),
    error: (...a: unknown[]) => console.error('[ai-agent-runtime]', ...a)
  }

  let worker: AiWorkerLike | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let initialTimer: ReturnType<typeof setTimeout> | null = null

  async function initAndTick() {
    try {
      const mod = await loadAiWorker()
      if (!mod) return
      if (!worker) {
        worker = mod.createAiAgentWorker({ intervalMs: INTERVAL_MS, log })
      }
      await worker.tick()
    } catch (err) {
      log.warn('AI worker tick error:', err)
    }
  }

  initialTimer = setTimeout(() => {
    log.log(`embedded AI agent runtime enabled (interval=${Math.round(INTERVAL_MS / 1000)}s)`)
    void initAndTick()
  }, 5_000)

  timer = setInterval(() => {
    void initAndTick()
  }, INTERVAL_MS)

  nitro.hooks.hook('close', () => {
    if (timer) clearInterval(timer)
    if (initialTimer) clearTimeout(initialTimer)
    worker?.stop()
  })
})
