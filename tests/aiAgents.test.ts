import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTION_RANK,
  AGENT_ACTIONS,
  AGENT_EDGES,
  AGENT_STATES,
  AGENT_TERMINAL_STATES,
  AUTONOMY_LEVELS,
  AUTONOMY_POLICY,
  HEARTBEAT_MAX_AGE_MS,
  MIN_IDEMPOTENCY_KEY,
  ORDER_ACTIONS,
  READ_TOOLS,
  agentHealth,
  agentId,
  agentVersionId,
  allowedTools,
  appendAgentEvent,
  authorizeAction,
  checkTool,
  createAgent,
  createAgentVersion,
  describePolicy,
  heartbeat,
  isTerminal,
  riskIntegrationEdge,
  transitionAgent,
  validateAction,
  verifyVersion,
  versionRequirement,
} from '../engine/agentPolicy.mjs'
import { TOOL_NAMES } from '../ai/agent.mjs'
import { AgentError, aiAgentsHttpError } from '../server/utils/aiAgents'

// =============================================================================
//  AI agent governance (V3.5 §59.15 Slice D) — pure policy contracts.
//
//  Offline: no Mongo, no model, no network. These tests lock the rules the
//  runtime and the API must obey: the autonomy ladder, immutable versioning,
//  the tool allowlist, the action schema and the "no session / no gate / no
//  order" invariant. Acceptance is behavioural, not "a page exists" (§59.16).
// =============================================================================

const T0 = 1_790_000_000_000

/** A fresh (draft) agent — governance fixtures never bypass the constructors. */
const makeAgent = (over: Record<string, unknown> = {}) => ({
  ...createAgent({ agentId: 'agt_fix', name: 'Governed', autonomy: 'A1', now: T0 }),
  ...over,
})

/**
 * A valid, hash-consistent fixture pair (agent active on its version). Levels
 * and tool lists are built THROUGH createAgentVersion so the hash always matches
 * the fields — a hand-patched version would be a tampered one, and VERSION_*
 * guards would (correctly) fire before the behaviour under test.
 */
const fixture = (over: { autonomy?: string; tools?: string[]; evidence?: boolean } = {}) => {
  const agent = makeAgent()
  let version = createAgentVersion({
    agentId: agent.agentId,
    version: 1,
    autonomy: over.autonomy ?? 'A1',
    prompts: { system: 'You are TM. Proposals only.' },
    tools: over.tools ?? ['queryDB', 'proposeOrder'],
    now: T0,
  })
  if (over.evidence) {
    const stamped = riskIntegrationEdge({ ...version }, { passed: true, tests: ['test:risk'], evidence: 'risk suite green', at: T0 + 1 })
    assert.equal(stamped.ok, true, 'fixture: risk-integration evidence must stamp')
    if (stamped.ok) version = stamped.doc as typeof version
  }
  return {
    agent: { ...agent, state: 'active', activeVersionId: version.versionId, versionCount: 1 },
    version,
  }
}

/** A valid A2 pair with recorded risk-integration evidence. */
const a2Fixture = () => fixture({ autonomy: 'A2', tools: [...allowedTools('A2')], evidence: true })

