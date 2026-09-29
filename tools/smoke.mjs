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

import { lint, build } from './build.mjs'
import { createNotifyServer, validate } from './notify/server.mjs'

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

// Ten da chung minh la KHONG co trong Pine v6. Giu lai day de neu ai do dua vao
// BUILTINS thi test nay hong - chan loi CE10271 quay lai (vi du table.cell_clear).
const FAKE_NAMES = [
  'input.timezone', 'table.cell_clear', 'ta.pivot', 'ta.hhv', 'ta.llv', 'ta.pmf',
  'ta.pwma', 'ta.rci', 'ta.cog', 'line.set_xy', 'color.gradient', 'request.alert',
  'request.quandl', 'symbol.setcurrency', 'symbol.clearinputs', 'strategy.closedtrades',
  'shape.triangle_down', 'position.center_left',
]
for (const fn of FAKE_NAMES) {
  const src = `//@version=6\nindicator("x")\nbad = ${fn}(close, 14)\n`
  const w = lint(src, 'fake')
  check(`ten khong ton tai "${fn}" — bi bao`, w.some((m) => m.includes('khong co trong Pine v6')), JSON.stringify(w))
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

// =============================================================================
section('2. dist — build lai tu parts va kiem tra cu phap')

build('indicator')
build('strategy')

for (const f of ['tm-signals.pine', 'tm-backtest.pine']) {
  const p = join(ROOT, 'pine', 'dist', f)
  check(`${f} ton tai`, existsSync(p))
  if (!existsSync(p)) continue

  const src = readFileSync(p, 'utf8')
  check(`${f} dong dau la //@version=6`, src.startsWith('//@version=6'), JSON.stringify(src.slice(0, 18)))
  check(`${f} co khai bao indicator/strategy`, /^(indicator|strategy)\(/m.test(src))
  check(`${f} da thay {{DECL}}`, !src.includes('{{DECL}}'))
  check(`${f} co alertcondition`, src.includes('alertcondition('))
  check(`${f} ngoac doi chieu`, (src.match(/\(/g) || []).length === (src.match(/\)/g) || []).length)
  check(`${f} khong canh bao lint`, lint(src, f).length === 0, JSON.stringify(lint(src, f)))
}

const sig = readFileSync(join(ROOT, 'pine', 'dist', 'tm-signals.pine'), 'utf8')
const bts = readFileSync(join(ROOT, 'pine', 'dist', 'tm-backtest.pine'), 'utf8')

check('indicator: co dashboard', sig.includes('table.new('))
check('indicator: KHONG goi strategy.entry', !sig.includes('strategy.entry('))
check('strategy: co lenh lenh trading', bts.includes('strategy.entry(') && bts.includes('strategy.exit('))
check('strategy: KHONG ve dashboard', !bts.includes('table.new('))

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
const server = createNotifyServer({ logFile, quiet: true, token: TOKEN })
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

const noTokServer = createNotifyServer({ logFile: join(tmpLog, 'no-token.ndjson'), quiet: true, token: '' })
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

await new Promise((r) => server.close(r))
rmSync(tmpLog, { recursive: true, force: true })

// =============================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
