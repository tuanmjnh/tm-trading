import { getQuery } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const limit = Math.min(Math.max(Number(getQuery(event).limit) || 8, 1), 30)

  try {
    const store = await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'services', 'signalStore.mjs')).href) as {
      getSignal(): Promise<{ find(f: Record<string, unknown>): { sort(o: Record<string, number>): { limit(n: number): { lean(): Promise<Array<Record<string, unknown>>> } } } | null }>
    }
    const M = await store.getSignal()
    if (!M) return { success: true, data: [] }
    const model = M as { find(f: Record<string, unknown>): { sort(o: Record<string, number>): { limit(n: number): { lean(): Promise<Array<Record<string, unknown>>> } } } }

    const rows = await model
      .find({ ownerId, signalKey: { $ne: null } })
      .sort({ ts: -1 })
      .limit(limit)
      .lean()

    return {
      success: true,
      data: rows.map(r => ({
        signalKey: r.signalKey,
        type: r.type,
        symbol: r.symbol,
        tf: r.tf,
        method: r.method,
        ts: r.ts instanceof Date ? r.ts.getTime() : Number(r.ts),
        price: r.price ?? null
      }))
    }
  } catch {
    return { success: true, data: [] }
  }
})
