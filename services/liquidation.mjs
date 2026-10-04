// =============================================================================
//  TM TRADING - LIQUIDATION SERVICE (roadmap Phase 9): Liquidation HeatMap.
//
//  Hai nguồn, cùng 1 mục tiêu "khu vực thanh lý tiềm năng":
//
//  1. Ước tính zone từ OI + phân bố đòn bẩy (REST, mọi nơi chạy được):
//     openInterest (contracts) × markPrice = notional (quy ước ×price — CÙNG
//     funding.mjs, một nguồn - D1). `/fapi/v1/leverageBracket` CẦN API key
//     (401) và `openInterestHist` bị gỡ (404) -> dùng phân bảng GIA MÔ
//     LIQ_CFG.bands (lev × trọng số, mmr) — ghi rõ "est", không tự xem là số
//     thật. Long thanh lý DƯỚI mark, short TRÊN mark.
//
//  2. Thanh lý THẬT từ WS `!forceOrder@arr` -> data/liq-events.ndjson ->
//     gom cụm theo giá (1% bin, cửa sổ LIQ_WINDOW_H). WS chỉ chạy trong
//     `services:watch` (startLiqCollector); `once` chỉ đọc file (nhanh).
//     GHI CHÚ MÔI TRƯỜNG: mạng dev hiện nay mở được TCP tới fstream nhưng
//     KHÔNG nhận frame (spot WS OK) -> collector im lặng fail-soft, số liệu
//     "actual" trống cho tới khi chạy ở môi trường WS thông (VPS...). Ước
//     tính REST vẫn đủ cho dashboard.
//
//  Cụm thật ≥ LIQ_ALERT_USD trong 1h -> Telegram (dedupe theo giờ - D4).
// =============================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { premiumIndex, openInterest, ticker24h, fapi } from './binance.mjs'
import { getIntel, saveSnapshot, insertEvents } from './store.mjs'
import { sendTelegram } from './telegram.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

