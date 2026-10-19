import { INSTRUMENTS } from './instruments'

// =============================================================================
//  TM TRADING — live symbol universe (TradingView-style search backend).
//
//  Combines every live source into one searchable list (no hardcoded MARKET_*
//  ceiling for discovery):
//    1. Bybit linear perpetuals (public REST, `status === 'Trading'`) — the
//       live PERP universe. Preferred over Binance fapi here because fapi
//       REST is intermittently banned on this network (HTTP 418), while the
//       WS streams that actually serve the terminal keep flowing.
//    2. OKX USDT linear swaps + BingX USDT-M swaps — more PERP depth.
//    3. Gate.io + Bitget + MEXC perpetuals — broad altcoin PERP coverage.
//    4. Binance + Gate.io + Bitget + MEXC + BingX SPOT market pairs (major
//       quotes only) — the live SPOT universe.
//    5. CoinGecko `/global` — market-cap index snapshots (informational).
//    6. The static catalog (server/utils/instruments.ts) — multi-venue rows
//       win on duplicates (richer venue/type info), and keep the endpoint
//       useful when every upstream is unreachable.
//
//  Every source is an independent vendor row set: one vendor being down never
//  sinks the list (per-source fail-soft). Vendors are fetched concurrently to
//  keep a cold sweep fast.
//
//  Cached 15 min per process; every failure mode is fail-soft (stale cache,
//  then static-only, never a 500). fetchImpl injectable for offline tests.
// =============================================================================

export type UniverseRowType = 'perp' | 'spot' | 'index'

export interface UniverseRow {
  symbol: string
  base: string
  quote: string
  type: UniverseRowType
  markets: string[]
  /** Venues listing this row, unioned across sources (static + live). */
  venues: string[]
  source:
    | 'bybit' | 'okx' | 'bingx' | 'bingx-spot'
    | 'binance-spot'
    | 'gate' | 'gate-spot'
    | 'bitget' | 'bitget-spot'
    | 'mexc' | 'mexc-spot'
    | 'coingecko' | 'static'
  /** Index rows only (BTC.D / TOTAL*): current snapshot value, never history. */
  value?: number | null
  unit?: string | null
}

export interface UniverseMeta {
  updatedAt: number | null
  counts: { perp: number; spot: number; index: number }
  sources: string[]
  degraded: boolean
  cached: boolean
}

export interface UniversePayload {
  rows: UniverseRow[]
  meta: UniverseMeta
}

const BYBIT_URL = 'https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'
const OKX_URL = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP'
const BINGX_URL = 'https://open-api.bingx.com/openApi/swap/v2/quote/contracts'
const BINGX_SPOT_URL = 'https://open-api.bingx.com/openApi/spot/v1/common/symbols'
const SPOT_URL = 'https://api.binance.com/api/v3/exchangeInfo'
const GATE_FUT_URL = 'https://api.gateio.ws/api/v4/futures/usdt/contracts'
const GATE_SPOT_URL = 'https://api.gateio.ws/api/v4/spot/currency_pairs'
const BITGET_FUT_URL = 'https://api.bitget.com/api/v2/mix/market/contracts?productType=usdt-futures'
const BITGET_SPOT_URL = 'https://api.bitget.com/api/v2/spot/public/symbols'
const MEXC_FUT_URL = 'https://contract.mexc.com/api/v1/contract/detail'
const MEXC_SPOT_URL = 'https://api.mexc.com/api/v3/exchangeInfo'
const GECKO_URL = 'https://api.coingecko.com/api/v3/global'
const SPOT_QUOTES = new Set(['USDT', 'USDC', 'BTC', 'ETH', 'BNB'])
/** Base-asset shape guard for dash/underscore-joined vendors (no exotic rows). */
const PLAIN_BASE = /^[A-Z0-9]{1,15}$/
const UNIVERSE_TTL_MS = 15 * 60_000

type FetchImpl = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean
  status?: number
  json: () => Promise<unknown>
}>

async function fetchJson(fetchImpl: FetchImpl, url: string): Promise<unknown> {
  const res = await fetchImpl(url)
  if (!res || typeof res.json !== 'function') throw new Error('universe: bad response object')
  if (res.ok === false) throw new Error(`universe HTTP ${res.status ?? '?'}`)
  return res.json()
}

interface BybitInstrument {
  symbol?: unknown
  baseCoin?: unknown
  quoteCoin?: unknown
  status?: unknown
  contractType?: unknown
}

