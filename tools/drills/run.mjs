#!/usr/bin/env node
// =============================================================================
//  TM TRADING — SERVICE RELIABILITY DRILLS (V4.2 §17.11 / §17.14)
//
//  Each drill starts the REAL supervisor process against a fixture registry and
//  then behaves like an operator (or like the Operations API) through the same
//  durable command inbox. Nothing is mocked: the assertions are made against the
//  state file the API and the CLI read.
//
//  Run everything:      npm run drills
//  Run one drill:       node tools/drills/run.mjs crash-restart
//  List drill names:    node tools/drills/run.mjs --list
//
//  Exit code is non-zero when any drill fails, so CI can gate on it.
// =============================================================================

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  ROOT,
  cleanupWorkspace,
  createWorkspace,
  enqueue,
  findOperation,
  findService,
  markerPath,
  quarantineEntries,
  snapshot,
  startSupervisor,
  stopSupervisor,
  waitFor,
  waitForOperation,
  waitForService,
  writeMarker,
} from './lib.mjs'

// -----------------------------------------------------------------------------
//  Drills
// -----------------------------------------------------------------------------

/**
 * Start -> READY -> STOPPED.
 *
 * Also the evidence-channel proof: `drill-main` declares subscription, job
 * validation and outbox rules, so a READY verdict is only possible if a real
 * worker delivered those observations through IPC.
 */
async function startReadyStop(workspace) {
  startSupervisor(workspace)

  const start = enqueue(workspace, { serviceId: 'drill-main', action: 'start' })
  const started = await waitForOperation(workspace, start.operationId)
  assert.equal(started.state, 'SUCCEEDED', `start failed: ${started.error ?? 'no detail'}`)

  const ready = await waitForService(workspace, 'drill-main', service => service.observed === 'READY')
  assert.equal(ready.health, 'HEALTHY')
  const blocking = ready.readiness.filter(check => check.required && check.passed !== true)
  assert.deepEqual(blocking, [], `required readiness checks did not pass: ${JSON.stringify(blocking)}`)
  for (const rule of ['subscription-acked', 'validated-job', 'outbox-consuming', 'fresh-event']) {
    const check = ready.readiness.find(candidate => candidate.id === rule)
    assert.ok(check, `${rule} was not evaluated`)
    assert.equal(check.passed, true, `${rule} did not pass`)
  }

  const stop = enqueue(workspace, { serviceId: 'drill-main', action: 'stop' })
  const stopped = await waitForOperation(workspace, stop.operationId)
  assert.equal(stopped.state, 'SUCCEEDED', `stop failed: ${stopped.error ?? 'no detail'}`)

  const after = await waitForService(workspace, 'drill-main', service => service.observed === 'STOPPED')
  assert.equal(after.desired, 'STOPPED')
  assert.equal(after.pid, null)

  return {
    detail: `pid ${ready.pid} proved READY from worker evidence, then drained to STOPPED`,
    operationIds: [start.operationId, stop.operationId],
  }
}

/** A duplicated command must reuse its operation; an expired one must be quarantined. */
async function duplicateLateCommand(workspace) {
  startSupervisor(workspace)

  const start = enqueue(workspace, { serviceId: 'drill-main', action: 'start' })
  await waitForOperation(workspace, start.operationId)
  await waitForService(workspace, 'drill-main', service => service.observed === 'READY')

  const duplicateId = 'drill_dup_command'
  const first = enqueue(workspace, {
    serviceId: 'drill-main',
    action: 'run-once',
    operationId: duplicateId,
    idempotencyKey: 'drill-duplicate',
  })
  // The same command again: at-least-once delivery must not run it twice.
  enqueue(workspace, {
    serviceId: 'drill-main',
    action: 'run-once',
    operationId: duplicateId,
    idempotencyKey: 'drill-duplicate',
  })

  const done = await waitForOperation(workspace, first.operationId)
  assert.equal(done.state, 'SUCCEEDED', `duplicate run-once failed: ${done.error ?? 'no detail'}`)
  const copies = snapshot(workspace).operations.filter(operation => operation.operationId === duplicateId)
  assert.equal(copies.length, 1, `duplicate command produced ${copies.length} operations`)

  const late = enqueue(workspace, {
    serviceId: 'drill-main',
    action: 'run-once',
    operationId: 'drill_late_command',
    idempotencyKey: 'drill-late',
    now: Date.now() - 600_000,
    ttlMs: 1_000,
  })
  const quarantined = await waitFor(
    () => quarantineEntries(workspace).find(entry => entry.command?.operationId === late.operationId),
    { label: 'expired command quarantine' },
  )
  assert.match(quarantined.reason, /expired/i)
  assert.equal(findOperation(snapshot(workspace), late.operationId), null, 'expired command was executed')

  return {
    detail: `one operation for a replayed command; expired command quarantined (${quarantined.reason})`,
    operationIds: [start.operationId, duplicateId],
  }
}

