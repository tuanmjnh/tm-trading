// =============================================================================
//  TM TRADING — RESEARCH EVIDENCE SETS, PURE (V3.5 §59.15 Slice E).
//
//  Slice C made a run traceable, Slice D made an agent governable. Slice E makes
//  a claim REPRODUCIBLE: a frozen bundle of the facts an AI conclusion was drawn
//  from, identified by a content hash, that can be re-read later and proven
//  unedited.
//
//  Two rules drive the design:
//
//   1. **Freeze once (D3).** The set id is deterministic from its source
//      (`ev_paper-session_ses_…`), so re-freezing the same session cannot fork a
//      second, slightly different "truth". Contents are hashed; `verifyEvidenceSet`
//      re-detects any edit.
//   2. **No claim above the sample (D12).** Below MIN_TRADES_FOR_EVIDENCE the
//      bundle says so and the metric block stays null instead of printing a
//      confident number built from four trades.
//
//  Nothing here reads Mongo or calls a model: the server layer hydrates the docs
//  and this module decides what they mean. Tests: tests/evidence.test.ts.
// =============================================================================

import { createHash } from 'node:crypto'
import { stableStringify } from './version.mjs'
import { MIN_TRADES_FOR_EVIDENCE, rMultipleOf } from './journal.mjs'

export const EVIDENCE_SCHEMA_VERSION = 'research-evidence-set.v1'

/** What produced the evidence. A session is not a backtest run — never conflate. */
export const EVIDENCE_KINDS = Object.freeze(['paper-session', 'replay-session', 'backtest-run', 'dataset'])

/** Session states that make evidence reproducible: a live session is still moving. */
export const EVIDENCE_SEALED_SESSION_STATES = Object.freeze(['completed', 'failed', 'halted'])

/** Below this many closed trades a set is labelled insufficient (journal floor). */
export const EVIDENCE_MIN_TRADES = MIN_TRADES_FOR_EVIDENCE

const fail = (code, message) => ({ ok: false, code, message })

/**
 * A trade with no stored id (a report row grouped into a series) still needs a
 * stable key: it goes into `keys.positionKeys`, which is inside the hash, so it
 * must be derived from the ROW, never from array position — re-ordering the
 * source must not invent a different identity for the same trade.
 */
function tradeContentKey(p) {
  return 'tc1_' + createHash('sha256')
    .update(stableStringify([
      p.entryTime instanceof Date ? p.entryTime.getTime() : p.entryTime ?? null,
      p.dir ?? null,
      p.entryPrice ?? null,
      p.result ?? p.exitReason ?? null,
      p.exitTime instanceof Date ? p.exitTime.getTime() : p.exitTime ?? null,
      p.exitPrice ?? null,
      p.rMultiple ?? null,
    ]))
    .digest('hex')
    .slice(0, 24)
}

// -----------------------------------------------------------------------------
//  Identity
// -----------------------------------------------------------------------------

/**
 * Deterministic set id (D3): one frozen set per source document. Re-freezing a
 * session must hit the same id (and be refused as already frozen) — a second id
 * would let two reports disagree about the same run.
 */
export function evidenceSetIdFor({ kind, sourceId } = {}) {
  const k = String(kind ?? '').trim()
  const src = String(sourceId ?? '').trim()
  if (!EVIDENCE_KINDS.includes(k)) {
    throw new Error(`evidence: kind must be one of ${EVIDENCE_KINDS.join('|')} (got ${String(kind)})`)
  }
  if (!src) throw new Error('evidence: sourceId is required')
  return `ev_${k}_${src}`
}

// -----------------------------------------------------------------------------
//  Trades -> measured outcome
// -----------------------------------------------------------------------------

/**
 * Normalize one closed position into an evidence trade row. Only what the doc
 * actually recorded is kept: an absent value stays null (never 0, which would
 * claim it was measured as zero).
 */