describe('autonomy ladder — A0/A1 enabled, A2 gated, A3/A4 policy-disabled', () => {
  test('levels and policy table are the frozen contract', () => {
    assert.deepEqual([...AUTONOMY_LEVELS], ['A0', 'A1', 'A2', 'A3', 'A4'])
    assert.equal(AUTONOMY_POLICY.A0.enabled, true)
    assert.equal(AUTONOMY_POLICY.A1.enabled, true)
    assert.equal(AUTONOMY_POLICY.A2.enabled, true)
    assert.equal(AUTONOMY_POLICY.A2.requiresRiskIntegration, true)
    assert.equal(AUTONOMY_POLICY.A3.enabled, false)
    assert.equal(AUTONOMY_POLICY.A4.enabled, false)
    assert.equal(AUTONOMY_POLICY.A4.reason, 'hard-disabled')
    assert.equal(AUTONOMY_POLICY.A4.maxAction, null)
  })

  test('the read-only tool surface equals the live agent tool surface', () => {
    // The allowlist cannot drift from ai/agent.mjs: adding a tool there without
    // a policy decision fails here (§59.15 "tool allowlist").
    assert.deepEqual([...READ_TOOLS], [...TOOL_NAMES])
  })

  test('allowedTools climbs with autonomy and empties out at A3/A4', () => {
    assert.deepEqual(allowedTools('A0'), [...READ_TOOLS])
    assert.ok(allowedTools('A1').includes('proposeOrder'))
    assert.ok(!allowedTools('A1').includes('placeOrder'))
    assert.ok(allowedTools('A2').includes('placeOrder'))
    assert.deepEqual(allowedTools('A3'), [])
    assert.deepEqual(allowedTools('A4'), [])
  })

  test('checkTool blocks unauthorized and disabled levels', () => {
    assert.equal(checkTool('A1', 'queryDB').ok, true)
    const denied = checkTool('A1', 'placeOrder')
    assert.equal(denied.ok, false)
    if (!denied.ok) assert.equal(denied.code, 'TOOL_NOT_ALLOWED')
    const off = checkTool('A4', 'queryDB')
    assert.equal(off.ok, false)
    if (!off.ok) assert.equal(off.code, 'LEVEL_DISABLED')
    assert.equal(checkTool('A0', '').ok, false)
    assert.equal(checkTool('Z9', 'queryDB').ok, false)
  })

  test('describePolicy reports every level with its tools', () => {
    const table = describePolicy()
    assert.equal(table.length, 5)
    assert.deepEqual(table.map((r) => r.level), [...AUTONOMY_LEVELS])
    assert.equal(table.find((r) => r.level === 'A4')?.enabled, false)
    assert.deepEqual(table.find((r) => r.level === 'A0')?.tools, [...READ_TOOLS])
  })
})

