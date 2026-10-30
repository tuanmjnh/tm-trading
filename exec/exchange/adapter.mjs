// =============================================================================
//  TM TRADING — V3.9 ExchangeDemoAdapter (§63.6/§64.3).
//
//  ONE contract, three venues. `createDemoAdapter` composes the registry
//  (profiles.mjs), signed REST client (http.mjs), normalization (normalize.mjs),
//  managed streams (stream.mjs), isolated health (health.mjs), throttling
//  (throttle.mjs) and reconciliation (reconcile.mjs) into the adapter object the
//  bot/AI runtime and API routes consume. Exchange-specific behaviour lives in
//  the per-venue branches here + normalize.mjs; consumers never touch raw payloads.
//
//  SAFETY:
//   - Every REST/WS call is allowlist-checked before I/O (http.mjs / stream.mjs).
//   - Order placement is capability-gated: it fails closed until a live probe has
//     VERIFIED the required capabilities (health.canExecute). A connected public
//     stream is never treated as proof that demo execution works.
//   - Order ops are never blind-retried; a timeout surfaces `order-uncertain` so
//     the caller reconciles by client order id first (reconcile-before-resend).
// =============================================================================

import { resolveProfile, CAP, EXECUTION_REQUIRED_CAPS, capabilityGaps, assertDemoWsHost } from './profiles.mjs'
import { createRestClient } from './http.mjs'
import { createStream } from './stream.mjs'
import { venueError } from './errors.mjs'
import { validateDemoOrder } from '../exchangeDemo.mjs'
import {
  normalizeAccount, normalizePositions, normalizeOrder, normalizeExecution,
  normalizeFeeSchedule, normalizeFundingObservation, normalizeInstrument,
} from './normalize.mjs'
import { dedupeFills, reconcileOrders, reconcilePositions, buildReconciliationResult, execKey } from './reconcile.mjs'

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Extract venue server time (ms) from a server-time response. */
function serverTimeOf(venue, payload) {
  if (venue === 'bybit') return num(payload?.result?.timeSecond) != null ? Number(payload.result.timeSecond) * 1000 : num(payload?.result?.timeNano) != null ? Number(payload.result.timeNano) / 1e6 : null
  if (venue === 'okx') return num(payload?.data?.[0]?.ts)
  return num(payload?.serverTime)
}

/**
 * @param {object} cfg {
 *   profileId, credentials, health (registry), throttle, fetchImpl, now,
 *   connectSocket, canonicalMapper(symbol)->canonicalId, persist (hooks),
 *   accountId, timeoutMs
 * }
 */
