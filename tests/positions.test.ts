import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCloseBody, validateModifyBody } from '../server/utils/positionActions'

// Transport-level contract of the two Phase 7P position routes. The DOMAIN
// rules (SL side, TP side, RISK_BUDGET, MIN_RR, qty bounds, halt) live in the
// risk gate and simulation core — exec/test-risk.mjs golden-tests those.
// These tests pin what the HTTP layer itself owns: shapes, types, and the
// "empty close body = full close" mapping.

describe('validateModifyBody (PATCH /positions/:id)', () => {
  test('accepts sl-only, tps-only and combined patches', () => {
    assert.deepEqual(validateModifyBody({ sl: 97 }).value, { sl: 97 })
    assert.deepEqual(validateModifyBody({ tps: [110, 120] }).value, { tps: [110, 120] })
    assert.deepEqual(validateModifyBody({ sl: 96, tps: [112] }).value, { sl: 96, tps: [112] })
  })

  test('rejects a missing / non-object body', () => {
    assert.equal(validateModifyBody(undefined).ok, false)
    assert.equal(validateModifyBody(null).ok, false)
    assert.equal(validateModifyBody('x').ok, false)
    assert.equal(validateModifyBody([1, 2]).ok, false)
  })

  test('rejects an empty patch (nothing to change)', () => {
    assert.equal(validateModifyBody({}).ok, false)
  })

  test('sl must be a real number (null / strings / NaN fail closed)', () => {
    assert.equal(validateModifyBody({ sl: null }).ok, false)
    assert.equal(validateModifyBody({ sl: '97' }).ok, false)
    assert.equal(validateModifyBody({ sl: Number.NaN }).ok, false)
    assert.equal(validateModifyBody({ sl: Number.POSITIVE_INFINITY }).ok, false)
    assert.equal(validateModifyBody({ sl: true }).ok, false)
  })

  test('tps must be an array of numbers, non-empty and capped', () => {
    assert.equal(validateModifyBody({ tps: 110 }).ok, false)
    assert.equal(validateModifyBody({ tps: [] }).ok, false)
    assert.equal(validateModifyBody({ tps: [110, 'x'] }).ok, false)
    assert.equal(validateModifyBody({ tps: [Number.NaN] }).ok, false)
    assert.equal(validateModifyBody({ tps: new Array(9).fill(110) }).ok, false) // > MAX_TPS
    assert.equal(validateModifyBody({ tps: new Array(8).fill(110) }).ok, true)
  })

  test('a valid sl patch still wins when tps is garbage (first flaw reported)', () => {
    const r = validateModifyBody({ sl: 97, tps: 'nope' })
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /tps must be an array/)
  })
})

describe('validateCloseBody (POST /positions/:id/close)', () => {
  test('no body / empty body = FULL close ({ pct: 100 })', () => {
    assert.deepEqual(validateCloseBody(undefined).value, { pct: 100 })
    assert.deepEqual(validateCloseBody(null).value, { pct: 100 })
    assert.deepEqual(validateCloseBody({}).value, { pct: 100 })
  })

  test('accepts qty-only and pct-only targets', () => {
    assert.deepEqual(validateCloseBody({ qty: 0.5 }).value, { qty: 0.5 })
    assert.deepEqual(validateCloseBody({ pct: 50 }).value, { pct: 50 })
  })

  test('passes qty AND pct through — the gate rejects it as AMBIGUOUS', () => {
    const r = validateCloseBody({ qty: 1, pct: 50 })
    assert.equal(r.ok, true)
    assert.deepEqual(r.value, { qty: 1, pct: 50 })
  })

  test('bounds (pct 0, pct 150, qty <= 0) belong to the gate, not transport', () => {
    // Transport only proves "a number was sent" — codes come back from
    // evaluatePartialClose (BAD_PCT / BAD_QTY / TOO_LARGE).
    assert.deepEqual(validateCloseBody({ pct: 0 }).value, { pct: 0 })
    assert.deepEqual(validateCloseBody({ pct: 150 }).value, { pct: 150 })
    assert.deepEqual(validateCloseBody({ qty: -1 }).value, { qty: -1 })
  })

  test('rejects non-object bodies and non-number fields', () => {
    assert.equal(validateCloseBody('x').ok, false)
    assert.equal(validateCloseBody([1]).ok, false)
    assert.equal(validateCloseBody({ qty: '1' }).ok, false)
    assert.equal(validateCloseBody({ pct: '50' }).ok, false)
    assert.equal(validateCloseBody({ qty: Number.NaN }).ok, false)
    assert.equal(validateCloseBody({ pct: null }).ok, false)
  })
})
