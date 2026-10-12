// engine/alertRules.mjs
// =============================================================================
//  ALERT RULES — the trading-domain rule CONTRACT (roadmap §58.5 /alerts).
//
//  §58.6 boundary: "Notifications != Alert Rules". This module owns the domain
//  half — how a rule is validated/normalized, whether a domain event satisfies a
//  rule, and the per-(rule,event) deduplication key. It does NOT deliver: the
//  service (services/alertRules.mjs) evaluates rules against the intel event
//  stream and routes matches through the shared notify/ router (§25).
//
//  PURE + dependency-light (node:crypto + version.stableStringify only) so it can
//  be unit-tested with plain Node (engine/test-alert-rules.mjs) — no Mongo, no
//  network. Keys must be STABLE: same rule+event -> same key (D4 lesson).
// =============================================================================
import { createHash } from 'node:crypto'
import { stableStringify } from './version.mjs'

export const ALERT_RULE_VERSION = 'alert-rule.v1'

/** Intel event streams a rule can watch (append-only streams with a unique key). */
export const RULE_EVENT_KINDS = Object.freeze(['news', 'alert'])

/** Severity ladder — `high` is the most severe (lower rank = louder). */
export const RULE_LEVELS = Object.freeze(['high', 'med', 'low'])
export const LEVEL_RANK = Object.freeze({ high: 0, med: 1, low: 2 })

/** Direction values carried by intel events (news/alert `data.dir`). */
export const RULE_DIRS = Object.freeze(['pos', 'neg', 'flat'])

/** Reuse the notify router priority ladder (§25) — never invent new priorities. */
export const RULE_PRIORITIES = Object.freeze(['critical', 'important', 'normal', 'info'])

const DEFAULT_LOOKBACK_SEC = 7 * 24 * 3600 // intel event TTL (7d)
const MAX_LOOKBACK_SEC = 30 * 24 * 3600
const MAX_LISTS = 64
const MAX_NAME = 80

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max)
const strList = (v) =>
  Array.isArray(v) ? v.map((x) => str(x, 64)).filter(Boolean).slice(0, MAX_LISTS) : []

/**
 * Validate a rule input. Pure — returns { ok:false, error } on the first flaw
 * (same shape as utils/orders.validateTicket, so the API route stays thin).
 */
export function validateRule(input) {
  const err = (m) => ({ ok: false, error: m })
  if (!input || typeof input !== 'object' || Array.isArray(input)) return err('rule must be an object')
  const r = input
  if (typeof r.name !== 'string' || !r.name.trim()) return err('name is required')
  if (r.name.trim().length > MAX_NAME) return err(`name must be <= ${MAX_NAME} characters`)
  if (r.kind !== undefined && !RULE_EVENT_KINDS.includes(r.kind)) {
    return err(`kind must be one of ${RULE_EVENT_KINDS.join('/')}`)
  }
  if (r.minLevel !== undefined && r.minLevel !== null && !RULE_LEVELS.includes(r.minLevel)) {
    return err(`minLevel must be one of ${RULE_LEVELS.join('/')}`)
  }
  if (r.priority !== undefined && !RULE_PRIORITIES.includes(r.priority)) {
    return err(`priority must be one of ${RULE_PRIORITIES.join('/')}`)
  }
  if (r.dirs !== undefined) {
    if (!Array.isArray(r.dirs) || r.dirs.some((d) => !RULE_DIRS.includes(d))) {
      return err(`dirs must be a subset of ${RULE_DIRS.join('/')}`)
    }
  }
  for (const field of ['symbols', 'sources', 'tags']) {
    if (r[field] !== undefined && !Array.isArray(r[field])) return err(`${field} must be an array`)
  }
  if (r.minScore !== undefined && r.minScore !== null && !Number.isFinite(Number(r.minScore))) {
    return err('minScore must be a number')
  }
  if (r.lookbackSec !== undefined && r.lookbackSec !== null) {
    const w = Number(r.lookbackSec)
    if (!Number.isFinite(w) || w < 0) return err('lookbackSec must be >= 0')
  }
  return { ok: true }
}

