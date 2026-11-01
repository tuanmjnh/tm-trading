// notify/policy.mjs
// Notification POLICY (roadmap §7.1 categories + §7.2 user controls) — PURE.
//
// The router (§25) decides WHICH event goes to WHICH channel at what priority.
// This file answers the orthogonal question: given the recipient's own settings,
// should this event be delivered *now*, deferred, aggregated into a digest, or
// dropped — and why. Splitting it from the router keeps both auditable: the
// router has no notion of a user, and the policy has no notion of a transport.
//
// Rules encoded here (§7.2), each a real control a trader asked for:
//   - per-category enable/disable;
//   - per-symbol / watchlist scope;
//   - severity floor (minimum priority);
//   - cooldown per (category, symbol) after a delivered message;
//   - quiet hours, with a bypass priority so a risk halt is never silenced;
//   - max messages per rolling window;
//   - instant vs digest per category.
//
// Every path returns a REASON (D12): "silenced by quiet hours" and "you disabled
// this category" must be distinguishable in the delivery history, or a user
// cannot tell a working filter from a broken pipeline.
//
// NO clock and NO IO live here: the caller supplies `at` (event time, D17) and
// `tzOffsetMin`, and the previous-delivery state it already has.

export const POLICY_VERSION = 'notify-policy.v1'

/**
 * §7.1 alert categories. These are the product's categories, not the router's
 * `kind` (which is transport-shaped). One event maps to exactly one category.
 */
export const ALERT_CATEGORIES = Object.freeze([
  'volatility', // market volatility and abnormal volume
  'movers', // top gainers/losers or configured mover thresholds
  'funding', // funding extremes and upcoming funding settlement
  'openInterest', // OI spike / divergence
  'signal', // futures research signal for watchlist coins
  'lowCap', // low-cap candidate passes / risk-flag changes
  'onchain', // large on-chain transfer / netflow anomaly
  'liquidation', // observed liquidation burst or estimated liquidity zone
  'news', // material news/event and AI market digest
  'digest', // daily / weekly market summary
])

/** Default channel priority floor per category (mirrors the router's ladder). */
export const DEFAULT_CATEGORY_SETTINGS = Object.freeze({
  enabled: true,
  instant: true, // false -> aggregate into the digest instead of pinging
  minPriority: 'info', // everything at or above this is a candidate
})

/** §7.2 "cooldown": default silence per (category, symbol) after a delivery. */
export const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000

/** §7.2 default per-window cap is off; an operator opts in. */
export const DEFAULT_SETTINGS = Object.freeze({
  version: POLICY_VERSION,
  categories: {}, // { [category]: Partial<categorySettings> }
  symbols: { mode: 'all', include: [], exclude: [] }, // 'all' | 'include' | 'exclude'
  watchlists: [], // list ids; empty = every symbol the account follows
  quietHours: {
    enabled: false,
    startMin: 22 * 60,
    endMin: 7 * 60,
    tzOffsetMin: 0, // minutes east of UTC (e.g. +420 for UTC+7)
    bypassAtOrAbove: 'critical',
  },
  maxPerWindow: { count: 0, windowMs: 60 * 60 * 1000 }, // count 0 = unlimited
  cooldownMs: DEFAULT_COOLDOWN_MS,
})

const PRIORITIES = ['critical', 'important', 'normal', 'info']
const rank = (p) => PRIORITIES.indexOf(p)

/** True when `priority` is at or above the `floor` on the §25 ladder. */
export function meetsFloor(priority, floor) {
  const p = rank(priority)
  const f = rank(floor)
  if (p < 0 || f < 0) return false // unknown values are never silently allowed
  return p <= f
}

/** Minutes since local midnight for an epoch time and an offset east of UTC. */
export function localMinutes(atMs, tzOffsetMin = 0) {
  const local = Number(atMs) + Number(tzOffsetMin || 0) * 60_000
  const dayMs = 24 * 60 * 60 * 1000
  return Math.floor((((local % dayMs) + dayMs) % dayMs) / 60_000)
}