function bybitRows(body: unknown): UniverseRow[] {
  const list = (body as { result?: { list?: unknown } })?.result?.list
  if (!Array.isArray(list)) throw new Error('universe: bybit shape changed')
  const out: UniverseRow[] = []
  for (const it of list as BybitInstrument[]) {
    if (it.contractType !== 'LinearPerpetual' || it.status !== 'Trading') continue
    const symbol = String(it.symbol ?? '')
    const base = String(it.baseCoin ?? '')
    const quote = String(it.quoteCoin ?? '')
    if (!symbol || !base || !quote) continue
    out.push({ symbol, base, quote, type: 'perp', markets: ['futures'], venues: ['bybit'], source: 'bybit' })
  }
  return out
}

interface OkxInstrument {
  instId?: unknown
  state?: unknown
}

/** OKX USDT-margined linear swaps: instId `BTC-USDT-SWAP`, state `live`. */
function okxRows(body: unknown): UniverseRow[] {
  const list = (body as { data?: unknown })?.data
  if (!Array.isArray(list)) throw new Error('universe: okx shape changed')
  const out: UniverseRow[] = []
  for (const it of list as OkxInstrument[]) {
    if (it.state !== 'live') continue
    const parts = String(it.instId ?? '').split('-')
    if (parts.length !== 3 || parts[2] !== 'SWAP' || parts[1] !== 'USDT') continue
    const base = parts[0]!
    const symbol = `${base}USDT`
    out.push({ symbol, base, quote: 'USDT', type: 'perp', markets: ['futures'], venues: ['okx'], source: 'okx' })
  }
  return out
}

interface BingxContract {
  symbol?: unknown
  status?: unknown
  asset?: unknown
  currency?: unknown
}

/** BingX USDT-M swaps: symbol `BTC-USDT`, status 1 = tradable. */
function bingxRows(body: unknown): UniverseRow[] {
  const list = (body as { data?: unknown })?.data
  if (!Array.isArray(list)) throw new Error('universe: bingx shape changed')
  const out: UniverseRow[] = []
  for (const it of list as BingxContract[]) {
    if (Number(it.status) !== 1) continue
    const dash = String(it.symbol ?? '')
    const base = String(it.asset ?? '')
    const quote = String(it.currency ?? '')
    if (!dash.includes('-') || !base || !quote) continue
    const symbol = `${base}${quote}`.toUpperCase()
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) continue
    out.push({ symbol, base: base.toUpperCase(), quote: quote.toUpperCase(), type: 'perp', markets: ['futures'], venues: ['bingx'], source: 'bingx' })
  }
  return out
}

interface GateContract {
  name?: unknown
  status?: unknown
  in_delisting?: unknown
  type?: unknown
  contract_type?: unknown
}

/**
 * Gate.io USDT-margined perpetuals: `name` `BTC_USDT`, `type` `direct`
 * (linear), `status` `trading`. Crypto contracts carry an EMPTY
 * `contract_type`, while the stocks/indices/commodities/forex/metals
 * contracts set it — that empty string is what keeps those non-crypto
 * instruments out of the universe.
 */
function gatePerpRows(body: unknown): UniverseRow[] {
  if (!Array.isArray(body)) throw new Error('universe: gate futures shape changed')
  const out: UniverseRow[] = []
  for (const it of body as GateContract[]) {
    if (it.status !== 'trading' || it.type !== 'direct') continue
    if (it.in_delisting === true || it.contract_type) continue
    const [base, quote] = String(it.name ?? '').split('_')
    if (!base || quote !== 'USDT' || !PLAIN_BASE.test(base)) continue
    out.push({ symbol: `${base}USDT`, base, quote, type: 'perp', markets: ['futures'], venues: ['gate'], source: 'gate' })
  }
  return out
}

interface GatePair {
  base?: unknown
  quote?: unknown
  trade_status?: unknown
}

/** Gate.io spot pairs: `trade_status` `tradable`, major quotes only. */
function gateSpotRows(body: unknown): UniverseRow[] {
  if (!Array.isArray(body)) throw new Error('universe: gate spot shape changed')
  const out: UniverseRow[] = []
  for (const it of body as GatePair[]) {
    if (it.trade_status !== 'tradable') continue
    const base = String(it.base ?? '').toUpperCase()
    const quote = String(it.quote ?? '').toUpperCase()
    if (!PLAIN_BASE.test(base) || !SPOT_QUOTES.has(quote) || base === quote) continue
    out.push({ symbol: `${base}${quote}`, base, quote, type: 'spot', markets: ['spot'], venues: ['gate'], source: 'gate-spot' })
  }
  return out
}

