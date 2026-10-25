// services/signalProducer.mjs
// =============================================================================
//  TM TRADING — LIVE SIGNAL PRODUCER (the missing link of the native chain).
//
//  Until now `generateSignals`/`publishSignals` had NO live caller: the native
//  signal path existed only inside backtests and tests, so a running bot had
//  nothing to consume. This service closes the loop:
//
//    bot_profiles (enabled, LIVE_PAPER) -> REST klines (closed bars only)
//      -> engine/signalEngine.generateSignals (SAME analyze() the backtester
//         uses — "same bar, same event" is not promised by hand)
//      -> services/signalStore.publishSignals ($setOnInsert, idempotent on
//         ownerId+signalKey — D3; re-running the same window upserts nothing).
//
//  Deliberate choices (documented, not hidden):
//    - REST polling, not a WS subscription: it fits the services pattern
//      (fail-soft, interval, `npm run services:once` for a bounded test) and
//      the method only needs CLOSED bars. The in-progress candle is dropped.
//    - accountId stays null on produced signals: the bridge rejects a signal
//      whose account differs from the instance's, and the instance may not
//      carry one (accountOf falls back to 'default').
//    - Every run re-emits the whole window; duplicates are database no-ops.
// =============================================================================

import { loadEnv } from '../exec/env.mjs'
import { connectMongo } from '../engine/db.mjs'
import { generateSignals } from '../engine/signalEngine.mjs'
import { publishSignals } from './signalStore.mjs'
import { fetchKlines } from '../engine/data.mjs'
import { tfToMs } from '../market/timeframes.mjs'

loadEnv()

/** Engine timeframe ('15') -> Binance kline interval ('15m'). */
export function binanceInterval(tf) {
  const minutes = tfToMs(tf) / 60_000
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/** Profile instrument ('BTCUSDT.P' perp) -> Binance fapi symbol ('BTCUSDT'). */
export const fapiSymbol = (symbol) => String(symbol ?? '').replace(/\.P$/i, '')

/**
 * Closed-bar window for one symbol/tf using fetchKlines (supports fapi/spot).
 * The last (in-progress) kline is dropped so a signal is only ever confirmed
 * on a CLOSED bar.
 */
export async function closedBars(symbol, tf, { bars: maxBars = 400, now = Date.now(), fetchImpl, market } = {}) {
  const mkt = market ?? (process.env.PAPER_MARKET || 'spot')
  const { bars } = await fetchKlines({
    symbol,
    tf,
    market: mkt,
    limit: Math.min(Math.max(Number(maxBars) || 400, 30), 1500),
    refresh: true,
    fetchImpl,
  })
  // fetchKlines returns CLOSED bars already (in-progress filtered by closeTime check)
  return bars
}

/**
 * One producer pass. Fail-soft: any single profile/window error is counted,
 * never thrown, so one bad row cannot starve the others.
 *
 * @returns {Promise<{ok:boolean, code?:string, profiles:number, windows:number,
 *   emitted:number, persisted:number, errors:string[]}>}
 */
export async function runSignalProducer({
  now = Date.now(),
  fetchImpl,
  bars: maxBars,
  profilesLimit = 5,
} = {}) {
  const mongoose = await connectMongo()
  if (!mongoose) return { ok: false, code: 'mongo_down', profiles: 0, windows: 0, emitted: 0, persisted: 0, errors: [] }

  const errors = []
  let windows = 0
  let emitted = 0
  let persisted = 0
  let profileCount = 0

  try {
    const { BotProfile } = await import('../engine/models/botProfile.mjs')
    const { StrategyVersion } = await import('../engine/models/strategyVersion.mjs')

    const profiles = await BotProfile.find({ status: 'enabled', mode: 'LIVE_PAPER' })
      .limit(Math.min(Math.max(Number(profilesLimit) || 5, 1), 20))
      .lean()

    for (const profile of profiles) {
      const ownerId = profile.ownerId == null ? null : String(profile.ownerId)
      if (!ownerId) continue // tenancy: a signal without an owner is unreachable
      profileCount += 1

      const svId = String(profile.strategyVersionId ?? '')
      const sv = svId ? await StrategyVersion.findOne({ _id: svId }).lean() : null
      const methodVersions = sv?.methodVersions && typeof sv.methodVersions === 'object' ? sv.methodVersions : null
      const method = methodVersions ? Object.keys(methodVersions)[0] : null
      if (!method || !sv) {
        errors.push(`${profile.profileId}: strategy ${svId || '(none)'} has no resolvable method`)
        continue
      }

      const symbols = (Array.isArray(profile.instruments) ? profile.instruments : []).map(fapiSymbol)
      const timeframes = Array.isArray(profile.timeframes) ? profile.timeframes : []

      for (const tf of timeframes) {
        for (const symbol of symbols) {
          windows += 1
          try {
            const bars = await closedBars(symbol, tf, { bars: maxBars, now, fetchImpl, market: process.env.PAPER_MARKET || 'spot' })
            if (bars.length === 0) {
              errors.push(`${symbol}@${tf}: no closed bars`)
              continue
            }
            const docs = generateSignals({
              bars,
              method,
              params: sv.parameters ?? undefined,
              symbol,
              tf,
              ownerId,
              strategyVersion: svId,
            })
            emitted += docs.length
            persisted += await publishSignals(docs)
          } catch (e) {
            errors.push(`${symbol}@${tf}: ${String(e?.message ?? e).slice(0, 120)}`)
          }
        }
      }
    }

    return { ok: errors.length === 0, profiles: profileCount, windows, emitted, persisted, errors }
  } catch (e) {
    return { ok: false, code: 'producer_error', profiles: profileCount, windows, emitted, persisted, errors: [String(e?.message ?? e).slice(0, 200)] }
  }
}
