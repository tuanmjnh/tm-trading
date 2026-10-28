// =============================================================================
//  TM TRADING — lazy market-plane singleton for the Nitro server (S3).
//
//  The plane lives in `market/` (plain ESM, dependency-free). Nitro imports it
//  through a dynamic pathToFileURL import — the same pattern as
//  server/utils/journal.ts — so the server typecheck never needs declarations
//  for the JS modules and the engine core stays dependency-free (AGENTS).
//
//  Construction happens ONCE per process, on the first WebSocket client:
//    * provider: Binance combined stream (trade + bookTicker + ticker + 1m kline)
//    * source='kline' -> 4m/10m candles come from D22 aggregation of closed
//      1m bars; trades/quotes flow through to subscribers as-is
//  Env knobs (server-side only, never public):
//    MARKET_PROVIDER=off   build the plane WITHOUT a live feed (tests/dev)
//    MARKET_SYMBOLS=BTCUSDT,ETHUSDT
//    MARKET_EXCHANGE=fapi|spot
//    MARKET_KLINE=1m       (empty = no kline stream; trades builder path)
// MARKET_DEPTH=off      disable the depth stream + REST snapshot sync
// MARKET_TICKER24=off   disable the 24h ticker pipeline (WS @ticker stream +
//                         REST 24hr poller) feeding Band-1 telemetry
//    MARKET_RECORD=off        disable the §23 candle recorder (default on)
//    MARKET_RECORD_RETENTION_DAYS=90   declared retention in the dataset manifest
// =============================================================================

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type MarketEvent = Record<string, unknown> & {
  type?: string
  eventTime?: number
  ingestTime?: number
}

export type Unsub = () => void

export interface MarketBus {
  on(topic: string, handler: (event: MarketEvent) => void): Unsub
  emit(topic: string, event: MarketEvent): number
  subscriberCount(topic: string): number
}

export interface MarketPlane {
  bus: MarketBus
  clock: {
    now(): number
    mode(): string
    /** Exchange-vs-local offset used by the D17 gate (live skew, see market/clock.mjs). */
    skew?(): number
    setSkew?(ms: number): number
  }
  quoteStore: { all(): Array<Record<string, unknown>>; size(): number }
  ticker24Store: { all(): Array<Record<string, unknown>>; size(): number }
  orderbookStore: { symbols(): string[]; get(symbol: string): unknown }
  monitor: { status(): Record<string, unknown> }
  provider: { status(): Record<string, unknown> } | null
  /** Static config mirrored into the WS hello frame (S5 UI). */
  symbols?: string[]
  timeframes?: string[]
  /** Serve one more symbol at runtime (false = invalid or already served). */
  addSymbol?(symbol: string): boolean
  attachDepthSync?(sync: DepthSync): void
  /** Route one canonical event through the D17 gate into stores + bus. */
  route(event: MarketEvent, topic: string): void
  start(): void
  stop(): void
  stats(): Record<string, unknown>
}

export interface DepthSync {
  start(): void
  stop(): void
  resync(symbol?: string): void
  stats(): Record<string, unknown>
}

export interface MarketPlaneModule {
  createBinanceProvider(opts: Record<string, unknown>): { status(): Record<string, unknown> }
  createMarketPlane(opts: Record<string, unknown>): MarketPlane
  createDepthSync(opts: Record<string, unknown>): DepthSync
}

let planePromise: Promise<MarketPlane> | null = null

const csv = (value: string | undefined, fallback: string[]): string[] => {
  const list = String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? list : fallback
}

