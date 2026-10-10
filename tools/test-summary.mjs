#!/usr/bin/env node
// =============================================================================
//  TM TRADING — test runner: `npm test` WITH a receipt.
//
//  Runs every suite in exactly the order of the old `&&` chain (one broke the
//  gate stopped everything), but keeps going so the summary shows the FULL
//  picture — which suite failed, where, and how long each took. Writes
//  logs/test-summary.json (logs/ is gitignored runtime output) and exits
//  non-zero when anything failed. `npm run verify` consumes it.
//
//  Contract: each suite prints a final `PASS — N pass, M fail` (or FAIL) line
//  and exits 0/1 (test-db SKIPs loudly with exit 0 when Mongo is down).
// =============================================================================
import { spawnSync, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOG_DIR = join(ROOT, 'logs')

// Same suites, same order as the historical `npm test` chain (+ test:stamp §10.3).
const SUITES = [
  ['pines', 'tools/smoke.mjs', []],
  ['engine', 'engine/test.mjs', []],
  ['market', 'market/test.mjs', []],
  ['journal', 'engine/test-journal.mjs', []],
  ['preset-drift', 'engine/test-preset-drift.mjs', []],
  ['stamp', 'exec/test-stamp.mjs', []],
  ['risk', 'exec/test-risk.mjs', []],
  ['paper', 'exec/test-paper.mjs', []],
  ['simulation', 'simulation/test.mjs', []],
  ['drift', 'exec/test-drift.mjs', []],
  ['mt5', 'exec/mt5/test.mjs', []],
  ['db', 'engine/test-db.mjs', []],
  ['services', 'tests/run-with-aliases.mjs', ['services/test.mjs']],
  ['ai', 'ai/test.mjs', []],
  ['ai-review', 'ai/test-review.mjs', []],
]

const parseSummary = (out) => {
  const m = String(out).match(/(?:PASS|FAIL) — (\d+) pass, (\d+) fail\s*$/m)
  if (!m) return null
  return { pass: Number(m[1]), fail: Number(m[2]) }
}

const gitRev = (() => {
  try { return String(execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' })).trim() || null }
  catch { return null }
})()

const startedAll = Date.now()
const results = []
for (const suite of SUITES) {
  const name = suite[0]
  const file = suite[1]
  const nodeFlags = suite[2] || []
  const scriptArgs = suite.slice(3) || []
  const t0 = Date.now()
  console.log(`\n===== [test] ${name}: node ${file} =====`)
  const r = spawnSync(process.execPath, [...nodeFlags, file, ...scriptArgs], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  process.stdout.write(out)
  const counts = parseSummary(out)
  const skipped = r.status === 0 && !counts && /SKIP/.test(out)
  results.push({
    name,
    file,
    exitCode: r.status ?? -1,
    pass: counts?.pass ?? null,
    fail: counts?.fail ?? null,
    status: r.status === 0 ? (counts ? (counts.fail === 0 ? 'pass' : 'fail') : (skipped ? 'skip' : 'pass')) : 'fail',
    durationMs: Date.now() - t0,
  })
}

const pass = results.reduce((s, r) => s + (r.pass ?? 0), 0)
const fail = results.reduce((s, r) => s + (r.fail ?? 0), 0)
const failed = results.filter((r) => r.status === 'fail')
const ok = failed.length === 0
const summary = {
  generatedAt: new Date().toISOString(),
  gitRev,
  node: process.version,
  ok,
  totals: { pass, fail, suites: results.length, skipped: results.filter((r) => r.status === 'skip').length },
  suites: results,
  durationMs: Date.now() - startedAll,
}
mkdirSync(LOG_DIR, { recursive: true })
writeFileSync(join(LOG_DIR, 'test-summary.json'), JSON.stringify(summary, null, 2) + '\n')

console.log('\n===== [test] summary =====')
for (const r of results) {
  const n = r.pass === null ? (r.status === 'skip' ? 'SKIP' : '?') : `${r.pass}/${r.fail ?? '?'}`
  console.log(`  ${r.status === 'pass' ? 'ok  ' : r.status === 'skip' ? 'skip' : 'FAIL'} ${r.name.padEnd(12)} ${n}  (${(r.durationMs / 1000).toFixed(1)}s)`)
}
console.log(`  total ${pass} pass, ${fail} fail across ${results.length} suites -> logs/test-summary.json\n`)
process.exit(ok ? 0 : 1)