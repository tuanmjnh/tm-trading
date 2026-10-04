#!/usr/bin/env node
// =============================================================================
//  TM TRADING - METHOD LEAGUE (Phase 10)
//
//  Bang xep hang method (vsa/price-action/trend/orderflow) tren nhieu
//  symbol x khung thoi gian. CHI DOC: khong luu run vao NDJSON, khong cham
//  Mongo — chi ghi file Markdown ket qua.
//
//  Chay:
//    npm run engine:league                       # mac dinh: 4 method x 3 symbol x [60,15]
//    node engine/league.mjs --methods vsa,trend --symbols BTCUSDT,ETHUSDT --tfs 60,240
//    node engine/league.mjs --limit 2000 --refresh
//    node engine/league.mjs --no-write           # chi in console
//
//  QUY UOC DOC KET QUA (de khong doc sai):
//   - Params = DEFAULTS cua tung method (chua optimize) — day la DIEM KHO de
//     so sanh method voi nhau, khong phai ket qua toi uu cua bat ky ai.
//   - Phi/slippage theo feePct/slipPct cua tung method (mac dinh 0.05% / 0.02%
//     moi ben) — tinh trong backtest, khong phai cong them sau.
//   - "Pooled" = gop toan bo trades cua 1 method qua cac o (symbol x tf):
//     TONG phan tram khong compound, maxDD gop chi tham khao — khong phai
//     equity curve cua mot tai khoan that. Can so sanh nghiem tuc -> doc tung o.
//   - Khong dung sub1m -> cung bar cham SL + TP tinh theo SL bao thu (D6 phan
//   - giai chi chay khi co du lieu 1m).
//   - Data lay tu data/ cache truoc, het thi fetch Binance (can mang).
// =============================================================================

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchKlines, resample, MUST_RESAMPLE, TF_MS, DataError } from './data.mjs'
import { backtest } from './backtest.mjs'
import { getMethod, listMethods } from './methods/index.mjs'
import './methods/all.mjs' // dang ky ca 4 method truoc khi listMethods() chay
import { summarizeBacktest, summaryRow } from './report.mjs'
import { summarizeRuns } from './store.mjs'
import { hashOf, ENGINE_VERSION } from './version.mjs'
import { parseArgs, normalizeTf, normalizeSymbol, BOOLEAN_FLAGS } from './run.mjs'

const DEFAULT_SYMBOLS = 'BTCUSDT,ETHUSDT,ZECUSDT'
const DEFAULT_TFS = '60,15'
const DEFAULT_LIMIT = 1000
const MIN_BARS = 100 // duoi do khong du warmup (slow MA 50 + pivot)

/** Lay bars (cache truoc, fetch sau) — giong getBars cua run.mjs nhung khong luu. */
async function getBars({ apiSymbol, tf, market, limit, refresh }) {
  if (MUST_RESAMPLE.includes(tf)) {
    const raw = await fetchKlines({ symbol: apiSymbol, tf: '1', market, limit, refresh })
    const bars = resample(raw.bars, TF_MS[tf], 60000)
    if (bars.length === 0) throw new DataError(`resample ${tf} cho rong`, { tf })
    return bars
  }
  const raw = await fetchKlines({ symbol: apiSymbol, tf, market, limit, refresh })
  return raw.bars
}

const fmtPct = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')
const fmtPf = (x) => (x === Infinity ? 'inf' : Number.isFinite(x) ? x.toFixed(2) : 'n/a')

function padTable(head, rows) {
  const all = [head, ...rows.map((r) => r.map(String))]
  const w = head.map((_, c) => Math.max(...all.map((r) => r[c].length)))
  const line = (r) => r.map((v, c) => String(v).padEnd(w[c])).join('  ')
  return [line(all[0]), w.map((n) => '-'.repeat(n)).join('  '), ...all.slice(1).map(line)].join('\n')
}

function mdTable(head, rows) {
  const esc = (v) => String(v).replace(/\|/g, '\\|')
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n')
}

