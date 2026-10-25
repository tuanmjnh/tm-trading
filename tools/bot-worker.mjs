#!/usr/bin/env node
// =============================================================================
//  TM TRADING - BOT WORKER CLI (roadmap §61.7 / §61.17 Phase E)
//
//    node tools/bot-worker.mjs run --owner <ownerId> [--interval 60]
//                                 [--nonce <id>] [--once]
//    node tools/bot-worker.mjs status --owner <ownerId>
//    node tools/bot-worker.mjs create --owner <ownerId> [--profile <profileId>]
//                                 [--watermark-ago <minutes>]   # new instance + start
//    node tools/bot-worker.mjs command --owner <ownerId> --instance <id>
//                                 --type start|pause|resume|stop
//    node tools/bot-worker.mjs stop --owner <ownerId>
//
//  The worker is the ONLY process that transitions bot instances. It drives
//  the existing paper executor, so manual and bot orders share one book.
//  Set a stable --nonce (or BOT_SUPERVISOR_NONCE) to adopt a live lease after
//  a fast restart; a different nonce waits for the lease to expire.
// =============================================================================
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

import { loadEnv } from '../exec/env.mjs'
import { beat as heartbeatBeat, readHeartbeat, HEARTBEAT_FILE } from '../services/heartbeat.mjs'

loadEnv()

function argOf(args, name, fallback = null) {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = args[i + 1]
  return v == null || v.startsWith('--') ? fallback : v
}

function requireOwner(args) {
  const owner = argOf(args, 'owner', process.env.BOT_OWNER_ID || null)
  if (!owner) {
    console.error('bot-worker: --owner <ownerId> is required (or BOT_OWNER_ID)')
    process.exit(2)
  }
  return owner
}

async function commands(args) {
  return import('../services/botRuntimeStore.mjs')
}

