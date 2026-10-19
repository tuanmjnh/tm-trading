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
//  IN-APP SIGNALS (§61.17 Phase D): a match ALSO writes a durable, owner-scoped
//  row into `alerts` (the collection the dashboard's Signals view reads), so
//  signals are generated in-app per owner with no dependence on the shared
//  TradingView webhook. Those rows carry `action: null` — inert to the paper
//  executor, which only ever opens a position from an `action: 'ENTRY'` alert.
//
//  Fail-soft (D12): Mongo down -> skipped, never a throw.
// =============================================================================
import { getAlertRule, getIntel, getNotificationLog, getAlert } from './store.mjs'
import { emitTradingEvent } from './workspaceStore.mjs'
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

/** Source tag for rule-generated rows — distinct from the 'tradingview' webhook. */
export const RULE_ALERT_SOURCE = 'alert-rule'

/**
 * Map a matched (rule, event) into a durable `alerts` row for the Signals view.
 * Pure + exported so it is unit-testable without Mongo. `action` is intentionally
 * null: exec/paper.mjs only fires on `action: 'ENTRY'`, so a rule signal can
 * never open a position (D7 — the risk gate owns every entry).
 */
export function toInAppAlertDoc(rule = {}, ev = {}, alertKey = null) {
  const side = ev.dir === 'pos' ? 'BUY' : ev.dir === 'neg' ? 'SELL' : null
  const score = Number(ev.score)
  return {
    ownerId: rule.ownerId ?? null,
    alertKey: alertKey ?? ruleEventDedupeKey(rule, ev),
    source: RULE_ALERT_SOURCE,
    v: 1,
    ts: new Date(ev.tsMs || Date.now()),
    symbol: ev.symbol || null,
    tf: null,
    mode: null,
    action: null,
    level: null,
    side,
    price: null,
    sl: null,
    tps: [],
    atr: null,
    conf: Number.isFinite(score) ? score : null,
    status: 'received',
    raw: JSON.stringify({ rule: rule.name ?? null, kind: ev.kind, title: ev.title, source: ev.source ?? null, tags: ev.tags ?? [] }),
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
  if (!rules.length) return { rules: 0, events: 0, matched: 0, notified: 0, signals: 0 }

  const Log = await getNotificationLog()
  const Alert = await getAlert()

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
  let signals = 0
  const stats = new Map()

  for (const rule of rules) {
    for (const ev of events) {
      if (!matchRule(rule, ev)) continue
      matched++

      const dedupeKey = ruleEventDedupeKey(rule, ev)
      const at = ev.tsMs || now()

      // In-app signal (§61.17 Phase D): durable, owner-scoped `alerts` row the
      // Signals view reads. Idempotent on {ownerId, alertKey}; attempted every
      // cycle so a best-effort miss is retried. Inert to the paper executor.
      if (Alert) {
        try {
          const res = await Alert.updateOne(
            { ownerId: rule.ownerId ?? null, alertKey: dedupeKey },
            { $setOnInsert: toInAppAlertDoc(rule, ev, dedupeKey) },
            { upsert: true },
          )
          signals++
          // New signal only -> one trading event to the outbox (§61.17 Phase C),
          // so the Signals view reconciles without a hard refresh. Idempotent.
          if (res?.upsertedId) {
            await emitTradingEvent({
              type: 'signal.received',
              entityId: dedupeKey,
              ownerId: rule.ownerId ?? null,
              at,
              data: { symbol: ev.symbol ?? null, side: rule.action ?? null },
            })
          }
        } catch { /* best-effort: the notify ledger stays the source of truth */ }
      }

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
          // Tenancy (roadmap §61.3): stamp the audit row with the rule's owner.
          ownerId: rule.ownerId ?? null,
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

  return { rules: rules.length, events: events.length, matched, notified, signals }
}
