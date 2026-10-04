// =============================================================================
//  TM TRADING - METHOD 0: VSA / WYCKOFF  (plugin - roadmap Phase 4 -> Phase 10)
//
//  Day la PHUONG PHAP DAU TIEN dang ky vao engine/methods/ (xem index.mjs).
//  Toan bo logic duoc dut ra tu engine/signals.mjs, GIU NGUYEN thu tu thuc thi
//  va tung phep tinh (port trung thanh cua pine/parts-vsa/*):
//      20_volume -> 30_levels -> 40_events -> (60_viz: level + auto-close)
//  Bien `var` cua Pine duoc mo hinh bang closure/state object, va thu tu cap nhat
//  trong 1 bar duoc giu nguyen (dieu nay co y nghia: vd ST khong the ban cung bar
//  voi SV vi quietST doi hoi KHONG phai purple).
//
//  Muc dich: khoa parity Pine <-> engine bang golden fixtures (roadmap §6, rui ro #1).
//  Ngoai pham vi: dashboard, ve hinh, alertcondition (khong anh huong logic).
//
//  GIU LAI DAY (khong phai "sua cho dep"): day la hop dong voi Pine, va 176 assertion
//  trong engine/test.mjs dang khoa no. Backtest doc thang qua `analyze()` (xem cuoi
//  file) - khong duoc truy cap truc tiep vao truong rieng cua method nay.
//
//  Gioi han da biet (ghi ro de khong ai tuong nham la da trung 100%):
//   - `barstate.isconfirmed`: engine CHI replay nen da dong, nen tm_okBar luon true.
//   - `ta.rma` cua Pine bo qua gia tri na; engine coi na la lo hong (xem ta.mjs).
//     VSA dung nz(volume) nen khong bao gio na -> khong anh huong ban nay.
//   - `time(timeframe.period, sess, tz)` cua Pine con tinh ngay nghi/le; engine
//     chi so gio trong ngay theo tz (du cho crypto + fixture on/off).
// =============================================================================

import { atr as taAtr, rma, pivotLow, pivotHigh, rollingSum, sessionOk, vsaBucket } from '../ta.mjs'
import { registerMethod } from './index.mjs'

/** ID cua method - luu vao run/trade de biet ket qua nay sinh tu phuong phap nao. */
export const ID = 'vsa'

