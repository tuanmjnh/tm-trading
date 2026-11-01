import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  REGISTRY_SCHEMA_VERSION,
  READINESS_RULE_LABELS,
  SERVICES,
  dependenciesOf,
  getServiceDefinition,
  resolveStartOrder,
  validateRegistry,
} from '../services/registry.mjs'

// =============================================================================
//  V4.2 §17.2 service registry contract.
//
//  The registry is the single description of "what runs". These tests protect
//  the properties the supervisor and the Operations UI will rely on:
//
//    1. every declared dependency resolves and the graph is acyclic;
//    2. the start order is deterministic and respects dependencies;
//    3. interval invariants match the execution mode;
//    4. a bad registry is REJECTED instead of silently accepted.
// =============================================================================

/** Build a valid synthetic definition so each test fails for one reason only. */
function definition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sample',
    label: 'Sample service',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/funding.mjs',
    intervalSec: 60,
    startupGraceMs: 60_000,
    dependencies: [],
    readiness: [{ id: 'process-alive', label: READINESS_RULE_LABELS['process-alive'], required: true }],
    supports: ['start', 'stop', 'restart', 'probe'],
    ...overrides,
  }
}

const RUNNING_SERVICES = [
  'market-plane',
  'funding',
  'scanner',
  'news',
  'regime',
  'liquidation',
  'confluence',
  'crossScan',
  'macro',
  'newsExtract',
  'retention',
  'reconcile',
  'signals',
  'alertRules',
  'brief',
  'ai-agent',
  'ai-review',
  'bot-supervisor',
]

const PLANNED_SERVICES = ['market-feeds', 'outlook', 'demo-runner']

describe('registry — shape', () => {
  test('declares every service the repo already runs', () => {
    for (const id of RUNNING_SERVICES) {
      assert.ok(getServiceDefinition(id), `missing definition for ${id}`)
    }
  })

  test('marks the target-only services as planned', () => {
    for (const id of PLANNED_SERVICES) {
      const service = getServiceDefinition(id)
      assert.ok(service, `missing planned definition for ${id}`)
      assert.equal(service.planned, true, `${id} must be planned`)
      assert.equal(service.entry, undefined, `${id} must not claim an entry file`)
    }
  })

  test('ids are unique and non-empty', () => {
    const ids = SERVICES.map(service => service.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const id of ids) assert.ok(id.length > 0)
  })

  test('every non-planned service points at a file that exists', () => {
    for (const service of SERVICES) {
      if (service.planned) continue
      assert.equal(typeof service.entry, 'string', `${service.id} needs an entry`)
      assert.ok(existsSync(join(process.cwd(), service.entry)), `${service.entry} does not exist`)
    }
  })

  test('every service can be probed', () => {
    for (const service of SERVICES) {
      assert.ok(service.supports.includes('probe'), `${service.id} must support probe`)
      assert.ok(service.supports.length > 0)
    }
  })

  test('readiness rules carry a label and a required flag', () => {
    for (const service of SERVICES) {
      assert.ok(service.readiness.length > 0, `${service.id} declares no readiness rule`)
      for (const rule of service.readiness) {
        assert.equal(typeof rule.label, 'string')
        assert.ok(rule.label.length > 0, `${service.id}/${rule.id} has no label`)
        assert.equal(typeof rule.required, 'boolean')
      }
    }
  })

  test('the schema version is stamped', () => {
    assert.equal(REGISTRY_SCHEMA_VERSION, 'services.v1')
  })
})

describe('registry — validation', () => {
  test('the real registry is valid', () => {
    const result = validateRegistry(SERVICES)
    assert.deepEqual(result.errors, [])
    assert.equal(result.ok, true)
  })

  test('a duplicate id is rejected', () => {
    const result = validateRegistry([definition({ id: 'x' }), definition({ id: 'x' })])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'duplicate-id'))
  })

  test('an unknown dependency is rejected', () => {
    const result = validateRegistry([definition({ dependencies: [{ serviceId: 'ghost', policy: 'OPTIONAL' }] })])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'unknown-dependency'))
  })

  test('a self dependency is rejected', () => {
    const result = validateRegistry([definition({ id: 'x', dependencies: [{ serviceId: 'x', policy: 'OPTIONAL' }] })])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'self-dependency'))
  })

  test('a dependency cycle is rejected', () => {
    const result = validateRegistry([
      definition({ id: 'a', dependencies: [{ serviceId: 'b', policy: 'OPTIONAL' }] }),
      definition({ id: 'b', dependencies: [{ serviceId: 'a', policy: 'OPTIONAL' }] }),
    ])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'dependency-cycle'))
  })

  test('a periodic service without an interval is rejected', () => {
    const result = validateRegistry([definition({ intervalSec: null })])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'invalid-interval'))
  })

  test('an event-driven service with an interval is rejected', () => {
    const result = validateRegistry([definition({ executionMode: 'event-driven', intervalSec: 60 })])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'invalid-interval'))
  })

  test('an unknown readiness rule is rejected', () => {
    const result = validateRegistry([
      definition({ readiness: [{ id: 'made-up-rule', label: 'x', required: true }] }),
    ])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'unknown-readiness-rule'))
  })

  test('an invalid enum value is rejected', () => {
    const result = validateRegistry([definition({ scope: 'galaxy' })])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'invalid-scope'))
  })

  test('an unknown dependency policy is rejected', () => {
    const result = validateRegistry([
      definition({ dependencies: [{ serviceId: 'sample-2', policy: 'WHENEVER' }] }),
      definition({ id: 'sample-2' }),
    ])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'invalid-dependency-policy'))
  })

  test('a zero startup grace is rejected', () => {
    const result = validateRegistry([definition({ startupGraceMs: 0 })])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.code === 'invalid-startup-grace'))
  })
})

