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

build('indicator')
build('strategy')
build('vsa')
build('vsa-strategy')
build('sweep')
build('xau')
build('xau2')

for (const f of ['TM Signals.pine', 'TM Backtest.pine', 'TM VSA Wyckoff.pine', 'TM VSA Backtest.pine', 'TM Liquidity Sweep.pine', 'TM XAU Signals.pine', 'TM XAU Signals 2.pine']) {
  const p = join(ROOT, 'pine', 'dist', f)
  check(`${f} ton tai`, existsSync(p))
  if (!existsSync(p)) continue

  const src = readFileSync(p, 'utf8')
  check(`${f} dong dau la //@version=6`, src.startsWith('//@version=6'), JSON.stringify(src.slice(0, 18)))
  check(`${f} co khai bao indicator/strategy`, /^(indicator|strategy)\(/m.test(src))
  check(`${f} da thay {{DECL}}/{{SHARED}}`, !src.includes('{{DECL}}') && !src.includes('{{SHARED}}'))
  check(`${f} co alertcondition`, src.includes('alertcondition('))
  check(`${f} ngoac doi chieu`, (src.match(/\(/g) || []).length === (src.match(/\)/g) || []).length)
  check(`${f} khong canh bao lint`, lint(src, f).length === 0, JSON.stringify(lint(src, f)))

  // Refactor shared 2026-10: moi dinh nghia f_* chi xuat hien DONG MOT lan trong dist.
  // Bat lai truong hop ai do copy lai ham tu shared vao parts (vi du {SHARED} trong comment).
  // Chi khop dinh nghia (dong ket thuc bang `=>`), khong khop loi GOI ham (indent).
  const defs = [...src.matchAll(/^\s*(f_\w+)\s*\([^)]*\)\s*=>/gm)].map((m) => m[1])
  const dupDefs = [...new Set(defs.filter((d, i) => defs.indexOf(d) !== i))]
  check(`${f} khong trung dinh nghia ham f_*`, dupDefs.length === 0, JSON.stringify(dupDefs))
}

const sig = readFileSync(join(ROOT, 'pine', 'dist', 'TM Signals.pine'), 'utf8')
const bts = readFileSync(join(ROOT, 'pine', 'dist', 'TM Backtest.pine'), 'utf8')
const vsa = readFileSync(join(ROOT, 'pine', 'dist', 'TM VSA Wyckoff.pine'), 'utf8')

check('indicator: co dashboard', sig.includes('table.new('))
check('indicator: KHONG goi strategy.entry', !sig.includes('strategy.entry('))
check('strategy: co lenh lenh trading', bts.includes('strategy.entry(') && bts.includes('strategy.exit('))
check('strategy: KHONG ve dashboard', !bts.includes('table.new('))

