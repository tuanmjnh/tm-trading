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
import { Run, Trade, Alert, Signal, Position, RiskState, Equity, TradingDomainEvent } from './models/index.mjs'
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
for (const M of [Run, Trade, Alert, Signal, Position, RiskState, Equity, TradingDomainEvent]) {
  await M.syncIndexes()
}

const idx = async (M) => (await M.collection.indexes()).map((i) => Object.keys(i.key).join('+') + (i.unique ? ' [unique]' : ''))
const alertIdx = await idx(Alert)
check('alerts co unique index tren ownerId+alertKey', alertIdx.some((s) => s === 'ownerId+alertKey [unique]'), alertIdx.join(' | '))
const runIdx = await idx(Run)
check('runs co index symbol+tf+createdAt', runIdx.some((s) => s === 'symbol+tf+createdAt'), runIdx.join(' | '))
check('runs co index paramsHash+engineVersion', runIdx.some((s) => s === 'paramsHash+engineVersion'), runIdx.join(' | '))
const rsIdx = await idx(RiskState)
check('risk_state co unique index ownerId+account+utcDay', rsIdx.some((s) => s === 'ownerId+account+utcDay [unique]'), rsIdx.join(' | '))
const posIdx = await idx(Position)
check('positions co unique sparse externalId', posIdx.some((s) => s.includes('externalId') && s.includes('[unique]')), posIdx.join(' | '))
const tdeIdx = await idx(TradingDomainEvent)
check('trading_domain_events co index ownerId+status+emittedAt', tdeIdx.some((s) => s === 'ownerId+status+emittedAt'), tdeIdx.join(' | '))
check('trading_domain_events ownerId duoc danh index', tdeIdx.some((s) => s === 'ownerId'), tdeIdx.join(' | '))
const sigIdx = await idx(Signal)
check('signals has a partial unique index on ownerId+signalKey (Phase D)', sigIdx.some((s) => s === 'ownerId+signalKey [unique]'), sigIdx.join(' | '))
check('signals index makes attribution.strategyVersion queryable', sigIdx.some((s) => s === 'attribution.strategyVersion'), sigIdx.join(' | '))

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
section('9. Phase C — outbox su kien trading (idempotent, khong mat khi restart)')

// Outbox §61.17 Phase C: moi su kien trading duoc ghi BEN VUNG va IDEMPOTENT
// (id tat dinh), de view nao cung hoi phuc duoc sau refresh/restart.
const ws = await import('../services/workspaceStore.mjs')
const tde = await import('../engine/tradingDomainEvents.mjs')

const EV_OWNER = 'owner-phasec'
const EV_AT = Date.parse('2026-10-19T10:00:00Z')
const built = tde.tradingDomainEvent({ type: 'order.filled', entityId: 'ord-1', ownerId: EV_OWNER, accountId: 'paper', at: EV_AT })

check('emit lan dau -> true', (await ws.emitTradingEvent({ type: 'order.filled', entityId: 'ord-1', ownerId: EV_OWNER, accountId: 'paper', at: EV_AT })) !== null)
check('emit CUNG su kien -> khong nhan doi', (await TradingDomainEvent.countDocuments({ _id: built._id })) === 1)

// Emit lai (retry / restart) -> van 1 dong, KHONG reset trang thai giao hang
await ws.markDelivered([built._id])
await ws.emitTradingEvent({ type: 'order.filled', entityId: 'ord-1', ownerId: EV_OWNER, accountId: 'paper', at: EV_AT })
const redelivered = await TradingDomainEvent.findById(built._id).lean()
check('emit lai KHONG reset trang thai da giao (idempotent that)', redelivered?.status === 'delivered', `status=${redelivered?.status}`)

// Tenancy: pending chi tra ve chu so huu
await ws.emitTradingEvent({ type: 'position.opened', entityId: 'pos-1', ownerId: 'owner-other', at: EV_AT })
check('pendingForOwner chi tra ve su kien cua minh', (await ws.pendingForOwner('owner-other')).length === 1)
check('owner khac khong thay su kien (tenancy)', (await ws.pendingForOwner('owner-nobody')).length === 0)

// viewKeysFor: tap view can lam moi
const pendingOther = await ws.pendingForOwner('owner-other')
check('viewsForEvents dung view cua su kien', JSON.stringify(ws.viewsForEvents(pendingOther)) === JSON.stringify(['positions', 'accounts']))

// markFailed -> dead-letter/reporting dem dung
await ws.markFailed('tde_khong_ton_tai', { error: 'probe' })
await ws.emitTradingEvent({ type: 'signal.received', entityId: 'sig-1', ownerId: 'owner-other', at: EV_AT })
const failed = await ws.markFailed((await ws.pendingForOwner('owner-other')).find((e) => e.type === 'signal.received')._id, { error: 'boom' })
check('markFailed -> true', failed === true)
const stats = await ws.outboxStats('owner-other')
check('outboxStats dem pending/failed dung', stats.pending === 1 && stats.failed === 1, JSON.stringify(stats))

// Ack chi ap dung cho chu so huu (tenancy §61.3): mot caller khong the danh dau
// da giao su kien cua nguoi khac.
await ws.emitTradingEvent({ type: 'order.created', entityId: 'ord-ack', ownerId: 'owner-a', at: EV_AT })
const ackEvent = await TradingDomainEvent.findOne({ 'entityRef.id': 'ord-ack' }).lean()
check('markDeliveredForOwner bo qua event cua nguoi khac', (await ws.markDeliveredForOwner('owner-b', [ackEvent._id])) === 0)
check('markDeliveredForOwner ack event cua chinh minh', (await ws.markDeliveredForOwner('owner-a', [ackEvent._id])) === 1)

// Mongoose chan su kien thieu ownerId (tenancy §61.3)
let badOwner = null
try { await TradingDomainEvent.create({ ...built, _id: 'tde_x', eventId: 'tde_x', ownerId: undefined }) } catch (e) { badOwner = e }
check('trading_domain_events chan ban ghi thieu ownerId', badOwner !== null)

