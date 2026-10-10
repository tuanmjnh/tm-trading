// =============================================================================
//  TM TRADING — EXPERIMENT ENGINE (roadmap §28) — PURE CORE
//
//  A strategy change must never be applied silently to the live preset. The
//  experiment lifecycle (§28.1) is a state machine over a persisted
//  `experiments` doc:
//
//      PROPOSED -> APPROVED -> RUNNING -> BACKTESTED -> HOLDOUT
//                -> PAPER_VALIDATION -> ACCEPTED | REJECTED
//
//  `transition(exp, to, opts)` is the ONLY way to move a doc, and it refuses
//  illegal jumps (D7 spirit: no silent production change — a candidate only
//  reaches `accepted` after every gate below has been measured).
//
//  §28.2 comparison: `compareArms(arms, {minTrades})` lines up baseline /
//  candidate / random baseline / holdout on the SAME metrics block that
//  summarizeRuns() already produces (§28.2), so an arm is never re-scored with
//  a second, subtly different formula.
//
//  §28.3 minimum acceptance: `acceptanceReport(exp)` returns a named list of
//  passes/fails (beat baseline, sample size, holdout, degeneracy, risk
//  constraints, reproducible run hash). The experiment is only `accepted` when
//  every gate passes — one metric alone never selects (D12).
//
//  PURE: no Mongo, no clock, no IO. The IO layer (engine/experimentService.mjs)
//  reads/writes the collection and feeds this core — tests run offline.
// =============================================================================

import { hashOf } from './version.mjs'

export const EXPERIMENT_SCHEMA_VERSION = 'experiment.v1'

/** §28.1 — the lifecycle states, in order. */
export const EXPERIMENT_STATES = Object.freeze([
  'proposed', 'approved', 'running', 'backtested', 'holdout', 'paper_validation',
  'accepted', 'rejected',
])

/** Terminal states — nothing may leave them. */
export const TERMINAL_STATES = Object.freeze(['accepted', 'rejected'])

/** The four arms a comparison lines up (§28.2). */
export const ARM_NAMES = Object.freeze(['baseline', 'candidate', 'random', 'holdout'])

/** Allowed forward edges; `rejected` is reachable from any non-terminal state. */
const ALLOWED = Object.freeze({
  proposed: ['approved', 'rejected'],
  approved: ['running', 'rejected'],
  running: ['backtested', 'rejected'],
  backtested: ['holdout', 'rejected'],
  holdout: ['paper_validation', 'rejected'],
  paper_validation: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
})

const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x))

/** Deterministic id for an experiment from its (proposal, strategy) identity (D3). */
export function experimentIdFor({ proposalId, strategyVersionId, paramsHash } = {}) {
  const pid = String(proposalId ?? '').trim()
  if (!pid) return null
  return `exp:${hashOf({
    proposalId: pid,
    strategyVersionId: String(strategyVersionId ?? '').trim() || null,
    paramsHash: String(paramsHash ?? '').trim() || null,
  }).slice(0, 32)}`
}

/**
 * Build a fresh `proposed` experiment doc from a validated AI proposal (§27.3).
 * The doc carries the evidence the AI cited so a reviewer can audit WHY the
 * change was proposed — a proposal without recorded evidence is rejected.
 */
export function experimentFromProposal(proposal, { now = 0 } = {}) {
  if (!proposal || typeof proposal !== 'object') return null
  const id = experimentIdFor({
    proposalId: proposal.proposalId,
    strategyVersionId: proposal.strategyVersionId,
    paramsHash: proposal.proposalId, // stable: changes live in the doc, not the key
  })
  if (!id) return null
  const changes = Array.isArray(proposal.changes) ? proposal.changes.map((c) => ({
    parameter: String(c?.parameter ?? ''),
    from: c?.from ?? null,
    to: c?.to ?? null,
  })) : []
  return {
    _id: id,
    experimentId: id,
    proposalId: String(proposal.proposalId ?? ''),
    strategyVersionId: proposal.strategyVersionId ?? null,
    hypothesis: String(proposal.hypothesis ?? ''),
    changes,
    evidence: Array.isArray(proposal.evidence) ? proposal.evidence : [],
    risks: Array.isArray(proposal.risks) ? proposal.risks.map(String) : [],
    recommendedTest: proposal.recommendedTest ?? {},
    arms: {},
    status: 'proposed',
    history: [{ from: null, to: 'proposed', at: num(now) }],
    createdAt: num(now),
    schemaVersion: EXPERIMENT_SCHEMA_VERSION,
  }
}

