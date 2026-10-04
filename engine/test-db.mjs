#!/usr/bin/env node
// =============================================================================
//  TM TRADING - TEST TANG DU LIEU (MongoDB that)
//
//  Khac engine/test.mjs (chay hoan toan khong can dich vu ngoai), file nay can
//  MongoDB. Neu khong ket noi duoc -> in SKIP va exit 0, de `npm test` van xanh
//  tren may chua dung Mongo. SKIP duoc in RAT RO de khong am tham bo qua.
//
//  Dieu quan trong nhat duoc kiem o day la D4: unique index tren alertKey phai
//  THUC SU chan ban ghi trung - day la thu thay the cho `Map` trong RAM.
// =============================================================================

import { connectMongo, disconnectMongo, mongoStatus } from './db.mjs'
import { alertKey, clientOrderId } from './keys.mjs'
import { runStamp } from './version.mjs'
import { Run, Trade, Alert, Signal, Position, RiskState, Equity } from './models/index.mjs'
import mongoose from 'mongoose'

const DB_NAME = 'tm-trading-test'
const URI = process.env.MONGODB_TEST_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`

// CHONG ROI RA DB THAT. `server/webhook.mjs` goi `loadEnv()` ngay khi import va
// dien `MONGODB_URI` tu `.env` (DB that `tm-trading`). `mongoDedupe()` sau do goi
// `connectMongo()` -> thay URI khac -> dong ket noi test va ket noi lai vao DB
// that -> cac lenh `dropDatabase()`/query cuoi file loi "Client must be connected"
// va alert test bi ghi vao DB that. Ghim URI TRUOC khi import webhook (loadEnv
// chi set khi undefined) -> dedupe van dung chung ket noi test.
process.env.MONGODB_URI = URI

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

process.on('uncaughtException', (e) => {
  fail++
  console.log(`  FAIL (nem loi ngoai du kien) — ${e && e.message}`)
  console.log(`\nFAIL — ${pass} pass, ${fail} fail\n`)
  process.exit(1)
})

// =============================================================================
section('0. ket noi (fail-soft dung nhu thiet ke)')

// Khong co URI -> tra null, KHONG nem (roadmap: NDJSON luon ghi, Mongo la tuy chon)
const none = await connectMongo('')
check('khong co URI -> tra null, khong nem', none === null)

const conn = await connectMongo(URI, { serverSelectionTimeoutMS: 3000 })
if (!conn) {
  console.log('\n  SKIP — khong ket noi duoc MongoDB tai ' + URI)
  console.log('  SKIP — day KHONG phai pass. Chay lai khi Mongo san sang de kiem D4 that.\n')
  process.exit(0)
}

const status = await mongoStatus()
check('ket noi duoc + ping OK', status.connected === true, JSON.stringify(status))

// DB rieng cho test: xoa sach truoc khi kiem
const db = mongoose.connection.db
await db.dropDatabase()

// =============================================================================
section('1. D4 — dedupe BEN VUNG (thay cho Map trong RAM)')

await Alert.syncIndexes() // tao index unique truoc khi kiem

const base = {
  v: 1,
  ts: '2026-10-01T03:17:21Z',
  symbol: 'BTCUSDT',
  tf: '15',
  mode: 'closed',
  action: 'ENTRY',
  side: 'BUY',
  price: 63250.5,
  sl: 63012.1,
  tps: [63655.0],
  atr: 238.4,
  conf: 0.72,
}

const key1 = alertKey(base, 'tradingview')
await Alert.create({ ...base, ts: new Date(base.ts), alertKey: key1 })
check('alert dau tien ghi duoc', (await Alert.countDocuments()) === 1)

// Retry y nguyen payload -> phai bi chan boi unique index
let dupErr = null
try {
  await Alert.create({ ...base, ts: new Date(base.ts), alertKey: key1 })
} catch (e) {
  dupErr = e
}
check('retry CUNG payload -> bi chan (khong tao ban ghi thu 2)', dupErr !== null && dupErr.code === 11000, `code=${dupErr?.code}`)
check('van chi co 1 ban ghi', (await Alert.countDocuments()) === 1, `count=${await Alert.countDocuments()}`)

// Payload khac gia -> khoa khac -> phai ghi duoc (khong chan nham)
const key2 = alertKey({ ...base, price: 63251.5 }, 'tradingview')
check('gia khac -> khoa khac', key1 !== key2)
await Alert.create({ ...base, price: 63251.5, ts: new Date(base.ts), alertKey: key2 })
check('payload khac -> ghi duoc', (await Alert.countDocuments()) === 2)

// Dao thu tu key trong payload -> VAN cung khoa (nho stableStringify)
const reordered = { price: base.price, side: base.side, action: base.action, tf: base.tf, symbol: base.symbol, ts: base.ts, mode: base.mode, v: base.v }
check('dao thu tu key -> cung alertKey', alertKey(reordered, 'tradingview') === key1)

// Nguon khac -> khoa khac (Phase 8: scanner/AI cung gui alert)
check('khac nguon -> khac khoa', alertKey(base, 'scanner') !== key1)

// ts / price vo ly -> phai nem loi, khong duoc sinh khoa rac
let threwTs = false
try { alertKey({ ...base, ts: 'khong-phai-ngay' }) } catch { threwTs = true }
check('ts khong hop le -> nem loi', threwTs)

// =============================================================================
section('2. D3 — idempotency tang LENH')

const cid = clientOrderId(key1, 0)
check('clientOrderId tat dinh', cid === clientOrderId(key1, 0))
check('clientOrderId <= 31 ky tu (gioi han MT5)', cid.length <= 31, `len=${cid.length}`)
check('clientOrderId chi gom ky tu an toan', /^[A-Za-z0-9_-]+$/.test(cid), cid)
check('seq khac -> id khac', clientOrderId(key1, 0) !== clientOrderId(key1, 1))

// =============================================================================
section('3. D1 — run/trade mang day du danh tinh')

const bars = [
  { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  { time: 2, open: 1.5, high: 2.5, low: 1.4, close: 2.2, volume: 12 },
]
const stamp = runStamp({
  params: { rP: 2.2 },
  bars,
  symbol: 'BTCUSDT',
  tf: '15',
  market: 'fapi',
  universeSnapshot: { source: 'fapi', takenAt: '2026-10-01', symbols: ['BTCUSDT'] },
})
const run = await Run.create({ ...stamp, from: new Date(0), to: new Date(1000), bars: bars.length, stats: { trades: 1, netPct: 5.5 } })
check('run co paramsHash + dataHash + engineVersion', !!run.paramsHash && !!run.dataHash && !!run.engineVersion)
check('universeSnapshot nguyen ven (Mixed)', run.universeSnapshot?.symbols?.[0] === 'BTCUSDT')

const trade = await Trade.create({
  runId: run._id,
  paramsHash: stamp.paramsHash,
  engineVersion: stamp.engineVersion,
  symbol: 'BTCUSDT',
  tf: '15',
  dir: 1,
  entryTime: new Date(10),
  entryPrice: 100,
  exitTime: new Date(20),
  exitPrice: 105,
  sl: 98,
  tp: 105,
  result: 'TP',
  pnlPct: 5,
  rMultiple: 2.5,
})
check('trade gan duoc runId', String(trade.runId) === String(run._id))

// Truy van nong nhat cua dashboard: run moi nhat theo symbol x tf
await Run.create({ ...stamp, symbol: 'BTCUSDT', tf: '15', createdAt: new Date(Date.now() + 5000), stats: { netPct: 9.9 } })
const latest = await Run.find({ symbol: 'BTCUSDT', tf: '15' }).sort({ createdAt: -1 }).limit(1).lean()
check('truy van "run moi nhat theo symbol x tf" dung', latest[0]?.stats?.netPct === 9.9, `netPct=${latest[0]?.stats?.netPct}`)

// Loc theo the he engine (D1: khong tron ket qua giua cac phien ban)
const sameGen = await Run.countDocuments({ paramsHash: stamp.paramsHash, engineVersion: stamp.engineVersion })
check('loc duoc theo (paramsHash, engineVersion)', sameGen === 2, `count=${sameGen}`)

// =============================================================================
section('4. D7b — risk_state: mot ban ghi cho moi (account, ngay UTC)')

await RiskState.syncIndexes()
const day = '2026-10-01'
await RiskState.create({ account: 'paper-1', utcDay: day, realizedPnlPct: -1.5, tradesClosed: 3 })
let dupDay = null
try {
  await RiskState.create({ account: 'paper-1', utcDay: day })
} catch (e) { dupDay = e }
check('trung (account, ngay) -> bi chan', dupDay?.code === 11000, `code=${dupDay?.code}`)

// Upsert tang bo dem - dung y nhu risk gate se lam
await RiskState.updateOne(
  { account: 'paper-1', utcDay: day },
  { $inc: { tradesClosed: 1, realizedPnlPct: -0.5 } },
  { upsert: true },
)
const rs = await RiskState.findOne({ account: 'paper-1', utcDay: day }).lean()
check('upsert $inc cong don dung', rs.tradesClosed === 4 && Math.abs(rs.realizedPnlPct + 2.0) < 1e-9, JSON.stringify({ t: rs.tradesClosed, p: rs.realizedPnlPct }))

// =============================================================================
section('5. Cac model con lai ghi/doc duoc')

await Signal.create({ ts: new Date(1), symbol: 'BTCUSDT', tf: '15', type: 'SV', price: 100, meta: { bucket: 'TIM', ratio: 3 } })
check('Signal ghi duoc', (await Signal.countDocuments()) === 1)

// enum phai chan type la
let badType = null
try { await Signal.create({ ts: new Date(1), symbol: 'X', tf: '15', type: 'KHONG-TON-TAI' }) } catch (e) { badType = e }
check('Signal chan type khong hop le', badType !== null)

await Position.create({ account: 'paper-1', symbol: 'BTCUSDT', dir: 1, qty: 0.01, entryPrice: 100, entryTime: new Date(1) })
check('Position ghi duoc', (await Position.countDocuments()) === 1)
let badDir = null
try { await Position.create({ account: 'p', symbol: 'X', dir: 5, qty: 1, entryPrice: 1, entryTime: new Date(1) }) } catch (e) { badDir = e }
check('Position chan dir khong hop le', badDir !== null)

await Equity.create({ account: 'paper-1', ts: new Date(1), equity: 10000 })
check('Equity ghi duoc', (await Equity.countDocuments()) === 1)

// =============================================================================
section('6. Index da duoc tao dung nhu data-model.md')

// syncIndexes() TRUOC khi doc: mongoose build index bat dong bo, doc ngay se thay
// trang thai nua voi (da dinh mot lan: index symbol+tf+createdAt chua kip tao).
for (const M of [Run, Trade, Alert, Signal, Position, RiskState, Equity]) {
  await M.syncIndexes()
}

const idx = async (M) => (await M.collection.indexes()).map((i) => Object.keys(i.key).join('+') + (i.unique ? ' [unique]' : ''))
const alertIdx = await idx(Alert)
check('alerts co unique index tren alertKey', alertIdx.some((s) => s.startsWith('alertKey') && s.includes('[unique]')), alertIdx.join(' | '))
const runIdx = await idx(Run)
check('runs co index symbol+tf+createdAt', runIdx.some((s) => s === 'symbol+tf+createdAt'), runIdx.join(' | '))
check('runs co index paramsHash+engineVersion', runIdx.some((s) => s === 'paramsHash+engineVersion'), runIdx.join(' | '))
const rsIdx = await idx(RiskState)
check('risk_state co unique index account+utcDay', rsIdx.some((s) => s === 'account+utcDay [unique]'), rsIdx.join(' | '))
const posIdx = await idx(Position)
check('positions co unique sparse externalId', posIdx.some((s) => s.includes('externalId') && s.includes('[unique]')), posIdx.join(' | '))

// =============================================================================
section('7. D4 — dedupe bang alerts unique index (thay cho Map trong RAM)')

// Day la phan quan trong nhat cua Phase 6 (D4): neu chi co unique index ma
// webhook khong DUNG, thi van la Map trong RAM. Test nay chay dung duong that.
const { mongoDedupe, toAlertDoc, sourceOf, validate } = await import('../server/webhook.mjs')
const { alertKey: ak } = await import('../engine/keys.mjs')

// Van de da gap truoc day: import webhook -> loadEnv() dien MONGODB_URI tu .env
// -> ket noi bi doi sang DB that giua chung. Kiem ro rang dang o DB test.
check('van ket noi DB test sau khi import webhook', mongoose.connection.name === DB_NAME, mongoose.connection.name)

const dedupe = mongoDedupe()
check('mongoDedupe bao minh la che do ben vung', dedupe.kind === 'mongo')

const p = {
  v: 1, ts: '2026-10-02T09:15:00Z', symbol: 'ETHUSDT', tf: '15', mode: 'closed',
  action: 'ENTRY', side: 'BUY', price: 3800, sl: 3775, tps: [3860, 3920],
}
const src = sourceOf(p)
const k = ak(p, src)
check('sourceOf: thieu source -> tradingview', src === 'tradingview')
check('sourceOf: source rong/khong hop le -> nem loi', (() => { try { sourceOf({ source: 'x y' }); return false } catch { return true } })())

const first = await dedupe.claim(k, toAlertDoc(p, src))
check('claim lan dau -> moi, durable', first.duplicate === false && first.durable === true, JSON.stringify(first))
check('alert da xuong collection alerts', (await Alert.countDocuments({ alertKey: k })) === 1)

// Retry - cung khoa. Day chinh la truong hop restart tung bi mat trang thai.
const retry = await dedupe.claim(k, toAlertDoc(p, src))
check('retry CUNG payload -> duplicate VAN BEN VUNG', retry.duplicate === true && retry.durable === true, JSON.stringify(retry))
check('van chi co 1 ban ghi (khong tao lenh thu 2)', (await Alert.countDocuments({ alertKey: k })) === 1)

// TP1/TP2 cung bar: khac level -> khac khoa -> phai ghi duoc ca 2
const tp1 = { ...p, action: 'TAKE_PROFIT', level: 1, ts: '2026-10-02T09:16:00Z' }
const tp2 = { ...tp1, level: 2 }
const cTp1 = await dedupe.claim(ak(tp1, 'tradingview'), toAlertDoc(tp1, 'tradingview'))
const cTp2 = await dedupe.claim(ak(tp2, 'tradingview'), toAlertDoc(tp2, 'tradingview'))
check('TP1 va TP2 cung bar -> ca 2 deu ghi duoc', cTp1.duplicate === false && cTp2.duplicate === false,
  JSON.stringify({ cTp1, cTp2 }))

// Nguon thu hai khong bi chan nham
const scanner = { ...p, action: 'ENTRY', ts: '2026-10-02T09:15:00Z' }
const cScan = await dedupe.claim(ak(scanner, 'scanner'), toAlertDoc(scanner, 'scanner'))
check('nguon scanner cung su kien -> khong bi chan nham', cScan.duplicate === false, JSON.stringify(cScan))

// Xac nhan validate duong that (khong qua HTTP) van nhan payload nay
check('validate van dong y payload da luu', validate(p).ok)

// Restart ao: dedupe MOI phai van doc duoc trang thai tu collection
const fresh = mongoDedupe()
const afterRestart = await fresh.claim(k, toAlertDoc(p, src))
check('dedupe MOI (mo phong restart) van nhan trung', afterRestart.duplicate === true, JSON.stringify(afterRestart))

// =============================================================================
section('7b. Phase 6 — dich alert -> signals (song song NDJSON)')

const { toSignalDoc, writeSignal } = await import('../server/webhook.mjs')

const sigDoc = toSignalDoc(p, src, k)
check('ENTRY BUY -> signal type ST LONG + giu alertKey', sigDoc?.type === 'ST LONG' && sigDoc?.alertKey === k && sigDoc?.method === 'vsa', JSON.stringify(sigDoc))
check('ENTRY SELL -> ST SHORT', toSignalDoc({ ...p, side: 'SELL' }, src, k)?.type === 'ST SHORT')
check('co event hop le -> dung event (khong suy tu side)', toSignalDoc({ ...p, event: 'NS' }, src, k)?.type === 'NS')
check('event lai -> lui ve side', toSignalDoc({ ...p, event: 'KHONG' }, src, k)?.type === 'ST LONG')
check('TP/SL/TIME_CLOSE khong phai su kien -> null',
  toSignalDoc({ ...p, action: 'TAKE_PROFIT' }, src, k) === null
  && toSignalDoc({ ...p, action: 'STOP_LOSS' }, src, k) === null
  && toSignalDoc({ ...p, action: 'TIME_CLOSE' }, src, k) === null)
check('thieu symbol/tf -> khong dich duoc (null)', toSignalDoc({ ...p, symbol: undefined }, src, k) === null)

check('writeSignal(null) -> skip (khong ghi rac)', await writeSignal(null) === 'skip')
check('writeSignal(doc) -> written', await writeSignal(sigDoc) === 'written')
check('signal xuong collection signals', (await Signal.countDocuments({ alertKey: k })) === 1)

// =============================================================================
section('8. D2 — thoi gian: UTC ms, khong gio dia phuong')

// D2: "Moi thu luu UTC ms; so sanh phien quy doi tz tuong minh; KHONG luu gio
// dia phuong". Bay that: test chay tren may co tz khac thi van phai ra cung ket qua.
{
  const alert = await Alert.findOne({ alertKey: k }).lean()
  check('alert.ts luu thanh Date (Mongo UTC ms)', alert?.ts instanceof Date || typeof alert?.ts === 'number', typeof alert?.ts)
  const back = new Date(alert.ts)
  check('alert.ts doc ra van la UTC dung (khong lech do tz may chay)',
    back.toISOString() === new Date(p.ts).toISOString(), `${back.toISOString()} vs ${new Date(p.ts).toISOString()}`)
  check('alert.ts khong mang offset dia phuong', back.toISOString().endsWith('Z'))

  // utcDay (risk_state) la chuoi YYYY-MM-DD theo UTC - khoa ngay ro rang,
  // khong phu thuoc mui gio may chay. 23:59 UTC van la cung ngay, 00:01 UTC sang ngay khac.
  check('utcDay 23:59 UTC -> cung ngay', new Date(Date.UTC(2026, 9, 1, 23, 59)).toISOString().slice(0, 10) === '2026-10-01')
  check('utcDay 00:01 UTC -> sang ngay khac', new Date(Date.UTC(2026, 9, 2, 0, 1)).toISOString().slice(0, 10) === '2026-10-02')

  // NDJSON (store) cung vay: ISO-8601 Z, khong phu thuoc tz
  const { withStamp } = await import('../engine/store.mjs')
  const s = withStamp({ symbol: 'BTCUSDT', tf: '15', params: { rP: 2.2 } })
  check('store.createdAt la ISO Z (D2)', typeof s.createdAt.toISOString() === 'string' && s.createdAt.toISOString().endsWith('Z'), s.createdAt.toISOString())
}

// =============================================================================
await db.dropDatabase() // khong de lai rac
await disconnectMongo()
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)