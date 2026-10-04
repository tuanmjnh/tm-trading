// =============================================================================
//  TM TRADING - METHOD: TREND (Phase 10, method 2)
//
//  Xu huong kinh dien tren MA + ATR — khong can volume, khong can pattern:
//   - PULL   : MA fast van tren MA slow (trend con) + retest MA fast (rong
//              pullDist x ATR) ma close van giu huong -> vao theo trend
//   - BRK    : close pha Donchian (highest/lowest brkLen bar truoc) -> break
//              momentum; SL o chinh level bi pha + slBuf x ATR
//   - RANGE  : MA fast/slow gan nhau (thi truong phang) + price nho trong
//              hop (bandwidth <= rngBand x ATR) -> mean reversion: mua o
//              day hop, ban o dinh hop
//
//  Tat ca entry MARKET tai close bar phat. Setup di qua simulateSetups()
//  (NGHIA giong VSA — xem simulate.mjs).
//   - 1 lenh/luc: signal moi khi con setup mo bi BO QUA (replaceActive: false)
//     — BRK/PULL re-fire moi bar -> neu thay nhu D5 thi setup song sót la cuoi
//     chuoi = vao dung dinh (adverse selection, gap khi chay league).
// =============================================================================
import { registerMethod } from './index.mjs'
import { atr, sma } from '../ta.mjs'
import { simulateSetups } from './simulate.mjs'

export const ID = 'trend'

export const DEFAULTS = Object.freeze({
  fast: 20,
  slow: 50,
  pullOn: true,
  pullDist: 0.35,    // retest MA fast trong khoang pullDist x ATR
  brkOn: true,
  brkLen: 20,        // Donchian window cho breakout
  rngOn: true,
  rngLen: 50,        // cua so hop
  rngBand: 2.0,      // bandwidth <= rngBand x ATR -> hop hop ly cho mean-rev
  rngAtrFlat: 1.0,   // |fast - slow| <= rngAtrFlat x ATR -> xem la "phang"
  atrLen: 14,
  slBuf: 0.5,
  rrFb: 2.0,
  feePct: 0.05,
  slipPct: 0.02,
})

/** Diem huong theo type su kien — doi cay nay = doi ket qua confluence. */
export const EVENT_SCORE = Object.freeze({
  'PULL LONG': 0.6,
  'PULL SHORT': -0.6,
  'BRK LONG': 0.7,
  'BRK SHORT': -0.7,
  'RANGE LONG': 0.4,
  'RANGE SHORT': -0.4,
})

/**
 * Chay method — tra ve dung METHOD_CONTRACT.
 * @param {{time:number,open:number,high:number,low:number,close:number,volume:number}[]} bars
 * @param {Partial<typeof DEFAULTS>} opts
 */
export function analyze(bars, opts = {}) {
  const p = { ...DEFAULTS, ...opts }
  const list = Array.isArray(bars) ? bars : []
  const n = list.length
  const scores = new Array(n).fill(0)
  const events = []
  const signals = []

  const closes = list.map((b) => b.close)
  const highs = list.map((b) => b.high)
  const lows = list.map((b) => b.low)
  const fastA = sma(closes, p.fast)
  const slowA = sma(closes, p.slow)
  const atrs = atr(list, p.atrLen)

  const ev = (i, type) => { events.push({ bar: i, type }); scores[i] = EVENT_SCORE[type] ?? 0 }
  const plan = (i, dir, sl) => {
    const entry = list[i].close
    const risk = dir === 1 ? entry - sl : sl - entry
    if (!(risk > 0)) return
    const tp = dir === 1 ? entry + p.rrFb * risk : entry - p.rrFb * risk
    signals.push({ bar: i, dir, entry, sl, tp, entryType: 'market' })
  }

  // Rolling highest/lowest TRUOC bar hien (khong nhin truoc): out[i] = extreme
  // cua [i-len+1 .. i] — dung out[i-1] cho so sanh voi close[i].
  const rollHigh = (len) => {
    const out = new Array(n).fill(null)
    for (let i = len - 1; i < n; i++) {
      let m = null
      for (let k = i - len + 1; k <= i; k++) m = m == null ? highs[k] : Math.max(m, highs[k])
      out[i] = m
    }
    return out
  }
  const rollLow = (len) => {
    const out = new Array(n).fill(null)
    for (let i = len - 1; i < n; i++) {
      let m = null
      for (let k = i - len + 1; k <= i; k++) m = m == null ? lows[k] : Math.min(m, lows[k])
      out[i] = m
    }
    return out
  }
  const brkH = p.brkOn ? rollHigh(p.brkLen) : null
  const brkL = p.brkOn ? rollLow(p.brkLen) : null
  const rngH = p.rngOn ? rollHigh(p.rngLen) : null
  const rngL = p.rngOn ? rollLow(p.rngLen) : null

  for (let i = 1; i < n; i++) {
    const b = list[i]
    const f = fastA[i]
    const s = slowA[i]
    const a = Number.isFinite(atrs[i]) ? atrs[i] : null
    if (!Number.isFinite(f) || !Number.isFinite(s) || !a) continue

    const up = f > s
    const dn = f < s
    const flat = Math.abs(f - s) <= p.rngAtrFlat * a
    let fired = 0

    // --- PULL: retest MA fast giu huong trend ---
    if (p.pullOn && up) {
      const zoneLo = f - p.pullDist * a
      const zoneHi = f + p.pullDist * a
      if (b.low <= zoneHi && b.low >= zoneLo && b.close > f) {
        ev(i, 'PULL LONG')
        plan(i, 1, b.low - p.slBuf * a)
        fired++
      }
    } else if (p.pullOn && dn) {
      const zoneHi = f + p.pullDist * a
      const zoneLo = f - p.pullDist * a
      if (b.high >= zoneLo && b.high <= zoneHi && b.close < f) {
        ev(i, 'PULL SHORT')
        plan(i, -1, b.high + p.slBuf * a)
        fired++
      }
    }

    // --- BRK: close pha Donchian truoc do ---
    if (p.brkOn && fired === 0 && brkH && brkL) {
      const ph = brkH[i - 1]
      const pl = brkL[i - 1]
      if (Number.isFinite(ph) && b.close > ph && list[i - 1].close <= ph) {
        ev(i, 'BRK LONG')
        plan(i, 1, ph - p.slBuf * a)
        fired++
      } else if (Number.isFinite(pl) && b.close < pl && list[i - 1].close >= pl) {
        ev(i, 'BRK SHORT')
        plan(i, -1, pl + p.slBuf * a)
        fired++
      }
    }

    // --- RANGE: thang phang + nho trong hop -> mean reversion ---
    if (p.rngOn && fired === 0 && flat && rngH && rngL) {
      const hh = rngH[i]
      const ll = rngL[i]
      if (Number.isFinite(hh) && Number.isFinite(ll)) {
        const bw = hh - ll
        if (bw > 0 && bw <= p.rngBand * a) {
          const q = bw * 0.15
          if (b.close <= ll + q) {
            ev(i, 'RANGE LONG')
            plan(i, 1, ll - p.slBuf * a)
          } else if (b.close >= hh - q) {
            ev(i, 'RANGE SHORT')
            plan(i, -1, hh + p.slBuf * a)
          }
        }
      }
    }
  }

  return { method: ID, events, scores, setups: simulateSetups(list, signals, { replaceActive: false }), params: p, bars: list }
}

export const method = Object.freeze({
  id: ID,
  name: 'Trend (MA pullback, ATR/Donchian breakout, range mean-reversion)',
  defaults: DEFAULTS,
  analyze,
})

registerMethod(method)
