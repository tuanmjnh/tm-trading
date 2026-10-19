import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calendarEventIdFor,
  MACRO_CALENDAR_HORIZON_MS,
  MACRO_CALENDAR_MIN_SAMPLES,
  projectNextRelease,
  releaseCadence,
  toCalendarEvent,
} from '../engine/macro.mjs'
import { writeMacroCalendar } from '../services/macro.mjs'
import { listMacroCalendar, toPublicMacroCalendarEvent } from '../server/utils/macroCalendar'

// =============================================================================
//  Macro release calendar — V3.5 §60.7 / §60.16 Slice C.
//
//  Offline: the projection is a PURE function of observed publication times, the
//  writer runs with injected models, and the read path is exercised with a fake
//  Mongo model. The point of every test here is the same: a cadence estimate must
//  be labelled as an estimate and must never invent a consensus or a date.
// =============================================================================

const DAY = 86400 * 1000
const T0 = Date.parse('2026-10-05T12:00:00Z')
/** Monthly publications: the 12th of each month, 00:00Z. */
const monthly = (n: number, startISO = '2026-01-12') => {
  const out: string[] = []
  const base = Date.parse(`${startISO}T00:00:00Z`)
  for (let i = 0; i < n; i++) {
    const d = new Date(base)
    d.setUTCMonth(d.getUTCMonth() + i)
    out.push(d.toISOString())
  }
  return out
}

describe('releaseCadence — how the source actually publishes', () => {
  test('monthly publications are recognised, and the median resists one irregular gap', () => {
    const c = releaseCadence(monthly(6))!
    assert.equal(c.samples, 6)
    assert.equal(c.cadence, 'monthly')
    assert.ok(c.gapDays >= 28 && c.gapDays <= 31, `unexpected gap ${c.gapDays}`)
    assert.equal(c.irregular, false)
  })

  test('weekly cadence and a single publication', () => {
    const weekly = Array.from({ length: 5 }, (_, i) => new Date(Date.parse('2026-06-05T00:00:00Z') + i * 7 * DAY).toISOString())
    assert.equal(releaseCadence(weekly)!.cadence, 'weekly')
    assert.equal(releaseCadence(['2026-06-05T00:00:00Z']), null, 'one data point is not a cadence')
    assert.equal(releaseCadence([]), null)
    assert.equal(releaseCadence([null, undefined, 'nonsense'] as never), null)
  })

  test('duplicate publication days collapse (a re-published vintage is not a new release)', () => {
    const dupes = ['2026-01-12T00:00:00Z', '2026-01-12T09:30:00Z', '2026-02-12T00:00:00Z', '2026-03-12T00:00:00Z']
    assert.equal(releaseCadence(dupes)!.samples, 3)
  })
})

describe('projectNextRelease — a projection, labelled as one', () => {
  test('projects the next publication and reports its evidence', () => {
    const p = projectNextRelease({ seriesId: 'CPIAUCSL', name: 'CPI', vintages: monthly(5, '2026-05-12'), nowMs: T0 })!
    assert.equal(p.projected, true)
    assert.equal(p.method, 'cadence')
    assert.equal(p.cadence, 'monthly')
    assert.equal(p.confidence, 'low', 'five samples is still a low-confidence guess')
    const at = new Date(p.scheduledAt).getTime()
    assert.ok(at > T0, 'a projection must be forward-looking')
    assert.equal(p.refPeriod, new Date(at).toISOString().slice(0, 10))
  })

  test('refuses to project without enough history or from a date already past', () => {
    assert.equal(projectNextRelease({ seriesId: 'X', vintages: monthly(2), nowMs: T0 }), null)
    // The last publication plus a monthly gap is already behind `now`.
    assert.equal(projectNextRelease({ seriesId: 'X', vintages: monthly(5, '2025-01-12'), nowMs: T0 }), null)
  })

  test('refuses to project beyond the horizon (a distant guess is not a schedule)', () => {
    assert.equal(projectNextRelease({ seriesId: 'X', vintages: monthly(5, '2026-05-12'), nowMs: T0, horizonMs: DAY }), null)
    assert.ok(MACRO_CALENDAR_HORIZON_MS >= 30 * DAY)
    assert.equal(MACRO_CALENDAR_MIN_SAMPLES, 3)
  })
})

describe('toCalendarEvent — honest calendar rows', () => {
  const series = { seriesId: 'PAYEMS', name: 'Nonfarm Payrolls', unit: 'thousands', frequency: 'm', marketGroup: 'macro_cb', sourceId: 'fred' }
  const projection = projectNextRelease({ seriesId: 'PAYEMS', name: series.name, vintages: monthly(6, '2026-04-12'), nowMs: T0 })!

  test('carries the previous value with its own provenance and a NULL consensus', () => {
    const doc = toCalendarEvent({
      series,
      projection,
      previous: { value: 158_000, sourceId: 'fred', vintageAt: '2026-09-12T00:00:00Z' },
      nowMs: T0,
    })!
    assert.equal(doc.seriesId, 'PAYEMS')
    assert.equal(doc.kind, 'macro_release')
    assert.equal(doc.importance, 'high', 'a monthly release is a high-importance event')
    assert.equal(doc.status, 'scheduled')
    assert.equal(doc.projected, true)
    assert.equal(doc.projection.cadence, 'monthly')
    assert.equal(doc.previous.value, 158_000)
    assert.equal(doc.previous.sourceId, 'fred')
    // No licensed consensus source exists: an empty one is honest, an invented one is not.
    assert.equal(doc.consensus.value, null)
    assert.equal(doc.actual.value, null)
    assert.equal(doc._id, calendarEventIdFor('PAYEMS', projection.refPeriod, new Date(projection.scheduledAt).getTime()))
    assert.match(doc.title, /Nonfarm Payrolls/)
  })

  test('a projection without a previous row still produces a valid, honest doc', () => {
    const doc = toCalendarEvent({ series, projection, previous: null, nowMs: T0 })!
    assert.equal(doc.previous.value, null)
    assert.equal(toCalendarEvent({ series, projection: null as never }), null)
  })
})