// Acceptance (§61.17 Phase C): ONE manual paper order produces the canonical
// event set (account -> order -> fill -> position) for a single owner. Every
// relevant view is invalidated, the batch is acknowledged, and the rows stay
// durable in Mongo — so a restart replays nothing and loses nothing.
const ACC_OWNER = 'owner-accept'
const ACC_T = Date.parse('2026-10-19T11:00:00Z')
for (const input of [
  { type: 'account.created', entityId: 'acc-1', accountId: 'acc-1' },
  { type: 'order.created', entityId: 'ord-9', accountId: 'acc-1' },
  { type: 'fill.recorded', entityId: 'fill-9', accountId: 'acc-1' },
  { type: 'order.filled', entityId: 'ord-9', accountId: 'acc-1' },
  { type: 'position.opened', entityId: 'pos-9', accountId: 'acc-1' }
]) {
  await ws.emitTradingEvent({ ...input, ownerId: ACC_OWNER, at: ACC_T })
}
const accPending = await ws.pendingForOwner(ACC_OWNER)
check('one paper order emits the full canonical event set', accPending.length === 5, `n=${accPending.length}`)
const accViews = ws.viewsForEvents(accPending)
check(
  'a single order invalidates orders + positions + accounts',
  ['orders', 'positions', 'accounts'].every((v) => accViews.includes(v)),
  accViews.join(',')
)
check('ack the batch -> 5 delivered', (await ws.markDeliveredForOwner(ACC_OWNER, accPending.map((e) => e._id))) === 5)
check('after ack the owner has no pending events', (await ws.pendingForOwner(ACC_OWNER)).length === 0)
check('rows stay durable after ack (restart loses nothing)', (await TradingDomainEvent.countDocuments({ ownerId: ACC_OWNER })) === 5)

// =============================================================================
section('10. Phase D — native signal engine persists attributed signals idempotently')

// Acceptance (§61.17 Phase D): a controlled fixture deterministically produces a
// signal whose method/indicator/strategy version is QUERYABLE, and duplicate
// events do NOT duplicate the signal. This runs the real store against Mongo.
const sigEngine = await import('../engine/signalEngine.mjs')
const sigStore = await import('../services/signalStore.mjs')

// Same loose thresholds as engine/test.mjs so the SV -> ST LONG path is the only
// thing the fixture exercises (VSA arithmetic is pinned there, not here).
const PD_LOOSE = { len: 5, pivLen: 3, lvFresh: 1000, lvTol: 1000, retestT: 1000, run: 5, atrLen: 5, entryMode: 'limit', tpMode: 'pivot' }
function pdBars() {
  const closes = []
  for (let i = 0; i < 16; i++) closes.push(110 - i)
  for (const c of [97, 99, 98.5, 97.8, 97.2, 96.4, 96.5, 96.8]) closes.push(c)
  const volumes = new Array(closes.length).fill(100)
  volumes[22] = 600
  const wick = 0.5
  const baseTime = Date.UTC(2026, 0, 5, 0, 0, 0)
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]
    const up = c >= o
    return { time: baseTime + i * 300000, open: o, high: up ? c + wick : o, low: up ? o : c - wick, close: c, volume: volumes[i] ?? 100 }
  })
}

const PD_OWNER = 'owner-phased'
const pdBarset = pdBars()
const pdInput = { bars: pdBarset, method: 'vsa', params: PD_LOOSE, symbol: 'XAUUSD', tf: '5m', ownerId: PD_OWNER }
const pdDocs = sigEngine.generateSignals(pdInput)
check(
  'a controlled fixture deterministically produces signals',
  pdDocs.length === 2 && pdDocs[0].type === 'SV' && pdDocs[1].type === 'ST LONG',
  pdDocs.map((d) => d.type).join(','),
)
check(
  'every signal carries traceable method/strategy/engine attribution',
  pdDocs.every(
    (d) => d.attribution?.method && d.attribution?.methodVersion && d.attribution?.strategyVersion && d.attribution?.engineVersion && /^[0-9a-f]{64}$/.test(d.attribution?.paramsHash),
  ),
)

check('publishSignals stores the new signals', (await sigStore.publishSignals(pdDocs)) === 2)
check('signals row count matches the fixture', (await Signal.countDocuments({ ownerId: PD_OWNER })) === 2)

// Re-generate + re-publish the SAME events (replay/retry) -> still 2 rows.
await sigStore.publishSignals(sigEngine.generateSignals(pdInput))
check('duplicate events do not duplicate the signal', (await Signal.countDocuments({ ownerId: PD_OWNER })) === 2)

// A second plain insert with the same key is refused by the unique index.
let pdDup = null
try { await Signal.create({ ...pdDocs[0] }) } catch (e) { pdDup = e }
check('unique index blocks a second row with the same (ownerId, signalKey)', pdDup?.code === 11000, `code=${pdDup?.code}`)

// Version is queryable from the stored rows.
const byStrategy = await sigStore.findSignalsByAttribution(PD_OWNER, { strategyVersion: pdDocs[0].attribution.strategyVersion })
check('signal version is queryable by strategyVersion', byStrategy.length === 2, `n=${byStrategy.length}`)
const byHash = await sigStore.findSignalsByAttribution(PD_OWNER, { paramsHash: pdDocs[0].attribution.paramsHash })
check('signal version is queryable by paramsHash', byHash.length === 2, `n=${byHash.length}`)
const byKey = await sigStore.findSignalByKey(PD_OWNER, pdDocs[1].signalKey)
check('signal is retrievable by its durable key', byKey?.type === 'ST LONG')

// Tenancy: the SAME fixture for another owner is a distinct signal set.
const PD_OTHER = 'owner-phased-other'
await sigStore.publishSignals(sigEngine.generateSignals({ ...pdInput, ownerId: PD_OTHER }))
check('another owner keeps its own signal rows (tenancy)', (await Signal.countDocuments({ ownerId: PD_OTHER })) === 2)
check('the first owner is unaffected by the second', (await Signal.countDocuments({ ownerId: PD_OWNER })) === 2)

// Legacy webhook rows (no signalKey) must still write under the partial index.
const pdLegacy = await Signal.create({ ts: new Date(1), symbol: 'ETHUSDT', tf: '15', type: 'SV' })
check('legacy signal without a signalKey still writes (partial index)', !!pdLegacy._id)

// =============================================================================
section('11. Phase E — owner lease, durable commands and instance recovery (E2)')

const { BotInstance: PEInstance } = await import('../engine/models/botInstance.mjs')
const { BotCommand: PECommand } = await import('../engine/models/botCommand.mjs')
const runtimeStore = await import('../services/botRuntimeStore.mjs')

const PE_OWNER = 'owner-phasee-lease'
const PE_A = 'bot_phasee_a'
const PE_B = 'bot_phasee_b'
const PE_T0 = Date.now()

await PEInstance.create({
  _id: PE_A,
  instanceId: PE_A,
  ownerId: PE_OWNER,
  accountId: 'default',
  botProfileId: 'bp_phasee',
  state: 'running',
  createdAt: PE_T0,
  createdBy: 'test-db',
})
await PEInstance.create({
  _id: PE_B,
  instanceId: PE_B,
  ownerId: PE_OWNER,
  accountId: 'default',
  botProfileId: 'bp_phasee',
  state: 'queued',
  createdAt: PE_T0 + 1,
  createdBy: 'test-db',
  demo: true,
})

