#!/usr/bin/env node
// =============================================================================
//  TM TRADING - BACKTESTER  (roadmap Phase 4, D5 + D6)
//
//  Nguyen tac cua file nay: DUONG VAO interface plugin (engine/methods/index.mjs),
//  khong doc truc tiep vao noi that cua phuong phap nao ca.
//
//      method.analyze(bars, params) -> { events, scores, setups }
//      setups[] = { bar, dir, entry, sl, tp, risk, filled, fillBar, doneBar?, result? }
//
//  Backtester CHI phu trach nhung thu THUOC VE VI THE, khong thuoc ve "phuong phap
//  phan tich" (xem methods/index.mjs - muc nay duoc chot truoc de Phase 10 them
//  method PA/SMC ma khong phai boc lai backtest):
//      - phi (feePct) + slippage (slipPct)      -> cost.mjs
//      - danh dau lenh (Trade model) + PnL/R    -> phan nay
//      - phan giai thu tu TP/SL trong bar (D6)  -> phan nay
//      - chinh sach "ST thay setup" (D5)        -> phan nay
//
//  DIEN GIAI D5 (quyet dinh quan trong nhat trong bang quyet dinh - roadmap §4):
//    `40_events.pine` chi co MOT o level. ST moi ghan lai tm_lvlE/S/T va
//    tm_lvlDone := false -> setup cu BI THAY MA KHONG LUU KET QUA. Ind khong
//    hien gi cho setup do. Vi vay:
//      - onReplace 'drop' (MAC DINH, dung voi Pine): setup da khop nhung chua
//        ket qua roi bi setup sau thay -> KHONG xuat trade. So nay van BI DEM
//        vao `counters.replaced` -> khong bao gio mat im.
//      - onReplace 'ttl' (BIEN THE, dat ten rieng, LOAI khoi moi so sanh parity):
//        dong tai bar cua ST thay the, nhan `result: 'TIME'`.
//    Neu ban chon 'drop' ma khong doc counters.replaced -> so WR/PF se dep hon
//    thuc te. Day la rui ro chu y, khong phai loi tinh toan.
//
//  DIEN GIAI D6:
//    Neu bar me cham CA TP va SL -> khong doan. Dua vao sub-bar 1m:
//      - 1m phan giai duoc (chi 1 muc cham trong 1m dau tien cham) -> lay ket qua do,
//        resolvedBy1m = true
//      - 1m cung khong phan giai duoc (cung 1m cham ca hai, hoac khong tim thay) -> SL
//        (bao thu), resolvedBy1m = false
//    Khong co 1m -> van SL (bao thu), resolvedBy1m = false.
//    Khong co su vi pham vi ro rang -> resolvedBy1m = null (khong can 1m).
// =============================================================================

import { METHOD_CONTRACT, getMethod } from './methods/index.mjs'
// Chi de DANG KY method vao registry (xem methods/all.mjs - khong the dat trong
// index.mjs vi sinh vong import). KHONG doc tu file nay: backtest van chi dung
// interface `analyze()`, chu khong biet method nao ton tai.
import './methods/all.mjs'

/** Cac chinh sach xu ly setup bi thay the. Nhan rieng, khong dua vao so sanh parity. */
export const ON_REPLACE = Object.freeze(['drop', 'ttl'])

/**
 * Chi phi giao dich tren 1 don vi tai san (tien, khong phai %).
 * Slippage huong NGUOC loi (mua cao hon, ban thap hon) - day la cach tinh bao thu.
 *
 * @param {number} entry  gia vao theo ke hoach
 * @param {number} exit   gia thoat (tp hoac sl)
 * @param {1|-1}   dir    1 = long, -1 = short
 * @param {{feePct:number, slipPct:number}} p
 * @returns {{net:number, fee:number, slipPerSide:number}}
 */
