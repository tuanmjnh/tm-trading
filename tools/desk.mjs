#!/usr/bin/env node
// =============================================================================
//  TM TRADING — DESK RUNNER (localhost training-data desk, roadmap Phase 6-13)
//
//  Starts and SUPERVISES the two long-running processes that turn the desk
//  into a 24/7 training-data collector:
//
//    [svc] node --import tsx services/run.mjs watch
//          (signal producer, funding, scanner, news, macro, retention, ...)
//    [wrk] node tools/bot-worker.mjs run --owner <ownerId>
//          (supervisor lease, signal bridge, paper executor cycles)
//
//  Watchdog: a child that exits is restarted after a short delay (cooldown
//  after 10 restarts/hour — a crashing process must not spin forever).
//
//  `--heal` (opt-in): every 5 minutes, when the owner has NO non-terminal bot
//  instance (a crashed worker leaves the run `failed` via lease recovery), a
//  fresh instance is created and armed. A deliberate `stop` by the operator is
//  indistinguishable from a crash to this check — that is why heal is opt-in.
//
//  Usage:
//    npm run desk                # services + worker
//    npm run desk -- --heal      # + auto-rearm the bot when nothing is running
//    npm run desk -- --owner <id> [--profile <id>] [--no-services]
//
//  SIGINT: children are stopped; the worker's own handler completes the open
//  paper session gracefully (the designed end-of-day behavior).
// =============================================================================
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { hostname } from 'node:os'

import { loadEnv, ROOT } from '../exec/env.mjs'

loadEnv()

// --- args -------------------------------------------------------------------
const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  return v == null || v.startsWith('--') ? fallback : v
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

const HEAL = hasFlag('heal')
const WITH_SERVICES = !hasFlag('no-services')
let stopping = false
const HEAL_INTERVAL_MS = 5 * 60_000
const RESTART_DELAY_MS = 5_000
const RESTART_WINDOW_MS = 60 * 60_000
const RESTART_MAX_PER_WINDOW = 10
const COOLDOWN_MS = 10 * 60_000

// --- logging ----------------------------------------------------------------
const logDir = join(ROOT, 'logs')
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
const logFile = join(logDir, `desk-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.log`)

function deskLog(line) {
  const text = `${new Date().toISOString()} [desk] ${line}`
  console.log(text)
  try { appendFileSync(logFile, `${text}\n`) } catch { /* best effort */ }
}

function childLog(tag, chunk) {
  for (const raw of String(chunk).split(/\r?\n/)) {
    if (raw.trim() === '') continue
    const text = `${new Date().toISOString()} [${tag}] ${raw}`
    console.log(text)
    try { appendFileSync(logFile, `${text}\n`) } catch { /* best effort */ }
  }
}

// --- owner ------------------------------------------------------------------
async function resolveOwner() {
  const fromArgOrEnv = argOf('owner', process.env.BOT_OWNER_ID || null)
  if (fromArgOrEnv) return fromArgOrEnv
  const mg = await import('../engine/db.mjs').then((m) => m.connectMongo())
  if (!mg) return null
  const { BotProfile } = await import('../engine/models/botProfile.mjs')
  const profile = await BotProfile.findOne({ status: 'enabled', mode: 'LIVE_PAPER' }).lean()
  return profile?.ownerId ?? null
}

// --- children ---------------------------------------------------------------
const children = new Map() // tag -> { child, restarts: number[], cooldownUntil: number }

function restartAllowed(tag) {
  const state = children.get(tag)
  if (!state) return true
  const now = Date.now()
  if (now < state.cooldownUntil) return false
  state.restarts = state.restarts.filter((t) => now - t < RESTART_WINDOW_MS)
  return state.restarts.length < RESTART_MAX_PER_WINDOW
}

function noteRestart(tag) {
  const state = children.get(tag)
  if (!state) return
  const now = Date.now()
  state.restarts.push(now)
  if (state.restarts.filter((t) => now - t < RESTART_WINDOW_MS).length >= RESTART_MAX_PER_WINDOW) {
    state.cooldownUntil = now + COOLDOWN_MS
    deskLog(`${tag}: ${RESTART_MAX_PER_WINDOW} restarts in the last hour — cooling down 10 min`)
  }
}

