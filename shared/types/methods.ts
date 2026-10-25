// =============================================================================
//  Method events + league data for the dashboard (roadmap Phase 10 UI).
//
//  The method plugins live in engine/ (src), the dashboard only reads:
//   - computed events (recommended recency window) for chart markers,
//   - a league snapshot JSON produced by `npm run engine:league -- --out-json`,
//   - the price-action / regime / funding / zone breakdown of a confluence
//     document (stored by services/confluence.mjs).
//
//  Unavailable data fails soft to empty lists (never 500).
// =============================================================================

/** One registered method plugin (engine/methods/*), mirror of its meta. */
export interface MethodMeta {
  id: string
  name: string
  /** version stamp — hashOf({ method: id, params: defaults }) (D1). */
  version: string
  defaults: Record<string, number | boolean | string>
}

/** Bar context grabbed around a detected method event (snapshot per acceptance). */
export interface MethodSnapshot {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** One detected method event ready for chart markers + the inspector. */
export interface MethodEvent {
  method: string
  version: string
  /** index of the triggering bar inside the analyzed window. */
  bar: number
  /** bar openTime in seconds (chart Time). */
  time: number
  type: string
  /** directional score in [-1, 1]; 0 = confirmation-only event. */
  score: number
  price: number
  reasons: string[]
  snapshot: MethodSnapshot
}

/** Pooled summary for a single method across every combo cell (league run). */
export interface MethodLeagueSummary {
  id: string
  name: string
  trades: number
  open: number
  winRate: number
  profitFactor: number
  netPct: number
  expectancy: number
}

/** Per combo cell (method x symbol x tf) row from the league snapshot. */
export interface MethodLeagueRow {
  method: string
  symbol: string
  tf: string
  bars: number
  trades: number
  closed: number
  winRate: number
  profitFactor: number
  netPct: number
  maxDrawdownPct: number
  noFill: number
  replaced: number
}

/** League snapshot file shape (engine/league.mjs --out-json). */
export interface MethodLeague {
  generatedAt: string
  engineVersion: string
  symbols: string[]
  tfs: string[]
  /** poolOut from league.mjs — pooled per method. */
  methods: MethodLeagueSummary[]
  /** Per combo cell rows — detail table. */
  rows: MethodLeagueRow[]
}

/** One weighted part of a confluence score with a reader-friendly tone. */
export interface ConfluencePart {
  key: 'method' | 'regime' | 'funding' | 'zone'
  label: string
  /** raw part score in [-1, 1]. */
  value: number
  /** fixed weight (0.4/0.2/0.2/0.2) — transparency (roadmap §13.3). */
  weight: number
  /** weighted contribution value * weight. */
  contribution: number
  /** short human reading of the part (from the score sign + thresholds). */
  note: string
}

/** Per-symbol confluence explanation for the terminal context. */
export interface ConfluenceDetail {
  symbol: string
  score: number
  rank: number
  tf: string
  bars: number
  src: string
  ts: string
  parts: ConfluencePart[]
}