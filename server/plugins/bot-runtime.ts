import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { botRuntimeStore } from '../utils/engineModel'

// =============================================================================
//  Embedded bot supervisor runtime (dev / self-host convenience).
//
//  The dashboard server ITSELF drives the supervisor loop for every owner that
//  has non-terminal instances or pending commands, so launching a bot from the
//  UI works without an external `npm run bot:worker` terminal. The loop reuses
//  the EXACT worker contract (`createBotWorker` → tick): lease + recovery +
//  command application + one paper cycle per running instance. No second order
//  path is introduced.
//
//  - Opt out with BOT_EMBEDDED=off (explicit external worker instead).
//  - Auto-disabled on serverless hosts (VERCEL) — a loop cannot outlive a
//    lambda; run `npm run bot:worker` there.
//  - The supervisor nonce is stable per process (hostname+pid), so a dev-server
//    restart adopts its own live leases instead of failing every instance.
// =============================================================================

const ACTIVE_STATES = ['queued', 'starting', 'running', 'paused', 'stopping']
const INTERVAL_MS = Math.max(5_000, Number(process.env.BOT_EMBEDDED_INTERVAL || 15_000) || 15_000)
const NONCE = process.env.BOT_SUPERVISOR_NONCE || `embedded-${process.pid}`

interface RecoveredInstance {
  instanceId: string
  from: string
  to: string
  reasonCode: string
}

interface BotWorkerLike {
  ownerId: string
  supervisorId: string
  boot(): Promise<{ ok: boolean, code?: string, recovered?: RecoveredInstance[] }>
  tick(): Promise<{ ok: boolean, code?: string, commands?: unknown, cycles?: unknown[] }>
  shutdown(): Promise<void>
}

/** A lease held by another supervisor is not an error — it is simply not ours. */
function isForeignLease(code?: string): boolean {
  return code === 'lease_held' || code === 'lease_lost' || code === 'stopped'
}

interface RuntimeModule {
  getBotRuntimeModels(): Promise<{
    BotInstance: { find(f: Record<string, unknown>): { distinct(field: string): Promise<string[]> } } | null
    BotCommand: { find(f: Record<string, unknown>): { distinct(field: string): Promise<string[]> } } | null
  } | null>
  listOwnedInstances(ownerId: string, opts?: { states?: string[], limit?: number }): Promise<Array<{
    instanceId: string
    state: string
    lease?: { supervisorId?: string | null } | null
  }>>
  transitionInstance(input: {
    ownerId: string
    instanceId: string
    from: string
    to: string
    set?: Record<string, unknown>
    now?: number
  }): Promise<boolean>
}

/** Console-shaped logger — the worker writes lifecycle lines via `log.log`. */
interface BotLogger {
  log(...a: unknown[]): void
  warn(...a: unknown[]): void
  error(...a: unknown[]): void
}

interface BotWorkerModule {
  createBotWorker(opts: { ownerId: string, nonce: string, log?: BotLogger }): BotWorkerLike
  releaseSupervisorLease(opts: { ownerId: string, supervisorId: string }): Promise<{ ok?: boolean }>
}

interface HeartbeatModule {
  beat(name: string, patch: Record<string, unknown>): unknown
  readHeartbeat(): { services?: Record<string, { count?: number }> }
}

let workerModule: BotWorkerModule | null = null
async function loadWorkerModule(): Promise<BotWorkerModule | null> {
  workerModule ??= await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'services', 'botWorker.mjs')).href) as BotWorkerModule
  return workerModule
}

// -----------------------------------------------------------------------------
//  D9 heartbeat: this process IS the bot worker when it drives the loop, so it
//  must beat like `tools/bot-worker.mjs` does. Without it the dashboard would
//  report a phantom "bot-worker overdue" while bots are in fact being ticked.
//  Best effort only — a heartbeat write can never affect supervision.
// -----------------------------------------------------------------------------
let heartbeatModule: HeartbeatModule | null = null
async function loadHeartbeatModule(): Promise<HeartbeatModule | null> {
  heartbeatModule ??= await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'services', 'heartbeat.mjs')).href) as HeartbeatModule
  return heartbeatModule
}

