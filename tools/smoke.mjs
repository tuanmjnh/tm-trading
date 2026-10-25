#!/usr/bin/env node
// =============================================================================
//  TM TRADING - SMOKE TEST
//  Khong can framework, khong can dependency. Chay: npm test
//
//  Kiem tra 4 tang:
//    1. build lint — bat duoc loi compile da gap tren TradingView
//    2. dist       — cu phap, header, va tach dung indicator/strategy
//    3. webhook    — validate payload
//    4. webhook    — HTTP + chong trung + ghi log
// =============================================================================

import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

import { lint, build, isPineFunction, splitArgs } from './build.mjs'
import { createNotifyServer, validate } from '../server/webhook.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const section = (t) => console.log(`\n${t}`)

// =============================================================================
section('1. build lint — loi da gap tren TradingView')

const badSnippets = {
  'ham khong ton tai trong Pine v6': `//@version=6\nindicator("x")\ntz = input.timezone("UTC", "tz")\n`,
  'plot() tran tham so theo thu tu (offset o vi tri 8)': `//@version=6\nindicator("x")\nplot(close, "c", color.red, 2, plot.style_line, true, 0, size.tiny)\n`,
  'plotshape() tran tham so theo thu tu': `//@version=6\nindicator("x")\nplotshape(close, "B", shape.triangleup, location.belowbar, color.red, size.tiny)\n`,
  'ngoac khong doi chieu': `//@version=6\nindicator("x")\nplot(close, "c", color = color.red\n`,
  'ham chua khai bao': `//@version=6\nindicator("x")\nb = ham_bi_dat_mot_cach_ngau_nhien(close)\n`,
  'options tach nhieu dong (CE10156 that dung)': `//@version=6\nindicator("x")\ntz = input.string("UTC", "tz", options = [\n     "UTC", "Asia/Ho_Chi_Minh",\n], group = "g")\n`,
  'supertrend nhan series float lam atrPeriod (CE10123)': `//@version=6\nindicator("x")\ntm_atr = ta.atr(14)\ntm_f = 3.0\ntm_len = input.int(10, "len")\nbad = ta.supertrend(tm_f * tm_atr, tm_atr)\nok  = ta.supertrend(tm_f * tm_atr, tm_len)\n`,
  'rsi nhan bien float lam length (CE10123)': `//@version=6\nindicator("x")\ntm_atr = ta.atr(14)\nbad = ta.rsi(close, tm_atr)\n`,
  'table.new tham so size khong ton tai (CE10120)': `//@version=6\nindicator("x")\nt = table.new(position.top_right, 2, 12, size = font.size.tiny)\n`,
  'str.format_time dao nguoc time/format (CE10123)': `//@version=6\nindicator("x")\ns = str.format_time("yyyy-MM-dd'T'HH:mm:ss'Z'", time, "UTC")\n`,
  'table.cell_clear khong ton tai trong Pine (CE10271)': `//@version=6\nindicator("x")\nt = table.new(position.top_right, 2, 12)\ntable.cell_clear(t, 0, 0, 1, 11)\n`,
}

for (const [name, snippet] of Object.entries(badSnippets)) {
  const w = lint(snippet, 'snippet')
  check(`${name} — bi bao`, w.length > 0, `warnings=${JSON.stringify(w)}`)
}

// Ten da chung minh la KHONG co trong Pine v6. Neu ai do dua ten nay vao ref
// thi test nay hong - chan loi CE10271 quay lai (vi du table.cell_clear).
// Nguon xac minh: tools/pine-ref.mjs (folknor/pine-tools + tai lieu chinh thuc).
const FAKE_NAMES = [
  'input.timezone', 'table.cell_clear', 'ta.pivot', 'ta.hhv', 'ta.llv', 'ta.pmf',
  'ta.pwma', 'line.set_xy', 'color.gradient', 'request.alert',
  'symbol.setcurrency', 'symbol.clearinputs', 'strategy.closedtrades',
  'shape.triangle_down', 'position.center_left',
  // cac ten nay TRUOC DAY bi dua vao FAKE_NAMES la SAI (chung co that) - giu lai
  // mot so ten phantom de dam bao ref khong bi "mo rong" tu cam tay
  'ta.ad', 'ta.normalize', 'ta.trix', 'ta.trima', 'ta.obv',
  'table.remove', 'str.isequal', 'label.set_bgcolor', 'matrix.new', 'array.new',
]
for (const fn of FAKE_NAMES) {
  const src = `//@version=6\nindicator("x")\nbad = ${fn}(close, 14)\n`
  const w = lint(src, 'fake')
  check(`ten khong ton tai "${fn}" — bi bao`, w.some((m) => m.includes('khong co trong Pine v6')), JSON.stringify(w))
}

// P0: FAKE_NAMES PHAI nam ngoai ref (neu khong thi rule "ten khong ton tai" se im
// lap lai ma test kia chi con phu thuoc vao viec ai do goi ten do trong snippet).
check('FAKE_NAMES deu khong co trong pine-ref', FAKE_NAMES.every((fn) => !isPineFunction(fn)),
  JSON.stringify(FAKE_NAMES.filter((fn) => isPineFunction(fn))))

// ham that phai nam trong ref - dam bao pine-ref.json khong bi doi/thieu du lieu
check('pine-ref nhan duoc ham that', ['ta.sma', 'plot', 'table.clear', 'str.format_time'].every(isPineFunction) &&
  !isPineFunction('khong_ton_tai'))

// Cap doi nghich dao cho ten: ta.cog/ta.rci/request.quandl TON TAI that (truoc day
// bi ghi nham vao FAKE_NAMES) - phai khong bi bao la khong ton tai.
for (const fn of ['ta.cog', 'ta.rci', 'request.quandl']) {
  check(`ham that "${fn}" — khong bi bao ten`, isPineFunction(fn) &&
    !lint(`//@version=6\nindicator("x")\nok = ${fn}(close, 14)\n`, 'real').some((m) => m.includes('khong co trong Pine v6')),
    JSON.stringify(lint(`//@version=6\nindicator("x")\nok = ${fn}(close, 14)\n`, 'real')))
}

const good = `//@version=6
indicator("x", overlay = true)
plotshape(close, title = "B", style = shape.triangleup, location = location.belowbar, color = color.red, size = size.tiny)
plot(close, "ema", color = color.blue)
f_clamp(float v, float lo, float hi) =>
    math.max(lo, math.min(hi, v))
x = f_clamp(close, 0.0, 100.0)
`
check('snippet tot — khong canh bao', lint(good, 'good').length === 0, JSON.stringify(lint(good, 'good')))

// Ten dung cua ham xoa noi dung bang la table.clear, KHONG phai table.cell_clear
check('table.clear - khong bi bao', lint('//@version=6\nindicator("x")\nt = table.new(position.top_right, 2, 12)\ntable.clear(t, 0, 0, 1, 11)\n', 'tclear').length === 0, JSON.stringify(lint('//@version=6\nindicator("x")\nt = table.new(position.top_right, 2, 12)\ntable.clear(t, 0, 0, 1, 11)\n', 'tclear')))

