#!/usr/bin/env node
// =============================================================================
//  TM TRADING - ENGINE TEST (golden fixtures)
//  Khong framework, khong dependency. Chay: npm run engine:test
//
//  Muc tieu (roadmap Phase 2, rui ro #1 "Lech Pine <-> engine"):
//   1. ta.mjs khop GIA TRI MAU tinh tay theo cong thuc Pine (khong phai "chay duoc
//      la xong"): RMA seed bang SMA, TR bar dau = high-low, math.sum na khi thieu.
//   2. pivot tra ve dung bar XAC NHAN (i = pivot + rightbars), khong nhin truoc.
//   3. signals.mjs cho ra dung chuoi su kien tren cac case vang:
//      SV -> ST LONG, BC -> ST SHORT, cham TP, cham SL (uu tien SL cung bar),
//      NS/ND, cate bucket, run/momentum, session on/off.
// =============================================================================

import { sma, rma, atr, trueRange, pivotLow, pivotHigh, rollingSum, sessionOk, vsaBucket, ema, rsi, stdev, macd, vwap, obv, cmf, donchian } from './ta.mjs'
import { runVsa, DEFAULTS } from './signals.mjs'
import * as signalsShim from './signals.mjs'
// Cac import cho section 11/12 (methods interface + backtest - Phase 4)
import { method as vsaMethod, runVsa as runVsaFromMethods } from './methods/vsa.mjs'
import { validateMethod, registerMethod, getMethod, listMethods } from './methods/index.mjs'
// 3 method Phase 10 (import tu dang ky vao registry — section 16)
import { simulateSetups } from './methods/simulate.mjs'
import { method as paMethod, EVENT_SCORE as PA_SCORE } from './methods/priceAction.mjs'
import { method as trendMethod, EVENT_SCORE as TREND_SCORE } from './methods/trend.mjs'
import { method as ofMethod, EVENT_SCORE as OF_SCORE } from './methods/orderflow.mjs'
import { method as sweepMethod, EVENT_SCORE as SWEEP_SCORE } from './methods/sweep.mjs'
import { backtest, costsOf } from './backtest.mjs'
import {
  summarizeBacktest, formatSummary, formatMatrix, toCsv, summaryRow, toRunDoc,
  TRADE_COLUMNS, SUMMARY_COLUMNS,
} from './report.mjs'
import { Trade } from './models/trade.mjs'
import { fetchKlines, resample, klineToBar, universeSnapshot, DataError } from './data.mjs'
import { parseArgs, normalizeSymbol, normalizeTf, buildParams, PRESETS } from './run.mjs'
import { paramsHash, hashOf, barsHash, stableStringify, runStamp, readGitRev, canonicalParams, PARAM_SCHEMA, ENGINE_VERSION } from './version.mjs'
import { withStamp, saveRun, loadRuns, readNdjson, summarizeRuns, groupByGeneration, generationKey } from './store.mjs'
import { alertKey, clientOrderId } from './keys.mjs'
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const near = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) <= eps
const allNull = (arr) => arr.every((x) => x === null)

// Bat exception ngoai du kien: neu mot ham nem loi ngoai cho mong doi, suite
// truoc day CHET giua chung va khong in dong tong ket -> che mat moi test phia sau
// (da gap that khi mutation-test version.mjs: bo merge DEFAULTS lam crash).
process.on('uncaughtException', (e) => {
  fail++
  console.log(`  FAIL (nem loi ngoai du kien) — ${e && e.message}`)
  console.log(`\nFAIL — ${pass} pass, ${fail} fail\n`)
  process.exit(1)
})

// =============================================================================
section('1. ta.mjs — gia tri mau tinh tay theo cong thuc Pine')

// --- ta.sma: na khi chua du length ------------------------------------------
{
  const s = sma([1, 2, 3, 4, 5], 3)
  check('sma: na cho den khi du length', s[0] === null && s[1] === null, JSON.stringify(s))
  check('sma: (1+2+3)/3 = 2', near(s[2], 2), `got ${s[2]}`)
  check('sma: (2+3+4)/3 = 3', near(s[3], 3), `got ${s[3]}`)
  check('sma: (3+4+5)/3 = 4', near(s[4], 4), `got ${s[4]}`)
}

// --- ta.rma: seed bang ta.sma(length) tai bar thu length --------------------
// Pine mau: alpha = 1/length; sum = na(sum[1]) ? sma(src,length) : alpha*src + (1-alpha)*nz(sum[1])
{
  const src = [10, 12, 11, 13, 14, 12, 15]
  const len = 3
  const r = rma(src, len)
  const expectedSeed = (10 + 12 + 11) / 3 // 11 tai bar index 2
  check('rma: seed = sma(3) = 11 tai bar 2', near(r[2], expectedSeed), `got ${r[2]}`)
  // bar 3: alpha*13 + (1-alpha)*11 = 13/3 + 2*11/3 = (13+22)/3 = 35/3
  check('rma: bar 3 = alpha*13+(1-alpha)*11 = 35/3', near(r[3], 35 / 3), `got ${r[3]}`)
  // bar 4: 14/3 + (2/3)*(35/3) = (14 + 70/3)/3 = (42/3+70/3)/3 = (112/3)/3 = 112/9
  check('rma: bar 4 = 112/9', near(r[4], 112 / 9), `got ${r[4]}`)
  check('rma: na truoc khi du length', r[0] === null && r[1] === null, JSON.stringify(r.slice(0, 2)))
}

// --- ta.tr / ta.atr: bar dau TR = high-low --------------------------------
{
  const bars = [
    { open: 10, high: 12, low: 9, close: 11, volume: 1 },
    { open: 11, high: 13, low: 10, close: 12, volume: 1 },
    { open: 12, high: 14, low: 11, close: 13, volume: 1 },
  ]
  const tr = trueRange(bars)
  check('tr: bar dau = high-low = 3', near(tr[0], 3), `got ${tr[0]}`)
  // bar 2: max(13-10=3, |13-11|=2, |10-11|=1) = 3
  check('tr: bar 2 = 3', near(tr[1], 3), `got ${tr[1]}`)
  // bar 3: max(14-11=3, |14-12|=2, |11-12|=1) = 3
  check('tr: bar 3 = 3', near(tr[2], 3), `got ${tr[2]}`)

  const a = atr(bars, 3)
  check('atr: seed = sma(tr,3) = 3 tai bar 2', near(a[2], 3), `got ${a[2]}`)
}

// --- math.sum: na khi chua du length (khac sma o cho do) -------------------
{
  const s = rollingSum([1, 2, 3, 4], 2)
  check('math.sum: na cho den khi du length', s[0] === null, JSON.stringify(s))
  check('math.sum: 1+2 = 3', near(s[1], 3), `got ${s[1]}`)
  check('math.sum: 3+4 = 7', near(s[3], 7), `got ${s[3]}`)
}

// =============================================================================
section('2. ta.mjs — pivot: bar XAC NHAN, khong nhin truoc')

{
  // low = [5, 3, 7, 9, 8], leftbars=1, rightbars=1
  // bar 1 (low=3) la day vi 5 > 3 va 7 > 3 -> xac nhan tai bar 2.
  const lows = [5, 3, 7, 9, 8]
  const pl = pivotLow(lows, 1, 1)
  check('pivotlow: khong tra ve truoc bar xac nhan', pl[0] === null && pl[1] === null, JSON.stringify(pl))
  check('pivotlow: xac nhan tai i = pivot+rightbars = 2', pl[2]?.value === 3 && pl[2]?.index === 1, JSON.stringify(pl[2]))
  check('pivotlow: khong phat lai o bar sau', pl[3] === null && pl[4] === null, JSON.stringify(pl.slice(3)))
}

{
  // pivotHigh: high = [5, 9, 4, 7, 6], leftbars=1, rightbars=1 -> dinh o bar 1
  const highs = [5, 9, 4, 7, 6]
  const ph = pivotHigh(highs, 1, 1)
  check('pivothigh: dinh o bar 1, xac nhan tai bar 2', ph[2]?.value === 9 && ph[2]?.index === 1, JSON.stringify(ph[2]))
}

{
  // Gia tri BANG NHAU: Pine coi cac bar con lai phai thuc su nho/lon hon (strict).
  // low = [4, 4, 4]: khong bar nao la pivot low -> khong co tin hieu.
  const lows = [4, 4, 4, 4, 4]
  const pl = pivotLow(lows, 1, 1)
  check('pivotlow: moi low bang nhau -> khong co pivot', allNull(pl), JSON.stringify(pl))
}

{
  // leftbars/rightbars lon hon mang -> khong co pivot, khong crash
  const pl = pivotLow([1, 2, 3], 10, 10)
  check('pivotlow: cua so rong hon mang -> toan null', allNull(pl), JSON.stringify(pl))
}

// =============================================================================
section('3. ta.mjs — session + bucket')

{
  // 2026-01-05T02:00:00Z = 09:00 gio Viet Nam -> TRONG phien 0800-1600
  const t = Date.UTC(2026, 0, 5, 2, 0, 0)
  check('session: 09:00 VN trong phien 0800-1600', sessionOk(t, '0800-1600', 'Asia/Ho_Chi_Minh') === true)
  // 2026-01-05T12:00:00Z = 19:00 VN -> NGOAI phien
  const t2 = Date.UTC(2026, 0, 5, 12, 0, 0)
  check('session: 19:00 VN ngoai phien', sessionOk(t2, '0800-1600', 'Asia/Ho_Chi_Minh') === false)
  // bien: 08:00 dung la bat dau (bao gom), 16:00 la ket thuc (khong bao gom)
  const t3 = Date.UTC(2026, 0, 5, 1, 0, 0) // 08:00 VN
  const t4 = Date.UTC(2026, 0, 5, 9, 0, 0) // 16:00 VN
  check('session: 08:00 tinh la trong phien', sessionOk(t3, '0800-1600', 'Asia/Ho_Chi_Minh') === true)
  check('session: 16:00 tinh la het phien', sessionOk(t4, '0800-1600', 'Asia/Ho_Chi_Minh') === false)
  // phien qua dem 2200-0200
  const t5 = Date.UTC(2026, 0, 5, 23, 0, 0) // 06:00 VN hom sau -> ngoai
  check('session: qua dem - 06:00 ngoai 2200-0200', sessionOk(t5, '2200-0200', 'Asia/Ho_Chi_Minh') === false)
  check('session: sess sai dinh dang -> false', sessionOk(t3, 'khong-phai-phien', 'UTC') === false)
}

{
  const r = { rP: 2.2, rVH: 1.8, rH: 1.2, rN: 0.8, rL: 0.4 }
  const ma = 100
  check('bucket: 2.21x = TIM', vsaBucket(221, ma, r) === 'TIM')
  check('bucket: 2.19x = VeryHigh', vsaBucket(219, ma, r) === 'VeryHigh')
  check('bucket: 1.8x = VeryHigh', vsaBucket(180, ma, r) === 'VeryHigh')
  check('bucket: 1.2x = High', vsaBucket(120, ma, r) === 'High')
  check('bucket: 0.8x = Normal', vsaBucket(80, ma, r) === 'Normal')
  check('bucket: 0.4x = Low', vsaBucket(40, ma, r) === 'Low')
  check('bucket: 0.39x = VeryLow', vsaBucket(39, ma, r) === 'VeryLow')
  check('bucket: ma na -> VeryLow (Pine: dieu kien na = false)', vsaBucket(100, null, r) === 'VeryLow')
  // BIEN SO THUC: 100*2.2 = 220.00000000000003 (IEEE double), nen vol = 220
  // KHONG dat nguong TIM du ve mat toan hoc la bang 2.2x. Pine dung double nen
  // hanh vi y het - engine tai hien dung, va bang bucket trong docs la y tuong
  // (chi lech o dung bien nay). Khoa lai de khong ai "sua" engine cho dep.
  check('bucket: bien 2.2x lech do double (giong Pine)', vsaBucket(220, ma, r) === 'VeryHigh', vsaBucket(220, ma, r))
}

// =============================================================================
section('4. signals.mjs — chuoi su kien tren fixture dieu khien duoc')

// --- Bo sinh bar -------------------------------------------------------------
// Bac ve theo HUONG NEN de dinh/day la DUY NHAT. Day khong phai chi tiet vun:
// pivot cua Pine so sanh NGHIEM NGAT, nen mot duong gia phang se khong bao gio
// tao pivot (da bi stub "moi low bang nhau" o section 2 khoa lai).
//   nen giam (c<o): high = o, low = c - wick  -> day giam dan deu
//   nen tang (c>o): high = c + wick, low = o  -> day tang dan deu
function mkBars(closes, volumes, wick = 0.5, baseTime = Date.UTC(2026, 0, 5, 0, 0, 0)) {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]
    const up = c >= o
    return {
      time: baseTime + i * 300000,
      open: o,
      high: up ? c + wick : o,
      low: up ? o : c - wick,
      close: c,
      volume: volumes[i] ?? 100,
    }
  })
}

// Nguong so hoc NOI de co lap LOGIC MAY TRANG THAI (SV -> ST -> cham TP/SL, run,
// bucket, session) khoi viec phai doan gia tri ATR. Ban than cac ham so hoc da
// duoc kiem gia tri mau o section 1-3.
//
// entryMode/tpMode duoc GHI RO (khong de theo mac dinh): cac case A/B1/B1b/B1c/E
// duoi day mo ta hanh vi che do LIMIT + TP theo pivot. Neu de mac dinh, mot lan doi
// mac dinh se lang le viet lai y nghia cua fixture.
const LOOSE = {
  len: 5, pivLen: 3, lvFresh: 1000, lvTol: 1000, retestT: 1000, run: 5, atrLen: 5,
  entryMode: 'limit', tpMode: 'pivot',
}

/**
 * Duong gia chuan: day tai i=15, hoi len dinh 99 tai i=17, giam dan den bar 21,
 * bar SV (xanh nhe, van thap hon close[i-5]) tai i=22, bar ST tai i=23.
 * Pivot low xac nhan tai i=18 (day 94.5) -> tm_lastPLow.
 */
function basePath() {
  const closes = []
  for (let i = 0; i < 16; i++) closes.push(110 - i) // 110..95
  closes.push(97)    // 16
  closes.push(99)    // 17  <- close[i-5] cua bar SV (runDown)
  closes.push(98.5)  // 18  <- pivot low xac nhan o day
  closes.push(97.8)  // 19
  closes.push(97.2)  // 20
  closes.push(96.4)  // 21
  closes.push(96.5)  // 22  SV: nen XANH (96.4 -> 96.5), < 99 -> runDown
  closes.push(96.8)  // 23  ST: nen xanh, volume thap
  return closes
}

/** Tao {closes, volumes} voi bar SV co volume TIM, cac bar khac volume 100. */
function svScenario() {
  const closes = basePath()
  const volumes = new Array(closes.length).fill(100)
  volumes[22] = 600 // ratio ~3 -> TIM
  return { closes, volumes }
}

// --- Case A: SV -> ST LONG -> TP = pivot high doi dien ---------------------
{
  const { closes, volumes } = svScenario()
  const bars = mkBars(closes, volumes)
  const r = runVsa(bars, LOOSE)
  const lvl = r.levels[0]

  check('A: SV phat tai bar 22', r.flags.SV[22] === true, `purple=${r.series.isPurple[22]} runDown=${r.series.runDown[22]} nearSup=${r.series.nearSup[22]}`)
  check('A: bar SV la cot TIM', r.series.bucket[22] === 'TIM', `bucket=${r.series.bucket[22]}`)
  check('A: ST LONG phat tai bar 23', r.flags.STl[23] === true, `quietST=${r.series.quietST[23]} svFresh=${r.series.svFresh[23]}`)
  check('A: su kien theo dung thu tu SV -> ST LONG', JSON.stringify(r.events) === JSON.stringify([{ bar: 22, type: 'SV' }, { bar: 23, type: 'ST LONG' }]), JSON.stringify(r.events))
  check('A: co dung 1 setup', r.levels.length === 1, `levels=${r.levels.length}`)
  check('A: Entry = low tai bar SV', lvl.entry === bars[22].low, `entry=${lvl.entry} low=${bars[22].low}`)
  check('A: huong setup = LONG', lvl.dir === 1, `dir=${lvl.dir}`)
  check('A: SL = Entry - slBuf*ATR', near(lvl.sl, lvl.entry - 0.5 * r.series.atr[23]), `sl=${lvl.sl}`)
  check('A: TP = pivot high doi dien (99.5), khong dung fallback', near(lvl.tp, 99.5), `tp=${lvl.tp}`)
}

