#!/usr/bin/env node
// =============================================================================
//  TM TRADING - CLI BACKTEST (roadmap Phase 4)
//
//      node engine/run.mjs --symbols BTCUSDT.P,ETHUSDT.P --tfs 5m,15m,1h
//      node engine/run.mjs --symbols BTCUSDT.P --tfs 4m,10m --sub1m
//
//      npm run engine:run -- --symbols BTCUSDT.P --tfs 15m
//
//  LUA CHON:
//    --symbols   dsach tach dau phay. Chua duong .P van duoc (fapi = perpetual,
//                ten hien thi se duoc bo sung .P cho dung kieu giac TradingView).
//    --tfs       '5m','15m','1h','4m','10m'... (4m/10m = resample tu 1m vi
//                Binance khong co - xem data.mjs MUST_RESAMPLE)
//    --market    fapi (mac dinh) | spot
//    --preset    ten preset (xem PRESETS) hoac bo qua de dung DEFAULTS
//    --params    JSON tuy chinh bo sung vao preset (uuong tin nhat: ghi len cuoi)
//    --sub1m     fetch 1m candles for intra-bar TP/SL resolution
//                (mac dinh TU DONG khi khung la 4m/10m vi luc do da co 1m)
//    --refresh   bo qua cache, goi lai Binance
//    --limit     so bar toi da moi khung (mac dinh 5000)
//    --min-bars / --min-trades  D11 loc min-history (mac dinh 0 = khong loc)
//    --no-mongo  chi ghi NDJSON (mac dinh 'auto': co MONGODB_URI thi ghi)
//    --out       thu muc CSV (mac dinh reports/)
//    --quiet     chi in bang tong hop, khong in tung bao cao
//
//  DAU RA:
//    reports/<symbol>-<tf>-trades.csv   tung lenh (Trade model)
//    reports/summary.csv                bang tong hop symbol x TF
//    reports/runs.ndjson + trades.ndjson  (luon - D1)
//    console: bao cao tung nhom + bang symbol x TF + canh bao D5/D11
//
//  NGUYEN TAC: khong tinh lai so luong (report.mjs lay summarizeRuns), khong
//  an counters (noFill/replaced), khong tron 2 the he params (D1).
// =============================================================================
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { fetchKlines, resample, universeSnapshot, MUST_RESAMPLE, TF_MS, MARKETS, DataError } from './data.mjs'
import { backtest } from './backtest.mjs'
import { summarizeBacktest, formatSummary, formatMatrix, toCsv, summaryRow, TRADE_COLUMNS, SUMMARY_COLUMNS } from './report.mjs'
import { saveRun } from './store.mjs'
import { DEFAULTS } from './methods/vsa.mjs'
import { listMethods } from './methods/index.mjs'
import './methods/all.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Presest. Moi preset = BO THAM SO KHAC DEFAULTS (khong nhan ghi de truc tiep
 * len DEFAULTS - can DEFAULTS thay doi, tat ca preset theo sau, khong ai bi lac).
 *
 * Phase 5 se mo rong bang nay tu backtest that. O Phase 4 chi co 2 preset that
 * history: 'default' (current) and 'legacy-limit' (prior to 0.4.0).
 */
export const PRESETS = Object.freeze({
  // Mac dinh engine (xem version.mjs 0.4.0): vao tai close bar ST, TP theo R.
  default: {},
  // Truoc 0.4.0: limit tai cuc tri SV/BC + TP theo pivot. GIU LAI de so sanh
  // lich su, khong phai de dung (docs/vsa-optimization.md §5b/§5c).
  'legacy-limit': { entryMode: 'limit', tpMode: 'pivot' },
})

/**
 * Cac flag KHONG nhan gia tri (dung `--refresh`, khong dung `--refresh 1`).
 *
 * Can rieng vi `--refresh BTCUSDT.P` (flag truoc mot tuong lai) se "an" di
 * tuong do neu khong biet flag nay la boolean. Da gap trong test: --refresh
 * lay luon chuoi positional va nguoi goi mat mot symbol ma khong bao loi.
 */
export const BOOLEAN_FLAGS = Object.freeze(new Set([
  'refresh', 'sub1m', 'no-mongo', 'quiet', 'help', 'h', 'cache', 'no-write',
]))