/** Subscription acked, no market event: READY plus a failed optional rule = DEGRADED. */
async function socketOpenNoData(workspace) {
  startSupervisor(workspace)

  const start = enqueue(workspace, { serviceId: 'drill-quiet', action: 'start' })
  const started = await waitForOperation(workspace, start.operationId)
  assert.equal(started.state, 'SUCCEEDED', `start failed: ${started.error ?? 'no detail'}`)

  const degraded = await waitForService(workspace, 'drill-quiet', service => service.observed === 'DEGRADED')
  assert.equal(degraded.health, 'DEGRADED')

  const subscription = degraded.readiness.find(check => check.id === 'subscription-acked')
  assert.equal(subscription?.passed, true, 'the subscription acknowledgement was lost')

  const fresh = degraded.readiness.find(check => check.id === 'fresh-event')
  assert.ok(fresh, 'fresh-event was not evaluated')
  assert.equal(fresh.required, false, 'fresh-event must be optional so a quiet feed is DEGRADED, not FAILED')
  assert.equal(fresh.passed, false, 'a five-minute-old event must fail the freshness window')

  return {
    detail: `subscription acked but ${fresh.detail}; observed DEGRADED (not FAILED)`,
    operationIds: [start.operationId],
  }
}

/** Crash while working, then recover with backoff and no lost command. */
async function crashRestart(workspace) {
  startSupervisor(workspace)

  const start = enqueue(workspace, { serviceId: 'drill-crash', action: 'start' })
  const started = await waitForOperation(workspace, start.operationId)
  assert.equal(started.state, 'SUCCEEDED', `start failed: ${started.error ?? 'no detail'}`)

  const before = await waitForService(workspace, 'drill-crash', service => service.observed === 'READY')
  assert.equal(before.restartCount, 0)

  // Put the service under load first so the crash happens on a busy worker.
  const loadIds = [1, 2, 3].map(index => enqueue(workspace, {
    serviceId: 'drill-crash',
    action: 'run-once',
    idempotencyKey: `drill-load-${index}`,
  }).operationId)
  for (const operationId of loadIds) {
    const operation = await waitForOperation(workspace, operationId)
    assert.equal(operation.state, 'SUCCEEDED', `load run-once failed: ${operation.error ?? 'no detail'}`)
  }

  // Crash exactly once, then queue one more command across the restart window.
  writeMarker(workspace, 'crash.request')
  const duringCrash = enqueue(workspace, {
    serviceId: 'drill-crash',
    action: 'run-once',
    idempotencyKey: 'drill-during-crash',
  })
  const duringResult = await waitForOperation(workspace, duringCrash.operationId)
  assert.ok(
    duringResult.state === 'SUCCEEDED' || duringResult.result?.code === 'WORKER_EXITED',
    `command across the crash neither ran nor reported the crash: ${JSON.stringify(duringResult)}`,
  )

  const restored = await waitForService(
    workspace,
    'drill-crash',
    service => service.restartCount >= 1 && service.observed === 'READY',
  )
  assert.ok(restored.generation > before.generation, 'the restarted worker kept the old generation')
  assert.notEqual(restored.pid, before.pid, 'the restarted worker kept the old pid')

  return {
    detail: `crashed after 3 load cycles, restart #${restored.restartCount} READY with pid ${restored.pid}`,
    operationIds: [start.operationId, ...loadIds, duringCrash.operationId],
  }
}

