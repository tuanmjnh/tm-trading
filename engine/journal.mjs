#!/usr/bin/env node
// =============================================================================
//  TM TRADING — CENTRAL TRADE JOURNAL (roadmap Phase 13, item 1)
//
//  ONE journal for every EXECUTED trade, whichever path produced it: the paper
//  executor, the MT5 bridge, an exchange sync or a manual entry. Backtest trades
//  are deliberately NOT journal rows — they are the frozen baseline this journal
//  is compared AGAINST (engine/preset-drift.mjs). Putting simulated and executed
//  fills in one table is exactly how a live win rate ends up averaging two
//  different things.
//
//  Where the rows come from (no new source of truth is invented):
//    positions  (engine/models/position.mjs) — "what is held" and the only place
//               a real fill exists. Its `source` already separates
//               paper|mt5|exchange|manual, and (account, source, externalId) is
//               already a UNIQUE sparse index, so the journal REFERENCES that
//               identity instead of inventing a parallel one.
//
//  D3/D4 respect: the journal key is DERIVED from the upstream identity
//  (account + source + externalId|_id). It is not a second order-id scheme:
//  nothing can place an order from it, and it changes whenever the upstream
//  identity changes, so two different fills can never be quietly merged into one
//  row. Re-syncing the same position is a no-op (unique index — the durable
//  dedupe of D4, not a Map in RAM).
//
//  Honesty rules (Phase 13 / D12 spirit):
//    - a tag that cannot be derived is recorded as `unknown` AND listed in
//      `entry.unknown` — it is never guessed;
//    - `fees` is null (unknown) rather than 0: null = a doc written before
//      Phase 7P or by a path that never measured costs — writing 0 would claim
//      costs were measured. Since Phase 7P exec/paper.mjs writes the MEASURED
//      round-trip fees of the simulation fill model, so a number here is real.
//    - `regime` is a POINT-IN-TIME lookup (latest intel snapshot at or before
//      entryTime). A later snapshot must never tag an earlier trade, otherwise
//      the journal leaks look-ahead information into its own review;
//    - `tf` comes from `positions.tf` when the executor stored it (written from
//      the opening alert since docs/data-model.md §10.3), else from the alert
//      that opened the position (signalKey -> alerts.alertKey), else unknown;
//    - the version stamp is read from `positions.stamp` (§10.3) — the WRITER's
//      declaration, the only one: this projection NEVER fills a missing stamp,
//      so a legacy row stays `unknown` and preset-drift can exclude it;
//    - `exitReason` is read from the position (recorded by the exit path where
//      the decision was made, §10.3.2) and mapped to `result`; when absent the
//      levels are consulted, `unknown` when that is not exact.
//
//  Layout: PURE CORE (no IO, no Mongo, no clock) + a thin IO layer, mirroring
//  exec/risk.mjs. The query/aggregate helpers are therefore testable without a
//  database and the engine core stays install-free.
//
//  CLI:
//    node engine/journal.mjs sync                 positions -> journal (Mongo + NDJSON)
//    node engine/journal.mjs list [--source paper] [--method vsa] [--regime alt]
//    node engine/journal.mjs stats [--by source,method,regime]
// =============================================================================
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { hashOf } from './version.mjs'
import { appendNdjson, readNdjson } from './store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Explicit sentinel: this value was NOT derivable. Never a placeholder number. */
export const UNKNOWN = 'unknown'
export const JOURNAL_FILE = join(ROOT, 'reports', 'journal.ndjson')
export const JOURNAL_SCHEMA_VERSION = 1
/** Executed-trade sources (same enum as engine/models/position.mjs + replay). */
export const JOURNAL_SOURCES = Object.freeze(['paper', 'mt5', 'exchange', 'manual', 'replay'])
export const EXECUTED_RESULTS = Object.freeze(['TP', 'SL', 'TIME', 'OPEN', UNKNOWN])
/** D12: below this many closed trades a bucket is not evidence, it is a rumour. */
export const MIN_TRADES_FOR_EVIDENCE = 20

// =============================================================================
//  Pure helpers
// =============================================================================

const num = (x) => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null)

