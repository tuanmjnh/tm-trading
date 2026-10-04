#!/usr/bin/env node
// =============================================================================
//  TM TRADING - SERVICES ORCHESTRATOR (roadmap Phase 8–9).
//
//    node services/run.mjs once    — chạy 1 vòng: funding -> scanner -> news
//                                    -> regime -> liquidation -> confluence
//    node services/run.mjs watch   — lặp theo chu kỳ + kiểm tra D9 mỗi 60s
//                                    + WS collect forceOrder (liq events)
//    node services/run.mjs status  — in bảng heartbeat (exit 1 nếu có overdue)
//
//  Heartbeat (D9): beat() trước mỗi lần chạy (lastRunAt), ok/err sau kết quả.
//  `watch` kiểm tra overdue 2×chu kỳ -> Telegram (nhắc lại mỗi
//  HEARTBEAT_REMIND_H, xem services/heartbeat.mjs).
// =============================================================================
import { pathToFileURL } from 'node:url'
import { loadEnv } from '../exec/env.mjs'
import { DEFAULT_INTERVALS, beat, readHeartbeat, evaluateHeartbeat, checkOverdue, HEARTBEAT_FILE } from './heartbeat.mjs'
import { sendTelegram } from './telegram.mjs'
import { runFunding } from './funding.mjs'
import { runScanner } from './scanner.mjs'
import { runNews } from './news.mjs'
import { runRegime } from './regime.mjs'
import { runLiquidation, startLiqCollector } from './liquidation.mjs'
import { runConfluence } from './confluence.mjs'
import { runBrief } from '../ai/daily-brief.mjs'

loadEnv()

const SERVICES = [
  { name: 'funding', run: runFunding, intervalSec: DEFAULT_INTERVALS.funding, tag: '[funding]' },
  { name: 'scanner', run: runScanner, intervalSec: DEFAULT_INTERVALS.scanner, tag: '[scanner]' },
  { name: 'news', run: runNews, intervalSec: DEFAULT_INTERVALS.news, tag: '[news]' },
  { name: 'regime', run: runRegime, intervalSec: DEFAULT_INTERVALS.regime, tag: '[regime]' },
  { name: 'liquidation', run: runLiquidation, intervalSec: DEFAULT_INTERVALS.liquidation, tag: '[liquidation]' },
  // Phase 10 — doc env TRUC TIEP (loadEnv() o tren da chay truoc dong nay,
  // khac DEFAULT_INTERVALS dong luc import -> khong thay .env).
  { name: 'confluence', run: runConfluence, intervalSec: Number(process.env.CONFLUENCE_INTERVAL || DEFAULT_INTERVALS.confluence), tag: '[confluence]' },
  // Phase 11 — AI daily brief: window-gated (AI_BRIEF_HOURS), skips cleanly
  // when AI_API_KEY is empty; same env-read pattern as confluence above.
  { name: 'brief', run: runBrief, intervalSec: Number(process.env.AI_BRIEF_INTERVAL || DEFAULT_INTERVALS.brief), tag: '[ai:brief]' },
]

const log = (tag, msg) => console.log(`${new Date().toISOString()} ${tag} ${msg}`)

async function runOne(s) {
  beat(s.name, { lastRunAt: new Date().toISOString(), intervalSec: s.intervalSec })
  const t0 = Date.now()
  try {
    const summary = await s.run()
    beat(s.name, {
      lastOkAt: new Date().toISOString(),
      count: (Number(readHeartbeat(HEARTBEAT_FILE).services?.[s.name]?.count) || 0) + 1,
      lastError: null,
      lastSummary: JSON.stringify(summary).slice(0, 500),
    })
    log(s.tag, `OK ${Date.now() - t0}ms ${JSON.stringify(summary)}`)
    return summary
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300)
    beat(s.name, { lastErrorAt: new Date().toISOString(), lastError: msg })
    log(s.tag, `FAIL ${Date.now() - t0}ms ${msg}`)
    return null
  }
}

async function once() {
  for (const s of SERVICES) await runOne(s)
}

async function watch() {
  log('[watch]', `chu ky: ${SERVICES.map((s) => `${s.name}=${s.intervalSec}s`).join(', ')}`)
  // WS forceOrder -> data/liq-events.ndjson (best effort — neu mang khong
  // nhan frame thi lang im, runLiquidation van doc duoc estimate REST).
  try {
    startLiqCollector()
    log('[watch]', 'liq collector: WS !forceOrder@arr da bat')
  } catch (e) {
    log('[watch]', `liq collector khong chay duoc: ${e?.message}`)
  }
  const timers = new Map()
  const schedule = (s, delayMs) => {
    timers.set(s.name, setTimeout(async () => {
      await runOne(s)
      schedule(s, s.intervalSec * 1000)
    }, delayMs))
  }
  SERVICES.forEach((s, i) => schedule(s, i * 3000)) // lệch pha nhẹ 3s

  // Kiem tra D9 (D9) — 60s/lan, nhanh hon chu ky nhieu lan de phat som.
  const checkSec = Number(process.env.HEARTBEAT_CHECK_SEC || 60)
  setInterval(async () => {
    try {
      const { overdue, alerted } = await checkOverdue({ send: (t) => sendTelegram(t, '[heartbeat]') })
      if (overdue.length) {
        log('[heartbeat]', `OVERDUE: ${overdue.map((r) => `${r.name}(${Math.round(r.overdueSec / 60)}m)`).join(', ')}${alerted.length ? ` -> da gui TG: ${alerted.join(',')}` : ''}`)
      }
    } catch (e) {
      log('[heartbeat]', `check loi: ${e?.message}`)
    }
  }, checkSec * 1000)

  // Giu process song; runOne fail da duoc catch rieng (khong kill watch).
  return new Promise(() => {})
}

function status() {
  const hb = readHeartbeat(HEARTBEAT_FILE)
  const rows = evaluateHeartbeat(hb)
  console.log(`heartbeat file: ${HEARTBEAT_FILE} (updatedAt=${hb.updatedAt || 'chua co'})`)
  if (!rows.length) {
    console.log('chua co service nao beat — chay: node services/run.mjs once')
    process.exit(1)
  }
  let bad = 0
  for (const r of rows) {
    const mark = r.overdue ? 'DEAD' : 'OK  '
    if (r.overdue) bad++
    console.log(
      `${mark} ${r.name.padEnd(8)} cu ${String(Math.round(r.overdueSec / 60)).padStart(4)}m / ky ${Math.round(r.intervalSec / 60)}m` +
      ` | ok=${r.lastOkAt || '-'} err=${r.lastErrorAt || '-'} lan=${r.count}` +
      (r.lastError ? ` | loi: ${r.lastError}` : ''),
    )
  }
  process.exit(bad ? 1 : 0)
}

const cmd = process.argv[2] || 'once'
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  if (cmd === 'status') status()
  else if (cmd === 'watch') await watch()
  else if (cmd === 'once') {
    await once()
    // Dong Mongo khong thi process treo (connection giu event loop) — cho
    // stdout flush xong roi thoat (log den pipe co the async tren Windows).
    const { disconnectMongo } = await import('../engine/db.mjs')
    await disconnectMongo()
    setTimeout(() => process.exit(0), 100)
  }
  else {
    console.error(`lenh khong biet: ${cmd} (once | watch | status)`)
    process.exit(2)
  }
}

export { SERVICES, runOne, once }