// --- Case B1: entry la lenh LIMIT -> CHUA KHOP thi KHONG duoc ghi ket qua ----
// Day la loi da sua (docs/vsa-optimization.md muc 4.1): truoc day setup chua
// tung vao lenh van duoc ghi "TP"/"SL". Bar 24 la nen TANG (open 96.8 -> close
// 100.5) nen low = 96.8 > entry 96.4 => KHONG khop entry, du high 101 >= TP 99.5.
{
  const { closes, volumes } = svScenario()
  closes.push(100.5)
  volumes.push(600)
  const r = runVsa(mkBars(closes, volumes), LOOSE)
  const lvl = r.levels[0]
  check('B1: entry KHONG duoc cham thi khong ghi TP', lvl.result === undefined, `res=${lvl.result}`)
  check('B1: setup ghi ro chua khop (filled=false)', lvl.filled === false, `filled=${lvl.filled}`)
  check('B1: khong sinh setup thu 2', r.levels.length === 1, `levels=${r.levels.length}`)
}

// --- Case B1b: entry KHOP roi moi cham TP -> ghi TP + nho bar khop ----------
// Bar 24 = nen GIAM 96.8 -> 96.7 nen low = 96.2: cham entry 96.4 (khop) nhung
// van TREN SL (~95.81) nen khong bi stop ngay trong cung bar.
// Bar 25 = nen tang len 100 -> high 100.5 >= TP 99.5 -> TP.
{
  const { closes, volumes } = svScenario()
  closes.push(96.7)
  volumes.push(600)
  closes.push(100.0)
  volumes.push(600)
  const r = runVsa(mkBars(closes, volumes), LOOSE)
  const lvl = r.levels[0]
  check('B1b: entry khop tai bar 24', lvl.fillBar === 24, `fillBar=${lvl.fillBar}`)
  check('B1b: cham TP tai bar 25', lvl.result === 'TP' && lvl.doneBar === 25, `res=${lvl.result} doneBar=${lvl.doneBar}`)
  check('B1b: danh dau da khop (filled=true)', lvl.filled === true, `filled=${lvl.filled}`)
}

// --- Case B1c: cung bar vua khop entry vua xuyen SL -> tinh SL (bao thu) -----
// Nen giam manh: low 95.0 <= entry 96.4 (khop) VA <= SL (~95.81) -> SL ngay.
{
  const { closes, volumes } = svScenario()
  closes.push(95.5) // nen giam: low = 95.0
  volumes.push(600)
  const r = runVsa(mkBars(closes, volumes), LOOSE)
  const lvl = r.levels[0]
  check('B1c: cung bar khop entry + xuyen SL -> SL', lvl.result === 'SL' && lvl.doneBar === 24, `res=${lvl.result} doneBar=${lvl.doneBar}`)
}

// --- Case B2: HANH VI THAT - ST moi THAY setup cu, khong luu ket qua -------
// 40_events.pine: khi ST xay ra, tm_lvlE/S/T duoc GAN LAI va tm_lvlDone := false,
// tm_lvlRes := "". Neu bar sau van la quietST trong vung retest (retestT mac dinh
// 1.0 ATR, lvFresh 60 bar) thi ST lai ban -> setup cu bi thay ma KHONG ghi lai
// TP/SL nao. Nghia la setup co the "mo mai" neu ST lap lien tuc.
// Day la hanh vi THAT cua ban Pine, khong phai loi port -> khoa lai o day.
{
  const { closes, volumes } = svScenario()
  closes.push(100.5) // bar 24: van quietST, gia trong vung retest -> ST moi
  volumes.push(100)
  const r = runVsa(mkBars(closes, volumes), LOOSE)
  check('B2: bar 24 sinh ST moi', r.flags.STl[24] === true, `quietST=${r.series.quietST[24]} svFresh=${r.series.svFresh[24]}`)
  check('B2: co 2 setup (setup cu bi thay)', r.levels.length === 2, `levels=${r.levels.length}`)
  check('B2: setup cu KHONG duoc ghi ket qua TP/SL', r.levels[0].result === undefined, `res=${r.levels[0].result}`)
  check('B2: setup moi bat dau lai tu bar 24', r.levels[1].bar === 24, `bar=${r.levels[1].bar}`)
}

// --- Case C: setup dong khi cham SL ----------------------------------------
{
  const { closes, volumes } = svScenario()
  const bars = mkBars(closes, volumes)
  const r0 = runVsa(bars, LOOSE)
  const lvl0 = r0.levels[0]
  closes.push(94) // 24: low 93.5 < SL -> cham SL
  volumes.push(100)
  const r = runVsa(mkBars(closes, volumes), LOOSE)
  const lvl = r.levels[0]
  check('C: setup dong bang SL', lvl.result === 'SL', `res=${lvl.result} sl=${lvl0.sl} low=${93.5}`)
  check('C: doneBar = bar cham SL (24)', lvl.doneBar === 24, `doneBar=${lvl.doneBar}`)
}

// --- Case D: cung bar cham ca TP va SL -> uu tien SL -----------------------
{
  const { closes, volumes } = svScenario()
  const bars = mkBars(closes, volumes)
  const lvl0 = runVsa(bars, LOOSE).levels[0]
  // Bar 24 keo dai cham ca hai muc trong cung mot nen
  bars.push({
    time: bars[bars.length - 1].time + 300000,
    open: closes[23],
    high: lvl0.tp + 5,      // vuot TP
    low: lvl0.sl - 5,       // vuot SL
    close: closes[23],
    volume: 100,
  })
  const lvl = runVsa(bars, LOOSE).levels[0]
  check('D: cung bar cham ca hai -> tinh SL (bi quan)', lvl.result === 'SL', `res=${lvl.result}`)
  check('D: doneBar = bar 24', lvl.doneBar === 24, `doneBar=${lvl.doneBar}`)
}

// --- Case E: BC -> ST SHORT ------------------------------------------------
{
  // Dinh tai i=17 (high 101) duoc xac nhan tai i=20 (pivLen=3).
  // Bar BC i=22: volume TIM, bac tren DAI (high 103, close 101) va
  // close > close[i-run] -> runUp.
  const closes = []
  for (let i = 0; i <= 16; i++) closes.push(84 + i) // 84..100
  closes.push(100.5) // 17  <- dinh 101, xac nhan o i=20
  closes.push(100)   // 18
  closes.push(99.5)  // 19
  closes.push(99)    // 20
  closes.push(98.5)  // 21
  closes.push(101)   // 22  BC: close 101 > closes[17]=100.5 -> runUp
  const volumes = new Array(closes.length).fill(100)
  volumes[22] = 600
  closes.push(100.5) // 23  ST SHORT: nen do (101 -> 100.5)
  volumes.push(100)

  const bars = mkBars(closes, volumes)
  // Bac tren dai: high 103, low 100 -> (103-101)/3 = 0.67 >= 0.5
  bars[22] = { ...bars[22], open: 100, high: 103, low: 100, close: 101, volume: 600 }

  const r = runVsa(bars, LOOSE)
  const lvl = r.levels.find((x) => x.dir === -1)
  check('E: dinh duoc xac nhan lam khang cu', r.series.nearRes[22] === true, `nearRes=${r.series.nearRes[22]} highFresh=${r.series.highFresh[22]}`)
  check('E: BC phat (bac tren dai + runUp)', r.flags.BC[22] === true, `purple=${r.series.isPurple[22]} runUp=${r.series.runUp[22]} wickReq=${(103 - 101) >= 0.5 * (103 - 100)}`)
  check('E: ST SHORT phat tai bar 23', r.flags.STs[23] === true, `quietST=${r.series.quietST[23]} bcFresh=${r.series.bcFresh[23]}`)
  check('E: co setup SHORT', !!lvl, `levels=${JSON.stringify(r.levels)}`)
  check('E: Entry SHORT = high tai bar BC', lvl && lvl.entry === 103, `entry=${lvl?.entry}`)
  check('E: SL SHORT = Entry + slBuf*ATR', lvl && near(lvl.sl, 103 + 0.5 * r.series.atr[23]), `sl=${lvl?.sl}`)
  check('E: TP SHORT = fallback khi khong co pivot low', lvl && near(lvl.tp, 103 - 2.0 * 0.5 * r.series.atr[23]), `tp=${lvl?.tp}`)
}

// --- Case F: cong tac tat -> khong co su kien ------------------------------
{
  const { closes, volumes } = svScenario()
  const bars = mkBars(closes, volumes)

  // LUU Y: NS/ND chi phu thuoc tm_i_quietOn, KHONG phu thuoc tm_i_evtOn
  // (dung nhu 40_events.pine). Nen "tat su kien" chi tat SV/BC/ST.
  const off = runVsa(bars, { ...LOOSE, evtOn: false })
  const tight = off.events.filter((e) => ['SV', 'BC', 'ST LONG', 'ST SHORT'].includes(e.type))
  check('F: evtOn=false -> khong SV/BC/ST', tight.length === 0, JSON.stringify(off.events))

  // volMin cao -> evtOk false -> khong thanh purple -> khong SV/ST
  const gated = runVsa(bars, { ...LOOSE, volMin: 1000 })
  check('F: volMin chan -> khong SV', gated.flags.SV.every((x) => !x), `purple22=${gated.series.isPurple[22]}`)
  check('F: volMin chi gate SU KIEN, bucket van dung TIM', gated.series.bucket[22] === 'TIM', `bucket=${gated.series.bucket[22]}`)
  check('F: volMin chan -> khong ST', gated.flags.STl.every((x) => !x) && gated.flags.STs.every((x) => !x))
  check('F: volMin chan ca NS/ND (vi evtOk dung chung)', gated.flags.NS.every((x) => !x) && gated.flags.ND.every((x) => !x))

  const nq = runVsa(bars, { ...LOOSE, quietOn: false })
  check('F: quietOn=false tuyt doi khong NS/ND', nq.flags.NS.every((x) => !x) && nq.flags.ND.every((x) => !x))
  check('F: quietOn=false khong anh huong SV', nq.flags.SV[22] === true, `SV=${nq.flags.SV[22]}`)
}

// --- Case G: session gate --------------------------------------------------
{
  const { closes, volumes } = svScenario()
  // 2026-01-05 12:00 UTC = 19:00 gio VN -> NGOAI phien 0800-1600.
  // (Moc 00:00 UTC = 07:00 VN cung ngoai, nhung bar 22 lui ve 01:50 UTC =
  //  08:50 VN lai TRONG phien - nen phai chon goc gio chac chan ngoai.)
  const bars = mkBars(closes, volumes, 0.5, Date.UTC(2026, 0, 5, 12, 0, 0))
  const out = runVsa(bars, { ...LOOSE, sessOn: true, sess: '0800-1600', tz: 'Asia/Ho_Chi_Minh' })
  check('G: ngoai phien -> sessOk=false', out.series.sessOk.every((x) => x === false), `sessOk[22]=${out.series.sessOk[22]}`)
  check('G: ngoai phien -> khong SV', out.flags.SV.every((x) => !x))
  check('G: ngoai phien -> khong ST', out.flags.STl.every((x) => !x) && out.flags.STs.every((x) => !x))
  check('G: ngoai phien -> khong NS/ND', out.flags.NS.every((x) => !x) && out.flags.ND.every((x) => !x))

  // Trong phien: 2026-01-05 02:00 UTC = 09:00 VN -> su kien hoat dong binh thuong
  const inSess = runVsa(mkBars(closes, volumes, 0.5, Date.UTC(2026, 0, 5, 2, 0, 0)), { ...LOOSE, sessOn: true, sess: '0800-1600', tz: 'Asia/Ho_Chi_Minh' })
  check('G: trong phien -> SV van phat', inSess.flags.SV[22] === true, `sessOk=${inSess.series.sessOk[22]}`)
}

// --- Case H: series cho dashboard ------------------------------------------
{
  const { closes, volumes } = svScenario()
  const r = runVsa(mkBars(closes, volumes), LOOSE)
  check('H: pur20 dem dung 1 cot TIM', r.series.pur20[22] === 1, `pur20=${r.series.pur20[22]}`)
  check('H: lastPurBar = bar co TIM', r.series.lastPurBar[22] === 22, `lastPurBar=${r.series.lastPurBar[22]}`)
  check('H: bucket bar thuong = Normal', r.series.bucket[21] === 'Normal', `bucket=${r.series.bucket[21]}`)
  check('H: ratio ~ 3 khi vol 600 / MA ~200? (bang so that)', near(r.series.ratio[22], 3, 1e-6), `ratio=${r.series.ratio[22]}`)
  check('H: lastEvt cap nhat sau ST', r.series.lastEvt[23] === 'ST', `lastEvt=${r.series.lastEvt[23]}`)
  check('H: atr na o dau chuoi, co gia tri ve sau', r.series.atr[0] === null && r.series.atr[22] != null)
}

// --- Case I: khong co du lieu -> khong crash ------------------------------
{
  const r = runVsa([], LOOSE)
  check('I: mang rong -> khong crash, khong su kien', r.events.length === 0 && r.levels.length === 0)
  const r1 = runVsa(mkBars([100], [100]), LOOSE)
  check('I: 1 bar -> khong crash', r1.events.length === 0)
}

// =============================================================================
section('5. version.mjs — danh tinh mot run (D1): paramsHash phai ON DINH')

// Cac "bay" nay deu da duoc kiem chung bang thuc nghiem truoc khi viet test.
// Neu ai do "toi uu" canonicalParams (bo merge DEFAULTS, bo sort, ep kieu theo
// gia tri nguoi dung), cac test duoi day se do NGAY.
{
  const A = { rP: 2.2 }
  const B = { ...DEFAULTS, rP: 2.2 }
  check('bay 1: chi truyen 1 tham so == truyen full default', paramsHash(A) === paramsHash(B),
    `${paramsHash(A).slice(0, 12)} vs ${paramsHash(B).slice(0, 12)}`)

  const k1 = { ...DEFAULTS }
  const k2 = {}
  for (const k of Object.keys(DEFAULTS).reverse()) k2[k] = DEFAULTS[k]
  check('bay 2: dao thu tu key -> cung hash', paramsHash(k1) === paramsHash(k2))

  check('bay 3: volMin 0 vs "0" -> cung hash',
    paramsHash({ ...DEFAULTS, volMin: 0 }) === paramsHash({ ...DEFAULTS, volMin: '0' }))
  check('bay 3b: len 20 vs 20.0 -> cung hash',
    paramsHash({ ...DEFAULTS, len: 20 }) === paramsHash({ ...DEFAULTS, len: 20.0 }))
  check('bay 3c: confirmOnly true vs "true" -> cung hash',
    paramsHash({ ...DEFAULTS, confirmOnly: true }) === paramsHash({ ...DEFAULTS, confirmOnly: 'true' }))

  // Bay 4: go sai ten tham so PHAI nem loi, khong duoc lang le sinh hash
  let threw = null
  try { paramsHash({ ...DEFAULTS, rp: 2.2 }) } catch (e) { threw = e.message }
  check('bay 4: ten tham so sai -> NEM LOI (khong lang le)', threw !== null, String(threw))
  check('bay 4b: loi co neu ro ten sai', threw !== null && threw.includes('rp'), String(threw))

  // Gia tri vo ly cung phai nem loi
  let threwNaN = null
  try { paramsHash({ ...DEFAULTS, rP: 'khong-phai-so' }) } catch (e) { threwNaN = e.message }
  check('gia tri khong phai so -> nem loi', threwNaN !== null, String(threwNaN))

  // Doi tham so THAT thi hash PHAI doi (neu khong, version stamp vo nghia)
  check('doi rP that -> hash doi', paramsHash({ ...DEFAULTS, rP: 2.2 }) !== paramsHash({ ...DEFAULTS, rP: 2.3 }))
  check('doi 1 tham so bat ky -> hash doi',
    paramsHash(DEFAULTS) !== paramsHash({ ...DEFAULTS, lvFresh: 61 }) &&
    paramsHash(DEFAULTS) !== paramsHash({ ...DEFAULTS, sessOn: true }))

  // stableStringify: sort key o MOI cap, ke ca object long nhau
  const n1 = { b: 1, a: { y: 2, x: 1 } }
  const n2 = { a: { x: 1, y: 2 }, b: 1 }
  check('stableStringify: object long nhau -> cung chuoi', stableStringify(n1) === stableStringify(n2), stableStringify(n1))
  check('stableStringify: mang giu NGUYEN thu tu (co y nghia)',
    stableStringify([1, 2]) !== stableStringify([2, 1]))
  check('stableStringify: undefined -> nem loi (khong am tham bo qua)',
    (() => { try { stableStringify({ a: undefined }); return false } catch { return true } })())

  // canonicalParams tra ve object co key DA SORT. stableStringify cung sort, nen
  // day la phong thu 2 lop: neu ai bo sort o 1 noi, lop kia van giu duoc tinh on dinh.
  // Test nay khoa y dinh do lai (mutation-test: bo sort o canonicalParams khong
  // lam test do, vi stableStringify da lo - assertion nay lam no do dung).
  const ck = Object.keys(canonicalParams({ rP: 2.2 }))
  check('canonicalParams: key da sort san (phong thu 2 lop)', ck.join(',') === [...ck].sort().join(','), ck.join(','))
  check('canonicalParams: du tham so ke ca khi truyen thieu', ck.length === Object.keys(PARAM_SCHEMA).length, `${ck.length} vs ${Object.keys(PARAM_SCHEMA).length}`)

  // barsHash: doi du lieu -> doi hash; chi doi truong la -> KHONG doi
  const bars1 = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]
  const bars2 = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 11 }]
  const barsLa = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, extra: 'bo-qua' }]
  check('barsHash: doi volume -> doi hash', barsHash(bars1) !== barsHash(bars2))
  check('barsHash: truong la khong anh huong', barsHash(bars1) === barsHash(barsLa))

  // runStamp: du cac truong D1, va paramsHash khop
  const st = runStamp({ params: { rP: 2.2 }, bars: bars1, symbol: 'BTCUSDT', tf: '15', market: 'fapi' })
  check('runStamp: du truong D1',
    ['engineVersion', 'paramsHash', 'dataHash', 'universeSnapshot', 'gitRev'].every((k) => k in st),
    Object.keys(st).join(','))
  check('runStamp: engineVersion la chuoi', typeof st.engineVersion === 'string' && st.engineVersion.length > 0)
  check('runStamp: paramsHash khop ham paramsHash', st.paramsHash === paramsHash({ rP: 2.2 }))
  check('runStamp: co params da canonical hoa (de TAI LAP duoc)', JSON.stringify(st.params) === JSON.stringify(canonicalParams({ rP: 2.2 })), `${Object.keys(st.params || {}).length} tham so`)
  check('runStamp: tham so truyen vao duoc ap dung', st.params.rP === 2.2 && st.params.atrLen === DEFAULTS.atrLen)
  check('runStamp: dataHash khop barsHash', st.dataHash === barsHash(bars1))
  check('runStamp: thieu bars -> dataHash null (khong crash)', runStamp({ params: {} }).dataHash === null)

  // readGitRev khong duoc nem loi du repo khong co .git
  let gitOk = true
  try { readGitRev('C:\\khong-ton-tai-dau') } catch { gitOk = false }
  check('readGitRev: duong dan sai -> null, khong nem', gitOk && readGitRev('C:\\khong-ton-tai-dau') === null)
}

