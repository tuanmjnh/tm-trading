#!/usr/bin/env node
// =============================================================================
//  TM TRADING - METHOD: LIQUIDITY SWEEP (Phase 11, ung vien league)
//
//  Port logic cua indicator "TM Liquidity Sweep" (pine/parts-sweep/) sang engine
//  de DO duoc. Phuong phap: gia QUET qua level thanh khoan (rau vuot) roi DONG
//  CUA TRO LAI -> dao chieu; xac nhan bang volume VSA.
//
//  Level = pivot swing (kieu Liquidity Swings [LuxAlgo]); level bi close vuot HAN
//  (breakout) bi loai. buy = level TREN (swing high), sell = level DUOI.
//
//  CACH VAO LENH (entryMode) — day la don bay chinh, do bang walk-forward:
//   - 'market' : vao NGAY bar quet (hanh vi cu).
//   - 'retest' : cho gia TEST LAI level voi volume THAP roi moi vao.
//   - 'confirm': cho bar XAC NHAN dao chieu (close vuot han cuc tri bar quet
//                theo huong dao chieu = displacement / BOS nho) roi moi vao.
//
//  CAC BO LOC (tham so):
//   - wickRatio     : rau boi >= wickRatio x bien do nen (0.5)
//   - volSweepMin   : volume ratio bar quet >= nguong (1.2) — cong VSA
//   - minTouches    : level phai duoc "ton trong" >= N lan (0 = tat)
//   - trendFast/Slow: chi SHORT khi xu huong xuong, LONG khi len (0 = tat)
//   - volRetestMax  : nguong volume khi test lai (1.2)
//   - retestBars/confirmBars: cua so cho test lai / xac nhan
//   - minRR         : RR toi thieu cua TP (2.0)
//   - slMinAtr/slMaxAtr: SAN/TRAAN do rong SL theo ATR (0.5 / 3.0)
//
//  Entry MARKET tai close bar phat. SL ngoai cuc tri rau quet + slBuf x ATR.
//  Setup qua simulateSetups() — NGHIA giong VSA (replaceActive: false).
// =============================================================================
import { registerMethod } from './index.mjs'
import { atr, rma, sma, pivotHigh, pivotLow } from '../ta.mjs'
import { simulateSetups } from './simulate.mjs'

export const ID = 'sweep'

export const DEFAULTS = Object.freeze({
  pivLen: 14,
  lvlFresh: 300,
  maxLvl: 8,
  tolAtr: 0.5,
  minTouches: 0,
  wickRatio: 0.5,
  volLen: 20,
  volSweepMin: 1.2,
  entryMode: 'retest',    // 'market' | 'retest' | 'confirm'  (retest = robust nhat qua walk-forward)
  retestBars: 10,
  volRetestMax: 1.2,
  confirmBars: 10,
  trendFast: 50,
  trendSlow: 200,
  minRR: 2.0,
  slBuf: 0.5,
  slMinAtr: 0.5,
  slMaxAtr: 3.0,
  rrFb: 2.0,
  atrLen: 14,
  feePct: 0.05,
  slipPct: 0.02,
})

