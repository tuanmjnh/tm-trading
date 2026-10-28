// services/botWorker.mjs
// =============================================================================
//  PER-USER BOT SUPERVISOR WORKER (roadmap §61.7 / §61.17 Phase E)
//
//  One logical supervisor per owner. The worker:
//    - holds the owner lease (exclusive across processes/hosts),
//    - recovers orphaned instances on boot (dead lease -> failed),
//    - applies durable commands exactly once (engine/botSupervisor.mjs policy),
//    - drives the EXISTING paper executor (exec/paper.mjs) for its running
//      instances — no second order/fill path,
//    - beats the instance lease + the shared file heartbeat.
//
//  Deliberate limits (documented, not hidden):
//    - one active instance per (owner, account): the paper executor is
//      account-wide, so two instances on one account would double-subscribe.
//      A start command is rejected with `account_busy` instead.
//    - a worker that restarts with a DIFFERENT supervisor id cannot adopt a
//      live lease; it waits for expiry and boot recovery fails the run. Set a
//      stable BOT_SUPERVISOR_NONCE (hostname by default) to adopt on restart.
// =============================================================================
import { ENGINE_VERSION } from '../engine/version.mjs'
import {
  LEASE_TTL_MS,
  evaluateHealth,
  heartbeatPatch,
  supervisorId as supervisorKey,
  validateCommand,
} from '../engine/botSupervisor.mjs'
import { appendEvent as appendSessionEvent, transition as transitionSession } from '../engine/session.mjs'
import { bridgeSignalsForInstance, symbolVariants } from './botSignalBridge.mjs'
import { evaluateInstanceSignals } from './botMethodDriver.mjs'
import {
  attachInstanceLease,
  beatInstance,
  claimSupervisorLease,
  findOwnedInstance,
  listOwnedInstances,
  listPendingCommands,
  markCommandApplied,
  markCommandRejected,
  recoverOwnedInstances,
  releaseSupervisorLease,
  renewSupervisorLease,
  transitionInstance,
} from './botRuntimeStore.mjs'

const ACTIVE_STATES = ['starting', 'running', 'paused']
const MAX_LAG_MS = Number(process.env.BOT_MAX_LAG_MS || 60_000)

// A freshly created session is `queued` (engine/session.mjs). Driving it to
// RUNNING — and later to COMPLETED — must respect the guarded edges, so the
// worker walks the path instead of writing a state directly.
const SESSION_OPEN_PATH = Object.freeze({
  queued: ['starting', 'running'],
  starting: ['running'],
  running: [],
  paused: ['running'],
})
const SESSION_CLOSE_PATH = Object.freeze({
  queued: ['starting', 'running', 'stopping', 'completed'],
  starting: ['running', 'stopping', 'completed'],
  running: ['stopping', 'completed'],
  paused: ['stopping', 'completed'],
  stopping: ['completed'],
})

let modelsMemo = null

/** Same model set the paper executor uses (one executor, one book). */
async function runtimeModels() {
  if (modelsMemo) return modelsMemo
  const { connectMongo } = await import('../engine/db.mjs')
  const conn = await connectMongo()
  if (!conn) return null
  const m = await import('../engine/models/index.mjs')
  modelsMemo = {
    Alert: m.Alert,
    Position: m.Position,
    PaperOrder: m.PaperOrder,
    PaperFill: m.PaperFill,
    PaperAccount: m.PaperAccount,
    Snapshot: m.Snapshot,
    Signal: m.Signal,
    TradeContext: m.TradeContext,
    TradingSession: m.TradingSession,
    TradingDomainEvent: m.TradingDomainEvent,
  }
  return modelsMemo
}

async function paperRuntime() {
  return import('../exec/paper.mjs')
}

async function riskRuntime() {
  return import('../exec/risk.mjs')
}

function accountOf(instance) {
  return instance?.accountId == null || instance.accountId === '' ? 'default' : String(instance.accountId)
}

/**
 * Create a supervisor worker. Pure wiring: no timers here, the caller owns the
 * loop (tools/bot-worker.mjs) so tests can drive ticks deterministically.
 */