export function evidenceTrade(position) {
  const p = position ?? {}
  const dir = Number(p.dir)
  const entry = Number(p.entryPrice)
  const exit = p.exitPrice == null ? null : Number(p.exitPrice)
  const sl = p.sl == null ? null : Number(p.sl)
  const hasOutcome = Number.isFinite(exit)
  const r = hasOutcome && Number.isFinite(sl) && (dir === 1 || dir === -1)
    ? rMultipleOf({ dir, entryPrice: entry, sl, exitPrice: exit })
    // Backtest trades (`trades`) store the engine's own R and often no R
    // distance: take the RECORDED value rather than inventing one, but only
    // once there is a realized exit — an open trade has no outcome (D12).
    : (hasOutcome && Number.isFinite(Number(p.rMultiple)) ? Number(p.rMultiple) : null)
  const storedKey = String(p._id ?? p.externalId ?? p.signalKey ?? '')

  return {
    key: storedKey || tradeContentKey(p),
    symbol: String(p.symbol ?? ''),
    dir: dir === 1 ? 1 : dir === -1 ? -1 : null,
    qty: Number.isFinite(Number(p.qty)) ? Number(p.qty) : null,
    entryPrice: Number.isFinite(entry) ? entry : null,
    exitPrice: Number.isFinite(exit) ? exit : null,
    entryTime: p.entryTime instanceof Date ? p.entryTime.getTime() : (Number(p.entryTime) || null),
    exitTime: p.exitTime instanceof Date ? p.exitTime.getTime() : (Number(p.exitTime) || null),
    pnlAbs: p.pnlAbs == null ? null : Number(p.pnlAbs),
    fees: p.fees == null ? null : Number(p.fees),
    // A backtest trade records its outcome as `result` (TP/SL/TIME/OPEN) — the
    // same fact a paper position calls exitReason.
    exitReason: p.exitReason ?? p.result ?? null,
    strategyVersionId: p.strategyVersionId ?? null,
    sessionId: p.sessionId ?? null,
    rMultiple: r,
    paramsHash: p.stamp?.paramsHash ?? p.paramsHash ?? null,
    engineVersion: p.stamp?.engineVersion ?? p.engineVersion ?? null,
  }
}

/**
 * Outcome block. `sufficient` is the honest switch: below the floor the metrics
 * are still reported but flagged, and the caller must not present them as a
 * result (§27.1 / D12).
 */
export function outcomeMetrics(trades = [], { minTrades = EVIDENCE_MIN_TRADES } = {}) {
  const rows = Array.isArray(trades) ? trades : []
  let wins = 0
  let losses = 0
  let netPnlAbs = 0
  let pnlMeasured = 0
  let rSum = 0
  let rCount = 0
  for (const t of rows) {
    if (t?.pnlAbs != null && Number.isFinite(Number(t.pnlAbs))) {
      netPnlAbs += Number(t.pnlAbs)
      pnlMeasured += 1
    }
    if (t?.rMultiple != null && Number.isFinite(Number(t.rMultiple))) {
      rSum += Number(t.rMultiple)
      rCount += 1
      if (Number(t.rMultiple) > 0) wins += 1
      else losses += 1
    }
  }
  const floor = Math.max(1, Number(minTrades) || EVIDENCE_MIN_TRADES)
  return {
    // Sample size counts every closed trade in the evidence, including the ones
    // whose outcome could not be measured — dropping them would let a thin
    // sample look thicker than it is.
    trades: rows.length,
    wins,
    losses,
    // Rates need a measured denominator — no 0/0 "100% win rate".
    winRate: rCount > 0 ? wins / rCount : null,
    netPnlAbs: pnlMeasured > 0 ? netPnlAbs : null,
    expectancyR: rCount > 0 ? rSum / rCount : null,
    totalR: rCount > 0 ? rSum : null,
    rMeasured: rCount,
    pnlMeasured,
    minTrades: floor,
    // Sufficiency is about MEASURED outcomes: 20 unmeasurable rows prove nothing.
    sufficient: rCount >= floor,
  }
}

