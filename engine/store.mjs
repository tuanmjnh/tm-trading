#!/usr/bin/env node
// =============================================================================
//  TM TRADING - LUU KET QUA RUN  (roadmap D1 + D2, Phase 3)
//
//  Ba luat cua file nay (khong co mot trong thi ket qua backtest tro thanh rac):
//
//   1. NDJSON **LUON** ghi, MongoDB la tuy chon (fail-soft). Cung triet ly voi
//      db.mjs: thieu Mongo / Mongo loi khong duoc lam hong mot lan chay.
//   2. Khong luu duoc mot run VO DANH TINH (D1). Neu thieu stamp -> tu sinh
//      bang `runStamp()`; neu co nhung `paramsHash` KHONG khop `params` ->
//      NEM LOI. "Tu choi tron" phai bat dau o tang GHI, neu khong thi tang
//      bao cao phai sua loi do song song (khong ai biet cai nao dung).
//   3. Thoi gian = UTC (D2): Date/Mongo luu UTC ms, NDJSON luu ISO-8601 `Z`.
//      Khong bao gio ghi gio dia phuong.
//
//  `summarizeRuns()` - tai sao co mat: D1 yeu cau dashboard/bao cao "TU CHOI
//  reject runs with different hash. Throws if invoked with mismatched hash.
//  tren 2 the he cau hinh; muon tong hop nhieu the thi dung `groupByGeneration()`
//  - ham do BO BUOC phai tach nhom theo cach do nen khong the tron duoc.
// =============================================================================

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runStamp, paramsHash, ENGINE_VERSION } from './version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// reports/ da bi .gitignore (output chay tai thoi diem chay) va KHONG bi `npm run
// clean` xoa (clean chi dot pine/dist + logs/) -> NDJSON ton tai duoc khi Mongo
// khong duoc cai, dung nhu noi luu lau dai nho.
export const RUNS_FILE = join(ROOT, 'reports', 'runs.ndjson')
export const TRADES_FILE = join(ROOT, 'reports', 'trades.ndjson')

// =============================================================================
//  NDJSON - append 1 dong JSON, doc lai duoc, khong can Mongo
// =============================================================================

export function appendNdjson(file, obj) {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(file, JSON.stringify(obj) + '\n')
  return file
}

/**
 * Doc NDJSON tra ve mang. Dong hong (JSON hong) bi BO QUA co y thay vi nem:
 * 1 dong rac khong duoc lam mat het cac run con lai. Dem so dong bi bo qua de
 * goi dich vu phia tren biet ma canh bao (`skipped`).
 */
export function readNdjson(file) {
  if (!existsSync(file)) return { rows: [], skipped: 0 }
  const rows = []
  let skipped = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      rows.push(JSON.parse(t))
    } catch {
      skipped++
    }
  }
  return { rows, skipped }
}

// =============================================================================
//  D1 - danh tinh truoc khi ghi
// =============================================================================

/**
 * Attach / verify run version stamp BEFORE saving.
 *
 * - Thieu stamp -> sinh tu `run.params` (khong luu run "vo danh tinh").
 * - Co stamp nhung `paramsHash` khong khop `params` -> NEM LOI. Day la chanh sat
 *   cua D1: mot run bi sua params roi khong hash lai se ton tai ben canh run
 *   dung voi cung mot bo tham so ghi tren mat -> ke toan sau khong the phan biet.
 * - Co `paramsHash` nhung thieu `params` -> NEM LUON (khong the tai lap duoc).
 */
export function withStamp(run, { bars = null, engineVersion = ENGINE_VERSION } = {}) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new TypeError('withStamp: run phai la object')
  }
  if (run.params === undefined || run.params === null || typeof run.params !== 'object') {
    throw new Error('run.thieu-params: can bo tham so hieu dung de danh tinh va tai lap')
  }

  const hash = paramsHash(run.params) // canonical -> merge DEFAULTS, sort key, ep kieu
  if (run.paramsHash !== undefined && run.paramsHash !== null && run.paramsHash !== hash) {
    throw new Error(
      `run.paramsHash-khong-khop: khai ${run.paramsHash} nhung hash tu params la ${hash} ` +
        `(params da sua ma khong hash lai - tu choi ghi de khong tron hai the he)`,
    )
  }

  const stamp = runStamp({
    params: run.params,
    bars: bars ?? undefined,
    symbol: run.symbol,
    tf: run.tf,
    market: run.market,
    universeSnapshot: run.universeSnapshot ?? null,
    engineVersion: run.engineVersion ?? engineVersion,
  })

  // Giu lai dataHash/createdAt da co (neu nguoi goi da tinh truoc); thieu moi sinh.
  const dataHash = run.dataHash ?? stamp.dataHash
  return {
    ...run,
    engineVersion: stamp.engineVersion,
    paramsHash: stamp.paramsHash,
    params: stamp.params,
    dataHash,
    universeSnapshot: stamp.universeSnapshot,
    gitRev: run.gitRev ?? stamp.gitRev,
    // D2: UTC. NDJSON se stringify thanh ISO `Z`, Mongo nhan Date (UTC ms).
    createdAt: run.createdAt ? new Date(run.createdAt) : new Date(),
  }
}