/**
 * Canonical stored shape. Throws on invalid input (validate first). Symbols are
 * upper-cased and sources/tags lower-cased so matching is case-insensitive.
 */
export function normalizeRule(input) {
  const v = validateRule(input)
  if (!v.ok) throw new Error(`normalizeRule: ${v.error}`)
  const minScore = input.minScore === undefined || input.minScore === null ? null : Number(input.minScore)
  const lookbackSec =
    input.lookbackSec === undefined || input.lookbackSec === null
      ? DEFAULT_LOOKBACK_SEC
      : Math.min(Math.max(Number(input.lookbackSec), 0), MAX_LOOKBACK_SEC)
  return {
    name: str(input.name, MAX_NAME),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    kind: input.kind ?? 'news',
    minLevel: input.minLevel ?? 'med',
    dirs: strList(input.dirs).sort(),
    symbols: strList(input.symbols).map((s) => s.toUpperCase()).sort(),
    sources: strList(input.sources).map((s) => s.toLowerCase()).sort(),
    tags: strList(input.tags).map((s) => s.toLowerCase()).sort(),
    minScore,
    priority: input.priority ?? 'normal',
    lookbackSec,
  }
}

/**
 * Stable identity of a rule's DEFINITION (unique index `ruleKey`). Tiny changes
 * that do not alter evaluation (enabled, dedupe window) are excluded so toggling
 * a rule never mints a new identity; a rename or condition change does.
 */
export function ruleKeyFor(normalized) {
  const canon = { ...normalized }
  delete canon.enabled
  delete canon.lookbackSec
  return 'r1_' + createHash('sha256').update(stableStringify(canon)).digest('hex').slice(0, 40)
}

/**
 * Does a domain event satisfy a rule? Pure. A present rule facet that the event
 * lacks (no symbol/source/tag, no comparable level/score) does NOT match — a
 * narrow rule must never fire on noise it cannot confirm.
 *
 * @param {ReturnType<typeof normalizeRule>} rule
 * @param {{kind:string, level?:string|null, dir?:string|null, symbol?:string|null,
 *          source?:string|null, tags?:string[], score?:number|null}} event
 */
export function matchRule(rule, event) {
  if (!rule || !event) return false
  if (rule.kind !== event.kind) return false

  const dirs = rule.dirs || []
  if (dirs.length && !dirs.includes(event.dir)) return false

  const symbols = rule.symbols || []
  if (symbols.length) {
    const sym = String(event.symbol ?? '').toUpperCase()
    if (!sym || !symbols.includes(sym)) return false
  }

  const sources = rule.sources || []
  if (sources.length && !sources.includes(String(event.source ?? '').toLowerCase())) return false

  const tags = rule.tags || []
  if (tags.length) {
    const evTags = (event.tags || []).map((x) => String(x).toLowerCase())
    if (!tags.some((tag) => evTags.includes(tag))) return false
  }

  if (rule.minLevel && event.level) {
    const floor = LEVEL_RANK[rule.minLevel]
    const rank = LEVEL_RANK[event.level]
    if (rank === undefined || rank > floor) return false // event less severe than the floor
  }

  if (rule.minScore !== null && rule.minScore !== undefined) {
    const s = Number(event.score)
    if (!Number.isFinite(s) || s < Number(rule.minScore)) return false
  }

  return true
}

/**
 * Dedupe identity for one (rule, event) pair. Stable across cycles/replays so a
 * re-run can never re-notify the same event (D4). Prefers the persisted rule
 * `_id`; falls back to the definition key for unsaved rules.
 */
export function ruleEventDedupeKey(rule, event = {}) {
  const ruleId = String(rule?._id ?? rule?.ruleKey ?? '')
  const evId = String(event.key ?? event.id ?? `${event.kind}:${event.ts ?? ''}:${event.title ?? ''}`)
  return 'ar1_' + createHash('sha256').update(stableStringify({ r: ruleId, e: evId })).digest('hex').slice(0, 40)
}

/** Map a rule's event kind to a notify router kind (§25 kinds). */
export function notifyKindFor(ruleKind) {
  return ruleKind === 'alert' ? 'signal' : 'market'
}