/** Load `market/index.mjs` once and build the plane (provider included). */
export async function getMarketPlane(): Promise<MarketPlane> {
  if (!planePromise) {
    planePromise = (async () => {
      const href = pathToFileURL(join(process.cwd(), 'market', 'index.mjs')).href
      const mod = (await import(href)) as unknown as MarketPlaneModule

      const symbols = csv(process.env.MARKET_SYMBOLS, ['BTCUSDT'])
      const exchange = process.env.MARKET_EXCHANGE === 'spot' ? 'spot' : 'fapi'
      const kline = process.env.MARKET_KLINE === '' ? null : (process.env.MARKET_KLINE || '1m')
      const depth = process.env.MARKET_DEPTH !== 'off'
      const ticker24 = process.env.MARKET_TICKER24 !== 'off'
      const provider = process.env.MARKET_PROVIDER === 'off'
        ? null
        : mod.createBinanceProvider({ market: exchange, symbols, klineInterval: kline, depth, ticker24 })

      // kline mode needs a 1m base to aggregate from; without a kline stream
      // the plane falls back to building every timeframe from raw trades.
      const source = kline ? 'kline' : 'trades'
      const plane = mod.createMarketPlane({ symbols, timeframes: ['1m', '4m', '10m'], source, provider })

      // 24h ticker pipeline (Band-1 24h Change / VOL): the WS @ticker stream
      // is subscribed above, but several venues/networks never deliver it —
      // so a slow REST 24hr poller feeds the SAME canonical event + store.
      // The store stale-guard merges both sources (newer eventTime wins).
      if (ticker24) {
        try {
          const pollMod = await import(pathToFileURL(join(process.cwd(), 'market', 'ticker24Poll.mjs')).href) as unknown as {
            createTicker24Poll(opts: Record<string, unknown>): { start(): void }
          }
          const poll = pollMod.createTicker24Poll({
            symbols,
            getSymbols: () => [...(plane.symbols ?? [])],
            market: exchange,
            bus: plane.bus,
            route: (event: MarketEvent, topic: string) => plane.route(event, topic),
            fetchImpl: fetch
          })
          poll.start()
          console.log(`[market] 24h ticker poller started (${symbols.join(',')})`)
        } catch (err) {
          console.warn(`[market] 24h ticker poller not started (fail-soft): ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Depth diffs only make sense after a REST snapshot — the sync owns
      // the official sequencing and publishes materialized ladders to the bus.
      if (depth && provider) {
        const sync = mod.createDepthSync({
          symbols,
          market: exchange,
          store: plane.orderbookStore,
          bus: plane.bus,
          fetchImpl: fetch
        })
        plane.attachDepthSync?.(sync)
        sync.start()
      }

      // D17 live skew: exchange-stamped events are dropped as "future" when
      // the local clock lags the exchange (measured via REST /time; refresh
      // so drift between samples never exceeds the ingest transit margin).
      // Measured on the SPOT time endpoint on purpose: spot and fapi share
      // the same exchange clock, and spot REST stays reachable even while
      // fapi REST is rate-limited/banned (HTTP 418) — the WS feed itself is
      // never affected by that ban.
      if (provider) {
        const timeUrl = 'https://api.binance.com/api/v3/time'
        const SKEW_MARGIN_MS = 5_000
        const SKEW_REFRESH_MS = 5 * 60_000
        const SKEW_RETRY_MS = 30_000
        const syncSkew = async (): Promise<boolean> => {
          try {
            const t0 = Date.now()
            const res = await fetch(timeUrl, { signal: AbortSignal.timeout(5_000) })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const body = (await res.json()) as { serverTime?: unknown }
            const t1 = Date.now()
            const offset = Number(body.serverTime) - (t0 + t1) / 2
            if (!Number.isFinite(offset)) throw new Error(`bad serverTime: ${String(body.serverTime)}`)
            const before = plane.clock.skew?.() ?? null
            plane.clock.setSkew?.(offset + SKEW_MARGIN_MS)
            const after = plane.clock.skew?.() ?? null
            if (after !== before) console.log(`[market] clock skew installed: offset=${Math.round(offset)}ms skew=${Math.round(after ?? 0)}ms`)
            return true
          } catch (err) {
            console.warn(`[market] clock skew sync failed (keeps previous skew=${plane.clock.skew?.() ?? 'n/a'}): ${err instanceof Error ? err.message : String(err)}`)
            return false
          }
        }
        if (typeof plane.clock.setSkew !== 'function') {
          console.warn('[market] clock has no setSkew() — D17 gate runs in local time only (check market/clock.mjs)')
        }
        const schedule = (ms: number) => {
          const t = setTimeout(async () => {
            const ok = await syncSkew()
            schedule(ok ? SKEW_REFRESH_MS : SKEW_RETRY_MS)
          }, ms)
          t.unref?.()
        }
        void syncSkew().then((ok) => schedule(ok ? SKEW_REFRESH_MS : SKEW_RETRY_MS))
      }

      // §23 candle recorder: persist CLOSED bars to Mongo `candles` and keep the
      // §23.4 dataset manifest in sync. Fail-soft by design — Mongo down or an
      // unavailable model simply idles the recorder; it must never break the
      // plane's WS feed (D33). Disable with MARKET_RECORD=off.
      if (process.env.MARKET_RECORD !== 'off') {
        void (async () => {
          try {
            const recHref = pathToFileURL(join(process.cwd(), 'market', 'recorder.mjs')).href
            const modelsHref = pathToFileURL(join(process.cwd(), 'engine', 'models', 'index.mjs')).href
            const [recMod, models] = await Promise.all([
              import(recHref) as Promise<{ createCandleRecorder(opts: Record<string, unknown>): { start(): void; stop(pending?: boolean): Promise<void>; stats(): Record<string, unknown> } }>,
              import(modelsHref) as Promise<{ Candle?: unknown; Dataset?: unknown }>,
            ])
            if (!models.Candle || !models.Dataset) throw new Error('candle/dataset models unavailable')
            const rec = recMod.createCandleRecorder({
              bus: plane.bus,
              candleModel: models.Candle,
              datasetModel: models.Dataset,
              retentionDays: Number(process.env.MARKET_RECORD_RETENTION_DAYS || 90),
            })
            rec.start()
            console.log(`[market] candle recorder started (retention=${Number(process.env.MARKET_RECORD_RETENTION_DAYS || 90)}d)`)
          } catch (err) {
            console.warn(`[market] candle recorder not started (fail-soft): ${err instanceof Error ? err.message : String(err)}`)
          }
        })()
      }

      // G8.2: publish the plane's MEASURED health (provider state, sequence
      // gaps, latency) so the paper executor — a different process — can feed
      // it into the §35 data-quality gate. A tiny snapshot replaced atomically;
      // fail-soft, the feed itself never depends on this writer.
      try {
        const healthHref = pathToFileURL(join(process.cwd(), 'market', 'healthSnapshot.mjs')).href
        const healthMod = (await import(healthHref)) as unknown as {
          createMarketHealthWriter(opts: Record<string, unknown>): { start(): void; stop(): void, file?: string }
        }
        const file = process.env.MARKET_HEALTH_FILE || join(process.cwd(), 'logs', 'market-plane-health.json')
        const writer = healthMod.createMarketHealthWriter({
          plane,
          file,
          everyMs: Number(process.env.MARKET_HEALTH_INTERVAL_MS || 15_000),
        })
        writer.start()
        console.log(`[market] health snapshot writer started -> ${file}`)
      } catch (err) {
        console.warn(`[market] health snapshot writer not started (fail-soft): ${err instanceof Error ? err.message : String(err)}`)
      }

      try {
        plane.start()
      } catch (err) {
        console.warn(`[market] plane.start() failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      return plane
    })().catch((err: unknown) => {
      planePromise = null // a failed construction may be retried on the next client
      throw err
    })
  }
  return planePromise
}

/** Test hook: forget the singleton (tests never call this — they use fakes). */
export function resetMarketPlane(): void {
  planePromise = null
}
