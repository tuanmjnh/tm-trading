import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  Embedded Continuous AI Review Runtime (roadmap Phase 13 / ADR-004)
//
//  Autonomously runs periodic trade journal analysis:
//  - Synchronizes closed positions to journal,
//  - Evaluates performance metrics & error taxonomy,
//  - Synthesizes dynamic risk & execution constraints,
//  - Injects lessons directly into active AI trading agents in real-time.
// =============================================================================

const INTERVAL_MS = Math.max(60_000, Number(process.env.AI_REVIEW_INTERVAL || 300_000) || 300_000)

interface ReviewWorkerLike {
  tick(opts?: { force?: boolean }): Promise<{ ok: boolean, error?: string, tradesReviewed?: number, rules?: unknown[] }>
  start(): void
  stop(): void
}

interface ReviewWorkerModule {
  createAiReviewWorker(opts?: { intervalMs?: number, log?: unknown }): ReviewWorkerLike
}

let workerModule: ReviewWorkerModule | null = null

async function loadReviewWorker(): Promise<ReviewWorkerModule | null> {
  if (!workerModule) {
    const href = pathToFileURL(join(process.cwd(), 'services', 'aiReviewWorker.mjs')).href
    workerModule = (await import(/* @vite-ignore */ href)) as ReviewWorkerModule
  }
  return workerModule
}

export default defineNitroPlugin((nitro) => {
  if (process.env.AI_REVIEW_EMBEDDED === 'off') {
    console.log('[ai-review-runtime] embedded AI review runner disabled (AI_REVIEW_EMBEDDED=off)')
    return
  }

  const log = {
    log: (...a: unknown[]) => console.log('[ai-review-runtime]', ...a),
    warn: (...a: unknown[]) => console.warn('[ai-review-runtime]', ...a),
    error: (...a: unknown[]) => console.error('[ai-review-runtime]', ...a)
  }

  let worker: ReviewWorkerLike | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let initialTimer: ReturnType<typeof setTimeout> | null = null

  async function initAndTick() {
    try {
      const mod = await loadReviewWorker()
      if (!mod) return
      if (!worker) {
        worker = mod.createAiReviewWorker({ intervalMs: INTERVAL_MS, log })
      }
      await worker.tick({ force: false })
    } catch (err) {
      log.warn('AI review worker tick error:', err)
    }
  }

  initialTimer = setTimeout(() => {
    log.log(`embedded AI continuous review runtime enabled (interval=${Math.round(INTERVAL_MS / 1000)}s)`)
    void initAndTick()
  }, 10_000)

  timer = setInterval(() => {
    void initAndTick()
  }, INTERVAL_MS)

  nitro.hooks.hook('close', () => {
    if (timer) clearInterval(timer)
    if (initialTimer) clearTimeout(initialTimer)
    worker?.stop()
  })
})
