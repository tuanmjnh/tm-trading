#!/usr/bin/env node
// =============================================================================
//  TM TRADING — THE LIVE VERSION STAMP (roadmap D1 / Phase 13 item 3)
//
//  WHAT THIS FILE EXISTS FOR: D1 says every stored result carries
//  `engineVersion` + `paramsHash`. The backtest side has obeyed since Phase 3
//  (`engine/version.mjs`). The LIVE side did not: `exec/risk.mjs recordOpen()`
//  wrote `paramsHash: null`, so every executed trade came out as
//  `unknown#unknown` and `engine/preset-drift.mjs` could only answer "cannot
//  compare". This module is the single place that decides what a live trade's
//  identity IS, so the writer and the reader cannot drift apart.
//
//  THREE RULES, and why each one is a rule:
//
//   1. ONE HASHING SCHEME. `paramsHash` here is `engine/version.mjs`'s
//      `paramsHash()` — never a local sha256 of a hand-built string. Two hashing
//      schemes mean two configs that ARE the same hash differently, i.e. preset
//      drift compares a preset against itself and reports a permanent gap.
//
//   2. THE LIVE PRESET IS DECLARED, NEVER GUESSED. The engine cannot discover
//      what parameters TradingView was actually running when the fill happened.
//      Falling back to the engine `DEFAULTS` would produce a confident stamp for
//      a configuration nobody verified, and a wrong stamp is WORSE than a missing
//      one: `unknown` is excludable, a wrong hash silently buckets live trades
//      against a backtest of a different preset. With no declaration the position
//      is stamped `unknown` (stampUnknown) and preset-drift excludes it.
//
//   3. `exitReason` IS RECORDED WHERE THE DECISION IS MADE. Only the exit path
//      knows whether a trade ended at `kind: 'tp'` or `kind: 'sl'`. Deriving it
//      later from prices is a heuristic (a gap fill lands on no level, so the old
//      journal had to say `unknown`). The executor knows exactly; so it says it.
//
//  Pure by construction: no IO, no clock, no Mongo, no process.env read inside the
//  pure functions (the resolver takes `env` as an argument). `engine/version.mjs`
//  is the only import, and it is install-free — so `exec/risk.mjs` and every test
//  can use this without pulling in a database or a network client.
// =============================================================================
import { readFileSync } from 'node:fs'

import { ENGINE_VERSION, canonicalParams, paramsHash } from './version.mjs'

/** Why a live position actually closed. NOT derivable later — recorded on the spot. */
export const EXIT_KINDS = Object.freeze(['tp', 'sl', 'time', 'manual', 'unknown'])

/** Environment names that declare the live preset (documented in docs/data-model.md §10.3.1). */
export const LIVE_PRESET_ENV = 'PAPER_LIVE_PRESET'
export const LIVE_PARAMS_ENV = 'PAPER_LIVE_PARAMS'

const str = (v) => (v === null || v === undefined || v === '' ? null : String(v))

/**
 * `exitReason` string for one exit. `source` names WHO decided (`alert` = the
 * trading platform's event, `data` = our own bar scan), `kind` says WHY.
 * The two parts are kept together because "tp" alone does not say whether we
 * trusted an external event or scanned klines ourselves.
 *
 * An unknown `kind` is NOT promoted to a real one: it becomes `unknown`, which is
 * the honest value and is what `preset-drift`/`journal` already treat as "not
 * derived" instead of a result.
 *
 * @param {'alert'|'data'|'manual'|string} source
 * @param {string} kind
 * @returns {string} e.g. 'data:tp', 'alert:STOP_LOSS', 'manual', 'unknown'
 */
export function exitReasonOf(source, kind) {
  if (source === 'manual') return 'manual'
  const k = str(kind)
  if (source === 'alert') {
    // Alerts carry TradingView's own action names (STOP_LOSS / TAKE_PROFIT /
    // TIME_CLOSE). They are passed through in upper case so the journal's
    // `deriveResult` contract (it matches ':TP'/':SL'/TAKE_PROFIT/...) holds.
    return k ? `alert:${k.toUpperCase()}` : 'unknown'
  }
  if (source === 'data') {
    const kk = k.toLowerCase()
    return EXIT_KINDS.includes(kk) && kk !== 'unknown' ? `data:${kk}` : 'unknown'
  }
  return 'unknown'
}

