import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EVIDENCE_FIELDS,
  evidenceFromSummary,
  pickEvidence,
} from '../services/workerProbes.mjs'
import { evaluateReadiness, readinessOptions } from '../services/readiness.mjs'
import { loadRegistry, validateRegistry } from '../services/registry.mjs'
import { runCycle } from '../services/workerHost.mjs'

// =============================================================================
//  V4.2 §17.4 — worker evidence.
//
//  Before this channel existed a service could only prove "Mongo answered" and
//  "the sink is writable", so a declared subscription / validated-job /
//  fresh-event / outbox rule could never pass for a real worker. The drill
//  harness found this: `drill-main` could not become READY even though it was
//  demonstrably working.
//
//  These tests pin the three rules that keep the channel honest:
//    1. only whitelisted fields travel (a service cannot invent a rule);
//    2. a missing field is `undefined` (not evidence) and `null` is preserved
//       (NOT OBSERVED is an answer, never a silent pass);
//    3. an explicit observation beats a heuristic derived from the summary.
// =============================================================================

describe('worker evidence — whitelist', () => {
  test('the canonical field list covers every readiness rule that needs one', () => {
    for (const field of [
      'dependenciesReachable',
      'subscriptionAcked',
      'lastEventAt',
      'lastSuccessAt',
      'lastOutputCount',
      'capabilityVerified',
      'lastJobValidated',
      'outboxLastConsumedAt',
      'sinkWritable',
    ]) {
      assert.ok(EVIDENCE_FIELDS.includes(field), `${field} is not in EVIDENCE_FIELDS`)
    }
  })

  test('pickEvidence keeps known fields and drops everything else', () => {
    const picked = pickEvidence({
      subscriptionAcked: true,
      lastEventAt: 123,
      // A service trying to write supervisor-owned state must be ignored.
      processAlive: true,
      observed: 'READY',
      health: 'HEALTHY',
      serviceInstanceId: 'si_forged',
    })
    assert.deepEqual(picked, { subscriptionAcked: true, lastEventAt: 123 })
  })

  test('pickEvidence preserves an explicit null but drops undefined', () => {
    const picked = pickEvidence({ subscriptionAcked: null, lastEventAt: undefined })
    assert.deepEqual(picked, { subscriptionAcked: null })
    assert.ok('subscriptionAcked' in picked, 'null means not observed and must survive')
    assert.ok(!('lastEventAt' in picked), 'undefined means "no answer", not evidence')
  })

  test('pickEvidence tolerates junk without throwing', () => {
    for (const value of [null, undefined, 42, 'evidence', [], () => {}]) {
      assert.deepEqual(pickEvidence(value), {})
    }
  })
})

describe('worker evidence — summary merge', () => {
  test('a mongo-up summary still proves dependency reachability', () => {
    const evidence = evidenceFromSummary({ mongo: 'up', count: 7 })
    assert.equal(evidence.dependenciesReachable, true)
    assert.equal(evidence.lastOutputCount, 7)
  })

  test('a mongo-down summary proves the dependency is broken', () => {
    assert.equal(evidenceFromSummary({ mongo: 'down', count: 0 }).dependenciesReachable, false)
    assert.equal(evidenceFromSummary({ skipped: 'mongo-down' }).dependenciesReachable, false)
    assert.equal(evidenceFromSummary({ mongoDown: true }).dependenciesReachable, false)
  })

  test('explicit evidence wins over the mongo heuristic', () => {
    // A service that reached its dependencies another way (or whose Mongo ping
    // is irrelevant) must be able to say so.
    const evidence = evidenceFromSummary({ mongo: 'down', evidence: { dependenciesReachable: true } })
    assert.equal(evidence.dependenciesReachable, true)
  })

  test('explicit evidence cannot smuggle in a non-whitelisted field', () => {
    const evidence = evidenceFromSummary({ evidence: { subscriptionAcked: true, observed: 'READY' } })
    assert.equal(evidence.subscriptionAcked, true)
    assert.ok(!('observed' in evidence))
  })

  test('output count follows the definition override keys', () => {
    const definition = { outputCountKeys: ['alerts'] }
    const evidence = evidenceFromSummary({ alerts: 12, count: 99 }, definition)
    assert.equal(evidence.lastOutputCount, 12)
  })
})

