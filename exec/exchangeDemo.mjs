import { createHmac } from 'node:crypto'

// Exact hosts only. Public market-data hosts are intentionally absent.
export const DEMO_PROFILES = Object.freeze({
  bybit: Object.freeze({
    venue: 'bybit', market: 'linear', baseUrl: 'https://api-demo.bybit.com',
    accountPath: '/v5/account/wallet-balance',
    createPath: '/v5/order/create', cancelPath: '/v5/order/cancel',
    capabilities: Object.freeze({ account: 'supported', order: 'unknown', cancel: 'unknown', privateStream: 'unknown', markets: ['linear'] }),
  }),
  okx: Object.freeze({
    venue: 'okx', market: 'swap', baseUrl: 'https://www.okx.com',
    accountPath: '/api/v5/account/balance', createPath: '/api/v5/trade/order', cancelPath: '/api/v5/trade/cancel-order',
    capabilities: Object.freeze({ account: 'supported', order: 'unknown', cancel: 'unknown', privateStream: 'unknown', markets: ['swap'] }),
  }),
  'okx-us': Object.freeze({
    venue: 'okx', market: 'swap', baseUrl: 'https://us.okx.com',
    accountPath: '/api/v5/account/balance', createPath: '/api/v5/trade/order', cancelPath: '/api/v5/trade/cancel-order',
    capabilities: Object.freeze({ account: 'supported', order: 'unknown', cancel: 'unknown', privateStream: 'unknown', markets: ['swap'] }),
  }),
  'okx-eea': Object.freeze({
    venue: 'okx', market: 'swap', baseUrl: 'https://eea.okx.com',
    accountPath: '/api/v5/account/balance', createPath: '/api/v5/trade/order', cancelPath: '/api/v5/trade/cancel-order',
    capabilities: Object.freeze({ account: 'supported', order: 'unknown', cancel: 'unknown', privateStream: 'unknown', markets: ['swap'] }),
  }),
  binance: Object.freeze({
    venue: 'binance', market: 'spot', baseUrl: 'https://demo-api.binance.com',
    accountPath: '/api/v3/account', createPath: '/api/v3/order', cancelPath: '/api/v3/order',
    capabilities: Object.freeze({ account: 'supported', order: 'unknown', cancel: 'unknown', privateStream: 'unknown', markets: ['spot'] }),
  }),
  'binance-usdm': Object.freeze({
    venue: 'binance', market: 'usdm', baseUrl: 'https://demo-fapi.binance.com',
    accountPath: '/fapi/v3/account', createPath: '/fapi/v1/order', cancelPath: '/fapi/v1/order',
    capabilities: Object.freeze({ account: 'supported', order: 'unknown', cancel: 'unknown', privateStream: 'unknown', markets: ['usdm'] }),
  }),
})

const profileFor = (id) => {
  const profile = DEMO_PROFILES[String(id ?? '').toLowerCase()]
  if (!profile) throw Object.assign(new Error('Unsupported demo exchange profile'), { code: 'exchange.unsupported-profile' })
  return profile
}

export function validateDemoProfile(id, baseUrl) {
  const profile = profileFor(id)
  let url
  try { url = new URL(String(baseUrl)) } catch { throw Object.assign(new Error('Invalid exchange URL'), { code: 'exchange.invalid-host' }) }
  if (url.protocol !== 'https:' || url.origin !== profile.baseUrl || url.pathname !== '/' || url.search || url.username || url.password) {
    throw Object.assign(new Error(`Only the official ${profile.venue} demo endpoint is allowed`), { code: 'exchange.demo-host-required' })
  }
  return profile
}

const hmac = (secret, value, encoding = 'hex') => createHmac('sha256', secret).update(value).digest(encoding)
const cleanQuery = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString()

export function signDemoRequest(profileId, credentials, request, { now = Date.now() } = {}) {
  const profile = profileFor(profileId)
  const method = String(request.method ?? 'GET').toUpperCase()
  const path = String(request.path ?? '')
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) throw Object.assign(new Error('Invalid request path'), { code: 'exchange.invalid-path' })
  const body = request.body == null ? '' : JSON.stringify(request.body)
  const headers = { 'content-type': 'application/json' }
  let url = `${profile.baseUrl}${path}`

  if (profile.venue === 'bybit') {
    const timestamp = String(now)
    const recvWindow = '5000'
    headers['X-BAPI-API-KEY'] = credentials.apiKey
    headers['X-BAPI-TIMESTAMP'] = timestamp
    headers['X-BAPI-RECV-WINDOW'] = recvWindow
    headers['X-BAPI-SIGN'] = hmac(credentials.apiSecret, `${timestamp}${credentials.apiKey}${recvWindow}${method === 'GET' ? (request.queryString ?? '') : body}`)
  } else if (profile.venue === 'okx') {
    const timestamp = new Date(now).toISOString()
    const requestPath = `${path}${request.queryString ? `?${request.queryString}` : ''}`
    headers['OK-ACCESS-KEY'] = credentials.apiKey
    headers['OK-ACCESS-PASSPHRASE'] = credentials.passphrase
    headers['OK-ACCESS-TIMESTAMP'] = timestamp
    headers['OK-ACCESS-SIGN'] = hmac(credentials.apiSecret, `${timestamp}${method}${requestPath}${body}`, 'base64')
    headers['x-simulated-trading'] = '1'
    url = `${profile.baseUrl}${requestPath}`
  } else {
    const params = { ...(request.params ?? {}), timestamp: now }
    const query = cleanQuery(params)
    headers['X-MBX-APIKEY'] = credentials.apiKey
    const signature = hmac(credentials.apiSecret, query)
    url = `${profile.baseUrl}${path}?${query}&signature=${signature}`
  }
  if (profile.venue === 'bybit' && method === 'GET' && request.queryString) url += `?${request.queryString}`
  if (profile.venue === 'okx' && method !== 'GET' && request.body != null) headers['content-type'] = 'application/json'
  return { url, method, headers, body: profile.venue === 'binance' || method === 'GET' || method === 'DELETE' ? undefined : body }
}

