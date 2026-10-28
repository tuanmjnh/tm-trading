import { aiAgentModel, aiAgentActionModel, aiProposalModel } from '../../../utils/engineModel'
import { requireOwnerId } from '~~/server/utils/owner'

// =============================================================================
//  GET /api/v1/ai-agents/stream — REALTIME AI agent state (SSE).
//
//  Server-side polls the DB every 2s and pushes a snapshot ONLY when something
//  changed (agents state/heartbeat/counts, new actions, new proposals), plus
//  a keep-alive comment when idle. Cookie-auth via the global middleware.
// =============================================================================

const POLL_MS = 2000
const IDLE_MS = 15000

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  const [Agent, Action, Proposal] = await Promise.all([
    aiAgentModel(),
    aiAgentActionModel(),
    aiProposalModel()
  ])

  if (!Agent || !Action || !Proposal) {
    event.node.res.write('data: {"agents":[],"actions":[],"proposals":[]}\n\n')
    return
  }

  let closed = false
  event.node.req.on('close', () => { closed = true })

  let lastHash = ''
  let lastPush = Date.now()

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  while (!closed) {
    try {
      const [agents, actions, proposals] = await Promise.all([
        Agent.find({ ownerId }).sort({ updatedAt: -1 }).limit(50).lean(),
        Action.find({ ownerId }).sort({ at: -1 }).limit(30).lean(),
        Proposal.find({ ownerId }).sort({ createdAt: -1 }).limit(20).lean()
      ])

      const snapshot = {
        agents: (agents as Array<Record<string, any>>).map(a => ({
          agentId: a.agentId,
          name: a.name,
          autonomy: a.autonomy,
          state: a.state,
          activeVersionId: a.activeVersionId,
          versionCount: a.versionCount,
          lastHeartbeatAt: a.lastHeartbeatAt,
          lastEventAt: a.lastEventAt,
          actionCounts: a.actionCounts
        })),
        actions: (actions as Array<Record<string, any>>).map(act => ({
          actionId: act.actionId,
          agentId: act.agentId,
          type: act.type,
          status: act.status,
          code: act.code,
          message: act.message,
          payload: act.payload,
          reason: act.reason,
          at: act.at
        })),
        proposals: (proposals as Array<Record<string, any>>).map(p => ({
          proposalId: p.proposalId,
          hypothesis: p.hypothesis,
          changes: p.changes,
          status: p.status,
          createdAt: p.createdAt
        })),
        ts: Date.now()
      }

      const hash = JSON.stringify({
        agents: snapshot.agents.map(a => `${a.agentId}:${a.state}:${a.lastHeartbeatAt}:${a.actionCounts?.allowed}`),
        actionsCount: actions.length,
        proposalsCount: proposals.length,
        lastActionId: (actions[0] as Record<string, any> | undefined)?.actionId
      })

      if (hash !== lastHash || Date.now() - lastPush > IDLE_MS) {
        lastHash = hash
        lastPush = Date.now()
        event.node.res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
      } else {
        event.node.res.write(': ping\n\n')
      }
    } catch {
      event.node.res.write(': err\n\n')
    }
    await sleep(POLL_MS)
  }
})
