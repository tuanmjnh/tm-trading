// services/signalStore.mjs
// =============================================================================
//  NATIVE SIGNAL STORE (roadmap §61.17 Phase D — D3).
//
//  The write side of the native signal engine. engine/signalEngine.mjs produces
//  attributed signal documents; this module persists them IDEMPOTENTLY on
//  (ownerId, signalKey). Re-running the same fixture/bar event therefore upserts
//  the same row instead of appending a duplicate — the same durable-outbox
//  discipline Phase C used for trading events.
//
//  Fail-soft (D12): Mongo down -> publish* returns false/0 and never throws, so a
//  signal generator can keep producing in-memory results without breaking.
//
//  Idempotency mechanism: `$setOnInsert` with a deterministic filter. Because the
//  unique index is partial (ownerId+signalKey), a row that already exists is left
//  untouched — including its timestamps — so "duplicate events do not duplicate
//  the signal" is a database guarantee, not a code convention.
// =============================================================================
import { connectMongo } from '../engine/db.mjs'

/** Model `signals` — null = Mongo down. Memo per process. */
let signalMemo = null
export async function getSignal() {
  if (signalMemo) return signalMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/signal.mjs')
  signalMemo = mod.Signal
  return signalMemo
}

/**
 * Persist one attributed signal document. Idempotent on `signalKey`.
 * A document without a `signalKey` is rejected (legacy/webhook rows go through
 * the webhook writer, not here).
 * @returns {Promise<boolean>} true = stored/exists, false = Mongo down or no key
 */
export async function publishSignal(doc) {
  const M = await getSignal()
  if (!M || !doc?.signalKey) return false
  try {
    await M.updateOne(
      { ownerId: doc.ownerId ?? null, signalKey: doc.signalKey },
      { $setOnInsert: doc },
      { upsert: true },
    )
    return true
  } catch (e) {
    // A concurrent identical emit already inserted it -> it is persisted, not lost.
    if (e?.code === 11000) return true
    return false
  }
}

/** Persist many signals in one unordered bulk upsert. Returns the count handled. */
export async function publishSignals(docs = []) {
  const M = await getSignal()
  if (!M || !docs.length) return 0
  const ops = docs
    .filter((d) => d?.signalKey)
    .map((d) => ({
      updateOne: {
        filter: { ownerId: d.ownerId ?? null, signalKey: d.signalKey },
        update: { $setOnInsert: d },
        upsert: true,
      },
    }))
  if (!ops.length) return 0
  try {
    const res = await M.bulkWrite(ops, { ordered: false })
    return (res?.upsertedCount || 0) + (res?.matchedCount || 0)
  } catch (e) {
    // Duplicates under ordered:false are expected; only a real failure is 0.
    return e?.code === 11000 ? ops.length : 0
  }
}

/** Look up one signal by its durable key, scoped to the owner (tenancy §61.3). */
export async function findSignalByKey(ownerId, signalKey) {
  const M = await getSignal()
  if (!M || !signalKey) return null
  try {
    return await M.findOne({ ownerId: ownerId ?? null, signalKey }).lean()
  } catch {
    return null
  }
}

/** How many signals this owner has (attribution sanity / reporting). */
export async function countSignals(ownerId) {
  const M = await getSignal()
  if (!M) return 0
  try {
    return await M.countDocuments({ ownerId: ownerId ?? null })
  } catch {
    return 0
  }
}

/**
 * Query signals by attribution — the "whose version produced this?" read.
 * Any undefined field is ignored; the owner is always applied.
 */
export async function findSignalsByAttribution(ownerId, { strategyVersion, paramsHash, method } = {}) {
  const M = await getSignal()
  if (!M) return []
  const filter = { ownerId: ownerId ?? null }
  if (method) filter.method = method
  if (strategyVersion) filter['attribution.strategyVersion'] = strategyVersion
  if (paramsHash) filter['attribution.paramsHash'] = paramsHash
  try {
    return await M.find(filter).sort({ ts: -1 }).lean()
  } catch {
    return []
  }
}
