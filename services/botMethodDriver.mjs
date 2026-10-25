// =============================================================================
//  TM TRADING - LIVE METHOD DRIVER (roadmap §61.17 Phase E2, integration map
//  "Candle -> method evaluation" gap closer)
//
//  WHAT: for each RUNNING bot instance, feed CLOSED candles of its symbol+tf
//  into its method's analyze(), and publish entry setups at the newest closed
//  bar as NATIVE signals (signalContract identity + D4 idempotent upsert).
//
//  THEN: the existing bridge (botSignalBridge.mjs) picks those signals up via
//  its cursor and turns them into `source:'bot'` alerts — the paper executor
//  stays the ONLY order path (D7). This module never touches orders.
//
//  WHY ONLY THE LAST CLOSED BAR: a bot trades fresh information. Older bars
//  are history (already priced in or skipped); publishing them would flood a
//  newly launched bot with stale entries. signalKey is deterministic per bar,
//  so re-evaluating the same bar is a no-op (D4), never a duplicate.
//
//  FAIL-SOFT: any error is returned as a code — a broken vendor fetch or a
//  bad method must never crash the supervisor tick.
// =============================================================================

import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { fetchKlines, TF_MS } from '../engine/data.mjs'
import { ENGINE_VERSION } from '../engine/version.mjs'
import { signalDoc } from '../engine/signalContract.mjs'
import { StrategyVersion } from '../engine/models/strategyVersion.mjs'

// Module-relative root — immune to process.cwd() differences (CLI vs Nitro).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const cwd = ROOT

/** Cached side-effect loader: registers every engine method. */
let methodsReady = null
async function ensureMethods() {
  if (!methodsReady) {
    await import(pathToFileURL(join(cwd, 'engine', 'methods', 'all.mjs')).href)
    methodsReady = await import(pathToFileURL(join(cwd, 'engine', 'methods', 'index.mjs')).href)
  }
  return methodsReady
}

const apiSymbol = (s) => (String(s ?? '').endsWith('.P') ? String(s).slice(0, -2) : String(s ?? ''))

/**
 * Evaluate one RUNNING instance's method on closed candles and publish fresh
 * entry signals.
 *
 * @param {object} input
 * @param {object} input.instance   bot instance (lean) — needs state 'running',
 *   strategyVersionId, instruments[0], timeframes[0], ownerId
 * @param {object} input.models     { StrategyVersion } (engine/models)
 * @param {number} [input.now]
 * @param {Function} [input.fetchImpl]  injectable klines fetcher (tests)
 * @param {number} [input.limit]        candle warmup (default 400)
 * @returns {Promise<{ok:boolean, code?:string, published:number,
 *   method:string|null, evaluatedBar:number|null, error?:string}>}
 */
export async function evaluateInstanceSignals({ instance, models, now = Date.now(), fetchImpl, limit = 400 } = {}) {
  const fail = (code, error) => ({ ok: false, code, published: 0, method: null, evaluatedBar: null, error })
  if (!instance?.instanceId || !instance?.ownerId) return fail('missing_instance')
  if (instance.state !== 'running') return fail('not_running')

  const symbol = String(instance.instruments?.[0] ?? '').trim()
  const tf = String(instance.timeframes?.[0] ?? '').trim()
  const strategyVersionId = String(instance.strategyVersionId ?? '')
  if (!symbol || !tf || !strategyVersionId) return fail('missing_config')

  // 'D' etc. are accepted by fetchKlines, but anything unmapped is skipped.
  if (!TF_MS[tf]) return fail('unsupported_tf')

  // 1) Immutable strategy version -> method + params (single source, D1).
  const sv = await StrategyVersion.findOne({ _id: strategyVersionId }).lean().catch(() => null)
  if (!sv) return fail('strategy_version_not_found')
  const methodVersions = sv.methodVersions && typeof sv.methodVersions === 'object' ? sv.methodVersions : {}
  const method = Object.keys(methodVersions)[0] ?? null
  if (!method) return fail('no_method')

  const registry = await ensureMethods()
  let plugin
  try {
    plugin = registry.getMethod(method)
  } catch {
    return fail('unknown_method')
  }

  // 2) Closed candles (drop the forming candle).
  const market = process.env.PAPER_MARKET || 'fapi'
  const doFetch = fetchImpl ?? ((o) => fetchKlines(o))
  let bars
  try {
    const res = await doFetch({ symbol: apiSymbol(symbol), tf, market, refresh: true, limit, fetchImpl })
    bars = Array.isArray(res?.bars) ? res.bars : []
  } catch (e) {
    return fail('fetch_failed', String(e?.message ?? e).slice(0, 160))
  }
  if (bars.length < 30) return fail('not_enough_bars')
  const lastOpen = Number(bars.at(-1)?.time)
  if (Number.isFinite(lastOpen) && lastOpen + TF_MS[tf] > now) bars = bars.slice(0, -1)
  if (bars.length < 30) return fail('not_enough_bars')

  // 3) Method analyze — a broken plugin must fail loud in the summary, not crash.
  const params = { ...(plugin.defaults ?? {}), ...(sv.parameters ?? {}) }
  let result
  try {
    result = plugin.analyze(bars, params)
  } catch (e) {
    return fail('analyze_failed', String(e?.message ?? e).slice(0, 160))
  }
  const setups = Array.isArray(result?.setups) ? result.setups : []
  const events = Array.isArray(result?.events) ? result.events : []
  const lastBar = bars.length - 1

  // 4) Entry setups on the NEWEST closed bar only.
  const fresh = setups.filter((s) => Number(s?.bar) === lastBar && (s.dir === 1 || s.dir === -1))
  if (!fresh.length) return { ok: true, published: 0, method, evaluatedBar: lastBar }

  const eventTypeAt = (bar, dir) => {
    const ev = events.find((e) => Number(e?.bar) === bar)
    return ev ? `${ev.type}` : null
  }

  const docs = []
  for (const s of fresh) {
    const type = s.dir === 1 ? 'ST LONG' : 'ST SHORT'
    try {
      const doc = signalDoc({
        type,
        ts: new Date(bars[lastBar].time),
        symbol,
        tf,
        price: Number(s.entry) || null,
        ownerId: instance.ownerId,
        accountId: instance.accountId ?? null,
        attribution: {
          method,
          methodVersion: String(methodVersions[method] ?? '1'),
          strategyVersion: strategyVersionId,
          engineVersion: ENGINE_VERSION,
          paramsHash: String(sv.paramsHash ?? ''),
          indicatorRefs: []
        },
        meta: {
          entry: Number(s.entry) || null,
          sl: Number(s.sl) || null,
          tp: Number(s.tp) || null,
          eventType: eventTypeAt(lastBar, s.dir),
          botInstanceId: instance.instanceId
        }
      })
      docs.push(doc)
    } catch {
      // An invalid setup (bad ts/price) is skipped — never crashes the tick.
    }
  }

  // 5) D4 idempotent upsert — same bar -> same signalKey -> no duplicate.
  const store = await import(pathToFileURL(join(cwd, 'services', 'signalStore.mjs')).href)
  const published = await store.publishSignals(docs)
  return { ok: true, published, method, evaluatedBar: lastBar }
}