// --- TM VSA Wyckoff: bao mat tinh nang + van de tinh toan ---
check('vsa: indicator overlay=false', /indicator\("TM VSA Wyckoff"/.test(vsa) && vsa.includes('overlay = false'))
check('vsa: khong goi strategy.entry', !vsa.includes('strategy.entry('))
check('vsa: histogram volume + MA co toggle (chuan xau)',
  vsa.includes('plot(tm_i_showViz and tm_i_showVol ? tm_vol : na, "Volume"') &&
  vsa.includes('plot(tm_i_showViz and tm_i_showMA ? tm_volMA : na, "Volume MA"'))
check('vsa: nhan tren gia force_overlay >= 8', (vsa.match(/force_overlay = true/g) || []).length >= 8, `count=${(vsa.match(/force_overlay = true/g) || []).length}`)
check('vsa: alert SV/BC/ST LONG/ST SHORT', ['"VSA SV"', '"VSA BC"', '"VSA ST LONG"', '"VSA ST SHORT"', '"VSA NS"', '"VSA ND"'].every((t) => vsa.includes(t)))
check('vsa: dung shared f_vsaColor + f_sessionOk', vsa.includes('f_vsaColor(') && vsa.includes('f_sessionOk('))
check('vsa: SV/BC bat buoc qua cot TIM', /tm_sigSV = .*tm_isPurple/.test(vsa) && /tm_sigBC = .*tm_isPurple/.test(vsa))
check('tm signals: dung shared f_vsaColor (khong ternary)', sig.includes('f_vsaColor(') && !/tm_vol >= tm_volMA \* 2\.2 \?/.test(sig))

// --- CE10165 THAT tren TradingView (2026-09-30): ta.pivotlow(20) bi bao
// "No value assigned to the rightbars parameter". Ref khong ghi default param
// (vi du nz() van dung duoc 1 tham so) nen KHONG lam rule lint chung - chi kiem
// cuc bo 2 ham pivot: goi 1 tham so la sai, 2-3 tham so la dung.
for (const [lb, src] of [['tm', sig], ['vsa', vsa]]) {
  const bad = []
  for (const m of src.matchAll(/ta\.pivot(?:low|high)\s*\(/g)) {
    const n = splitArgs(src, m.index + m[0].length).length
    if (n < 2 || n > 3) bad.push(`${n} args`)
  }
  check(`${lb}: ta.pivotlow/high goi 2-3 tham so (CE10165)`, bad.length === 0, JSON.stringify(bad))
}

// width/height cua table.cell la PHAN TRAM khong gian pane (docs TV: width = 100
// = 100% -> "covers the whole chart"), KHONG phai pixel. Goi that 2026-09-30: VSA
// truyen width = 68, height = 18 -> 9 hang x 18% + bgcolor xam dac phu het chart.
// TM/VSA de auto-size theo text (1 dong = 1 cell theo quy uoc file).
for (const [lb, src] of [['tm', sig], ['vsa', vsa]]) {
  const bad = src.split('\n').filter((l) => l.includes('table.cell(') && /\b(width|height)\s*=/.test(l))
  check(`${lb}: table.cell khong truyen width/height (%)`, bad.length === 0, bad[0]?.slice(0, 70))
}

// Guard: table.cell thieu dau phay truoc mot kwarg (xuat hien 2026-09-30 khi sua
// width/height bang replaceAll - xoa nham phay). Mot dong = 1 cell theo quy uoc file:
// ... token, kwarg = ... | token kwarg = ...  =>  phai co , hoac ( truoc kwarg.
for (const [lb, src] of [['tm', sig], ['vsa', vsa]]) {
  const bad = src.split('\n')
    .filter((l) => l.includes('table.cell('))
    .filter((l) => /[\w")\]]\s+[A-Za-z_]\w*\s*=/.test(l))
  check(`${lb}: table.cell du dau phay truoc kwarg`, bad.length === 0, bad[0]?.slice(0, 70))
}

// Level tu dong Entry/SL/TP (setup ST gan nhat) - state, input, ve line + label
check('vsa: level Entry/SL/TP co state + 3 input',
  /tm_lvlE\s*:=/.test(vsa) && /tm_i_lvlOn/.test(vsa) && /tm_i_slBuf/.test(vsa) && /tm_i_rrFb/.test(vsa))
check('vsa: line/label Entry-SL-TP force_overlay',
  /label\.new\(bar_index, tm_lvlE, "Entry /.test(vsa) && /label\.new\(bar_index, tm_lvlS/.test(vsa) && /label\.new\(bar_index, tm_lvlT/.test(vsa)
  && (vsa.match(/force_overlay = true/g) || []).length >= 14)
check('vsa: level tu dong dong khi cham TP/SL (uu tien SL)',
  /tm_lvlDone\s*:=\s*true/.test(vsa) && /tm_lvlRes\s*:=\s*"SL"/.test(vsa) && /tm_lvlDoneBar\s*:=/.test(vsa))
check('vsa: dung 1 nhan Entry (gia tai bar cuoi, khong nhan bar ST) + nhan ket qua',
  /label\.new\(bar_index, tm_lvlE, "Entry /.test(vsa) && !/label\.new\(tm_lvlB/.test(vsa) && /label\.new\(tm_lvlDoneBar/.test(vsa))

// --- VSA: 2 ban sua 2026-10-01 (docs/vsa-optimization.md #1,#2) --------------
// #2 Entry la lenh LIMIT -> PHAI theo doi da khop truoc khi xet TP/SL. Truoc day
//    setup chua tung vao lenh van bi ghi "TP"/"SL" -> bao cao tren chart sai.
check('vsa: auto-close BAT BUOC entry da khop (tm_lvlFill)',
  /var bool\s+tm_lvlFill\s*=/.test(vsa) && /if not tm_lvlFill/.test(vsa) && /tm_lvlFill\s*:=\s*true/.test(vsa))
check('vsa: chi xet TP/SL khi da khop (if tm_lvlFill bao ngoai)',
  /if tm_lvlFill\n\s+if tm_lvlDir == 1/.test(vsa), 'thieu gate tm_lvlFill quanh khoi TP/SL')
check('vsa: ca 2 khoi tao setup (LONG+SHORT) deu gan tm_lvlFill theo che do',
  (vsa.match(/tm_lvlFill\s*:=\s*tm_entryMarket/g) || []).length === 2, `so lan = ${(vsa.match(/tm_lvlFill\s*:=\s*tm_entryMarket/g) || []).length} (mong doi 2)`)
// #1 Rang buoc phi: fee_R = phi_round-trip / (slBuf x ATR%)
check('vsa: co fee_R + feeOk + slBuf toi thieu',
  /tm_feeR\s*=/.test(vsa) && /tm_feeOk\s*=/.test(vsa) && /tm_slBufMin\s*=/.test(vsa))
check('vsa: co input phi (feePct, feeMaxR)',
  /tm_i_feePct\s*=\s*input\.float/.test(vsa) && /tm_i_feeMaxR\s*=\s*input\.float/.test(vsa))
check('vsa: dashboard co dong Phi/R + slBuf toi thieu',
  vsa.includes('"Phi/R"') && vsa.includes('"slBuf toi thieu"') && /table\.new\(position\.top_right, 2, 13/.test(vsa))
// --- Muc 5b: doi MO HINH vao lenh (docs/vsa-optimization.md §5b) -------------
check('vsa: co input chon kieu vao lenh + kieu TP',
  /tm_i_entryMode\s*=\s*input\.string/.test(vsa) && /tm_i_tpMode\s*=\s*input\.string/.test(vsa))
check('vsa: market entry lay CLOSE bar ST, limit lay cuc tri SV/BC',
  /\(tm_entryMarket or tm_wyckoffMode\) \? close : tm_svPx/.test(vsa) && /\(tm_entryMarket or tm_wyckoffMode\) \? close : tm_bcPx/.test(vsa))
check('vsa: SL = ngoai DAY/DINH bar kich hoat o che do Wyckoff, ngoai cuc tri o che do VSA',
  /\(\(tm_wyckoffMode \? low : tm_svPx\) - tm_i_slBuf \* tm_atr\)/.test(vsa) && /\(\(tm_wyckoffMode \? high : tm_bcPx\) \+ tm_i_slBuf \* tm_atr\)/.test(vsa))
check('vsa: TP theo R dung RUI RO THAT (e + rrFb * rk), khong dung slBuf*ATR',
  /tm_tpTheoR \? e1 \+ tm_i_rrFb \* rk1/.test(vsa) && /tm_tpTheoR \? e2 - tm_i_rrFb \* rk2/.test(vsa))
check('vsa: bo qua setup khi risk <= 0', (vsa.match(/if rk[12] > 0/g) || []).length === 2)
check('vsa: dashboard hien che do vao lenh/TP',
  vsa.includes('"Vao lenh / TP"') && /\(tm_entryMarket or tm_wyckoffMode\) \? "Market" : "Limit"/.test(vsa))
// --- §5c: CHIEN LUOC 'VSA loc + WYCKOFF' (spring/UTAD, SOS/SOW, LPS/LPSY) ----
check('vsa: co input chon chien luoc + su kien Wyckoff + nguong',
  /tm_i_signalMode\s*=\s*input\.string/.test(vsa) && /tm_i_wyckoffEvent\s*=\s*input\.string/.test(vsa) &&
  /tm_i_sosSpread\s*=\s*input\.float/.test(vsa) && /tm_i_sosVol\s*=\s*input\.float/.test(vsa) && /tm_i_lpsTol\s*=\s*input\.float/.test(vsa))
check('vsa: KHONG con BOS/CHoCH (da thay bang Wyckoff cho nhat quan truong phai)',
  !/tm_brkUp|tm_brkDn|tm_structDir|tm_i_breakMode/.test(vsa))
check('vsa: Spring/UTAD = PHA VO vung nhung DONG CUA tro lai trong vung',
  /tm_wSpring = .*low < tm_lastPLow and close > tm_lastPLow and close > open/.test(vsa) &&
  /tm_wUtad   = .*high > tm_lastPHigh and close < tm_lastPHigh and close < open/.test(vsa))
check('vsa: SOS/SOW = than RONG + volume MANH dong cua ngoai vung',
  /tm_wSos = .*tm_spread >= tm_i_sosSpread \* tm_atr and tm_strongVol and close > open/.test(vsa) &&
  /tm_wSow = .*tm_spread >= tm_i_sosSpread \* tm_atr and tm_strongVol and close < open/.test(vsa))
check('vsa: LPS/LPSY giu TREN day bar SOS (duoi dinh bar SOW)',
  /tm_wLps   = .*low > tm_sosLow and low <= tm_sosLow \+ tm_i_lpsTol \* tm_atr and close > open/.test(vsa) &&
  /tm_wLpsy  = .*high < tm_sowHigh and high >= tm_sowHigh - tm_i_lpsTol \* tm_atr and close < open/.test(vsa))
check('vsa: SHORT la GONG doi xung cua LONG (spring/sos/lps -> utad/sow/lpsy)',
  /tm_evShort = tm_i_wyckoffEvent == "Spring" \? tm_wUtad : tm_i_wyckoffEvent == "SOS" \? tm_wSow : tm_wLpsy/.test(vsa))
check('vsa: Wyckoff mode dung SV/BC lam BO LOC vung (svFresh/bcFresh)',
  /tm_wyckoffMode \? \(tm_evLong and tm_svFresh\)/.test(vsa) && /tm_wyckoffMode \? \(tm_evShort and tm_bcFresh\)/.test(vsa))
check('vsa: GIU tm_okBar o CA HAI nhanh cua chien luoc',
  (vsa.match(/tm_i_evtOn and tm_okBar and \(tm_wyckoffMode/g) || []).length === 2,
  `so lan = ${(vsa.match(/tm_i_evtOn and tm_okBar and \(tm_wyckoffMode/g) || []).length}`)
check('vsa: dashboard hien chien luoc dang chay', vsa.includes('"Chien luoc"') && /tm_wyckoffMode \? \("Wyckoff: "/.test(vsa))
check('vsa: canh bao PHI CAO tren nhan Entry khi fee qua nguong',
  /tm_feeOk \? "" : " \/ PHI CAO"/.test(vsa))
check('vsa: nhan SL co hien R thuc te cua setup',
  /"SL " \+ str\.tostring\(tm_lvlS, format\.mintick\) \+ "  R "/.test(vsa))

// --- TM VSA Backtest: ban twin phai CUNG logic, chi khac phan thi hanh ------
// Bat bien quan trong nhat: 2 ban chia se dung 1 nguon parts-vsa, nen neu ai do
// sua logic su kien o mot ban thi ban kia phai doi theo. Test so SANH TRUC TIEP
// hai dist thay vi kiem chuoi con, de bat duoc lech that.
const vsaBT = readFileSync(join(ROOT, 'pine', 'dist', 'TM VSA Backtest.pine'), 'utf8')
const logicLines = (s) =>
  s.split('\n').filter((l) => /^\s*tm_(sigSV|sigBC|sigSTl|sigSTs|sigST|sigNS|sigND)\s*=/.test(l) || /^\s*tm_lvl[ESTBD]+\s*:=/.test(l))
const logicA = logicLines(vsa).join('\n')
const logicB = logicLines(vsaBT).join('\n')
check('vsa twin: logic su kien GIONG HET ban indicator', logicA.length > 0 && logicA === logicB, `A=${logicA.length}b B=${logicB.length}b`)

check('vsa twin: la strategy', /^strategy\("TM VSA Backtest"/m.test(vsaBT))
check('vsa twin: co strategy.entry + strategy.exit', vsaBT.includes('strategy.entry(') && vsaBT.includes('strategy.exit('))
check('vsa twin: KHONG ve dashboard/plotshape (da cat 60_viz)', !vsaBT.includes('table.new(') && !vsaBT.includes('plotshape('))
check('vsa twin: KHONG lot bridge sang ban indicator', !vsa.includes('strategy.entry(') && !vsa.includes('tm_i_btOn'))
check('vsa twin: co input rieng cho backtest', vsaBT.includes('TM · Backtest') && vsa.includes('TM · Hien thi'))
check('vsa twin: dat lenh DUNG luc setup ST tao (khong tre 1 bar)',
  /tm_btLong\s*=\s*tm_i_btOn and tm_sigSTl and tm_hasSV/.test(vsaBT) && /tm_btShort\s*=\s*tm_i_btOn and tm_sigSTs and tm_hasBC/.test(vsaBT))
check('vsa twin: exit dung tm_lvlS/tm_lvlT tu 40_events (khong tinh lai)',
  /strategy\.exit\(.*stop = tm_lvlS, limit = tm_lvlT\)/.test(vsaBT))
check('vsa twin: qty theo % equity / gia (khong phu thuoc default_qty)', /tm_btQty\s*=\s*tm_i_btPct \/ 100\.0 \* strategy\.equity \/ close/.test(vsaBT))
check('vsa: 60_viz bi cat khoi ban strategy bang marker',
  vsa.includes('table.new(') && !vsaBT.includes('table.new(') && vsa.includes('plotshape(tm_i_showViz and tm_i_showSig and tm_sigSV'))
check('vsa: alertcondition co o CA HAI ban (top-level, hop le trong strategy)',
  vsa.includes('alertcondition(tm_sigSV') && vsaBT.includes('alertcondition(tm_sigSV'))

// --- TM Liquidity Sweep: quet thanh khoan (LuxAlgo) + xac nhan volume VSA ----
const swp = readFileSync(join(ROOT, 'pine', 'dist', 'TM Liquidity Sweep.pine'), 'utf8')
check('sweep: indicator overlay=false (pane rieng cho volume)', /indicator\("TM Liquidity Sweep"/.test(swp) && swp.includes('overlay = false'))
check('sweep: histogram volume 6 mau + MA co toggle (chuan xau)',
  swp.includes('plot(tm_i_showViz and tm_i_showVol ? tm_vol : na, "Volume"') &&
  swp.includes('plot(tm_i_showViz and tm_i_showMA ? tm_volMA : na, "Volume MA"'))
check('sweep: moi hinh ve tren gia deu force_overlay', (swp.match(/force_overlay = true/g) || []).length >= 13, `count=${(swp.match(/force_overlay = true/g) || []).length}`)
check('sweep: khong goi strategy.entry (chi la indicator)', !swp.includes('strategy.entry('))
check('sweep: co UDT level + 2 mang buy-side/sell-side',
  swp.includes('type TmLevel') && swp.includes('array<TmLevel> tm_buy') && swp.includes('array<TmLevel> tm_sell'))
check('sweep: dieu kien quet = rau VUOT level nhung close TRO LAI',
  /high > Lb\.px and close < Lb\.px/.test(swp) && /low < Ls\.px and close > Ls\.px/.test(swp))
check('sweep: level vuot han (breakout) bi danh dau swept, khong con ung vien',
  /if close > Lb\.px/.test(swp) && /if close < Ls\.px/.test(swp) && (swp.match(/swept := true/g) || []).length >= 4)
check('sweep: cong volume VSA (ratio >= nguong input)', /tm_volOk = tm_i_volMinR <= 0\.0 or tm_ratio >= tm_i_volMinR/.test(swp))
check('sweep: cong rau tu choi (rau >= ti le bien do)',
  /tm_upWick >= tm_i_wickRng \* tm_rng/.test(swp) && /tm_dnWick >= tm_i_wickRng \* tm_rng/.test(swp))
check('sweep: dung shared f_vsaColor + f_vsaName + f_sessionOk',
  swp.includes('f_vsaColor(') && swp.includes('f_vsaName(') && swp.includes('f_sessionOk('))
check('sweep: alert SWEEP LONG + SWEEP SHORT', swp.includes('"SWEEP LONG"') && swp.includes('"SWEEP SHORT"'))
check('sweep: dashboard + Entry/SL/TP setup',
  swp.includes('table.new(') && /label\.new\(bar_index, tm_setE, "Entry /.test(swp) && /table\.new\(position\.top_right, 2, 10/.test(swp))
check('sweep: knobs toi uu (entryMode/retest/confirm/minRR/SL bounds)',
  ['tm_i_entryMode', 'tm_i_retestBars', 'tm_i_volRetestMax', 'tm_i_confirmBars', 'tm_i_minRR', 'tm_i_slMinAtr', 'tm_i_slMaxAtr', 'tm_i_trendFast', 'tm_i_trendSlow', 'tm_i_minTouches'].every((k) => swp.includes(k)))
check('sweep: entry market khop ngay + auto-close sau entry',
  (swp.match(/tm_setFill    := true/g) || []).length === 2 && /if tm_setFill\n\s+if tm_setDir == 1/.test(swp))
check('sweep: co state cho retest/confirm (tm_pmDir) + huy khi het cua so',
  /tm_pmDir := -1/.test(swp) && /bar_index - tm_pmBar > maxBars/.test(swp) && /tm_resLong/.test(swp))
check('sweep: pivot goi 2-3 tham so (CE10165)', (() => {
  const bad = []
  for (const m of swp.matchAll(/ta\.pivot(?:low|high)\s*\(/g)) {
    const n = splitArgs(swp, m.index + m[0].length).length
    if (n < 2 || n > 3) bad.push(`${n} args`)
  }
  return bad.length === 0
})(), 'pivot arg count sai')

// --- Chuan viz parts-xau/80_viz.pine: master switch + dong Session ---------
// Ca 5 bo phai co: (1) input master tat/bat TOAN BO viz, (2) marker + dashboard
// bi master gate, (3) dong Session hien phien hien tai (London/NY/New York/...).
const xauSrc = readFileSync(join(ROOT, 'pine', 'dist', 'TM XAU Signals.pine'), 'utf8')
const xau2Src = readFileSync(join(ROOT, 'pine', 'dist', 'TM XAU Signals 2.pine'), 'utf8')
for (const [lb, src, master, sigInput] of [
  ['tm', sig, 'tm_showViz', 'tm_showSig'],
  ['vsa', vsa, 'tm_i_showViz', 'tm_i_showSig'],
  ['sweep', swp, 'tm_i_showViz', 'tm_i_showSig'],
  ['xau', xauSrc, 'xau_showViz', 'xau_showSig'],
  ['xau2', xau2Src, 'x2_showViz', 'x2_showSig'],
]) {
  check(`${lb}: co input master tat/bat toan bo viz`, new RegExp(`${master}\\s*= input\\.bool`).test(src))
  check(`${lb}: master gate marker (plotshape)`, src.includes(`plotshape(${master} and ${sigInput}`))
  check(`${lb}: master gate dashboard`, src.includes(`if ${master} and `))
  check(`${lb}: dashboard co dong Session (chuan xau)`, src.includes('"Session"') && src.includes('"London/NY"'))
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
check('ca hai ban deu khong goi input.timezone', !codeOnly(sig).includes('input.timezone') && !codeOnly(bts).includes('input.timezone'))

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
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