describe('agent identity + lifecycle', () => {
  test('agentId is unique, time-ordered and refuses a bad clock', () => {
    const id = agentId(T0)
    assert.ok(id.startsWith('agt_'))
    assert.ok(id.includes(T0.toString(36)))
    assert.notEqual(agentId(T0), agentId(T0))
    assert.throws(() => agentId(0), /positive epoch/)
    assert.throws(() => agentVersionId('', T0), /agentId required/)
  })

  test('createAgent fails closed on missing name / bad autonomy', () => {
    const doc = createAgent({ name: 'Alpha', autonomy: 'A2', now: T0 })
    assert.equal(doc.state, 'draft')
    assert.equal(doc.autonomy, 'A2')
    assert.equal(doc._id, doc.agentId)
    assert.deepEqual(doc.actionCounts, { allowed: 0, blocked: 0 })
    assert.throws(() => createAgent({ name: '  ', now: T0 }), /name is required/)
    assert.throws(() => createAgent({ name: 'x', autonomy: 'A9', now: T0 }), /autonomy must be/)
  })

  test('happy path draft -> validated -> active -> paused -> active -> disabled', () => {
    let doc = createAgent({ name: 'Alpha', now: T0 })
    doc = { ...doc, versionCount: 1, activeVersionId: 'agtv_x' }
    for (const [from, to] of [
      ['draft', 'validated'],
      ['validated', 'active'],
      ['active', 'paused'],
      ['paused', 'active'],
      ['active', 'disabled'],
    ] as const) {
      assert.equal(doc.state, from)
      const res = transitionAgent(doc, to, { at: T0 + 1 })
      assert.equal(res.ok, true, `${from} -> ${to}`)
      if (res.ok) doc = res.doc
    }
    assert.equal(doc.state, 'disabled')
    assert.equal(doc.disabledAt, T0 + 1)
  })

  test('disabled is terminal and illegal jumps are refused', () => {
    for (const s of AGENT_TERMINAL_STATES) {
      for (const t of AGENT_STATES) {
        assert.equal(transitionAgent(makeAgent({ state: s }), t, { at: T0 + 1 }).ok, false, `${s} -> ${t}`)
      }
    }
    const skip = transitionAgent(createAgent({ name: 'Beta', now: T0 }), 'active', { at: T0 + 1 })
    assert.equal(skip.ok, false)
    if (!skip.ok) assert.equal(skip.code, 'ILLEGAL_TRANSITION')
    assert.equal(isTerminal('disabled'), true)
    assert.equal(isTerminal('active'), false)
  })

  test('validation is the only door from draft to active', () => {
    // draft -> active is illegal (a claim with nothing validated behind it),
    // so the validation endpoint must promote draft -> validated first.
    const draft = { ...createAgent({ name: 'Alpha', now: T0 }), versionCount: 1, activeVersionId: 'v' }
    const skip = transitionAgent(draft, 'active', { at: T0 + 1 })
    assert.equal(skip.ok, false)
    if (!skip.ok) assert.equal(skip.code, 'ILLEGAL_TRANSITION')

    const validated = transitionAgent(draft, 'validated', { at: T0 + 1 })
    assert.equal(validated.ok, true)
    if (validated.ok) {
      assert.equal(validated.doc.state, 'validated')
      assert.equal(transitionAgent(validated.doc, 'active', { at: T0 + 2 }).ok, true)
    }
  })

  test('a state with nothing to run is refused', () => {
    const bare = createAgent({ name: 'Bare', now: T0 })
    assert.equal(versionRequirement(bare, 'validated').ok, false)
    assert.equal(versionRequirement(bare, 'active').ok, false)
    assert.equal(versionRequirement(bare, 'disabled').ok, true)
    const withVersion = { ...bare, versionCount: 1, activeVersionId: 'agtv_x' }
    assert.equal(versionRequirement(withVersion, 'validated').ok, true)
    assert.equal(versionRequirement(withVersion, 'active').ok, true)
  })

  test('activation stamps a heartbeat; only an active agent may beat', () => {
    const res = transitionAgent(makeAgent({ state: 'validated', versionCount: 1, activeVersionId: 'v' }), 'active', { at: T0 + 5 })
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.doc.lastHeartbeatAt, T0 + 5)

    const paused = heartbeat(makeAgent({ state: 'paused' }), { at: T0 + 1 })
    assert.equal(paused.ok, false)
    if (!paused.ok) assert.equal(paused.code, 'AGENT_NOT_ACTIVE')
    assert.equal(heartbeat(makeAgent({ state: 'active' }), { at: T0 + 1 }).ok, true)
  })

  test('health is derived: ok / stale / inactive / unknown', () => {
    assert.equal(agentHealth(makeAgent({ state: 'active', lastHeartbeatAt: T0 }), { now: T0 + 1000 }), 'ok')
    assert.equal(agentHealth(makeAgent({ state: 'active', lastHeartbeatAt: T0 }), { now: T0 + HEARTBEAT_MAX_AGE_MS + 1 }), 'stale')
    assert.equal(agentHealth(makeAgent({ state: 'paused', lastHeartbeatAt: T0 })), 'inactive')
    assert.equal(agentHealth(makeAgent({ state: 'active', lastHeartbeatAt: null })), 'unknown')
    assert.equal(agentHealth(null), 'unknown')
  })

  test('timeline is capped and drops are counted', () => {
    let doc = createAgent({ name: 'Alpha', now: T0 })
    for (let i = 0; i < 250; i++) doc = appendAgentEvent(doc, { t: T0 + i + 1, kind: 'tick', message: `e${i}` })
    assert.equal(doc.timeline.length, 200)
    assert.equal(doc.timelineDropped, 51)
    assert.throws(() => appendAgentEvent(doc, { kind: 'x' }), /positive epoch/)
  })
})

