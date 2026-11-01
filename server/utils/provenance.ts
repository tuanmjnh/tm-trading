import type { DataProvenance, FreshnessState, ProvenancedValue } from '#shared/types/provenance'

// =============================================================================
//  Provenance / freshness evaluation (V4.2 §4.2).
//
//  PURE: this module never reads a clock it was not given, never queries a
//  store and never fabricates a timestamp. Every function is deterministic for
//  a fixed `now`, which is what makes the freshness contract testable.
//
//  The single rule the whole module exists to enforce:
//
//    A value is live ONLY when it is FRESH. Everything else — DELAYED, STALE,
//    MISSING, UNKNOWN — must render as not-live. There is no "probably fine"
//    state, and there is no path where absent data becomes 0.
//
//  Thresholds are per source kind because a 15 s quote and a 24 h macro series
//  age at completely different rates. The caller picks the kind (or passes an
//  explicit `maxAgeMs`); this module never guesses.
// =============================================================================

/** Version stamp (D1) — bump when the freshness rules change. */
export const FRESHNESS_SCHEMA_VERSION = 'provenance.v1'

/**
 * Default stale threshold per source kind, in milliseconds.
 *
 * A value is FRESH up to `maxAgeMs`, DELAYED up to `2 × maxAgeMs`, and STALE
 * beyond that. Override per call with `maxAgeMs` when a producer knows better.
 */
export const FRESHNESS_THRESHOLDS_MS = Object.freeze({
  /** Streaming quote / ticker. */
  quote: 15_000,
  /** Individual trade print. */
  trade: 30_000,
  /** Forming 1 m candle. */
  candle1m: 90_000,
  /** Rolling 24 h ticker snapshot (polled). */
  ticker24: 60_000,
  /** Funding rate observation. */
  funding: 900_000,
  /** Open-interest observation. */
  openInterest: 900_000,
  /** Liquidation event stream. */
  liquidation: 300_000,
  /** Order-book snapshot. */
  orderBook: 30_000,
  /** Ingested news item. */
  news: 3_600_000,
  /** Macro series / calendar observation. */
  macro: 86_400_000,
  /** Intel snapshot written by a periodic service. */
  intelSnapshot: 1_800_000,
  /** On-chain observation. */
  onchain: 3_600_000,
  /** Fear & Greed index (daily). */
  fearGreed: 86_400_000,
} as const)

export type FreshnessSourceKind = keyof typeof FRESHNESS_THRESHOLDS_MS

/** Tolerated future skew before a timestamp is treated as bad data. */
export const CLOCK_SKEW_MS = 5_000

export interface FreshnessOptions {
  /** Reference clock, epoch ms. Defaults to `Date.now()`. */
  now?: number
  /** Source kind used to look up the default threshold. Defaults to `quote`. */
  kind?: FreshnessSourceKind
  /** Explicit threshold in ms. Wins over `kind` when provided. */
  maxAgeMs?: number
}

/**
 * Coerce a value to a finite number, or `null`.
 *
 * `null`, `undefined`, `''`, whitespace, booleans, objects and non-finite
 * numbers all yield `null`. This is the guard that keeps "missing" from
 * silently becoming 0 (§4.2).
 */
export function numericOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Age of an observation in ms, or `null` when the timestamp is unusable. */
export function observationAgeMs(
  provenance: DataProvenance | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!provenance) return null
  const asOf = numericOrNull(provenance.asOf)
  if (asOf === null || !Number.isFinite(now)) return null
  return now - asOf
}

/**
 * Compute the read-time freshness of one observation.
 *
 * Precedence, highest first:
 *
 * 1. no provenance            -> MISSING
 * 2. quality `unavailable`    -> MISSING
 * 3. quality `stale` / `gap`  -> STALE   (the producer already knows it is bad)
 * 4. unusable / future `asOf` -> UNKNOWN
 * 5. age > 2 × threshold      -> STALE
 * 6. quality `delayed` / `estimated` -> DELAYED (capped, never FRESH)
 * 7. age <= threshold         -> FRESH
 * 8. otherwise                -> DELAYED
 */
export function freshnessOf(
  provenance: DataProvenance | null | undefined,
  options: FreshnessOptions = {},
): FreshnessState {
  if (!provenance) return 'MISSING'
  if (provenance.quality === 'unavailable') return 'MISSING'
  // A gap is a hole in the series: the value exists but the stream is not
  // delivering. Treat it as STALE so it can never be shown as live.
  if (provenance.quality === 'stale' || provenance.quality === 'gap') return 'STALE'

  const asOf = numericOrNull(provenance.asOf)
  if (asOf === null) return 'UNKNOWN'

  const now = options.now ?? Date.now()
  if (!Number.isFinite(now)) return 'UNKNOWN'

  const ageMs = now - asOf
  // A timestamp in the future beyond clock skew is bad data, not freshness.
  if (ageMs < -CLOCK_SKEW_MS) return 'UNKNOWN'

  const threshold = options.maxAgeMs ?? FRESHNESS_THRESHOLDS_MS[options.kind ?? 'quote']
  if (!Number.isFinite(threshold) || threshold <= 0) return 'UNKNOWN'

  if (ageMs > 2 * threshold) return 'STALE'

  // Producer-declared degradation caps the best possible state.
  if (provenance.quality === 'delayed' || provenance.quality === 'estimated') return 'DELAYED'

  if (ageMs <= threshold) return 'FRESH'
  return 'DELAYED'
}

/**
 * Freshness of a possibly-absent metric.
 *
 * - no value at all        -> MISSING
 * - value present, no provenance -> UNKNOWN (cannot prove it is current)
 * - otherwise              -> `freshnessOf(provenance)`
 *
 * A present value of `0` is a real observation and is evaluated normally.
 */
export function freshnessOfValue(
  observed: ProvenancedValue<unknown> | null | undefined,
  options: FreshnessOptions = {},
): FreshnessState {
  if (!observed) return 'MISSING'
  const hasValue = observed.value !== null && observed.value !== undefined
  if (!hasValue) return 'MISSING'
  if (!observed.provenance) return 'UNKNOWN'
  return freshnessOf(observed.provenance, options)
}

/** Only `FRESH` may be rendered as a live/green value (§4.2). */
export function isLive(state: FreshnessState): boolean {
  return state === 'FRESH'
}

/**
 * Severity order used when a section summarises several observations.
 *
 * STALE ranks above MISSING because a stale value actively looks real, while a
 * missing value is honestly absent.
 */
const SEVERITY: Record<FreshnessState, number> = {
  FRESH: 0,
  DELAYED: 1,
  UNKNOWN: 2,
  MISSING: 3,
  STALE: 4,
}

/** Worst state in a set; an empty set is UNKNOWN, never FRESH. */
export function worstFreshness(states: readonly FreshnessState[]): FreshnessState {
  if (states.length === 0) return 'UNKNOWN'
  return states.reduce<FreshnessState>(
    (worst, state) => (SEVERITY[state] > SEVERITY[worst] ? state : worst),
    'FRESH',
  )
}
