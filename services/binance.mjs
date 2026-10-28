// =============================================================================
//  TM TRADING - Binance USDⓈ-M raw HTTP helpers cho services (Phase 8).
//
//  KHÔNG đụng engine/data.mjs (kline của nó bỏ cột taker-buy ở index 9 —
//  scanner cần cột này cho taker delta; và cache 1500 bar thừa cho service).
//  Chỉ mượn MARKETS để một nguồn base-URL (D1).
//
//  Resilience: khi fapi.binance.com bị HTTP 418 (IP ban) hoặc HTTP 429:
//  - ticker24h tự động fallback sang Binance Spot API (/api/v3/ticker/24hr).
//  - premiumIndex tự động fallback sang Bybit Linear perp tickers (/v5/market/tickers).
//  - klinesRaw tự động fallback sang Binance Spot API (/api/v3/klines).
//  - openInterest tự động fallback sang Bybit linear ticker.
// =============================================================================
import { MARKETS } from '../engine/data.mjs'

const DEFAULT_TIMEOUT_MS = Number(process.env.SERVICES_HTTP_TIMEOUT_MS || 8000)
const FAPI_BASE = process.env.BINANCE_FAPI_BASE || MARKETS.fapi.base

/** GET JSON từ fapi. Throw nếu HTTP lỗi hoặc payload lỗi ({code,msg}). */
export async function fapi(path, params = {}, { fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = new URL(FAPI_BASE + path)
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

/** /fapi/v1/ticker/24hr (mảng) -> rows đã lọc USDT perp. Fail-soft sang spot API khi 418/429. */
export async function ticker24h(opts = {}) {
  try {
    const raw = await fapi('/fapi/v1/ticker/24hr', {}, opts)
    return (Array.isArray(raw) ? raw : []).filter((r) => isUsdtPerp(r.symbol))
  } catch (err) {
    // Fallback sang Binance Spot ticker24hr nếu fapi bị HTTP 418 / rate-limit
    try {
      const doFetch = opts.fetchImpl || fetch
      const res = await doFetch('https://api.binance.com/api/v3/ticker/24hr', {
        signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS)
      })
      if (res.ok) {
        const spotRows = await res.json()
        if (Array.isArray(spotRows)) {
          return spotRows.filter((r) => isUsdtPerp(r.symbol))
        }
      }
    } catch {
      // Tiếp tục thử Bybit nếu Spot cũng không được
    }

    // Fallback sang Bybit linear tickers
    try {
      const doFetch = opts.fetchImpl || fetch
      const res = await doFetch('https://api.bybit.com/v5/market/tickers?category=linear', {
        signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS)
      })
      if (res.ok) {
        const json = await res.json()
        const list = json.result?.list || []
        return list.filter((r) => isUsdtPerp(r.symbol)).map((r) => ({
          symbol: r.symbol,
          priceChangePercent: (Number(r.price24hPcnt) * 100).toFixed(2),
          quoteVolume: r.turnover24h || r.volume24h || '0',
          lastPrice: r.lastPrice || '0'
        }))
      }
    } catch {
      // Re-throw lỗi ban đầu nếu mọi fallback đều thất bại
    }

    throw err
  }
}

/** /fapi/v1/premiumIndex (mảng) -> rows USDT perp. Fail-soft sang Bybit linear tickers khi 418/429. */
export async function premiumIndex(opts = {}) {
  try {
    const raw = await fapi('/fapi/v1/premiumIndex', {}, opts)
    return (Array.isArray(raw) ? raw : []).filter((r) => isUsdtPerp(r.symbol))
  } catch (err) {
    // Fallback sang Bybit linear perp tickers khi fapi bị 418 / ban
    try {
      const doFetch = opts.fetchImpl || fetch
      const res = await doFetch('https://api.bybit.com/v5/market/tickers?category=linear', {
        signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS)
      })
      if (res.ok) {
        const json = await res.json()
        const list = json.result?.list || []
        return list
          .filter((r) => isUsdtPerp(r.symbol))
          .map((r) => ({
            symbol: r.symbol,
            lastFundingRate: r.fundingRate || '0.0001',
            nextFundingTime: Number(r.nextFundingTime) || (Date.now() + 8 * 3600 * 1000),
            markPrice: r.markPrice || r.lastPrice || '0',
            lastPrice: r.lastPrice || '0'
          }))
      }
    } catch {
      // Re-throw lỗi ban đầu nếu Bybit cũng không được
    }

    throw err
  }
}

/** Open interest (contracts) của 1 symbol. Fail-soft sang Bybit khi fapi lỗi. */
export async function openInterest(symbol, opts = {}) {
  try {
    const json = await fapi('/fapi/v1/openInterest', { symbol }, opts)
    return Number(json?.openInterest) || 0
  } catch {
    try {
      const doFetch = opts.fetchImpl || fetch
      const cleanSym = String(symbol).replace('.P', '')
      const res = await doFetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${cleanSym}`, {
        signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS)
      })
      if (res.ok) {
        const json = await res.json()
        return Number(json.result?.list?.[0]?.openInterest) || 0
      }
    } catch {
      // Return 0 if all fail
    }
    return 0
  }
}

/**
 * Kline THÔ (mảng string) — KHÔNG cache, KHÔNG pagination.
 * Fail-soft sang Binance Spot khi fapi bị 418/429.
 */
export async function klinesRaw({ symbol, interval = '1h', limit = 120 } = {}, opts = {}) {
  try {
    const raw = await fapi('/fapi/v1/klines', { symbol, interval, limit }, opts)
    return Array.isArray(raw) ? raw : []
  } catch (err) {
    try {
      const doFetch = opts.fetchImpl || fetch
      const cleanSym = String(symbol).replace('.P', '')
      const res = await doFetch(`https://api.binance.com/api/v3/klines?symbol=${cleanSym}&interval=${interval}&limit=${limit}`, {
        signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS)
      })
      if (res.ok) {
        const spotKlines = await res.json()
        if (Array.isArray(spotKlines)) return spotKlines
      }
    } catch {
      // fallback fail
    }
    throw err
  }
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
