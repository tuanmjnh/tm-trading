#!/usr/bin/env node
// =============================================================================
//  TM TRADING - BAO CAO (roadmap Phase 4)
//
//  Bao cao chi LA MAT TRINH BAY. Toan bo so lieu toi uu den tu
//  `summarizeRuns()` (engine/store.mjs) - khong tinh lai mot so nao o day, neu
//  khong se co 2 noi tinh WR/PF va chung se lech nhau.
//
//  Nguyen tac TRUNG THUC (rui ro #6 "bao cao dep hon thuc te"):
//    - `noFill` (limit khong khop) va `replaced` (setup bi ST thay, D5) phai
//      HIEN RA ro rang, khong dung chung vao `trades`. Neu khong, WR/PF cua
//      nhung lenh CON LAI se duoc doc thanh ket qua cua ca he thong.
//    - `profitFactor = Infinity` phai in ra "inf" ro rang, khong phai la so
//      lon ngo nhien.
//    - Moi file CSV di kem mot dong comment/`paramsHash` de biet chay nao.
//
//  Dinh dang:
//      console : formatSummary(summary)  -> chuoi in ra terminal
//                 formatMatrix(rows)     -> bang symbol x TF
//      csv     : toCsv(rows, columns)    -> chuan RFC4180 (dau ",", ky tu "
//                 escaping = lap ", ). Khong dua vao thu vien ngoai.
// =============================================================================
import { summarizeRuns } from './store.mjs'

/**
 * Gom mot ket qua cua backtest() thanh object de `summarizeRuns` doc duoc.
 * `backtest()` khong phai run - no khong co paramsHash/engineVersion. Nguoi goi
 * (run.mjs) truoc do se chot stamp, o day chi chuan bi phan trades.
 */
export function toRunDoc(bt, extra = {}) {
  if (!bt || !Array.isArray(bt.trades)) throw new Error('toRunDoc: thieu bt.trades (hay khong phai ket qua backtest?)')
  return { ...extra, trades: bt.trades }
}

/**
 * Thong ke cho MOT nhom cau hinh (D1: khong duoc tron 2 the he params).
 * Bao gom ca counters cua backtest de khong mat `noFill`/`replaced`.
 */
export function summarizeBacktest(bt, extra = {}) {
  const summary = summarizeRuns([toRunDoc(bt, extra)], { label: 'report' })
  return { ...summary, counters: bt.counters ?? null, variant: bt.variant ?? null, method: bt.method ?? null }
}

/** PF vo han in ro rang, khong phai so khong y nghia. */
function num(x, digits = 2) {
  if (x === Infinity) return 'inf'
  if (!Number.isFinite(x)) return 'n/a'
  return digits === 0 ? String(Math.round(x)) : x.toFixed(digits)
}

/**
 * In mot bao cao cho 1 nhom cau hinh.
 * Tra ve CHUOI (khong console.log truc tiep) de test duoc va de run.mjs gop.
 */
