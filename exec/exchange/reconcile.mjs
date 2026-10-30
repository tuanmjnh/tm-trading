// =============================================================================
//  TM TRADING — V3.9 reconciliation (§63.8/§64.6/§64.8).
//
//  Pure functions. Reconciliation is how the system proves it knows the true
//  venue state after a reconnect/restart/timeout, and how it guarantees a retry
//  can NEVER duplicate an order or a fill.
//
//  Idempotency keys ALWAYS include venue + account identity, so an identical
//  order/exec id from two different exchanges can never collide (§64.6).
// =============================================================================

/** Stable, venue+account-scoped idempotency key for a fill/execution. */
export function execKey({ venue, accountId, execId }) {
  return `${String(venue)}:${String(accountId ?? 'default')}:${String(execId)}`
}

/** Stable, venue+account-scoped idempotency key for an order. */
export function orderKey({ venue, accountId, externalOrderId, clientOrderId }) {
  const id = externalOrderId ?? clientOrderId
  return `${String(venue)}:${String(accountId ?? 'default')}:${String(id)}`
}

/**
 * Deduplicate incoming executions against an already-persisted key set.
 * Returns { accepted, duplicates } — duplicates are dropped, never re-persisted.
 * @param {string[]} existingKeys execKey() values already stored
 * @param {object[]} incoming normalized executions (must carry venue/accountId/execId)
 */
export function dedupeFills(existingKeys, incoming) {
  const seen = new Set(existingKeys)
  const accepted = []
  const duplicates = []
  for (const fill of incoming ?? []) {
    const key = execKey(fill)
    if (!fill.execId) { duplicates.push({ fill, reason: 'missing-execId' }); continue }
    if (seen.has(key)) { duplicates.push({ fill, reason: 'duplicate', key }); continue }
    seen.add(key)
    accepted.push(fill)
  }
  return { accepted, duplicates }
}

/**
 * Reconcile locally-known orders against the venue's authoritative orders.
 * Detects orders the venue has that we missed (missing), local orders the venue
 * no longer reports (unresolved — possibly cancelled/filled/expired), and state
 * divergences. Matching prefers externalOrderId then clientOrderId.
 */
export function reconcileOrders(localOrders, venueOrders) {
  const byExternal = new Map()
  const byClient = new Map()
  for (const o of localOrders ?? []) {
    if (o.externalOrderId) byExternal.set(String(o.externalOrderId), o)
    if (o.clientOrderId) byClient.set(String(o.clientOrderId), o)
  }
  const matched = []
  const missing = [] // on venue, not local
  const divergent = []
  for (const v of venueOrders ?? []) {
    const local = (v.externalOrderId && byExternal.get(String(v.externalOrderId))) || (v.clientOrderId && byClient.get(String(v.clientOrderId))) || null
    if (!local) { missing.push(v); continue }
    matched.push({ local, venue: v })
    if (local.status && v.status && local.status !== v.status) divergent.push({ key: orderKey(v), local: local.status, venue: v.status })
  }
  // Local orders still active but absent from the venue snapshot.
  const venueKeys = new Set((venueOrders ?? []).map((v) => orderKey(v)))
  const unresolved = (localOrders ?? [])
    .filter((l) => ['pending', 'partiallyFilled', 'riskChecked', 'created'].includes(l.status))
    .filter((l) => !venueKeys.has(orderKey(l)))
  return { matched: matched.length, missing, divergent, unresolved }
}

/** Reconcile local positions against venue positions by symbol+side. */
export function reconcilePositions(localPositions, venuePositions) {
  const key = (p) => `${String(p.symbol)}:${String(p.side)}`
  const local = new Map((localPositions ?? []).map((p) => [key(p), p]))
  const venue = new Map((venuePositions ?? []).map((p) => [key(p), p]))
  const missing = [...venue.values()].filter((p) => !local.has(key(p)))
  const divergent = []
  for (const [k, v] of venue) {
    const l = local.get(k)
    if (l && Number(l.qty) !== Number(v.qty)) divergent.push({ key: k, localQty: l.qty, venueQty: v.qty })
  }
  const extra = [...local.values()].filter((p) => !venue.has(key(p)))
  return { missing, extra, divergent }
}

/**
 * Build a ReconciliationResult summary consumed by health + persistence + UI.
 * `unresolved` > 0 keeps the session DEGRADED (never silently success-shaped).
 */
export function buildReconciliationResult({ fills = {}, orders = {}, positions = {}, at = Date.now() } = {}) {
  const duplicate = (fills.duplicates?.length ?? 0)
  const missing = (orders.missing?.length ?? 0) + (positions.missing?.length ?? 0) + (fills.missing?.length ?? 0)
  const unresolved = (orders.unresolved?.length ?? 0) + (orders.divergent?.length ?? 0) + (positions.divergent?.length ?? 0)
  return {
    at,
    counts: { duplicate, missing, unresolved, matchedOrders: orders.matched ?? 0, acceptedFills: fills.accepted?.length ?? 0 },
    ok: unresolved === 0,
    status: unresolved === 0 ? 'RECONCILED' : 'UNRECONCILED',
    detail: { orders, positions, fills: { accepted: fills.accepted?.length ?? 0, duplicates: fills.duplicates?.length ?? 0 } },
  }
}