// -----------------------------------------------------------------------------
//  Bundle + freeze
// -----------------------------------------------------------------------------

/**
 * Build the (not yet frozen) evidence bundle for one source.
 *
 * @param {object} o
 * @param {string} o.kind     EVIDENCE_KINDS
 * @param {string} o.sourceId sessionId / runId / datasetId
 * @param {object} [o.session] trading session doc (sessions carry the manifest)
 * @param {object} [o.manifest] versioned identity of a NON-session source (a
 *   backtest run's stamp, a dataset's retention manifest). When given it
 *   replaces `session.manifest`; a source without a session stays `state: null`,
 *   `sessionId: null` and `sealed: true` — it is not a live run.
 * @param {string[]} [o.instruments] instruments of a non-session source
 * @param {string[]} [o.timeframes] timeframes of a non-session source
 * @param {string} [o.strategyVersionId] version of a non-session source (rare)
 * @param {string|null} [o.sessionId] explicit session link (pass `null` to keep
 *   a backtest run or dataset from claiming a session it does not have)
 * @param {object[]} [o.positions] closed positions produced by the source
 * @param {object[]} [o.orders] paper orders
 * @param {object[]} [o.fills] paper fills
 * @param {string[]} [o.datasetIds] datasets whose candles fed the source
 * @param {object|null} [o.dataQuality] data-center quality summary + notes
 * @param {string[]} [o.notes] extra coverage/limitation notes
 * @param {number} [o.frozenAt]
 */
export function buildEvidenceBundle(o = {}) {
  const kind = String(o.kind ?? '')
  const sourceId = String(o.sourceId ?? '')
  const id = evidenceSetIdFor({ kind, sourceId }) // validates kind + sourceId

  const session = o.session && typeof o.session === 'object' ? o.session : null
  const trades = (Array.isArray(o.positions) ? o.positions : []).map(evidenceTrade)
  const orders = Array.isArray(o.orders) ? o.orders : []
  const fills = Array.isArray(o.fills) ? o.fills : []
  const frozenAt = Number(o.frozenAt ?? 0)
  if (!Number.isFinite(frozenAt) || frozenAt <= 0) {
    throw new Error('evidence: frozenAt must be a positive epoch ms')
  }

  const metrics = outcomeMetrics(trades, { minTrades: o.minTrades ?? EVIDENCE_MIN_TRADES })
  const state = session ? String(session.state ?? '') : null
  const sealed = !session || EVIDENCE_SEALED_SESSION_STATES.includes(state)

  // Non-session sources (a backtest run, a dataset) declare their own versioned
  // identity instead of borrowing a session's; when neither exists the bundle
  // must SAY SO rather than carry a null manifest silently.
  const manifest = o.manifest !== undefined ? o.manifest ?? null : (session?.manifest ?? null)
  const instruments = o.instruments ?? session?.instruments ?? []
  const timeframes = o.timeframes ?? session?.timeframes ?? []
  const strategyVersionId = o.strategyVersionId !== undefined
    ? o.strategyVersionId ?? null
    : (session?.strategyVersionId ?? null)

  // Limitations are the point of the document, not a disclaimer at the bottom:
  // every one of them is a reason a reader could NOT conclude something.
  const limitations = []
  if (session && !sealed) limitations.push(`source session is ${state || 'unknown'} — evidence is still moving`)
  if (!metrics.sufficient) {
    limitations.push(`only ${metrics.rMeasured}/${metrics.trades} closed trade(s) had a measured R; the evidence floor is ${metrics.minTrades}`)
  }
  if (manifest === null) limitations.push('no versioned manifest on the source — engine/params/data identity is not provable')
  for (const n of Array.isArray(o.notes) ? o.notes : []) limitations.push(String(n))

  const qualityState = o.dataQuality && typeof o.dataQuality === 'object' ? String(o.dataQuality.state ?? 'unknown') : 'unknown'

  return {
    setId: id,
    kind,
    sourceId,
    sessionId: o.sessionId !== undefined
      ? o.sessionId
      : (session ? String(session.sessionId ?? sourceId) : null),
    state,
    sealed,
    accountId: session ? String(session.accountId ?? 'default') : null,
    strategyVersionId,
    instruments,
    timeframes,
    manifest,
    counts: { orders: orders.length, fills: fills.length, trades: metrics.trades },
    keys: {
      orderKeys: orders.map((x) => String(x?.clientOrderId ?? x?._id ?? '')).filter(Boolean),
      fillKeys: fills.map((x) => String(x?.fillId ?? x?._id ?? '')).filter(Boolean),
      positionKeys: trades.map((t) => t.key).filter(Boolean),
      // Phase F: journal rows are linked by upstream fill identity, so the keys
      // are facts about THIS session (an empty list means none were found).
      journalKeys: Array.isArray(o.journalKeys) ? o.journalKeys.map(String) : (session?.journalKeys ?? []),
    },
    trades,
    metrics,
    dataQuality: {
      state: qualityState,
      datasets: (Array.isArray(o.datasetIds) ? o.datasetIds : []).map(String),
    },
    limitations,
    // Time is UTC epoch ms everywhere (D2); each stamp keeps its own meaning —
    // `frozenAt` is when the evidence was captured, never a substitute for when
    // the events happened.
    pointInTime: {
      frozenAt,
      sessionStartedAt: Number(session?.startedAt) || null,
      sessionStoppedAt: Number(session?.stoppedAt) || null,
    },
  }
}

