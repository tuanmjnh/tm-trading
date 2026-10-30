// =============================================================================
//  TM TRADING — V3.9 exchange DEMO venue profiles, capability registry and
//  demo-only endpoint allowlist (roadmap §63.4/§63.5/§64.2/§64.3/§64.8).
//
//  ONE source of truth for: which venue/profile exists, its exact demo REST +
//  WS hosts, its per-endpoint paths, its declared capability matrix, its rate
//  budget and its auth style. Adapters read this; nothing hard-codes a host.
//
//  SAFETY (non-negotiable):
//   - Only demo/sandbox hosts appear here. Production/mainnet hosts are NOT in
//     this registry and are rejected before any network I/O (assertDemo*).
//   - OKX serves live AND demo on the SAME host (www.okx.com); the discriminator
//     is the `x-simulated-trading: 1` header. That header is therefore mandatory
//     and enforced fail-closed (assertSimulatedTradingHeader) — a missing header
//     means "production" and is refused before I/O.
//   - Capabilities are DECLARED (from official docs) but execution is only
//     enabled after a live probe VERIFIES them (see health.mjs / adapter.mjs).
//     Declared != verified. Required capabilities that are UNKNOWN/UNSUPPORTED
//     fail closed (capabilityOk).
//
//  Hosts verified against official docs on 2026-10-28:
//   - Bybit V5 Demo:  https://bybit-exchange.github.io/docs/v5/demo
//   - OKX V5:         https://www.okx.com/docs-v5/en/
//   - Binance USDM:   https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info
//   - Binance Spot demo host could NOT be confirmed from docs at that time, so
//     the spot profile's capabilities stay UNKNOWN and fail closed until probed.
// =============================================================================

/** Capability levels (§64.3). Anything required that is not SUPPORTED fails closed. */
export const CAP = Object.freeze({ SUPPORTED: 'SUPPORTED', UNSUPPORTED: 'UNSUPPORTED', UNKNOWN: 'UNKNOWN' })

export const VENUES = Object.freeze(['bybit', 'binance', 'okx'])
export const ENVIRONMENT = 'DEMO'

/** marketDataPolicy values (§64.4). */
export const MARKET_DATA_POLICY = Object.freeze({ PREFERRED_ONLY: 'PREFERRED_ONLY', ALLOW_REFERENCE_FAILOVER: 'ALLOW_REFERENCE_FAILOVER' })
/** executionSwitchPolicy value (§64.4) — the only permitted policy. */
export const EXECUTION_SWITCH_POLICY = Object.freeze({ MANUAL_NEW_SESSION_ONLY: 'MANUAL_NEW_SESSION_ONLY' })

// --- demo-only host allowlist (REST + WS). Production hosts are absent. -------
// REST hosts that are demo/sandbox for their venue.
const DEMO_REST_HOSTS = Object.freeze({
  bybit: Object.freeze(['api-demo.bybit.com']),
  okx: Object.freeze(['www.okx.com', 'us.okx.com', 'eea.okx.com']), // live+demo share host; header discriminates
  binance: Object.freeze(['demo-fapi.binance.com', 'demo-api.binance.com']),
})
// WS hosts that are demo/sandbox for their venue (never the production stream).
const DEMO_WS_HOSTS = Object.freeze({
  bybit: Object.freeze(['stream-demo.bybit.com']),
  okx: Object.freeze(['wspap.okx.com']),
  binance: Object.freeze(['demo-fstream.binance.com', 'demo-stream.binance.com']),
})
// Public market-data feeds are READ-ONLY reference sources and may use the
// venue's mainnet PUBLIC stream (roadmap §63.3: Bybit demo market data IS the
// mainnet public feed). They are labelled MARKET DATA SOURCE and are NEVER an
// execution endpoint nor an execution venue's mark/account/order truth.
const PUBLIC_MARKET_WS_HOSTS = Object.freeze({
  bybit: Object.freeze(['stream.bybit.com']),
  okx: Object.freeze(['ws.okx.com', 'wspap.okx.com']),
  binance: Object.freeze(['fstream.binance.com', 'stream.binance.com', 'demo-fstream.binance.com']),
})

