import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestRun, TestRunError, testRunHttpError } from '../server/utils/testRuns'

// =============================================================================
//  startTestRun — POST /api/v1/runs (roadmap §58.9 Slice 3). The engine core is
//  injected so this stays offline: we prove the REQUEST is validated + normalized
//  with the engine's own helpers (normalizeSymbol/normalizeTf/buildParams) and
//  that the D1 manifest is echoed for the deep-link. Never a fabricated result.
// =============================================================================

const METHODS = async () => ['vsa', 'priceAction']

function fakeEngine(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown>[] = []
  const runOne = async (o: Record<string, unknown>) => {
    calls.push(o)
    return {
      symbol: o.display,
      tf: o.tf,
      summary: {
        engineVersion: '0.4.0',
        paramsHash: 'h'.repeat(12),
        trades: 12,
        winRate: 0.42,
        netPct: 3.1,
        maxDrawdownPct: -1.5,
        profitFactor: 1.7
      },
      bars: 4321,
      source: 'test-fixture',
      runId: 'run-abc',
      warnings: ['multipleRuns'],
      ...overrides
    }
  }
  return { runOne, calls }
}

describe('startTestRun (POST /api/v1/runs — §58.9 Slice 3)', () => {
  test('happy path returns the D1 manifest and a deep-link seriesId', async () => {
    const eng = fakeEngine()
    const res = await startTestRun(
      { symbol: 'BTCUSDT', tf: '15m', method: 'vsa' },
      { runOne: eng.runOne, methods: METHODS }
    )

    assert.equal(res.symbol, 'BTCUSDT.P', 'fapi display suffix applied by the engine')
    assert.equal(res.tf, '15', 'normalizeTf("15m") -> engine tf code')
    assert.equal(res.market, 'fapi')
    assert.equal(res.method, 'vsa')
    assert.equal(res.preset, null)
    assert.equal(res.engineVersion, '0.4.0')
    assert.equal(res.paramsHash, 'h'.repeat(12))
    assert.equal(res.runId, 'run-abc')
    assert.equal(res.bars, 4321)
    assert.equal(res.source, 'test-fixture')
    assert.deepEqual(res.warnings, ['multipleRuns'])
    assert.equal(res.stats.trades, 12)
    assert.ok(res.seriesId.includes('BTCUSDT.P'), 'seriesId carries the display symbol')
    assert.ok(res.seriesId.includes('h'.repeat(12)), 'seriesId carries the paramsHash')

    assert.equal(eng.calls.length, 1)
    const o = eng.calls[0]!
    assert.equal(o.api, 'BTCUSDT', 'order symbol has no display suffix')
    assert.equal(o.tf, '15')
    assert.equal(o.market, 'fapi')
    assert.equal(o.method, 'vsa')
    assert.equal(o.limit, 5000)
    assert.equal(o.refresh, false)
  })

  test('applies defaults and clamps the bar limit', async () => {
    const eng = fakeEngine()
    await startTestRun({ symbol: 'ethusdt', tf: '1h' }, { runOne: eng.runOne, methods: METHODS })
    assert.equal(eng.calls[0]!.method, 'vsa')
    assert.equal(eng.calls[0]!.market, 'fapi')
    assert.equal(eng.calls[0]!.tf, '60', 'normalizeTf("1h") -> "60"')
    assert.equal(eng.calls[0]!.api, 'ETHUSDT')
    assert.equal(eng.calls[0]!.limit, 5000)

    const eng2 = fakeEngine()
    await startTestRun({ symbol: 'BTCUSDT', tf: '5m', limit: 999_999 }, { runOne: eng2.runOne, methods: METHODS })
    assert.equal(eng2.calls[0]!.limit, 20000, 'clamped to the engine ceiling')
  })

  test('rejects missing/invalid fields with 400', async () => {
    const cases: Array<[Record<string, unknown>]> = [[{}], [{ tf: '15m' }], [{ symbol: 'BTCUSDT' }], [{ symbol: 'BTCUSDT', tf: '15m', limit: -3 }]]
    for (const [body] of cases) {
      await assert.rejects(
        () => startTestRun(body, { runOne: fakeEngine().runOne, methods: METHODS }),
        (e: unknown) => e instanceof TestRunError && e.statusCode === 400 && e.statusMessage === 'invalid_field'
      )
    }
  })

  test('rejects an unknown method and an unsupported market with 400', async () => {
    await assert.rejects(
      () => startTestRun({ symbol: 'BTCUSDT', tf: '15m', method: 'nope' }, { runOne: fakeEngine().runOne, methods: METHODS }),
      (e: unknown) => e instanceof TestRunError && e.statusCode === 400 && e.statusMessage === 'unknown_method'
    )
    await assert.rejects(
      () => startTestRun({ symbol: 'BTCUSDT', tf: '15m', market: 'margin' }, { runOne: fakeEngine().runOne, methods: METHODS }),
      (e: unknown) => e instanceof TestRunError && e.statusCode === 400 && e.statusMessage === 'invalid_market'
    )
  })

  test('maps an engine failure to 502 (bad gateway), not 400', async () => {
    const runOne = async () => {
      throw new Error('upstream 418')
    }
    await assert.rejects(
      () => startTestRun({ symbol: 'BTCUSDT', tf: '15m' }, { runOne, methods: METHODS }),
      (e: unknown) => e instanceof TestRunError && e.statusCode === 502 && e.statusMessage === 'run_failed'
    )
  })

  test('testRunHttpError preserves the status intent', () => {
    const mapped = testRunHttpError(new TestRunError('bad', 400, 'invalid_field')) as {
      statusCode: number
      statusMessage: string
    }
    assert.equal(mapped.statusCode, 400)
    assert.equal(mapped.statusMessage, 'invalid_field')

    const fallback = testRunHttpError(new Error('boom')) as { statusCode: number }
    assert.equal(fallback.statusCode, 500)
  })
})