/**
 * Doc argv thanh object.
 *   `--flag`        -> true (neu flag la boolean, hoac khong co tu sau)
 *   `--key val`     -> 'val'
 *   `--key=val`     -> 'val'
 * Tuong khong bat dau bang `--` khong nam trong flag boolean -> di vao `out._`.
 */
export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq)
    if (eq !== -1) {
      out[key] = a.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

/**
 * Chuan hoa symbol.
 * - Bo duong `.P` khi dien lenh (fapi khong can) - nhung GIU ten hien thi.
 * - Tra ve { api, display } de khong ai nham giua `BTCUSDT` (lenh) va
 *   `BTCUSDT.P` (ten tren bang bao cao).
 */
export function normalizeSymbol(raw, market = 'fapi') {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s) throw new DataError('symbol rong')
  const api = s.endsWith('.P') ? s.slice(0, -2) : s
  if (!api) throw new DataError(`symbol khong hop le "${raw}"`)
  const suffix = MARKETS[market]?.suffix ?? ''
  return { api, display: api.endsWith(suffix) || !suffix ? api : `${api}${suffix}` }
}

/** '5m' | '5' | '1h' | '60' | 'D' -> ma TF cua engine ('5','60','D'...). */
export function normalizeTf(raw) {
  const s = String(raw ?? '').trim()
  if (!s) throw new DataError('tf rong')
  const m = /^(\d+)\s*m?$/i.exec(s)
  if (m) {
    const min = Number(m[1])
    const byMs = Object.entries(TF_MS).find(([, ms]) => ms === min * 60000)
    if (byMs) return byMs[0]
    throw new DataError(`khong co khung ${min}m (khung co san: ${Object.keys(TF_MS).join(', ')})`)
  }
  const h = /^(\d+)\s*h$/i.exec(s)
  if (h) {
    const ms = Number(h[1]) * 3600000
    const byMs = Object.entries(TF_MS).find(([, v]) => v === ms)
    if (byMs) return byMs[0]
    throw new DataError(`khong co khung ${h[1]}h`)
  }
  const up = s.toUpperCase()
  if (TF_MS[up]) return up
  throw new DataError(`tf khong ro "${raw}" (vd: 5m, 15m, 1h, 4m, 10m, D)`)
}

/** Ghop preset + --params (JSON) thanh bo tham so day du. */
export function buildParams({ preset, paramsJson }) {
  let p = {}
  if (preset) {
    if (!PRESETS[preset]) {
      throw new DataError(`preset khong ton tai "${preset}" (co: ${Object.keys(PRESETS).join(', ')})`)
    }
    p = { ...PRESETS[preset] }
  }
  if (paramsJson) {
    let extra
    try {
      extra = typeof paramsJson === 'string' ? JSON.parse(paramsJson) : paramsJson
    } catch (e) {
      throw new DataError(`--params khong phai JSON hop le: ${e.message}`)
    }
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
      throw new DataError('--params phai la object JSON')
    }
    p = { ...p, ...extra }
  }
  return p
}

/**
 * Lay du lieu cho 1 khung: neu khung la 4m/10m -> lay 1m roi resample.
 * Tra ve { bars, bars1m|null, source, fetchedAt, fromCache }.
 */
async function getBars({ apiSymbol, tf, market, dataDir, limit, refresh, fetchImpl }) {
  if (MUST_RESAMPLE.includes(tf)) {
    const raw = await fetchKlines({ symbol: apiSymbol, tf: '1', market, dataDir, limit, refresh, fetchImpl })
    const bars = resample(raw.bars, TF_MS[tf], 60000)
    if (bars.length === 0) throw new DataError(`resample ${tf} cho rong`, { tf })
    // 1m van giu lai de D6 phan giai thu tu TP/SL (mien phi vi da lay roi)
    return { bars, bars1m: raw.bars, source: `${raw.source} ->resample ${tf}`, fetchedAt: raw.fetchedAt, fromCache: raw.fromCache }
  }
  const raw = await fetchKlines({ symbol: apiSymbol, tf, market, dataDir, limit, refresh, fetchImpl })
  return { bars: raw.bars, bars1m: null, source: raw.source, fetchedAt: raw.fetchedAt, fromCache: raw.fromCache }
}

