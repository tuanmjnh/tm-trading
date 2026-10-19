#!/usr/bin/env node
// =============================================================================
//  backfill-owner.mjs — stamp `ownerId` on pre-tenancy rows.
//
//  Tenancy (docs/web-app/user-tenancy-plan.md): every per-user collection is
//  scoped by the hub user id (`sub`). Rows written before that ship have no
//  `ownerId`, so a strict per-owner read would hide them. This script assigns
//  those legacy rows to ONE owner (the account you pass in) — it never guesses
//  and never touches rows that already carry an owner.
//
//  Usage:  node scripts/backfill-owner.mjs --owner <hub-user-id> [--dry-run]
//          node scripts/backfill-owner.mjs --owner <hub-user-id> --only alerts,positions
//          node scripts/backfill-owner.mjs --report [--only alerts,positions]
//
//  --report prints a read-only owner-coverage table per collection (total /
//  owned / unassigned / foreign-owned) without writing anything. This is the
//  Phase B "dry-run owner backfill report" (roadmap §61.3 / §61.17).
//
//  The owner id is the hub `sub` (JWT subject). For root@example.com on the
//  deployed hub it is `62da4efe-34b4-4a6b-b4ae-967942ecaf53`.
// =============================================================================

import { loadEnv } from '../exec/env.mjs'

loadEnv()

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const OWNER = arg('--owner')
const DRY = process.argv.includes('--dry-run')
const REPORT = process.argv.includes('--report')
const ONLY = (arg('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

if (!OWNER && !REPORT) {
  console.error('[backfill-owner] --owner <hub-user-id> is required (JWT `sub`), or pass --report for a read-only coverage table.')
  process.exit(1)
}

// Per-user collections (roadmap §61.3). Shared/reference collections (candles,
// datasets, intel, trades, news_articles/news_events/news_macro_*, market_*) are
// deliberately NOT here. `market_snapshots` (decision snapshots),
// `news_evaluations`, `news_evidence_sets` and `equity` ARE per-user (their
// models declare ownerId — data-ownership-map.md).
const COLLECTIONS = [
  'alerts',
  'positions',
  'paper_orders',
  'paper_fills',
  'paper_accounts',
  'risk_state',
  'trading_sessions',
  'journal',
  'runs',
  'signals',
  'indicator_runs',
  'strategy_profiles',
  'strategy_versions',
  'bot_profiles',
  'bot_instances',
  'alert_rules',
  'ai_agents',
  'ai_agent_versions',
  'ai_agent_actions',
  'ai_proposals',
  'research_evidence_sets',
  'experiments',
  'experiment_runs',
  'notification_logs',
  'trade_context',
  'market_snapshots',
  'news_evaluations',
  'news_evidence_sets',
  'equity'
]

const targets = ONLY.length ? COLLECTIONS.filter((c) => ONLY.includes(c)) : COLLECTIONS

// Broader per-user set for the read-only coverage report. Some of these models
// do NOT declare `ownerId` yet (Phase B work) — the report counts them as
// unassigned, which is exactly the gap this phase must close.
const REPORT_COLLECTIONS = [
  'alerts', 'positions', 'paper_orders', 'paper_fills', 'paper_accounts',
  'risk_state', 'trading_sessions', 'journal',
  'runs', 'signals', 'indicator_runs', 'strategy_profiles', 'strategy_versions',
  'bot_profiles', 'bot_instances', 'alert_rules', 'ai_agents', 'ai_agent_versions',
  'ai_agent_actions', 'ai_proposals', 'research_evidence_sets', 'experiments',
  'experiment_runs', 'notification_logs', 'trade_context', 'market_snapshots',
  'news_evaluations', 'news_evidence_sets', 'equity'
]

const reportTargets = ONLY.length ? REPORT_COLLECTIONS.filter((c) => ONLY.includes(c)) : REPORT_COLLECTIONS

const { connectMongo } = await import(new URL('../engine/db.mjs', import.meta.url).href)
const mongoose = await connectMongo()
if (!mongoose) {
  console.error('[backfill-owner] Mongo is not reachable (MONGODB_URI) — aborting.')
  process.exit(1)
}

const db = mongoose.connection.db

// --- read-only coverage report (Phase B dry-run) -----------------------------
if (REPORT) {
  const rows = []
  let grandTotal = 0
  let grandUnassigned = 0
  let grandOwned = 0
  let grandForeign = 0
  for (const name of reportTargets) {
    try {
      const coll = db.collection(name)
      const total = await coll.countDocuments({})
      const unassigned = await coll.countDocuments({ ownerId: null })
      const owned = total - unassigned
      const foreign = OWNER ? await coll.countDocuments({ ownerId: { $nin: [null, OWNER] } }) : null
      const owners = await coll.distinct('ownerId')
      grandTotal += total
      grandUnassigned += unassigned
      grandOwned += owned
      if (foreign != null) grandForeign += foreign
      rows.push({
        collection: name,
        total,
        owned,
        unassigned,
        foreign,
        owners: owners.filter((o) => o != null).length,
        coverage: total ? `${Math.round((owned / total) * 100)}%` : 'n/a'
      })
    } catch (e) {
      rows.push({ collection: name, total: 'ERR', owned: '?', unassigned: '?', foreign: '?', owners: '?', coverage: String(e?.message ?? e) })
    }
  }
  console.log('[backfill-owner] owner-coverage report (read-only)')
  if (OWNER) console.log(`[backfill-owner] target owner: ${OWNER}`)
  console.log(['collection', 'total', 'owned', OWNER ? 'foreign' : 'foreign', 'unassigned', 'owners', 'coverage'].join('\t'))
  for (const r of rows) {
    console.log([r.collection, r.total, r.owned, r.foreign, r.unassigned, r.owners, r.coverage].join('\t'))
  }
  console.log(`[backfill-owner] TOTALS total=${grandTotal} owned=${grandOwned} foreign=${OWNER ? grandForeign : 'n/a'} unassigned=${grandUnassigned}`)
  await mongoose.disconnect()
  process.exit(0)
}

let total = 0

for (const name of targets) {
  // `{ ownerId: null }` matches both null and a missing field (Mongo equality
  // semantics), which is exactly the pre-tenancy set.
  const filter = { ownerId: null }
  try {
    const pending = await db.collection(name).countDocuments(filter)
    if (DRY) {
      console.log(`[backfill-owner] ${name}: ${pending} row(s) would be assigned to ${OWNER}`)
      total += pending
      continue
    }
    if (pending === 0) {
      console.log(`[backfill-owner] ${name}: nothing to do`)
      continue
    }
    const res = await db.collection(name).updateMany(filter, { $set: { ownerId: OWNER } })
    console.log(`[backfill-owner] ${name}: ${res.modifiedCount} row(s) assigned to ${OWNER}`)
    total += res.modifiedCount
  } catch (e) {
    console.error(`[backfill-owner] ${name}: FAILED — ${String(e?.message ?? e)}`)
  }
}

console.log(`[backfill-owner] ${DRY ? '(dry-run) ' : ''}done — ${total} row(s) ${DRY ? 'pending' : 'updated'}`)
await mongoose.disconnect()
