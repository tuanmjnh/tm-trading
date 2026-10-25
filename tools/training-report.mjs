#!/usr/bin/env node
// =============================================================================
//  TM TRADING — TRAINING DATA REPORT (localhost training-data desk)
//
//  One read-only command that answers "is my training dataset growing and
//  complete?". The dataset the AI consumes accumulates ONLY while the desk
//  runs, so this also doubles as a desk health check:
//
//    node tools/training-report.mjs            # report
//    node tools/training-report.mjs --strict   # exit 1 on any WARN (for cron)
//
//  Fail-soft: Mongo down degrades every check instead of crashing. Read-only —
//  nothing here mutates state.
// =============================================================================
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { loadEnv, ROOT } from '../exec/env.mjs'

loadEnv()

const DAY_MS = 86_400_000
const WARN = []

const ageOf = (ts) => (ts == null ? null : Math.round((Date.now() - Number(ts)) / 60_000)) // minutes
const fmtAge = (minutes) => {
  if (minutes == null) return '—'
  if (minutes < 120) return `${minutes}m ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / DAY_MS)}d ago`
}
const stamp = (row, field = 'ts') => (row?.[field] ? new Date(row[field]).toISOString() : '—')

async function counts(db, names) {
  const out = {}
  for (const name of names) {
    try { out[name] = await db.collection(name).countDocuments({}) } catch { out[name] = null }
  }
  return out
}

async function main() {
  const strict = process.argv.includes('--strict')
  const dbMod = await import('../engine/db.mjs')
  const mg = await dbMod.connectMongo()
  if (!mg) {
    console.error('training-report: Mongo unavailable — start mongod and retry')
    process.exit(1)
  }
  const db = mg.connection

  // --- volumes ---------------------------------------------------------------
  const c = await counts(db, [
    'signals', 'alerts', 'orders', 'fills', 'positions', 'journal',
    'trade_context', 'sessions', 'equity', 'experiments', 'evidence_sets',
    'ai_agents', 'bot_instances',
  ])
  console.log('=== TM Trading — training data report ===')
  console.log('volumes:')
  for (const [k, v] of Object.entries(c)) console.log(`  ${String(k).padEnd(14)} ${v ?? 'n/a'}`)

  // --- signal flow -----------------------------------------------------------
  const entries = await db.collection('signals')
    .find({ type: { $in: ['ST LONG', 'ST SHORT'] } }).sort({ ts: -1 }).limit(1).toArray()
  const lastEntry = entries[0] ?? null
  const entryAge = lastEntry ? ageOf(lastEntry.ts) : null
  console.log('signal flow:')
  console.log(`  last entry signal        ${stamp(lastEntry)} (${fmtAge(entryAge)})`)

  // --- active instance -------------------------------------------------------
  const active = await db.collection('bot_instances')
    .find({ state: { $in: ['queued', 'starting', 'running', 'paused', 'stopping'] } })
    .sort({ startedAt: -1 }).limit(3).toArray()
  if (active.length) {
    console.log('active instances:')
    for (const i of active) {
      console.log(`  ${i.instanceId}  ${i.state}  counts=${JSON.stringify(i.counts)}  equity=${i.paperEquity}`)
    }
  } else {
    WARN.push('no active bot instance — the desk is idle, training data is NOT accumulating (start the worker / npm run desk --heal)')
    console.log('active instances: NONE')
  }

  // --- completeness: RECENT closed trades should have journal + context ------
  // Historical/seed positions predate the executor's journal write path — only
  // the last 7 days of closes are the executor era and must be complete.
  const recentCutoff = Date.now() - 7 * DAY_MS
  const recentClosed = (await db.collection('positions')
    .find({ status: 'closed' }).sort({ exitTime: -1 }).limit(200).toArray())
    .filter((p) => {
      const t = p.exitTime instanceof Date ? p.exitTime.getTime() : new Date(p.exitTime).getTime()
      return Number.isFinite(t) && t >= recentCutoff
    })
  const closedIds = new Set(recentClosed.map((p) => String(p.externalId ?? p._id)))
  const journalSourceIds = new Set(
    (await db.collection('journal').find({ source: 'paper' }).limit(1000).toArray())
      .map((j) => String(j.sourceId ?? '')),
  )
  const ctxTradeIds = new Set(
    (await db.collection('trade_context').find({}).limit(1000).toArray())
      .flatMap((t) => [String(t._id ?? ''), String(t.tradeId ?? '')]),
  )
  const missingJournal = [...closedIds].filter((id) => !journalSourceIds.has(id)).length
  const missingCtx = [...closedIds].filter((id) => !ctxTradeIds.has(id)).length
  console.log('completeness (recent closed trades → AI context, 7d window):')
  console.log(`  recent closed trades     ${recentClosed.length}`)
  console.log(`  missing journal rows     ${missingJournal}`)
  console.log(`  missing trade_context    ${missingCtx}`)
  if (recentClosed.length > 0 && missingJournal > 0) {
    WARN.push(`${missingJournal} recent closed trade(s) without a journal row — the executor write path may be degraded`)
  }
  if (recentClosed.length > 0 && missingCtx > 0) {
    WARN.push(`${missingCtx} recent closed trade(s) without trade_context — the AI loses signal→fill provenance for those`)
  }

  // --- research artifacts ----------------------------------------------------
  console.log('research artifacts:')
  console.log(`  experiments              ${c.experiments}  (accepted drive §29 promotion)`)
  console.log(`  evidence sets            ${c.evidence_sets}`)
  console.log(`  governed agents          ${c.ai_agents}`)

  // --- backup freshness ------------------------------------------------------
  let lastBackup = null
  try {
    const dir = join(ROOT, 'backups')
    const stamps = readdirSync(dir).sort().reverse()
    lastBackup = stamps[0] ?? null
  } catch { lastBackup = null }
  console.log('backup:')
  console.log(`  newest backup            ${lastBackup ?? 'NONE (run: npm run backup)'}`)
  if (!lastBackup) {
    WARN.push('no backup found — run `npm run backup` (mongodump runs+trades, D13)')
  }

  // --- retention note --------------------------------------------------------
  console.log('retention:')
  console.log('  candles/market_feed      purged after 90d (market data only)')
  console.log('  journal/trades/sessions  NEVER purged — the training core')

  // --- verdict ----------------------------------------------------------------
  console.log('=========================================')
  if (WARN.length === 0) {
    console.log('VERDICT: OK — the training dataset is accumulating and complete.')
  } else {
    for (const w of WARN) console.log(`WARN: ${w}`)
    console.log(`VERDICT: ${WARN.length} warning(s) — see above.`)
  }
  if (strict && WARN.length > 0) process.exit(1)
  process.exit(0)
}

main().catch((e) => {
  console.error(`training-report: ${String(e?.message ?? e)}`)
  process.exit(1)
})