/** A control-plane process restart must not touch a running worker. */
async function controlPlaneRestart(workspace) {
  startSupervisor(workspace)

  const start = enqueue(workspace, { serviceId: 'drill-main', action: 'start' })
  await waitForOperation(workspace, start.operationId)
  const before = await waitForService(workspace, 'drill-main', service => service.observed === 'READY')

  // A separate short-lived process (the API stand-in) enqueues a command and
  // exits. This is what a dashboard restart looks like to the supervisor.
  const operationId = 'drill_control_plane_command'
  const child = spawnSync(
    process.execPath,
    [join(ROOT, 'tools', 'drills', 'fixtures', 'enqueue-command.mjs'), workspace.commandsDir, operationId, 'drill-main', 'run-once'],
    { cwd: ROOT, encoding: 'utf8', env: process.env },
  )
  assert.equal(child.status, 0, `control-plane stand-in failed: ${child.stderr || child.stdout}`)

  const done = await waitForOperation(workspace, operationId)
  assert.equal(done.state, 'SUCCEEDED', `command from the control plane failed: ${done.error ?? 'no detail'}`)

  const after = findService(snapshot(workspace), 'drill-main')
  assert.equal(after.pid, before.pid, 'the worker pid changed when the control plane restarted')
  assert.equal(after.serviceInstanceId, before.serviceInstanceId, 'the worker instance changed')
  assert.equal(after.generation, before.generation, 'the worker generation changed')

  return {
    detail: `pid ${before.pid} and generation ${before.generation} survived a control-plane process restart`,
    operationIds: [start.operationId, operationId],
  }
}

/** A supervisor restart must restore desired RUNNING without an operator Start. */
async function supervisorRestartRecovery(workspace) {
  const first = startSupervisor(workspace)

  const start = enqueue(workspace, { serviceId: 'drill-main', action: 'start' })
  await waitForOperation(workspace, start.operationId)
  const before = await waitForService(workspace, 'drill-main', service => service.observed === 'READY')

  await stopSupervisor(first)
  const drained = findService(snapshot(workspace), 'drill-main')
  assert.equal(drained.desired, 'RUNNING', 'a supervisor shutdown must not rewrite operator intent')
  assert.equal(drained.observed, 'STOPPED', `drained state was ${drained.observed}`)
  assert.equal(drained.pid, null)
  // A graceful drain is not a crash: the exit event may arrive after `drain()`
  // has already recorded STOPPED, and counting that as a crash would inflate
  // `restartCount` on every routine supervisor restart.
  assert.equal(drained.restartCount, 0, `a graceful drain was counted as ${drained.restartCount} crash(es)`)
  assert.equal(drained.nextRestartAt, null, 'a graceful drain must not schedule a crash restart')

  startSupervisor(workspace)
  const restored = await waitForService(
    workspace,
    'drill-main',
    service => service.observed === 'READY' && service.generation > before.generation,
  )
  assert.notEqual(restored.pid, before.pid, 'recovery reused the drained process')

  const recovery = snapshot(workspace).audit.find(entry => entry.actor === 'supervisor-recovery')
  assert.ok(recovery, 'no supervisor-recovery operation was queued')

  return {
    detail: `desired RUNNING restored after restart: generation ${before.generation} -> ${restored.generation}, pid ${restored.pid}`,
    operationIds: [start.operationId, recovery.operationId],
  }
}

