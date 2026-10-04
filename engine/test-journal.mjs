#!/usr/bin/env node
// =============================================================================
//  TM TRADING — fixtures for engine/journal.mjs (roadmap Phase 13, item 1)
//
//  Pure logic + the NDJSON store only: no Mongo, no network, no API key.
//  The Mongo path is covered by engine/test-db.mjs (SKIPs without a DB); here we
//  prove the derivation rules, the tag honesty, the query helpers and the
//  idempotency of the durable file store.
//
//  Run: node engine/test-journal.mjs   (wired into `npm test`)
// =============================================================================
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  UNKNOWN, MIN_TRADES_FOR_EVIDENCE,
  timeOf, rMultipleOf, journalKey, regimeAt, deriveResult, unknownFields,
  normalizeEntry, fromPosition, entriesFromPositions,
  filterJournal, journalStats, groupJournal, journalQuery,
  serializeEntry, writeJournalNdjson, readJournalNdjson, loadJournal, syncJournal,
} from './journal.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
function finish() {
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
  process.exit(fail === 0 ? 0 : 1)
}
// An unexpected throw must NEVER hide the summary line.
process.on('uncaughtException', (e) => { fail++; console.log(`  FAIL (unexpected throw) — ${e?.message || e}`); finish() })
process.on('unhandledRejection', (e) => { fail++; console.log(`  FAIL (unhandled rejection) — ${e?.message || e}`); finish() })

const tmp = mkdtempSync(join(tmpdir(), 'tm-journal-'))

// This suite must never touch a database. The pure core and the `mongo:false`
// IO path must not even pull the DB layer in (engine core stays install-free) —
// proven here, before anything else can import it.
check('pure core + mongo:false never import the DB layer (globalThis.__tmMongo undefined)', globalThis.__tmMongo === undefined)

// =============================================================================
section('1. timeOf + rMultipleOf — R is derived, never guessed')

check('timeOf(ISO Z) -> UTC ms', timeOf('2026-10-01T00:00:00Z') === Date.UTC(2026, 9, 1))
check('timeOf(Date) -> ms', timeOf(new Date(Date.UTC(2026, 9, 1))) === Date.UTC(2026, 9, 1))
check('timeOf(ms) -> ms', timeOf(1759276800000) === 1759276800000)
check('timeOf(garbage/null/"") -> null', timeOf('not-a-date') === null && timeOf(null) === null && timeOf('') === null)
check('timeOf(Invalid Date) -> null', timeOf(new Date('x')) === null)
check('LONG win 100/95 -> 110 = +2R', rMultipleOf({ dir: 1, entryPrice: 100, sl: 95, exitPrice: 110 }) === 2)
check('LONG loss 100/95 -> 95 = -1R', rMultipleOf({ dir: 1, entryPrice: 100, sl: 95, exitPrice: 95 }) === -1)
check('SHORT win 100/105 -> 90 = +2R', rMultipleOf({ dir: -1, entryPrice: 100, sl: 105, exitPrice: 90 }) === 2)
check('SHORT loss 100/105 -> 105 = -1R', rMultipleOf({ dir: -1, entryPrice: 100, sl: 105, exitPrice: 105 }) === -1)
check('side names work too (BUY/SELL)', rMultipleOf({ dir: 'BUY', entryPrice: 100, sl: 95, exitPrice: 110 }) === 2)
check('SL == entry -> null (no risk distance, no R)', rMultipleOf({ dir: 1, entryPrice: 100, sl: 100, exitPrice: 110 }) === null)
check('missing exit -> null (open trade has no realized R)', rMultipleOf({ dir: 1, entryPrice: 100, sl: 95, exitPrice: null }) === null)
check('bad dir -> null', rMultipleOf({ dir: 0, entryPrice: 100, sl: 95, exitPrice: 110 }) === null)

// =============================================================================
section('2. journalKey — derived from the upstream identity (D3/D4)')

