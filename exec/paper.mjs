#!/usr/bin/env node
// =============================================================================
//  TM TRADING - PAPER EXECUTOR (roadmap Phase 6)
//
//  Every order (webhook / scanner / AI) runs PAPER first. One cycle:
//
//    A) OPEN    — ENTRY alerts (status 'received', not stale) go through the
//                 risk gate (exec/risk.mjs — sizing + all limits) -> paper
//                 Position. Idempotent at the ORDER layer (D3): externalId =
//                 clientOrderId(alertKey) hits the unique sparse index, so a
//                 re-run / crash-replay never opens the same alert twice.
//    B) EXIT    — exits come from two sources, both matched against "the
//                 latest data" for live PnL:
//                   1. follow-up alerts from TV (STOP_LOSS / TAKE_PROFIT /
//                      TIME_CLOSE) — the event TradingView already saw;
//                   2. 1m klines scan (SL/TP cross) for everything else.
//                 Conservative intra-bar rule (same as backtest): if both SL
//                 and TP could be touched, SL is assumed first; a bar that
//                 OPENS beyond the stop fills at the open (worse); TP always
//                 fills at the TP level (never optimistic).
//    C) CLOSE   — PnL -> position doc + risk_state day counters (recordClose,
//                 which auto-halts the day at the loss cap). Closes are logged
//                 through the gate module too (roadmap acceptance).
//
//  Known v1 simplifications (documented on purpose):
//   - entry fills at the SIGNAL price (limit-at-signal semantics); ENTRY older
//     than PAPER_STALE_MS (default 15 min) is rejected as stale instead of
//     filling at a phantom price;
//   - linear PnL, no fees/slippage (fees arrive with the real brokers);
//   - multiple open positions on one symbol: follow-up alerts close the
//     OLDEST one first;
//   - TAKE_PROFIT closes the full position (partial exits = Phase 11+).
//
//  CLI:
//    node exec/paper.mjs                 one cycle, then exit
//    node exec/paper.mjs --watch         loop (PAPER_INTERVAL sec, default 60)
//    node exec/paper.mjs --interval 30   loop with custom interval (seconds)
// =============================================================================
import { fetchKlines } from '../engine/data.mjs'
import { clientOrderId } from '../engine/keys.mjs'
import { loadEnv } from './env.mjs'
import {
  loadRiskConfig, checkOrder, recordOpen, recordClose, equityNow, auditLog,
} from './risk.mjs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

loadEnv()

const PAPER_DEFAULTS = Object.freeze({
  staleMs: Number(process.env.PAPER_STALE_MS || 15 * 60 * 1000),
  intervalSec: Number(process.env.PAPER_INTERVAL || 60),
  market: process.env.PAPER_MARKET || 'fapi',
  batch: 20, // max ENTRY alerts processed per cycle
})

let models = null
async function getModels() {
  if (models) return models
  const db = await import('../engine/db.mjs')
  const conn = await db.connectMongo()
  if (!conn) return null
  const { Alert, Position } = await import('../engine/models/index.mjs')
  models = { Alert, Position }
  return models
}

// 'BTCUSDT.P' (TradingView display) -> 'BTCUSDT' (Binance API)
const apiSymbol = (s) => (s.endsWith('.P') ? s.slice(0, -2) : s)

// =============================================================================
//  EXIT matching (pure over bars — easy to reason about, reviewed by eye)
// =============================================================================

/**
 * First SL/TP1 touch AFTER `afterMs`, conservative intra-bar ordering.
 * @returns {{price:number, time:number, kind:'sl'|'tp'} | null}
 */
export function findFirstExit(bars, { dir, sl, tp1 }, afterMs) {
  if (!Number.isFinite(sl) || !Number.isFinite(tp1)) return null
  for (const b of bars) {
    if (b.time <= afterMs) continue
    if (dir === 1) {
      // SL first: gap open below stop fills at open (worse); else level.
      if (b.open < sl) return { price: b.open, time: b.time, kind: 'sl' }
      if (b.low <= sl) return { price: sl, time: b.time, kind: 'sl' }
      if (b.high >= tp1) return { price: tp1, time: b.time, kind: 'tp' }
    } else {
      if (b.open > sl) return { price: b.open, time: b.time, kind: 'sl' }
      if (b.high >= sl) return { price: sl, time: b.time, kind: 'sl' }
      if (b.low <= tp1) return { price: tp1, time: b.time, kind: 'tp' }
    }
  }
  return null
}