// Cap doi nghich dao: neu ai dao nguoc rule str.format_time, 1 trong 2 cai nay se hong.
const fmtOk = '//@version=6\nindicator("x")\ns = str.format_time(time, "yyyy-MM-dd\'T\'HH:mm:ss\'Z\'", "UTC")\n'
const fmtBad = '//@version=6\nindicator("x")\ns = str.format_time("yyyy-MM-dd\'T\'HH:mm:ss\'Z\'", time, "UTC")\n'
check('str.format_time DUNG (time dau) - khong bi bao', lint(fmtOk, 'fmt-ok').length === 0, JSON.stringify(lint(fmtOk, 'fmt-ok')))
check('str.format_time SAI (chuoi dau) - bi bao CE10123', lint(fmtBad, 'fmt-bad').some((m) => m.includes('CE10123')), JSON.stringify(lint(fmtBad, 'fmt-bad')))

// Cap doi nghich dao cho offset cua plot*: 5 tham so la hop le, 6 thi roi vao offset.
const psOk = '//@version=6\nindicator("x")\nplotshape(close, "B", shape.triangleup, location.belowbar, color.red)\n'
const psBad = '//@version=6\nindicator("x")\nplotshape(close, "B", shape.triangleup, location.belowbar, color.red, size.tiny)\n'
check('plotshape 5 tham so theo thu tu - khong bi bao', lint(psOk, 'ps-ok').length === 0, JSON.stringify(lint(psOk, 'ps-ok')))
check('plotshape 6 tham so theo thu tu - bi bao offset', lint(psBad, 'ps-bad').some((m) => m.includes('offset')), JSON.stringify(lint(psBad, 'ps-bad')))

// --- cap doi nghich dao cho luat tham so dau tien phai la UNIX time ---
// `time("D")` la DUNG (tham so dau cua ham time la timeframe) - neu ai derive
// rule nho ten ham la `time` thay vi ten/tham so thi cai nay se hong.
const tOk = '//@version=6\nindicator("x")\nvar t = time("D")\n'
const tBad = '//@version=6\nindicator("x")\nvar t = hour("D", "UTC")\n'
const tOk2 = '//@version=6\nindicator("x")\nvar t = hour(time, "UTC")\n'
check('time("D") - khong bi bao', lint(tOk, 'time-ok').length === 0, JSON.stringify(lint(tOk, 'time-ok')))
check('hour("D") - bi bao', lint(tBad, 'hour-bad').length > 0, JSON.stringify(lint(tBad, 'hour-bad')))
check('hour(time) - khong bi bao', lint(tOk2, 'hour-ok').length === 0, JSON.stringify(lint(tOk2, 'hour-ok')))

// --- cap doi nghich dao cho luat int/float (chi bat float CHAC CHAN) ---
const intOk = `//@version=6
indicator("x")
tm_len = input.int(14, "len")
tm_atr = ta.atr(14)
a1 = ta.sma(close, 14)
a2 = ta.sma(close, tm_len)
a3 = ta.rsi(close, length = tm_len)
a4 = ta.stoch(close, high, low, 20)
`
const intBad1 = '//@version=6\nindicator("x")\ntm_f = 3.0\nb = ta.sma(close, tm_f)\n'
const intBad2 = '//@version=6\nindicator("x")\ntm_atr = ta.atr(14)\nb = ta.rsi(close, length = tm_atr)\n'
const intBad3 = '//@version=6\nindicator("x")\nb = ta.atr(2.5)\n'
check('tham so int hop le - khong bi bao', lint(intOk, 'int-ok').length === 0, JSON.stringify(lint(intOk, 'int-ok')))
check('ta.sma nhan bien float - bi bao', lint(intBad1, 'int-bad1').some((m) => m.includes('CE10123')), JSON.stringify(lint(intBad1, 'int-bad1')))
check('ta.rsi(length = bien float) - bi bao', lint(intBad2, 'int-bad2').some((m) => m.includes('CE10123')), JSON.stringify(lint(intBad2, 'int-bad2')))
check('ta.atr nhan 2.5 - bi bao', lint(intBad3, 'int-bad3').some((m) => m.includes('CE10123')), JSON.stringify(lint(intBad3, 'int-bad3')))

// --- overload: chu ky x/y cua box.new thi vi tri 4 la `bottom` (float) ---
// Neu derive int tu chu ky GOP (point) thi dong nay se bi bao sai (false positive).
const boxOk = `//@version=6
indicator("x")
box.new(bar_index, low, bar_index + 10, high, border_color = color.red, border_width = 2)
box.new(chart.point.from_index(bar_index, low), chart.point.from_index(bar_index + 10, high), border_width = 2)
`
check('box.new chu ky x/y - khong bi bao', lint(boxOk, 'box-ok').length === 0, JSON.stringify(lint(boxOk, 'box-ok')))

// Ten tham so hop le ca 2 chu ky (point-first va x/y-first) - lay tu chu ky GOP.
const boxNamed = '//@version=6\nindicator("x")\nb = box.new(left = bar_index, top = high, right = bar_index + 1, bottom = low, text = "x")\n'
check('box.new ten tham so chu ky x/y - khong bi bao', lint(boxNamed, 'box-named').length === 0, JSON.stringify(lint(boxNamed, 'box-named')))
const boxBad = '//@version=6\nindicator("x")\nb = box.new(left = bar_index, top = high, right = bar_index + 1, bottom = low, mau = color.red)\n'
check('box.new ten tham so sai - bi bao CE10120', lint(boxBad, 'box-bad').some((m) => m.includes('CE10120')), JSON.stringify(lint(boxBad, 'box-bad')))

// Phep ep kieu int()/float() la ham that - phai nam trong BUILTINS
check('phep ep kieu int() khong bi bao', lint('//@version=6\nindicator("x")\nx = int(math.round(1.5))\n', 'cast').length === 0, JSON.stringify(lint('//@version=6\nindicator("x")\nx = int(math.round(1.5))\n', 'cast')))

check('chuoi tieng Viet trong input khong bi nham la ham', lint('//@version=6\nindicator("x")\nlbl = input.bool(true, "Chi tin hieu tren nen da dong (khong repait)")\n', 'vn').length === 0)

// `==` ben trong bieu thuc khong duoc nham la tham so ten
check('bieu thuc co == khong bi nham la named arg', lint('//@version=6\nindicator("x")\nd = tm_posDir == 1 ? "a" : "b"\n', 'eq').length === 0, JSON.stringify(lint('//@version=6\nindicator("x")\nd = tm_posDir == 1 ? "a" : "b"\n', 'eq')))

// Tham so co ten dung theo thu tu tuoc khi
const ordered = `//@version=6\nindicator("x")
t = table.new(position.top_right, 2, 12, border_width = 1, border_color = color.gray)
table.cell(t, 0, 0, "A", text_color = color.white, text_size = size.tiny, text_halign = text.align_left, bgcolor = color.black)
line.set_xy1(ln, bar_index, close)
plot(close, "c", color = color.blue)
s = str.format_time(time, "yyyy-MM-dd", "UTC")
`
check('ten tham so dung, thu tu dung', lint(ordered, 'ord').length === 0, JSON.stringify(lint(ordered, 'ord')))

// Cac loi TradingView THAT da duoc ghi lai boi `node tools/errors.mjs --apply`.
// Day la vong lap 2 chieu con lai: neu lint hong bat lai mot loi da gap that thi
// phan nay hong - bat buoc sua rule, khong duoc xoa test.
const badSnippetsFile = join(ROOT, 'tools', 'bad-snippets.json')
if (existsSync(badSnippetsFile)) {
  const extra = JSON.parse(readFileSync(badSnippetsFile, 'utf8'))
  check('bad-snippets.json la mang', Array.isArray(extra), JSON.stringify(extra).slice(0, 80))
  for (const s of extra) {
    const w = lint(s.code, 'snippet-file')
    const ok = s.expect ? w.some((m) => m.includes(s.expect)) : w.length > 0
    check(`${s.name} — bi bao ${s.expect ?? ''}`.trim(), ok, JSON.stringify(w))
  }
} else {
  check('bad-snippets.json ton tai (chay node tools/errors.mjs --apply de tao)', false)
}

