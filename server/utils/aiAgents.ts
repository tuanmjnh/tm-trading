import { createError } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  aiAgentActionModel,
  aiAgentModel,
  aiAgentVersionModel,
  aiProposalModel,
  experimentModel,
  tradingSessionModel
} from './engineModel'

// =============================================================================
//  AI agents store — read model (V3.4 Slice B) + governance (V3.5 §59.15 D).
//
//  READ MODEL: gateway config status (presence flags only — never secrets), the
//  static tool allowlist of ai/agent.mjs, and counts of persisted AI outputs.
//
//  GOVERNANCE (Slice D): agents, immutable versions, the autonomy ladder, the
//  tool allowlist, the action schema and the append-only action ledger. Every
//  decision comes from the pure guards in engine/agentPolicy.mjs (D25) — this
//  module only resolves models, applies guarded results and persists.
//
//  The model layer still runs no autonomous loop: an agent is a governed
//  configuration plus an audited action trail. Nothing here places an order —
//  an A2 order action is authorized only with a real exec/risk.mjs decision, and
//  the executor (Slice C) remains the thing that writes orders/positions.
//
//  Dynamic engine imports (pathToFileURL + @vite-ignore): Nitro dev bundles
//  static relative paths out of server/ incorrectly (docs/app-inheritance.md).
// =============================================================================

// -----------------------------------------------------------------------------
//  Read model (Slice B)
// -----------------------------------------------------------------------------

export interface AiToolInfo {
  name: string
  description: string
}

export interface AiAgentsStatus {
  gateway: {
    provider: string
    model: string
    configured: boolean
  }
  tools: AiToolInfo[]
  counts: {
    proposals: number
    experiments: number
    agents: number
    blockedActions: number
  }
  mongo: 'up' | 'down'
}

interface AgentModule {
  TOOLS: Record<string, { description?: unknown }>
}

let agentModP: Promise<AgentModule> | null = null

function agentModule(): Promise<AgentModule> {
  if (!agentModP) {
    const href = pathToFileURL(join(process.cwd(), 'ai', 'agent.mjs')).href
    // @vite-ignore — same cwd-dynamic-import pattern as engineModel (dev
    // bundler mangles static relative paths out of server/).
    agentModP = import(/* @vite-ignore */ href) as Promise<AgentModule>
  }
  return agentModP
}

export async function aiAgentsStatus(ownerId?: string): Promise<AiAgentsStatus> {
  const provider = String(process.env.AI_PROVIDER || 'openai').toLowerCase()
  const model = String(process.env.AI_MODEL || 'gpt-4o-mini').trim()
  const configured = String(process.env.AI_API_KEY || '').trim().length > 0

  let tools: AiToolInfo[] = []
  try {
    const mod = await agentModule()
    tools = Object.entries(mod.TOOLS ?? {}).map(([name, def]) => ({
      name,
      description: typeof def?.description === 'string' ? def.description : ''
    }))
  } catch {
    tools = []
  }

  let proposals = 0
  let experiments = 0
  let agents = 0
  let blockedActions = 0
  let mongo: 'up' | 'down' = 'down'
  try {
    const [P, E, A, Act] = await Promise.all([
      aiProposalModel(),
      experimentModel(),
      aiAgentModel(),
      aiAgentActionModel()
    ])
    if (P && E) {
      // Tenancy (roadmap §61.3): counts must reflect only the caller's rows.
      const own = ownerId ? { ownerId } : {}
      const [pc, ec, ac, bc] = await Promise.all([
        P.countDocuments(own).catch(() => 0),
        E.countDocuments(own).catch(() => 0),
        A ? A.countDocuments(own).catch(() => 0) : 0,
        Act ? Act.countDocuments({ ...own, status: 'blocked' }).catch(() => 0) : 0
      ])
      proposals = Number(pc) || 0
      experiments = Number(ec) || 0
      agents = Number(ac) || 0
      blockedActions = Number(bc) || 0
      mongo = 'up'
    }
  } catch {
    mongo = 'down'
  }

  return { gateway: { provider, model, configured }, tools, counts: { proposals, experiments, agents, blockedActions }, mongo }
}