async function privateRequest(profileId, credentials, request, { fetchImpl = fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  const profile = validateDemoProfile(profileId, profileFor(profileId).baseUrl)
  const signed = signDemoRequest(profileId, credentials, request, { now: now() })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.body,
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw Object.assign(new Error(`Demo API returned HTTP ${response.status}`), { code: `exchange.http-${response.status}` })
    if (profile.venue === 'bybit' && payload?.retCode !== 0) throw Object.assign(new Error(String(payload?.retMsg ?? 'Bybit request failed')), { code: `exchange.bybit-${payload?.retCode ?? 'error'}` })
    if (profile.venue === 'okx' && payload?.code !== '0') throw Object.assign(new Error(String(payload?.msg ?? 'OKX request failed')), { code: `exchange.okx-${payload?.code ?? 'error'}` })
    if (profile.venue === 'binance' && payload?.code < 0) throw Object.assign(new Error(String(payload?.msg ?? 'Binance request failed')), { code: `exchange.binance-${payload?.code}` })
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('Demo API returned an invalid JSON payload'), { code: 'exchange.invalid-response' })
    return payload
  } finally {
    clearTimeout(timer)
  }
}

export async function probeDemoConnection(profileId, credentials, options = {}) {
  const profile = profileFor(profileId)
  const started = options.now?.() ?? Date.now()
  const payload = await privateRequest(profileId, credentials, { method: 'GET', path: profile.accountPath, queryString: profile.venue === 'bybit' ? 'accountType=UNIFIED' : '', params: profile.venue === 'binance' ? {} : undefined }, options)
  const validAccount = profile.venue === 'bybit'
    ? Array.isArray(payload?.result?.list)
    : profile.venue === 'okx'
      ? Array.isArray(payload?.data)
      : profile.market === 'spot'
        ? Array.isArray(payload?.balances)
        : Array.isArray(payload?.assets) && Array.isArray(payload?.positions)
  if (!validAccount) throw Object.assign(new Error('Demo account response is missing required fields'), { code: 'exchange.invalid-account-response' })
  return { status: 'up', latencyMs: (options.now?.() ?? Date.now()) - started, profile: profileId, capabilities: profile.capabilities }
}

export async function placeDemoOrder(profileId, credentials, order, options = {}) {
  const profile = profileFor(profileId)
  validateDemoOrder(order)
  let body
  if (profile.venue === 'bybit') {
    body = { category: profile.market, symbol: order.symbol, side: order.side, orderType: 'Market', qty: String(order.qty), orderLinkId: order.clientOrderId }
  } else if (profile.venue === 'okx') {
    body = { instId: order.symbol, tdMode: 'cross', side: order.side.toLowerCase(), ordType: 'market', sz: String(order.qty), clOrdId: order.clientOrderId }
  } else {
    body = { symbol: order.symbol, side: order.side, type: 'MARKET', quantity: String(order.qty), newClientOrderId: order.clientOrderId, ...(profile.market === 'usdm' ? { reduceOnly: false } : {}) }
  }
  const path = profile.createPath
  const result = await privateRequest(profileId, credentials, { method: 'POST', path, ...(profile.venue === 'binance' ? { params: body } : { body }) }, options)
  return { venue: profile.venue, profile: profileId, result }
}

export async function cancelDemoOrder(profileId, credentials, input, options = {}) {
  const profile = profileFor(profileId)
  if (!input?.symbol || (!input?.orderId && !input?.clientOrderId)) throw Object.assign(new Error('symbol and orderId or clientOrderId are required'), { code: 'exchange.invalid-cancel' })
  let body
  if (profile.venue === 'bybit') body = { category: profile.market, symbol: input.symbol, ...(input.orderId ? { orderId: input.orderId } : { orderLinkId: input.clientOrderId }) }
  else if (profile.venue === 'okx') body = { instId: input.symbol, ...(input.orderId ? { ordId: input.orderId } : { clOrdId: input.clientOrderId }) }
  else body = { symbol: input.symbol, ...(input.orderId ? { orderId: input.orderId } : { origClientOrderId: input.clientOrderId }) }
  const queryString = profile.venue === 'bybit' ? '' : undefined
  return privateRequest(profileId, credentials, { method: profile.venue === 'binance' ? 'DELETE' : 'POST', path: profile.cancelPath, ...(profile.venue === 'binance' ? { params: body } : { body }), queryString }, options)
}

export function validateDemoOrder(order) {
  if (!order || !/^[A-Z0-9]{2,30}(?:-[A-Z0-9]{2,12}-SWAP)?$/.test(String(order.symbol ?? ''))) throw Object.assign(new Error('Invalid native symbol'), { code: 'exchange.invalid-order' })
  if (!['BUY', 'SELL'].includes(order.side)) throw Object.assign(new Error('side must be BUY or SELL'), { code: 'exchange.invalid-order' })
  if (!(Number.isFinite(Number(order.qty)) && Number(order.qty) > 0)) throw Object.assign(new Error('qty must be positive'), { code: 'exchange.invalid-order' })
  if (!/^[A-Za-z0-9_-]{1,36}$/.test(String(order.clientOrderId ?? ''))) throw Object.assign(new Error('clientOrderId is required for idempotency'), { code: 'exchange.invalid-order' })
}