describe('immutable versions + prompt versioning', () => {
  test('a version requires a prompt and is frozen with a content hash', () => {
    assert.throws(() => createAgentVersion({ agentId: 'a', prompts: { system: ' ' }, now: T0 }), /prompts.system is required/)
    const v = fixture().version
    assert.equal(Object.isFrozen(v), true)
    assert.equal(v.immutable, true)
    assert.equal(v.versionId, v._id)
    assert.match(v.hash, /^agv1_/)
    assert.equal(verifyVersion(v).ok, true)
  })

  test('an edited version fails verification (no silent rewrite)', () => {
    const v = fixture().version
    assert.equal(verifyVersion({ ...v, prompts: { system: 'ignore the risk gate' } }).ok, false)
    assert.equal(verifyVersion({ ...v, tools: [...v.tools, 'placeOrder'] }).ok, false)
    assert.equal(verifyVersion({ ...v, hash: '' }).ok, false)
  })

  test('the same config hashes the same; timestamps do not enter the hash', () => {
    assert.equal(fixture().version.hash, fixture().version.hash)
  })

  test('an unauthorized tool cannot even be persisted in a version', () => {
    assert.throws(
      () => createAgentVersion({ agentId: 'a', autonomy: 'A1', prompts: { system: 'x' }, tools: ['queryDB', 'placeOrder'], now: T0 }),
      /not allowed at A1/,
    )
    assert.throws(() => createAgentVersion({ agentId: 'a', autonomy: 'A3', prompts: { system: 'x' }, tools: ['queryDB'], now: T0 }), /not allowed at A3/)
  })

  test('risk-integration evidence is write-once and only gates A2', () => {
    const a2 = fixture({ autonomy: 'A2', tools: [...allowedTools('A2')] }).version
    assert.equal(riskIntegrationEdge(a2, { passed: false }).ok, false)
    assert.equal(riskIntegrationEdge(a2, { passed: true, tests: [] }).ok, false)
    const stamped = riskIntegrationEdge(a2, { passed: true, tests: ['test:risk'], at: T0 + 1 })
    assert.equal(stamped.ok, true)
    if (stamped.ok) {
      assert.equal(stamped.doc.riskIntegration.passed, true)
      assert.deepEqual(stamped.doc.riskIntegration.tests, ['test:risk'])
      assert.equal(riskIntegrationEdge(stamped.doc, { passed: true, tests: ['again'] }).ok, false)
    }
    // evidence is an A2 gate only — an A1 version cannot claim it
    assert.equal(riskIntegrationEdge(fixture().version, { passed: true, tests: ['x'] }).ok, false)
  })
})

describe('action schema — explicit, session-bound, idempotent', () => {
  test('every action needs an actionId and an idempotency key', () => {
    assert.equal(validateAction(null).ok, false)
    assert.equal(validateAction({ type: 'advice' }).ok, false)
    assert.equal(validateAction({ actionId: 'a1', type: 'nope', idempotencyKey: 'k'.repeat(9) }).ok, false)
    const short = validateAction({ actionId: 'a1', type: 'advice', idempotencyKey: 'x'.repeat(MIN_IDEMPOTENCY_KEY - 1) })
    assert.equal(short.ok, false)
    if (!short.ok) assert.equal(short.code, 'IDEMPOTENCY_REQUIRED')
  })

  test('order actions carry a sessionId; advice/proposal need none', () => {
    for (const type of ORDER_ACTIONS) {
      const res = validateAction({ actionId: 'a1', type, idempotencyKey: 'k'.repeat(9) })
      assert.equal(res.ok, false, type)
      if (!res.ok) assert.equal(res.code, 'SESSION_REQUIRED')
    }
    assert.equal(validateAction({ actionId: 'a1', type: 'proposal', idempotencyKey: 'k'.repeat(9) }).ok, true)
    assert.equal(validateAction({ actionId: 'a1', type: 'advice', idempotencyKey: 'k'.repeat(9) }).ok, true)
  })

  test('a validated action is normalized (payload object, epoch time)', () => {
    const res = validateAction({ actionId: ' a1 ', type: 'advice', idempotencyKey: ' 12345678 ', payload: 'nope', at: T0 })
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.equal(res.action.actionId, 'a1')
      assert.equal(res.action.idempotencyKey, '12345678')
      assert.deepEqual(res.action.payload, {})
      assert.equal(res.action.at, T0)
    }
  })

  test('ACTION_RANK keeps the ladder honest', () => {
    assert.equal(ACTION_RANK.advice, 0)
    assert.equal(ACTION_RANK.proposal, 1)
    for (const a of ORDER_ACTIONS) assert.equal(ACTION_RANK[a], 2)
    assert.deepEqual([...AGENT_ACTIONS], ['advice', 'proposal', 'place-order', 'cancel-order', 'close-position'])
  })
})