const k1 = journalKey({ account: 'paper', source: 'paper', externalId: 'tm-abc-0' })
check('deterministic (same input -> same key)', k1 === journalKey({ account: 'paper', source: 'paper', externalId: 'tm-abc-0' }))
check('prefixed + bounded length', k1.startsWith('j1_') && k1.length === 43, `len=${k1.length}`)
check('key order/casing of the object does not matter', k1 === journalKey({ source: 'paper', externalId: 'tm-abc-0', account: 'paper' }))
check('other account -> other key', k1 !== journalKey({ account: 'mt5-demo', source: 'paper', externalId: 'tm-abc-0' }))
check('other source -> other key', k1 !== journalKey({ account: 'paper', source: 'mt5', externalId: 'tm-abc-0' }))
check('other fill -> other key', k1 !== journalKey({ account: 'paper', source: 'paper', externalId: 'tm-abc-1' }))
check('falls back to the document id when there is no externalId', journalKey({ account: 'manual', source: 'manual', id: 'p9' }) === journalKey({ account: 'manual', source: 'manual', id: 'p9' }))
check('externalId wins over id (upstream ticket is the identity)', journalKey({ account: 'a', source: 'mt5', externalId: 'X1', id: 'p1' }) === journalKey({ account: 'a', source: 'mt5', externalId: 'X1' }))
let keyThrew = false
try { journalKey({ account: 'a', source: 'paper' }) } catch { keyThrew = true }
check('no identity at all -> throws (an anonymous fill is not a row)', keyThrew)

// =============================================================================
section('3. regimeAt — point-in-time only (no look-ahead)')

const snaps = [
  { ts: '2026-09-20T00:00:00Z', data: { season: 'btc' } },
  { ts: '2026-10-01T00:00:00Z', data: { season: 'alt' } },
  { ts: '2026-10-05T00:00:00Z', data: { season: 'neutral' } },
]
check('latest snapshot BEFORE the trade wins', regimeAt('2026-10-02T00:00:00Z', snaps) === 'alt')
check('a later snapshot must NOT tag an earlier trade (no look-ahead)', regimeAt('2026-09-25T00:00:00Z', snaps) === 'btc')
check('trade before every snapshot -> unknown', regimeAt('2026-09-01T00:00:00Z', snaps) === UNKNOWN)
check('no snapshots -> unknown', regimeAt('2026-10-02T00:00:00Z', []) === UNKNOWN)
check('snapshot without data.season -> unknown', regimeAt('2026-10-02T00:00:00Z', [{ ts: '2026-10-01T00:00:00Z', data: {} }]) === UNKNOWN)
check('unusable entry time -> unknown', regimeAt(null, snaps) === UNKNOWN)

// =============================================================================
section('4. deriveResult — the reason is derived from levels, else unknown')

check('closed at the stop level -> SL', deriveResult({ dir: 1, sl: 95, tps: [110], exitPrice: 95, status: 'closed' }) === 'SL')
check('closed at TP2 -> TP', deriveResult({ dir: 1, sl: 95, tps: [105, 110], exitPrice: 110, status: 'closed' }) === 'TP')
check('closed NOT at a level (gap fill) -> unknown, not a guess', deriveResult({ dir: 1, sl: 95, tps: [110], exitPrice: 93.4, status: 'closed' }) === UNKNOWN)
check('open position -> OPEN', deriveResult({ dir: 1, sl: 95, tps: [110], exitPrice: null, status: 'open' }) === 'OPEN')
check('unknown status -> unknown', deriveResult({ dir: 1, sl: 95, tps: [110], exitPrice: 95, status: 'cancelled' }) === UNKNOWN)
check('executor reason wins when it is available (alert:TAKE_PROFIT)', deriveResult({ dir: 1, sl: 95, tps: [110], exitPrice: 93.4, status: 'closed', exitReason: 'alert:TAKE_PROFIT' }) === 'TP')
check('executor reason wins (data:sl)', deriveResult({ dir: 1, sl: 95, tps: [110], exitPrice: 93.4, status: 'closed', exitReason: 'data:sl' }) === 'SL')

// =============================================================================
section('5. fromPosition — the tag set, and what "unknown" means')

