#!/usr/bin/env node
// =============================================================================
//  TM TRADING — test:stamp: THE LIVE VERSION STAMP (docs/data-model.md §10.3)
//  Drives `exec/risk.mjs recordOpen()` through an INJECTED fake model layer —
//  the write path is executed and its document inspected, WITHOUT a database —
//  plus the pure stamp helpers, the exit-reason wiring and the stampUnknown
//  exclusion that preset-drift applies.
//
//  Why this suite exists: the old defect (`recordOpen()` stored paramsHash: null
//  while the report compared against frozen backtest presets) lived INSIDE an IO
//  function nobody could call without Mongo, so it was invisible. This suite
//  keeps the write path honestly visible-to-tests, with zero Mongo/network key.
//
//  Run: node exec/test-stamp.mjs   (wired into `npm test`)
// =============================================================================
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ENGINE_VERSION, canonicalParams, paramsHash } from '../engine/version.mjs'
import {
  LIVE_PRESET_ENV, LIVE_PARAMS_ENV, exitReasonOf, exitReasonFromHit,
  resolveLivePreset, liveStamp, buildPositionDoc, isStampUnknown,
} from '../engine/stamp.mjs'
import { recordOpen } from './risk.mjs'
import { deriveResult } from '../engine/journal.mjs'
import { comparePresetDrift } from '../engine/preset-drift.mjs'

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
process.on('uncaughtException', (e) => { fail++; console.log(`  FAIL (unexpected throw) — ${e?.message || e}`); finish() })
process.on('unhandledRejection', (e) => { fail++; console.log(`  FAIL (unhandled rejection) — ${(e && e.message) || e}`); finish() })

const tmp = mkdtempSync(join(tmpdir(), 'tm-stamp-'))
const auditFile = join(tmp, 'risk-audit.ndjson')

// Importing exec/risk.mjs must NOT pull the DB layer (getModels is lazy, the
// suite only ever calls recordOpen with _models injected) — proven first.
check('importing the gate never imports the DB layer (globalThis.__tmMongo undefined)', globalThis.__tmMongo === undefined)

// Paper-style env must not leak into the assertions: remember what the shell
// had, clear it for the undeclared cases, restore at the very end.
const savedPresetEnv = process.env[LIVE_PRESET_ENV]
const savedParamsEnv = process.env[LIVE_PARAMS_ENV]
const clearLiveEnv = () => { delete process.env[LIVE_PRESET_ENV]; delete process.env[LIVE_PARAMS_ENV] }
clearLiveEnv()

// =============================================================================
section('1. resolveLivePreset — the live preset is DECLARED, never guessed (§10.3.1)')

const bare = resolveLivePreset({})
check('no declaration -> kind unknown, paramsHash null (NEVER engine DEFAULTS)',
  bare.kind === 'unknown' && bare.paramsHash === null && bare.params === null, JSON.stringify(bare))
const pinned = resolveLivePreset({ [LIVE_PRESET_ENV]: 'deadbeefcafe01' })
check('PAPER_LIVE_PRESET pins live trades to a backtest preset hash, verbatim',
  pinned.kind === 'declared' && pinned.paramsHash === 'deadbeefcafe01' && pinned.params === null)
const declaredJson = resolveLivePreset({ [LIVE_PARAMS_ENV]: '{"engineVersion":"0.6.0","rP":2}' })
check('PAPER_LIVE_PARAMS is canonicalised + hashed like the backtest side',
  declaredJson.kind === 'declared' && declaredJson.paramsHash === paramsHash(canonicalParams({ rP: 2 })), JSON.stringify(declaredJson.paramsHash))
check('engineVersion inside the params names the GENERATION, not a parameter',
  declaredJson.engineVersion === '0.6.0' && !('engineVersion' in (declaredJson.params ?? {})))
let badJson = false
try { resolveLivePreset({ [LIVE_PARAMS_ENV]: '{"rP":' }) } catch { badJson = true }
check('a declaration that cannot be read FAILS CLOSED (throws, never silent)',
  badJson)
check('a non-object declaration throws', (() => { try { resolveLivePreset({ [LIVE_PARAMS_ENV]: '[1,2]' }); return false } catch { return true } })())
check('an unreadable declaration file throws (fail closed, no silent unknown)',
  (() => {
    try { resolveLivePreset({ [LIVE_PARAMS_ENV]: 'no-such-file.json' }, () => { throw new Error('ENOENT') }); return false } catch { return true }
  })())
check('a file path is read through the injected reader (no disk in unit tests)',
  resolveLivePreset({ [LIVE_PARAMS_ENV]: 'x.json' }, () => '{"rP":3}').paramsHash === paramsHash(canonicalParams({ rP: 3 })))