// =============================================================================
section('6. fee_R — rang buoc TOAN HOC cua do rong stop (docs/vsa-optimization.md)')

// fee_R = phi_round-trip / (slBuf x ATR%). Vi sao phai co: voi slBuf=0.5 tren khung
// 5m, rieng phi da bang 1.40R -> moi lenh vao da am 1.4R truoc khi gia di.
{
  const { closes, volumes } = svScenario()
  const bars = mkBars(closes, volumes)

  // ATR chua san (dau chuoi) -> feeR = null, khong crash
  const r0 = runVsa(bars, LOOSE)
  check('feeR: null khi chua co ATR', r0.series.feeR[0] === null, `feeR[0]=${r0.series.feeR[0]}`)
  check('feeR: co gia tri khi ATR da san', r0.series.feeR[22] != null, `feeR[22]=${r0.series.feeR[22]}`)

  // Khop cong thuc tinh tay: fee_R = (feePct/100 * 2) / (slBuf * atr/close)
  const i = 22
  const a = r0.series.atr[i]
  const c = bars[i].close
  const expect = ((DEFAULTS.feePct / 100) * 2) / (DEFAULTS.slBuf * (a / c))
  check('feeR: khop cong thuc tinh tay', Math.abs(r0.series.feeR[i] - expect) < 1e-9,
    `engine=${r0.series.feeR[i]} tay=${expect}`)

  // slBuf rong hon -> fee_R nho di (cung mot nen)
  const rWide = runVsa(bars, { ...LOOSE, slBuf: 2.0 })
  check('feeR: slBuf 2.0 -> fee_R giam ~4 lan', Math.abs(rWide.series.feeR[i] - expect / 4) < 1e-9,
    `${rWide.series.feeR[i]} vs ${expect / 4}`)

  // feeOk: nguong hien hanh
  check('feeOk: false khi fee_R > feeMaxR', r0.series.feeOk[i] === (r0.series.feeR[i] <= DEFAULTS.feeMaxR),
    `feeR=${r0.series.feeR[i]} feeOk=${r0.series.feeOk[i]}`)

  // slBuf=0.5 + nguong 0.15 -> cau hinh nay BAT KHA THI ve toan hoc o moi khung
  // thuc te (feeR se ~0.36-1.40R tuy khung), nen tren fixture nay phai la false.
  const tight = runVsa(bars, { ...LOOSE, slBuf: 0.5, feeMaxR: 0.15 })
  check('feeOk: slBuf=0.5 vi pham nguong 0.15R', tight.series.feeOk[i] === false, `feeR=${tight.series.feeR[i]}`)

  // Nguong rong -> chap nhan
  const loose = runVsa(bars, { ...LOOSE, slBuf: 0.5, feeMaxR: 5 })
  check('feeOk: nguong rong thi chap nhan', loose.series.feeOk[i] === true, `feeR=${loose.series.feeR[i]}`)

  // Phi = 0 -> fee_R = 0 va luon OK (dung cho san zero-fee)
  const noFee = runVsa(bars, { ...LOOSE, feePct: 0 })
  check('feeR: phi = 0 -> fee_R = 0 va feeOk', noFee.series.feeR[i] === 0 && noFee.series.feeOk[i] === true)
}

// =============================================================================
section('7. Muc 5b — entry theo XAC NHAN (market) + TP co dinh theo R')

// Ly do doi (docs/vsa-optimization.md §5b): che do limit tai cuc tri SV/BC lam
// 64-72% setup KHONG BAO GIO khop trong cua so cua no -> tin hieu tren chart khong
// phai lenh; so it khop duoc thi khop vi gia dang DAM XUYEN qua muc do -> gan nhu SL.
{
  const { closes, volumes } = svScenario()
  const bars = mkBars(closes, volumes)
  const stBar = 23
  const svBar = 22
  const MKT = { ...LOOSE, entryMode: 'market', tpMode: 'r' }

  const r = runVsa(bars, MKT)
  const lvl = r.levels[0]
  const atr = r.series.atr[stBar]

  check('market: Entry = CLOSE cua bar ST (khong phai cuc tri SV)',
    lvl.entry === bars[stBar].close, `entry=${lvl.entry} close=${bars[stBar].close} svPx=${bars[svBar].low}`)
  check('market: SL van theo CAU TRUC (duoi SV low)',
    near(lvl.sl, bars[svBar].low - 0.5 * atr), `sl=${lvl.sl}`)
  check('market: rui ro RONG hon che do limit',
    lvl.risk > 0.5 * atr, `risk=${lvl.risk} vs limit=${0.5 * atr}`)
  check('market: TP = rrFb x R (R co dinh)',
    near(lvl.tp, lvl.entry + 2.0 * lvl.risk), `tp=${lvl.tp} entry=${lvl.entry} risk=${lvl.risk}`)
  check('market: khop NGAY tai bar ST (moi tin hieu thanh lenh)',
    lvl.filled === true && lvl.fillBar === stBar, `filled=${lvl.filled} fillBar=${lvl.fillBar}`)
  check('market: risk = entry - sl', near(lvl.risk, lvl.entry - lvl.sl))

  // Moi tin hieu ST deu phai thanh mot level co khop (khong con "chua khop")
  const nST = r.flags.STl.filter(Boolean).length + r.flags.STs.filter(Boolean).length
  check('market: moi ST deu sinh level', r.levels.length === nST, `levels=${r.levels.length} ST=${nST}`)
  check('market: khong con setup "chua khop"', r.levels.every((L) => L.filled === true),
    JSON.stringify(r.levels.map((L) => L.filled)))

  // TP theo pivot chi dung khi pivot >= entry + 1R
  const piv = runVsa(bars, { ...LOOSE, entryMode: 'market', tpMode: 'pivot' })
  const lp = piv.levels[0]
  check('market+pivot: pivot 99.5 >= entry + 1R -> dung pivot', near(lp.tp, 99.5),
    `tp=${lp.tp} nguong=${lp.entry + lp.risk}`)

  // Chan gia tri sai ngay tai cua vao
  let e1 = null
  try { runVsa(bars, { ...LOOSE, entryMode: 'thi-truong' }) } catch (e) { e1 = e.message }
  check('chan entryMode sai', e1 !== null && e1.includes('entryMode'), String(e1))
  let e2 = null
  try { runVsa(bars, { ...LOOSE, tpMode: 'xyz' }) } catch (e) { e2 = e.message }
  check('chan tpMode sai', e2 !== null && e2.includes('tpMode'), String(e2))

  // SHORT: market entry = close bar ST, SL tren BC high
  const sym = []
  for (let i = 0; i <= 16; i++) sym.push(84 + i)
  sym.push(100.5, 100, 99.5, 99, 98.5, 101, 100.5)
  const vols = new Array(sym.length).fill(100)
  vols[22] = 600
  const sbars = mkBars(sym, vols)
  sbars[22] = { ...sbars[22], open: 100, high: 103, low: 100, close: 101, volume: 600 }
  const rs = runVsa(sbars, MKT)
  const ls = rs.levels.find((L) => L.dir === -1)
  check('market SHORT: Entry = close bar ST', ls && ls.entry === sbars[23].close, `entry=${ls?.entry}`)
  check('market SHORT: SL tren BC high (cau truc)', ls && near(ls.sl, 103 + 0.5 * rs.series.atr[23]), `sl=${ls?.sl}`)
}

// =============================================================================
section('8. §5c — chien luoc WYCKOFF (spring/UTAD, SOS/SOW, LPS/LPSY)')

// VSA chi lam BO LOC vung; SU KIEN WYCKOFF quyet dinh thoi diem vao lenh.
// (Thay cho BOS/CHoCH cua SMC o phien ban truoc - xem docs/vsa-optimization.md §5d.)
{
  const { closes, volumes } = svScenario()
  const bars = mkBars(closes, volumes)

  // Cac mang su kien phai ton tai va dung do dai
  const r = runVsa(bars, { ...LOOSE, signalMode: 'wyckoff' })
  const evKeys = ['spring', 'utad', 'sos', 'sow', 'lps', 'lpsy']
  check('wyckoff: co du 6 mang su kien', evKeys.every((k) => Array.isArray(r.series[k]) && r.series[k].length === bars.length),
    evKeys.map((k) => `${k}:${Array.isArray(r.series[k]) ? r.series[k].length : 'thieu'}`).join(' '))

  for (const ev of ['spring', 'sos', 'lps']) {
    const rr = runVsa(bars, { ...LOOSE, signalMode: 'wyckoff', wyckoffEvent: ev, slBuf: 1.5, tpMode: 'r' })
    const nST = rr.flags.STl.filter(Boolean).length + rr.flags.STs.filter(Boolean).length
    // Wyckoff luon vao market -> moi tin hieu deu thanh lenh da khop
    check(`wyckoff ${ev}: moi tin hieu thanh lenh da khop`, rr.levels.length === nST && rr.levels.every((L) => L.filled === true),
      `levels=${rr.levels.length} ST=${nST} filled=${rr.levels.map((L) => L.filled).join(',')}`)
    // SL dat ngoai DAY/DINH cua chinh bar kich hoat
    const bad = rr.levels.find((L) => L.dir === 1 ? !(L.sl < bars[L.bar].low) : !(L.sl > bars[L.bar].high))
    check(`wyckoff ${ev}: SL ngoai day/dinh bar kich hoat`, !bad,
      bad ? `bar=${bad.bar} dir=${bad.dir} sl=${bad.sl} low=${bars[bad.bar].low} high=${bars[bad.bar].high}` : '')
    // TP = rrFb x risk
    const badTp = rr.levels.find((L) => !near(Math.abs(L.tp - L.entry), 2.0 * L.risk, 1e-9))
    check(`wyckoff ${ev}: TP = rrFb x R (R co dinh)`, !badTp, badTp ? `tp=${badTp.tp} entry=${badTp.entry} risk=${badTp.risk}` : '')
  }

  // Chan gia tri sai
  let e3 = null
  try { runVsa(bars, { ...LOOSE, signalMode: 'wyckoff', wyckoffEvent: 'bos' }) } catch (e) { e3 = e.message }
  check('wyckoff: chan su kien khong phai Wyckoff (vd "bos")', e3 !== null && e3.includes('wyckoffEvent'), String(e3))
  let e4 = null
  try { runVsa(bars, { ...LOOSE, signalMode: 'trend' }) } catch (e) { e4 = e.message }
  check('wyckoff: chan signalMode cu "trend" (SMC da bo)', e4 !== null && e4.includes('signalMode'), String(e4))
}

// =============================================================================
section('9. store.mjs - append NDJSON + reject mismatched paramsHash (D1)')

// ACCEPTANCE Phase 3: "engine/store.mjs records with version stamp;
// test verifies 2 runs with different paramsHash are not mixed in reports."
// If someone removes this lock, this test immediately fails.
{
  const tmp = mkdtempSync(join(tmpdir(), 'tm-store-'))
  const runsFile = join(tmp, 'runs.ndjson')
  const tradesFile = join(tmp, 'trades.ndjson')
  const fixtureBars = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]

  // --- withStamp: chot o tang GHI, khong de run vo danh tinh xuong dis ---
  const bare = { symbol: 'BTCUSDT', tf: '15', market: 'fapi', params: { rP: 2.2 } }
  const stamped = withStamp(bare, { bars: fixtureBars })
  check('withStamp: tu sinh day du D1 khi thieu', ['engineVersion', 'paramsHash', 'params', 'dataHash'].every((k) => stamped[k] != null),
    Object.keys(stamped).join(','))
  check('withStamp: params da canonical (du tham so default)', Object.keys(stamped.params).length === Object.keys(PARAM_SCHEMA).length)
  check('withStamp: createdAt la Date UTC', stamped.createdAt instanceof Date && stamped.createdAt.toISOString().endsWith('Z'))

  let noParams = null
  try { withStamp({ symbol: 'BTCUSDT' }) } catch (e) { noParams = e.message }
  check('withStamp: thieu params -> NEM LOI (khong luu run vo danh tinh)', noParams !== null, String(noParams))

  // Bay nghiem trong nhat cua D1: params da sua nhung paramsHash cu khong doi theo
  // -> run gia nam ben canh run dung cung mot bo tham so ghi tren mat.
  let mismatch = null
  try { withStamp({ ...bare, paramsHash: 'cuc-hash-cu' }) } catch (e) { mismatch = e.message }
  check('withStamp: paramsHash khong khop params -> NEM LOI', mismatch !== null && mismatch.includes('khong-khop'), String(mismatch))

  // --- saveRun: NDJSON LUON ghi, du co Mongo hay khong ---
  const r1 = await saveRun({ ...bare, stats: { trades: 2, netPct: 4 } }, { mongo: false, runsFile, tradesFile })
  check('saveRun: NDJSON ghi duoc khi khong co Mongo (fail-soft)', r1.ndjson === true && r1.mongo === false)
  check('saveRun: ban ghi da mang stamp', typeof r1.run.paramsHash === 'string' && r1.run.paramsHash.length === 64)
  check('saveRun: ISO-8601 Z (D2, khong gio dia phuong)', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(r1.run.createdAt instanceof Date ? r1.run.createdAt.toISOString() : ''))

  const r2 = await saveRun({ ...bare, tf: '60', stats: { trades: 1, netPct: -2 } }, { mongo: false, runsFile, tradesFile, trades: [{ dir: 1, result: 'TP', pnlPct: 3, rMultiple: 1.5 }] })
  check('saveRun: ghi duoc lenh rieng (khong nhung vao run)', loadRuns(tradesFile).length === 1, `lines=${loadRuns(tradesFile).length}`)
  check('saveRun: trade keo theo paramsHash + engineVersion', loadRuns(tradesFile)[0]?.paramsHash === r2.run.paramsHash)
  check('saveRun: 2 run cung params -> cung hash (on dinh)', r1.run.paramsHash === r2.run.paramsHash)

  const rows = loadRuns(runsFile)
  check('loadRuns: doc lai du 2 run', rows.length === 2, `lines=${rows.length}`)
  check('loadRuns: doc ra van con paramsHash (khong mat danh tinh)', rows.every((r) => typeof r.paramsHash === 'string'))

  // --- TU CHOI TRON: day la noi D1 duoc thi hanh ---
  const rowsWithTrades = rows.map((r, i) => ({ ...r, trades: i === 0 ? [{ result: 'TP', pnlPct: 5, rMultiple: 2 }, { result: 'SL', pnlPct: -2.5, rMultiple: -1 }] : [] }))
  const sumSame = summarizeRuns(rowsWithTrades, { label: 'test' })
  check('summarize: 1 bo tham so -> tong hop duoc', sumSame.trades === 2 && sumSame.generations.length === 1, JSON.stringify(sumSame.generations))
  check('summarize: winRate/WR tinh dung', Math.abs(sumSame.winRate - 0.5) < 1e-12, String(sumSame.winRate))
  check('summarize: netPct = TONG tung lenh', Math.abs(sumSame.netPct - 2.5) < 1e-12, String(sumSame.netPct))
  check('summarize: expectancy = ky vong R', Math.abs(sumSame.expectancy - 0.5) < 1e-12, String(sumSame.expectancy))

  // 2 run KHAC paramsHash -> phai NEM LOI, khong duoc im lang cong chung
  const genA = { engineVersion: '0.4.0', paramsHash: 'aaaa', params: {}, trades: [{ result: 'TP', pnlPct: 10, rMultiple: 3 }] }
  const genB = { engineVersion: '0.5.0', paramsHash: 'bbbb', params: {}, trades: [{ result: 'SL', pnlPct: -1, rMultiple: -1 }] }
  let mixed = null
  try { summarizeRuns([genA, genB], { label: 'preset-bang' }) } catch (e) { mixed = e.message }
  check('summarize: 2 KHAC paramsHash -> NEM LOI (D1)', mixed !== null, String(mixed))
  check('summarize: loi neu ro ca 2 hash dang tron', mixed !== null && mixed.includes('aaaa') && mixed.includes('bbbb'), String(mixed))

  // Neu khong tron duoc thi phai TACH duoc - va moi nhom tu tong hop rieng
  const groups = groupByGeneration([genA, genB, { ...genA, tf: '60' }])
  check('groupByGeneration: 2 nhom rieng le, khong gop', groups.size === 2, `size=${groups.size}`)
  const perGroup = [...groups.values()].map((g) => summarizeRuns(g).netPct).sort((a, b) => a - b)
  // nhom A co 2 run (genA + ban sao tf khac) moi run +10 -> 20; nhom B co 1 run -1
  check('groupByGeneration: tong hop tung nhom ra so khac nhau', perGroup[0] === -1 && perGroup[1] === 20, JSON.stringify(perGroup))
  check('generationKey: khac engineVersion cung khong gop chung', generationKey(genA) !== generationKey(genB))

  // Dong hong trong file -> khong duoc mat het cac run con lai
  appendFileSync(runsFile, '{"paramsHash":"hong","engineVersion":\n')
  const { rows: after, skipped } = readNdjson(runsFile)
  check('readNdjson: dong hong bi bo qua, khong lam mat file', after.length === 2 && skipped === 1, `rows=${after.length} skipped=${skipped}`)

  rmSync(tmp, { recursive: true, force: true })
}