const lease1 = await runtimeStore.claimSupervisorLease({ ownerId: PE_OWNER, supervisorId: 'sup_one', now: PE_T0, ttlMs: 30_000 })
check('the first supervisor claims the owner lease', lease1.ok === true && lease1.lease?.supervisorId === 'sup_one')
const lease2 = await runtimeStore.claimSupervisorLease({ ownerId: PE_OWNER, supervisorId: 'sup_two', now: PE_T0 + 1000, ttlMs: 30_000 })
check('a second supervisor cannot steal a live lease', lease2.ok === false && lease2.code === 'lease_held')
const renewed = await runtimeStore.renewSupervisorLease({ ownerId: PE_OWNER, supervisorId: 'sup_one', now: PE_T0 + 2000, ttlMs: 30_000 })
check('the holder renews its own lease', renewed.ok === true)
const stolen = await runtimeStore.claimSupervisorLease({ ownerId: PE_OWNER, supervisorId: 'sup_two', now: PE_T0 + 40_000, ttlMs: 30_000 })
check('an expired lease becomes claimable by another supervisor', stolen.ok === true && stolen.lease?.supervisorId === 'sup_two')

const cmd = await runtimeStore.enqueueCommand({ ownerId: PE_OWNER, instanceId: PE_A, type: 'pause', commandId: 'pe-cmd-1', requestedAt: PE_T0 })
const dupCmd = await runtimeStore.enqueueCommand({ ownerId: PE_OWNER, instanceId: PE_A, type: 'pause', commandId: 'pe-cmd-1', requestedAt: PE_T0 + 1 })
check('a command is enqueued once', cmd.ok === true && cmd.duplicate === false)
check('a retried command id is deduped, not duplicated', dupCmd.ok === true && dupCmd.duplicate === true && (await PECommand.countDocuments({ ownerId: PE_OWNER, commandId: 'pe-cmd-1' })) === 1)

const applied = await runtimeStore.markCommandApplied({ ownerId: PE_OWNER, commandId: 'pe-cmd-1', supervisorId: 'sup_two', now: PE_T0 + 2 })
const appliedTwice = await runtimeStore.markCommandApplied({ ownerId: PE_OWNER, commandId: 'pe-cmd-1', supervisorId: 'sup_one', now: PE_T0 + 3 })
check('only one worker can acknowledge a pending command', applied === true && appliedTwice === false)

const moved = await runtimeStore.transitionInstance({ ownerId: PE_OWNER, instanceId: PE_B, from: 'queued', to: 'starting', now: PE_T0 + 4 })
const staleMove = await runtimeStore.transitionInstance({ ownerId: PE_OWNER, instanceId: PE_B, from: 'queued', to: 'starting', now: PE_T0 + 5 })
check('instance transitions are compare-and-swap guarded', moved === true && staleMove === false)

const attached = await runtimeStore.attachInstanceLease({ ownerId: PE_OWNER, instanceId: PE_A, supervisorId: 'sup_two', now: PE_T0 + 6, ttlMs: 30_000 })
const wrongBeat = await runtimeStore.beatInstance({ ownerId: PE_OWNER, instanceId: PE_A, supervisorId: 'sup_one', patch: {}, now: PE_T0 + 7 })
const rightBeat = await runtimeStore.beatInstance({
  ownerId: PE_OWNER,
  instanceId: PE_A,
  supervisorId: 'sup_two',
  patch: { engineVersion: 'test-1', subscriptions: ['BTCUSDT'], health: 'ok' },
  now: PE_T0 + 8,
  ttlMs: 30_000,
})
check('only the lease holder may beat an instance', attached === true && wrongBeat === false && rightBeat === true)
const beatDoc = await runtimeStore.findOwnedInstance(PE_OWNER, PE_A)
check(
  'heartbeat persists engine version, subscriptions and a fresh lease',
  beatDoc?.engineVersion === 'test-1' && beatDoc?.subscriptions?.[0] === 'BTCUSDT' && beatDoc?.lease?.expiresAt === PE_T0 + 30_008,
)

check('another owner cannot read the instance', (await runtimeStore.findOwnedInstance('owner-someone-else', PE_A)) === null)
check('demo rows never appear in the operational list', (await runtimeStore.listOwnedInstances(PE_OWNER)).every((i) => i.demo !== true))
check('boot recovery fails an orphaned instance with an explicit reason', (await runtimeStore.recoverOwnedInstances({ ownerId: PE_OWNER, now: PE_T0 + 60_000 })).length >= 1)
const recovered = await runtimeStore.findOwnedInstance(PE_OWNER, PE_A)
check('the orphan is FAILED with lease_expired, never silently RUNNING', recovered?.state === 'failed' && recovered?.healthReason === 'lease_expired' && recovered?.lease?.supervisorId == null)

// =============================================================================
section('12. Phase E — supervisor worker applies commands and owns session state')

const { createBotWorker } = await import('../services/botWorker.mjs')
const { TradingSession: PEWSession } = await import('../engine/models/session.mjs')

const PEW_OWNER = 'owner-phasee-worker'
const PEW_ID = 'bot_phasee_worker_1'
const PEW_T0 = Date.now()
const PEW_NOW = () => PEW_T0

await PEInstance.create({
  _id: PEW_ID,
  instanceId: PEW_ID,
  ownerId: PEW_OWNER,
  accountId: 'default',
  botProfileId: 'bp_phasee',
  state: 'queued',
  createdAt: PEW_T0,
  createdBy: 'test-db',
})

const worker = createBotWorker({ ownerId: PEW_OWNER, nonce: 'test', now: PEW_NOW, log: { log() {}, warn() {} } })
const workerBoot = await worker.boot()
check('worker claims the owner lease and boots', workerBoot.ok === true && worker.claimed === true)

await runtimeStore.enqueueCommand({ ownerId: PEW_OWNER, instanceId: PEW_ID, type: 'start', commandId: 'pew-start', requestedAt: PEW_T0 })
await worker.applyPendingCommands()
const started = await runtimeStore.findOwnedInstance(PEW_OWNER, PEW_ID)
check('a start command creates a live-paper session and RUNNING instance', started?.state === 'running' && typeof started?.sessionId === 'string')
const startedSession = started?.sessionId ? await PEWSession.findOne({ sessionId: started.sessionId }).lean() : null
check('the session is persisted and owned by the same owner/account', startedSession?.state === 'running' && startedSession?.ownerId === PEW_OWNER && startedSession?.accountId === 'default')
const startCmd = await PECommand.findOne({ ownerId: PEW_OWNER, commandId: 'pew-start' }).lean()
check('the applied command is acknowledged with the supervisor id', startCmd?.status === 'applied' && startCmd?.supervisorId === worker.supervisorId)

