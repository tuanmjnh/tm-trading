// market/crossScanner.mjs
// Cross-Exchange Scanner (roadmap §36): compares canonical instruments
// across venues. Returns OBSERVED differences — NEVER a guaranteed arbitrage
// (D12). Pure core: given venue quotes/funding/OI, computes the numbers.
//
// Venue adapters (extensible): each implements `fetch({symbol, venue})` returning
// { quote, funding, oi } in canonical units. Null = venue doesn't have it.
//
// Canonical instrument schema (§26):
//   { symbol: 'BTC/USDT', type: 'perp', venues: [{venue:'binance', native:'BTCUSDT'}, {venue:'bybit', native:'BTCUSDT'}] }
//
// Usage:
//   const scan = await scanAll(instruments, { binance: binanceAdapter, bybit: bybitAdapter })
//   // scan = [{ instrument, symbol, venues: { binance: {...}, bybit: {...} }, spreads: {...} }]

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export const SCANNER_VERSION = 'crossScanner.v1'

/** Relative spread between two prices. Returns null if either is null or base is 0. */
export function relSpread(a, b) {
  const x = num(a), y = num(b)
  if (x === null || y === null || x === 0) return null
  return Math.abs(x - y) / x
}

/** Absolute spread. */
export function absSpread(a, b) {
  const x = num(a), y = num(b)
  if (x === null || y === null) return null
  return Math.abs(x - y)
}

/** Compare two venues for one instrument. Returns all §36 metrics. */
export function compareVenues(v1, v2, { label1, label2 } = {}) {
  const q1 = v1?.quote ?? {}
  const q2 = v2?.quote ?? {}
  const f1 = v1?.funding ?? {}
  const f2 = v2?.funding ?? {}
  const o1 = v1?.oi ?? {}
  const o2 = v2?.oi ?? {}

  return {
    [label1 ?? 'venue1']: { quote: q1.last ?? q1, funding: f1.rate ?? f1, oi: o1.value ?? o1 },
    [label2 ?? 'venue2']: { quote: q2.last ?? q2, funding: f2.rate ?? f2, oi: o2.value ?? o2 },
    quote: {
      absolute: absSpread(q1.last, q2.last),
      relative: relSpread(q1.last, q2.last),
      bidAsk: { absSpread: absSpread(q1.bid, q2.ask), relSpread: relSpread(q1.bid, q2.ask) },
    },
    funding: {
      absolute: absSpread(f1.rate, f2.rate),
      relative: relSpread(f1.rate, f2.rate),
    },
    oi: {
      absolute: absSpread(o1.value, o2.value),
      relative: relSpread(o1.value, o2.value),
    },
  }
}

/**
 * Scan ALL instruments across provided venues.
 * `instruments`: array of { symbol, type, venues: [{venue, native}] }
 * `adapters`: { [venue]: { fetch: async ({symbol, native}) => { quote, funding, oi } } }
 * Returns array of { instrument, symbol, venues: { [venue]: { quote, funding, oi, error } }, comparisons: { [pair]: {...} } }
 */
export async function scanAll(instruments, adapters, { concurrency = 6 } = {}) {
  const out = []
  for (const inst of instruments ?? []) {
    const sym = inst.symbol
    const venues = inst.venues ?? []
    const venueData = {}
    const errors = []

    // Fetch all venues for this instrument (bounded concurrency)
    const sem = Math.min(concurrency, venues.length)
    const queue = [...venues]
    const running = new Set()

    const runOne = async (v) => {
      const { venue, native } = v
      const adapter = adapters[venue]
      if (!adapter) {
        errors.push({ venue, reason: 'no adapter registered' })
        return
      }
      try {
        const data = await adapter.fetch({ symbol: sym, native })
        venueData[venue] = data
      } catch (e) {
        errors.push({ venue, reason: e?.message || String(e) })
      }
    }

    // Simple bounded runner
    while (queue.length || running.size) {
      while (queue.length && running.size < sem) {
        const v = queue.shift()
        running.add(v)
        runOne(v).finally(() => running.delete(v))
      }
      if (running.size) await new Promise((r) => setTimeout(r, 50))
    }

    // Build pairwise comparisons
    const venueNames = Object.keys(venueData)
    const comparisons = {}
    for (let i = 0; i < venueNames.length; i++) {
      for (let j = i + 1; j < venueNames.length; j++) {
        const a = venueNames[i], b = venueNames[j]
        comparisons[`${a}_${b}`] = compareVenues(venueData[a], venueData[b], { label1: a, label2: b })
      }
    }

    out.push({
      instrument: sym,
      type: inst.type ?? 'perp',
      venues: venueData,
      errors,
      comparisons,
      scannedAt: Date.now(),
    })
  }
  return out
}

/**
 * Format one scan result into the terminal table (roadmap §36 example).
 * `BTC/USDT PERP` → `Binance 120,100  Bybit 120,115  OKX 120,108`
 */
export function formatScanLine(result) {
  const sym = result.instrument
  const type = result.type?.toUpperCase() ?? 'PERP'
  const parts = [`${sym} ${type}`]
  for (const [venue, data] of Object.entries(result.venues)) {
    const q = data?.quote?.last ?? data?.quote
    if (q != null) parts.push(`${venue.toUpperCase()} ${Number(q).toLocaleString()}`)
  }
  return parts.join('  ')
}

/**
 * Top N widest relative spreads across all scans (for alerting/terminal).
 */
export function topSpreads(scans, { metric = 'quote.relative', limit = 10 } = {}) {
  const rows = []
  for (const s of scans ?? []) {
    for (const [pair, cmp] of Object.entries(s.comparisons ?? {})) {
      // metric may be dotted: 'quote.relative' -> cmp.quote.relative
      const path = String(metric).split('.')
      let val = cmp
      for (const key of path) {
        val = val?.[key]
        if (val == null) break
      }
      val = num(val)
      if (val != null) rows.push({ instrument: s.instrument, pair, spread: val })
    }
  }
  return rows.sort((a, b) => b.spread - a.spread).slice(0, limit)
}