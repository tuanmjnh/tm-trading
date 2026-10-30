import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  VENUE_PROFILES, resolveProfile, CAP, VENUES, EXECUTION_REQUIRED_CAPS,
  assertDemoRestHost, assertDemoWsHost, assertSimulatedTradingHeader, capabilityGaps,
} from './profiles.mjs'
import { createHealthRegistry, VENUE_STATUS } from './health.mjs'
import { createThrottleRegistry } from './throttle.mjs'
import { createExchangeRuntime } from './index.mjs'
import { sanitizeText, venueError, classifyError } from './errors.mjs'
import { dedupeFills, reconcileOrders, buildReconciliationResult, execKey } from './reconcile.mjs'
import {
  resolveMarketSource, onExecutionVenueFailure, assertExecutionVenueImmutable,
  canSwitchForNextSession, planVenueSwitch, MARKET_DATA_POLICY, FAILOVER_CODES,
} from './failover.mjs'
import { createStream } from './stream.mjs'
import { _sanitizeVenuePreference } from './venuePreferenceStore.mjs'
import { createSession, EXECUTION_MODES } from '../../engine/session.mjs'
import { persistEvent, persistExecutions, idempotencyKeyFor } from './eventStore.mjs'
import { executeExchangeDemoIntent } from './executeIntent.mjs'
import { routeExchangeDemoIntent } from './botBridge.mjs'

const credentials = { apiKey: 'demo-key-1234', apiSecret: 'demo-secret-5678', passphrase: 'demo-pass' }

// --- mock fetch ---------------------------------------------------------------
function mockResponse(payload, { ok = true, status = 200, headers = {} } = {}) {
  return { ok, status, headers: { get: (k) => headers[k] ?? headers[String(k).toLowerCase()] ?? null }, json: async () => payload }
}
function mockFetch(router) {
  const calls = []
  const impl = async (url, init) => {
    const u = new URL(url)
    calls.push({ url: String(url), origin: u.origin, path: u.pathname, method: init.method, headers: init.headers, body: init.body })
    const hit = router.find((r) => r.path === u.pathname && (!r.method || r.method === init.method))
    if (!hit) return mockResponse({ retCode: 0, code: '0', result: {}, data: [] })
    if (hit.throw) { const e = new Error('timeout'); e.name = 'AbortError'; throw e }
    return mockResponse(hit.payload, hit.opts ?? {})
  }
  impl.calls = calls
  return impl
}

// =============================================================================
test('P1 allowlist: demo hosts accepted, production hosts rejected before I/O', () => {
  assert.equal(assertDemoRestHost('bybit', 'https://api-demo.bybit.com'), 'api-demo.bybit.com')
  assert.equal(assertDemoWsHost('bybit', 'wss://stream-demo.bybit.com/v5/private'), 'stream-demo.bybit.com')
  assert.equal(assertDemoRestHost('binance', 'https://demo-fapi.binance.com'), 'demo-fapi.binance.com')
  assert.equal(assertDemoWsHost('binance', 'wss://demo-fstream.binance.com/ws'), 'demo-fstream.binance.com')
  assert.equal(assertDemoRestHost('okx', 'https://www.okx.com'), 'www.okx.com')
  assert.equal(assertDemoWsHost('okx', 'wss://wspap.okx.com/ws/v5/private'), 'wspap.okx.com')
  // production hosts rejected
  assert.throws(() => assertDemoRestHost('bybit', 'https://api.bybit.com'), { code: 'exchange.demo-host-required' })
  assert.throws(() => assertDemoRestHost('binance', 'https://api.binance.com'), { code: 'exchange.demo-host-required' })
  assert.throws(() => assertDemoRestHost('binance', 'https://fapi.binance.com'), { code: 'exchange.demo-host-required' })
  assert.throws(() => assertDemoWsHost('bybit', 'wss://stream.bybit.com/v5/private'), { code: 'exchange.demo-ws-host-required' })
  assert.throws(() => assertDemoWsHost('okx', 'wss://ws.okx.com/ws/v5/private'), { code: 'exchange.demo-ws-host-required' })
  // non-https / non-wss rejected
  assert.throws(() => assertDemoRestHost('bybit', 'http://api-demo.bybit.com'), { code: 'exchange.demo-host-required' })
})

