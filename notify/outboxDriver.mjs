// notify/outboxDriver.mjs
// Runtime glue for the durable outbox (§7.3): resolve the real sinks + the
// outbox/log models lazily, then enqueue and drain. The decision layers stay
// pure — `router.mjs` (which event, which channel), `policy.mjs` (should this
// recipient get it now), `outbox.mjs` (retry state machine). This file is the
// only one that touches services/ and Mongo, mirroring notify/service.mjs.
//
// Flow:
//   event -> routeEvent -> evaluatePolicy -> outbox.enqueue -> outbox.attempt
//           -> notification_logs (first-attempt audit)
//           -> notification_outbox (current delivery truth, retries, dead letter)
//
// A drain tick retries whatever is due. `accepted` is only ever recorded when
// Telegram returned a message id; otherwise the best we can honestly claim is
// `sent`.
import { routeEvent } from './router.mjs'
import { createOutbox, DEFAULT_OUTBOX_CONFIG } from './outbox.mjs'
import { categoryForEvent, evaluatePolicy } from './policy.mjs'
import { notificationLogDoc } from './send.mjs'
import { sendTelegramMessage } from '../services/telegram.mjs'

export const OUTBOX_DRIVER_VERSION = 'notify-outbox-driver.v1'

/**
 * Render one queue entry as the §7 Telegram message. Pure.
 *
 * Only fields the source actually provided are rendered (§7: "the template must
 * render only fields actually supported by the source"); nothing here can leak a
 * credential because producers only ever set title/body/symbol.
 */
export function formatTelegramMessage(entry = {}) {
  const lines = []
  const head = [entry.symbol, entry.name].filter(Boolean).join(' · ')
  if (head) lines.push(head)
  if (entry.title) lines.push(String(entry.title))
  if (entry.body) lines.push(String(entry.body))
  const meta = []
  if (entry.priority) meta.push(String(entry.priority).toUpperCase())
  if (Number.isFinite(Number(entry.at))) {
    meta.push(`${new Date(Number(entry.at)).toISOString().slice(0, 16).replace('T', ' ')} UTC`)
  }
  if (meta.length) lines.push(meta.join(' · '))
  return lines.join('\n')
}

/**
 * Telegram sink for the outbox. Returns the transport EVIDENCE (not a boolean),
 * so `planAttempt` can distinguish `accepted` from `sent` and decide retryability.
 */
export async function telegramOutboxSink(entry, { fetchImpl } = {}) {
  return sendTelegramMessage(formatTelegramMessage(entry), '[notify]', { fetchImpl })
}

export const DEFAULT_OUTBOX_SINKS = Object.freeze({ telegram: telegramOutboxSink })

async function defaultModels() {
  const { getNotificationOutbox, getNotificationLog } = await import('../services/store.mjs')
  const [outboxModel, logModel] = await Promise.all([getNotificationOutbox(), getNotificationLog()])
  return { outboxModel, logModel }
}

/**
 * Route + policy-gate + queue one event. Returns the routing decision (or null
 * when the router rejected it) plus what the policy decided and what was queued.
 *
 * Never throws (fail-soft, D33). When Mongo is down there is no durable queue, so
 * this degrades to reporting nothing queued rather than losing the caller.
 */