// =============================================================================
//  GHI - NDJSON luon, Mongo tuy chon
// =============================================================================

/**
 * Luu mot run (+ cac lenh cua no).
 *
 * @param {object} run        document run (co the chua stamp, khong cung duoc)
 * @param {object} opt
 * @param {Array}  opt.trades cac lenh de ghi rieng (khong nhung vao run -
 *                            mot run hang nghin lenh se cham 16MB neu nhung)
 * @param {Array}  opt.bars   chuoi nent de tinh dataHash neu run chua co
 * @param {boolean|'auto'} opt.mongo  'auto' = ghi Mongo neu co MONGODB_URI
 * @param {string} opt.runsFile / opt.tradesFile  de test tro vao tmp
 *
 * @returns {Promise<{run: object, ndjson: boolean, mongo: boolean, runId: string|null, warnings: string[]}>}
 *          `run` la ban ghi DA CO stamp - goi lai `run.paramsHash` duoc ngay.
 */
export async function saveRun(run, opt = {}) {
  const { trades = [], bars = null, mongo = 'auto', runsFile = RUNS_FILE, tradesFile = TRADES_FILE } = opt
  const warnings = []

  // --- D1: danh tinh TRUOC moi hanh dong ghi ---
  const doc = withStamp(run, { bars, engineVersion: run.engineVersion })

  // --- NDJSON: LUON ghi (du Mongo co hay khong) ---
  appendNdjson(runsFile, serialize(doc))
  for (const t of trades) {
    appendNdjson(tradesFile, serialize({ ...t, runId: null, paramsHash: doc.paramsHash, engineVersion: doc.engineVersion }))
  }
  let ndjson = true

  // --- Mongo: tuy chon, fail-soft ---
  let mongoWritten = false
  let runId = null
  if (mongo !== false) {
    const result = await writeMongo(doc, trades, mongo, warnings)
    mongoWritten = result.written
    runId = result.runId
    if (mongo === true && !mongoWritten) {
      // `true` = nguoi goi BAT BUOC phai co Mongo (test, CI) -> khong im lang.
      throw new Error(`saveRun: khong ghi duoc Mongo (${warnings.join('; ') || 'khong ro ly do'})`)
    }
  }

  return { run: doc, ndjson, mongo: mongoWritten, runId, warnings }
}

/** Date -> ISO-8601 `Z` (D2), con lai giu nguyen. Object Mongo `_id` -> string. */
function serialize(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Date ? v.toISOString() : v
  }
  if (out._id !== undefined && out._id !== null && typeof out._id !== 'string') out._id = String(out._id)
  return out
}

/**
 * Ghi Mongo. IM LOI va tra ve written:false khi loi (fail-soft) - lai tru khi
 * saveRun(..., {mongo:true}) must succeed strictly.
 * roadmap D1 ghi ro NDJSON la noi luu chot, Mongo la phu.
 */
async function writeMongo(doc, trades, mode, warnings) {
  if (mode === 'auto' && !String(process.env.MONGODB_URI ?? '').trim()) {
    warnings.push('khong co MONGODB_URI -> chi ghi NDJSON (D1 van du - run van mang day du stamp)')
    return { written: false, runId: null }
  }
  try {
    const db = await import('./db.mjs')
    const conn = await db.connectMongo()
    if (!conn) {
      warnings.push('Mongo khong ket noi duoc -> chi ghi NDJSON')
      return { written: false, runId: null }
    }
    const { Run, Trade } = await import('./models/index.mjs')

    const runDoc = await Run.create(doc)
    for (const t of trades) {
      await Trade.create({ ...t, runId: runDoc._id, paramsHash: doc.paramsHash, engineVersion: doc.engineVersion })
    }
    return { written: true, runId: String(runDoc._id) }
  } catch (e) {
    // 11000 (trung) cung vao day: run cung hash da co -> giu cai cu, khong nhan.
    warnings.push(`Mongo: ${e?.code === 11000 ? 'run trung (cung paramsHash + scope) - da co' : e?.message}`)
    return { written: false, runId: null }
  }
}

// =============================================================================
//  TONG HOP - khong bao gio tron 2 the he cau hinh (D1)
// =============================================================================

/** Khoa the he: engineVersion + paramsHash. 2 run cung khoa = cung cau hinh that su. */
export function generationKey(run) {
  return `${run?.engineVersion ?? '?'}#${run?.paramsHash ?? '?'}`
}

/**
 * Nhom theo the he - DUNG KHI can tong hop nhieu bo tham so khac nhau.
 * Ham nay KHONG THE tron: key duoc tinh tu chinh run.
 * @returns {Map<string, object[]>} key -> runs, nhom dau tien theo thu tu xuat hien
 */