export function createBotWorker({
  ownerId,
  nonce = '',
  ttlMs = LEASE_TTL_MS,
  maxLagMs = MAX_LAG_MS,
  now = () => Date.now(),
  log = console,
} = {}) {
  if (!ownerId) throw new Error('createBotWorker: ownerId is required')
  const supervisorId = supervisorKey(ownerId, nonce)
  let claimed = false
  let stopped = false
  const activeSessions = new Map() // accountId -> sessionId

  async function claimOrRenew() {
    if (!claimed) {
      const res = await claimSupervisorLease({ ownerId, supervisorId, now: now(), ttlMs, engineVersion: ENGINE_VERSION })
      if (!res.ok) return res
      claimed = true
      return res
    }
    const res = await renewSupervisorLease({ ownerId, supervisorId, now: now(), ttlMs })
    if (!res.ok) claimed = false
    return res
  }

  /** Claim the owner lease, then fail orphaned instances. */
  async function boot() {
    const lease = await claimOrRenew()
    if (!lease.ok) return lease
    const recovered = await recoverOwnedInstances({ ownerId, now: now(), ttlMs })
    if (recovered.length) {
      log.warn(`[bot-worker] recovered ${recovered.length} orphaned instance(s): ${recovered.map((r) => `${r.instanceId}:${r.reasonCode}`).join(', ')}`)
    }
    return { ok: true, recovered }
  }

  // ---------------------------------------------------------------------------
  //  Commands
  // ---------------------------------------------------------------------------

  async function reject(cmd, code, message = null) {
    await markCommandRejected({ ownerId, commandId: cmd.commandId, supervisorId, reasonCode: code, message, now: now() })
    log.warn(`[bot-worker] command ${cmd.commandId} rejected: ${code}`)
    return { ok: false, code }
  }

  async function ensureAccountFree(instance) {
    const account = accountOf(instance)
    const active = await listOwnedInstances(ownerId, { states: ACTIVE_STATES, limit: 500, includeDemo: true })
    const other = active.find((i) => i.instanceId !== instance.instanceId && accountOf(i) === account)
    return other ? { ok: false, code: 'account_busy', instanceId: other.instanceId } : { ok: true }
  }

  async function startInstance(instance) {
    const free = await ensureAccountFree(instance)
    if (!free.ok) return free

    const m = await runtimeModels()
    if (!m) return { ok: false, code: 'mongo_down' }

    await attachInstanceLease({ ownerId, instanceId: instance.instanceId, supervisorId, now: now(), ttlMs })
    const from = String(instance.state)
    if (from === 'queued') {
      const moved = await transitionInstance({ ownerId, instanceId: instance.instanceId, from, to: 'starting', now: now() })
      if (!moved) return { ok: false, code: 'state_changed' }
    }

    const paper = await paperRuntime()
    const risk = await riskRuntime()
    const account = accountOf(instance)
    const cfg = { ...risk.loadRiskConfig(), ownerId, account, execution: instance.execution ?? null }
    // Phase F: the session manifest names the instance, its immutable strategy
    // version and its data source, so the evidence of a bot run is traceable to
    // the bot that produced it.
    const identity = {
      source: 'bot',
      purpose: 'bot-instance',
      engineVersion: instance.engineVersion ?? ENGINE_VERSION,
      strategyVersionId: instance.strategyVersionId ?? null,
      paramsHash: instance.strategyFingerprint ?? null,
      method: instance?.source?.method ?? null,
      instruments: instance.instruments ?? [],
      timeframes: instance.timeframes ?? [],
      instanceId: instance.instanceId,
      botProfileId: instance.botProfileId ?? null,
      dataSource: 'venue-rest',
      datasetIds: instance?.source?.datasetIds ?? (instance?.source?.datasetId ? [instance.source.datasetId] : []),
    }
    let sessionId = null
    try {
      sessionId = await paper.resolvePaperSession(m, cfg, { watch: true, identity })
    } catch (e) {
      sessionId = null
      log.warn(`[bot-worker] session start failed: ${e?.message || e}`)
    }

    if (!sessionId) {
      await transitionInstance({
        ownerId,
        instanceId: instance.instanceId,
        from: 'starting',
        to: 'failed',
        set: { health: 'error', healthReason: 'session_failed', stoppedAt: now() },
        now: now(),
      })
      return { ok: false, code: 'session_failed' }
    }

    // A fresh session starts as `queued`; drive it to RUNNING through the
    // guarded edges before the instance is exposed as RUNNING (§61.7).
    await driveSession(sessionId, SESSION_OPEN_PATH)

    const started = await transitionInstance({
      ownerId,
      instanceId: instance.instanceId,
      from: 'starting',
      to: 'running',
      set: {
        sessionId,
        health: 'ok',
        healthReason: null,
        startedAt: now(),
        engineVersion: ENGINE_VERSION,
        'lease.supervisorId': supervisorId,
        'lease.beatAt': now(),
        'lease.expiresAt': now() + ttlMs,
      },
      now: now(),
    })
    if (!started) return { ok: false, code: 'state_changed' }
    activeSessions.set(account, sessionId)
    log.log(`[bot-worker] ${instance.instanceId} running (session ${sessionId})`)
    return { ok: true }
  }

  async function pauseInstance(instance) {
    const moved = await transitionInstance({
      ownerId,
      instanceId: instance.instanceId,
      from: String(instance.state),
      to: 'paused',
      set: { health: 'unknown' },
      now: now(),
    })
    return moved ? { ok: true } : { ok: false, code: 'state_changed' }
  }

  async function resumeInstance(instance) {
    const moved = await transitionInstance({
      ownerId,
      instanceId: instance.instanceId,
      from: 'paused',
      to: 'running',
      set: { health: 'ok', healthReason: null },
      now: now(),
    })
    return moved ? { ok: true } : { ok: false, code: 'state_changed' }
  }

  /**
   * Walk a session along the guarded path table and persist the new state in
   * one write. Returns the final document (or null when the session is gone).
   */
  async function driveSession(sessionId, pathTable, reason = null) {
    const m = await runtimeModels()
    if (!m || !sessionId) return null
    try {
      const found = await m.TradingSession.findOne({ sessionId }).lean()
      if (!found) return null
      let doc = found
      for (const to of pathTable[found.state] || []) {
        const res = transitionSession(doc, to, { at: now(), reason })
        if (!res.ok) break
        doc = res.doc
      }
      await m.TradingSession.updateOne(
        { sessionId },
        {
          $set: {
            state: doc.state,
            startedAt: doc.startedAt ?? null,
            stoppedAt: doc.stoppedAt ?? null,
            timeline: doc.timeline,
            timelineDropped: doc.timelineDropped,
            lastEventAt: doc.lastEventAt,
          },
        },
      )
      return doc
    } catch (e) {
      log.warn(`[bot-worker] session drive failed: ${e?.message || e}`)
      return null
    }
  }

  /** Finalize the instance's session through the guarded state machine. */
  async function closeSession(sessionId, reasonCode) {
    if (!sessionId) return
    const doc = await driveSession(sessionId, SESSION_CLOSE_PATH, reasonCode)
    if (!doc) return
    const m = await runtimeModels()
    try {
      const withEvent = appendSessionEvent(doc, { t: now(), kind: 'stopped', message: `bot instance stopped (${reasonCode})` })
      await m.TradingSession.updateOne(
        { sessionId },
        { $set: { timeline: withEvent.timeline, timelineDropped: withEvent.timelineDropped, lastEventAt: withEvent.lastEventAt } },
      )
    } catch (e) {
      log.warn(`[bot-worker] session event failed: ${e?.message || e}`)
    }
  }

  async function stopInstance(instance) {
    const account = accountOf(instance)
    const sid = instance.sessionId || activeSessions.get(account) || null
    const moved = await transitionInstance({
      ownerId,
      instanceId: instance.instanceId,
      from: String(instance.state),
      to: 'stopping',
      set: { stoppedAt: now() },
      now: now(),
    })
    if (!moved) return { ok: false, code: 'state_changed' }

    await closeSession(sid, 'instance_stopped')
    activeSessions.delete(account)

    await transitionInstance({
      ownerId,
      instanceId: instance.instanceId,
      from: 'stopping',
      to: 'completed',
      set: {
        health: 'unknown',
        'lease.supervisorId': null,
        'lease.beatAt': null,
        'lease.expiresAt': null,
      },
      now: now(),
    })
    return { ok: true }
  }

  /**
   * Apply pending commands in request order. Ownership is re-read from the DB
   * (never trusted from the command row) and the transition is conditional.
   */
  async function applyPendingCommands() {
    const commands = await listPendingCommands(ownerId, 200)
    const results = []
    for (const cmd of commands) {
      const instance = await findOwnedInstance(ownerId, cmd.instanceId)
      const verdict = validateCommand({
        instance,
        command: cmd.type,
        commandId: cmd.commandId,
        ownerId,
        accountId: cmd.accountId,
      })
      if (!verdict.ok) {
        results.push(await reject(cmd, verdict.code))
        continue
      }
      if (verdict.noop) {
        await markCommandApplied({ ownerId, commandId: cmd.commandId, supervisorId, now: now() })
        results.push({ ok: true, noop: true })
        continue
      }

      let result
      if (cmd.type === 'start') result = await startInstance(instance)
      else if (cmd.type === 'pause') result = await pauseInstance(instance)
      else if (cmd.type === 'resume') result = await resumeInstance(instance)
      else if (cmd.type === 'stop') result = await stopInstance(instance)
      else result = { ok: false, code: 'unknown_command' }

      if (result.ok) {
        await markCommandApplied({ ownerId, commandId: cmd.commandId, supervisorId, now: now() })
      } else {
        await markCommandRejected({
          ownerId,
          commandId: cmd.commandId,
          supervisorId,
          reasonCode: result.code || 'apply_failed',
          now: now(),
        })
      }
      results.push(result)
    }
    return results
  }

  // ---------------------------------------------------------------------------
  //  Tick
  // ---------------------------------------------------------------------------

  /**
   * One supervisor tick: renew the owner lease, apply commands, run one paper
   * cycle per running instance and beat it. Returns a structured summary.
   */
  async function tick() {
    if (stopped) return { ok: false, code: 'stopped' }
    const lease = await claimOrRenew()
    if (!lease.ok) return lease
    if (!claimed) return { ok: false, code: 'lease_lost' }

    const commands = await applyPendingCommands()

    const m = await runtimeModels()
    if (!m) return { ok: false, code: 'mongo_down', commands }

    const paper = await paperRuntime()
    const risk = await riskRuntime()
    const running = await listOwnedInstances(ownerId, { states: ['running'], limit: 100 })
    const cycles = []

    for (const instance of running) {
      if (instance.lease?.supervisorId !== supervisorId) continue
      const account = accountOf(instance)

      // E2: LIVE method evaluation — closed candles -> method analyze() ->
      // native signals (D4 idempotent). Runs BEFORE the bridge so a signal
      // born this tick is bridged the same tick.
      let evalInfo = { ok: false, published: 0, code: 'skipped' }
      try {
        evalInfo = await evaluateInstanceSignals({ instance, models: m, now: now() })
      } catch (e) {
        log.warn(`[bot-worker] method eval ${instance.instanceId}: ${e?.message || e}`)
      }

      // E4: turn new native signals into `source:'bot'` alerts BEFORE the cycle
      // so the same tick can execute them through the shared paper path.
      const bridge = await bridgeSignalsForInstance({ instance, models: m })
      const cfg = { ...risk.loadRiskConfig(), ownerId, account, execution: instance.execution ?? null }
      let sessionId = instance.sessionId || activeSessions.get(account) || null
      if (!sessionId) {
        try {
          sessionId = await paper.resolvePaperSession(m, cfg, { watch: true })
          if (sessionId) activeSessions.set(account, sessionId)
        } catch {
          sessionId = null
        }
      }

      const stats = await paper
        .runCycle(cfg, sessionId ? { sessionId } : {})
        .catch((e) => ({ errors: 1, error: String(e?.message || e) }))

      const subs = Array.isArray(instance.subscriptions) && instance.subscriptions.length
        ? instance.subscriptions
        : (instance.instruments || [])
      const allSyms = [...new Set(subs.flatMap(symbolVariants))]

      // Metrics rollup for live monitoring and UI reporting
      const [signalsCount, ordersCount, positions] = await Promise.all([
        m.Signal && allSyms.length ? m.Signal.countDocuments({ ownerId, symbol: { $in: allSyms } }).catch(() => 0) : 0,
        m.PaperOrder ? m.PaperOrder.countDocuments({ ownerId, $or: [{ account }, { accountId: account }] }).catch(() => 0) : 0,
        m.Position ? m.Position.find({ ownerId, $or: [{ account }, { accountId: account }] }).lean().catch(() => []) : [],
      ])

      let realizedPnl = 0
      let unrealizedPnl = 0

      let quoteFor = () => null
      try {
        const { getMarketPlane } = await import('../server/utils/market-plane.ts').catch(() => ({}))
        if (getMarketPlane) {
          const plane = await getMarketPlane()
          const rows = plane.quoteStore.all()
          const bySym = new Map()
          for (const r of rows) {
            const clean = String(r.symbol || '').replace(/\.P$/i, '').toUpperCase()
            bySym.set(clean, r)
            bySym.set(`${clean}.P`, r)
          }
          quoteFor = (sym) => {
            const clean = String(sym || '').replace(/\.P$/i, '').toUpperCase()
            return bySym.get(sym) || bySym.get(clean) || bySym.get(`${clean}.P`) || null
          }
        }
      } catch { /* plane lookup fail-soft */ }

      for (const p of positions) {
        if (p.status === 'open') {
          let u = Number(p.live?.unrealized)
          if (!Number.isFinite(u)) {
            const q = quoteFor(p.symbol)
            if (q) {
              const mark = p.dir === 1 ? (q.bid || q.last) : (q.ask || q.last)
              if (mark && p.entryPrice && p.qty) {
                const gross = (mark - p.entryPrice) * p.dir * p.qty
                u = gross - (p.fees || 0)
              }
            }
          }
          unrealizedPnl += Number(Number.isFinite(u) ? u : (p.pnlAbs ?? 0))
        } else {
          realizedPnl += Number(p.pnlAbs ?? 0)
        }
      }
      const totalPnl = Number((realizedPnl + unrealizedPnl).toFixed(2))
      const baseCapital = Number(instance.initialCapital) || 10000
      const currentEquity = Number((baseCapital + totalPnl).toFixed(2))

      const health = evaluateHealth({
        mongoDown: Boolean(stats?.mongoDown),
        lastError: stats?.errors ? 'cycle_errors' : null,
        lagMs: 0,
        maxLagMs,
      })
      const patch = heartbeatPatch({
        now: now(),
        health: health.health,
        healthReason: health.reasonCode,
        engineVersion: ENGINE_VERSION,
        subscriptions: instance.subscriptions || [],
        lastSignalKey: instance.lastSignalKey,
        counts: {
          signals: signalsCount,
          orders: ordersCount,
          trades: positions.length,
        },
        paperEquity: currentEquity,
        paperPnl: totalPnl,
      })
      if (sessionId) patch.sessionId = sessionId
      // The signal cursor only advances after the alerts were queued, so a
      // crash between insert and beat re-reads and dedupes instead of dropping.
      if (bridge?.ok) {
        patch.lastSignalKey = bridge.lastSignalKey ?? instance.lastSignalKey ?? null
        patch.lastSignalTs = bridge.lastSignalTs ?? instance.lastSignalTs ?? null
      }
      const beat = await beatInstance({ ownerId, instanceId: instance.instanceId, supervisorId, patch, now: now(), ttlMs })
      if (!beat) log.warn(`[bot-worker] lost lease on ${instance.instanceId}`)

      cycles.push({
        instanceId: instance.instanceId,
        account,
        sessionId,
        health: health.health,
        signals: { queued: bridge?.queued ?? 0, skipped: bridge?.skipped ?? 0 },
        eval: { ok: evalInfo.ok, published: evalInfo.published, code: evalInfo.code ?? null },
        stats: { opened: stats?.opened ?? 0, closed: stats?.closed ?? 0, rejected: stats?.rejected ?? 0, errors: stats?.errors ?? 0 },
      })
    }

    return { ok: true, commands, cycles }
  }

  /** Graceful shutdown: complete this supervisor's running instances. */
  async function shutdown() {
    stopped = true
    const active = await listOwnedInstances(ownerId, { states: ACTIVE_STATES, limit: 200, includeDemo: true })
    for (const instance of active) {
      if (instance.lease?.supervisorId !== supervisorId) continue
      try {
        if (instance.state === 'running' || instance.state === 'starting') {
          await stopInstance(instance)
        } else {
          await transitionInstance({
            ownerId,
            instanceId: instance.instanceId,
            from: instance.state,
            to: 'completed',
            set: { stoppedAt: now(), 'lease.supervisorId': null, 'lease.beatAt': null, 'lease.expiresAt': null },
            now: now(),
          })
        }
      } catch (e) {
        log.warn(`[bot-worker] shutdown ${instance.instanceId}: ${e?.message || e}`)
      }
    }
    await releaseSupervisorLease({ ownerId, supervisorId })
    claimed = false
  }

  return {
    ownerId,
    supervisorId,
    boot,
    tick,
    shutdown,
    applyPendingCommands,
    get claimed() {
      return claimed
    },
  }
}