/** Tham so mac dinh = dung gia tri mac dinh trong pine/parts-vsa/10_inputs.pine. */
export const DEFAULTS = {
  confirmOnly: true,
  len: 20,
  rP: 2.2,
  rVH: 1.8,
  rH: 1.2,
  rN: 0.8,
  rL: 0.4,
  purWin: 20,
  volMin: 0,
  sessOn: false,
  sess: '0800-1600',
  tz: 'Asia/Ho_Chi_Minh',
  evtOn: true,
  quietOn: true,
  run: 5,
  lvTol: 0.5,
  lvFresh: 60,
  testR: 1.2,
  retestT: 1.0,
  atrLen: 14,
  pivLen: 20,
  slBuf: 0.5,
  rrFb: 2.0,
  // Phi giao dich (taker, moi chieu, %) va nguong canh bao phi/R.
  // Dung de tinh fee_R = phi_round-trip / (slBuf * ATR%) - rang buoc TOAN HOC:
  // stop phai du rong de phi khong an het loi the (xem docs/vsa-optimization.md).
  feePct: 0.05,
  feeMaxR: 0.15,
  // --- Tham so RIENG cua BACKTEST (khong co trong Pine indicator) --------------
  //  slipPct: slippage % moi chieu (taker), ap dung khi doi thanh thanh cong.
  //  PHAI nam trong DEFAULTS (vi theo D1 moi tham so anh huong ket qua PHAI
  //  duoc hash vao paramsHash - neu de rieng ben backtest thi 2 run cung
  //  paramsHash nhung khac slip se BI TRON trong bao cao, vi pham D1).
  //  Pine indicator khong co vi no chi ve tin hieu; Pine STRATEGY co slippage
  //  rieng cua strategy(). Gia tri 0.02% = hop ly cho taker fapi.
  slipPct: 0.02,
  // --- Kieu vao lenh / kieu dat TP (xem docs/vsa-optimization.md muc 5b) --------
  //  entryMode 'market': vao tai CLOSE cua bar ST (bar xac nhan). Moi tin hieu deu
  //    thanh lenh; SL van dat duoi cau truc (duoi SV low) nen rui ro RONG hon va
  //    dung cho nghia "rui ro that".
  //  entryMode 'limit' : limit tai cuc tri SV/BC (hanh vi CU). Chi khop khi gia
  //    quay lai muc do trong cua so cua setup -> da do: 64-72% KHONG BAO GIO khop.
  //  tpMode 'r'    : TP = rrFb x R (R co dinh -> SO SANH DUOC giua cac lenh).
  //  tpMode 'pivot': TP = pivot doi dien neu RR >= 1 (hanh vi CU; R moi lenh khac
  //    nhau nen vai lenh thang lon chi phoi thong ke).
  entryMode: 'market',
  tpMode: 'r',
  // --- Chien luoc (docs/vsa-optimization.md §5c muc 1) -------------------------
  //  'vsa'    : VSA PHAT tin hieu - SV/BC -> ST -> vao lenh (dao chieu).
  //  'wyckoff': VSA chi lam BO LOC xac dinh VUNG (SV = vung cau, BC = vung cung);
  //             THOI DIEM vao lenh do SU KIEN WYCKOFF quyet dinh (xem wyckoffEvent).
  //             Ly do: baseline D12 cho thay "bat day/dinh" khong khac vao lenh ngau
  //             nhien, nen chuyen VSA sang vai tro bo loc (dung ban chat Wyckoff).
  signalMode: 'vsa',
  // Su kien Wyckoff dung lam diem vao lenh (chi o signalMode 'wyckoff'):
  //   'spring': pha VO vung roi PHUC HOI  (LONG) / UTAD (SHORT) - Phase C
  //   'sos'   : bar than RONG + volume MANH pha vung (LONG) / SOW (SHORT) - Phase D
  //   'lps'   : pullback sau SOS giu TREN day bar SOS (LONG) / LPSY (SHORT) - Phase D
  wyckoffEvent: 'spring',
  // Nguong cho SOS/SOW: than nen >= sosSpread x ATR va volume >= sosVol x MA.
  sosSpread: 1.0,
  sosVol: 1.2,
  // LPS/LPSY duoc coi la "pullback hop le" khi cach muc da pha <= lpsTol x ATR.
  lpsTol: 0.5,
}

const num = (v) => (Number.isFinite(v) ? v : 0)

/**
 * Chay engine VSA tren mang bar da dong.
 *
 * @param {{time:number,open:number,high:number,low:number,close:number,volume:number}[]} bars
 * @param {Partial<typeof DEFAULTS>} opts
 * @returns {{bars:object[], series:object, events:object[], levels:object[]}}
 */
