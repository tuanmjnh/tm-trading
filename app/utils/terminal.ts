// =============================================================================
//  Terminal display helpers (S8 / roadmap 7T) — PURE functions only.
//
//  D21 (roadmap): the UI never decides position/risk state — the server owns
//  it. This module only maps server read-models (types/positions, types/
//  signals, types/risk) to presentation tones/formats. No fetching, no state.
// =============================================================================
import type { DriftStatus } from '../../types/risk'

export type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'

/** Signal/alert status -> badge tone (engine/models/alert.mjs lifecycle). */
export function signalTone(status: string): Tone {
  if (status === 'rejected') return 'error'
  if (status === 'forwarded' || status === 'opened') return 'success'
  if (status === 'received') return 'info'
  return 'neutral' // closed, unknown
}

/** Alert side (buy/sell/long/short) -> tone. Unknown/absent -> neutral. */
export function sideTone(side: string | null | undefined): Tone {
  if (!side) return 'neutral'
  const s = side.toLowerCase()
  if (s === 'buy' || s === 'long') return 'success'
  if (s === 'sell' || s === 'short') return 'error'
  return 'neutral'
}

/** Position direction (1 = long, -1 = short) -> tone. */
export function dirTone(dir: number): Tone {
  return dir === -1 ? 'error' : 'success'
}

/** PnL sign -> tone (null/zero = neutral). */
export function pnlTone(v: number | null | undefined): Tone {
  if (v == null || !Number.isFinite(v) || v === 0) return 'neutral'
  return v > 0 ? 'success' : 'error'
}

/** Kill-switch state -> tone (halted blocks new orders, D7c). */
export function haltTone(halted: boolean): Tone {
  return halted ? 'error' : 'success'
}

/** Mongo fail-soft flag -> tone. */
export function mongoTone(mongo: 'up' | 'down' | undefined): Tone {
  return mongo === 'down' ? 'warning' : 'success'
}

/** Market regime season (intel `regime.season`) -> tone. */
export function regimeTone(season: string | null | undefined): Tone {
  if (season === 'alt') return 'success'
  if (season === 'btc') return 'warning'
  return 'neutral'
}

/**
 * Funding rate -> tone (intel `funding.pct`, %). Elevated positive funding
 * means a crowded long — contrarian warning; negative means crowded short —
 * info. Near zero stays neutral.
 */
export function fundingTone(pct: number | null | undefined): Tone {
  if (pct == null || !Number.isFinite(pct)) return 'neutral'
  if (pct >= 0.01) return 'warning'
  if (pct <= -0.01) return 'info'
  return 'neutral'
}

/** OI trend (intel `regime.sweep[].oiTrendPct`, %) -> tone. Rises = attention. */
export function oiTrendTone(pct: number | null | undefined): Tone {
  if (pct == null || !Number.isFinite(pct)) return 'neutral'
  if (Math.abs(pct) < 0.5) return 'neutral'
  return pct > 0 ? 'warning' : 'info'
}

/** Volume-flow direction (intel `flow.dir`) -> tone. */
export function flowTone(dir: string | null | undefined): Tone {
  if (dir === 'buy') return 'success'
  if (dir === 'sell') return 'error'
  if (dir === 'vol') return 'warning'
  return 'neutral'
}

/** Next-funding countdown (ms) -> "2h 13m" / "13m" / "now" / '—'. Pure (D2). */
export function fundingCountdown(nextMs: number | null | undefined, nowMs = Date.now()): string {
  if (nextMs == null || !Number.isFinite(nextMs)) return '—'
  const diff = nextMs - nowMs
  if (diff <= 0) return 'now'
  const hours = Math.floor(diff / 3_600_000)
  const mins = Math.floor((diff % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

/** Drift check (D8) -> tone: null = never ran, breach = halted-grade. */
export function driftTone(drift: DriftStatus | null | undefined): Tone {
  if (!drift) return 'neutral'
  return drift.breach ? 'error' : 'success'
}

/** Signed fixed-point: '+1.20' / '-0.35' / '0.00' (never '-0.00'). */
export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const fixed = Math.abs(v) < 10 ** -digits ? 0 : v
  const s = fixed.toFixed(digits)
  return fixed > 0 ? `+${s}` : s
}

/** Signed percent: '+0.42%'. */
export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${fmtSigned(v, digits)}%`
}

/** ISO timestamp -> UTC HH:mm:ss (D2: everything stays UTC in the UI). */
export function fmtUtcTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' })
}

/** Position quantity -> compact display (max 6 dp, trailing zeros trimmed). */
export function fmtQty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return String(Number(v.toFixed(6)))
}

/** Method `defaults` object -> display entries (numbers keep a short form). */
export function methodParamEntries(
  defaults: Record<string, unknown> | undefined | null,
  limit = 8
): Array<[string, string]> {
  if (!defaults) return []
  return Object.entries(defaults)
    .slice(0, limit)
    .map(([key, value]) => [key, formatParamValue(value)] as [string, string])
}

function formatParamValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
