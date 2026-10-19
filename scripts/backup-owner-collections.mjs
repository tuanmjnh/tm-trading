#!/usr/bin/env node
// =============================================================================
//  backup-owner-collections.mjs — pre-migration backup for tenancy (Phase B).
//
//  Before backfilling `ownerId` on legacy rows (scripts/backfill-owner.mjs) we
//  must be able to restore. This dumps every per-user collection to
//  `backups/<UTC stamp>-owner/<db>/<collection>.bson.gz` via `mongodump`.
//
//  Usage:  node scripts/backup-owner-collections.mjs [--keep 7] [--strict]
//          npm run backup:owner
//
//  Skips cleanly (exit 0) when mongodump or MONGODB_URI is missing, unless
//  `--strict` is passed — a periodic job must not silently "succeed".
//  Rollback: mongorestore --uri <uri> --gzip --dir backups/<stamp>-owner
// =============================================================================

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, ROOT } from '../exec/env.mjs'

loadEnv()

// The per-user collections that a tenancy migration can touch. Shared reference
// collections (candles, news_*, macro_*, market_*) are intentionally excluded.
const COLLECTIONS = [
  'alerts', 'positions', 'paper_orders', 'paper_fills', 'paper_accounts',
  'risk_state', 'trading_sessions', 'journal', 'runs', 'signals', 'indicator_runs',
  'strategy_profiles', 'strategy_versions', 'bot_profiles', 'bot_instances',
  'alert_rules', 'ai_agents', 'ai_agent_versions', 'ai_agent_actions', 'ai_proposals',
  'research_evidence_sets', 'experiments', 'experiment_runs', 'notification_logs',
  'trade_context', 'market_snapshots'
]

const BACKUP_ROOT = join(ROOT, 'backups')
const args = process.argv.slice(2)
const keep = Number(args[args.indexOf('--keep') + 1]) || Number(process.env.BACKUP_KEEP) || 14
const strict = args.includes('--strict')

function findMongodump() {
  const exe = process.platform === 'win32' ? 'mongodump.exe' : 'mongodump'
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of String(process.env.PATH || '').split(sep)) {
    if (!dir) continue
    const p = join(dir.trim(), exe)
    if (existsSync(p)) return p
  }
  const roots = process.platform === 'win32'
    ? ['C:\\Program Files\\MongoDB', 'C:\\Program Files\\MongoDB Tools', join(process.env.LOCALAPPDATA || '', 'MongoDB')]
    : ['/usr', '/usr/local', '/opt/homebrew']
  for (const r of roots) {
    if (!existsSync(r)) continue
    for (const sub of ['Tools', 'Server', '']) {
      const base = sub ? join(r, sub) : r
      if (!existsSync(base)) continue
      if (!sub) {
        const flat = join(base, 'bin', exe)
        if (existsSync(flat)) return flat
        continue
      }
      let entries = []
      try { entries = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { continue }
      for (const d of entries) {
        const p = join(base, d.name, 'bin', exe)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

function pruneBackups(root, keepCount) {
  if (!existsSync(root)) return []
  const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  const removed = []
  while (dirs.length > keepCount) {
    const victim = dirs.shift()
    rmSync(join(root, victim), { recursive: true, force: true })
    removed.push(victim)
  }
  return removed
}

const uri = String(process.env.MONGODB_URI || '').trim()
if (!uri) {
  console.log('SKIP — no MONGODB_URI. Nothing backed up (NOT a success).')
  process.exit(strict ? 1 : 0)
}
const bin = findMongodump()
if (!bin) {
  console.log('SKIP — mongodump not found. Nothing backed up (NOT a success).')
  process.exit(strict ? 1 : 0)
}

const { dbNameFromUri } = await import('../engine/db.mjs')
const dbName = dbNameFromUri(uri) || 'tm-trading'
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z'
const outDir = join(BACKUP_ROOT, `${stamp}-owner`)
mkdirSync(outDir, { recursive: true })

const started = Date.now()
try {
  for (const col of COLLECTIONS) {
    execFileSync(bin, ['--uri', uri, '--db', dbName, '--collection', col, '--gzip', '--out', outDir], { stdio: ['ignore', 'pipe', 'pipe'] })
  }
} catch (e) {
  rmSync(outDir, { recursive: true, force: true })
  console.error(`FAIL — mongodump error: ${e?.message}`)
  process.exit(1)
}

const files = []
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else files.push(p)
  }
}
walk(outDir)
const size = files.reduce((s, f) => s + statSync(f).size, 0)
const removed = pruneBackups(BACKUP_ROOT, keep)
console.log(`BACKUP OK — ${dbName}: ${COLLECTIONS.length} per-user collections -> ${outDir.replace(ROOT + '\\', '')} (${files.length} files, ${(size / 1024).toFixed(0)} KB, ${Date.now() - started}ms), keep=${keep}${removed.length ? `, pruned ${removed.length}` : ''}`)
console.log(`ROLLBACK: mongorestore --uri "${uri}" --gzip --dir "${outDir}"`)