// -----------------------------------------------------------------------------
//  Governance module loader (pure policy) — engine/agentPolicy.mjs
// -----------------------------------------------------------------------------

type PolicyModule = typeof import('../../engine/agentPolicy.mjs')
type RiskModule = typeof import('../../exec/risk.mjs')

let policyModP: Promise<PolicyModule> | null = null
let riskModP: Promise<RiskModule> | null = null

async function policyModule(): Promise<PolicyModule> {
  if (!policyModP) {
    const href = pathToFileURL(join(process.cwd(), 'engine', 'agentPolicy.mjs')).href
    policyModP = import(/* @vite-ignore */ href) as Promise<PolicyModule>
  }
  return policyModP
}

/** The Risk Gate (D7). Slice D never re-implements it — it calls the real one. */
async function riskGate(): Promise<RiskModule> {
  if (!riskModP) {
    const href = pathToFileURL(join(process.cwd(), 'exec', 'risk.mjs')).href
    riskModP = import(/* @vite-ignore */ href) as Promise<RiskModule>
  }
  return riskModP
}

export class AgentError extends Error {
  statusCode: number
  statusMessage: string
  constructor(message: string, statusCode = 400, statusMessage = 'agent_error') {
    super(message)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

export function aiAgentsHttpError(err: unknown) {
  if (err instanceof AgentError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.statusMessage, message: err.message })
  }
  const e = err as { statusCode?: number; statusMessage?: string; message?: string } | null
  if (e && typeof e.statusCode === 'number') {
    return createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? 'error', message: e.message ?? 'error' })
  }
  return createError({ statusCode: 500, statusMessage: 'agent_failed', message: e?.message || 'agent failed' })
}

/** Policy table for the UI — one source, never hand-maintained in a component. */
export async function agentPolicyAsync() {
  const mod = await policyModule()
  return mod.describePolicy()
}

type AnyDoc = Record<string, any>

/**
 * Loose shape of a pure-guard result. engine/agentPolicy.mjs is untyped JS, so
 * TypeScript widens `ok` to boolean and cannot discriminate the union — this
 * alias keeps the narrowing explicit at every call site instead of sprinkling
 * `any` through the store.
 */
type GuardResult = {
  ok: boolean
  code?: string
  message?: string
  doc?: AnyDoc
  action?: AnyDoc
  hash?: string
  level?: string
}

export interface ListAgentsOptions {
  limit?: number
  state?: string
  autonomy?: string
  accountId?: string
  /** Tenancy (roadmap §61.3): restrict the list to the caller's own agents. */
  ownerId?: string
}

export async function listAgents(options: ListAgentsOptions = {}): Promise<AnyDoc[]> {
  const Agent = await aiAgentModel()
  if (!Agent) return []
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
  const filter: Record<string, unknown> = {}
  if (options.ownerId) filter.ownerId = options.ownerId
  if (options.state) filter.state = options.state
  if (options.autonomy) filter.autonomy = options.autonomy
  if (options.accountId) filter.accountId = options.accountId
  try {
    return (await Agent.find(filter).sort({ lastEventAt: -1, _id: -1 }).limit(limit).lean()) as AnyDoc[]
  } catch {
    return []
  }
}

export async function getAgent(id: string, ownerId: string): Promise<AnyDoc | null> {
  const Agent = await aiAgentModel()
  if (!Agent) return null
  try {
    const found = await Agent.findOne({ ownerId, $or: [{ _id: id }, { agentId: id }] }).lean()
    return (found ?? null) as AnyDoc | null
  } catch {
    return null
  }
}

