#!/usr/bin/env node
// =============================================================================
//  Typecheck khong bi treo — "nuxt prepare xong nhung khong thoat" (bay #5).
//
//  Van hanh:
//    1. spawn `nuxt prepare` (sinh .nuxt/tsconfig.*.json)
//    2. poll cho den khi tat ca tsconfig moi + JSON hop le
//    3. kill tree cua prepare (no se khong thoat tu nhien)
//    4. chay vue-tsc cho tung project: server, app, shared, node
//    5. exit = max(cac exit code)
//
//  Dung:  npm run typecheck
//  Khi doi nuxt.config.ts -> chay lai lenh nay (no se tu prepare lai).
// =============================================================================
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const NUXI = join(ROOT, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
const VUE_TSC = join(ROOT, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js')

const PROJECTS = ['server', 'app', 'shared', 'node']
const PREPARE_TIMEOUT_MS = 180_000
const POLL_MS = 300
const GRACE_MS = 1_000

const tsconfigOf = (p) => join(ROOT, '.nuxt', `tsconfig.${p}.json`)

function log(msg) {
  process.stdout.write(`[typecheck] ${msg}\n`)
}

function isFreshJson(path, sinceMs) {
  try {
    if (statSync(path).mtimeMs < sinceMs) return false
    JSON.parse(readFileSync(path, 'utf8'))
    return true
  } catch {
    return false
  }
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGKILL')
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function prepare() {
  if (!existsSync(NUXI)) {
    log(`khong tim thay nuxt (${NUXI}) — bo qua prepare, dung .nuxt hien tai`)
    return
  }
  const since = Date.now()
  log('chay nuxt prepare ...')
  const child = spawn(process.execPath, [NUXI, 'prepare'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.stderr.on('data', (b) => process.stderr.write(`[prepare] ${b}`))

  const deadline = since + PREPARE_TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) {
      killTree(child)
      throw new Error(`prepare khong xong sau ${PREPARE_TIMEOUT_MS / 1000}s`)
    }
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`prepare loi (exit ${child.exitCode})`)
    }
    const fresh = PROJECTS.every((p) => isFreshJson(tsconfigOf(p), since))
    if (fresh) break
    await sleep(POLL_MS)
  }

  // Cho nuxi ghi xong het truoc khi kill (no van con dang dong file).
  await sleep(GRACE_MS)
  killTree(child)
  log('prepare xong — da kill (khong thoat tu nhien la binh thuong)')
}

async function runVueTsc(project) {
  const cfg = tsconfigOf(project)
  if (!existsSync(cfg)) {
    log(`SKIP ${project} (thieu ${cfg})`)
    return 0
  }
  log(`vue-tsc ${project} ...`)
  return await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [VUE_TSC, '--noEmit', '-p', cfg],
      { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
    )
    child.on('close', (code) => resolve(code ?? 1))
  })
}

let failed = 0
try {
  await prepare()
} catch (e) {
  log(`ERROR: ${e.message}`)
  process.exit(2)
}

for (const p of PROJECTS) {
  const code = await runVueTsc(p)
  if (code !== 0) {
    failed = code
    log(`${p}: FAIL (exit ${code})`)
  } else {
    log(`${p}: OK`)
  }
}

log(failed === 0 ? 'PASS — 4/4 project' : 'FAIL')
process.exit(failed)