export const LIQ_CFG = Object.freeze({
  /** Symbol mặc định (majors) — env LIQ_SYMBOLS, thêm top |pct| movers. */
  symbols: String(process.env.LIQ_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  /** Cửa sổ đọc event thật (giờ) — env LIQ_WINDOW_H. */
  windowH: Number(process.env.LIQ_WINDOW_H || 6),
  /** Cụm thật ≥ USD này trong 1h -> TG — env LIQ_ALERT_USD. */
  alertUsd: Number(process.env.LIQ_ALERT_USD || 5_000_000),
  /** Binning event thật: bin ±1% quanh ref — env LIQ_BIN_PCT. */
  binPct: Number(process.env.LIQ_BIN_PCT || 1),
  eventsFile: process.env.LIQ_EVENTS_FILE || join(ROOT, 'data', 'liq-events.ndjson'),
  wsUrl: process.env.LIQ_WS_URL || 'wss://fstream.binance.com/ws/!forceOrder@arr',
  /**
   * Phân bảng đòn bẩy GIA MÔ (leverageBracket cần key) — sum(w)=1.
   * mmr: maintenance margin rate giả định 0.4%.
   */
  bands: Object.freeze([
    { lev: 3, w: 0.10 }, { lev: 5, w: 0.12 }, { lev: 10, w: 0.20 },
    { lev: 20, w: 0.20 }, { lev: 25, w: 0.14 }, { lev: 50, w: 0.14 },
    { lev: 100, w: 0.10 },
  ]),
  mmr: 0.004,
  /** Gom cụm event thật tối thiểu (USD) để khỏi rác. */
  minClusterUsd: 50_000,
})

// -----------------------------------------------------------------------------
//  Logic thuần — golden test.
// -----------------------------------------------------------------------------

/**
 * Ước tính zone thanh lý từ markPrice + OI — PURE (gia mô, không phải số thật).
 * Long liq = mark × (1 − (1/lev − mmr)) (dưới mark); short = mark × (1 + (1/lev − mmr)).
 * @returns {{lev:number, w:number, side:'long'|'short', price:number, pct:number, usd:number}[]}
 */
export function estimateZones({ markPx, oiUsd, bands = LIQ_CFG.bands, mmr = LIQ_CFG.mmr } = {}) {
  if (!(markPx > 0) || !(oiUsd > 0)) return []
  const out = []
  for (const b of bands) {
    const dist = 1 / b.lev - mmr
    if (!(dist > 0)) continue
    out.push({ lev: b.lev, w: b.w, side: 'long', price: markPx * (1 - dist), pct: -dist * 100, usd: Math.round(oiUsd * b.w) })
    out.push({ lev: b.lev, w: b.w, side: 'short', price: markPx * (1 + dist), pct: dist * 100, usd: Math.round(oiUsd * b.w) })
  }
  return out
}

/**
 * Đọc event forceOrder (ndjson) trong cửa sổ — fail-soft từng dòng hỏng.
 * @returns {{symbol:string, price:number, usd:number, side:'long'|'short', ts:number}[]}
 */
export function readLiqEvents({ file = LIQ_CFG.eventsFile, now = Date.now(), windowH = LIQ_CFG.windowH } = {}) {
  try {
    if (!existsSync(file)) return []
    const cutoff = now - windowH * 3600_000
    const out = []
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        const ts = Number(e?.ts)
        if (!Number.isFinite(ts) || ts < cutoff || ts > now + 60_000) continue
        const price = Number(e?.price)
        if (!(price > 0)) continue
        out.push({
          symbol: String(e?.symbol || ''),
          price,
          usd: Number(e?.usd) || 0,
          side: e?.side === 'short' ? 'short' : 'long',
          ts,
        })
      } catch { /* dong hong -> bo qua */ }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Gom event thật theo bin giá (1% quanh ref của từng symbol) — PURE.
 * @returns {{symbol:string, side:'long'|'short', price:number, usd:number, n:number}[]}
 */
export function clusterLiqs(events, { binPct = LIQ_CFG.binPct, minUsd = LIQ_CFG.minClusterUsd } = {}) {
  const refBy = new Map()
  for (const e of events || []) if (!refBy.has(e.symbol)) refBy.set(e.symbol, e.price) // event dau = ref (cua so ngan)
  const bins = new Map()
  for (const e of events || []) {
    const ref = refBy.get(e.symbol)
    if (!(ref > 0)) continue
    const step = ref * (binPct / 100)
    const bucket = Math.round(e.price / step)
    const k = `${e.symbol}|${e.side}|${bucket}`
    const cur = bins.get(k) || { symbol: e.symbol, side: e.side, bucket, price: 0, usd: 0, n: 0 }
    cur.price += e.price
    cur.usd += e.usd
    cur.n += 1
    bins.set(k, cur)
  }
  return [...bins.values()]
    .map((b) => ({ symbol: b.symbol, side: b.side, price: Math.round((b.price / b.n) * 1000) / 1000, usd: Math.round(b.usd), n: b.n }))
    .filter((b) => b.usd >= minUsd)
    .sort((a, b) => b.usd - a.usd)
}

/** Phân cụm theo Giờ UTC cho key dedupe TG (mỗi symbol × mỗi giờ 1 lần). */
export const hourBucket = (ts) => Math.floor(ts / 3600_000)

// -----------------------------------------------------------------------------
//  WS collector (chỉ watch mode) — append data/liq-events.ndjson.
// -----------------------------------------------------------------------------

let collector = null

/** Bắt đầu collect forceOrder (idempotent). Trả {stop()}. */
export function startLiqCollector({ url = LIQ_CFG.wsUrl, file = LIQ_CFG.eventsFile } = {}) {
  if (collector) return collector
  let stopped = false
  let ws = null
  let backoffMs = 5000
  let timer = null

  // Dọn event > 7 ngày một lần khi start (giu file nho).
  try {
    if (existsSync(file)) {
      const cutoff = Date.now() - 7 * 86_400_000
      const keep = readFileSync(file, 'utf8').split('\n').filter((l) => {
        try { return Number(JSON.parse(l).ts) >= cutoff } catch { return false }
      })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, keep.length ? keep.join('\n') + '\n' : '')
      renameSync(tmp, file)
    }
  } catch { /* khong anh huong */ }

  const connect = () => {
    if (stopped) return
    try {
      ws = new WebSocket(url)
    } catch {
      timer = setTimeout(connect, backoffMs)
      backoffMs = Math.min(backoffMs * 2, 60_000)
      return
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data))
        const o = msg?.o
        if (!o?.s) return
        const price = Number(o.p) || Number(o.ap) || 0
        const qty = Number(o.q) || 0
        if (!(price > 0) || !(qty > 0)) return
        mkdirSync(dirname(file), { recursive: true })
        appendFileSync(file, JSON.stringify({
          symbol: String(o.s),
          price,
          usd: Math.round(price * qty),
          side: o.S === 'SELL' ? 'long' : 'short', // SELL = long bi thanh ly
          ts: Number(o.T) || Date.now(),
        }) + '\n')
        backoffMs = 5000
      } catch { /* tin nhat hong -> bo */ }
    }
    ws.onerror = () => { /* onclose xu ly */ }
    ws.onclose = () => {
      if (stopped) return
      timer = setTimeout(connect, backoffMs)
      backoffMs = Math.min(backoffMs * 2, 60_000)
    }
  }
  connect()

  collector = {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      try { ws?.close() } catch { /* da dong */ }
      collector = null
    },
  }
  return collector
}

