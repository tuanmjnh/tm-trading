#!/usr/bin/env node
// =============================================================================
//  TM TRADING — DESK STOP
//
//  Force-stops the desk tree (desk runner + bot worker + services watcher and
//  their cmd wrappers) WITHOUT touching the dashboard dev server (nuxt/4001).
//
//  The worker is killed HARD (taskkill /F) — Windows console processes detached
//  from a parent cannot receive a graceful Ctrl+C, so the open paper session is
//  NOT completed here: its lease expires (30s) and the next `npm run desk
//  --heal` recovers the orphan and re-arms a fresh run. That is the designed
//  recovery path, not data loss (journal/trades are never purged).
//
//  Usage:
//    npm run desk:stop              # stop the desk tree
//    node tools/desk-stop.mjs       # same
//    node tools/desk-stop.mjs --dry-run   # preview only
// =============================================================================
import { execFileSync } from 'node:child_process'

const DRY = process.argv.includes('--dry-run')

// Matches the desk runner, the worker, the services watcher and their cmd
// wrappers. Deliberately does NOT match nuxt/nuxt-dev — the dashboard stays up.
const PATTERNS = [
  /tools[\\/]desk\.mjs/i,
  /tools[\\/]bot-worker\.mjs/i,
  /services[\\/]run\.mjs/i,
]

function listDeskProcesses() {
  const script = [
    'Get-CimInstance Win32_Process',
    "| Where-Object { $_.CommandLine -match 'tools.desk\\.mjs|tools.bot-worker\\.mjs|services.run\\.mjs' }",
    '| ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.CommandLine)" }',
  ].join(' ')
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  return out.split(/\r?\n/).filter((l) => l.includes('|')).map((l) => {
    const [pid, name, ...rest] = l.split('|')
    return { pid: Number(pid), name, cmd: rest.join('|') }
  }).filter((p) => Number.isFinite(p.pid))
}

const procs = listDeskProcesses()
if (procs.length === 0) {
  console.log('desk-stop: no desk processes found — nothing to stop')
  process.exit(0)
}

for (const p of procs) {
  console.log(`${DRY ? 'WOULD STOP' : 'stopping'}  pid=${p.pid}  ${p.name}  ${String(p.cmd).slice(0, 90)}`)
  if (!DRY) {
    try {
      // /T kills the tree (cmd wrapper + node children), /F is force.
      execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch { /* already gone */ }
  }
}

if (!DRY) {
  // Re-check: anything left?
  const left = listDeskProcesses()
  console.log(left.length === 0
    ? 'desk-stop: desk tree stopped (dashboard dev server untouched)'
    : `desk-stop: WARNING — ${left.length} process(es) survived: ${left.map((p) => p.pid).join(', ')}`)
  console.log('note: the open paper run ends via lease recovery — `npm run desk -- --heal` re-arms it on next start')
}
