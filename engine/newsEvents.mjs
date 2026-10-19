// engine/newsEvents.mjs
// Market-event normalization (V3.5 §60 Slice C) — PURE, offline-testable,
// NO AI. Deterministic rules only:
//
// - fingerprintOf: normalized title fingerprint (lowercase, strip source names,
//   punctuation, dates/numbers) so the same story syndicated across providers
//   maps to one cluster.
// - nearDuplicate: token-set Jaccard >= 0.85 merges reworded headlines.
// - eventIdFor: DETERMINISTIC `_id = 'evt_' + sha1(fingerprint)` — re-clustering
//   upserts the same event, never forks.
// - linkEntities: allowlist ticker linker with confidence; ambiguous or weak
//   matches are marked `uncertain: true` (uncertainty is VISIBLE, never hidden).
// - corroborate: source-independence counting (distinct providers) + direction
//   conflict detection -> `contradicted`.
// - correctionSignal: keyword flag for retraction/correction (human review;
//   status propagation is the store layer's job).

import { createHash } from 'node:crypto'

export const EVENT_SCHEMA_VERSION = '1'
/** Token-set Jaccard threshold for headline near-duplicate clustering. */
export const CLUSTER_SIMILARITY = 0.85

const SOURCE_WORDS = /\b(coindesk|cointelegraph|decrypt|cryptopanic|the block|bloomberg|reuters|cnbc|wsj|ft\.?|coin[-\s]?desk)\b/gi
const DATE_WORDS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|tomorrow)\b/gi

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(SOURCE_WORDS, ' ')
    .replace(DATE_WORDS, ' ')
    .replace(/https?:\S+/g, ' ')
    // $ attached to a number is a price ($100k), not a ticker — drop it so
    // "$100K" and "100k" fingerprint identically. $TICKER keeps its $.
    .replace(/\$(?=\d)/g, '')
    .replace(/[^a-z0-9$.\s]/g, ' ')
    .replace(/\$\s+/g, '$')
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

/** Normalized fingerprint tokens (sorted, unique). */
export function fingerprintTokens(title) {
  return [...new Set(tokenize(title))].sort()
}

export function fingerprintOf(title) {
  return fingerprintTokens(title).join(' ')
}

export function eventIdFor(fingerprint) {
  return `evt_${createHash('sha1').update(String(fingerprint)).digest('hex')}`
}

function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (!A.size && !B.size) return 1
  let inter = 0
  for (const t of A) if (B.has(t)) inter += 1
  return inter / (A.size + B.size - inter)
}

/** True when two headlines describe the same story (token-set similarity). */
export function nearDuplicate(titleA, titleB) {
  if (!titleA || !titleB) return false
  if (titleA === titleB) return true
  return jaccard(fingerprintTokens(titleA), fingerprintTokens(titleB)) >= CLUSTER_SIMILARITY
}

/**
 * Crypto pilot entity allowlist: symbol -> match words (standalone, case-ins).
 * Deliberately narrow — a missed link is `unlinked`, a wrong link is harm.
 * `$TICKER` form = strong (0.95); bare word = normal (0.85); multiple distinct
 * symbols in one headline = each marked uncertain (needs corroboration).
 */
export const ENTITY_ALLOWLIST = Object.freeze([
  { symbol: 'BTC', words: ['bitcoin', 'btc'] },
  { symbol: 'ETH', words: ['ethereum', 'eth'] },
  { symbol: 'SOL', words: ['solana', 'sol'] },
  { symbol: 'BNB', words: ['bnb', 'binance coin'] },
  { symbol: 'XRP', words: ['xrp', 'ripple'] },
  { symbol: 'DOGE', words: ['dogecoin', 'doge'] },
  { symbol: 'ADA', words: ['cardano', 'ada'] },
  { symbol: 'LINK', words: ['chainlink'] }, // bare "link" is too noisy — $LINK still matches via ticker form
  { symbol: 'USDT', words: ['tether', 'usdt'] },
  { symbol: 'USDC', words: ['usd coin', 'usdc'] },
])

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Link headline entities. Returns [{ symbol, confidence, uncertain, matched }].
 * Empty array = unlinked (honest), never a guess.
 */
export function linkEntities(title, excerpt = '') {
  const text = `${title || ''} ${excerpt || ''}`
  const hits = []
  for (const { symbol, words } of ENTITY_ALLOWLIST) {
    let strong = false
    let normal = false
    // $TICKER form always matches on the symbol itself (e.g. $LINK, $SOL).
    if (new RegExp(`\\$${escapeRe(symbol)}\\b`, 'i').test(text)) strong = true
    for (const w of words) {
      if (new RegExp(`\\$${escapeRe(w)}\\b`, 'i').test(text)) { strong = true; break }
      if (new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(text)) normal = true
    }
    if (strong || normal) hits.push({ symbol, confidence: strong ? 0.95 : 0.85, matched: strong ? 'ticker' : 'word' })
  }
  const uncertain = hits.length !== 1
  return hits.map((h) => ({ ...h, uncertain: uncertain || h.confidence < 0.9 }))
}

/**
 * Corroboration over one event's items. `items`: [{ sourceId, dir, level }].
 * - independentSources: distinct providers (source-independence counting).
 * - status: 'single_source' | 'multi_source' (dirs agree) | 'contradicted'.
 */
export function corroborate(items) {
  const sources = [...new Set((items || []).map((i) => i.sourceId).filter(Boolean))]
  const dirs = [...new Set((items || []).map((i) => i.dir).filter((d) => d === 'pos' || d === 'neg'))]
  const status = dirs.length > 1 ? 'contradicted' : sources.length > 1 ? 'multi_source' : 'single_source'
  return { independentSources: sources.length, sourceIds: sources, dirs, status }
}

/**
 * Correction/retraction keyword flag. Returns the signal or null.
 * A flagged item NEVER auto-mutates history — the store appends a revision and
 * marks the event for review; previously known facts stay reproducible.
 */
const CORRECTION_RES = [
  { re: /\bretract(?:ed|ion)?\b/i, signal: 'retraction' },
  { re: /\bcorrection\b|\bcorrects\b|\bcorrected\b/i, signal: 'correction' },
  { re: /\bamended\b|\berrata\b/i, signal: 'amendment' },
]

export function correctionSignal(title, excerpt = '') {
  const text = `${title || ''} ${excerpt || ''}`
  for (const { re, signal } of CORRECTION_RES) {
    if (re.test(text)) return signal
  }
  return null
}

/**
 * Forward map from Slice B keyword tags to taxonomy v1 event types
 * (docs/news-taxonomy.md §4). First match wins; null = unclassified.
 */
const TAG_EVENT_MAP = Object.freeze([
  ['security', 'security_incident'],
  ['stability', 'market_structure_change'],
  ['regulation', 'regulatory_action'],
  ['etf', 'fund_flow'],
  ['approval', 'official_disclosure'],
  ['whale', 'fund_flow'],
  ['adoption', 'market_structure_change'],
  ['listing', 'listing_delisting'],
])

export function eventTypeForTags(tags) {
  for (const [tag, evt] of TAG_EVENT_MAP) {
    if ((tags || []).includes(tag)) return evt
  }
  return null
}