describe('writeMacroCalendar — wired to observed vintages', () => {
  const fakeCal = () => {
    const docs = new Map<string, Record<string, any>>()
    return {
      docs,
      async updateOne(filter: Record<string, any>, update: Record<string, any>) {
        const id = String(filter._id)
        if (docs.has(id)) return { acknowledged: true }
        docs.set(id, update.$setOnInsert)
        return { acknowledged: true, upsertedCount: 1, upsertedId: id }
      },
    }
  }
  const fakeObs = (bySeries: Record<string, string[]>) => ({
    find: (q: Record<string, any>) => ({
      sort: () => ({
        limit: () => ({
          lean: async () =>
            (bySeries[q.seriesId] ?? []).slice(0, 8).map((v) => ({
              seriesId: q.seriesId,
              value: 100,
              sourceId: 'fred',
              vintageAt: new Date(v),
            })),
        }),
      }),
    }),
  })

  test('writes one projected row per series with enough observations', async () => {
    const CalendarModel = fakeCal()
    const Obs = fakeObs({
      CPIAUCSL: monthly(5, '2026-05-12'),
      PAYEMS: monthly(4, '2026-06-12'),
      DGS10: ['2026-10-01T00:00:00Z'], // daily series with one observation: no projection
    })
    const inserted = await writeMacroCalendar({
      Obs,
      Series: { find: () => ({ lean: async () => [{ seriesId: 'CPIAUCSL', name: 'CPI', marketGroup: 'macro_cb' }] }) },
      now: new Date(T0),
      deps: { CalendarModel },
    })
    assert.equal(inserted, 2)
    assert.equal(CalendarModel.docs.size, 2)
    for (const doc of CalendarModel.docs.values()) {
      assert.equal(doc.projected, true, 'nothing here is an official schedule')
      assert.equal(doc.consensus.value, null)
      assert.ok(doc.scheduledAt.getTime() > T0)
    }
  })

  test('a re-run inserts nothing new (deterministic ids) and never overwrites an official row', async () => {
    const CalendarModel = fakeCal()
    const Obs = fakeObs({ CPIAUCSL: monthly(5, '2026-05-12') })
    const opts = { Obs, now: new Date(T0), deps: { CalendarModel } }
    assert.equal(await writeMacroCalendar(opts), 1)
    assert.equal(await writeMacroCalendar(opts), 0, 'the same month is the same row')
    assert.equal(CalendarModel.docs.size, 1)
  })

  test('fail-soft: a broken calendar model returns 0 instead of breaking the macro run', async () => {
    const CalendarModel = { updateOne: async () => { throw new Error('mongo down') } }
    const inserted = await writeMacroCalendar({
      Obs: fakeObs({ CPIAUCSL: monthly(5, '2026-05-12') }),
      now: new Date(T0),
      deps: { CalendarModel },
    })
    assert.equal(inserted, 0)
    assert.equal(await writeMacroCalendar({ Obs: null as never, now: new Date(T0), deps: { CalendarModel } }), 0)
  })
})

describe('calendar reads — allowlisted and fail-soft', () => {
  const row = {
    _id: 'CPIAUCSL|2026-11-12|2026-11-12T00:00:00.000Z',
    seriesId: 'CPIAUCSL',
    title: 'Consumer Price Index — 2026-11-12',
    kind: 'macro_release',
    importance: 'high',
    scheduledAt: new Date('2026-11-12T00:00:00Z'),
    refPeriod: '2026-11-12',
    status: 'scheduled',
    projected: true,
    projection: { method: 'cadence', cadence: 'monthly', samples: 6, confidence: 'medium' },
    previous: { value: 3.1, sourceId: 'fred', vintageAt: new Date('2026-10-12T00:00:00Z') },
    consensus: { value: null, sourceId: null, vintageAt: null },
    actual: { value: null },
    sourceId: 'fred',
  }

  test('the public projection exposes the projection evidence and NULL consensus', () => {
    const p = toPublicMacroCalendarEvent(row)
    assert.equal(p.projected, true)
    assert.equal(p.projectionMethod, 'cadence')
    assert.equal(p.projectionSamples, 6)
    assert.equal(p.projectionConfidence, 'medium')
    assert.equal(p.previous.value, 3.1)
    assert.equal(p.consensus, null, 'no consensus source -> null, never 0')
    assert.equal(p.actual, null)
    assert.equal(Object.keys(p).includes('projection'), false, 'internal field name must not leak')
  })

  const model = {
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) }),
    countDocuments: async () => 1,
  }

  test('list returns rows with an honest meta block', async () => {
    const r = await listMacroCalendar({ limit: 10, deps: { MacroCalendarEventModel: model } })
    assert.equal(r.events.length, 1)
    assert.deepEqual(
      { mongo: r.meta.mongo, total: r.meta.total, projected: r.meta.projected },
      { mongo: 'up', total: 1, projected: 1 },
    )
  })

  test('Mongo down is reported, never rendered as an empty schedule', async () => {
    const r = await listMacroCalendar({ limit: 10, deps: { MacroCalendarEventModel: null } })
    assert.equal(r.meta.mongo, 'down')
    assert.deepEqual(r.events, [])
  })
})