interface BitgetContract {
  symbol?: unknown
  baseCoin?: unknown
  quoteCoin?: unknown
  symbolStatus?: unknown
  symbolType?: unknown
}

/** Bitget USDT-M perpetuals: `symbolType` `perpetual`, `symbolStatus` `normal`. */
function bitgetPerpRows(body: unknown): UniverseRow[] {
  const list = (body as { data?: unknown })?.data
  if (!Array.isArray(list)) throw new Error('universe: bitget futures shape changed')
  const out: UniverseRow[] = []
  for (const it of list as BitgetContract[]) {
    if (it.symbolStatus !== 'normal' || it.symbolType !== 'perpetual') continue
    const symbol = String(it.symbol ?? '').toUpperCase()
    const base = String(it.baseCoin ?? '').toUpperCase()
    const quote = String(it.quoteCoin ?? '').toUpperCase()
    if (quote !== 'USDT' || !PLAIN_BASE.test(base)) continue
    out.push({ symbol: symbol || `${base}USDT`, base, quote, type: 'perp', markets: ['futures'], venues: ['bitget'], source: 'bitget' })
  }
  return out
}

interface BitgetSpotSymbol {
  symbol?: unknown
  baseCoin?: unknown
  quoteCoin?: unknown
  status?: unknown
}

/** Bitget spot pairs: `status` `online`, major quotes only. */
function bitgetSpotRows(body: unknown): UniverseRow[] {
  const list = (body as { data?: unknown })?.data
  if (!Array.isArray(list)) throw new Error('universe: bitget spot shape changed')
  const out: UniverseRow[] = []
  for (const it of list as BitgetSpotSymbol[]) {
    if (it.status !== 'online') continue
    // `basisCoin` is not reliably upper-cased upstream (e.g. `rNNNN`).
    const base = String(it.baseCoin ?? '').toUpperCase()
    const quote = String(it.quoteCoin ?? '').toUpperCase()
    if (!PLAIN_BASE.test(base) || !SPOT_QUOTES.has(quote) || base === quote) continue
    out.push({ symbol: `${base}${quote}`, base, quote, type: 'spot', markets: ['spot'], venues: ['bitget'], source: 'bitget-spot' })
  }
  return out
}

interface MexcContract {
  symbol?: unknown
  baseCoin?: unknown
  quoteCoin?: unknown
  state?: unknown
}

/** MEXC USDT-M perpetuals: `symbol` `BTC_USDT`, `state` 0 (enabled). */
function mexcPerpRows(body: unknown): UniverseRow[] {
  const list = (body as { data?: unknown })?.data
  if (!Array.isArray(list)) throw new Error('universe: mexc futures shape changed')
  const out: UniverseRow[] = []
  for (const it of list as MexcContract[]) {
    if (Number(it.state) !== 0) continue
    const base = String(it.baseCoin ?? '').toUpperCase()
    const quote = String(it.quoteCoin ?? '').toUpperCase()
    if (quote !== 'USDT' || !PLAIN_BASE.test(base)) continue
    // Pre-market / index contracts are never plain `BASE_USDT`.
    if (String(it.symbol ?? '') !== `${base}_USDT`) continue
    out.push({ symbol: `${base}USDT`, base, quote, type: 'perp', markets: ['futures'], venues: ['mexc'], source: 'mexc' })
  }
  return out
}

interface MexcSpotSymbol {
  symbol?: unknown
  baseAsset?: unknown
  quoteAsset?: unknown
  status?: unknown
  isSpotTradingAllowed?: unknown
}

/** MEXC spot pairs (Binance-shaped payload): `status` `1`, spot enabled. */
function mexcSpotRows(body: unknown): UniverseRow[] {
  const list = (body as { symbols?: unknown })?.symbols
  if (!Array.isArray(list)) throw new Error('universe: mexc spot shape changed')
  const out: UniverseRow[] = []
  for (const it of list as MexcSpotSymbol[]) {
    if (String(it.status) !== '1' || it.isSpotTradingAllowed === false) continue
    const base = String(it.baseAsset ?? '').toUpperCase()
    const quote = String(it.quoteAsset ?? '').toUpperCase()
    if (!PLAIN_BASE.test(base) || !SPOT_QUOTES.has(quote) || base === quote) continue
    out.push({ symbol: `${base}${quote}`, base, quote, type: 'spot', markets: ['spot'], venues: ['mexc'], source: 'mexc-spot' })
  }
  return out
}

interface BingxSpotSymbol {
  symbol?: unknown
  status?: unknown
  apiStateBuy?: unknown
  apiStateSell?: unknown
}