const alert = { alertKey: 'a1_xyz', tf: '15' }
const pos = {
  _id: 'p1', account: 'paper', source: 'paper', externalId: 'tm-abc-0',
  symbol: 'BTCUSDT', dir: 1, qty: 1, entryPrice: 100, entryTime: new Date('2026-10-02T00:00:00Z'),
  sl: 95, tps: [105, 110], exitPrice: 110, exitTime: new Date('2026-10-02T04:00:00Z'),
  status: 'closed', pnlAbs: 10, pnlPct: 10, method: null, paramsHash: null, signalKey: 'a1_xyz',
}
const e1 = fromPosition(pos, { alert, regimeSnapshots: snaps })
check('symbol/dir/source carried over', e1.symbol === 'BTCUSDT' && e1.dir === 1 && e1.source === 'paper')
check('tf resolved through the opening alert (positions do not store tf)', e1.tf === '15')
check('result derived from the levels (TP)', e1.result === 'TP')
check('R derived from entry/sl/exit (+2R)', e1.rMultiple === 2)
check('regime from the point-in-time snapshot', e1.regime === 'alt')
check('entryTime is a Date (UTC, D2)', e1.entryTime instanceof Date && e1.entryTime.toISOString() === '2026-10-02T00:00:00.000Z')
check('fees stay null — paper PnL is fee-free by design, 0 would be a claim', e1.fees === null)
check('engineVersion/paramsHash unknown (nothing live stamps them yet)', e1.engineVersion === UNKNOWN && e1.paramsHash === UNKNOWN)
check('unknown[] lists exactly the non-derivable tags',
  JSON.stringify(e1.unknown) === JSON.stringify(['fees', 'method', 'engineVersion', 'paramsHash']), JSON.stringify(e1.unknown))
check('key matches journalKey() of the same identity', e1.key === journalKey({ account: 'paper', source: 'paper', externalId: 'tm-abc-0' }))

const e1b = fromPosition(pos, { regimeSnapshots: snaps })
check('no alert -> tf unknown (never invented)', e1b.tf === UNKNOWN && e1b.unknown.includes('tf'))

const openPos = { ...pos, status: 'open', exitPrice: null, exitTime: null, pnlAbs: null, pnlPct: null }
const e2 = fromPosition(openPos, { alert, regimeSnapshots: snaps })
check('open position -> result OPEN', e2.result === 'OPEN')
check('open position: exitPrice/R are not-applicable, not unknown',
  !e2.unknown.includes('exitPrice') && !e2.unknown.includes('rMultiple') && e2.rMultiple === null)
check('open position still reports its unknown tags', e2.unknown.includes('fees'))

const e3 = fromPosition({ ...pos, exitPrice: 97, method: 'vsa' }, { alert, regimeSnapshots: snaps })
check('exit not on a level -> result unknown while R is still computed', e3.result === UNKNOWN && e3.rMultiple === -0.6)
check('provided method is kept', e3.method === 'vsa' && !e3.unknown.includes('method'))

const e4 = fromPosition({ ...pos, paramsHash: 'deadbeef', engineVersion: '0.5.0' }, { alert })
check('stamps already on the row are kept as-is', e4.paramsHash === 'deadbeef' && e4.engineVersion === '0.5.0')
check('explicit stamps from the caller only fill the gap', fromPosition(pos, { alert, engineVersion: '0.5.0', paramsHash: 'aa' }).paramsHash === 'aa')

let noSymbol = false
try { fromPosition({ ...pos, symbol: null }) } catch { noSymbol = true }
check('position without symbol -> throws (not a silent row)', noSymbol)
let noDir = false
try { fromPosition({ ...pos, dir: 0 }) } catch { noDir = true }
check('position without direction -> throws', noDir)
let noTime = false
try { fromPosition({ ...pos, entryTime: null }) } catch { noTime = true }
check('position without entryTime -> throws (D2)', noTime)

const bulk = entriesFromPositions([pos, { ...pos, _id: 'p-bad', symbol: null }], { alerts: [alert], regimeSnapshots: snaps })
check('entriesFromPositions: one good row, one reported as skipped', bulk.entries.length === 1 && bulk.skipped.length === 1, JSON.stringify(bulk.skipped))
check('skipped rows carry a reason (a dropped trade must not vanish)', typeof bulk.skipped[0].reason === 'string' && bulk.skipped[0].reason.length > 0)

