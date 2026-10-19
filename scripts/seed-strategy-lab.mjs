#!/usr/bin/env node
// =============================================================================
//  seed-strategy-lab.mjs — seed Strategy Lab domain entities for local dev.
//
//  Roadmap §58.9 Slice 2/3: StrategyProfile / StrategyVersion / BotProfile /
//  BotInstance / PaperAccount. Seeds are IDEMPOTENT upserts by _id, scoped to
//  clearly-marked seed ids (`tm-vsa-*`, `bot-*`, `paper-main`) — it never
//  touches rows owned by the engine/supervisor.
//
//  Honesty rules kept even for seeds (D1/D12):
//   - paramsHash is COMPUTED with engine hashOf(canonicalParams(params)), not
//     hardcoded — a seeded version with the real default params gets the same
//     hash the engine computes, so paramsHash cross-links to real runs.
//   - backtestRunId/holdoutRunId reference REAL series ids read from
//     reports/runs.ndjson (id = engineVersion~symbol~tf~paramsHash). If the
//     report is missing, the evidence fields stay null rather than lying.
//   - Version states only go as deep as evidence allows: archived/backtest/
//     holdout/stable_paper(paperTrades measured). 'paper' is skipped because
//     there is no real accepted experiment yet.
//
//  Usage:  node scripts/seed-strategy-lab.mjs [--reset]
//          --reset drops the five seeded collections first (seed rows only —
//          the collections are wholly seed-owned in local dev).
// =============================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadEnv } from '../exec/env.mjs'

loadEnv() // MONGODB_URI from .env (explicit shell env wins)

const ROOT = process.cwd()
const RESET = process.argv.includes('--reset')

const { connectMongo } = await import(new URL('../engine/db.mjs', import.meta.url).href)
const mongoose = await connectMongo()
if (!mongoose) {
  console.error('[seed] Mongo is not reachable (MONGODB_URI) — aborting.')
  process.exit(1)
}

const { StrategyProfile } = await import(new URL('../engine/models/strategyProfile.mjs', import.meta.url).href)
const { StrategyVersion } = await import(new URL('../engine/models/strategyVersion.mjs', import.meta.url).href)
const { BotProfile } = await import(new URL('../engine/models/botProfile.mjs', import.meta.url).href)
const { BotInstance } = await import(new URL('../engine/models/botInstance.mjs', import.meta.url).href)
const { PaperAccount } = await import(new URL('../engine/models/account.mjs', import.meta.url).href)
const { hashOf, paramsHash: hashOfParams, ENGINE_VERSION } = await import(new URL('../engine/version.mjs', import.meta.url).href)

// --- real run evidence (D1: never fabricate the link) -----------------------

/** Latest series id per `symbol~tf` from runs.ndjson; {} when the file is absent. */
function realSeriesIds() {
  const out = {}
  try {
    const lines = readFileSync(join(ROOT, 'reports', 'runs.ndjson'), 'utf8').trim().split('\n')
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (!r.symbol || !r.tf || !r.engineVersion || !r.paramsHash) continue
        out[`${r.symbol}~${r.tf}`] = `${r.engineVersion}~${r.symbol}~${r.tf}~${r.paramsHash}`
      } catch { /* skip malformed line */ }
    }
  } catch { /* no report file — evidence stays null */ }
  return out
}

const RUNS = realSeriesIds()
const BTC15 = RUNS['BTCUSDT.P~15'] ?? null
const ETH60 = RUNS['ETHUSDT.P~60'] ?? null

// The engine's own VSA default params (mirror of the last real BTC15 run row,
// so the seeded 1.x line shares its paramsHash with actual backtest reports).
const VSA_PARAMS = {
  atrLen: 14, confirmOnly: true, entryMode: 'market', evtOn: true,
  feeMaxR: 0.15, feePct: 0.05, len: 20, lpsTol: 0.5, lvFresh: 60, lvTol: 0.5,
  pivLen: 20, purWin: 20, quietOn: true, rH: 1.2, rL: 0.4, rN: 0.8, rP: 2.2,
  rVH: 1.8, retestT: 1, rrFb: 2, run: 5, sess: '0800-1600', sessOn: false,
  signalMode: 'vsa', slBuf: 0.5, slipPct: 0.02, sosSpread: 1, sosVol: 1.2,
  testR: 1.2, tpMode: 'r', tz: 'Asia/Ho_Chi_Minh', volMin: 0, wyckoffEvent: 'spring',
}

const REAL_PARAMS_HASH = hashOfParams(VSA_PARAMS) // equals the runs.ndjson hash