// =============================================================================
section('10. keys.mjs — alertKey (D3/D4): phai khac nhau khi SU KIEN khac nhau')

// Bay that su da gap: 2 alert TAKE_PROFIT cho TP1/TP2 xay ra cung bar co CUNG
// ts/action/side/price. Neu alertKey bo qua `level` -> alert thu 2 bi coi la
// retry cua TradingView va BI MAT (khong ai biet tai sao thieu 1 lenh).
{
  const base = {
    v: 1, ts: '2026-10-01T03:17:21Z', symbol: 'BTCUSDT', tf: '15', mode: 'closed',
    action: 'TAKE_PROFIT', side: 'BUY', price: 63250.5, sl: 63012.1, tps: [63655, 64000],
  }
  const kTp1 = alertKey({ ...base, level: 1 })
  const kTp2 = alertKey({ ...base, level: 2 })
  check('TP1 vs TP2 cung bar -> KHAC khoa (khong mat alert)', kTp1 !== kTp2, `${kTp1.slice(0, 12)} vs ${kTp2.slice(0, 12)}`)

  // Retry cung payload -> PHAI cung khoa (day la chuc nang khong trung)
  check('retry cung payload -> CUNG khoa', alertKey({ ...base, level: 1 }) === kTp1)

  // Chart "live" va chart "closed" cung bar khong duoc chan nhau
  check('khac mode -> khac khoa', alertKey({ ...base, level: 1, mode: 'live' }) !== kTp1)

  // Nguon rieng (scanner/AI) khong duoc chan nham vao alert TradingView
  check('khac source -> khac khoa', alertKey({ ...base, level: 1 }, 'scanner') !== kTp1)
  check('dao thu tu key van cung khoa', alertKey({ tps: base.tps, sl: base.sl, price: base.price, side: base.side, action: base.action, mode: base.mode, tf: base.tf, symbol: base.symbol, ts: base.ts, level: 1 }) === kTp1)

  // alertKey bat loi chu khong sinh khoa rac
  let badTs = null
  try { alertKey({ ...base, ts: 'khong-phai-ngay' }) } catch (e) { badTs = e.message }
  check('ts hong -> NEM LOI (khong sinh khoa)', badTs !== null && badTs.includes('ts'), String(badTs))
  let badPx = null
  try { alertKey({ ...base, price: 'abc' }) } catch (e) { badPx = e.message }
  check('price hong -> NEM LOI', badPx !== null && badPx.includes('price'), String(badPx))

  // clientOrderId derived tu key van <= 31 ky tu (gioi han MT5) sau doi canon
  const cid = clientOrderId(kTp1, 0)
  check('clientOrderId <= 31 ky tu sau khi doi canon', cid.length <= 31 && /^[A-Za-z0-9_-]+$/.test(cid), `${cid} (${cid.length})`)
}

// =============================================================================
section('11. methods/ — hop dong plugin Phase 10 (khoa 🔒 Phase 4)')

// LY DO CUA MUC NAY (roadmap Phase 4, dau muc khoa): neu de den Phase 10 moi tach
// VSA, backtest.mjs se gan khuc vao noi that cua no (levels, flags, series...) va
// khi them method PA/SMC phai boc lai toan bo backtest. Nen backtest PHAI duong
// vao interface ngay tu bay gio - va interface do phai co test cam.
{
  check('method id = "vsa"', vsaMethod.id === 'vsa', String(vsaMethod.id))
  check('method co defaults (la cai version.mjs hash)', vsaMethod.defaults === DEFAULTS)
  check('method co analyze la function', typeof vsaMethod.analyze === 'function')

  // validateMethod: khong chay analyze (kiem tra tinh trang thoi) -> phai tra [] cho plugin hop le
  check('validateMethod: vsa la hop le', validateMethod(vsaMethod).length === 0, JSON.stringify(validateMethod(vsaMethod)))

  const { closes, volumes } = svScenario()
  const bars = mkBars(closes, volumes)
  const an = vsaMethod.analyze(bars, LOOSE)

  // --- in -> events/scores (hang 1 cua hop dong) ---
  check('analyze: du 3 truong bat buoc', ['events', 'scores', 'setups'].every((k) => an[k] !== undefined))
  check('analyze: events = dung chuoi SV -> ST LONG', JSON.stringify(an.events.map((e) => e.type)) === '["SV","ST LONG"]', JSON.stringify(an.events))
  check('analyze: scores dai bang so bar', an.scores.length === bars.length, `${an.scores.length} vs ${bars.length}`)
  check('analyze: scores nam trong [-1,1]', an.scores.every((s) => s >= -1 && s <= 1))
  check('analyze: bar ST LONG diem +1 (huong)', an.scores[23] === 1, `scores[23]=${an.scores[23]}`)
  check('analyze: bar SV diem +0.5 (ung vien, khong phai vao lenh)', an.scores[22] === 0.5, `scores[22]=${an.scores[22]}`)
  check('analyze: bar khong su kien diem 0 (khong keo diem sang bar sau)', an.scores[0] === 0 && an.scores[10] === 0, `s0=${an.scores[0]} s10=${an.scores[10]}`)

  // --- out -> setup {dir, entry, sl, tp} (hang 2 cua hop dong) ---
  const s0 = an.setups[0]
  check('analyze: setups co day du dir/entry/sl/tp', ['dir', 'entry', 'sl', 'tp'].every((k) => Number.isFinite(s0[k])), JSON.stringify(s0))
  check('analyze: setup chi dung 1 trong 2 huong phep', an.setups.every((x) => x.dir === 1 || x.dir === -1))
  check('analyze: setups cung ket qua voi runVsa (khong co 2 ban tinh)', JSON.stringify(an.setups) === JSON.stringify(runVsa(bars, LOOSE).levels))

  // --- registry ---
  check('getMethod("vsa") tra ve chinh plugin dang ky', getMethod('vsa') === vsaMethod)
  check('listMethods co "vsa"', listMethods().includes('vsa'), JSON.stringify(listMethods()))
  let unknown = null
  // Dung id se KHONG BAO GIO dang ky (khong phai 'price-action' — id do da duoc
  // dang ky tu Phase 10, neu test cu thi section nay se fail sai).
  try { getMethod('method-khong-ton-tai') } catch (e) { unknown = e.message }
  check('method chua co -> NEM LOI (khong im lang chay method mac dinh)', unknown !== null && unknown.includes('method-khong-ton-tai'), String(unknown))

  // --- chan plugin sai hop dong ---
  const badNoAnalyze = validateMethod({ id: 'xx', name: 'x', defaults: {} })
  check('validateMethod: thieu analyze -> bao loi', badNoAnalyze.some((e) => e.includes('analyze')), JSON.stringify(badNoAnalyze))
  const badId = validateMethod({ id: 'X SA!', name: 'x', defaults: {}, analyze() {} })
  check('validateMethod: id sai dinh dang -> bao loi', badId.some((e) => e.includes('id')), JSON.stringify(badId))
  let dup = null
  try { registerMethod({ id: 'vsa', name: 'plugin khac', defaults: {}, analyze() {} }) } catch (e) { dup = e.message }
  check('registerMethod: trung id voi plugin KHAC -> NEM LOI (khong duoc lam cham method)', dup !== null && dup.includes('da duoc dang ky'), String(dup))

  // --- signals.mjs van la re-export (khong co logic rieng) ---
  check('signals.mjs re-export dung 1 implementation (khong co 2 ban tinh)', signalsShim.runVsa === runVsaFromMethods)
}

// =============================================================================
section('12. backtest.mjs — D5 (ST thay setup) + D6 (thu tu TP/SL trong bar)')

// Dung method GIA de test backtest. Day la cach dung: backtest phai hoat dong
// dung tren interface `analyze()`, nen phai kiem chung duoc voi setups do dieu
// khien duoc - khong phai chi voi VSA (no se tao setup ngau nhien qua fixture).
// Phai nhan `opts.params` tu backtest (khong chi dung tham so dong), khong thi
// feePct/slipPct khong toi duoc cost math - chinh la loi da gap khi viet test nay.
function stubMethod(setups, defaults = {}) {
  return {
    id: 'stub',
    name: 'Stub',
    defaults,
    analyze: (bars, opts) => ({
      events: [],
      scores: bars.map(() => 0),
      setups,
      params: { ...defaults, ...(opts ?? {}) },
    }),
  }
}

// 5 bar, 5m. Bar 0 = bar tao setup. Cac bar sau deu co kha nang cham muc.
const T0 = Date.UTC(2026, 0, 5, 0, 0, 0)
const stubBars = [
  { time: T0, open: 100, high: 101, low: 99, close: 100, volume: 100 },
  { time: T0 + 300000, open: 100, high: 112, low: 94, close: 105, volume: 100 }, // cham CA TP va SL
  { time: T0 + 600000, open: 105, high: 106, low: 104, close: 105, volume: 100 }, // khong cham gi
  { time: T0 + 900000, open: 105, high: 106, low: 104, close: 105, volume: 100 },
  { time: T0 + 1200000, open: 105, high: 112, low: 100, close: 111, volume: 100 }, // chi cham TP
]
// setup LONG: entry 100, sl 95, tp 110. Bar 1 cham ca hai (low 94 <= 95, high 112 >= 110)
const LONG_SETUP = { bar: 0, dir: 1, entry: 100, sl: 95, tp: 110, risk: 5, filled: true, fillBar: 0, doneBar: 1, result: 'SL' }

// --- phi + slippage: phai an vao loi the, khong phai chi so do ----------------
{
  const bt = backtest(stubBars, { method: stubMethod([{ ...LONG_SETUP }]), params: { feePct: 0, slipPct: 0 }, symbol: 'BTCUSDT', tf: '5' })
  const t = bt.trades[0]
  // gross = (95-100)/100 = -5% . phi/slippage = 0 -> nghia vu -5%
  check('phi=0 slip=0: pnlPct = gross -5%', near(t.pnlPct, -5, 1e-9), `got ${t.pnlPct}`)
  check('phi=0 slip=0: rMultiple = -1R', near(t.rMultiple, -1, 1e-9), `got ${t.rMultiple}`)
  check('gia thoat = SL (strategy.exit stop=), khong phai close bar', t.exitPrice === 95, `exit=${t.exitPrice}`)

  const bt2 = backtest(stubBars, { method: stubMethod([{ ...LONG_SETUP }]), params: { feePct: 0.05, slipPct: 0.02 }, symbol: 'BTCUSDT', tf: '5' })
  const t2 = bt2.trades[0]
  check('co phi + slip -> loi hon (khong phai do duong)', t2.pnlPct < t.pnlPct, `${t2.pnlPct} vs ${t.pnlPct}`)
  // slip 0.02%/chieu + fee 0.05%/chieu x 2 chieu = 0.14% -> -5.14% x ~100/96.47 khong can xac
  check('lop phi + slip = 0.14% (cong don 4 lan)', near(t2.pnlPct - t.pnlPct, -0.14, 0.01), `delta=${t2.pnlPct - t.pnlPct}`)

  // SHORT cung phai huong dung (khong nham dau)
  const short = { ...LONG_SETUP, dir: -1, entry: 100, sl: 105, tp: 90, risk: 5 }
  const bts = backtest(stubBars, { method: stubMethod([short]), params: { feePct: 0, slipPct: 0 }, symbol: 'BTCUSDT', tf: '5' })
  check('SHORT SL: pnlPct = -5% (khong nham dau thanh +5%)', near(bts.trades[0].pnlPct, -5, 1e-9), `got ${bts.trades[0].pnlPct}`)
  check('SHORT: gia thoat = sl 105', bts.trades[0].exitPrice === 105, `exit=${bts.trades[0].exitPrice}`)
}

// --- setup CHUA KHOP -> khong phai la lenh (khong duoc dem vao WR) -----------
{
  const noFill = { ...LONG_SETUP, filled: false, fillBar: 0, result: undefined, doneBar: undefined }
  const bt = backtest(stubBars, { method: stubMethod([noFill]), params: {}, symbol: 'BTCUSDT', tf: '5' })
  check('setup khong khop -> khong sinh trade', bt.trades.length === 0, `trades=${bt.trades.length}`)
  check('setup khong khop -> dem vao noFill (khong im lang)', bt.counters.noFill === 1 && bt.counters.filled === 0, JSON.stringify(bt.counters))
}

