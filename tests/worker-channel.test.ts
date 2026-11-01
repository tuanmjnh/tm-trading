import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// =============================================================================
//  A worker whose control plane disappears.
//
//  Found live: restarting the supervisor (or the Nitro process hosting the
//  embedded one) closed the IPC channel, and the worker's very next heartbeat
//  died as `uncaughtException: ERR_IPC_CHANNEL_CLOSED` — a stack trace per
//  service, per restart. The contract pinned here is the one that actually keeps
//  a producer safe: notice the loss, say so once, stay up long enough for a
//  restarted supervisor to adopt the pid, then leave on its own.
// =============================================================================

const ROOT = process.cwd()

interface WorkerRun {
  code: number | null
  signal: string | null
  stderr: string
  stdout: string
}

/** Fork the real worker host against the drill fixture registry, then hang up. */
function runOrphanedWorker(graceMs: number, { disconnect = true } = {}): Promise<WorkerRun> {
  return new Promise((resolve, reject) => {
    const scratch = mkdtempSync(join(tmpdir(), 'tm-channel-'))
    const child = fork(join(ROOT, 'services', 'workerHost.mjs'), [], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        TM_SUPERVISOR_REGISTRY: join(ROOT, 'tools', 'drills', 'fixtures', 'registry.mjs'),
        TM_SERVICE_ID: 'drill-main',
        TM_SERVICE_SCOPE: 'system',
        TM_SERVICE_GENERATION: '1',
        TM_SERVICE_MODE: 'run',
        TM_SERVICE_RESET: '0',
        WORKER_CHANNEL_GRACE_MS: String(graceMs),
        DRILL_SCRATCH_DIR: scratch,
      },
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`worker did not exit within ${graceMs + 8000}ms\nstdout: ${stdout}\nstderr: ${stderr}`))
    }, graceMs + 8_000)

    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      try { rmSync(scratch, { recursive: true, force: true }) } catch { /* best effort */ }
      resolve({ code, signal, stdout, stderr })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    // Let the worker boot, report its first heartbeat, then vanish the way a
    // restarted control plane does.
    setTimeout(() => {
      if (disconnect) child.disconnect()
      else child.kill('SIGKILL')
    }, 2_500)
  })
}

describe('worker host — control-plane channel loss', () => {
  test('a worker whose channel closes exits cleanly, not with an uncaughtException', async () => {
    const run = await runOrphanedWorker(1_200)

    assert.equal(run.code, 0, `expected a clean exit, got code=${run.code}\n${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /lost its control-plane channel/)
    assert.match(run.stdout, /was not adopted within the grace window/)
    // The reason may name the code, but it must stay a stated reason: no fatal
    // handler and no stack trace.
    const output = run.stdout + run.stderr
    assert.doesNotMatch(output, /uncaughtException/)
    assert.doesNotMatch(output, /at target\.send/)
    assert.doesNotMatch(output, /\{ type: 'fatal'|"type":"fatal"/)
  })

  test('the worker keeps running through the grace window so a restart can adopt it', async () => {
    const run = await runOrphanedWorker(3_000)

    // The loss is announced before the exit, and the exit only happens after the
    // window: the pid must be adoptable while the next supervisor boots.
    const lostAt = run.stdout.indexOf('lost its control-plane channel')
    const goneAt = run.stdout.indexOf('was not adopted within the grace window')
    assert.ok(lostAt >= 0, `loss not announced\n${run.stdout}`)
    assert.ok(goneAt > lostAt, `exit announced before the loss\n${run.stdout}`)
    assert.equal(run.code, 0)
  })
})