test('P2 OKX simulated-trading header is mandatory (shared live/demo host)', () => {
  assert.doesNotThrow(() => assertSimulatedTradingHeader('okx', { 'x-simulated-trading': '1' }))
  assert.throws(() => assertSimulatedTradingHeader('okx', {}), { code: 'exchange.simulated-header-required' })
  assert.throws(() => assertSimulatedTradingHeader('okx', { 'x-simulated-trading': '0' }), { code: 'exchange.simulated-header-required' })
  assert.doesNotThrow(() => assertSimulatedTradingHeader('bybit', {})) // not required for bybit
})

test('P1 registry: three venues, regional inheritance, capabilities fail closed', () => {
  assert.deepEqual([...new Set(Object.values(VENUE_PROFILES).map((p) => p.venue))].sort(), ['binance', 'bybit', 'okx'])
  const okxUs = resolveProfile('okx-us')
  assert.equal(okxUs.rest.baseUrl, 'https://us.okx.com')
  assert.equal(okxUs.auth.requiresSimulatedHeader, true) // inherited from okx
  assert.equal(okxUs.rest.endpoints.account, '/api/v5/account/balance') // inherited
  // Binance spot/futures capabilities stay UNKNOWN (fail closed) until probed
  assert.equal(VENUE_PROFILES.binance.capabilities.order, CAP.UNKNOWN)
  assert.equal(VENUE_PROFILES['binance-usdm'].capabilities.order, CAP.UNKNOWN)
  assert.equal(capabilityGaps({ order: CAP.UNKNOWN }, ['order']).length, 1)
})

test('P1 throttle isolation: one venue exhausting budget never affects another', () => {
  const reg = createThrottleRegistry({ now: () => 1_000 })
  const bybit = reg.get('bybit')
  const okx = reg.get('okx')
  // exhaust bybit budget
  let guard = 0
  while (bybit.reserve(100).ok && guard++ < 100) { /* drain */ }
  assert.ok(bybit.remaining() < 100)
  // okx budget untouched
  assert.equal(okx.remaining(), okx.state.budgetPerMinute)
  assert.ok(okx.reserve(1).ok)
  // backoff on bybit does not touch okx
  bybit.backoff({ retryAfterMs: 5000 })
  assert.ok(okx.reserve(1).ok)
})

test('P1 health isolation: one venue down never marks another unhealthy', () => {
  const h = createHealthRegistry({ now: () => 10_000 })
  h.setRestAccount('bybit', { status: 'up' })
  h.setPublicStream('bybit', { status: 'connected' })
  h.markPublicEvent('bybit')
  h.setRestAccount('okx', { status: 'down', errorCode: 'exchange.okx.50011' })
  assert.equal(h.getHealth('bybit').status, VENUE_STATUS.READY)
  assert.equal(h.getHealth('okx').status, VENUE_STATUS.DEGRADED)
  // binance untouched -> disconnected, not down
  assert.equal(h.getHealth('binance-usdm').status, VENUE_STATUS.DISCONNECTED)
})

test('P1 capability gating: execution fails closed until verified SUPPORTED', () => {
  const h = createHealthRegistry({ now: () => 1 })
  assert.equal(h.canExecute('bybit').ok, false) // declared SUPPORTED but NOT verified
  for (const c of EXECUTION_REQUIRED_CAPS) h.verifyCapability('bybit', c, CAP.SUPPORTED)
  assert.equal(h.canExecute('bybit').ok, true)
  // a failed probe keeps it closed
  h.verifyCapability('binance-usdm', 'order', CAP.UNKNOWN)
  assert.equal(h.canExecute('binance-usdm').ok, false)
})

test('P5 reconcile: fill dedupe is venue+account scoped (no cross-venue collision)', () => {
  const bybitFill = { venue: 'bybit', accountId: 'a', execId: 'E1' }
  const okxSameId = { venue: 'okx', accountId: 'a', execId: 'E1' } // same execId, different venue
  const existing = [execKey(bybitFill)]
  const { accepted, duplicates } = dedupeFills(existing, [bybitFill, okxSameId])
  assert.equal(duplicates.length, 1) // bybit E1 is a duplicate
  assert.equal(accepted.length, 1) // okx E1 accepted (different venue namespace)
  assert.equal(accepted[0].venue, 'okx')
  assert.notEqual(execKey(bybitFill), execKey(okxSameId))
})