/** Date | UTC ms | ISO string -> UTC ms. null = not a usable instant (D2). */
export function timeOf(x) {
  if (x === null || x === undefined || x === '') return null
  if (x instanceof Date) return Number.isFinite(x.getTime()) ? x.getTime() : null
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  const t = Date.parse(String(x))
  return Number.isFinite(t) ? t : null
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

/**
 * Realized R of one trade, derived from the recorded levels.
 * null = cannot be derived (never guess: zero/absent risk distance has no R).
 */
export function rMultipleOf({ dir, entryPrice, sl, exitPrice }) {
  const d = dir === 1 || dir === -1 ? dir : dir === 'BUY' ? 1 : dir === 'SELL' ? -1 : null
  const e = num(entryPrice)
  const s = num(sl)
  const x = num(exitPrice)
  if (d === null || e === null || s === null || x === null) return null
  const risk = Math.abs(e - s)
  if (!(risk > 0)) return null
  return (d * (x - e)) / risk
}

/**
 * Journal identity. DERIVED from the upstream fill identity — this is a
 * reference, not a competitor to alertKey/clientOrderId (D3).
 * @throws when the row has no identity at all (an anonymous fill is not a row)
 */
export function journalKey({ account, source, externalId, id } = {}) {
  const ref = externalId !== undefined && externalId !== null && externalId !== ''
    ? String(externalId)
    : id !== undefined && id !== null && id !== ''
      ? `id:${String(id)}`
      : null
  if (!ref) throw new Error('journalKey: need externalId or id — no identity, no journal row')
  return 'j1_' + hashOf({
    v: JOURNAL_SCHEMA_VERSION,
    account: String(account ?? ''),
    source: String(source ?? ''),
    ref,
  }).slice(0, 40)
}

/**
 * POINT-IN-TIME regime tag from intel snapshots (kind 'regime', data.season).
 * Only snapshots at or BEFORE `entryTime` count — tagging a trade with a regime
 * that was measured after it closed would be look-ahead information.
 */
export function regimeAt(entryTime, snapshots = []) {
  const t = timeOf(entryTime)
  if (t === null) return UNKNOWN
  let best = null
  let bestTs = -Infinity
  for (const s of snapshots ?? []) {
    const ts = timeOf(s?.ts ?? s?.time)
    if (ts === null || ts > t) continue
    if (ts > bestTs) {
      bestTs = ts
      best = s
    }
  }
  const season = best?.data?.season ?? best?.season
  return typeof season === 'string' && season ? season : UNKNOWN
}

/**
 * Result of a closed position. `positions.exitReason` records WHY it closed
 * (§10.3.2 — written by the exit path at the moment it decided), so the executor
 * reason wins whenever it is present. Without one the recorded levels are
 * consulted: a gap fill (paper fills the stop at the bar OPEN, not at the stop
 * level) matches no level and therefore stays `unknown` ON PURPOSE — calling it
 * TP or SL would be a guess.
 */
export function deriveResult({ dir, sl, tps, exitPrice, status, exitReason = null } = {}) {
  if (exitReason) {
    const r = String(exitReason).toUpperCase()
    if (r.includes('TAKE_PROFIT') || r.endsWith(':TP')) return 'TP'
    if (r.includes('STOP_LOSS') || r.endsWith(':SL')) return 'SL'
    if (r.includes('TIME_CLOSE')) return 'TIME'
  }
  if (status === 'open') return 'OPEN'
  const x = num(exitPrice)
  if (x === null || status !== 'closed') return UNKNOWN
  const near = (a) => (a === null ? false : Math.abs(x - a) <= Math.max(1e-9, Math.abs(a) * 1e-9))
  if (near(num(sl))) return 'SL'
  for (const t of Array.isArray(tps) ? tps : []) if (near(num(t))) return 'TP'
  return UNKNOWN
}

/** Fields that are checked for "not derivable" and reported in `entry.unknown`. */
export const TRACKED_TAGS = Object.freeze([
  'tf', 'fees', 'method', 'regime', 'engineVersion', 'paramsHash',
  'entryPrice', 'sl', 'exitPrice', 'result', 'rMultiple', 'pnlAbs', 'pnlPct',
])

/** Names of the tracked fields this row could not derive. Single source of truth. */
export function unknownFields(entry) {
  const out = []
  const openPosition = entry?.result === 'OPEN'
  for (const f of TRACKED_TAGS) {
    // An OPEN trade has no exit yet: that is "not applicable", not "unknown".
    if (openPosition && (f === 'exitPrice' || f === 'rMultiple')) continue
    const v = entry?.[f]
    if (v === null || v === undefined || v === UNKNOWN) out.push(f)
  }
  return out
}

/**
 * Canonical journal row. Throws only when the row is not identifiable at all
 * (no symbol / no direction / no instant): a row that cannot be attributed is
 * worse than no row.
 */
export function normalizeEntry(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('normalizeEntry: object required')
  const symbol = raw.symbol ? String(raw.symbol) : null
  if (!symbol) throw new Error('normalizeEntry: symbol is required')
  const dir = raw.dir === 1 || raw.dir === -1 ? raw.dir : null
  if (dir === null) throw new Error(`normalizeEntry: dir must be 1 or -1 (got ${JSON.stringify(raw.dir)})`)
  const entryTime = timeOf(raw.entryTime)
  if (entryTime === null) throw new Error('normalizeEntry: entryTime must be a Date, UTC ms or ISO string (D2)')
  const exitTime = timeOf(raw.exitTime)

  const result = EXECUTED_RESULTS.includes(raw.result) ? raw.result : UNKNOWN
  const str = (v) => (v === null || v === undefined || v === '' ? UNKNOWN : String(v))
  const entry = {
    schema: JOURNAL_SCHEMA_VERSION,
    key: raw.key ? String(raw.key) : journalKey(raw),
    source: str(raw.source),
    account: str(raw.account),
    sourceId: raw.externalId !== undefined && raw.externalId !== null && raw.externalId !== ''
      ? String(raw.externalId)
      : raw.id !== undefined && raw.id !== null && raw.id !== ''
        ? String(raw.id)
        : null,
    symbol,
    tf: str(raw.tf),
    dir,
    entryPrice: num(raw.entryPrice),
    exitPrice: num(raw.exitPrice),
    sl: num(raw.sl),
    tps: Array.isArray(raw.tps)
      // Number(null) is 0: filter the gaps BEFORE coercing, or a missing TP
      // level silently turns into a price of 0.
      ? raw.tps.filter((v) => v !== null && v !== undefined && v !== '').map(Number).filter(Number.isFinite)
      : [],
    qty: num(raw.qty),
    result,
    rMultiple: raw.rMultiple !== undefined && raw.rMultiple !== null
      ? num(raw.rMultiple)
      : rMultipleOf({ dir, entryPrice: raw.entryPrice, sl: raw.sl, exitPrice: raw.exitPrice }),
    pnlAbs: num(raw.pnlAbs),
    pnlPct: num(raw.pnlPct),
    fees: num(raw.fees),
    method: str(raw.method),
    regime: str(raw.regime),
    engineVersion: str(raw.engineVersion),
    paramsHash: str(raw.paramsHash),
    status: str(raw.status),
    entryTime: new Date(entryTime),
    exitTime: exitTime === null ? null : new Date(exitTime),
    recordedAt: raw.recordedAt ? new Date(timeOf(raw.recordedAt) ?? Date.now()) : new Date(),
    signalKey: raw.signalKey ? String(raw.signalKey) : null,
  }
  entry.unknown = unknownFields(entry)
  return entry
}

/**
 * A `positions` document -> one journal row.
 *
 * The version stamp is read from the position itself: nested `pos.stamp.*`
 * (docs/data-model.md §10.3) first, then the LEGACY top-level fields written
 * before §10.3. There is deliberately NO caller-supplied stamp parameter: the
 * writer (recordOpen) is the only source of truth, and a projection that could
 * relabel a legacy row would defeat the stampUnknown exclusion (§10.4).
 *
 * @param {object} pos     positions doc (lean is fine)
 * @param {object} [opts]
 * @param {object} [opts.alert]            alert doc for the opening signal (resolves tf)
 * @param {Array}  [opts.regimeSnapshots]  intel kind 'regime' docs
 * @param {string} [opts.exitReason]       fallback reason when the position itself carries none
 */
export function fromPosition(pos, opts = {}) {
  if (!pos || typeof pos !== 'object' || Array.isArray(pos)) throw new TypeError('fromPosition: position object required')
  const alert = opts.alert ?? null
  const tps = Array.isArray(pos.tps) ? pos.tps : []
  const status = String(pos.status ?? '')
  // The executor recorded WHY on the position (§10.3.2); the caller's string is
  // only a fallback for rows written before that field existed.
  const result = deriveResult({ dir: pos.dir, sl: pos.sl, tps, exitPrice: pos.exitPrice, status, exitReason: pos.exitReason ?? opts.exitReason ?? null })
  const st = pos.stamp && typeof pos.stamp === 'object' ? pos.stamp : null
  return normalizeEntry({
    source: pos.source,
    account: pos.account,
    externalId: pos.externalId,
    id: pos._id !== undefined && pos._id !== null ? String(pos._id) : pos.id,
    symbol: pos.symbol,
    tf: pos.tf ?? alert?.tf ?? null,
    dir: pos.dir,
    entryPrice: pos.entryPrice,
    exitPrice: pos.exitPrice,
    sl: pos.sl,
    tps,
    qty: pos.qty,
    result,
    pnlAbs: pos.pnlAbs,
    pnlPct: pos.pnlPct,
    // paper PnL is fee-free by design -> null (UNKNOWN) unless the executor wrote one
    fees: pos.fees,
    method: pos.method,
    regime: regimeAt(pos.entryTime, opts.regimeSnapshots ?? []),
    engineVersion: st?.engineVersion ?? pos.engineVersion ?? null,
    paramsHash: st?.paramsHash ?? pos.paramsHash ?? null,
    status,
    entryTime: pos.entryTime,
    exitTime: pos.exitTime,
    recordedAt: opts.recordedAt ?? null,
    signalKey: pos.signalKey,
  })
}

/**
 * Many positions -> journal rows. Unusable rows are RETURNED as `skipped` with a
 * reason instead of silently disappearing (a dropped trade is a lost data point).
 */
export function entriesFromPositions(positions, opts = {}) {
  const alertByKey = new Map(
    (opts.alerts ?? []).filter(Boolean).map((a) => [String(a.alertKey), a]),
  )
  const entries = []
  const skipped = []
  for (const p of positions ?? []) {
    try {
      const alert = p?.signalKey ? alertByKey.get(String(p.signalKey)) ?? null : null
      entries.push(fromPosition(p, { ...opts, alert }))
    } catch (e) {
      skipped.push({ id: String(p?._id ?? p?.externalId ?? ''), reason: e?.message || String(e) })
    }
  }
  return { entries, skipped }
}

// =============================================================================
//  Query + aggregation (pure — this is what the dashboard will call)
// =============================================================================

/**
 * Filter journal rows. Date range is HALF-OPEN [from, to) in UTC ms (D2), so two
 * adjacent windows never both contain the same trade.
 */
export function filterJournal(entries, f = {}) {
  const from = f.from === undefined || f.from === null ? null : timeOf(f.from)
  const to = f.to === undefined || f.to === null ? null : timeOf(f.to)
  return (entries ?? []).filter(Boolean).filter((e) => {
    if (f.source && e.source !== f.source) return false
    if (f.method && e.method !== f.method) return false
    if (f.regime && e.regime !== f.regime) return false
    if (f.result && e.result !== f.result) return false
    if (f.account && e.account !== f.account) return false
    if (f.engineVersion && e.engineVersion !== f.engineVersion) return false
    if (f.paramsHash && e.paramsHash !== f.paramsHash) return false
    if (f.symbol && String(e.symbol).toUpperCase() !== String(f.symbol).toUpperCase()) return false
    if (f.tf && String(e.tf) !== String(f.tf)) return false
    const t = timeOf(e.entryTime)
    if (from !== null && !(t !== null && t >= from)) return false
    if (to !== null && !(t !== null && t < to)) return false
    return true
  })
}

const median = (sorted) => {
  if (!sorted.length) return null
  if (sorted.length % 2) return sorted[(sorted.length - 1) / 2]
  return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
}

/**
 * Win rate / expectancy in R for a set of journal rows.
 *
 * R-metrics are computed ONLY over closed rows whose R could be derived;
 * `rMissing` says how many closed rows were left out, so a "clean" win rate can
 * never be mistaken for the win rate of the whole set. `insufficient` is the D12
 * gate: below `minTrades` R samples this is an observation, not a verdict.
 */
export function journalStats(entries, { minTrades = MIN_TRADES_FOR_EVIDENCE } = {}) {
  const list = (entries ?? []).filter(Boolean)
  const open = list.filter((e) => e.result === 'OPEN')
  const closed = list.filter((e) => e.result !== 'OPEN')
  const rs = closed.map((e) => e.rMultiple).filter(isNum)
  const wins = rs.filter((r) => r > 0)
  const losses = rs.filter((r) => r < 0)
  const grossWin = wins.reduce((s, r) => s + r, 0)
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0))
  const sumR = rs.reduce((s, r) => s + r, 0)
  const unknownTagCounts = {}
  for (const e of list) for (const f of e.unknown ?? []) unknownTagCounts[f] = (unknownTagCounts[f] ?? 0) + 1
  return {
    n: list.length,
    closed: closed.length,
    open: open.length,
    rSamples: rs.length,
    rMissing: closed.length - rs.length,
    wins: wins.length,
    losses: losses.length,
    flat: rs.length - wins.length - losses.length,
    winRate: rs.length ? wins.length / rs.length : null,
    expectancyR: rs.length ? sumR / rs.length : null,
    medianR: median([...rs].sort((a, b) => a - b)),
    sumR: rs.length ? sumR : null,
    profitFactorR: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    unknownTagCounts,
    minTrades,
    insufficient: rs.length < minTrades,
    insufficientReason: rs.length < minTrades
      ? `insufficient evidence: ${rs.length}/${minTrades} closed trades with a derivable R`
      : null,
  }
}

