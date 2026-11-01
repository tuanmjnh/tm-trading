import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  OUTBOX READ-MODEL LOADER (V4.2 §7.3)
//
//  Thin shell over `notify/outbox.mjs`, mirroring `server/utils/operations.ts`.
//  The outbox decision layer lives in `notify/`, which Nitro cannot statically
//  bundle from `server/`, so the model is imported through an absolute file URL
//  with `@vite-ignore` — the same pattern `server/utils/intel.ts` uses for
//  `services/heartbeat.mjs` and `operations.ts` uses for `services/*.mjs`.
//
//  Read-only by design. The only mutation here is `replay`, which is an
//  operator action (dead letter -> queued) audited through the caller.
// =============================================================================

type OutboxMod = typeof import('../../notify/outbox.mjs')

let outboxModPromise: Promise<OutboxMod> | null = null

function outboxMod(): Promise<OutboxMod> {
  if (!outboxModPromise) {
    const file = pathToFileURL(join(process.cwd(), 'notify', 'outbox.mjs')).href
    outboxModPromise = import(/* @vite-ignore */ file) as Promise<OutboxMod>
  }
  return outboxModPromise
}

async function outbox() {
  const mod = await outboxMod()
  const { getNotificationOutbox } = await import('../../services/store.mjs')
  const model = await getNotificationOutbox()
  // @ts-ignore
  return mod.createOutbox({ model })
}

/**
 * Outbox counters per state, plus the dead-letter subset.
 *
 * Mongo down -> empty counts with `mongo: 'down'` (fail-soft, never 500).
 */
export async function loadOutboxStats(ownerId?: string | null): Promise<{ stats: Record<string, number>, dead: unknown[], mongo: 'up' | 'down', error?: string }> {
  try {
    const ob = await outbox()
    const [stats, dead] = await Promise.all([
      ob.stats({ ownerId: ownerId ?? undefined }),
      // @ts-ignore
      ob.deadLetters({ limit: 100, ownerId: ownerId ?? undefined }),
    ])
    return { stats, dead, mongo: 'up' }
  } catch (e: any) {
    return { stats: {}, dead: [], mongo: 'down', error: String(e?.message || e) }
  }
}

/**
 * Move one dead letter back into the queue for retry.
 *
 * Returns the Mongo update result, or null when the id is unknown / Mongo is
//  down. The caller is responsible for validating the id shape.
 */
export async function replayOutbox(id: string): Promise<{ matchedCount: number, modifiedCount: number } | null> {
  if (typeof id !== 'string' || id.length > 200 || !/^[A-Za-z0-9:_-]+$/.test(id)) return null
  try {
    const ob = await outbox()
    const res = await ob.replay(id)
    if (!res) return null
    return { matchedCount: Number(res.matchedCount) || 0, modifiedCount: Number(res.modifiedCount) || 0 }
  } catch {
    return null
  }
}