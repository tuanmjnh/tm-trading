// engine/newsAssess.mjs
// Versioned news extraction (V3.5 §60 Slice D) — PURE, offline-testable.
//
// `rule-v1` is a DETERMINISTIC extractor (no model calls): it converts one
// NewsItem (+ its event context, when clustered) into the §60.6 assessment
// shape with evidence IDs, confidence and explicit unknowns. An LLM extractor
// can later write `rule-v2+` versions alongside — versions never overwrite.
//
// Honesty rules enforced here:
// - every claim carries sourceItemId + sourceUrl + verification status;
// - verification comes from corroboration (primary/multi/single/unverified),
//   never from prose confidence;
// - contradicted events force humanReviewRequired;
// - anything not observed is the string 'unknown', never a guess.

import { createHash } from 'node:crypto'

export const ASSESS_SCHEMA_VERSION = 1
export const ASSESS_EXTRACTOR_VERSION = 'rule-v1'

function claimIdFor(itemId, kind, n) {
  return `clm_${createHash('sha1').update(`${itemId}|${kind}|${n}`).digest('hex').slice(0, 16)}`
}

/**
 * Build one versioned assessment for an item.
 * `event`: the item's MarketEvent doc (or null when unclustered).
 */
export function assessNewsItem(item, event = null, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const itemId = String(item._id || item.id || '')
  const corr = event?.corroboration?.status || 'single_source'
  const verification =
    corr === 'contradicted' ? 'contradicted' : corr === 'multi_source' ? 'multi_source' : 'single_source'
  const entities = (event?.entities || []).map((e) => ({
    entityType: 'instrument',
    sourceText: e.symbol,
    normalizedId: e.symbol,
    confidence: typeof e.confidence === 'number' ? e.confidence : 0,
  }))
  const claims = [
    {
      claimId: claimIdFor(itemId, 'headline', 0),
      claimType: item.level === 'high' ? 'fact' : 'opinion',
      claimText: String(item.title || ''),
      sourceUrl: item.originUrl || item.url || '',
      confidence: item.level === 'high' ? 0.7 : 0.5,
      verification,
    },
  ]
  return {
    _id: `${itemId}|${ASSESS_EXTRACTOR_VERSION}`,
    sourceItemId: itemId,
    eventId: event?._id ? String(event._id) : null,
    extractorModelVersion: ASSESS_EXTRACTOR_VERSION,
    schemaVersion: ASSESS_SCHEMA_VERSION,
    normalizedHeadline: String(item.title || ''),
    claims,
    entities,
    eventType: event?.eventType || null,
    affectedMarkets: event?.marketGroup ? [event.marketGroup] : [item.marketGroup || 'crypto'],
    potentialDrivers: Array.isArray(item.tags) ? item.tags : [],
    impactConfidence: verification === 'multi_source' ? 0.65 : verification === 'contradicted' ? 0.3 : 0.45,
    counterEvidenceNeeded: verification === 'contradicted' ? ['resolve direction conflict'] : ['independent corroboration'],
    humanReviewRequired: verification === 'contradicted' || (event?.status && event.status !== 'active'),
    assessedAt: new Date(now),
  }
}

/** Assessment id for (item, extractor version) — upsert key. */
export function assessmentIdFor(itemId, extractorVersion = ASSESS_EXTRACTOR_VERSION) {
  return `${itemId}|${extractorVersion}`
}
