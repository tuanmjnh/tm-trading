// =============================================================================
//  TM TRADING - METHOD: ORDERFLOW (Phase 10, method 3)
//
//  Doc nhanh luong taker mua/ban tu tick (cot K-line da luu `takerBuy`):
//   - DELTA SPIKE : cot volume lon bat thuong (>= spikeMult x MA volume) va
//                   taker chiem qua deltaTh cua tong (taker mua thua qua thi
//                   mua qua manh / nguoc lai) -> entry theo huong don day do
//   - DIV          : gia tao dinh moi MA delta lai KHONG dap (tich luy taker
//                   yeu di) -> phan khang (chi su kien xac nhan, khong dat
//                   setup — giam so lenh yeu tin)
//
//  `takerBuy` bat buoc (kline tra `taker_buy_volume`) — cot thieu thi bo qua,
//  khong doan gia. Tat ca entry MARKET, setup di qua simulateSetups()
//  (NGHIA giong VSA — xem simulate.mjs).
//   - 1 lenh/luc: signal moi khi con setup mo bi BO QUA (replaceActive: false).
// =============================================================================
import { registerMethod } from './index.mjs'
import { atr, sma } from '../ta.mjs'
import { simulateSetups } from './simulate.mjs'

export const ID = 'orderflow'

export const DEFAULTS = Object.freeze({
  volLen: 20,
  spikeMult: 1.5,   // volume >= spikeMult x MA(volume) -> cot bat thuong
  deltaTh: 0.3,     // |delta| / volume >= 0.3 (taker >=65% lenh) — do tren du lieu that
  divOn: true,
  divLen: 10,       // so bar so sanh cho divergence
  atrLen: 14,
  slBuf: 0.5,
  rrFb: 2.0,
  feePct: 0.05,
  slipPct: 0.02,
})

/** Diem huong theo type su kien — doi cay nay = doi ket qua confluence. */
export const EVENT_SCORE = Object.freeze({
  'DELTA LONG': 0.6,
  'DELTA SHORT': -0.6,
  'DIV BULL': 0.4,   // gia thap moi + delta cao hon -> dong vao (phan khang tich cuc)
  'DIV BEAR': -0.4,  // gia cao moi + delta thap hon -> dong ra (phan khang tiu cuc)
})

/**
 * Chay method — tra ve dung METHOD_CONTRACT.
 * @param {{time:number,open:number,high:number,low:number,close:number,volume:number,takerBuy?:number}[]} bars
 * @param {Partial<typeof DEFAULTS>} opts
 */
export function analyze(bars, opts = {}) {
  const p = { ...DEFAULTS, ...opts }
  const list = Array.isArray(bars) ? bars : []
  const n = list.length
  const scores = new Array(n).fill(0)
  const events = []
  const signals = []

  // Delta = taker mua - taker ban = 2*takerBuy - volume (khop cong thuc
  // takerBuyRatio * 2 - 1). Cot thieu takerBuy -> delta khong tinh duoc.
  const volMa = sma(list.map((b) => b.volume), p.volLen)
  const delta = list.map((b) =>
    Number.isFinite(b.takerBuy) && b.volume > 0 ? 2 * b.takerBuy - b.volume : null,
  )
  const atrs = atr(list, p.atrLen)

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
    const a = Number.isFinite(atrs[i]) ? atrs[i] : null
    const d = delta[i]
    const vm = volMa[i]
    let fired = 0

    // --- DELTA SPIKE: volume bat thuong + taker thuan manh ---
    if (a && d != null && Number.isFinite(vm) && vm > 0 && b.volume >= p.spikeMult * vm) {
      const dR = d / b.volume // -1..1
      if (dR >= p.deltaTh) {
        ev(i, 'DELTA LONG')
        plan(i, 1, b.low - p.slBuf * a)
        fired++
      } else if (dR <= -p.deltaTh) {
        ev(i, 'DELTA SHORT')
        plan(i, -1, b.high + p.slBuf * a)
        fired++
      }
    }

    // --- DIVERGENCE: gia tao cuc moi, delta khong theo (chi event) ---
    // Bo loc: bar phai co volume >= MA (du phan hop — div tren volume yeu la
    // nhieu, khong dang tin). Do con thieu bo loc nay event cham 23% bar.
    if (p.divOn && fired === 0 && i >= p.divLen && Number.isFinite(vm) && b.volume >= vm) {
      let priceHH = true
      let priceLL = true
      let dPrevMax = null
      let dPrevMin = null
      let okDelta = true
      for (let k = i - p.divLen; k < i; k++) {
        if (list[k].close >= b.close) priceHH = false
        if (list[k].close <= b.close) priceLL = false
        const dk = delta[k]
        if (dk == null) { okDelta = false; break }
        dPrevMax = dPrevMax == null ? dk : Math.max(dPrevMax, dk)
        dPrevMin = dPrevMin == null ? dk : Math.min(dPrevMin, dk)
      }
      if (okDelta && d != null) {
        if (priceHH && dPrevMax != null && d < dPrevMax) {
          ev(i, 'DIV BEAR') // gia cao moi nhung delta yeu hon da qua
        } else if (priceLL && dPrevMin != null && d > dPrevMin) {
          ev(i, 'DIV BULL') // gia thap moi nhung delta manh hon da qua
        }
      }
    }
  }

  return { method: ID, events, scores, setups: simulateSetups(list, signals, { replaceActive: false }), params: p, bars: list }
}

export const method = Object.freeze({
  id: ID,
  name: 'Orderflow (taker delta spike + delta divergence)',
  defaults: DEFAULTS,
  analyze,
})

registerMethod(method)