/** Reset replaces the process but never deletes history. */
async function resetPreservesHistory(workspace) {
  startSupervisor(workspace)

  const start = enqueue(workspace, { serviceId: 'drill-main', action: 'start' })
  await waitForOperation(workspace, start.operationId)
  const before = await waitForService(workspace, 'drill-main', service => service.observed === 'READY')

  const run = enqueue(workspace, { serviceId: 'drill-main', action: 'run-once', idempotencyKey: 'drill-reset-run' })
  const runResult = await waitForOperation(workspace, run.operationId)
  assert.equal(runResult.state, 'SUCCEEDED', `run-once failed: ${runResult.error ?? 'no detail'}`)

  const reset = enqueue(workspace, { serviceId: 'drill-main', action: 'reset' })
  const resetResult = await waitForOperation(workspace, reset.operationId)
  assert.equal(resetResult.state, 'SUCCEEDED', `reset failed: ${resetResult.error ?? 'no detail'}`)
  assert.equal(resetResult.result?.reset, true)

  const after = snapshot(workspace)
  assert.ok(
    findOperation(after, run.operationId),
    'reset deleted an earlier operation from history',
  )
  assert.ok(
    after.audit.some(entry => entry.action === 'operation-succeeded' && entry.operationId === run.operationId),
    'reset deleted the audit entry for an earlier operation',
  )
  const restored = findService(after, 'drill-main')
  assert.ok(restored.generation > before.generation, 'reset did not start a new generation')
  assert.ok(existsSync(markerPath(workspace, 'reset.marker')), 'reset did not call the module reset() hook')

  return {
    detail: `generation ${before.generation} -> ${restored.generation}; earlier operation and audit entry retained`,
    operationIds: [start.operationId, run.operationId, reset.operationId],
  }
}

// -----------------------------------------------------------------------------
//  Runner
// -----------------------------------------------------------------------------

const DRILLS = [
  ['start-ready-stop', startReadyStop],
  ['duplicate-late-command', duplicateLateCommand],
  ['socket-open-no-data', socketOpenNoData],
  ['crash-restart', crashRestart],
  ['control-plane-restart', controlPlaneRestart],
  ['supervisor-restart-recovery', supervisorRestartRecovery],
  ['reset-preserves-history', resetPreservesHistory],
]

async function execute(name, drill) {
  const workspace = createWorkspace(name)
  const startedAt = Date.now()
  try {
    const result = await drill(workspace)
    return { ok: true, result, durationMs: Date.now() - startedAt }
  } catch (error) {
    return {
      ok: false,
      error,
      durationMs: Date.now() - startedAt,
      log: workspace.log.slice(-20),
    }
  } finally {
    await cleanupWorkspace(workspace)
  }
}

async function main() {
  const requested = process.argv.slice(2).filter(argument => !argument.startsWith('-'))

  if (process.argv.includes('--list')) {
    for (const [name] of DRILLS) console.log(name)
    return
  }

  const selected = requested.length === 0
    ? DRILLS
    : DRILLS.filter(([name]) => requested.includes(name))
  if (selected.length === 0) {
    console.error(`unknown drill(s): ${requested.join(', ')}`)
    console.error(`available: ${DRILLS.map(([name]) => name).join(', ')}`)
    process.exit(2)
  }

  const startedAt = Date.now()
  let failed = 0
  for (const [name, drill] of selected) {
    process.stdout.write(`drill ${name.padEnd(30)} `)
    const outcome = await execute(name, drill)
    if (outcome.ok) {
      console.log(`PASS  ${outcome.durationMs}ms`)
      if (outcome.result?.detail) console.log(`  ${outcome.result.detail}`)
      for (const operationId of outcome.result?.operationIds ?? []) {
        console.log(`  operation ${operationId}`)
      }
      continue
    }

    failed += 1
    console.log(`FAIL  ${outcome.durationMs}ms`)
    const detail = String(outcome.error?.stack || outcome.error || 'unknown error')
      .split('\n')
      .slice(0, 8)
      .join('\n  ')
    console.log(`  ${detail}`)
    if (outcome.log?.length) {
      console.log('  supervisor log (tail):')
      for (const line of outcome.log) console.log(`    ${line}`)
    }
  }

  const total = Date.now() - startedAt
  console.log(`\n${selected.length - failed}/${selected.length} drills passed in ${total}ms`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`drill runner failed: ${String(error?.stack || error)}`)
  process.exit(1)
})