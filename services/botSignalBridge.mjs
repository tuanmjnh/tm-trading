// services/botSignalBridge.mjs
// =============================================================================
//  Phase E (E4) — native signal → bot instance → paper alert.
//
//  The bot does NOT get its own order path. A runnable strategy signal becomes
//  an `Alert` with `source: 'bot'`, exactly like a manual ticket becomes an
//  `Alert` with `source: 'manual'`, so both are consumed by the ONE executor in
//  `exec/paper.mjs` (risk → order → fill → position → metrics).
//
//  Identity is deterministic: `bot_<instanceId>_<signalKey>`. Replaying the same
//  signal (reconnect, worker restart, double tick) hits the unique alertKey
//  index and is counted as `skipped`, never duplicated.
//
//  PURE part (signalToAlert / cursorFilter) is unit-tested offline; the DB part
//  (bridgeSignalsForInstance) only does queries + inserts.
// =============================================================================

export const BOT_ALERT_SOURCE = 'bot'
export const BOT_ALERT_PREFIX = 'bot_'
export const BOT_SIGNAL_BATCH = 100

/** The only event types that are entries (mirrors engine/signalEngine EVENT_DIRECTION). */
export const ENTRY_SIGNAL_TYPES = Object.freeze(['ST LONG', 'ST SHORT'])

/** `bot_<instanceId>_<signalKey>` — stable across restarts. */
export function botAlertKey(instanceId, signalKey) {
  return `${BOT_ALERT_PREFIX}${instanceId}_${signalKey}`
}

/** Sub-book of an instance (registry: `'default'` sentinel, never the tenancy axis). */
export function accountOf(instance) {
  const a = instance?.accountId
  return typeof a === 'string' && a.length > 0 ? a : 'default'
}

/** Direction of an entry signal, or 0 when the signal is informational. */
export function signalSide(signal) {
  if (signal?.type === 'ST LONG') return 'BUY'
  if (signal?.type === 'ST SHORT') return 'SELL'
  return null
}

/**
 * Replay-safe cursor for `signals`. The pair (ts, signalKey) is ordered so a
 * second signal on the same bar is not skipped when the first one advanced the
 * watermark.
 * 
 * The cursor uses signalKey as primary ordering since it's unique and generated
 * in creation order. We also include signals with signalKey > lastSignalKey
 * regardless of timestamp, since signalKey ordering doesn't perfectly match
 * timestamp ordering (earlier timestamps can have lexicographically larger keys).
 */
export function cursorFilter({ lastSignalTs = null, lastSignalKey = null } = {}) {
  const ts = Number(lastSignalTs)
  if (!Number.isFinite(ts) || ts <= 0) return {}
  const at = new Date(ts)
  if (typeof lastSignalKey !== 'string' || lastSignalKey.length === 0) return { ts: { $gt: at } }
  return {
    $or: [
      { ts: { $gt: at } },
      { ts: at, signalKey: { $gt: lastSignalKey } },
      { signalKey: { $gt: lastSignalKey } }
    ]
  }
}

/**
 * Map one native signal to an alert document, or `null` when the signal must not
 * open a position (informational event, legacy row, other owner/account).
 *
 * Market entry is deliberate: the signal is confirmed on a CLOSED bar, so the
 * honest fill is the next executable quote, not a fabricated better price.
 *
 * @returns {object|null}
 */