await runtimeStore.enqueueCommand({ ownerId: PEW_OWNER, instanceId: PEW_ID, type: 'pause', commandId: 'pew-pause', requestedAt: PEW_T0 + 1 })
await worker.applyPendingCommands()
check('pause moves the instance to PAUSED', (await runtimeStore.findOwnedInstance(PEW_OWNER, PEW_ID))?.state === 'paused')

await runtimeStore.enqueueCommand({ ownerId: PEW_OWNER, instanceId: PEW_ID, type: 'resume', commandId: 'pew-resume', requestedAt: PEW_T0 + 2 })
await worker.applyPendingCommands()
check('resume moves the instance back to RUNNING', (await runtimeStore.findOwnedInstance(PEW_OWNER, PEW_ID))?.state === 'running')

await runtimeStore.enqueueCommand({ ownerId: PEW_OWNER, instanceId: PEW_ID, type: 'stop', commandId: 'pew-stop', requestedAt: PEW_T0 + 3 })
await worker.applyPendingCommands()
const stopped = await runtimeStore.findOwnedInstance(PEW_OWNER, PEW_ID)
const stoppedSession = stopped?.sessionId ? await PEWSession.findOne({ sessionId: stopped.sessionId }).lean() : null
check('stop completes the instance and releases its lease', stopped?.state === 'completed' && stopped?.lease?.supervisorId == null)
check('stop completes the trading session through the guarded state machine', stoppedSession?.state === 'completed' && stoppedSession?.stoppedAt != null)

// Replaying the same command id is a no-op, not a second transition.
const replay = await runtimeStore.enqueueCommand({ ownerId: PEW_OWNER, instanceId: PEW_ID, type: 'stop', commandId: 'pew-stop', requestedAt: PEW_T0 + 4 })
check('a replayed command id is deduped at the store', replay.ok === true && replay.duplicate === true)

await worker.shutdown()
const worker2 = createBotWorker({ ownerId: PEW_OWNER, nonce: 'test', now: () => PEW_T0 + 10, log: { log() {}, warn() {} } })
const boot2 = await worker2.boot()
check('restarting the same supervisor re-claims the lease with nothing to recover', boot2.ok === true && boot2.recovered.length === 0)
await worker2.shutdown()

// =============================================================================
section('13. Phase E — a native signal becomes exactly one bot alert (E4)')

const { bridgeSignalsForInstance } = await import('../services/botSignalBridge.mjs')

const PB_OWNER = 'owner-phasee-bridge'
const PB_ID = 'bot_phasee_bridge_1'
const PB_T0 = Date.now()

await PEInstance.create({
  _id: PB_ID,
  instanceId: PB_ID,
  ownerId: PB_OWNER,
  accountId: 'default',
  botProfileId: 'bp_phasee',
  state: 'running',
  subscriptions: [],
  createdAt: PB_T0,
  createdBy: 'test-db',
})

const attribution = { method: 'vsa', methodVersion: '1', strategyVersion: 'vsa@1', engineVersion: 'test', paramsHash: 'p0', indicatorRefs: [] }
const mkSignal = (over = {}) => ({
  ts: new Date(PB_T0),
  symbol: 'BTCUSDT',
  tf: '1h',
  type: 'ST LONG',
  price: 100,
  ownerId: PB_OWNER,
  accountId: null,
  method: 'vsa',
  signalKey: `sig_${Math.random().toString(36).slice(2, 10)}`,
  schemaVersion: 'signal.v1',
  attribution,
  meta: { entry: 100, sl: 95, tp: 110 },
  ...over,
})

await Signal.insertMany([
  mkSignal({ signalKey: 'sig_long_1', ts: new Date(PB_T0), type: 'ST LONG' }),
  mkSignal({ signalKey: 'sig_sv_1', ts: new Date(PB_T0 + 1), type: 'SV' }),
  mkSignal({ signalKey: 'sig_short_1', ts: new Date(PB_T0 + 2), type: 'ST SHORT', meta: { entry: 100, sl: 105, tp: 90 } }),
  mkSignal({ signalKey: 'sig_other_owner', ts: new Date(PB_T0 + 3), ownerId: 'someone-else' }),
])

const pbInstance = await runtimeStore.findOwnedInstance(PB_OWNER, PB_ID)
const bridge1 = await bridgeSignalsForInstance({ instance: pbInstance, models: { Signal, Alert } })
check("the bridge queues only the owner's entry signals", bridge1.ok === true && bridge1.queued === 2 && bridge1.scanned === 2)
const botAlerts = await Alert.find({ ownerId: PB_OWNER, source: 'bot' }).lean()
check('bot alerts land in the shared alerts collection with bot provenance', botAlerts.length === 2 && botAlerts.every((a) => a.instanceId === PB_ID && typeof a.signalKey === 'string'))
const longAlert = botAlerts.find((a) => a.side === 'BUY')
check('an entry alert keeps the plan levels from the signal meta', longAlert?.sl === 95 && longAlert?.tps?.[0] === 110 && JSON.parse(longAlert.raw).type === 'market')
check('the alert key is deterministic per (instance, signal)', longAlert?.alertKey === `bot_${PB_ID}_sig_long_1`)

const cursor = { ...pbInstance, lastSignalKey: bridge1.lastSignalKey, lastSignalTs: bridge1.lastSignalTs }
const bridge2 = await bridgeSignalsForInstance({ instance: cursor, models: { Signal, Alert } })
check('a second pass over the same window queues nothing (cursor + unique key)', bridge2.queued === 0 && bridge2.skipped === 0)
check('no duplicate alert rows were created', (await Alert.countDocuments({ ownerId: PB_OWNER, source: 'bot' })) === 2)

await Alert.deleteMany({ ownerId: PB_OWNER })

// =============================================================================
section('14. Phase E — signal -> bot -> risk -> order -> fill -> position -> metrics (E7)')

const { runCycle } = await import('../exec/paper.mjs')
const { loadRiskConfig } = await import('../exec/risk.mjs')
const { PaperOrder } = await import('../engine/models/order.mjs')
const { PaperFill } = await import('../engine/models/fill.mjs')
const { PaperAccount } = await import('../engine/models/account.mjs')

const PI_OWNER = 'owner-phasee-e2e'
const PI_ID = 'bot_phasee_e2e_1'
const PI_T0 = Date.now()

