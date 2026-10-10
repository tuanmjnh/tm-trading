// market/providers/bybit.mjs
// Bybit USDT perp adapter (roadmap §36) — implements the provider contract
// for cross-exchange scanner. REST only (WS depth not wired yet).
// `fetch({symbol, native})` -> { quote, funding, oi } in canonical units.

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

const BYBIT_BASE = 'https://api.bybit.com'

/** GET JSON. Throw on HTTP error or payload code. */
async function bybitFetch(path, params = {}, { fetchImpl, timeoutMs = 8000 } = {}) {
  const url = new URL(BYBIT_BASE + path)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  const doFetch = fetchImpl || fetch
  const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`bybit ${path} HTTP ${res.status}`)
  const json = await res.json()
  if (json && typeof json === 'object' && json.retCode !== undefined && json.retCode !== 0) {
    throw new Error(`bybit ${path} ${json.retCode}: ${json.retMsg || ''}`)
  }
  return json
}

/** Bybit tickers (24h) — returns { last, bid, ask, ... } per symbol. */
async function tickers({ fetchImpl, timeoutMs } = {}) {
  const json = await bybitFetch('/v5/market/tickers', { category: 'linear' }, { fetchImpl, timeoutMs })
  const list = json?.result?.list ?? []
  const out = {}
  for (const t of list) {
    const last = num(t.lastPrice)
    const bid = num(t.bid1Price)
    const ask = num(t.ask1Price)
    if (last != null) out[t.symbol] = { last, bid, ask, volume: num(t.volume24h) }
  }
  return out
}

/** Bybit funding rate. */
async function fundingRate(symbol, { fetchImpl, timeoutMs } = {}) {
  const json = await bybitFetch('/v5/market/funding/history', { category: 'linear', symbol, limit: 1 }, { fetchImpl, timeoutMs })
  const item = json?.result?.list?.[0]
  const rate = num(item?.fundingRate)
  if (rate == null) return null
  return { rate, nextFundingTime: num(item?.nextFundingTime) }
}

/** Bybit open interest (contracts). */
async function openInterest(symbol, { fetchImpl, timeoutMs } = {}) {
  const json = await bybitFetch('/v5/market/open-interest', { category: 'linear', symbol, intervalTime: '1h', limit: 1 }, { fetchImpl, timeoutMs })
  const item = json?.result?.list?.[0]
  const value = num(item?.openInterest)
  return value != null ? { value } : null
}

/** Single fetch for cross-scanner: returns { quote, funding, oi } or nulls. */
export async function fetch({ symbol, native }, opts = {}) {
  const [tk, f, oi] = await Promise.all([
    tickers(opts).then((m) => m[native] ?? null),
    fundingRate(native, opts),
    openInterest(native, opts),
  ])
  return {
    quote: tk ?? null,
    funding: f ?? null,
    oi: oi ?? null,
  }
}

/** Provider contract id. */
export const id = 'bybit'

/** Markets this adapter can serve. */
export const markets = ['linear']

/** Stream keys (WS not wired for scanner — empty). */
export const streams = () => []

/** Connect/close/status (no persistent WS for scanner). */
export function connect() {}
export function close() {}
export function status() { return { state: 'idle' } }