/** Explicit production hosts — used only to prove they are REJECTED by tests. */
export const PRODUCTION_HOSTS = Object.freeze({
  bybit: Object.freeze(['api.bybit.com', 'stream.bybit.com']),
  okx: Object.freeze(['ws.okx.com']), // okx REST live shares www.okx.com (header-gated)
  binance: Object.freeze(['api.binance.com', 'fapi.binance.com', 'fstream.binance.com']),
})

function hostOf(rawUrl) {
  try { return new URL(String(rawUrl)).host } catch { return null }
}

/**
 * Assert a REST base URL is an allowlisted demo host for the venue. Throws with
 * a stable code BEFORE any network I/O. `requireSimulatedHeader` marks venues
 * (OKX) whose demo status is header-based, not host-based.
 */
export function assertDemoRestHost(venue, baseUrl) {
  const host = hostOf(baseUrl)
  const allowed = DEMO_REST_HOSTS[venue] ?? []
  if (!host || !allowed.includes(host)) {
    throw Object.assign(new Error(`Only official ${venue} demo REST hosts are allowed (${allowed.join(', ')})`), { code: 'exchange.demo-host-required', venue })
  }
  let protocol
  try { protocol = new URL(String(baseUrl)).protocol } catch { protocol = null }
  if (protocol !== 'https:') throw Object.assign(new Error('Demo REST must use https'), { code: 'exchange.demo-host-required', venue })
  return host
}

/** Assert a private WS URL is an allowlisted demo host for the venue. */
export function assertDemoWsHost(venue, wsUrl) {
  const host = hostOf(wsUrl)
  const allowed = DEMO_WS_HOSTS[venue] ?? []
  if (!host || !allowed.includes(host)) {
    throw Object.assign(new Error(`Only official ${venue} demo WS hosts are allowed (${allowed.join(', ')})`), { code: 'exchange.demo-ws-host-required', venue })
  }
  let protocol
  try { protocol = new URL(String(wsUrl)).protocol } catch { protocol = null }
  if (protocol !== 'wss:') throw Object.assign(new Error('Demo WS must use wss'), { code: 'exchange.demo-ws-host-required', venue })
  return host
}

/**
 * Assert a public market-data WS URL is a known read-only market feed host.
 * These are MARKET DATA SOURCES only — never execution endpoints.
 */
export function assertMarketWsHost(venue, wsUrl) {
  const host = hostOf(wsUrl)
  const allowed = PUBLIC_MARKET_WS_HOSTS[venue] ?? []
  if (!host || !allowed.includes(host)) {
    throw Object.assign(new Error(`Unknown ${venue} market-data WS host (${allowed.join(', ')})`), { code: 'exchange.unknown-market-host', venue })
  }
  return host
}

/**
 * OKX fail-closed guard: www.okx.com serves BOTH live and demo; only the
 * `x-simulated-trading: 1` header makes a request demo. Refuse to send an OKX
 * request that lacks it (that would be a production request).
 */
export function assertSimulatedTradingHeader(venue, headers) {
  if (venue !== 'okx') return
  const value = String(headers?.['x-simulated-trading'] ?? '')
  if (value !== '1') {
    throw Object.assign(new Error('OKX demo requests must carry x-simulated-trading: 1 (refusing potential production request)'), { code: 'exchange.simulated-header-required', venue })
  }
}