export function createDemoAdapter(cfg) {
  const profileId = String(cfg.profileId).toLowerCase()
  const profile = resolveProfile(profileId)
  const venue = profile.venue
  const credentials = cfg.credentials
  const now = cfg.now ?? (() => Date.now())
  const health = cfg.health
  const throttle = cfg.throttle
  const accountId = cfg.accountId ?? 'default'
  const canonical = cfg.canonicalMapper ?? (() => null)
  const persist = cfg.persist ?? {}
  const ctxBase = { accountId, canonical, ingestTime: now(), marketType: profile.marketType }

  const rest = createRestClient({ profileId, credentials, throttle, fetchImpl: cfg.fetchImpl, now, timeoutMs: cfg.timeoutMs })
  const E = (name) => rest.endpoint(name)

  // Venue-appropriate query params per operation.
  function q(op, extra = {}) {
    if (venue === 'bybit') return { category: profile.category, ...extra }
    if (venue === 'okx') {
      if (op === 'instruments') return { instType: profile.category, ...extra }
      if (op === 'ticker' || op === 'funding') return { instId: extra.symbol ?? extra.instId, ...stripSymbol(extra) }
      if (op === 'positions' || op === 'openOrders' || op === 'executions' || op === 'fee') return { instType: profile.category, ...extra }
      return { ...extra }
    }
    return { ...extra } // binance: symbol etc. passed through
  }
  const stripSymbol = (o) => { const { symbol, instId, ...rest2 } = o; return rest2 }
  const symbolParam = (symbol) => (venue === 'okx' ? { instId: symbol } : { symbol })

  async function getServerTime() {
    const payload = await rest.get(E('serverTime'), { weight: 1 })
    const t = serverTimeOf(venue, payload)
    if (t != null) {
      throttle?.setClockSkew(t)
      health?.setClockSkew(profileId, t - now())
    }
    return t
  }

  async function getCapabilities() {
    const declared = profile.capabilities
    const verified = health ? Object.fromEntries(EXECUTION_REQUIRED_CAPS.map((k) => [k, health.effectiveCapability(profileId, k)])) : {}
    const canExec = health ? health.canExecute(profileId) : { ok: false, gaps: capabilityGaps({}, EXECUTION_REQUIRED_CAPS) }
    return {
      venue, profileId, environment: 'DEMO', marketType: profile.marketType, category: profile.category,
      declared, verified, executionReady: canExec.ok, executionGaps: canExec.gaps,
      wsTradeSupported: profile.wsTradeSupported, retentionDays: profile.retentionDays,
      endpoints: { rest: profile.rest.baseUrl, privateWs: profile.ws.privateUrl, publicWs: profile.ws.publicUrl, publicIsMainnet: profile.ws.publicIsMainnet },
    }
  }

  function getHealth() {
    const rec = health?.getHealth(profileId)
    const cap = health ? health.effectiveCapabilities(profileId) : profile.capabilities
    const canExec = health ? health.canExecute(profileId) : { ok: false, gaps: capabilityGaps({}, EXECUTION_REQUIRED_CAPS) }
    return { ...(rec ?? { profileId, venue, status: 'DISCONNECTED' }), capabilities: cap, executionReady: canExec.ok, executionGaps: canExec.gaps, rateLimit: { ...(rec?.rateLimit ?? {}), remaining: throttle?.remaining?.() ?? null } }
  }

  async function getInstruments(query = {}) {
    const payload = await rest.get(E('instruments'), { params: q('instruments', query), weight: 1 })
    const list = venue === 'bybit' ? payload?.result?.list : venue === 'okx' ? payload?.data : (payload?.symbols ?? payload)
    return (list ?? []).map((raw) => normalizeInstrument(venue, raw, ctxBase))
  }

  async function getMarketSnapshot(symbol) {
    const payload = await rest.get(E('ticker'), { params: q('ticker', symbolParam(symbol)), weight: 1 })
    const row = venue === 'bybit' ? payload?.result?.list?.[0] : venue === 'okx' ? payload?.data?.[0] : payload
    const n = (k) => num(row?.[k])
    if (venue === 'bybit') return { venue, symbol, last: n('lastPrice'), bid: n('bid1Price'), ask: n('ask1Price'), markPrice: n('markPrice'), indexPrice: n('indexPrice'), fundingRate: n('fundingRate'), nextFundingTime: n('nextFundingTime'), source: 'venue-public', asOf: now() }
    if (venue === 'okx') return { venue, symbol, last: n('last'), bid: n('bidPx'), ask: n('askPx'), markPrice: null, indexPrice: null, fundingRate: null, nextFundingTime: null, source: 'venue-public', asOf: now() }
    return { venue, symbol, last: null, bid: n('bidPrice'), ask: n('askPrice'), markPrice: n('markPrice'), indexPrice: null, fundingRate: n('lastFundingRate'), nextFundingTime: null, source: 'venue-public', asOf: now() }
  }

  async function getRecentBars(query = {}) {
    const params = venue === 'okx' ? { instId: query.symbol, bar: query.interval ?? '1m', limit: query.limit ?? 200 } : venue === 'bybit' ? { category: profile.category, symbol: query.symbol, interval: query.interval ?? '1', limit: query.limit ?? 200 } : { symbol: query.symbol, interval: query.interval ?? '1m', limit: query.limit ?? 200 }
    const payload = await rest.get(E('candles'), { params, weight: 1 })
    const rows = venue === 'bybit' ? payload?.result?.list : venue === 'okx' ? payload?.data : payload
    return (rows ?? []).map((r) => (Array.isArray(r)
      ? { venue, symbol: query.symbol, openTime: num(r[0]), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) }
      : { venue, symbol: query.symbol, openTime: num(r.start ?? r.ts), open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume ?? r.vol) }))
  }

  async function getFeeSchedule(query = {}) {
    const params = venue === 'okx' ? { instType: profile.category } : venue === 'bybit' ? { category: profile.category, symbol: query.symbol } : { symbol: query.symbol }
    const payload = await rest.get(E('feeRate'), { params, weight: 1 })
    return normalizeFeeSchedule(venue, payload, { ...ctxBase, symbol: query.symbol })
  }

  async function getFundingSnapshot(query = {}) {
    const payload = await rest.get(E('fundingHistory'), { params: q('funding', symbolParam(query.symbol)), weight: 1 })
    return normalizeFundingObservation(venue, payload, { ...ctxBase, symbol: query.symbol })
  }

  async function getAccountSnapshot(scope = {}) {
    const params = venue === 'bybit' ? { accountType: 'UNIFIED' } : venue === 'okx' ? {} : {}
    const payload = await rest.get(E('account'), { params, weight: 2 })
    const acct = normalizeAccount(venue, payload, { ...ctxBase, accountId: scope.accountId ?? accountId })
    health?.setRestAccount(profileId, { status: 'up', latencyMs: null })
    return acct
  }

  async function getPositions(scope = {}) {
    const params = venue === 'bybit' ? { category: profile.category, settleCoin: 'USDT' } : venue === 'okx' ? { instType: profile.category } : {}
    const payload = await rest.get(E('positions'), { params, weight: 2 })
    return normalizePositions(venue, payload, { ...ctxBase, accountId: scope.accountId ?? accountId })
  }

  async function getOpenOrders(scope = {}) {
    const params = venue === 'bybit' ? { category: profile.category, settleCoin: 'USDT' } : venue === 'okx' ? { instType: profile.category } : {}
    const payload = await rest.get(E('openOrders'), { params, weight: 2 })
    const list = venue === 'bybit' ? payload?.result?.list : venue === 'okx' ? payload?.data : (payload?.orders ?? payload)
    return (list ?? []).map((o) => normalizeOrder(venue, o, ctxBase))
  }

  async function getOrder(clientOrderId, scope = {}) {
    const params = venue === 'bybit' ? { category: profile.category, orderLinkId: clientOrderId } : venue === 'okx' ? { clOrdId: clientOrderId } : { origClientOrderId: clientOrderId }
    const payload = await rest.get(E('order'), { params, weight: 1 })
    const raw = venue === 'bybit' ? payload?.result?.list?.[0] : venue === 'okx' ? payload?.data?.[0] : payload
    return raw ? normalizeOrder(venue, raw, ctxBase) : null
  }

  async function getExecutions(query = {}) {
    const params = venue === 'bybit' ? { category: profile.category, limit: query.limit ?? 50 } : venue === 'okx' ? { instType: profile.category, limit: query.limit ?? 50 } : { limit: query.limit ?? 50 }
    const payload = await rest.get(E('executions'), { params, weight: 2 })
    const list = venue === 'bybit' ? payload?.result?.list : venue === 'okx' ? payload?.data : payload
    return (list ?? []).map((e) => normalizeExecution(venue, e, ctxBase))
  }

  // --- order operations (capability-gated, fail-closed) ----------------------
  function assertCanExecute(op) {
    if (!health) throw venueError(venue, 'no-health-registry', 'adapter has no health registry to verify execution capability', { profileId })
    const gate = health.canExecute(profileId)
    if (!gate.ok) {
      throw venueError(venue, 'capability-unverified', `${op} refused: execution capability not verified (gaps: ${gate.gaps.map((g) => `${g.capability}=${g.level}`).join(', ')})`, { profileId })
    }
  }

  function orderBody(intent) {
    if (venue === 'bybit') return { category: profile.category, symbol: intent.symbol, side: intent.side, orderType: intent.type === 'limit' ? 'Limit' : 'Market', qty: String(intent.qty), orderLinkId: intent.clientOrderId, ...(intent.price ? { price: String(intent.price) } : {}) }
    if (venue === 'okx') return { instId: intent.symbol, tdMode: intent.tdMode ?? 'cross', side: intent.side.toLowerCase(), ordType: intent.type === 'limit' ? 'limit' : 'market', sz: String(intent.qty), clOrdId: intent.clientOrderId, ...(intent.price ? { px: String(intent.price) } : {}) }
    return { symbol: intent.symbol, side: intent.side, type: intent.type === 'limit' ? 'LIMIT' : 'MARKET', quantity: String(intent.qty), newClientOrderId: intent.clientOrderId, ...(intent.price ? { price: String(intent.price) } : {}), ...(profile.marketType === 'usdm' ? { reduceOnly: false } : {}) }
  }

  async function placeDemoOrder(intent) {
    validateDemoOrder({ symbol: intent.symbol, side: intent.side, qty: intent.qty, clientOrderId: intent.clientOrderId })
    assertCanExecute('placeDemoOrder')
    const body = orderBody(intent)
    const op = { method: 'POST', isOrderOp: true, op: 'createOrder', weight: profile.rateLimit.orderWeight ?? 1 }
    const payload = venue === 'binance'
      ? await rest.post(E('createOrder'), { ...op, params: body })
      : await rest.post(E('createOrder'), { ...op, body })
    const ack = {
      venue, profileId, environment: 'DEMO', accountId, sessionId: intent.sessionId ?? null,
      clientOrderId: intent.clientOrderId,
      externalOrderId: venue === 'bybit' ? payload?.result?.orderId : venue === 'okx' ? payload?.data?.[0]?.ordId : str(payload?.orderId),
      status: 'accepted', ackAt: now(), raw: undefined,
    }
    await persist.orderMapping?.({ ...ack, venueInstrumentId: intent.symbol, canonicalInstrumentId: canonical(intent.symbol) })
    return ack
  }

  async function amendDemoOrder(intent) {
    if (profile.capabilities.amend !== CAP.SUPPORTED) throw venueError(venue, 'amend-unsupported', 'amend not supported for this profile', { profileId })
    assertCanExecute('amendDemoOrder')
    const body = venue === 'bybit' ? { category: profile.category, symbol: intent.symbol, orderId: intent.externalOrderId, ...(intent.qty ? { qty: String(intent.qty) } : {}), ...(intent.price ? { price: String(intent.price) } : {}) }
      : venue === 'okx' ? { instId: intent.symbol, ordId: intent.externalOrderId, ...(intent.qty ? { newSz: String(intent.qty) } : {}), ...(intent.price ? { newPx: String(intent.price) } : {}) }
        : { symbol: intent.symbol, orderId: intent.externalOrderId, ...(intent.qty ? { quantity: String(intent.qty) } : {}), ...(intent.price ? { price: String(intent.price) } : {}) }
    const payload = venue === 'binance' ? await rest.put(E('amendOrder'), { isOrderOp: true, op: 'amendOrder', params: body }) : await rest.post(E('amendOrder'), { isOrderOp: true, op: 'amendOrder', body })
    return { venue, profileId, externalOrderId: intent.externalOrderId, status: 'amend-accepted', ackAt: now(), raw: payload }
  }

  async function cancelDemoOrder(intent) {
    assertCanExecute('cancelDemoOrder')
    const body = venue === 'bybit' ? { category: profile.category, symbol: intent.symbol, ...(intent.externalOrderId ? { orderId: intent.externalOrderId } : { orderLinkId: intent.clientOrderId }) }
      : venue === 'okx' ? { instId: intent.symbol, ...(intent.externalOrderId ? { ordId: intent.externalOrderId } : { clOrdId: intent.clientOrderId }) }
        : { symbol: intent.symbol, ...(intent.externalOrderId ? { orderId: intent.externalOrderId } : { origClientOrderId: intent.clientOrderId }) }
    const payload = venue === 'binance' ? await rest.del(E('cancelOrder'), { isOrderOp: true, op: 'cancelOrder', params: body }) : await rest.post(E('cancelOrder'), { isOrderOp: true, op: 'cancelOrder', body })
    return { venue, profileId, externalOrderId: intent.externalOrderId ?? null, clientOrderId: intent.clientOrderId ?? null, status: 'cancel-accepted', ackAt: now(), raw: payload }
  }

  // --- streams ---------------------------------------------------------------
  function subscribeMarket(query, onEvent) {
    // Public market feed is a READ-ONLY MARKET DATA SOURCE (may be mainnet public).
    const url = profile.ws.publicUrl
    const topics = venue === 'bybit' ? [`tickers.${query.symbol}`] : venue === 'okx' ? [{ channel: 'tickers', instId: query.symbol }] : [`${String(query.symbol).toLowerCase()}@bookTicker`]
    const stream = createStream({ profileId, venue, channel: 'public', url, credentials, connectSocket: cfg.connectSocket, topics, now, onMessage: (msg, meta) => { health?.markPublicEvent(profileId); onEvent?.({ venue, symbol: query.symbol, raw: msg, source: profile.ws.publicIsMainnet ? 'mainnet-public' : 'demo-public', ...meta }) }, onStatus: (s) => { health?.setPublicStream(profileId, { status: s.state === 'connected' ? 'connected' : s.state, reconnects: s.reconnects }) } })
    stream.start()
    return () => stream.close()
  }

  async function subscribePrivate(scope, handlers = {}) {
    assertDemoWsHost(venue, profile.ws.privateUrl)
    let url = profile.ws.privateUrl
    // Binance private stream needs a REST listenKey embedded in the URL.
    if (venue === 'binance') {
      const lk = await rest.post('/fapi/v1/listenKey', { weight: 1 }).catch(() => null)
      const key = lk?.listenKey
      if (!key) throw venueError(venue, 'listenkey-unavailable', 'could not obtain private listenKey', { profileId })
      url = `${profile.ws.privateUrl.replace(/\/ws$/, '')}/ws/${key}`
    }
    const topics = venue === 'bybit' ? ['orders', 'executions', 'positions', 'wallet'] : venue === 'okx' ? [{ channel: 'orders', instType: profile.category }, { channel: 'positions', instType: profile.category }, { channel: 'account' }] : []
    const stream = createStream({
      profileId, venue, channel: 'private', url, credentials, connectSocket: cfg.connectSocket, topics, now,
      onMessage: (msg, meta) => {
        health?.markPrivateEvent(profileId)
        handlers.onRaw?.(msg, meta)
        // Best-effort canonical dispatch; the persistence layer dedupes by execKey.
        const list = venue === 'bybit' ? msg?.data : venue === 'okx' ? (msg?.data ?? []) : (Array.isArray(msg) ? msg : [msg])
        if (handlers.onExecution && venue === 'bybit' && msg?.topic === 'executions') handlers.onExecution((msg.data ?? []).map((e) => normalizeExecution(venue, e, ctxBase)), meta)
        else if (handlers.onExecution && venue === 'okx' && msg?.arg?.channel === 'fills') handlers.onExecution((msg.data ?? []).map((e) => normalizeExecution(venue, e, ctxBase)), meta)
        else if (handlers.onOrder && venue === 'bybit' && msg?.topic === 'orders') handlers.onOrder((msg.data ?? []).map((o) => normalizeOrder(venue, o, ctxBase)), meta)
        else if (handlers.onOrder && venue === 'okx' && msg?.arg?.channel === 'orders') handlers.onOrder((msg.data ?? []).map((o) => normalizeOrder(venue, o, ctxBase)), meta)
        void list
      },
      onStatus: (s) => { health?.setPrivateStream(profileId, { status: s.state === 'connected' ? 'connected' : s.state, reconnects: s.reconnects, authenticated: s.authenticated }); handlers.onStatus?.(s) },
      onResync: async () => { await reconcile({ reason: 'reconnect' }); handlers.onResync?.() },
    })
    stream.start()
    return () => stream.close()
  }

  // --- reconciliation --------------------------------------------------------
  async function reconcile(input = {}) {
    const [venueOrders, venuePositions] = await Promise.all([
      getOpenOrders({ accountId }).catch(() => null),
      getPositions({ accountId }).catch(() => null),
    ])
    const localOrders = input.localOrders ?? []
    const localPositions = input.localPositions ?? []
    const incomingFills = input.incomingFills ?? []
    const existingKeys = input.existingFillKeys ?? []
    const fills = dedupeFills(existingKeys, incomingFills)
    const orders = reconcileOrders(localOrders, venueOrders ?? [])
    const positions = reconcilePositions(localPositions, venuePositions ?? [])
    const result = buildReconciliationResult({ fills, orders, positions, at: now() })
    health?.markReconciled(profileId, { missing: result.counts.missing, duplicate: result.counts.duplicate, unresolved: result.counts.unresolved })
    await persist.reconciliation?.({ profileId, venue, accountId, sessionId: input.sessionId ?? null, result, reason: input.reason ?? 'manual' })
    return result
  }

  return {
    venue, profileId, environment: 'DEMO', accountId,
    getCapabilities, getHealth, getServerTime, getInstruments, getMarketSnapshot, getRecentBars,
    getFeeSchedule, getFundingSnapshot, getAccountSnapshot, getPositions, getOpenOrders, getOrder, getExecutions,
    placeDemoOrder, amendDemoOrder, cancelDemoOrder, subscribeMarket, subscribePrivate, reconcile,
    // expose for tests/telemetry
    _internals: { profile, rest, throttle, health, execKey },
  }
}

function str(v) { return v == null ? null : String(v) }
