// exec/tradeContext.mjs
// Trade Context (roadmap §26.6) ONE row per COMPLETED paper trade — the
// future AI dataset. It does not re-measure anything: it joins facts the
// pipeline already produced (position + close result + snapshot ids) into one
// addressable document, and keeps honest nulls for everything the pipeline has
// not learned yet (strategyVersionId, regime, funding/OI, news — those become
// non-null when §19/§24 producers land, never before).
//
// PURE core (no IO, no clock). Persistence is fail-soft: the context is the
// research record, never the execution choke point (D33). Idempotency mirrors
// the order layer (D3): `_id = tc:${tradeId}`, and `$setOnInsert` means the
// first close is the fact (D4) — a crash-retried close can never rewrite an
// outcome.
import { snapshotIdFor } from './snapshot.mjs'

export const TRADE_CONTEXT_SCHEMA_VERSION = 'tradeContext.v1'

// null/'' must NEVER become 0 — Number(null)===0 has produced three separate
// bugs in this codebase;tottally refusing coercion is the honest answer.
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** §26.6 natural key. tradeId = the order-layer externalId (clientOrderId). */
export function tradeContextIdFor(tradeId) {
  const id = String(tradeId ?? '').trim()
  return id ? `tc:${id}` : null
}

/**
 * Build a validated `trade_context` doc, or null when the trade is not
 * addressable yet (no id, not closed, prices missing).
 *
 * @param {object} args
 * @param {object} args.position closed position doc (engine positions shape)
 * @param {object} args.close    { exitPrice, exitTime (ms|Date), exitReason,
 *                                 pnlAbs, pnlPct, fees (measured round-trip) }
 * @param {string|null} [args.venue]        `binance:fapi` etc — null when unknown
 * @param {number} args.now                 record clock (caller-owned clock)
 */
export function tradeContextRecord({ position, close, venue = null, now } = {}) {
  if (!position || !close) return null
  const tradeId = position.externalId || (position._id ? `pos:${String(position._id)}` : null)
  const tradeContextId = tradeContextIdFor(tradeId)
  if (!tradeContextId) return null
  if (position.status && position.status !== 'closed') return null

  const exitPrice = num(close.exitPrice)
  if (exitPrice === null) return null // a trade with an unpriced exit is not a fact

  const entryTimeMs = +new Date(position.entryTime)
  const exitTimeMs = +new Date(close.exitTime)
  const pnlAbs = num(close.pnlAbs)

  const entrySnapshotId = position.signalKey ? snapshotIdFor(position.signalKey) : null
  const exitSnapshotId = position.signalKey ? snapshotIdFor(`${position.signalKey}#exit`) : null

  return {
    _id: tradeContextId,
    tradeContextId,
    tradeId,
    accountId: position.account ?? null,

    // --- §26.6 identity: never guessed --------------------------------------
    strategyVersionId: position.strategyVersionId ?? null, // §29: from the position, written at open time (null = never declared — stays honest)
    method: position.method ?? null,
    stamp: position.stamp
      ? { engineVersion: position.stamp.engineVersion ?? null, paramsHash: position.stamp.paramsHash ?? null, kind: position.stamp.kind ?? 'unknown' }
      : { engineVersion: null, paramsHash: position.stampUnknown ? 'unknown' : null, kind: 'unknown' },
    symbol: position.symbol,
    venue: venue ? String(venue) : null,
    timeframe: position.tf ?? null,
    direction: position.dir === 1 ? 'long' : position.dir === -1 ? 'short' : null,

    // --- entry / exit snapshots (§14/§26.3) ----------------------------------
    entrySnapshotId,
    exitSnapshotId,

    // Honest until §19/§24 producers fill them — never fabricated:
    indicators: null,
    marketRegime: null,
    fundingOi: null,
    newsContext: null,

    // --- execution metrics (facts from the fill model + position) ------------
    execution: {
      entryPrice: num(position.entryPrice),
      entryTime: Number.isFinite(entryTimeMs) ? entryTimeMs : null,
      qty: num(position.qty),
      orderType: position.orderType ?? null,
      entrySlippageBps: num(position.slippage),
      exitPrice,
      exitTime: Number.isFinite(exitTimeMs) ? exitTimeMs : null,
      exitReason: close.exitReason ?? position.exitReason ?? 'unknown',
      fees: num(close.fees),
      holdMs: Number.isFinite(entryTimeMs) && Number.isFinite(exitTimeMs) ? exitTimeMs - entryTimeMs : null,
    },

    // --- outcome ---------------------------------------------------------------
    outcome: {
      state: pnlAbs === null ? 'unknown' : pnlAbs > 0 ? 'win' : pnlAbs < 0 ? 'loss' : 'flat',
      pnlAbs,
      pnlPct: num(close.pnlPct),
    },

    recordedAt: num(now),
    schemaVersion: TRADE_CONTEXT_SCHEMA_VERSION,
  }
}

/**
 * Persist ONE trade context. Fail-soft + idempotent ($setOnInsert, D4:
 * the first close is the fact). @returns {Promise<{wrote:boolean}|null>}
 */
export async function recordTradeContext(model, doc) {
  if (!model || !doc?.tradeContextId) return null
  try {
    const res = await model.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true })
    return { wrote: Boolean(res?.upsertedCount) }
  } catch (e) {
    console.warn(`[tradeContext] record error ${doc.tradeContextId}: ${e?.message || e}`)
    return { wrote: false }
  }
}