test('P5 reconcile: order REST-vs-stream detects missing + unresolved', () => {
  const local = [{ externalOrderId: '1', clientOrderId: 'tm-1', status: 'filled' }, { externalOrderId: '2', clientOrderId: 'tm-2', status: 'pending' }]
  const venue = [{ externalOrderId: '1', clientOrderId: 'tm-1', status: 'filled' }, { externalOrderId: '3', clientOrderId: 'tm-3', status: 'pending' }]
  const r = reconcileOrders(local, venue)
  assert.equal(r.matched, 1)
  assert.equal(r.missing.length, 1) // venue order 3 not local
  assert.equal(r.unresolved.length, 1) // local order 2 pending but gone from venue
  const summary = buildReconciliationResult({ orders: r })
  assert.equal(summary.status, 'UNRECONCILED')
  assert.ok(summary.counts.unresolved > 0)
})

test('P4 market-data failover: PREFERRED_ONLY pauses instead of switching', () => {
  const res = resolveMarketSource({ preferredVenue: 'bybit', policy: MARKET_DATA_POLICY.PREFERRED_ONLY, fallbackOrder: ['okx', 'binance'], marketHealth: { bybit: 'down', okx: 'up' }, at: 1 })
  assert.equal(res.isFallback, false)
  assert.equal(res.pauseEntries, true)
  assert.equal(res.code, FAILOVER_CODES.MARKET_FALLBACK_DISABLED)
})

test('P4 market-data failover: ALLOW_REFERENCE_FAILOVER switches, labels + emits event', () => {
  const res = resolveMarketSource({ preferredVenue: 'bybit', policy: MARKET_DATA_POLICY.ALLOW_REFERENCE_FAILOVER, fallbackOrder: ['okx', 'binance'], marketHealth: { bybit: 'down', okx: 'up' }, at: 5 })
  assert.equal(res.isFallback, true)
  assert.equal(res.source, 'okx')
  assert.match(res.labelled, /FALLBACK DATA SOURCE: OKX \(REFERENCE ONLY/)
  assert.equal(res.event?.type, 'market.source-switched')
  assert.equal(res.event.reference, true)
  assert.equal(res.event.newVenue, 'okx')
})

test('P4 market-data failover: strategy needing native mark pauses (never cross-venue mark)', () => {
  const res = resolveMarketSource({ preferredVenue: 'bybit', policy: MARKET_DATA_POLICY.ALLOW_REFERENCE_FAILOVER, fallbackOrder: ['okx'], strategyRequiresNativeMark: true, marketHealth: { bybit: 'down', okx: 'up' }, at: 1 })
  assert.equal(res.pauseEntries, true)
  assert.equal(res.isFallback, false)
  assert.equal(res.code, FAILOVER_CODES.MARKET_NATIVE_REQUIRED_PAUSED)
})

test('P4 execution failover: never auto-switches, marks DEGRADED, blocks entries', () => {
  const res = onExecutionVenueFailure({})
  assert.equal(res.switchVenue, false)
  assert.equal(res.sessionState, VENUE_STATUS.DEGRADED)
  assert.equal(res.blockNewEntries, true)
  assert.equal(res.preserveVenueOwnership, true)
})

test('P4 execution venue is immutable for an active session', () => {
  const active = { sessionId: 's1', state: 'running', executionVenue: 'bybit' }
  const bad = assertExecutionVenueImmutable({ session: active, requestedVenue: 'okx', now: 1 })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, FAILOVER_CODES.EXEC_IMMUTABLE_VIOLATION)
  assert.equal(bad.audit.type, 'execution.switch-rejected')
  // same venue is fine
  assert.equal(assertExecutionVenueImmutable({ session: active, requestedVenue: 'bybit' }).ok, true)
})

test('P4 switch-for-next-session requires flat + no pending orders', () => {
  const notFlat = canSwitchForNextSession({ currentVenue: 'bybit', targetVenue: 'okx', openPositions: [{ symbol: 'BTC' }], openOrders: [] })
  assert.equal(notFlat.ok, false)
  assert.equal(notFlat.code, FAILOVER_CODES.EXEC_SWITCH_REQUIRES_FLAT)
  const flat = canSwitchForNextSession({ currentVenue: 'bybit', targetVenue: 'okx', openPositions: [], openOrders: [] })
  assert.equal(flat.ok, true)
  const plan = planVenueSwitch({ currentVenue: 'bybit', targetVenue: 'okx', gate: flat, now: 9 })
  assert.equal(plan.startsNewSession, true)
  assert.equal(plan.migratesPositions, false)
  assert.equal(plan.mergesPnl, false)
  assert.equal(plan.audit.type, 'execution.switch-requested')
})

