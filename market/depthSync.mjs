// =============================================================================
//  TM TRADING — REST depth snapshot synchronizer (Phase 7T orderbook).
//
//  The orderbook store only applies Binance diff streams after a REST
//  snapshot (official sequencing: snapshot -> straddling diff -> contiguous
//  diffs). This module owns that loop:
//    * start()   — subscribe provider STATUS on the bus; resync every symbol
//                  on every 'connected' (fresh snapshot per reconnect)
//    * resync()  — fetch + store.applySnapshot per symbol (inflight-guarded,
//                  retry with a fixed backoff when the REST call fails)
//    * after every applied snapshot the MATERIALIZED book (full level ladder,
//      not the raw diff) is emitted on the bus, so /ws/market clients always
//      receive something renderable.
//
//  Zero dependencies: global fetch, injectable fetchImpl/timers for tests.
// =============================================================================

import { TOPICS } from './events.mjs'

const REST_BASES = { fapi: 'https://fapi.binance.com', spot: 'https://api.binance.com' }
const DEPTH_PATHS = { fapi: '/fapi/v1/depth', spot: '/api/v3/depth' }

/**
 * @param {object} opts
 * @param {string[]} [opts.symbols=['BTCUSDT']]
 * @param {'fapi'|'spot'} [opts.market='fapi']
 * @param {object} opts.store        orderbook store (needs applySnapshot/get)
 * @param {object} opts.bus          event bus (STATUS in, market.book out)
 * @param {string} [opts.base]       override the REST base URL
 * @param {number} [opts.limit=500]  snapshot depth (Binance max 5000/100)
 * @param {typeof fetch} [opts.fetchImpl=globalThis.fetch]
 * @param {(fn: Function, ms: number) => any} [opts.setTimeoutFn]
 * @param {(id: any) => void} [opts.clearTimeoutFn]
 * @param {number} [opts.retryMs=3000] retry delay after a failed snapshot
 */
export function createDepthSync({
  symbols = ['BTCUSDT'],
  market = 'fapi',
  store,
  bus,
  base,
  limit = 500,
  fetchImpl = globalThis.fetch,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  retryMs = 3000
} = {}) {
  if (!store || typeof store.applySnapshot !== 'function' || typeof store.get !== 'function') {
    throw new Error('depthSync: store with applySnapshot/get required')
  }
  if (!bus || typeof bus.on !== 'function' || typeof bus.emit !== 'function') {
    throw new Error('depthSync: bus with on/emit required')
  }
  if (!base && !(market in REST_BASES)) throw new Error(`depthSync: market must be ${Object.keys(REST_BASES).join('|')} (got ${market})`)
  if (typeof fetchImpl !== 'function') throw new Error('depthSync: fetchImpl required')

  const restBase = base || REST_BASES[market]
  const depthPath = DEPTH_PATHS[market] || '/fapi/v1/depth'
  const inflight = new Set()
  const timers = new Map()
  const stats = { snapshots: 0, failures: 0, retries: 0, emitted: 0 }
  let started = false
  let stopped = false
  let offStatus = null

  const snapshotUrl = (symbol) =>
    `${restBase}${depthPath}?symbol=${encodeURIComponent(symbol)}&limit=${limit}`

  /** Publish the renderable ladder for one symbol (only when synced). */
  const emitBook = (symbol) => {
    const book = store.get(symbol)
    if (!book || !book.synced) return
    bus.emit(TOPICS.BOOK, {
      type: TOPICS.BOOK,
      symbol,
      bids: book.bids,
      asks: book.asks,
      lastUpdateId: book.lastUpdateId,
      synced: true,
      eventTime: Number.isFinite(book.eventTime) ? book.eventTime : Date.now(),
      source: 'depth',
      ingestTime: Date.now()
    })
    stats.emitted++
  }

  const run = async (symbol) => {
    if (stopped || inflight.has(symbol)) return
    inflight.add(symbol)
    try {
      const res = await fetchImpl(snapshotUrl(symbol))
      if (!res || typeof res.json !== 'function') throw new Error('depth: bad response object')
      if (res.ok === false) throw new Error(`depth HTTP ${res.status ?? '?'}`)
      const snap = await res.json()
      const lastUpdateId = Number(snap?.lastUpdateId)
      if (!Number.isFinite(lastUpdateId) || lastUpdateId < 0) throw new Error('depth: snapshot.lastUpdateId missing')
      if (!Array.isArray(snap?.bids) || !Array.isArray(snap?.asks)) throw new Error('depth: snapshot levels missing')
      store.applySnapshot({
        symbol,
        lastUpdateId,
        bids: snap.bids,
        asks: snap.asks,
        eventTime: Date.now()
      })
      stats.snapshots++
      inflight.delete(symbol)
      emitBook(symbol)
    } catch {
      inflight.delete(symbol)
      if (stopped) return
      stats.failures++
      const t = setTimeoutFn(() => {
        timers.delete(symbol)
        if (stopped) return
        stats.retries++
        run(symbol)
      }, retryMs)
      timers.set(symbol, t)
    }
  }

  const resync = (symbol) => { run(symbol) }

  const resyncAll = () => {
    if (stopped) return
    for (const sym of symbols) run(sym)
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      if (!offStatus) {
        offStatus = bus.on(TOPICS.STATUS, (status) => {
          if (status?.state === 'connected') resyncAll()
        })
      }
      resyncAll() // provider may already be connected (late attach)
    },
    stop() {
      stopped = true
      if (offStatus) { offStatus(); offStatus = null }
      for (const t of timers.values()) clearTimeoutFn(t)
      timers.clear()
      inflight.clear()
    },
    resync,
    resyncAll,
    stats: () => ({ ...stats, inFlight: inflight.size, retrying: timers.size })
  }
}
