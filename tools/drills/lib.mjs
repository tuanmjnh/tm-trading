// =============================================================================
//  TM TRADING — DRILL HARNESS HELPERS (V4.2 §17.11)
//
//  The drills must exercise the REAL supervisor process, not a mock: the thing
//  under test is that a separate OS process can spawn, prove readiness, crash,
//  restart, drain and recover while another process watches. So this module
//  spawns `node services/supervisor.mjs run` with a throwaway state file, a
//  throwaway command inbox and the fixture registry, then observes the state
//  file the operator would observe.
//
//  Every path lives under `node_modules/.cache/tm-trading/drills/<run>/`, so a
//  drill can never read or consume a real operator's commands.
// =============================================================================

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { enqueueCommand, listQuarantine, normaliseCommand } from '../../services/commandInbox.mjs'
import { readSupervisorSnapshot } from '../../services/supervisorStore.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FIXTURE_REGISTRY = join(ROOT, 'tools', 'drills', 'fixtures', 'registry.mjs')
export const DRILLS_CACHE = join(ROOT, 'node_modules', '.cache', 'tm-trading', 'drills')

/** Operation states that still mean "the supervisor is working on it". */
const ACTIVE_STATES = new Set(['QUEUED', 'RUNNING'])

/** Sleep helper (no timers in the harness runtime, only plain Node). */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Create an isolated drill workspace.
 *
 * @param {string} name
 */
export function createWorkspace(name) {
  mkdirSync(DRILLS_CACHE, { recursive: true })
  const dir = mkdtempSync(join(DRILLS_CACHE, `${name}-`))
  const workspace = {
    name,
    dir,
    stateFile: join(dir, 'supervisor.json'),
    commandsDir: join(dir, 'commands'),
    scratchDir: join(dir, 'scratch'),
    log: [],
    supervisors: [],
  }
  mkdirSync(workspace.commandsDir, { recursive: true })
  mkdirSync(workspace.scratchDir, { recursive: true })
  return workspace
}

/**
 * Spawn the real supervisor CLI against one workspace.
 *
 * `stdio` includes `'ipc'` on purpose: on win32 `child.kill('SIGTERM')` does not
 * run a signal handler, so a drain has to travel over the message channel.
 *
 * @param {ReturnType<typeof createWorkspace>} workspace
 * @param {{ tickMs?: number }} [options]
 */
export function startSupervisor(workspace, { tickMs = 250 } = {}) {
  const child = spawn(process.execPath, [join('services', 'supervisor.mjs'), 'run'], {
    cwd: ROOT,
    env: {
      ...process.env,
      TM_SUPERVISOR_STATE: workspace.stateFile,
      TM_SUPERVISOR_COMMANDS: workspace.commandsDir,
      TM_SUPERVISOR_REGISTRY: FIXTURE_REGISTRY,
      DRILL_SCRATCH_DIR: workspace.scratchDir,
      // Drill oracle only: the fixtures have no database dependency, and the
      // harness must never touch the shared production Supabase/Mongo.
      MONGODB_URI: '',
      SUPERVISOR_TICK_MS: String(tickMs),
      SUPERVISOR_COMMAND_TIMEOUT_MS: '30000',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })

  const handle = { child, workspace, exited: false, exit: null }
  const capture = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim().length === 0) continue
      workspace.log.push(line)
    }
    if (workspace.log.length > 500) workspace.log.splice(0, workspace.log.length - 500)
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  child.on('exit', (code, signal) => {
    handle.exited = true
    handle.exit = { code, signal }
  })
  workspace.supervisors.push(handle)
  return handle
}

/**
 * Ask one supervisor to drain and exit, then make sure it is gone.
 *
 * @param {{ child: import('node:child_process').ChildProcess, exited: boolean } | null} handle
 * @param {{ timeoutMs?: number }} [options]
 */