test('errors: secrets sanitized, namespaced per venue, classified', () => {
  const dirty = 'failed sig=X-MBX-APIKEY=ABCD1234secret https://x/api?signature=deadbeefdeadbeefdeadbeefdeadbeef&apiKey=k'
  const clean = sanitizeText(dirty)
  assert.ok(!clean.includes('deadbeefdeadbeef'))
  const e = venueError('okx', 'boom', 'okx failed', { profileId: 'okx' })
  assert.equal(e.code, 'exchange.okx.boom')
  assert.equal(e.venue, 'okx')
  const c = classifyError(Object.assign(new Error('x'), { code: 'exchange.binance.-1003', retryable: true }))
  assert.equal(c.rateLimited, true)
  assert.equal(c.venue, null) // code not namespaced with venue field here
})

// --- adapter with mock fetch --------------------------------------------------
test('adapter: bybit account/positions/orders/executions normalize from demo host', async () => {
  const health = createHealthRegistry({ now: () => 1000 })
  const throttles = createThrottleRegistry({ now: () => 1000 })
  const fetchImpl = mockFetch([
    { path: '/v5/account/wallet-balance', payload: { retCode: 0, result: { list: [{ totalEquity: '100000', coin: [{ coin: 'USDT', equity: '100000', availableToWithdraw: '99000', unrealisedPnl: '10' }] }] } } },
    { path: '/v5/position/list', payload: { retCode: 0, result: { list: [{ symbol: 'BTCUSDT', side: 'Buy', size: '0.10', entryPrice: '50000', markPrice: '51000', unrealisedPnl: '100', leverage: '10', positionId: 'p1' }] } } },
    { path: '/v5/order/realtime', payload: { retCode: 0, result: { list: [{ orderId: 'o1', orderLinkId: 'tm-1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.1', cumExecQty: '0.1', orderStatus: 'Filled' }] } } },
    { path: '/v5/execution/list', payload: { retCode: 0, result: { list: [{ execId: 'e1', orderId: 'o1', orderLinkId: 'tm-1', symbol: 'BTCUSDT', side: 'Buy', execQty: '0.1', execPrice: '50000', execFee: '0.05', feeCurrency: 'USDT', isMaker: false, execTime: '1700000000000' }] } } },
  ])
  const rt = createExchangeRuntime({ fetchImpl, now: () => 1000 })
  const adapter = rt.getAdapter({ ownerId: 'u1', profileId: 'bybit', credentials, accountId: 'acc1' })
  const acct = await adapter.getAccountSnapshot({})
  assert.equal(acct.venue, 'bybit')
  assert.equal(acct.totalEquity, 100000)
  const pos = await adapter.getPositions({})
  assert.equal(pos[0].side, 'LONG')
  assert.equal(pos[0].unrealisedPnl, 100)
  const orders = await adapter.getOpenOrders({})
  assert.equal(orders[0].externalOrderId, 'o1')
  assert.equal(orders[0].status, 'filled')
  const execs = await adapter.getExecutions({})
  assert.equal(execs[0].execId, 'e1')
  assert.equal(execs[0].feeState, 'VERIFIED_VENUE')
  // every call hit the demo host only
  assert.ok(fetchImpl.calls.every((c) => c.origin === 'https://api-demo.bybit.com'))
  void health; void throttles
})

test('adapter: placeDemoOrder fails closed until capabilities verified', async () => {
  const fetchImpl = mockFetch([{ path: '/v5/order/create', method: 'POST', payload: { retCode: 0, result: { orderId: 'by-ord-1' } } }])
  const rt = createExchangeRuntime({ fetchImpl, now: () => 1 })
  const persisted = []
  const adapter = rt.getAdapter({ ownerId: 'u1', profileId: 'bybit', credentials, accountId: 'a', persist: { orderMapping: async (m) => persisted.push(m) } })
  const intent = { symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, clientOrderId: 'tm-abcdef-0', type: 'market' }
  await assert.rejects(adapter.placeDemoOrder(intent), /capability not verified/)
  assert.equal(fetchImpl.calls.length, 0) // refused BEFORE network I/O
  // verify caps, then it succeeds + persists mapping
  for (const c of EXECUTION_REQUIRED_CAPS) rt.health.verifyCapability('bybit', c, CAP.SUPPORTED)
  const ack = await adapter.placeDemoOrder(intent)
  assert.equal(ack.externalOrderId, 'by-ord-1')
  assert.equal(persisted.length, 1)
  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(fetchImpl.calls[0].origin, 'https://api-demo.bybit.com')
})

