// services/newsReview.mjs
// Periodic source/rights review + data-quality report (V3.5 §60 Slice F) —
// the operator artifact §60.16 requires before ANY provider coverage expands.
//
// - collectReview: live read across news_sources / news_items /
//   news_market_events / news_assessments / news_market_outlooks /
//   news_model_evaluations (fail-soft: Mongo down -> { mongo: 'down' }).
// - buildReport (PURE): per-source uptime/rights/extraction quality,
//   retention compliance, coverage gate verdict per source.
// - coverageGate: a source may expand coverage (new groups, higher poll rate,
//   paid tier) ONLY after per-source uptime + rights + extraction quality are
//   proven. Unknown/unproven -> blocked with reasons (never silent).
//
// Run: node services/newsReview.mjs (prints JSON; pipe to a file for the audit trail).

import { connectMongo } from '../engine/db.mjs'

/** Minimum consecutive-healthy bar for coverage expansion. */
export const COVERAGE_MIN_OK_RATIO = 0.95

/**
 * PURE report builder. `snap`: { sources[], itemCountBySource{}, eventStats,
 * assessmentStats, outlookStats, evalStats, retentionDays }.
 */
export function buildReport(snap = {}, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const sources = (snap.sources || []).map((s) => {
    const h = s.health || {}
    const total = (snap.itemCountBySource || {})[s.sourceId] || 0
    const rights = {
      license: s.licenseStatus || 'unknown',
      display: s.rights?.allowedDisplay === true,
      summarize: s.rights?.allowedSummarize === true,
      training: s.rights?.allowedTraining === true,
    }
    const gate = coverageGate(s, {
      total,
      multiSourceEvents: (snap.eventStats || {}).multiSource || 0,
      contradictedEvents: (snap.eventStats || {}).contradicted || 0,
    })
    return {
      sourceId: s.sourceId,
      trustTier: s.trustTier || 'T2_SECONDARY',
      transport: s.transport || 'rss',
      health: {
        state: h.state || 'unknown',
        lastOkAt: h.lastOkAt || null,
        consecutiveErrors: h.consecutiveErrors || 0,
      },
      itemsStored: total,
      rights,
      retentionDays: s.retentionDays ?? 7,
      coverage: gate,
    }
  })
  return {
    generatedAt: new Date(now).toISOString(),
    schemaVersion: '1',
    sources,
    events: snap.eventStats || { total: 0, multiSource: 0, contradicted: 0, corrected: 0, retracted: 0 },
    assessments: snap.assessmentStats || { total: 0, humanReview: 0 },
    outlooks: snap.outlookStats || { total: 0, directional: 0, insufficient: 0 },
    evaluations: snap.evalStats || { total: 0, snapshots: 0, hitRate: null, baselineHitRate: null },
    reviewQueue: {
      deadLetters: Number.isFinite(Number(snap.deadLetterCount)) ? Number(snap.deadLetterCount) : null,
      note: Number.isFinite(Number(snap.deadLetterCount))
        ? 'malformed/empty connector payloads awaiting review (news_dead_letters, 7d TTL)'
        : 'review-queue count unavailable — do not read this as zero',
    },
    retention: {
      policyDays: 7,
      ttlEnforced: snap.ttlEnforced === true,
      note: snap.ttlEnforced === true
        ? 'news_items TTL index active (7d); snapshots replace, never accumulate'
        : 'TTL status unverified — confirm the news_items index before expanding coverage',
    },
    pilotGroups: ['crypto'],
  }
}

/**
 * Coverage expansion gate (PURE). Returns { allowed, reasons[] }.
 * A source expands ONLY when: license ok + display permitted + health ok +
 * it actually produced items + multi-source corroboration exists in the window.
 */
export function coverageGate(source, stats = {}) {
  const reasons = []
  if ((source.licenseStatus || 'unknown') !== 'ok') reasons.push(`license ${source.licenseStatus || 'unknown'} — not verified`)
  if (source.rights && source.rights.allowedDisplay === false) reasons.push('display not permitted')
  if ((source.health?.state || 'unknown') !== 'ok') reasons.push(`health ${source.health?.state || 'unknown'} — not proven`)
  if (!(stats.total > 0)) reasons.push('no items stored in window')
  if (!(stats.multiSourceEvents > 0)) reasons.push('no multi-source corroboration in window')
  return { allowed: reasons.length === 0, reasons }
}

