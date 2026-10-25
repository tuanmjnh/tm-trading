#!/usr/bin/env node
// =============================================================================
//  TM TRADING - NATIVE SIGNAL GENERATOR  (roadmap §61.17 Phase D)
//
//  Turns "market data -> indicator -> strategy -> signal" into ONE pure
//  function. It does NOT run its own indicator math: it calls the
//  `analyze(bars, opts)` method contract in `engine/methods/` — the SAME
//  contract the backtester (`engine/backtest.mjs`) and replay already use — so
//  "same bar, same event" is not a promise made by hand.
//
//  Output are attributed signal documents (see engine/signalContract.mjs): every
//  event carries traceable method/indicator/strategy/engine versions plus a
//  deterministic `signalKey`, so re-emitting does not create a second row.
//
//  PURE (no DB). The store (services/signalStore.mjs, D3) is what performs the
//  `$setOnInsert`.
// =============================================================================

import { ENGINE_VERSION, hashOf, paramsHash, PARAM_SCHEMA } from './version.mjs'
import { INTERFACE_VERSION, METHOD_CONTRACT, getMethod } from './methods/index.mjs'
// Only to register the methods into the registry (see methods/all.mjs — it
// cannot live in index.mjs because that would create an import cycle). Same
// approach as backtest.mjs.
import './methods/all.mjs'
import { SIGNAL_CONTRACT_VERSION, isSignalEventType, signalDoc, signalAttribution } from './signalContract.mjs'

/** Version of the generator. Any change to event->signal mapping bumps this. */
export const SIGNAL_ENGINE_VERSION = '1'

/** Direction of an event, when it is an entry point. */
export const EVENT_DIRECTION = Object.freeze({ 'ST LONG': 1, 'ST SHORT': -1 })

/**
 * Fingerprint of the whole signal-generation stack: contract + generator +
 * method interface. A signal written under a different fingerprint was produced
 * by a different version — handy for detecting drift without reading each field.
 */
export function signalEngineFingerprint() {
  return (
    'sigfp_' +
    hashOf({
      contract: SIGNAL_CONTRACT_VERSION,
      engine: SIGNAL_ENGINE_VERSION,
      interface: INTERFACE_VERSION,
    }).slice(0, 16)
  )
}

/** Find the setup (order plan) for an event, matching bar and direction when known. */
function setupForEvent(setups, type, bar) {
  const wantDir = EVENT_DIRECTION[type]
  return setups.find((s) => s.bar === bar && (wantDir === undefined || s.dir === wantDir)) ?? null
}

/**
 * paramsHash using the METHOD's own defaults when the parameter set carries
 * names outside the global PARAM_SCHEMA (wonderwhales/priceAction declare their
 * own vocabulary, which VSA-schema canonicalParams would reject — league.mjs
 * had to fall back to hashOf for the same reason). version.mjs keeps the VSA
 * schema as the global default, so every hash stored before this change stays
 * reproducible, and parameter sets fully inside the VSA schema hash byte-
 * identically to the old `paramsHash(params)` — only previously-throwing sets
 * change behaviour.
 */
function methodParamsHash(params, methodDefaults) {
  const p = params && typeof params === 'object' ? params : {}
  const foreign = Object.keys(p).filter((k) => !(k in PARAM_SCHEMA))
  if (foreign.length === 0 || !methodDefaults) return paramsHash(p)
  return paramsHash(p, methodDefaults)
}

/**
 * Generate attributed signals from a bar series.
 *
 * @param {object} input
 * @param {{time:number|Date,open:number,high:number,low:number,close:number,volume:number}[]} input.bars
 * @param {string|{id:string,analyze:Function}} input.method  registered method id or plugin
 * @param {object} [input.params]   method parameters (canonicalized for the hash)
 * @param {string} input.symbol
 * @param {string} input.tf
 * @param {string|null} [input.ownerId]
 * @param {string|null} [input.accountId]
 * @param {string} [input.strategyVersion]  defaults to `${methodId}@${INTERFACE_VERSION}`
 * @param {string} [input.engineVersion]
 * @param {{id:string,version:string}[]} [input.indicatorRefs]
 * @returns {object[]} signal documents, in event order (as the backtest confirms)
 */
export function generateSignals({
  bars,
  method,
  params = {},
  symbol,
  tf,
  ownerId = null,
  accountId = null,
  strategyVersion,
  engineVersion,
  indicatorRefs = [],
} = {}) {
  if (!Array.isArray(bars) || bars.length === 0) {
    throw new Error('generateSignals: bars must be a non-empty array')
  }
  const m = typeof method === 'string' ? getMethod(method) : method
  if (!m || typeof m.analyze !== 'function') {
    throw new Error('generateSignals: missing a valid method (pass an id or a plugin with analyze())')
  }

  // analyze() is responsible for canonicalizing params (see methods/vsa.mjs runVsa).
  const an = m.analyze(bars, params)
  for (const k of METHOD_CONTRACT.analyzeReturns) {
    if (an?.[k] === undefined) throw new Error(`generateSignals: method.analyze() is missing field "${k}"`)
  }

  const attribution = signalAttribution({
    method: m.id,
    methodVersion: String(INTERFACE_VERSION),
    strategyVersion: strategyVersion ?? `${m.id}@${INTERFACE_VERSION}`,
    engineVersion: engineVersion ?? ENGINE_VERSION,
    paramsHash: methodParamsHash(an.params ?? params, m.defaults),
    indicatorRefs,
  })

  return an.events.map((e) => {
    // Methods may emit their own event vocabulary (wonderwhales 'SAR FLIP LONG',
    // ...). eventSignalType is an OPTIONAL plugin field mapping it onto the
    // shared signal vocabulary; without a mapping the type must already be one
    // of SIGNAL_EVENT_TYPES, exactly as before.
    const mapped = m.eventSignalType?.[e.type]
    const type = mapped ?? e.type
    if (!isSignalEventType(type)) {
      throw new Error(`generateSignals: method returned an invalid event type (${JSON.stringify(e.type)})`)
    }
    const bar = bars[e.bar]
    if (!bar) throw new Error(`generateSignals: event points to bar ${e.bar} out of range`)
    const setup = setupForEvent(an.setups ?? [], type, e.bar)
    return signalDoc({
      symbol,
      tf,
      ts: bar.time,
      type,
      price: bar.close ?? null,
      ownerId,
      accountId,
      attribution,
      meta: {
        bar: e.bar,
        eventType: e.type,
        dir: setup ? setup.dir : (EVENT_DIRECTION[type] ?? null),
        entry: setup ? setup.entry : null,
        sl: setup ? setup.sl : null,
        tp: setup ? setup.tp : null,
      },
    })
  })
}
