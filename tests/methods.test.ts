import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFLUENCE_WEIGHTS,
  explainConfluence,
  methodEventsFromBars,
  summarizeLeague,
  toEngineBars,
  type MethodPluginLike
} from '../server/utils/methods'

/** Deterministic synthetic bars (60 bars, fixed OHLCV). */
function makeBars(n = 60): { time: number; open: number; high: number; low: number; close: number; volume: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100_000 + i * 1000
    return { time: 1_700_000_000_000 + i * 60_000, open: base, high: base + 500, low: base - 500, close: base + (i % 2 ? -300 : 300), volume: 20 + (i % 7) }
  })
}

function makePlugin(id: string, events: { bar: number; type: string }[], scores: number[]): MethodPluginLike {
  return {
    id,
    name: `Method ${id}`,
    defaults: { foo: 1 },
    version: `v:${id}`,
    analyze: () => ({ events, scores })
  }
}

describe('method event mapping (server/utils/methods)', () => {
  test('maps analyze() output to method/version/reasons/score/snapshot', () => {
    const bars = makeBars()
    const plugin = makePlugin('pa', [{ bar: 3, type: 'PIN LONG' }, { bar: 9, type: 'BOS SHORT' }], [0, 0, 0, 0.7, 0, 0, 0, 0, 0, -0.5])
    const { events, ran } = methodEventsFromBars(bars, ['pa'], [plugin])

    assert.deepEqual(ran, ['pa'])
    assert.equal(events.length, 2)
    assert.equal(events[0]!.method, 'pa')
    assert.equal(events[0]!.version, 'v:pa')
    assert.equal(events[0]!.bar, 3)
    assert.equal(events[0]!.time, Math.floor(bars[3]!.time / 1000))
    assert.equal(events[0]!.score, 0.7)
    assert.equal(events[0]!.price, bars[3]!.close)
    assert.deepEqual(events[0]!.reasons, ['PIN LONG'])
    assert.equal(events[0]!.snapshot.time, new Date(bars[3]!.time).toISOString())
    assert.equal(events[0]!.snapshot.close, bars[3]!.close)
    assert.equal(events[1]!.score, -0.5)
    assert.equal(events[1]!.type, 'BOS SHORT')
  })

  test('drops score-0 confirmation events by default, keeps them when requested', () => {
    const bars = makeBars()
    const plugin = makePlugin('pa', [{ bar: 1, type: 'INSIDE' }, { bar: 2, type: 'PIN LONG' }], [0, 0, 0.7])
    const neutral = methodEventsFromBars(bars, ['pa'], [plugin])
    assert.equal(neutral.events.length, 1)
    assert.equal(neutral.events[0]!.type, 'PIN LONG')

    const all = methodEventsFromBars(bars, ['pa'], [plugin], { skipNeutral: false })
    assert.equal(all.events.length, 2)
  })

  test('skips out-of-range event bars and sorts by time ascending', () => {
    const bars = makeBars()
    const plugin = makePlugin('pa', [{ bar: 999, type: 'BOS LONG' }, { bar: 5, type: 'ENG SHORT' }, { bar: 2, type: 'PIN LONG' }], [0, 0, 0.6, 0, 0, -0.4])
    const { events } = methodEventsFromBars(bars, ['pa'], [plugin])
    assert.equal(events.length, 2)
    assert.deepEqual(events.map((e) => e.bar), [2, 5])
  })

  test('unknown method ids are skipped without failing the group', () => {
    const bars = makeBars()
    const plugin = makePlugin('trend', [{ bar: 1, type: 'PULL LONG' }], [0, 0.5])
    const { events, ran } = methodEventsFromBars(bars, ['missing', 'trend'], [plugin])
    assert.deepEqual(ran, ['trend'])
    assert.equal(events.length, 1)
  })

  test('toEngineBars maps openTime to time and drops malformed rows', () => {
    const bars = toEngineBars([
      { openTime: 1, open: 1, high: 2, low: 0, close: 1.5, volume: 10 },
      { openTime: 2, open: 1, high: 2, low: 0, close: 1.5, volume: 10 },
      { openTime: 3, open: 'x', high: 2, low: 0, close: 1.5, volume: 10 }
    ])
    assert.equal(bars.length, 2)
    assert.equal(bars[0]!.time, 1)
    assert.equal(bars[1]!.time, 2)
  })
})

