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
import { runRetentionService } from '../exec/retention.mjs'
import { runReconcileService } from './reconcile.mjs'
import { runCrossScan } from './crossScan.mjs'
import { runAlertRules } from './alertRules.mjs'
import { runMacro } from './macro.mjs'
import { runNewsExtract } from './newsExtract.mjs'
import { runSignalProducer } from './signalProducer.mjs'
import { notify } from '../notify/service.mjs'
import { partitionBySupervisorLease } from './orchestratorGuard.mjs'
import { createSupervisorStore } from './supervisorStore.mjs'

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
  // Phase 23.4 — data retention enforcement (retentionDays on the manifest).
  { name: 'retention', run: runRetentionService, intervalSec: Number(process.env.RETENTION_INTERVAL || DEFAULT_INTERVALS.retention), tag: '[retention]' },
  // §24.2 — compare recorded candles against venue REST; flag suspect datasets.
  { name: 'reconcile', run: runReconcileService, intervalSec: Number(process.env.RECONCILE_INTERVAL || DEFAULT_INTERVALS.reconcile), tag: '[reconcile]' },
  // §36 — cross-venue spread/funding/OI scanner (fail-soft, REST only).
  { name: 'crossScan', run: runCrossScan, intervalSec: Number(process.env.CROSS_SCAN_INTERVAL || DEFAULT_INTERVALS.crossScan), tag: '[cross-scan]' },
  // §58.5 — evaluate user alert rules against the intel event stream, route
  // matches through the notify/ router (dedupe via notification_logs, D4).
  { name: 'alertRules', run: runAlertRules, intervalSec: Number(process.env.ALERT_RULES_INTERVAL || DEFAULT_INTERVALS.alertRules), tag: '[alert-rules]' },
  // §60 Slice F — FRED macro vintages (skips cleanly without FRED_API_KEY).
  { name: 'macro', run: runMacro, intervalSec: Number(process.env.MACRO_INTERVAL || DEFAULT_INTERVALS.macro), tag: '[macro]' },
  // §60 Slice D/E — LLM extraction of eligible items (budget-capped, skips
  // cleanly without AI key; NEWS_EXTRACT=0 disables).
  { name: 'newsExtract', run: runNewsExtract, intervalSec: Number(process.env.NEWS_EXTRACT_INTERVAL || 86400), tag: '[news-extract]' },
  // Live native-signal producer (Phase E/E4 missing link): closed bars ->
  // generateSignals -> publishSignals, idempotent per ownerId+signalKey (D3).
  { name: 'signals', run: runSignalProducer, intervalSec: Number(process.env.SIGNAL_PRODUCER_INTERVAL || 60), tag: '[signals]' },
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
    // §25 — loud failures: a crashed service is an 'important' service event.
    // 1h measured dedupe window per service (every repeat is audited, one ping).
    void notify(
      { kind: 'service', priority: 'important', name: `service.error.${s.name}`, title: `Service ${s.name} that vong chay`, body: `${s.tag} ${msg}`, at: Date.now() },
      { dedupeWindowMs: 3_600_000 },
    ).catch(() => {})
    return null
  }
}

// -----------------------------------------------------------------------------
//  Overlap guard (V4.2 §17.15-O4): never run a service a live supervisor owns.
//
//  Two copies of a producer means duplicate alerts and duplicate writes. The
//  supervisor is the authority — it holds an exclusive lease per service — so
//  this orchestrator only READS that state and steps aside.
//  `SERVICES_ALLOW_OVERLAP=1` is the deliberate, loud escape hatch.
// -----------------------------------------------------------------------------

function overlapsAllowed() {
  return process.env.SERVICES_ALLOW_OVERLAP === '1'
}

function partitionAgainstSupervisor() {
  if (overlapsAllowed()) return { runnable: [...SERVICES], blocked: [] }
  try {
    const store = createSupervisorStore(process.env.TM_SUPERVISOR_STATE
      ? { file: process.env.TM_SUPERVISOR_STATE }
      : {})
    return partitionBySupervisorLease({ store, services: SERVICES, serviceIdOf: s => s.name })
  } catch (e) {
    log('[guard]', `cannot read supervisor state (skipping the overlap check): ${e?.message}`)
    return { runnable: [...SERVICES], blocked: [] }
  }
}

function reportBlocked(blocked) {
  for (const { service, owner, expiresAt } of blocked) {
    log('[guard]', `SKIP ${service.name}: supervisor lease held by ${owner} (expires ${new Date(expiresAt).toISOString()})`)
  }
  if (blocked.length) {
    log('[guard]', `${blocked.length} service(s) are owned by the supervisor — run "node services/supervisor.mjs status" to see them, or set SERVICES_ALLOW_OVERLAP=1 to override (this WILL run duplicates).`)
  }
}

async function once() {
  const { runnable, blocked } = partitionAgainstSupervisor()
  reportBlocked(blocked)
  if (!runnable.length && blocked.length) {
    log('[guard]', 'every service is owned by the supervisor — nothing to run.')
    return false
  }
  for (const s of runnable) await runOne(s)
  return true
}

async function watch() {
  const initial = partitionAgainstSupervisor()
  reportBlocked(initial.blocked)
  if (!initial.runnable.length && initial.blocked.length) {
    log('[watch]', 'every service is owned by the supervisor — watch has nothing to do.')
    process.exit(1)
  }
  log('[watch]', `chu ky: ${initial.runnable.map((s) => `${s.name}=${s.intervalSec}s`).join(', ')}`)
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
      // A supervisor may have picked this service up since we started; re-check
      // every cycle so a second copy can never run alongside it.
      if (!overlapsAllowed()) {
        const { blocked } = partitionAgainstSupervisor()
        if (blocked.some(entry => entry.service.name === s.name)) {
          log('[guard]', `SKIP ${s.name}: supervisor lease held — skipping this cycle`)
          schedule(s, s.intervalSec * 1000)
          return
        }
      }
      await runOne(s)
      schedule(s, s.intervalSec * 1000)
    }, delayMs))
  }
  initial.runnable.forEach((s, i) => schedule(s, i * 3000)) // lệch pha nhẹ 3s

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
    const ran = await once()
    // Dong Mongo khong thi process treo (connection giu event loop) — cho
    // stdout flush xong roi thoat (log den pipe co the async tren Windows).
    const { disconnectMongo } = await import('../engine/db.mjs')
    await disconnectMongo()
    // Non-zero when every service was skipped: a cron/timer must be able to tell
    // "ran nothing because the supervisor owns it" from "ran everything".
    setTimeout(() => process.exit(ran === false ? 1 : 0), 100)
  }
  else {
    console.error(`lenh khong biet: ${cmd} (once | watch | status)`)
    process.exit(2)
  }
}

export { SERVICES, runOne, once }