export async function league(argv = process.argv.slice(2)) {
  const a = parseArgs(argv)
  if (a.help || a.h) {
    console.log(` league: --methods <csv> --symbols <csv> --tfs <csv> --limit <n> --out <md>
         --no-write (chi in) --refresh (fetch lau) --market <fapi|spot>`)
    return 0
  }

  const known = listMethods()
  const methods = String(a.methods ?? known.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = methods.filter((m) => !known.includes(m))
  if (unknown.length) {
    console.error(`league: method khong ton tai: ${unknown.join(', ')} (co san: ${known.join(', ')})`)
    return 1
  }
  const symbols = String(a.symbols ?? DEFAULT_SYMBOLS)
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  let tfs
  try {
    tfs = [...new Set(String(a.tfs ?? DEFAULT_TFS).split(',').map((t) => normalizeTf(t.trim())))]
  } catch (e) {
    console.error(`league: ${e.message}`)
    return 1
  }
  const limit = Number(a.limit ?? DEFAULT_LIMIT)
  const market = String(a.market ?? 'fapi')
  const refresh = !!a.refresh
  const noWrite = !!a['no-write']
  const out = String(a.out ?? join('docs', 'method-league.md'))

  const rows = []      // tung o: {method, symbol, tf, bars, row(summaryRow)}
  const pooled = new Map() // method -> {trades, params, name}
  const notes = []
  let tMin = Infinity
  let tMax = -Infinity

  for (const sym of symbols) {
    const fs = normalizeSymbol(sym, market)
    for (const tf of tfs) {
      let bars
      try {
        bars = await getBars({ apiSymbol: fs.api, tf, market, limit, refresh })
      } catch (e) {
        notes.push(`skip ${sym}/${tf}: ${e.message}`)
        console.warn(`[league] skip ${sym}/${tf}: ${e.message}`)
        continue
      }
      if (!Array.isArray(bars) || bars.length < MIN_BARS) {
        notes.push(`skip ${sym}/${tf}: chi co ${bars?.length ?? 0} bar (< ${MIN_BARS})`)
        continue
      }
      tMin = Math.min(tMin, bars[0].time)
      tMax = Math.max(tMax, bars[bars.length - 1].time)

      for (const id of methods) {
        let bt
        try {
          bt = backtest(bars, { method: id, symbol: fs.display, tf })
        } catch (e) {
          notes.push(`backtest ${id}/${sym}/${tf}: ${e.message}`)
          continue
        }
        // hashOf (khong phai paramsHash): PARAM_SCHEMA = DEFAULTS cua VSA —
        // can method moi (pinWick, deltaTh, ...) se bi canonicalParams tu choi.
        // League can chi mot khoa nhom the hinh on dinh -> hashOf la du.
        const gen = hashOf({ method: id, params: bt.params })
        const sm = summarizeBacktest({ ...bt }, {
          params: bt.params,
          paramsHash: gen,
          engineVersion: ENGINE_VERSION,
        })
        rows.push({ method: id, symbol: sym, tf, bars: bars.length, row: summaryRow(sym, tf, sm) })

        const p = pooled.get(id) ?? { trades: [], params: bt.params, name: getMethod(id).name }
        p.trades.push(...bt.trades)
        pooled.set(id, p)
      }
    }
  }

  if (!rows.length) {
    console.error('league: khong co o nao chay duoc' + (notes.length ? `\n  ${notes.join('\n  ')}` : ''))
    return 1
  }

  // --- Pooled theo method (1 generation = 1 bo params) ---
  const poolOut = []
  for (const id of methods) {
    const p = pooled.get(id)
    if (!p) continue
    const s = summarizeRuns([{
      trades: p.trades,
      params: p.params,
      paramsHash: hashOf({ method: id, params: p.params }),
      engineVersion: ENGINE_VERSION,
    }], { label: 'league' })
    poolOut.push({
      id, name: p.name,
      trades: s.trades, open: s.open, winRate: s.winRate,
      pf: s.profitFactor, netPct: s.netPct, expectancy: s.expectancy,
    })
  }

  // --- In console ---
  const head = ['Method', 'Trades', 'Closed', 'WR%', 'PF', 'Net%', 'E[R]']
  const poolTable = padTable(head, poolOut.map((s) => [
    s.id, String(s.trades), String(s.trades - s.open), fmtPct(s.winRate * 100, 1),
    fmtPf(s.pf), fmtPct(s.netPct), fmtPct(s.expectancy),
  ]))
  const detHead = ['Method', 'Symbol', 'TF', 'Bars', 'Trades', 'Closed', 'WR%', 'PF', 'Net%', 'MaxDD%', 'NoFill', 'Repl']
  const detTable = padTable(detHead, rows.map((r) => [
    r.method, r.symbol, r.tf, String(r.bars), String(r.row.trades), String(r.row.closed),
    fmtPct(r.row.winRate, 1), fmtPf(Number(r.row.profitFactor)), fmtPct(r.row.netPct),
    fmtPct(r.row.maxDrawdownPct), String(r.row.noFill ?? '-'), String(r.row.replaced ?? '-'),
  ]))
  console.log(`\n=== METHOD LEAGUE — pooled (gop ${symbols.length} symbol x ${tfs.length} tf) ===\n`)
  console.log(poolTable)
  console.log(`\n=== Chi tiet tung o (method x symbol x tf) ===\n`)
  console.log(detTable)
  if (notes.length) console.log(`\nNote:\n  ${notes.join('\n  ')}`)

  // --- Ghi Markdown ---
  if (!noWrite) {
    const win = Number.isFinite(tMin) && Number.isFinite(tMax)
      ? `${new Date(tMin).toISOString().slice(0, 16).replace('T', ' ')} -> ${new Date(tMax).toISOString().slice(0, 16).replace('T', ' ')} (UTC)`
      : 'n/a'
    const md = [
      '# Method League',
      '',
      '> Sinh tu dong boi `npm run engine:league` (engine/league.mjs) — KHONG chinh sua tay.',
      '',
      `- Sinh luc: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
      `- Cua so du lieu: ${win} — toi da ${limit} bar/moi o`,
      `- Symbol x TF: ${symbols.join(', ')} x [${tfs.join(', ')}]`,
      `- Method: ${methods.map((m) => `${m} (${getMethod(m).name})`).join('; ')}`,
      '- Params: DEFAULTS tung method (chua optimize); phi/slippage theo feePct/slipPct cua method.',
      '- Khong dung sub1m: cung bar SL+TP tinh theo SL bao thu.',
      ...(notes.length ? ['', '## Note', ...notes.map((n) => `- ${n}`)] : []),
      '',
      '## Pooled theo method',
      '',
      '_Gop toan bo trades cac o: tong % khong compound, chi tham khao — can so sanh nghiem tuc doc bang chi tiet._',
      '',
      mdTable(head, poolOut.map((s) => [
        s.id, s.trades, s.trades - s.open, fmtPct(s.winRate * 100, 1),
        fmtPf(s.pf), fmtPct(s.netPct), fmtPct(s.expectancy),
      ])),
      '',
      '## Chi tiet tung o',
      '',
      mdTable(detHead, rows.map((r) => [
        r.method, r.symbol, r.tf, r.bars, r.row.trades, r.row.closed,
        fmtPct(r.row.winRate, 1), fmtPf(Number(r.row.profitFactor)), fmtPct(r.row.netPct),
        fmtPct(r.row.maxDrawdownPct), r.row.noFill ?? '-', r.row.replaced ?? '-',
      ])),
      '',
    ].join('\n')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, md, 'utf8')
    console.log(`\nDa ghi ${out}`)
  }
  return 0
}

// Chay tu CLI (khong chay khi bi import trong test) — giong run.mjs
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  league().then((code) => process.exit(code))
}
