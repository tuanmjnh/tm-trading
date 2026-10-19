// services/newsStore.mjs
// NewsItem/NewsSource persistence glue (V3.5 §60 Slice B).
//
// Fail-soft like services/store.mjs: Mongo down -> null, the runner keeps its
// intel-snapshot + heartbeat path and marks mongo='down'. Models are injected
// (`deps`) so tests run with fakes and no Mongo connection.

import { connectMongo } from '../engine/db.mjs'
import { PILOT_SOURCES, licenseGate, toNewsItem, revisionDocFor } from '../engine/newsIngest.mjs'
import { deadLetterRecord } from '../engine/newsFetch.mjs'

let itemMemo = null
let sourceMemo = null
let deadMemo = null
let revisionMemo = null

export async function getNewsItem() {
  if (itemMemo) return itemMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/newsItem.mjs')
  itemMemo = mod.NewsItem
  return itemMemo
}

export async function getNewsItemRevision() {
  if (revisionMemo) return revisionMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/newsItemRevision.mjs')
  revisionMemo = mod.NewsItemRevision
  return revisionMemo
}

export async function getNewsSource() {
  if (sourceMemo) return sourceMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/newsSource.mjs')
  sourceMemo = mod.NewsSource
  return sourceMemo
}

export async function getNewsDeadLetter() {
  if (deadMemo) return deadMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/newsDeadLetter.mjs')
  deadMemo = mod.NewsDeadLetter
  return deadMemo
}

let domainMemo = null

export async function getNewsDomainEvent() {
  if (domainMemo) return domainMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/newsDomainEvent.mjs')
  domainMemo = mod.NewsDomainEvent
  return domainMemo
}

/**
 * Persist domain events (§60.12). Deterministic ids make emission idempotent:
 * re-clustering the same window re-derives the same events and writes nothing
 * new. Fail-soft — an audit-trail write must never break ingestion.
 * Returns { inserted, duplicates }.
 */
export async function persistDomainEvents(events, { NewsDomainEventModel = null } = {}) {
  const out = { inserted: 0, duplicates: 0 }
  if (!events?.length) return out
  try {
    const Model = NewsDomainEventModel || (await getNewsDomainEvent())
    if (!Model) return out
    for (const e of events) {
      const { _id, ...rest } = e
      const res = await Model.updateOne({ _id }, { $setOnInsert: { _id, ...rest } }, { upsert: true })
      if (res?.upsertedCount || res?.upsertedId) out.inserted += 1
      else out.duplicates += 1
    }
  } catch {
    // fail-soft
  }
  return out
}

export function resetNewsStoreMemo() {
  itemMemo = null
  sourceMemo = null
  deadMemo = null
  domainMemo = null
  revisionMemo = null
}

/**
 * Seed the pilot registry. Policy fields are $setOnInsert (operator edits
 * survive); health + timestamps are $set. Returns the source records keyed by
 * sourceId (real docs or plain objects), or null when Mongo is down.
 */
export async function seedNewsSources({ NewsSourceModel = null, now = new Date() } = {}) {
  const Model = NewsSourceModel || (await getNewsSource())
  if (!Model) return null
  const ops = PILOT_SOURCES.map((s) => ({
    updateOne: {
      filter: { _id: s.sourceId },
      update: {
        $setOnInsert: {
          _id: s.sourceId,
          sourceId: s.sourceId,
          name: s.name,
          provider: s.provider,
          transport: s.transport,
          feedUrl: s.feedUrl,
          trustTier: s.trustTier,
          marketGroups: s.marketGroups,
          languages: s.languages,
          licenseStatus: s.licenseStatus,
          rights: s.rights,
          pollIntervalSec: s.pollIntervalSec,
          retentionDays: s.retentionDays,
          enabled: true,
          schemaVersion: '1',
        },
        $set: { updatedAt: now },
      },
      upsert: true,
    },
  }))
  await Model.bulkWrite(ops, { ordered: false })
  const docs = await Model.find({ _id: { $in: PILOT_SOURCES.map((s) => s.sourceId) } }).lean()
  const byId = {}
  for (const d of docs) byId[d.sourceId || d._id] = d
  // A fake model may not implement find — fall back to seed data (policy only).
  if (!Object.keys(byId).length) {
    for (const s of PILOT_SOURCES) byId[s.sourceId] = { ...s }
  }
  return byId
}

