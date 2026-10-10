// notify/send.mjs
// Notification dispatch (roadmap §25): EXECUTES a routing decision and records
// EVERY outcome — delivered, skipped, failed — into `notification_logs` (§26).
//
// Design rules:
//  - PURE decision lives in notify/router.mjs; this file only orchestrates IO.
//  - Sinks are INJECTED ({telegram, webPush, electron}) — this module never
//    imports transport code, so it runs anywhere and tests without network.
//  - Fail-soft everywhere (D33): a missing/throwing sink never breaks the
//    caller; an unreachable Mongo never blocks delivery. EVERY attempt is
//    recorded (D12: a silent notification system is indistinguishable from a
//    working one).
//  - Identity (§25 dedupe): `_id = notifyId:at` — the same event replayed with
//    the same event-time (crash restart) is a no-op (D4: first record wins);
//    optional `dedupeWindowMs` additionally suppresses repeat sends of an
//    identical event within a window (measured, not guessed).
import { routeEvent, ROUTER_VERSION } from './router.mjs'

export const SEND_VERSION = 'notify-send.v1'

const str = (v, max = 2000) => (v == null ? null : String(v).slice(0, max))

/**
 * Build the `notification_logs` row for one dispatched event. Pure.
 */
export function notificationLogDoc({ event = {}, route, attempts = [], delivered = [], deduped = false, now = Date.now() }) {
  const at = Number.isFinite(Number(event.at)) ? Number(event.at) : now
  return {
    _id: `${route.notifyId}:${at}`,
    notifyId: route.notifyId,
    dedupeKey: route.dedupeKey,
    kind: route.kind,
    priority: route.priority,
    preset: str(event.preset) ?? null,
    name: str(event.name) ?? null,
    symbol: str(event.symbol) ?? null,
    title: str(event.title) ?? null,
    body: str(event.body) ?? null,
    at, // event time (D17)
    sentAt: now, // when WE attempted delivery
    attempts,
    delivered,
    deduped,
    routerVersion: ROUTER_VERSION,
  }
}

/**
 * Route + deliver + log ONE event. Never throws.
 *
 * @param {object} event {preset?, kind?, priority?, title?, body?, symbol?, dedupeKey?, at?}
 * @param {{sinks?:Record<string,(ctx)=>Promise<boolean>>, logModel?:object|null, dedupeWindowMs?:number, log?:{warn?:Function}, now?:number}} [opts]
 * @returns {Promise<null|{notifyId:string, kind:string, priority:string, delivered:string[], attempts:object[], skipped:object[], deduped:boolean, logged:boolean}>}
 *          null = invalid event (router rejected it — logged as a warn, never silent)
 */
export async function dispatch(event = {}, { sinks = {}, logModel = null, dedupeWindowMs = 0, log = console, now = Date.now() } = {}) {
  const route = routeEvent(event)
  if (!route) {
    if (log && log.warn) log.warn(`[notify] rejected event: kind/priority not on the ladder (${JSON.stringify({ kind: event.kind, priority: event.priority, preset: event.preset })})`)
    return null
  }

  const base = { notifyId: route.notifyId, kind: route.kind, priority: route.priority, skipped: route.skipped }

  // Optional measured window-dedupe: identical event already delivered
  // within the window -> record a deduped row instead of re-pinging.
  if (dedupeWindowMs > 0 && logModel) {
    try {
      const prev = await logModel.findOne({ notifyId: route.notifyId, delivered: { $exists: true, $ne: [] }, sentAt: { $gte: now - dedupeWindowMs } }).lean()
      if (prev) {
        const doc = notificationLogDoc({ event, route, attempts: [], delivered: [], deduped: true, now })
        let logged = false
        try { await logModel.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true }); logged = true } catch (e) { if (log && log.warn) log.warn(`[notify] dedupe log write error: ${e?.message || e}`) }
        return { ...base, delivered: [], attempts: [], deduped: true, logged }
      }
    } catch { /* dedupe check is best-effort; never block delivery on it */ }
  }

  const attempts = []
  const delivered = []
  for (const channel of route.channels) {
    const sink = sinks[channel]
    if (!sink) { attempts.push({ channel, ok: false, error: 'sink not configured' }); continue }
    try {
      const ok = await sink({ ...event, ...route, channel })
      attempts.push({ channel, ok: Boolean(ok) })
      if (ok) delivered.push(channel)
      else attempts[attempts.length - 1].error = 'sink returned falsy (unconfigured or transport failure)'
    } catch (e) {
      attempts.push({ channel, ok: false, error: String(e?.message ?? e) })
    }
  }

  let logged = false
  if (logModel) {
    const doc = notificationLogDoc({ event, route, attempts, delivered, now })
    try {
      await logModel.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true })
      logged = true
    } catch (e) {
      if (log && log.warn) log.warn(`[notify] log write error ${doc.notifyId}: ${e?.message || e}`)
    }
  }

  return { ...base, delivered, attempts, deduped: false, logged }
}