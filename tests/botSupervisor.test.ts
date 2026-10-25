import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SUPERVISOR_SCHEMA_VERSION,
  LEASE_TTL_MS,
  SUPERVISOR_COMMANDS,
  HEALTH_STATES,
  BOT_TRANSITIONS,
  SUPERVISOR_TERMINAL_STATES,
  SUPERVISOR_ACTIVE_STATES,
  isTerminalState,
  isActiveState,
  canTransition,
  supervisorId,
  leaseDoc,
  leaseIsLive,
  leaseExpired,
  validateCommand,
  recoverOnBoot,
  evaluateHealth,
  heartbeatPatch,
  heartbeatIsFresh,
} from '../engine/botSupervisor.mjs'
import { BOT_INSTANCE_STATES, BOT_INSTANCE_TERMINAL_STATES } from '../engine/models/botInstance.mjs'

// =============================================================================
//  Bot supervisor contract (roadmap §61.7 / §61.17 Phase E).
//
//  The supervisor is the only writer of `bot_instances.state`; this suite pins
//  the deterministic policy it must obey: legal edges, command authorization,
//  lease liveness, boot recovery and health promotion. Pure — no DB, no timer.
// =============================================================================

const OWNER = 'owner-alice'
const OTHER = 'owner-bob'
const T0 = 1_790_000_000_000

function inst(over = {}) {
  return { instanceId: 'bot_1', ownerId: OWNER, state: 'queued', accountId: 'default', ...over }
}

function command(over = {}) {
  return { command: 'start', commandId: 'cmd_1', ownerId: OWNER, ...over }
}

describe('bot supervisor — vocabulary in sync with the persisted model', () => {
  test('transition table covers exactly the model states', () => {
    assert.deepEqual(Object.keys(BOT_TRANSITIONS).sort(), [...BOT_INSTANCE_STATES].sort())
    for (const [from, tos] of Object.entries(BOT_TRANSITIONS)) {
      for (const to of tos) {
        assert.ok(BOT_INSTANCE_STATES.includes(to), `${from} -> ${to} is not a model state`)
      }
    }
  })

  test('terminal sets agree with the model', () => {
    assert.deepEqual([...SUPERVISOR_TERMINAL_STATES].sort(), [...BOT_INSTANCE_TERMINAL_STATES].sort())
    for (const s of SUPERVISOR_TERMINAL_STATES) assert.equal(BOT_TRANSITIONS[s].length, 0, `${s} must have no edges`)
    for (const s of SUPERVISOR_ACTIVE_STATES) assert.ok(BOT_INSTANCE_STATES.includes(s), `${s} not a model state`)
  })

  test('schema version and command/health vocabularies are frozen', () => {
    assert.equal(SUPERVISOR_SCHEMA_VERSION, '1')
    assert.deepEqual([...SUPERVISOR_COMMANDS], ['start', 'pause', 'resume', 'stop'])
    assert.deepEqual([...HEALTH_STATES], ['ok', 'degraded', 'error', 'unknown'])
    assert.equal(LEASE_TTL_MS, 30_000)
  })

  test('isTerminalState / isActiveState partition the lifecycle', () => {
    for (const s of BOT_INSTANCE_STATES) {
      assert.equal(isTerminalState(s), SUPERVISOR_TERMINAL_STATES.includes(s))
    }
    assert.equal(isActiveState('running'), true)
    assert.equal(isActiveState('queued'), false)
    assert.equal(isActiveState('halted'), false)
  })

  test('canTransition rejects self edges and unknown states', () => {
    assert.equal(canTransition('running', 'running'), false)
    assert.equal(canTransition('queued', 'running'), false)
    assert.equal(canTransition('nope', 'running'), false)
    assert.equal(canTransition('paused', 'running'), true)
    assert.equal(canTransition('halted', 'running'), false)
  })
})