/** Exit price implied by a follow-up alert (TV already saw the event). */
export function followExitPrice(alert) {
  if (alert.action === 'STOP_LOSS') return Number(alert.price) // actual stop price
  if (alert.action === 'TAKE_PROFIT') {
    const lvl = Number(alert.level)
    const tp = Number.isFinite(lvl) && alert.tps?.[lvl - 1] !== undefined ? Number(alert.tps[lvl - 1]) : NaN
    return Number.isFinite(tp) ? tp : Number(alert.price)
  }
  return null // TIME_CLOSE -> market (resolved by caller from latest data)
}

// =============================================================================
//  Cycle
// =============================================================================

export async function runCycle(config = loadRiskConfig(), opts = {}) {
  const cfg = { ...PAPER_DEFAULTS, ...opts }
  const stats = { opened: 0, rejected: 0, stale: 0, closed: 0, errors: 0, mongoDown: false }
  const m = await getModels()
  if (!m) {
    stats.mongoDown = true
    console.warn('[paper] Mongo unavailable — cycle skipped (fail-soft)')
    return stats
  }

  // --- A) OPEN: ENTRY -> risk gate -> paper position -----------------------
  const staleCutoff = new Date(Date.now() - cfg.staleMs)
  const staleRes = await m.Alert.updateMany(
    { action: 'ENTRY', status: 'received', ts: { $lt: staleCutoff } },
    { $set: { status: 'rejected', rejectReason: `stale: older than ${Math.round(cfg.staleMs / 1000)}s — refusing phantom fills` } },
  )
  stats.stale = staleRes.modifiedCount || 0
  if (stats.stale) console.log(`[paper] stale ENTRY rejected: ${stats.stale}`)

  const entries = await m.Alert.find({ action: 'ENTRY', status: 'received', ts: { $gte: staleCutoff } })
    .sort({ ts: 1 }).limit(cfg.batch).lean()

  for (const a of entries) {
    try {
      const decision = await checkOrder(
        { symbol: a.symbol, side: a.side, entry: a.price, sl: a.sl, tps: a.tps },
        config,
      )
      if (!decision.ok) {
        await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { status: 'rejected', rejectReason: `${decision.code}: ${decision.message}` } })
        stats.rejected++
        console.log(`[paper] REJECT ${a.symbol} ${a.side} — ${decision.code}`)
        continue
      }
      const dir = a.side === 'BUY' ? 1 : -1
      try {
        await recordOpen({
          config,
          symbol: a.symbol,
          dir,
          qty: decision.qty,
          entryPrice: a.price,
          sl: a.sl,
          tps: a.tps,
          externalId: clientOrderId(a.alertKey, 0), // D3 order-layer idempotency
          alertKey: a.alertKey,
        })
      } catch (e) {
        if (e?.code === 11000) {
          // Same alert already opened before a crash — order layer blocked it.
          console.log(`[paper] duplicate order (11000) for ${a.symbol} — already open`)
        } else throw e
      }
      await m.Alert.updateOne({ alertKey: a.alertKey }, { $set: { status: 'opened' } })
      stats.opened++
      console.log(`[paper] OPEN ${a.symbol} ${a.side} qty=${decision.qty?.toFixed(4)} @ ${a.price} (risk ${(decision.notional ?? 0).toFixed(0)})`)
    } catch (e) {
      stats.errors++
      console.error(`[paper] open error ${a.symbol}:`, e?.message || e)
      auditLog('paper_open_error', { symbol: a.symbol, error: e?.message || String(e) })
    }
  }

  // --- B) EXIT -------------------------------------------------------------
  const open = await m.Position.find({ account: config.account, status: 'open', source: 'paper' })
    .sort({ entryTime: 1 }).lean()
  if (open.length) {
    // B1) follow-up alerts (TV events), chronological, oldest position first
    const symbols = [...new Set(open.map((p) => p.symbol))]
    const follows = await m.Alert.find({
      action: { $in: ['TAKE_PROFIT', 'STOP_LOSS', 'TIME_CLOSE'] },
      status: 'received',
      symbol: { $in: symbols },
    }).sort({ ts: 1 }).lean()
    const stillOpen = [...open]
    for (const f of follows) {
      const idx = stillOpen.findIndex((p) => p.symbol === f.symbol && f.ts > p.entryTime)
      if (idx === -1) continue // no position (leftover history) or already closed
      const pos = stillOpen[idx]
      let price = followExitPrice(f)
      if (price === null) {
        // TIME_CLOSE: fill at the latest market close
        try {
          const { bars } = await fetchKlines({ symbol: apiSymbol(pos.symbol), tf: '1', market: cfg.market, refresh: true, limit: 2 })
          price = bars?.length ? bars[bars.length - 1].close : Number(f.price)
        } catch {
          price = Number(f.price)
        }
      }
      if (!(Number.isFinite(price) && price > 0)) {
        console.warn(`[paper] follow-up ${f.action} ${f.symbol} has no usable price — skipped`)
        continue
      }
      const closed = await closePosition(m, config, pos, price, `alert:${f.action}`, f.ts)
      if (closed) {
        await m.Alert.updateOne({ alertKey: f.alertKey }, { $set: { status: 'closed' } })
        stillOpen.splice(idx, 1)
        stats.closed++
      }
    }

    // B2) data-driven SL/TP scan for whatever is still open (one fetch per symbol)
    const bySymbol = new Map()
    for (const p of stillOpen) {
      if (!bySymbol.has(p.symbol)) bySymbol.set(p.symbol, [])
      bySymbol.get(p.symbol).push(p)
    }
    for (const [symbol, positions] of bySymbol) {
      try {
        const oldest = Math.min(...positions.map((p) => +new Date(p.entryTime)))
        const needBars = Math.min(30000, Math.ceil((Date.now() - oldest) / 60000) + 10)
        const { bars } = await fetchKlines({ symbol: apiSymbol(symbol), tf: '1', market: cfg.market, refresh: true, limit: needBars })
        for (const pos of positions) {
          const tp1 = Array.isArray(pos.tps) && pos.tps.length ? Number(pos.tps[0]) : NaN
          const hit = findFirstExit(bars, { dir: pos.dir, sl: Number(pos.sl), tp1 }, +new Date(pos.entryTime))
          if (!hit) continue
          const closed = await closePosition(m, config, pos, hit.price, `data:${hit.kind}`, new Date(hit.time))
          if (closed) stats.closed++
        }
      } catch (e) {
        stats.errors++
        console.error(`[paper] data scan error ${symbol}:`, e?.message || e)
        auditLog('paper_scan_error', { symbol, error: e?.message || String(e) })
      }
    }
  }

  if (stats.opened || stats.closed || stats.rejected || stats.stale || stats.errors) {
    console.log(`[paper] cycle: opened=${stats.opened} closed=${stats.closed} rejected=${stats.rejected} stale=${stats.stale} errors=${stats.errors}`)
  }
  return stats
}