function startChild(tag, command, args) {
  const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.set(tag, { ...(children.get(tag) ?? { restarts: [], cooldownUntil: 0 }), child })
  deskLog(`${tag}: started (pid ${child.pid}) — ${command} ${args.join(' ')}`)
  child.stdout.on('data', (chunk) => childLog(tag, chunk))
  child.stderr.on('data', (chunk) => childLog(`${tag}:err`, chunk))
  child.on('exit', (code, signal) => {
    deskLog(`${tag}: exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
    if (stopping) return
    if (!restartAllowed(tag)) return
    noteRestart(tag)
    deskLog(`${tag}: restarting in ${RESTART_DELAY_MS / 1000}s (watchdog)`)
    setTimeout(() => {
      if (!stopping && !children.get(tag)?.child) startChild(tag, command, args)
    }, RESTART_DELAY_MS)
  })
  return child
}

function stopChildren() {
  for (const [tag, state] of children) {
    try {
      state.child?.kill()
      deskLog(`${tag}: stop signal sent`)
    } catch { /* already gone */ }
  }
}

// --- heal (opt-in) ----------------------------------------------------------
let healTimer = null
async function healOnce(ownerId) {
  try {
    const store = await import('../services/botRuntimeStore.mjs')
    const m = await store.getBotRuntimeModels()
    if (!m) return
    const active = await m.BotInstance.countDocuments({
      ownerId,
      state: { $in: ['queued', 'starting', 'running', 'paused', 'stopping'] },
    })
    if (active > 0) return
    const res = await store.createInstanceFromProfile({
      ownerId,
      watermarkTs: Date.now(),
      createdBy: 'desk-heal',
    })
    if (!res.ok) {
      deskLog(`heal: create failed (${res.code}${res.message ? `: ${res.message}` : ''})`)
      return
    }
    if (!res.created) return
    const cmd = await store.enqueueCommand({
      ownerId,
      instanceId: res.instanceId,
      botProfileId: null,
      type: 'start',
      commandId: `desk_heal_${res.instanceId}_${Date.now().toString(36)}`,
    })
    deskLog(`heal: armed ${res.instanceId} (start command ${cmd.ok ? 'queued' : `FAILED ${cmd.code}`})`)
  } catch (e) {
    deskLog(`heal: error ${String(e?.message ?? e).slice(0, 160)}`)
  }
}

// --- main -------------------------------------------------------------------
const ownerId = await resolveOwner()
if (!ownerId) {
  console.error('desk: no owner — pass --owner <id> or enable a LIVE_PAPER profile')
  process.exit(1)
}
deskLog(`desk starting — owner=${ownerId} services=${WITH_SERVICES} heal=${HEAL} host=${hostname()}`)
if (!HEAL) {
  deskLog('tip: after a worker crash the run is failed by lease recovery; use --heal to auto-rearm')
}

if (WITH_SERVICES) {
  startChild('svc', process.execPath, ['--import', 'tsx', 'services/run.mjs', 'watch'])
}
startChild('wrk', process.execPath, ['tools/bot-worker.mjs', 'run', '--owner', ownerId, '--interval', '60'])

if (HEAL) {
  healTimer = setInterval(() => { void healOnce(ownerId) }, HEAL_INTERVAL_MS)
  healTimer.unref()
  // First heal after 15s: the worker's boot recovery must have finished failing
  // orphaned runs (lease_expired) before we decide the desk needs re-arming.
  setTimeout(() => { void healOnce(ownerId) }, 15_000).unref()
}

const shutdown = (signal) => {
  if (stopping) return
  stopping = true
  deskLog(`shutting down (${signal})`)
  if (healTimer) clearInterval(healTimer)
  stopChildren()
  // The worker's own SIGTERM handler completes the open session gracefully.
  setTimeout(() => process.exit(0), 8_000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
