// services/newsExtract.mjs
// =============================================================================
//  LLM extraction runner (V3.5 §60 Slice D/E) — versioned model assessments.
//
//  Eligible per run: recent `high` or multi-source items WITHOUT an `llm:*`
//  assessment yet (set semantics — a rerun never re-spends budget on the same
//  item). Budget cap per run (NEWS_EXTRACT_BUDGET, default 10); NEWS_EXTRACT=0
//  disables. No AI key -> skipped cleanly (same pattern as the AI brief).
//  Every model row is humanReviewRequired and coexists with rule-v1 —
//  versions never overwrite each other.
//
//  Injection safety: the extractor chat call carries NO tools, and
//  parseAndValidate() rejects fabricated citations/invented tickers before
//  anything is stored (engine/newsExtractLlm.mjs).
// =============================================================================
import { connectMongo } from '../engine/db.mjs'
import { buildExtractionPrompt, parseAndValidate } from '../engine/newsExtractLlm.mjs'

export const EXTRACT_BUDGET = Math.max(0, Number(process.env.NEWS_EXTRACT_BUDGET || 10))
export const EXTRACT_WINDOW_HOURS = Math.max(1, Number(process.env.NEWS_EXTRACT_WINDOW_H || 72))

/**
 * Pick eligible items: recent high/multi-source, no llm assessment yet.
 * Pure over plain rows (offline-testable).
 */
export function pickEligible({ items = [], eventsByItem = {}, assessedIds = new Set(), budget = EXTRACT_BUDGET }) {
  const out = []
  const ranked = [...items].sort((a, b) => {
    const score = (x) => (x.level === 'high' ? 2 : 1) + (eventsByItem[x._id]?.corroboration?.status === 'multi_source' ? 2 : 0)
    return score(b) - score(a)
  })
  for (const it of ranked) {
    if (out.length >= budget) break
    const id = String(it._id)
    if (assessedIds.has(id)) continue
    const ev = eventsByItem[id] || null
    const multi = ev?.corroboration?.status === 'multi_source'
    if (it.level !== 'high' && !multi) continue
    out.push({ item: it, event: ev })
  }
  return out
}

/**
 * One run. chatImpl defaults to the real gateway (tools=[] always).
 * @returns summary (heartbeat lastSummary)
 */
export async function runNewsExtract({
  chatImpl = null,
  now = new Date(),
  budget = EXTRACT_BUDGET,
  modelVersion = null,
  deps = {},
} = {}) {
  if (process.env.NEWS_EXTRACT === '0') return { skipped: 'disabled', extracted: 0, rejected: 0 }
  const mg = deps.mongo !== undefined ? deps.mongo : await connectMongo()
  if (!mg) return { skipped: 'mongo-down', extracted: 0, rejected: 0 }
  const [{ NewsItem }, { MarketEvent }, { NewsAssessment }] = await Promise.all([
    deps.NewsItem ? { NewsItem: deps.NewsItem } : import('../engine/models/newsItem.mjs'),
    deps.MarketEvent ? { MarketEvent: deps.MarketEvent } : import('../engine/models/marketEvent.mjs'),
    deps.NewsAssessment ? { NewsAssessment: deps.NewsAssessment } : import('../engine/models/newsAssessment.mjs'),
  ])
  const since = new Date(now.getTime() - EXTRACT_WINDOW_HOURS * 3600 * 1000)
  const items = await NewsItem.find({ ingestedAt: { $gte: since } }).sort({ ingestedAt: -1 }).limit(200).lean()
  if (!items.length) return { skipped: 'no-items', extracted: 0, rejected: 0 }
  const events = await MarketEvent.find({ lastSeenAt: { $gte: since } }).limit(200).lean()
  const eventsByItem = {}
  for (const e of events) {
    for (const id of e.itemIds || []) {
      if (!eventsByItem[id]) {
        eventsByItem[id] = {
          _id: String(e._id), corroboration: e.corroboration, status: e.status,
          eventType: e.eventType, marketGroup: e.marketGroup,
        }
      }
    }
  }
  const assessed = await NewsAssessment.find({
    sourceItemId: { $in: items.map((i) => String(i._id)) },
    extractorModelVersion: /^llm:/,
  }).select({ sourceItemId: 1 }).lean()
  const assessedIds = new Set(assessed.map((a) => String(a.sourceItemId)))
  const eligible = pickEligible({ items, eventsByItem, assessedIds, budget })
  if (!eligible.length) return { skipped: 'nothing-eligible', extracted: 0, rejected: 0 }

  let chat = chatImpl
  let version = modelVersion
  if (!chat) {
    const gw = await import('../ai/gateway.mjs')
    if (!gw.aiConfig().apiKey) return { skipped: 'no-key', extracted: 0, rejected: 0 }
    version = version || gw.aiConfig().model
    chat = (messages) => gw.chat(messages, [], { tag: '[news-extract]' })
  }
  version = version || 'test-model'

  let extracted = 0
  let rejected = 0
  const failures = []
  for (const { item, event } of eligible) {
    try {
      const { system, user } = buildExtractionPrompt(item, event)
      const res = await chat([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ])
      const text = typeof res === 'string' ? res : res?.text || res?.content || JSON.stringify(res)
      const verdict = parseAndValidate(text, item, event, version, now.getTime())
      if (!verdict.ok) {
        rejected += 1
        failures.push(`${item._id}: ${verdict.reason}`)
        continue
      }
      await NewsAssessment.updateOne(
        { _id: verdict.assessment._id },
        { $setOnInsert: verdict.assessment },
        { upsert: true },
      )
      extracted += 1
    } catch (e) {
      rejected += 1
      failures.push(`${item._id}: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  return { extracted, rejected, failures: failures.slice(0, 10), model: version }
}
