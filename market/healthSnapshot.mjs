// =============================================================================
//  TM TRADING — market-plane health SNAPSHOT (V3.5 §35 / G8.2).
//
//  The realtime plane (WebSocket + depth + 24h ticker) lives in the Nitro
//  process, while the paper executor is a SEPARATE process. Before this file
//  the plane's monitor.status() (latency, sequence gaps, provider connection
//  state) could only be read from inside the process that owned it, so the
//  §35 data-quality gate priced paper entries off REST klines with no idea
//  whether the WS feed was healthy, lagging or dropping sequence ids.
//
//  This is the shared, MEASURED fact between the two processes: a tiny JSON
//  file rewritten atomically at a bounded cadence. Readers must treat an old
//  or missing file as `unknown`, never as `ok` (D12) — see exec/wsHealth.mjs.
//
//  No timers here beyond the caller-supplied one, no Mongo, no network.
// =============================================================================
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const MARKET_HEALTH_SCHEMA_VERSION = 'marketHealth.v1'

/** Default file — same repo root for both processes (opt-in path override). */
export const DEFAULT_HEALTH_FILE = join(process.cwd(), 'logs', 'market-plane-health.json')

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * Build the snapshot from a live plane. Pure: every value is read from the
 * plane's own status()/monitor.status() — nothing is invented.
 *
 * @param {{ plane?: any, at?: number }} o
 * @returns {object} snapshot (safe to JSON.stringify)
 */
export function buildMarketHealthSnapshot({ plane = null, at = Date.now() } = {}) {
  const status = (() => {
    try { return plane?.monitor?.status?.() ?? null } catch { return null }
  })()
  const rawSeq = status?.seq ?? {}
  let streams = 0
  let gaps = 0
  let dup = 0
  let outOfOrder = 0
  for (const s of Object.values(rawSeq)) {
    streams += 1
    gaps += Number(s?.gaps) || 0
    dup += Number(s?.dup) || 0
    outOfOrder += Number(s?.outOfOrder) || 0
  }
  const provider = (() => {
    try { return plane?.provider?.status?.() ?? null } catch { return null }
  })()
  const stats = (() => {
    try { return plane?.stats?.() ?? null } catch { return null }
  })()

  return {
    schemaVersion: MARKET_HEALTH_SCHEMA_VERSION,
    at: Number(at),
    provider: provider
      ? {
          state: String(provider.state ?? 'unknown'),
          attempt: Number(provider.attempt) || 0,
          name: provider.provider ?? null,
          market: provider.market ?? null,
          streams: Number(provider.streams) || 0,
        }
      : null,
    latency: {
      samples: Number(status?.latency?.samples) || 0,
      p50: num(status?.latency?.p50),
      p95: num(status?.latency?.p95),
      max: num(status?.latency?.max),
    },
    seq: { streams, gaps, dup, outOfOrder },
    stats: stats && typeof stats === 'object' ? stats : null,
  }
}

/**
 * Atomically replace the snapshot file (tmp + rename), so a reader never sees
 * a half-written document. Fail-soft: a write error must never disturb the
 * feed (D33) — the caller only loses observability, never market data.
 *
 * @returns {boolean} true when the file was replaced
 */
export function writeMarketHealthSnapshot(file, snapshot) {
  const tmp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(snapshot)}\n`)
    renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}

/**
 * Periodic writer. `start()` writes once immediately, then on an unref'd
 * interval so it never keeps the process alive on its own.
 *
 * @param {{ plane: any, file?: string, everyMs?: number, now?: () => number }} o
 */
export function createMarketHealthWriter({ plane, file = DEFAULT_HEALTH_FILE, everyMs = 15_000, now = () => Date.now() } = {}) {
  const period = Math.max(1_000, Number(everyMs) || 15_000)
  let timer = null
  const write = () => writeMarketHealthSnapshot(file, buildMarketHealthSnapshot({ plane, at: now() }))
  return {
    file,
    everyMs: period,
    write,
    start() {
      if (timer) return
      write()
      timer = setInterval(write, period)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