describe('league snapshot normalization', () => {
  test('maps poolOut + rows into the MethodLeague shape', () => {
    const league = summarizeLeague({
      generatedAt: '2026-10-04T03:00:00Z',
      engineVersion: '42',
      symbols: ['BTCUSDT', 'ETHUSDT'],
      tfs: ['60', '15'],
      poolOut: [
        { id: 'price-action', name: 'PA', trades: 337, open: 3, winRate: 0.338, profitFactor: 0.8, netPct: -12.4, expectancy: -0.11 }
      ],
      rows: [
        {
          method: 'price-action',
          symbol: 'BTCUSDT',
          tf: '60',
          bars: 1000,
          row: { trades: 40, closed: 39, winRate: 0.33, profitFactor: 0.9, netPct: -3, maxDrawdownPct: 8, noFill: 0, replaced: 0 }
        }
      ]
    })
    assert.equal(league.generatedAt, '2026-10-04T03:00:00Z')
    assert.equal(league.methods.length, 1)
    assert.deepEqual(league.methods[0], { id: 'price-action', name: 'PA', trades: 337, open: 3, winRate: 0.338, profitFactor: 0.8, netPct: -12.4, expectancy: -0.11 })
    assert.equal(league.rows.length, 1)
    assert.equal(league.rows[0]!.trades, 40)
    assert.equal(league.rows[0]!.maxDrawdownPct, 8)
  })

  test('fails soft on an empty / partial payload', () => {
    const empty = summarizeLeague({})
    assert.equal(empty.methods.length, 0)
    assert.equal(empty.rows.length, 0)
    assert.equal(empty.symbols.length, 0)
  })
})

describe('confluence explanation', () => {
  test('builds weighted transparent parts from an intel doc', () => {
    const detail = explainConfluence({
      symbol: 'BTCUSDT',
      score: 0.32,
      parts: { method: 0.5, regime: 0.3, funding: -0.1, zone: 0.2 },
      rank: 1,
      tf: '60',
      bars: 150,
      src: 'mover',
      ts: '2026-10-04T03:00:00Z'
    })
    assert.equal(detail.symbol, 'BTCUSDT')
    assert.equal(detail.score, 0.32)
    assert.equal(detail.parts.length, 4)
    assert.equal(detail.parts[0]!.key, 'method')
    assert.equal(detail.parts[0]!.weight, CONFLUENCE_WEIGHTS.method)
    assert.equal(detail.parts[0]!.contribution, Number((0.5 * 0.4).toFixed(4)))
  })

  test('notes follow the score sign per part', () => {
    const d = explainConfluence({ symbols: '' as never, symbol: 'X', score: 0, parts: { method: 0.5, regime: 0, funding: -0.2, zone: -0.4 }, rank: 0, tf: '60', bars: 0, src: '', ts: '' } as any)
    const byKey = Object.fromEntries(d.parts.map((p) => [p.key, p.note]))
    assert.match(byKey.method!, /buy-side/)
    assert.match(byKey.funding!, /crowded long/)
    assert.match(byKey.zone!, /cascade/)
  })

  test('handles missing parts defensively', () => {
    const d = explainConfluence({ symbol: 'X', score: 0, parts: {} as any, rank: 0, tf: '', bars: 0, src: '', ts: '' })
    assert.equal(d.parts.length, 4)
    for (const p of d.parts) assert.equal(p.value, 0)
  })
})