// --- D5: MAC DINH = dung voi Pine: setup bi thay -> KHONG luu ket qua --------
{
  const openSetup = { bar: 0, dir: 1, entry: 100, sl: 95, tp: 110, risk: 5, filled: true, fillBar: 0 } // chua co result
  const replaced = { bar: 2, dir: 1, entry: 105, sl: 100, tp: 115, risk: 5, filled: true, fillBar: 2, doneBar: 3, result: 'TP' }

  const def = backtest(stubBars, { method: stubMethod([openSetup, replaced]), params: {}, symbol: 'BTCUSDT', tf: '5' })
  check('D5 mac dinh: setup bi thay KHONG xuat trade (dung nhu ind hien thi)', def.trades.length === 1 && def.trades[0].entryPrice === 105, `trades=${def.trades.length}`)
  check('D5 mac dinh: van DEM so nay (khong mat im -> khong khong WR gia)', def.counters.replaced === 1 && def.counters.dropped === 1, JSON.stringify(def.counters))
  check('D5 mac dinh: khong nhan variant', def.variant === null, String(def.variant))

  const ttl = backtest(stubBars, { method: stubMethod([openSetup, replaced]), params: {}, symbol: 'BTCUSDT', tf: '5', onReplace: 'ttl' })
  check('D5 ttl: setup bi thay -> trade nhan TIME (variant)', ttl.trades.length === 2 && ttl.trades[0].result === 'TIME', JSON.stringify(ttl.trades.map((x) => x.result)))
  check('D5 ttl: nhan variant ro rang de LOAI khoi so sanh parity', ttl.variant === 'onReplace=ttl', String(ttl.variant))
  check('D5 ttl: dong tai bar cua ST thay the', ttl.trades[0].exitTime instanceof Date && ttl.trades[0].exitTime.getTime() === T0 + 600000, String(ttl.trades[0].exitTime))
  check('D5 ttl: dropped = 0 (khong con bi loai)', ttl.counters.dropped === 0, JSON.stringify(ttl.counters))
  // HOP PHONG BUG: truoc do ttl khong tang counters.closed -> bao cao in
  // "dong: 42" trong khi bang tong hop in 110 lenh. closed PHAI bang so lenh
  // da dong (khong con lenh nao bi dem 2 lan hay khong duoc dem).
  check('D5 ttl: closed = tong trade da dong (trong do co cac lenh TIME)',
    ttl.counters.closed === ttl.trades.filter((t) => t.result !== 'OPEN').length,
    `closed=${ttl.counters.closed} trades=${ttl.trades.length}`)
  // HOP PHONG BUG: `replaced` = D5 xay ra (khong phu thuoc che do) nen trong ttl
  // no TRUNG voi `closed`. Invariant dung va dung cho CA HAI che do:
  //   filled = closed + open + dropped
  check('D5 ttl: filled = closed + open + dropped (khong lech counts)',
    ttl.counters.filled === ttl.counters.closed + ttl.counters.open + ttl.counters.dropped,
    JSON.stringify(ttl.counters))
  check('D5 mac dinh: filled = closed + open + dropped (cung cong thuc)',
    def.counters.filled === def.counters.closed + def.counters.open + def.counters.dropped,
    JSON.stringify(def.counters))
  // HOP PHONG BUG: text canh bao khong duoc noi "chay lai voi ttl" khi DANG chay ttl
  const ttlReport = formatSummary(
    { ...summarizeBacktest(ttl, { engineVersion: 'x', paramsHash: 'y' }), method: 'stub', variant: 'onReplace=ttl' },
    { title: 'ttl' })
  check('D5 ttl: bao cao KHONG noi "chay lai voi onReplace=ttl" (vi dang chay ttl)',
    !ttlReport.includes("Chay lai voi --on-replace ttl"), ttlReport.split('\n').filter((l) => l.includes('!!') || l.includes('Chay')).join(' | '))
  check('D5 ttl: bao cao ghi ro cac lenh nay dong vi thay the (TIME)',
    ttlReport.includes('dong vi thay the'), ttlReport.split('\n').filter((l) => l.includes('thay the')).join(' | '))
  check('D5 mac dinh: bao cao VAN phai keo canh bao bi loai',
    formatSummary(summarizeBacktest(def, { engineVersion: 'x', paramsHash: 'y' })).includes('BI LOAI khoi'), 'thieu canh bao ben mac dinh')

  let bad = null
  try { backtest(stubBars, { method: stubMethod([]), params: {}, symbol: 'X', tf: '5', onReplace: 'vua' }) } catch (e) { bad = e.message }
  check('onReplace la chuoi khong biet -> NEM LOI (khong chay ngam)', bad !== null && bad.includes('onReplace'), String(bad))
}

// --- D6: bar me cham ca TP va SL ---------------------------------------------
// Bar 1 cua stubBars: low 94 <= sl 95 VA high 112 >= tp 110 -> VI PHAM VI.
// Map dinh (khong co 1m) -> SL bao thu, resolvedBy1m = false.
{
  const bt = backtest(stubBars, { method: stubMethod([{ ...LONG_SETUP }]), params: {}, symbol: 'BTCUSDT', tf: '5' })
  const t = bt.trades[0]
  check('D6 khong co 1m: SL bao thu', t.result === 'SL', `res=${t.result}`)
  check('D6 khong co 1m: resolvedBy1m = false (khong doan bao thu ma im lang)', t.resolvedBy1m === false, String(t.resolvedBy1m))

  // Co 1m: 1m dau tien chi cham TP -> phan giai duoc, doi thanh TP
  const subTp = [
    { time: T0 + 300000, open: 100, high: 111, low: 100, close: 111, volume: 10 },
    { time: T0 + 360000, open: 111, high: 111, low: 110.5, close: 111, volume: 10 },
  ]
  const btTp = backtest(stubBars, { method: stubMethod([{ ...LONG_SETUP }]), params: {}, symbol: 'BTCUSDT', tf: '5', sub1m: subTp })
  check('D6 co 1m cham TP truoc -> doi thanh TP', btTp.trades[0].result === 'TP', `res=${btTp.trades[0].result}`)
  check('D6 co 1m phan giai duoc -> resolvedBy1m = true', btTp.trades[0].resolvedBy1m === true, String(btTp.trades[0].resolvedBy1m))
  check('D6 doi ket qua -> gia thoat cung doi theo (khong con la SL)', btTp.trades[0].exitPrice === 110, `exit=${btTp.trades[0].exitPrice}`)

  // Co 1m nhung 1m dau tien cham CA HAI -> van khong phan giai duoc -> SL
  const subBoth = [{ time: T0 + 300000, open: 100, high: 112, low: 94, close: 105, volume: 10 }]
  const btBoth = backtest(stubBars, { method: stubMethod([{ ...LONG_SETUP }]), params: {}, symbol: 'BTCUSDT', tf: '5', sub1m: subBoth })
  check('D6 1m cung vi pham vi -> van SL, resolvedBy1m = false', btBoth.trades[0].result === 'SL' && btBoth.trades[0].resolvedBy1m === false, `res=${btBoth.trades[0].result} r1m=${btBoth.trades[0].resolvedBy1m}`)

  // Co 1m nhung 1m dau tien chi cham SL -> van SL, nhung LON RO la da phan giai
  const subSl = [{ time: T0 + 300000, open: 100, high: 104, low: 94, close: 96, volume: 10 }]
  const btSl = backtest(stubBars, { method: stubMethod([{ ...LONG_SETUP }]), params: {}, symbol: 'BTCUSDT', tf: '5', sub1m: subSl })
  check('D6 1m cham SL truoc -> SL nhung resolvedBy1m = true (khac voi "doan")', btSl.trades[0].result === 'SL' && btSl.trades[0].resolvedBy1m === true, `res=${btSl.trades[0].result} r1m=${btSl.trades[0].resolvedBy1m}`)

  // Khong vi pham vi (bar 4 chi cham TP, khong cham SL) -> khong can 1m -> null
  const clear = { ...LONG_SETUP, doneBar: 4, result: 'TP' }
  const btClear = backtest(stubBars, { method: stubMethod([clear]), params: {}, symbol: 'BTCUSDT', tf: '5', sub1m: subTp })
  check('khong vi pham vi -> resolvedBy1m = null (khong can 1m)', btClear.trades[0].resolvedBy1m === null, String(btClear.trades[0].resolvedBy1m))
}

// --- bao ve: phai co method/symbol/tf, khong chay ngam ------------------------
{
  let e1 = null
  try { backtest(stubBars, { params: {}, symbol: 'BTCUSDT', tf: '5' }) } catch (e) { e1 = e.message }
  check('thieu method -> NEM LOI (khong suy ra mot phuong phap mac dinh)', e1 !== null && e1.includes('method'), String(e1))

  let e2 = null
  try { backtest(stubBars, { method: stubMethod([]), params: {}, tf: '5' }) } catch (e) { e2 = e.message }
  check('thieu symbol -> NEM LOI (Trade model bat buoc)', e2 !== null && e2.includes('symbol'), String(e2))

  let e3 = null
  try { backtest(stubBars, { method: stubMethod([]), params: {}, symbol: 'BTCUSDT' }) } catch (e) { e3 = e.message }
  check('thieu tf -> NEM LOI', e3 !== null && e3.includes('tf'), String(e3))

  let e4 = null
  try { backtest([], { method: stubMethod([]), params: {}, symbol: 'BTCUSDT', tf: '5' }) } catch (e) { e4 = e.message }
  check('bars rong -> NEM LOI', e4 !== null && e4.includes('bars rong'), String(e4))

  // Method khong tra ve du truong hop dong -> phai bao ro, khong crash sau do
  const broken = { id: 'broken', name: 'x', defaults: {}, analyze: () => ({ events: [] }) }
  let e5 = null
  try { backtest(stubBars, { method: broken, params: {}, symbol: 'BTCUSDT', tf: '5' }) } catch (e) { e5 = e.message }
  check('method thieu truong hop dong -> NEM LOI ro rang', e5 !== null && e5.includes('thieu truong'), String(e5))
}

// --- OPEN: het du lieu van con giu -> dem rieng, khong tinh WR ---------------
{
  const open = { bar: 0, dir: 1, entry: 100, sl: 95, tp: 110, risk: 5, filled: true, fillBar: 0 } // khong result, la setup cuoi
  const bt = backtest(stubBars, { method: stubMethod([open]), params: {}, symbol: 'BTCUSDT', tf: '5' })
  check('OPEN: sinh trade co result OPEN', bt.trades[0]?.result === 'OPEN', String(bt.trades[0]?.result))
  check('OPEN: khong co exit -> pnl = 0 (khong tinh la loi/lo)', bt.trades[0].pnlPct === 0 && bt.trades[0].exitPrice === null, `pnl=${bt.trades[0].pnlPct} exit=${bt.trades[0].exitPrice}`)
  check('OPEN: dem vao counters.open rieng', bt.counters.open === 1 && bt.counters.closed === 0, JSON.stringify(bt.counters))
  check('OPEN: barsHeld = so bar con lai', bt.trades[0].barsHeld === 4, `barsHeld=${bt.trades[0].barsHeld}`)
}

// --- PARITY: phi=0, slip=0, khong co 1m -> backtest PHAI trung ket qua method --
// Day la cam giu de "lech Pine <-> engine" (rui ro #1) khong am tham noi backtest:
// backtest khong duoc sua doi ket qua cua method, chi bo them chi phi va D6.
{
  const { closes, volumes } = svScenario()
  const c = [...closes]
  const v = [...volumes]
  c.push(96.7); v.push(600)   // bar 24: khop entry limit
  c.push(100.0); v.push(600)  // bar 25: cham TP
  c.push(96.6); v.push(600)   // bar 26: day them 1 bar de co setup noi/duoi
  const bars = mkBars(c, v)

  const levels = runVsa(bars, LOOSE).levels
  const bt = backtest(bars, { method: 'vsa', params: { ...LOOSE, feePct: 0, slipPct: 0 }, symbol: 'BTCUSDT', tf: '5' })

  const resolved = levels.filter((l) => l.filled && (l.result === 'TP' || l.result === 'SL'))
  const closedTrades = bt.trades.filter((t) => t.result === 'TP' || t.result === 'SL')

  check('parity: so lenh dong = so setup da khop co ket qua', closedTrades.length === resolved.length,
    `bt=${closedTrades.length} method=${resolved.length}`)
  check('parity: result trung het (khong lech qua backtest)',
    JSON.stringify(closedTrades.map((t) => t.result)) === JSON.stringify(resolved.map((l) => l.result)),
    JSON.stringify(closedTrades.map((t) => t.result)))
  check('parity: exitTime trung het voi doneBar',
    JSON.stringify(closedTrades.map((t) => t.exitTime.toISOString())) ===
    JSON.stringify(resolved.map((l) => new Date(bars[l.doneBar].time).toISOString())))
  check('parity: rMultiple la so huu han (fee=0 -> gross R)',
    closedTrades.every((t) => Number.isFinite(t.rMultiple)),
    JSON.stringify(closedTrades.map((t) => t.rMultiple)))
  check('parity: khong co 1m -> khong bao gio nhan resolvedBy1m = true',
    bt.trades.every((t) => t.resolvedBy1m !== true), JSON.stringify(bt.trades.map((t) => t.resolvedBy1m)))

  // D5 tren du lieu that: setup da khop nhung khong co ket qua -> phai bi DEM
  const noResultFilled = levels.filter((l) => l.filled && !(l.result === 'TP' || l.result === 'SL')).length
  check('parity: setup khop nhung khong ket qua = counters.replaced + open',
    bt.counters.replaced + bt.counters.open === noResultFilled,
    `${bt.counters.replaced}+${bt.counters.open} vs ${noResultFilled}`)
}

// =============================================================================
section('13. report.mjs — trung thuc: khong tinh lai, khong an counters')