/** `'22:30'` -> 1350. Returns null when the string is not a valid wall time. */
export function parseHhMm(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Is `min` inside [startMin, endMin)? A window that wraps midnight is handled.
 * `start === end` is an empty window (never quiet), not a full day.
 */
export function inQuietWindow(min, startMin, endMin) {
  if (startMin === endMin) return false
  if (startMin < endMin) return min >= startMin && min < endMin
  return min >= startMin || min < endMin
}

/**
 * Epoch time at which the quiet window ends (the next moment delivery resumes).
 * Always strictly after `atMs`.
 */
export function quietWindowEnd(atMs, { endMin, tzOffsetMin = 0 }) {
  const offsetMs = Number(tzOffsetMin || 0) * 60_000
  const dayMs = 24 * 60 * 60 * 1000
  const local = Number(atMs) + offsetMs
  const dayStart = Math.floor(local / dayMs) * dayMs
  let end = dayStart + endMin * 60_000
  if (end <= local) end += dayMs
  return end - offsetMs
}

/** Merge a partial settings object with the defaults without mutating either. */
export function normaliseSettings(input = {}) {
  const q = input.quietHours || {}
  const w = input.maxPerWindow || {}
  const s = input.symbols || {}
  return {
    version: POLICY_VERSION,
    categories: { ...(input.categories || {}) },
    symbols: {
      mode: ['all', 'include', 'exclude'].includes(s.mode) ? s.mode : 'all',
      include: [...(s.include || [])],
      exclude: [...(s.exclude || [])],
    },
    watchlists: [...(input.watchlists || [])],
    quietHours: {
      enabled: Boolean(q.enabled),
      startMin: Number.isFinite(q.startMin) ? q.startMin : DEFAULT_SETTINGS.quietHours.startMin,
      endMin: Number.isFinite(q.endMin) ? q.endMin : DEFAULT_SETTINGS.quietHours.endMin,
      tzOffsetMin: Number.isFinite(q.tzOffsetMin) ? q.tzOffsetMin : 0,
      bypassAtOrAbove: PRIORITIES.includes(q.bypassAtOrAbove) ? q.bypassAtOrAbove : 'critical',
    },
    maxPerWindow: {
      count: Number.isFinite(w.count) && w.count > 0 ? Math.floor(w.count) : 0,
      windowMs: Number.isFinite(w.windowMs) && w.windowMs > 0 ? w.windowMs : DEFAULT_SETTINGS.maxPerWindow.windowMs,
    },
    cooldownMs: Number.isFinite(input.cooldownMs) && input.cooldownMs >= 0
      ? input.cooldownMs
      : DEFAULT_SETTINGS.cooldownMs,
  }
}

/** Effective per-category settings (defaults + the operator's overrides). */
export function categorySettings(settings, category) {
  const override = (settings?.categories || {})[category] || {}
  return { ...DEFAULT_CATEGORY_SETTINGS, ...override }
}

/**
 * Map a router event onto exactly one §7.1 category.
 *
 * `preset`/`name` are the precise signals (a producer states its intent); `kind`
 * is the fallback, because a producer that does not state a category still has to
 * land somewhere an operator can switch off.
 */
export function categoryForEvent(event = {}) {
  const preset = event.preset || ''
  const name = String(event.name || '').toLowerCase()
  const hay = `${preset} ${name}`.toLowerCase()
  if (/risk|halt|kill/.test(hay)) return 'signal'
  if (/funding/.test(hay)) return 'funding'
  if (/liquidat/.test(hay)) return 'liquidation'
  if (/oi|open.?interest/.test(hay)) return 'openInterest'
  if (/onchain|on-chain|netflow|whale/.test(hay)) return 'onchain'
  if (/low.?cap|hidden/.test(hay)) return 'lowCap'
  if (/mover|gain|los|volatil|volume/.test(hay)) return 'volatility'
  if (/signal|drift/.test(hay)) return 'signal'
  if (/digest|summar|recap|weekly|daily/.test(hay)) return 'digest'
  if (/news|event/.test(hay)) return 'news'
  switch (event.kind) {
    case 'risk':
    case 'signal':
    case 'position':
    case 'order':
      return 'signal'
    case 'market':
      return 'volatility'
    default:
      return 'news'
  }
}

/** Is `symbol` in scope for these settings? Missing/blank symbols pass through. */
export function symbolInScope(symbol, settings) {
  const sym = symbol == null ? '' : String(symbol)
  if (!sym) return true
  const { mode, include, exclude } = settings.symbols
  const has = (list) => list.some((entry) => String(entry).toUpperCase() === sym.toUpperCase())
  if (mode === 'include') return has(include)
  if (mode === 'exclude') return !has(exclude)
  return true
}

/**
 * Decide the fate of one event for one recipient. Pure.
 *
 * @param {{event?:object, category?:string, priority?:string, symbol?:string, at:number, settings?:object,
 *          state?:{lastSentAt?:Record<string,number>, window?:{count?:number, startAt?:number}}}} input
 * @returns {{
 *   allow: boolean,
 *   category: string,
 *   priority: string,
 *   reason: string,
 *   deferUntil: number|null,
 *   digest: boolean,
 *   cooldownKey: string,
 * }}
 */
export function evaluatePolicy({ event = {}, category, priority, symbol, at, settings, state = {} } = {}) {
  const cfg = normaliseSettings(settings || {})
  const resolvedCategory = ALERT_CATEGORIES.includes(category) ? category : categoryForEvent(event)
  const resolvedPriority = PRIORITIES.includes(priority) ? priority : (event.priority || 'normal')
  const sym = symbol ?? event.symbol ?? ''
  const cooldownKey = `${resolvedCategory}:${String(sym || '*').toUpperCase()}`
  const base = { category: resolvedCategory, priority: resolvedPriority, deferUntil: null, digest: false, cooldownKey }

  const cat = categorySettings(cfg, resolvedCategory)
  if (!cat.enabled) return { ...base, allow: false, reason: 'category-disabled' }

  if (!symbolInScope(sym, cfg)) return { ...base, allow: false, reason: 'symbol-out-of-scope' }

  if (!meetsFloor(resolvedPriority, cat.minPriority)) {
    return { ...base, allow: false, reason: `below-severity-floor:${cat.minPriority}` }
  }

  // Quiet hours, unless this priority is explicitly allowed through. A halt must
  // be deliverable at 03:00, or the filter is a safety hole.
  if (cfg.quietHours.enabled) {
    const bypass = meetsFloor(resolvedPriority, cfg.quietHours.bypassAtOrAbove)
    if (!bypass) {
      const min = localMinutes(at, cfg.quietHours.tzOffsetMin)
      if (inQuietWindow(min, cfg.quietHours.startMin, cfg.quietHours.endMin)) {
        return {
          ...base,
          allow: false,
          reason: 'quiet-hours',
          deferUntil: quietWindowEnd(at, cfg.quietHours),
        }
      }
    }
  }

  // Cooldown after a delivered message for the same (category, symbol).
  if (cfg.cooldownMs > 0) {
    const last = Number(state.lastSentAt?.[cooldownKey])
    if (Number.isFinite(last) && last <= at && at - last < cfg.cooldownMs) {
      return { ...base, allow: false, reason: 'cooldown', deferUntil: last + cfg.cooldownMs }
    }
  }

  // Rolling-window cap.
  if (cfg.maxPerWindow.count > 0) {
    const window = state.window || {}
    const startedAt = Number(window.startAt)
    const fresh = Number.isFinite(startedAt) && at - startedAt < cfg.maxPerWindow.windowMs
    const count = fresh ? Number(window.count) || 0 : 0
    if (count >= cfg.maxPerWindow.count) {
      return {
        ...base,
        allow: false,
        reason: 'rate-limited',
        deferUntil: fresh ? startedAt + cfg.maxPerWindow.windowMs : at,
      }
    }
  }

  // Instant vs digest: a non-instant category is aggregated, not dropped.
  if (!cat.instant) return { ...base, allow: false, reason: 'digest-only', digest: true }

  return { ...base, allow: true, reason: 'allowed' }
}

/**
 * Fold a delivered (or deferred) decision back into the state the next call
 * needs. Pure — the caller persists the result.
 *
 * @param {{state?:object, decision:object, at:number, delivered?:boolean}} input
 */
export function applyPolicyState({ state = {}, decision, at, delivered = true } = {}) {
  const window = state.window || { count: 0, startAt: at }
  const lastSentAt = { ...(state.lastSentAt || {}) }
  if (delivered) lastSentAt[decision.cooldownKey] = at
  return {
    lastSentAt,
    window: { count: (Number(window.count) || 0) + 1, startAt: window.startAt ?? at },
  }
}
