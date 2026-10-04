// =============================================================================
//  TM TRADING - SCANNER SERVICE (roadmap Phase 8: biến động / dòng tiền /
//  gom hàng — gate nới lỏng từ TIM/VSA: dùng lại khung 1h + volume gate).
//
//  1 call ticker24hr (toàn bộ) -> lọc USDT perp, thanh khoản >=
//  SCANNER_MIN_QUOTE_VOL -> chọn top |biến động| + top thanh khoản (gộp, cap)
//  để scan sâu bằng klines 1h×120 (GIỮ cột taker-buy — xem binance.mjs).
//
//  3 snapshot (dashboard top-list, ghi đè mỗi chu kỳ): `mover` / `flow` /
//  `accum`. Alert Telegram khi |24h| >= SCANNER_ALERT_PCT (dedupe theo
//  `alert:mover:<sym>:<day>:<dir>` — 1 cảnh báo /symbol/ngày).
//
//  Toàn bộ detect là hàm PURE (services/test.mjs chạy golden offline).
// =============================================================================
import { ticker24h, klinesRaw, rawKlineToBar } from './binance.mjs'
import { getIntel, saveSnapshot, insertEvents } from './store.mjs'
import { sendTelegram } from './telegram.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const SCANNER_CFG = Object.freeze({
  minQuoteVol: Number(process.env.SCANNER_MIN_QUOTE_VOL || 30_000_000),
  deepN: Number(process.env.SCANNER_TOP_N || 40),
  deepCap: Number(process.env.SCANNER_DEEP_CAP || 48),
  moverTop: 8,
  alertPct: Number(process.env.SCANNER_ALERT_PCT || 15),
})

// ---------------------------------------------------------------------------
//  PURE helpers
// ---------------------------------------------------------------------------

/** Lọc ticker: USDT perp + thanh khoản tối thiểu; chuẩn hóa number. */
export function pickTickers(rows, { minQuoteVol = SCANNER_CFG.minQuoteVol } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.symbol?.endsWith('USDT'))
    .map((r) => ({
      symbol: r.symbol,
      pct24h: Number(r.priceChangePercent) || 0,
      quoteVolume: Number(r.quoteVolume) || 0,
      lastPrice: Number(r.lastPrice) || 0,
    }))
    .filter((r) => r.quoteVolume >= minQuoteVol && r.lastPrice > 0)
}

/** Top N theo |biến động 24h|. */
export function topMovers(tickers, limit = 8) {
  return [...tickers].sort((a, b) => Math.abs(b.pct24h) - Math.abs(a.pct24h)).slice(0, limit)
}

function mean(arr) {
  if (!arr.length) return 0
  return arr.reduce((s, x) => s + x, 0) / arr.length
}

/**
 * Chỉ số 1 symbol từ bar 1h (cần >= 60 bar để có baseline 25 + window).
 * PURE — bars: {time, open, high, low, close, volume, takerBuy}.
 */
export function computeStats(bars) {
  const n = bars.length
  if (n < 60) throw new Error('scanner: klines qua ngan')
  const last = bars[n - 1]

  const chg4h = (last.close / bars[n - 5].close - 1) * 100
  const priceΔ48 = (last.close / bars[n - 49].close - 1) * 100

  // ATR14 (% giá trị hiện tại)
  let trSum = 0
  for (let i = n - 14; i < n; i++) {
    const pc = bars[i - 1].close
    trSum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc))
  }
  const atr = trSum / 14
  const atrPct = (atr / last.close) * 100

  // Range 48 bar gần nhất (dải nén cho accumulate)
  const w48 = bars.slice(n - 48)
  const hi48 = Math.max(...w48.map((b) => b.high))
  const lo48 = Math.min(...w48.map((b) => b.low))
  const rangePct = ((hi48 - lo48) / lo48) * 100

  // Volume spike: 5 bar mới nhất vs baseline 20 bar đứng sau nó (không chồng lấn)
  const recentVol = mean(bars.slice(n - 5).map((b) => b.volume))
  const baseVol = mean(bars.slice(n - 25, n - 6).map((b) => b.volume))
  const volRatio = baseVol > 0 ? recentVol / baseVol : 1

  // Taker buy/sell delta 20 bar: takerBuy / total volume (0.5 = cân bằng)
  const w20 = bars.slice(n - 20)
  const takerSum = w20.reduce((s, b) => s + b.takerBuy, 0)
  const volSum = w20.reduce((s, b) => s + b.volume, 0)
  const takerRatio = volSum > 0 ? takerSum / volSum : 0.5

  // CMF 20 bar: money-flow theo vị trí close trong range, trọng số volume
  let mfv = 0
  for (const b of w20) {
    const rng = b.high - b.low
    mfv += rng > 0 ? (((b.close - b.low) - (b.high - b.close)) / rng) * b.volume : 0
  }
  const cmf = volSum > 0 ? mfv / volSum : 0

  // OBV: Δ20 bar tinh theo baseline volume (don vi "so bar volume")
  let obv = 0
  const obvSeries = [0]
  for (let i = 1; i < n; i++) {
    obv += Math.sign(bars[i].close - bars[i - 1].close) * bars[i].volume
    obvSeries.push(obv)
  }
  const obvDelta = obvSeries[n - 1] - obvSeries[n - 21]
  const obvNorm = baseVol > 0 ? obvDelta / baseVol : 0

  return { lastPrice: last.close, chg4h, priceΔ48, atr, atrPct, rangePct, volRatio, takerRatio, cmf, obvNorm, vol24h: 0 }
}

