// =============================================================================
//  TM TRADING — SERVICE COMMAND INBOX (V4.2 §17.6–§17.7)
//
//  The Operations API and the supervisor are different processes. Only the
//  supervisor may write service state (it is the single writer, so two ticks can
//  never race on one record). So the API does not call the supervisor directly:
//  it drops a COMMAND into an inbox, and the supervisor consumes it on its next
//  tick and performs a real operation.
//
//  Why one file per command instead of one JSON array:
//
//    - two API workers can enqueue at the same time without a read-modify-write
//      race (each writes a distinct file, atomically via tmp+rename);
//    - a partially written command is never observed (rename is atomic);
//    - the queue is just a directory listing, so there is no index to corrupt.
//
//  Delivery is at-least-once, which is safe because the supervisor's `request()`
//  is idempotent on `operationId`/idempotency key: consuming a command twice
//  resolves to the same operation instead of a second one. That is why the API
//  mints the `operationId` — the screen can poll for it before the supervisor
//  has even looked at the inbox.
// =============================================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeFileAtomicSync } from './atomicFile.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Default inbox directory — beside the supervisor state file, outside the tree. */
export const COMMANDS_DIR = join(ROOT, 'node_modules', '.cache', 'tm-trading', 'commands')

/**
 * The inbox this process should use.
 *
 * The API and the supervisor are separate processes and must agree, so both
 * honour `TM_SUPERVISOR_COMMANDS`. A drill points it at a throwaway directory,
 * which is why the default is resolved per call instead of captured at import
 * time.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveCommandsDir(env = process.env) {
  const override = String(env.TM_SUPERVISOR_COMMANDS ?? '').trim()
  return override.length > 0 ? override : COMMANDS_DIR
}

export const COMMAND_SCHEMA_VERSION = 'service-command.v1'

/** How long a command may wait for the supervisor before it is dropped. */
export const DEFAULT_COMMAND_TTL_MS = 300_000

/**
 * How many *pending* commands the inbox will hold.
 *
 * A queue with no ceiling is a slow-motion outage: if the supervisor is down and
 * a client keeps retrying, the directory grows until the disk or the supervisor's
 * next tick is the thing that fails (§17.11 "bounded queues"). A full inbox is
 * refused loudly with `INBOX_FULL` rather than silently dropping work.
 */
export const DEFAULT_MAX_PENDING = 200

/**
 * Where a dropped command is kept instead of being deleted (§17.11
 * "dead-letter/quarantine"). It lives *inside* the commands directory so it
 * moves with the inbox (same volume, same permissions) and an operator needs one
 * path to look at.
 */
export const QUARANTINE_DIRNAME = 'quarantine'

/** How many quarantined items to keep before the oldest are pruned. */
export const DEFAULT_MAX_QUARANTINE = 100

/** Thrown by `enqueueCommand` when the inbox is at capacity. */
export class InboxFullError extends Error {
  /**
   * @param {number} pending
   * @param {number} max
   */
  constructor(pending, max) {
    super(`command inbox is full (${pending}/${max} pending)`)
    this.name = 'InboxFullError'
    this.code = 'INBOX_FULL'
    this.pending = pending
    this.max = max
  }
}

/** Only these ids are safe as filenames (they are generated, never user text). */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

/**
 * Validate a normalised command. Pure — the API uses this before writing, the
 * supervisor uses it before trusting a file on disk.
 *
 * @param {unknown} command
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCommand(command) {
  const errors = []
  if (!command || typeof command !== 'object') return { ok: false, errors: ['command is not an object'] }
  const c = /** @type {Record<string, unknown>} */ (command)
  for (const field of ['operationId', 'serviceId', 'action', 'actor']) {
    if (typeof c[field] !== 'string' || String(c[field]).length === 0) errors.push(`${field} is required`)
  }
  if (typeof c.operationId === 'string' && !SAFE_ID.test(c.operationId)) {
    errors.push('operationId contains unsafe characters')
  }
  if (typeof c.requestedAt !== 'number' || !Number.isFinite(c.requestedAt)) errors.push('requestedAt must be a number')
  if (typeof c.deadlineAt !== 'number' || !Number.isFinite(c.deadlineAt)) errors.push('deadlineAt must be a number')
  return { ok: errors.length === 0, errors }
}

/**
 * Turn a control request into a durable command. Pure.
 *
 * @param {{
 *   operationId: string,
 *   serviceId: string,
 *   action: string,
 *   actor: string,
 *   idempotencyKey: string,
 *   scopeKey?: string,
 *   reason?: string | null,
 *   now?: number,
 *   ttlMs?: number,
 * }} input
 */
export function normaliseCommand(input) {
  const now = Number.isFinite(input.now) ? /** @type {number} */ (input.now) : Date.now()
  const ttlMs = Number.isFinite(input.ttlMs) && /** @type {number} */ (input.ttlMs) > 0
    ? /** @type {number} */ (input.ttlMs)
    : DEFAULT_COMMAND_TTL_MS
  return {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    operationId: String(input.operationId),
    serviceId: String(input.serviceId),
    scopeKey: input.scopeKey ? String(input.scopeKey) : 'system',
    action: String(input.action),
    actor: String(input.actor),
    idempotencyKey: String(input.idempotencyKey),
    reason: input.reason ?? null,
    requestedAt: now,
    deadlineAt: now + ttlMs,
  }
}