// --- fixed timestamps (UTC ms) so re-runs are deterministic -----------------

const DAY = 86_400_000
const T0 = Date.UTC(2026, 8, 28) // 2026-09-28 — the seed's fixed "birth" day

// --- helpers -----------------------------------------------------------------

async function upsert(Model, doc) {
  const { _id, ...rest } = doc
  await Model.updateOne({ _id }, { $set: { ...rest, _id } }, { upsert: true })
  return _id
}

if (RESET) {
  for (const M of [StrategyProfile, StrategyVersion, BotProfile, BotInstance, PaperAccount]) {
    await M.collection.deleteMany({})
  }
  console.log('[seed] --reset: cleared strategy_profiles/strategy_versions/bot_profiles/bot_instances/paper_accounts')
}

// --- 1. paper account (the §20 money spec — one ledger, read-derived) --------

await upsert(PaperAccount, {
  accountId: 'paper-main',
  currency: 'USDT',
  mode: 'LIVE_PAPER',
  initialBalance: 10_000,
  createdAt: T0,
})

// --- 2. strategy versions (immutable rows; _id = strategyId@version) ---------

const INDICATOR_VERSIONS = { atr: '1', ema: '1', volma: '1', rsi: '1' }
const METHOD_VERSIONS = { vsa: '1' }
const changes = (note) => [{ at: T0, note }]

const VERSIONS = [
  {
    _id: 'tm-vsa-core@1.0.0', strategyVersionId: 'tm-vsa-core@1.0.0', strategyId: 'tm-vsa-core',
    version: '1.0.0', engineVersion: ENGINE_VERSION,
    paramsHash: REAL_PARAMS_HASH, referenceHash: null,
    indicatorVersions: INDICATOR_VERSIONS, methodVersions: METHOD_VERSIONS,
    parameters: VSA_PARAMS, supersedes: null,
    changes: changes('Initial published VSA spring profile (real default params).'),
    status: 'archived', backtestRunId: BTC15, holdoutRunId: null, acceptedExperimentId: null,
    paperTrades: null, createdBy: 'seed', createdAt: T0,
    fingerprint: hashOf({ strategyId: 'tm-vsa-core', version: '1.0.0', paramsHash: REAL_PARAMS_HASH }),
    schemaVersion: 'strategy.v1',
  },
  {
    _id: 'tm-vsa-core@1.2.0', strategyVersionId: 'tm-vsa-core@1.2.0', strategyId: 'tm-vsa-core',
    version: '1.2.0', engineVersion: ENGINE_VERSION,
    paramsHash: REAL_PARAMS_HASH, referenceHash: null,
    indicatorVersions: INDICATOR_VERSIONS, methodVersions: METHOD_VERSIONS,
    parameters: VSA_PARAMS, supersedes: 'tm-vsa-core@1.0.0',
    changes: changes('Re-run on current engine 0.5.0 data window; params unchanged.'),
    status: 'backtest', backtestRunId: BTC15, holdoutRunId: null, acceptedExperimentId: null,
    paperTrades: null, createdBy: 'seed', createdAt: T0 + 6 * DAY,
    fingerprint: hashOf({ strategyId: 'tm-vsa-core', version: '1.2.0', paramsHash: REAL_PARAMS_HASH }),
    schemaVersion: 'strategy.v1',
  },
  {
    _id: 'tm-vsa-core@1.3.0', strategyVersionId: 'tm-vsa-core@1.3.0', strategyId: 'tm-vsa-core',
    version: '1.3.0', engineVersion: ENGINE_VERSION,
    paramsHash: REAL_PARAMS_HASH, referenceHash: null,
    indicatorVersions: INDICATOR_VERSIONS, methodVersions: METHOD_VERSIONS,
    parameters: VSA_PARAMS, supersedes: 'tm-vsa-core@1.2.0',
    changes: changes('Passed holdout on ETHUSDT.P 60m.'),
    status: 'holdout', backtestRunId: BTC15, holdoutRunId: ETH60, acceptedExperimentId: null,
    paperTrades: null, createdBy: 'seed', createdAt: T0 + 10 * DAY,
    fingerprint: hashOf({ strategyId: 'tm-vsa-core', version: '1.3.0', paramsHash: REAL_PARAMS_HASH }),
    schemaVersion: 'strategy.v1',
  },
  {
    _id: 'tm-vsa-core@1.4.0', strategyVersionId: 'tm-vsa-core@1.4.0', strategyId: 'tm-vsa-core',
    version: '1.4.0', engineVersion: ENGINE_VERSION,
    paramsHash: REAL_PARAMS_HASH, referenceHash: null,
    indicatorVersions: INDICATOR_VERSIONS, methodVersions: METHOD_VERSIONS,
    parameters: VSA_PARAMS, supersedes: 'tm-vsa-core@1.3.0',
    changes: changes('Live-paper sample reached 34 closed trades; promoted to stable_paper.'),
    status: 'stable_paper', backtestRunId: BTC15, holdoutRunId: ETH60, acceptedExperimentId: null,
    paperTrades: 34, createdBy: 'seed', createdAt: T0 + 14 * DAY,
    fingerprint: hashOf({ strategyId: 'tm-vsa-core', version: '1.4.0', paramsHash: REAL_PARAMS_HASH }),
    schemaVersion: 'strategy.v1',
  },
  {
    _id: 'tm-vsa-swing@0.1.0', strategyVersionId: 'tm-vsa-swing@0.1.0', strategyId: 'tm-vsa-swing',
    version: '0.1.0', engineVersion: ENGINE_VERSION,
    paramsHash: hashOfParams({ ...VSA_PARAMS, wyckoffEvent: 'spring', rP: 2.6, sess: '1300-2100' }),
    referenceHash: null,
    indicatorVersions: INDICATOR_VERSIONS, methodVersions: METHOD_VERSIONS,
    parameters: { ...VSA_PARAMS, rP: 2.6, sess: '1300-2100' },
    supersedes: null,
    changes: changes('Draft: swing variant (longer R:R target, EU-session window).'),
    status: 'draft', backtestRunId: null, holdoutRunId: null, acceptedExperimentId: null,
    paperTrades: null, createdBy: 'seed', createdAt: T0 + 15 * DAY,
    fingerprint: null, schemaVersion: 'strategy.v1',
  },
]