export function runVsa(bars, opts = {}) {
  const p = { ...DEFAULTS, ...opts }

  // Chan gia tri sai ngay tai cua vao: neu khong, mot gia tri go sai se lang le
  // cho ra ket qua kieu "limit" trong khi nguoi dung tuong dang chay "market".
  if (!['market', 'limit'].includes(p.entryMode)) {
    throw new Error(`entryMode chi nhan 'market' | 'limit' (nhan ${JSON.stringify(p.entryMode)})`)
  }
  if (!['r', 'pivot'].includes(p.tpMode)) {
    throw new Error(`tpMode chi nhan 'r' | 'pivot' (nhan ${JSON.stringify(p.tpMode)})`)
  }
  if (!['vsa', 'wyckoff'].includes(p.signalMode)) {
    throw new Error(`signalMode chi nhan 'vsa' | 'wyckoff' (nhan ${JSON.stringify(p.signalMode)})`)
  }
  if (!['spring', 'sos', 'lps'].includes(p.wyckoffEvent)) {
    throw new Error(`wyckoffEvent chi nhan 'spring' | 'sos' | 'lps' (nhan ${JSON.stringify(p.wyckoffEvent)})`)
  }

  const n = bars.length
  const times = bars.map((b) => b.time)
  const close = bars.map((b) => b.close)
  const high = bars.map((b) => b.high)
  const low = bars.map((b) => b.low)
  const open = bars.map((b) => b.open)
  // Pine: tm_vol = nz(volume) -> na thanh 0.
  const vol = bars.map((b) => num(b.volume))

  // --- 20_volume: chi tieu chuan bi (series, tinh truoc nhu Pine) -------------
  const atrS = p.atrLen > 0 ? taAtr(bars, p.atrLen) : new Array(n).fill(null)
  const volMA = rma(vol, p.len)
  const pivotLo = pivotLow(low, p.pivLen, p.pivLen)
  const pivotHi = pivotHigh(high, p.pivLen, p.pivLen)
  const ratio = volMA.map((m, i) => (m != null && m > 0 ? vol[i] / m : 0))
  const eomMove = bars.map((b, i) => {
    const prev = close[i - 1]
    const a = atrS[i]
    return prev != null && a != null && Math.abs(b.close - prev) >= 0.5 * a
  })

  // --- state `var` cua Pine --------------------------------------------------
  const st = {
    eomRun: 0,
    lastPurBar: null,
    lastPLow: null,
    lastPHigh: null,
    plowBar: 0,
    phighBar: 0,
    hasLow: false,
    hasHigh: false,
    svBar: 0,
    svPx: null,
    bcBar: 0,
    bcPx: null,
    hasSV: false,
    hasBC: false,
    lvlE: null,
    lvlS: null,
    lvlT: null,
    lvlB: 0,
    lvlDir: 0,
    lvlDone: false,
    lvlRes: '',
    lvlDoneBar: 0,
    // Entry la lenh LIMIT tai cuc tri SV/BC -> phai theo doi da khop chua.
    // Truoc day engine/Pine bo qua buoc nay nen ghi nhan TP/SL cho ca nhung
    // setup CHUA TUNG vao lenh (xem docs/vsa-optimization.md muc 4.1).
    lvlFill: false,
    lvlFillBar: 0,
    // Trang thai Wyckoff: moc SOS/SOW gan nhat de tim LPS/LPSY.
    sosDone: false,
    sosBar: 0,
    sosLow: null,
    sowDone: false,
    sowBar: 0,
    sowHigh: null,
    lastEvt: '-',
    lastEvtBar: 0,
  }

  const series = {
    atr: atrS,
    volMA,
    ratio,
    bucket: new Array(n).fill('VeryLow'),
    pur20: new Array(n).fill(null),
    eomRun: new Array(n).fill(0),
    lastPurBar: new Array(n).fill(null),
    isPurRaw: new Array(n).fill(false),
    isPurple: new Array(n).fill(false),
    quietST: new Array(n).fill(false),
    quietLow: new Array(n).fill(false),
    evtOk: new Array(n).fill(false),
    sessOk: new Array(n).fill(false),
    nearSup: new Array(n).fill(false),
    nearRes: new Array(n).fill(false),
    runUp: new Array(n).fill(false),
    runDown: new Array(n).fill(false),
    lowFresh: new Array(n).fill(false),
    highFresh: new Array(n).fill(false),
    svFresh: new Array(n).fill(false),
    bcFresh: new Array(n).fill(false),
    // fee_R: phi round-trip quy ra R. feeOk = con trong nguong cho phep.
    feeR: new Array(n).fill(null),
    feeOk: new Array(n).fill(false),
    // Su kien Wyckoff (chi dung o signalMode 'wyckoff')
    spring: new Array(n).fill(false),
    utad: new Array(n).fill(false),
    sos: new Array(n).fill(false),
    sow: new Array(n).fill(false),
    lps: new Array(n).fill(false),
    lpsy: new Array(n).fill(false),
  }

  const flags = {
    SV: new Array(n).fill(false),
    BC: new Array(n).fill(false),
    STl: new Array(n).fill(false),
    STs: new Array(n).fill(false),
    NS: new Array(n).fill(false),
    ND: new Array(n).fill(false),
  }

  const events = []   // su kien theo thu tu uu tien Pine (SV > BC > ST > NS > ND)
  const levels = []   // moi lan ST mo mot setup Entry/SL/TP

  series.lastEvt = new Array(n).fill('-')
  series.lastEvtBar = new Array(n).fill(0)

  // ===========================================================================
  //  Vong lap theo bar - thu tu y nguyen nhu dist
  // ===========================================================================
  for (let i = 0; i < n; i++) {
    const b = bars[i]
    const a = atrS[i]
    const m = volMA[i]

    // ---------- 20_volume ----------------------------------------------------
    series.sessOk[i] = !p.sessOn || sessionOk(times[i], p.sess, p.tz)
    const evtOk = (p.volMin <= 0 || vol[i] >= p.volMin) && series.sessOk[i]
    series.evtOk[i] = evtOk

    series.bucket[i] = vsaBucket(vol[i], m, p)
    const isPurRaw = m != null && m > 0 && vol[i] >= m * p.rP
    series.isPurRaw[i] = isPurRaw
    const isPurple = isPurRaw && evtOk
    series.isPurple[i] = isPurple
    series.quietST[i] = m != null && m > 0 && vol[i] < m * p.testR && !isPurRaw && evtOk
    series.quietLow[i] = m != null && m > 0 && vol[i] < m * p.rN && evtOk

    // fee_R = phi round-trip quy ra R. Rang buoc TOAN HOC cua do rong stop:
    //   phi_round-trip = feePct% x 2 (taker 2 chieu)
    //   fee_R = phi_round-trip / (slBuf x ATR%)   voi ATR% = atr / close
    // fee_R > feeMaxR nghia la phi an qua lon phan R -> cau hinh bat kha thi
    // (xem docs/vsa-optimization.md: 5m voi slBuf=0.5 cho fee_R = 1.40R).
    {
      const atrPct = a != null && a > 0 && close[i] > 0 ? a / close[i] : null
      if (atrPct != null && p.slBuf > 0) {
        const feeRoundTrip = (p.feePct / 100) * 2
        series.feeR[i] = feeRoundTrip / (p.slBuf * atrPct)
        series.feeOk[i] = series.feeR[i] <= p.feeMaxR
      }
    }

    // var int tm_eomRun
    st.eomRun = series.quietLow[i] && eomMove[i] ? st.eomRun + 1 : 0
    series.eomRun[i] = st.eomRun

    // var int tm_lastPurBar
    if (isPurple) st.lastPurBar = i
    series.lastPurBar[i] = st.lastPurBar

    // ---------- 30_levels ----------------------------------------------------
    const plo = pivotLo[i]
    const phi = pivotHi[i]
    if (plo) {
      st.lastPLow = plo.value
      st.plowBar = i          // Pine dung bar_index (bar XAC NHAN), khong phai bar pivot
      st.hasLow = true
    }
    if (phi) {
      st.lastPHigh = phi.value
      st.phighBar = i
      st.hasHigh = true
    }
    const lowFresh = st.hasLow && i - st.plowBar <= p.lvFresh
    const highFresh = st.hasHigh && i - st.phighBar <= p.lvFresh
    series.lowFresh[i] = lowFresh
    series.highFresh[i] = highFresh
    // LUU Y PARITY: Pine cho `na` khi tm_atr chua co -> moi so sanh voi na deu
    // FALSE. Trong JS `null * 0.5 === 0`, nen neu khong chan `a != null` thi
    // nearSup/nearRes se dung sai o cac bar dau (pivot da co nhung ATR chua du).
    series.nearSup[i] = lowFresh && a != null && low[i] <= st.lastPLow + p.lvTol * a
    series.nearRes[i] = highFresh && a != null && high[i] >= st.lastPHigh - p.lvTol * a
    series.runDown[i] = close[i - p.run] != null && close[i] < close[i - p.run]
    series.runUp[i] = close[i - p.run] != null && close[i] > close[i - p.run]

    // ---------- 40_events ----------------------------------------------------
    // CHINH: SV/BC bat buoc qua cot TIM (isPurple)
    const sigSV = p.evtOn && isPurple && series.runDown[i] && series.nearSup[i] && high[i] > low[i] && close[i] > open[i]
    const sigBC = p.evtOn && isPurple && series.runUp[i] && series.nearRes[i] && high[i] > low[i] && (high[i] - close[i]) >= 0.5 * (high[i] - low[i])
    flags.SV[i] = sigSV
    flags.BC[i] = sigBC

    if (sigSV) {
      st.svBar = i
      st.svPx = low[i]
      st.hasSV = true
    }
    if (sigBC) {
      st.bcBar = i
      st.bcPx = high[i]
      st.hasBC = true
    }

    const svFresh = st.hasSV && i - st.svBar <= p.lvFresh
    const bcFresh = st.hasBC && i - st.bcBar <= p.lvFresh
    series.svFresh[i] = svFresh
    series.bcFresh[i] = bcFresh

    // --- Su kien WYCKOFF (thay cho BOS/CHoCH cua SMC) -------------------------
    // Truong phai: BOS/CHoCH la ky thuat SMC, khong phai Wyckoff. Wyckoff xac nhan
    // bang SPRING (pha vo vung roi phuc hoi - Phase C) va SOS (bar manh pha vung -
    // Phase D), roi vao o LPS (pullback sau SOS). SHORT la gong doi xung.
    const phLvl = st.lastPHigh
    const plLvl = st.lastPLow
    const spread = high[i] - low[i]
    const strongVol = m != null && m > 0 && vol[i] >= m * p.sosVol

    // Spring / UTAD: PHA VO vung trong bar nhung DONG CUA tro lai trong vung.
    // Day la khac biet cot loi so voi "pha cau truc": pha vo that bai (that bai cua
    // ben ban) moi la tin hieu, khong phai pha vo thanh cong.
    const wSpring = a != null && lowFresh && plLvl != null &&
      low[i] < plLvl && close[i] > plLvl && close[i] > open[i]
    const wUtad = a != null && highFresh && phLvl != null &&
      high[i] > phLvl && close[i] < phLvl && close[i] < open[i]

    // SOS / SOW: bar than RONG + volume MANH dong cua ngoai vung.
    const wSos = a != null && highFresh && phLvl != null &&
      close[i] > phLvl && spread >= p.sosSpread * a && strongVol && close[i] > open[i]
    const wSow = a != null && lowFresh && plLvl != null &&
      close[i] < plLvl && spread >= p.sosSpread * a && strongVol && close[i] < open[i]

    if (wSos) { st.sosDone = true; st.sosBar = i; st.sosLow = low[i] }
    if (wSow) { st.sowDone = true; st.sowBar = i; st.sowHigh = high[i] }

    // LPS / LPSY: pullback sau SOS/SOW, GIU tren day bar SOS (duoi dinh bar SOW).
    const wLps = a != null && st.sosDone && st.sosLow != null && i > st.sosBar &&
      low[i] > st.sosLow && low[i] <= st.sosLow + p.lpsTol * a && close[i] > open[i]
    const wLpsy = a != null && st.sowDone && st.sowHigh != null && i > st.sowBar &&
      high[i] < st.sowHigh && high[i] >= st.sowHigh - p.lpsTol * a && close[i] < open[i]

    series.spring[i] = wSpring
    series.utad[i] = wUtad
    series.sos[i] = wSos
    series.sow[i] = wSow
    series.lps[i] = wLps
    series.lpsy[i] = wLpsy

    // --- Kich hoat VAO LENH theo signalMode ----------------------------------
    const wyckoffMode = p.signalMode === 'wyckoff'
    let sigSTl
    let sigSTs
    if (wyckoffMode) {
      // VSA lam BO LOC vung: SV tao vung CAU (chi tim LONG), BC tao vung CUNG (SHORT).
      // Su kien Wyckoff quyet dinh THOI DIEM; SHORT la gong doi xung cua LONG.
      const ev = {
        spring: [wSpring, wUtad],
        sos: [wSos, wSow],
        lps: [wLps, wLpsy],
      }[p.wyckoffEvent]
      sigSTl = p.evtOn && ev[0] && svFresh
      sigSTs = p.evtOn && ev[1] && bcFresh
    } else {
      sigSTl = p.evtOn && svFresh && series.quietST[i] && Math.abs(low[i] - st.svPx) <= p.retestT * a && close[i] > open[i]
      sigSTs = p.evtOn && bcFresh && series.quietST[i] && Math.abs(high[i] - st.bcPx) <= p.retestT * a && close[i] < open[i]
    }
    flags.STl[i] = sigSTl
    flags.STs[i] = sigSTs

    // Level tu dong Entry/SL/TP khi tin hieu phat (setup moi thay setup cu).
    //  - che do 'vsa'    : Entry limit/market tai vung SV/BC; SL ngoai cuc tri SV/BC.
    //  - che do 'wyckoff': vao theo SU KIEN -> luon market, va SL dat ngoai DAY/DINH
    //    cua chinh bar kich hoat (do la cau truc vua tao ra tin hieu).
    // risk = |entry - sl| la RUI RO THAT -> dung cho ca TP theo R va tinh fee_R.
    const entryMarket = p.entryMode === 'market' || wyckoffMode
    if (sigSTl && st.hasSV) {
      const e = entryMarket ? close[i] : st.svPx
      const slBase = wyckoffMode ? low[i] : st.svPx
      const sl = slBase - p.slBuf * a
      const risk = e - sl
      if (risk > 0) {
        st.lvlE = e
        st.lvlS = sl
        st.lvlT = p.tpMode === 'pivot' && st.lastPHigh != null && st.lastPHigh >= e + risk
          ? st.lastPHigh
          : e + p.rrFb * risk
        st.lvlB = i
        st.lvlDir = 1
        st.lvlDone = false
        st.lvlRes = ''
        st.lvlDoneBar = 0
        st.lvlFill = entryMarket
        st.lvlFillBar = entryMarket ? i : 0
        levels.push({ bar: i, dir: 1, entry: e, sl, tp: st.lvlT, risk, filled: entryMarket, fillBar: entryMarket ? i : 0 })
      }
    }
    if (sigSTs && st.hasBC) {
      const e = entryMarket ? close[i] : st.bcPx
      const slBase = wyckoffMode ? high[i] : st.bcPx
      const sl = slBase + p.slBuf * a
      const risk = sl - e
      if (risk > 0) {
        st.lvlE = e
        st.lvlS = sl
        st.lvlT = p.tpMode === 'pivot' && st.lastPLow != null && st.lastPLow <= e - risk
          ? st.lastPLow
          : e - p.rrFb * risk
        st.lvlB = i
        st.lvlDir = -1
        st.lvlDone = false
        st.lvlRes = ''
        st.lvlDoneBar = 0
        st.lvlFill = entryMarket
        st.lvlFillBar = entryMarket ? i : 0
        levels.push({ bar: i, dir: -1, entry: e, sl, tp: st.lvlT, risk, filled: entryMarket, fillBar: entryMarket ? i : 0 })
      }
    }

    // Tu dong dong setup. THU TU QUAN TRONG:
    //   1. Khop entry truoc (limit tai cuc tri SV/BC)
    //   2. Chi xet TP/SL khi DA khop; uu tien SL ke ca khi cung bar vua khop
    if (st.lvlE != null && !st.lvlDone && i > st.lvlB) {
      if (!st.lvlFill) {
        if (st.lvlDir === 1 && low[i] <= st.lvlE) {
          st.lvlFill = true
          st.lvlFillBar = i
        } else if (st.lvlDir === -1 && high[i] >= st.lvlE) {
          st.lvlFill = true
          st.lvlFillBar = i
        }
      }
      if (st.lvlFill) {
        // Dong bo trang thai "da khop" vao level object NGAY luc xay ra.
        // Truoc day chi ghi trong Object.assign cua luc DONE -> limit da khop
        // nhung chua cham TP/SL van tra `filled:false`, va backtest se BO QUA
        // lenh that (im lang, khong canh bao). Guong doc bang test section 11.
        const cur = levels[levels.length - 1]
        if (cur && cur.bar === st.lvlB && !cur.filled) {
          cur.filled = true
          cur.fillBar = st.lvlFillBar
        }
        if (st.lvlDir === 1) {
          if (low[i] <= st.lvlS) {
            st.lvlDone = true
            st.lvlRes = 'SL'
            st.lvlDoneBar = i
          } else if (high[i] >= st.lvlT) {
            st.lvlDone = true
            st.lvlRes = 'TP'
            st.lvlDoneBar = i
          }
        } else if (st.lvlDir === -1) {
          if (high[i] >= st.lvlS) {
            st.lvlDone = true
            st.lvlRes = 'SL'
            st.lvlDoneBar = i
          } else if (low[i] <= st.lvlT) {
            st.lvlDone = true
            st.lvlRes = 'TP'
            st.lvlDoneBar = i
          }
        }
      }
      if (st.lvlDone) {
        const last = levels[levels.length - 1]
        if (last) Object.assign(last, { doneBar: i, result: st.lvlRes, filled: true, fillBar: st.lvlFillBar })
      }
    }

    // NS/ND: cot am tai H/T
    flags.NS[i] = p.quietOn && series.quietLow[i] && series.nearSup[i] && close[i] > open[i]
    flags.ND[i] = p.quietOn && series.quietLow[i] && series.nearRes[i] && close[i] < open[i]

    if (sigSV || sigBC || sigSTl || sigSTs || flags.NS[i] || flags.ND[i]) {
      st.lastEvt = sigSV ? 'SV' : sigBC ? 'BC' : (sigSTl || sigSTs) ? 'ST' : flags.NS[i] ? 'NS' : 'ND'
      st.lastEvtBar = i
    }
    series.lastEvt[i] = st.lastEvt
    series.lastEvtBar[i] = st.lastEvtBar

    if (sigSV || sigBC || sigSTl || sigSTs || flags.NS[i] || flags.ND[i]) {
      events.push({
        bar: i,
        type: sigSV ? 'SV' : sigBC ? 'BC' : sigSTl ? 'ST LONG' : sigSTs ? 'ST SHORT' : flags.NS[i] ? 'NS' : 'ND',
      })
    }
  }

  // tm_pur20 = math.sum(isPurple ? 1 : 0, purWin) - tinh sau khi co co isPurple
  series.pur20 = rollingSum(series.isPurple.map((x) => (x ? 1 : 0)), p.purWin)

  return { bars, params: p, series, flags, events, levels, eomMove }
}