/** Lay 1m cho D6 khi khung khong phai resample (chi khi --sub1m). */
async function getSub1m({ apiSymbol, bars, tf, market, dataDir, refresh, fetchImpl, maxMinutes }) {
  const tfMs = TF_MS[tf]
  const span = bars[bars.length - 1].time - bars[0].time + tfMs
  const minutes = Math.ceil(span / 60000) + 2
  if (minutes > maxMinutes) {
    // Khong im lang: neu bo qua ma van chay, D6 se tu dong roi ve SL bao thu
    // va ai do se doc ket qua la "da phan giai". Canh bao ro rang.
    console.warn(`[run] bo qua sub1m: can ${minutes} bar 1m > nguong ${maxMinutes} (D6 se ve SL bao thu)`)
    return null
  }
  try {
    const raw = await fetchKlines({
      symbol: apiSymbol, tf: '1', market, dataDir,
      limit: minutes, refresh, fetchImpl, endTime: bars[bars.length - 1].time + tfMs - 1,
    })
    return raw.bars
  } catch (e) {
    console.warn(`[run] khong lay duoc 1m cho D6: ${e.message} (D6 se ve SL bao thu)`)
    return null
  }
}

/**
 * Chay 1 (symbol, tf).
 * @returns {Promise<{symbol,tf,summary,excluded,rows,universeEntry,runId}>}
 */
export async function runOne(o) {
  const { bars, bars1m, source, fetchedAt } = await getBars({ ...o, apiSymbol: o.api })
  const tfMs = TF_MS[o.tf]

  let sub1m = bars1m
  if (!sub1m && o.wantSub1m) {
    sub1m = await getSub1m({ ...o, apiSymbol: o.api, bars, tf: o.tf, maxMinutes: o.maxSub1mMinutes ?? 400000 })
  }

  const bt = backtest(bars, {
    method: o.method ?? 'vsa',
    params: o.params,
    symbol: o.display,
    tf: o.tf,
    sub1m,
    onReplace: o.onReplace,
  })

  const run = {
    // D1: params bat buoc truoc khi ghi. `params` o day la BO PHU (preset +
    // --params); withStamp se merge DEFAULTS truoc khi hash -> khong ai bi lech.
    params: o.params ?? {},
    symbol: o.display,
    tf: o.tf,
    market: o.market,
    source,
    fetchedAt,
    dataFromCache: o.dataFromCache ?? false,
    variant: bt.variant,
    method: bt.method,
    preset: o.preset ?? null,
    sub1mUsed: !!sub1m,
  }

  const saved = await saveRun(run, {
    trades: bt.trades,
    bars,
    mongo: o.mongo === false ? false : 'auto',
    runsFile: o.runsFile,
    tradesFile: o.tradesFile,
  })

  const summary = summarizeBacktest({ ...bt }, {
    engineVersion: saved.run.engineVersion,
    paramsHash: saved.run.paramsHash,
    params: saved.run.params,
  })

  return {
    symbol: o.display,
    tf: o.tf,
    summary,
    trades: bt.trades,
    counters: bt.counters,
    bars: bars.length,
    source,
    fetchedAt,
    excluded: false,
    runId: saved.runId,
    warnings: saved.warnings,
  }
}

