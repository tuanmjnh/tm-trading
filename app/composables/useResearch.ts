import type {
  ArmRole,
  EvidenceSet,
  Experiment,
  ExperimentResearch,
  FreezeEvidenceInput,
  PaperValidationLaunch,
  Proposal,
  StrategyResearch
} from '#shared/types/research'

// =============================================================================
//  useResearch — AI Research workspace client (roadmap §27 / §28 / §58.9 Slice 5).
//
//  Wraps the §30.7 research API. Reads are fail-soft (empty on a store blip, the
//  page shows an empty state, never a stack trace). Writes (createExperiment /
//  runArm / move / decide) surface failure to the caller so the UI can report it.
//
//  Guardrail (D7): nothing here can activate a strategy version — creating an
//  experiment or accepting one only writes experiment docs. The active strategy
//  version changes solely through the strategy activation path, never here.
// =============================================================================

export interface RunArmInput {
  role: ArmRole
  params?: Record<string, unknown>
  method?: string
  symbols?: string[]
  timeframes?: string[]
  market?: string
}

export interface DecideOptions {
  minTrades?: number
  maxDegenerate?: number
  ddSlackPct?: number
}

export const useResearch = () => {
  async function proposals(options: { status?: string; limit?: number } = {}): Promise<Proposal[]> {
    try {
      const res = await $fetch<{ success: boolean; data: Proposal[] }>('/api/v1/research/proposals', {
        params: { status: options.status || undefined, limit: options.limit ?? 50 }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function strategy(id: string): Promise<StrategyResearch | null> {
    try {
      const res = await $fetch<{ success: boolean; data: StrategyResearch }>(
        `/api/v1/research/strategies/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  async function experiments(options: { status?: string; limit?: number } = {}): Promise<Experiment[]> {
    try {
      const res = await $fetch<{ success: boolean; data: Experiment[] }>('/api/v1/research/experiments', {
        params: { status: options.status || undefined, limit: options.limit ?? 100 }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function experiment(id: string): Promise<ExperimentResearch | null> {
    try {
      const res = await $fetch<{ success: boolean; data: ExperimentResearch | null }>(
        `/api/v1/research/experiments/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  /** Create a `proposed` experiment from a §27.3 proposal (human approval, D7). */
  async function createExperiment(body: Proposal): Promise<Experiment> {
    const res = await $fetch<{ success: boolean; data?: Experiment; error?: string }>(
      '/api/v1/research/experiments',
      { method: 'POST', body }
    )
    if (!res.success || !res.data) throw new Error(res.error || 'create-failed')
    return res.data
  }

  /** Run one arm (baseline/candidate/random/holdout) through the engine backtest. */
  async function runArm(id: string, input: RunArmInput): Promise<unknown> {
    const res = await $fetch<{ success: boolean; data?: unknown; error?: string }>(
      `/api/v1/research/experiments/${encodeURIComponent(id)}/run`,
      { method: 'POST', body: input }
    )
    if (!res.success) throw new Error(res.error || 'run-failed')
    return res.data
  }

  /** Advance the §28.1 lifecycle one legal step. */
  async function move(id: string, to: string): Promise<Experiment> {
    const res = await $fetch<{ success: boolean; data?: Experiment; error?: string }>(
      `/api/v1/research/experiments/${encodeURIComponent(id)}/move`,
      { method: 'POST', body: { to } }
    )
    if (!res.success || !res.data) throw new Error(res.error || 'move-failed')
    return res.data
  }

  /** Accept/reject at the gate (§28.3). */
  async function decide(id: string, accept: boolean, opts: DecideOptions = {}): Promise<Experiment> {
    const res = await $fetch<{ success: boolean; data?: Experiment; error?: string }>(
      `/api/v1/research/experiments/${encodeURIComponent(id)}/decide`,
      { method: 'POST', body: { accept, opts } }
    )
    if (!res.success || !res.data) throw new Error(res.error || 'decide-failed')
    return res.data
  }

  // -------- Evidence sets (§59.15 Slice E) --------

  /** Frozen evidence sets. Fail-soft: an unavailable store reads as "none yet". */
  async function evidenceSets(options: { kind?: string; sessionId?: string; strategyVersionId?: string; limit?: number } = {}): Promise<EvidenceSet[]> {
    try {
      const res = await $fetch<{ success: boolean; data: EvidenceSet[] }>('/api/v1/research/evidence-sets', {
        params: {
          kind: options.kind || undefined,
          sessionId: options.sessionId || undefined,
          strategyVersionId: options.strategyVersionId || undefined,
          limit: options.limit ?? 50
        }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  /** One set with its integrity + sufficiency verdicts computed on read. */
  async function evidenceSet(id: string): Promise<EvidenceSet | null> {
    try {
      const res = await $fetch<{ success: boolean; data: EvidenceSet | null }>(
        `/api/v1/research/evidence-sets/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  /**
   * Freeze the evidence of one source. A repeat freeze returns the set that
   * already exists rather than forking a second version of the same run (D3).
   */
  async function freezeEvidence(input: FreezeEvidenceInput): Promise<EvidenceSet> {
    const res = await $fetch<{ success: boolean; data?: EvidenceSet; error?: string }>(
      '/api/v1/research/evidence-sets',
      { method: 'POST', body: input }
    )
    if (!res.success || !res.data) throw new Error(res.error || 'freeze-failed')
    return res.data
  }

  /**
   * Launch the governed paper-validation session for a candidate. The SERVER
   * decides whether the experiment may be validated (it must be in
   * `paper_validation` and the candidate must not already be live — D31), so
   * this can only report the refusal, never bypass it.
   */
  async function launchPaperSession(id: string, input: Record<string, unknown> = {}): Promise<PaperValidationLaunch> {
    const res = await $fetch<{ success: boolean; data?: PaperValidationLaunch; error?: string }>(
      `/api/v1/research/experiments/${encodeURIComponent(id)}/paper-session`,
      { method: 'POST', body: input }
    )
    if (!res.success || !res.data) throw new Error(res.error || 'paper-session-failed')
    return res.data
  }

  return {
    proposals,
    strategy,
    experiments,
    experiment,
    createExperiment,
    runArm,
    move,
    decide,
    evidenceSets,
    evidenceSet,
    freezeEvidence,
    launchPaperSession
  }
}