/**
 * Content hash of a bundle. Deliberately excludes nothing that could change a
 * conclusion and nothing that is a timestamp: the same facts must hash the same,
 * while `pointInTime` is recorded alongside so the freeze moment is still
 * auditable.
 */
export function evidenceHash(bundle) {
  const b = bundle ?? {}
  const canon = {
    setId: b.setId,
    kind: b.kind,
    sourceId: b.sourceId,
    sessionId: b.sessionId,
    strategyVersionId: b.strategyVersionId,
    instruments: b.instruments ?? [],
    timeframes: b.timeframes ?? [],
    manifest: b.manifest ?? null,
    counts: b.counts ?? null,
    keys: b.keys ?? null,
    trades: b.trades ?? [],
    metrics: b.metrics ?? null,
    dataQuality: b.dataQuality ?? null,
    limitations: b.limitations ?? [],
  }
  return 'evh1_' + createHash('sha256').update(stableStringify(canon)).digest('hex').slice(0, 40)
}

/** Freeze a bundle into an immutable evidence-set document. */
export function freezeEvidenceSet(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new Error('evidence: bundle required')
  const doc = {
    _id: bundle.setId,
    setId: bundle.setId,
    ...bundle,
    hash: evidenceHash(bundle),
    frozen: true,
    immutable: true,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
  }
  return Object.freeze(doc)
}

/** Re-derive the hash and compare: an edited evidence set fails here. */
export function verifyEvidenceSet(doc) {
  if (!doc || typeof doc !== 'object') return fail('BAD_SET', 'evidence set doc required')
  if (!doc.frozen) return fail('NOT_FROZEN', 'evidence set is not frozen')
  const expected = String(doc.hash ?? '')
  if (!expected) return fail('NO_HASH', 'evidence set has no hash')
  const actual = evidenceHash(doc)
  if (actual !== expected) return fail('SET_TAMPERED', 'evidence set hash does not match its content')
  return { ok: true, hash: actual }
}

