// services/workspaceStore.mjs
// =============================================================================
//  TRADING WORKSPACE OUTBOX (roadmap §61.17 Phase C).
//
//  The write side of UI state propagation. Every trading fact (account/order/
//  fill/position/signal) is appended to `trading_domain_events` through here so
//  the dashboard can reconcile after a refresh, a dropped socket or a restart —
//  instead of each screen guessing when to refetch.
//
//  Idempotent by construction: the event `_id` is deterministic
//  (engine/tradingDomainEvents.mjs), so persisting uses `$setOnInsert` upserts —
//  re-emitting the same fact NEVER duplicates a row and NEVER resets its
//  delivery state. This is what makes "restart does not lose the update" true.
//
//  Fail-soft (D12): Mongo down -> `publish*` returns false, writers continue; the
//  live UI still converges on its next fetch.
// =============================================================================
import { connectMongo } from '../engine/db.mjs'
import { tradingDomainEvent, viewKeysFor } from '../engine/tradingDomainEvents.mjs'

/** Model `trading_domain_events` — null = Mongo down. Memo per process. */
let tradingEventMemo = null
export async function getTradingDomainEvent() {
  if (tradingEventMemo) return tradingEventMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/tradingDomainEvent.mjs')
  tradingEventMemo = mod.TradingDomainEvent
  return tradingEventMemo
}

/**
 * Persist one already-built trading domain event. Idempotent on `_id`.
 * @returns {Promise<boolean>} true = stored/exists, false = Mongo down or bad row
 */
export async function publishTradingEvent(event) {
  const M = await getTradingDomainEvent()
  if (!M || !event?._id) return false
  try {
    await M.updateOne({ _id: event._id }, { $setOnInsert: event }, { upsert: true })
    return true
  } catch (e) {
    // A concurrent identical emit already inserted it -> it is persisted, not lost.
    if (e?.code === 11000) return true
    return false
  }
}

/** Persist many events in one unordered bulk upsert. Returns the count stored. */
export async function publishTradingEvents(events = []) {
  const M = await getTradingDomainEvent()
  if (!M || !events.length) return 0
  const ops = events
    .filter((e) => e?._id)
    .map((e) => ({ updateOne: { filter: { _id: e._id }, update: { $setOnInsert: e }, upsert: true } }))
  if (!ops.length) return 0
  try {
    const res = await M.bulkWrite(ops, { ordered: false })
    return (res?.upsertedCount || 0) + (res?.matchedCount || 0)
  } catch (e) {
    // Duplicates under ordered:false are expected; only a real failure is 0.
    return e?.code === 11000 ? ops.length : 0
  }
}

/**
 * Build + persist one trading event in a single call (the writer-side helper).
 * Returns the built event (or null when the input is invalid — never throws, so
 * a bad event never breaks the trade that produced it).
 */
export async function emitTradingEvent(input) {
  let event = null
  try {
    event = tradingDomainEvent(input)
  } catch {
    return null
  }
  await publishTradingEvent(event)
  return event
}

/**
 * Events a client still has to reconcile for one owner, oldest first. Undelivered
 * rows never expire, so this survives a restart with nothing lost.
 */
export async function pendingForOwner(ownerId, { limit = 200 } = {}) {
  const M = await getTradingDomainEvent()
  if (!M || !ownerId) return []
  try {
    return await M.find({ ownerId, status: { $ne: 'delivered' } })
      .sort({ emittedAt: 1 })
      .limit(Math.min(Math.max(Number(limit) || 200, 1), 1000))
      .lean()
  } catch {
    return []
  }
}

/** The union of workspace views a set of events invalidates (for the client). */
export function viewsForEvents(events = []) {
  return viewKeysFor(events.map((e) => e?.type).filter(Boolean))
}

/** Mark events delivered (client acknowledged). Idempotent. */
export async function markDelivered(ids = [], { at = new Date() } = {}) {
  const M = await getTradingDomainEvent()
  if (!M || !ids.length) return 0
  try {
    const res = await M.updateMany(
      { _id: { $in: ids.map(String) } },
      { $set: { status: 'delivered', deliveredAt: at, lastError: null } },
    )
    return res?.modifiedCount ?? 0
  } catch {
    return 0
  }
}

/**
 * Mark events delivered ONLY when they belong to `ownerId` — the client ack
 * path. The owner filter is in the update itself, so a caller can never mark
 * another user's events delivered (tenancy §61.3). Idempotent.
 */
export async function markDeliveredForOwner(ownerId, ids = [], { at = new Date() } = {}) {
  const M = await getTradingDomainEvent()
  if (!M || !ownerId || !ids.length) return 0
  try {
    const res = await M.updateMany(
      { _id: { $in: ids.map(String) }, ownerId },
      { $set: { status: 'delivered', deliveredAt: at, lastError: null } },
    )
    return res?.modifiedCount ?? 0
  } catch {
    return 0
  }
}

/** Record a failed delivery attempt — the dead-letter/reporting signal. */
export async function markFailed(id, { error = null } = {}) {
  const M = await getTradingDomainEvent()
  if (!M || !id) return false
  try {
    await M.updateOne({ _id: String(id) }, { $set: { status: 'failed', lastError: error ? String(error).slice(0, 500) : null }, $inc: { attempts: 1 } })
    return true
  } catch {
    return false
  }
}

/** Delivered / pending / failed counts for one owner (outbox reporting). */
export async function outboxStats(ownerId) {
  const M = await getTradingDomainEvent()
  const empty = { pending: 0, delivered: 0, failed: 0 }
  if (!M || !ownerId) return empty
  try {
    const rows = await M.aggregate([{ $match: { ownerId } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
    const out = { ...empty }
    for (const r of rows) if (r?._id in out) out[r._id] = r.n
    return out
  } catch {
    return empty
  }
}