{
  // Mot bo ket qua GIA co y: 2 lenh THANG, 1 lenh THUA, 1 OPEN, 2 setup khong
  // khop, 1 setup bi thay (D5). Neu report an counters di, PF/WR se dep nham.
  const bt = {
    method: 'vsa',
    variant: null,
    counters: { setups: 5, filled: 3, noFill: 2, closed: 3, open: 1, replaced: 1, dropped: 1 },
    trades: [
      { symbol: 'BTCUSDT', tf: '5', method: 'vsa', dir: 1, entryTime: new Date(0), entryPrice: 100, exitTime: new Date(60000), exitPrice: 110, sl: 95, tp: 110, result: 'TP', barsHeld: 2, pnlPct: 10, rMultiple: 2, resolvedBy1m: null },
      { symbol: 'BTCUSDT', tf: '5', method: 'vsa', dir: 1, entryTime: new Date(0), entryPrice: 100, exitTime: new Date(60000), exitPrice: 110, sl: 95, tp: 110, result: 'TP', barsHeld: 2, pnlPct: 8, rMultiple: 1.6, resolvedBy1m: null },
      { symbol: 'BTCUSDT', tf: '5', method: 'vsa', dir: -1, entryTime: new Date(0), entryPrice: 100, exitTime: new Date(60000), exitPrice: 105, sl: 105, tp: 90, result: 'SL', barsHeld: 1, pnlPct: -5, rMultiple: -1, resolvedBy1m: false },
      { symbol: 'BTCUSDT', tf: '5', method: 'vsa', dir: 1, entryTime: new Date(0), entryPrice: 100, exitTime: null, exitPrice: null, sl: 95, tp: 110, result: 'OPEN', barsHeld: 3, pnlPct: 0, rMultiple: 0, resolvedBy1m: null },
    ],
  }

  const s = summarizeBacktest(bt, { engineVersion: '9.9.9', paramsHash: 'hash-mau', params: {} })
  check('summarizeBacktest: chi dem cac lenh da dong (OPEN tach rieng)', s.trades === 3 && s.open === 1, `trades=${s.trades} open=${s.open}`)
  check('summarizeBacktest: counters duoc keo theo (khong mat noFill/replaced)', s.counters?.noFill === 2 && s.counters?.replaced === 1, JSON.stringify(s.counters))
  check('summarizeBacktest: winRate = 2/3 (khong tinh OPEN)', near(s.winRate, 2 / 3, 1e-12), String(s.winRate))
  check('summarizeBacktest: PF = 18/5', near(s.profitFactor, 18 / 5, 1e-12), String(s.profitFactor))
  check('summarizeBacktest: netPct = 10+8-5 = 13', near(s.netPct, 13, 1e-12), String(s.netPct))

  const out = formatSummary(s, { title: 'mau' })
  check('formatSummary: in winRate %', /winRate\s*:\s*66\.67%/.test(out), out.split('\n').find((l) => l.includes('winRate')))
  check('formatSummary: in PF 2 phan thap', /profitFactor\s*:\s*3\.60/.test(out), 'thieu PF')
  check('formatSummary: CO dong noFill (khong an)', /khop \/ khong khop\s*:\s*3 \/ 2/.test(out), out.split('\n').find((l) => l.includes('khong khop')))
  check('formatSummary: CO dong canh bao D5 (khong an replaced)', out.includes('1 setup da khop nhung khong co ket qua'), 'thieu canh bao D5')
  check('formatSummary: ghi ro dropped', /dropped=1/.test(out), 'thieu dropped')
  check('formatSummary: khong gianh cho variant khi variant = null', !out.includes('VARIANT'), out.split('\n')[1])

  // Variant -> phai ghi ro de bi loai khoi so sanh parity
  const vt = formatSummary({ ...s, variant: 'onReplace=ttl' }, { title: 'v' })
  check('formatSummary: variant -> ghi ro TEN variant', vt.includes('onReplace=ttl') && vt.includes('LOAI khoi so sanh parity'), vt.split('\n')[1])

  // PF vo han -> in "inf", khong phai so khong y nghia
  const inf = summarizeBacktest({ counters: { setups: 1, filled: 1, noFill: 0, closed: 1, open: 0, replaced: 0, dropped: 0 }, trades: [{ result: 'TP', pnlPct: 5, rMultiple: 1 }] })
  check('summarizeBacktest: khong co loi -> PF = Infinity', inf.profitFactor === Infinity, String(inf.profitFactor))
  check('formatSummary: PF Infinity in "inf"', /profitFactor\s*:\s*inf/.test(formatSummary(inf)), 'khong in inf')

  // toRunDoc: phai tu choi object khong phai ket qua backtest
  let e = null
  try { toRunDoc({ trades: 'khong phai mang' }) } catch (x) { e = x.message }
  check('toRunDoc: trades khong phai mang -> NEM LOI', e !== null, String(e))

  // --- median vs mean: mot lenh risk 0.003% cho R = 87 khong duoc keo ca bo ---
  // Day la loi that da gap tren du lieu BTCUSDT 15m that: avgRr = +0.15R (doc
  // nhu co loi) trong khi PF = 0.32, net = -16%. Median van -0.58R.
  const skewed = {
    counters: { setups: 5, filled: 5, noFill: 0, closed: 5, open: 0, replaced: 0, dropped: 0 },
    trades: [
      { result: 'SL', pnlPct: -2, rMultiple: -1, entryPrice: 100, sl: 102 },
      { result: 'SL', pnlPct: -2, rMultiple: -1, entryPrice: 100, sl: 102 },
      { result: 'SL', pnlPct: -2, rMultiple: -1, entryPrice: 100, sl: 102 },
      { result: 'SL', pnlPct: -2, rMultiple: -1, entryPrice: 100, sl: 102 },
      { result: 'TP', pnlPct: 0.25, rMultiple: 87, entryPrice: 83645.2, sl: 83642.79 },
    ],
  }
  const sk = summarizeBacktest(skewed, { engineVersion: 'x', paramsHash: 'y' })
  check('medianRr: binh quan R bi chiem boi outlier -> median van am', sk.medianRr === -1, `median=${sk.medianRr}`)
  check('medianRr: avgRr van la trung binh thuan (khong sua so cu)', near(sk.avgRr, (87 - 4) / 5, 1e-9), `avg=${sk.avgRr}`)
  check('medianRr: avg va median NGUOC DAU -> khong doc avg don duoc', sk.avgRr > 0 && sk.medianRr < 0, `avg=${sk.avgRr} med=${sk.medianRr}`)
  check('degenerateRisk: dem dung lenh co risk < 0.1% cua entry', sk.degenerateRisk === 1, `deg=${sk.degenerateRisk}`)
  check('degenerateRisk: cac lenh risk binh thuong khong bi dem', summarizeBacktest({
    counters: { setups: 1, filled: 1, noFill: 0, closed: 1, open: 0, replaced: 0, dropped: 0 },
    trades: [{ result: 'SL', pnlPct: -2, rMultiple: -1, entryPrice: 100, sl: 105 }],
  }).degenerateRisk === 0, 'nham voi lenh risk 5%')

  const skOut = formatSummary(sk, { title: 'skew' })
  check('formatSummary: in ca medianRr (khong chi avg)', /medianRr\s*:\s*-1\.00R/.test(skOut), skOut.split('\n').find((l) => l.includes('medianRr')))
  check('formatSummary: canh bao RO rang khi avg va median cung dau nguoc', skOut.includes('CUNG DAU NGUOC'), 'thieu canh bao')
  check('formatSummary: canh bao chi dan dung median de danh gia', skOut.includes('khong dung avgRr don bo'), 'thieu huong dan')
  check('formatSummary: canh bao so lenh risk qua nho', skOut.includes('1/5 lenh'), skOut.split('\n').find((l) => l.includes('0.1% cua entry')))
  check('formatSummary: KHONG canh bao khi avg va median cung dau', !formatSummary(summarizeBacktest(bt, { engineVersion: 'x', paramsHash: 'y' })).includes('CUNG DAU NGUOC'), 'canh bao sai cho truong hop on')

  const mx = formatMatrix([{ symbol: 'X', tf: '5', summary: sk }])
  check('formatMatrix: co cot medR', mx.split('\n')[0].includes('medR'), mx.split('\n')[0])
  check('formatMatrix: danh dau * khi avg/median nguoc dau', mx.split('\n')[1].includes('*'), mx.split('\n')[1])

  // Cot CSV phai dung voi Trade model - neu model doi ma cot khong doi, CSV se
  // mat truong ma khong ai de y.
  const tradeFields = Object.keys(Trade.schema.obj)
  const missing = TRADE_COLUMNS.filter((k) => !tradeFields.includes(k))
  check('TRADE_COLUMNS: moi cot deu ton tai trong Trade schema', missing.length === 0, `thieu: ${missing.join(', ')}`)
  check('TRADE_COLUMNS: khong thieu truong quan trong cua Trade',
    ['dir', 'entryTime', 'entryPrice', 'exitTime', 'exitPrice', 'result', 'pnlPct', 'rMultiple', 'resolvedBy1m'].every((k) => TRADE_COLUMNS.includes(k)),
    TRADE_COLUMNS.join(','))
}

// --- CSV: RFC4180, khong doan cot tu object dau tien -------------------------
{
  const cols = ['symbol', 'tf', 'pnlPct', 'note']
  const rows = [
    { symbol: 'BTCUSDT', tf: '5', pnlPct: 1.5, note: 'binh thuong' },
    { symbol: 'ETH,USDT', tf: '15', pnlPct: -2, note: 'co dau phay' },
    { symbol: 'XRPUSDT', tf: '1h', pnlPct: 0, note: 'co "xuong kep"' },
  ]
  const csv = toCsv(rows, cols)
  check('toCsv: dong header dung thu tu (khong doan)', csv.startsWith('symbol,tf,pnlPct,note'), csv.split('\r\n')[0])
  check('toCsv: dong binh thuong khong bi boc khong can', csv.includes('BTCUSDT,5,1.5,binh thuong'), csv)
  check('toCsv: dau phay -> boc trong ""', csv.includes('"ETH,USDT"'), csv)
  check('toCsv: ky tu " -> nhan doi ""', csv.includes('"co ""xuong kep"""'), csv)
  check('toCsv: null/undefined -> o rong, khong in "null"', csv.includes('XRPUSDT,1h,0,'), csv.split('\r\n')[3])

  let e = null
  try { toCsv([], []) } catch (x) { e = x.message }
  check('toCsv: thieu columns -> NEM LOI', e !== null, String(e))

  // Trade model co Date -> CSV phai ra ISO Z (D2), khong ra "[object Date]"
  const t = toCsv([{ t: new Date('2026-01-05T00:00:00Z') }], ['t'])
  check('toCsv: Date -> ISO-8601 Z', t.includes('2026-01-05T00:00:00.000Z'), t)
  check('toCsv: khong in "[object Date]"', !t.includes('[object Date]'), t)
}

// --- matrix symbol x TF + summaryRow (acceptance Phase 4) --------------------
{
  const mk = (over = {}) => summarizeBacktest({
    method: 'vsa',
    trades: [
      { result: 'TP', pnlPct: 4, rMultiple: 1, entryPrice: 100, exitPrice: 104, barsHeld: 1 },
      { result: 'TP', pnlPct: 4, rMultiple: 1, entryPrice: 100, exitPrice: 104, barsHeld: 1 },
      { result: 'SL', pnlPct: -2, rMultiple: -0.5, entryPrice: 100, exitPrice: 98, barsHeld: 1 },
    ],
    counters: { setups: 4, filled: 3, noFill: 1, closed: 3, open: 0, replaced: 0, dropped: 0 },
    ...over,
  }, { engineVersion: '0.5.0', paramsHash: 'h1' })
  const rows = [
    { symbol: 'BTCUSDT.P', tf: '5', summary: mk() },
    { symbol: 'BTCUSDT.P', tf: '15', summary: mk() },
    { symbol: 'ETHUSDT.P', tf: '5', summary: mk() },
  ]
  const m = formatMatrix(rows)
  check('formatMatrix: co header symbol/tf/trades', m.split('\n')[0].includes('symbol') && m.split('\n')[0].includes('trades'), m.split('\n')[0])
  check('formatMatrix: so dong = header + rows', m.split('\n').length === 4, String(m.split('\n').length))
  check('formatMatrix: co cot noFill + replaced (khong an counters)', m.split('\n')[0].includes('noFill') && m.split('\n')[0].includes('replaced'), m.split('\n')[0])

  const sr = summaryRow('BTCUSDT.P', '5', mk())
  check('summaryRow: dua day du cot de toCsv', SUMMARY_COLUMNS.every((k) => k in sr), JSON.stringify(Object.keys(sr)))
  const csv = toCsv([sr], SUMMARY_COLUMNS)
  // Chi `variant` duoc phep rong (chi co gia tri khi chay bien the D5 ttl)
  const cells = csv.split('\r\n')[1].split(',')
  check('summaryRow -> toCsv: chi cot `variant` duoc phep rong',
    cells.slice(0, SUMMARY_COLUMNS.length - 1).every((v) => v !== ''),
    csv.split('\r\n')[1])
  check('summaryRow: cot cuoi la variant va rong khi khong phai variant', cells[cells.length - 1] === '', JSON.stringify(cells[cells.length - 1]))
  check('summaryRow: winRate la %, khong phai ti le', sr.winRate > 1, String(sr.winRate))
}

// =============================================================================
section('14. data.mjs — phan trang, cache, resample 1m→4m/10m, D11 universe')

{
  // --- klineToBar: bao ve moi quan he O/H/L/C, khong nhan gia tri hong -------
  const ok = klineToBar(['1767590400000', '100', '110', '95', '105', '1234.5'])
  check('klineToBar: doc dung 6 cot', ok.time === 1767590400000 && ok.open === 100 && ok.high === 110 && ok.low === 95 && ok.close === 105 && ok.volume === 1234.5, JSON.stringify(ok))

  let e = null
  try { klineToBar(['1767590400000', '100', '90', '110', '105', '10']) } catch (x) { e = x }
  check('klineToBar: high < low -> NEM LOI (khong chay tiep voi du lieu sai)', e instanceof DataError && e.message.includes('O/H/L/C'), String(e?.message))

  let e2 = null
  try { klineToBar(['1', 'x', '1', '1', '1', '1']) } catch (x) { e2 = x }
  check('klineToBar: so khong huu han -> NEM LOI', e2 instanceof DataError, String(e2?.message))

  let e3 = null
  try { klineToBar(['1', '100']) } catch (x) { e3 = x }
  check('klineToBar: thieu cot -> NEM LOI', e3 instanceof DataError, String(e3?.message))

  // --- takerBuy (cot 9) cho method orderflow — Phase 10 ---
  const tb = klineToBar(['1767590400000', '100', '110', '95', '105', '1234.5', '1767590399999', '5000', '100', '320', '200', '1767590399999'])
  check('klineToBar: 12 cot -> giu takerBuy (cot 9)', tb.takerBuy === 320 && tb.volume === 1234.5, JSON.stringify(tb))
  const tb6 = klineToBar(['1767590400000', '100', '110', '95', '105', '1234.5'])
  check('klineToBar: 6 cot -> khong append takerBuy undefined', !('takerBuy' in tb6), JSON.stringify(tb6))

  // resample: takerBuy cong nhu volume (4m/10m van doc duoc delta)
  const R0 = 1767590400000 // chia het cho 240000 (4m) — khong bi lo phan
  const src = [0, 1, 2, 3].map((i) => ({ time: R0 + i * 60000, open: 1, high: 2, low: 0, close: 1, volume: 10, takerBuy: i }))
  const rs = resample(src, 240000, 60000)
  check('resample: takerBuy cong theo bucket', rs.length === 1 && rs[0].takerBuy === 0 + 1 + 2 + 3, JSON.stringify(rs))
  const srcNo = src.map((b) => { const { takerBuy, ...rest } = b; return rest })
  const rsNo = resample(srcNo, 240000, 60000)
  check('resample: bar goc khong co takerBuy -> output khong co', !('takerBuy' in rsNo[0]), JSON.stringify(rsNo[0]))
}

// --- fetchKlines: phan trang + cache, OFFLINE bang fetchImpl -----------------
{
  const tmp = mkdtempSync(join(tmpdir(), 'tm-data-'))
  const T = Date.UTC(2026, 0, 5, 0, 0, 0)

  // Phan trang: server CAP toi da 3 bar/trang (mo phong Binance 1500) va trang
  // sau lap 1 bar cuoi. Fake phai cap, khong thi khong co gi de phan trang.
  const CAP = 3
  const mkPage = (bars) => bars.map((b) => [String(b.time), String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume)])
  const all = Array.from({ length: 6 }, (_, i) => ({ time: T + i * 60000, open: 100, high: 101, low: 99, close: 100, volume: 10 }))
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(url)
    const u = new URL(url)
    const end = u.searchParams.has('endTime') ? Number(u.searchParams.get('endTime')) : Infinity
    const lim = Math.min(Number(u.searchParams.get('limit')), CAP)
    const inRange = all.filter((b) => b.time <= end).sort((a, b) => b.time - a.time).slice(0, lim)
    return mkPage(inRange.sort((a, b) => a.time - b.time))
  }

  const doc = await fetchKlines({ symbol: 'BTCUSDT', tf: '1', market: 'fapi', dataDir: tmp, limit: 6, refresh: true, fetchImpl: fakeFetch })
  check('fetchKlines: lay du 6 bar', doc.bars.length === 6, `bars=${doc.bars.length}`)
  check('fetchKlines: sap xep tang dan theo time', doc.bars.every((b, i, a) => i === 0 || a[i - 1].time < b.time), JSON.stringify(doc.bars.map((b) => b.time)))
  check('fetchKlines: khong trung bar giua 2 trang', new Set(doc.bars.map((b) => b.time)).size === 6, `unique=${new Set(doc.bars.map((b) => b.time)).size}`)
  check('fetchKlines: da goi API hon 1 lan (co phan trang)', calls.length > 1, `calls=${calls.length}`)
  check('fetchKlines: lan 2 co endTime (phan trang ve truoc)', new URL(calls[1]).searchParams.has('endTime'), calls[1])
  check('fetchKlines: ghi nhan source + fetchedAt + market', doc.source.includes('fapi.binance.com') && !!doc.fetchedAt && doc.market === 'fapi', `${doc.source} ${doc.market}`)
  check('fetchKlines: lan 1 khong doc tu cache (fromCache=false)', doc.fromCache === false, String(doc.fromCache))

  // Cache: lan sau khong goi API nua
  const callsBefore = calls.length
  const cached = await fetchKlines({ symbol: 'BTCUSDT', tf: '1', market: 'fapi', dataDir: tmp, limit: 6, fetchImpl: async () => { throw new Error('khong duoc goi API khi co cache') } })
  check('fetchKlines: co cache -> khong goi API (fetchImpl se nem loi neu bi goi)', cached.fromCache === true && cached.bars.length === 6, `fromCache=${cached.fromCache}`)
  check('fetchKlines: so luot goi API khong tang', calls.length === callsBefore, `${callsBefore} -> ${calls.length}`)

  // Chi so van dung la FAI (khong phai spot)
  const c2 = await fetchKlines({ symbol: 'BTCUSDT', tf: '5', market: 'spot', dataDir: tmp, refresh: true, fetchImpl: async (u) => (calls.push(u), mkPage([all[0]])) })
  check('fetchKlines: market=spot -> /api/v3/klines', c2.source.includes('/api/v3/klines'), c2.source)

  // Binance loi -> DataError ro rang, khong doc thanh bar
  let en = null
  try {
    await fetchKlines({ symbol: 'NOPE', tf: '1', market: 'fapi', dataDir: tmp, refresh: true, fetchImpl: async () => ({ code: -1121, msg: 'Invalid symbol.' }) })
  } catch (x) { en = x }
  check('Binance tra {code,msg} -> NEM LOI ro rang', en instanceof DataError && en.message.includes('-1121'), String(en?.message))

  // unsupported timeframe -> throw before API call (resample required)
  let etf = null
  try { await fetchKlines({ symbol: 'BTCUSDT', tf: '4', market: 'fapi', dataDir: tmp, refresh: true, fetchImpl: fakeFetch }) } catch (x) { etf = x }
  check('tf=4 khong co trong interval map -> NEM LOI (phai resample tu 1m)', etf instanceof DataError && etf.message.includes('tf khong ho tro'), String(etf?.message))

  let em = null
  try { await fetchKlines({ symbol: 'BTCUSDT', tf: '1', market: 'binance', dataDir: tmp }) } catch (x) { em = x }
  check('market khong ro -> NEM LOI', em instanceof DataError && em.message.includes('market khong ho tro'), String(em?.message))

  rmSync(tmp, { recursive: true, force: true })
}