// =============================================================================
//  HOP DONG PLUGIN (engine/methods/index.mjs)
//
//  `runVsa` ben tren la BACKBONE - chi tra ve su kien + level cua chinh no, va
//  chua co scores. Backtest/Phase 10 chi phep doc thang qua `analyze()` duoi day.
//
//  Sao cho ro:
//   - `events` la su kien theo thu tu xay ra (SV > BC > ST > NS > ND nhu Pine).
//   - `scores` la diem HUONG tinh cho MOI BAR, [-1..1]: +1 = manh cho LONG,
//     -1 = manh cho SHORT, 0 = khong co su kien. Khong phai "diem conf" cua
//     Pine (do la tm_score cua ban TM, rieng biet) - day la diem de cac method
//     khac va confluence (Phase 10) TRON DUOC voi nhau.
//   - `setups` la KE HOACH LENH (entry/sl/tp chua deduct fee/slippage) -
//     backtest.mjs moi chiu trach nhiem doi thanh trade that.
// =============================================================================

/** Diem huong cho moi type su kien. Giu nho, doi cai nay = doi ket qua confluence. */
export const EVENT_SCORE = Object.freeze({
  'ST LONG': 1,     // vao lenh LONG - manh nhat
  'ST SHORT': -1,   // vao lenh SHORT - manh nhat
  SV: 0.5,          // vung cau (tu choi ban) - ung vien LONG
  BC: -0.5,         // vung cung (tu choi mua) - ung vien SHORT
  NS: 0.3,          // No Supply - xac nhan LONG
  ND: -0.3,         // No Demand - xac nhan SHORT
})