export async function stopSupervisor(handle, { timeoutMs = 15_000 } = {}) {
  if (!handle || handle.exited) return true
  try {
    if (handle.child.connected) handle.child.send({ type: 'shutdown' })
    else handle.child.kill()
  } catch {
    try { handle.child.kill() } catch { /* already gone */ }
  }
  try {
    await waitFor(() => handle.exited, { timeoutMs, intervalMs: 50, label: 'supervisor shutdown' })
  } catch {
    // Escalate: a stuck supervisor must not wedge the next drill.
    try { handle.child.kill('SIGKILL') } catch { /* already gone */ }
    try {
      await waitFor(() => handle.exited, { timeoutMs: 5_000, intervalMs: 50, label: 'supervisor kill' })
    } catch { /* reported by the caller */ }
  }
  return handle.exited
}

/**
 * Stop every supervisor a drill started, then remove its directory.
 *
 * @param {ReturnType<typeof createWorkspace>} workspace
 */
export async function cleanupWorkspace(workspace) {
  for (const handle of workspace.supervisors ?? []) {
    await stopSupervisor(handle)
  }
  try {
    rmSync(workspace.dir, { recursive: true, force: true })
  } catch {
    // A locked file on win32 is harmless: the next run uses a new directory.
  }
}

/**
 * Drop one command into a workspace inbox.
 *
 * @param {ReturnType<typeof createWorkspace>} workspace
 * @param {{ serviceId: string, action: string, operationId?: string, idempotencyKey?: string, now?: number, ttlMs?: number }} input
 * @returns {object} the normalised command
 */
export function enqueue(workspace, input) {
  const operationId = input.operationId ?? `drill_${randomUUID()}`
  const command = normaliseCommand({
    operationId,
    serviceId: input.serviceId,
    action: input.action,
    actor: 'drill',
    idempotencyKey: input.idempotencyKey ?? `drill:${operationId}`,
    now: input.now,
    ttlMs: input.ttlMs,
  })
  enqueueCommand(command, { dir: workspace.commandsDir })
  return command
}

/** Read what the supervisor persisted (the same file the Operations API reads). */
export function snapshot(workspace) {
  return readSupervisorSnapshot(workspace.stateFile)
}

/** One service record from a snapshot, or `null`. */
export function findService(view, serviceId, scopeKey = 'system') {
  return (view.services ?? []).find(service => service.serviceId === serviceId && service.scopeKey === scopeKey) ?? null
}

/** One operation from a snapshot, or `null`. */
export function findOperation(view, operationId) {
  return (view.operations ?? []).find(operation => operation.operationId === operationId) ?? null
}

/** True when an operation can no longer change state. */
export function isTerminal(operation) {
  return Boolean(operation) && !ACTIVE_STATES.has(operation.state)
}

/** Poll until `predicate` returns truthy, or fail with a readable label. */
export async function waitFor(predicate, { timeoutMs = 30_000, intervalMs = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
    }
    await sleep(intervalMs)
  }
}

/** Wait for one operation to reach a terminal state. */
export function waitForOperation(workspace, operationId, options = {}) {
  return waitFor(
    () => {
      const operation = findOperation(snapshot(workspace), operationId)
      return isTerminal(operation) ? operation : null
    },
    { label: `operation ${operationId}`, ...options },
  )
}

/** Wait for one service record to satisfy `predicate`. */
export function waitForService(workspace, serviceId, predicate, options = {}) {
  return waitFor(
    () => {
      const service = findService(snapshot(workspace), serviceId)
      return service && predicate(service) ? service : null
    },
    { label: `service ${serviceId}`, ...options },
  )
}

/** Dead-letter entries for a workspace inbox, newest first. */
export function quarantineEntries(workspace) {
  return listQuarantine({ dir: workspace.commandsDir })
}

/** Absolute path of a drill marker file. */
export function markerPath(workspace, name) {
  return join(workspace.scratchDir, name)
}

/** Write a drill control marker (for example `crash.request`). */
export function writeMarker(workspace, name) {
  writeFileSync(markerPath(workspace, name), String(Date.now()))
}