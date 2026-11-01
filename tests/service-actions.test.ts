import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { SERVICE_ACTIONS_UI, actionBlockReason, isActionDisabled } from '../app/utils/serviceActions'
import { isTerminalState, runServiceOperation } from '../app/utils/serviceOperation'

// =============================================================================
//  Service control vocabulary and the operation-following loop (V4.2 §17.6–17.7).
//
//  Two rules worth pinning:
//
//    1. ONE place decides whether an action is allowed, so the drawer, the row
//       menu and the swipe shortcuts can never disagree;
//    2. "accepted ≠ succeeded": the loop only ends on a terminal state, and a
//       deadline ends as UNCONFIRMED — the UI cannot mistake it for success.
// =============================================================================

function service(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: 'news',
    planned: false,
    supervised: true,
    registered: true,
    observed: 'STOPPED',
    supports: ['start', 'stop', 'restart', 'reset', 'probe', 'run-once'],
    ...overrides,
  } as never
}

describe('actionBlockReason', () => {
  test('a stopped, supervised service can be started, restarted, reset and probed', () => {
    for (const action of ['start', 'restart', 'reset', 'run-once', 'probe'] as const) {
      assert.equal(actionBlockReason(service(), action), null, `${action} should be allowed`)
    }
    assert.equal(actionBlockReason(service(), 'stop'), 'notRunning', 'nothing to stop')
  })

  test('probe is always allowed, even where nothing else is', () => {
    const planned = service({ planned: true })
    assert.equal(actionBlockReason(planned, 'probe'), null)
    assert.equal(actionBlockReason(planned, 'start'), 'notControllable')
    const external = service({ supervised: false })
    assert.equal(actionBlockReason(external, 'start'), 'notControllable')
    assert.equal(actionBlockReason(external, 'probe'), null)
  })

  test('an unsupported action is blocked regardless of state', () => {
    assert.equal(actionBlockReason(service({ supports: ['probe'] }), 'restart'), 'unsupported')
    assert.equal(actionBlockReason(service({ supports: [] }), 'probe'), 'unsupported')
  })

  test('start and stop respect the observed state', () => {
    assert.equal(actionBlockReason(service({ observed: 'READY' }), 'start'), 'alreadyRunning')
    assert.equal(actionBlockReason(service({ observed: 'STARTING' }), 'start'), 'alreadyRunning')
    assert.equal(actionBlockReason(service({ observed: 'STOPPED' }), 'stop'), 'notRunning')
    assert.equal(actionBlockReason(service({ observed: 'FAILED' }), 'stop'), null, 'a failed worker can still be stopped')
    assert.equal(actionBlockReason(service({ observed: 'READY' }), 'stop'), null)
  })

  test('restart needs a service that has actually run', () => {
    assert.equal(actionBlockReason(service({ registered: false }), 'restart'), 'neverStarted')
    assert.equal(actionBlockReason(service({ registered: true }), 'restart'), null)
  })

  test('isActionDisabled mirrors the reason', () => {
    assert.equal(isActionDisabled(service({ observed: 'READY' }), 'start'), true)
    assert.equal(isActionDisabled(service({ observed: 'STOPPED' }), 'start'), false)
  })

  test('the vocabulary groups actions and never ships an unknown id', () => {
    const ids = SERVICE_ACTIONS_UI.map(meta => meta.action)
    assert.deepEqual([...ids].sort(), ['probe', 'reset', 'restart', 'run-once', 'start', 'stop'])
    assert.ok(SERVICE_ACTIONS_UI.some(meta => meta.group === 'control'))
    assert.ok(SERVICE_ACTIONS_UI.some(meta => meta.group === 'inspect'))
    assert.equal(SERVICE_ACTIONS_UI.find(meta => meta.action === 'probe')?.group, 'inspect')
  })
})

describe('runServiceOperation', () => {
  const noSleep = async () => {}

  test('follows an operation from accepted to terminal and reports each phase', async () => {
    const phases: string[] = []
    let accepted = 0
    const snapshots = [
      { state: 'RUNNING', phase: 'starting', terminal: false },
      { state: 'RUNNING', phase: 'awaiting-readiness', terminal: false },
      { state: 'SUCCEEDED', phase: 'done', terminal: true },
    ]
    let reads = 0

    const result = await runServiceOperation({
      serviceId: 'news',
      action: 'start',
      request: async () => { accepted += 1; return { operationId: 'op_1' } },
      fetchOperation: async () => snapshots[Math.min(reads++, snapshots.length - 1)] as never,
      onPhase: phase => phases.push(phase),
      sleep: noSleep,
    })

    assert.equal(accepted, 1)
    assert.equal(result.state, 'SUCCEEDED')
    assert.equal(result.operationId, 'op_1')
    assert.equal(result.timedOut, false)
    assert.deepEqual(phases, ['queued', 'starting', 'awaiting-readiness', 'done'])
  })

  test('a non-terminal operation ends UNCONFIRMED at the deadline, never as success', async () => {
    const result = await runServiceOperation({
      serviceId: 'news',
      action: 'start',
      request: async () => ({ operationId: 'op_1' }),
      fetchOperation: async () => ({ state: 'RUNNING', phase: 'draining', terminal: false }) as never,
      timeoutMs: 0,
      sleep: noSleep,
    })
    assert.equal(result.state, 'UNCONFIRMED')
    assert.equal(result.timedOut, true)
  })

  test('a terminal failure carries its error', async () => {
    const result = await runServiceOperation({
      serviceId: 'news',
      action: 'start',
      request: async () => ({ operationId: 'op_1' }),
      fetchOperation: async () => ({ state: 'FAILED', terminal: true, error: 'READINESS_TIMEOUT: too slow' }) as never,
      sleep: noSleep,
    })
    assert.equal(result.state, 'FAILED')
    assert.match(String(result.error), /READINESS_TIMEOUT/)
  })

  test('derives terminality from the state when the flag is absent', async () => {
    const result = await runServiceOperation({
      serviceId: 'news',
      action: 'probe',
      request: async () => ({ operationId: 'op_1' }),
      fetchOperation: async () => ({ state: 'SUCCEEDED' }) as never,
      sleep: noSleep,
    })
    assert.equal(result.state, 'SUCCEEDED')
  })

  test('an aborted signal stops polling and never reports success', async () => {
    const controller = new AbortController()
    controller.abort()
    let reads = 0
    const result = await runServiceOperation({
      serviceId: 'news',
      action: 'start',
      request: async () => ({ operationId: 'op_1' }),
      fetchOperation: async () => { reads += 1; return { state: 'SUCCEEDED', terminal: true } as never },
      signal: controller.signal,
      sleep: noSleep,
    })
    assert.equal(result.state, 'CANCELLED')
    assert.equal(reads, 0, 'an aborted caller does not keep polling')
  })

  test('isTerminalState knows the four terminal states', () => {
    for (const state of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCONFIRMED']) {
      assert.equal(isTerminalState(state), true, state)
    }
    for (const state of ['QUEUED', 'RUNNING']) {
      assert.equal(isTerminalState(state), false, state)
    }
  })
})