// -----------------------------------------------------------------------------
//  Runner.
// -----------------------------------------------------------------------------

/**
 * Chạy 1 lần. Throw nếu nguồn chính (ticker/premium) hỏng.
 * @returns {Promise<{symbols:number, oiUsd:number, events:number, clusters:number,
 *   alerted:number, mongo:'up'|'down'}>}
 */
export async function runLiquidation({ fetchImpl, now = new Date(), send = sendTelegram } = {}) {
  const ts = now.getTime()
  const [tickers, premium] = await Promise.all([
    ticker24h({ fetchImpl }),
    premiumIndex({ fetchImpl }),
  ])
  const markBy = new Map(premium.map((p) => [p.symbol, Number(p.markPrice) || 0]))

  // Union: majors + top 3 |pct| (loai stable/coin-margined).
  const movers = [...tickers]
    .map((t) => ({ symbol: t.symbol, pct: Math.abs(Number(t.priceChangePercent) || 0) }))
    .filter((t) => t.symbol.endsWith('USDT') && !LIQ_CFG.symbols.includes(t.symbol))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)
    .map((t) => t.symbol)
  const symbols = [...new Set([...LIQ_CFG.symbols, ...movers])]

  const rows = []
  let oiUsdTotal = 0
  for (const symbol of symbols) {
    const markPx = markBy.get(symbol) || 0
    let oiUsd = null
    try {
      const contracts = await openInterest(symbol, { fetchImpl })
      oiUsd = Math.round(contracts * markPx)
    } catch { oiUsd = null }
    if (oiUsd) oiUsdTotal += oiUsd

    let lsRatio = null
    try {
      const hist = await fapi('/futures/data/globalLongShortAccountRatio', { symbol, period: '5m', limit: 2 }, { fetchImpl })
      const arr = Array.isArray(hist) ? hist : []
      if (arr.length) lsRatio = Number(arr[arr.length - 1].longShortRatio) || null
    } catch { lsRatio = null }

    const est = markPx && oiUsd
      ? estimateZones({ markPx, oiUsd }).sort((a, b) => b.usd - a.usd).slice(0, 6)
      : []
    rows.push({ symbol, markPx, oiUsd, lsRatio, est })
  }

  // Thanh ly that tu file (watch da ghi) — khong co -> [] (fail-soft, khong doan).
  const events = readLiqEvents({ now: ts })
  const clusters = clusterLiqs(events)
  for (const r of rows) r.actual = clusters.filter((c) => c.symbol === r.symbol).slice(0, 3)

  const Intel = await getIntel()
  const mongo = Intel ? 'up' : 'down'
  let alerted = 0
  if (Intel) {
    await saveSnapshot('zone', rows.map((r) => ({
      key: `zone:${r.symbol}`,
      symbol: r.symbol,
      ts,
      score: r.oiUsd ? Math.round(r.oiUsd / 1e6) : null,
      data: { markPx: r.markPx, oiUsd: r.oiUsd, lsRatio: r.lsRatio, est: r.est, actual: r.actual },
    })))

    // Cuc that lon trong 1h -> TG (dedupe theo gio - D4).
    const hourEvents = events.filter((e) => ts - e.ts <= 3600_000)
    const hotBySym = new Map()
    for (const e of hourEvents) hotBySym.set(e.symbol, (hotBySym.get(e.symbol) || 0) + e.usd)
    const big = [...hotBySym.entries()].filter(([, usd]) => usd >= LIQ_CFG.alertUsd).sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (big.length) {
      const res = await insertEvents(big.map(([symbol, usd]) => ({
        key: `alert:liq:${symbol}:${hourBucket(ts)}`,
        kind: 'alert',
        symbol,
        ts,
        score: Math.round(usd / 1e6),
        data: { usd, window: '1h' },
      })))
      if (res?.inserted.length) {
        const fresh = big.filter(([symbol]) => res.inserted.includes(`alert:liq:${symbol}:${hourBucket(ts)}`))
        await send(
          ['💥 TM Trading — THANH LÝ NẶNG (1h)', ...fresh.map(([s, u]) => `• ${s}: $${(u / 1e6).toFixed(1)}M đã thanh lý`), `Cửa sổ ${LIQ_CFG.windowH}h · chi tiết: card Regime & Zones.`].join('\n'),
          '[liquidation]',
        )
        alerted = res.inserted.length
      }
    }
  }

  return {
    symbols: rows.length,
    oiUsd: oiUsdTotal,
    events: events.length,
    clusters: clusters.length,
    alerted,
    mongo,
  }
}