await PEInstance.create({
  _id: PI_ID,
  instanceId: PI_ID,
  ownerId: PI_OWNER,
  accountId: 'default',
  botProfileId: 'bp_phasee',
  state: 'queued',
  subscriptions: ['BTCUSDT'],
  createdAt: PI_T0,
  createdBy: 'test-db',
})

const e2eWorker = createBotWorker({ ownerId: PI_OWNER, nonce: 'e7', now: () => PI_T0, log: { log() {}, warn() {} } })
await e2eWorker.boot()
await runtimeStore.enqueueCommand({ ownerId: PI_OWNER, instanceId: PI_ID, type: 'start', commandId: 'e7-start', requestedAt: PI_T0 })
await e2eWorker.applyPendingCommands()
const e2eInstance = await runtimeStore.findOwnedInstance(PI_OWNER, PI_ID)
check('the supervisor starts the instance with a live session', e2eInstance?.state === 'running' && typeof e2eInstance?.sessionId === 'string')

// Deterministic market (injected, never a real feed): bar 1 fills the entry at
// 100, bar 2 crosses TP 110.
const bar = (time, o, h, l, c) => ({ time, open: o, high: h, low: l, close: c, volume: 10 })
let marketRound = 0
const quoteFor = (symbol, { at } = {}) => {
  const t = Number(at) || Date.now()
  const close = marketRound === 0 ? 100 : 111
  return { last: close, time: t, bar: bar(t - 30_000, close, close, close, close) }
}
const fetchKlines = async ({ symbol }) => {
  const t = Date.now()
  // The second bar must be NEWER than the position's openedAt, otherwise the
  // exit scanner (correctly) refuses to look at bars from before the fill.
  const rows = marketRound === 0
    ? [bar(t - 120_000, 100, 100.5, 99.5, 100), bar(t - 60_000, 100, 100.5, 99.5, 100)]
    : [bar(t - 120_000, 100, 100.5, 99.5, 100), bar(t, 111, 111.5, 110.5, 111)]
  return { symbol, tf: '1', bars: rows }
}

await Signal.create({
  ts: new Date(PI_T0),
  symbol: 'BTCUSDT',
  tf: '1h',
  type: 'ST LONG',
  price: 100,
  ownerId: PI_OWNER,
  accountId: 'default',
  method: 'vsa',
  signalKey: 'sig_e2e_entry_1',
  schemaVersion: 'signal.v1',
  attribution: { method: 'vsa', methodVersion: '1', strategyVersion: 'vsa@1', engineVersion: 'test', paramsHash: 'p0', indicatorRefs: [] },
  meta: { entry: 100, sl: 95, tp: 110 },
})

const e2eBridge = await bridgeSignalsForInstance({ instance: e2eInstance, models: { Signal, Alert } })
check('the signal became exactly one bot alert', e2eBridge.ok === true && e2eBridge.queued === 1)

const cfg = { ...loadRiskConfig(), ownerId: PI_OWNER, account: 'default' }
const cycle1 = await runCycle(cfg, { sessionId: e2eInstance.sessionId, quoteFor, fetchKlines })
const order1 = await PaperOrder.findOne({ ownerId: PI_OWNER }).lean()
const fill1 = await PaperFill.findOne({ ownerId: PI_OWNER }).lean()
const pos1 = await Position.findOne({ ownerId: PI_OWNER, status: 'open' }).lean()
check('risk approved the bot intent and opened a filled paper order', cycle1.opened === 1 && order1?.status === 'filled')
check('the order carries bot provenance (alertKey + instance)', order1?.alertKey === `bot_${PI_ID}_sig_e2e_entry_1` && order1?.ownerId === PI_OWNER)
check('the fill ledger recorded the execution', Boolean(fill1) && fill1?.qty > 0)
check('one open position exists at the executed price with the signal SL/TP', pos1?.status === 'open' && pos1?.sl === 95 && pos1?.tps?.[0] === 110)
check('the alert is consumed (not left retrying)', (await Alert.findOne({ signalKey: 'sig_e2e_entry_1' })).status === 'opened')

marketRound = 1
const cycle2 = await runCycle(cfg, { sessionId: e2eInstance.sessionId, quoteFor, fetchKlines })
const pos2 = await Position.findOne({ ownerId: PI_OWNER }).lean()
check('the TP cross closed the position through the exit scanner', cycle2.closed === 1 && pos2?.status === 'closed')
check('the close booked a fee-net PnL on the position', Number.isFinite(Number(pos2?.pnlAbs)) && Number(pos2?.pnlAbs) > 0)
const acct = await PaperAccount.findOne({ ownerId: PI_OWNER, accountId: 'default' }).lean()
check('the paper account is anchored (baseline frozen, projection source)', Boolean(acct) && Number(acct?.initialBalance) > 0)
const dayKey = new Date().toISOString().slice(0, 10)
const riskDay = await RiskState.findOne({ ownerId: PI_OWNER, account: 'default', utcDay: dayKey }).lean()
check('the close is booked in the day risk state (daily metrics)', Number(riskDay?.realizedPnlAbs ?? 0) > 0)

const evTypes = (await TradingDomainEvent.find({ ownerId: PI_OWNER }).lean()).map((e) => e.type)
for (const t of ['order.created', 'order.filled', 'position.opened', 'position.closed']) {
  check(`domain event emitted: ${t}`, evTypes.includes(t))
}

// Restart-no-duplicate: replaying the whole cycle must not create a second
// order/fill/position (alertKey + clientOrderId are the dedupe keys).
const ordersBefore = await PaperOrder.countDocuments({ ownerId: PI_OWNER })
const fillsBefore = await PaperFill.countDocuments({ ownerId: PI_OWNER })
await runCycle(cfg, { sessionId: e2eInstance.sessionId, quoteFor, fetchKlines })
check('a replayed cycle creates no duplicate order', (await PaperOrder.countDocuments({ ownerId: PI_OWNER })) === ordersBefore)
check('a replayed cycle creates no duplicate fill', (await PaperFill.countDocuments({ ownerId: PI_OWNER })) === fillsBefore)

const sessionDoc = await PEWSession.findOne({ sessionId: e2eInstance.sessionId }).lean()
check('the trading session is live and recorded the guarded start path', sessionDoc?.state === 'running' && (sessionDoc?.timeline || []).some((e) => e.message === 'queued -> starting'))

await e2eWorker.shutdown()

// =============================================================================
section('15. Phase F — manifest -> frozen evidence -> PIT -> graph -> advisory draft')