/**
 * Close a paper position at `exitPrice` and push counters through the gate
 * module (recordClose -> risk_state + auto daily-cap halt). Idempotent: the
 * update only matches status 'open'.
 */
async function closePosition(m, config, pos, exitPrice, reason, exitTime = new Date()) {
  const equityBefore = await equityNow(config)
  const pnlAbs = pos.dir * (exitPrice - pos.entryPrice) * pos.qty
  const notional = Math.abs(pos.entryPrice * pos.qty)
  const pnlPct = notional > 0 ? (pnlAbs / notional) * 100 : 0
  const pnlPctOnEquity = equityBefore > 0 ? (pnlAbs / equityBefore) * 100 : 0
  const res = await m.Position.updateOne(
    { _id: pos._id, status: 'open' },
    { $set: { status: 'closed', exitPrice, exitTime, pnlAbs, pnlPct } },
  )
  if (!res.modifiedCount) return false // someone else closed it first
  await recordClose({ config, symbol: pos.symbol, pnlAbs, pnlPctOnEquity, win: pnlAbs > 0, equity: equityBefore, reason })
  // Follow the ENTRY alert to 'closed' so the dashboard/accounting sees the
  // full journey received -> opened -> closed (signalKey = alertKey).
  if (pos.signalKey) await m.Alert.updateOne({ alertKey: pos.signalKey }, { $set: { status: 'closed' } })
  console.log(`[paper] CLOSE ${pos.symbol} ${pos.dir === 1 ? 'LONG' : 'SHORT'} @ ${exitPrice} pnl=${pnlAbs.toFixed(2)} (${reason})`)
  return true
}

// =============================================================================
//  CLI
// =============================================================================
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  const watch = args.includes('--watch')
  const ivIdx = args.indexOf('--interval')
  const intervalSec = ivIdx >= 0 && Number.isFinite(Number(args[ivIdx + 1])) ? Number(args[ivIdx + 1]) : PAPER_DEFAULTS.intervalSec
  const config = loadRiskConfig()

  if (!watch) {
    runCycle(config).then((s) => process.exit(s.errors ? 1 : 0)).catch((e) => { console.error('[paper]', e); process.exit(1) })
  } else {
    console.log(`[paper] watch mode — every ${intervalSec}s (Ctrl+C to stop)`)
    let running = false
    const tick = async () => {
      if (running) return
      running = true
      try {
        await runCycle(config)
      } catch (e) {
        console.error('[paper] cycle error:', e?.message || e)
      } finally {
        running = false
      }
    }
    tick()
    const timer = setInterval(tick, intervalSec * 1000)
    process.on('SIGINT', () => { clearInterval(timer); console.log('\n[paper] stopped'); process.exit(0) })
    process.on('SIGTERM', () => { clearInterval(timer); process.exit(0) })
  }
}
