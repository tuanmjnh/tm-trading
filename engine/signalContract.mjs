#!/usr/bin/env node
// =============================================================================
//  TM TRADING - SIGNAL IDENTITY & ATTRIBUTION CONTRACT  (roadmap §61.17 Phase D)
//
//  WHY THIS FILE EXISTS: a signal only means something if you know which method
//  produced it, at which version, with which parameter set, on which engine.
//  Rows in the `signals` collection carry none of that today (see
//  docs/web-app/system-integration-map.md). This module defines the *identity*
//  of a signal before anything is written to the database.
//
//  PURE CONTRACT (no mongoose, no DB): the engine layer (backtest, replay) and
//  the persistence layer both agree on "the same signal" through this single
//  definition. Editing this file changes the identity of every stored signal.
//
//  WHY THE KEY MUST BE STABLE: same bar -> same event -> same `signalKey`. That
//  is what lets a replay/retry of the same fixture avoid writing a second row
//  (`$setOnInsert` at the store layer). We use `stableStringify` (keys sorted at
//  every level), never a raw `JSON.stringify`.
// =============================================================================

import { createHash } from 'node:crypto'

import { stableStringify } from './version.mjs'

/** Version of this contract. Any shape/semantic change bumps this. */
export const SIGNAL_CONTRACT_VERSION = '1'

/**
 * Signal event vocabulary. MUST match the `SIGNAL_TYPES` enum in
 * `engine/models/signal.mjs`; the match is pinned by tests/signalContract.test.ts
 * (this file deliberately does not import the model, keeping the engine layer
 * free of mongoose).
 *
 * SAR/EMA reversal events use the SAME vocabulary as every other entry signal:
 * 'SAR FLIP LONG' is emitted as-is only by method consumers that read raw
 * events; the signal layer maps direction to 'ST LONG'/'ST SHORT'
 * (see signalEngine EVENT_DIRECTION and botMethodDriver's dir→type mapping).
 */
export const SIGNAL_EVENT_TYPES = Object.freeze(['SV', 'BC', 'ST LONG', 'ST SHORT', 'NS', 'ND', 'EoM'])

export function isSignalEventType(type) {
  return SIGNAL_EVENT_TYPES.includes(type)
}

/** Required attribution fields. */
const REQUIRED_ATTR = ['method', 'methodVersion', 'strategyVersion', 'engineVersion', 'paramsHash']

/**
 * Normalize the list of indicators used: keep only `{ id, version }` and sort by
 * `id`, so declaration order never changes a signal's identity.
 */
export function normalizeIndicatorRefs(list) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw new TypeError('indicatorRefs must be an array')
  return list
    .map((r, i) => {
      if (!r || typeof r.id !== 'string' || r.id === '') {
        throw new Error(`indicatorRefs[${i}].id must be a non-empty string`)
      }
      if (typeof r.version !== 'string' || r.version === '') {
        throw new Error(`indicatorRefs[${i}].version must be a non-empty string`)
      }
      return { id: r.id, version: r.version }
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Full attribution of a signal. A missing required field THROWS — a signal that
 * cannot be traced must never be written silently.
 *
 * @returns {{method:string, methodVersion:string, strategyVersion:string,
 *            engineVersion:string, paramsHash:string, indicatorRefs:{id:string,version:string}[]}}
 */
export function signalAttribution(input = {}) {
  const a = {
    method: input.method,
    methodVersion: input.methodVersion,
    strategyVersion: input.strategyVersion,
    engineVersion: input.engineVersion,
    paramsHash: input.paramsHash,
    indicatorRefs: normalizeIndicatorRefs(input.indicatorRefs),
  }
  const missing = REQUIRED_ATTR.filter((k) => typeof a[k] !== 'string' || a[k] === '')
  if (missing.length) throw new Error(`signal attribution missing: ${missing.join(', ')}`)
  return a
}

/**
 * STABLE identity key of a signal. It covers exactly the fields that identify
 * the event: symbol + tf + bar time + type + method + strategyVersion.
 *
 * It deliberately excludes `price`: recalculating the same bar yields the same
 * price, and any tiny drift still describes the SAME signal — price is payload,
 * not identity.
 *
 * `ownerId` is included only when present (same rule as `alertKey`): signals
 * from before tenancy (or without an owner) keep their old key.
 */
export function signalKeyFor({ symbol, tf, ts, type, method, strategyVersion, ownerId } = {}) {
  if (!isSignalEventType(type)) {
    throw new Error(`signalKeyFor: invalid type (${JSON.stringify(type)})`)
  }
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) throw new Error(`signalKeyFor: invalid ts (${JSON.stringify(ts)})`)

  const canon = {
    symbol: String(symbol ?? ''),
    tf: String(tf ?? ''),
    ts: d.toISOString(),
    type: String(type),
    method: String(method ?? ''),
    strategyVersion: String(strategyVersion ?? ''),
    ...(typeof ownerId === 'string' && ownerId.length > 0 ? { ownerId } : {}),
  }
  return 'sig_' + createHash('sha256').update(stableStringify(canon)).digest('hex').slice(0, 40)
}

/**
 * Build a normalized signal document (not yet persisted). Validates type, ts and
 * attribution, and derives `signalKey`.
 *
 * @returns {{signalKey:string, schemaVersion:string, ts:Date, symbol:string,
 *            tf:string, type:string, price:number|null, ownerId:string|null,
 *            accountId:string|null, attribution:object, meta:object|null}}
 */
export function signalDoc(input = {}) {
  const type = input.type
  if (!isSignalEventType(type)) {
    throw new Error(`signalDoc: invalid type (${JSON.stringify(type)})`)
  }
  const ts = input.ts instanceof Date ? input.ts : new Date(input.ts)
  if (Number.isNaN(ts.getTime())) throw new Error(`signalDoc: invalid ts (${JSON.stringify(input.ts)})`)

  const attribution = signalAttribution(input.attribution ?? input)
  const price = input.price === undefined || input.price === null ? null : Number(input.price)
  if (price !== null && !Number.isFinite(price)) {
    throw new Error(`signalDoc: invalid price (${JSON.stringify(input.price)})`)
  }

  const symbol = String(input.symbol ?? '')
  const tf = String(input.tf ?? '')

  return {
    signalKey: signalKeyFor({
      symbol,
      tf,
      ts,
      type,
      method: attribution.method,
      strategyVersion: attribution.strategyVersion,
      ownerId: input.ownerId,
    }),
    schemaVersion: SIGNAL_CONTRACT_VERSION,
    ts,
    symbol,
    tf,
    type,
    price,
    ownerId: typeof input.ownerId === 'string' && input.ownerId.length > 0 ? input.ownerId : null,
    accountId: typeof input.accountId === 'string' && input.accountId.length > 0 ? input.accountId : null,
    attribution,
    meta: input.meta ?? null,
  }
}
