// =============================================================================
//  TM TRADING — PROCESS TELEMETRY (V4.2 §17.13 / A7)
//
//  "Process alive" is not evidence that a worker is keeping up. A periodic
//  service can hold a pid, beat its heartbeat and still be hours behind because
//  its event loop is saturated by a synchronous backfill. The Operations screen
//  must show REAL saturation, so every worker samples its own process and
//  reports the numbers with its heartbeat.
//
//  What is measured (all cheap, no external agent):
//
//    event loop delay   monitorEventLoopDelay() histogram → p50/p95/p99/max
//    ELU                performance.eventLoopUtilization() delta
//    memory             process.memoryUsage() → heap used/total, RSS
//    CPU                process.cpuUsage() delta over the sampling window
//    GC                 PerformanceObserver('gc') → count/total/max pause
//
//  Honesty rules (D12), the same ones the rest of the repo follows:
//
//    - a metric that was not measured is `null`, never 0;
//    - the first CPU sample is `null` (there is no window to average over);
//    - GC is `null` when no collection ran inside the window;
//    - `evaluateTelemetry` returns `unknown` when there is no event-loop
//      evidence, instead of a comfortable `ok`.
//
//  The histogram is RESET after every sample so each snapshot describes the
//  window since the previous one, not the lifetime of the process. A single
//  stall at boot therefore does not mark the service saturated forever.
//
//  PURE evaluation, IMPURE sampling: `evaluateTelemetry` takes a snapshot and
//  a clock, so the verdict is deterministic and testable without waiting for a
//  real stall.
// =============================================================================

import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks'
import { hostname } from 'node:os'

/** Version stamp (D1) — bump when the snapshot shape or thresholds change. */
export const TELEMETRY_SCHEMA_VERSION = 'telemetry.v1'

/** Default histogram resolution; 20 ms keeps the sampler nearly free. */
export const TELEMETRY_RESOLUTION_MS = 20

/**
 * Verdict thresholds.
 *
 * Event-loop p95 is the primary signal: above 50 ms the loop is visibly late,
 * above 200 ms callbacks are seconds behind. ELU is the secondary signal and
 * cannot be evaluated alone (a mostly-idle loop reports a low value while a
 * single long task is still blocking).
 */
export const TELEMETRY_THRESHOLDS = Object.freeze({
  eventLoopP95Ms: Object.freeze({ elevated: 50, saturated: 200 }),
  utilization: Object.freeze({ elevated: 0.7, saturated: 0.9 }),
  /** Heap used / heap total above this fraction is a pressure warning. */
  heapUsedFraction: Object.freeze({ elevated: 0.9 }),
  /** GC pause accumulated inside one sampling window. */
  gcPauseMs: Object.freeze({ elevated: 50, saturated: 200 }),
})

/** @typedef {import('../shared/types/service').ProcessTelemetry} ProcessTelemetry */
/** @typedef {'ok' | 'elevated' | 'saturated' | 'unknown'} TelemetryVerdict */

/**
 * Convert nanoseconds to milliseconds.
 *
 * `monitorEventLoopDelay` reports nanoseconds. `null`, `undefined`, NaN and
 * infinities are `null` — an absent measurement must not become 0.
 *
 * @param {number | bigint | null | undefined} ns
 * @param {number} [decimals]
 * @returns {number | null}
 */
export function nsToMs(ns, decimals = 2) {
  if (ns === null || ns === undefined) return null
  const value = typeof ns === 'bigint' ? Number(ns) : ns
  if (!Number.isFinite(value)) return null
  const ms = value / 1e6
  const factor = 10 ** decimals
  return Math.round(ms * factor) / factor
}