const { buildManifest, manifestGaps } = await import('./manifest.mjs')
const { buildEvidenceBundle, freezeEvidenceSet, verifyEvidenceSet, evidenceSufficiency } = await import('./evidence.mjs')
const { pitAudit, pitLimitation } = await import('./pointInTime.mjs')
const { linkSummary, graphDigest, graphIds } = await import('./evidenceGraph.mjs')
const { persistAiProposal, persistProposal } = await import('./experimentService.mjs')
const { TradingSession, EvidenceSet, Journal, AiProposal } = await import('./models/index.mjs')
const { NewsEvidenceSet } = await import('./models/newsEvidenceSet.mjs')
const { acceptanceReport } = await import('./experiment.mjs')

const PF_OWNER = 'owner-phasef-e2e'
const PF_SESSION = 'ses_phasef_e2e'
const PF_T0 = Date.now() - 7_200_000
const PF_STOP = PF_T0 + 3_600_000
const PF_FROZEN = PF_STOP + 1_000

const pfManifestInput = {
  kind: 'session',
  source: 'paper',
  engineVersion: 'test-f5',
  strategyVersionId: 'vsa@1.4.0',
  paramsHash: 'ph_f5',
  method: 'vsa',
  riskFingerprint: 'rf1_f5',
  dataSource: 'venue-rest',
  purpose: 'paper-validation',
  instruments: ['BTCUSDT'],
  timeframes: ['1h'],
  createdAt: PF_T0,
}
const pfManifest = buildManifest(pfManifestInput)
check('a v1 manifest has no gaps for a session', manifestGaps(pfManifest, { kind: 'session' }).length === 0,
  JSON.stringify(manifestGaps(pfManifest, { kind: 'session' })))
check('the manifest fingerprint is deterministic and excludes createdAt', pfManifest.fingerprint.startsWith('mf1_')
  && pfManifest.fingerprint === buildManifest({ ...pfManifestInput, createdAt: PF_STOP }).fingerprint)

await TradingSession.create({
  _id: PF_SESSION,
  sessionId: PF_SESSION,
  kind: 'live-paper',
  ownerId: PF_OWNER,
  accountId: 'default',
  strategyVersionId: 'vsa@1.4.0',
  instruments: ['BTCUSDT'],
  timeframes: ['1h'],
  state: 'completed',
  startedAt: PF_T0,
  stoppedAt: PF_STOP,
  manifest: pfManifest,
  createdBy: 'test-db',
})

// 22 closed trades (the evidence floor is 20), all strictly inside the window.
const pfPositions = Array.from({ length: 22 }, (_, i) => ({
  _id: `pos_f5_${i}`,
  externalId: `ext_f5_${i}`,
  symbol: 'BTCUSDT',
  dir: 1,
  entryPrice: 100,
  exitPrice: 101,
  entryTime: PF_T0 + (i + 1) * 60_000,
  exitTime: PF_T0 + (i + 1) * 60_000 + 30_000,
  qty: 1,
  pnlAbs: 1,
  fees: 0,
  result: 'TP',
  rMultiple: 1,
}))
const pfOrders = [{ clientOrderId: 'co_f5_0', status: 'filled' }]
const pfFills = [{ fillId: 'fl_f5_0', qty: 1, price: 100 }]
const pfJournalRows = pfPositions.map((p, i) => ({
  key: p.externalId,
  ownerId: PF_OWNER,
  source: 'paper',
  account: 'default',
  sourceId: p.externalId,
  symbol: 'BTCUSDT',
  tf: '1h',
  dir: 1,
  entryPrice: 100,
  exitPrice: 101,
  entryTime: new Date(p.entryTime),
  exitTime: new Date(p.exitTime),
  result: 'TP',
  rMultiple: 1,
  pnlAbs: 1,
}))
// Raw insert: the Journal schema reserves the path name `schema`, which Mongoose
// document validation cannot handle (engine/journal.mjs inserts per-row and
// swallows the error) — the audit below only needs the persisted rows.
await Journal.collection.insertMany(pfJournalRows)
const pfNews = await NewsEvidenceSet.create({
  _id: 'nv_f5_1',
  setId: 'nv_f5_1',
  ownerId: PF_OWNER,
  purpose: 'evaluation',
  symbols: ['BTCUSDT'],
  asOf: new Date(PF_T0 + 30_000),
  hash: 'nvh_f5',
})

const pfBundle = buildEvidenceBundle({
  kind: 'paper-session',
  sourceId: PF_SESSION,
  session: { sessionId: PF_SESSION, state: 'completed', startedAt: PF_T0, stoppedAt: PF_STOP, accountId: 'default', strategyVersionId: 'vsa@1.4.0', instruments: ['BTCUSDT'], timeframes: ['1h'], manifest: pfManifest },
  positions: pfPositions,
  orders: pfOrders,
  fills: pfFills,
  journalKeys: pfJournalRows.map((j) => j.key),
  frozenAt: PF_FROZEN,
})
check('the bundle is sealed, carries the manifest and all 22 trades', pfBundle.sealed === true && pfBundle.trades.length === 22 && pfBundle.manifest?.fingerprint === pfManifest.fingerprint)
check('the bundle links the journal rows by upstream identity', pfBundle.keys.journalKeys.length === 22 && pfBundle.keys.journalKeys.includes('ext_f5_0'))

const pfFrozen = freezeEvidenceSet(pfBundle)
await EvidenceSet.create({ ...pfFrozen, ownerId: PF_OWNER, createdBy: 'test-db' })
const pfRead = await EvidenceSet.findById(pfFrozen.setId).lean()
check('the frozen set persists and re-verifies byte-for-byte', verifyEvidenceSet(pfRead).ok === true)
check('an edited set fails verification (immutability is enforced, not assumed)',
  verifyEvidenceSet({ ...pfRead, trades: pfRead.trades.slice(0, 1) }).code === 'SET_TAMPERED')

const pfPit = pitAudit({ bundle: pfRead, journal: pfJournalRows, news: [pfNews] })
check('a clean graph passes the strict point-in-time audit', pfPit.ok === true && pfPit.cutoff === PF_FROZEN && pitLimitation(pfPit) === null)
const pfLeak = pitAudit({ bundle: { ...pfRead, trades: [...pfRead.trades, { key: 'pos_future', entryTime: PF_T0, exitTime: PF_FROZEN + 1 }] }, journal: pfJournalRows, news: [pfNews] })
check('a record after the freeze is reported, not silently dropped',
  pfLeak.ok === false && pfLeak.violations.some((v) => v.code === 'EXIT_AFTER_CUTOFF' && v.recordId === 'pos_future'))
check('the leaking set is not sufficient despite 22 trades', evidenceSufficiency(pfRead, { pit: pfLeak }).sufficient === false)
check('the clean set is sufficient (floor 20)', evidenceSufficiency(pfRead, { pit: pfPit }).sufficient === true)