export function signalToAlert({ signal, instance } = {}) {
  if (!signal || !instance) return null
  if (instance.state !== undefined && instance.state !== 'running') return null

  const side = signalSide(signal)
  if (!side) return null
  if (typeof signal.signalKey !== 'string' || signal.signalKey.length === 0) return null

  const ownerId = instance.ownerId
  if (!ownerId || String(signal.ownerId ?? '') !== String(ownerId)) return null

  const accountId = accountOf(instance)
  if (signal.accountId != null && String(signal.accountId) !== accountId) return null

  const subs = Array.isArray(instance.subscriptions) ? instance.subscriptions : []
  if (subs.length > 0 && !subs.includes(signal.symbol)) return null

  const meta = signal.meta && typeof signal.meta === 'object' ? signal.meta : {}
  const sl = Number(meta.sl)
  const tp = Number(meta.tp)
  const tps = Number.isFinite(tp) && tp > 0 ? [tp] : []
  const entry = Number(meta.entry)

  const ts = signal.ts instanceof Date ? signal.ts : new Date(signal.ts)

  return {
    alertKey: botAlertKey(instance.instanceId, signal.signalKey),
    ownerId,
    accountId,
    instanceId: instance.instanceId,
    signalKey: signal.signalKey,
    source: BOT_ALERT_SOURCE,
    ts,
    symbol: signal.symbol,
    tf: signal.tf,
    action: 'ENTRY',
    side,
    price: Number.isFinite(entry) && entry > 0 ? entry : null,
    sl: Number.isFinite(sl) && sl > 0 ? sl : null,
    tps,
    status: 'received',
    raw: JSON.stringify({
      type: 'market',
      botInstanceId: instance.instanceId,
      signalKey: signal.signalKey,
      signalType: signal.type,
      attribution: signal.attribution ?? null,
      meta: signal.meta ?? null,
    }),
  }
}

/**
 * Read new entry signals for one instance and enqueue them as bot alerts.
 *
 * @param {object} input
 * @param {object} input.instance  bot instance document (lean)
 * @param {object} input.models    { Alert, Signal }
 * @param {number} [input.limit]
 * @returns {Promise<{ok:boolean,code?:string,queued:number,skipped:number,
 *   lastSignalKey:string|null,lastSignalTs:number|null}>}
 */
export async function bridgeSignalsForInstance({ instance, models, limit = BOT_SIGNAL_BATCH } = {}) {
  const empty = {
    ok: false,
    queued: 0,
    skipped: 0,
    lastSignalKey: instance?.lastSignalKey ?? null,
    lastSignalTs: instance?.lastSignalTs ?? null,
  }
  const Signal = models?.Signal
  const Alert = models?.Alert
  if (!Signal || !Alert) return { ...empty, code: 'missing_model' }
  if (!instance?.instanceId || !instance?.ownerId) return { ...empty, code: 'missing_instance' }
  if (instance.state !== 'running') return { ...empty, code: 'not_running' }

  const filter = { ownerId: instance.ownerId, ...cursorFilter(instance) }
  const subs = Array.isArray(instance.subscriptions) ? instance.subscriptions : []
  if (subs.length > 0) filter.symbol = { $in: subs }
  // Informational events are never orders; filter in the query so the watermark
  // still advances past them.
  filter.type = { $in: [...ENTRY_SIGNAL_TYPES] }

  let rows
  try {
    rows = await Signal.find(filter).sort({ ts: 1, signalKey: 1 }).limit(Math.max(1, Number(limit) || BOT_SIGNAL_BATCH)).lean()
  } catch {
    return { ...empty, code: 'query_failed' }
  }

  let queued = 0
  let skipped = 0
  let lastSignalKey = empty.lastSignalKey
  let lastSignalTs = empty.lastSignalTs

  for (const signal of rows) {
    const alert = signalToAlert({ signal, instance })
    if (!alert) {
      skipped++
    } else {
      try {
        await Alert.create(alert)
        queued++
      } catch (e) {
        if (e?.code === 11000) skipped++
        else return { ok: false, code: 'insert_failed', queued, skipped, lastSignalKey, lastSignalTs }
      }
    }
    if (signal.signalKey) lastSignalKey = signal.signalKey
    const ts = signal.ts instanceof Date ? signal.ts.getTime() : Number(signal.ts)
    if (Number.isFinite(ts)) lastSignalTs = ts
  }

  return { ok: true, queued, skipped, lastSignalKey, lastSignalTs, scanned: rows.length }
}
