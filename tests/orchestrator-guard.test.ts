import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  overlappingSupervisorLeases,
  partitionBySupervisorLease,
} from '../services/orchestratorGuard.mjs'

// =============================================================================
//  Orchestrator / supervisor overlap guard (V4.2 §17.15-O4).
//
//  Two copies of a producer means duplicate alerts and duplicate writes, so the
//  legacy orchestrator must step aside for any service a live supervisor owns.
//  The rules that matter:
//
//    1. a LIVE lease blocks; an EXPIRED lease does not (a crashed supervisor
//       must not lock the orchestrator out forever);
//    2. only the same ownership scope counts;
//    3. the guard never blocks itself (its own owner id is ignored);
//    4. it is read-only — a broken/missing store degrades to "run everything".
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

function storeOf(records: Array<Record<string, unknown>>) {
  return { listServices: () => records }
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: 'news',
    scopeKey: 'system',
    lease: { owner: 'host-a:1', expiresAt: NOW + 30_000, acquiredAt: NOW },
    ...overrides,
  }
}

describe('overlappingSupervisorLeases', () => {
  test('blocks a service with a live lease', () => {
    const blocked = overlappingSupervisorLeases({
      store: storeOf([record()]),
      serviceIds: ['news', 'scanner'],
      now: NOW,
    })
    assert.deepEqual(blocked, [{ serviceId: 'news', owner: 'host-a:1', expiresAt: NOW + 30_000 }])
  })

  test('ignores a service the orchestrator does not run', () => {
    const blocked = overlappingSupervisorLeases({
      store: storeOf([record({ serviceId: 'signals' })]),
      serviceIds: ['news'],
      now: NOW,
    })
    assert.deepEqual(blocked, [])
  })

  test('an expired lease does not block anything', () => {
    const blocked = overlappingSupervisorLeases({
      store: storeOf([record({ lease: { owner: 'host-a:1', expiresAt: NOW - 1 } })]),
      serviceIds: ['news'],
      now: NOW,
    })
    assert.deepEqual(blocked, [], 'a crashed supervisor must not lock the orchestrator out')
  })

  test('a lease with no expiry is not treated as live', () => {
    const blocked = overlappingSupervisorLeases({
      store: storeOf([record({ lease: { owner: 'host-a:1' } })]),
      serviceIds: ['news'],
      now: NOW,
    })
    assert.deepEqual(blocked, [])
  })

  test('another ownership scope is a different service', () => {
    const blocked = overlappingSupervisorLeases({
      store: storeOf([record({ scopeKey: 'owner-1' })]),
      serviceIds: ['news'],
      now: NOW,
    })
    assert.deepEqual(blocked, [])
  })

  test('the guard never blocks the orchestrator itself', () => {
    const blocked = overlappingSupervisorLeases({
      store: storeOf([record({ lease: { owner: 'legacy-orchestrator', expiresAt: NOW + 30_000 } })]),
      serviceIds: ['news'],
      now: NOW,
    })
    assert.deepEqual(blocked, [])
  })

  test('a record without a lease is ignored, and output is sorted', () => {
    const blocked = overlappingSupervisorLeases({
      store: storeOf([
        { serviceId: 'signals', scopeKey: 'system', lease: null },
        record({ serviceId: 'regime' }),
        record({ serviceId: 'funding' }),
      ]),
      serviceIds: ['signals', 'regime', 'funding'],
      now: NOW,
    })
    assert.deepEqual(blocked.map(entry => entry.serviceId), ['funding', 'regime'])
  })

  test('a missing or broken store degrades to "nothing blocked"', () => {
    assert.deepEqual(overlappingSupervisorLeases({ store: null, serviceIds: ['news'], now: NOW }), [])
    assert.deepEqual(overlappingSupervisorLeases({ store: {}, serviceIds: ['news'], now: NOW }), [])
  })
})

describe('partitionBySupervisorLease', () => {
  const services = [{ name: 'news' }, { name: 'scanner' }, { name: 'funding' }]

  test('keeps order and splits owned services out', () => {
    const { runnable, blocked } = partitionBySupervisorLease({
      store: storeOf([record({ serviceId: 'scanner' })]),
      services,
      now: NOW,
    })
    assert.deepEqual(runnable.map(service => service.name), ['news', 'funding'])
    assert.deepEqual(blocked.map(entry => entry.service.name), ['scanner'])
    assert.equal(blocked[0].owner, 'host-a:1')
  })

  test('with no supervisor state everything runs', () => {
    const { runnable, blocked } = partitionBySupervisorLease({ store: storeOf([]), services, now: NOW })
    assert.equal(runnable.length, 3)
    assert.equal(blocked.length, 0)
  })

  test('with the whole registry owned, nothing runs', () => {
    const { runnable, blocked } = partitionBySupervisorLease({
      store: storeOf(services.map(service => record({ serviceId: service.name }))),
      services,
      now: NOW,
    })
    assert.equal(runnable.length, 0)
    assert.equal(blocked.length, 3)
  })

  test('the orchestrator itself is wired to the guard', () => {
    const source = readSource('services/run.mjs')
    assert.match(source, /partitionBySupervisorLease\(/, 'run.mjs consults the guard')
    assert.match(source, /SERVICES_ALLOW_OVERLAP/, 'the escape hatch is explicit')
    assert.match(source, /SKIP \$\{s\.name\}/, 'a blocked service is skipped and logged, never started')
    assert.match(source, /initial\.runnable\.forEach/, 'watch schedules only what it may run')
  })

  test('the supervisor side already refuses a second active operation', () => {
    const source = readSource('services/supervisor.mjs')
    assert.match(source, /OPERATION_IN_PROGRESS/, 'one active operation per service')
    assert.match(source, /LEASE_HELD/, 'one live worker per service+scope')
  })
})

function readSource(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}
