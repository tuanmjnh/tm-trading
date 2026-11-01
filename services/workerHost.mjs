#!/usr/bin/env node
// =============================================================================
//  TM TRADING — SUPERVISED WORKER HOST (V4.2 §17.5–§17.7)
//
//  One OS process per service instance. The supervisor forks this file with
//  TM_SERVICE_ID in the environment; this file imports the service's declared
//  `runExport`, runs it on the declared interval and reports evidence over IPC.
//
//  Why a host instead of forking the service module directly: every service
//  needs the same three things — a cycle loop, a heartbeat with telemetry, and
//  a drain path that does not depend on signals working on win32. Putting them
//  here means a service module stays a plain function.
//
//  Message protocol (child -> supervisor):
//
//    hello             instance identity after boot
//    heartbeat         telemetry + readiness evidence, every HEARTBEAT_MS
//    cycle             one cycle finished (ok, duration, output count, skip)
//    operation-result  reply to a `run-once` request
//    stopping/stopped  drain progress
//    fatal             an uncaught error; the process exits 1 so the supervisor
//                      restarts it with backoff
//
//  Message protocol (supervisor -> child):
//
//    shutdown          drain now, then exit 0 (graceMs bounds the wait)
//    run-once          run exactly one cycle and answer with operation-result
//
//  Rules that must not be broken:
//
//    - a skip is not a success: `lastSuccessAt` is only refreshed by a cycle
//      that actually did work, so "outside the brief window" cannot mask a
//      broken brief;
//    - readiness evidence is tri-state; a probe that could not run reports
//      `null` and never a comfortable `true`;
//    - `reset` never deletes history; it only asks the module for its optional
//      `reset()` hook (ephemeral state), then restarts.
// =============================================================================

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { loadEnv } from '../exec/env.mjs'
import { loadRegistry } from './registry.mjs'
import { createTelemetrySampler } from './telemetry.mjs'
import {
  cycleSkipReason,
  cycleSucceeded,
  evidenceFromSummary,
  mongoEvidence,
  outputCountOf,
  probeProviderCapability,
  probeSink,
} from './workerProbes.mjs'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const DATA_DIR = join(ROOT, 'data')

/** Version stamp (D1). */
export const WORKER_SCHEMA_VERSION = 'worker.v1'

/** Evidence heartbeat cadence. Short enough to notice a stall, cheap enough. */
export const DEFAULT_HEARTBEAT_MS = 10_000

/** Delay before the first cycle so the supervisor can register the instance. */
export const DEFAULT_FIRST_CYCLE_DELAY_MS = 1_000

/** A cycle interval below this would spin the process for no benefit. */
export const MIN_CYCLE_INTERVAL_MS = 1_000

/** How long a provider capability answer is reused (it costs a round trip). */
export const CAPABILITY_TTL_MS = 300_000

/**
 * Resolve the cycle interval in milliseconds.
 *
 * The env override is honoured the same way `services/run.mjs` honours it, so
 * moving a service onto the supervisor does not silently change its cadence.
 *
 * @param {{ intervalSec?: number | null, intervalEnv?: string }} definition
 * @param {Record<string, string | undefined>} [env]
 * @returns {number | null}
 */
export function cycleIntervalMs(definition, env = process.env) {
  const raw = definition.intervalEnv ? env[definition.intervalEnv] : undefined
  const override = Number(raw)
  const seconds = raw !== undefined && raw !== '' && Number.isFinite(override) && override > 0
    ? override
    : definition.intervalSec
  if (!Number.isFinite(seconds) || seconds === null || seconds <= 0) return null
  return Math.max(MIN_CYCLE_INTERVAL_MS, Math.round(Number(seconds) * 1000))
}

/** Keep a cycle summary small enough to travel over IPC and into the audit log. */
export function summarizeCycle(summary) {
  if (summary === undefined || summary === null) return null
  try {
    const text = JSON.stringify(summary)
    if (!text) return null
    return text.length > 500 ? `${text.slice(0, 500)}…` : text
  } catch {
    return null
  }
}

/**
 * Run exactly one cycle and describe the outcome.
 *
 * Never throws: a service that explodes is a failed cycle, not a dead worker,
 * so the loop can report it and try again on the next tick.
 *
 * @param {{
 *   definition: { outputCountKeys?: ReadonlyArray<string> },
 *   run: () => Promise<unknown> | unknown,
 *   now?: () => number,
 * }} input
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped: string | null,
 *   startedAt: number,
 *   durationMs: number,
 *   outputCount: number | null,
 *   evidence: Record<string, unknown>,
 *   summary: string | null,
 *   error: string | null,
 * }>}
 */
