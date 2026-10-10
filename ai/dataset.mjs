// ai/dataset.mjs
// AI Dataset Builder (roadmap §27.1): joins COMPLETED trades with their
// market snapshots into a format suitable for AI research (§27.2).
//
// PURE core: it takes hydrated docs and returns a research-ready object.
// Honesty (D12): unhydrated snapshots or missing indicators stay null —
// the dataset is a reflection of evidence, not a fabrication.
//
// @param {object} args {tradeContext, entrySnapshot, exitSnapshot}
export function buildAiTradeRecord({ tradeContext, entrySnapshot = null, exitSnapshot = null } = {}) {
  if (!tradeContext) return null
  const tc = tradeContext
  return {
    tradeId: tc.tradeId,
    identity: {
      symbol: tc.symbol,
      venue: tc.venue,
      timeframe: tc.timeframe,
      direction: tc.direction,
      method: tc.method,
      strategyVersionId: tc.strategyVersionId,
      stamp: tc.stamp,
    },
    context: {
      entry: entrySnapshot ? snapshotToAiContext(entrySnapshot) : null,
      exit: exitSnapshot ? snapshotToAiContext(exitSnapshot) : null,
      marketRegime: tc.marketRegime,
      fundingOi: tc.fundingOi,
      news: tc.newsContext,
    },
    execution: tc.execution,
    outcome: tc.outcome,
    recordedAt: tc.recordedAt,
    schemaVersion: 'aiRecord.v1',
  }
}

/** Simplify a raw market snapshot for AI reading (strips identity/D1 metadata). */
function snapshotToAiContext(s) {
  if (!s) return null
  return {
    clockTime: s.clockTime,
    bar: s.bar, // OHLCV + state:closed
    quote: s.quote,
    indicators: s.indicators, // honest null if not computed
    methods: s.methods,
    regime: s.regime,
    dataQuality: s.dataQuality,
    decision: s.decision,
  }
}

/**
 * Hydrate a list of TradeContext docs with their snapshots from models.
 * Fail-soft: a missing snapshot keeps its field null.
 */
export async function hydrateAiDataset({ tradeContexts = [], models = {} } = {}) {
  const m = models
  if (!m.Snapshot) return tradeContexts.map((tc) => buildAiTradeRecord({ tradeContext: tc }))

  const snapshotIds = new Set()
  for (const tc of tradeContexts) {
    if (tc.entrySnapshotId) snapshotIds.add(tc.entrySnapshotId)
    if (tc.exitSnapshotId) snapshotIds.add(tc.exitSnapshotId)
  }

  const snaps = await m.Snapshot.find({ snapshotId: { $in: Array.from(snapshotIds) } }).lean()
  const snapMap = new Map(snaps.map((s) => [s.snapshotId, s]))

  return tradeContexts.map((tc) => buildAiTradeRecord({
    tradeContext: tc,
    entrySnapshot: snapMap.get(tc.entrySnapshotId) || null,
    exitSnapshot: snapMap.get(tc.exitSnapshotId) || null,
  }))
}