function commandPath(dir, operationId) {
  return join(dir, `${operationId}.json`)
}

/**
 * How many pending (valid, unexpired) commands are waiting.
 *
 * @param {{ dir?: string, now?: number }} [options]
 */
export function pendingCount(options = {}) {
  return listCommands(options).commands.length
}

/**
 * Write a command atomically (tmp + rename). Returns the file path.
 *
 * Refuses with `InboxFullError` when the inbox is at capacity, except for a
 * replay of a command already waiting — that is the same command, not a new one.
 *
 * @param {object} command a `normaliseCommand()` result
 * @param {{ dir?: string, now?: number, maxPending?: number }} [options]
 */
export function enqueueCommand(command, options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const maxPending = Number.isFinite(options.maxPending) && /** @type {number} */ (options.maxPending) > 0
    ? /** @type {number} */ (options.maxPending)
    : DEFAULT_MAX_PENDING
  const check = validateCommand(command)
  if (!check.ok) throw new Error(`enqueueCommand: invalid command — ${check.errors.join(', ')}`)
  mkdirSync(dir, { recursive: true })
  const target = commandPath(dir, command.operationId)
  // Idempotent replay: the exact command is already queued, so it must succeed
  // even when the queue is otherwise full.
  if (existsSync(target)) return target
  const pending = pendingCount({ dir, now: options.now })
  if (pending >= maxPending) throw new InboxFullError(pending, maxPending)
  // The supervisor lists this directory while the API writes to it, so the
  // rename needs the same bounded retry the state file uses on win32.
  writeFileAtomicSync(target, JSON.stringify(command, null, 2))
  return target
}

/**
 * Read the inbox. Corrupt or invalid files are reported, never thrown: a bad
 * file must not stop the supervisor from processing the good ones.
 *
 * @param {{ dir?: string, now?: number }} [options]
 * @returns {{ commands: object[], invalid: Array<{ file: string, errors: string[] }>, expired: object[] }}
 */
export function listCommands(options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const now = Number.isFinite(options.now) ? /** @type {number} */ (options.now) : Date.now()
  const commands = []
  const invalid = []
  const expired = []
  if (!existsSync(dir)) return { commands, invalid, expired }

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue
    let parsed
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (error) {
      invalid.push({ file, errors: [`unreadable: ${String(error?.message || error)}`] })
      continue
    }
    const check = validateCommand(parsed)
    if (!check.ok) {
      invalid.push({ file, errors: check.errors })
      continue
    }
    if (Number.isFinite(parsed.deadlineAt) && now > parsed.deadlineAt) expired.push(parsed)
    else commands.push(parsed)
  }
  return { commands, invalid, expired }
}

/**
 * Remove a command once the supervisor has performed it (or given up on it).
 *
 * @param {string} operationId
 * @param {{ dir?: string }} [options]
 */
export function consumeCommand(operationId, options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const target = commandPath(dir, operationId)
  if (!existsSync(target)) return false
  rmSync(target, { force: true })
  return true
}

/** Drop a command without performing it (expired, or permanently invalid). */
export const dropCommand = consumeCommand

/**
 * Remove a command by its inbox filename. Used for a file that could not be
 * parsed, so it cannot wedge the queue forever.
 *
 * @param {string} fileName
 * @param {{ dir?: string }} [options]
 */
export function removeCommandFile(fileName, options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const base = String(fileName)
  if (!base.endsWith('.json') || base.includes('/') || base.includes('\\')) return false
  const target = join(dir, base)
  if (!existsSync(target)) return false
  rmSync(target, { force: true })
  return true
}

/** The quarantine directory for a given inbox. */
function quarantineDirOf(dir) {
  return join(dir, QUARANTINE_DIRNAME)
}

/** Sort-safe quarantine filename: zero-padded time, then a stable id. */
function quarantineFileName(at, suffix) {
  return `q_${String(Math.trunc(at)).padStart(16, '0')}_${suffix}`
}

/**
 * Prune the quarantine down to `max` items, oldest first.
 *
 * A dead-letter box that grows without bound is just a slower outage: the point
 * is to keep enough to diagnose the failure, not to keep everything forever.
 *
 * @param {{ dir?: string, max?: number }} [options]
 * @returns {number} how many files were removed
 */
export function pruneQuarantine(options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const max = Number.isFinite(options.max) && /** @type {number} */ (options.max) >= 0
    ? /** @type {number} */ (options.max)
    : DEFAULT_MAX_QUARANTINE
  const target = quarantineDirOf(dir)
  if (!existsSync(target)) return 0
  const files = readdirSync(target).filter(name => name.endsWith('.json')).sort()
  const excess = files.slice(0, Math.max(0, files.length - max))
  for (const file of excess) rmSync(join(target, file), { force: true })
  return excess.length
}

