// engine/newsIngest.mjs
// News ingestion primitives (V3.5 §60 Slice B) — PURE, offline-testable.
//
// - canonicalizeUrl: tracking-param/fragment/host normalization so the same
//   story shared with different query strings maps to ONE id (dedupe D4).
// - newsItemIdFor: DETERMINISTIC `_id = 'news_' + sha1(canonicalUrl)` —
//   re-ingest (replay, retry, overlap) hits the same id and cannot duplicate.
// - PILOT_SOURCES: canonical registry seed (mirrors docs/news-source-audit.md
//   + docs/news-license-matrix.md). Policy fields are $setOnInsert — an
//   operator edit in Mongo is never overwritten by the seeder.
// - toNewsItem: normalized envelope (taxonomy v1 defaults, times, rights
//   snapshot). Excerpt capped at 240 chars (rights-safe, matrix v1).
// - licenseGate: fail-CLOSED. unknown/revoked license blocks storage.
// - toPublicNewsItem: server-side projection — only safe fields ever leave
//   the API (full text is never stored, but the projection is allowlist-based
//   so a future field cannot leak by accident).

import { createHash } from 'node:crypto'

export const NEWS_SCHEMA_VERSION = '1'
export const NEWS_EXCERPT_MAX = 240
/** License matrix v1 retention ceiling (docs/news-license-matrix.md). */
export const NEWS_RETENTION_SECONDS = 7 * 24 * 3600

const TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_/i, /^igsh/i]

/**
 * Canonical form of an article URL for identity (NOT for display — the
 * original URL is preserved separately for citation/link-out).
 * Unparseable input returns '' (caller must drop the item).
 */
