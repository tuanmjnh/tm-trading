import { getQuery } from 'h3'
import { botInstanceModel } from '../../../../utils/engineModel'

// =============================================================================
//  GET /api/v1/bots/instances/stream — REALTIME bot state (SSE).
//
//  Server-side polls the DB every 2s and pushes a snapshot ONLY when something
//  changed (state/counts/health/lastEventAt), plus a keep-alive comment when
//  idle. Cookie-auth via the global middleware (EventSource sends cookies).
//
//  Payload: { instances: [...], signals: [...latest attributed bot signals...] }
//  The UI replaces its polling with this stream (D — same supervisor data, zero
//  extra order path).
// =============================================================================

const POLL_MS = 2000
const IDLE_MS = 15000

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const q = getQuery(event)
  const includeArchived = q.includeArchived === '1'

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  // Proxy-safe: never buffer the stream.
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  const BotInstance = await botInstanceModel()
  if (!BotInstance) {
    event.node.res.write('data: {"instances":[],"signals":[]}\n\n')
    return
  }

  let closed = false
  event.node.req.on('close', () => { closed = true })

  let lastHash = ''
  let lastPush = Date.now()

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  while (!closed) {
    try {
      const instances = await BotInstance
        .find({ ownerId, ...(includeArchived ? {} : { archived: { $ne: true } }) })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean()

      const snapshot = {
        instances: instances.map(i => ({
          _id: i._id,
          instanceId: i.instanceId,
          botProfileId: i.botProfileId,
          strategyVersionId: i.strategyVersionId,
          state: i.state,
          mode: i.mode,
          accountId: i.accountId || (i.source as Record<string, any>)?.accountId || null,
          source: i.source,
          timeframes: i.timeframes,
          instruments: i.instruments,
          counts: i.counts,
          health: i.health,
          healthReason: i.healthReason ?? null,
          paperEquity: i.paperEquity,
          paperPnl: i.paperPnl,
          startedAt: i.startedAt,
          lastEventAt: i.lastEventAt,
          lastError: i.lastError ?? null
        })),
        ts: Date.now()
      }

      const hash = JSON.stringify(snapshot.instances)
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