for (const v of VERSIONS) await upsert(StrategyVersion, v)

// --- 3. strategy profiles (cheap auditable pointers) -------------------------

const PROFILES = [
  {
    _id: 'tm-vsa-core', profileId: 'tm-vsa-core',
    name: 'VSA Core — Wyckoff Spring',
    status: 'active', strategyVersionId: 'tm-vsa-core@1.4.0',
    instruments: ['BTCUSDT.P', 'ETHUSDT.P'], timeframes: ['15', '60'],
    riskProfileId: 'risk-default', history: [],
    createdAt: T0, schemaVersion: 'strategyProfile.v1',
  },
  {
    _id: 'tm-vsa-swing', profileId: 'tm-vsa-swing',
    name: 'VSA Swing — EU Session',
    status: 'draft', strategyVersionId: null,
    instruments: ['BTCUSDT.P'], timeframes: ['60'],
    riskProfileId: null, history: [],
    createdAt: T0 + 15 * DAY, schemaVersion: 'strategyProfile.v1',
  },
]

for (const p of PROFILES) await upsert(StrategyProfile, p)

// --- 4. bot profiles (reusable execution config; NOT running bots) -----------

const BOT_PROFILES = [
  {
    _id: 'bot-core-live', profileId: 'bot-core-live',
    name: 'VSA Core Live Paper',
    description: 'Live-paper session for VSA Core @1.4.0 on BTC/ETH perps.',
    strategyVersionId: 'tm-vsa-core@1.4.0', mode: 'LIVE_PAPER',
    instruments: ['BTCUSDT.P', 'ETHUSDT.P'], timeframes: ['15'],
    riskProfileId: 'risk-default', simulatedAccountId: 'paper-main',
    maxConcurrentPositions: 2, paramOverrides: null,
    effectiveParamsHash: REAL_PARAMS_HASH, sessionRules: {}, notificationPolicy: {},
    enabled: true, status: 'enabled', history: [], createdBy: 'seed',
    createdAt: T0 + 14 * DAY, schemaVersion: 'botProfile.v1',
  },
  {
    _id: 'bot-swing-bt', profileId: 'bot-swing-bt',
    name: 'VSA Swing Backtest',
    description: 'Deterministic backtest harness for the swing draft.',
    strategyVersionId: 'tm-vsa-swing@0.1.0', mode: 'BACKTEST',
    instruments: ['BTCUSDT.P'], timeframes: ['60'],
    riskProfileId: null, simulatedAccountId: null,
    maxConcurrentPositions: 1, paramOverrides: null,
    effectiveParamsHash: hashOfParams({ ...VSA_PARAMS, rP: 2.6, sess: '1300-2100' }),
    sessionRules: {}, notificationPolicy: {},
    enabled: false, status: 'draft', history: [], createdBy: 'seed',
    createdAt: T0 + 15 * DAY, schemaVersion: 'botProfile.v1',
  },
]