async function cmdRun(args) {
  const { createBotWorker } = await import('../services/botWorker.mjs')
  const ownerId = requireOwner(args)
  const intervalSec = Math.max(5, Number(argOf(args, 'interval', process.env.BOT_INTERVAL || 60)) || 60)
  const nonce = argOf(args, 'nonce', process.env.BOT_SUPERVISOR_NONCE || hostname())
  const once = args.includes('--once')
  const worker = createBotWorker({ ownerId, nonce })

  const boot = await worker.boot()
  if (!boot.ok) {
    console.error(`bot-worker: lease not acquired (${boot.code}${boot.holderId ? `, holder=${boot.holderId}` : ''})`)
    process.exit(1)
  }
  console.log(`[bot-worker] owner=${ownerId} supervisor=${worker.supervisorId} interval=${intervalSec}s`)

  let beats = Number(readHeartbeat(HEARTBEAT_FILE).services?.['bot-worker']?.count) || 0
  const beat = (patch) => {
    try {
      heartbeatBeat('bot-worker', { intervalSec, ...patch })
    } catch { /* heartbeat is best effort */ }
  }

  const tick = async () => {
    beat({ lastRunAt: new Date().toISOString() })
    const res = await worker.tick()
    if (!res.ok) {
      beat({ lastErrorAt: new Date().toISOString(), lastError: res.code })
      console.error(`[bot-worker] tick failed: ${res.code}`)
      if (res.code === 'lease_lost' || res.code === 'lease_held') process.exit(1)
      return res
    }
    beats++
    beat({ lastOkAt: new Date().toISOString(), count: beats, lastSummary: JSON.stringify(res.cycles).slice(0, 500) })
    return res
  }

  if (once) {
    const res = await tick()
    console.log(
      `[bot-worker] once: ok=${res?.ok === true} commands=${res?.commands?.length ?? 0} cycles=${res?.cycles?.length ?? 0}`,
    )
    await worker.shutdown()
    return
  }

  let busy = false
  const loop = async () => {
    if (busy) return
    busy = true
    try {
      await tick()
    } finally {
      busy = false
    }
  }
  await loop()
  const timer = setInterval(loop, intervalSec * 1000)

  const shutdown = async (signal) => {
    clearInterval(timer)
    console.log(`\n[bot-worker] stopping (${signal})`)
    await worker.shutdown()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

async function cmdStatus(args) {
  const ownerId = requireOwner(args)
  const runtime = await import('../services/botRuntimeStore.mjs')
  const models = await runtime.getBotRuntimeModels()
  if (!models) {
    console.error('bot-worker: Mongo unavailable')
    process.exit(1)
  }
  const lease = await models.BotSupervisor.findById(
    (await import('../engine/botSupervisor.mjs')).supervisorId(ownerId),
  ).lean()
  const instances = await runtime.listOwnedInstances(ownerId, { limit: 200 })
  const pending = await runtime.listPendingCommands(ownerId, 50)
  const now = Date.now()
  console.log(`owner: ${ownerId}`)
  console.log(`lease: ${lease ? `${lease.supervisorId} (${lease.expiresAt > now ? 'live' : 'expired'})` : 'none'}`)
  console.log(`instances: ${instances.length}`)
  for (const i of instances) {
    const live = Number(i.lease?.expiresAt) > now ? 'live' : 'none'
    console.log(`  ${i.instanceId}  ${String(i.state).padEnd(9)}  health=${i.health}  account=${i.accountId ?? 'default'}  lease=${live}  session=${i.sessionId ?? '-'}`)
  }
  console.log(`pending commands: ${pending.length}`)
  for (const c of pending) console.log(`  ${c.commandId}  ${c.type}  ${c.instanceId}`)
}

async function cmdCommand(args) {
  const ownerId = requireOwner(args)
  const instanceId = argOf(args, 'instance')
  const type = String(argOf(args, 'type', '')).toLowerCase()
  if (!instanceId || !type) {
    console.error('bot-worker: --instance <id> and --type <start|pause|resume|stop> are required')
    process.exit(2)
  }
  const store = await commands()
  const commandId = argOf(args, 'command-id', `cli_${randomUUID()}`)
  const instance = await store.findOwnedInstance(ownerId, instanceId)
  if (!instance) {
    console.error(`bot-worker: instance ${instanceId} not found for this owner`)
    process.exit(1)
  }
  const res = await store.enqueueCommand({
    ownerId,
    instanceId,
    type,
    commandId,
    accountId: instance.accountId ?? null,
    botProfileId: instance.botProfileId ?? null,
    requestedAt: Date.now(),
  })
  if (!res.ok) {
    console.error(`bot-worker: enqueue failed (${res.code})`)
    process.exit(1)
  }
  console.log(res.duplicate ? `already queued: ${commandId}` : `queued: ${commandId} (${type} ${instanceId})`)
}

/**
 * Create a bot instance from an enabled LIVE_PAPER profile and queue its start
 * command. Delegates to the shared store helper (`createInstanceFromProfile`)
 * — the same path the desk auto-heal uses.
 *
 *   node tools/bot-worker.mjs create --owner <id> [--profile <profileId>]
 *        [--watermark-ago <minutes>]   (default 0: only NEW signals are consumed)
 */
async function cmdCreate(args) {
  const ownerId = requireOwner(args)
  const profileId = argOf(args, 'profile')
  const watermarkAgoMin = Math.max(0, Number(argOf(args, 'watermark-ago', 0)) || 0)
  const store = await commands()

  const res = await store.createInstanceFromProfile({
    ownerId,
    profileId,
    watermarkTs: Date.now() - watermarkAgoMin * 60_000,
    createdBy: 'cli',
  })
  if (!res.ok) {
    console.error(`bot-worker: create failed (${res.code}${res.message ? `: ${res.message}` : ''})`)
    process.exit(1)
  }
  if (!res.created) {
    console.log(`instance already exists: ${res.instanceId} (${res.state}) — enqueue nothing`)
    return
  }

  const start = await store.enqueueCommand({
    ownerId,
    instanceId: res.instanceId,
    botProfileId: profileId || null,
    type: 'start',
    commandId: `cli_start_${res.instanceId}_${randomUUID()}`,
    requestedAt: Date.now(),
  })
  if (!start.ok) {
    console.error(`bot-worker: start command enqueue failed (${start.code})`)
    process.exit(1)
  }
  console.log(`created: ${res.instanceId} (state=queued, watermark=${new Date(Date.now() - watermarkAgoMin * 60_000).toISOString()})`)
  console.log('queued start command — the worker applies it on its next tick')
}

async function cmdStop(args) {
  const ownerId = requireOwner(args)
  const store = await commands()
  const active = await store.listOwnedInstances(ownerId, { states: ['starting', 'running', 'paused'], limit: 200 })
  if (!active.length) {
    console.log('no active instances')
    return
  }
  for (const i of active) {
    // The `stop` command is instance-level, so the id encodes the target.
    const commandId = `cli_stop_${i.instanceId}_${randomUUID()}`
    await store.enqueueCommand({
      ownerId,
      instanceId: i.instanceId,
      type: 'stop',
      commandId,
      accountId: i.accountId ?? null,
      requestedAt: Date.now(),
    })
    console.log(`queued stop: ${i.instanceId}`)
  }
}

const [sub, ...args] = process.argv.slice(2)
const run = { run: cmdRun, status: cmdStatus, command: cmdCommand, create: cmdCreate, stop: cmdStop }[sub]
if (!run) {
  console.error('usage: node tools/bot-worker.mjs <run|status|command|create|stop> --owner <ownerId> [...flags]')
  console.error('  create: --profile <profileId> --watermark-ago <minutes=0> — new instance from an enabled LIVE_PAPER profile')
  process.exit(2)
}
await run(args)

// One-shot subcommands (status|command|create|stop) close the Mongo connection
// and exit explicitly. `run` is a DAEMON: cmdRun returns after arming the tick
// interval — it must NOT fall through to `process.exit(0)`, which killed the
// continuous worker right after its first tick (the silent deaths seen live).
// The run loop keeps the event loop alive until SIGINT/SIGTERM.
if (sub !== 'run') {
  const db = await import('../engine/db.mjs')
  await db.disconnectMongo().catch(() => {})
  process.exit(0)
}