/**
 * Persist scored items idempotently. Each doc upserts by deterministic _id
 * with $setOnInsert — firstSeenAt/ingestedAt survive re-ingest, low-score
 * items never reach this function (runner filters). License-gated per source
 * (fail-closed); skipped items are counted, never stored.
 *
 * §60.11 revisions: when a previously stored item's content hash changes, the
 * envelope's mutable fields are updated AND an append-only `news_item_revisions`
 * row is written capturing the PREVIOUS rights-safe fields. When the backing
 * model exposes `find` we can detect prior content; without it (offline fakes)
 * behaviour is insert-only, exactly as before.
 */
export async function persistNewsItems(scored, sourcesById, { NewsItemModel = null, NewsItemRevisionModel = null, now = new Date() } = {}) {
  const out = { persisted: 0, duplicates: 0, skipped: 0, skippedReasons: {}, revised: 0, revisions: 0 }
  if (!scored.length) return out
  const Model = NewsItemModel || (await getNewsItem())
  if (!Model) return out
  const nowMs = now.getTime()
  // Gate + normalize (no de-dupe here: intra-batch collapse is counted below,
  // exactly as the insert path always did).
  const candidates = []
  for (const s of scored) {
    const source = (sourcesById || {})[s.source] || null
    const gate = licenseGate(source)
    if (!gate.ok) {
      out.skipped += 1
      out.skippedReasons[gate.reason] = (out.skippedReasons[gate.reason] || 0) + 1
      continue
    }
    const doc = toNewsItem(s, source, nowMs)
    if (!doc) {
      out.skipped += 1
      out.skippedReasons.invalid = (out.skippedReasons.invalid || 0) + 1
      continue
    }
    candidates.push(doc)
  }
  if (!candidates.length) return out

  // Prior content (only when the model can query): drives revision detection.
  const canQuery = typeof Model.find === 'function'
  const existing = new Map()
  if (canQuery) {
    try {
      const ids = [...new Set(candidates.map((c) => c._id))]
      const rows = await Model.find({ _id: { $in: ids } })
        .select({ _id: 1, contentHash: 1, title: 1, excerpt: 1, level: 1, dir: 1, tags: 1, eventType: 1 })
        .lean()
      for (const r of rows) existing.set(String(r._id), r)
    } catch {
      existing.clear()
    }
  }

  const itemOps = []
  const revisionDocs = []
  let inserts = 0
  for (const doc of candidates) {
    const prev = existing.get(doc._id)
    if (!prev) {
      itemOps.push({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })
      revisionDocs.push(revisionDocFor(doc, null, 'ingested', nowMs))
      inserts += 1
    } else if (prev.contentHash && prev.contentHash !== doc.contentHash) {
      itemOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              title: doc.title,
              excerpt: doc.excerpt,
              level: doc.level,
              score: doc.score,
              dir: doc.dir,
              tags: doc.tags,
              eventType: doc.eventType,
              contentHash: doc.contentHash,
              updatedAt: new Date(nowMs),
            },
          },
          upsert: false,
        },
      })
      out.revised += 1
      revisionDocs.push(revisionDocFor(doc, prev, 'revised', nowMs))
    } else {
      out.duplicates += 1
    }
  }

  let upserted = 0
  if (itemOps.length) {
    const res = await Model.bulkWrite(itemOps, { ordered: false })
    upserted = typeof res?.getUpsertedIds === 'function' ? Object.keys(res.getUpsertedIds()).length : (res?.upsertedCount ?? inserts)
  }
  out.persisted = upserted
  // Intra-batch collapse (same id twice) shows up as insert candidates that did
  // not actually upsert.
  out.duplicates += inserts - upserted

  if (revisionDocs.length) {
    try {
      const Revision = NewsItemRevisionModel || (await getNewsItemRevision())
      if (Revision) {
        // Deterministic ids collapse re-derived revisions; de-dupe the batch too.
        const seen = new Set()
        const ops = []
        for (const r of revisionDocs) {
          if (seen.has(r._id)) continue
          seen.add(r._id)
          ops.push({ updateOne: { filter: { _id: r._id }, update: { $setOnInsert: r }, upsert: true } })
        }
        await Revision.bulkWrite(ops, { ordered: false })
        out.revisions = ops.length
      }
    } catch {
      // fail-soft: the revision trail is evidence bookkeeping, never breaks ingest
    }
  }
  return out
}

/**
 * Enqueue malformed/unusable payloads for operator review (§60.5 dead-letter
 * queue). Deterministic ids mean a repeat failure increments `fails` on ONE row
 * instead of appending a new one every cycle. Fail-soft: the queue must never
 * break an ingest run. Returns { queued, duplicates }.
 */
