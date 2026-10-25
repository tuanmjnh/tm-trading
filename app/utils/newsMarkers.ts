import type { IntelNewsItem } from '#shared/types/intel'
import type { MarketEventPublic } from '#shared/types/news'

// =============================================================================
//  Symbol-linked news markers (V3.5 §60 Slice D) — PURE helpers.
//
//  Maps certain-linked MarketEvents onto the IntelNewsItem shape TradeChart
//  already renders (no chart changes). Rules:
//  - retracted events are EXCLUDED (a withdrawn story must never mark a chart);
//  - only certain entity links mark (uncertain links stay on the News Desk);
//  - level is always 'med' (blue circle): corroboration is not impact, and
//    severity scoring belongs to extraction (Slice D), not markers.
// =============================================================================

const QUOTES = ['USDT', 'USDC', 'USD', 'BUSD', 'TUSD', 'FDUSD', 'EUR', 'BTC', 'ETH']

/** Base asset of a trading symbol: 'BTCUSDT.P' -> 'BTC', 'ETHUSDT' -> 'ETH'. */
export function baseAssetOf(symbol: string): string {
  let s = String(symbol || '').toUpperCase().replace(/\.P$|\.PERP$|_PERP$/i, '').replace(/[-_/]/g, '')
  for (const q of QUOTES) {
    if (s.length > q.length && s.endsWith(q)) return s.slice(0, -q.length)
  }
  return ''
}

/** Event -> chart marker (null when the event must not mark). */
export function eventToMarker(e: MarketEventPublic, base: string): IntelNewsItem | null {
  if (!e || e.status === 'retracted') return null
  const link = (e.entities || []).find((en) => !en.uncertain && en.symbol === base)
  if (!link) return null
  const dirs = e.dirs || (e.corroboration as unknown as { dirs?: string[] })?.dirs || []
  const pos = dirs.filter((d) => d === 'pos').length
  const neg = dirs.filter((d) => d === 'neg').length
  return {
    title: e.title,
    link: `event:${e.id}`,
    source: (e.sourceIds || [])[0] || 'events',
    level: 'med',
    dir: pos > neg ? 'pos' : neg > pos ? 'neg' : 'flat',
    tags: [],
    score: 0,
    ts: e.firstSeenAt || e.lastSeenAt || '',
    excerpt: '',
  }
}

/** Merge intel markers + event markers, deduped by link (intel wins ties). */
export function mergeNewsMarkers(intel: IntelNewsItem[], events: IntelNewsItem[]): IntelNewsItem[] {
  const seen = new Set((intel || []).map((n) => n.link))
  const extra = (events || []).filter((n) => n.link && !seen.has(n.link))
  return [...(intel || []), ...extra]
}
