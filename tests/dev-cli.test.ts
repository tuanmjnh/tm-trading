import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  catalogSummary,
  digestEvents,
  indicatorSelfTest,
  parseArgs,
  syntheticBars
} from '../tools/dev.mjs'
import { createReplayPlayer, normalizeReplayBars } from '../simulation/replay.mjs'
import { INDICATORS } from '../engine/indicators.mjs'

// =============================================================================
//  Roadmap §44 — the developer CLI (`tools/dev.mjs`). The network/Mongo
//  commands need live infra, so this suite locks the PURE core they are built
//  on: argument parsing, the catalog rollup, the indicator self-test contract
//  and the replay determinism digest. A CLI that computes a wrong digest would
//  silently break the §42.5 reproducibility guarantee, so it is tested here.
// =============================================================================

describe('dev-cli / parseArgs', () => {
  it('parses --key=value', () => {
    assert.deepEqual(parseArgs(['--symbol=BTCUSDT', '--timeframe=1m']).flags, { symbol: 'BTCUSDT', timeframe: '1m' })
  })

  it('parses --key value and boolean --flag', () => {
    const { flags } = parseArgs(['--seconds', '30', '--json'])
    assert.equal(flags.seconds, '30')
    assert.equal(flags.json, true)
  })

  it('keeps positionals and treats a trailing flag as boolean', () => {
    const { positionals, flags } = parseArgs(['market:once', '--json'])
    assert.deepEqual(positionals, ['market:once'])
    assert.equal(flags.json, true)
  })

  it('does not swallow a following flag as a value', () => {
    const { flags } = parseArgs(['--verbose', '--json'])
    assert.equal(flags.verbose, true)
    assert.equal(flags.json, true)
  })
})

describe('dev-cli / catalogSummary', () => {
  it('rolls instruments up by type, status and venue', () => {
    const s = catalogSummary([
      { id: 'a', type: 'perp', status: 'active', venues: [{ venue: 'binance' }, { venue: 'bybit' }] },
      { id: 'b', type: 'spot', status: 'active', venues: [{ venue: 'binance' }] }
    ])
    assert.equal(s.total, 2)
    assert.deepEqual(s.byType, { perp: 1, spot: 1 })
    assert.deepEqual(s.byStatus, { active: 2 })
    assert.deepEqual(s.byVenue, { binance: 2, bybit: 1 })
  })

  it('is empty-safe', () => {
    assert.deepEqual(catalogSummary([]), { total: 0, byType: {}, byStatus: {}, byVenue: {} })
  })
})

describe('dev-cli / syntheticBars', () => {
  it('produces a deterministic, finite OHLCV series', () => {
    const a = syntheticBars(20)
    const b = syntheticBars(20)
    assert.equal(a.length, 20)
    assert.deepEqual(a, b)
    for (const bar of a) {
      for (const k of ['open', 'high', 'low', 'close', 'volume'] as const) {
        assert.ok(Number.isFinite(bar[k]), `${k} finite`)
      }
      assert.ok(bar.high >= Math.max(bar.open, bar.close))
      assert.ok(bar.low <= Math.min(bar.open, bar.close))
    }
  })
})

describe('dev-cli / indicatorSelfTest', () => {
  it('passes the whole registry with uniquely-keyed, aligned outputs', () => {
    const res = indicatorSelfTest()
    assert.equal(res.total, INDICATORS.length)
    assert.equal(res.fail, 0, JSON.stringify(res.results.filter((r) => !r.ok)))
    assert.equal(res.pass, res.total)
  })

  it('can scope to a single indicator', () => {
    const res = indicatorSelfTest({ only: 'sma' })
    assert.equal(res.total, 1)
    assert.equal(res.results[0].id, 'sma')
  })
})

describe('dev-cli / replay determinism', () => {
  const rows = syntheticBars(40).map((b) => ({ ...b, state: 'closed', symbol: 'BTCUSDT', timeframe: '1m' }))

  it('digest is stable and order-independent after normalization', () => {
    const normalized = normalizeReplayBars(rows)
    const shuffled = normalizeReplayBars([...rows].reverse())
    assert.equal(digestEvents(normalized), digestEvents(shuffled))
  })

  it('a full replay digests identically to the input bars', () => {
    const normalized = normalizeReplayBars(rows)
    const player = createReplayPlayer({ symbol: 'BTCUSDT', timeframe: '1m', bars: normalized })
    const emitted: unknown[] = []
    let chunk = player.step(1000)
    while (chunk.length > 0) {
      emitted.push(...chunk)
      chunk = player.step(1000)
    }
    assert.equal(emitted.length, normalized.length)
    assert.equal(digestEvents(emitted), digestEvents(normalized))
  })
})
