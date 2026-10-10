import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { qualityGates, qualityGateSummary, BLOCK_IDS, DEGRADED_IDS, DEFAULT_QUALITY_GATES } from '../exec/qualityGates.mjs'

// =============================================================================
//  §35 Data Quality Gates — fail-closed block list + honest degraded list.
//  Pure, offline. The gate is the terminal display source of truth too.
// =============================================================================

// A healthy measured fact set — nothing blocks, nothing degrades.
const healthy = () => ({
  streamState: 'ok',
  quoteAgeMs: 2000,
  candleGapUnresolved: false,
  orderbookSeqInvalid: false,
  depthDependentFill: false,
  instrumentState: 'active',
  riskStateAvailable: true,
  fundingAgeMs: 1000,
  oiAgeMs: 1000,
  newsAvailable: true,
  secondaryProviderUp: true,
})

describe('qualityGates (§35)', () => {
  test('healthy facts -> allowed, no block, no degraded', () => {
    const q = qualityGates(healthy())
    assert.equal(q.allowed, true)
    assert.deepEqual(q.block, [])
    assert.deepEqual(q.degraded, [])
  })

  test('every §35.1 block condition refuses a new entry, named', () => {
    assert.match(qualityGates({ ...healthy(), streamState: 'disconnected' }).block.join(), /market_stream_disconnected/)
    assert.equal(qualityGates({ ...healthy(), streamState: 'disconnected' }).allowed, false)

    assert.equal(qualityGates({ ...healthy(), streamState: 'unknown' }).block.includes('market_stream_disconnected'), true) // fail-closed
    assert.equal(qualityGates({ ...healthy(), streamState: null }).block.includes('market_stream_disconnected'), true)

    assert.equal(qualityGates({ ...healthy(), quoteAgeMs: DEFAULT_QUALITY_GATES.quoteStaleMs + 1 }).block.includes('quote_stale'), true)
    assert.equal(qualityGates({ ...healthy(), quoteAgeMs: DEFAULT_QUALITY_GATES.quoteStaleMs }).block.length, 0) // at threshold is ok

    assert.equal(qualityGates({ ...healthy(), candleGapUnresolved: true }).block.includes('candle_gap_unresolved'), true)
    assert.equal(qualityGates({ ...healthy(), orderbookSeqInvalid: true, depthDependentFill: true }).block.includes('orderbook_sequence_invalid'), true)
    // an invalid sequence that is NOT depth-dependent must not block
    assert.equal(qualityGates({ ...healthy(), orderbookSeqInvalid: true, depthDependentFill: false }).block.length, 0)

    assert.equal(qualityGates({ ...healthy(), instrumentState: 'inactive' }).block.includes('instrument_not_active'), true)
    assert.equal(qualityGates({ ...healthy(), riskStateAvailable: false }).block.includes('risk_state_unavailable'), true)
    assert.equal(qualityGates({ ...healthy(), riskStateAvailable: null }).block.includes('risk_state_unavailable'), true) // unknown = unavailable
  })

  test('block ids match the §35.1 list; degraded ids match §35.2', () => {
    assert.deepEqual(BLOCK_IDS, [
      'market_stream_disconnected', 'quote_stale', 'candle_gap_unresolved',
      'orderbook_sequence_invalid', 'instrument_not_active', 'risk_state_unavailable',
    ])
    assert.deepEqual(DEGRADED_IDS, ['funding_stale', 'oi_delayed', 'news_unavailable', 'secondary_provider_unavailable'])
  })

  test('degraded conditions are reported but never block', () => {
    const q = qualityGates({
      ...healthy(),
      fundingAgeMs: 10 * 3600_000,
      oiAgeMs: 10 * 3600_000,
      newsAvailable: false,
      secondaryProviderUp: false,
    })
    assert.equal(q.allowed, true)
    assert.deepEqual(q.degraded, ['funding_stale', 'oi_delayed', 'news_unavailable', 'secondary_provider_unavailable'])
  })

  test('null optional feeds are honest: no samples -> no claim (neither ok nor degraded)', () => {
    const q = qualityGates({ ...healthy(), fundingAgeMs: null, oiAgeMs: null, newsAvailable: null, secondaryProviderUp: null })
    assert.equal(q.allowed, true)
    assert.deepEqual(q.degraded, [])
  })

  test('unmeasured quote age (null) does not auto-block — the quote path already failed', () => {
    assert.equal(qualityGates({ ...healthy(), quoteAgeMs: null }).block.includes('quote_stale'), false)
  })

  test('thresholds are overridable per call', () => {
    const strict = qualityGates({ ...healthy(), quoteAgeMs: 10_000, thresholds: { quoteStaleMs: 5_000 } })
    assert.equal(strict.block.includes('quote_stale'), true)
    const lax = qualityGates({ ...healthy(), quoteAgeMs: 10_000, thresholds: { quoteStaleMs: 600_000 } })
    assert.equal(lax.allowed, true)
  })

  test('qualityGateSummary is the terminal line for both tiers', () => {
    assert.equal(qualityGateSummary(qualityGates(healthy())), 'ok')
    assert.match(qualityGateSummary(qualityGates({ ...healthy(), riskStateAvailable: false })), /^BLOCK: risk_state_unavailable$/)
    assert.match(qualityGateSummary(qualityGates({ ...healthy(), newsAvailable: false })), /^degraded: news_unavailable$/)
    assert.match(
      qualityGateSummary(qualityGates({ ...healthy(), newsAvailable: false, riskStateAvailable: false })),
      /^BLOCK\(1\) \+ degraded\(1\)$/,
    )
    assert.equal(qualityGateSummary(null), 'unknown')
  })
})