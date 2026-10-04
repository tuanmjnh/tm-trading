// =============================================================================
//  TM TRADING - FUNDING SERVICE (roadmap Phase 8).
//
//  Nguồn: /fapi/v1/premiumIndex (một call = TẤT CẢ symbol, lastFundingRate +
//  nextFundingTime + markPrice) + openInterest từng symbol ở mức CỰC ĐOAN.
//
//  - Snapshot `funding`: top |rate| -> dashboard.
//  - Cực đoan |rate| >= FUNDING_ALERT_RATE (mặc định 0.0005 = 0.05%/8h) ->
//    Telegram, dedupe theo `alert:funding:<sym>:<nextFundingTime>` (mỗi kỳ
//    funding 1 lần, chạy lại không gửi lại).
// =============================================================================
import { premiumIndex, openInterest } from './binance.mjs'
import { getIntel, saveSnapshot, insertEvents } from './store.mjs'
import { sendTelegram } from './telegram.mjs'

/** Cực đoan: |rate| >= th (0.0001 = 0.01%). Env FUNDING_ALERT_RATE. */
export const DEFAULT_ALERT_RATE = Number(process.env.FUNDING_ALERT_RATE || 0.0005)

/**
 * Chọn snapshot (top N theo |rate|) + mực cực đoan — PURE (golden test).
 * @param {{symbol:string, rate:number, nextFundingTime:number, price:number}[]} rows
 * @returns {{snapshot:any[], extremes:any[]}}
 */
export function evaluateFunding(rows, { snapshotN = 15, maxExtremes = 10, th = DEFAULT_ALERT_RATE } = {}) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate))
  const snapshot = sorted.slice(0, snapshotN)
  const extremes = sorted.filter((r) => Math.abs(r.rate) >= th).slice(0, maxExtremes)
  return { snapshot, extremes }
}

/** Gắn open interest (contracts + notional USD) — fail-soft từng symbol. */
async function attachOi(list, { fetchImpl, oiCap = 8 } = {}) {
  const targets = list.slice(0, oiCap)
  for (const e of targets) {
    try {
      e.oiContracts = await openInterest(e.symbol, { fetchImpl })
      e.oiNotionalUsd = Math.round(e.oiContracts * (e.price || 0))
    } catch {
      e.oiContracts = null
      e.oiNotionalUsd = null
    }
  }
  return list
}

const fmtPct = (rate) => `${(rate * 100).toFixed(4)}%`

/**
 * Chạy 1 lần. Throw nếu nguồn chính hỏng (orchestrator bắt -> heartbeat error).
 * @returns {Promise<{checked:number, snapshot:number, extremes:number, alerted:number, mongo:'up'|'down'}>}
 */
export async function runFunding({ fetchImpl, now = new Date(), th = DEFAULT_ALERT_RATE } = {}) {
  const raw = await premiumIndex({ fetchImpl })
  const rows = raw
    .map((r) => ({
      symbol: r.symbol,
      rate: Number(r.lastFundingRate) || 0,
      nextFundingTime: Number(r.nextFundingTime) || 0,
      price: Number(r.markPrice) || Number(r.lastPrice) || 0,
    }))
    .filter((r) => r.price > 0)

  const { snapshot, extremes } = evaluateFunding(rows, { th })
  const withOi = await attachOi([...new Map([...snapshot.slice(0, 3), ...extremes].map((e) => [e.symbol, e])).values()])

  const Intel = await getIntel()
  const mongo = Intel ? 'up' : 'down'
  let alerted = 0
  if (Intel) {
    const ts = now.getTime()
    await saveSnapshot('funding', snapshot.map((e) => ({
      key: `funding:${e.symbol}`,
      symbol: e.symbol,
      ts,
      data: { rate: e.rate, pct: Number((e.rate * 100).toFixed(4)), nextFundingTime: e.nextFundingTime, price: e.price, oiContracts: e.oiContracts ?? null, oiNotionalUsd: e.oiNotionalUsd ?? null },
    })))

    if (extremes.length) {
      const res = await insertEvents(extremes.map((e) => ({
        key: `alert:funding:${e.symbol}:${e.nextFundingTime}`,
        kind: 'alert',
        symbol: e.symbol,
        ts,
        score: Math.round(Math.abs(e.rate) * 1e6),
        data: { rate: e.rate, pct: Number((e.rate * 100).toFixed(4)), nextFundingTime: e.nextFundingTime, oiNotionalUsd: e.oiNotionalUsd ?? null },
      })))
      if (res?.inserted.length) {
        const fresh = extremes.filter((e) => res.inserted.includes(`alert:funding:${e.symbol}:${e.nextFundingTime}`))
        const lines = fresh.map((e) => `• ${e.symbol}: ${fmtPct(e.rate)} (${e.rate > 0 ? 'long trả' : 'short trả'})${e.oiNotionalUsd ? ` · OI $${(e.oiNotionalUsd / 1e6).toFixed(1)}M` : ''}`)
        await sendTelegram(
          [`💸 TM Trading — FUNDING CỰC ĐOAN (${fresh.length})`, ...lines, `Kỳ kế tiếp tính theo nextFundingTime.`].join('\n'),
          '[funding]',
        )
        alerted = res.inserted.length
      }
    }
  }

  return { checked: rows.length, snapshot: snapshot.length, extremes: extremes.length, alerted, mongo }
}