/** BingX spot pairs: dash-joined `BTC-USDT`, `status` 1 = online. */
function bingxSpotRows(body: unknown): UniverseRow[] {
  const list = (body as { data?: { symbols?: unknown } })?.data?.symbols
  if (!Array.isArray(list)) throw new Error('universe: bingx spot shape changed')
  const out: UniverseRow[] = []
  for (const it of list as BingxSpotSymbol[]) {
    if (Number(it.status) !== 1) continue
    if (it.apiStateBuy === false || it.apiStateSell === false) continue
    const [base, quote] = String(it.symbol ?? '').split('-')
    if (!base || !quote || !PLAIN_BASE.test(base) || !SPOT_QUOTES.has(quote) || base === quote) continue
    out.push({ symbol: `${base}${quote}`, base, quote, type: 'spot', markets: ['spot'], venues: ['bingx'], source: 'bingx-spot' })
  }
  return out
}

interface GeckoGlobal {
  data?: {
    total_market_cap?: Record<string, unknown>
    market_cap_percentage?: Record<string, unknown>
  }
}

/**
 * Market-wide index snapshots (CoinGecko /global, no key): BTC dominance,
 * TOTAL crypto market cap, TOTAL2 (ex-BTC) and TOTAL3 (ex-BTC+ETH).
 * CURRENT VALUES ONLY — no history vendor is available, so index rows are
 * informational (never chartable); the picker marks them as such.
 */
function indexRows(body: unknown): UniverseRow[] {
  const data = (body as GeckoGlobal)?.data
  const total = Number(data?.total_market_cap?.usd)
  const btc = Number(data?.market_cap_percentage?.btc)
  const eth = Number(data?.market_cap_percentage?.eth)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(btc)) {
    throw new Error('universe: coingecko shape changed')
  }
  const t2 = total * (1 - btc / 100)
  const rows: UniverseRow[] = [
    { symbol: 'BTC.D', base: 'BTC', quote: 'CRYPTO', type: 'index', markets: [], venues: ['coingecko'], source: 'coingecko', value: btc, unit: '%' },
    { symbol: 'TOTAL', base: 'TOTAL', quote: 'USD', type: 'index', markets: [], venues: ['coingecko'], source: 'coingecko', value: total, unit: 'USD' },
    { symbol: 'TOTAL2', base: 'TOTAL2', quote: 'USD', type: 'index', markets: [], venues: ['coingecko'], source: 'coingecko', value: t2, unit: 'USD' }
  ]
  if (Number.isFinite(eth)) {
    rows.push({ symbol: 'TOTAL3', base: 'TOTAL3', quote: 'USD', type: 'index', markets: [], venues: ['coingecko'], source: 'coingecko', value: t2 - total * (eth / 100), unit: 'USD' })
  }
  return rows
}

interface SpotSymbol {
  symbol?: unknown
  baseAsset?: unknown
  quoteAsset?: unknown
  status?: unknown
}

function spotRows(body: unknown): UniverseRow[] {
  const list = (body as { symbols?: unknown })?.symbols
  if (!Array.isArray(list)) throw new Error('universe: spot shape changed')
  const out: UniverseRow[] = []
  for (const it of list as SpotSymbol[]) {
    if (it.status !== 'TRADING') continue
    const symbol = String(it.symbol ?? '')
    const base = String(it.baseAsset ?? '')
    const quote = String(it.quoteAsset ?? '')
    if (!symbol || !base || !quote || !SPOT_QUOTES.has(quote)) continue
    out.push({ symbol, base, quote, type: 'spot', markets: ['spot'], venues: ['binance'], source: 'binance-spot' })
  }
  return out
}

function staticRows(): UniverseRow[] {
  return INSTRUMENTS.filter((i) => i.status === 'active').map((i): UniverseRow => ({
    symbol: i.engineSymbol ?? i.venues[0]?.native ?? i.id,
    base: i.base,
    quote: i.quote,
    type: i.type === 'perp' ? 'perp' : 'spot',
    markets: [...new Set(
      i.venues.map((v) => v.market).filter((m): m is 'spot' | 'futures' => m === 'spot' || m === 'futures')
    )],
    venues: [...new Set(i.venues.map((v) => v.venue))],
    source: 'static' as const
  }))
}

/**
 * Merge: static rows win on symbol+type but ABSORB live venues (one terminal
 * row shows every venue serving it); unseen symbol+type rows are appended.
 */