const pfGraph = { session: { sessionId: PF_SESSION, ownerId: PF_OWNER }, bundle: pfRead, orders: pfOrders, fills: pfFills, journal: pfJournalRows, news: [pfNews], experiments: [], relatedSets: [], pit: pfPit }
const pfLinks = linkSummary(pfGraph)
check('the graph links set/journal/news and names the missing experiment', pfLinks.counts.orders === 1
  && pfLinks.counts.journal === 22 && pfLinks.counts.news === 1 && pfLinks.counts.trades === 22
  && pfLinks.missing.includes('experiment') && !pfLinks.missing.includes('journal'))
const pfIds = graphIds(pfGraph)
check('the citation allowlist contains real record ids from every source', pfIds.includes(pfFrozen.setId)
  && pfIds.includes('ext_f5_0') && pfIds.includes('nv_f5_1') && pfIds.includes('co_f5_0'))
const pfDigest1 = graphDigest(pfGraph)
check('the digest is deterministic', pfDigest1 === graphDigest({ ...pfGraph }))
check('adding a news row changes the digest (the graph is content-addressed)',
  pfDigest1 !== graphDigest({ ...pfGraph, news: [...pfGraph.news, { setId: 'nv_f5_2', asOf: new Date(PF_T0 + 40_000) }] }))

const pfProposal = {
  proposalId: 'prop_f5_1',
  strategyVersionId: 'vsa@1.4.0',
  hypothesis: 'the TP/SL mix improved expectancy on the frozen sample',
  changes: [{ parameter: 'minRRR', from: 1.5, to: 2 }],
  evidence: [{ metric: 'expectancyR', value: 1, sampleSize: 22 }],
  risks: ['single-regime sample'],
  recommendedTest: { symbols: ['BTCUSDT'], timeframes: ['1h'] },
  evidenceSetId: pfFrozen.setId,
  citations: [
    { kind: 'evidence-set', id: pfFrozen.setId },
    { kind: 'trade', id: 'ext_f5_0' },
    { kind: 'news', id: 'nv_f5_1' },
  ],
}
const pfPersisted = await persistAiProposal(pfProposal, { generation: { kind: 'session-analysis', at: PF_FROZEN }, ownerId: PF_OWNER })
const pfStored = await AiProposal.findById('prop_f5_1').lean()
check('the advisory draft records its evidence set and citations', pfPersisted.ok === true
  && pfStored?.evidenceSetId === pfFrozen.setId && (pfStored?.citations ?? []).length === 3)
check('persisting the same draft twice cannot fork it ($setOnInsert)',
  (await AiProposal.countDocuments({ _id: 'prop_f5_1' })) === 1 && (await persistAiProposal(pfProposal, { ownerId: PF_OWNER })).ok === true)

const pfExp = await persistProposal(pfProposal, { now: PF_FROZEN, evidenceSetId: pfFrozen.setId, baselineVersionId: 'vsa@1.4.0', ownerId: PF_OWNER })
check('the proposal becomes a draft experiment citing the same frozen set', pfExp.ok === true && pfExp.exp?.evidenceSetId === pfFrozen.setId)
check('a candidate equal to its baseline can never pass acceptance', acceptanceReport(pfExp.exp).ok === false
  && acceptanceReport(pfExp.exp).gates.some((g) => g.key === 'independentArms' && g.pass === false))

// =============================================================================
section('16. AI provider connections (Phase G, D35)')

process.env.AI_CREDENTIAL_KEY ||= 'test-db-credential-key'
const { listConnections, getConnection, upsertConnection, testConnection, setEnabled, deleteConnection, resolveProviderCandidates, resolveProviderConfig, recordUsage, budgetFor, envConnection, exportConnections, importConnections, discoverModelsForInput } = await import('../ai/providerStore.mjs')
const { AiProviderConnection } = await import('./models/aiProviderConnection.mjs')
const { AiProviderAudit } = await import('./models/aiProviderAudit.mjs')
const AI_OWNER = 'owner_ai_1'
const AI_OTHER = 'owner_ai_2'
const FAKE_KEY = 'sk-test-db-secret-123456789'

const createdAi = await upsertConnection({ provider: 'openai', name: 'main', model: 'gpt-4o-mini', apiKey: FAKE_KEY, ownerId: AI_OWNER }, { actor: AI_OWNER })
check('a provider connection is created and redacted (no key in the response)',
  createdAi.provider === 'openai' && createdAi.hasSecret === true && !JSON.stringify(createdAi).includes(FAKE_KEY)
  && createdAi.secretMask !== FAKE_KEY && /^afp1_/.test(createdAi.secretFingerprint))
const aiRaw = await AiProviderConnection.findById(createdAi.id).lean()
check('the raw row stores an AES-GCM envelope, never plaintext',
  String(aiRaw?.secretEnc ?? '').startsWith('enc1.') && !JSON.stringify(aiRaw).includes(FAKE_KEY))
check('listing is owner-scoped', (await listConnections({ ownerId: AI_OWNER })).length === 1
  && (await listConnections({ ownerId: AI_OTHER })).length === 0)
const otherAi = await upsertConnection({ provider: 'openai', name: 'main', model: 'gpt-4o-mini', apiKey: 'sk-other-owner-123456', ownerId: AI_OTHER }, { actor: AI_OTHER })
check('two owners can use the same provider/label without an _id collision',
  otherAi.id !== createdAi.id && (await listConnections({ ownerId: AI_OWNER })).length === 1
  && (await listConnections({ ownerId: AI_OTHER })).length === 1)
await deleteConnection(otherAi.id, { ownerId: AI_OTHER, actor: AI_OTHER })

const updatedAi = await upsertConnection({ id: createdAi.id, provider: 'openai', name: 'main', model: 'gpt-4o', ownerId: AI_OWNER }, { actor: AI_OWNER })
const aiRaw2 = await AiProviderConnection.findById(createdAi.id).lean()
check('editing the model keeps the stored secret and resets health to untested',
  updatedAi.model === 'gpt-4o' && aiRaw2.secretEnc === aiRaw.secretEnc && updatedAi.status === 'untested')
check('another owner cannot read or delete the row',
  (await getConnection(createdAi.id, { ownerId: AI_OTHER })) === null
  && (await deleteConnection(createdAi.id, { ownerId: AI_OTHER })) === false)

const aiCandidates = await resolveProviderCandidates({ ownerId: AI_OWNER })
check('the request resolver decrypts internally and exposes the configured model',
  aiCandidates.length === 1 && aiCandidates[0].apiKey === FAKE_KEY && aiCandidates[0].model === 'gpt-4o')