describe('authorizeAction — the single decision point', () => {
  const runningSession = { sessionId: 'ses_1', state: 'running' }

  test('only an active agent with its ACTIVE version may act', () => {
    const { agent, version: v } = fixture()
    const advice = validateAction({ actionId: 'a1', type: 'advice', idempotencyKey: 'k'.repeat(9) })
    assert.ok(advice.ok)

    assert.equal(authorizeAction({ agent: { ...agent, state: 'paused' }, version: v, action: advice.action }).ok, false)
    const stale = authorizeAction({ agent: { ...agent, activeVersionId: 'other' }, version: v, action: advice.action })
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.equal(stale.code, 'VERSION_NOT_ACTIVE')
    const foreign = authorizeAction({ agent, version: { ...v, agentId: 'someone-else' }, action: advice.action })
    assert.equal(foreign.ok, false)
    if (!foreign.ok) assert.equal(foreign.code, 'VERSION_MISMATCH')
    assert.equal(authorizeAction({ agent, version: v, action: advice.action }).ok, true)
  })

  test('A0 may advise but never propose an order', () => {
    const { agent, version: v } = fixture({ autonomy: 'A0', tools: [] })
    const advice = validateAction({ actionId: 'a1', type: 'advice', idempotencyKey: 'k'.repeat(9) })
    const proposal = validateAction({ actionId: 'a2', type: 'proposal', idempotencyKey: 'k'.repeat(9) })
    assert.ok(advice.ok && proposal.ok)
    assert.equal(authorizeAction({ agent, version: v, action: advice.action }).ok, true)
    const denied = authorizeAction({ agent, version: v, action: proposal.action })
    assert.equal(denied.ok, false)
    if (!denied.ok) assert.equal(denied.code, 'ACTION_NOT_ALLOWED')
  })

  test('an A1 version without proposeOrder in its allowlist cannot propose', () => {
    const { agent, version: v } = fixture({ tools: ['queryDB'] })
    const proposal = validateAction({ actionId: 'a1', type: 'proposal', idempotencyKey: 'k'.repeat(9) })
    assert.ok(proposal.ok)
    const res = authorizeAction({ agent, version: v, action: proposal.action })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.code, 'TOOL_NOT_DECLARED')
  })

  test('A3/A4 can never be authorized, whatever the stored version claims', () => {
    for (const level of ['A3', 'A4']) {
      // A record may exist at a disabled level; no action may ever pass.
      const { agent, version: v } = fixture({ autonomy: level, tools: [] })
      assert.equal(v.autonomy, level)
      const advice = validateAction({ actionId: 'a1', type: 'advice', idempotencyKey: 'k'.repeat(9) })
      assert.ok(advice.ok)
      const res = authorizeAction({ agent, version: v, action: advice.action })
      assert.equal(res.ok, false, level)
      if (!res.ok) assert.equal(res.code, 'LEVEL_DISABLED')
    }
  })

  test('an order needs a session, a running session and a gate approval', () => {
    const { agent, version: v } = a2Fixture()
    const action = validateAction({ actionId: 'a1', type: 'place-order', idempotencyKey: 'k'.repeat(9), sessionId: 'ses_1' })
    assert.ok(action.ok)

    // no session doc
    const noSession = authorizeAction({ agent, version: v, action: action.action })
    assert.equal(noSession.ok, false)
    if (!noSession.ok) assert.equal(noSession.code, 'SESSION_NOT_FOUND')

    // session not running
    const notRunning = authorizeAction({ agent, version: v, action: action.action, session: { sessionId: 'ses_1', state: 'paused' }, riskDecision: { ok: true, code: 'OK' } })
    assert.equal(notRunning.ok, false)
    if (!notRunning.ok) assert.equal(notRunning.code, 'SESSION_NOT_RUNNING')

    // running session, but no Risk Gate decision (D7)
    const noGate = authorizeAction({ agent, version: v, action: action.action, session: runningSession })
    assert.equal(noGate.ok, false)
    if (!noGate.ok) assert.equal(noGate.code, 'RISK_DECISION_REQUIRED')

    // gate DENIED — a denied decision is not an approval
    const denied = authorizeAction({ agent, version: v, action: action.action, session: runningSession, riskDecision: { ok: false, code: 'MAX_POSITIONS' } })
    assert.equal(denied.ok, false)
    if (!denied.ok) assert.equal(denied.code, 'RISK_DECISION_REQUIRED')

    // everything present -> allowed
    const allowed = authorizeAction({ agent, version: v, action: action.action, session: runningSession, riskDecision: { ok: true, code: 'OK' } })
    assert.equal(allowed.ok, true)
    if (allowed.ok) assert.equal(allowed.order, true)
  })

  test('A2 without recorded evidence still cannot order', () => {
    // riskIntegration untouched — the level is enabled but not proven
    const { agent, version: v } = fixture({ autonomy: 'A2', tools: [...allowedTools('A2')] })
    const action = validateAction({ actionId: 'a1', type: 'place-order', idempotencyKey: 'k'.repeat(9), sessionId: 'ses_1' })
    assert.ok(action.ok)
    const res = authorizeAction({ agent, version: v, action: action.action, session: runningSession, riskDecision: { ok: true, code: 'OK' } })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.code, 'RISK_INTEGRATION_REQUIRED')
  })

  test('a tampered version cannot act (hash guard runs first)', () => {
    const { agent, version: v } = fixture()
    const action = validateAction({ actionId: 'a1', type: 'advice', idempotencyKey: 'k'.repeat(9) })
    assert.ok(action.ok)
    const res = authorizeAction({ agent, version: { ...v, tools: ['placeOrder'] }, action: action.action })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.code, 'VERSION_TAMPERED')
  })

  test('the edge table has no edge out of a terminal state', () => {
    for (const s of AGENT_STATES) {
      const edges = AGENT_EDGES[s as keyof typeof AGENT_EDGES] ?? []
      assert.equal(edges.length === 0, AGENT_TERMINAL_STATES.includes(s))
    }
  })
})

describe('aiAgentsHttpError — HTTP mapping (endpoints only map, never decide)', () => {
  test('AgentError keeps its codes; blocked actions map to 403', () => {
    const err = aiAgentsHttpError(new AgentError('nope', 403, 'ACTION_NOT_ALLOWED')) as {
      statusCode: number
      statusMessage: string
    }
    assert.equal(err.statusCode, 403)
    assert.equal(err.statusMessage, 'ACTION_NOT_ALLOWED')
  })

  test('h3-style errors pass through; unknown failures become 500s', () => {
    const passthrough = aiAgentsHttpError({ statusCode: 404, statusMessage: 'x', message: 'y' }) as { statusCode: number }
    assert.equal(passthrough.statusCode, 404)
    const boom = aiAgentsHttpError(new Error('boom')) as { statusCode: number; statusMessage: string }
    assert.equal(boom.statusCode, 500)
    assert.equal(boom.statusMessage, 'agent_failed')
  })
})