export function costsOf(entry, exit, dir, p) {
  const s = (Number(p.slipPct) || 0) / 100
  const f = (Number(p.feePct) || 0) / 100
  if (dir === 1) {
    const buy = entry * (1 + s)   // mua: slip day len
    const sell = exit * (1 - s)   // ban: slip day xuong
    const fee = f * (buy + sell)  // phi 2 chieu tren khong gian KHOP
    return { net: sell - buy - fee, slipPerSide: entry * s, fee }
  }
  const sell = entry * (1 - s)    // ban (vao lenh short): slip day xuong
  const buy = exit * (1 + s)      // mua de dong: slip day len
  const fee = f * (sell + buy)
  return { net: sell - buy - fee, slipPerSide: entry * s, fee }
}

/** Mot bar co cham muc nao khong (dung nghia cham = touch, khong can close). */
function touch(bar, dir, sl, tp) {
  const hitSl = dir === 1 ? bar.low <= sl : bar.high >= sl
  const hitTp = dir === 1 ? bar.high >= tp : bar.low <= tp
  return { hitSl, hitTp }
}

/** Do dai 1 bar me (ms) tai chi so i - suy tu bar ke, hoac tu truyen vao. */
function spanOf(list, i, tfMs) {
  if (tfMs > 0) return tfMs
  if (i + 1 < list.length) return list[i + 1].time - list[i].time
  if (i > 0) return list[i].time - list[i - 1].time
  return 0
}

/** Chi so dau tien co time >= t (mang da sap xep tang - binary search). */
function lowerBound(arr, t) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Cat mang bar 1m nam trong vung [t0, t1).
 * `cursor` duoc nang dan (doneBar tang dan) de khong quet lai tu dau.
 */
function sliceSub1m(sub1m, t0, t1, cursor) {
  let i = Math.max(cursor, lowerBound(sub1m, t0))
  const out = []
  while (i < sub1m.length && sub1m[i].time < t1) {
    out.push(sub1m[i])
    i++
  }
  return { out, cursor: i }
}

/**
 * D6 - di tim 1m dau tien cham mot trong hai muc.
 *
 * @returns {{result:'TP'|'SL', resolved:boolean}|'nodata'}
 *   'nodata' = khong co du lieu 1m cho vung nay -> caller giu ket qua cu (SL da bao thu)
 */
function resolveBySub1m(sub, dir, sl, tp) {
  if (!sub || sub.length === 0) return 'nodata'
  for (const b of sub) {
    const { hitSl, hitTp } = touch(b, dir, sl, tp)
    if (hitSl && hitTp) return { result: 'SL', resolved: false } // 1m cung vi pham vi -> bao thu
    if (hitSl) return { result: 'SL', resolved: true }
    if (hitTp) return { result: 'TP', resolved: true }
  }
  // 1m khong tai hien lai dieu bar me da cho thay -> du lieu lech, khong tin -> bao thu
  return { result: 'SL', resolved: false }
}

/**
 * Xac dinh ket qua dong cua mot setup, co the bi D6 chinh sua.
 *
 * @returns {{result:string, resolvedBy1m:boolean|null}}
 */
function resolveExit({ list, setup, fillBar, doneBar, sub1m, tfMs, cursor }) {
  const base = setup.result === 'TP' || setup.result === 'SL' ? setup.result : null
  if (base === null) return { result: setup.result ?? 'OPEN', resolvedBy1m: null }

  const bar = list[doneBar]
  const { hitSl, hitTp } = touch(bar, setup.dir, setup.sl, setup.tp)
  if (!(hitSl && hitTp)) return { result: base, resolvedBy1m: null } // ro rang -> khong can 1m

  let sub = null
  let next = cursor
  if (Array.isArray(sub1m) && sub1m.length) {
    const t0 = list[doneBar].time
    const t1 = t0 + spanOf(list, doneBar, tfMs)
    const sl = sliceSub1m(sub1m, t0, t1, cursor)
    sub = sl.out
    next = sl.cursor
  }

  const r = resolveBySub1m(sub, setup.dir, setup.sl, setup.tp)
  if (r === 'nodata') return { result: base, resolvedBy1m: false, cursor: next } // doan bao thu (SL da co san)
  return { result: r.result, resolvedBy1m: r.resolved, cursor: next }
}

