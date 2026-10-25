import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  Model engine cho server (Nitro) — mot NGUON cho ca signals/risk (D1).
//
//  Import runtime vi cung ly do nhu reports.ts: Nitro bundle tinh sai do sau
//  duong dan tuong doi ra ngoai `server/` (xem docs/app-inheritance.md) — dung
//  process.cwd() dua truc tiep vao Node.
//
//  Memo theo process: connectMongo cua engine da co state + cooldown rieng.
//  Mongo khong san sang -> tra null va HUY memo de lan sau thu lai (khong bam
//  loi 30s).
// =============================================================================

type EngineDb = typeof import('../../engine/db.mjs')
type AnyModel = typeof import('mongoose').Model<any>

let dbPromise: Promise<EngineDb> | null = null

export function engineDb(): Promise<EngineDb> {
  if (!dbPromise) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'db.mjs')).href
    dbPromise = import(/* @vite-ignore */ file) as Promise<EngineDb>
  }
  return dbPromise
}

const modelMemos = new Map<string, Promise<AnyModel | null>>()

/**
 * Model cua engine (vd. engineModel('alert.mjs', 'Alert')), co ket noi thi moi
 * tra ve — null = Mongo khong san sang (fail-soft, khong 500).
 */
export function engineModel(modelFile: string, exportName: string): Promise<AnyModel | null> {
  const key = `${modelFile}#${exportName}`
  const cached = modelMemos.get(key)
  if (cached) return cached

  const promise = (async () => {
    const db = await engineDb()
    const mongoose = await db.connectMongo()
    if (!mongoose) return null
    const file = pathToFileURL(join(process.cwd(), 'engine', 'models', modelFile)).href
    const mod = await import(/* @vite-ignore */ file)
    return (mod as Record<string, AnyModel | undefined>)[exportName] ?? null
  })()
  modelMemos.set(key, promise)
  promise.then((model) => {
    // Mongo chua len -> huy memo de lan sau thu lai.
    if (!model && modelMemos.get(key) === promise) modelMemos.delete(key)
  }).catch(() => {
    if (modelMemos.get(key) === promise) modelMemos.delete(key)
  })
  return promise
}

// =============================================================================
//  Simulation modules (pure core) — cung ly do: Nitro bundle tinh sai do sau
//  duong dan tuong doi ra ngoai `server/` (simulation/ nam ngoai server/).
//  Dung dynamic import tu process.cwd() de tranh tinh sai do sau.
// =============================================================================

type SimulationModule = typeof import('../../simulation/order.mjs')
type FillModule = typeof import('../../simulation/fill.mjs')
type EngineSimModule = typeof import('../../simulation/engine.mjs')
type MarginModule = typeof import('../../simulation/margin.mjs')
type LiquidationModule = typeof import('../../simulation/liquidation.mjs')
type AccountSimModule = typeof import('../../simulation/account.mjs')

let orderSimPromise: Promise<SimulationModule> | null = null
let fillSimPromise: Promise<FillModule> | null = null
let engineSimPromise: Promise<EngineSimModule> | null = null
let marginSimPromise: Promise<MarginModule> | null = null
let liquidationSimPromise: Promise<LiquidationModule> | null = null
let accountSimPromise: Promise<AccountSimModule> | null = null

export async function simulationOrder(): Promise<SimulationModule> {
  if (!orderSimPromise) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'order.mjs')).href
    orderSimPromise = import(/* @vite-ignore */ file) as Promise<SimulationModule>
  }
  return orderSimPromise
}

export async function simulationFill(): Promise<FillModule> {
  if (!fillSimPromise) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'fill.mjs')).href
    fillSimPromise = import(/* @vite-ignore */ file) as Promise<FillModule>
  }
  return fillSimPromise
}

export async function simulationEngine(): Promise<EngineSimModule> {
  if (!engineSimPromise) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'engine.mjs')).href
    engineSimPromise = import(/* @vite-ignore */ file) as Promise<EngineSimModule>
  }
  return engineSimPromise
}

export async function simulationMargin(): Promise<MarginModule> {
  if (!marginSimPromise) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'margin.mjs')).href
    marginSimPromise = import(/* @vite-ignore */ file) as Promise<MarginModule>
  }
  return marginSimPromise
}

export async function simulationLiquidation(): Promise<LiquidationModule> {
  if (!liquidationSimPromise) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'liquidation.mjs')).href
    liquidationSimPromise = import(/* @vite-ignore */ file) as Promise<LiquidationModule>
  }
  return liquidationSimPromise
}

export async function simulationAccount(): Promise<AccountSimModule> {
  if (!accountSimPromise) {
    const file = pathToFileURL(join(process.cwd(), 'simulation', 'account.mjs')).href
    accountSimPromise = import(/* @vite-ignore */ file) as Promise<AccountSimModule>
  }
  return accountSimPromise
}

// =============================================================================
//  Strategy service & models (runtime dynamic import to prevent Rollup
//  relative depth calculation errors outside server/).
// =============================================================================

type StrategyServiceModule = typeof import('../../engine/strategyService.mjs')

let strategyServicePromise: Promise<StrategyServiceModule> | null = null

export async function strategyService(): Promise<StrategyServiceModule> {
  if (!strategyServicePromise) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'strategyService.mjs')).href
    strategyServicePromise = import(/* @vite-ignore */ file) as Promise<StrategyServiceModule>
  }
  return strategyServicePromise
}