const INTERVAL_SEC = Math.max(5, Math.round(INTERVAL_MS / 1000))
let beats: number | null = null
async function beat(patch: Record<string, unknown>): Promise<void> {
  try {
    const mod = await loadHeartbeatModule()
    if (!mod) return
    if (beats === null) beats = Number(mod.readHeartbeat()?.services?.['bot-worker']?.count) || 0
    const next = patch.lastOkAt ? beats + 1 : beats
    mod.beat('bot-worker', { intervalSec: INTERVAL_SEC, ...patch, count: next })
    beats = next
  } catch { /* heartbeat is best effort */ }
}

const drivers = new Map<string, BotWorkerLike>()

export default defineNitroPlugin((nitro) => {
  if (process.env.BOT_EMBEDDED === 'off' || process.env.VERCEL) return

  // Console-shaped: the worker logs lifecycle lines with `log.log`, so a
  // warn-only logger would throw mid-tick (start command -> session open).
  const log: BotLogger = {
    log: (...a: unknown[]) => console.log('[bot-runtime]', ...a),
    warn: (...a: unknown[]) => console.warn('[bot-runtime]', ...a),
    error: (...a: unknown[]) => console.error('[bot-runtime]', ...a)
  }
  console.log(`[bot-runtime] embedded supervisor enabled (nonce=${NONCE}, interval=${INTERVAL_SEC}s)`)

  /** One-shot so an idle supervisor is visible without spamming the log. */
  let idleLogged = false
  /** Only log a change in failure count — the sweep runs every 15s. */
  let lastFailureCount = 0

  async function sweep(): Promise<void> {
    try {
      const store = await botRuntimeStore() as unknown as RuntimeModule
      const m = await store.getBotRuntimeModels()
      // Store unavailable -> no beat at all: an overdue heartbeat is the honest
      // signal, because a live process that cannot supervise is not healthy.
      if (!m?.BotInstance || !m.BotCommand) {
        if (!idleLogged) {
          idleLogged = true
          log.warn('store unavailable — supervisor idle (instances keep their last recorded state)')
        }
        return
      }
      idleLogged = false

      const [instanceOwners, commandOwners] = await Promise.all([
        m.BotInstance.find({ state: { $in: ACTIVE_STATES } }).distinct('ownerId'),
        m.BotCommand.find({ status: 'pending' }).distinct('ownerId')
      ])
      const owners = [...new Set([...instanceOwners, ...commandOwners].filter(Boolean).map(String))]
      const mod = await loadWorkerModule()
      if (!mod) return

      const failures: string[] = []
      for (const ownerId of owners) {
        let worker = drivers.get(ownerId)
        if (!worker) {
          worker = mod.createBotWorker({ ownerId, nonce: NONCE, log }) as BotWorkerLike
          drivers.set(ownerId, worker)
          // Boot ONCE per driver, exactly like tools/bot-worker.mjs: claim the
          // owner lease, then fail instances whose lease died with a previous
          // supervisor. Skipping this leaves an orphaned instance reporting
          // `running` while tick() ignores it forever — tick only drives
          // instances leased to THIS supervisor id.
          const boot = await worker.boot().catch((e: unknown): { ok: boolean, code?: string, recovered?: RecoveredInstance[] } => ({ ok: false, code: `boot:${String((e as Error)?.message ?? e).slice(0, 120)}` }))
          if (!boot.ok) {
            drivers.delete(ownerId)
            if (!isForeignLease(boot.code)) failures.push(`boot ${ownerId}:${boot.code}`)
            continue
          }
          if (boot.recovered?.length) log.warn(`recovered ${boot.recovered.length} orphaned instance(s)`, boot.recovered.map(r => `${r.instanceId}:${r.reasonCode}`).join(', '))
        }
        // Finish our own stranded `stopping` runs. An in-process reload can move
        // a run to `stopping` and die before completing it, and tick() only ever
        // drives `running` instances — so nothing else could close it and the UI
        // would show a phantom "stopping" forever. `stopping -> completed` is the
        // only legal edge, and a foreign supervisor's run is left alone.
        const stalled = await store.listOwnedInstances(ownerId, { states: ['stopping'], limit: 50 }).catch(() => [])
        for (const inst of stalled) {
          const leaseOwner = inst?.lease?.supervisorId ?? null
          if (leaseOwner && leaseOwner !== worker.supervisorId) continue
          const closed = await store.transitionInstance({
            ownerId,
            instanceId: inst.instanceId,
            from: 'stopping',
            to: 'completed',
            set: { health: 'unknown', 'lease.supervisorId': null, 'lease.beatAt': null, 'lease.expiresAt': null },
            now: Date.now()
          }).catch(() => false)
          if (!closed) log.warn(`could not close stranded instance ${inst.instanceId}`)
        }
        // tick() claims/renews the owner lease itself; a lease that is not ours
        // (another supervisor took over, or the CLI worker is running) drops the
        // in-process driver so the next sweep re-boots instead of spinning.
        const res = await worker.tick().catch((e: unknown) => ({ ok: false, code: `tick:${String((e as Error)?.message ?? e).slice(0, 120)}` }))
        if (!res.ok) {
          if (isForeignLease(res.code)) drivers.delete(ownerId)
          else failures.push(`tick ${ownerId}:${res.code}`)
        }
      }

      if (failures.length) {
        const error = failures.join(', ').slice(0, 200)
        await beat({ lastErrorAt: new Date().toISOString(), lastError: error, lastSummary: `owners=${owners.length}` })
        if (failures.length !== lastFailureCount) log.warn('supervisor tick failed:', error)
        lastFailureCount = failures.length
      } else {
        lastFailureCount = 0
        await beat({ lastOkAt: new Date().toISOString(), lastSummary: `owners=${owners.length}` })
      }
    } catch (e) {
      await beat({ lastErrorAt: new Date().toISOString(), lastError: String((e as Error)?.message ?? e).slice(0, 200) })
      log.warn('sweep failed:', (e as Error)?.message ?? e)
    }
  }

  const timer = setInterval(() => { void sweep() }, INTERVAL_MS)
  // First sweep shortly after boot (instances queued before the restart).
  const bootTimer = setTimeout(() => { void sweep() }, 3_000)

  // ---------------------------------------------------------------------------
  //  Graceful stop: the bots are driven by THIS process, so when the dashboard
  //  server exits (Ctrl+C, SIGTERM, dev restart) its bots must exit with it —
  //  otherwise the UI would show phantom RUNNING rows until the lease expires.
  //  worker.shutdown() stops running/starting instances, completes paused ones
  //  and releases the owner lease. Guarded once (close hook + signals may both
  //  fire); the exit handler caps the wait so shutdown cannot hang the process.
  // ---------------------------------------------------------------------------
  let stopping = false
  async function gracefulStop(): Promise<void> {
    if (stopping) return
    stopping = true
    clearInterval(timer)
    clearTimeout(bootTimer)
    const mod = workerModule ?? await loadWorkerModule().catch(() => null)
    if (!mod) return
    for (const worker of drivers.values()) {
      try {
        await worker.shutdown()
      } catch (e) {
        log.warn(`shutdown ${worker.ownerId}:`, (e as Error)?.message ?? e)
      }
    }
    drivers.clear()
  }

  nitro.hooks.hook('close', () => { void gracefulStop() })

  const exitHandler = () => {
    if (stopping) return
    void gracefulStop().finally(() => process.exit(0))
    // Hard cap: never let the shutdown DB work block Ctrl+C for long.
    setTimeout(() => process.exit(0), 8_000).unref()
  }
  process.once('SIGINT', exitHandler)
  process.once('SIGTERM', exitHandler)
})