describe('worker evidence — readiness windows', () => {
  const definition = {
    id: 'test-service',
    label: 'Test',
    startupGraceMs: 10_000,
    intervalSec: 60,
    dependencies: [],
    readiness: [
      { id: 'process-alive', required: true },
      { id: 'fresh-event', required: false },
      { id: 'outbox-consuming', required: false },
    ],
    supports: ['start'],
  }

  test('no override yields no window options', () => {
    assert.deepEqual(readinessOptions({ ...definition }), {})
  })

  test('positive overrides are passed through', () => {
    assert.deepEqual(
      readinessOptions({ ...definition, staleAfterMs: 5_000, freshEventMaxAgeMs: 1_000, outboxMaxAgeMs: 2_000 }),
      { staleAfterMs: 5_000, freshEventMaxAgeMs: 1_000, outboxMaxAgeMs: 2_000 },
    )
  })

  test('zero, negative and non-numeric overrides are ignored', () => {
    assert.deepEqual(
      readinessOptions({ ...definition, staleAfterMs: 0, freshEventMaxAgeMs: -1, outboxMaxAgeMs: 'soon' }),
      {},
    )
    assert.deepEqual(readinessOptions(null), {})
  })

  test('a raised freshness window turns a stale event into a pass', () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0)
    const evidence = { processAlive: true, lastEventAt: now - 90_000 }

    const strict = evaluateReadiness(definition, evidence, { now })
    assert.equal(strict.checks.find(check => check.id === 'fresh-event')?.passed, false, '90s must fail the default 60s window')

    const relaxed = evaluateReadiness(definition, evidence, { now, ...readinessOptions({ ...definition, freshEventMaxAgeMs: 120_000 }) })
    assert.equal(relaxed.checks.find(check => check.id === 'fresh-event')?.passed, true)
  })
})

describe('worker evidence — cycle reporting', () => {
  test('runCycle reports the evidence the service observed', async () => {
    const result = await runCycle({
      definition: { id: 'test', outputCountKeys: ['count'] },
      run: () => ({ ok: true, count: 2, evidence: { subscriptionAcked: true, lastJobValidated: true } }),
    })
    assert.equal(result.ok, true)
    assert.equal(result.outputCount, 2)
    assert.equal(result.evidence.subscriptionAcked, true)
    assert.equal(result.evidence.lastJobValidated, true)
    assert.equal(result.evidence.lastOutputCount, 2)
  })

  test('a skipped cycle claims no output but keeps the real evidence', async () => {
    const result = await runCycle({
      definition: { id: 'test', outputCountKeys: ['count'] },
      run: () => ({ ok: true, skipped: 'market-closed', count: 0, evidence: { subscriptionAcked: true } }),
    })
    assert.equal(result.skipped, 'market-closed')
    assert.equal(result.outputCount, null, 'a skip is not proof of zero output')
    assert.equal(result.evidence.subscriptionAcked, true)
    assert.equal(result.evidence.lastOutputCount, null)
  })

  test('a thrown cycle reports no evidence at all', async () => {
    const result = await runCycle({
      definition: { id: 'test' },
      run: () => { throw new Error('boom') },
    })
    assert.equal(result.ok, false)
    assert.match(String(result.error), /boom/)
    assert.deepEqual(result.evidence, { lastOutputCount: null })
  })
})

describe('worker evidence — custom registry', () => {
  function writeRegistry(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'tm-registry-'))
    const file = join(dir, 'registry.mjs')
    writeFileSync(file, contents)
    return file
  }

  test('with no override the built-in registry is used', async () => {
    const { registry, source } = await loadRegistry({})
    assert.equal(source, 'builtin')
    assert.ok(registry.length > 0)
    assert.equal(validateRegistry(registry).ok, true)
  })

  test('the drill fixture registry is valid', async () => {
    const { registry, source } = await loadRegistry({ TM_SUPERVISOR_REGISTRY: 'tools/drills/fixtures/registry.mjs' })
    assert.match(source, /registry\.mjs$/)
    assert.deepEqual(registry.map(definition => definition.id), ['drill-main', 'drill-quiet', 'drill-crash'])
    assert.equal(validateRegistry(registry).ok, true)
  })

  test('an invalid override is rejected instead of silently ignored', async () => {
    const file = writeRegistry('export const SERVICES = [{ id: "broken" }]')
    try {
      await assert.rejects(
        () => loadRegistry({ TM_SUPERVISOR_REGISTRY: file }),
        /is invalid/,
      )
    } finally {
      rmSync(join(file, '..'), { recursive: true, force: true })
    }
  })

  test('a module that exports nothing is rejected', async () => {
    const file = writeRegistry('export const OTHER = []')
    try {
      await assert.rejects(
        () => loadRegistry({ TM_SUPERVISOR_REGISTRY: file }),
        /non-empty SERVICES array/,
      )
    } finally {
      rmSync(join(file, '..'), { recursive: true, force: true })
    }
  })
})