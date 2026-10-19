import { useStorage } from '@vueuse/core'

// =============================================================================
//  useTerminalPrefs — the Trade Terminal workspace, persisted (v3.4 §33/§54).
//
//  ONE versioned blob (`tm-term:v1`) instead of scattered keys, so the whole
//  desk survives a reload and can be reset in a single action. Symbol and
//  timeframe stay in the URL query (shareable links); they are mirrored here
//  only as the fallback used when /trading is opened without a query.
//
//  We deliberately persist INTENT, never prices: absolute entry/SL/TP levels go
//  stale the moment the symbol or the market moves, so the ticket only remembers
//  side/type/size-mode/size/leverage (D12 — no stale levels presented as valid).
//
//  Every read is sanitized against the live allow-lists (unknown enum values,
//  bad lengths, overlong lists) so a hand-edited or outdated blob can never
//  break the desk.
// =============================================================================

export type DeskTab = 'positions' | 'orders' | 'ticket' | 'signals' | 'risk' | 'journal'
export type TicketSide = 'BUY' | 'SELL'
export type TicketType = 'market' | 'limit' | 'stop'
export type TicketSizeMode = 'qty' | 'riskPct'

export interface TerminalTicketPrefs {
  side: TicketSide
  orderType: TicketType
  sizeMode: TicketSizeMode
  size: string
  leverage: number
}

export interface TerminalPrefsV1 {
  /** Schema version — bump only with a migration path. */
  v: 1
  /** Last used symbol/timeframe (URL query wins when present). */
  symbol: string | null
  timeframe: string | null
  deskTab: DeskTab
  /** Most recently selected symbols, newest first. */
  recent: string[]
  /** User-editable "suggested" list shown when there is no history yet. */
  suggested: string[]
  /** User watchlist (ordered). Empty until seeded from the served plane. */
  watchlist: string[]
  /** True once the watchlist was seeded from the served symbols. */
  watchlistSeeded: boolean
  ticket: TerminalTicketPrefs
}

export const TERMINAL_PREFS_KEY = 'tm-term:v1'
export const MAX_RECENT_SYMBOLS = 8
export const MAX_SUGGESTED_SYMBOLS = 10
export const MAX_WATCHLIST = 60

/**
 * Baseline symbols offered before the user has any history. Static on purpose:
 * the live universe carries no rank/volume for perps (only index rows have a
 * `value`), so a "most traded" list would be invented data (D12).
 */
export const SUGGESTED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
  'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'
]

const DESK_TABS: readonly DeskTab[] = ['positions', 'orders', 'ticket', 'signals', 'risk', 'journal']
const TICKET_SIDES: readonly TicketSide[] = ['BUY', 'SELL']
const TICKET_TYPES: readonly TicketType[] = ['market', 'limit', 'stop']
const TICKET_SIZE_MODES: readonly TicketSizeMode[] = ['qty', 'riskPct']
const LEVERAGE_ALLOWED: readonly number[] = [1, 2, 3, 5]

const SYMBOL_RE = /^[A-Z0-9]{5,20}$/

export function defaultTerminalPrefs(): TerminalPrefsV1 {
  return {
    v: 1,
    symbol: null,
    timeframe: null,
    deskTab: 'positions',
    recent: [],
    suggested: [...SUGGESTED_SYMBOLS],
    watchlist: [],
    watchlistSeeded: false,
    ticket: {
      side: 'BUY',
      orderType: 'market',
      sizeMode: 'qty',
      size: '',
      leverage: 5
    }
  }
}

const cleanSymbols = (list: unknown, max: number): string[] => {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const sym = raw.trim().toUpperCase()
    if (!SYMBOL_RE.test(sym)) continue
    if (!out.includes(sym)) out.push(sym)
    if (out.length >= max) break
  }
  return out
}