/** Round a number, or `null` when it is not finite. */
function roundOrNull(value, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Bytes to MiB, or `null`. */
function bytesToMb(bytes) {
  if (!Number.isFinite(bytes)) return null
  return roundOrNull(bytes / (1024 * 1024), 1)
}

/**
 * Create a sampler bound to the current process.
 *
 * The returned object owns two OS-level resources (the delay histogram and the
 * GC observer); `stop()` releases both and is idempotent.
 *
 * @param {{ resolutionMs?: number, host?: string, pid?: number, now?: () => number }} [options]
 */
export function createTelemetrySampler(options = {}) {
  const resolutionMs = Number.isFinite(options.resolutionMs) && options.resolutionMs > 0
    ? Math.max(1, Math.floor(options.resolutionMs))
    : TELEMETRY_RESOLUTION_MS
  const host = options.host ?? hostname()
  const pid = options.pid ?? process.pid
  const now = options.now ?? (() => Date.now())

  const histogram = monitorEventLoopDelay({ resolution: resolutionMs })
  histogram.enable()

  let previousElu = null
  let previousCpu = null
  let previousSampleAt = null
  let stopped = false

  /** GC pauses accumulated since the previous sample. */
  let gcCount = 0
  let gcTotalMs = 0
  let gcMaxMs = 0

  let observer = null
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const durationMs = Number(entry.duration)
        if (!Number.isFinite(durationMs)) continue
        gcCount += 1
        gcTotalMs += durationMs
        if (durationMs > gcMaxMs) gcMaxMs = durationMs
      }
    })
    observer.observe({ entryTypes: ['gc'] })
  } catch {
    // GC observation is optional: an environment without it still reports
    // event-loop delay, memory and CPU rather than failing to start.
    observer = null
  }

  /**
   * Take one snapshot of the current process.
   *
   * @returns {ProcessTelemetry}
   */
  function sample() {
    const sampledAt = now()

    const p50 = nsToMs(histogram.percentile(50))
    const p95 = nsToMs(histogram.percentile(95))
    const p99 = nsToMs(histogram.percentile(99))
    const max = nsToMs(histogram.max)
    // Percentiles describe the window since the previous sample.
    histogram.reset()

    let utilization = null
    try {
      const current = performance.eventLoopUtilization(previousElu ?? undefined)
      utilization = roundOrNull(current.utilization, 3)
      previousElu = performance.eventLoopUtilization()
    } catch {
      utilization = null
    }

    const memory = process.memoryUsage()

    let cpuPercent = null
    try {
      const current = process.cpuUsage(previousCpu ?? undefined)
      if (previousCpu && previousSampleAt !== null && sampledAt > previousSampleAt) {
        const elapsedMs = sampledAt - previousSampleAt
        const cpuMs = (current.user + current.system) / 1000
        cpuPercent = roundOrNull((cpuMs / elapsedMs) * 100, 1)
      }
      previousCpu = process.cpuUsage()
    } catch {
      cpuPercent = null
    }

    previousSampleAt = sampledAt

    const gcPauseMs = gcCount > 0
      ? { count: gcCount, totalMs: roundOrNull(gcTotalMs, 2) ?? 0, maxMs: roundOrNull(gcMaxMs, 2) ?? 0 }
      : null
    gcCount = 0
    gcTotalMs = 0
    gcMaxMs = 0

    return {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      pid,
      host,
      sampledAt,
      uptimeSec: roundOrNull(process.uptime(), 1) ?? 0,
      eventLoopDelayMs: { p50, p95, p99, max },
      utilization,
      heapUsedMb: bytesToMb(memory.heapUsed) ?? 0,
      heapTotalMb: bytesToMb(memory.heapTotal) ?? 0,
      rssMb: bytesToMb(memory.rss) ?? 0,
      cpuPercent,
      gcPauseMs,
    }
  }

  /** Release the histogram and the GC observer. Safe to call twice. */
  function stop() {
    if (stopped) return
    stopped = true
    try {
      histogram.disable()
    } catch {
      // Already disabled or unavailable — nothing to release.
    }
    try {
      observer?.disconnect()
    } catch {
      // The observer may already be disconnected.
    }
    observer = null
  }

  return { sample, stop, resolutionMs, host, pid, get stopped() { return stopped } }
}

/**
 * Explain a snapshot: verdict plus the reasons behind it.
 *
 * Reasons are English identifiers, not UI strings — the Operations screen maps
 * them to `operationsCenter.telemetry.*` translation keys.
 *
 * @param {ProcessTelemetry | null | undefined} snapshot
 * @param {{ thresholds?: typeof TELEMETRY_THRESHOLDS }} [options]
 * @returns {{ verdict: TelemetryVerdict, reasons: string[] }}
 */
export function explainTelemetry(snapshot, options = {}) {
  const thresholds = options.thresholds ?? TELEMETRY_THRESHOLDS
  if (!snapshot || typeof snapshot !== 'object') return { verdict: 'unknown', reasons: ['no-sample'] }

  const reasons = []
  let verdict = 'ok'

  const escalate = (level) => {
    if (level === 'saturated') verdict = 'saturated'
    else if (level === 'elevated' && verdict === 'ok') verdict = 'elevated'
  }

  const delay = snapshot.eventLoopDelayMs ?? {}
  const p95 = Number.isFinite(delay.p95) ? delay.p95 : null
  const utilization = Number.isFinite(snapshot.utilization) ? snapshot.utilization : null

  // No event-loop evidence at all: do not claim the process is fine.
  if (p95 === null && utilization === null) {
    return { verdict: 'unknown', reasons: ['no-event-loop-evidence'] }
  }

  if (p95 !== null) {
    if (p95 >= thresholds.eventLoopP95Ms.saturated) {
      reasons.push('event-loop-delay-critical')
      escalate('saturated')
    } else if (p95 >= thresholds.eventLoopP95Ms.elevated) {
      reasons.push('event-loop-delay-high')
      escalate('elevated')
    }
  }

  if (utilization !== null) {
    if (utilization >= thresholds.utilization.saturated) {
      reasons.push('event-loop-utilization-critical')
      escalate('saturated')
    } else if (utilization >= thresholds.utilization.elevated) {
      reasons.push('event-loop-utilization-high')
      escalate('elevated')
    }
  }

  const heapUsed = Number.isFinite(snapshot.heapUsedMb) ? snapshot.heapUsedMb : null
  const heapTotal = Number.isFinite(snapshot.heapTotalMb) && snapshot.heapTotalMb > 0 ? snapshot.heapTotalMb : null
  if (heapUsed !== null && heapTotal !== null) {
    const fraction = heapUsed / heapTotal
    if (fraction >= thresholds.heapUsedFraction.elevated) {
      reasons.push('heap-pressure')
      escalate('elevated')
    }
  }

  if (snapshot.gcPauseMs && Number.isFinite(snapshot.gcPauseMs.totalMs)) {
    const pause = snapshot.gcPauseMs.totalMs
    if (pause >= thresholds.gcPauseMs.saturated) {
      reasons.push('gc-pause-critical')
      escalate('saturated')
    } else if (pause >= thresholds.gcPauseMs.elevated) {
      reasons.push('gc-pause-high')
      escalate('elevated')
    }
  }

  return { verdict, reasons }
}

/**
 * Saturation verdict for one process snapshot.
 *
 * @param {ProcessTelemetry | null | undefined} snapshot
 * @param {{ thresholds?: typeof TELEMETRY_THRESHOLDS }} [options]
 * @returns {TelemetryVerdict}
 */
export function evaluateTelemetry(snapshot, options = {}) {
  return explainTelemetry(snapshot, options).verdict
}