/** Ghi 1 file CSV (tao thu muc). Tra ve duong da ghi. */
function writeCsv(path, rows, columns) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, toCsv(rows, columns))
  return path
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv)

  if (a.h === true || a.help === true) {
    console.log(USAGE)
    return 0
  }

  const market = a.market ?? 'fapi'
  if (!MARKETS[market]) throw new DataError(`--market khong ho tro "${market}" (chi: ${Object.keys(MARKETS).join(', ')})`)

  const symbolsRaw = String(a.symbols ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const tfsRaw = String(a.tfs ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (symbolsRaw.length === 0) throw new DataError('thieu --symbols (vd: --symbols BTCUSDT.P,ETHUSDT.P)')
  if (tfsRaw.length === 0) throw new DataError('thieu --tfs (vd: --tfs 5m,15m,1h)')

  const params = buildParams({ preset: a.preset, paramsJson: a.params })
  const tfs = tfsRaw.map(normalizeTf)
  const symbols = symbolsRaw.map((s) => normalizeSymbol(s, market))
  const limit = a.limit !== undefined ? Number(a.limit) : 5000
  const wantSub1m = a.sub1m === true || a.sub1m === 'true'
  const quiet = a.quiet === true || a.quiet === 'true'
  const dataDir = a['data-dir'] ? String(a['data-dir']) : join(ROOT, 'data')
  const outDir = a.out ? String(a.out) : join(ROOT, 'reports')
  const minBars = a['min-bars'] !== undefined ? Number(a['min-bars']) : 0
  const minTrades = a['min-trades'] !== undefined ? Number(a['min-trades']) : 0

  if (!Number.isFinite(limit) || limit <= 0) throw new DataError('--limit phai la so duong')
  if (!Number.isFinite(minBars) || minBars < 0) throw new DataError('--min-bars phai la so >= 0')
  if (!Number.isFinite(minTrades) || minTrades < 0) throw new DataError('--min-trades phai la >= 0')

  const methodId = a.method ?? 'vsa'
  const known = listMethods()
  if (!known.includes(methodId)) {
    throw new DataError(`method khong ton tai "${methodId}" (co: ${known.join(', ')})`)
  }

  const jobs = []
  for (const sym of symbols) {
    for (const tf of tfs) jobs.push({ ...sym, tf })
  }

  console.log(`[run] ${jobs.length} chay · market=${market} · method=${methodId}` +
    `${a.preset ? ` · preset=${a.preset}` : ''} · limit=${limit} bars` +
    `${minBars || minTrades ? ` · min-history bars>=${minBars} trades>=${minTrades}` : ' · khong loc min-history'}`)

  const results = []
  const failures = []
  for (const j of jobs) {
    const label = `${j.display} ${j.tf}`
    try {
      const r = await runOne({
        ...j,
        market,
        dataDir,
        limit,
        refresh: a.refresh === true || a.refresh === 'true',
        params,
        method: methodId,
        preset: a.preset ?? null,
        wantSub1m,
        onReplace: a['on-replace'],
        mongo: a['no-mongo'] === true || a['no-mongo'] === 'true' ? false : undefined,
        runsFile: a['runs-file'],
        tradesFile: a['trades-file'],
      })
      results.push(r)
      if (!quiet) console.log(formatSummary({ ...r.summary, method: methodId }, { title: `${label}  (bars=${r.bars}, source=${r.source})` }) + '\n')
    } catch (e) {
      // 1 symbol loi khong duoc lam het cu chay - nhung PHAI hien ro ten symbol
      // (neu in chi "loi fetch" thi khong biet do symbol nao bi mat).
      failures.push({ label, message: e.message })
      console.error(`[run] LOI ${label}: ${e.message}`)
    }
  }

  if (results.length === 0) {
    console.error('[run] khong co chay nao thanh cong')
    return 1
  }

  // --- D11: universe snapshot, chot TRUOC khi in bao cao de biet dong nao bi loai
  const snap = universeSnapshot({
    market,
    minHistoryBars: minBars,
    minTrades,
    entries: results.map((r) => ({ symbol: r.symbol, bars: r.bars, trades: r.summary.trades })),
  })
  const excludedSet = new Set(snap.symbols.filter((s) => s.excluded).map((s) => s.symbol))
  for (const r of results) r.excluded = excludedSet.has(r.symbol)
  const excludedReasons = new Map(snap.symbols.map((s) => [s.symbol, s.reason]))

  // --- CSV -------------------------------------------------------------------
  mkdirSync(outDir, { recursive: true })
  const written = []
  for (const r of results) {
    const p = join(outDir, `${r.symbol.replace(/[^\w.-]/g, '_')}-${r.tf}-trades.csv`)
    writeCsv(p, r.trades, TRADE_COLUMNS)
    written.push(p)
  }
  const rows = results.map((r) => ({ ...summaryRow(r.symbol, r.tf, { ...r.summary, variant: r.summary.variant ?? null }), excluded: r.excluded ? 'true' : '', excludedReason: excludedReasons.get(r.symbol) ?? '' }))
  const summaryPath = join(outDir, 'summary.csv')
  writeCsv(summaryPath, rows, [...SUMMARY_COLUMNS, 'excluded', 'excludedReason'])
  written.push(summaryPath)

  const universePath = join(outDir, 'universe.json')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(universePath, JSON.stringify(snap, null, 2))
  written.push(universePath)

  // --- Console ---------------------------------------------------------------
  console.log('\n=== BANG TONG HOP SYMBOL x TF ===')
  console.log(formatMatrix(results.map((r) => ({
    symbol: r.excluded ? `${r.symbol} (LOAI)` : r.symbol,
    tf: r.tf,
    summary: r.summary,
  }))))

  // CANH BAO DU LIEU - phai in CA trong che do --quiet. --quiet chi bo phep
  // in tung bao cao chi tiet, khong bao gio bo phep bo qua canh bao ve tinh
  // trung thuc cua chinh bang ket qua dang doc.
  const totalReplaced = results.reduce((s, r) => s + (r.counters?.replaced ?? 0), 0)
  const totalDropped = results.reduce((s, r) => s + (r.counters?.dropped ?? 0), 0)
  const totalTrades = results.reduce((s, r) => s + (r.summary?.trades ?? 0), 0)
  const totalSetups = results.reduce((s, r) => s + (r.counters?.setups ?? 0), 0)
  if (totalDropped > 0) {
    const pct = totalSetups ? ((totalDropped / totalSetups) * 100).toFixed(1) : '?'
    console.log(`\n[!] D5 (mac dinh = dung voi Pine): ${totalDropped}/${totalSetups} setup (${pct}%) da khop nhung bi ST sau`)
    console.log(`    thay truoc khi co ket qua -> BI LOAI khoi ${totalTrades} lenh o tren. WR/PF/net chi la`)
    console.log(`    cua cac lenh CON LAI, khong phai cua ${totalSetups} setup.`)
    console.log(`    Xem chinh sach nay: --on-replace ttl (dong tai bar thay the, bi LOAI khoi parity).`)
    if (totalDropped / Math.max(totalSetups, 1) > 0.5) {
      console.log(`    !! >50% setup bi loai. BANG TREN KHONG DAI DIEN cho toan bo du lieu.`)
    }
  }

  if (snap.excludedCount > 0) {
    console.log(`\n${snap.excludedCount} dong bi LOAI boi min-history (van DUOC LUU o ${universePath}):`)
    for (const s of snap.symbols.filter((x) => x.excluded)) console.log(`  - ${s.symbol}: ${s.reason}`)
  }
  if (minBars === 0 && minTrades === 0) {
    console.log('\n[!] Chua bat min-history (--min-bars/--min-trades = 0): token moi co 20 lenh')
    console.log('    dang bi tron vao cung bang voi BTC. Bat len truoc khi doc ket qua la su that.')
  }
  console.log(`\n[!] ${snap.survivorshipNote}`)

  console.log('\n=== PHAN MAU (van tai o reports/) ===')
  for (const p of written) console.log(`  ${p}`)

  if (failures.length > 0) {
    console.log(`\n${failures.length} chay LOI (khong dung toan bo ket qua):`)
    for (const f of failures) console.log(`  - ${f.label}: ${f.message}`)
  }

  return failures.length > 0 ? 1 : 0
}

const USAGE = `tm-trading · engine backtest CLI

  npm run engine:run -- --symbols BTCUSDT.P,ETHUSDT.P,ZECUSDT.P --tfs 5m,15m,1h
  npm run engine:run -- --symbols BTCUSDT.P --tfs 4m,10m --sub1m
  node engine/run.mjs --help

  --symbols      dsach tach dau phay (BTCUSDT.P,ETHUSDT.P)
  --tfs          dsach khung (5m,15m,1h,4m,10m,D)
  --market       fapi (mac dinh) | spot
  --preset       ${Object.keys(PRESETS).join(' | ')}
  --params       JSON bo sung tham so (vd: --params '{"slBuf":0.8}')
  --method       ${listMethods().join(' | ')}  (mac dinh vsa)
  --sub1m        lay 1m de D6 phan giai thu tu TP/SL (tu dong voi 4m/10m)
  --on-replace   drop (mac dinh, dung voi Pine) | ttl (variant, bi loai parity)
  --refresh       bo qua cache
  --limit         so bar toi da (mac dinh 5000)
  --min-bars      D11: loai symbol it hon N bar lich su (mac dinh 0)
  --min-trades    D11: loai symbol it hon N lenh (mac dinh 0)
  --no-mongo      chi ghi NDJSON
  --out           thu muc CSV (mac dinh reports/)
  --quiet         chi in bang tong hop
`

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`\n[run] LOI: ${e.message}`)
    process.exit(1)
  })
}
