#!/usr/bin/env node
// =============================================================================
//  TM TRADING - CONFLUENCE SERVICE (roadmap Phase 10).
//
//  Diem gop "coin nao dang dat trong tam ngam" hằng ngày — ket hop 4 nguon:
//   1. METHOD  (0.4): diem recency-trung-binh cua TUNG method da dang ky
//      (vsa/price-action/trend/orderflow) tren `CONFLUENCE_TF` bar gan nhat
//      — doc tu engine methods, khong tinh lai he trong o UI (D1).
//   2. REGIME  (0.2): season (alt/btc) + F&G cuc doi (mua tham, ban tham).
//   3. FUNDING (0.2): rate > 0 (long tra tien = crowded long) -> diem am;
//      rate < 0 -> diem duong. Nguong 3bp/8h.
//   4. ZONE    (0.2): gia dang trong vung thanh ly duong duoi (est) + L/S
//      crowding + thanh ly that vua qua.
//
//  Ghi intel kind `confluence` (saveSnapshot = thay the moi lan chay).
//  Docs: services/test.mjs section 8 test cac ham PURE (combineScore...).
//
//  Chay: ~Services (heartbeat day) hoac `node services/confluence.mjs` (1 lan).
//  Env:  CONFLUENCE_INTERVAL (86400), CONFLUENCE_TOP, CONFLUENCE_TF,
//        CONFLUENCE_BARS, CONFLUENCE_RECENCY, CONFLUENCE_SYMBOLS (csv).
// =============================================================================

import { loadEnv } from '../exec/env.mjs'
loadEnv() // doc .env TRUOC khi doc CFG — dung pattern telegram.mjs (CLI doc lap)