export function canonicalizeUrl(raw) {
  let u
  try {
    u = new URL(String(raw || '').trim())
  } catch {
    return ''
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
  u.protocol = 'https:'
  u.hostname = u.hostname.toLowerCase()
  u.hash = ''
  const kept = []
  for (const [k, v] of u.searchParams) {
    if (TRACKING_PARAMS.some((re) => re.test(k))) continue
    kept.push([k, v])
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  u.search = ''
  for (const [k, v] of kept) u.searchParams.append(k, v)
  let s = u.toString()
  if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1)
  return s
}

export function sha1Hex(s) {
  return createHash('sha1').update(String(s)).digest('hex')
}

/** Deterministic NewsItem id. '' when the URL is unusable. */
export function newsItemIdFor(url) {
  const canon = canonicalizeUrl(url)
  return canon ? `news_${sha1Hex(canon)}` : ''
}

/**
 * Canonical pilot registry (Slice B). `feedUrl` never carries secrets —
 * CryptoPanic token is appended at fetch time from env only.
 */
export const PILOT_SOURCES = Object.freeze([
  {
    sourceId: 'coindesk',
    name: 'CoinDesk',
    provider: 'CoinDesk',
    transport: 'rss',
    feedUrl: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    trustTier: 'T2_SECONDARY',
    marketGroups: ['crypto'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 600,
    retentionDays: 7,
  },
  {
    sourceId: 'cointelegraph',
    name: 'Cointelegraph',
    provider: 'Cointelegraph',
    transport: 'rss',
    feedUrl: 'https://cointelegraph.com/rss',
    trustTier: 'T2_SECONDARY',
    marketGroups: ['crypto'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 600,
    retentionDays: 7,
  },
  {
    sourceId: 'decrypt',
    name: 'Decrypt',
    provider: 'Decrypt',
    transport: 'rss',
    feedUrl: 'https://decrypt.co/feed',
    trustTier: 'T2_SECONDARY',
    marketGroups: ['crypto'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 600,
    retentionDays: 7,
  },
  {
    sourceId: 'cryptopanic',
    name: 'CryptoPanic',
    provider: 'CryptoPanic',
    transport: 'api',
    feedUrl: 'https://cryptopanic.com/api/v1/posts/',
    trustTier: 'T2_SECONDARY',
    marketGroups: ['crypto'],
    languages: ['multi'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 600,
    retentionDays: 7,
  },
  {
    sourceId: 'federalreserve',
    name: 'Federal Reserve Board',
    provider: 'Board of Governors of the Federal Reserve System',
    transport: 'rss',
    feedUrl: 'https://www.federalreserve.gov/feeds/press_all.xml',
    trustTier: 'T0_PRIMARY',
    marketGroups: ['macro_cb'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 600,
    retentionDays: 7,
  },
  {
    sourceId: 'sec_edgar',
    name: 'SEC EDGAR — latest 8-K filings',
    provider: 'U.S. Securities and Exchange Commission',
    transport: 'rss',
    feedUrl: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom',
    trustTier: 'T0_PRIMARY',
    marketGroups: ['equities_global'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 900,
    retentionDays: 7,
  },
  {
    sourceId: 'ecb',
    name: 'European Central Bank — press releases',
    provider: 'European Central Bank',
    transport: 'rss',
    feedUrl: 'https://www.ecb.europa.eu/rss/press.html',
    trustTier: 'T0_PRIMARY',
    marketGroups: ['macro_cb'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 900,
    retentionDays: 7,
  },
  {
    sourceId: 'bls_cpi',
    name: 'BLS — Consumer Price Index release',
    provider: 'U.S. Bureau of Labor Statistics',
    transport: 'rss',
    feedUrl: 'https://www.bls.gov/feed/cpi.rss',
    trustTier: 'T0_PRIMARY',
    marketGroups: ['macro_cb'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 900,
    retentionDays: 7,
  },
  {
    sourceId: 'bls_empsit',
    name: 'BLS — Employment Situation release',
    provider: 'U.S. Bureau of Labor Statistics',
    transport: 'rss',
    feedUrl: 'https://www.bls.gov/feed/empsit.rss',
    trustTier: 'T0_PRIMARY',
    marketGroups: ['macro_cb'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 900,
    retentionDays: 7,
  },
  {
    sourceId: 'bls_ppi',
    name: 'BLS — Producer Price Index release',
    provider: 'U.S. Bureau of Labor Statistics',
    transport: 'rss',
    feedUrl: 'https://www.bls.gov/feed/ppi.rss',
    trustTier: 'T0_PRIMARY',
    marketGroups: ['macro_cb'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 900,
    retentionDays: 7,
  },
  {
    sourceId: 'bls_jolts',
    name: 'BLS — Job Openings and Labor Turnover release',
    provider: 'U.S. Bureau of Labor Statistics',
    transport: 'rss',
    feedUrl: 'https://www.bls.gov/feed/jolts.rss',
    trustTier: 'T0_PRIMARY',
    marketGroups: ['macro_cb'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 900,
    retentionDays: 7,
  },
  {
    sourceId: 'eia',
    name: 'EIA — Today in Energy',
    provider: 'U.S. Energy Information Administration',
    transport: 'rss',
    feedUrl: 'https://www.eia.gov/rss/todayinenergy.xml',
    trustTier: 'T0_PRIMARY',
    marketGroups: ['fx_gold_commod'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 1800,
    retentionDays: 7,
  },
  {
    sourceId: 'vnexpress',
    name: 'VnExpress International — Business',
    provider: 'VnExpress',
    transport: 'rss',
    feedUrl: 'https://e.vnexpress.net/rss/business.rss',
    trustTier: 'T2_SECONDARY',
    // A broad Vietnamese business feed: equities_vn is its primary group, but an
    // individual gold/FX headline is re-grouped to fx_gold_commod per item
    // (§60.5 precision, marketGroupFor).
    marketGroups: ['equities_vn', 'fx_gold_commod'],
    languages: ['en'],
    licenseStatus: 'ok',
    rights: { allowedStoreMetadata: true, allowedDisplay: true, allowedSummarize: false, allowedTraining: false },
    pollIntervalSec: 900,
    retentionDays: 7,
  },
])

export function pilotSourceFor(sourceId) {
  return PILOT_SOURCES.find((s) => s.sourceId === sourceId) || null
}

/**
 * Fail-closed license gate. Returns { ok, reason } — storage AND display
 * require ok. `source` is the registry record (seed or operator-edited).
 */
export function licenseGate(source) {
  if (!source) return { ok: false, reason: 'unknown_source' }
  if (source.enabled === false) return { ok: false, reason: 'source_disabled' }
  if (source.licenseStatus === 'revoked') return { ok: false, reason: 'license_revoked' }
  if (source.licenseStatus !== 'ok') return { ok: false, reason: 'license_not_verified' }
  if (source.rights && source.rights.allowedStoreMetadata === false) return { ok: false, reason: 'storage_not_permitted' }
  return { ok: true, reason: 'ok' }
}

/**
 * §60.5 precision: an item's primary `marketGroup` is the group its strongest
 * group-specific score tag maps to, restricted to the groups the source
 * declares; otherwise the source's primary group. Single-group sources (all the
 * crypto ones, Fed/ECB/BLS/SEC/EIA) are unaffected because no mapping targets a
 * group they don't already declare. Only multi-group sources (a broadpress feed)
 * move an individual item, e.g. a gold headline out of `equities_vn` into
 * `fx_gold_commod`.
 */
export const TAG_MARKET_GROUP = Object.freeze({
  commodity: 'fx_gold_commod',
  macro_release: 'macro_cb',
  central_bank: 'macro_cb',
  equity_market: 'equities_vn',
  filing: 'equities_global',
})

export function marketGroupFor(tags, sourceGroups) {
  const groups = Array.isArray(sourceGroups) && sourceGroups.length ? sourceGroups : ['crypto']
  for (const tag of Array.isArray(tags) ? tags : []) {
    const g = TAG_MARKET_GROUP[tag]
    if (g && groups.includes(g)) return g
  }
  return groups[0]
}

/**
 * Build the normalized envelope for one scored feed item.
 * Returns null when the item is unusable (no URL / gated license).
 * `scored` = { title, link, source, excerpt, ts, score, level, dir, tags }.
 */
export function toNewsItem(scored, source, nowMs) {
  const gate = licenseGate(source)
  if (!gate.ok) return null
  const id = newsItemIdFor(scored.link)
  if (!id) return null
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const publishedAt = scored.ts ? new Date(scored.ts) : null
  const at = new Date(now)
  return {
    _id: id,
    sourceId: source.sourceId,
    url: canonicalizeUrl(scored.link),
    originUrl: String(scored.link),
    title: String(scored.title || ''),
    excerpt: String(scored.excerpt || '').slice(0, NEWS_EXCERPT_MAX),
    language: (source.languages && source.languages[0]) || 'en',
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    firstSeenAt: at,
    ingestedAt: at,
    marketGroup: marketGroupFor(scored.tags, source.marketGroups),
    eventType: null,
    tags: Array.isArray(scored.tags) ? scored.tags : [],
    level: scored.level,
    score: scored.score,
    dir: scored.dir,
    rights: {
      allowedDisplay: source.rights?.allowedDisplay !== false,
      allowedSummarize: source.rights?.allowedSummarize === true,
    },
    hash: sha1Hex(`${scored.title || ''}|${canonicalizeUrl(scored.link)}`),
    contentHash: newsContentHashFor({ title: scored.title, excerpt: scored.excerpt, level: scored.level, dir: scored.dir, tags: scored.tags, eventType: null }),
    schemaVersion: NEWS_SCHEMA_VERSION,
  }
}

/**
 * §60.11 content fingerprint for change detection: covers only the fields a
 * correction can materially change (headline, excerpt, level, direction, tags,
 * event type) — never volatile ones (score jitter, timestamps). Two ingests of
 * the same story produce the same hash; a rewritten headline does not.
 */
export function newsContentHashFor(item) {
  const tags = Array.isArray(item?.tags) ? [...item.tags].sort().join(',') : ''
  return sha1Hex([
    String(item?.title || '').trim(),
    String(item?.excerpt || '').trim(),
    String(item?.level || ''),
    String(item?.dir || ''),
    tags,
    String(item?.eventType || ''),
  ].join('|'))
}

/** Deterministic revision id: `nir_<sha1(itemId|contentHash)>` — a repeat of the same content is ONE row. */
export function newsRevisionIdFor(itemId, contentHash) {
  return itemId && contentHash ? `nir_${sha1Hex(`${itemId}|${contentHash}`)}` : ''
}

/**
 * Build one append-only revision record (§60.11). `kind: 'ingested'` is the
 * first observation (prev empty); `kind: 'revised'` captures the PREVIOUS
 * rights-safe fields so "what was previously known" survives a material change.
 * Never stores full text — title + excerpt only, same ceiling as the envelope.
 */
export function revisionDocFor(itemDoc, prev, kind, nowMs) {
  const at = new Date(Number.isFinite(nowMs) ? nowMs : Date.now())
  const contentHash = itemDoc.contentHash || newsContentHashFor(itemDoc)
  return {
    _id: newsRevisionIdFor(itemDoc._id, contentHash),
    itemId: itemDoc._id,
    sourceId: itemDoc.sourceId || null,
    kind,
    at,
    contentHash,
    prevContentHash: prev?.contentHash || null,
    prev: {
      title: String(prev?.title || ''),
      excerpt: String(prev?.excerpt || '').slice(0, NEWS_EXCERPT_MAX),
      level: prev?.level || null,
      dir: prev?.dir || null,
      tags: Array.isArray(prev?.tags) ? prev.tags : [],
      eventType: prev?.eventType || null,
    },
    note: '',
    schemaVersion: NEWS_SCHEMA_VERSION,
  }
}

/**
 * Server-side public projection (allowlist). Strips originUrl? No — citation
 * needs the ORIGINAL link (canonical form may differ). Strips hash/internal
 * rights detail, keeps only what the News Desk renders.
 */
export function toPublicNewsItem(doc) {
  const d = typeof doc?.toObject === 'function' ? doc.toObject() : doc || {}
  if (d.rights && d.rights.allowedDisplay === false) return null
  return {
    id: String(d._id || ''),
    sourceId: d.sourceId || '',
    url: d.originUrl || d.url || '',
    title: d.title || '',
    excerpt: d.excerpt || '',
    language: d.language || 'en',
    publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
    firstSeenAt: d.firstSeenAt ? new Date(d.firstSeenAt).toISOString() : null,
    marketGroup: d.marketGroup || 'crypto',
    eventType: d.eventType || null,
    tags: Array.isArray(d.tags) ? d.tags : [],
    level: d.level || 'med',
    dir: d.dir || 'flat',
    score: typeof d.score === 'number' ? d.score : 0,
  }
}