// =============================================================================
section('6. normalizeEntry — validation and the unknown bookkeeping')

const n1 = normalizeEntry({ source: 'manual', account: 'manual', id: 'm1', symbol: 'ethusdt', dir: -1, entryPrice: 200, sl: 210, tps: [180], exitPrice: 180, result: 'TP', entryTime: '2026-10-03T00:00:00Z' })
check('symbol kept verbatim; source/account kept', n1.symbol === 'ethusdt' && n1.source === 'manual' && n1.account === 'manual')
check('R derived for a short (+2R)', n1.rMultiple === 2)
check('unknown[] always present and consistent with unknownFields()', JSON.stringify(n1.unknown) === JSON.stringify(unknownFields(n1)))
check('schema version stamped on every row', n1.schema === 1)
check('recordedAt defaults to now (UTC Date)', n1.recordedAt instanceof Date && Number.isFinite(n1.recordedAt.getTime()))
check('an explicit key is respected (round-tripped rows keep their identity)', normalizeEntry({ ...n1, key: 'j1_explicit' }).key === 'j1_explicit')
check('result outside the enum -> unknown', normalizeEntry({ ...n1, result: 'WEIRD' }).result === UNKNOWN)
check('tps are numbers only', JSON.stringify(normalizeEntry({ ...n1, tps: [180, 'x', null] }).tps) === JSON.stringify([180]))
check('sourceId falls back to the document id', n1.sourceId === 'm1')

// =============================================================================
section('7. filterJournal — source/method/regime/date (half-open [from, to))')

const r1 = normalizeEntry({ source: 'paper', account: 'paper', id: 'r1', symbol: 'BTCUSDT', tf: '15', dir: 1, entryPrice: 100, sl: 95, tps: [110], exitPrice: 110, result: 'TP', method: 'vsa', regime: 'alt', entryTime: '2026-10-01T00:00:00Z' })
const r2 = normalizeEntry({ source: 'mt5', account: 'live', id: 'r2', symbol: 'XAUUSD', tf: '60', dir: -1, entryPrice: 2000, sl: 2020, tps: [1950], exitPrice: 1950, result: 'TP', method: 'price-action', regime: 'btc', entryTime: '2026-10-08T00:00:00Z' })
const r3 = normalizeEntry({ source: 'manual', account: 'paper', id: 'r3', symbol: 'BTCUSDT', tf: '15', dir: 1, entryPrice: 100, sl: 95, tps: [110], exitPrice: 95, result: 'SL', method: 'vsa', regime: UNKNOWN, entryTime: '2026-10-08T00:00:00Z' })
const all = [r1, r2, r3]