/** Sufficiency verdict for a set/bundle (metrics re-used, never re-derived). */
export function evidenceSufficiency(doc, { minTrades = EVIDENCE_MIN_TRADES, pit = null } = {}) {
  const metrics = doc?.metrics ?? outcomeMetrics(doc?.trades ?? [], { minTrades })
  const floor = Math.max(1, Number(minTrades) || EVIDENCE_MIN_TRADES)
  const reasons = []
  if (!metrics.sufficient) reasons.push(`trades ${metrics.trades} < floor ${floor}`)
  if (reasons.length === 0 && doc?.sealed === false) reasons.push('source session has not stopped')
  // Phase F: a set that leaks records past its own cut-off is not sufficient,
  // however many trades it contains.
  if (pit && pit.ok === false && Array.isArray(pit.violations) && pit.violations.length > 0) {
    const codes = [...new Set(pit.violations.map((v) => String(v?.code ?? 'VIOLATION')))]
    reasons.push(`point-in-time violations: ${codes.join(', ')}`)
  }
  return { sufficient: reasons.length === 0, trades: metrics.trades, minTrades: floor, reasons }
}

// -----------------------------------------------------------------------------
//  Linking AI output to evidence (the Slice E acceptance rule)
// -----------------------------------------------------------------------------

/**
 * Does this proposal cite usable evidence?
 *
 * AI-generated proposals (they carry `generation`) MUST reference an existing
 * frozen set, and that set MUST describe the same strategy version — otherwise
 * the model reasoned about a different run and the experiment is not
 * reproducible. Hand-written proposals may skip the link; the caller decides
 * whether that is acceptable for its workflow.
 *
 * @returns {{ ok: boolean, code?: string, message?: string, required?: boolean }}
 */
export function proposalEvidenceLink(proposal, { evidenceSet = null, aiGenerated = null } = {}) {
  const p = proposal ?? {}
  const generated = aiGenerated === null ? !!p.generation : !!aiGenerated
  const cited = String(p.evidenceSetId ?? '').trim()

  if (!generated && !cited) return { ok: true, required: false }

  if (!cited) {
    return fail('EVIDENCE_REQUIRED', 'an AI-generated proposal must cite the evidence set it was derived from')
  }
  if (!evidenceSet || typeof evidenceSet !== 'object') {
    return fail('EVIDENCE_NOT_FOUND', `evidence set ${cited} does not exist — freeze it before citing it`)
  }
  const intact = verifyEvidenceSet(evidenceSet)
  if (!intact.ok) return intact
  if (String(evidenceSet.setId) !== cited) {
    return fail('EVIDENCE_MISMATCH', 'cited evidence set id does not match the loaded set')
  }
  const pv = p.strategyVersionId ?? null
  const ev = evidenceSet.strategyVersionId ?? null
  if (pv && ev && String(pv) !== String(ev)) {
    return fail('EVIDENCE_WRONG_VERSION', `evidence set belongs to ${ev}, proposal targets ${pv}`)
  }
  return { ok: true, required: true, hash: String(evidenceSet.hash) }
}

/**
 * May a paper-validation session be launched for this experiment (§59.15: the
 * candidate must stay separate from the active baseline until approved)?
 */
export function paperValidationEdge(experiment) {
  if (!experiment || typeof experiment !== 'object') return fail('BAD_EXPERIMENT', 'experiment required')
  const status = String(experiment.status ?? '')
  if (status !== 'paper_validation') {
    return fail('NOT_IN_PAPER_VALIDATION', `experiment is ${status || 'unknown'} — a validation session starts only from paper_validation`)
  }
  if (!experiment.strategyVersionId) {
    return fail('NO_CANDIDATE_VERSION', 'experiment has no strategy version to validate')
  }
  return { ok: true, candidateVersionId: String(experiment.strategyVersionId) }
}

/**
 * The candidate must not already BE the active version: that would mean it was
 * promoted silently, which D31 forbids.
 */
export function candidateIndependence({ candidateVersionId, activeVersionId } = {}) {
  const cand = String(candidateVersionId ?? '').trim()
  const active = String(activeVersionId ?? '').trim()
  if (!cand) return fail('NO_CANDIDATE_VERSION', 'candidateVersionId is required')
  if (active && cand === active) {
    return fail('CANDIDATE_IS_ACTIVE', 'the candidate is already the active version — this is no longer a validation')
  }
  return { ok: true, candidateVersionId: cand, activeVersionId: active || null }
}