/**
 * Group rows by one or more fields (dot-free field names) and attach stats.
 * @param {object[]} entries
 * @param {string|string[]} by  e.g. ['source','method'] or 'regime'
 */
export function groupJournal(entries, by = ['source'], opts = {}) {
  const fields = Array.isArray(by) ? by : String(by).split(',').map((s) => s.trim()).filter(Boolean)
  if (!fields.length) throw new Error('groupJournal: need at least one group field')
  const groups = new Map()
  for (const e of entries ?? []) {
    if (!e) continue
    const values = {}
    for (const f of fields) values[f] = e[f] === undefined || e[f] === null ? UNKNOWN : e[f]
    const key = fields.map((f) => String(values[f])).join('|')
    if (!groups.has(key)) groups.set(key, { key, fields, values, entries: [] })
    groups.get(key).entries.push(e)
  }
  return [...groups.values()]
    .map((g) => ({ key: g.key, fields: g.fields, values: g.values, stats: journalStats(g.entries, opts) }))
    .sort((a, b) => b.stats.n - a.stats.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

// =============================================================================
//  NDJSON store — durable even when Mongo is absent (same philosophy as store.mjs)
// =============================================================================

/** Date -> ISO `Z` for NDJSON (D2); everything else is copied as-is. */
export function serializeEntry(entry) {
  return {
    ...entry,
    entryTime: entry.entryTime instanceof Date ? entry.entryTime.toISOString() : entry.entryTime,
    exitTime: entry.exitTime instanceof Date ? entry.exitTime.toISOString() : entry.exitTime,
    recordedAt: entry.recordedAt instanceof Date ? entry.recordedAt.toISOString() : entry.recordedAt,
  }
}

/**
 * Append rows that are not in the file yet. The file has no unique index, so the
 * key check is what makes NDJSON re-syncs idempotent too (D4 in spirit).
 */
export function writeJournalNdjson(entries, file = JOURNAL_FILE) {
  const { rows } = readNdjson(file)
  const seen = new Set(rows.map((r) => r?.key).filter(Boolean))
  let written = 0
  let dupes = 0
  for (const e of entries ?? []) {
    if (!e?.key) continue
    if (seen.has(e.key)) {
      dupes++
      continue
    }
    appendNdjson(file, serializeEntry(e))
    seen.add(e.key)
    written++
  }
  return { written, dupes }
}

export function readJournalNdjson(file = JOURNAL_FILE) {
  const { rows, skipped } = readNdjson(file)
  const byKey = new Map()
  let dupes = 0
  for (const r of rows) {
    const k = r?.key
    if (!k) continue
    if (byKey.has(k)) {
      dupes++
      continue
    }
    byKey.set(k, r)
  }
  return { entries: [...byKey.values()], skipped, dupes }
}

// =============================================================================
//  IO layer (Mongo, fail-soft) — only reached by sync/load, never by the pure API
// =============================================================================

let models = null
async function getModels() {
  if (models) return models
  const db = await import('./db.mjs')
  const conn = await db.connectMongo()
  if (!conn) return null
  const { Position, Alert, Journal, Intel } = await import('./models/index.mjs')
  try {
    await Journal.syncIndexes()
  } catch {
    // index already present or not creatable — inserts still work
  }
  models = { Position, Alert, Journal, Intel }
  return models
}

/** Index-friendly Mongo query for the same filters as `filterJournal`. */
export function journalQuery(f = {}) {
  const q = {}
  if (f.source) q.source = f.source
  if (f.method) q.method = f.method
  if (f.regime) q.regime = f.regime
  if (f.result) q.result = f.result
  if (f.account) q.account = f.account
  if (f.engineVersion) q.engineVersion = f.engineVersion
  if (f.paramsHash) q.paramsHash = f.paramsHash
  if (f.symbol) q.symbol = String(f.symbol).toUpperCase()
  if (f.tf) q.tf = String(f.tf)
  const from = f.from === undefined || f.from === null ? null : timeOf(f.from)
  const to = f.to === undefined || f.to === null ? null : timeOf(f.to)
  if (from !== null || to !== null) {
    q.entryTime = {}
    if (from !== null) q.entryTime.$gte = new Date(from)
    if (to !== null) q.entryTime.$lt = new Date(to) // half-open, matches filterJournal
  }
  return q
}

/**
 * positions -> journal. Mongo rows are pulled, alerts resolve the missing `tf`,
 * the regime history resolves the `regime` tag. NDJSON is written ALWAYS, Mongo
 * only when available (store.mjs rule: a missing DB must not break the run).
 *
 * @param {object} [opts]
 * @param {'auto'|false|true} [opts.mongo]
 * @param {string}  [opts.file]              NDJSON target ('' disables the mirror)
 * @param {object[]}[opts.positions]         injected rows (tests / backfills)
 * @param {object[]}[opts.alerts]            injected alert rows
 * @param {object[]}[opts.regimeSnapshots]   injected intel regime rows
 * @param {number}  [opts.limit]
 * @param {string}  [opts.account]
 *
 * NOTE: there is deliberately NO `engineVersion`/`paramsHash` declaration here
 * (docs/data-model.md §10.3.1: the declaration lives in PAPER_LIVE_PRESET /
 * PAPER_LIVE_PARAMS — where trades are OPENED — and nowhere else). This is a
 * projection: it copies the position's own stamp or writes `unknown`, never a
 * relabelled one.
 */
export async function syncJournal(opts = {}) {
  const {
    mongo = 'auto',
    file = JOURNAL_FILE,
    limit = 5000,
    account = null,
  } = opts
  const stats = { scanned: 0, entries: 0, added: 0, dupes: 0, ndjson: 0, mongo: false, skipped: [], warnings: [] }

  let positions = Array.isArray(opts.positions) ? opts.positions : null
  let alerts = Array.isArray(opts.alerts) ? opts.alerts : null
  let regimes = Array.isArray(opts.regimeSnapshots) ? opts.regimeSnapshots : null

  const m = mongo === false ? null : await getModels()
  if (!positions) {
    if (!m) {
      stats.warnings.push('mongo unavailable: nothing pulled (the journal is a projection of positions)')
      if (mongo === true) throw new Error('syncJournal: mongo:true but no connection')
      return stats
    }
    positions = await m.Position.find(account ? { account } : {}).sort({ entryTime: -1 }).limit(limit).lean()
    const keys = positions.map((p) => p?.signalKey).filter(Boolean)
    alerts = alerts ?? (keys.length ? await m.Alert.find({ alertKey: { $in: keys } }).select('alertKey tf').lean() : [])
    regimes = regimes ?? await m.Intel.find({ kind: 'regime' }).sort({ ts: -1 }).limit(500).lean()
  }
  stats.scanned = positions.length

  const built = entriesFromPositions(positions, {
    alerts: alerts ?? [],
    regimeSnapshots: regimes ?? [],
    recordedAt: opts.recordedAt ?? null,
  })
  stats.entries = built.entries.length
  stats.skipped = built.skipped
  if (!built.entries.length) return stats

  if (file) {
    const w = writeJournalNdjson(built.entries, file)
    stats.ndjson = w.written
    if (w.dupes) stats.warnings.push(`${w.dupes} row(s) already present in ${file} (key-based dedupe)`)
  }

  if (!m) {
    stats.warnings.push('mongo unavailable: NDJSON only')
    return stats
  }
  for (const e of built.entries) {
    try {
      await m.Journal.create(e)
      stats.added++
    } catch (err) {
      if (err?.code === 11000) stats.dupes++
      else stats.warnings.push(`insert failed for ${e.key}: ${err?.message || err}`)
    }
  }
  stats.mongo = true
  return stats
}

/**
 * Read the journal: Mongo when available, else the NDJSON mirror. Never throws
 * for a missing database — it reports `source` so a caller knows what it read.
 */
export async function loadJournal(opts = {}) {
  const { filters = {}, file = JOURNAL_FILE, limit = 5000, mongo = 'auto' } = opts
  if (mongo !== false) {
    const m = await getModels()
    if (m) {
      const rows = await m.Journal.find(journalQuery(filters)).sort({ entryTime: -1 }).limit(limit).lean()
      return { source: 'mongo', entries: rows.map((r) => normalizeEntry(r)), warnings: [] }
    }
    if (mongo === true) throw new Error('loadJournal: mongo:true but no connection')
  }
  const { entries, skipped, dupes } = readJournalNdjson(file)
  const warnings = []
  if (skipped) warnings.push(`${skipped} malformed NDJSON line(s) skipped in ${file}`)
  if (dupes) warnings.push(`${dupes} duplicate key(s) collapsed in ${file}`)
  return { source: 'ndjson', entries: filterJournal(entries.map((r) => normalizeEntry(r)), filters), warnings }
}

// =============================================================================
//  CLI
// =============================================================================
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  const cmd = args.find((a) => !a.startsWith('--')) || 'stats'
  const val = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const filters = {}
  for (const f of ['source', 'method', 'regime', 'symbol', 'tf', 'result', 'account', 'engineVersion', 'paramsHash', 'from', 'to']) {
    const v = val(`--${f}`)
    if (v !== undefined) filters[f] = v
  }
  const by = val('--by')

  try {
    if (cmd === 'sync') {
      const out = await syncJournal({ mongo: 'auto' })
      console.log(JSON.stringify(out, null, 2))
    } else {
      const loaded = await loadJournal({ filters, mongo: 'auto' })
      if (cmd === 'list') {
        console.log(JSON.stringify({ source: loaded.source, warnings: loaded.warnings, filters, count: loaded.entries.length, entries: loaded.entries.map(serializeEntry) }, null, 2))
      } else {
        const groups = by ? groupJournal(loaded.entries, by) : [{ key: 'all', values: {}, stats: journalStats(loaded.entries) }]
        console.log(JSON.stringify({ source: loaded.source, warnings: loaded.warnings, filters, groups }, null, 2))
      }
    }
  } catch (e) {
    console.error('[journal] error:', e?.message || e)
    process.exit(1)
  }
  process.exit(0)
}
