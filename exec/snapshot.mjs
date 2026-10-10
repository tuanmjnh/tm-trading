// exec/snapshot.mjs
// Immutable market snapshots at DECISION points (roadmap §14 + §26.3 — the AI
// dataset foundation). One row per approved ENTRY decision, keyed by the alert
// (snapshotId = `snap:${alertKey}`) so a crash-replay can never duplicate it
// (D3) and a re-emitted same-alert context upserts instead of overwriting (D4:
// $setOnInsert — the FIRST observation is the fact, later runs never rewrite).
//
// PURE core (no IO, no clock of its own): every input is passed in. `snapshotHash`
// fingerprints the CONTEXT (venue/symbol/bar/quote/indicators/regime) — the
// decision outcome rides alongside, it is the label, not part of the fingerprint.
//
// Honesty (D12): when the pipeline has no indicator outputs / regime, those
// fields stay null/[] — never fabricated. `dataQuality.ageMs` measures how old
// OUR observed kline was at decision time, the honest staleness of our data.
import { createHash } from 'node:crypto'

/** Version stamp (D1) — bump whenever the snapshot shape changes meaningfully. */
export const SNAPSHOT_SCHEMA_VERSION = 'snapshot.v1'
/** Snapshot kinds we record (the paper executor writes entry + exit decisions). */
export const SNAPSHOT_KIND = Object.freeze({ entryDecision: 'entry-decision', exitDecision: 'exit-decision' })

/** Natural key (D3): one snapshot per alert, idempotent across crash replays. */
export function snapshotIdFor(alertKey) {
  return `snap:${String(alertKey ?? '').trim()}`
}

/**
 * sha256 of the stable JSON fingerprint of the CONTEXT parts. Deterministic:
 * the same parts always hash the same, so snapshots can be grouped/deduped by
 * market context regardless of the decision outcome.
 */
export function snapshotHash(parts) {
  const canon = JSON.stringify(sortDeep(parts))
  return createHash('sha256').update(canon).digest('hex')
}

/** Recursive key sort so JSON.stringify is order-independent. */
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v !== null && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k])
    return out
  }
  return v
}

const fin = (v) => Number.isFinite(Number(v)) && Number(v) > 0
const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/** Copy a kline bar into the snapshot shape; returns null if it has no usable close. */
export function barOf(kline) {
  if (!kline || !fin(kline.close)) return null
  return {
    open: numOrNull(kline.open) ?? kline.close,
    high: numOrNull(kline.high) ?? kline.close,
    low: numOrNull(kline.low) ?? kline.close,
    close: Number(kline.close),
    volume: numOrNull(kline.volume) ?? 0,
    time: numOrNull(kline.time),
    state: 'closed', // recorders only capture CLOSED bars (D20)
  }
}

/**
 * Build a validated `market_snapshots` doc, or return null on a malformed input
 * — null is the honest answer for "this can never be a snapshot".
 *
 * @param {object} args
 *   alertKey, symbol, venue, clockTime (Number ms UTC),
 *   timeframe?, bar? ({open,high,low,close,volume,time}), quote? ({last,time,
 *   bid?,ask?}), indicators? (unknown), methods?: string[], regime?: unknown,
 *   dataQuality? ({source,lastSeenMs,ageMs}), decision ({ok,code,message,
 *   side?,qty?,notional?})
 */
export function snapshotRecord(args = {}) {
  const { alertKey, symbol, venue } = args
  const clockTime = Number(args.clockTime)
  if (!alertKey || !symbol || !venue) return null
  if (!Number.isFinite(clockTime) || clockTime <= 0) return null
  if (!args.decision || typeof args.decision !== 'object') return null

  const instrumentId = `${String(venue)}:${String(symbol)}`
  const bar = args.bar ? barOf(args.bar) : null
  const last = Number(args.quote?.last)
  const quote = args.quote && Number.isFinite(args.quote.time)
    ? { last: fin(last) ? last : null, bid: numOrNull(args.quote.bid), ask: numOrNull(args.quote.ask), time: Number(args.quote.time) }
    : null
  const lastSeenMs = args.dataQuality?.lastSeenMs ?? bar?.time ?? quote?.time ?? null

  const contextHash = snapshotHash({
    venue, symbol, timeframe: args.timeframe ?? null,
    bar, quote, indicators: args.indicators ?? null, regime: args.regime ?? null,
  })

  return {
    snapshotId: snapshotIdFor(alertKey),
    snapshotHash: contextHash,
    kind: Object.values(SNAPSHOT_KIND).includes(args.kind) ? args.kind : SNAPSHOT_KIND.entryDecision,
    instrumentId,
    venue: String(venue),
    symbol: String(symbol),
    timeframe: args.timeframe ?? null,
    clockTime,
    bar,
    quote,
    indicators: args.indicators ?? null, // honest: null when not computed
    methods: Array.isArray(args.methods) ? [...args.methods] : [],
    regime: args.regime ?? null,
    dataQuality: {
      source: args.dataQuality?.source ?? 'unknown',
      lastSeenMs,
      ageMs: Number.isFinite(lastSeenMs) ? clockTime - lastSeenMs : null,
    },
    decision: {
      ok: Boolean(args.decision.ok),
      code: String(args.decision.code ?? ''),
      message: String(args.decision.message ?? ''),
      side: args.decision.side ?? null,
      qty: numOrNull(args.decision.qty),
      notional: numOrNull(args.decision.notional),
    },
    alertKey: String(alertKey),
    strategyVersionId: null, // honest: no strategy version catalog yet
    modelVersion: SNAPSHOT_SCHEMA_VERSION,
  }
}

/**
 * Persist ONE decision snapshot. Fail-soft (the ledger is evidence, never the
 * choke point): a missing model or a write error logs, never throws. $setOnInsert
 * keeps the first recorded observation immutable across crash replays (D4).
 * @returns {Promise<{wrote:boolean}|null>} null when the model is absent
 */
export async function recordDecisionSnapshot(model, doc) {
  if (!model) return null
  if (!doc?.snapshotId) return null
  try {
    const res = await model.updateOne(
      { snapshotId: doc.snapshotId },
      { $setOnInsert: doc },
      { upsert: true },
    )
    return { wrote: Boolean(res?.upsertedCount) }
  } catch (e) {
    console.warn(`[snapshot] record error ${doc.snapshotId}: ${e?.message || e}`)
    return { wrote: false }
  }
}