// --- declared capability defaults --------------------------------------------
// Docs-derived. Execution capabilities start UNKNOWN and are only promoted to
// SUPPORTED after a live probe verifies them (health.mjs). Read/metadata
// capabilities may be declared SUPPORTED where the endpoint is documented.
const cap = (over = {}) => Object.freeze({
  instruments: CAP.SUPPORTED,
  marketSnapshot: CAP.SUPPORTED,
  account: CAP.UNKNOWN,
  openOrders: CAP.UNKNOWN,
  order: CAP.UNKNOWN,
  amend: CAP.UNKNOWN,
  cancel: CAP.UNKNOWN,
  executions: CAP.UNKNOWN,
  positions: CAP.UNKNOWN,
  feeSchedule: CAP.UNKNOWN,
  funding: CAP.SUPPORTED,
  publicStream: CAP.SUPPORTED,
  privateStream: CAP.UNKNOWN,
  historyCoverage: CAP.UNKNOWN,
  ...over,
})

/**
 * The registry. Keyed by profile id. `venue` groups profiles; `marketType` and
 * `category` are the venue-native product selectors. `rest.endpoints` uses
 * path templates the adapter fills. `ws.publicIsMainnet` flags that the public
 * feed is the mainnet market stream (a MARKET DATA SOURCE, not execution).
 */
