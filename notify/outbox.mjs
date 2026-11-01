// notify/outbox.mjs
// Durable notification OUTBOX (roadmap §7.3) — the retry layer the notify/
// router never had.
//
// Today a send happens inline inside whatever service triggered it: a Telegram
// outage slows the service loop and loses the message, and a failed send is
// terminal (see `v4.2-service-inventory.md` §6). §7.3 asks for exactly four
// things this file provides:
//
//   - a stable alert key so a replay/reconnect cannot storm (§7.3 dedupe);
//   - a durable queue with exponential backoff + jitter;
//   - the states `queued | sent | accepted | failed` — and NOTHING claimed
//     beyond the evidence. `accepted` requires a provider acknowledgement (a
//     message id); `sent` means the transport reported success without one;
//     `failed` is terminal and visible as a dead letter.
//   - dead-letter visibility, so a delivery that will never happen is a record
//     a human can act on, not a log line nobody reads (D12).
//
// Layout: the decision + state machine are PURE (`backoffMs`, `outboxDoc`,
// `planAttempt`); the store is IO-injected (`createOutbox({ model })`), so the
// whole retry contract is testable without Mongo or a network.
import { notifyHash } from './router.mjs'

export const OUTBOX_VERSION = 'notify-outbox.v1'

/** §7.3 states. There is no `delivered` — Telegram gives no such signal. */
export const OUTBOX_STATES = Object.freeze(['queued', 'sent', 'accepted', 'failed'])

/** Retry envelope. Attempt 1 happens immediately; backoff starts at `baseMs`. */
export const DEFAULT_OUTBOX_CONFIG = Object.freeze({
  baseMs: 30_000, // 30 s
  factor: 2,
  maxMs: 60 * 60 * 1000, // 1 h ceiling
  jitter: 0.2, // ±20% so a provider outage does not resynchronise every retry
  maxAttempts: 6,
})

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Exponential backoff with jitter for the Nth failed attempt (1-based). Pure.
 *
 * `rand` is injectable so a test can pin the jitter; production passes Math.random.
 */
export function backoffMs(attempt, config = {}, rand = Math.random) {
  const cfg = { ...DEFAULT_OUTBOX_CONFIG, ...config }
  const n = Math.max(1, Math.floor(Number(attempt) || 1))
  const raw = cfg.baseMs * Math.pow(cfg.factor, n - 1)
  const capped = clamp(raw, 0, cfg.maxMs)
  const spread = capped * clamp(Number(cfg.jitter) || 0, 0, 1)
  // rand in [0,1) -> offset in [-spread, +spread)
  const offset = (rand() * 2 - 1) * spread
  return Math.max(0, Math.round(capped + offset))
}

/**
 * The durable queue row for ONE channel of ONE event. Pure.
 *
 * `_id = ${notifyId}:${channel}` — the same event replayed (same event time, D17)
 * resolves to the same row, so a crash restart cannot duplicate a message.
 */