// =============================================================================
section('2. liveStamp — the engine half is ALWAYS known, the preset half may not be')

const bare2 = liveStamp({ env: {} })
check('engineVersion is present even with no declaration (the engine IS known)',
  bare2.engineVersion === ENGINE_VERSION)
check('undeclared preset -> null hash, unknown kind', bare2.paramsHash === null && bare2.kind === 'unknown')
check('an explicit engineVersion wins (tests pin theirs)', liveStamp({ env: {}, engineVersion: '9.9.9' }).engineVersion === '9.9.9')
check('since is stamped by the caller (this module has no clock)',
  liveStamp({ env: {}, since: '2026-10-05T00:00:00.000Z' }).since === '2026-10-05T00:00:00.000Z')

// =============================================================================
section('3. buildPositionDoc — the canonical write payload (pure, §10.3)')

const declaredStamp = { engineVersion: '0.5.0', paramsHash: 'aaa', params: null, kind: 'declared', since: null }
const d1 = buildPositionDoc({
  account: 'paper', symbol: 'BTCUSDT', dir: 1, qty: 0.4, entryPrice: 100,
  sl: 95, tps: [110, 120], tf: '15', source: 'paper', alertKey: 'a1_xyz', method: 'vsa',
  stamp: declaredStamp, now: new Date('2026-10-05T00:00:00Z'),
})
check('declared stamp -> stampUnknown false, hash + kind persisted',
  d1.stampUnknown === false && d1.stamp.kind === 'declared' && d1.stamp.paramsHash === 'aaa' && d1.stamp.engineVersion === '0.5.0')
check('the two write-time defaults: entryTime (from injected now) + status open',
  d1.status === 'open' && d1.entryTime instanceof Date && d1.entryTime.toISOString() === '2026-10-05T00:00:00.000Z')
check('inputs become identities, not duplicate keys: alertKey -> signalKey', d1.signalKey === 'a1_xyz' && !('alertKey' in d1))
check('write payload carries no clock keys', !('now' in d1))
check('caller fields carried: source/tf/externalId/method', d1.source === 'paper' && d1.tf === '15' && d1.method === 'vsa')
const unknownDoc = buildPositionDoc({ symbol: 'X', dir: -1, qty: 1, entryPrice: 10, stamp: liveStamp({ env: {} }) })
check('undeclared stamp -> stampUnknown TRUE (visible in the data, §10.3)',
  unknownDoc.stampUnknown === true && unknownDoc.stamp.kind === 'unknown' && unknownDoc.stamp.paramsHash === null)
check('undeclared still stamps the engine (D1: the engine IS known)', unknownDoc.stamp.engineVersion === ENGINE_VERSION)
const sinceDoc = buildPositionDoc({ stamp: { ...declaredStamp }, now: new Date('2026-10-05T12:00:00Z') })
check('stamp.since is an ISO UTC instant (D2)', sinceDoc.stamp.since === '2026-10-05T12:00:00.000Z')
let mismatchThrows = false
try { buildPositionDoc({ stamp: { engineVersion: '0.5.0', paramsHash: 'aaa', params: { rP: 99 }, kind: 'declared' } }) } catch { mismatchThrows = true }
check('a stamp that cannot be reproduced THROWS (a lie is worse than a missing stamp)', mismatchThrows)
const livePreset = resolveLivePreset({ [LIVE_PARAMS_ENV]: '{"engineVersion":"0.6.0","rP":2}' })
check('a declared pair survives its own verification', buildPositionDoc({ stamp: livePreset }).stampUnknown === false)

// =============================================================================
section('4. recordOpen through an INJECTED fake model layer (the write path, no DB)')

// The fake writes through the same code the paper executor uses — injected, so
// no socket is ever opened and no real collection is touched.
const created = []
const updated = []
const riskRows = []
const fakeModels = {
  Position: {
    create: async (doc) => {
      created.push(doc)
      return { _id: `pos${created.length}`, ...doc }
    },
  },
  RiskState: {
    findOne: (q) => ({
      lean: async () => riskRows.find((r) => r.account === q.account && (!q.utcDay || r.utcDay === q.utcDay)) ?? null,
      sort: () => ({ lean: async () => null }), // no history on day one
    }),
    create: async (row) => { riskRows.push({ ...row }); return row },
    updateOne: async (q, update, opts) => {
      updated.push({ q, update, opts })
      const r = riskRows.find((x) => x.account === q.account && x.utcDay === q.utcDay)
      if (r && update?.$inc?.tradesOpened) r.tradesOpened = (r.tradesOpened ?? 0) + update.$inc.tradesOpened
      return { upsertedCount: 1 }
    },
  },
}
const cfg = { account: 'paper', equity: 10000, riskPerTradePct: 1, kellyFraction: 0, kellyMaxPct: 3, dailyLossCapPct: 5, maxLeverage: 5, maxOpen: 5, exposurePct: 500, minRR: 1.5, closeOnHalt: false }

