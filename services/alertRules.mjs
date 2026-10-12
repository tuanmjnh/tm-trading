// services/alertRules.mjs
// =============================================================================
//  ALERT RULES service (roadmap §58.5 /alerts; §58.6 Notifications != Alert Rules).
//
//  Evaluates enabled `alert_rules` against the intel event stream (`news`/`alert`
//  events written by the other services) and routes each match through the shared
//  notify/ router (§25). No delivery code lives here — the router decides the
//  channels, send.mjs records every attempt in `notification_logs`.
//
//  DEDUPE (D4): the ledger is the source of truth. Each (rule, event) pair has a
//  stable key (engine/alertRules.ruleEventDedupeKey) and, because the event time
//  is fixed, a stable `_id` in `notification_logs` — so a re-run (or crash restart)
//  can never notify the same event twice. Only NEW events reach the router.
//
//  Fail-soft (D12): Mongo down -> skipped, never a throw.
// =============================================================================
import { getAlertRule, getIntel, getNotificationLog } from './store.mjs'
import { matchRule, ruleEventDedupeKey, notifyKindFor } from '../engine/alertRules.mjs'
import { notifyHash } from '../notify/router.mjs'
import { notify } from '../notify/service.mjs'

const EVENT_LIMIT = 500
const LOOKBACK_MAX_SEC = 30 * 24 * 3600

/** Project an intel doc into the flat event the pure matcher consumes. */
function toEvent(d) {
  const data = d?.data || {}
  const ts = new Date(d?.ts)
  const score = Number.isFinite(Number(d?.score)) ? Number(d.score) : Number.isFinite(Number(data.score)) ? Number(data.score) : null
  return {
    key: String(d?.key ?? ''),
    kind: d?.kind ?? '',
    title: String(d?.title || data.title || ''),
    symbol: d?.symbol || null,
    level: data.level || null,
    dir: data.dir || null,
    source: data.source || null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    score,
    excerpt: String(data.excerpt || ''),
    tsMs: Number.isNaN(ts.getTime()) ? 0 : ts.getTime(),
  }
}

/**
 * One evaluation cycle: load enabled rules + recent events, notify new matches.
 * @returns {Promise<object>} summary (also the heartbeat `lastSummary`)
 */
export async function runAlertRules({ now = Date.now } = {}) {
  const Rule = await getAlertRule()
  const Intel = await getIntel()
  if (!Rule || !Intel) return { skipped: 'mongo-down' }

  const rules = await Rule.find({ enabled: true }).lean()
  if (!rules.length) return { rules: 0, events: 0, matched: 0, notified: 0 }

  const Log = await getNotificationLog()

  const lookback = Math.min(
    Math.max(...rules.map((r) => Number(r.lookbackSec) || 0), 3600),
    LOOKBACK_MAX_SEC,
  )
  const since = new Date(now() - lookback * 1000)
  const kinds = [...new Set(rules.map((r) => r.kind))]
  const docs = await Intel.find({ kind: { $in: kinds }, ts: { $gte: since } })
    .sort({ ts: -1 })
    .limit(EVENT_LIMIT)
    .lean()
  const events = docs.map(toEvent)

  let matched = 0
  let notified = 0
  const stats = new Map()

  for (const rule of rules) {
    for (const ev of events) {
      if (!matchRule(rule, ev)) continue
      matched++

      const dedupeKey = ruleEventDedupeKey(rule, ev)
      const at = ev.tsMs || now()
      const logId = `nl:${notifyHash(dedupeKey)}:${at}`

      // Already routed this (rule, event) -> the ledger says so; skip delivery.
      if (Log) {
        try {
          const seen = await Log.exists({ _id: logId })
          if (seen) continue
        } catch { /* dedupe check is best-effort; never block on it */ }
      }

      let emitted = false
      try {
        const res = await notify({
          kind: notifyKindFor(rule.kind),
          priority: rule.priority,
          name: rule.name,
          title: `[${rule.name}] ${ev.title}`.slice(0, 300),
          body: `${ev.source ? `${ev.source} · ` : ''}${ev.excerpt || ev.title}`.slice(0, 500),
          symbol: ev.symbol || undefined,
          dedupeKey,
          at,
        })
        emitted = Boolean(res) && !res.deduped
      } catch { emitted = false }
      if (emitted) notified++

      const id = String(rule._id)
      const s = stats.get(id) || { matches: 0, notified: 0, lastMatchAt: null }
      s.matches++
      if (emitted) {
        s.notified++
        s.lastMatchAt = new Date(at)
      }
      stats.set(id, s)
    }
  }

  for (const [id, s] of stats.entries()) {
    try {
      await Rule.updateOne(
        { _id: id },
        {
          $inc: { 'stats.matches': s.matches, 'stats.notified': s.notified },
          $set: { 'stats.lastRunAt': new Date(now()), ...(s.lastMatchAt ? { 'stats.lastMatchAt': s.lastMatchAt } : {}) },
        },
      )
    } catch { /* stats are a read model — best-effort (D12) */ }
  }

  return { rules: rules.length, events: events.length, matched, notified }
}