export async function runCycle({ definition, run, now = () => Date.now() }) {
  const startedAt = now()
  try {
    const summary = await run()
    const ok = cycleSucceeded(summary)
    const skipped = ok ? cycleSkipReason(summary) : null
    const evidence = evidenceFromSummary(summary, definition)
    // A skipped cycle produced no rows; claiming 0 would fail an optional
    // `output-produced` check for a service that is idle by design, so the
    // output count is NOT OBSERVED rather than zero. The supervisor applies the
    // same rule, and both ends must agree.
    if (skipped) evidence.lastOutputCount = null
    return {
      ok,
      skipped,
      startedAt,
      durationMs: Math.max(0, now() - startedAt),
      outputCount: ok && !skipped ? outputCountOf(summary, definition.outputCountKeys) : null,
      evidence,
      summary: summarizeCycle(summary),
      error: ok ? null : String(summary?.error ?? summary?.code ?? 'cycle reported failure').slice(0, 300),
    }
  } catch (error) {
    return {
      ok: false,
      skipped: null,
      startedAt,
      durationMs: Math.max(0, now() - startedAt),
      outputCount: null,
      evidence: { lastOutputCount: null },
      summary: null,
      error: String(error?.message || error).slice(0, 300),
    }
  }
}

/**
 * The in-process half of a worker: cycle loop, heartbeat and drain.
 *
 * Timers and sleep are injected so a test can drive the whole protocol without
 * waiting on wall-clock time.
 *
 * @param {{
 *   definition: object,
 *   run: () => Promise<unknown> | unknown,
 *   send?: (message: object) => void,
 *   now?: () => number,
 *   intervalMs?: number | null,
 *   heartbeatMs?: number,
 *   firstCycleDelayMs?: number,
 *   telemetry?: { sample: () => object, stop: () => void } | null,
 *   collectEvidence?: (() => Promise<object> | object) | null,
 *   timers?: { setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function },
 *   sleep?: (ms: number) => Promise<void>,
 *   instanceId?: string,
 *   log?: (line: string) => void,
 * }} options
 */
