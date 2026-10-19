// =============================================================================
//  TM TRADING — WS health for the §35 gate (V3.5 §35 / G8.2) — PURE + 1 file read.
//
//  The paper executor prices entries off REST klines, so a WebSocket outage does
//  not corrupt a fill price. It DOES corrupt the operator's picture of the
//  market: sequence gaps, duplicate ids, out-of-order arrivals and a plane that
//  stopped reporting. Before this module none of that reached §35 — the gate saw
//  only REST fetch health.
//
//  Vocabulary is the same D33 set the rest of §35 uses
//  (ok / degraded / stale / disconnected / unknown) so a snapshot can feed
//  `qualityGates({ wsState })` without translation.
//
//  Honesty rules (D12):
//  - Missing or unreadable snapshot   -> 'unknown' (never 'ok')
//  - Snapshot older than maxAgeMs     -> 'unknown': a reporter that stopped
//    reporting is not evidence of health, it is evidence of silence.
//  - Timestamp in the future beyond tolerance -> 'unknown' (clock disagreement)
//  - Provider idle/connecting         -> 'unknown' with a named reason
// =============================================================================

export const WS_HEALTH_SCHEMA_VERSION = 'wsHealth.v1'

export const WS_HEALTH_DEFAULTS = Object.freeze({
  /** A snapshot older than this is silence, not a verdict. */
  maxAgeMs: 90_000,
  /** p95 ingest latency above this marks the plane degraded. */
  latencyP95CapMs: 1_500,
  /** A snapshot stamped this far in the future is a clock disagreement. */
  futureSkewMs: 10_000,
})

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

const unknown = (reason, extra = {}) => ({
  state: 'unknown',
  ageMs: null,
  providerState: null,
  gaps: 0,
  dup: 0,
  outOfOrder: 0,
  latencyP95Ms: null,
  reasons: [reason],
  ...extra,
})

/**
 * Translate a plane health snapshot into a §35 stream state.
 *
 * @param {object|null} snapshot  output of market/healthSnapshot.mjs
 * @param {{ at?: number, maxAgeMs?: number, latencyP95CapMs?: number, futureSkewMs?: number }} [opts]
 * @returns {{ state: 'ok'|'degraded'|'stale'|'disconnected'|'unknown', ageMs: number|null,
 *   providerState: string|null, gaps: number, dup: number, outOfOrder: number,
 *   latencyP95Ms: number|null, reasons: string[] }}
 */
export function wsHealthFromSnapshot(snapshot, opts = {}) {
  if (!snapshot || typeof snapshot !== 'object') return unknown('no market-plane health snapshot')

  const at = num(opts.at) ?? Date.now()
  const maxAgeMs = num(opts.maxAgeMs) ?? WS_HEALTH_DEFAULTS.maxAgeMs
  const latencyP95CapMs = num(opts.latencyP95CapMs) ?? WS_HEALTH_DEFAULTS.latencyP95CapMs
  const futureSkewMs = num(opts.futureSkewMs) ?? WS_HEALTH_DEFAULTS.futureSkewMs

  const seenAt = num(snapshot.at)
  if (seenAt == null || seenAt <= 0) return unknown('market-plane health snapshot has no usable timestamp')

  const ageMs = at - seenAt
  if (ageMs < -futureSkewMs) {
    return unknown(`market-plane health timestamp is ${Math.abs(ageMs)}ms in the future (clock disagreement)`, { ageMs })
  }
  if (ageMs > maxAgeMs) {
    return unknown(`market-plane stopped reporting ${ageMs}ms ago (limit ${maxAgeMs}ms)`, { ageMs })
  }

  const provider = snapshot.provider && typeof snapshot.provider === 'object' ? snapshot.provider : null
  if (!provider) return unknown('market plane reports no provider', { ageMs })
  const providerState = String(provider.state || 'unknown')
  const gaps = Number(snapshot.seq?.gaps) || 0
  const dup = Number(snapshot.seq?.dup) || 0
  const outOfOrder = Number(snapshot.seq?.outOfOrder) || 0
  const latencyP95Ms = num(snapshot.latency?.p95)
  const base = { ageMs, providerState, gaps, dup, outOfOrder, latencyP95Ms }

  if (providerState === 'disconnected') {
    return { ...base, state: 'disconnected', reasons: [`market WS provider is disconnected (attempt ${Number(provider.attempt) || 0})`] }
  }
  if (providerState !== 'connected') {
    return { ...base, state: 'unknown', reasons: [`market WS provider is '${providerState}' — no measured stream yet`] }
  }

  const reasons = []
  if (gaps > 0) reasons.push(`${gaps} sequence gap(s) observed`)
  if (dup > 0) reasons.push(`${dup} duplicate sequence id(s)`)
  if (outOfOrder > 0) reasons.push(`${outOfOrder} out-of-order event(s)`)
  if (latencyP95Ms != null && latencyP95Ms > latencyP95CapMs) {
    reasons.push(`p95 ingest latency ${latencyP95Ms}ms > ${latencyP95CapMs}ms`)
  }
  if (reasons.length) return { ...base, state: 'degraded', reasons }

  return {
    ...base,
    state: 'ok',
    reasons: [`market WS connected, ${Number(snapshot.seq?.streams) || 0} stream(s), p95 ${latencyP95Ms ?? 'n/a'}ms`],
  }
}

/**
 * Read the shared snapshot file and translate it. Any IO/parse failure becomes
 * `unknown` with the reason attached — callers never have to guess.
 *
 * @param {string} file
 * @param {object} [opts]  passed through to wsHealthFromSnapshot
 */
export async function readWsHealth(file, opts = {}) {
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(file, 'utf8')
    let parsed = null
    try { parsed = JSON.parse(raw) } catch { return { ...unknown(`market-plane health file is not valid JSON (${file})`), file } }
    return { ...wsHealthFromSnapshot(parsed, opts), file }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'READ_FAILED'
    return { ...unknown(code === 'ENOENT' ? `no market-plane health snapshot at ${file}` : `market-plane health read failed (${code})`), file }
  }
}