/** Agent + active version + derived health + recent versions/actions (§59.16). */
export async function getAgentDetail(id: string, ownerId: string): Promise<AnyDoc | null> {
  const [Agent, Version, Action] = await Promise.all([aiAgentModel(), aiAgentVersionModel(), aiAgentActionModel()])
  if (!Agent) return null
  const agent = await getAgent(id, ownerId)
  if (!agent) return null
  const policy = await policyModule()

  const [activeVersion, versions, actions] = await Promise.all([
    agent.activeVersionId && Version
      ? Version.findOne({ versionId: agent.activeVersionId, ownerId }).lean().catch(() => null)
      : Promise.resolve(null),
    Version
      ? Version.find({ agentId: agent.agentId, ownerId }).sort({ version: -1 }).limit(10).lean().catch(() => [])
      : Promise.resolve([]),
    Action
      ? Action.find({ agentId: agent.agentId, ownerId }).sort({ at: -1 }).limit(20).lean().catch(() => [])
      : Promise.resolve([])
  ])

  const integrity = activeVersion ? (policy.verifyVersion(activeVersion) as GuardResult) : null

  return {
    agent,
    activeVersion: activeVersion ?? null,
    versionIntegrity: integrity ? { ok: integrity.ok, code: integrity.ok ? 'OK' : integrity.code } : null,
    health: policy.agentHealth(agent),
    policy: policy.describePolicy().find((p) => p.level === (activeVersion?.autonomy ?? agent.autonomy)) ?? null,
    versions,
    actions,
    mongo: 'up'
  }
}

export interface CreateAgentInput {
  name?: string
  description?: string
  autonomy?: string
  accountId?: string
  instruments?: string[]
  createdBy?: string | null
  /** Tenancy (roadmap §61.3): the creating hub user id. */
  ownerId?: string | null
}

export async function createAgentRecord(input: CreateAgentInput): Promise<AnyDoc> {
  const Agent = await aiAgentModel()
  if (!Agent) throw new AgentError('agents store unavailable', 503, 'mongo_down')
  const policy = await policyModule()
  let doc: AnyDoc
  try {
    doc = policy.createAgent({ ...input, now: Date.now() })
  } catch (err) {
    throw new AgentError(err instanceof Error ? err.message : 'invalid agent', 400, 'invalid_agent')
  }
  doc.ownerId = input.ownerId ?? null
  try {
    const created = await Agent.create(doc)
    return created.toObject ? created.toObject() : created
  } catch (err) {
    if ((err as { code?: unknown })?.code === 11000) throw new AgentError('agent already exists', 409, 'agent_exists')
    throw err
  }
}

export interface PublishVersionInput {
  autonomy?: string
  model?: Record<string, unknown> | null
  prompts?: { system?: string } | null
  tools?: string[]
  note?: string
  createdBy?: string | null
}

/**
 * Publish an immutable version. The version number is assigned here (never by
 * the client) and the agent's activeVersionId points at it — activation stays a
 * separate, explicit transition.
 */
export async function publishAgentVersion(agentId: string, input: PublishVersionInput, ownerId: string): Promise<AnyDoc> {
  const [Agent, Version] = await Promise.all([aiAgentModel(), aiAgentVersionModel()])
  if (!Agent || !Version) throw new AgentError('agents store unavailable', 503, 'mongo_down')
  const agent = await getAgent(agentId, ownerId)
  if (!agent) throw new AgentError(`agent not found: ${agentId}`, 404, 'agent_not_found')

  const policy = await policyModule()
  const next = Number(agent.versionCount || 0) + 1
  let doc: AnyDoc
  try {
    doc = policy.createAgentVersion({
      agentId: agent.agentId,
      version: next,
      autonomy: input.autonomy ?? agent.autonomy,
      model: input.model ?? null,
      prompts: input.prompts ?? null,
      tools: input.tools ?? [],
      note: input.note ?? '',
      createdBy: input.createdBy ?? null,
      now: Date.now()
    })
  } catch (err) {
    throw new AgentError(err instanceof Error ? err.message : 'invalid version', 400, 'invalid_version')
  }

  // Tenancy (roadmap §61.3): versions and actions inherit the owning agent's id.
  doc.ownerId = ownerId
  try {
    await Version.create(doc)
  } catch (err) {
    if ((err as { code?: unknown })?.code === 11000) throw new AgentError('version already exists', 409, 'version_exists')
    throw err
  }
  await Agent.updateOne(
    { agentId: agent.agentId, ownerId },
    { $set: { activeVersionId: doc.versionId, versionCount: next, autonomy: doc.autonomy, lastEventAt: Date.now() } }
  )
  const updated = await getAgent(agent.agentId, ownerId)
  return { version: doc, agent: updated }
}