test('adapter: timed-out order surfaces order-uncertain, never blind-retried', async () => {
  const fetchImpl = mockFetch([{ path: '/v5/order/create', method: 'POST', throw: true }])
  const rt = createExchangeRuntime({ fetchImpl, now: () => 1 })
  for (const c of EXECUTION_REQUIRED_CAPS) rt.health.verifyCapability('bybit', c, CAP.SUPPORTED)
  const adapter = rt.getAdapter({ ownerId: 'u1', profileId: 'bybit', credentials, accountId: 'a' })
  await assert.rejects(
    adapter.placeDemoOrder({ symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, clientOrderId: 'tm-abcdef-0', type: 'market' }),
    (err) => err.code === 'exchange.bybit.order-uncertain',
  )
  assert.equal(fetchImpl.calls.length, 1) // exactly one attempt — no duplicate order
})

test('adapter: okx adapter always sends x-simulated-trading:1 to demo host', async () => {
  const fetchImpl = mockFetch([{ path: '/api/v5/account/balance', payload: { code: '0', data: [{ totalEq: '50000', details: [{ ccy: 'USDT', eq: '50000', availBal: '49000' }] }] } }])
  const rt = createExchangeRuntime({ fetchImpl, now: () => 1 })
  const adapter = rt.getAdapter({ ownerId: 'u1', profileId: 'okx', credentials, accountId: 'a' })
  const acct = await adapter.getAccountSnapshot({})
  assert.equal(acct.totalEquity, 50000)
  assert.equal(fetchImpl.calls[0].origin, 'https://www.okx.com')
  assert.equal(fetchImpl.calls[0].headers['x-simulated-trading'], '1')
})

test('adapter: binance-usdm reads stay on demo-fapi host', async () => {
  const fetchImpl = mockFetch([{ path: '/fapi/v3/account', payload: { totalWalletBalance: '20000', assets: [{ asset: 'USDT', marginBalance: '20000', availableBalance: '19000' }], positions: [] } }])
  const rt = createExchangeRuntime({ fetchImpl, now: () => 1 })
  const adapter = rt.getAdapter({ ownerId: 'u1', profileId: 'binance-usdm', credentials, accountId: 'a' })
  const acct = await adapter.getAccountSnapshot({})
  assert.equal(acct.totalEquity, 20000)
  assert.equal(fetchImpl.calls[0].origin, 'https://demo-fapi.binance.com')
})

// --- stream (fake socket) -----------------------------------------------------
class FakeSocket {
  constructor(url) { this.url = url; this.handlers = {}; this.sent = []; this.closed = false }
  addEventListener(ev, cb) { this.handlers[ev] = cb }
  send(d) { this.sent.push(d) }
  close() { this.closed = true; this.handlers.close?.({}) }
  emitOpen() { this.handlers.open?.({}) }
  emitMessage(data) { this.handlers.message?.({ data: typeof data === 'string' ? data : JSON.stringify(data) }) }
}

test('stream: private connect authenticates + subscribes; message delivered', () => {
  const sockets = []
  const got = []
  const s = createStream({
    profileId: 'bybit', venue: 'bybit', channel: 'private', url: 'wss://stream-demo.bybit.com/v5/private',
    credentials, topics: ['orders'], connectSocket: (url) => { const sock = new FakeSocket(url); sockets.push(sock); return sock },
    onMessage: (m) => got.push(m), now: () => 1000,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  })
  s.start()
  sockets[0].emitOpen()
  assert.ok(sockets[0].sent.some((d) => JSON.parse(d).op === 'auth'))
  assert.ok(sockets[0].sent.some((d) => JSON.parse(d).op === 'subscribe'))
  sockets[0].emitMessage({ topic: 'orders', data: [{ orderId: 'o1' }] })
  assert.equal(got.length, 1)
  s.close()
})

test('stream: refuses to open a non-demo private host', () => {
  assert.throws(() => createStream({ profileId: 'bybit', venue: 'bybit', channel: 'private', url: 'wss://stream.bybit.com/v5/private', credentials, connectSocket: () => new FakeSocket('x') }), { code: 'exchange.demo-ws-host-required' })
})