/** Dòng tiền: volume spike / taker lệch / CMF — cần volRatio >= 1.2 kèm theo. */
export function detectFlow(stats, cfg = {}) {
  const minVol = cfg.minVolRatio ?? 1.2
  const reasons = []
  let buy = false
  let sell = false
  if (stats.volRatio >= (cfg.spike ?? 2)) { reasons.push('volSpike'); }
  if (stats.takerRatio >= (cfg.takerBuy ?? 0.6)) { reasons.push('takerBuy'); buy = true }
  if (stats.takerRatio <= (cfg.takerSell ?? 0.4)) { reasons.push('takerSell'); sell = true }
  if (stats.cmf >= (cfg.cmfIn ?? 0.2)) { reasons.push('cmfIn'); buy = true }
  if (stats.cmf <= (cfg.cmfOut ?? -0.2)) { reasons.push('cmfOut'); sell = true }
  const hit = stats.volRatio >= minVol && reasons.length > 0
  const dir = buy && sell ? 'mixed' : buy ? 'buy' : sell ? 'sell' : 'vol'
  const score = stats.volRatio + Math.abs(stats.cmf) * 2 + Math.abs(stats.takerRatio - 0.5) * 4
  return { hit, dir, reasons, score: Number(score.toFixed(3)) }
}

/** Gom hàng (Wyckoff nới lỏng): nén range + sideway + OBV tăng (volume khô là tag). */
export function detectAccum(stats, cfg = {}) {
  const reasons = []
  const rangeOk = stats.rangePct <= (cfg.maxRangePct ?? 6)
  const flat = Math.abs(stats.priceΔ48) <= (cfg.flatPct ?? 1.5)
  const obvUp = stats.obvNorm >= (cfg.minObv ?? 0.2)
  const volDry = stats.volRatio <= (cfg.volDryMax ?? 0.8)
  if (rangeOk) reasons.push('range')
  if (flat) reasons.push('flat')
  if (obvUp) reasons.push('obvUp')
  if (volDry) reasons.push('volDry')
  return { hit: rangeOk && flat && obvUp, reasons, volDry }
}

/** Breakout 20-bar cao nhất với volume xác nhận (volRatio >= 1.5). */
export function detectBreakout(bars, stats, cfg = {}) {
  const n = bars.length
  const prior = bars.slice(n - 21, n - 1)
  const breakoutHigh = Math.max(...prior.map((b) => b.high))
  return bars[n - 1].close >= breakoutHigh && stats.volRatio >= (cfg.volBreakout ?? 1.5)
}

// ---------------------------------------------------------------------------
//  Runner
// ---------------------------------------------------------------------------