const fakeOk = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }) })
const aiTest = await testConnection(createdAi.id, { fetchImpl: fakeOk, actor: AI_OWNER })
check('a successful health test records ok + model discovery without leaking the key',
  aiTest.ok === true && aiTest.modelFound === true && aiTest.models.length === 2 && !JSON.stringify(aiTest).includes(FAKE_KEY))
const aiAfterTest = await AiProviderConnection.findById(createdAi.id).lean()
check('health persists on the row (status ok, latency, testedAt)',
  aiAfterTest.status === 'ok' && aiAfterTest.lastTestedAt > 0 && aiAfterTest.lastError === null)

const fake401 = async () => ({ ok: false, status: 401, text: async () => '{"error":"bad key"}' })
const aiBad = await testConnection(createdAi.id, { fetchImpl: fake401, actor: AI_OWNER })
check('an invalid key is visible as ai.invalid-key and persists an error',
  aiBad.ok === false && aiBad.code === 'ai.invalid-key'
  && (await AiProviderConnection.findById(createdAi.id).lean())?.status === 'error')
const fakeDown = async () => { throw new Error('connect ECONNREFUSED') }
const aiDown = await testConnection(createdAi.id, { fetchImpl: fakeDown, actor: AI_OWNER })
check('a network outage is classified as ai.network, not a generic 500',
  aiDown.ok === false && aiDown.code === 'ai.network')

const disabled = await setEnabled(createdAi.id, false, { ownerId: AI_OWNER, actor: AI_OWNER })
check('a disabled connection is excluded from request resolution',
  disabled.enabled === false && (await resolveProviderCandidates({ ownerId: AI_OWNER, includeEnv: false })).length === 0)
await setEnabled(createdAi.id, true, { ownerId: AI_OWNER, actor: AI_OWNER })

const aiBadCreate = await upsertConnection({ provider: 'unknown-ai', model: 'x', apiKey: FAKE_KEY, ownerId: AI_OWNER }).then(() => null).catch((e) => e)
check('unknown providers are rejected before they reach the database', aiBadCreate?.code === 'ai.invalid-connection')

const ollamaAi = await upsertConnection({ provider: 'ollama', name: 'local', model: 'llama3.2', ownerId: AI_OWNER }, { actor: AI_OWNER })
check('a keyless local provider is allowed and stores no envelope',
  ollamaAi.hasSecret === false && (await AiProviderConnection.findById(ollamaAi.id).lean())?.secretEnc === null)

await AiProviderConnection.findByIdAndUpdate(createdAi.id, { $set: { budgets: { limitTokens: 100 } } })
await recordUsage(createdAi.id, { tokens: 85 })
const aiBudget = await budgetFor(createdAi.id)
check('usage is recorded and the budget reports near-exhaustion', aiBudget.usedTokens === 85 && aiBudget.limitTokens === 100 && aiBudget.state === 'near')

const auditRows = await AiProviderAudit.find({ connectionId: createdAi.id }).lean()
check('create/update/test/enable/disable actions are audited without secrets',
  auditRows.length >= 5 && auditRows.some((r) => r.action === 'test') && !JSON.stringify(auditRows).includes(FAKE_KEY))

const savedEnv = { ...process.env }
process.env.AI_PROVIDER = 'ollama'
process.env.AI_BASE_URL = 'http://127.0.0.1:11434/v1'
process.env.AI_MODEL = 'llama3.2'
delete process.env.AI_API_KEY
const envCfg = envConnection(process.env)
const envResolved = await resolveProviderCandidates({ ownerId: 'owner_no_rows', includeEnv: true })
check('a fresh owner falls back to env config only when no stored connection resolves',
  envCfg?.provider === 'ollama' && envResolved.length === 1 && envResolved[0].source === 'env')
process.env = savedEnv

const fakeModels = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }) })
const aiDiscover = await discoverModelsForInput(
  { provider: 'openai', apiKey: 'sk-discover-test-123456', baseUrl: 'https://api.openai.com/v1' },
  { fetchImpl: fakeModels },
)
check('discover models for unsaved credentials without writing a row',
  aiDiscover.ok === true && aiDiscover.models.length === 2
  && (await AiProviderConnection.countDocuments({ ownerId: AI_OWNER })) === 2)

const aiExport = await exportConnections({ ownerId: AI_OWNER })
check('export omits secrets by default and scopes to the owner', aiExport.connections.length === 2
  && !JSON.stringify(aiExport).includes(FAKE_KEY) && aiExport.includeSecrets === false)
const aiExportKeys = await exportConnections({ ownerId: AI_OWNER, includeSecrets: true })
check('export with secrets decrypts the stored keys', aiExportKeys.includeSecrets === true
  && JSON.stringify(aiExportKeys).includes(FAKE_KEY) && aiExportKeys.unreadable === 0)

const importedSkip = await importConnections(aiExport.connections, { ownerId: AI_OWNER, overwrite: false })
check('import skips existing provider/label pairs unless overwrite is on',
  importedSkip.skipped === 2 && importedSkip.imported === 0)

const NEW_KEY = 'sk-imported-secret-987654321'
const importedUpdate = await importConnections([{ provider: 'openai', name: 'main', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiKey: NEW_KEY }], { ownerId: AI_OWNER, overwrite: true })
const importedResolved = await resolveProviderConfig({ ownerId: AI_OWNER, id: createdAi.id })
check('import overwrite updates the encrypted key in place', importedUpdate.imported === 1
  && importedUpdate.results[0].status === 'updated' && importedResolved.apiKey === NEW_KEY
  && !JSON.stringify(importedUpdate).includes(NEW_KEY))

const importedNew = await importConnections([{ provider: 'groq', name: 'backup', model: 'llama-3.1-8b-instant', apiKey: 'sk-groq-import-123456' }], { ownerId: AI_OWNER })
check('import creates a new connection with its provider default base URL', importedNew.imported === 1
  && importedNew.results[0].status === 'created')
const importedRow = (await listConnections({ ownerId: AI_OWNER })).find((r) => r.name === 'backup')
check('the created import is visible and redacted', importedRow?.provider === 'groq'
  && importedRow?.baseUrl === 'https://api.groq.com/openai/v1' && !JSON.stringify(importedRow).includes('sk-groq-import-123456'))
await deleteConnection(importedRow.id, { ownerId: AI_OWNER, actor: AI_OWNER })

check('deleting removes only the owner\'s row', (await deleteConnection(createdAi.id, { ownerId: AI_OWNER, actor: AI_OWNER })) === true
  && (await AiProviderConnection.findById(createdAi.id)) === null)

// =============================================================================
await db.dropDatabase() // khong de lai rac
await disconnectMongo()
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)