test('stream: close triggers reconnect with resync on reconnection', () => {
  const sockets = []
  let reconnectCb = null
  let resyncs = 0
  const s = createStream({
    profileId: 'okx', venue: 'okx', channel: 'private', url: 'wss://wspap.okx.com/ws/v5/private',
    credentials, topics: [], connectSocket: (url) => { const sock = new FakeSocket(url); sockets.push(sock); return sock },
    onResync: () => { resyncs += 1 }, now: () => 1000,
    setInterval: () => 0, clearInterval: () => {},
    setTimeout: (fn) => { reconnectCb = fn; return 0 }, clearTimeout: () => {},
  })
  s.start()
  sockets[0].emitOpen()
  sockets[0].close() // unexpected close -> scheduleReconnect stores cb
  assert.equal(typeof reconnectCb, 'function')
  reconnectCb() // fire reconnect
  sockets[1].emitOpen()
  assert.equal(resyncs, 1) // resync ran on reconnection
  s.close()
})

test('VENUES constant lists exactly the three supported venues', () => {
  assert.deepEqual([...VENUES].sort(), ['binance', 'bybit', 'okx'])
})

// --- P4 session venue binding (pure) -----------------------------------------
test('P4 session: default executionMode is INTERNAL_PAPER (legacy unchanged)', () => {
  const doc = createSession({ now: 1000 })
  assert.equal(doc.executionMode, 'INTERNAL_PAPER')
  assert.equal(doc.executionVenue, null)
  assert.ok(EXECUTION_MODES.includes('EXCHANGE_DEMO'))
})

test('P4 session: EXCHANGE_DEMO binds an immutable executionVenue', () => {
  const doc = createSession({ now: 1000, executionMode: 'EXCHANGE_DEMO', executionVenue: 'bybit', exchangeConnectionId: 'u1:bybit', marketDataVenue: 'bybit' })
  assert.equal(doc.executionMode, 'EXCHANGE_DEMO')
  assert.equal(doc.executionVenue, 'bybit')
  assert.equal(doc.exchangeConnectionId, 'u1:bybit')
  // EXCHANGE_DEMO without a venue fails closed
  assert.throws(() => createSession({ now: 1000, executionMode: 'EXCHANGE_DEMO' }), /requires an executionVenue/)
  assert.throws(() => createSession({ now: 1000, executionMode: 'LIVE_MAINNET' }), /executionMode must be one of/)
})

test('P4 preference sanitize forces DEMO + manual-new-session, strips preferred from fallback', () => {
  const p = _sanitizeVenuePreference({ preferredVenue: 'okx', executionEnvironment: 'PRODUCTION', marketDataPolicy: 'ALLOW_REFERENCE_FAILOVER', marketDataFallbackOrder: ['okx', 'bybit', 'binance', 'okx', 'kraken'], executionSwitchPolicy: 'AUTOMATIC' })
  assert.equal(p.executionEnvironment, 'DEMO') // forced, never production
  assert.equal(p.executionSwitchPolicy, 'MANUAL_NEW_SESSION_ONLY') // forced, never auto
  assert.equal(p.preferredVenue, 'okx')
  assert.deepEqual(p.marketDataFallbackOrder, ['bybit', 'binance']) // preferred + dupes + unknown removed
})

// --- P5 idempotent persistence (fake in-memory model, no DB) ------------------
function fakeModel() {
  const store = new Map()
  return {
    _store: store,
    findOne({ _id }) { return { lean: async () => (store.has(_id) ? { ...store.get(_id) } : null) } },
    async updateOne({ _id }, { $set, $setOnInsert }) {
      const existing = store.get(_id)
      store.set(_id, { ...(existing ?? {}), ...(existing ? {} : ($setOnInsert ?? {})), ...$set })
      return { acknowledged: true }
    },
    find() { return { sort: () => ({ limit: () => ({ lean: async () => [...store.values()] }) }) } },
  }
}

test('P5 persistEvent is idempotent (re-delivery upserts, never duplicates)', async () => {
  const M = fakeModel()
  const ev = { venue: 'bybit', accountId: 'a', kind: 'order', externalOrderId: 'o1', clientOrderId: 'tm-1', eventTime: 5 }
  const first = await persistEvent('u1', ev, { _models: { ExchangeEvent: M } })
  const second = await persistEvent('u1', ev, { _models: { ExchangeEvent: M } })
  assert.equal(first.inserted, true)
  assert.equal(second.inserted, false)
  assert.equal(M._store.size, 1)
  assert.equal(first.id, second.id)
})

