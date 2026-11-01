import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { desirableServices } from '../server/utils/embeddedServices.ts'
import { SERVICES } from '../services/registry.mjs'

// =============================================================================
//  The embedded supervisor starts a set of services on boot by itself, so the
//  rule that picks them is a contract: it must never start a second copy of a
//  service another process hosts, never start something with no code, and never
//  purge data as a side effect of opening the dashboard.
// =============================================================================

const definition = (overrides: Record<string, unknown> = {}) => ({
  id: 'alpha',
  supervised: true,
  intervalSec: 900,
  supports: ['start', 'stop', 'run-once', 'probe'],
  ...overrides,
})

describe('embedded supervisor — auto-start selection', () => {
  test('keeps the periodic services the supervisor owns', () => {
    const picked = desirableServices([
      definition({ id: 'funding' }),
      definition({ id: 'scanner' }),
    ])
    assert.deepEqual(picked.map(entry => entry.id), ['funding', 'scanner'])
  })

  test('never starts a service another process hosts', () => {
    const picked = desirableServices([
      definition({ id: 'market-plane', supervised: false }),
      definition({ id: 'ai-agent', supervised: false }),
      definition({ id: 'funding' }),
    ])
    assert.deepEqual(picked.map(entry => entry.id), ['funding'])
  })

  test('never starts a planned service or one without a cadence', () => {
    const picked = desirableServices([
      definition({ id: 'market-feeds', planned: true }),
      definition({ id: 'outlook', planned: true }),
      definition({ id: 'event-driven', intervalSec: null }),
      definition({ id: 'funding' }),
    ])
    assert.deepEqual(picked.map(entry => entry.id), ['funding'])
  })

  test('never starts a service that does not support start', () => {
    const picked = desirableServices([
      definition({ id: 'probe-only', supports: ['probe'] }),
      definition({ id: 'funding' }),
    ])
    assert.deepEqual(picked.map(entry => entry.id), ['funding'])
  })

  test('leaves retention to the operator', () => {
    const picked = desirableServices([
      definition({ id: 'retention', intervalSec: 21600 }),
      definition({ id: 'funding' }),
    ])
    assert.deepEqual(picked.map(entry => entry.id), ['funding'])
  })

  test('against the real registry it picks the periodic services only', () => {
    const picked = desirableServices(SERVICES as unknown as Array<{ id: string }>)
    const ids = picked.map(entry => entry.id).sort()

    assert.deepEqual(ids, [
      'alertRules', 'brief', 'confluence', 'crossScan', 'funding', 'liquidation',
      'macro', 'news', 'newsExtract', 'outbox-drain', 'reconcile', 'regime', 'scanner', 'signals',
    ])
    // The exceptions are structural, not accidental.
    for (const excluded of ['retention', 'market-plane', 'ai-agent', 'ai-review', 'bot-supervisor', 'market-feeds', 'outlook', 'demo-runner']) {
      assert.equal(ids.includes(excluded), false, `${excluded} must not be auto-started`)
    }
  })
})