export function createWorker(options) {
  const {
    definition,
    run,
    send = () => {},
    now = () => Date.now(),
    intervalMs = null,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    firstCycleDelayMs = DEFAULT_FIRST_CYCLE_DELAY_MS,
    telemetry = null,
    collectEvidence = null,
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    instanceId = `si_${process.pid}`,
    log = () => {},
  } = options

  let stopping = false
  let started = false
  let cycleTimer = null
  let heartbeatTimer = null
  let inFlight = null
  let lastEvidence = null
  let lastCycleAt = null

  /** Run one cycle, refusing to overlap two of them. */
  async function cycle() {
    if (inFlight) return { busy: true, ok: false, error: 'a cycle is already running' }
    const promise = runCycle({ definition, run, now })
    inFlight = promise
    try {
      const result = await promise
      lastCycleAt = result.startedAt
      lastEvidence = result.evidence
      return result
    } finally {
      inFlight = null
    }
  }

  function reportCycle(result) {
    if (result.busy) return
    send({
      type: 'cycle',
      instanceId,
      at: now(),
      ok: result.ok,
      skipped: result.skipped,
      durationMs: result.durationMs,
      outputCount: result.outputCount,
      evidence: result.evidence,
      error: result.error,
      summary: result.summary,
    })
  }

  function scheduleNext(delayMs) {
    if (stopping) return
    cycleTimer = timers.setTimeout(async () => {
      if (stopping) return
      const result = await cycle()
      reportCycle(result)
      if (!stopping && intervalMs !== null) scheduleNext(intervalMs)
    }, delayMs)
  }

  async function heartbeat() {
    if (stopping) return
    let evidence = {}
    try {
      evidence = (await collectEvidence?.()) ?? {}
    } catch (error) {
      // A probe that fails must not kill the heartbeat: the supervisor needs to
      // hear from a worker even when Mongo is down.
      log(`[worker] evidence probe failed: ${String(error?.message || error)}`)
      evidence = {}
    }
    const merged = { ...(lastEvidence ?? {}), ...evidence }
    if (merged.lastOutputCount === undefined) merged.lastOutputCount = null

    let sample = null
    try {
      sample = telemetry ? telemetry.sample() : null
    } catch {
      sample = null
    }

    send({ type: 'heartbeat', instanceId, at: now(), telemetry: sample, evidence: merged })
  }

  function start() {
    if (started || stopping) return
    started = true
    send({ type: 'hello', instanceId, at: now(), pid: process.pid, schemaVersion: WORKER_SCHEMA_VERSION })
    scheduleNext(firstCycleDelayMs)
    heartbeatTimer = timers.setInterval(() => { void heartbeat() }, heartbeatMs)
  }

  /** Run one cycle on demand (`run-once`); never overlaps the periodic loop. */
  async function runOnce(operationId) {
    if (inFlight) {
      send({
        type: 'operation-result',
        instanceId,
        operationId,
        ok: false,
        error: 'a cycle is already running',
      })
      return { ok: false, error: 'a cycle is already running' }
    }
    const result = await cycle()
    send({
      type: 'operation-result',
      instanceId,
      operationId,
      ok: result.ok,
      result: {
        durationMs: result.durationMs,
        outputCount: result.outputCount,
        skipped: result.skipped,
        summary: result.summary,
      },
      evidence: result.evidence,
      error: result.error,
    })
    return result
  }

  /**
   * Drain: stop scheduling, let the in-flight cycle finish, release telemetry.
   *
   * The grace period is the supervisor's contract, not an internal timeout: a
   * cycle that overruns it is reported as not drained and the supervisor
   * escalates to a kill.
   */
  async function stop({ reason = 'shutdown', graceMs = 15_000 } = {}) {
    if (stopping) return { drained: inFlight === null, alreadyStopping: true }
    stopping = true
    if (cycleTimer !== null) timers.clearTimeout(cycleTimer)
    if (heartbeatTimer !== null) timers.clearInterval(heartbeatTimer)
    cycleTimer = null
    heartbeatTimer = null

    send({ type: 'stopping', instanceId, at: now(), reason })
    const deadline = now() + Math.max(0, graceMs)
    while (inFlight && now() < deadline) await sleep(50)
    const drained = inFlight === null
    try {
      telemetry?.stop()
    } catch {
      // Telemetry is best-effort at shutdown.
    }
    send({ type: 'stopped', instanceId, at: now(), reason, drained })
    log(`[worker] stopped reason=${reason} drained=${drained} lastCycleAt=${lastCycleAt ?? '-'}`)
    return { drained }
  }

  /** Handle one supervisor message. Unknown messages are ignored on purpose. */
  async function onMessage(message) {
    if (!message || typeof message !== 'object') return undefined
    switch (message.type) {
      case 'shutdown':
        // Return the drain result so the process entry point can exit; on win32
        // a signal handler is not a reliable way to end a child, and a child
        // that drains but never exits would make the supervisor escalate to a
        // kill for no reason.
        return stop({ reason: message.reason ?? 'shutdown', graceMs: message.graceMs })
      case 'run-once':
        await runOnce(message.operationId ?? null)
        return undefined
      default:
        return undefined
    }
  }

  return {
    instanceId,
    start,
    cycle,
    runOnce,
    stop,
    heartbeat,
    onMessage,
    get stopping() { return stopping },
    get busy() { return inFlight !== null },
  }
}

// =============================================================================
//  Process entry point — only when executed, never when imported by a test.
// =============================================================================