export function formatSummary(s, { title = 'report' } = {}) {
  const c = s.counters ?? null
  const lines = []
  const pad = (k) => String(k).padEnd(22)

  lines.push(`--- ${title} ---`)
  lines.push(`${pad('method')} : ${s.method ?? '-'}${s.variant ? `  [VARIANT: ${s.variant} — LOAI khoi so sanh parity]` : ''}`)
  lines.push(`${pad('engineVersion')} : ${s.engineVersion ?? '-'}   paramsHash=${s.paramsHash ?? '-'}`)
  lines.push(`${pad('runs / trades (dong)')} : ${s.runs} / ${s.trades}${s.open ? `  (+${s.open} OPEN)` : ''}`)
  lines.push(`${pad('wins / losses')} : ${s.wins} / ${s.losses}`)
  lines.push(`${pad('winRate')} : ${num(s.winRate * 100)}%`)
  lines.push(`${pad('profitFactor')} : ${num(s.profitFactor)}`)
  lines.push(`${pad('netPct (khong nhan loi)')} : ${num(s.netPct)}%`)
  lines.push(`${pad('maxDrawdownPct')} : ${num(s.maxDrawdownPct)}%`)
  lines.push(`${pad('avgRr / expectancy')} : ${num(s.avgRr)}R / ${num(s.expectancy)}R`)
  if (s.medianRr !== undefined) {
    lines.push(`${pad('medianRr')} : ${num(s.medianRr)}R   (median khong bi 1 lenh chiem)`)

    // CANH BAO TRUNG THUC: mean va median cung dau nguoc -> mot vai lenh
    // dang keo binh quan. Doc chi `avgRr` se nham (vd: avgRr = +0.15R trong khi
    // PF = 0.32, net = -16%). Phai IN RA, khong duoc de ai do doc 1 con so.
    const m = s.avgRr ?? 0
    const d = s.medianRr ?? 0
    if (m * d < 0) {
      lines.push(`  !! AVG vs MEDIAN CUNG DAU NGUOC (avg ${num(m)}R vs median ${num(d)}R).`)
      lines.push(`     Mot it lenh co risk/entry rat nho dang keo binh quan R.`)
      lines.push(`     Dung medianRr (va PF/net) de danh gia - khong dung avgRr don bo.`)
    }
    if (s.degenerateRisk > 0) {
      const pct = s.trades ? ((s.degenerateRisk / s.trades) * 100).toFixed(1) : '0'
      lines.push(`  !! ${s.degenerateRisk}/${s.trades} lenh (${pct}%) co risk < 0.1% cua entry -> R qua nhay.`)
      lines.push(`     Van GIU trong du lieu (la that), nhung R cua chung khong doi xung voi cac lenh khac.`)
    }
  }

  if (c) {
    // Phan nay KHONG duoc an: day la su khac biet giua "ket qua cua cac lenh
    // khop" va "ket qua cua ca bo du lieu".
    lines.push(`${pad('  setup (tong)')} : ${c.setups}`)
    lines.push(`${pad('  khop / khong khop')} : ${c.filled} / ${c.noFill}${c.noFill ? '   (limit khong ve lai cuc tri)' : ''}`)
    lines.push(`${pad('  dong (TP/SL/TIME)')} : ${c.closed}`)
    lines.push(`${pad('  con mo (OPEN)')} : ${c.open}`)
    lines.push(`${pad('  bi ST thay (D5)')} : ${c.replaced}${c.dropped ? `  (dropped=${c.dropped} — khong tinh vao so o tren)` : '  (che do ttl: dong tai bar thay the)'}`)
    // Chi keo canh bao "bi loai" khi THUC SU co lenh bi loai (dropped > 0).
    // Truoc do text nay in ca voi ttl -> noi "chay lai voi onReplace='ttl'"
    // trong khi dang chay chinh ttl.
    if (c.dropped > 0) {
      lines.push(`  !! ${c.dropped} setup da khop nhung khong co ket qua va BI LOAI khoi ${s.trades} lenh tren.`)
      lines.push(`     WR/PF/net chi la cua cac lenh con lai, khong phai cua ${c.setups} setup.`)
      lines.push(`     Chay lai voi --on-replace ttl de dong tai bar thay the (bien the nay bi loai khoi parity).`)
    } else if (s.variant === 'onReplace=ttl' && c.replaced > 0) {
      lines.push(`     ${c.replaced} lenh nay dong vi thay the (result=TIME), khong phai vi cham TP/SL.`)
      lines.push(`     BIEN THE NAY bi loai khoi moi so sanh parity voi Pine.`)
    }
  }
  return lines.join('\n')
}

/**
 * Bang tong hop symbol x TF (acceptance Phase 4).
 * @param {{symbol:string,tf:string,summary:object}[]} rows
 */