test('P5 persistExecutions dedupes fills and never collides across venues', async () => {
  const M = fakeModel()
  const scope = { venue: 'bybit', accountId: 'a', sessionId: 's1' }
  const fill = { execId: 'E1', venue: 'bybit', accountId: 'a', symbol: 'BTCUSDT', side: 'BUY', fillQty: 0.1, fillPrice: 50000, feeAmount: 0.05, feeState: 'VERIFIED_VENUE' }
  const r1 = await persistExecutions('u1', scope, [fill], { _models: { ExchangeEvent: M } })
  assert.equal(r1.accepted.length, 1)
  // re-delivery of the same fill is a duplicate
  const r2 = await persistExecutions('u1', scope, [fill], { _models: { ExchangeEvent: M } })
  assert.equal(r2.accepted.length, 0)
  assert.equal(r2.duplicates.length, 1)
  assert.equal(M._store.size, 1)
  // same execId on a DIFFERENT venue is a distinct record (no cross-venue collision)
  const okx = { ...fill, venue: 'okx' }
  const r3 = await persistExecutions('u1', { venue: 'okx', accountId: 'a' }, [okx], { _models: { ExchangeEvent: M } })
  assert.equal(r3.accepted.length, 1)
  assert.equal(M._store.size, 2)
  assert.notEqual(idempotencyKeyFor({ ...fill, kind: 'execution' }), idempotencyKeyFor({ ...okx, kind: 'execution' }))
})

// --- P8 order-intent pipeline (mock adapter + mock risk gate + fake models) ---
function mockAdapter(venue, behavior) {
  return { venue, profileId: venue, placeDemoOrder: async (intent) => behavior(intent) }
}
const okRisk = async () => ({ ok: true, qty: 0.01, notional: 500, code: 'OK' })
const rejectRisk = async () => ({ ok: false, code: 'RISK_REJECT', message: 'blocked by risk gate' })
const demoSession = (venue = 'bybit', mode = 'EXCHANGE_DEMO') => ({ sessionId: 's1', state: 'running', executionMode: mode, executionVenue: venue, accountId: 'a' })
const demoIntent = { symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, price: 50000, sl: 49000, tps: [52000], alertKey: 'a1_abcdef0123456789abcdef' }

test('P8 intent: refuses when session is not EXCHANGE_DEMO', async () => {
  const res = await executeExchangeDemoIntent({ ownerId: 'u1', session: demoSession('bybit', 'INTERNAL_PAPER'), intent: demoIntent, adapter: mockAdapter('bybit', () => ({ externalOrderId: 'x' })), checkOrder: okRisk, now: 1, models: { ExchangeEvent: fakeModel(), ExchangeOrderMapping: fakeModel() } })
  assert.equal(res.status, 'REJECTED_NOT_EXCHANGE_DEMO')
})

test('P8 intent: immutable execution venue — adapter venue must equal session venue', async () => {
  const res = await executeExchangeDemoIntent({ ownerId: 'u1', session: demoSession('bybit'), intent: demoIntent, adapter: mockAdapter('okx', () => ({ externalOrderId: 'x' })), checkOrder: okRisk, now: 1, models: { ExchangeEvent: fakeModel(), ExchangeOrderMapping: fakeModel() } })
  assert.equal(res.status, 'REJECTED_IMMUTABLE_VENUE')
})

test('P8 intent: Risk Gate rejection stops before the venue is touched', async () => {
  let placed = false
  const res = await executeExchangeDemoIntent({ ownerId: 'u1', session: demoSession(), intent: demoIntent, adapter: mockAdapter('bybit', () => { placed = true; return { externalOrderId: 'x' } }), checkOrder: rejectRisk, now: 1, models: { ExchangeEvent: fakeModel(), ExchangeOrderMapping: fakeModel() } })
  assert.equal(res.status, 'REJECTED_BY_RISK')
  assert.equal(placed, false) // never reached the adapter
})

test('P8 intent: capability-unverified fails closed (no submission)', async () => {
  const res = await executeExchangeDemoIntent({ ownerId: 'u1', session: demoSession(), intent: demoIntent, adapter: mockAdapter('bybit', () => { throw venueError('bybit', 'capability-unverified', 'not verified') }), checkOrder: okRisk, now: 1, models: { ExchangeEvent: fakeModel(), ExchangeOrderMapping: fakeModel() } })
  assert.equal(res.status, 'REJECTED_CAPABILITY')
})