describe('bot supervisor — leases', () => {
  test('supervisorId is stable per owner and distinct per nonce', () => {
    assert.equal(supervisorId(OWNER), supervisorId(OWNER))
    assert.notEqual(supervisorId(OWNER), supervisorId(OTHER))
    assert.notEqual(supervisorId(OWNER, 'a'), supervisorId(OWNER, 'b'))
    assert.match(supervisorId(OWNER, 'a'), /^sup_[0-9a-f]{16}_a$/)
    assert.throws(() => supervisorId(''), /ownerId is required/)
  })

  test('leaseDoc stamps claim/beat/expiry from one clock', () => {
    const lease = leaseDoc({ supervisorId: 'sup_x', now: T0, ttlMs: 1000 })
    assert.deepEqual(lease, { supervisorId: 'sup_x', claimedAt: T0, beatAt: T0, expiresAt: T0 + 1000 })
    assert.throws(() => leaseDoc({ supervisorId: '' }), /supervisorId is required/)
    assert.throws(() => leaseDoc({ supervisorId: 'sup_x', now: NaN }), /finite epoch ms/)
  })

  test('a lease is live strictly before expiry, dead at/after it', () => {
    const lease = leaseDoc({ supervisorId: 'sup_x', now: T0, ttlMs: 1000 })
    assert.equal(leaseIsLive(lease, T0), true)
    assert.equal(leaseIsLive(lease, T0 + 999), true)
    assert.equal(leaseIsLive(lease, T0 + 1000), false, 'expiry instant is dead')
    assert.equal(leaseExpired(lease, T0 + 1000), true)
    assert.equal(leaseIsLive(null, T0), false)
    assert.equal(leaseIsLive({ expiresAt: T0 + 10 }, T0), false, 'no beatAt is untrustworthy')
    assert.equal(leaseIsLive({ expiresAt: T0 + 10, beatAt: T0 }, T0), true)
  })

  test('heartbeatIsFresh uses lastEventAt, not the lease', () => {
    assert.equal(heartbeatIsFresh({ lastEventAt: T0 }, T0 + 10, 1000), true)
    assert.equal(heartbeatIsFresh({ lastEventAt: T0 }, T0 + 1000, 1000), false)
    assert.equal(heartbeatIsFresh({}, T0, 1000), false)
  })
})

describe('bot supervisor — command authorization', () => {
  test('commands move through the declared edges', () => {
    assert.deepEqual(validateCommand({ ...command(), instance: inst() }), { ok: true, to: 'starting', noop: false })
    assert.deepEqual(
      validateCommand({ ...command({ command: 'pause' }), instance: inst({ state: 'running' }) }),
      { ok: true, to: 'paused', noop: false },
    )
    assert.deepEqual(
      validateCommand({ ...command({ command: 'resume' }), instance: inst({ state: 'paused' }) }),
      { ok: true, to: 'running', noop: false },
    )
    assert.deepEqual(
      validateCommand({ ...command({ command: 'stop' }), instance: inst({ state: 'running' }) }),
      { ok: true, to: 'stopping', noop: false },
    )
    assert.deepEqual(
      validateCommand({ ...command({ command: 'stop' }), instance: inst({ state: 'queued' }) }),
      { ok: true, to: 'stopping', noop: false },
    )
  })

  test('repeating a satisfied command is an idempotent no-op', () => {
    assert.deepEqual(
      validateCommand({ ...command(), instance: inst({ state: 'running' }) }),
      { ok: true, to: 'starting', noop: true },
    )
    assert.deepEqual(
      validateCommand({ ...command({ command: 'pause' }), instance: inst({ state: 'paused' }) }),
      { ok: true, to: 'paused', noop: true },
    )
    assert.deepEqual(
      validateCommand({ ...command({ command: 'stop' }), instance: inst({ state: 'stopping' }) }),
      { ok: true, to: 'stopping', noop: true },
    )
  })

  test('ownership is checked against the persisted owner only', () => {
    assert.equal(validateCommand({ ...command({ ownerId: OTHER }), instance: inst() }).code, 'not_owner')
    assert.equal(validateCommand({ ...command({ ownerId: null }), instance: inst() }).code, 'not_owner')
    assert.equal(validateCommand({ ...command({ ownerId: OWNER }), instance: inst({ ownerId: null }) }).code, 'not_owner')
  })

  test('invalid commands report a stable reason code', () => {
    assert.equal(validateCommand({ instance: null }).code, 'missing_instance')
    assert.equal(validateCommand({ ...command({ command: 'explode' }), instance: inst() }).code, 'unknown_command')
    assert.equal(validateCommand({ ...command({ command: '' }), instance: inst() }).code, 'unknown_command')
    assert.equal(validateCommand({ ...command({ commandId: '' }), instance: inst() }).code, 'missing_command_id')
    assert.equal(validateCommand({ ...command({ commandId: undefined }), instance: inst() }).code, 'missing_command_id')
    assert.equal(
      validateCommand({ ...command({ command: 'resume' }), instance: inst({ state: 'halted' }) }).code,
      'terminal_instance',
    )
    assert.equal(validateCommand({ ...command(), instance: inst({ state: 'halted' }) }).code, 'terminal_instance')
    assert.equal(validateCommand({ ...command({ command: 'pause' }), instance: inst({ state: 'queued' }) }).code, 'invalid_transition')
  })

  test('account mismatch is refused when both sides declare one', () => {
    const instance = inst({ accountId: 'acct_a' })
    assert.equal(validateCommand({ ...command({ accountId: 'acct_b' }), instance }).code, 'account_mismatch')
    assert.equal(validateCommand({ ...command({ accountId: 'acct_a' }), instance }).ok, true)
    assert.equal(validateCommand({ ...command({ accountId: null }), instance }).ok, true)
  })
})

