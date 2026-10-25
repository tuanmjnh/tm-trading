import type { IntelNewsItem } from '#shared/types/intel'
import { engineModel } from './engineModel'
import { toNews } from './intel'

// =============================================================================
//  READ the intel `news` event stream for the News Calendar — roadmap §58.5.
//
//  Read-only, no recompute (D1): the model + connection come from the engine,
//  shared with intel.ts / signals.ts (memo + fail-soft). Mongo khong ket noi
//  duoc -> 200 + meta.mongo='down' + mang rong (khong 500).
// =============================================================================

export interface ListNewsQuery {
  limit: number
  /** Inclusive lower bound (ISO-8601 or epoch ms) on the headline timestamp. */
  since?: string
}

export interface ListNewsResult {
  items: IntelNewsItem[]
  /** Tong so headline khop bo loc, khong tinh `limit`. */
  total: number
  /** ISO time cua headline moi nhat; null khi rong. */
  generatedAt: string | null
  mongo: 'up' | 'down'
}

function parseSince(since?: string): Date | undefined {
  if (!since) return undefined
  const ms = Number(since)
  const t = Number.isFinite(ms) ? ms : Date.parse(since)
  if (Number.isNaN(t)) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidSince', message: `since khong hop le: ${since}` })
  }
  return new Date(t)
}

export async function listNews(q: ListNewsQuery): Promise<ListNewsResult> {
  const Intel = await engineModel('intel.mjs', 'Intel')
  if (!Intel) return { items: [], total: 0, generatedAt: null, mongo: 'down' }

  const since = parseSince(q.since)
  const filter: Record<string, any> = { kind: 'news' }
  if (since) filter.ts = { $gte: since }

  try {
    const docs = await Intel.find(filter).sort({ ts: -1 }).limit(q.limit).lean()
    const total = await Intel.countDocuments(filter)
    const items = docs.map(toNews)
    return { items, total, generatedAt: items[0]?.ts || null, mongo: 'up' }
  } catch {
    // Mat ket noi giua chung -> fail-soft (khong 500) — giong signals/risk.
    return { items: [], total: 0, generatedAt: null, mongo: 'down' }
  }
}