/** `findFirstExit()` result -> exitReason. A null result means NOTHING was decided. */
export function exitReasonFromHit(hit) {
  if (!hit || (hit.kind !== 'tp' && hit.kind !== 'sl')) return 'unknown'
  return exitReasonOf('data', hit.kind)
}

/**
 * Resolve the LIVE preset declaration into the stamp half that identifies the
 * CONFIGURATION (the engine half, `engineVersion`, is always known).
 *
 * Order (docs/data-model.md §10.3.1):
 *   1. `PAPER_LIVE_PRESET`  — an already-computed paramsHash. Trusted verbatim:
 *      the live path cannot recompute the hash of parameters it was not given,
 *      and this is how an operator pins live trades to a backtest run's preset.
 *   2. `PAPER_LIVE_PARAMS`  — the parameter set itself, as JSON or as a path to a
 *      JSON file. Canonicalised + hashed by `version.mjs`, so it can never drift
 *      from the backtest side. An `engineVersion` key inside it names the
 *      GENERATION the trade belongs to (a preset can be re-run on a new engine)
 *      and is removed before hashing — it is not an engine parameter and
 *      `canonicalParams` would reject it.
 *   3. Neither -> `{ paramsHash: null, params: null, kind: 'unknown' }`. Not a
 *      fallback to DEFAULTS (see rule 2 in the header).
 *
 * @param {object} [env]         environment (defaults to process.env)
 * @param {Function} [readFile]  file reader, injected so tests need no disk
 * @returns {{paramsHash:string|null, params:object|null, engineVersion:string|null, kind:'declared'|'unknown', since:string}}
 */
