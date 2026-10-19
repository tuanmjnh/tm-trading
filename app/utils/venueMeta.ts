// =============================================================================
//  Venue display metadata — one place mapping a venue/source id to its label,
//  compact badge text and (when a brand mark exists in the installed icon
//  collection) an icon.
//
//  Icons come from @iconify-json/simple-icons (installed dependency). Only the
//  brands actually present in that collection get an icon — everything else
//  falls back to the text short-label, so a row is never icon-less by accident
//  and we never reference a non-existent icon.
//
//  Unknown ids degrade gracefully: uppercase short label, no icon.
// =============================================================================

export interface VenueMeta {
  /** Canonical id (post-alias). */
  id: string
  /** Full display name. */
  label: string
  /** Compact badge text (always uppercase, <= 7 chars). */
  short: string
  /** Iconify name, or null when the brand has no glyph in the bundle. */
  icon: string | null
}

/** Provenance ids that map onto a venue id. */
const ALIASES: Record<string, string> = {
  'binance-spot': 'binance',
  'binance-futures': 'binance',
  'bingx-spot': 'bingx',
  'gate-spot': 'gate',
  'bitget-spot': 'bitget',
  'mexc-spot': 'mexc',
  'coin-gecko': 'coingecko'
}

const VENUES: Record<string, Omit<VenueMeta, 'id'>> = {
  binance: { label: 'Binance', short: 'BINANCE', icon: 'i-simple-icons-binance' },
  bybit: { label: 'Bybit', short: 'BYBIT', icon: null },
  okx: { label: 'OKX', short: 'OKX', icon: 'i-simple-icons-okx' },
  bingx: { label: 'BingX', short: 'BINGX', icon: null },
  bitget: { label: 'Bitget', short: 'BITGET', icon: null },
  gate: { label: 'Gate', short: 'GATE', icon: null },
  kucoin: { label: 'KuCoin', short: 'KUCOIN', icon: 'i-simple-icons-kucoin' },
  kraken: { label: 'Kraken', short: 'KRAKEN', icon: null },
  coinbase: { label: 'Coinbase', short: 'COINBASE', icon: 'i-simple-icons-coinbase' },
  coingecko: { label: 'CoinGecko', short: 'GECKO', icon: null },
  static: { label: 'TM Trading', short: 'TM', icon: null }
}

/** Canonicalize an id (handles aliases + case). */
export function venueId(raw: string | null | undefined): string {
  const key = String(raw ?? '').trim().toLowerCase()
  return ALIASES[key] ?? key
}

export function venueMeta(raw: string | null | undefined): VenueMeta {
  const id = venueId(raw)
  const hit = VENUES[id]
  if (hit) return { id, ...hit }
  if (!id) return { id: '', label: '—', short: '—', icon: null }
  return { id, label: id.toUpperCase(), short: id.slice(0, 7).toUpperCase(), icon: null }
}

/** All known venue ids (client-bundle-safe list for iterators/selects). */
export const VENUE_IDS_CLIENT = Object.freeze(Object.keys(VENUES))