/** Chạy 1 lần. Throw nếu nguồn chính hỏng (orchestrator -> heartbeat error). */
export async function runScanner({ fetchImpl, now = new Date(), cfg = SCANNER_CFG } = {}) {
  const raw = await ticker24h({ fetchImpl })
  const tickers = pickTickers(raw, { minQuoteVol: cfg.minQuoteVol })
  if (!tickers.length) throw new Error('scanner: ticker rong (API hoac filter)')

  const movers = topMovers(tickers, cfg.moverTop)
  const byVolume = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, cfg.deepN)
  const universe = [...new Map([...movers, ...byVolume].map((t) => [t.symbol, t])).values()].slice(0, cfg.deepCap)

  const scan = []
  for (const t of universe) {
    try {
      const rows = await klinesRaw({ symbol: t.symbol, interval: '1h', limit: 120 }, { fetchImpl })
      const bars = rows.map(rawKlineToBar)
      if (bars.length < 60) continue
      const stats = computeStats(bars)
      scan.push({
        ...t,
        stats,
        breakout: detectBreakout(bars, stats, cfg),
        flow: detectFlow(stats, cfg),
        accum: detectAccum(stats, cfg),
      })
    } catch {
      // 1 symbol hỏng (delist giữa chừng...) không được giết cả lần scan.
    } finally {
      if (cfg.delayMs) await sleep(cfg.delayMs)
    }
  }
  if (!scan.length) throw new Error('scanner: khong scan duoc symbol nao')

  const moversOut = [...scan]
    .sort((a, b) => Math.abs(b.pct24h) - Math.abs(a.pct24h))
    .slice(0, cfg.moverTop)
    .map((s) => ({ symbol: s.symbol, pct24h: Number(s.pct24h.toFixed(2)), chg4h: Number(s.stats.chg4h.toFixed(2)), quoteVolume: s.quoteVolume, lastPrice: s.lastPrice, breakout: s.breakout, atrPct: Number(s.stats.atrPct.toFixed(2)) }))

  const flowsOut = scan.filter((s) => s.flow.hit)
    .sort((a, b) => b.flow.score - a.flow.score)
    .slice(0, cfg.moverTop)
    .map((s) => ({ symbol: s.symbol, dir: s.flow.dir, reasons: s.flow.reasons, volRatio: Number(s.stats.volRatio.toFixed(2)), takerRatio: Number(s.stats.takerRatio.toFixed(3)), cmf: Number(s.stats.cmf.toFixed(3)), pct24h: Number(s.pct24h.toFixed(2)), score: s.flow.score }))

  const accumsOut = scan.filter((s) => s.accum.hit)
    .slice(0, cfg.moverTop)
    .map((s) => ({ symbol: s.symbol, reasons: s.accum.reasons, rangePct: Number(s.stats.rangePct.toFixed(2)), priceChg48: Number(s.stats.priceΔ48.toFixed(2)), obvNorm: Number(s.stats.obvNorm.toFixed(2)), volRatio: Number(s.stats.volRatio.toFixed(2)), pct24h: Number(s.pct24h.toFixed(2)) }))

  const Intel = await getIntel()
  const mongo = Intel ? 'up' : 'down'
  let alerted = 0
  const ts = now.getTime()
  const day = now.toISOString().slice(0, 10)
  if (Intel) {
    await saveSnapshot('mover', moversOut.map((m) => ({ key: `mover:${m.symbol}`, symbol: m.symbol, ts, data: m })))
    await saveSnapshot('flow', flowsOut.map((m) => ({ key: `flow:${m.symbol}`, symbol: m.symbol, ts, data: m })))
    await saveSnapshot('accum', accumsOut.map((m) => ({ key: `accum:${m.symbol}`, symbol: m.symbol, ts, data: m })))

    const extreme = moversOut.filter((m) => Math.abs(m.pct24h) >= cfg.alertPct)
    if (extreme.length) {
      const res = await insertEvents(extreme.map((m) => ({
        key: `alert:mover:${m.symbol}:${day}:${m.pct24h >= 0 ? 'up' : 'down'}`,
        kind: 'alert',
        symbol: m.symbol,
        ts,
        score: Math.abs(m.pct24h),
        data: { pct24h: m.pct24h, dir: m.pct24h >= 0 ? 'up' : 'down', breakout: m.breakout, chg4h: m.chg4h },
      })))
      if (res?.inserted.length) {
        const fresh = extreme.filter((m) => res.inserted.includes(`alert:mover:${m.symbol}:${day}:${m.pct24h >= 0 ? 'up' : 'down'}`))
        const lines = fresh.map((m) => `• ${m.symbol}: ${m.pct24h > 0 ? '+' : ''}${m.pct24h}% 24h (${m.chg4h > 0 ? '+' : ''}${m.chg4h}% 4h)${m.breakout ? ' 🚀 breakout' : ''}`)
        await sendTelegram([`📊 TM Trading — BIẾN ĐỘNG LỚN (${fresh.length})`, ...lines].join('\n'), '[scanner]')
        alerted = res.inserted.length
      }
    }
  }

  return { tickers: tickers.length, scanned: scan.length, movers: moversOut.length, flows: flowsOut.length, accums: accumsOut.length, alerted, mongo }
}