export function resolveLivePreset(env = process.env, readFile = readFileSync) {
  const declared = str(env?.[LIVE_PRESET_ENV])
  if (declared) {
    return { paramsHash: declared, params: null, engineVersion: null, kind: 'declared', since: null }
  }
  const raw = str(env?.[LIVE_PARAMS_ENV])
  if (!raw) {
    return { paramsHash: null, params: null, engineVersion: null, kind: 'unknown', since: null }
  }
  // JSON inline first (a value that starts with '{' is never a file name), then a
  // path. Both failures THROW: a declaration that cannot be read must stop the
  // caller (fail closed) instead of silently producing an unstamped trade.
  let text = raw
  if (!raw.trimStart().startsWith('{')) {
    try {
      text = String(readFile(raw, 'utf8'))
    } catch (e) {
      throw new Error(`live preset: cannot read ${LIVE_PARAMS_ENV} file "${raw}": ${e?.message || e}`)
    }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new Error(`live preset: ${LIVE_PARAMS_ENV} is not valid JSON: ${e?.message || e}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`live preset: ${LIVE_PARAMS_ENV} must be a JSON object of engine parameters`)
  }
  const engineVersion = str(parsed.engineVersion)
  const params = { ...parsed }
  delete params.engineVersion // generation, not a parameter (see above)
  return {
    paramsHash: paramsHash(params), // canonicalParams inside: DEFAULTS merged, keys sorted, schema-coerced
    params: canonicalParams(params),
    engineVersion,
    kind: 'declared',
    since: null,
  }
}

/**
 * The version stamp of one LIVE position. `engineVersion` is ALWAYS present (the
 * engine that filled the order is known even when the preset is not); the
 * `paramsHash`/`params` half is null exactly when nothing was declared.
 *
 * `since` is stamped at WRITE time by the caller (this module has no clock):
 * a position is a point-in-time declaration, and it must be possible to see
 * WHICH declaration produced it after the operator changes `.env`.
 *
 * @returns {{engineVersion:string, paramsHash:string|null, params:object|null, kind:'declared'|'unknown', since:string|null}}
 */
export function liveStamp({ env = process.env, readFile = readFileSync, engineVersion = null, since = null } = {}) {
  const preset = resolveLivePreset(env, readFile)
  return {
    engineVersion: str(engineVersion) ?? preset.engineVersion ?? ENGINE_VERSION,
    paramsHash: preset.paramsHash,
    params: preset.params,
    kind: preset.kind,
    since: since ?? preset.since ?? null,
  }
}

/**
 * Canonical `positions` write payload for one OPEN order.
 *
 * This function exists so the write path is TESTABLE without a database: it is
 * pure, so a test can assert exactly what `recordOpen()` persists (the old defect
 * — `paramsHash: null` — was invisible precisely because it lived inside an IO
 * function nobody could call without Mongo).
 *
 * @param {object} input
 * @param {Date|string} [input.now]  write instant (injected: no clock in this module)
 * @throws when a stamp value that is present does not match its own parameters
 *         (same check as `engine/store.mjs withStamp` for runs: a mismatched hash
 *         is a lie, and a lie is worse than a missing stamp)
 */
export function buildPositionDoc(input = {}) {
  // `now`/`alertKey` are CALL INPUTS, not stored fields: `alertKey` is projected
  // onto `signalKey` (the stored identity) and `now` onto `entryTime`, so neither
  // leaks into the document as a duplicate key.
  const {
    now = null, stamp = null, alertKey = null, ...rest
  } = input
  const {
    source = 'paper', sl = null, tps = [], tf = null, externalId = null, method = 'vsa',
  } = rest
  const at = now ? new Date(now) : new Date()
  const s = stamp ?? liveStamp()
  // A declared pair (hash + params together) must agree. Without params there is
  // nothing to verify against, so a bare hash is trusted (see resolveLivePreset).
  if (s.paramsHash && s.params) {
    const expected = paramsHash(s.params)
    if (expected !== s.paramsHash) {
      throw new Error(
        `stamp paramsHash does not match stamp params (declared ${s.paramsHash}, hash of params ${expected}) — refusing to write a stamp that cannot be reproduced`,
      )
    }
  }
  const params = s.params ?? null
  const hash = s.paramsHash ?? (params ? paramsHash(params) : null)
  const known = !!(hash && s.kind !== 'unknown')
  return {
    // Spread first so every caller field is carried through, then the fields this
    // function is responsible for (the stamp + the two write-time defaults).
    ...rest,
    source,
    externalId,
    sl,
    tps,
    tf,
    entryTime: at,
    status: 'open',
    method,
    signalKey: alertKey,
    stamp: {
      engineVersion: str(s.engineVersion) ?? ENGINE_VERSION,
      paramsHash: known ? String(hash) : null,
      params: params ?? null,
      kind: known ? 'declared' : 'unknown',
      since: (s.since ? new Date(s.since) : at).toISOString(), // D2: UTC instant of the declaration
    },
    // Undeclared rows are marked, not hidden: D1 consumers exclude them
    // (engine/preset-drift.mjs) instead of reading "no preset" as "some preset".
    stampUnknown: !known,
  }
}

/**
 * True when a position (or a row projected from one) carries NO usable version
 * stamp. Deliberately true for ALL of these shapes:
 *   - a legacy doc with no `stamp` sub-document at all,
 *   - a doc written by an undeclared live path (`stamp.kind === 'unknown'`,
 *     `stamp.paramsHash === null`, `stampUnknown: true`),
 *   - a journal/metric row whose halves are the literal `unknown` sentinel
 *     (`engine/journal.mjs UNKNOWN` / `metricRow`) — 'unknown' is an EXPLICIT
 *     "not derivable", so it must never be read as a stamp value; a row with
 *     `engineVersion: '0.5.0'` but `paramsHash: 'unknown'` is just as
 *     uncomparable as one with no stamp at all (D1: both halves or neither).
 * Used by `preset-drift` to exclude such rows from every bucket, and by tests to
 * state the legacy rule in one place.
 */
export function isStampUnknown(row) {
  if (!row || typeof row !== 'object') return true
  if (row.stampUnknown === true) return true
  const s = row.stamp && typeof row.stamp === 'object' ? row.stamp : null
  const version = str(s?.engineVersion) ?? str(row.engineVersion)
  const hash = str(s?.paramsHash) ?? str(row.paramsHash)
  const usable = (v) => v !== null && v !== 'unknown'
  return !usable(version) || !usable(hash)
}