/**
 * Chay backtest tren mot mang bar da dong.
 *
 * @param {{time:number,open:number,high:number,low:number,close:number,volume:number}[]} bars
 * @param {object} opts
 * @param {string|object} opts.method  id da dang ky ('vsa') hoac object plugin
 * @param {object}   [opts.params]     tham so day du (gop DEFAULTS truoc khi truyen)
 * @param {string}   opts.symbol
 * @param {string}   opts.tf           dinh dang tu data.mjs ('1','4','5','15','60','240')
 * @param {object[]} [opts.sub1m]      mang bar 1m da sap xep tang - dung cho D6
 * @param {'drop'|'ttl'} [opts.onReplace='drop']
 * @param {number}   [opts.tfMs]       so ms cua 1 bar me (mac dinh suy tu 2 bar dau)
 * @returns {{method:string, params:object, trades:object[], counters:object,
 *            events:object[], scores:number[], variant:string|null}}
 */
export function backtest(bars, opts = {}) {
  const list = Array.isArray(bars) ? bars : []
  if (list.length === 0) throw new Error('backtest: bars rong - khong co gi de replay')
  if (!opts.symbol) throw new Error('backtest: thieu opts.symbol (Trade model bat buoc)')
  if (!opts.tf) throw new Error('backtest: thieu opts.tf (Trade model bat buoc)')

  const method = typeof opts.method === 'string' ? getMethod(opts.method) : opts.method
  if (!method || typeof method.analyze !== 'function') {
    throw new Error(
      "backtest: thieu method hop le. Truyen {method:'vsa'} hoac object co analyze(). " +
        'Day la dieu CO Y: backtest khong duoc truy cap noi that cua mot phuong phap cu the.',
    )
  }

  const onReplace = opts.onReplace ?? 'drop'
  if (!ON_REPLACE.includes(onReplace)) {
    throw new Error(`backtest: onReplace khong hop le "${onReplace}" (chi: ${ON_REPLACE.join(', ')})`)
  }

  const sub1m = Array.isArray(opts.sub1m) ? opts.sub1m : null
  const tfMs = Number.isFinite(opts.tfMs) ? opts.tfMs : list.length > 1 ? list[1].time - list[0].time : 0

  const an = method.analyze(list, opts.params ?? {})
  for (const k of METHOD_CONTRACT.analyzeReturns) {
    if (an?.[k] === undefined) throw new Error(`backtest: method.analyze() thieu truong "${k}"`)
  }
  const setups = an.setups
  const p = an.params // da gop DEFAULTS - chinh la cai version.mjs da hash

  const trades = []
  const counters = {
    setups: setups.length,
    filled: 0,
    noFill: 0, // limit khong bao gio khop (docs/vsa-optimization.md: 64-72%)
    closed: 0,
    open: 0,
    replaced: 0, // da khop nhung bi ST sau thay truoc khi co ket qua
    dropped: 0, // so trade thuc su bi loai vi onReplace === 'drop'
  }

  let cursor = 0 // con tro vung 1m da dung

  for (let k = 0; k < setups.length; k++) {
    const s = setups[k]
    if (!s || !Number.isFinite(s.entry) || !Number.isFinite(s.sl) || !Number.isFinite(s.tp)) continue

    const isLast = k === setups.length - 1
    const filled = s.filled === true
    const fillBar = Number.isFinite(s.fillBar) ? s.fillBar : s.bar
    const hasResult = s.result === 'TP' || s.result === 'SL'

    if (!filled) {
      // Khop entry la dieu kien can (va du) de co mot lenh. Setup chua khop khong
      // phai la "thua" - no chua tung ton tai -> khong duoc dem vao WR.
      counters.noFill++
      continue
    }
    counters.filled++

    if (hasResult) {
      counters.closed++
      const r = resolveExit({ list, setup: s, fillBar, doneBar: s.doneBar, sub1m, tfMs, cursor })
      if (r.cursor !== undefined) cursor = r.cursor
      trades.push(buildTrade(list, s, fillBar, s.doneBar, r.result, r.resolvedBy1m, p, opts))
      continue
    }

    if (isLast) {
      // Het du lieu ma van con giu -> OPEN. Phai dem RIENG, khong tinh vao WR.
      counters.open++
      trades.push(buildTrade(list, s, fillBar, null, 'OPEN', null, p, opts))
      continue
    }

    // Da khop nhung chua ket qua va bi setup sau thay (D5).
    // `replaced` = so lan D5 XAY RA - khong phu thuoc che do. `dropped` = so
    // trade bi loai THUC SU (chi > 0 voi onReplace='drop'). Rieng 2 con so nay
    // phai tach: trong che do ttl van dem replaced de biet D5 xay ra nhieu nho,
    // nhung khong the noi "bi loai" vi chung van xuat hien trong trades.
    counters.replaced++
    if (onReplace === 'ttl') {
      // TTL: lenh dong tai bar bi thay the -> day la lenh that, PHAI dem vao
      // closed. Neu khong, `closed` se nho hon `trades` va bao cao ghi so
      // "dong" la 42 trong khi bang tong hop in 110 (da gap khi chay CLI).
      const replaceBar = setups[k + 1].bar
      counters.closed++
      trades.push(buildTrade(list, s, fillBar, replaceBar, 'TIME', null, p, opts))
    } else {
      counters.dropped++
    }
  }

  return {
    method: method.id ?? String(method.name ?? 'unknown'),
    params: p,
    variant: onReplace === 'ttl' ? 'onReplace=ttl' : null,
    trades,
    counters,
    events: an.events,
    scores: an.scores,
  }
}