export function mergeUniverse(staticList: UniverseRow[], liveList: UniverseRow[]): UniverseRow[] {
  const byKey = new Map(staticList.map((r) => [`${r.symbol}|${r.type}`, r]))
  const out = [...staticList]
  for (const r of liveList) {
    const key = `${r.symbol}|${r.type}`
    const existing = byKey.get(key)
    if (existing) {
      for (const v of r.venues) if (!existing.venues.includes(v)) existing.venues.push(v)
      for (const m of r.markets) if (!existing.markets.includes(m)) existing.markets.push(m)
      continue
    }
    byKey.set(key, r)
    out.push(r)
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return out
}

export interface UniverseOptions {
  fetchImpl?: FetchImpl
  now?: () => number
  ttlMs?: number
}

let cache: { at: number; payload: UniversePayload } | null = null

/** Test hook: forget the cache (production code never calls this). */
export function resetUniverseCache(): void {
  cache = null
}

export async function getUniverse(opts: UniverseOptions = {}): Promise<UniversePayload> {
  const fetchImpl = (opts.fetchImpl ?? globalThis.fetch) as FetchImpl
  const now: () => number = opts.now ?? Date.now
  const ttlMs = opts.ttlMs ?? UNIVERSE_TTL_MS

  if (cache && now() - cache.at < ttlMs) {
    return { rows: cache.payload.rows, meta: { ...cache.payload.meta, cached: true } }
  }

  const want = [
    'bybit', 'okx', 'bingx', 'bingx-spot', 'binance-spot',
    'gate', 'gate-spot', 'bitget', 'bitget-spot', 'mexc', 'mexc-spot',
    'coingecko'
  ] as const
  const fetchers: Record<(typeof want)[number], () => Promise<UniverseRow[]>> = {
    bybit: async () => bybitRows(await fetchJson(fetchImpl, BYBIT_URL)),
    okx: async () => okxRows(await fetchJson(fetchImpl, OKX_URL)),
    bingx: async () => bingxRows(await fetchJson(fetchImpl, BINGX_URL)),
    'bingx-spot': async () => bingxSpotRows(await fetchJson(fetchImpl, BINGX_SPOT_URL)),
    'binance-spot': async () => spotRows(await fetchJson(fetchImpl, SPOT_URL)),
    gate: async () => gatePerpRows(await fetchJson(fetchImpl, GATE_FUT_URL)),
    'gate-spot': async () => gateSpotRows(await fetchJson(fetchImpl, GATE_SPOT_URL)),
    bitget: async () => bitgetPerpRows(await fetchJson(fetchImpl, BITGET_FUT_URL)),
    'bitget-spot': async () => bitgetSpotRows(await fetchJson(fetchImpl, BITGET_SPOT_URL)),
    mexc: async () => mexcPerpRows(await fetchJson(fetchImpl, MEXC_FUT_URL)),
    'mexc-spot': async () => mexcSpotRows(await fetchJson(fetchImpl, MEXC_SPOT_URL)),
    coingecko: async () => indexRows(await fetchJson(fetchImpl, GECKO_URL))
  }
  // Concurrent sweep with deterministic assembly: a slow or blocked vendor
  // must not serialize the others, while `sources` keeps the declared order.
  const settled = await Promise.all(want.map(async (name) => {
    try {
      return { name, rows: await fetchers[name]() }
    } catch {
      // one vendor down must not sink the universe (fail-soft per source)
      return { name, rows: null as UniverseRow[] | null }
    }
  }))
  const live: UniverseRow[] = []
  const sources: string[] = []
  for (const s of settled) {
    if (!s.rows) continue
    live.push(...s.rows)
    sources.push(s.name)
  }
  const degraded = want.some((w) => !sources.includes(w))

  const stat = staticRows()
  if (!live.length && !stat.length) {
    // Total outage: serve the stale cache if any, else an honest empty set.
    if (cache) return { rows: cache.payload.rows, meta: { ...cache.payload.meta, cached: true, degraded: true } }
    return {
      rows: [],
      meta: { updatedAt: null, counts: { perp: 0, spot: 0, index: 0 }, sources: [], degraded: true, cached: false }
    }
  }
  sources.push('static')

  const rows = mergeUniverse(stat, live)
  const payload: UniversePayload = {
    rows,
    meta: {
      updatedAt: now(),
      counts: {
        perp: rows.filter((r) => r.type === 'perp').length,
        spot: rows.filter((r) => r.type === 'spot').length,
        index: rows.filter((r) => r.type === 'index').length
      },
      sources,
      degraded,
      cached: false
    }
  }
  cache = { at: now(), payload }
  return payload
}
