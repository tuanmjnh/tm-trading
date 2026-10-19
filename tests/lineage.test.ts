import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLineageRows,
  lineageStrategyIds,
  type LeanVersionRow,
} from '../server/utils/lineage'

// =============================================================================
//  Run -> strategy-version lineage shaping (roadmap §58.9 Slice 3). Pure logic,
//  no Mongo — the endpoint injects lean rows; every fallback rule is locked here.
// =============================================================================

const RUN = '0.5.0~BTCUSDT.P~15~87ad386ceb1957831c292e67020d0a1632497bfbc6089f2960bd47819b487887'
const OTHER_RUN = '0.5.0~BTCUSDT.P~15~deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

function v(over: Partial<LeanVersionRow> = {}): LeanVersionRow {
  return { _id: 'oid1', strategyVersionId: 'sv1', strategyId: 'st1', ...over }
}

describe('lineage shaping (server/utils/lineage.ts)', () => {
  test('lineageStrategyIds returns distinct, non-empty ids', () => {
    const rows = [
      v({ strategyId: 'st1' }),
      v({ strategyId: 'st1' }),
      v({ strategyId: 'st2' }),
      v({ strategyId: undefined }),
      v({ strategyId: '' }),
    ]
    assert.deepEqual(lineageStrategyIds(rows), ['st1', 'st2'])
  })

  test('backtest/holdout flags resolve against the canonical run id', () => {
    const rows = [
      v({ _id: 'a', strategyVersionId: 'sv-a', backtestRunId: RUN }),
      v({ _id: 'b', strategyVersionId: 'sv-b', holdoutRunId: RUN }),
      v({ _id: 'c', strategyVersionId: 'sv-c', backtestRunId: OTHER_RUN, holdoutRunId: OTHER_RUN }),
    ]
    const out = buildLineageRows(rows, RUN)
    assert.equal(out[0].backtest, true)
    assert.equal(out[0].holdout, false)
    assert.equal(out[1].backtest, false)
    assert.equal(out[1].holdout, true)
    // A version pointing at a different run is not lineage for this run.
    assert.deepEqual([out[2].backtest, out[2].holdout], [false, false])
  })

  test('strategyVersionId falls back to _id when absent', () => {
    const rows = [v({ strategyVersionId: undefined, _id: 'fallback-oid' })]
    assert.equal(buildLineageRows(rows, RUN)[0].strategyVersionId, 'fallback-oid')
  })

  test('profile names are cosmetic: missing profile -> nulls, never throws', () => {
    const rows = [v({ strategyId: 'st-missing' })]
    const out = buildLineageRows(rows, RUN, {})
    assert.equal(out[0].profileName, null)
    assert.equal(out[0].profileStatus, null)
  })

  test('profile join resolves name + status by strategyId', () => {
    const rows = [v({ strategyId: 'st1' })]
    const profiles = { st1: { name: 'VSA Core', status: 'enabled' } }
    const out = buildLineageRows(rows, RUN, profiles)
    assert.equal(out[0].profileName, 'VSA Core')
    assert.equal(out[0].profileStatus, 'enabled')
  })

  test('nullable scalar fields default to null, not undefined', () => {
    // strategyId stays populated (from the base row); every other optional
    // scalar must default to null — never undefined — when absent.
    const rows = [v({ version: undefined, status: undefined, engineVersion: undefined, paramsHash: undefined, createdAt: undefined })]
    const out = buildLineageRows(rows, RUN)[0]
    assert.equal(out.strategyId, 'st1')
    for (const k of ['version', 'status', 'engineVersion', 'paramsHash', 'profileName', 'profileStatus', 'createdAt'] as const) {
      assert.equal(out[k], null, `${k} should be null`)
    }
  })

  test('maps a realistic row end-to-end', () => {
    const rows: LeanVersionRow[] = [{
      _id: 'oid9',
      strategyVersionId: 'tm-vsa-core@1.4.0',
      strategyId: 'st-vsa',
      version: '1.4.0',
      status: 'stable_paper',
      engineVersion: '0.5.0',
      paramsHash: '87ad386c',
      backtestRunId: RUN,
      holdoutRunId: null,
      createdAt: 1727000000000,
    }]
    const out = buildLineageRows(rows, RUN, { 'st-vsa': { name: 'VSA Core', status: 'enabled' } })
    assert.deepEqual(out[0], {
      strategyVersionId: 'tm-vsa-core@1.4.0',
      strategyId: 'st-vsa',
      version: '1.4.0',
      status: 'stable_paper',
      engineVersion: '0.5.0',
      paramsHash: '87ad386c',
      backtest: true,
      holdout: false,
      profileName: 'VSA Core',
      profileStatus: 'enabled',
      createdAt: 1727000000000,
    })
  })
})