check('filter by source', filterJournal(all, { source: 'mt5' }).length === 1)
check('filter by method', filterJournal(all, { method: 'vsa' }).length === 2)
check('filter by regime', filterJournal(all, { regime: 'btc' }).length === 1)
check('filter by regime unknown is addressable', filterJournal(all, { regime: UNKNOWN }).length === 1)
check('filter by result', filterJournal(all, { result: 'SL' }).length === 1)
check('filter by symbol is case-insensitive', filterJournal(all, { symbol: 'btcusdt' }).length === 2)
check('filter by tf', filterJournal(all, { tf: '60' }).length === 1)
check('filter by account', filterJournal(all, { account: 'live' }).length === 1)
check('date range is half-open: entry at `from` included', filterJournal(all, { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z' }).length === 1)
check('date range: entry exactly at `to` excluded (no double counting)', filterJournal(all, { from: '2026-10-08T00:00:00Z', to: '2026-10-15T00:00:00Z' }).length === 2)
check('combined filters', filterJournal(all, { source: 'manual', method: 'vsa', result: 'SL' }).length === 1)
check('no filters -> everything', filterJournal(all, {}).length === 3)

// =============================================================================
section('8. journalStats — win rate + expectancy in R (with the honesty gates)')

const s = journalStats([r1, r2, r3])
check('closed counted, OPEN excluded', s.closed === 3 && s.open === 0)
check('R samples = closed rows with derivable R', s.rSamples === 3)
check('wins/losses', s.wins === 2 && s.losses === 1)
check('win rate = wins / R samples', Math.abs(s.winRate - 2 / 3) < 1e-12, String(s.winRate))
check('expectancy in R = mean R (+2, +2.5, -1 -> 1.1667R)', Math.abs(s.expectancyR - (2 + 2.5 - 1) / 3) < 1e-12, String(s.expectancyR))
check('median R', s.medianR === 2)
check('profit factor in R = gross win / gross loss', s.profitFactorR === 4.5)
check('below minTrades -> insufficient + explicit reason', s.insufficient === true && /insufficient evidence: 3\/20/.test(s.insufficientReason || ''), s.insufficientReason)

const sBig = journalStats(all, { minTrades: 2 })
check('minTrades honoured when there are enough R samples', sBig.insufficient === false && sBig.insufficientReason === null)

const noR = normalizeEntry({ source: 'manual', account: 'manual', id: 'noR', symbol: 'BTCUSDT', dir: 1, entryPrice: 100, sl: 100, tps: [110], exitPrice: 95, result: 'SL', entryTime: '2026-10-09T00:00:00Z' })
const sMix = journalStats([r1, r1, noR], { minTrades: 2 })
check('closed without a derivable R is excluded AND counted in rMissing', sMix.closed === 3 && sMix.rSamples === 2 && sMix.rMissing === 1)
check('win rate only over R samples (no silent denominator)', sMix.winRate === 1)

const openRow = normalizeEntry({ source: 'paper', account: 'paper', id: 'open1', symbol: 'BTCUSDT', dir: 1, entryPrice: 100, sl: 95, tps: [110], result: 'OPEN', entryTime: '2026-10-10T00:00:00Z' })
const sOpen = journalStats([openRow, r1])
check('OPEN trades are reported separately, never inside the win rate', sOpen.open === 1 && sOpen.closed === 1 && sOpen.rSamples === 1)
check('no losses -> profit factor is Infinity (not a made-up number)', journalStats([r1]).profitFactorR === Infinity)
check('empty set -> nulls, not zeros pretending to be results', journalStats([]).winRate === null && journalStats([]).expectancyR === null)
check('unknown tag counts are aggregated for the caller', journalStats([r1, r3]).unknownTagCounts.fees === 2)

// =============================================================================
section('9. groupJournal — buckets for the dashboard')

const g = groupJournal([r1, r2, r3], ['method'])
check('one bucket per method, sorted by size desc', g.length === 2 && g[0].values.method === 'vsa' && g[0].stats.n === 2, JSON.stringify(g.map((x) => [x.key, x.stats.n])))
const g2 = groupJournal([r1, r2, r3], 'method,regime')
check('composite key keeps generations of tags apart', g2.length === 3 && g2.some((x) => x.values.regime === UNKNOWN))
check('stats attached per bucket', g2.every((x) => typeof x.stats.rSamples === 'number'))
let gThrew = false
try { groupJournal(all, []) } catch { gThrew = true }
check('empty group spec -> throws instead of returning nonsense', gThrew)

// =============================================================================
section('10. NDJSON store — durable without Mongo, idempotent by key (D4)')

const file = join(tmp, 'journal.ndjson')
const w1 = writeJournalNdjson([r1, r2], file)
check('first write appends both rows', w1.written === 2 && w1.dupes === 0, JSON.stringify(w1))
const w2 = writeJournalNdjson([r1, r2, r3], file)
check('re-sync: known keys are not appended twice', w2.written === 1 && w2.dupes === 2, JSON.stringify(w2))
const rd = readJournalNdjson(file)
check('read returns 3 unique rows', rd.entries.length === 3 && rd.dupes === 0, JSON.stringify({ n: rd.entries.length, dupes: rd.dupes }))
check('dates are stored as ISO Z (D2)', typeof rd.entries[0].entryTime === 'string' && rd.entries[0].entryTime.endsWith('Z'))
check('serializeEntry keeps Date -> ISO for every timestamps field',
  serializeEntry(r1).entryTime.endsWith('Z') && serializeEntry(r1).recordedAt.endsWith('Z'))

appendFileSync(file, '{ this is not json }\n')
const rd2 = readJournalNdjson(file)
check('a corrupt line is skipped and COUNTED, not fatal', rd2.skipped === 1 && rd2.entries.length === 3, JSON.stringify({ skipped: rd2.skipped }))
appendFileSync(file, JSON.stringify(serializeEntry(r1)) + '\n')
check('a hand-appended duplicate is collapsed on read', readJournalNdjson(file).dupes === 1)

const loaded = await loadJournal({ file, mongo: false, filters: { source: 'paper' } })
check('loadJournal(mongo:false) reads the mirror and applies filters', loaded.source === 'ndjson' && loaded.entries.length === 1 && loaded.entries[0].key === r1.key)
check('loadJournal reports the skipped corrupt line as a warning', loaded.warnings.some((w) => /malformed/.test(w)), JSON.stringify(loaded.warnings))

// =============================================================================
section('11. syncJournal — positions -> journal without a database')

const syncFile = join(tmp, 'sync.ndjson')
const posA = { ...pos, externalId: 'tm-sync-0' }
const posB = { ...pos, _id: 'p2', externalId: 'tm-sync-1', exitPrice: 95, pnlAbs: -5, pnlPct: -5 }
const syn = await syncJournal({ mongo: false, file: syncFile, positions: [posA, posB, { _id: 'broken' }], alerts: [alert], regimeSnapshots: snaps, engineVersion: '0.5.0', paramsHash: 'aaa' })
check('scanned/entries counted', syn.scanned === 3 && syn.entries === 2, JSON.stringify({ scanned: syn.scanned, entries: syn.entries }))
check('unusable position reported with a reason', syn.skipped.length === 1 && /symbol is required/.test(syn.skipped[0].reason), JSON.stringify(syn.skipped))
check('NDJSON mirror written (always, even with Mongo off)', syn.ndjson === 2 && syn.mongo === false)
check('Mongo-unavailable is announced, not hidden', syn.warnings.some((w) => /NDJSON only/.test(w)), JSON.stringify(syn.warnings))
const syn2 = await syncJournal({ mongo: false, file: syncFile, positions: [posA, posB], alerts: [alert], regimeSnapshots: snaps })
check('re-sync is a no-op on the file store', syn2.ndjson === 0 && syn2.warnings.some((w) => /already present/.test(w)), JSON.stringify(syn2.warnings))
const reRead = await loadJournal({ file: syncFile, mongo: false })
check('declared stamps are applied where the position had none', reRead.entries.every((e) => e.engineVersion === '0.5.0' && e.paramsHash === 'aaa'))
check('derived R survives the round trip', reRead.entries.filter((e) => e.rMultiple === 2).length === 1)
// Strict callers must be told the truth — checked with MONGODB_URI cleared so
// this test can NEVER reach a real database even if the shell exports one.
const savedUri = process.env.MONGODB_URI
delete process.env.MONGODB_URI
let strictSync = false
try { await syncJournal({ mongo: true }) } catch { strictSync = true }
if (savedUri !== undefined) process.env.MONGODB_URI = savedUri
check('mongo:true with no connection throws (strict callers are not lied to)', strictSync)

// =============================================================================
section('12. journalQuery — index-friendly Mongo filter (same semantics)')

const q = journalQuery({ source: 'paper', method: 'vsa', symbol: 'btcusdt', tf: '15', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' })
check('scalar filters mapped', q.source === 'paper' && q.method === 'vsa' && q.tf === '15')
check('symbol upper-cased to match stored docs', q.symbol === 'BTCUSDT')
check('date range is a half-open Date range', q.entryTime.$gte instanceof Date && q.entryTime.$lt instanceof Date)
check('range width is exactly one day', q.entryTime.$lt.getTime() - q.entryTime.$gte.getTime() === 86400000)
check('empty filters -> empty query', JSON.stringify(journalQuery({})) === '{}')

check('MIN_TRADES_FOR_EVIDENCE is the D12 threshold used by the stats gate', MIN_TRADES_FOR_EVIDENCE === 20)

rmSync(tmp, { recursive: true, force: true })
finish()
