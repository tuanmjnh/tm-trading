#!/usr/bin/env node
// =============================================================================
//  TM TRADING - D13 BACKUP (roadmap Phase 6)
//
//  `mongodump` theo định kỳ cho `runs` + `trades` — 2 collection KHÔNG tái tạo
//  được (nguồn kết quả backtest). Trái lại:
//    - `data/`   (cache OHLCV)  -> tái tạo được từ Binance  → không sao lưu;
//    - `reports/` (NDJSON/CSV)  -> tái tạo được bằng engine:run → không sao lưu;
//    - `logs/*.ndjson`          -> bản ghi phụ; nguồn chân lý là Mongo.
//
//  Usage:
//    node tools/backup.mjs                 dump vào backups/<UTC stamp>/
//    node tools/backup.mjs --keep 7        giữ 7 bản mới nhất (mặc định 14 / BACKUP_KEEP)
//    node tools/backup.mjs --strict        thiếu mongodump/Mongo -> exit 1 (cho cron)
//    npm run backup
//
//  Định kỳ: Windows Task Scheduler (schtasks) hoặc cron gọi `npm run backup`
//  — đưa vào services/ cùng heartbeat ở Phase 8-9.
//
//  SKIP (thiếu binary / thiếu MONGODB_URI) in RÕ ràng và exit 0 như test-db,
//  trừ khi `--strict` — job định kỳ KHÔNG được âm thầm "thành công" khi không
//  backup được gì.
// =============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnv, ROOT } from '../exec/env.mjs'

loadEnv()

const BACKUP_ROOT = join(ROOT, 'backups')
const COLLECTIONS = ['runs', 'trades']

/** PATH first, then the usual installer layouts (<root>/Tools|Server/<ver>/bin). */
export function findMongodump() {
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
      try {
        entries = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory())
      } catch {
        continue
      }
      for (const d of entries) {
        const p = join(base, d.name, 'bin', exe)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

/** Keep the newest `keep` dump folders, delete the rest. */
export function pruneBackups(root = BACKUP_ROOT, keep = 14) {
  if (!existsSync(root)) return []
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  const removed = []
  while (dirs.length > keep) {
    const victim = dirs.shift()
    rmSync(join(root, victim), { recursive: true, force: true })
    removed.push(victim)
  }
  return removed
}

function logBackup(entry) {
  const file = join(ROOT, 'logs', 'backup.ndjson')
  if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true })
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const args = process.argv.slice(2)
  const keep = Number(args[args.indexOf('--keep') + 1]) || Number(process.env.BACKUP_KEEP) || 14
  const strict = args.includes('--strict')
  const uri = String(process.env.MONGODB_URI || '').trim()
  const exit = (code, msg) => { if (msg) console.log(msg); process.exit(code) }

  if (!uri) {
    logBackup({ event: 'skip', reason: 'no MONGODB_URI' })
    exit(strict ? 1 : 0, 'SKIP — no MONGODB_URI in env/.env. Nothing backed up (NOT a success).')
  }
  const bin = findMongodump()
  if (!bin) {
    logBackup({ event: 'skip', reason: 'mongodump not found' })
    exit(strict ? 1 : 0, 'SKIP — mongodump not found on PATH or in Program Files. Nothing backed up (NOT a success).')
  }

  // DB name inside the URI wins (dbNameFromUri — same rule as db.mjs)
  const { dbNameFromUri } = await import('../engine/db.mjs')
  const dbName = dbNameFromUri(uri) || 'tm-trading'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z'
  const outDir = join(BACKUP_ROOT, stamp)
  mkdirSync(outDir, { recursive: true })

  const started = Date.now()
  try {
    for (const col of COLLECTIONS) {
      execFileSync(bin, ['--uri', uri, '--db', dbName, '--collection', col, '--gzip', '--out', outDir], { stdio: ['ignore', 'pipe', 'pipe'] })
    }
  } catch (e) {
    rmSync(outDir, { recursive: true, force: true })
    logBackup({ event: 'fail', error: e?.message })
    exit(1, `FAIL — mongodump error: ${e?.message}`)
  }

  // mongodump writes <out>/<db>/*.bson.gz — measure REAL files recursively
  // (a directory's own stat size can be 0 on some filesystems).
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
  const hasBson = files.some((f) => f.endsWith('.bson.gz') || f.endsWith('.bson'))
  if (!files.length || size === 0 || !hasBson) {
    rmSync(outDir, { recursive: true, force: true })
    logBackup({ event: 'fail', reason: 'no bson in dump', files: files.length, bytes: size })
    exit(1, `FAIL — dump produced no data (${files.length} files, ${size} bytes)`)
  }
  const removed = pruneBackups(BACKUP_ROOT, keep)
  const summary = { event: 'ok', out: outDir.replace(ROOT + '\\', ''), db: dbName, collections: COLLECTIONS, files: files.length, bytes: size, ms: Date.now() - started, pruned: removed.length }
  logBackup(summary)
  console.log(`BACKUP OK — ${dbName}: ${COLLECTIONS.join(' + ')} -> ${summary.out} (${files.length} files, ${(size / 1024).toFixed(0)} KB, ${summary.ms}ms), keep=${keep}${removed.length ? `, pruned ${removed.length}` : ''}`)
  exit(0)
}