export function formatMatrix(rows) {
  const head = ['symbol', 'tf', 'trades', 'winRate%', 'PF', 'net%', 'maxDD%', 'avgR', 'medR', 'noFill', 'replaced']
  const body = rows.map((r) => {
    const s = r.summary ?? {}
    const c = s.counters ?? {}
    // Dau * = avg va median cung dau nguoc -> khong doc avg don bo.
    const avg = s.avgRr ?? 0
    const med = s.medianRr ?? 0
    const flag = avg * med < 0 ? '*' : ''
    return [
      r.symbol, r.tf,
      String(s.trades ?? 0),
      num((s.winRate ?? 0) * 100, 1),
      num(s.profitFactor),
      num(s.netPct),
      num(s.maxDrawdownPct),
      num(avg) + flag,
      num(med) + flag,
      String(c.noFill ?? '-'),
      String(c.replaced ?? '-'),
    ]
  })
  const table = [head, ...body]
  const w = head.map((_, i) => Math.max(...table.map((r) => r[i].length)))
  return table.map((r) => r.map((v, i) => v.padEnd(w[i])).join('  ').trimEnd()).join('\n')
}

/** Escape theo RFC4180: boc " khi co dau phay / xuong dong / ky tu ". */
function csvCell(v) {
  if (v === null || v === undefined) return ''
  const s = v instanceof Date ? v.toISOString() : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Ghi CSV. `columns` = ten truong (lay theo thu tu) - khong doan tu object dau
 * tien vi tung dong co the khac nhau (open trade thieu exit*).
 */
export function toCsv(rows, columns) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('toCsv: thieu columns (khong doan tu object dau tien)')
  const lines = [columns.map(csvCell).join(',')]
  for (const r of rows ?? []) lines.push(columns.map((k) => csvCell(r?.[k])).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** Cac cot cua Trade model (engine/models/trade.mjs) - khong thay doi tuy tinh. */
export const TRADE_COLUMNS = Object.freeze([
  'symbol', 'tf', 'method', 'dir',
  'entryTime', 'entryPrice', 'exitTime', 'exitPrice',
  'sl', 'tp', 'result', 'barsHeld', 'pnlPct', 'rMultiple', 'resolvedBy1m',
])

/** Cot cua bang tong hop (symbol x TF). */
export const SUMMARY_COLUMNS = Object.freeze([
  'symbol', 'tf', 'method', 'engineVersion', 'paramsHash',
  'trades', 'open', 'wins', 'losses', 'winRate', 'profitFactor',
  'netPct', 'maxDrawdownPct', 'avgRr', 'medianRr', 'expectancy', 'degenerateRisk',
  'setups', 'filled', 'noFill', 'closed', 'replaced', 'dropped', 'variant',
])

/** Dong bang tong hop, chuan bi de toCsv(SUMMARY_COLUMNS). */
export function summaryRow(symbol, tf, s) {
  const c = s.counters ?? {}
  return {
    symbol, tf,
    method: s.method ?? '',
    engineVersion: s.engineVersion ?? '',
    paramsHash: s.paramsHash ?? '',
    trades: s.trades ?? 0,
    open: s.open ?? 0,
    wins: s.wins ?? 0,
    losses: s.losses ?? 0,
    winRate: Number(((s.winRate ?? 0) * 100).toFixed(4)),
    profitFactor: Number.isFinite(s.profitFactor) ? Number(s.profitFactor.toFixed(6)) : 'inf',
    netPct: Number((s.netPct ?? 0).toFixed(6)),
    maxDrawdownPct: Number((s.maxDrawdownPct ?? 0).toFixed(6)),
    avgRr: Number((s.avgRr ?? 0).toFixed(6)),
    medianRr: Number((s.medianRr ?? 0).toFixed(6)),
    expectancy: Number((s.expectancy ?? 0).toFixed(6)),
    degenerateRisk: s.degenerateRisk ?? 0,
    setups: c.setups ?? '',
    filled: c.filled ?? '',
    noFill: c.noFill ?? '',
    closed: c.closed ?? '',
    replaced: c.replaced ?? '',
    dropped: c.dropped ?? '',
    variant: s.variant ?? '',
  }
}