async function main() {
  loadEnv()

  const serviceId = String(process.env.TM_SERVICE_ID ?? '')
  const { registry, source } = await loadRegistry()
  const definition = registry.find(candidate => candidate.id === serviceId)
  if (!definition) {
    console.error(`[worker] unknown TM_SERVICE_ID=${serviceId || '(empty)'} registry=${source}`)
    process.exit(2)
  }
  if (!definition.entry || !definition.runExport) {
    console.error(`[worker] ${serviceId} declares no entry/runExport`)
    process.exit(2)
  }

  const instanceId = String(process.env.TM_SERVICE_INSTANCE_ID ?? `si_${process.pid}`)
  const mode = process.env.TM_SERVICE_MODE === 'once' ? 'once' : 'run'
  const reset = process.env.TM_SERVICE_RESET === '1'
  const operationId = process.env.TM_OPERATION_ID || null
  const log = line => console.log(`${new Date().toISOString()} ${line}`)

  const send = (message) => {
    try {
      if (typeof process.send === 'function') process.send(message)
    } catch {
      // The supervisor may already be gone; the process still has to exit.
    }
  }

  const module = await import(pathToFileURL(join(ROOT, definition.entry)).href)
  const run = module[definition.runExport]
  if (typeof run !== 'function') {
    console.error(`[worker] ${definition.entry} does not export ${definition.runExport}()`)
    process.exit(2)
  }

  if (reset && typeof module.reset === 'function') {
    try {
      await module.reset()
      log(`[worker] ${serviceId} reset hook executed`)
    } catch (error) {
      log(`[worker] ${serviceId} reset hook failed: ${String(error?.message || error)}`)
    }
  }

  const db = await import('../engine/db.mjs')
  const mongoConfigured = Boolean(String(process.env.MONGODB_URI ?? '').trim())

  let mongoState = { configured: mongoConfigured, connected: false }
  let capability = { passed: null, detail: 'not probed', at: 0 }
  const needsCapability = (definition.readiness ?? []).some(rule => rule.id === 'capability-verified')

  async function refreshMongo() {
    if (!mongoConfigured) return { configured: false, connected: false }
    const connection = await db.connectMongo().catch(() => null)
    if (!connection) return { configured: true, connected: false }
    const status = await db.mongoStatus().catch(() => ({ connected: false }))
    return { configured: true, connected: status?.connected === true }
  }

  async function refreshCapability() {
    if (!needsCapability) return capability
    if (Date.now() - capability.at < CAPABILITY_TTL_MS) return capability
    try {
      const { aiConfig } = await import('../ai/gateway.mjs')
      const result = await probeProviderCapability({ cfg: aiConfig() })
      capability = { ...result, at: Date.now() }
    } catch (error) {
      capability = { passed: null, detail: `capability probe unavailable: ${String(error?.message || error).slice(0, 200)}`, at: Date.now() }
    }
    return capability
  }

  async function collectEvidence() {
    mongoState = await refreshMongo()
    const cap = await refreshCapability()
    return {
      dependenciesReachable: mongoEvidence(mongoState),
      capabilityVerified: cap.passed,
      sinkWritable: probeSink({ mongoConfigured, mongoConnected: mongoState.connected, dir: DATA_DIR }),
    }
  }

  async function shutdown(code) {
    await db.disconnectMongo().catch(() => {})
    // Give the IPC channel a tick to flush before the process disappears.
    setTimeout(() => process.exit(code), 50)
  }

  // --- one-shot: run a single cycle and report the result ---------------------
  if (mode === 'once') {
    const result = await runCycle({ definition, run })
    send({
      type: 'operation-result',
      instanceId,
      operationId,
      ok: result.ok,
      result: {
        durationMs: result.durationMs,
        outputCount: result.outputCount,
        skipped: result.skipped,
        summary: result.summary,
      },
      evidence: result.evidence,
      error: result.error,
    })
    log(`[worker] once ${serviceId} ok=${result.ok} ${result.durationMs}ms${result.error ? ` error=${result.error}` : ''}`)
    await shutdown(result.ok ? 0 : 1)
    return
  }

  // --- long-running: cycle loop + heartbeat ----------------------------------
  const intervalMs = cycleIntervalMs(definition)
  if (intervalMs === null) {
    console.error(`[worker] ${serviceId} is ${definition.executionMode} but declares no interval`)
    process.exit(2)
  }

  let telemetry = null
  try {
    telemetry = createTelemetrySampler({ host: undefined, pid: process.pid })
  } catch (error) {
    log(`[worker] telemetry unavailable: ${String(error?.message || error)}`)
  }

  const worker = createWorker({
    definition,
    run,
    send,
    intervalMs,
    telemetry,
    collectEvidence,
    instanceId,
    log,
  })

  process.on('message', (message) => {
    void worker.onMessage(message).then((result) => {
      // A `shutdown` request is the supervisor's drain: answer it, then exit so
      // the supervisor sees the process end instead of escalating to a kill.
      if (message?.type === 'shutdown') return shutdown(result?.drained === false ? 1 : 0)
      return undefined
    })
  })

  const fatal = (label) => (error) => {
    const detail = String(error?.stack || error?.message || error).slice(0, 500)
    send({ type: 'fatal', instanceId, at: Date.now(), error: `${label}: ${detail}` })
    log(`[worker] ${label}: ${detail}`)
    void shutdown(1)
  }
  process.on('uncaughtException', fatal('uncaughtException'))
  process.on('unhandledRejection', fatal('unhandledRejection'))

  const graceful = async (signal) => {
    await worker.stop({ reason: signal })
    await shutdown(0)
  }
  process.on('SIGINT', () => { void graceful('SIGINT') })
  process.on('SIGTERM', () => { void graceful('SIGTERM') })

  log(`[worker] ${serviceId} instance=${instanceId} pid=${process.pid} interval=${intervalMs}ms generation=${process.env.TM_SERVICE_GENERATION ?? '0'}`)
  worker.start()
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  main().catch((error) => {
    console.error(`[worker] boot failed: ${String(error?.stack || error)}`)
    process.exit(1)
  })
}