/**
 * Validate a version against policy: hash integrity, allowlisted tools and the
 * A2 risk-integration gate. Returns every failing check — an agent UI must show
 * why, not a generic "invalid".
 */
export async function validateAgentVersion(agentId: string, versionId: string | undefined, ownerId: string): Promise<AnyDoc> {
  const [Agent, Version] = await Promise.all([aiAgentModel(), aiAgentVersionModel()])
  if (!Agent || !Version) throw new AgentError('agents store unavailable', 503, 'mongo_down')
  const agent = await getAgent(agentId, ownerId)
  if (!agent) throw new AgentError(`agent not found: ${agentId}`, 404, 'agent_not_found')

  const target = versionId || agent.activeVersionId
  if (!target) throw new AgentError('no version to validate', 409, 'version_required')
  const version = await Version.findOne({ versionId: target, agentId: agent.agentId, ownerId }).lean().catch(() => null)
  if (!version) throw new AgentError(`version not found: ${target}`, 404, 'version_not_found')

  const policy = await policyModule()
  const errors: string[] = []

  const integrity = policy.verifyVersion(version) as GuardResult
  if (!integrity.ok) errors.push(String(integrity.message ?? 'version failed integrity check'))

  const allow = policy.allowedTools(version.autonomy)
  for (const tool of Array.isArray(version.tools) ? version.tools : []) {
    if (!allow.includes(tool)) errors.push(`tool "${tool}" is not allowed at ${version.autonomy}`)
  }

  const policyTable = policy.AUTONOMY_POLICY as Record<string, { enabled: boolean; maxAction: string | null; requiresRiskIntegration: boolean; reason: string | null }>
  const levelPolicy = policyTable[String(version.autonomy ?? '')]
  if (!levelPolicy?.enabled) {
    errors.push(`autonomy ${version.autonomy} is disabled by policy (${levelPolicy?.reason ?? 'unknown'})`)
  } else if (!levelPolicy.maxAction) {
    errors.push(`autonomy ${version.autonomy} has no action capability`)
  }
  if (levelPolicy?.requiresRiskIntegration && version.riskIntegration?.passed !== true) {
    errors.push('risk-integration evidence is required before this level may act on orders')
  }
  if (!version.prompts?.system?.trim()) errors.push('prompts.system is required')

  const result = {
    ok: errors.length === 0,
    versionId: version.versionId,
    hash: version.hash,
    agentId: agent.agentId,
    autonomy: version.autonomy,
    tools: version.tools ?? [],
    allowedTools: allow,
    riskIntegrationPassed: version.riskIntegration?.passed === true,
    errors,
    agentState: agent.state as string,
    agentPromoted: false
  }

  // Validation is the ONLY door from `draft`: without this promotion nothing
  // could ever reach `validated`, and `start` would be refused forever. The
  // move is guarded like every other transition — it is a consequence of a
  // passing check, never of the caller asking for it.
  if (result.ok && agent.state === 'draft') {
    const promoted = await moveAgent(agent.agentId, 'validated', ownerId).catch(() => null)
    if (promoted) {
      result.agentState = String(promoted.state)
      result.agentPromoted = true
    }
  }

  return result
}

/** Guarded lifecycle transition (illegal moves rejected, never forced). */
export async function moveAgent(agentId: string, to: string, ownerId: string): Promise<AnyDoc> {
  const Agent = await aiAgentModel()
  if (!Agent) throw new AgentError('agents store unavailable', 503, 'mongo_down')
  const agent = await getAgent(agentId, ownerId)
  if (!agent) throw new AgentError(`agent not found: ${agentId}`, 404, 'agent_not_found')

  const policy = await policyModule()
  const pre = policy.versionRequirement(agent, to) as GuardResult
  if (!pre.ok) throw new AgentError(String(pre.message ?? 'version required'), 409, String(pre.code ?? 'version_required'))

  const res = policy.transitionAgent(agent, to, { at: Date.now() }) as GuardResult
  if (!res.ok) throw new AgentError(String(res.message ?? 'illegal transition'), 409, String(res.code ?? 'illegal_transition'))
  const next = res.doc ?? agent

  await Agent.updateOne(
    { agentId: agent.agentId, ownerId },
    {
      $set: {
        state: next.state,
        startedAt: next.startedAt ?? null,
        disabledAt: next.disabledAt ?? null,
        lastHeartbeatAt: next.lastHeartbeatAt ?? null,
        lastEventAt: next.lastEventAt,
        timeline: next.timeline,
        timelineDropped: next.timelineDropped
      }
    }
  )
  const updated = await getAgent(agent.agentId, ownerId)
  return updated ?? next
}

