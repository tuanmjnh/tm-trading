// =============================================================================
//  Scanner candidate merge (roadmap §58.5 /markets/scanner) — PURE function only.
//
//  Projects the scanner service snapshots (intel `mover` / `flow` / `accum`) into
//  ONE symbol-centric candidate list, joined to the canonical Instrument Catalog
//  by venue-native or engine symbol. No fetching, no recalculation (D1): every
//  metric is what services/scanner.mjs already stored.
// =============================================================================
import type { IntelData, IntelFlow } from '~~/types/intel'
import type { Instrument } from '~~/types/instruments'

/** The scanner-service snapshot a candidate was detected in. */
export type ScannerSignal = 'mover' | 'flow' | 'accum'

export interface ScannerCandidate {
  symbol: string
  /** Which scanner snapshots flagged this symbol (one or more). */
  signals: ScannerSignal[]
  pct24h: number
  chg4h: number | null
  lastPrice: number | null
  quoteVolume: number | null
  atrPct: number | null
  breakout: boolean
  /** Flow direction when the symbol also appears in the `flow` snapshot. */
  flowDir: IntelFlow['dir'] | null
  /** Flow score (0 when there is no flow hit). */
  score: number
  /** Max volRatio across the flow/accum snapshots (context for the spike). */
  volRatio: number | null
  /** De-duplicated union of flow + accum reasons. */
  reasons: string[]
  /** Canonical catalog instrument when the symbol maps to one. */
  instrument: Instrument | null
}

function matchInstrument(instruments: Instrument[], symbol: string): Instrument | null {
  for (const inst of instruments) {
    if (inst.engineSymbol === symbol) return inst
    if (inst.venues.some((v) => v.native === symbol)) return inst
  }
  return null
}

/**
 * Merge scanner-service snapshots into a single candidate list. Symbols are
 * keyed by venue-native symbol; a symbol flagged by several snapshots keeps the
 * richest metrics (mover 24h change wins over flow/accum). Sorted by flow score
 * desc, then |24h change| desc. Pure — safe to unit-test without a runtime (D1).
 */
export function mergeScannerCandidates(
  intel: Pick<IntelData, 'movers' | 'flows' | 'accums'> | null,
  instruments: Instrument[] = []
): ScannerCandidate[] {
  const map = new Map<string, ScannerCandidate>()
  const ensure = (symbol: string): ScannerCandidate => {
    let c = map.get(symbol)
    if (!c) {
      c = {
        symbol,
        signals: [],
        pct24h: 0,
        chg4h: null,
        lastPrice: null,
        quoteVolume: null,
        atrPct: null,
        breakout: false,
        flowDir: null,
        score: 0,
        volRatio: null,
        reasons: [],
        instrument: null
      }
      map.set(symbol, c)
    }
    return c
  }

  for (const m of intel?.movers ?? []) {
    const c = ensure(m.symbol)
    c.signals.push('mover')
    c.pct24h = m.pct24h
    c.chg4h = m.chg4h
    c.lastPrice = m.lastPrice
    c.quoteVolume = m.quoteVolume
    c.atrPct = m.atrPct
    c.breakout = m.breakout
  }

  for (const f of intel?.flows ?? []) {
    const c = ensure(f.symbol)
    c.signals.push('flow')
    c.flowDir = f.dir
    c.score = f.score
    c.volRatio = Math.max(c.volRatio ?? 0, f.volRatio)
    c.reasons.push(...f.reasons)
    if (!c.signals.includes('mover')) c.pct24h = f.pct24h
  }

  for (const a of intel?.accums ?? []) {
    const c = ensure(a.symbol)
    c.signals.push('accum')
    c.volRatio = Math.max(c.volRatio ?? 0, a.volRatio)
    c.reasons.push(...a.reasons)
    if (!c.signals.includes('mover') && !c.signals.includes('flow')) c.pct24h = a.pct24h
  }

  const out = [...map.values()]
  for (const c of out) {
    c.reasons = [...new Set(c.reasons)]
    c.instrument = matchInstrument(instruments, c.symbol)
  }
  return out.sort((a, b) => (b.score - a.score) || (Math.abs(b.pct24h) - Math.abs(a.pct24h)))
}