export async function persistDeadLetters(records, { NewsDeadLetterModel = null, now = new Date() } = {}) {
  const out = { queued: 0, updated: 0, skipped: 0 }
  if (!records?.length) return out
  try {
    const Model = NewsDeadLetterModel || (await getNewsDeadLetter())
    if (!Model) return out
    for (const r of records) {
      const { fails: _fails, ...doc } = deadLetterRecord({ ...r, at: now.getTime() })
      const res = await Model.updateOne(
        { _id: doc._id },
        {
          $set: { lastFailedAt: doc.lastFailedAt, httpStatus: doc.httpStatus, attempts: doc.attempts, bytes: doc.bytes, contentType: doc.contentType, payloadHash: doc.payloadHash },
          // `fails` lives only in $inc: listing it in $setOnInsert too would make
          // Mongo reject the update as a path conflict.
          $inc: { fails: 1 },
          $setOnInsert: doc,
        },
        { upsert: true },
      )
      if (res?.upsertedCount || res?.upsertedId) out.queued += 1
      else out.updated += 1
    }
  } catch {
    // fail-soft: review bookkeeping never breaks ingestion
  }
  return out
}

/** Count review-queue rows (fail-soft; Mongo down -> null, never a false zero). */
export async function countDeadLetters({ NewsDeadLetterModel = null, sinceMs = null, now = new Date() } = {}) {
  try {
    const Model = NewsDeadLetterModel || (await getNewsDeadLetter())
    if (!Model) return null
    const filter = Number.isFinite(sinceMs) ? { lastFailedAt: { $gte: new Date(now.getTime() - Number(sinceMs)) } } : {}
    return await Model.countDocuments(filter)
  } catch {
    return null
  }
}

/**
 * Record per-source fetch health after a run. `results`: array of
 * { sourceId, ok, itemCount, error }. Never throws (fail-soft).
 */
export async function updateSourceHealth(results, { NewsSourceModel = null, now = new Date() } = {}) {
  try {
    const Model = NewsSourceModel || (await getNewsSource())
    if (!Model || !results.length) return
    const ops = results.map((r) => {
      const failed = !r.ok
      const set = {
        'health.state': failed ? 'down' : r.itemCount > 0 ? 'ok' : 'degraded',
        'health.lastFetchAt': now,
        'health.lastError': failed ? String(r.error || 'fetch failed') : null,
        updatedAt: now,
      }
      if (!failed) {
        set['health.lastOkAt'] = now
        set['health.consecutiveErrors'] = 0
        if (r.itemCount > 0) set['health.lastItemAt'] = now
        // §60.12: a manual retry request is honored by this successful fetch.
        set.retryRequestedAt = null
      }
      const update = failed
        ? { $set: set, $inc: { 'health.consecutiveErrors': 1 } }
        : { $set: set }
      return { updateOne: { filter: { _id: r.sourceId }, update, upsert: false } }
    })
    await Model.bulkWrite(ops, { ordered: false })
  } catch {
    // fail-soft: health bookkeeping must never break the ingest run
  }
}

/**
 * §60.12 manual reprocessing: stamp `retryRequestedAt` on the named sources so
 * the next ingest cycle polls them immediately (cadence bypass). `ids` empty ->
 * every enabled source. Returns { requested, missing } — `missing` lists ids
 * that are not in the registry (caller decides 404 vs partial). Fail-soft:
 * Mongo down -> { requested: [], missing: [], mongo: 'down' }.
 */
export async function requestNewsRetry(ids, { NewsSourceModel = null, now = new Date() } = {}) {
  try {
    const Model = NewsSourceModel || (await getNewsSource())
    if (!Model) return { requested: [], missing: [], mongo: 'down' }
    const filter = ids?.length ? { _id: { $in: ids } } : { enabled: { $ne: false } }
    const rows = await Model.find(filter).select({ _id: 1 }).lean()
    const found = rows.map((r) => String(r._id))
    if (!found.length) return { requested: [], missing: ids || [], mongo: 'up' }
    await Model.updateMany({ _id: { $in: found } }, { $set: { retryRequestedAt: now } })
    const missing = (ids || []).filter((id) => !found.includes(id))
    return { requested: found, missing, mongo: 'up' }
  } catch {
    return { requested: [], missing: [], mongo: 'down' }
  }
}
