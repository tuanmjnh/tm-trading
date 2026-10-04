// =============================================================================
//  TM TRADING - Binance USDⓈ-M raw HTTP helpers cho services (Phase 8).
//
//  KHÔNG đụng engine/data.mjs (kline của nó bỏ cột taker-buy ở index 9 —
//  scanner cần cột này cho taker delta; và cache 1500 bar thừa cho service).
//  Chỉ mượn MARKETS để một nguồn base-URL (D1). Fail-throw — service nào
//  catch thì tự quyết fail-soft.
// =============================================================================
import { MARKETS } from '../engine/data.mjs'

const DEFAULT_TIMEOUT_MS = Number(process.env.SERVICES_HTTP_TIMEOUT_MS || 8000)

/** GET JSON từ fapi. Throw nếu HTTP lỗi hoặc payload lỗi ({code,msg}). */
export async function fapi(path, params = {}, { fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = new URL(MARKETS.fapi.base + path)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  const doFetch = fetchImpl || fetch
  const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`fapi ${path} HTTP ${res.status}`)
  const json = await res.json()
  if (json && typeof json === 'object' && !Array.isArray(json) && json.code) {
    throw new Error(`fapi ${path} ${json.code}: ${json.msg || ''}`)
  }
  return json
}

/** USDT perp trên fapi — symbol kết thúc bằng 'USDT' (loại 'BTCUSD_' coin-margined). */
export const isUsdtPerp = (symbol) => typeof symbol === 'string' && symbol.endsWith('USDT')

/** /fapi/v1/ticker/24hr (mảng) -> rows đã lọc USDT perp. */
export async function ticker24h(opts = {}) {
  const raw = await fapi('/fapi/v1/ticker/24hr', {}, opts)
  return (Array.isArray(raw) ? raw : []).filter((r) => isUsdtPerp(r.symbol))
}

/** /fapi/v1/premiumIndex (mảng) -> rows USDT perp. */
export async function premiumIndex(opts = {}) {
  const raw = await fapi('/fapi/v1/premiumIndex', {}, opts)
  return (Array.isArray(raw) ? raw : []).filter((r) => isUsdtPerp(r.symbol))
}

/** Open interest (contracts) của 1 symbol. */
export async function openInterest(symbol, opts = {}) {
  const json = await fapi('/fapi/v1/openInterest', { symbol }, opts)
  return Number(json?.openInterest) || 0
}

/**
 * Kline THÔ (mảng string) — KHÔNG cache, KHÔNG pagination (service chỉ cần
 * ~120 bar 1h; 1 request = 1 call, weight 1-2,远 dưới rate-limit).
 */
export async function klinesRaw({ symbol, interval = '1h', limit = 120 } = {}, opts = {}) {
  const raw = await fapi('/fapi/v1/klines', { symbol, interval, limit }, opts)
  return Array.isArray(raw) ? raw : []
}

/**
 * 1 dòng kline -> bar của scanner, GIỮ cột taker-buy (index 9).
 * [openTime, o, h, l, c, volume, closeTime, quoteVol, trades, takerBuyBase, ...]
 */
export function rawKlineToBar(k) {
  if (!Array.isArray(k) || k.length < 10) throw new Error('kline thieu cot')
  const bar = {
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    takerBuy: Number(k[9]) || 0,
  }
  if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every((x) => Number.isFinite(x))) {
    throw new Error('kline co gia tri khong huu han')
  }
  return bar
}