describe('registry — interval invariants', () => {
  test('periodic and continuous services declare a positive interval', () => {
    for (const service of SERVICES) {
      if (service.executionMode !== 'periodic' && service.executionMode !== 'continuous') continue
      assert.ok(Number.isFinite(service.intervalSec), `${service.id} needs an interval`)
      assert.ok(service.intervalSec > 0, `${service.id} interval must be > 0`)
    }
  })

  test('event-driven and on-demand services declare no interval', () => {
    for (const service of SERVICES) {
      if (service.executionMode !== 'event-driven' && service.executionMode !== 'on-demand') continue
      assert.equal(service.intervalSec, null, `${service.id} must not declare an interval`)
    }
  })
})

describe('resolveStartOrder', () => {
  test('is deterministic for the same input', () => {
    const first = resolveStartOrder(SERVICES)
    const second = resolveStartOrder(SERVICES)
    assert.deepEqual(first.errors, [])
    assert.deepEqual(first.order, second.order)
  })

  test('starts dependencies before dependents', () => {
    const { order } = resolveStartOrder(SERVICES)
    const at = (id: string) => {
      const index = order.indexOf(id)
      assert.ok(index >= 0, `${id} is missing from the order`)
      return index
    }

    assert.ok(at('scanner') < at('regime'))
    assert.ok(at('funding') < at('regime'))
    assert.ok(at('regime') < at('confluence'))
    assert.ok(at('funding') < at('confluence'))
    assert.ok(at('liquidation') < at('confluence'))
    assert.ok(at('news') < at('newsExtract'))
    assert.ok(at('brief') < at('outlook'))
  })

  test('reports an unknown id instead of dropping it', () => {
    const { order, errors } = resolveStartOrder(SERVICES, ['funding', 'ghost'])
    assert.deepEqual(order, ['funding'])
    assert.equal(errors.length, 1)
    assert.equal(errors[0].code, 'unknown-service')
  })

  test('reports a cycle instead of returning a partial order silently', () => {
    const cyclic = [
      definition({ id: 'a', dependencies: [{ serviceId: 'b', policy: 'OPTIONAL' }] }),
      definition({ id: 'b', dependencies: [{ serviceId: 'a', policy: 'OPTIONAL' }] }),
    ]
    const { order, errors } = resolveStartOrder(cyclic)
    assert.equal(order.length, 0)
    assert.equal(errors[0].code, 'dependency-cycle')
  })
})

describe('dependenciesOf', () => {
  test('returns direct dependencies only by default', () => {
    assert.deepEqual(dependenciesOf(SERVICES, 'confluence'), ['regime', 'funding', 'liquidation'])
  })

  test('walks the graph transitively when asked', () => {
    assert.deepEqual(dependenciesOf(SERVICES, 'confluence', { transitive: true }), [
      'regime',
      'scanner',
      'funding',
      'liquidation',
    ])
  })

  test('a leaf service has no dependencies', () => {
    assert.deepEqual(dependenciesOf(SERVICES, 'funding'), [])
  })

  test('an unknown service has no dependencies', () => {
    assert.deepEqual(dependenciesOf(SERVICES, 'ghost'), [])
  })

  test('a cycle terminates and never lists the origin', () => {
    const cyclic = [
      definition({ id: 'a', dependencies: [{ serviceId: 'b', policy: 'OPTIONAL' }] }),
      definition({ id: 'b', dependencies: [{ serviceId: 'a', policy: 'OPTIONAL' }] }),
    ]
    assert.deepEqual(dependenciesOf(cyclic, 'a', { transitive: true }), ['b'])
  })
})