describe('bot supervisor — boot recovery', () => {
  const live = { supervisorId: 'sup_live', beatAt: T0, expiresAt: T0 + 60_000 }

  test('orphaned active instances fail; a stopping one completes', () => {
    const changes = recoverOnBoot(
      [
        inst({ instanceId: 'a', state: 'running' }),
        inst({ instanceId: 'b', state: 'starting', lease: { expiresAt: T0 - 1, beatAt: T0 - 1000 } }),
        inst({ instanceId: 'c', state: 'stopping' }),
        inst({ instanceId: 'd', state: 'paused' }),
      ],
      { now: T0 },
    )
    assert.deepEqual(changes, [
      { instanceId: 'a', from: 'running', to: 'failed', reasonCode: 'lease_expired' },
      { instanceId: 'b', from: 'starting', to: 'failed', reasonCode: 'lease_expired' },
      { instanceId: 'c', from: 'stopping', to: 'completed', reasonCode: 'lease_expired_stopping' },
      { instanceId: 'd', from: 'paused', to: 'failed', reasonCode: 'lease_expired' },
    ])
  })

  test('a live lease is left alone; queued/terminal rows are untouched', () => {
    const changes = recoverOnBoot(
      [
        inst({ instanceId: 'a', state: 'running', lease: live }),
        inst({ instanceId: 'b', state: 'queued' }),
        inst({ instanceId: 'c', state: 'completed', lease: { expiresAt: 0, beatAt: 0 } }),
        null,
        {},
      ],
      { now: T0 },
    )
    assert.deepEqual(changes, [])
  })

  test('recovery is deterministic and reports only the rows it changes', () => {
    const input = [inst({ instanceId: 'a', state: 'running' })]
    assert.deepEqual(recoverOnBoot(input, { now: T0 }), recoverOnBoot(input, { now: T0 }))
  })
})

describe('bot supervisor — health and heartbeat', () => {
  test('mongo down and worker errors are ERROR, never quiet', () => {
    assert.deepEqual(evaluateHealth({ mongoDown: true, lagMs: 0 }), { health: 'error', reasonCode: 'mongo_down' })
    assert.deepEqual(evaluateHealth({ lastError: 'boom' }), { health: 'error', reasonCode: 'worker_error' })
  })

  test('event lag over budget is DEGRADED; otherwise ok', () => {
    assert.deepEqual(evaluateHealth({ lagMs: 60_001, maxLagMs: 60_000 }), { health: 'degraded', reasonCode: 'event_lag' })
    assert.deepEqual(evaluateHealth({ lagMs: 60_000 }), { health: 'ok', reasonCode: null })
    assert.deepEqual(evaluateHealth({ lagMs: null }), { health: 'ok', reasonCode: null })
  })

  test('heartbeatPatch whitelists fields and validates health', () => {
    const patch = heartbeatPatch({
      now: T0,
      health: 'degraded',
      healthReason: 'event_lag',
      lagMs: 120_000,
      engineVersion: '0.5.0',
      subscriptions: ['BTCUSDT'],
      lastSignalKey: 'sig_1',
      evil: 'x',
    })
    assert.deepEqual(patch, {
      lastEventAt: T0,
      health: 'degraded',
      healthReason: 'event_lag',
      eventLagMs: 120_000,
      engineVersion: '0.5.0',
      subscriptions: ['BTCUSDT'],
      lastSignalKey: 'sig_1',
    })
    assert.throws(() => heartbeatPatch({ health: 'brilliant' }), /unknown health/)
  })

  test('heartbeatPatch omits optional identity fields when absent', () => {
    const patch = heartbeatPatch({ now: T0 })
    assert.deepEqual(patch, { lastEventAt: T0, health: 'ok', healthReason: null, eventLagMs: null })
  })
})