/**
 * Move an experiment to `to`. Illegal jumps (backward, skipping a stage, or
 * leaving a terminal state) return `{ok:false, code}` — they never mutate.
 * Attaching an arm result (e.g. a backtest summary) is a data write that
 * happens alongside the transition, so the doc and its state change together.
 */
export function transition(exp, to, { at = null, data = null } = {}) {
  if (!exp || typeof exp !== 'object') return { ok: false, code: 'EXP_NOT_A_DOC', exp }
  const from = String(exp.status ?? '')
  if (!EXPERIMENT_STATES.includes(to)) return { ok: false, code: `EXP_BAD_STATE:${to}`, exp }
  // Terminal states are final: nothing leaves them, not even a replay of the
  // same state (an accepted experiment must never be "re-accepted" silently).
  if (TERMINAL_STATES.includes(from)) return { ok: false, code: `EXP_ILLEGAL:${from}->${to}`, exp }
  if (from === to) return { ok: false, code: 'EXP_ALREADY', exp }
  if (!(ALLOWED[from] || []).includes(to)) return { ok: false, code: `EXP_ILLEGAL:${from}->${to}`, exp }
  const next = { ...exp, status: to }
  if (data) Object.assign(next, data)
  next.history = [...(Array.isArray(exp.history) ? exp.history : []), { from, to, at: num(at) }]
  return { ok: true, code: 'OK', exp: next }
}

/**
 * Compute the metrics block for one arm from a run summary (output of
 * summarizeRuns / summarizeBacktest). Missing inputs stay null — never 0, so a
 * "clean" arm can never hide an unmeasured one.
 */
export function armMetrics(run) {
  const s = run?.summary ?? run
  if (!s || typeof s !== 'object') return null
  return {
    trades: num(s.trades),
    open: num(s.open),
    winRate: num(s.winRate),
    profitFactor: num(s.profitFactor === Infinity ? Infinity : s.profitFactor),
    expectancyR: num(s.expectancy ?? s.avgRr),
    medianR: num(s.medianRr),
    netPct: num(s.netPct),
    maxDrawdownPct: num(s.maxDrawdownPct),
    degenerateRisk: num(s.degenerateRisk),
    paramsHash: s.paramsHash ?? null,
    engineVersion: s.engineVersion ?? null,
  }
}

/**
 * §28.2 — line up the arms on identical metrics. Each arm may be:
 *   { name, metrics }  (precomputed via armMetrics)
 * Arms named in ARM_NAMES are placed in the canonical order; the result carries
 * `delta` (candidate vs baseline) on each numeric metric so no reader has to
 * re-derive "did the candidate beat baseline" by eye.
 */
export function compareArms(arms, { requireRandom = false, requireHoldout = true } = {}) {
  const byName = new Map((Array.isArray(arms) ? arms : []).filter(Boolean).map((a) => [a.name, a]))
  const ordered = ARM_NAMES.map((name) => byName.get(name)).filter(Boolean)
  const present = ordered.map((a) => a.name)
  const missing = []
  if (requireRandom && !present.includes('random')) missing.push('random')
  if (requireHoldout && !present.includes('holdout')) missing.push('holdout')
  const baseline = byName.get('baseline')?.metrics ?? null
  const candidate = byName.get('candidate')?.metrics ?? null

  const metrics = ['winRate', 'profitFactor', 'expectancyR', 'medianR', 'netPct', 'maxDrawdownPct']
  const delta = {}
  for (const m of metrics) {
    const b = num(baseline?.[m])
    const c = num(candidate?.[m])
    delta[m] = b === null || c === null ? null : c - b
  }
  return {
    arms: ordered,
    present,
    missing,
    delta,
    complete: missing.length === 0,
  }
}

