// =============================================================================
//  Research domain types (roadmap §27 / §28 / §58.9 Slice 5).
//
//  These mirror the shapes the engine owns: ai/proposal.mjs (§27.3 proposal),
//  engine/experiment.mjs (§28.1 lifecycle, §28.2 comparison, §28.3 acceptance)
//  and server/utils/research.ts (the §30.7 transport layer). The UI never
//  invents a metric — an unmeasured value is null, never 0 (D12).
// =============================================================================

/** §28.1 — the experiment lifecycle states, in order. */
export type ExperimentState =
  | 'proposed'
  | 'approved'
  | 'running'
  | 'backtested'
  | 'holdout'
  | 'paper_validation'
  | 'accepted'
  | 'rejected'

/** The four arms a comparison lines up (§28.2). */
export type ArmRole = 'baseline' | 'candidate' | 'random' | 'holdout'

/** A bounded parameter change proposed by the AI (§27.3). */
export interface ProposalChange {
  parameter: string
  from: unknown
  to: unknown
}

/** One piece of supporting evidence with its sample size (§27.3, D12). */
export interface ProposalEvidence {
  metric: string
  value: number
  sampleSize: number
}

export interface RecommendedTest {
  symbols: string[]
  timeframes: string[]
}

/**
 * A structured AI improvement hypothesis (§27.3). Proposals are DATA (D7): the
 * only path to production is human approval → experiment → gate.
 */
export interface Proposal {
  proposalId: string
  strategyVersionId: string | null
  hypothesis: string
  changes: ProposalChange[]
  evidence: ProposalEvidence[]
  risks: string[]
  recommendedTest: RecommendedTest
  /** §59.15 Slice E — the frozen set this hypothesis was derived from. */
  evidenceSetId?: string | null
  schemaVersion?: string
  status?: string
  generation?: unknown
  createdAt?: number | null
}

/** One arm's metrics block (§28.2) — the SAME block every run summarizes. */
export interface ArmMetrics {
  trades: number | null
  open: number | null
  winRate: number | null
  profitFactor: number | null
  expectancyR: number | null
  medianR: number | null
  netPct: number | null
  maxDrawdownPct: number | null
  degenerateRisk: number | null
  paramsHash: string | null
  engineVersion: string | null
}

/** A recorded experiment arm (engine/experimentService.mjs runArm doc). */
export interface ExperimentRun {
  _id: string
  experimentId: string
  role: string
  summary?: Record<string, unknown> | null
  runHash?: string | null
  engineVersion?: string | null
  paramsHash?: string | null
  symbols?: string[]
  timeframes?: string[]
  runIds?: string[]
  recordedAt?: number | null
}

/** An arm folded into the experiment doc's `arms` map. */
export interface ExperimentArm {
  name?: string
  role?: string
  metrics?: ArmMetrics | null
  at?: number | null
  run?: ExperimentRun | null
}

export interface ExperimentHistoryEntry {
  from: string | null
  to: string
  at: number | null
}

/** §28.3 — one named acceptance gate pass/fail. */
export interface AcceptanceGate {
  key: string
  pass: boolean
  detail: string | null
}

/** The persisted `experiments` doc (§28.1). */
export interface Experiment {
  _id: string
  experimentId?: string
  proposalId?: string
  strategyVersionId?: string | null
  /** §59.15 Slice E — the frozen evidence set the hypothesis came from. */
  evidenceSetId?: string | null
  /** §59.15 Slice E — the version this candidate must beat (frozen at proposal time). */
  baselineVersionId?: string | null
  /** §59.15 Slice E — paper-validation sessions launched for this candidate. */
  paperSessionIds?: string[]
  hypothesis?: string
  changes?: ProposalChange[]
  evidence?: ProposalEvidence[]
  risks?: string[]
  recommendedTest?: RecommendedTest
  arms?: Record<string, ExperimentArm>
  status?: ExperimentState
  history?: ExperimentHistoryEntry[]
  createdAt?: number | null
  acceptance?: AcceptanceGate[] | null
  schemaVersion?: string
}