export function outboxDoc({ event = {}, route, channel, at, now = Date.now() }) {
  return {
    _id: `${route.notifyId}:${channel}`,
    outboxVersion: OUTBOX_VERSION,
    notifyId: route.notifyId,
    dedupeKey: route.dedupeKey,
    channel,
    ownerId: event.ownerId != null ? String(event.ownerId) : null,
    category: event.category ?? null,
    kind: route.kind,
    priority: route.priority,
    preset: event.preset ?? null,
    name: event.name ?? null,
    symbol: event.symbol ?? null,
    title: event.title != null ? String(event.title).slice(0, 500) : null,
    body: event.body != null ? String(event.body).slice(0, 4000) : null,
    at: Number.isFinite(Number(at)) ? Number(at) : now,
    state: 'queued',
    attempts: 0,
    nextAttemptAt: at,
    lastError: null,
    messageId: null,
    dead: false,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Fold an attempt outcome into the next queue state. Pure.
 *
 * @param {{entry:object, outcome:{ok?:boolean, accepted?:boolean, messageId?:string|null,
 *          error?:string|null, retryable?:boolean}, now:number, config?:object, rand?:Function}} input
 * @returns {{state:string, attempts:number, nextAttemptAt:number|null, dead:boolean,
 *            lastError:string|null, messageId:string|null}}
 */
export function planAttempt({ entry = {}, outcome = {}, now = Date.now(), config = {}, rand = Math.random }) {
  const cfg = { ...DEFAULT_OUTBOX_CONFIG, ...config }
  const attempts = (Number(entry.attempts) || 0) + 1

  if (outcome.ok) {
    // Evidence decides the state: an explicit provider acknowledgement is
    // `accepted`; anything less is only `sent`.
    const accepted = Boolean(outcome.accepted) && outcome.messageId != null
    return {
      state: accepted ? 'accepted' : 'sent',
      attempts,
      nextAttemptAt: null,
      dead: false,
      lastError: null,
      messageId: outcome.messageId != null ? String(outcome.messageId) : null,
    }
  }

  const retryable = outcome.retryable !== false
  const exhausted = attempts >= cfg.maxAttempts
  if (!retryable || exhausted) {
    return {
      state: 'failed',
      attempts,
      nextAttemptAt: null,
      dead: true,
      lastError: String(outcome.error ?? (retryable ? 'attempts exhausted' : 'non-retryable failure')).slice(0, 500),
      messageId: null,
    }
  }

  return {
    state: 'queued',
    attempts,
    nextAttemptAt: now + backoffMs(attempts, cfg, rand),
    dead: false,
    lastError: String(outcome.error ?? 'attempt failed').slice(0, 500),
    messageId: null,
  }
}

/** Queued entries whose `nextAttemptAt` has passed. Pure filter over rows. */
export function dueEntries(entries = [], now = Date.now()) {
  return entries
    .filter((e) => e.state === 'queued' && Number(e.nextAttemptAt ?? 0) <= now)
    .sort((a, b) => Number(a.nextAttemptAt ?? 0) - Number(b.nextAttemptAt ?? 0))
}

/** Stable identity for a manual replay request (guards the API path). */
export function outboxKeyFor(notifyId, channel) {
  return `outbox:${notifyHash(`${notifyId}:${channel}`)}`
}

/**
 * A durable outbox over an injected model. The model only needs the four calls
 * below, which both a Mongoose collection and the test fake provide:
 * `updateOne`, `find` (chainable sort/limit/lean), `countDocuments`, `deleteOne`.
 */
export function createOutbox({ model, now = Date.now, log = console, config = {} } = {}) {
  const cfg = { ...DEFAULT_OUTBOX_CONFIG, ...config }
  const hasModel = Boolean(model)

  /**
   * Queue every channel of one routed event. Idempotent per (event, channel):
   * an existing row is left untouched — first record wins (D4) — so a replay
   * never re-queues a message that was already attempted.
   *
   * @returns {Promise<{inserted:number, existing:number}>}
   */
  async function enqueue({ event = {}, route, channels = [] }) {
    if (!hasModel) return { inserted: 0, existing: 0 }
    let inserted = 0
    let existing = 0
    const at = Number.isFinite(Number(event.at)) ? Number(event.at) : now()
    for (const channel of channels) {
      const doc = outboxDoc({ event, route, channel, at, now: now() })
      try {
        const res = await model.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true })
        if (res?.upsertedCount || res?.upsertedId) inserted += 1
        else existing += 1
      } catch (e) {
        if (log?.warn) log.warn(`[outbox] enqueue failed for ${doc._id}: ${e?.message || e}`)
      }
    }
    return { inserted, existing }
  }

  /** Rows whose next attempt is due, oldest first. */
  async function due(at = now(), limit = 25) {
    if (!hasModel) return []
    const rows = await model.find({ state: 'queued', nextAttemptAt: { $lte: at } })
      .sort({ nextAttemptAt: 1 })
      .limit(Math.max(1, limit))
      .lean()
    return dueEntries(rows, at)
  }

  /**
   * Perform one attempt against `sink` and persist the resulting state.
   * Returns the updated row (never throws).
   */
  async function attempt(entry, sink) {
    const at = now()
    let outcome
    if (typeof sink !== 'function') {
      outcome = { ok: false, retryable: false, error: 'sink not configured' }
    } else {
      try {
        outcome = await sink(entry)
      } catch (e) {
        outcome = { ok: false, retryable: true, error: String(e?.message ?? e) }
      }
    }
    const next = planAttempt({ entry, outcome, now: at, config: cfg })
    const patch = { ...next, updatedAt: at, outcomeAt: at }
    try {
      await model.updateOne({ _id: entry._id }, { $set: patch })
    } catch (e) {
      if (log?.warn) log.warn(`[outbox] could not persist attempt for ${entry._id}: ${e?.message || e}`)
    }
    return { ...entry, ...patch, channel: entry.channel }
  }

  /**
   * Attempt every due entry once. Callers pass the sink map + an `emit` hook so
   * the ledger (`notification_logs`) can record the outcome too.
   *
   * @param {{sinks?:Record<string,Function>, limit?:number, at?:number, onOutcome?:Function}} [opts]
   */
  async function drain({ sinks = {}, limit = 25, at = now(), onOutcome = null } = {}) {
    const entries = await due(at, limit)
    const results = []
    for (const entry of entries) {
      const updated = await attempt(entry, sinks[entry.channel])
      results.push(updated)
      if (onOutcome) {
        try { await onOutcome(entry, updated) } catch (e) {
          if (log?.warn) log.warn(`[outbox] outcome hook failed for ${entry._id}: ${e?.message || e}`)
        }
      }
    }
    return { attempted: results.length, accepted: results.filter((r) => r.state === 'accepted').length, sent: results.filter((r) => r.state === 'sent').length, dead: results.filter((r) => r.dead).length, results }
  }

  /** Counts per state (including the dead-letter subset). */
  async function stats({ ownerId } = {}) {
    const filter = ownerId != null ? { ownerId: String(ownerId) } : {}
    const out = { queued: 0, sent: 0, accepted: 0, failed: 0, dead: 0 }
    if (!hasModel) return out
    for (const state of OUTBOX_STATES) {
      out[state] = await model.countDocuments({ ...filter, state })
    }
    out.dead = await model.countDocuments({ ...filter, dead: true })
    return out
  }

  /** The dead-letter view: terminal failures a human must look at. */
  async function deadLetters({ limit = 100, ownerId } = {}) {
    if (!hasModel) return []
    const filter = { dead: true, ...(ownerId != null ? { ownerId: String(ownerId) } : {}) }
    return model.find(filter).sort({ updatedAt: -1 }).limit(limit).lean()
  }

  /** Put a dead letter back into the queue (operator action, audited by caller). */
  async function replay(id, { at = now() } = {}) {
    if (!hasModel) return null
    const res = await model.updateOne(
      { _id: String(id) },
      { $set: { state: 'queued', dead: false, attempts: 0, nextAttemptAt: at, lastError: null, updatedAt: at } },
    )
    return res
  }

  return { enqueue, due, attempt, drain, stats, deadLetters, replay }
}