export async function enqueueNotification(event = {}, {
  settings = null,
  state = null,
  sinks = DEFAULT_OUTBOX_SINKS,
  getModels = defaultModels,
  config = {},
  now = Date.now,
  log = console,
} = {}) {
  const route = routeEvent(event)
  if (!route) {
    if (log?.warn) log.warn(`[notify] rejected event (kind/priority not on the ladder) ${JSON.stringify({ kind: event.kind, priority: event.priority, preset: event.preset })}`)
    return null
  }

  const at = Number.isFinite(Number(event.at)) ? Number(event.at) : now()
  // The §7.1 category is stamped on the queue row whether or not a policy is
  // supplied, so the delivery history can always be grouped by category.
  const category = event.category ?? categoryForEvent(event)
  const decision = settings
    ? evaluatePolicy({ event, category, priority: route.priority, at, settings, state: state || {} })
    : { allow: true, reason: 'no-policy', category, digest: false, deferUntil: null, cooldownKey: `${category}:*` }

  const base = { notifyId: route.notifyId, channels: route.channels, priority: route.priority, decision, queued: 0, skipped: [] }

  if (!decision.allow) {
    // A refusal is not a delivery failure: it is an explicit, recorded decision.
    return { ...base, queued: 0, suppressed: true, delivered: [] }
  }

  let outboxModel = null
  let logModel = null
  try {
    ({ outboxModel, logModel } = await getModels())
  } catch (e) {
    if (log?.warn) log.warn(`[notify] models unavailable: ${e?.message || e}`)
  }
  if (!outboxModel) return { ...base, delivered: [], queued: 0, enqueued: false }

  const outbox = createOutbox({ model: outboxModel, now, log, config })
  const { inserted } = await outbox.enqueue({
    event: { ...event, category: decision.category },
    route,
    channels: route.channels,
  })

  // Write the immutable audit row BEFORE attempting: the attempt handler keeps a
  // derived `delivery.<channel>` projection on it, so the row has to exist first
  // for that update to land. D4 identity is preserved (`_id = notifyId:at`), and
  // `$setOnInsert` keeps a replay from rewriting the audit.
  if (logModel) {
    const doc = notificationLogDoc({ event, route, attempts: [], delivered: [], now: now() })
    try {
      await logModel.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true })
    } catch (e) {
      if (log?.warn) log.warn(`[notify] log write error ${route.notifyId}: ${e?.message || e}`)
    }
  }

  // Attempt the newly queued rows straight away so "instant" stays instant; the
  // drain tick only exists for retries.
  const pending = inserted > 0 ? await outbox.due(now(), Math.max(1, route.channels.length)) : []
  const drained = pending.length
    ? await outbox.drain({
      sinks,
      limit: route.channels.length,
      at: now(),
      onOutcome: (entry, updated) => recordDelivery({ logModel, entry, updated, route, now: now(), log }),
    })
    : { attempted: 0, results: [] }

  return {
    ...base,
    queued: inserted,
    enqueued: true,
    delivered: drained.results.filter((r) => r.state === 'accepted' || r.state === 'sent').map((r) => r.channel),
    results: drained.results,
  }
}

/**
 * Keep the ledger's *derived* delivery projection in step with the outbox. The
 * audit fields (`_id`, `at`, `kind`...) stay immutable; only the projection that
 * answers "where is this message now?" changes, which is why it lives under one
 * key instead of being spread across the row.
 */
async function recordDelivery({ logModel, entry, updated, route, now, log }) {
  if (!logModel) return
  const projection = {
    state: updated.state,
    attempts: updated.attempts,
    messageId: updated.messageId ?? null,
    lastError: updated.lastError ?? null,
    dead: Boolean(updated.dead),
    channel: entry.channel,
    at: now,
  }
  const update = { $set: { [`delivery.${entry.channel}`]: projection } }
  if (updated.state === 'sent' || updated.state === 'accepted') update.$addToSet = { delivered: entry.channel }
  try {
    await logModel.updateOne({ _id: `${route.notifyId}:${entry.at}` }, update)
  } catch (e) {
    if (log?.warn) log.warn(`[notify] delivery projection write failed for ${entry._id}: ${e?.message || e}`)
  }
}

/**
 * Retry every due entry once. Called by the drain tick and by the API.
 *
 * @returns {Promise<{attempted:number, accepted:number, sent:number, dead:number}>}
 */
export async function drainOutbox({
  sinks = DEFAULT_OUTBOX_SINKS,
  getModels = defaultModels,
  limit = 25,
  config = {},
  now = Date.now,
  log = console,
} = {}) {
  let outboxModel = null
  let logModel = null
  try {
    ({ outboxModel, logModel } = await getModels())
  } catch (e) {
    if (log?.warn) log.warn(`[notify] drain skipped, models unavailable: ${e?.message || e}`)
  }
  if (!outboxModel) return { attempted: 0, accepted: 0, sent: 0, dead: 0 }

  const outbox = createOutbox({ model: outboxModel, now, log, config })
  return outbox.drain({
    sinks,
    limit,
    at: now(),
    onOutcome: (entry, updated) => recordDelivery({
      logModel,
      entry,
      updated,
      route: { notifyId: entry.notifyId },
      now: now(),
      log,
    }),
  })
}

export { DEFAULT_OUTBOX_CONFIG }
