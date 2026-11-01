// =============================================================================
//  Data provenance and freshness (V4.2 §4.2).
//
//  Every displayed market observation must carry WHERE it came from, WHEN it
//  happened, WHEN we received it and HOW trustworthy it is. The browser never
//  derives an authoritative value, so the producer stamps the observation once
//  at the adapter boundary and every consumer only projects it.
//
//  Two different concepts are kept apart on purpose:
//
//    DataQuality     what the PRODUCER knows about the observation
//                    ('valid' | 'delayed' | 'stale' | 'gap' | 'estimated' |
//                    'unavailable').
//    FreshnessState  what a READER computes at render time from the age of the
//                    observation against a per-source threshold
//                    (FRESH | DELAYED | STALE | MISSING | UNKNOWN).
//
//  A producer may say 'valid' about a value that is already hours old; the
//  reader must still render STALE. That is why both exist: §4.2 requires that
//  stale data is never presented with a green/live state.
//
//  All timestamps are UTC epoch milliseconds (D2 — time is UTC everywhere).
// =============================================================================

/** Producer-declared quality of a single observation (§4.2). */
export type DataQuality =
  | 'valid'
  | 'delayed'
  | 'stale'
  | 'gap'
  | 'estimated'
  | 'unavailable'

/** Read-time freshness. Only `FRESH` may be rendered as live. */
export type FreshnessState = 'FRESH' | 'DELAYED' | 'STALE' | 'MISSING' | 'UNKNOWN'

/** Provenance attached to one observation. */
export interface DataProvenance {
  /** Stable source id, e.g. `binance.rest`, `news.rss`, `service.funding`. */
  source: string
  /** Venue the value belongs to, when the source is a trading venue. */
  venue?: string
  /** Canonical instrument id when the observation is instrument-scoped. */
  instrumentId?: string
  /** When the event happened at the source (epoch ms, UTC). */
  eventTime: number
  /** When this process received it (epoch ms, UTC). */
  ingestTime: number
  /**
   * The instant the observation describes (epoch ms, UTC). Usually `eventTime`;
   * for a candle it is the close time, not the open time.
   */
  asOf: number
  quality: DataQuality
  /** How the value was produced, when it is derived rather than observed. */
  methodology?: string
}

/**
 * A value that is allowed to be absent.
 *
 * `value: null` means "we do not have this metric" and must render as N/A /
 * UNAVAILABLE — never as 0 (§4.2). `provenance: null` means "we have a number
 * but cannot prove where it came from", which is UNKNOWN, never FRESH.
 */
export interface ProvenancedValue<T = number> {
  value: T | null
  provenance: DataProvenance | null
}