/**
 * Keep a dropped command for inspection instead of deleting it.
 *
 * The original file is removed (it must not be retried after the supervisor gave
 * up on it) and a copy is written under `quarantine/` with the reason attached,
 * so "nothing happened" always has an explanation the operator can read.
 *
 * @param {object} command a normalised command
 * @param {{ dir?: string, now?: number, reason?: string, maxQuarantine?: number }} [options]
 * @returns {string} the quarantine file path
 */
export function quarantineCommand(command, options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const at = Number.isFinite(options.now) ? /** @type {number} */ (options.now) : Date.now()
  const reason = String(options.reason ?? 'dropped')
  const operationId = command?.operationId ? String(command.operationId) : 'unknown'
  const target = quarantineDirOf(dir)
  mkdirSync(target, { recursive: true })
  const file = join(target, quarantineFileName(at, `${operationId}.json`))
  const payload = { quarantinedAt: at, reason, command: command ?? null }
  writeFileAtomicSync(file, JSON.stringify(payload, null, 2))
  if (operationId !== 'unknown') consumeCommand(operationId, { dir })
  pruneQuarantine({ dir, max: options.maxQuarantine })
  return file
}

/**
 * Quarantine a file that could not be parsed or validated.
 *
 * The raw bytes are preserved verbatim, because a corrupt payload is the very
 * evidence someone needs to debug it — and it is removed from the inbox so it
 * cannot wedge the queue forever.
 *
 * @param {string} fileName
 * @param {{ dir?: string, now?: number, reason?: string, maxQuarantine?: number }} [options]
 * @returns {string | null} the quarantine file path, or null if the file was unsafe
 */
export function quarantineFile(fileName, options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const base = String(fileName)
  if (!base.endsWith('.json') || base.includes('/') || base.includes('\\')) return null
  const at = Number.isFinite(options.now) ? /** @type {number} */ (options.now) : Date.now()
  const reason = String(options.reason ?? 'invalid')
  let raw = null
  try {
    raw = readFileSync(join(dir, base), 'utf8')
  } catch {
    raw = null
  }
  const target = quarantineDirOf(dir)
  mkdirSync(target, { recursive: true })
  const file = join(target, quarantineFileName(at, `file_${base}`))
  const payload = { quarantinedAt: at, reason, source: base, raw }
  writeFileAtomicSync(file, JSON.stringify(payload, null, 2))
  removeCommandFile(base, { dir })
  pruneQuarantine({ dir, max: options.maxQuarantine })
  return file
}

/**
 * How many items are currently in the dead-letter box. Reads the directory
 * only — it does not parse, so it is cheap enough for a status read.
 *
 * @param {{ dir?: string }} [options]
 */
export function quarantineCount(options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const target = quarantineDirOf(dir)
  if (!existsSync(target)) return 0
  return readdirSync(target).filter(name => name.endsWith('.json')).length
}

/**
 * Read the dead-letter box, newest first.
 *
 * @param {{ dir?: string, limit?: number }} [options]
 * @returns {Array<{ file: string, quarantinedAt: number | null, reason: string, command: object | null, source?: string, raw?: string | null }>}
 */
export function listQuarantine(options = {}) {
  const dir = options.dir ?? resolveCommandsDir()
  const limit = Number.isFinite(options.limit) && /** @type {number} */ (options.limit) > 0
    ? /** @type {number} */ (options.limit)
    : DEFAULT_MAX_QUARANTINE
  const target = quarantineDirOf(dir)
  if (!existsSync(target)) return []
  const entries = []
  for (const file of readdirSync(target).filter(name => name.endsWith('.json')).sort().reverse()) {
    try {
      const parsed = JSON.parse(readFileSync(join(target, file), 'utf8'))
      entries.push({
        file,
        quarantinedAt: Number.isFinite(parsed?.quarantinedAt) ? parsed.quarantinedAt : null,
        reason: String(parsed?.reason ?? 'unknown'),
        command: parsed?.command ?? null,
        ...(parsed?.source !== undefined ? { source: parsed.source, raw: parsed.raw ?? null } : {}),
      })
    } catch {
      entries.push({ file, quarantinedAt: null, reason: 'unreadable quarantine entry', command: null })
    }
  }
  return entries.slice(0, limit)
}

/**
 * Project pending commands as operations for the read model.
 *
 * A command the supervisor has not consumed yet must be visible to the screen,
 * otherwise a click would look like it did nothing until the next tick.
 *
 * @param {{ dir?: string, now?: number }} [options]
 */
export function pendingOperations(options = {}) {
  const { commands } = listCommands(options)
  return commands.map(command => ({
    operationId: command.operationId,
    serviceId: command.serviceId,
    scopeKey: command.scopeKey,
    action: command.action,
    requestedBy: command.actor,
    requestedAt: command.requestedAt,
    deadlineAt: command.deadlineAt,
    state: 'QUEUED',
    phase: 'queued',
    pending: true,
    result: command.reason ? { reason: command.reason } : {},
    error: null,
    finishedAt: null,
  }))
}
