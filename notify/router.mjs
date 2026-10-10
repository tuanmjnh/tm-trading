// notify/router.mjs
// Notification Router (roadmap §25) — PURE decision layer: given an event
// (market | signal | risk | order | position | service) it decides WHO gets it
// (webPush / telegram / electron), at what priority, and under what identity.
//
// It never sends, never logs, never reads a clock: `notify/send.mjs` executes
// the decision, and every execution is recorded in `notification_logs` (§26).
// The pure layer is what makes the routing auditable and testable.
//
// Priorities (D12: never downgrade silently — unknown values are refused):
//   critical   risk halted · market source disconnected · paper engine stale ·
//              signal drift · position SL/TP event · service overdue
//   important  actionable things a trader should see soon
//   normal     daily informational traffic
//   info       verbose/log-like, desktop only by default
//
// Routing is MINIMUM-PRIORITY per channel: a channel receives everything at
// or above its floor. Floors are configurable; defaults honour the §25 picture
// (Telegram gets important+, Web Push normal+, Electron info+).

export const ROUTER_VERSION = 'notify-router.v1'

/** §25 event sources. */
export const NOTIFICATION_KINDS = Object.freeze(['market', 'signal', 'risk', 'order', 'position', 'service'])

/** §25 priority ladder, highest first. */
export const PRIORITIES = Object.freeze(['critical', 'important', 'normal', 'info'])

/** Minimum priority each channel wants (§25 diagram). */
export const DEFAULT_ROUTING = Object.freeze({
  telegram: 'important',
  webPush: 'normal',
  electron: 'info',
})

/** §25 "Critical examples" — the defaults every critical producer inherits. */
export const CRITICAL_PRESETS = Object.freeze({
  'risk.halted': { kind: 'risk', priority: 'critical' },
  'market.disconnected': { kind: 'market', priority: 'critical' },
  'paper.stale': { kind: 'service', priority: 'critical' },
  'signal.drift': { kind: 'signal', priority: 'critical' },
  'position.sltp': { kind: 'position', priority: 'critical' },
  'service.overdue': { kind: 'service', priority: 'critical' },
})

/**
 * Deterministic 12-hex hash (FNV-1a). Identity, NOT security — collisions are
 * astronomically unlikely for event keys and worst case merges two identical
 * notifications (which dedupe would merge anyway).
 */
export function notifyHash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Stable event identity (§25 dedupe key): preset/name · symbol · normalized body. */
export function notifyDedupeKey({ preset, name, symbol = '', title = '', body = '' } = {}) {
  const id = [preset || name || 'evt', symbol || '', String(title || '').trim(), String(body || '').trim()].join('·')
  return `nl:${name ? `${name}:` : ''}${notifyHash(id)}`
}

const rank = (p) => PRIORITIES.indexOf(p)

/**
 * Decide channels + priority for one event. Pure, no IO, no clock.
 *
 * @param {{preset?:string, kind?:string, priority?:string, title?:string, body?:string, symbol?:string, dedupeKey?:string}} event
 * @param {{routing?:Record<string,string>, channels?:string[]}} [opts]
 * @returns {{channels:string[], priority:string, kind:string, notifyId:string, dedupeKey:string, skipped:{channel:string, reason:string}[]}|null}
 *          null when the event is invalid (kind/priority not on the ladder)
 */
export function routeEvent(event = {}, { routing = DEFAULT_ROUTING, channels = Object.keys(DEFAULT_ROUTING) } = {}) {
  const preset = event.preset ? CRITICAL_PRESETS[event.preset] : null
  if (event.preset && !preset) return null
  const kind = event.kind ?? preset?.kind
  const priority = event.priority ?? preset?.priority ?? 'normal'
  if (!kind || !NOTIFICATION_KINDS.includes(kind)) return null
  if (!PRIORITIES.includes(priority)) return null

  const dedupeKey = event.dedupeKey || notifyDedupeKey({ ...event, preset })
  const notifyId = `nl:${notifyHash(dedupeKey)}`

  const floor = (ch) => routing[ch] ?? DEFAULT_ROUTING[ch] ?? 'normal'
  const picked = []
  const skipped = []
  for (const ch of channels) {
    const min = floor(ch)
    if (!PRIORITIES.includes(min)) { skipped.push({ channel: ch, reason: `unknown floor '${min}'` }); continue }
    if (rank(priority) <= rank(min)) picked.push(ch)
    else skipped.push({ channel: ch, reason: `priority '${priority}' below floor '${min}'` })
  }
  return { channels: picked, priority, kind, notifyId, dedupeKey, skipped }
}