/**
 * Record A2 risk-integration evidence — write-once, on the active version. This
 * is the only mutation an immutable version ever accepts.
 */
export async function recordAgentRiskIntegration(agentId: string, evidence: Record<string, unknown>, ownerId: string): Promise<AnyDoc> {
  const [Agent, Version] = await Promise.all([aiAgentModel(), aiAgentVersionModel()])
  if (!Agent || !Version) throw new AgentError('agents store unavailable', 503, 'mongo_down')
  const agent = await getAgent(agentId, ownerId)
  if (!agent) throw new AgentError(`agent not found: ${agentId}`, 404, 'agent_not_found')
  if (!agent.activeVersionId) throw new AgentError('agent has no active version', 409, 'version_required')

  const version = await Version.findOne({ versionId: agent.activeVersionId, ownerId }).lean().catch(() => null)
  if (!version) throw new AgentError(`version not found: ${agent.activeVersionId}`, 404, 'version_not_found')

  const policy = await policyModule()
  const edge = policy.riskIntegrationEdge(version, evidence) as GuardResult
  if (!edge.ok) throw new AgentError(String(edge.message ?? 'evidence rejected'), 409, String(edge.code ?? 'evidence_rejected'))

  await Version.updateOne(
    { versionId: version.versionId, ownerId },
    { $set: { riskIntegration: edge.doc?.riskIntegration ?? null } }
  )
  const updated = await Version.findOne({ versionId: version.versionId, ownerId }).lean()
  return { version: updated, agent: await getAgent(agent.agentId, ownerId) }
}

/**
 * Liveness report from a runtime. Only an active agent has a heartbeat; a
 * paused agent claiming to be alive is refused (never fabricated — D12).
 */
export async function heartbeatAgent(agentId: string, at: number | undefined, ownerId: string): Promise<AnyDoc> {
  const Agent = await aiAgentModel()
  if (!Agent) throw new AgentError('agents store unavailable', 503, 'mongo_down')
  const agent = await getAgent(agentId, ownerId)
  if (!agent) throw new AgentError(`agent not found: ${agentId}`, 404, 'agent_not_found')

  const policy = await policyModule()
  const beat = policy.heartbeat(agent, { at: at ?? Date.now() }) as GuardResult
  if (!beat.ok) throw new AgentError(String(beat.message ?? 'heartbeat refused'), 409, String(beat.code ?? 'heartbeat_refused'))

  await Agent.updateOne(
    { agentId: agent.agentId, ownerId },
    { $set: { lastHeartbeatAt: beat.doc?.lastHeartbeatAt ?? null, lastEventAt: beat.doc?.lastEventAt ?? null } }
  )
  return (await getAgent(agent.agentId, ownerId)) ?? beat.doc ?? agent
}

export interface ActionInput extends Record<string, unknown> {
  actionId?: string
  type?: string
  idempotencyKey?: string
  sessionId?: string
  payload?: Record<string, unknown>
  reason?: string
}

/**
 * The governed action path. Order:
 *   validate schema -> replay check (D4) -> load version/session ->
 *   real Risk Gate decision (D7, order actions) -> authorizeAction ->
 *   persist the ledger row (allowed OR blocked) -> bump counts.
 *
 * Returns the ledger row; the caller answers 403 when status is 'blocked'
 * (the row is already durable — denial is audited, never silent).
 */
