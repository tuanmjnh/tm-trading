// =============================================================================
//  TM TRADING — timeframe maths for the market plane (D22 boundaries).
//
//  Two notations, both UTC-aligned (D2 — day boundaries UTC):
//    engine style: '1', '4', '60'      -> minutes
//    binance style: '1m', '4m', '1h'   -> explicit unit
//  Bucket end is EXCLUSIVE: a '4m' bar covers [openTime, openTime + 4m).
// =============================================================================

const EXPLICIT = /^(\d+)(m|h|d)$/

/** Timeframe -> bucket width in ms. Throws on anything unknown. */
export function tfToMs(tf) {
  const s = String(tf).trim()
  if (s === '') throw new Error(`tf: empty timeframe`)
  if (/^\d+$/.test(s)) {
    const minutes = Number(s)
    if (minutes <= 0) throw new Error(`tf: minutes must be > 0 (got ${s})`)
    return minutes * 60_000
  }
  const m = EXPLICIT.exec(s)
  if (m) {
    const n = Number(m[1])
    if (n <= 0) throw new Error(`tf: unit amount must be > 0 (got ${s})`)
    const unit = m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000
    return n * unit
  }
  throw new Error(`tf: unsupported timeframe "${tf}"`)
}

/** Floor a timestamp onto the bucket that starts at or before it. */
export const alignDown = (ts, tfMs) => Math.floor(Number(ts) / tfMs) * tfMs

/** Exclusive end of the bucket starting at `openTime`. */
export const bucketEnd = (openTime, tfMs) => Number(openTime) + tfMs

/** Close time of a bar (Binance convention: end - 1ms). */
export const closeTimeOf = (openTime, tfMs) => bucketEnd(openTime, tfMs) - 1
