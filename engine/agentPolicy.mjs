// =============================================================================
//  TM TRADING — AI AGENT GOVERNANCE, PURE (V3.5 §59.15 Slice D).
//
//  Slice C made a trading session the durable record of a run. Slice D makes an
//  AI agent governable: an immutable versioned config, an explicit autonomy
//  level, a locked tool allowlist and a structured action that CANNOT reach the
//  Risk Gate without a session, an idempotency key and a gate decision.
//
//  Nothing here runs a model or places an order. This module is the policy:
//  pure guards (D25) that the server and the runtime MUST call before every
//  write, so a policy change is one reviewed diff, not a runtime behaviour.
//
//  Autonomy ladder (§59.15):
//    A0 advice only            — enabled
//    A1 propose order          — enabled (proposal is DATA, never an order)
//    A2 governed live paper    — enabled ONLY with recorded risk-integration
//                                evidence; orders still need a session + gate
//    A3 demo connector         — policy-disabled (future gate)
//    A4 real execution         — hard-disabled
//
//  Test-locked contracts live in tests/aiAgents.test.ts; the read model in
//  server/utils/aiAgents.ts; the rewrite of the old "no runtime" claim in
//  docs/web-app/ai-agent-session-audit.md.
// =============================================================================

import { createHash } from 'node:crypto'
import { stableStringify } from './version.mjs'

export const AGENT_SCHEMA_VERSION = 'ai-agent.v1'
export const AGENT_VERSION_SCHEMA_VERSION = 'ai-agent-version.v1'
export const AGENT_ACTION_SCHEMA_VERSION = 'ai-agent-action.v1'

/** Autonomy ladder, weakest first. Order is meaningful — never reorder. */
export const AUTONOMY_LEVELS = Object.freeze(['A0', 'A1', 'A2', 'A3', 'A4'])

export const AUTONOMY_LABELS = Object.freeze({
  A0: 'advice-only',
  A1: 'propose-order',
  A2: 'governed-live-paper',
  A3: 'demo-connector',
  A4: 'real-execution',
})

/**
 * The whole authority table. `maxAction` is the strongest action the level may
 * take; `requiresRiskIntegration` forces evidence recorded by
 * `recordRiskIntegration` before the level can act on orders at all.
 */
export const AUTONOMY_POLICY = Object.freeze({
  A0: Object.freeze({ enabled: true, maxAction: 'advice', requiresRiskIntegration: false, reason: null }),
  A1: Object.freeze({ enabled: true, maxAction: 'proposal', requiresRiskIntegration: false, reason: null }),
  A2: Object.freeze({ enabled: true, maxAction: 'place-order', requiresRiskIntegration: true, reason: null }),
  A3: Object.freeze({ enabled: false, maxAction: null, requiresRiskIntegration: true, reason: 'future-gated' }),
  A4: Object.freeze({ enabled: false, maxAction: null, requiresRiskIntegration: true, reason: 'hard-disabled' }),
})

/**
 * The read-only tool surface. These names MUST equal the live `TOOL_NAMES` of
 * ai/agent.mjs — tests/aiAgents.test.ts asserts it, so a new model tool cannot
 * silently become agent-visible without a policy decision (D7).
 */
export const READ_TOOLS = Object.freeze([
  'queryDB',
  'getKlines',
  'scanMovers',
  'methodSignals',
  'regimeSnapshot',
  'backtestQuick',
  'newsEvidence',
])

/**
 * Action-capable tools. These are NOT LLM tools (ai/agent.mjs must stay
 * read-only) — they are governance capabilities an action is checked against.
 */
export const ACTION_TOOLS = Object.freeze(['proposeOrder', 'placeOrder'])

/** Every action an agent may attempt. Rank orders capability strength. */
export const AGENT_ACTIONS = Object.freeze(['advice', 'proposal', 'place-order', 'cancel-order', 'close-position'])

export const ACTION_RANK = Object.freeze({
  advice: 0,
  proposal: 1,
  'place-order': 2,
  'cancel-order': 2,
  'close-position': 2,
})

/** Actions that touch an account — the Risk Gate's territory (D7). */
export const ORDER_ACTIONS = Object.freeze(['place-order', 'cancel-order', 'close-position'])