/** §28.2 — arms lined up on identical metrics with candidate-vs-baseline delta. */
export interface ArmComparison {
  arms: { name: string; metrics?: ArmMetrics | null }[]
  present: string[]
  missing: string[]
  delta: Record<string, number | null>
  complete: boolean
}

/** GET /research/strategies/:id — the research view of one strategy (§30.7). */
export interface StrategyResearch {
  profile: Record<string, unknown> | null
  versions: Record<string, unknown>[]
  experiments: Experiment[]
  proposals: Proposal[]
  mongo: 'up' | 'down'
}

// -----------------------------------------------------------------------------
//  Research Evidence Sets (§59.15 Slice E)
// -----------------------------------------------------------------------------

/** The four sources an evidence set can freeze. A session is not a run. */
export type EvidenceKind = 'paper-session' | 'replay-session' | 'backtest-run' | 'dataset'

/** Session states whose evidence is reproducible — a live session is still moving. */
export type EvidenceSealedState = 'completed' | 'failed' | 'halted'

/** One closed trade inside a frozen set; an unmeasured value stays null (D12). */
export interface EvidenceTrade {
  key: string
  symbol: string
  dir: 1 | -1 | null
  qty: number | null
  entryPrice: number | null
  exitPrice: number | null
  entryTime: number | null
  exitTime: number | null
  pnlAbs: number | null
  fees: number | null
  exitReason: string | null
  strategyVersionId: string | null
  sessionId: string | null
  rMultiple: number | null
  paramsHash: string | null
  engineVersion: string | null
}

/** Sample-size honest outcome block — `sufficient` gates any claim (D12). */
export interface EvidenceMetrics {
  trades: number
  wins: number
  losses: number
  winRate: number | null
  netPnlAbs: number | null
  expectancyR: number | null
  totalR: number | null
  rMeasured: number
  pnlMeasured: number
  minTrades: number
  sufficient: boolean
}

/** Hash re-verification verdict, computed on read (never stored). */
export interface EvidenceIntegrity {
  ok: boolean
  code: string | null
}

/** May this set support a conclusion yet? */
export interface EvidenceSufficiency {
  sufficient: boolean
  trades: number
  minTrades: number
  reasons: string[]
}

/**
 * A frozen evidence set. `hash` covers every field that could change a
 * conclusion; `usedByExperimentIds` is the append-only citation list and lives
 * outside it. `alreadyFrozen`/`sourceChanged` are added by the freeze endpoint.
 */
export interface EvidenceSet {
  _id: string
  setId: string
  kind: EvidenceKind
  sourceId: string
  sessionId: string | null
  state: string | null
  sealed: boolean
  accountId: string | null
  strategyVersionId: string | null
  instruments: string[]
  timeframes: string[]
  manifest: Record<string, unknown> | null
  counts: { orders: number; fills: number; trades: number }
  keys?: Record<string, string[]>
  trades?: EvidenceTrade[]
  metrics: EvidenceMetrics
  dataQuality: { state: string; datasets: string[] }
  limitations: string[]
  pointInTime: { frozenAt: number; sessionStartedAt: number | null; sessionStoppedAt: number | null }
  hash: string
  frozen: boolean
  immutable?: boolean
  schemaVersion: string
  usedByExperimentIds?: string[]
  createdBy?: string | null
  createdAt?: number | null
  // freeze-endpoint extras
  alreadyFrozen?: boolean
  sourceChanged?: boolean
  // read-endpoint extras
  integrity?: EvidenceIntegrity
  sufficiency?: EvidenceSufficiency
}

/** Freeze request body. */
export interface FreezeEvidenceInput {
  kind?: EvidenceKind
  sourceId: string
  notes?: string[]
  createdBy?: string | null
}

/** Result of launching a governed paper-validation session (§59.15 Slice E). */
export interface PaperValidationLaunch {
  session: Record<string, unknown> & { sessionId?: string }
  experimentId: string
  candidateVersionId: string
}

/** GET /research/experiments/:id — experiment + comparison + acceptance. */
export interface ExperimentResearch {
  experiment: Experiment | null
  comparison: ArmComparison | null
  acceptance: { ok: boolean; gates: AcceptanceGate[]; exp?: unknown } | null
  mongo: 'up' | 'down'
}