import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getIntel, saveSnapshot } from './store.mjs'
import { fetchKlines } from '../engine/data.mjs'
import { listMethods, getMethod } from '../engine/methods/index.mjs'
import '../engine/methods/all.mjs' // dang ky day du method truoc khi listMethods()

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const CONFLUENCE_CFG = Object.freeze({
  topN: Number(process.env.CONFLUENCE_TOP || 10),
  tf: process.env.CONFLUENCE_TF || '60',
  bars: Number(process.env.CONFLUENCE_BARS || 150), // > sma50 + lvFresh60 warmup
  recency: Number(process.env.CONFLUENCE_RECENCY || 12), // bar cuoi tinh diem
  minBars: 60,
  symbols: String(process.env.CONFLUENCE_SYMBOLS || '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  weights: Object.freeze({ method: 0.4, regime: 0.2, funding: 0.2, zone: 0.2 }),
  fallbackSymbols: Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']),
})

// Major = 4 l1 bluechip "tien te luan chuyen" (SOL van la ALT — alt-season
// giu cho no duong, btc-season cho no am).
const MAJORS = new Set(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT'])

const clamp11 = (x) => (Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0)
const g = (v) => (Number.isFinite(v) ? v : 0)

/**
 * Gop 4 phan diem thanh tong [-1,1] — PURE (test services section 8).
 * @param {{method?:number, regime?:number, funding?:number, zone?:number}} parts
 */
export function combineScore(parts, weights = CONFLUENCE_CFG.weights) {
  return clamp11(
    weights.method * g(parts?.method)
    + weights.regime * g(parts?.regime)
    + weights.funding * g(parts?.funding)
    + weights.zone * g(parts?.zone),
  )
}

/**
 * Diem recency cua 1 method: trung binh scores o `recency` bar cuoi — PURE.
 * Diem method la [-1,1] (0 = khong co su kien huong) — khong tinh lai o UI.
 */
export function methodRecencyScore(scores, recency = CONFLUENCE_CFG.recency) {
  if (!Array.isArray(scores) || !scores.length) return 0
  const tail = scores.slice(-Math.max(1, Math.floor(recency)))
  const nums = tail.filter((x) => Number.isFinite(x))
  if (!nums.length) return 0
  return clamp11(nums.reduce((a, b) => a + b, 0) / nums.length)
}

/**
 * Phan regime (PURE, doc truc tiep data regime doc).
 * Alt-season: alt duong, major am nhe; btc-season: nguoc lai.
 * F&G cuc doi (<=25 / >=75): mua tham / ban tham (contrarian).
 */
export function scoreRegime(d, symbol) {
  if (!d || typeof d !== 'object') return 0
  let s = 0
  if (d.season === 'alt') s += MAJORS.has(symbol) ? -0.05 : 0.2
  else if (d.season === 'btc') s += symbol === 'BTCUSDT' ? 0.2 : MAJORS.has(symbol) ? 0.05 : -0.1
  const fng = d.fng?.value
  if (Number.isFinite(fng)) {
    if (fng <= 25) s += 0.15
    else if (fng >= 75) s -= 0.15
  }
  return clamp11(s)
}

/**
 * Phan funding (PURE): funding am = crowded short (nguoc lai dang long) -> duong.
 * Nguong 3bp/8h (0.0003) = muc crowded day du.
 */
export function scoreFunding(rate) {
  if (!Number.isFinite(rate)) return 0
  return clamp11(-rate / 0.0003)
}

/**
 * Phan zone (PURE): est = vung thanh ly duong duoi (tinh tu mark hien tai,
 * luon nam duoi gia — pct >= -2.5 nghia la "ngay duoi mat") + L/S crowding +
 * thanh ly that vua qua (actual) -> domino dang dien ra.
 */
export function scoreZone(d) {
  if (!d || typeof d !== 'object') return 0
  let s = 0
  const ls = d.lsRatio
  if (Number.isFinite(ls)) {
    if (ls > 2.5) s -= 0.2 // crowded long -> rui ro xuong
    else if (ls < 0.7) s += 0.2 // crowded short -> day nang xuong
  }
  const est = Array.isArray(d.est) ? d.est : []
  const nearest = est
    .filter((e) => e?.side === 'long' && Number.isFinite(e?.pct))
    .reduce((best, e) => Math.max(best, e.pct), -Infinity)
  if (Number.isFinite(nearest) && nearest >= -2.5) s -= 0.3 // cascade fuel ngay duoi
  const actual = Array.isArray(d.actual) ? d.actual : []
  if (actual.some((a) => a?.side === 'long')) s -= 0.15 // thanh ly long that vua qua
  return clamp11(s)
}

/** Chon danh sach symbol: env -> top mover theo |chg| -> fallback cac major. */
async function pickSymbols(Intel) {
  if (CONFLUENCE_CFG.symbols.length) return { symbols: CONFLUENCE_CFG.symbols, src: 'env' }
  if (Intel) {
    try {
      const movers = await Intel.find({ kind: 'mover' }).sort({ ts: -1 }).limit(20).lean()
      const uniq = new Map()
      for (const m of movers) {
        const s = String(m?.symbol || '')
        const pct = Number(m?.data?.pct24h)
        if (s && !uniq.has(s)) uniq.set(s, Number.isFinite(pct) ? Math.abs(pct) : 0)
      }
      const top = [...uniq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, CONFLUENCE_CFG.topN)
        .map(([s]) => s)
      if (top.length) return { symbols: top, src: 'mover' }
    } catch { /* Mongo loi -> fallback */ }
  }
  return { symbols: [...CONFLUENCE_CFG.fallbackSymbols], src: 'fallback' }
}

/**
 * Chay 1 lan: tinh diem gop cho tung symbol -> saveSnapshot('confluence').
 * Fail-soft theo tung symbol (kline loi -> bo qua method part, van tinh 3 nguon
 * con lai). Mongo down -> tinh nhung khong luu (saveSnapshot = -1).
 *
 * @returns {Promise<{n:number, saved:number, top:string[], skipped:string[]}>}
 */
export async function runConfluence({ now = Date.now(), fetchImpl } = {}) {
  const cfg = CONFLUENCE_CFG
  const Intel = await getIntel()
  const { symbols, src } = await pickSymbols(Intel)

  let regimeData = null
  let fundMap = new Map()
  let zoneMap = new Map()
  if (Intel) {
    try {
      const [regimeDocs, fundingDocs, zoneDocs] = await Promise.all([
        Intel.find({ kind: 'regime' }).sort({ ts: -1 }).limit(1).lean(),
        Intel.find({ kind: 'funding' }).limit(30).lean(),
        Intel.find({ kind: 'zone' }).limit(30).lean(),
      ])
      regimeData = regimeDocs[0]?.data ?? null
      fundMap = new Map(fundingDocs.map((f) => [String(f?.symbol || ''), f?.data ?? null]))
      zoneMap = new Map(zoneDocs.map((z) => [String(z?.symbol || ''), z?.data ?? null]))
    } catch { /* Mongo loi giua chung -> 3 phan regime/funding/zone = 0 */ }
  }

  const rows = []
  const skipped = []
  const methodIds = listMethods()

  for (const symbol of symbols) {
    let bars = null
    try {
      const raw = await fetchKlines({ symbol, tf: cfg.tf, market: 'fapi', limit: cfg.bars, fetchImpl })
      bars = raw?.bars ?? null
    } catch (e) {
      skipped.push(`${symbol}: kline ${e?.message ?? e}`)
    }

    let method = 0
    if (Array.isArray(bars) && bars.length >= cfg.minBars) {
      const per = []
      for (const id of methodIds) {
        try {
          const an = getMethod(id).analyze(bars)
          per.push(methodRecencyScore(an.scores, cfg.recency))
        } catch {
          // method loi tren du lieu nay -> bo khoi trung binh (khong lam hong chay)
        }
      }
      if (per.length) method = per.reduce((a, b) => a + b, 0) / per.length
    }

    const parts = {
      method: clamp11(method),
      regime: scoreRegime(regimeData, symbol),
      funding: scoreFunding(fundMap.get(symbol)?.rate),
      zone: scoreZone(zoneMap.get(symbol)),
    }
    const score = combineScore(parts)
    rows.push({
      key: `confluence:${symbol}`,
      symbol,
      ts: new Date(now),
      score: Math.round(score * 1000) / 1000,
      data: {
        score,
        parts,
        rank: 0,
        tf: cfg.tf,
        bars: Array.isArray(bars) ? bars.length : 0,
        src,
      },
    })
  }

  rows.sort((a, b) => b.score - a.score)
  rows.forEach((r, i) => { r.data.rank = i + 1 })

  const saved = await saveSnapshot('confluence', rows)
  return {
    n: rows.length,
    saved,
    skipped,
    top: rows.slice(0, 3).map((r) => `${r.symbol}=${r.score.toFixed(2)}`),
  }
}

// CLI: `node services/confluence.mjs` — 1 lan, disconnect de khong tre process
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const t0 = Date.now()
  runConfluence()
    .then((r) => {
      console.log(`[confluence] ${r.n} symbol, saved=${r.saved}, top: ${r.top.join(' | ') || '-'} (${Date.now() - t0}ms)`)
      if (r.skipped.length) console.log(`[confluence] skip: ${r.skipped.join('; ')}`)
    })
    .catch((e) => console.error('[confluence] LOI:', e?.message ?? e))
    .finally(async () => {
      try {
        const { disconnectMongo } = await import('./store.mjs')
        await disconnectMongo()
      } catch { /* store khong export cung khong sao */ }
      setTimeout(() => process.exit(0), 100)
    })
}