export const VENUE_PROFILES = Object.freeze({
  bybit: Object.freeze({
    id: 'bybit', venue: 'bybit', environment: ENVIRONMENT, label: 'Bybit Demo (USDT Perpetual)',
    marketType: 'linear', category: 'linear',
    rest: Object.freeze({
      baseUrl: 'https://api-demo.bybit.com',
      endpoints: Object.freeze({
        serverTime: '/v5/market/time', instruments: '/v5/market/instruments-info',
        ticker: '/v5/market/tickers', orderbook: '/v5/market/orderbook', candles: '/v5/market/kline',
        fundingHistory: '/v5/market/funding/history', feeRate: '/v5/account/fee-rate',
        account: '/v5/account/wallet-balance', positions: '/v5/position/list',
        createOrder: '/v5/order/create', amendOrder: '/v5/order/amend', cancelOrder: '/v5/order/cancel',
        openOrders: '/v5/order/realtime', order: '/v5/order/realtime', executions: '/v5/execution/list',
      }),
    }),
    ws: Object.freeze({ privateUrl: 'wss://stream-demo.bybit.com/v5/private', publicUrl: 'wss://stream.bybit.com/v5/public', publicIsMainnet: true }),
    auth: Object.freeze({ style: 'bybit', requiresSimulatedHeader: false }),
    rateLimit: Object.freeze({ weightPerMinute: 600, orderWeight: 1, weightHeader: 'x-baystat-limit' }),
    retentionDays: 7,
    wsTradeSupported: false, // docs: demo WS is private-data only; use REST for orders
    capabilities: cap({ account: CAP.SUPPORTED, positions: CAP.SUPPORTED, executions: CAP.SUPPORTED, feeSchedule: CAP.SUPPORTED, privateStream: CAP.SUPPORTED, order: CAP.SUPPORTED, amend: CAP.SUPPORTED, cancel: CAP.SUPPORTED, openOrders: CAP.SUPPORTED, historyCoverage: CAP.SUPPORTED }),
  }),

  okx: Object.freeze({
    id: 'okx', venue: 'okx', environment: ENVIRONMENT, label: 'OKX Demo (Perpetual Swap)',
    marketType: 'swap', category: 'SWAP',
    rest: Object.freeze({
      baseUrl: 'https://www.okx.com',
      endpoints: Object.freeze({
        serverTime: '/api/v5/public/time', instruments: '/api/v5/public/instruments',
        ticker: '/api/v5/market/ticker', orderbook: '/api/v5/market/books', candles: '/api/v5/market/candles',
        fundingHistory: '/api/v5/public/funding-rate', feeRate: '/api/v5/account/trade-fee',
        account: '/api/v5/account/balance', positions: '/api/v5/account/positions',
        createOrder: '/api/v5/trade/order', amendOrder: '/api/v5/trade/amend-order', cancelOrder: '/api/v5/trade/cancel-order',
        openOrders: '/api/v5/trade/orders-pending', order: '/api/v5/trade/order', executions: '/api/v5/trade/fills',
      }),
    }),
    ws: Object.freeze({ privateUrl: 'wss://wspap.okx.com/ws/v5/private', publicUrl: 'wss://wspap.okx.com/ws/v5/public', publicIsMainnet: false }),
    auth: Object.freeze({ style: 'okx', requiresSimulatedHeader: true }),
    rateLimit: Object.freeze({ weightPerMinute: 600, orderWeight: 1, weightHeader: 'x-ratelimit-limit' }),
    retentionDays: 7,
    wsTradeSupported: true,
    capabilities: cap({ account: CAP.SUPPORTED, positions: CAP.SUPPORTED, executions: CAP.SUPPORTED, feeSchedule: CAP.SUPPORTED, privateStream: CAP.SUPPORTED, order: CAP.SUPPORTED, amend: CAP.SUPPORTED, cancel: CAP.SUPPORTED, openOrders: CAP.SUPPORTED }),
  }),

  'okx-us': Object.freeze({
    id: 'okx-us', venue: 'okx', environment: ENVIRONMENT, label: 'OKX Demo (US region)', region: 'US',
    marketType: 'swap', category: 'SWAP', inherits: 'okx',
    rest: Object.freeze({ baseUrl: 'https://us.okx.com' }),
    ws: Object.freeze({ privateUrl: 'wss://wspap.okx.com/ws/v5/private', publicUrl: 'wss://wspap.okx.com/ws/v5/public', publicIsMainnet: false }),
  }),

  'okx-eea': Object.freeze({
    id: 'okx-eea', venue: 'okx', environment: ENVIRONMENT, label: 'OKX Demo (EEA region)', region: 'EEA',
    marketType: 'swap', category: 'SWAP', inherits: 'okx',
    rest: Object.freeze({ baseUrl: 'https://eea.okx.com' }),
    ws: Object.freeze({ privateUrl: 'wss://wspap.okx.com/ws/v5/private', publicUrl: 'wss://wspap.okx.com/ws/v5/public', publicIsMainnet: false }),
  }),

  'binance-usdm': Object.freeze({
    id: 'binance-usdm', venue: 'binance', environment: ENVIRONMENT, label: 'Binance Demo (USDⓈ-M Futures)',
    marketType: 'usdm', category: 'usdm',
    rest: Object.freeze({
      baseUrl: 'https://demo-fapi.binance.com',
      endpoints: Object.freeze({
        serverTime: '/fapi/v1/time', instruments: '/fapi/v1/exchangeInfo',
        ticker: '/fapi/v1/ticker/bookTicker', orderbook: '/fapi/v1/depth', candles: '/fapi/v1/klines',
        fundingHistory: '/fapi/v1/fundingRate', feeRate: '/fapi/v1/commissionRate',
        account: '/fapi/v3/account', positions: '/fapi/v3/positionRisk',
        createOrder: '/fapi/v1/order', amendOrder: '/fapi/v1/order', cancelOrder: '/fapi/v1/order',
        openOrders: '/fapi/v1/openOrders', order: '/fapi/v1/order', executions: '/fapi/v1/userTrades',
      }),
    }),
    ws: Object.freeze({ privateUrl: 'wss://demo-fstream.binance.com/ws', publicUrl: 'wss://demo-fstream.binance.com/stream', publicIsMainnet: false }),
    auth: Object.freeze({ style: 'binance', requiresSimulatedHeader: false }),
    rateLimit: Object.freeze({ weightPerMinute: 2400, orderWeight: 1, weightHeader: 'x-mbx-used-weight' }),
    retentionDays: null, // verify live
    wsTradeSupported: false,
    // Historical -1003 rate-limit/error-isolation finding (§64.1) must be
    // re-tested before order capability is enabled — capabilities stay UNKNOWN.
    capabilities: cap({ instruments: CAP.SUPPORTED, marketSnapshot: CAP.SUPPORTED, funding: CAP.SUPPORTED }),
  }),

  binance: Object.freeze({
    id: 'binance', venue: 'binance', environment: ENVIRONMENT, label: 'Binance Demo (Spot)',
    marketType: 'spot', category: 'spot',
    rest: Object.freeze({
      // Spot demo host could NOT be confirmed against official docs on
      // 2026-10-28 — capabilities stay UNKNOWN and fail closed until probed.
      baseUrl: 'https://demo-api.binance.com',
      endpoints: Object.freeze({
        serverTime: '/api/v3/time', instruments: '/api/v3/exchangeInfo',
        ticker: '/api/v3/ticker/bookTicker', orderbook: '/api/v3/depth', candles: '/api/v3/klines',
        account: '/api/v3/account', createOrder: '/api/v3/order', cancelOrder: '/api/v3/order',
        openOrders: '/api/v3/openOrders', order: '/api/v3/order', executions: '/api/v3/myTrades',
      }),
    }),
    ws: Object.freeze({ privateUrl: 'wss://demo-stream.binance.com/ws', publicUrl: 'wss://demo-stream.binance.com/stream', publicIsMainnet: false }),
    auth: Object.freeze({ style: 'binance', requiresSimulatedHeader: false }),
    rateLimit: Object.freeze({ weightPerMinute: 6000, orderWeight: 1, weightHeader: 'x-mbx-used-weight' }),
    retentionDays: null,
    wsTradeSupported: false,
    capabilities: cap({ funding: CAP.UNSUPPORTED }), // spot has no funding
  }),
})

