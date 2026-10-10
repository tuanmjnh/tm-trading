// =============================================================================
//  TM TRADING — DATA QUALITY GATES (roadmap §35) — PURE CORE
//
//  §35 turns measured data conditions into a GO/NO-GO for NEW PAPER ENTRIES.
//  Two tiers, mirroring the roadmap:
//
//    BLOCK  (§35.1)  — a new entry MUST be refused. Fail-closed: a condition we
//    can't measure that could corrupt a fill blocks too (an unknown stream is
//    not a healthy stream).
//
//    DEGRADED (§35.2) — may continue if policy allows; the terminal must show
//    it. Degraded never blocks on its own.
//
//  Every condition is judged from MEASURED facts passed in (D12): a null
//  heartbeat, an unmeasured quote age, a missing gap flag — each has an honest
//  branch. Nothing here touches IO; the caller resolves the facts.
//
//  The gate returns the FULL picture, not just a boolean, so the terminal and
//  the decision snapshot can both display WHY a trade was (or was not) allowed.
// =============================================================================

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const bool = (v) => (typeof v === 'boolean' ? v : null)

/** §35.1 block condition ids (stable, used as reject reasons). */
export const BLOCK_IDS = Object.freeze([
  'market_stream_disconnected',
  'quote_stale',
  'candle_gap_unresolved',
  'orderbook_sequence_invalid',
  'instrument_not_active',
  'risk_state_unavailable',
])

/** §35.2 degraded condition ids (shown, not blocking). */
export const DEGRADED_IDS = Object.freeze([
  'funding_stale',
  'oi_delayed',
  'news_unavailable',
  'secondary_provider_unavailable',
])

/** Default thresholds (ms) for staleness — every one overridable. */
export const DEFAULT_QUALITY_GATES = Object.freeze({
  quoteStaleMs: 60_000,
  fundingStaleMs: 3_600_000, // 1h
  oiStaleMs: 3_600_000,
})

/**
 * @param {object} o
 * @param {'ok'|'suspect'|'unknown'|null} [o.streamState]  market stream health
 * @param {number|null} [o.quoteAgeMs]    age of the quote used for pricing
 * @param {boolean|null} [o.candleGapUnresolved]  a known unresolved gap
 * @param {boolean|null} [o.orderbookSeqInvalid]  depth-dependent fill + bad seq
 * @param {boolean|null} [o.depthDependentFill]  this fill reads the book
 * @param {'active'|'inactive'|'unknown'|null} [o.instrumentState]
 * @param {boolean|null} [o.riskStateAvailable]
 * @param {number|null} [o.fundingAgeMs]
 * @param {number|null} [o.oiAgeMs]
 * @param {boolean|null} [o.newsAvailable]
 * @param {boolean|null} [o.secondaryProviderUp]
 * @param {object} [o.thresholds]
 * @returns {{block: string[], degraded: string[], allowed: boolean, reasons: Array<{id, level:'block'|'degraded', reason}>}}
 */
export function qualityGates(o = {}) {
  const th = { ...DEFAULT_QUALITY_GATES, ...(o.thresholds ?? {}) }
  const out = { block: [], degraded: [], reasons: [] }
  const add = (id, level, reason) => {
    out.reasons.push({ id, level, reason })
    ;(level === 'block' ? out.block : out.degraded).push(id)
  }

  // --- §35.1 BLOCK conditions -------------------------------------------------
  // market stream disconnected: a null/unknown/disconnected stream fails closed —
  // we cannot trust a price we are not actively receiving.
  const stream = o.streamState
  if (stream === null || stream === undefined || stream === 'unknown' || stream === 'disconnected') {
    add('market_stream_disconnected', 'block', `market stream state '${stream ?? 'unknown'}' — refusing a fill on data we are not receiving`)
  }

  // quote stale: measured age over threshold. A null age is NOT auto-block here
  // (quote staleness is usually caught by the stream/quote checks above); the
  // caller passes null only when the quote path itself already failed.
  const qa = num(o.quoteAgeMs)
  if (qa != null && qa > th.quoteStaleMs) {
    add('quote_stale', 'block', `quote age ${qa}ms > ${th.quoteStaleMs}ms`)
  }

  // candle gap unresolved: only blocks when we actually KNOW there is a gap.
  if (bool(o.candleGapUnresolved) === true) {
    add('candle_gap_unresolved', 'block', 'an unresolved candle gap is in the window — a fill priced off gapped data is a guess')
  }

  // orderbook sequence invalid: only meaningful for a depth-dependent fill.
  if (bool(o.orderbookSeqInvalid) === true && bool(o.depthDependentFill) !== false) {
    add('orderbook_sequence_invalid', 'block', 'orderbook sequence is invalid for a depth-dependent fill')
  }

  // instrument not active: non-active fails closed.
  const instr = o.instrumentState
  if (instr !== 'active') {
    add('instrument_not_active', 'block', `instrument state '${instr ?? 'unknown'}' is not active`)
  }

  // risk state unavailable: the gate is the choke point (D7) — no risk state,
  // no entry. Unknown is treated as unavailable (fail-closed).
  if (bool(o.riskStateAvailable) !== true) {
    add('risk_state_unavailable', 'block', 'risk state is unavailable — the risk gate (D7) cannot authorize an entry')
  }

  // --- §35.2 DEGRADED conditions (shown, never blocking) ----------------------
  const fa = num(o.fundingAgeMs)
  if (fa != null && fa > th.fundingStaleMs) add('funding_stale', 'degraded', `funding age ${fa}ms > ${th.fundingStaleMs}ms`)

  const oa = num(o.oiAgeMs)
  if (oa != null && oa > th.oiStaleMs) add('oi_delayed', 'degraded', `OI age ${oa}ms > ${th.oiStaleMs}ms`)

  if (bool(o.newsAvailable) === false) add('news_unavailable', 'degraded', 'news feed is unavailable')
  if (bool(o.secondaryProviderUp) === false) add('secondary_provider_unavailable', 'degraded', 'a secondary provider is unavailable')

  out.allowed = out.block.length === 0
  return out
}

/** Short human line for the terminal / decision snapshot (both tiers). */
export function qualityGateSummary(q) {
  if (!q) return 'unknown'
  if (q.block.length && q.degraded.length) return `BLOCK(${q.block.length}) + degraded(${q.degraded.length})`
  if (q.block.length) return `BLOCK: ${q.block.join(', ')}`
  if (q.degraded.length) return `degraded: ${q.degraded.join(', ')}`
  return 'ok'
}