export function groupByGeneration(runs) {
  const groups = new Map()
  for (const r of runs ?? []) {
    const k = generationKey(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  return groups
}

/**
 * Tong hop mot nhom run CUNG the he. Neu truyen nhieu the he -> NEM LOI.
 *
 * Day la hanh dong "tu choi tron" ma D1 yeu cau: thay vi im lang cong chung
 * (prevents invalid comparisons across engine generations).
 * tron va bat nguoi goi phai chon 1 the hoac dung groupByGeneration().
 *
 * `netPct` la TONG pnlPct tung lenh (khong compounding) - xem tieu de truong.
 */
export function summarizeRuns(runs, { label = 'report' } = {}) {
  const list = (runs ?? []).filter(Boolean)
  if (!list.length) {
    return { runs: 0, generations: [], trades: 0, wins: 0, losses: 0, open: 0, winRate: 0, profitFactor: 0, netPct: 0, maxDrawdownPct: 0, avgRr: 0, expectancy: 0, medianRr: 0, degenerateRisk: 0 }
  }

  const keys = [...new Set(list.map(generationKey))].sort()
  if (keys.length > 1) {
    throw new Error(
      `${label}: khong duoc tron ${keys.length} the he cau hinh trong mot tong hop - ` +
        `${keys.join(', ')}. Dung groupByGeneration() de tach, hoac chon dung 1 bo tham so (D1).`,
    )
  }

  // Chi mot nhom -> cong binh thuong. Lay dau tien lam dai dien (da dam bao cung khoa).
  const rep = list[0]
  const closed = list.flatMap((r) => (Array.isArray(r.trades) ? r.trades : [])).filter((t) => t && t.result !== 'OPEN')
  const open = list.flatMap((r) => (Array.isArray(r.trades) ? r.trades : [])).filter((t) => t && t.result === 'OPEN')

  const wins = closed.filter((t) => (t.pnlPct ?? 0) > 0)
  const losses = closed.filter((t) => (t.pnlPct ?? 0) < 0)
  const grossWin = wins.reduce((s, t) => s + (t.pnlPct ?? 0), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnlPct ?? 0), 0))

  // Equity chay tich luy -> drawdown = tham (sau dinh) lon nhat (phan tram von).
  let eq = 0
  let peak = 0
  let maxDD = 0
  for (const t of closed) {
    eq += t.pnlPct ?? 0
    if (eq > peak) peak = eq
    const dd = peak - eq
    if (dd > maxDD) maxDD = dd
  }

  const rList = closed.map((t) => t.rMultiple).filter((x) => Number.isFinite(x))

  // Median - dung chong lai mean bi chiem by outlier. Mot lenh co risk 0.003%
  // cua entry (sl gan entry) cho R = 87 thi R do MOT MINH keo binh quan cua 110
  // lenh tu -0.58R len +0.15R -> bao cao doc nhu co loi trong khi PF = 0.32.
  // Median khong bi anh huong boi 1 lenh; co 2 so moi doc duoc (xem report.mjs).
  const rSorted = [...rList].sort((a, b) => a - b)
  const medianR = rSorted.length
    ? (rSorted.length % 2 ? rSorted[(rSorted.length - 1) / 2]
      : (rSorted[rSorted.length / 2 - 1] + rSorted[rSorted.length / 2]) / 2)
    : 0
  const meanR = rList.length ? rList.reduce((s, x) => s + x, 0) / rList.length : 0

  // So lenh co risk/entry qua nho -> R qua nhay, khong doi xung voi cac lenh
  // khac. Khong LOAI chung (do la du lieu that), chi DEM de bao cao canh bao.
  const degenerate = closed.filter((t) => {
    const risk = Math.abs((t.entryPrice ?? 0) - (t.sl ?? 0))
    const entry = t.entryPrice ?? 0
    return entry > 0 && risk > 0 && risk / entry < 0.001 // < 0.1% entry
  }).length

  return {
    generations: keys,
    engineVersion: rep.engineVersion,
    paramsHash: rep.paramsHash,
    params: rep.params ?? null,
    runs: list.length,
    trades: closed.length,
    open: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    netPct: closed.reduce((s, t) => s + (t.pnlPct ?? 0), 0), // TONG khong nhan loi
    maxDrawdownPct: maxDD,
    avgRr: meanR,
    // Expectancy = ky vong R moi lenh (tieuan), = WR x avgWin - (1-WR) avgLoss.
    // Cong thuc nay CO Y = mean(rList) - khong phai 2 so khac nhau, nen khi
    // doc 2 so trung thi khong phai bug (da chung minh trong test).
    expectancy: meanR,
    medianRr: medianR,
    degenerateRisk: degenerate,
  }
}

/** Doc lai cac run da luu (NDJSON). Gom ca skipped dong hong de canh bao. */
export function loadRuns(file = RUNS_FILE) {
  const { rows, skipped } = readNdjson(file)
  if (skipped) console.warn(`[store] ${skipped} dong NDJSON hong bi bo qua trong ${file}`)
  return rows
}

/** For CI/monitoring: reports file and record counts. */
export function storeStats(files = [RUNS_FILE, TRADES_FILE]) {
  return files.map((f) => {
    if (!existsSync(f)) return { file: f, exists: false, lines: 0 }
    const lines = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length
    return { file: f, exists: true, lines }
  })
}

export { ENGINE_VERSION }