/**
 * Dien mot lenh ra dung shape cua Trade model (engine/models/trade.mjs).
 *
 * Gia thoat: strategy.exit(limit = tm_lvlT, stop = tm_lvlS) cua Pine khop TAI muc
 * TP/SL, khong phai tai close cua bar cham. Dung `tp`/`sl` -> moi lenh cung RR voi
 * Pine (neu dung close se lech va khong so sanh duoc voi tm_lvlRes).
 *
 * `result === 'OPEN'` -> khong co exit -> pnl/r = 0 (dem rieng, khong tinh WR).
 */
function buildTrade(list, s, fillBar, doneBar, result, resolvedBy1m, p, opts) {
  const entry = list[fillBar]
  const dir = s.dir
  const isOpen = result === 'OPEN'
  const exitBar = isOpen ? null : doneBar
  // 'TIME' (D5 ttl) thoat tai close cua bar thay the - khong co muc TP/SL nao cham.
  const exitPrice = isOpen ? null : (result === 'TP' ? s.tp : result === 'SL' ? s.sl : list[exitBar].close)

  const { net } = isOpen ? { net: 0 } : costsOf(s.entry, exitPrice, dir, p)

  const risk = Number.isFinite(s.risk) && s.risk > 0 ? s.risk : Math.abs(s.entry - s.sl)

  return {
    symbol: opts.symbol,
    tf: opts.tf,
    method: typeof opts.method === 'string' ? opts.method : (opts.method?.id ?? 'vsa'),
    dir,
    entryTime: new Date(entry.time),
    entryPrice: s.entry,
    exitTime: isOpen ? null : new Date(list[exitBar].time),
    exitPrice,
    sl: s.sl,
    tp: s.tp,
    result,
    barsHeld: isOpen ? list.length - 1 - fillBar : exitBar - fillBar,
    // PnL tren khong gian von = gia vao (khong compound trong 1 lenh).
    pnlPct: isOpen ? 0 : (net / s.entry) * 100,
    rMultiple: isOpen || !(risk > 0) ? 0 : net / risk,
    resolvedBy1m,
  }
}
