import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { JournalEntry, JournalStats } from '#shared/types/journal'

// =============================================================================
//  READ JOURNAL FOR THE DASHBOARD — engine/journal.mjs only (D1: one source of
//  truth). The module is loaded from disk like server/utils/engineModel.ts:
//  Nitro resolves relative imports inside `server/` differently at build time
//  (docs/app-inheritance.md), so process.cwd() + pathToFileURL is the safe way.
//
//  Fail-soft: Mongo down -> NDJSON mirror; both unavailable/broken -> empty
//  list + source 'none' + a warning, never a 500.
// =============================================================================

type EngineJournal = typeof import('../../engine/journal.mjs')

let journalMod: Promise<EngineJournal> | null = null

function engineJournal(): Promise<EngineJournal> {
  if (!journalMod) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'journal.mjs')).href
    journalMod = import(/* @vite-ignore */ file) as Promise<EngineJournal>
  }
  return journalMod
}

export interface ListJournalQuery {
  limit: number
  /**
   * Tenancy (docs/web-app/user-tenancy-plan.md): hub user id (`sub`) that owns
   * the journal rows. Required — an unscoped read would leak another tenant.
   */
  ownerId: string
  cursor?: string
  source?: string
  method?: string
  regime?: string
  result?: string
  symbol?: string
  tf?: string
  account?: string
  /** ISO-8601 (validated by the endpoint). */
  from?: string
  /** ISO-8601, half-open upper bound. */
  to?: string
}

export interface ListJournalResult {
  /** Whole filtered set, newest first (entryTime desc — engine sort order). */
  items: JournalEntry[]
  total: number
  /** Metrics over the whole filtered set. */
  stats: JournalStats
  source: 'mongo' | 'ndjson' | 'none'
  warnings: string[]
  filters: Record<string, string>
}

const FILTER_KEYS = ['source', 'method', 'regime', 'result', 'symbol', 'tf', 'account', 'from', 'to'] as const

export async function listJournal(q: ListJournalQuery): Promise<ListJournalResult> {
  const filters: Record<string, string> = {}
  for (const k of FILTER_KEYS) {
    const v = q[k]
    if (v) filters[k] = v
  }
  // ownerId is not a user-chosen display filter: it is the tenant boundary, so
  // it is passed to the engine query but kept out of the echoed `filters`.
  const engineFilters: Record<string, string> = { ...filters, ownerId: q.ownerId }

  // engine/journal.mjs is plain JS: cast its load() result to the shape we use
  // (source is only ever 'mongo' | 'ndjson' — see loadJournal()).
  interface LoadedJournal {
    source: 'mongo' | 'ndjson'
    entries: Record<string, any>[]
    warnings: string[]
  }

  let raw: LoadedJournal | null = null
  const warnings: string[] = []
  try {
    const mod = await engineJournal()
    raw = (await mod.loadJournal({ filters: engineFilters, mongo: 'auto' })) as unknown as LoadedJournal
  } catch (err) {
    warnings.push(`journal load failed: ${(err as Error)?.message || String(err)}`)
  }

  const mod = await engineJournal()
  const entries = (raw?.entries ?? []).slice()
  if (raw?.source === 'mongo' || raw?.source === 'ndjson') {
    // Mongo path is already sorted by the query; the NDJSON path keeps append
    // order — sort both here so the cursor is stable either way.
    entries.sort((a, b) => (Number(b.entryTime) || 0) - (Number(a.entryTime) || 0))
  }
  warnings.push(...(raw?.warnings ?? []))

  const items = entries.map(e => mod.serializeEntry(e)) as unknown as JournalEntry[]
  const stats = mod.journalStats(entries) as unknown as JournalStats

  return {
    items,
    total: items.length,
    stats,
    source: raw?.source ?? 'none',
    warnings,
    filters
  }
}