test('P8 intent: accepted path persists mapping + order event with lineage', async () => {
  const ev = fakeModel(); const map = fakeModel()
  const res = await executeExchangeDemoIntent({ ownerId: 'u1', session: demoSession(), intent: { ...demoIntent, strategyVersionId: 'sv1', agentId: 'ag1' }, adapter: mockAdapter('bybit', () => ({ externalOrderId: 'by-ord-9', ackAt: 2 })), checkOrder: okRisk, now: 1, models: { ExchangeEvent: ev, ExchangeOrderMapping: map } })
  assert.equal(res.status, 'ACCEPTED')
  assert.equal(res.externalOrderId, 'by-ord-9')
  assert.ok(res.clientOrderId)
  assert.ok(map._store.size >= 1) // mapping persisted
  const events = [...ev._store.values()]
  assert.ok(events.some((e) => e.kind === 'risk_decision'))
  assert.ok(events.some((e) => e.kind === 'order' && e.data?.status === 'accepted'))
  assert.ok(events.every((e) => e.environment === 'DEMO' && e.venue === 'bybit'))
})

test('P8 intent: timed-out ack is UNCERTAIN and is not resent', async () => {
  let calls = 0
  const ev = fakeModel(); const map = fakeModel()
  const res = await executeExchangeDemoIntent({ ownerId: 'u1', session: demoSession(), intent: demoIntent, adapter: mockAdapter('bybit', () => { calls += 1; throw venueError('bybit', 'order-uncertain', 'timed out') }), checkOrder: okRisk, now: 1, models: { ExchangeEvent: ev, ExchangeOrderMapping: map } })
  assert.equal(res.status, 'UNCERTAIN')
  assert.equal(calls, 1) // exactly one submission attempt — no duplicate order
  const mapping = [...map._store.values()].find((m) => m.status === 'uncertain')
  assert.ok(mapping)
})

test('P8 bridge: non-EXCHANGE_DEMO sessions are NOT routed to a venue (paper path untouched)', async () => {
  const res = await routeExchangeDemoIntent({ ownerId: 'u1', session: { executionMode: 'INTERNAL_PAPER', executionVenue: null }, intent: demoIntent })
  assert.equal(res.routed, false)
  assert.equal(res.reason, 'not-exchange-demo')
})

test('P8 bridge: EXCHANGE_DEMO routes through Risk Gate + adapter to the demo host only', async () => {
  const fetchImpl = mockFetch([{ path: '/v5/order/create', method: 'POST', payload: { retCode: 0, result: { orderId: 'by-bridge-1' } } }])
  const runtime = createExchangeRuntime({ fetchImpl, now: () => 1 })
  for (const c of EXECUTION_REQUIRED_CAPS) runtime.health.verifyCapability('bybit', c, CAP.SUPPORTED)
  const ev = fakeModel(); const map = fakeModel()
  const res = await routeExchangeDemoIntent({
    ownerId: 'u1',
    session: { sessionId: 's1', state: 'running', executionMode: 'EXCHANGE_DEMO', executionVenue: 'bybit', accountId: 'a' },
    intent: { ...demoIntent, strategyVersionId: 'sv1' },
    connectionProfile: 'bybit',
    deps: { runtime, resolveCredentials: async () => credentials, checkOrder: okRisk },
    models: { ExchangeEvent: ev, ExchangeOrderMapping: map },
  })
  assert.equal(res.routed, true)
  assert.equal(res.result.status, 'ACCEPTED')
  assert.equal(res.result.externalOrderId, 'by-bridge-1')
  assert.ok(fetchImpl.calls.length >= 1)
  assert.ok(fetchImpl.calls.every((c) => c.origin === 'https://api-demo.bybit.com'))
})

test('P8 bridge: EXCHANGE_DEMO with unverified capability fails closed (no order submitted)', async () => {
  const fetchImpl = mockFetch([{ path: '/v5/order/create', method: 'POST', payload: { retCode: 0, result: { orderId: 'should-not-happen' } } }])
  const runtime = createExchangeRuntime({ fetchImpl, now: () => 1 }) // capabilities NOT verified
  const res = await routeExchangeDemoIntent({
    ownerId: 'u1',
    session: { sessionId: 's1', state: 'running', executionMode: 'EXCHANGE_DEMO', executionVenue: 'bybit', accountId: 'a' },
    intent: demoIntent, connectionProfile: 'bybit',
    deps: { runtime, resolveCredentials: async () => credentials, checkOrder: okRisk },
    models: { ExchangeEvent: fakeModel(), ExchangeOrderMapping: fakeModel() },
  })
  assert.equal(res.routed, true)
  assert.equal(res.result.status, 'REJECTED_CAPABILITY')
  assert.equal(fetchImpl.calls.length, 0) // refused before any network I/O
})



