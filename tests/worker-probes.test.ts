import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cycleIntervalMs,
  createWorker,
  runCycle,
} from '../services/workerHost.mjs'
import {
  cycleSkipReason,
  cycleSucceeded,
  evidenceFromSummary,
  mongoEvidence,
  outputCountOf,
  probeProviderCapability,
  probeSink,
  providerProbeTarget,
} from '../services/workerProbes.mjs'

// =============================================================================
//  V4.2 §17.4 — the evidence a worker is allowed to claim.
//
//  The supervisor trusts these answers, so the rules under test are:
//
//    1. an absent measurement is `null`, never a comfortable `true`/`0`;
//    2. a skip is not a success (it must not refresh `lastSuccessAt`);
//    3. a provider probe that cannot run is `null`, a rejected credential is
//       `false`, and an unreachable provider is `false`;
//    4. the worker protocol reports every cycle and drains on request.
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

describe('outputCountOf', () => {
  test('reads the declared keys in order', () => {
    assert.equal(outputCountOf({ scanned: 7, checked: 3 }, ['scanned', 'checked']), 7)
    assert.equal(outputCountOf({ checked: 3 }, ['scanned', 'checked']), 3)
  })

  test('an array summary reports its length', () => {
    assert.equal(outputCountOf([1, 2, 3]), 3)
    assert.equal(outputCountOf([]), 0)
  })

  test('zero is a real answer and stays zero', () => {
    assert.equal(outputCountOf({ checked: 0 }, ['checked']), 0)
  })

  test('an absent or unusable field is null', () => {
    assert.equal(outputCountOf({}), null)
    assert.equal(outputCountOf(null), null)
    assert.equal(outputCountOf(undefined), null)
    assert.equal(outputCountOf({ count: 'many' }), null)
    assert.equal(outputCountOf({ count: Number.NaN }), null)
    assert.equal(outputCountOf({ count: -2 }), null)
  })

  test('falls back to the default keys', () => {
    assert.equal(outputCountOf({ rows: 4 }), 4)
  })
})

describe('cycleSucceeded / cycleSkipReason', () => {
  test('an explicit failure is a failure', () => {
    assert.equal(cycleSucceeded({ ok: false }), false)
    assert.equal(cycleSucceeded({ error: 'boom' }), false)
  })

  test('a plain summary is a success', () => {
    assert.equal(cycleSucceeded({ checked: 2 }), true)
    assert.equal(cycleSucceeded(undefined), true)
    assert.equal(cycleSucceeded([]), true)
  })

  test('a skip is reported with its reason', () => {
    assert.equal(cycleSkipReason({ skipped: 'no-key' }), 'no-key')
    assert.equal(cycleSkipReason({ skipped: true }), 'skipped')
    assert.equal(cycleSkipReason({ skipped: 2 }), 'skipped:2')
    assert.equal(cycleSkipReason({ checked: 2 }), null)
    assert.equal(cycleSkipReason(null), null)
  })
})

describe('evidenceFromSummary', () => {
  test('carries the output count', () => {
    assert.deepEqual(evidenceFromSummary({ checked: 5 }, { outputCountKeys: ['checked'] }), {
      lastOutputCount: 5,
    })
  })

  test('mongo up/down becomes dependency evidence', () => {
    assert.equal(evidenceFromSummary({ mongo: 'up' }).dependenciesReachable, true)
    assert.equal(evidenceFromSummary({ mongo: 'down' }).dependenciesReachable, false)
    assert.equal(evidenceFromSummary({ mongoDown: true }).dependenciesReachable, false)
    assert.equal(evidenceFromSummary({ skipped: 'mongo-down' }).dependenciesReachable, false)
    assert.equal(evidenceFromSummary({ checked: 1 }).dependenciesReachable, undefined)
  })
})

describe('mongoEvidence', () => {
  test('no configured dependency is vacuously reachable', () => {
    assert.equal(mongoEvidence({ configured: false, connected: false }), true)
  })

  test('a configured dependency must actually answer', () => {
    assert.equal(mongoEvidence({ configured: true, connected: true }), true)
    assert.equal(mongoEvidence({ configured: true, connected: false }), false)
  })

  test('no status is no evidence', () => {
    assert.equal(mongoEvidence(null), null)
    assert.equal(mongoEvidence({}), null)
  })
})