// =============================================================================
section('2. dist — build lai tu parts va kiem tra cu phap')

build('tm')
build('tm-strategy')
build('xau')
build('lk-vsa')
build('lk-vsa-strategy')
build('pa-mtf')
build('pa-mtf-strategy')
build('fz')
build('fz-strategy')
build('wonderwhales')
build('wonderwhales-strategy')

const ACTIVE_DIST = [
  'LongKaco VSA.pine',
  'LongKaco VSA Backtest.pine',
  'Price Action MTF.pine',
  'Price Action MTF Backtest.pine',
  'TM Fusion Zones.pine',
  'TM Fusion Zones Backtest.pine',
  'TM XAU Signals 2.pine',
  'TM Indicator 2.pine',
  'TM Indicator Strategy Lab 2.pine',
  'Wonderwhales.pine',
  'Wonderwhales Backtest.pine',
]

for (const f of ACTIVE_DIST) {
  const p = join(ROOT, 'pine', 'dist', f)
  check(`${f} ton tai`, existsSync(p))
  if (!existsSync(p)) continue

  const src = readFileSync(p, 'utf8')
  check(`${f} dong dau la //@version=6`, src.startsWith('//@version=6'), JSON.stringify(src.slice(0, 18)))
  check(`${f} co khai bao indicator/strategy`, /^(indicator|strategy)\(/m.test(src))
  check(`${f} da thay {{DECL}}/{{SHARED}}`, !src.includes('{{DECL}}') && !src.includes('{{SHARED}}'))
  if (!f.includes('Strategy') && !f.includes('Backtest')) check(`${f} co alertcondition`, src.includes('alertcondition('))
  check(`${f} ngoac doi chieu`, (src.match(/\(/g) || []).length === (src.match(/\)/g) || []).length)
  check(`${f} khong canh bao lint`, lint(src, f).length === 0, JSON.stringify(lint(src, f)))

  // Refactor shared 2026-10: moi dinh nghia f_* chi xuat hien DONG MOT lan trong dist.
  const defs = [...src.matchAll(/^\s*(f_\w+)\s*\([^)]*\)\s*=>/gm)].map((m) => m[1])
  const dupDefs = [...new Set(defs.filter((d, i) => defs.indexOf(d) !== i))]
  check(`${f} khong trung dinh nghia ham f_*`, dupDefs.length === 0, JSON.stringify(dupDefs))
}

// =============================================================================
section('2b. LongKaco VSA — ban build rieng (parts-longkaco-vsa)')

// Ban LongKaco VSA la COPY-ON-WRITE cua parts-vsa + 3 afterfix cua bo A. Bat bien:
//   (1) ban cu parts-vsa KHONG bi doi -> dist TM VSA Wyckoff phai y het truoc/sau
//       khi them target moi (kiem bang cach so voi chinh no o day: khong co
//       assertion nao khac duoc phep doi), va
//   (2) tat het afterfix -> dieu kien su kien phai TRUNG ban cu (A/B that su).
const lk  = readFileSync(join(ROOT, 'pine', 'dist', 'LongKaco VSA.pine'), 'utf8')
const lkBT = readFileSync(join(ROOT, 'pine', 'dist', 'LongKaco VSA Backtest.pine'), 'utf8')

// --- A-P0-1 sweep-truoc-ST --------------------------------------------------
check('lk-vsa: co input cong sweep (sweepReq/sweepWin) + group rieng',
  /tm_i_sweepReq\s*=\s*input\.bool/.test(lk) && /tm_i_sweepWin\s*=\s*input\.int/.test(lk) && lk.includes('TM · Sweep (A-P0-1)'))
check('lk-vsa: bar sweep = rau VUOT level nhung CLOSE TRO LAI (giong TM Liquidity Sweep)',
  /tm_sweepUpBar = .*low < tm_svPx and close > tm_svPx/.test(lk) && /tm_sweepDnBar = .*high > tm_bcPx and close < tm_bcPx/.test(lk))
check('lk-vsa: bar sweep phai SAU bar SV/BC (>= svBar/bcBar)',
  /tm_sweepUpBl >= tm_svBar/.test(lk) && /tm_sweepDnBl >= tm_bcBar/.test(lk))
check('lk-vsa: tin hieu THO tach khoi tin hieu da qua cong',
  /tm_stRawL = /.test(lk) && /tm_stRawS = /.test(lk) && /tm_sigSTl = tm_stRawL and \(not tm_sweepGateOn or tm_sweepL\)/.test(lk))
check('lk-vsa: cong sweep CHI ap cho che do VSA (Wyckoff da co spring/UTAD)',
  /tm_sweepGateOn = tm_i_sweepReq and not tm_wyckoffMode/.test(lk))
check('lk-vsa: co canh bao rieng khi bi loai vi thieu sweep',
  /tm_noSweep = tm_sweepGateOn and/.test(lk) && lk.includes('"LK VSA NO SWEEP"'))