/** Diem huong theo type su kien — doi cay nay = doi ket qua confluence. */
export const EVENT_SCORE = Object.freeze({
  'SWEEP LONG': 0.7,
  'SWEEP SHORT': -0.7,
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
  const closes = list.map((b) => b.close)
  const vols = list.map((b) => b.volume)
  const atrs = atr(list, p.atrLen)
  const volMa = rma(vols, p.volLen)
  const fastSma = p.trendFast > 0 ? sma(closes, p.trendFast) : null
  const slowSma = p.trendSlow > 0 ? sma(closes, p.trendSlow) : null
  const phArr = pivotHigh(highs, p.pivLen, p.pivLen)
  const plArr = pivotLow(lows, p.pivLen, p.pivLen)

  const buy = []  // level TREN (buy-side) — quet len -> SHORT
  const sell = [] // level DUOI (sell-side) — quet xuong -> LONG

  const trendOn = p.trendFast > 0 && p.trendSlow > 0
  const ev = (i, type) => { events.push({ bar: i, type }); scores[i] = EVENT_SCORE[type] ?? 0 }
  const ratioAt = (i) => {
    const m = volMa[i]
    return Number.isFinite(m) && m > 0 ? vols[i] / m : 0
  }
  const trendUp = (i) => !trendOn || (Number.isFinite(fastSma[i]) && Number.isFinite(slowSma[i]) && fastSma[i] > slowSma[i])
  const trendDn = (i) => !trendOn || (Number.isFinite(fastSma[i]) && Number.isFinite(slowSma[i]) && fastSma[i] < slowSma[i])

  const removeLvl = (arr, obj) => {
    const k = arr.indexOf(obj)
    if (k >= 0) arr.splice(k, 1)
  }

  /** TP = level doi dien gan nhat cho RR >= minRR; khong co -> fallback rrFb x R. */
  const tpFor = (i, dir, entry, risk) => {
    const rr = p.minRR
    let best = null
    if (dir === 1) {
      for (const L of buy) {
        if (i - L.bar > p.lvlFresh) continue
        if (L.px >= entry + rr * risk && (best == null || L.px < best)) best = L.px
      }
    } else {
      for (const L of sell) {
        if (i - L.bar > p.lvlFresh) continue
        if (L.px <= entry - rr * risk && (best == null || L.px > best)) best = L.px
      }
    }
    if (best != null) return best
    return p.rrFb >= rr ? (dir === 1 ? entry + p.rrFb * risk : entry - p.rrFb * risk) : null
  }

  /** Setup market; null neu risk ngoai [slMin,slMax] hoac TP vo nghia. */
  const mkSignal = (i, dir, extreme, entryPx) => {
    const a = atrs[i]
    if (!Number.isFinite(a)) return null
    const entry = entryPx == null ? closes[i] : entryPx
    const sl = dir === 1 ? extreme - p.slBuf * a : extreme + p.slBuf * a
    const risk = dir === 1 ? entry - sl : sl - entry
    if (!(risk > 0)) return null
    if (risk < p.slMinAtr * a || risk > p.slMaxAtr * a) return null
    const tp = tpFor(i, dir, entry, risk)
    if (tp == null) return null
    return { bar: i, dir, entry, sl, tp, entryType: 'market' }
  }

  let pending = null // {dir, px, sweepBar, sweepHigh, sweepLow}

  for (let i = 1; i < n; i++) {
    const b = list[i]
    const a = Number.isFinite(atrs[i]) ? atrs[i] : null
    const range = b.high - b.low
    const upW = b.high - Math.max(b.open, b.close)
    const dnW = Math.min(b.open, b.close) - b.low
    const ratio = ratioAt(i)

    // 1. Pivot moi -> level (giu toi da maxLvl moi ben)
    if (phArr[i]) { buy.push({ px: phArr[i].value, bar: phArr[i].index, touches: 0 }); if (buy.length > p.maxLvl) buy.shift() }
    if (plArr[i]) { sell.push({ px: plArr[i].value, bar: plArr[i].index, touches: 0 }); if (sell.length > p.maxLvl) sell.shift() }

    // 2. Bo level qua cu
    for (let k = buy.length - 1; k >= 0; k--) if (i - buy[k].bar > p.lvlFresh) buy.splice(k, 1)
    for (let k = sell.length - 1; k >= 0; k--) if (i - sell[k].bar > p.lvlFresh) sell.splice(k, 1)

    // 3. touches + loai level bi close vuot HAN (breakout)
    if (a) {
      for (let k = buy.length - 1; k >= 0; k--) {
        const L = buy[k]
        if (i <= L.bar) continue
        if (b.close > L.px) { buy.splice(k, 1); continue }
        if (b.high >= L.px - p.tolAtr * a) L.touches++
      }
      for (let k = sell.length - 1; k >= 0; k--) {
        const L = sell[k]
        if (i <= L.bar) continue
        if (b.close < L.px) { sell.splice(k, 1); continue }
        if (b.low <= L.px + p.tolAtr * a) L.touches++
      }
    }

    // 4. Giai pending (retest / confirm) — chi xet tu bar sau bar quet
    if (pending) {
      if (i > pending.sweepBar) {
        const isLong = pending.dir === 1
        let cancel = false
        if (a) {
          const slNow = isLong ? pending.sweepLow - p.slBuf * a : pending.sweepHigh + p.slBuf * a
          if (isLong ? (b.low <= slNow || b.close < pending.px) : (b.high >= slNow || b.close > pending.px)) cancel = true
        }
        const maxBars = p.entryMode === 'confirm' ? p.confirmBars : p.retestBars
        if (i - pending.sweepBar > maxBars) cancel = true
        if (cancel) {
          pending = null
        } else {
          let trigger = false
          if (p.entryMode === 'retest') {
            const touch = isLong ? b.low <= pending.px : b.high >= pending.px
            trigger = touch && ratio < p.volRetestMax
          } else {
            trigger = isLong ? b.close > pending.sweepHigh : b.close < pending.sweepLow
          }
          if (trigger) {
            const sig = mkSignal(i, pending.dir, isLong ? pending.sweepLow : pending.sweepHigh, b.close)
            if (sig) { signals.push(sig); ev(i, isLong ? 'SWEEP LONG' : 'SWEEP SHORT') }
            pending = null
          }
        }
      }
      continue // dang cho -> khong mo them
    }

    // 5. Cong VSA + phat hien quet moi
    if (!a || range <= 0 || !(ratio >= p.volSweepMin)) continue

    let shortL = null // level TREN bi quet -> SHORT
    for (const L of buy) {
      if (i <= L.bar) continue
      if (p.minTouches > 0 && L.touches < p.minTouches) continue
      if (b.high > L.px && b.close < L.px) {
        const d = Math.abs(b.high - L.px)
        if (shortL == null || d < shortL.d) shortL = { d, L }
      }
    }
    let longL = null // level DUOI bi quet -> LONG
    for (const L of sell) {
      if (i <= L.bar) continue
      if (p.minTouches > 0 && L.touches < p.minTouches) continue
      if (b.low < L.px && b.close > L.px) {
        const d = Math.abs(L.px - b.low)
        if (longL == null || d < longL.d) longL = { d, L }
      }
    }

    let shortOk = shortL != null && upW >= p.wickRatio * range && trendDn(i)
    let longOk = longL != null && dnW >= p.wickRatio * range && trendUp(i)
    if (shortOk && longOk) {
      if (dnW > upW) shortOk = false
      else longOk = false
    }

    if (shortOk) {
      removeLvl(buy, shortL.L)
      if (p.entryMode === 'market') {
        const sig = mkSignal(i, -1, b.high)
        if (sig) { signals.push(sig); ev(i, 'SWEEP SHORT') }
      } else {
        pending = { dir: -1, px: shortL.L.px, sweepBar: i, sweepHigh: b.high, sweepLow: b.low }
      }
    } else if (longOk) {
      removeLvl(sell, longL.L)
      if (p.entryMode === 'market') {
        const sig = mkSignal(i, 1, b.low)
        if (sig) { signals.push(sig); ev(i, 'SWEEP LONG') }
      } else {
        pending = { dir: 1, px: longL.L.px, sweepBar: i, sweepHigh: b.high, sweepLow: b.low }
      }
    }
  }

  return { method: ID, events, scores, setups: simulateSetups(list, signals, { replaceActive: false }), params: p, bars: list }
}

export const method = Object.freeze({
  id: ID,
  name: 'Liquidity Sweep (quet thanh khoan + rau tu choi + volume VSA)',
  defaults: DEFAULTS,
  analyze,
})

registerMethod(method)