const undeclared = await recordOpen({
  config: cfg, symbol: 'BTCUSDT', qty: 0.4, dir: 1, entryPrice: 100, sl: 95, tps: [110],
  externalId: 'tm-u1-0', alertKey: 'a-u1', method: 'vsa', tf: '15', source: 'paper',
  _models: fakeModels, auditFile,
})
check('recordOpen returns the stamp it wrote', undeclared.opened === true && undeclared.positionId === 'pos1' && undeclared.stampUnknown === true)
const stored = created[created.length - 1]
check('the STORED document carries positions.stamp (§10.3)',
  stored.stamp && stored.stamp.engineVersion === ENGINE_VERSION && stored.stamp.kind === 'unknown')
check('stored document is marked stampUnknown (excludable, not anonymous)', stored.stampUnknown === true && stored.stamp.paramsHash === null)
check('stored document keeps tf/source/signalKey from the alert',
  stored.tf === '15' && stored.source === 'paper' && stored.signalKey === 'a-u1' && stored.externalId === 'tm-u1-0' && stored.status === 'open')
const createdBeforeMismatch = created.length
let mismatchOpenThrows = false
try {
  await recordOpen({
    config: cfg, symbol: 'ETH', qty: 1, dir: 1, entryPrice: 10, sl: 9, tps: [12],
    stamp: { engineVersion: '0.5.0', paramsHash: 'zzz-no-match', params: { rP: 99 }, kind: 'declared' },
    _models: fakeModels, auditFile,
  })
} catch { mismatchOpenThrows = true }
check('a rejected open stores NOTHING (throw before Position.create)', mismatchOpenThrows && created.length === createdBeforeMismatch)
check('the day counter is incremented through the injected layer', updated.some((u) => u.update?.$inc?.tradesOpened === 1))
const auditText = readFileSync(auditFile, 'utf8')
check('the write path appends ONE audit line carrying the stamp (fail-audit-proof)',
  auditText.split('\n').filter(Boolean).length === 1
  && auditText.includes('"event":"position_opened"')
  && auditText.includes(`"engineVersion":"${ENGINE_VERSION}"`)
  && auditText.includes('"stampUnknown":true'))

// Declared: the operator pointed PAPER_LIVE_PRESET at a frozen preset hash.
process.env[LIVE_PRESET_ENV] = 'cafe01cafe01'
const declared = await recordOpen({
  config: cfg, symbol: 'BTCUSDT', qty: 0.4, dir: 1, entryPrice: 100, sl: 95, tps: [110],
  externalId: 'tm-u2-0', alertKey: 'a-u2', method: 'vsa', tf: '15', source: 'paper',
  _models: fakeModels, auditFile,
})
delete process.env[LIVE_PRESET_ENV]
check('a DECLARED live preset is pinned on the stored doc (D1 identity)',
  declared.stampUnknown === false && declared.stamp.kind === 'declared' && declared.stamp.paramsHash === 'cafe01cafe01')
check('declared doc paramsHash lands on the persisted row', created[created.length - 1].stamp.paramsHash === 'cafe01cafe01')
check('a second open keeps the audit honest (one line per open)', readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).length === 2)

// =============================================================================
section('5. exit-reason wiring — the exit path says WHY, the journal trusts it (§10.3.2)')

check('alert:TAKE_PROFIT/STOP_LOSS pass through (TradingView already saw them)',
  exitReasonOf('alert', 'TAKE_PROFIT') === 'alert:TAKE_PROFIT' && exitReasonOf('alert', 'stop_loss') === 'alert:STOP_LOSS')
