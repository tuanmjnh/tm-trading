import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dirTone,
  driftTone,
  flowTone,
  fmtPct,
  fmtQty,
  fmtSigned,
  fmtUtcTime,
  fundingCountdown,
  fundingTone,
  haltTone,
  methodParamEntries,
  mongoTone,
  oiTrendTone,
  pnlTone,
  regimeTone,
  sideTone,
  signalTone
} from '../app/utils/terminal'

describe('terminal tone mapping', () => {
  test('signalTone maps alert statuses', () => {
    assert.equal(signalTone('received'), 'info')
    assert.equal(signalTone('forwarded'), 'success')
    assert.equal(signalTone('opened'), 'success')
    assert.equal(signalTone('rejected'), 'error')
    assert.equal(signalTone('closed'), 'neutral')
    assert.equal(signalTone('something-else'), 'neutral')
    assert.equal(signalTone(''), 'neutral')
  })

  test('sideTone maps buy/sell/long/short case-insensitively', () => {
    assert.equal(sideTone('buy'), 'success')
    assert.equal(sideTone('LONG'), 'success')
    assert.equal(sideTone('sell'), 'error')
    assert.equal(sideTone('Short'), 'error')
    assert.equal(sideTone('hold'), 'neutral')
    assert.equal(sideTone(null), 'neutral')
    assert.equal(sideTone(undefined), 'neutral')
  })

  test('dirTone: 1 = long (success), -1 = short (error)', () => {
    assert.equal(dirTone(1), 'success')
    assert.equal(dirTone(-1), 'error')
    // defensive: any other value renders as long-toned
    assert.equal(dirTone(0), 'success')
  })

  test('pnlTone by sign, null/zero/NaN = neutral', () => {
    assert.equal(pnlTone(1.5), 'success')
    assert.equal(pnlTone(-0.25), 'error')
    assert.equal(pnlTone(0), 'neutral')
    assert.equal(pnlTone(null), 'neutral')
    assert.equal(pnlTone(undefined), 'neutral')
    assert.equal(pnlTone(NaN), 'neutral')
  })

  test('haltTone / mongoTone / driftTone', () => {
    assert.equal(haltTone(false), 'success')
    assert.equal(haltTone(true), 'error')
    assert.equal(mongoTone('up'), 'success')
    assert.equal(mongoTone('down'), 'warning')
    assert.equal(mongoTone(undefined), 'success')
    assert.equal(driftTone(null), 'neutral')
    assert.equal(driftTone({ lastCheckAt: 'x', breach: false, windowH: 24, checked: 5, diverged: 0 }), 'success')
    assert.equal(driftTone({ lastCheckAt: 'x', breach: true, windowH: 24, checked: 5, diverged: 2 }), 'error')
  })

  test('regimeTone: alt = success, btc = warning, else neutral', () => {
    assert.equal(regimeTone('alt'), 'success')
    assert.equal(regimeTone('btc'), 'warning')
    assert.equal(regimeTone('neutral'), 'neutral')
    assert.equal(regimeTone('something'), 'neutral')
    assert.equal(regimeTone(null), 'neutral')
    assert.equal(regimeTone(undefined), 'neutral')
  })

  test('fundingTone: elevated positive = warning, negative = info, near zero = neutral', () => {
    assert.equal(fundingTone(0.05), 'warning')
    assert.equal(fundingTone(0.01), 'warning')
    assert.equal(fundingTone(0.009), 'neutral')
    assert.equal(fundingTone(-0.03), 'info')
    assert.equal(fundingTone(-0.01), 'info')
    assert.equal(fundingTone(0), 'neutral')
    assert.equal(fundingTone(null), 'neutral')
    assert.equal(fundingTone(NaN), 'neutral')
  })

  test('oiTrendTone: |pct| < 0.5 neutral, rise = warning, fall = info', () => {
    assert.equal(oiTrendTone(0.4), 'neutral')
    assert.equal(oiTrendTone(1.2), 'warning')
    assert.equal(oiTrendTone(-2.4), 'info')
    assert.equal(oiTrendTone(null), 'neutral')
    assert.equal(oiTrendTone(NaN), 'neutral')
  })

  test('flowTone: buy/sell/vol tones, else neutral', () => {
    assert.equal(flowTone('buy'), 'success')
    assert.equal(flowTone('sell'), 'error')
    assert.equal(flowTone('vol'), 'warning')
    assert.equal(flowTone('mixed'), 'neutral')
    assert.equal(flowTone(''), 'neutral')
    assert.equal(flowTone(null), 'neutral')
  })

  test('fundingCountdown renders h/m labels from ms diff', () => {
    const now = 1_700_000_000_000
    assert.equal(fundingCountdown(now + (2 * 3_600_000 + 13 * 60_000), now), '2h 13m')
    assert.equal(fundingCountdown(now + 13 * 60_000, now), '13m')
    assert.equal(fundingCountdown(now + 59_999, now), '0m')
    assert.equal(fundingCountdown(now, now), 'now')
    assert.equal(fundingCountdown(now - 5000, now), 'now')
    assert.equal(fundingCountdown(null, now), '—')
    assert.equal(fundingCountdown(NaN, now), '—')
  })
})

describe('terminal formatters', () => {
  test('fmtSigned keeps + sign and avoids -0.00', () => {
    assert.equal(fmtSigned(1.2), '+1.20')
    assert.equal(fmtSigned(-0.35), '-0.35')
    assert.equal(fmtSigned(0), '0.00')
    assert.equal(fmtSigned(-0.0001, 2), '0.00')
    assert.equal(fmtSigned(null), '—')
    assert.equal(fmtSigned(NaN), '—')
    assert.equal(fmtSigned(1.23456, 4), '+1.2346')
  })

  test('fmtPct appends % via fmtSigned', () => {
    assert.equal(fmtPct(0.42), '+0.42%')
    assert.equal(fmtPct(-1.5), '-1.50%')
    assert.equal(fmtPct(null), '—')
  })

  test('fmtUtcTime renders UTC HH:mm:ss, rejects garbage', () => {
    assert.equal(fmtUtcTime('2026-10-07T04:22:03.205Z'), '04:22:03')
    assert.equal(fmtUtcTime('not-a-date'), '—')
    assert.equal(fmtUtcTime(null), '—')
    assert.equal(fmtUtcTime(undefined), '—')
  })

  test('fmtQty caps at 6 dp and trims zeros', () => {
    assert.equal(fmtQty(0.2018680054530201), '0.201868')
    assert.equal(fmtQty(2), '2')
    assert.equal(fmtQty(0.5), '0.5')
    assert.equal(fmtQty(null), '—')
    assert.equal(fmtQty(Number.NaN), '—')
  })

  test('methodParamEntries slices + formats values', () => {
    const entries = methodParamEntries(
      { length: 20, ratio: 1.5, on: true, note: 'x', deep: { a: 1 }, skipped: 1 },
      4
    )
    assert.deepEqual(entries, [
      ['length', '20'],
      ['ratio', '1.5'],
      ['on', 'true'],
      ['note', 'x']
    ])
    assert.deepEqual(methodParamEntries(null), [])
    assert.deepEqual(methodParamEntries(undefined), [])
    assert.deepEqual(methodParamEntries({ a: 1, b: 2 }, 8).length, 2)
  })
})
