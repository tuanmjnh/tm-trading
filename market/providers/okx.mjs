// market/providers/okx.mjs
// OKX USDT perp adapter (roadmap §36) — implements the provider contract
// for cross-exchange scanner. REST only (WS depth not wired yet).
// `fetch({symbol, native})` -> { quote, funding, oi } in canonical units.

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

const OKX_BASE = 'https://www.okx.com'

/** GET JSON. Throw on HTTP error or payload code. */
async function okxFetch(path, params = {}, { fetchImpl, timeoutMs = 8000 } = {}) {
  const url = new URL(OKX_BASE + path)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  const doFetch = fetchImpl || fetch
  const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`okx ${path} HTTP ${res.status}`)
  const json = await res.json()
  if (json && typeof json === 'object' && json.code !== undefined && json.code !== '0') {
    throw new Error(`okx ${path} ${json.code}: ${json.msg || ''}`)
  }
  return json
}

/** OKX tickers — returns { last, bid, ask, ... } per symbol. */
async function tickers({ fetchImpl, timeoutMs } = {}) {
  const json = await okxFetch('/api/v5/market/tickers', { instType: 'SWAP' }, { fetchImpl, timeoutMs })
  const list = json?.data ?? []
  const out = {}
  for (const t of list) {
    const last = num(t.last)
    const bid = num(t.bidPx)
    const ask = num(t.askPx)
    if (last != null) out[t.instId] = { last, bid, ask, volume: num(t.volCcy24h) }
  }
  return out
}

/** OKX funding rate. */
async function fundingRate(symbol, { fetchImpl, timeoutMs } = {}) {
  const json = await okxFetch('/api/v5/public/funding-rate', { instId: symbol }, { fetchImpl, timeoutMs })
  const item = json?.data?.[0]
  const rate = num(item?.fundingRate)
  if (rate == null) return null
  return { rate, nextFundingTime: num(item?.nextFundingTime) }
}

/** OKX open interest (contracts). */
async function openInterest(symbol, { fetchImpl, timeoutMs } = {}) {
  const json = await okxFetch('/api/v5/public/open-interest', { instId: symbol, instType: 'SWAP' }, { fetchImpl, timeoutMs })
  const item = json?.data?.[0]
  const value = num(item?.oi)
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
export const id = 'okx'

/** Markets this adapter can serve. */
export const markets = ['swap']

/** Stream keys (WS not wired for scanner — empty). */
export const streams = () => []

/** Connect/close/status (no persistent WS for scanner). */
export function connect() {}
export function close() {}
export function status() { return { state: 'idle' } }