check('lk-vsa: dashboard co dong Sweep truoc ST',
  lk.includes('"Sweep truoc ST"') && /table\.new\(position\.top_right, 2, 15/.test(lk) && lk.includes('table.clear(tm_tbl, 0, 0, 1, 14)'))

const lkStRaw = (lk.match(/^tm_stRawL = .*$/m) ?? [''])[0].replace(/^tm_stRawL = /, '')
check('lk-vsa: dieu kien ST THO co khai bao', lkStRaw !== '')
const lkSsRaw = (lk.match(/^tm_stRawS = .*$/m) ?? [''])[0].replace(/^tm_stRawS = /, '')
check('lk-vsa: dieu kien ST SHORT THO co khai bao', lkSsRaw !== '')

// --- A-P1-1 TP measured move ------------------------------------------------
check('lk-vsa: TP co che do thu 3 "Measured move (A-P1-1)"',
  /tm_i_tpMode\s*=\s*input\.string\(.*"Measured move \(A-P1-1\)"/.test(lk) && /tm_tpMM\s*=/.test(lk))
check('lk-vsa: measured move do tu PHA DAY TRUOC (khong nhin tuong lai)',
  /tm_mmUp\s*= tm_lastPHigh - tm_lowRun1/.test(lk) && /tm_mmDn\s*= tm_highRun1 - tm_lastPLow/.test(lk) &&
  /tm_highRun1 = ta\.highest\(high, tm_i_run \+ 1\)/.test(lk) && /tm_lowRun1  = ta\.lowest\(low, tm_i_run \+ 1\)/.test(lk))
check('lk-vsa: MM chi dung khi pha day di NGUOC chieu vi the, du phong rrFb x R',
  /tpM1  = tm_highFresh and .*tm_mmUp > rk1 \? e1 \+ tm_mmUp : tpR1/.test(lk) &&
  /tpM2  = tm_lowFresh and .*tm_mmDn > rk2 \? e2 - tm_mmDn : tpR2/.test(lk))
check('lk-vsa: TT MM giu nguyen luat "bo qua setup khi risk <= 0"',
  (lk.match(/if rk[12] > 0/g) || []).length === 2)
check('lk-vsa: dashboard hien TP mode R/Pivot/MM', /tm_tpDash\s*=/.test(lk) && lk.includes('+ tm_tpDash'))

// --- A-P1-3 CLX-E -----------------------------------------------------------
check('lk-vsa: CLX-E co input + state mot lan cho moi setup',
  /tm_i_clxOn\s*=\s*input\.bool/.test(lk) && /var bool tm_clxE = false/.test(lk) && /if tm_sigST\n    tm_clxE := false/.test(lk))
check('lk-vsa: CLX-E = volume TIM khi gia da di >= clxR x R theo huong co loi',
  /tm_isPurple and not tm_lvlDone/.test(lk) && /tm_lvlDir == 1 and high >= tm_lvlE \+ tm_i_clxR \* tm_lvlRisk/.test(lk) &&
  /tm_lvlDir == -1 and low <= tm_lvlE - tm_i_clxR \* tm_lvlRisk/.test(lk))
check('lk-vsa: nhan CLX-E tren gia (xcross, force_overlay) + alert rieng',
  /plotshape\(.*tm_clxE and tm_lvlDir == 1, title = "CLX-E LONG", style = shape\.xcross/.test(lk) &&
  /plotshape\(.*tm_clxE and tm_lvlDir == -1, title = "CLX-E SHORT"/.test(lk) && lk.includes('"LK VSA CLX-E"'))
check('lk-vsa: dashboard co dong CLX-E (muc tien xa nhat / nguong)', lk.includes('"CLX-E"') && /tm_clxDash\s*=/.test(lk))

// --- A-P1-2 pyramid (chi o ban strategy) ------------------------------------
check('lk-vsa-strategy: pyramid co input 1..5 + buoc lech ATR',
  /tm_i_btPyr\s*=\s*input\.int\(1, .*minval = 1, maxval = 5/.test(lkBT) && /tm_i_btStep\s*=\s*input\.float/.test(lkBT))
check('lk-vsa-strategy: pyramiding = 5 trong khai bao strategy (bat buoc de chay pyramid)',
  /^strategy\("LongKaco VSA Backtest".*pyramiding = 5/m.test(lkBT))
check('lk-vsa-strategy: N lenh con co ID rieng (L1..Ln / S1..Sn) + 1 exit moi ID',
  /strategy\.entry\("L" \+ str\.tostring\(i\)/.test(lkBT) && /for i = 1 to tm_i_btPyr/.test(lkBT) &&
  /strategy\.exit\("XL" \+ str\.tostring\(i\), from_entry = "L" \+ str\.tostring\(i\)/.test(lkBT))
check('lk-vsa-strategy: N = 1 giu NGUYEN duong cu (market + ID Long/Short + exit VSA X)',
  /strategy\.entry\("Long", strategy\.long, qty = tm_btQty, comment = "LK VSA ST LONG"\)/.test(lkBT) &&
  /strategy\.exit\("VSA X", from_entry = tm_btEn, stop = tm_lvlS, limit = tm_lvlT\)/.test(lkBT) && /tm_btMulti = tm_i_btPyr > 1/.test(lkBT))
// P0: pyramiding = 5 khien CUNG MOT ID cong don (docs TV: chinh vi du "Entry" 4 lan
// voi pyramiding = 4 deu thanh lenh) -> duong N = 1 PHAI tu chan bang position_size,
// neu khong backtest A/B se lech ngay tu mac dinh.
check('lk-vsa-strategy: N = 1 tu chan lenh thu 2 bang strategy.position_size',
  /tm_btLong and not tm_btMulti and strategy\.position_size >= 0/.test(lkBT) &&
  /tm_btShort and not tm_btMulti and strategy\.position_size <= 0/.test(lkBT))
check('lk-vsa-strategy: khoi luong chia deu cho so lenh con', /tm_btQty = tm_i_btPct \/ 100\.0 \* strategy\.equity \/ close \/ tm_i_btPyr/.test(lkBT))
check('lk-vsa-strategy: la strategy, cat 60_viz, khong goi strategy.entry o ban indicator',
  /^strategy\("LongKaco VSA Backtest"/m.test(lkBT) && !lkBT.includes('table.new(') && !lk.includes('strategy.entry('))
check('lk-vsa: alertcondition co o CA HAI ban (top-level, hop le trong strategy)',
  lk.includes('alertcondition(tm_sigSV') && lkBT.includes('alertcondition(tm_sigSV') && lk.includes('"LK VSA SV"'))

// --- twin: logic su kien cua 2 ban LongKaco phai GIONG HET -------------------
const lkLogic = (s) =>
  s.split('\n').filter((l) => /^\s*tm_(sigSV|sigBC|sigSTl|sigSTs|sigST|sigNS|sigND|stRawL|stRawS|noSweep|clxE)\s*=/.test(l) || /^\s*tm_lvl[ESTBD]+\s*:=/.test(l))
check('lk twin: logic su kien indicator = strategy (khong the lech)',
  lkLogic(lk).join('\n') === lkLogic(lkBT).join('\n'), `${lkLogic(lk).length} vs ${lkLogic(lkBT).length}`)
for (const [lb, src, master, sigInput] of [['lk-vsa', lk, 'tm_i_showViz', 'tm_i_showSig']]) {
  check(`${lb}: co input master tat/bat toan bo viz`, new RegExp(`${master}\\s*= input\\.bool`).test(src))
  check(`${lb}: master gate marker (plotshape)`, src.includes(`plotshape(${master} and ${sigInput}`))
  check(`${lb}: master gate dashboard`, src.includes(`if ${master} and `))
  check(`${lb}: dashboard co dong Session (chuan xau)`, src.includes('"Session"') && src.includes('"London/NY"'))
}
check('lk-vsa: khong truyen width/height % cho table.cell',
  !/\b(width|height)\s*=/.test(lk.split('\n').filter((l) => l.includes('table.cell(')).join('\n')))
check('lk-vsa: pivot goi 2-3 tham so (CE10165)', (() => {
  const bad = []
  for (const m of lk.matchAll(/ta\.pivot(?:low|high)\s*\(/g)) {
    const n = splitArgs(lk, m.index + m[0].length).length
    if (n < 2 || n > 3) bad.push(`${n} args`)
  }
  return bad.length === 0
})(), 'pivot arg count sai')

// --- Chuan viz: master switch + dong Session ---------
const xau2Src = readFileSync(join(ROOT, 'pine', 'dist', 'TM XAU Signals 2.pine'), 'utf8')
for (const [lb, src, master, sigInput] of [
  ['lk-vsa', lk, 'tm_i_showViz', 'tm_i_showSig'],
  ['xau', xau2Src, 'x2_showViz', 'x2_showSig'],
]) {
  check(`${lb}: co input master tat/bat toan bo viz`, new RegExp(`${master}\\s*= input\\.bool`).test(src))
  check(`${lb}: master gate marker (plotshape)`, src.includes(`plotshape(${master} and ${sigInput}`))
  check(`${lb}: master gate dashboard`, src.includes(`if ${master} and `))
  check(`${lb}: dashboard co dong Session`, src.includes('"Session"'))
}

// --- XAU Signals 2 (master-prompt v2) ----------------------------------------
check('xau2: indicator, khong phai strategy', /^indicator\("TM XAU Signals 2"/m.test(xau2Src) && !xau2Src.includes('strategy.entry('))
check('xau2: khai bao shorttitle + dynamic_requests', xau2Src.includes('shorttitle = "TM·XAU2"') && xau2Src.includes('dynamic_requests = true'))
// §1: moi event la structured data (UDT) co timestamp/tf/confirmed/level
check('xau2: UDT X2Event day du field (kind/dir/srcBar/srcTime/tf/confirmed/level)',
  /type X2Event/.test(xau2Src) && ['string kind', 'string dir', 'int    srcBar', 'int    srcTime', 'string tf', 'bool   confirmed', 'float  level'].every((s) => xau2Src.includes(s)))
check('xau2: event buffer array<X2Event> + push co confirmed gate',
  xau2Src.includes('array<X2Event>') && xau2Src.includes('array.push(x2_evtBuf') && /f_pushEvent\("BOS", "bull", x2_lastHighBar, time, barstate\.isconfirmed/.test(xau2Src))
check('xau2: event kinds day du BOS/CHoCH/MSS/RETEST/FAILBRK/CONT/PULL/SWEEP',
  ['f_pushEvent("BOS"', 'f_pushEvent("CHoCH"', 'f_pushEvent("MSS"', 'f_pushEvent("RETEST"', 'f_pushEvent("FAILBRK"', 'f_pushEvent("CONT"', 'f_pushEvent("PULL"', 'f_pushEvent("SWEEP"'].every((s) => xau2Src.includes(s)))
// §2: indicator engine - chi so phai CO (ta.macd/ta.dmi/ta.bb/ta.vwap), OBV tinh thu cong (ta.obv khong co trong Pine v6)
check('xau2: MACD + DMI/ADX + Bollinger + VWAP + RelVol + OBV + EMA 20/50/200',
  ['ta.macd(', 'ta.dmi(', 'ta.bb(', 'ta.vwap(', 'ta.ema(close, x2_emaFast)', 'ta.ema(close, x2_emaSlow)', 'x2_relVol', 'x2_obvSlope'].every((s) => xau2Src.includes(s)) &&
  !xau2Src.includes('ta.obv('))
check('xau2: nhom correlated duoc AVERAGE (khong tinh trung lap)',
  xau2Src.includes('(x2_rsiScore + x2_macdScore + x2_dmiScore) / 3.0') && xau2Src.includes('(x2_relVolScore + x2_obvScore + x2_vsaScore) / 3.0'))
// §3: liquidity/market location - moi tinh nang toggle rieng
check('xau2: PD/PW/Session HL/Equal/Sweep/Trendline/FVG/OB co toggle rieng',
  ['x2_liq_pdOn', 'x2_liq_pwOn', 'x2_liq_sessOn', 'x2_liq_sweepOn', 'x2_liq_tlOn', 'x2_fvg_showOn', 'x2_ob_showOn', 'x2_sr_showOn'].every((s) => new RegExp(`${s}\\s*= input\\.`).test(xau2Src)))
check('xau2: FVG dieu kien 3 nen + nguong ATR, OB = displacement + nen truoc do',
  /low > high\[2\]/.test(xau2Src) && /high < low\[2\]/.test(xau2Src) && /x2_dispBull and close\[1\] < open\[1\]/.test(xau2Src))
check('xau2: trendline 2 pivot + slope + touch tolerance',
  xau2Src.includes('x2_tlUpSlope') && xau2Src.includes('x2_liq_tlTol') && xau2Src.includes('x2_tlLoTouch'))
// §4: MTF - Context + Setup, LTF khong override HTF (VEto ro rang)
check('xau2: Context TF + Setup TF request.security lookahead_on',
  (xau2Src.match(/lookahead = barmerge\.lookahead_on/g) || []).length >= 4 &&
  /request\.security\(syminfo\.tickerid, x2_ctxTf/.test(xau2Src) && /request\.security\(syminfo\.tickerid, x2_setupTf/.test(xau2Src))
check('xau2: HTF VETO chan lenh nguoc Context + gate vao signal',
  /x2_htfVeto = x2_htfVetoOn and x2_ctxDir != 0 and x2_dir != 0 and x2_ctxDir != x2_dir/.test(xau2Src) &&
  /x2_okFilter = x2_okMtf and/.test(xau2Src))
check('xau2:11 trong so nhom (weight) +4 nguong quality',
  ['x2_w_trend', 'x2_w_struct', 'x2_w_liq', 'x2_w_loc', 'x2_w_sr', 'x2_w_candle', 'x2_w_vol', 'x2_w_atr', 'x2_w_mom', 'x2_w_sess', 'x2_w_mtf'].every((s) => xau2Src.includes(s)) &&
  ['"NO TRADE"', '"WEAK"', '"SETUP"', '"STRONG"', '"A+"'].every((s) => xau2Src.includes(s)))
check('xau2: no-repaint gate (confirmOnly) + alertcondition + webhook payload',
  xau2Src.includes('x2_confirmOnly ? barstate.isconfirmed : true') && xau2Src.includes('alertcondition(') && xau2Src.includes('\\"action\\":\\"EVENT\\"'))
check('xau2: moi hinh ve tren gia deu force_overlay', (xau2Src.match(/force_overlay = true/g) || []).length >= 20, `count=${(xau2Src.match(/force_overlay = true/g) || []).length}`)
check('xau2: khong truyen width/height % cho table.cell', !/\b(width|height)\s*=/.test(xau2Src.split('\n').filter((l) => l.includes('table.cell(')).join('\n')))
check('xau2: dashboard 2 cot va table.clear phu het hang', xau2Src.includes('table.new(position.top_right, 2, 23') && xau2Src.includes('table.clear(x2_tbl, 0, 0, 1, 22)'))
check('xau2: pivot goi 2-3 tham so (CE10165)', (() => {
  const bad = []
  for (const m of xau2Src.matchAll(/ta\.pivot(?:low|high)\s*\(/g)) {
    const n = splitArgs(xau2Src, m.index + m[0].length).length
    if (n < 2 || n > 3) bad.push(`${n} args`)
  }
  return bad.length === 0
})(), 'pivot arg count sai')

// Kiem tra tren MA THAT (bo comment) - truong hop "input.timezone" chi con lai
// trong comment nen khong duoc goi that su.
const codeOnly = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
check('ca hai ban deu khong goi input.timezone', !codeOnly(lk).includes('input.timezone') && !codeOnly(xau2Src).includes('input.timezone'))

// =============================================================================
section('2d. Price Action MTF — ban build rieng (parts-price-action-mtf)')

const paSrc   = readFileSync(join(ROOT, 'pine', 'dist', 'Price Action MTF.pine'), 'utf8')
const paBtSrc = readFileSync(join(ROOT, 'pine', 'dist', 'Price Action MTF Backtest.pine'), 'utf8')

check('pa-mtf: indicator, khong phai strategy', /^indicator\("Price Action MTF"/m.test(paSrc) && !paSrc.includes('strategy.entry('))
check('pa-mtf-strategy: la strategy', /^strategy\("Price Action MTF Backtest"/m.test(paBtSrc) && paBtSrc.includes('strategy.entry('))
check('pa-mtf: co input master tat/bat toan bo viz', /pa_showViz\s*= input\.bool/.test(paSrc))
check('pa-mtf: master gate marker (plotshape)', paSrc.includes('plotshape(pa_showViz and pa_showSig'))
check('pa-mtf: master gate dashboard', paSrc.includes('if pa_showViz and pa_showDash'))
check('pa-mtf: dashboard co dong Session', paSrc.includes('"Session"') && paSrc.includes('pa_sessName'))
check('pa-mtf: dashboard 2 cot va table.clear phu het hang', paSrc.includes('table.new(position.top_right, 2, 27') && paSrc.includes('table.clear(pa_tbl, 0, 0, 1, 26)'))

// Afterfix B-P0-1: Mau hinh gia (Double/Triple Top-Bottom + Vai dau vai)
check('pa-mtf: B-P0-1 co Double/Triple Top-Bottom + Vai dau vai pha neckline',
  paSrc.includes('pa_hsTopBrk') && paSrc.includes('pa_dtBrk') && paSrc.includes('pa_patNeck') && paSrc.includes('f_pushEvent("PATTERN"'))

// Afterfix B-P0-2: Inside bar / Doji / 3 Soldiers & Crows
check('pa-mtf: B-P0-2 Inside bar, Doji, 3 Soldiers / Crows',
  paSrc.includes('pa_isInsideBar') && paSrc.includes('pa_ibBull') && paSrc.includes('pa_isDoji') && paSrc.includes('pa_3Soldiers') && paSrc.includes('pa_3Crows'))

// Afterfix B-P0-3: Confluence 0-3
check('pa-mtf: B-P0-3 confluence score 0-3 va alert setup',
  paSrc.includes('pa_confluenceScore = (pa_cf1 ? 1 : 0) + (pa_cf2 ? 1 : 0) + (pa_cf3 ? 1 : 0)') &&
  paSrc.includes('"PA MTF SETUP"') && paSrc.includes('pa_confluenceScore == 3'))

// Afterfix B-P1-1: Volume veto
check('pa-mtf: B-P1-1 volume veto tren pin/engulf',
  paSrc.includes('pa_vVetoMul = pa_cp_volVetoOn ? (pa_volRatio >= pa_cp_volVetoR ? 1.0 : 0.4) : 1.0') &&
  paSrc.includes('(pa_bullPin ? 1.0 : 0.0) * pa_vVetoMul'))

// Afterfix B-P1-2: Regime gate
check('pa-mtf: B-P1-2 regime gate (ADX + BBW Squeeze + Range Edge)',
  paSrc.includes('pa_regime') && paSrc.includes('pa_isSqueeze') && paSrc.includes('pa_okRegime') &&
  paSrc.includes('TRENDING') && paSrc.includes('CHOPPY') && paSrc.includes('RANGING'))

// Afterfix B-P1-3: Measured-move TP
check('pa-mtf: B-P1-3 measured-move TP theo do cao mo hinh',
  paSrc.includes('Measured move (B-P1-3)') && paSrc.includes('pa_patHeight') && paSrc.includes('mmDist * 0.5'))

// Afterfix B-P1-4: Engulfing streak
check('pa-mtf: B-P1-4 dem chuoi engulfing va bonus diem',
  paSrc.includes('pa_engulfStreak') && paSrc.includes('pa_streakBonus'))

// Strategy twin checks
check('pa-mtf twin: strategy cat volume plot cua pane',
  paSrc.includes('plot(pa_showViz and pa_showVol ? pa_vol : na,   "Volume"') && !paBtSrc.includes('plot(pa_showViz and pa_showVol ? pa_vol : na,   "Volume"'))
check('pa-mtf twin: strategy cat khoi ban indicator', !paSrc.includes('strategy.entry(') && !paSrc.includes('pa_strat_on'))
check('pa-mtf twin: alertcondition co o ca hai ban', paSrc.includes('alertcondition(pa_evEntry') && paBtSrc.includes('alertcondition(pa_evEntry'))

// =============================================================================
section('2e. TM Fusion Zones — ban build rieng (parts-fusion-zones)')

const fzSrc   = readFileSync(join(ROOT, 'pine', 'dist', 'TM Fusion Zones.pine'), 'utf8')
const fzBtSrc = readFileSync(join(ROOT, 'pine', 'dist', 'TM Fusion Zones Backtest.pine'), 'utf8')

check('fz: indicator, khong phai strategy', /^indicator\("TM Fusion Zones"/m.test(fzSrc) && !fzSrc.includes('strategy.entry('))
check('fz-strategy: la strategy', /^strategy\("TM Fusion Zones Backtest"/m.test(fzBtSrc) && fzBtSrc.includes('strategy.entry('))
check('fz: shorttitle <= 10 ky tu', fzSrc.includes('shorttitle = "TM FZ"') && fzBtSrc.includes('shorttitle = "TM FZ BT"'))
check('fz: overlay = true ca hai ban', fzSrc.includes('overlay = true') && fzBtSrc.includes('overlay = true'))
check('fz: co master visual switch fz_showViz', /fz_showViz\s*= input\.bool/.test(fzSrc))
check('fz: master visual gate tren plot va HUD', fzSrc.includes('fz_showDash and fz_showViz') && fzSrc.includes('fz_rb_show and fz_showViz'))
check('fz: co 3 setup vao lenh doc lap',
  ['fz_setup_pullback', 'fz_setup_sweep', 'fz_setup_range'].every((s) => new RegExp(`${s}\\s*= input\\.bool`).test(fzSrc)))
check('fz: co scoring weights + thresholds',
  ['fz_w_trend', 'fz_w_zone', 'fz_w_struct', 'fz_w_candle', 'fz_w_mtf'].every((s) => fzSrc.includes(s)) &&
  ['fz_scr_noTrade', 'fz_scr_setup', 'fz_scr_strong'].every((s) => fzSrc.includes(s)))
check('fz: co Obstacle Gate chan opposing zone < TP1', fzSrc.includes('fz_obstacleGate') && fzSrc.includes('f_nearestOpposingZoneDistance'))
check('fz: webhook schema fz.signal.v1.0', fzSrc.includes('fz.signal.v1.0') && fzSrc.includes('version'))
check('fz: alertcondition co o ca hai ban', fzSrc.includes('alertcondition(fz_signalLong') && fzBtSrc.includes('alertcondition(fz_signalLong'))
check('fz twin: strategy cat khoi ban indicator', !fzSrc.includes('strategy.entry(') && fzBtSrc.includes('strategy.entry('))

// =============================================================================
section('2f. Wonderwhales — ban build rieng (parts-wonderwhales)')

const wwSrc = readFileSync(join(ROOT, 'pine', 'dist', 'Wonderwhales.pine'), 'utf8')

check('ww: indicator, khong phai strategy', /^indicator\("Wonderwhales"/m.test(wwSrc) && !wwSrc.includes('strategy.entry('))
check('ww: shorttitle <= 10 ky tu', wwSrc.includes('shorttitle = "WWHALES"'))
check('ww: overlay = false (ho tro Volume pane ben duoi)', wwSrc.includes('overlay = false'))
check('ww: PSAR va cac plots tren gia co force_overlay = true',
  wwSrc.includes('title = "Parabolic SAR", color = ww_psarColor, style = plot.style_cross, linewidth = 2, force_overlay = true') &&
  wwSrc.includes('title = "Fast EMA", color = color.rgb(59, 130, 246), linewidth = 1, force_overlay = true'))
check('ww: VSA Volume pane plots duoi chart (format.volume)',
  wwSrc.includes('format = format.volume') && wwSrc.includes('title = "VSA Volume"') && wwSrc.includes('title = "Volume MA"'))
check('ww: Signal icons ho tro Triangle va Label thu nho (Tiny default)',
  wwSrc.includes('ww_iconStyle') && wwSrc.includes('style = shape.triangleup') && wwSrc.includes('size = size.tiny'))
check('ww: PSAR inputs mac dinh 0.02 / 0.02 / 0.2',
  wwSrc.includes('ww_psarStart = input.float(0.02') &&
  wwSrc.includes('ww_psarInc   = input.float(0.02') &&
  wwSrc.includes('ww_psarMax   = input.float(0.2'))
check('ww: confirm on bar close mac dinh true', wwSrc.includes('ww_confirmOnClose = input.bool(true'))
check('ww: 4 che do signal mode day du',
  ['"Parabolic SAR Reversal"', '"EMA Crossover"', '"SAR + EMA Trend Filter"', '"SAR + EMA + ATR Filter"'].every((m) => wwSrc.includes(m)))
check('ww: EMA filter + ATR filter co input / toggle',
  wwSrc.includes('ww_fastEmaLen') && wwSrc.includes('ww_slowEmaLen') && wwSrc.includes('ww_atrLen') && wwSrc.includes('ww_minAtrPct'))
check('ww: alertcondition cho BUY, SELL va Any Signal',
  wwSrc.includes('alertcondition(ww_signalBuy,') &&
  wwSrc.includes('alertcondition(ww_signalSell,') &&
  wwSrc.includes('alertcondition(ww_signalBuy or ww_signalSell,'))
check('ww: nhan BUY / SELL ngon ngu EN va CN',
  wwSrc.includes('text = "BUY"') && wwSrc.includes('text = "SELL"') &&
  wwSrc.includes('text = "买"') && wwSrc.includes('text = "卖"'))
check('ww: VSA barcolor tat mac dinh de giu mau nen goc TradingView',
  /ww_vsaBarColor\s*=\s*input\.bool\(false,/.test(wwSrc))
check('ww: Secondary indicators va Dashboard tat mac dinh (Default OFF)',
  /ww_showEma200\s*=\s*input\.bool\(false,/.test(wwSrc) &&
  /ww_showBb\s*=\s*input\.bool\(false,/.test(wwSrc) &&
  /ww_showDash\s*=\s*input\.bool\(false,/.test(wwSrc))
check('ww: HUD Dashboard co table 2 cot va day du hang',
  wwSrc.includes('table.new(ww_tablePos, 2, 7') &&
  wwSrc.includes('table.cell(ww_hud, 0, 1, "PSAR Trend"') &&
  wwSrc.includes('table.cell(ww_hud, 0, 2, "VSA Volume"'))

const wwOvSrc = readFileSync(join(ROOT, 'pine', 'dist', 'Wonderwhales Overlay.pine'), 'utf8')
check('ww-ov: indicator overlay = true tren chart gia', /^indicator\("Wonderwhales Overlay"/m.test(wwOvSrc) && wwOvSrc.includes('overlay = true'))
check('ww-ov: cat volume pane de khong vo ty le chart gia', !wwOvSrc.includes('format = format.volume'))
check('ww-ov: co Trend Highlight Candles ho tro hover', wwOvSrc.includes('title = "Trend Highlight Candles"'))

const wwBtSrc = readFileSync(join(ROOT, 'pine', 'dist', 'Wonderwhales Backtest.pine'), 'utf8')

check('ww-strategy: strategy, khong phai indicator', /^strategy\("Wonderwhales Backtest"/m.test(wwBtSrc) && !wwBtSrc.includes('indicator('))
check('ww-strategy: shorttitle <= 10 ky tu', wwBtSrc.includes('shorttitle = "WWHALES BT"'))
check('ww-strategy: overlay = true de hien thi trade tren chart', wwBtSrc.includes('overlay = true'))
check('ww-strategy: co strategy.entry Long va Short', wwBtSrc.includes('strategy.entry("Long"') && wwBtSrc.includes('strategy.entry("Short"'))
check('ww-strategy: co strategy.exit', wwBtSrc.includes('strategy.exit('))
check('ww-strategy: cat volume pane de khong vo ty le chart gia', !wwBtSrc.includes('title = "VSA Volume"') && wwSrc.includes('title = "VSA Volume"'))
check('ww twin: indicator khong goi strategy.entry', !wwSrc.includes('strategy.entry(') && wwBtSrc.includes('strategy.entry('))

// =============================================================================
section('3. webhook — validate payload')

const base = {
  v: 1,
  ts: '2026-09-29T03:17:21Z',
  symbol: 'BTCUSDT',
  tf: '15',
  mode: 'closed',
  action: 'ENTRY',
  side: 'BUY',
  price: 63250.5,
  sl: 63012.1,
  tps: [63655.0, 64000.0],
  atr: 238.4,
  conf: 0.72,
}

check('payload hop le', validate(base).ok)
check('tps rong -> tu choi', !validate({ ...base, tps: [] }).ok)
check('BUY nhung SL > price -> tu choi', !validate({ ...base, sl: 64000 }).ok)
check('SELL nhung SL < price -> tu choi', !validate({ ...base, side: 'SELL', sl: 63000, tps: [62000] }).ok)
check('action sai -> tu choi', !validate({ ...base, action: 'MUA' }).ok)
check('schema version sai -> tu choi', !validate({ ...base, v: 2 }).ok)
check('gia khong hop le -> tu choi', !validate({ ...base, price: -1 }).ok)
check('TP sai huong -> tu choi', !validate({ ...base, tps: [60000] }).ok)
check('SELL day du hop le', validate({ ...base, side: 'SELL', price: 63000, sl: 63200, tps: [62400, 62000] }).ok)

// =============================================================================
section('4. webhook — HTTP')

const tmpLog = mkdtempSync(join(tmpdir(), 'tm-log-'))
const logFile = join(tmpLog, 'alerts.ndjson')
const TOKEN = 's3cret-t0ken'
// dedupe:'ram' - TEST khong duoc ghi vao collection `alerts` that. Duong D4 ben
// vung (unique index) duoc kiem trong engine/test-db.mjs tren DB rieng.
const server = createNotifyServer({ logFile, quiet: true, token: TOKEN, dedupe: 'ram' })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const post = (body, url = `/tm-alert/${TOKEN}`) =>
  fetch(`http://127.0.0.1:${port}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const r1 = await post(base)
check('POST hop le -> 200', r1.status === 200, `status=${r1.status}`)

const r2 = await post(base)
const j2 = await r2.json()
check('gui trung -> 200 + duplicate', r2.status === 200 && j2.note === 'duplicate', JSON.stringify(j2))

const r3 = await post({ ...base, ts: '2026-09-29T03:17:22Z', side: 'SELL', price: 63000, sl: 63100, tps: [62500] })
check('alert moi -> 200', r3.status === 200, `status=${r3.status}`)

const r4 = await post('khong phai json')
check('JSON hong -> 400', r4.status === 400, `status=${r4.status}`)

const r5 = await post({ ...base, ts: 'z', sl: 99999 })
check('logic sai -> 422', r5.status === 422, `status=${r5.status}`)

const r6 = await fetch(`http://127.0.0.1:${port}/khong-ton-tai`)
check('duong dan sai -> 404', r6.status === 404, `status=${r6.status}`)

const r7 = await fetch(`http://127.0.0.1:${port}/health`)
check('/health -> 200', r7.status === 200)
// Phase 12: the MT5 bridge is a component of the aggregate /health (D9). A dead
// or unconfigured bridge must stay fail-soft: the webhook must still answer 200.
const j7 = await r7.json()
check('/health exposes the mt5 bridge component', j7.mt5?.component === 'mt5_bridge', JSON.stringify(j7.mt5))
check('mt5 component never hides the webhook as failed', j7.ok === true && j7.dedupe === 'ram', JSON.stringify({ ok: j7.ok, dedupe: j7.dedupe }))

// --- xac thuc (P1): fail-closed, khong phu thuoc User-Agent ---
const noTok = await post(base, '/tm-alert')
check('thieu token -> 401', noTok.status === 401, `status=${noTok.status}`)

const badTok = await post(base, '/tm-alert/sai-token')
check('token tren path sai -> 401', badTok.status === 401, `status=${badTok.status}`)

const badQuery = await post(base, '/tm-alert?token=sai')
check('token tren query sai -> 401', badQuery.status === 401, `status=${badQuery.status}`)

const spoofUA = await fetch(`http://127.0.0.1:${port}/tm-alert`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain', 'User-Agent': 'TradingView' },
  body: JSON.stringify(base),
})
check('chi spoof User-Agent van bi 401', spoofUA.status === 401, `status=${spoofUA.status}`)

const bearer = await fetch(`http://127.0.0.1:${port}/tm-alert`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(base),
})
check('Bearer token dung -> 200', bearer.status === 200, `status=${bearer.status}`)

const noTokServer = createNotifyServer({ logFile: join(tmpLog, 'no-token.ndjson'), quiet: true, token: '', dedupe: 'ram' })
await new Promise((r) => noTokServer.listen(0, '127.0.0.1', r))
const rFailClosed = await fetch(`http://127.0.0.1:${noTokServer.address().port}/tm-alert/${TOKEN}`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify(base),
})
check('khong cai TM_TOKEN -> fail-closed 401', rFailClosed.status === 401, `status=${rFailClosed.status}`)
await new Promise((r) => noTokServer.close(r))

const logged = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length : 0
check('2 alert hop le da ghi log', logged === 2, `lines=${logged}`)

// --- payload qua lon (413): truoc day socket bi huy NGAY, client khong nhan
// duoc phan hoi nao (chi thay connection reset) -> khong the biet loi gi.
// Nay phai tra 413 + JSON loi TRUOC khi dong ket noi.
const huge = 'x'.repeat(64 * 1024)
let r413
try {
  r413 = await post(huge)
} catch (e) {
  r413 = { status: 0, err: e.message }
}
check('payload 64KB -> 413 (khong phai connection reset)', r413.status === 413, `status=${r413.status} ${r413.err ?? ''}`)
if (r413.status === 413) {
  const j = await r413.json().catch(() => ({}))
  check('payload qua lon -> JSON co ok:false + error', j.ok === false && typeof j.error === 'string', JSON.stringify(j))
}

await new Promise((r) => server.close(r))
rmSync(tmpLog, { recursive: true, force: true })

// =============================================================================
section('5. TM Indicator 2 — v2.1 P0/P1 invariants')

// v2.1 P0: LONG and SHORT must be scored independently on the same 0-100 scale.
// These assertions fail on the v2.0 signed-score design (50 + raw * 50), which
// made a bearish raw score produce a LOW quality score and blocked SHORT.
check('tm2 build 0 warning', build('tm2') === 0)
check('tm2-strategy build 0 warning', build('tm2-strategy') === 0)

const tm2Src = readFileSync(join(ROOT, 'pine', 'dist', 'TM Indicator 2.pine'), 'utf8')
const tm2StratSrc = readFileSync(join(ROOT, 'pine', 'dist', 'TM Indicator Strategy Lab 2.pine'), 'utf8')

check('tm2: no signed score-to-quality mapping (50 + raw * 50)', !/tm_score100\s*=\s*math\.round\(50\.0\s*\+/.test(tm2Src))
check('tm2: independent long/short scores', tm2Src.includes('tm_longScore100') && tm2Src.includes('tm_shortScore100') && tm2Src.includes('tm_scoreMargin'))
check('tm2: symmetric directional parts', tm2Src.includes('f_tmLongPart(') && tm2Src.includes('f_tmShortPart(') && tm2Src.includes('f_tmSideScore('))
// Structural symmetry: the LONG and SHORT weighted sums must be identical apart
// from which directional part they consume. This guards against a one-sided
// weight/threshold being re-introduced by a later edit.
const weightedExpr = (name) => (tm2Src.match(new RegExp(`float ${name} = (.+)`))?.[1] ?? '').replace(/f_tm(?:Long|Short)Part/g, 'PART').replace(/\s+/g, ' ')
check('tm2: long/short weighted sums structurally symmetric', weightedExpr('tm_longWeighted') !== '' && weightedExpr('tm_longWeighted') === weightedExpr('tm_shortWeighted'), weightedExpr('tm_longWeighted'))
check('tm2: explicit direction codes', ['NO_DIRECTION', 'AMBIGUOUS_SETUP', 'BLOCKED_SCORE_LONG', 'BLOCKED_SCORE_SHORT'].every((c) => tm2Src.includes(c)))
const tm2SecCalls = (tm2Src.match(/=\s*request\.security\s*\(/g) || []).length
check('tm2: request.security calls <= 5', tm2SecCalls <= 5, String(tm2SecCalls))

// P0/P1 reason codes + RR target semantics
for (const code of ['BLOCKED_RR', 'BLOCKED_NET_RR', 'BLOCKED_NO_ATR', 'BLOCKED_BAD_SL', 'BLOCKED_BAD_TP', 'BLOCKED_OBSTACLE', 'BLOCKED_OVEREXTENSION', 'BLOCKED_COOLDOWN', 'BLOCKED_DAILY_LIMIT', 'BLOCKED_CIRCUIT_BREAKER', 'BLOCKED_POSITION_OPEN'])
  check(`tm2: reason code ${code}`, tm2Src.includes(`"${code}"`))
check('tm2: RR gate names its evaluation target (TP2)', tm2Src.includes('TMPlan2.new(') && tm2Src.includes('"TP2"'))

// v2.1 P1 modules + dashboard
check('tm2: entry modes A/B/C present', tm2Src.includes('MODE_A_PULLBACK') && tm2Src.includes('MODE_B_SWEEP') && tm2Src.includes('MODE_C_RANGE'))
check('tm2: compact + advanced dashboard', tm2Src.includes('options = ["Compact", "Advanced"]') && tm2Src.includes('tm_dashRows   = tm_dashMode == "Compact" ? 13 : 34'))
check('tm2: dashboard co dong Session', tm2Src.includes('"Session"') && tm2Src.includes('tm_sessName'))
check('tm2: lifecycle funnel counters', ['tm_statCandidates', 'tm_statEligible', 'tm_statPendingN', 'tm_statFilledN', 'tm_statClosedN'].every((v) => tm2Src.includes(v)))
check('tm2: alert contract v2.1', tm2Src.includes('tm2.signal.v2.1') && tm2Src.includes('"long_score"') && tm2Src.includes('"score_side"') && tm2Src.includes('"blockers"'))
check('tm2: alert payload keeps score side explicit', tm2Src.includes('"score_side"') && tm2Src.includes('"direction_code"'))

// Both outputs must share the same logic modules (only 11_* differs by marker).
for (const [name, src] of [['tm2', tm2Src], ['tm2-strategy', tm2StratSrc]]) {
  const defs = [...src.matchAll(/^\s*(f_\w+)\s*\([^)]*\)\s*=>/gm)].map((m) => m[1])
  const dup = [...new Set(defs.filter((d, i) => defs.indexOf(d) !== i))]
  check(`${name}: no duplicate f_* definition`, dup.length === 0, JSON.stringify(dup))
  check(`${name}: shared scoring helpers inlined once`, (src.match(/f_tmSideScore\(/g) || []).length >= 3)
}
check('tm2-strategy: indicator-only alertcondition stripped', !tm2StratSrc.includes('alertcondition('))
check('tm2: strategy bridge stripped from indicator', !tm2Src.includes('strategy.entry('))

// =============================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