/**
 * §28.3 — the acceptance gate. Every item must pass before `accepted`:
 *   beatBaseline      candidate expectancyR > baseline (the defined baseline)
 *   sampleSize        candidate has at least minTrades closed trades
 *   holdout           a holdout arm exists and is at least as good as the
 *                     candidate on expectancy (no in-sample-only edge)
 *   noDegeneracy      candidate degenerateRisk below maxDegenerate
 *   riskPreserved     candidate maxDrawdownPct not worse than baseline + slack
 *   reproducible      candidate carries a paramsHash + engineVersion (run hash)
 * Returns `{ok, gates:[{key, pass, detail}], exp}`.
 */
export function acceptanceReport(exp, o = {}) {
  const minTrades = o.minTrades ?? 30
  const maxDeg = o.maxDegenerate ?? 0
  const ddSlack = o.ddSlackPct ?? 5
  const arms = exp?.arms ?? {}
  // Arms stored by withArm are { name, metrics, at } — the metrics were already
  // computed by armMetrics(); running it on the wrapper would re-derive from
  // fields the wrapper does not have and produce a block of nulls.
  const metricsOf = (a) => (a && a.metrics !== undefined ? a.metrics : armMetrics(a))
  const baseline = metricsOf(arms.baseline)
  const candidate = metricsOf(arms.candidate)
  const holdout = metricsOf(arms.holdout)
  const random = metricsOf(arms.random)

  const gates = []
  const g = (key, pass, detail) => gates.push({ key, pass: !!pass, detail: detail ?? null })

  g('hasArms', !!(baseline && candidate), 'baseline and candidate arms must be recorded')
  g('beatBaseline',
    candidate?.expectancyR !== null && baseline?.expectancyR !== null
      && candidate.expectancyR > baseline.expectancyR,
    `candidate expectancy ${candidate?.expectancyR} vs baseline ${baseline?.expectancyR}`)
  g('beatRandom',
    random === null || random.expectancyR === null
      ? true // random baseline not run: neutral (not an acceptance input on its own)
      : candidate?.expectancyR !== null && candidate.expectancyR > random.expectancyR,
    random === null || random.expectancyR === null
      ? 'random baseline not run'
      : `candidate ${candidate?.expectancyR} vs random ${random.expectancyR}`)
  g('sampleSize',
    candidate?.trades !== null && candidate.trades >= minTrades,
    `candidate trades ${candidate?.trades ?? 'n/a'} >= min ${minTrades}`)
  g('holdout',
    holdout !== null && candidate?.expectancyR !== null && holdout.expectancyR !== null
      ? holdout.expectancyR >= candidate.expectancyR - 1e-12
      : false,
    holdout === null
      ? 'holdout arm missing'
      : `holdout ${holdout?.expectancyR} vs candidate ${candidate?.expectancyR}`)
  g('noDegeneracy',
    candidate?.degenerateRisk !== null && candidate.degenerateRisk <= maxDeg,
    `candidate degenerateRisk ${candidate?.degenerateRisk ?? 'n/a'} <= ${maxDeg}`)
  g('riskPreserved',
    baseline?.maxDrawdownPct !== null && candidate?.maxDrawdownPct !== null
      ? candidate.maxDrawdownPct <= baseline.maxDrawdownPct + ddSlack
      : false,
    `candidate DD ${candidate?.maxDrawdownPct ?? 'n/a'} <= baseline ${baseline?.maxDrawdownPct ?? 'n/a'} + ${ddSlack}`)
  g('reproducible',
    !!(candidate?.paramsHash && candidate.engineVersion),
    `candidate run hash ${candidate?.paramsHash ?? 'n/a'} @ ${candidate?.engineVersion ?? 'n/a'}`)

  const ok = gates.every((x) => x.pass)
  return { ok, gates, exp }
}

/**
 * Record an arm result on an experiment doc (data-only; does not advance the
 * state). Re-recording the same arm replaces it — but the run hash of the
 * candidate arm is what acceptance checks, so a stale arm can never be
 * silently reused.
 */
export function withArm(exp, name, run, { at = null } = {}) {
  if (!exp || typeof exp !== 'object') return { ok: false, code: 'EXP_NOT_A_DOC', exp }
  if (!ARM_NAMES.includes(name)) return { ok: false, code: `EXP_BAD_ARM:${name}`, exp }
  const next = { ...exp, arms: { ...(exp.arms ?? {}), [name]: { name, metrics: armMetrics(run), at: num(at) } } }
  return { ok: true, code: 'OK', exp: next }
}
