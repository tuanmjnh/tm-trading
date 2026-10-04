// =============================================================================
//  TM TRADING - METHOD: PRICE ACTION / SMC (Phase 10, method 1)
//
//  Candle pattern kinh dien + cau truc (khong dung volume, khong dung MA):
//   - PIN bar    : ria duoi/duoi >= pinWick x pham vi, body nho -> tu choi ban/
//                  tu choi mua (setup market, SL ngoai cum ria + slBuf x ATR)
//   - Engulfing  : cot hien nuot chung cot truoc (theo body) + huong nguoc
//   - Inside bar : cot thu hep (chi su kien xac nhan — khong tinh diem huong)
//   - BOS        : close vuot swing high/low vua xac nhan (pivot) -> pha cau
//                  truc (setup, SL o chinh level bi pha + slBuf x ATR)
//
//  Toan bo entry la MARKET tai close cua bar phat (xac nhan tai close) — khong
//  doan limit vi pattern PA khong co "gia vao" tu nhien nhu vung SV/BC cua VSA.
//  Setup di qua simulateSetups() — NGHIA fill/exit dung nhu VSA (xem simulate.mjs).
//   - 1 lenh/luc: signal moi khi con setup mo bi BO QUA (replaceActive: false)
//     — khong thay nhu D5 cua VSA (BRK/PULL re-fire moi bar -> vao cuoi chuoi
//     = adverse selection, gap khi chay league).
// =============================================================================
import { registerMethod } from './index.mjs'
import { atr, pivotHigh, pivotLow } from '../ta.mjs'
import { simulateSetups } from './simulate.mjs'

export const ID = 'price-action'

export const DEFAULTS = Object.freeze({
  pinWick: 0.6,      // ria / pham vi >= 60% -> pin
  pinBodyMax: 0.4,   // body / pham vi <= 40% -> pin
  engOn: true,
  insOn: true,
  bosOn: true,
  pivLeft: 3,
  pivRight: 3,
  atrLen: 14,
  slBuf: 0.5,        // SL lui them slBuf x ATR ngoai cuc tri pattern
  rrFb: 2.0,         // TP = entry + rrFb x risk
  feePct: 0.05,
  slipPct: 0.02,
})

/** Diem huong theo type su kien — doi cay nay = doi ket qua confluence. */
export const EVENT_SCORE = Object.freeze({
  'PIN LONG': 0.7,
  'PIN SHORT': -0.7,
  'ENG LONG': 0.6,
  'ENG SHORT': -0.6,
  'BOS LONG': 0.5,
  'BOS SHORT': -0.5,
  // INSIDE: chi su kien, khong huong -> 0 (khong dua vao map)
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

  const highs = list.map((b) => b.high)
  const lows = list.map((b) => b.low)
  const atrs = atr(list, p.atrLen)

  // Pivot xac nhan tai bar i (i = pivot + pivRight) -> cap nhat swing gan nhat.
  const phArr = pivotHigh(highs, p.pivLeft, p.pivRight)
  const plArr = pivotLow(lows, p.pivLeft, p.pivRight)
  let lastPH = null
  let lastPL = null

  const ev = (i, type) => { events.push({ bar: i, type }); scores[i] = EVENT_SCORE[type] ?? 0 }
  const plan = (i, dir, sl) => {
    const entry = list[i].close
    const risk = dir === 1 ? entry - sl : sl - entry
    if (!(risk > 0)) return
    const tp = dir === 1 ? entry + p.rrFb * risk : entry - p.rrFb * risk
    signals.push({ bar: i, dir, entry, sl, tp, entryType: 'market' })
  }

  for (let i = 1; i < n; i++) {
    const b = list[i]
    const pv = list[i - 1]
    const a = Number.isFinite(atrs[i]) ? atrs[i] : null
    const range = b.high - b.low
    const body = Math.abs(b.close - b.open)
    const upW = b.high - Math.max(b.open, b.close)
    const dnW = Math.min(b.open, b.close) - b.low

    if (phArr[i] != null) lastPH = phArr[i]
    if (plArr[i] != null) lastPL = plArr[i]

    // --- PIN bar ---
    if (a && range > 0) {
      const bodyRatio = body / range
      if (bodyRatio <= p.pinBodyMax) {
        if (dnW / range >= p.pinWick && b.close > b.low + range * 0.5) {
          ev(i, 'PIN LONG')
          plan(i, 1, b.low - p.slBuf * a)
        } else if (upW / range >= p.pinWick && b.close < b.high - range * 0.5) {
          ev(i, 'PIN SHORT')
          plan(i, -1, b.high + p.slBuf * a)
        }
      }
    }

    // --- Engulfing (cot truoc nguoc huong, body nuot chung) ---
    if (p.engOn && a) {
      const pvBear = pv.close < pv.open
      const pvBull = pv.close > pv.open
      const bull = b.close > b.open
      const bear = b.close < b.open
      const bodyPrev = Math.abs(pv.close - pv.open)
      if (pvBear && bull && b.open <= pv.close && b.close >= pv.open && body >= bodyPrev) {
        ev(i, 'ENG LONG')
        plan(i, 1, Math.min(b.open, b.low) - p.slBuf * a)
      } else if (pvBull && bear && b.open >= pv.close && b.close <= pv.open && body >= bodyPrev) {
        ev(i, 'ENG SHORT')
        plan(i, -1, Math.max(b.open, b.high) + p.slBuf * a)
      }
    }

    // --- Inside bar (su kien xac nhan, khong huong -> scores van 0) ---
    if (p.insOn && b.high <= pv.high && b.low >= pv.low) {
      events.push({ bar: i, type: 'INSIDE' })
    }

    // --- BOS: close pha swing vua xac nhan (mot lan cho moi swing) ---
    if (p.bosOn && a) {
      if (lastPH != null && b.close > lastPH && list[i - 1].close <= lastPH) {
        ev(i, 'BOS LONG')
        plan(i, 1, lastPH - p.slBuf * a)
        lastPH = null // mot lan — cho den khi pivot moi xac nhan
      } else if (lastPL != null && b.close < lastPL && list[i - 1].close >= lastPL) {
        ev(i, 'BOS SHORT')
        plan(i, -1, lastPL + p.slBuf * a)
        lastPL = null
      }
    }
  }

  return { method: ID, events, scores, setups: simulateSetups(list, signals, { replaceActive: false }), params: p, bars: list }
}

export const method = Object.freeze({
  id: ID,
  name: 'Price action / SMC (pin, engulf, inside, BOS)',
  defaults: DEFAULTS,
  analyze,
})

registerMethod(method)