describe('probeSink', () => {
  test('a disconnected Mongo is a non-writable sink', () => {
    assert.equal(probeSink({ mongoConfigured: true, mongoConnected: false }), false)
    assert.equal(probeSink({ mongoConfigured: true, mongoConnected: true }), true)
  })

  test('file-only deployments check the data directory', () => {
    const writable = { accessSync: () => {}, constants: { W_OK: 2 } }
    const readOnly = { accessSync: () => { throw new Error('EACCES') }, constants: { W_OK: 2 } }
    assert.equal(probeSink({ dir: 'data', fsImpl: writable as never }), true)
    assert.equal(probeSink({ dir: 'data', fsImpl: readOnly as never }), false)
  })

  test('no sink at all is no evidence', () => {
    assert.equal(probeSink({}), null)
  })
})

describe('providerProbeTarget', () => {
  test('OpenAI-compatible providers list models with a bearer token', () => {
    const target = providerProbeTarget({ provider: 'openai', apiKey: 'sk-x', baseUrl: 'https://api.openai.com/v1/' })
    assert.deepEqual(target, {
      url: 'https://api.openai.com/v1/models',
      headers: { authorization: 'Bearer sk-x' },
    })
  })

  test('Anthropic uses its own headers', () => {
    const target = providerProbeTarget({ provider: 'anthropic', apiKey: 'sk-a', baseUrl: 'https://api.anthropic.com/v1' })
    assert.equal(target?.url, 'https://api.anthropic.com/v1/models')
    assert.equal(target?.headers['x-api-key'], 'sk-a')
    assert.ok(target?.headers['anthropic-version'])
  })

  test('a local Ollama daemon needs no key', () => {
    assert.deepEqual(providerProbeTarget({ provider: 'ollama', baseUrl: 'http://localhost:11434' }), {
      url: 'http://localhost:11434/api/tags',
      headers: {},
    })
  })

  test('no honest probe exists for the hub gateway or a keyless provider', () => {
    assert.equal(providerProbeTarget({ provider: 'hub', apiKey: 'x', baseUrl: 'https://hub.example' }), null)
    assert.equal(providerProbeTarget({ provider: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1' }), null)
    assert.equal(providerProbeTarget(null), null)
  })
})

describe('probeProviderCapability', () => {
  const cfg = { provider: 'openai', apiKey: 'sk-x', baseUrl: 'https://api.example/v1' }

  test('a 2xx answer proves the credentials work', async () => {
    const result = await probeProviderCapability({
      cfg,
      fetchImpl: (async () => ({ ok: true, status: 200 })) as never,
    })
    assert.equal(result.passed, true)
  })

  test('a rejected credential is a real fault', async () => {
    for (const status of [401, 403]) {
      const result = await probeProviderCapability({
        cfg,
        fetchImpl: (async () => ({ ok: false, status })) as never,
      })
      assert.equal(result.passed, false)
    }
  })

  test('an inconclusive status is not evidence', async () => {
    for (const status of [404, 429, 500]) {
      const result = await probeProviderCapability({
        cfg,
        fetchImpl: (async () => ({ ok: false, status })) as never,
      })
      assert.equal(result.passed, null)
    }
  })

  test('an unreachable provider is a fault', async () => {
    const result = await probeProviderCapability({
      cfg,
      fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as never,
    })
    assert.equal(result.passed, false)
    assert.match(result.detail, /ECONNREFUSED/)
  })

  test('an unconfigured provider is not observed, not broken', async () => {
    const result = await probeProviderCapability({
      cfg: { provider: 'openai', apiKey: '', baseUrl: 'https://api.example/v1' },
      fetchImpl: (async () => { throw new Error('must not be called') }) as never,
    })
    assert.equal(result.passed, null)
    assert.equal(result.detail, 'no provider configured')
  })
})

describe('runCycle', () => {
  const definition = { outputCountKeys: ['checked'] }

  test('describes a successful cycle', async () => {
    const result = await runCycle({
      definition,
      run: async () => ({ checked: 4, mongo: 'up' }),
      now: () => NOW,
    })
    assert.equal(result.ok, true)
    assert.equal(result.outputCount, 4)
    assert.equal(result.evidence.lastOutputCount, 4)
    assert.equal(result.evidence.dependenciesReachable, true)
    assert.equal(result.error, null)
  })

  test('turns a throw into a failed cycle, not a dead worker', async () => {
    const result = await runCycle({
      definition,
      run: async () => { throw new Error('provider exploded') },
      now: () => NOW,
    })
    assert.equal(result.ok, false)
    assert.equal(result.outputCount, null)
    assert.match(result.error ?? '', /provider exploded/)
  })

  test('honours a reported failure', async () => {
    const result = await runCycle({
      definition,
      run: async () => ({ ok: false, code: 'mongo_down' }),
      now: () => NOW,
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'mongo_down')
  })

  test('a skip keeps the output count unknown', async () => {
    const result = await runCycle({
      definition,
      run: async () => ({ skipped: 'outside-window', chars: 0 }),
      now: () => NOW,
    })
    assert.equal(result.ok, true)
    assert.equal(result.skipped, 'outside-window')
    assert.equal(result.outputCount, null)
  })

  test('an array summary reports its length', async () => {
    const result = await runCycle({ definition, run: async () => [1, 2], now: () => NOW })
    assert.equal(result.outputCount, 2)
  })
})

describe('cycleIntervalMs', () => {
  test('uses the declared interval', () => {
    assert.equal(cycleIntervalMs({ intervalSec: 900 }, {}), 900_000)
  })

  test('honours the env override', () => {
    assert.equal(cycleIntervalMs({ intervalSec: 900, intervalEnv: 'FUNDING_INTERVAL' }, { FUNDING_INTERVAL: '30' }), 30_000)
  })

  test('ignores an unusable override', () => {
    assert.equal(cycleIntervalMs({ intervalSec: 900, intervalEnv: 'X' }, { X: 'abc' }), 900_000)
    assert.equal(cycleIntervalMs({ intervalSec: 900, intervalEnv: 'X' }, { X: '-5' }), 900_000)
  })

  test('clamps a sub-second interval', () => {
    assert.equal(cycleIntervalMs({ intervalSec: 0.1 }, {}), 1_000)
  })

  test('an event-driven service has no interval', () => {
    assert.equal(cycleIntervalMs({ intervalSec: null }, {}), null)
  })
})

describe('createWorker', () => {
  function harness(run: () => unknown, options: Record<string, unknown> = {}) {
    const sent: Array<Record<string, unknown>> = []
    const timers = {
      timeouts: [] as Array<{ run: () => unknown, ms: number }>,
      intervals: [] as Array<{ fn: () => unknown, ms: number }>,
      setTimeout(fn: () => unknown, ms: number) {
        // Real timers fire once and disappear; the fake must do the same or a
        // test that checks "one timer pending" sees the fired one too.
        const entry = {
          ms,
          run: () => {
            const index = timers.timeouts.indexOf(entry)
            if (index >= 0) timers.timeouts.splice(index, 1)
            return fn()
          },
        }
        timers.timeouts.push(entry)
        return entry
      },
      clearTimeout(t: { run: () => unknown }) {
        const index = timers.timeouts.indexOf(t as never)
        if (index >= 0) timers.timeouts.splice(index, 1)
      },
      setInterval(fn: () => unknown, ms: number) { const t = { fn, ms }; timers.intervals.push(t); return t },
      clearInterval(t: { fn: () => unknown }) { const i = timers.intervals.indexOf(t); if (i >= 0) timers.intervals.splice(i, 1) },
    }
    const worker = createWorker({
      definition: { outputCountKeys: ['checked'] },
      run,
      send: message => sent.push(message as Record<string, unknown>),
      now: () => NOW,
      intervalMs: 60_000,
      firstCycleDelayMs: 0,
      heartbeatMs: 10_000,
      instanceId: 'si_test',
      timers,
      ...options,
    })
    return { worker, sent, timers }
  }

  test('announces itself and schedules the first cycle', () => {
    const { worker, sent, timers } = harness(async () => ({ checked: 1 }))
    worker.start()
    assert.equal(sent[0]?.type, 'hello')
    assert.equal(sent[0]?.instanceId, 'si_test')
    assert.equal(timers.timeouts.length, 1)
    assert.equal(timers.intervals.length, 1)
  })

  test('reports every cycle and reschedules', async () => {
    const { worker, sent, timers } = harness(async () => ({ checked: 3 }))
    worker.start()
    await timers.timeouts[0]!.run()
    const cycle = sent.find(message => message.type === 'cycle')
    assert.ok(cycle)
    assert.equal(cycle?.ok, true)
    assert.equal(cycle?.outputCount, 3)
    assert.equal(timers.timeouts.length, 1, 'the next cycle is scheduled')
  })

  test('reports a failed cycle without dying', async () => {
    let calls = 0
    const { worker, sent, timers } = harness(async () => {
      calls += 1
      if (calls === 1) throw new Error('first cycle failed')
      return { checked: 1 }
    })
    worker.start()
    await timers.timeouts[0]!.run()
    const cycle = sent.find(message => message.type === 'cycle')
    assert.equal(cycle?.ok, false)
    assert.match(String(cycle?.error), /first cycle failed/)
    assert.equal(worker.stopping, false)
  })

  test('a heartbeat carries telemetry and merged evidence', async () => {
    const telemetry = { sample: () => ({ pid: 1 }), stop: () => {} }
    const { worker, sent } = harness(async () => ({ checked: 2 }), {
      telemetry,
      collectEvidence: async () => ({ dependenciesReachable: true }),
    })
    worker.start()
    await worker.heartbeat()
    const heartbeat = sent.find(message => message.type === 'heartbeat')
    assert.ok(heartbeat)
    assert.deepEqual(heartbeat?.telemetry, { pid: 1 })
    assert.equal((heartbeat?.evidence as Record<string, unknown>).dependenciesReachable, true)
    assert.equal((heartbeat?.evidence as Record<string, unknown>).lastOutputCount, null)
  })

  test('a failing evidence probe does not stop the heartbeat', async () => {
    const { worker, sent } = harness(async () => ({}), {
      collectEvidence: async () => { throw new Error('mongo down') },
    })
    worker.start()
    await worker.heartbeat()
    assert.equal(sent.filter(message => message.type === 'heartbeat').length, 1)
  })

  test('run-once answers with an operation result', async () => {
    const { worker, sent } = harness(async () => ({ checked: 2 }))
    await worker.runOnce('op_1')
    const result = sent.find(message => message.type === 'operation-result')
    assert.equal(result?.operationId, 'op_1')
    assert.equal(result?.ok, true)
  })

  test('run-once refuses to overlap a running cycle', async () => {
    let release: (() => void) | null = null
    const { worker, sent } = harness(() => new Promise(resolve => {
      release = () => resolve({ checked: 1 })
    }))
    const first = worker.cycle()
    await worker.runOnce('op_2')
    const result = sent.find(message => message.type === 'operation-result')
    assert.equal(result?.ok, false)
    assert.match(String(result?.error), /already running/)
    release?.()
    await first
  })

  test('stop clears timers and reports a clean drain', async () => {
    const { worker, sent, timers } = harness(async () => ({ checked: 1 }))
    worker.start()
    const result = await worker.stop({ reason: 'test' })
    assert.equal(result.drained, true)
    assert.equal(timers.timeouts.length, 0)
    assert.equal(timers.intervals.length, 0)
    assert.deepEqual(sent.filter(message => message.type === 'stopped').map(message => message.drained), [true])
    assert.equal(worker.stopping, true)
  })

  test('stop is idempotent', async () => {
    const { worker } = harness(async () => ({}))
    worker.start()
    await worker.stop({ reason: 'first' })
    const second = await worker.stop({ reason: 'second' })
    assert.equal(second.drained, true)
    assert.equal(second.alreadyStopping, true)
  })

  test('a shutdown message drains the worker', async () => {
    const { worker, sent } = harness(async () => ({}))
    worker.start()
    await worker.onMessage({ type: 'shutdown', reason: 'op_9', graceMs: 0 })
    assert.equal(worker.stopping, true)
    assert.ok(sent.some(message => message.type === 'stopped'))
  })
})