/**
 * Chay method va tra ve dung shape cua METHOD_CONTRACT.
 *
 * @param {{time:number,open:number,high:number,low:number,close:number,volume:number}[]} bars
 * @param {Partial<typeof DEFAULTS>} opts
 * @returns {{method:string, events:object[], scores:number[], setups:object[],
 *            series:object, flags:object, params:object, bars:object[]}}
 */
export function analyze(bars, opts = {}) {
  const r = runVsa(bars, opts)
  const n = r.bars.length

  // Diem tinh theo bar. De `0` cho cac bar khong co su kien - khong duoc
  // "keo diem" sang bar sau: confluence can biet ro luc nao co tin hieu.
  const scores = new Array(n).fill(0)
  for (const e of r.events) {
    const s = EVENT_SCORE[e.type]
    if (s !== undefined) scores[e.bar] = s
  }

  return {
    method: ID,
    events: r.events,
    scores,
    setups: r.levels,
    series: r.series,
    flags: r.flags,
    params: r.params,
    bars: r.bars,
  }
}

/**
 * Plugin dang ky vao registry. `analyze` la ENTRY POINT duy nhat cho backtest;
 * cac truong con lai (series/flags) la phuong phap rieng, backtest KHONG dua vao.
 */
export const method = Object.freeze({
  id: ID,
  name: 'VSA / Wyckoff (method 0)',
  defaults: DEFAULTS,
  analyze,
})

registerMethod(method)
