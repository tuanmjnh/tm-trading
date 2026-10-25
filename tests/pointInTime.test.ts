import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PIT_SCHEMA_VERSION,
  PIT_VIOLATION_CODES,
  pitAudit,
  pitLimitation
} from '../engine/pointInTime.mjs'
import { evidenceSufficiency } from '../engine/evidence.mjs'

// =============================================================================
//  Phase F — strict point-in-time control.
//
//  The audit proves that every record falls inside the cut-off the evidence
//  claims, and names the ones that do not. It cannot prove an honest clock — it
//  can prove a leak, which is what acceptance needs.
// =============================================================================

const T0 = 1_790_000_000_000
const cutoff = T0 + 3_600_000

type Row = Record<string, any>

const bundleOf = (over: Row = {}): Row => ({
  setId: 'ev_paper-session_ses_1',
  sessionId: 'ses_1',
  kind: 'paper-session',
  sealed: true,
  pointInTime: { frozenAt: cutoff, sessionStartedAt: T0, sessionStoppedAt: cutoff },
  trades: [
    { key: 'pos_1', entryTime: T0 + 1000, exitTime: T0 + 2000 },
  ],
  ...over,
})

const journalOf = (over: Row = {}): Row => ({ key: 'j1_a', entryTime: new Date(T0 + 1000), exitTime: new Date(T0 + 2000), ...over })
const newsOf = (over: Row = {}): Row => ({ setId: 'nv_1', asOf: new Date(T0 + 500), ...over })

describe('point-in-time audit', () => {
  test('a clean graph passes and reports its cut-off', () => {
    const a = pitAudit({ bundle: bundleOf(), journal: [journalOf()], news: [newsOf()] })
    assert.equal(a.schema, PIT_SCHEMA_VERSION)
    assert.equal(a.ok, true)
    assert.equal(a.blocking, false)
    assert.equal(a.cutoff, cutoff)
    assert.equal(a.counts.trades, 1)
    assert.equal(a.maxRecordTs, T0 + 2000)
    assert.deepEqual(a.violations, [])
  })

  test('a trade that exits after the freeze is a leak', () => {
    const a = pitAudit({ bundle: bundleOf({ trades: [{ key: 'pos_future', entryTime: T0 + 1000, exitTime: cutoff + 1 }] }) })
    assert.equal(a.ok, false)
    assert.equal(a.blocking, true)
    assert.deepEqual(a.violations.map((v) => v.code), ['EXIT_AFTER_CUTOFF'])
    assert.equal(a.violations[0].recordId, 'pos_future')
  })

  test('journal rows are audited separately from trades', () => {
    const a = pitAudit({ bundle: bundleOf(), journal: [journalOf({ exitTime: new Date(cutoff + 60_000) })] })
    assert.deepEqual(a.violations.map((v) => v.code), ['JOURNAL_EXIT_AFTER_CUTOFF'])
    assert.equal(a.violations[0].recordId, 'j1_a')
  })

  test('news without an as-of time cannot be proven point-in-time', () => {
    const a = pitAudit({ bundle: bundleOf(), news: [newsOf({ asOf: null })] })
    assert.deepEqual(a.violations.map((v) => v.code), ['NEWS_NO_ASOF'])
  })

  test('news published after the cut-off is a leak', () => {
    const a = pitAudit({ bundle: bundleOf(), news: [newsOf({ asOf: new Date(cutoff + 1) })] })
    assert.deepEqual(a.violations.map((v) => v.code), ['NEWS_AFTER_CUTOFF'])
  })

  test('no cut-off at all is a violation, not an implicit pass', () => {
    const a = pitAudit({ bundle: { trades: [] } })
    assert.deepEqual(a.violations.map((v) => v.code), ['NO_CUTOFF'])
    assert.equal(a.cutoff, null)
  })

  test('an unsealed source has no point-in-time verdict', () => {
    const a = pitAudit({ bundle: bundleOf({ sealed: false }) })
    assert.ok(a.violations.some((v) => v.code === 'SOURCE_NOT_SEALED'))
    assert.equal(a.ok, false)
    const lax = pitAudit({ bundle: bundleOf({ sealed: false }), strict: false })
    assert.equal(lax.ok, false)
    assert.equal(lax.blocking, false)
  })

  test('codes are a closed set and the limitation names them', () => {
    const a = pitAudit({ bundle: bundleOf({ sealed: false, pointInTime: null }), news: [newsOf({ asOf: null })] })
    for (const v of a.violations) assert.ok(PIT_VIOLATION_CODES.includes(v.code as never))
    const limit = pitLimitation(a)
    assert.ok(limit && limit.startsWith('point-in-time:'))
    assert.equal(pitLimitation(pitAudit({ bundle: bundleOf() })), null)
  })

  test('a leaking set is not sufficient, however many trades it has', () => {
    const doc = {
      sealed: true,
      metrics: { sufficient: true, trades: 50 },
      trades: Array.from({ length: 50 }, (_, i) => ({ key: `p${i}`, entryTime: T0, exitTime: T0 + i })),
      pointInTime: { frozenAt: cutoff },
    }
    const pit = pitAudit({ bundle: doc })
    const s = evidenceSufficiency(doc, { pit })
    assert.equal(s.sufficient, true) // no leak in this fixture
    const leaky = { ...doc, trades: [...doc.trades, { key: 'p_future', entryTime: T0, exitTime: cutoff + 5 }] }
    const s2 = evidenceSufficiency(leaky, { pit: pitAudit({ bundle: leaky }) })
    assert.equal(s2.sufficient, false)
    assert.ok(s2.reasons.some((r) => r.includes('point-in-time violations: EXIT_AFTER_CUTOFF')))
  })
})