/** The tool an action requires in the version's allowlist. */
export const ACTION_TOOL = Object.freeze({
  advice: null,
  proposal: 'proposeOrder',
  'place-order': 'placeOrder',
  'cancel-order': 'placeOrder',
  'close-position': 'placeOrder',
})

/** Lifecycle states of an agent record (not of a session — §59 keeps them apart). */
export const AGENT_STATES = Object.freeze(['draft', 'validated', 'active', 'paused', 'disabled'])

/** `disabled` is terminal: supersede it, never resurrect it silently. */
export const AGENT_TERMINAL_STATES = Object.freeze(['disabled'])

export const AGENT_EDGES = Object.freeze({
  draft: ['validated', 'disabled'],
  validated: ['active', 'disabled'],
  active: ['paused', 'disabled'],
  paused: ['active', 'disabled'],
  disabled: [],
})

/** Timeline cap, same discipline as sessions: drop oldest, count the drops. */
export const AGENT_MAX_EVENTS = 200

/** A heartbeat older than this is `stale` — an idle agent is visible, not assumed alive. */
export const HEARTBEAT_MAX_AGE_MS = 120_000

/** Minimum idempotency key length — short keys collide and lose replays. */
export const MIN_IDEMPOTENCY_KEY = 8

const fail = (code, message) => ({ ok: false, code, message })