check('TIME_CLOSE -> alert:TIME_CLOSE', exitReasonOf('alert', 'TIME_CLOSE') === 'alert:TIME_CLOSE')
check('data kind tp/sl -> data:tp / data:sl', exitReasonOf('data', 'tp') === 'data:tp' && exitReasonOf('data', 'sl') === 'data:sl')
check('an unknown data kind is NOT promoted to a real one', exitReasonOf('data', 'weird') === 'unknown' && exitReasonOf('data', 'unknown') === 'unknown')
check('manual stays manual', exitReasonOf('manual', 'anything') === 'manual')
check('findFirstExit hit -> exitReason (tp/sl only)', exitReasonFromHit({ kind: 'tp' }) === 'data:tp' && exitReasonFromHit({ kind: 'sl' }) === 'data:sl')
check('findFirstExit null -> unknown: nothing decided, nothing recorded', exitReasonFromHit(null) === 'unknown')
const paperSrc = readFileSync(new URL('./paper.mjs', import.meta.url), 'utf8')
check('follow-up closes with the ALERT reason (the event TV already saw)',
  /exitReasonOf\('alert',\s*f\.action\)/.test(paperSrc))
check('data exits close with the SCAN reason (only that path knows kind)',
  /exitReasonFromHit\(hit\)/.test(paperSrc))
check('closePosition PERSISTS the reason on the position (#10.3.2)', /\$set: \{ status: 'closed'[^}]*exitReason \}/.test(paperSrc))
check('entry hand-off stores the doc through recordOpen (stamp write point)',
  /recordOpen\(\{/.test(paperSrc) && /stampUnknown/.test(readFileSync(new URL('./risk.mjs', import.meta.url), 'utf8')))

// =============================================================================
section('6. exclusion — preset-drift gets only stamped rows (§10.4)')

const rows = [
  { engineVersion: ENGINE_VERSION, paramsHash: 'abc', dir: 1, entryPrice: 100, sl: 95, exitPrice: 110, result: 'TP', entryTime: '2026-10-01T00:00:00Z' },
  { engineVersion: ENGINE_VERSION, paramsHash: undefined, dir: 1, entryPrice: 100, sl: 95, exitPrice: 95, result: 'SL', entryTime: '2026-10-01T00:00:00Z' },
  { engineVersion: undefined, paramsHash: undefined, dir: 1, entryPrice: 100, sl: 95, exitPrice: 95, result: 'SL', entryTime: '2026-10-01T00:00:00Z' },
]
const frozen = [{ engineVersion: ENGINE_VERSION, paramsHash: 'abc', dir: 1, entryPrice: 100, sl: 95, exitPrice: 110, result: 'TP', entryTime: '2026-09-01T00:00:00Z' }]
const rep = comparePresetDrift({ live: rows, backtest: frozen, minTrades: 0 })
check('isStampUnknown: declared row usable; missing halves + legacy unknown all excluded',
  !isStampUnknown(rows[0]) && isStampUnknown(rows[1]) && isStampUnknown(rows[2])
  && isStampUnknown({ stampUnknown: true }) && !isStampUnknown({ stamp: { engineVersion: ENGINE_VERSION, paramsHash: 'abc' } }))
check('comparePresetDrift excludes the unstamped rows from EVERY bucket', rep.liveGenerations.length === 1 && rep.buckets.length === 1)
check('the excluded count is on the report', rep.excludedUnknown === 2)
check('a warning carries the count (never silent)', rep.warnings.some((w) => /2 live row\(s\) with NO version stamp/.test(w)))
check('a stale undeclared doc is excluded by its OWN flag, even if it looks stamped',
  (() => {
    const r2 = comparePresetDrift({
      live: [{ engineVersion: ENGINE_VERSION, paramsHash: undefined, stampUnknown: true, result: 'TP', rMultiple: 1, entryTime: new Date('2026-10-01T00:00:00Z').getTime() }],
      backtest: frozen, minTrades: 0,
    })
    return r2.buckets.length === 0 && r2.excludedUnknown === 1
  })())

// The recorded exit reason survives into the journal result (§10.3.2 end-to-end).
check("data:tp maps to journal result 'TP' (executor trusted over levels)",
  deriveResult({ dir: 1, sl: 95, tps: [110], exitPrice: 93.4, status: 'closed', exitReason: 'data:tp' }) === 'TP')
check("alert:STOP_LOSS maps to 'SL' even when the fill missed the level",
  deriveResult({ dir: 1, sl: 95, tps: [110], exitPrice: 93.4, status: 'closed', exitReason: 'alert:STOP_LOSS' }) === 'SL')

// This suite must never open a socket or import the DB layer — proven again at
// the END, after the write path has run through the fake models.
check('nothing in this suite pulled the DB layer in (globalThis.__tmMongo undefined)', globalThis.__tmMongo === undefined)

// Restore the shell environment before the summary line.
if (savedPresetEnv !== undefined) process.env[LIVE_PRESET_ENV] = savedPresetEnv
if (savedParamsEnv !== undefined) process.env[LIVE_PARAMS_ENV] = savedParamsEnv

rmSync(tmp, { recursive: true, force: true })
finish()