/** Merge an unknown/partial blob onto the defaults (never throws). */
export function sanitizeTerminalPrefs(input: unknown): TerminalPrefsV1 {
  const base = defaultTerminalPrefs()
  if (!input || typeof input !== 'object' || (input as { v?: unknown }).v !== 1) return base
  const raw = input as Partial<TerminalPrefsV1>
  const ticket = (raw.ticket ?? {}) as Partial<TerminalTicketPrefs>
  return {
    v: 1,
    symbol: typeof raw.symbol === 'string' && SYMBOL_RE.test(raw.symbol) ? raw.symbol : null,
    timeframe: typeof raw.timeframe === 'string' && raw.timeframe ? raw.timeframe : null,
    deskTab: DESK_TABS.includes(raw.deskTab as DeskTab) ? raw.deskTab as DeskTab : base.deskTab,
    recent: cleanSymbols(raw.recent, MAX_RECENT_SYMBOLS),
    suggested: (() => {
      const list = cleanSymbols(raw.suggested, MAX_SUGGESTED_SYMBOLS)
      return list.length ? list : base.suggested
    })(),
    watchlist: cleanSymbols(raw.watchlist, MAX_WATCHLIST),
    watchlistSeeded: raw.watchlistSeeded === true,
    ticket: {
      side: TICKET_SIDES.includes(ticket.side as TicketSide) ? ticket.side as TicketSide : base.ticket.side,
      orderType: TICKET_TYPES.includes(ticket.orderType as TicketType) ? ticket.orderType as TicketType : base.ticket.orderType,
      sizeMode: TICKET_SIZE_MODES.includes(ticket.sizeMode as TicketSizeMode) ? ticket.sizeMode as TicketSizeMode : base.ticket.sizeMode,
      size: typeof ticket.size === 'string' && ticket.size.length <= 24 ? ticket.size : '',
      leverage: LEVERAGE_ALLOWED.includes(Number(ticket.leverage)) ? Number(ticket.leverage) : base.ticket.leverage
    }
  }
}

export const useTerminalPrefs = () => {
  const prefs = useStorage<TerminalPrefsV1>(TERMINAL_PREFS_KEY, defaultTerminalPrefs())

  // Idempotent in-place repair: only writes when the stored blob actually drifts
  // from its sanitized form (keeps this safe to call from every consumer).
  const sanitized = sanitizeTerminalPrefs(prefs.value)
  if (JSON.stringify(sanitized) !== JSON.stringify(prefs.value)) prefs.value = sanitized

  /** Remember a pick (newest first, deduped, capped). */
  const bumpRecent = (symbol: string): void => {
    const sym = symbol.trim().toUpperCase()
    if (!SYMBOL_RE.test(sym)) return
    prefs.value.recent = [sym, ...prefs.value.recent.filter((s) => s !== sym)].slice(0, MAX_RECENT_SYMBOLS)
  }

  const inWatchlist = (symbol: string): boolean =>
    prefs.value.watchlist.includes(symbol.trim().toUpperCase())

  const addToWatchlist = (symbol: string): void => {
    const sym = symbol.trim().toUpperCase()
    if (!SYMBOL_RE.test(sym) || prefs.value.watchlist.includes(sym)) return
    if (prefs.value.watchlist.length >= MAX_WATCHLIST) return
    prefs.value.watchlist = [...prefs.value.watchlist, sym]
  }

  const removeFromWatchlist = (symbol: string): void => {
    const sym = symbol.trim().toUpperCase()
    prefs.value.watchlist = prefs.value.watchlist.filter((s) => s !== sym)
  }

  /** Seed the watchlist once from the served plane (keeps the legacy default UX). */
  const seedWatchlist = (symbols: readonly string[]): void => {
    if (prefs.value.watchlistSeeded) return
    prefs.value.watchlist = cleanSymbols(symbols, MAX_WATCHLIST)
    prefs.value.watchlistSeeded = true
  }

  /** Reset the whole workspace to defaults (blob + legacy terminal keys). */
  const reset = (): void => {
    prefs.value = defaultTerminalPrefs()
    for (const key of ['trade-recent-symbols', 'trade-indicators', 'trade-quick-tfs', 'trade-panes-v2']) {
      try {
        localStorage.removeItem(key)
      } catch {
        // storage unavailable (SSR / private mode) — nothing to clear
      }
    }
  }

  return {
    prefs,
    bumpRecent,
    inWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    seedWatchlist,
    reset
  }
}