/** Unique agent id (D3): time-ordered + random suffix, safe as a Mongo _id. */
export function agentId(now = Date.now()) {
  const t = Number(now)
  if (!Number.isFinite(t) || t <= 0) throw new Error('agent: now must be a positive epoch ms')
  return `agt_${t.toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Unique version id, derived from the agent it belongs to. */
export function agentVersionId(agent, now = Date.now()) {
  const owner = String(agent ?? '').trim()
  if (!owner) throw new Error('agent: agentId required for a version id')
  const t = Number(now)
  if (!Number.isFinite(t) || t <= 0) throw new Error('agent: now must be a positive epoch ms')
  return `agtv_${owner.slice(-12)}_${t.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Tools allowed at a level. Unknown / disabled levels allow nothing. */
export function allowedTools(level) {
  switch (level) {
    case 'A0': return [...READ_TOOLS]
    case 'A1': return [...READ_TOOLS, 'proposeOrder']
    case 'A2': return [...READ_TOOLS, 'proposeOrder', 'placeOrder']
    default: return [] // A3/A4 (and anything unknown) get an empty surface
  }
}

/** Is this tool callable at this level? Unauthorized tools are BLOCKED, not warned. */
export function checkTool(level, tool) {
  const name = String(tool ?? '').trim()
  if (!name) return fail('TOOL_REQUIRED', 'tool name is required')
  if (!AUTONOMY_LEVELS.includes(level)) return fail('BAD_LEVEL', `unknown autonomy level ${String(level)}`)
  if (!AUTONOMY_POLICY[level].enabled) {
    return fail('LEVEL_DISABLED', `autonomy ${level} (${AUTONOMY_LABELS[level]}) is disabled by policy (${AUTONOMY_POLICY[level].reason})`)
  }
  if (!allowedTools(level).includes(name)) {
    return fail('TOOL_NOT_ALLOWED', `tool "${name}" is not allowed at ${level} (allowed: ${allowedTools(level).join(', ') || 'none'})`)
  }
  return { ok: true, level, tool: name }
}

/** Full policy table — what the dashboard renders (never hand-maintained in the UI). */
export function describePolicy() {
  return AUTONOMY_LEVELS.map((level) => {
    const p = AUTONOMY_POLICY[level]
    return {
      level,
      label: AUTONOMY_LABELS[level],
      enabled: p.enabled,
      maxAction: p.maxAction,
      tools: allowedTools(level),
      requiresRiskIntegration: p.requiresRiskIntegration,
      reason: p.reason,
    }
  })
}

/**
 * Build a new agent record (not yet persisted). Throws on bad input — fail
 * closed at creation, like createSession/createPositionDoc.
 */
export function createAgent(input = {}) {
  const {
    agentId: id = null,
    name = '',
    description = '',
    autonomy = 'A0',
    accountId = 'default',
    instruments = [],
    createdBy = null,
    now = Date.now(),
  } = input ?? {}

  const label = String(name ?? '').trim()
  if (!label) throw new Error('agent: name is required')
  if (label.length > 120) throw new Error('agent: name must be <= 120 chars')
  if (!AUTONOMY_LEVELS.includes(autonomy)) {
    throw new Error(`agent: autonomy must be one of ${AUTONOMY_LEVELS.join('|')} (got ${String(autonomy)})`)
  }
  const at = Number(now)
  if (!Number.isFinite(at) || at <= 0) throw new Error('agent: now must be a positive epoch ms')
  const finalId = id === null || id === undefined ? agentId(at) : String(id)
  if (!finalId) throw new Error('agent: agentId required')

  return {
    _id: finalId,
    agentId: finalId,
    name: label,
    description: String(description ?? '').slice(0, 500),
    autonomy,
    accountId: String(accountId ?? 'default'),
    instruments: Array.isArray(instruments) ? instruments.map(String) : [],
    state: 'draft',
    activeVersionId: null,
    versionCount: 0,
    startedAt: null,
    disabledAt: null,
    lastEventAt: at,
    lastHeartbeatAt: null,
    actionCounts: { allowed: 0, blocked: 0 },
    timeline: [{ t: at, kind: 'created', message: `agent created at ${autonomy}` }],
    timelineDropped: 0,
    createdBy: createdBy ?? null,
    schemaVersion: AGENT_SCHEMA_VERSION,
  }
}

/** Append a timeline event (capped; overflow drops the oldest and counts it). */
export function appendAgentEvent(doc, event) {
  if (!doc || typeof doc !== 'object') throw new Error('agent: doc required')
  const ev = event && typeof event === 'object' ? event : {}
  const t = Number(ev.t)
  if (!Number.isFinite(t) || t <= 0) throw new Error('agent: event.t must be a positive epoch ms')
  const entry = { t, kind: String(ev.kind ?? 'note'), message: String(ev.message ?? '').slice(0, 500) }
  const timeline = [...(Array.isArray(doc.timeline) ? doc.timeline : []), entry]
  let dropped = Number(doc.timelineDropped) || 0
  while (timeline.length > AGENT_MAX_EVENTS) {
    timeline.shift()
    dropped += 1
  }
  return { ...doc, timeline, timelineDropped: dropped, lastEventAt: t }
}

/**
 * Guard an agent state transition. Returns { ok:true, doc } with timestamps and
 * a timeline entry applied (input untouched) or { ok:false, code, message }.
 * Terminal states never reopen; a capability upgrade is a new version, not a
 * state edit.
 */
export function transitionAgent(doc, to, opts = {}) {
  if (!doc || typeof doc !== 'object') return fail('BAD_DOC', 'agent: doc required')
  const from = doc.state
  if (!AGENT_STATES.includes(from)) return fail('BAD_STATE', `agent: unknown state ${String(from)}`)
  if (!AGENT_STATES.includes(to)) return fail('BAD_TARGET', `agent: unknown target ${String(to)}`)
  const allowed = AGENT_EDGES[from] ?? []
  if (!allowed.includes(to)) {
    return fail('ILLEGAL_TRANSITION', `agent: ${String(from)} -> ${String(to)} not allowed`)
  }
  const at = opts.at === undefined || opts.at === null ? Date.now() : Number(opts.at)
  if (!Number.isFinite(at) || at <= 0) return fail('BAD_TIME', 'agent: at must be a positive epoch ms')

  const next = { ...doc, state: to, lastEventAt: at }
  if (to === 'active') {
    next.startedAt = doc.startedAt ?? at
    next.lastHeartbeatAt = at // activation is the first recorded liveness point
  }
  if (to === 'disabled') next.disabledAt = at
  return { ok: true, doc: appendAgentEvent(next, { t: at, kind: 'state', message: `${from} -> ${to}` }) }
}

/** True when no further transitions are legal. */
export function isTerminal(state) {
  return AGENT_TERMINAL_STATES.includes(state)
}

/**
 * Extra precondition for a target state: an agent may not be validated with no
 * version, and may not become active without one published (a state with
 * nothing to run is a claim, not a configuration).
 */
export function versionRequirement(agent, to) {
  if (!agent || typeof agent !== 'object') return fail('BAD_DOC', 'agent: doc required')
  if (to === 'validated' && !(Number(agent.versionCount) > 0)) {
    return fail('VERSION_REQUIRED', 'publish a version before validating an agent')
  }
  if (to === 'active' && !agent.activeVersionId) {
    return fail('VERSION_REQUIRED', 'an agent cannot become active without a published version')
  }
  return { ok: true }
}

/**
 * Record a heartbeat. Only an active agent has liveness — a paused/disabled
 * agent reporting "alive" is exactly the fabrication §59.16 forbids.
 */
export function heartbeat(doc, opts = {}) {
  if (!doc || typeof doc !== 'object') return fail('BAD_DOC', 'agent: doc required')
  if (doc.state !== 'active') return fail('AGENT_NOT_ACTIVE', `agent is ${String(doc.state)} — only an active agent has a heartbeat`)
  const at = opts.at === undefined || opts.at === null ? Date.now() : Number(opts.at)
  if (!Number.isFinite(at) || at <= 0) return fail('BAD_TIME', 'agent: at must be a positive epoch ms')
  return { ok: true, doc: { ...doc, lastHeartbeatAt: at, lastEventAt: at } }
}

/** Health of an agent at `now`, derived — never stored as a second truth. */
export function agentHealth(doc, opts = {}) {
  if (!doc || typeof doc !== 'object') return 'unknown'
  if (doc.state !== 'active') return 'inactive'
  const now = Number(opts.now ?? Date.now())
  const maxAge = Number(opts.maxAgeMs ?? HEARTBEAT_MAX_AGE_MS)
  const beat = Number(doc.lastHeartbeatAt)
  if (!Number.isFinite(beat) || beat <= 0) return 'unknown'
  return now - beat > maxAge ? 'stale' : 'ok'
}

/**
 * Deterministic identity of an immutable version. Covers the fields that change
 * behaviour (model, prompts, tools, autonomy, policy snapshot) — not timestamps,
 * so the same config published twice hashes the same and a tampered field is
 * detectable (verifyVersion).
 */
export function versionHash(version) {
  const canon = {
    agentId: String(version?.agentId ?? ''),
    version: Number(version?.version) || 0,
    autonomy: String(version?.autonomy ?? ''),
    model: version?.model ?? null,
    prompts: version?.prompts ?? null,
    tools: Array.isArray(version?.tools) ? [...version.tools].map(String).sort() : [],
    policy: version?.policy ?? null,
  }
  return 'agv1_' + createHash('sha256').update(stableStringify(canon)).digest('hex').slice(0, 40)
}

/** Recompute and compare — an edited immutable version fails this check. */
export function verifyVersion(version) {
  if (!version || typeof version !== 'object') return fail('BAD_VERSION', 'version doc required')
  const expected = String(version.hash ?? '')
  if (!expected) return fail('VERSION_UNHASHED', 'version has no hash')
  const actual = versionHash(version)
  if (actual !== expected) return fail('VERSION_TAMPERED', 'version hash does not match its content')
  return { ok: true, hash: actual }
}

/**
 * Build an immutable agent version. Throws on anything the policy forbids —
 * an unauthorized tool must never be persisted in the first place.
 */
export function createAgentVersion(input = {}) {
  const {
    versionId: id = null,
    agentId: owner = '',
    version = 1,
    autonomy = 'A0',
    model = null,
    prompts = null,
    tools = [],
    createdBy = null,
    note = '',
    now = Date.now(),
  } = input ?? {}

  const agent = String(owner ?? '').trim()
  if (!agent) throw new Error('agent version: agentId is required')
  if (!AUTONOMY_LEVELS.includes(autonomy)) {
    throw new Error(`agent version: autonomy must be one of ${AUTONOMY_LEVELS.join('|')} (got ${String(autonomy)})`)
  }
  const n = Number(version)
  if (!Number.isInteger(n) || n < 1) throw new Error('agent version: version must be an integer >= 1')
  const at = Number(now)
  if (!Number.isFinite(at) || at <= 0) throw new Error('agent version: now must be a positive epoch ms')

  const promptText = prompts && typeof prompts === 'object' ? String(prompts.system ?? '').trim() : ''
  if (!promptText) throw new Error('agent version: prompts.system is required (a version with no prompt is not a version)')

  const allow = allowedTools(autonomy)
  const list = [...new Set((Array.isArray(tools) ? tools : []).map((t) => String(t).trim()).filter(Boolean))]
  for (const tool of list) {
    if (!allow.includes(tool)) {
      throw new Error(`agent version: tool "${tool}" is not allowed at ${autonomy} (allowed: ${allow.join(', ') || 'none'})`)
    }
  }

  const versionDoc = {
    _id: id === null || id === undefined ? agentVersionId(agent, at) : String(id),
    versionId: '',
    agentId: agent,
    version: n,
    autonomy,
    model: model && typeof model === 'object' ? { ...model } : null,
    prompts: { system: promptText.slice(0, 8000) },
    tools: list,
    policy: {
      level: autonomy,
      label: AUTONOMY_LABELS[autonomy],
      enabled: AUTONOMY_POLICY[autonomy].enabled,
      maxAction: AUTONOMY_POLICY[autonomy].maxAction,
      requiresRiskIntegration: AUTONOMY_POLICY[autonomy].requiresRiskIntegration,
    },
    // A2 may not act on orders until real evidence is recorded here.
    riskIntegration: { passed: false, at: null, evidence: null, tests: [] },
    note: String(note ?? '').slice(0, 500),
    immutable: true,
    createdBy: createdBy ?? null,
    schemaVersion: AGENT_VERSION_SCHEMA_VERSION,
  }
  versionDoc.versionId = versionDoc._id
  return Object.freeze({ ...versionDoc, hash: versionHash(versionDoc) })
}

/**
 * Guard for stamping risk-integration evidence. Write-once: evidence may set
 * `passed` from false to true exactly once, never un-pass and never be replaced
 * (a version's proof of risk testing is part of its identity).
 */
export function riskIntegrationEdge(version, evidence = {}) {
  if (!version || typeof version !== 'object') return fail('BAD_VERSION', 'version doc required')
  if (version.riskIntegration?.passed) {
    return fail('EVIDENCE_ALREADY_RECORDED', 'risk-integration evidence is already recorded for this version')
  }
  const passed = evidence?.passed === true
  if (!passed) return fail('EVIDENCE_NOT_PASSED', 'evidence.passed must be true to unblock A2')
  const tests = Array.isArray(evidence?.tests) ? evidence.tests.map(String).filter(Boolean) : []
  if (tests.length === 0) return fail('EVIDENCE_INCOMPLETE', 'evidence.tests must name at least one passing risk test')
  const at = Number(evidence?.at ?? Date.now())
  if (!Number.isFinite(at) || at <= 0) return fail('BAD_TIME', 'evidence.at must be a positive epoch ms')
  if (version.autonomy !== 'A2') return fail('LEVEL_NOT_GATED', `risk-integration evidence only gates A2 (version is ${String(version.autonomy)})`)
  return { ok: true, doc: { ...version, riskIntegration: { passed: true, at, evidence: String(evidence?.evidence ?? '').slice(0, 1000) || null, tests } } }
}

/**
 * Validate the explicit action schema. Every action carries an actionId and an
 * idempotency key; every ORDER action additionally carries a sessionId — no
 * session, no order (§59.15 D3, Slice C).
 */
export function validateAction(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail('BAD_ACTION', 'action must be an object')
  }
  const type = String(input.type ?? '').trim()
  if (!AGENT_ACTIONS.includes(type)) {
    return fail('BAD_ACTION_TYPE', `action.type must be one of ${AGENT_ACTIONS.join('|')} (got "${type}")`)
  }
  const actionId = String(input.actionId ?? '').trim()
  if (!actionId) return fail('ACTION_ID_REQUIRED', 'action.actionId is required')

  const idempotencyKey = String(input.idempotencyKey ?? '').trim()
  if (idempotencyKey.length < MIN_IDEMPOTENCY_KEY) {
    return fail('IDEMPOTENCY_REQUIRED', `action.idempotencyKey must be at least ${MIN_IDEMPOTENCY_KEY} chars (D4: no order-layer action without one)`)
  }
  const sessionId = input.sessionId === undefined || input.sessionId === null
    ? null
    : String(input.sessionId).trim() || null
  if (ORDER_ACTIONS.includes(type) && !sessionId) {
    return fail('SESSION_REQUIRED', `${type} requires action.sessionId — an order with no session is untraceable`)
  }
  const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? { ...input.payload }
    : {}
  const at = Number(input.at ?? Date.now())
  if (!Number.isFinite(at) || at <= 0) return fail('BAD_TIME', 'action.at must be a positive epoch ms')

  return {
    ok: true,
    action: {
      actionId,
      type,
      idempotencyKey,
      sessionId,
      payload,
      at,
      reason: String(input.reason ?? '').slice(0, 500),
    },
  }
}

/**
 * The single authorization decision. Callers MUST NOT write anything the agent
 * requested when this returns { ok:false } — block, audit, stop (§59.15).
 *
 * @param {object} o
 * @param {object} o.agent  persisted agent doc (state + activeVersionId)
 * @param {object} o.version persisted version doc (must be the active one)
 * @param {object} o.action result of validateAction().action
 * @param {object} [o.session] trading session doc for order actions
 * @param {object} [o.riskDecision] decision returned by exec/risk.mjs (D7)
 * @param {number} [o.at]
 */
export function authorizeAction(o = {}) {
  const { agent, version, action, session = null, riskDecision = null } = o

  if (!agent || typeof agent !== 'object') return fail('AGENT_REQUIRED', 'agent doc required')
  if (agent.state !== 'active') {
    return fail('AGENT_NOT_ACTIVE', `agent is ${String(agent.state)} — only an active agent may act`)
  }
  if (!version || typeof version !== 'object') return fail('VERSION_REQUIRED', 'agent version doc required')
  if (String(version.agentId) !== String(agent.agentId)) {
    return fail('VERSION_MISMATCH', 'version does not belong to this agent')
  }
  const intact = verifyVersion(version)
  if (!intact.ok) return intact
  if (String(agent.activeVersionId ?? '') !== String(version.versionId)) {
    return fail('VERSION_NOT_ACTIVE', 'only the active version of an agent may act')
  }
  if (!action || typeof action !== 'object') return fail('BAD_ACTION', 'action required')

  const level = String(version.autonomy ?? '')
  const policy = AUTONOMY_POLICY[level]
  if (!policy) return fail('BAD_LEVEL', `unknown autonomy level ${level}`)
  if (!policy.enabled) {
    return fail('LEVEL_DISABLED', `autonomy ${level} (${AUTONOMY_LABELS[level]}) is disabled by policy (${policy.reason})`)
  }
  const rank = ACTION_RANK[action.type]
  if (rank === undefined) return fail('BAD_ACTION_TYPE', `unknown action type ${String(action.type)}`)
  if (rank > ACTION_RANK[policy.maxAction]) {
    return fail('ACTION_NOT_ALLOWED', `action "${action.type}" exceeds ${level} (${AUTONOMY_LABELS[level]}, max ${policy.maxAction})`)
  }
  const neededTool = ACTION_TOOL[action.type]
  if (neededTool) {
    const toolOk = checkTool(level, neededTool)
    if (!toolOk.ok) return toolOk
    const declared = Array.isArray(version.tools) ? version.tools : []
    if (!declared.includes(neededTool)) {
      return fail('TOOL_NOT_DECLARED', `version does not declare "${neededTool}" in its tool allowlist`)
    }
  }

  if (!ORDER_ACTIONS.includes(action.type)) {
    return { ok: true, level, actionType: action.type, order: false }
  }

  // ---- Order-capable actions: session first, then the Risk Gate decision ----
  if (!action.sessionId) return fail('SESSION_REQUIRED', `${action.type} requires a sessionId`)
  if (!session || typeof session !== 'object') {
    return fail('SESSION_NOT_FOUND', `trading session ${action.sessionId} does not exist`)
  }
  if (String(session.sessionId ?? session._id) !== String(action.sessionId)) {
    return fail('SESSION_MISMATCH', 'session doc does not match action.sessionId')
  }
  if (session.state !== 'running') {
    return fail('SESSION_NOT_RUNNING', `session ${action.sessionId} is ${String(session.state)} — orders need a running session`)
  }
  if (policy.requiresRiskIntegration && version.riskIntegration?.passed !== true) {
    return fail('RISK_INTEGRATION_REQUIRED', `${level} requires recorded risk-integration evidence before acting on orders`)
  }
  if (!riskDecision || riskDecision.ok !== true) {
    return fail(
      'RISK_DECISION_REQUIRED',
      `no Risk Gate approval for ${action.type} (D7: the gate is the only way to an order)`
    )
  }
  return { ok: true, level, actionType: action.type, order: true, gateCode: String(riskDecision.code ?? 'OK') }
}