export async function submitAgentAction(agentId: string, body: ActionInput, ownerId: string): Promise<AnyDoc> {
  const [Agent, Version, Action, Session] = await Promise.all([
    aiAgentModel(),
    aiAgentVersionModel(),
    aiAgentActionModel(),
    tradingSessionModel()
  ])
  if (!Agent || !Version || !Action) throw new AgentError('agents store unavailable', 503, 'mongo_down')

  const agent = await getAgent(agentId, ownerId)
  if (!agent) throw new AgentError(`agent not found: ${agentId}`, 404, 'agent_not_found')

  const policy = await policyModule()
  const parsed = policy.validateAction({ ...body, agentId: agent.agentId }) as GuardResult
  if (!parsed.ok) throw new AgentError(String(parsed.message ?? 'invalid action'), 400, String(parsed.code ?? 'invalid_action'))
  const action = (parsed.action ?? {}) as AnyDoc

  // D4 idempotency at the ACTION layer: a retry replays, it never re-acts.
  const replay = await Action.findOne({ agentId: agent.agentId, ownerId, idempotencyKey: action.idempotencyKey })
    .lean()
    .catch(() => null)
  if (replay) return { ...replay, replayed: true }

  const version = agent.activeVersionId
    ? await Version.findOne({ versionId: agent.activeVersionId, ownerId }).lean().catch(() => null)
    : null
  const session = action.sessionId && Session
    ? await Session.findOne({ ownerId, $or: [{ _id: action.sessionId }, { sessionId: action.sessionId }] }).lean().catch(() => null)
    : null

  let gateDecision: AnyDoc | null = null
  if (policy.ORDER_ACTIONS.includes(action.type)) {
    try {
      const risk = await riskGate()
      gateDecision = await risk.checkOrder({ ...(action.payload ?? {}), account: (action.payload?.account ?? agent.accountId) })
    } catch (err) {
      gateDecision = { ok: false, code: 'GATE_UNAVAILABLE', message: String((err as Error)?.message || err) }
    }
  }

  const decision = policy.authorizeAction({
    agent,
    version,
    action,
    session,
    riskDecision: gateDecision ?? undefined,
    at: Date.now()
  }) as GuardResult

  const at = Number(action.at) || Date.now()
  const row: AnyDoc = {
    _id: action.actionId,
    actionId: action.actionId,
    agentId: agent.agentId,
    agentVersionId: version?.versionId ?? null,
    autonomy: version?.autonomy ?? agent.autonomy ?? null,
    type: action.type,
    status: decision.ok ? 'allowed' : 'blocked',
    code: decision.ok ? 'OK' : decision.code,
    message: decision.ok ? '' : (decision.message ?? ''),
    sessionId: action.sessionId ?? null,
    idempotencyKey: action.idempotencyKey,
    riskDecision: gateDecision
      ? {
          ok: gateDecision.ok === true,
          code: String(gateDecision.code ?? (gateDecision.ok ? 'OK' : 'UNKNOWN')),
          at,
          mongoDown: gateDecision.mongoDown === true
        }
      : null,
    payload: action.payload ?? null,
    reason: action.reason ?? '',
    at,
    // Tenancy (roadmap §61.3): the ledger row belongs to the agent's owner.
    ownerId
  }

  try {
    await Action.create(row)
  } catch (err) {
    if ((err as { code?: unknown })?.code === 11000) {
      const raced = await Action.findOne({ agentId: agent.agentId, ownerId, idempotencyKey: action.idempotencyKey }).lean()
      if (raced) return { ...raced, replayed: true }
    }
    throw err
  }

  await Agent.updateOne(
    { agentId: agent.agentId, ownerId },
    {
      $inc: decision.ok ? { 'actionCounts.allowed': 1 } : { 'actionCounts.blocked': 1 },
      $set: decision.ok
        ? { lastHeartbeatAt: at, lastEventAt: at }
        : { lastEventAt: at }
    }
  )

  return row
}

export async function listAgentActions(agentId: string, limit: number, ownerId: string): Promise<AnyDoc[]> {
  const Action = await aiAgentActionModel()
  if (!Action) return []
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200)
  try {
    return (await Action.find({ agentId, ownerId }).sort({ at: -1 }).limit(n).lean()) as AnyDoc[]
  } catch {
    return []
  }
}