export function strategyProfileModel(): Promise<AnyModel | null> {
  return engineModel('strategyProfile.mjs', 'StrategyProfile')
}

export function strategyVersionModel(): Promise<AnyModel | null> {
  return engineModel('strategyVersion.mjs', 'StrategyVersion')
}

// -----------------------------------------------------------------------------
//  Trading workspace outbox (§61.17 Phase C) — services/workspaceStore.mjs.
//  Same dynamic-import-from-cwd reason: Nitro computes the relative depth out of
//  `server/` incorrectly, so resolve from process.cwd() instead of importing.
// -----------------------------------------------------------------------------

type WorkspaceStoreModule = typeof import('../../services/workspaceStore.mjs')

let workspaceStorePromise: Promise<WorkspaceStoreModule> | null = null

export function workspaceStore(): Promise<WorkspaceStoreModule> {
  if (!workspaceStorePromise) {
    const file = pathToFileURL(join(process.cwd(), 'services', 'workspaceStore.mjs')).href
    workspaceStorePromise = import(/* @vite-ignore */ file) as Promise<WorkspaceStoreModule>
  }
  return workspaceStorePromise
}

// -----------------------------------------------------------------------------
//  Bot contracts (§57.4 G/H, §58.6): Bot Profile != Bot Instance. Both are
//  read-only in the dashboard for now — the supervisor owns lifecycle writes.
// -----------------------------------------------------------------------------

export function botProfileModel(): Promise<AnyModel | null> {
  return engineModel('botProfile.mjs', 'BotProfile')
}

export function botInstanceModel(): Promise<AnyModel | null> {
  return engineModel('botInstance.mjs', 'BotInstance')
}

// -----------------------------------------------------------------------------
//  Bot supervisor contracts (§61.7 / Phase E). The lifecycle write path lives in
//  services/botRuntimeStore.mjs behind the owner lease; the HTTP layer may only
//  enqueue durable commands, never mutate state directly. Same dynamic-import-
//  from-cwd rule as the models above.
// -----------------------------------------------------------------------------

type BotSupervisorModule = typeof import('../../engine/botSupervisor.mjs')

let botSupervisorPromise: Promise<BotSupervisorModule> | null = null

export function botSupervisorRules(): Promise<BotSupervisorModule> {
  if (!botSupervisorPromise) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'botSupervisor.mjs')).href
    botSupervisorPromise = import(/* @vite-ignore */ file) as Promise<BotSupervisorModule>
  }
  return botSupervisorPromise
}

type BotRuntimeStoreModule = typeof import('../../services/botRuntimeStore.mjs')

let botRuntimeStorePromise: Promise<BotRuntimeStoreModule> | null = null

export function botRuntimeStore(): Promise<BotRuntimeStoreModule> {
  if (!botRuntimeStorePromise) {
    const file = pathToFileURL(join(process.cwd(), 'services', 'botRuntimeStore.mjs')).href
    botRuntimeStorePromise = import(/* @vite-ignore */ file) as Promise<BotRuntimeStoreModule>
  }
  return botRuntimeStorePromise
}

// -----------------------------------------------------------------------------
//  Research models (§30.7) — Experiment Engine §28 + AI Research §27.3.
// -----------------------------------------------------------------------------

export function experimentModel(): Promise<AnyModel | null> {
  return engineModel('experiment.mjs', 'Experiment')
}

export function experimentRunModel(): Promise<AnyModel | null> {
  return engineModel('experimentRun.mjs', 'ExperimentRun')
}

export function aiProposalModel(): Promise<AnyModel | null> {
  return engineModel('aiProposal.mjs', 'AiProposal')
}

export function tradingSessionModel(): Promise<AnyModel | null> {
  return engineModel('session.mjs', 'TradingSession')
}

// -----------------------------------------------------------------------------
//  AI agent governance models (§59.15 Slice D) — registry, immutable versions
//  and the append-only action ledger. Policy lives in engine/agentPolicy.mjs;
//  these resolvers only hand the store its models.
// -----------------------------------------------------------------------------

export function aiAgentModel(): Promise<AnyModel | null> {
  return engineModel('aiAgent.mjs', 'AiAgent')
}

export function aiAgentVersionModel(): Promise<AnyModel | null> {
  return engineModel('aiAgentVersion.mjs', 'AiAgentVersion')
}

export function aiAgentActionModel(): Promise<AnyModel | null> {
  return engineModel('aiAgentAction.mjs', 'AiAgentAction')
}

// -----------------------------------------------------------------------------
//  Research evidence sets (§59.11 / §59.15 Slice E) — frozen, hash-verified
//  bundles of the facts a conclusion was drawn from.
// -----------------------------------------------------------------------------

export function evidenceSetModel(): Promise<AnyModel | null> {
  return engineModel('evidenceSet.mjs', 'EvidenceSet')
}

// -----------------------------------------------------------------------------
//  Data Center models (§58.9 Slice 4) — dataset retention manifest, recorded
//  closed candles, and the raw feed ledger. Read-only in the dashboard; the
//  recorder/supervisor owns every write.
// -----------------------------------------------------------------------------

export function datasetModel(): Promise<AnyModel | null> {
  return engineModel('dataset.mjs', 'Dataset')
}

export function candleModel(): Promise<AnyModel | null> {
  return engineModel('candle.mjs', 'Candle')
}

export function marketFeedModel(): Promise<AnyModel | null> {
  return engineModel('marketFeed.mjs', 'MarketFeed')
}

