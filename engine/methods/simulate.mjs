// =============================================================================
//  TM TRADING - SIMULATE SETUPS (Phase 10)
//
//  Bo lap lap entry/exit dung cho cac method moi (price-action/trend/orderflow).
//  VSA (methods/vsa.mjs) van giu vong rieng vi no can dong khop voi Pine —
//  KHONG dot vao do. Nhung NGHIA phai GIONG NHAU:
//
//   - 1 slot mo: setup MOI thay setup cu (setup cu con lai khong co `result`
//     -> backtest dem `replaced`, bo o che do drop / dong tai bar sau o ttl — D5).
//     **Tuy nhien** cac method Phase 10 chay `replaceActive: false`: signal moi
//     khi con setup mo bi BO QUA (khong thay). Ly do: BRK/PULL cua trend re-fire
//     gan nhu moi bar trong xuong huong -> neu thay (D5), setup song sót la
//     setup CUOI cung chuoi = vao dung dinh -> SL day dac (adverse selection,
//     gap khi chay league). VSA van giu replace=true vi signal cua no la chuyen
//     trang thai (hiem), khong re-fire.
//   - Market: filled NGAY tai bar phat (fillBar = bar), nhung moi xet TP/SL tu
//     bar SAU (i > bar) — giong VSA.
//   - Limit: di tim cham entry tu bar ke; da khop roi thi xet TP/SL NGAY bar do
//     (uu tien SL ke ca khi cung bar vua khop — giong VSA).
//   - Cung bar cham SL + TP -> SL (bao thu); backtest se phan giai lai bang
//     sub 1m (D6).
//   - Setup con mo cuoi du lieu -> khong gan result (backtest in OPEN neu no
//     la setup cuoi mang).
//
//  Input: signals[] da tinh san { bar, dir, entry, sl, tp, entryType? }.
//  `risk = |entry - sl|` bat buoc > 0 — signal rui ro <= 0 bi bo qua (khong
//  gianh setup cho lenh khong tinh duoc R).
// =============================================================================

/**
 * Chay mo phong fill/exit tren mang bar.
 *
 * @param {{time:number,open:number,high:number,low:number,close:number,volume:number}[]} bars
 * @param {{bar:number, dir:1|-1, entry:number, sl:number, tp:number,
 *          entryType?:'market'|'limit'}[]} signals
 * @param {{replaceActive?:boolean}} [opts]  replaceActive=false: signal moi
 *        khi con setup mo -> bo qua (1 lenh/luc); mac dinh true = D5 giong VSA.
 * @returns {object[]} setups dung shape backtest (bar/dir/entry/sl/tp/risk/
 *          filled/fillBar + doneBar/result khi dong)
 */
export function simulateSetups(bars, signals, opts = {}) {
  const replaceActive = opts.replaceActive !== false // mac dinh: thay (D5)
  const list = Array.isArray(bars) ? bars : []
  const n = list.length
  const raw = (Array.isArray(signals) ? signals : [])
    .filter((s) => s && Number.isInteger(s.bar) && s.bar >= 0 && s.bar < n)
    .slice()
    .sort((a, b) => a.bar - b.bar) // sort stable -> giu thu tu cung bar

  const setups = []
  let active = null
  let si = 0

  for (let i = 0; i < n; i++) {
    // 1. Signal tai bar i TRUOC (setup moi thay setup cu — VSA cung vay;
    //    voi replaceActive=false thi dung hon: con lenh thi bo qua signal moi).
    while (si < raw.length && raw[si].bar === i) {
      const sg = raw[si++]
      if (!replaceActive && active) continue // con setup mo -> bo qua signal moi
      const dir = sg.dir === -1 ? -1 : 1
      const entry = Number(sg.entry)
      const sl = Number(sg.sl)
      const tp = Number(sg.tp)
      const risk = dir === 1 ? entry - sl : sl - entry
      if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp) || !(risk > 0)) continue
      const isMarket = sg.entryType !== 'limit' // mac dinh market
      const lvl = { bar: i, dir, entry, sl, tp, risk, filled: isMarket, fillBar: isMarket ? i : 0 }
      setups.push(lvl)
      active = lvl // setup cu (neu con mo) bi thay — khoong gan result cho no
    }

    // 2. Walk cho setup dang mo — chi tu bar SAU bar phat.
    if (active && i > active.bar) {
      const b = list[i]
      if (!active.filled) {
        if (active.dir === 1 ? b.low <= active.entry : b.high >= active.entry) {
          active.filled = true
          active.fillBar = i
        }
      }
      if (active.filled) {
        if (active.dir === 1) {
          if (b.low <= active.sl) Object.assign(active, { doneBar: i, result: 'SL' })
          else if (b.high >= active.tp) Object.assign(active, { doneBar: i, result: 'TP' })
        } else {
          if (b.high >= active.sl) Object.assign(active, { doneBar: i, result: 'SL' })
          else if (b.low <= active.tp) Object.assign(active, { doneBar: i, result: 'TP' })
        }
        if (active.result) active = null
      }
    }
  }

  return setups
}
