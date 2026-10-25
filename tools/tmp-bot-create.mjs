// tools/tmp-bot-create.mjs — create a live instance + start command (watermark = now).
import { loadEnv } from '../exec/env.mjs'
loadEnv()
import mongoose from 'mongoose'
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tm-trading')
const { BotProfile } = await import('../engine/models/botProfile.mjs')
const { BotInstance } = await import('../engine/models/botInstance.mjs')
const { StrategyVersion } = await import('../engine/models/strategyVersion.mjs')
const { hashOf } = await import('../engine/version.mjs')
const { enqueueCommand } = await import('../services/botRuntimeStore.mjs')

const profile = await BotProfile.findOne({ status: 'enabled', mode: 'LIVE_PAPER' }).lean()
const sv = await StrategyVersion.findOne({ _id: profile.strategyVersionId }).lean()
const suffix = process.argv[2] || 'd'
const id = `bot-core-live-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${suffix}`

const exists = await BotInstance.findOne({ _id: id }).lean()
if (exists) { console.log('exists:', id, exists.state); process.exit(0) }

const now = Date.now()
await BotInstance.create({
  _id: id, instanceId: id,
  botProfileId: profile.profileId, strategyVersionId: profile.strategyVersionId,
  strategyFingerprint: hashOf({ strategyId: sv?.strategyId ?? 'tm-vsa-core', version: sv?.version ?? '0', paramsHash: profile.effectiveParamsHash ?? '' }),
  ownerId: profile.ownerId,
  mode: 'LIVE_PAPER',
  source: { kind: 'live', venue: 'binance', symbol: profile.instruments[0], tf: profile.timeframes[0] },
  instruments: profile.instruments, timeframes: profile.timeframes,
  state: 'queued', startedAt: now, stoppedAt: null, lastEventAt: now, eventLagMs: 0,
  counts: { signals: 0, orders: 0, trades: 0 },
  paperEquity: 0, paperPnl: 0,
  riskState: { dailyLossUsedPct: 0, halted: false, openPositions: 0 },
  health: 'ok', lastError: null,
  lastSignalTs: now, lastSignalKey: null,
  createdBy: 'manual-test', demo: false, schemaVersion: 'botInstance.v1',
})
const cmd = await enqueueCommand({
  ownerId: profile.ownerId, instanceId: id, botProfileId: profile.profileId,
  type: 'start', commandId: `cmd_start_${id}_${now.toString(36)}`,
})
console.log('instance:', id, '| command:', cmd.ok, cmd.code ?? '')
process.exit(0)