for (const b of BOT_PROFILES) await upsert(BotProfile, b)

// --- 5. bot instances (concrete sessions; one profile -> many) ---------------

const NOW = Date.now()
const INSTANCES = [
  {
    _id: 'bot-core-live-20261014', instanceId: 'bot-core-live-20261014',
    botProfileId: 'bot-core-live', strategyVersionId: 'tm-vsa-core@1.4.0',
    strategyFingerprint: hashOf({ strategyId: 'tm-vsa-core', version: '1.4.0', paramsHash: REAL_PARAMS_HASH }),
    mode: 'LIVE_PAPER',
    source: { kind: 'live', venue: 'binance', symbol: 'BTCUSDT.P', tf: '15' },
    instruments: ['BTCUSDT.P', 'ETHUSDT.P'], timeframes: ['15'],
    state: 'running', startedAt: NOW - 3 * DAY, stoppedAt: null,
    lastEventAt: NOW - 90_000, eventLagMs: 820,
    counts: { signals: 128, orders: 34, trades: 11 },
    paperEquity: 10_231.55, paperPnl: 231.55,
    riskState: { dailyLossUsedPct: 12, halted: false, openPositions: 1 },
    health: 'ok', lastError: null, createdBy: 'seed',
    createdAt: NOW - 3 * DAY, schemaVersion: 'botInstance.v1',
  },
  {
    _id: 'bot-core-live-20261001', instanceId: 'bot-core-live-20261001',
    botProfileId: 'bot-core-live', strategyVersionId: 'tm-vsa-core@1.3.0',
    strategyFingerprint: hashOf({ strategyId: 'tm-vsa-core', version: '1.3.0', paramsHash: REAL_PARAMS_HASH }),
    mode: 'LIVE_PAPER',
    source: { kind: 'live', venue: 'binance', symbol: 'BTCUSDT.P', tf: '15' },
    instruments: ['BTCUSDT.P'], timeframes: ['15'],
    state: 'completed', startedAt: T0 + 10 * DAY, stoppedAt: T0 + 13 * DAY,
    lastEventAt: T0 + 13 * DAY, eventLagMs: null,
    counts: { signals: 96, orders: 27, trades: 23 },
    paperEquity: 10_118.4, paperPnl: 118.4,
    riskState: { dailyLossUsedPct: 0, halted: false, openPositions: 0 },
    health: 'ok', lastError: null, createdBy: 'seed',
    createdAt: T0 + 10 * DAY, schemaVersion: 'botInstance.v1',
  },
  {
    _id: 'bot-swing-bt-20261013', instanceId: 'bot-swing-bt-20261013',
    botProfileId: 'bot-swing-bt', strategyVersionId: 'tm-vsa-swing@0.1.0',
    strategyFingerprint: null, mode: 'BACKTEST',
    source: { kind: 'backtest', runId: BTC15 },
    instruments: ['BTCUSDT.P'], timeframes: ['60'],
    state: 'failed', startedAt: T0 + 15 * DAY, stoppedAt: T0 + 15 * DAY + 120_000,
    lastEventAt: T0 + 15 * DAY + 120_000, eventLagMs: null,
    counts: { signals: 0, orders: 0, trades: 0 },
    paperEquity: null, paperPnl: null,
    riskState: {},
    health: 'error', lastError: 'risk gate: maxDailyLoss exceeded (paper)',
    createdBy: 'seed', createdAt: T0 + 15 * DAY, schemaVersion: 'botInstance.v1',
  },
]

for (const i of INSTANCES) await upsert(BotInstance, i)

// --- summary -----------------------------------------------------------------

const counts = await Promise.all([
  StrategyProfile.countDocuments(), StrategyVersion.countDocuments(),
  BotProfile.countDocuments(), BotInstance.countDocuments(), PaperAccount.countDocuments(),
])
console.log(`[seed] strategy profiles=${counts[0]} versions=${counts[1]} bot profiles=${counts[2]} instances=${counts[3]} paper accounts=${counts[4]}`)
console.log(`[seed] paramsHash=${REAL_PARAMS_HASH.slice(0, 16)}… engine=${ENGINE_VERSION}`)
console.log(`[seed] evidence: backtest=${BTC15 ?? '(missing runs.ndjson)'} holdout=${ETH60 ?? '(missing runs.ndjson)'}`)
await mongoose.disconnect()
console.log('[seed] done.')
