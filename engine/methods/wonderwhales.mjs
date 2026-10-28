#!/usr/bin/env node
// =============================================================================
//  TM TRADING - METHOD: WONDERWHALES (Phase 12, ung vien league)
//
//  Port logic cua indicator "Wonderwhales" (pine/parts-wonderwhales/) sang engine
//  de DO duoc. Phuong phap: DAO CHIEU theo Parabolic SAR flip, co 4 che do signal
//  giong hang pine:
//   - 'sar'        : pure PSAR reversal flips
//   - 'ema'        : fast EMA x slow EMA crossovers
//   - 'sar-ema'    : PSAR flip CHI khi thoa huong EMA (fast>slow = bull)
//   - 'sar-ema-atr': nhu tren + loc ATR% (atrs/close*100 >= minAtrPct) bo chop
//
//  CACH VAO LENH: entry MARKET tai close bar flip. SL = gia tri SAR tai flip
//  (chinh la EP cua xu huong cu) + slBuf x ATR bien an toan. TP = rrFb x risk.
//  Setup qua simulateSetups() — NGHIA giong VSA/trend (replaceActive: false).
//
//  VSA volume buckets trong pine la DISPLAY-ONLY (khong tham gia signal) nen
//  khong port vao day — dung method 'vsa' khi muon tin hieu theo volume.
// =============================================================================
import { registerMethod } from './index.mjs'
import { atr, ema, sar } from '../ta.mjs'
import { simulateSetups } from './simulate.mjs'

export const ID = 'wonderwhales'

export const MODES = Object.freeze(['sar', 'ema', 'sar-ema', 'sar-ema-atr'])

export const DEFAULTS = Object.freeze({
  mode: 'sar-ema-atr',  // 'sar' | 'ema' | 'sar-ema' | 'sar-ema-atr'
  psarStart: 0.02,
  psarInc: 0.02,
  psarMax: 0.2,
  fast: 20,
  slow: 50,
  atrLen: 14,
  minAtrPct: 0.2,       // % gia tri — bo tin hieu khi ATR% thap (thi truong phang). Giu <=0.2 cho BTCUSDT 15m
  slBuf: 0.5,
  rrFb: 2.0,
  feePct: 0.05,
  slipPct: 0.02,
})

/** Diem huong theo type su kien — doi cay nay = doi ket qua confluence. */
export const EVENT_SCORE = Object.freeze({
  'SAR FLIP LONG': 0.6,
  'SAR FLIP SHORT': -0.6,
  'EMA CROSS LONG': 0.5,
  'EMA CROSS SHORT': -0.5,
})

/**
 * Anh xa event -> tu vung signal (engine/signalContract SIGNAL_EVENT_TYPES).
 * Signal layer chi dung ST LONG/ST SHORT cho entry; event name cua method giu
 * nguyen trong meta.eventType de truy vet. signalEngine doc field nay (tuy
 * chon) — method khong co no thi type duoc giu nguyen nhu cu.
 */
export const EVENT_SIGNAL_TYPE = Object.freeze({
  'SAR FLIP LONG': 'ST LONG',
  'SAR FLIP SHORT': 'ST SHORT',
  'EMA CROSS LONG': 'ST LONG',
  'EMA CROSS SHORT': 'ST SHORT',
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
  const sarA = sar(list, p.psarStart, p.psarInc, p.psarMax)
  const fastA = ema(closes, p.fast)
  const slowA = ema(closes, p.slow)
  const atrs = atr(list, p.atrLen)

  const ev = (i, type) => { events.push({ bar: i, type }); scores[i] = EVENT_SCORE[type] ?? 0 }
  const plan = (i, dir, sl) => {
    const entry = list[i].close
    const risk = dir === 1 ? entry - sl : sl - entry
    if (!(risk > 0)) return
    const tp = dir === 1 ? entry + p.rrFb * risk : entry - p.rrFb * risk
    signals.push({ bar: i, dir, entry, sl, tp, entryType: 'market' })
  }

  // Huong SAR theo dung quy uoc pine (30_calc.pine): sar < low => bull.
  const sarDir = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    const s = sarA[i]
    if (!Number.isFinite(s)) continue
    if (s < lows[i]) sarDir[i] = 1
    else if (s > highs[i]) sarDir[i] = -1
  }

  const mode = MODES.includes(p.mode) ? p.mode : 'sar-ema-atr'
  const useEma = mode === 'ema' || mode === 'sar-ema' || mode === 'sar-ema-atr'
  const useAtr = mode === 'sar-ema-atr'

  for (let i = 1; i < n; i++) {
    const b = list[i]
    const prevDir = sarDir[i - 1]
    const dir = sarDir[i]
    const a = Number.isFinite(atrs[i]) ? atrs[i] : null
    const f = fastA[i]
    const s = slowA[i]
    const fPrev = fastA[i - 1]
    const sPrev = slowA[i - 1]
    const emaReady = useEma && Number.isFinite(f) && Number.isFinite(s)
      && Number.isFinite(fPrev) && Number.isFinite(sPrev)
    const emaBull = emaReady && f > s
    const emaBear = emaReady && f < s
    const atrPct = a && b.close > 0 ? (a / b.close) * 100 : 0
    const atrOk = !useAtr || (a && atrPct >= p.minAtrPct)

    // --- EMA crossover mode ---
    if (mode === 'ema') {
      if (emaReady && fPrev <= sPrev && f > s) {
        ev(i, 'EMA CROSS LONG')
        plan(i, 1, b.low - (a ? p.slBuf * a : b.close * 0.01))
      } else if (emaReady && fPrev >= sPrev && f < s) {
        ev(i, 'EMA CROSS SHORT')
        plan(i, -1, b.high + (a ? p.slBuf * a : b.close * 0.01))
      }
      continue
    }

    // --- SAR flip modes ---
    const buyFlip = dir === 1 && prevDir === -1
    const sellFlip = dir === -1 && prevDir === 1
    if (!buyFlip && !sellFlip) continue

    const emaOk = !useEma || (buyFlip ? emaBull : emaBear)
    if (buyFlip && emaOk && atrOk) {
      ev(i, 'SAR FLIP LONG')
      // SL o gia tri SAR vua lat (EP cua xu huong cu) + buffer.
      plan(i, 1, sarA[i] - (a ? p.slBuf * a : 0))
    } else if (sellFlip && emaOk && atrOk) {
      ev(i, 'SAR FLIP SHORT')
      plan(i, -1, sarA[i] + (a ? p.slBuf * a : 0))
    }
  }

  return { method: ID, events, scores, setups: simulateSetups(list, signals, { replaceActive: false }), params: p, bars: list }
}

export const method = Object.freeze({
  id: ID,
  name: 'Wonderwhales (PSAR reversal / EMA cross, optional EMA + ATR% filter)',
  defaults: DEFAULTS,
  eventSignalType: EVENT_SIGNAL_TYPE,
  analyze,
})

registerMethod(method)