/** Resolve a profile, applying `inherits` (regional OKX profiles extend okx). */
export function resolveProfile(profileId) {
  const id = String(profileId ?? '').toLowerCase()
  const base = VENUE_PROFILES[id]
  if (!base) throw Object.assign(new Error(`Unsupported demo venue profile: ${String(profileId)}`), { code: 'exchange.unsupported-profile' })
  if (!base.inherits) return base
  const parent = VENUE_PROFILES[base.inherits]
  if (!parent) throw Object.assign(new Error(`Profile ${id} inherits missing ${base.inherits}`), { code: 'exchange.unsupported-profile' })
  return Object.freeze({
    ...parent, ...base,
    rest: Object.freeze({ ...parent.rest, ...base.rest, endpoints: Object.freeze({ ...parent.rest.endpoints, ...(base.rest?.endpoints ?? {}) }) }),
    ws: Object.freeze({ ...parent.ws, ...base.ws }),
    auth: Object.freeze({ ...parent.auth, ...base.auth }),
    rateLimit: Object.freeze({ ...parent.rateLimit, ...base.rateLimit }),
    capabilities: Object.freeze({ ...parent.capabilities, ...base.capabilities }),
  })
}

export const PROFILE_IDS = Object.freeze(Object.keys(VENUE_PROFILES))

/** Profiles grouped by venue (for the venue selector / fallback order). */
export function profilesForVenue(venue) {
  return PROFILE_IDS.filter((id) => VENUE_PROFILES[id].venue === venue || resolveProfile(id).venue === venue)
}

/** True when every required capability in `required` is SUPPORTED in `caps`. */
export function capabilityOk(capabilities, required) {
  for (const key of required) {
    if (capabilities?.[key] !== CAP.SUPPORTED) return false
  }
  return true
}

/** Human-readable list of missing/unknown required capabilities (for UI/reports). */
export function capabilityGaps(capabilities, required) {
  const gaps = []
  for (const key of required) {
    const level = capabilities?.[key] ?? CAP.UNKNOWN
    if (level !== CAP.SUPPORTED) gaps.push({ capability: key, level })
  }
  return gaps
}

/** Capabilities required before an EXECUTION (order) may be enabled (§64.8). */
export const EXECUTION_REQUIRED_CAPS = Object.freeze(['account', 'order', 'cancel', 'openOrders', 'executions', 'positions'])