// --- resample 1m -> 4m/10m (Binance khong co 4m/10m) ------------------------
{
  const T = Date.UTC(2026, 0, 5, 0, 0, 0)
  const mk = (i, o, h, l, c, v) => ({ time: T + i * 60000, open: o, high: h, low: l, close: c, volume: v })
  const src = [
    mk(0, 100, 103, 99, 102, 10),   // 00:00
    mk(1, 102, 105, 101, 104, 20),  // 00:01
    mk(2, 104, 106, 98, 99, 30),    // 00:02  -> low 98 = low cua o
    mk(3, 99, 101, 97, 100, 40),    // 00:03  -> close 100 = close cua o
    mk(4, 100, 110, 96, 109, 50),   // 00:04
    mk(5, 109, 112, 108, 111, 60),  // 00:05
    mk(6, 111, 113, 110, 112, 70),  // 00:06
    mk(7, 112, 114, 111, 113, 80),  // 00:07
  ]

  const r4 = resample(src, 240000)
  check('resample 4m: so o = so bar goc / 4', r4.length === 2, `got ${r4.length}`)
  check('resample 4m: time lech tren lo 4m', r4.every((b) => b.time % 240000 === 0), JSON.stringify(r4.map((b) => b.time)))
  check('resample 4m: O = open bar dau', r4[0].open === 100, `open=${r4[0].open}`)
  check('resample 4m: H = max, khong phai close bar cuoi', r4[0].high === 106, `high=${r4[0].high}`)
  check('resample 4m: L = min cac low trong o (97 tu 00:03, khong phai 99 cua bar dau)', r4[0].low === 97, `low=${r4[0].low}`)
  check('resample 4m: C = close bar cuoi', r4[0].close === 100, `close=${r4[0].close}`)
  check('resample 4m: volume = TONG (khong phai binh quan)', r4[0].volume === 100, `vol=${r4[0].volume}`)
  check('resample 4m: o thu 2 = 4 bar cuoi', r4[1].open === 100 && r4[1].high === 114 && r4[1].low === 96 && r4[1].close === 113 && r4[1].volume === 260, JSON.stringify(r4[1]))

  const r10 = resample(src, 600000)
  check('resample 10m: 8 bar 1m -> 1 o (8 phut < 10 phut)', r10.length === 1, `got ${r10.length}`)
  check('resample 10m: gop het vao 1 o', r10[0].open === 100 && r10[0].high === 114 && r10[0].low === 96 && r10[0].close === 113 && r10[0].volume === 360, JSON.stringify(r10[0]))

  // CHONG LECH NHAN: target khong chia het cho bar goc -> phai nem, khong im lang
  let e = null
  try { resample(src, 90000) } catch (x) { e = x }
  check('resample: targetMs khong chia het cho src -> NEM LOI (lech nhan)', e instanceof DataError && e.message.includes('chia het'), String(e?.message))

  let e2 = null
  try { resample(src, 30000) } catch (x) { e2 = x }
  check('resample: target < src -> NEM LOI', e2 instanceof DataError, String(e2?.message))

  // Bar khong lech tren lo -> du lieu lech (khong phai lech do rounding)
  const skewed = [...src, { time: T + 8 * 60000 + 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]
  let e3 = null
  try { resample(skewed, 240000) } catch (x) { e3 = x }
  check('resample: bar lech lo -> NEM LOI (khong gop im bar lech)', e3 instanceof DataError && e3.message.includes('lech'), String(e3?.message))

  check('resample: mang rong -> tra rong, khong nem', resample([], 240000).length === 0)
  check('resample: khong suy duoc srcMs -> NEM LOI', (() => { try { resample([src[0]], 240000); return false } catch { return true } })())
}

// --- D11 — universe snapshot -------------------------------------------------
{
  const snap = universeSnapshot({
    market: 'fapi',
    minHistoryBars: 100,
    minTrades: 10,
    entries: [
      { symbol: 'BTCUSDT.P', bars: 5000, trades: 40 },
      { symbol: 'ETHUSDT.P', bars: 4000, trades: 35 },
      { symbol: 'NEWCOINUSDT.P', bars: 20, trades: 5 },   // qua moi -> loai
      { symbol: 'THINUSDT.P', bars: 3000, trades: 3 },    // it lenh qua -> loai
    ],
  })

  check('universe: chot duoc ngay lay + nguon + market', !!snap.fetchedAt && snap.source.includes('fapi.binance.com') && snap.market === 'fapi', `${snap.fetchedAt} ${snap.source}`)
  check('universe: dem dung tong / included / excluded', snap.total === 4 && snap.included === 2 && snap.excludedCount === 2, `t=${snap.total} i=${snap.included} e=${snap.excludedCount}`)
  check('universe: token MOI bi loai bo min-history', snap.symbols.find((s) => s.symbol === 'NEWCOINUSDT.P').excluded === true, JSON.stringify(snap.symbols[2]))
  check('universe: ly do loai co so cu the (khong chi ghi "loai")', (snap.symbols[2].reason ?? '').includes('20 bar') && (snap.symbols[2].reason ?? '').includes('min 100'), snap.symbols[2].reason)
  check('universe: so lenh qua it cung bi loai', snap.symbols.find((s) => s.symbol === 'THINUSDT.P').excluded === true, snap.symbols[3].reason)
  check('universe: dong tot van con, khong bi loai nham', snap.symbols.find((s) => s.symbol === 'BTCUSDT.P').excluded === false, String(snap.symbols[0].excluded))
  check('universe: DANH SACH BI LOAI VAN DUOC LUU (D11 - khong bo di)', snap.symbols.length === 4, `len=${snap.symbols.length}`)
  check('universe: ghi ro survivorship bias = true', snap.survivorshipBias === true, String(snap.survivorshipBias))
  check('universe: note co noi dung canh bao delisted', snap.survivorshipNote.includes('delisted'), snap.survivorshipNote.slice(0, 60))

  let e = null
  try { universeSnapshot({ entries: [] }) } catch (x) { e = x }
  check('universe: entries rong -> NEM LOI (khong chot cai trong)', e instanceof DataError && e.message.includes('rong'), String(e?.message))

  // Khong loc -> van co the khong loai ai, nhung survivorshipBias van = true
  const noFilter = universeSnapshot({ entries: [{ symbol: 'A', bars: 1, trades: 1 }] })
  check('universe: khong dat min van chot duoc, khong loai dong nao', noFilter.excludedCount === 0 && noFilter.included === 1, JSON.stringify(noFilter.symbols))
}

// =============================================================================
section('15. run.mjs — CLI helper (parse argv, chuan hoa symbol/tf, preset)')

{
  // parseArgs: --flag (khong gia tri), --key val, --key=val, van tu
  const a = parseArgs(['--symbols', 'BTCUSDT.P,ETHUSDT.P', '--tfs=5m,15m', '--refresh', 'positional'])
  check('parseArgs: --key val', a.symbols === 'BTCUSDT.P,ETHUSDT.P', String(a.symbols))
  check('parseArgs: --key=val', a.tfs === '5m,15m', String(a.tfs))
  check('parseArgs: flag boolean khong an tuong lai sau no', a.refresh === true && a._.includes('positional'), JSON.stringify(a))
  check('parseArgs: flag cuoi khong "an" mot flag sau do', parseArgs(['--a', '--b']).a === true && parseArgs(['--a', '--b']).b === true)
  check('parseArgs: so am bi doc la gia tri, khong phai flag', parseArgs(['--limit', '-5']).limit === '-5', String(parseArgs(['--limit', '-5']).limit))

  // normalizeSymbol: fapi khong can .P trong lenh, nhung hien thi thi CAN
  const fs = normalizeSymbol('BTCUSDT.P', 'fapi')
  check('normalizeSymbol: bo .P khi dien lenh (fapi khong can)', fs.api === 'BTCUSDT', String(fs.api))
  check('normalizeSymbol: giu .P o ten hien thi (dung kieu giac TradingView)', fs.display === 'BTCUSDT.P', String(fs.display))
  const noSuffix = normalizeSymbol('BTCUSDT', 'fapi')
  check('normalizeSymbol: tu them .P neu nguoi goi khong dua', noSuffix.display === 'BTCUSDT.P', String(noSuffix.display))
  const spot = normalizeSymbol('BTCUSDT.P', 'spot')
  check('normalizeSymbol: spot khong them suffix', spot.display === 'BTCUSDT', String(spot.display))
  check('normalizeSymbol: chuan hoa chu thuong/thuong', normalizeSymbol('  ethusdt ', 'spot').api === 'ETHUSDT', 'khong trim/toUpperCase')
  let es = null
  try { normalizeSymbol('   ', 'fapi') } catch (x) { es = x }
  check('normalizeSymbol: rong -> NEM LOI', es instanceof DataError, String(es?.message))
  let es2 = null
  try { normalizeSymbol('.P', 'fapi') } catch (x) { es2 = x }
  check('normalizeSymbol: chi co suffix -> NEM LOI (khong truyen rong lenh)', es2 instanceof DataError, String(es2?.message))

  // normalizeTf: '5m'/'5'/'1h'/'60'/'D'
  check('normalizeTf: 5m -> 5', normalizeTf('5m') === '5', normalizeTf('5m'))
  check('normalizeTf: 15m -> 15', normalizeTf('15m') === '15', normalizeTf('15m'))
  check('normalizeTf: 1h -> 60', normalizeTf('1h') === '60', normalizeTf('1h'))
  check('normalizeTf: 4h -> 240', normalizeTf('4h') === '240', normalizeTf('4h'))
  check('normalizeTf: so thuan (khong don vi) van dung', normalizeTf('60') === '60', normalizeTf('60'))
  check('normalizeTf: D -> D', normalizeTf('D') === 'D', normalizeTf('D'))
  check('normalizeTf: 4m -> 4 (khung resample, khong bi tu choi)', normalizeTf('4m') === '4', normalizeTf('4m'))
  check('normalizeTf: 10m -> 10 (khung resample)', normalizeTf('10m') === '10', normalizeTf('10m'))
  let et = null
  try { normalizeTf('7m') } catch (x) { et = x }
  check('normalizeTf: khung khong ton tai -> NEM LOI va LIET KE khung co san', et instanceof DataError && et.message.includes('khung co san'), String(et?.message))
  // 2h THUC SU co (TF_MS['120']) - khong duoc tu choi. Can phai la khung khong
  // co that thi moi loi, de khong nham la "2h khong ho tro".
  check('normalizeTf: 2h -> 120 (co that, khong bi tu choi)', normalizeTf('2h') === '120', normalizeTf('2h'))
  let et2 = null
  try { normalizeTf('7h') } catch (x) { et2 = x }
  check('normalizeTf: 7h khong co -> NEM LOI (khong sua thanh 60m ngam)', et2 instanceof DataError, String(et2?.message))

  // buildParams: preset + --params JSON
  check('buildParams: khong preset -> object rong (dung DEFAULTS)', Object.keys(buildParams({})).length === 0)
  check('buildParams: preset legacy-limit', JSON.stringify(buildParams({ preset: 'legacy-limit' })) === '{"entryMode":"limit","tpMode":"pivot"}', JSON.stringify(buildParams({ preset: 'legacy-limit' })))
  check('buildParams: --params JSON ghi de len preset', buildParams({ preset: 'legacy-limit', paramsJson: '{"entryMode":"market"}' }).entryMode === 'market')
  check('buildParams: --params giu cac key khac cua preset', buildParams({ preset: 'legacy-limit', paramsJson: '{"entryMode":"market"}' }).tpMode === 'pivot')
  let ep = null
  try { buildParams({ preset: 'khong-co' }) } catch (x) { ep = x }
  check('buildParams: preset khong ro -> NEM LOI va LIET KE preset', ep instanceof DataError && ep.message.includes('default') && ep.message.includes('legacy-limit'), String(ep?.message))
  let ep2 = null
  try { buildParams({ paramsJson: '{khong phai json}' }) } catch (x) { ep2 = x }
  check('buildParams: --params hong JSON -> NEM LOI ro rang', ep2 instanceof DataError && ep2.message.includes('JSON'), String(ep2?.message))
  let ep3 = null
  try { buildParams({ paramsJson: '[1,2]' }) } catch (x) { ep3 = x }
  check('buildParams: --params la mang -> NEM LOI (phai object)', ep3 instanceof DataError, String(ep3?.message))
}

// =============================================================================
section('16. Phase 10 — methods moi (price-action/trend/orderflow) + simulate')

{
  // --- hop dong plugin cho 3 method moi ---
  for (const [id, m] of [['price-action', paMethod], ['trend', trendMethod], ['orderflow', ofMethod]]) {
    check(`${id}: id khop`, m.id === id, String(m.id))
    const ve = validateMethod(m)
    check(`${id}: validateMethod = []`, Array.isArray(ve) && ve.length === 0, JSON.stringify(ve))
    check(`${id}: listMethods chua id`, listMethods().includes(id), JSON.stringify(listMethods()))
    check(`${id}: defaults co feePct/slipPct (backtest tinh phi/slippage tu day)`,
      Number.isFinite(m.defaults.feePct) && Number.isFinite(m.defaults.slipPct),
      JSON.stringify({ fee: m.defaults.feePct, slip: m.defaults.slipPct }))
  }

  // EVENT_SCORE: LONG/BULL phai duong, nguoc lai am — doi cay nay = doi ket qua
  const chkMap = (name, map) => {
    const vals = Object.entries(map)
    check(`${name}: EVENT_SCORE gia tri [-1,1]`, vals.every(([, v]) => v >= -1 && v <= 1), JSON.stringify(map))
    check(`${name}: LONG/BULL > 0, con lai < 0`,
      vals.every(([k, v]) => (k.includes('LONG') || k.includes('BULL')) ? v > 0 : v < 0), JSON.stringify(map))
  }
  chkMap('price-action', PA_SCORE)
  chkMap('trend', TREND_SCORE)
  chkMap('orderflow', OF_SCORE)

  // Fixture deterministic: xuong ~100 bar -> len manh (tao trend + BOS),
  // volume/takerBuy co cot lon dinh ky (delta spike + div).
  const mk10 = () => {
    const out = []
    let price = 100
    for (let i = 0; i < 200; i++) {
      const drift = i < 100 ? -0.4 : 0.6
      const open = price
      price = price + drift + Math.sin(i / 3) * 0.8
      const close = price
      const high = Math.max(open, close) + 0.6
      const low = Math.min(open, close) - 0.6
      const volume = 50 + (i % 17 === 0 ? 150 : 0) + i * 0.2
      const takerBuy = volume * (i % 7 === 0 ? 0.85 : 0.5)
      out.push({ time: 1700000000000 + i * 3600000, open, high, low, close, volume, takerBuy })
    }
    return out
  }
  const bars10 = mk10()

  for (const id of ['price-action', 'trend', 'orderflow']) {
    const an = getMethod(id).analyze(bars10)
    check(`${id}: analyze du 3 truong bat buoc`, ['events', 'scores', 'setups'].every((k) => an[k] !== undefined))
    check(`${id}: scores dai bang bars.length`, an.scores.length === bars10.length, `${an.scores.length} vs ${bars10.length}`)
    check(`${id}: scores nam trong [-1,1]`, an.scores.every((s) => s >= -1 && s <= 1))
    check(`${id}: co it nhat 1 diem khac 0`, an.scores.some((s) => s !== 0), 'scores toan 0')
    check(`${id}: co it nhat 1 su kien`, an.events.length > 0, 'events = 0')
    check(`${id}: setups hop le (dir 1/-1, risk > 0, tp finite)`,
      an.setups.every((s) => (s.dir === 1 || s.dir === -1) && s.risk > 0 && Number.isFinite(s.tp)),
      JSON.stringify(an.setups[0]))
    check(`${id}: params merge DEFAULTS (feePct con lai)`, Number.isFinite(an.params.feePct) && Number.isFinite(an.params.slipPct), '')

    // backtest e2e — phai chay duoc toan pipeline nhu vsa
    let bt = null
    let bErr = null
    try { bt = backtest(bars10, { method: id, symbol: 'TESTUSDT.P', tf: '60' }) } catch (e) { bErr = e }
    check(`${id}: backtest() khong throw`, bt != null, String(bErr && bErr.message))
    if (bt) {
      check(`${id}: backtest method id khop`, bt.method === id, String(bt.method))
      check(`${id}: backtest co counters`, bt.counters != null && Number.isFinite(bt.counters.closed), JSON.stringify(bt.counters))
      check(`${id}: trades dung shape Trade`, bt.trades.every((t) => t.method === id && Number.isFinite(t.entryPrice)
        && (t.result === 'OPEN' || (Number.isFinite(t.exitPrice) && Number.isFinite(t.pnlPct)))), JSON.stringify(bt.trades[0]))
      let sm = null
      let sErr = null
      try { sm = summarizeBacktest({ ...bt }, { params: bt.params }) } catch (e) { sErr = e }
      check(`${id}: summarizeBacktest chay duoc`, sm != null && typeof sm.trades === 'number', String(sErr && sErr.message))
    }
  }

  // --- unit simulateSetups: NGHIA giong VSA (xem simulate.mjs) ---
  const B = (h, l, c) => ({ time: 0, open: c, high: h, low: l, close: c, volume: 1 })

  // market: fill ngay bar phat, xet TP/SL tu bar sau, SL truoc TP cung bar
  const s1 = simulateSetups(
    [B(101, 99, 100), B(102, 96, 100), B(111, 94, 105)],
    [{ bar: 0, dir: 1, entry: 100, sl: 95, tp: 110 }],
  )
  check('sim: market filled tai bar phat (fillBar = 0)', s1[0].filled === true && s1[0].fillBar === 0, JSON.stringify(s1[0]))
  // bar cuoi: low 94 <= SL 95 VA high 111 >= TP 110 cung bar -> SL thang
  check('sim: cung bar cham SL + TP -> SL (bao thu, D6 phan giai sub1m)', s1[0].result === 'SL' && s1[0].doneBar === 2, JSON.stringify(s1[0]))

  // limit: khong fill bar phat, cham moi fill, fill xong xet exit NGAY bar do
  const s2 = simulateSetups(
    [B(101, 99, 100), B(102, 97, 99), B(100, 94, 97)],
    [{ bar: 0, dir: 1, entry: 98, sl: 95, tp: 110, entryType: 'limit' }],
  )
  check('sim: limit fillBar = 1 (khong fill bar phat)', s2[0].fillBar === 1, JSON.stringify(s2[0]))
  check('sim: limit cham SL sau do 1 bar', s2[0].result === 'SL' && s2[0].doneBar === 2, JSON.stringify(s2[0]))

  // D5: setup moi thay setup cu con mo -> setup cu khong co result (backtest dem replaced)
  const s3 = simulateSetups(
    [B(101, 99, 100), B(102, 96, 100), B(100, 94, 97)],
    [
      { bar: 0, dir: 1, entry: 100, sl: 95, tp: 110 },
      { bar: 2, dir: -1, entry: 97, sl: 102, tp: 87 },
    ],
  )
  check('sim: setup cu bi thay -> khong result (D5)', s3[0].result === undefined, JSON.stringify(s3[0]))
  check('sim: setup moi la active moi', s3[1].filled === true && s3[1].result === undefined, JSON.stringify(s3[1]))

  // risk <= 0 -> bo qua (khong gianh setup cho lenh khong tinh duoc R)
  const s4 = simulateSetups([B(101, 99, 100)], [{ bar: 0, dir: 1, entry: 100, sl: 100, tp: 110 }])
  check('sim: risk <= 0 -> bo qua signal', s4.length === 0, JSON.stringify(s4))

  // setup cuoi du lieu con mo -> khong gan result (backtest in OPEN)
  const s5 = simulateSetups(
    [B(101, 99, 100), B(102, 100, 101)],
    [{ bar: 1, dir: 1, entry: 101, sl: 96, tp: 120 }],
  )
  check('sim: setup cuoi du lieu -> khong result (OPEN cho backtest)', s5[0].result === undefined && s5[0].filled === true, JSON.stringify(s5[0]))

  // replaceActive: false (3 method Phase 10) — con lenh thi BO QUA signal moi,
  // khong thay (khong dem replaced, khong adverse-select cuoi chuoi)
  const s6 = simulateSetups(
    [B(101, 99, 100), B(102, 99, 101), B(103, 100, 102), B(104, 94, 99)],
    [
      { bar: 0, dir: 1, entry: 100, sl: 95, tp: 110 },
      { bar: 1, dir: 1, entry: 101, sl: 96, tp: 111 },
      { bar: 2, dir: 1, entry: 102, sl: 97, tp: 112 },
    ],
    { replaceActive: false },
  )
  check('sim replace=false: chi setup dau tien duoc ghi nhan', s6.length === 1, JSON.stringify(s6))
  check('sim replace=false: setup dau tien van bi dong binh thuong (SL bar 3)', s6[0].result === 'SL' && s6[0].doneBar === 3, JSON.stringify(s6[0]))
  const s7 = simulateSetups(
    [B(101, 99, 100), B(102, 94, 95), B(103, 100, 102)],
    [
      { bar: 0, dir: 1, entry: 100, sl: 95, tp: 110 },
      { bar: 2, dir: -1, entry: 101, sl: 106, tp: 91 },
    ],
    { replaceActive: false },
  )
  check('sim replace=false: signal sau khi setup dong van nhan (vi khong con lenh)', s7.length === 2 && s7[1].result === undefined, JSON.stringify(s7))
}

section('17. Phase 11 — method sweep (quet thanh khoan + volume VSA)')

{
  check('sweep: id khop', sweepMethod.id === 'sweep', String(sweepMethod.id))
  check('sweep: validateMethod = []', validateMethod(sweepMethod).length === 0, JSON.stringify(validateMethod(sweepMethod)))
  check('sweep: listMethods chua sweep', listMethods().includes('sweep'), JSON.stringify(listMethods()))
  check('sweep: EVENT_SCORE LONG > 0, SHORT < 0', SWEEP_SCORE['SWEEP LONG'] > 0 && SWEEP_SCORE['SWEEP SHORT'] < 0, JSON.stringify(SWEEP_SCORE))
  check('sweep: defaults co feePct/slipPct + knobs toi uu',
    Number.isFinite(sweepMethod.defaults.feePct) && Number.isFinite(sweepMethod.defaults.slipPct) &&
    ['entryMode', 'retestBars', 'volRetestMax', 'confirmBars', 'trendFast', 'trendSlow', 'minRR', 'slMinAtr', 'slMaxAtr', 'minTouches'].every((k) => sweepMethod.defaults[k] !== undefined))

  // Fixture: pivot high 110 tai bar 8; bar 20 quet len (high 112) nhung close 105.5 < 110, volume no.
  const mkSweep = () => {
    const out = []
    for (let i = 0; i < 40; i++) {
      let o = 100, h = 101, l = 99, c = 100
      if (i === 8) { o = 105; h = 110; l = 104; c = 106 }
      else if (i > 8 && i < 20) { o = 104; h = 107; l = 102; c = 105 }
      else if (i === 20) { o = 106; h = 112; l = 105; c = 105.5 }
      else if (i === 23) { o = 106; h = 111; l = 104; c = 106 }
      else if (i > 20) { o = 105.5; h = 106.5; l = 104; c = 105 }
      const volume = i === 20 ? 100 : 10
      out.push({ time: 1700000000000 + i * 3600000, open: o, high: h, low: l, close: c, volume })
    }
    return out
  }
  const bars = mkSweep()
  const base = { pivLen: 2, lvlFresh: 100, entryMode: 'market', trendFast: 0, trendSlow: 0, minRR: 0, slMinAtr: 0, slMaxAtr: 9999, volSweepMin: 1.2, wickRatio: 0.5, atrLen: 2 }

  const an = sweepMethod.analyze(bars, base)
  check('sweep: analyze du 3 truong bat buoc', ['events', 'scores', 'setups'].every((k) => an[k] !== undefined))
  check('sweep: scores dai bang bars.length', an.scores.length === bars.length, `${an.scores.length} vs ${bars.length}`)
  check('sweep: scores nam trong [-1,1]', an.scores.every((s) => s >= -1 && s <= 1))
  check('sweep: phat hien quet len -> SWEEP SHORT', an.events.some((e) => e.type === 'SWEEP SHORT'), JSON.stringify(an.events))
  check('sweep: co setup hop le (dir/risk/tp)', an.setups.length >= 1 && an.setups.every((s) => (s.dir === 1 || s.dir === -1) && s.risk > 0 && Number.isFinite(s.tp)), JSON.stringify(an.setups[0]))
  check('sweep: params merge DEFAULTS (entryMode giu nguyen)', Number.isFinite(an.params.feePct) && an.params.entryMode === 'market')

  check('sweep: volSweepMin qua cao -> 0 setup', sweepMethod.analyze(bars, { ...base, volSweepMin: 999 }).setups.length === 0)
  check('sweep: minRR bat kha thi -> 0 setup', sweepMethod.analyze(bars, { ...base, minRR: 999 }).setups.length === 0)

  // retest: khong vao ngay bar quet (bar 20) ma doi gia test lai (bar 23) voi volume thap
  const rt = sweepMethod.analyze(bars, { ...base, entryMode: 'retest', retestBars: 10, volRetestMax: 1.2 })
  check('sweep: retest doi test lai, khong vao bar quet', rt.setups.length >= 1 && rt.setups.every((s) => s.bar > 20), JSON.stringify(rt.setups.map((s) => s.bar)))

  let bt = null
  let bErr = null
  try { bt = backtest(bars, { method: 'sweep', symbol: 'TESTUSDT', tf: '60', params: base }) } catch (e) { bErr = e }
  check('sweep: backtest e2e chay duoc', bt != null && Array.isArray(bt.trades), String(bErr?.message ?? ''))

  const a2 = sweepMethod.analyze(bars, base)
  check('sweep: deterministic (2 lan giong nhau)', JSON.stringify(a2.events) === JSON.stringify(an.events) && a2.setups.length === an.setups.length)
}

// =============================================================================
section('18. ta.mjs — Phase 7I indicator primitives (ema/rsi/stdev/macd/vwap/obv/cmf/donchian)')

// --- ta.ema: Pine seed = first valid src, NOT sma ---------------------------
{
  // alpha = 2/(3+1) = 0.5; seed src[0]
  const e = ema([2, 4, 6, 8], 3)
  check('ema: seed = first src (khong phai sma)', near(e[0], 2), `got ${e[0]}`)
  check('ema: bar 1 = 0.5*4 + 0.5*2 = 3', near(e[1], 3), `got ${e[1]}`)
  check('ema: bar 2 = 0.5*6 + 0.5*3 = 4.5', near(e[2], 4.5), `got ${e[2]}`)
  check('ema: bar 3 = 0.5*8 + 0.5*4.5 = 6.25', near(e[3], 6.25), `got ${e[3]}`)

  // na src -> na output, recursion state untouched (resume on next valid bar)
  const n = ema([2, null, 6], 3)
  check('ema: na src -> na, state giu nguyen', n[0] === 2 && n[1] === null && near(n[2], 4), JSON.stringify(n))

  check('ema: length <= 0 -> toan null', allNull(ema([1, 2, 3], 0)))
}

// --- ta.rsi: Wilder, hand-computed on a zigzag series -----------------------
{
  // closes [10,11,10,11,10], length=2 -> gains [na,1,0,1,0], losses [na,0,1,0,1]
  // rma(gains,2): seed 0.5 @i2, then 0.75, 0.375; rma(losses,2): 0.5, 0.25, 0.625
  const r = rsi([10, 11, 10, 11, 10], 2)
  check('rsi: na truoc khi du seed', r[0] === null && r[1] === null, JSON.stringify(r.slice(0, 2)))
  check('rsi: i2 = 100-100/(1+0.5/0.5) = 50', near(r[2], 50), `got ${r[2]}`)
  check('rsi: i3 = 100-100/(1+0.75/0.25) = 75', near(r[3], 75), `got ${r[3]}`)
  check('rsi: i4 = 100-100/(1+0.375/0.625) = 37.5', near(r[4], 37.5), `got ${r[4]}`)

  // flat series: 0/0 -> na (Pine math), khong phai 50
  const flat = rsi([10, 10, 10, 10, 10], 2)
  check('rsi: series phang -> na (0/0)', flat[4] === null, `got ${flat[4]}`)

  // all-up: losses = 0 -> +inf -> rsi = 100
  const up = rsi([1, 2, 3, 4, 5, 6], 2)
  check('rsi: gia tang lien tuc -> 100', near(up[5], 100), `got ${up[5]}`)
}

// --- ta.stdev: population, strict window ------------------------------------
{
  const s = stdev([1, 2, 3, 4], 4)
  check('stdev: sqrt(var(pop)) = sqrt(1.25)', s[3] != null && Math.abs(s[3] - Math.sqrt(1.25)) < 1e-9, `got ${s[3]}`)
  check('stdev: na truoc khi du length', s[0] === null && s[1] === null && s[2] === null, JSON.stringify(s))
  check('stdev: constant -> 0', near(stdev([3, 3, 3, 3], 4)[3], 0), `got ${stdev([3, 3, 3, 3], 4)[3]}`)
  const withNa = stdev([1, null, 3, 4], 3)
  check('stdev: na trong cua so -> na', withNa[3] === null, `got ${withNa[3]}`)
}

// --- ta.macd: structure + exact recursion -----------------------------------
{
  const m = macd([1, 2, 3, 4, 5], 2, 3, 2)
  check('macd: 3 output cung dai bars', m.macd.length === 5 && m.signal.length === 5 && m.hist.length === 5)
  // ema2 seed=1, ema3 seed=1 -> macd[0] = 0
  check('macd: seed ca 2 ema = src -> macd[0] = 0', near(m.macd[0], 0), `got ${m.macd[0]}`)
  // macd[1] = 5/3 - 1.5 = 1/6; signal[1] = (2/3)*(1/6) = 1/9; hist[1] = 1/18
  check('macd: bar 1 = 1/6', near(m.macd[1], 1 / 6), `got ${m.macd[1]}`)
  check('macd: signal bar 1 = 1/9', near(m.signal[1], 1 / 9), `got ${m.signal[1]}`)
  check('macd: hist = macd - signal', m.hist.every((h, i) => h === null || (m.macd[i] !== null && m.signal[i] !== null && near(h, m.macd[i] - m.signal[i], 1e-9))))
}

// --- ta.vwap: anchored typical-price VWAP -----------------------------------
{
  const bars = [
    { open: 9, high: 10, low: 8, close: 9, volume: 100 }, // tp = 9
    { open: 10, high: 12, low: 9, close: 10, volume: 300 }, // tp = 31/3
  ]
  const v = vwap(bars)
  check('vwap: bar 1 = tp = 9', near(v[0], 9), `got ${v[0]}`)
  check('vwap: bar 2 = (900+3100)/(100+300) = 10', near(v[1], 10), `got ${v[1]}`)
}

// --- ta.obv: starts 0, +/- volume by close direction ------------------------
{
  const bars = [
    { open: 10, high: 11, low: 9, close: 10, volume: 5 },
    { open: 10, high: 12, low: 9, close: 11, volume: 3 }, // up -> +3
    { open: 11, high: 11, low: 9, close: 10, volume: 7 }, // down -> -7
    { open: 10, high: 11, low: 9, close: 10, volume: 2 }, // flat -> unchanged
  ]
  const o = obv(bars)
  check('obv: bat dau tai 0', o[0] === 0, `got ${o[0]}`)
  check('obv: len +3 = 3', near(o[1], 3), `got ${o[1]}`)
  check('obv: xuong -7 = -4', near(o[2], -4), `got ${o[2]}`)
  check('obv: bang nhau -> giu nguyen', near(o[3], -4), `got ${o[3]}`)
}

// --- ta.cmf: sum(mfv)/sum(vol), degenerate bar -> na ------------------------
{
  const bars = [
    { open: 9, high: 10, low: 8, close: 10, volume: 10 }, // clv = +1 -> mfv = 10
    { open: 9, high: 10, low: 8, close: 8, volume: 20 }, // clv = -1 -> mfv = -20
  ]
  const c = cmf(bars, 2)
  check('cmf: (10-20)/(10+20) = -1/3', c[1] != null && Math.abs(c[1] + 1 / 3) < 1e-9, `got ${c[1]}`)
  check('cmf: na truoc khi du length', c[0] === null, `got ${c[0]}`)

  const deg = cmf([{ open: 9, high: 9, low: 9, close: 9, volume: 5 }, { open: 9, high: 9, low: 9, close: 9, volume: 5 }], 2)
  check('cmf: bar h==l (mfv na) -> na', deg[1] === null, `got ${deg[1]}`)
}

// --- donchian: highest(high)/lowest(low) ------------------------------------
{
  const bars = [
    { open: 9, high: 10, low: 8, close: 9, volume: 1 },
    { open: 10, high: 12, low: 9, close: 11, volume: 1 },
    { open: 11, high: 11, low: 7, close: 8, volume: 1 },
    { open: 8, high: 14, low: 10, close: 13, volume: 1 },
  ]
  const d = donchian(bars, 2)
  check('donchian: na truoc khi du length', d.upper[0] === null && d.lower[0] === null, JSON.stringify([d.upper[0], d.lower[0]]))
  check('donchian: upper[1] = max(10,12) = 12', near(d.upper[1], 12), `got ${d.upper[1]}`)
  check('donchian: lower[1] = min(8,9) = 8', near(d.lower[1], 8), `got ${d.lower[1]}`)
  check('donchian: middle = (u+l)/2', near(d.middle[1], 10), `got ${d.middle[1]}`)
  check('donchian: upper[3] = max(11,14) = 14', near(d.upper[3], 14), `got ${d.upper[3]}`)
}

// =============================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)