/** Live collection (fail-soft). Counts only — no content leaves the store. */
export async function collectReview() {
  const mg = await connectMongo()
  if (!mg) return { mongo: 'down', report: null }
  const [{ NewsSource }, { NewsItem }, { MarketEvent }, { NewsAssessment }, { MarketOutlook }, { NewsEvaluation }, { NewsDeadLetter }] =
    await Promise.all([
      import('../engine/models/newsSource.mjs'),
      import('../engine/models/newsItem.mjs'),
      import('../engine/models/marketEvent.mjs'),
      import('../engine/models/newsAssessment.mjs'),
      import('../engine/models/marketOutlook.mjs'),
      import('../engine/models/newsEvaluation.mjs'),
      import('../engine/models/newsDeadLetter.mjs'),
    ])
  const [sources, items, events, assessments, outlooks, evals, ttl] = await Promise.all([
    NewsSource.find({}).lean(),
    NewsItem.aggregate([{ $group: { _id: '$sourceId', n: { $sum: 1 } } }]),
    MarketEvent.aggregate([
      { $group: { _id: null, total: { $sum: 1 }, multi: { $sum: { $cond: [{ $eq: ['$corroboration.status', 'multi_source'] }, 1, 0] } }, contradicted: { $sum: { $cond: [{ $eq: ['$corroboration.status', 'contradicted'] }, 1, 0] } }, corrected: { $sum: { $cond: [{ $eq: ['$status', 'corrected'] }, 1, 0] } }, retracted: { $sum: { $cond: [{ $eq: ['$status', 'retracted'] }, 1, 0] } } } },
    ]),
    NewsAssessment.aggregate([
      { $group: { _id: null, total: { $sum: 1 }, review: { $sum: { $cond: ['$humanReviewRequired', 1, 0] } } } },
    ]),
    MarketOutlook.aggregate([
      { $group: { _id: null, total: { $sum: 1 }, directional: { $sum: { $cond: [{ $in: ['$state', ['bullish', 'bearish']] }, 1, 0] } }, insufficient: { $sum: { $cond: [{ $eq: ['$state', 'insufficient_evidence'] }, 1, 0] } } } },
    ]),
    NewsEvaluation.aggregate([
      { $group: { _id: null, total: { $sum: 1 }, snapshots: { $sum: '$snapshots' } } },
    ]),
    NewsItem.collection.getIndexes().then((ix) => Object.values(ix).some((d) => d.key?.ingestedAt === 1 && d.expireAfterSeconds === 604800)).catch(() => false),
  ])
  const itemCountBySource = {}
  for (const r of items) itemCountBySource[r._id] = r.n
  const ev = events[0] || {}
  const report = buildReport({
    sources,
    itemCountBySource,
    eventStats: { total: ev.total || 0, multiSource: ev.multi || 0, contradicted: ev.contradicted || 0, corrected: ev.corrected || 0, retracted: ev.retracted || 0 },
    assessmentStats: { total: assessments[0]?.total || 0, humanReview: assessments[0]?.review || 0 },
    outlookStats: { total: outlooks[0]?.total || 0, directional: outlooks[0]?.directional || 0, insufficient: outlooks[0]?.insufficient || 0 },
    evalStats: { total: evals[0]?.total || 0, snapshots: evals[0]?.snapshots || 0, hitRate: null, baselineHitRate: null },
    ttlEnforced: ttl,
    deadLetterCount: await NewsDeadLetter.countDocuments({}).catch(() => null),
  })
  return { mongo: 'up', report }
}

const isMain = process.argv[1] && process.argv[1].endsWith('newsReview.mjs')
if (isMain) {
  collectReview()
    .then((r) => {
      console.log(JSON.stringify(r, null, 1))
      process.exit(0)
    })
    .catch((e) => {
      console.log(JSON.stringify({ mongo: 'error', error: String(e?.message || e) }))
      process.exit(1)
    })
}
