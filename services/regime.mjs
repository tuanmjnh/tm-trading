// =============================================================================
//  TM TRADING - REGIME SERVICE (roadmap Phase 9): Altseason, BTC.D, Fear&Greed,
//  cờ "trần bán treo" (supply drift + unlock calendar) + filter alt-lướt.
//
//  Nguồn FREE, không key:
//    - Altcoin Season Index: nhúng trong trang blockchaincenter.net
//      (/altcoin-season-index/ — parse latestScores, fallback og:description)
//    - Fear & Greed: api.alternative.me/fng (limit=30 -> trung bình 30 ngày)
//    - BTC.D / ETH.D / mcap 24h: api.coingecko.com/api/v3/global
//    - Circulating supply: coingecko /coins/markets (MAJOR_CG_IDS) — so với
//      snapshot lần trước (kind `supply`) -> drift %/ngày = cờ trần bán treo
//    - Unlock calendar: file data/unlocks.json tuỳ chọn (UNLOCKS_FILE) —
//      nguồn ngoài (TokenUnlocks) trả phí -> để Phase 11, thiếu file = []
//
//  Filter alt-lướt (altSweep): altseason ON + funding không cực đoan +
//  OI đang tăng (so snapshot kind `oi` chu kỳ trước) + không unlock 48h.
//  Tiêu chí chưa đánh giá được -> blocker trung thực (chu kỳ đầu OI chưa
//  có lịch sử -> chưa pass), KHÔNG đoán.
//
//  Mongo down -> chạy tính toán + trả summary mongo:'down', không TG (dedupe
//  cần store — giống funding). Nguồn CHÍNH (ASI) hỏng -> throw -> heartbeat
//  D9 bắt (nguồn chết phải nhìn thấy, không im lặng).
// =============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { premiumIndex, openInterest, ticker24h } from './binance.mjs'
import { getIntel, saveSnapshot, insertEvents } from './store.mjs'
import { sendTelegram } from './telegram.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** CoinGecko ids cho majors (dùng supply drift — id viết tay, đã verify free API). */
export const MAJOR_CG_IDS = Object.freeze([
  'bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple', 'dogecoin', 'cardano',
  'chainlink', 'avalanche-2', 'polkadot', 'tron', 'litecoin', 'uniswap', 'near',
])

export const REGIME_CFG = Object.freeze({
  asiUrl: 'https://www.blockchaincenter.net/altcoin-season-index/',
  fngUrl: 'https://api.alternative.me/fng/?limit=30',
  cgGlobal: 'https://api.coingecko.com/api/v3/global',
  cgMarkets: `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${MAJOR_CG_IDS.join(',')}&order=market_cap_desc&per_page=${MAJOR_CG_IDS.length}`,
  /** Altseason: top 50 beat BTC 90d; blockchaincenter: ≥75 alt, ≤25 bitcoin. */
  asiAlt: 75,
  asiBtc: 25,
  sweepTopN: 12,
  /** Funding không cực đoan cho filter: cùng mực cảnh báo funding Phase 8. */
  sweepFundingTh: Number(process.env.FUNDING_ALERT_RATE || 0.0005),
  /** Cờ trần bán: nguồn vào tăng nhanh ≥ %/ngày này (env SUPPLY_DRIFT_FLAG_PCT). */
  supplyDriftFlagPct: Number(process.env.SUPPLY_DRIFT_FLAG_PCT || 0.2),
  unlockFile: process.env.UNLOCKS_FILE || join(ROOT, 'data', 'unlocks.json'),
  /** Loại stablecoin + BTC khỏi ứng viên alt-lướt. */
  skipBase: Object.freeze(['BTC', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'BUSD', 'EUR', 'AEUR', 'USDE']),
})

// -----------------------------------------------------------------------------
//  Nguồn + parse — PURE (test offline với HTML/JSON mẫu).
// -----------------------------------------------------------------------------

/**
 * Parse Altcoin Season Index từ HTML blockchaincenter — PURE.
 * Ưu tiên `latestScores":{"30":x,"90":y,"365":z}`; fallback og:description
 * (`57% · It is not Altcoin Season`). Không đọc được -> null.
 * @param {string} html
 * @returns {{d30:number|null, d90:number|null, d365:number|null}|null}
 */
export function parseAsi(html) {
  if (typeof html !== 'string' || !html) return null
  const out = { d30: null, d90: null, d365: null }
  const i = html.indexOf('latestScores')
  if (i >= 0) {
    const seg = html.slice(i, i + 160)
    for (const m of seg.matchAll(/\\?"(\d+)\\?":(\d+)/g)) {
      if (m[1] === '30') out.d30 = Number(m[2])
      else if (m[1] === '90') out.d90 = Number(m[2])
      else if (m[1] === '365') out.d365 = Number(m[2])
    }
  }
  if (out.d90 === null) {
    const og = html.match(/(\d+)% · It is( not)? Altcoin Season/)
    if (og) out.d90 = Number(og[1])
  }
  return out.d30 === null && out.d90 === null && out.d365 === null ? null : out
}

/**
 * Parse Fear & Greed (alternative.me) — PURE.
 * API tra `value_classification` (deprecated alias `classification` van doc duoc).
 * @returns {{value:number, classification:string, avg30:number|null}|null}
 */
export function parseFng(json) {
  const arr = Array.isArray(json?.data) ? json.data : []
  if (!arr.length) return null
  const vals = arr.map((x) => Number(x.value)).filter((x) => Number.isFinite(x))
  if (!vals.length) return null
  const avg30 = vals.reduce((a, b) => a + b, 0) / vals.length
  return { value: Number(arr[0].value), classification: String(arr[0].value_classification || arr[0].classification || ''), avg30: Math.round(avg30) }
}

/** GET text/JSON — fetchImpl để test offline (cùng pattern services khác). */
async function jget(url, { fetchImpl, as = 'json', timeoutMs = 10000 } = {}) {
  const doFetch = fetchImpl || fetch
  const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${String(url).slice(0, 60)}`)
  return as === 'text' ? res.text() : res.json()
}

/** Đọc unlock calendar — fail-soft: thiếu/hỏng file -> []. */
export function readUnlocks(file = REGIME_CFG.unlockFile) {
  try {
    if (!existsSync(file)) return []
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw
      .map((u) => ({
        symbol: String(u?.symbol || '').toUpperCase(),
        ts: Date.parse(u?.date ?? u?.ts ?? ''),
        label: String(u?.label || u?.name || ''),
      }))
      .filter((u) => u.symbol && Number.isFinite(u.ts))
  } catch {
    return []
  }
}

/**
 * So nguồn cung mới vs snapshot trước -> drift %/ngày + cờ trần bán — PURE.
 * prevRows: intel kind `supply` [{symbol, data:{circulating}, ts}].
 */
export function computeSupplyDrift(prevRows, nextRows, now = Date.now(), thPct = REGIME_CFG.supplyDriftFlagPct) {
  const prevBy = new Map((prevRows || []).map((p) => [p.symbol, p]))
  return (nextRows || []).map((n) => {
    const p = prevBy.get(n.symbol)
    const pts = p ? (p.ts instanceof Date ? p.ts.getTime() : Number(p.ts)) : NaN
    if (!p || !(p.data?.circulating > 0) || !(n.circulating > 0) || !Number.isFinite(pts)) {
      return { symbol: n.symbol, circulating: n.circulating, driftPctPerDay: null, flag: false }
    }
    const days = Math.max((now - pts) / 86_400_000, 1 / 24)
    const driftPctPerDay = (((n.circulating - p.data.circulating) / p.data.circulating) / days) * 100
    return {
      symbol: n.symbol,
      circulating: n.circulating,
      driftPctPerDay: Math.round(driftPctPerDay * 1000) / 1000,
      flag: driftPctPerDay >= thPct,
    }
  })
}

/**
 * Kết luận regime + cờ — PURE (golden test).
 * @param {{asi, fng, btcDom, ethDom, mcapChg24h, supplyDrift, unlocks, now}} input
 */
export function evalRegime({ asi, fng, btcDom = null, ethDom = null, mcapChg24h = null, supplyDrift = [], unlocks = [], now = Date.now() } = {}) {
  const d90 = asi?.d90 ?? null
  const season = d90 === null ? 'neutral' : d90 >= REGIME_CFG.asiAlt ? 'alt' : d90 <= REGIME_CFG.asiBtc ? 'btc' : 'neutral'
  const flags = []
  if (fng) {
    if (fng.value <= 25) flags.push('fear-extreme')
    else if (fng.value >= 75) flags.push('greed-extreme')
  }
  const unlocks48h = (unlocks || [])
    .filter((u) => u.ts >= now && u.ts - now <= 48 * 3600_000)
    .sort((a, b) => a.ts - b.ts)
    .map((u) => ({ symbol: u.symbol, date: new Date(u.ts).toISOString(), label: u.label }))
  if (unlocks48h.length) flags.push('unlock-48h')
  const drifted = (supplyDrift || []).filter((s) => s.flag)
  for (const s of drifted.slice(0, 5)) flags.push(`supply-drift:${s.symbol}`)
  return { season, flags, unlocks48h }
}

/**
 * Filter "trade lướt alt" — PURE (golden test).
 * Tiêu chí đúng roadmap: altseason ON + funding không cực đoan + OI tăng +
 * không unlock 48h. Tiêu chí thiếu dữ liệu -> blocker ('...:unknown') trung thực.
 *
 * @param {{season, candidates:[{symbol}], fundingBySymbol:Record<string,number>,
 *          oiTrendBySymbol:Record<string,number|null>, unlock48Symbols:string[]}} input
 * @returns {{symbol:string, ok:boolean, reasons:string[], blockers:string[],
 *            rate:number|null, oiTrendPct:number|null}[]}
 */
export function altSweep({ season = 'neutral', candidates = [], fundingBySymbol = {}, oiTrendBySymbol = {}, unlock48Symbols = [] } = {}) {
  const th = REGIME_CFG.sweepFundingTh
  return candidates.map((c) => {
    const reasons = []
    const blockers = []
    if (season === 'alt') reasons.push('altseason')
    else blockers.push(`season:${season}`)

    const rate = fundingBySymbol[c.symbol]
    if (rate === undefined || rate === null) blockers.push('funding:unknown')
    else if (Math.abs(rate) >= th) blockers.push(`funding:${(rate * 100).toFixed(4)}%`)
    else reasons.push('funding-ok')

    const trend = oiTrendBySymbol[c.symbol]
    if (trend === undefined || trend === null) blockers.push('oi-trend:unknown')
    else if (trend > 0) reasons.push(`oi:+${trend.toFixed(1)}%`)
    else blockers.push(`oi:${trend.toFixed(1)}%`)

    if (unlock48Symbols.includes(c.symbol)) blockers.push('unlock:48h')

    return {
      symbol: c.symbol,
      ok: blockers.length === 0,
      reasons,
      blockers,
      rate: typeof rate === 'number' ? rate : null,
      oiTrendPct: typeof trend === 'number' ? trend : null,
    }
  })
}

/** Ứng viên alt-lướt: top quoteVolume, loại BTC/stable — PURE. */
export function pickSweepCandidates(tickers, { topN = REGIME_CFG.sweepTopN, skipBase = REGIME_CFG.skipBase } = {}) {
  const skip = new Set(skipBase)
  return (tickers || [])
    .filter((t) => typeof t.symbol === 'string' && t.symbol.endsWith('USDT'))
    .map((t) => ({
      symbol: t.symbol,
      quoteVolume: Number(t.quoteVolume) || 0,
      price: Number(t.lastPrice) || Number(t.price) || 0,
      base: t.symbol.slice(0, -4),
    }))
    .filter((t) => !skip.has(t.base))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, topN)
    .map(({ symbol, quoteVolume, price }) => ({ symbol, quoteVolume, price }))
}

// -----------------------------------------------------------------------------
//  Runner.
// -----------------------------------------------------------------------------

/**
 * Chạy 1 lần. Nguồn chính (ASI) lỗi -> throw (heartbeat D9 bắt).
 * @returns {Promise<{season:string, asi90:number|null, fng:number|null,
 *   btcDom:number|null, flags:number, sweep:number, sweepOk:number,
 *   sources:Record<string,string>, mongo:'up'|'down'}>}
 */
export async function runRegime({ fetchImpl, now = new Date(), send = sendTelegram } = {}) {
  const sources = {}
  const ts = now.getTime()

  // Nguồn CHÍNH — lỗi/parse hỏng -> throw (nguồn chết phải thấy được - D9).
  const html = await jget(REGIME_CFG.asiUrl, { fetchImpl, as: 'text' })
  const asi = parseAsi(html)
  if (!asi || asi.d90 === null) throw new Error('ASI parse that bai — trang blockchaincenter doi structure')
  sources.asi = 'ok'

  // Nguồn phụ — fail-soft từng cái (rate-limit không được giết service).
  let fng = null
  try { fng = parseFng(await jget(REGIME_CFG.fngUrl, { fetchImpl })); sources.fng = 'ok' } catch { sources.fng = 'fail' }
  let btcDom = null, ethDom = null, mcapChg24h = null
  try {
    const g = await jget(REGIME_CFG.cgGlobal, { fetchImpl })
    btcDom = Number(g?.data?.market_cap_percentage?.btc) || null
    ethDom = Number(g?.data?.market_cap_percentage?.eth) || null
    mcapChg24h = Number(g?.data?.market_cap_change_percentage_24h_usd) || null
    sources.cg = 'ok'
  } catch { sources.cg = 'fail' }

  const Intel = await getIntel()
  const mongo = Intel ? 'up' : 'down'

  // Supply drift (cờ trần bán treo) — so snapshot kind `supply` trước đó.
  let supplyDrift = []
  try {
    const markets = await jget(REGIME_CFG.cgMarkets, { fetchImpl })
    const nextRows = (Array.isArray(markets) ? markets : [])
      .map((m) => ({
        symbol: String(m?.symbol || '').toUpperCase(),
        circulating: Number(m?.circulating_supply) || 0,
      }))
      .filter((m) => m.symbol && m.circulating > 0)
    const prev = Intel ? await Intel.find({ kind: 'supply' }).lean() : []
    supplyDrift = computeSupplyDrift(prev, nextRows, ts)
    if (Intel && nextRows.length) {
      await saveSnapshot('supply', nextRows.map((r) => ({
        key: `supply:${r.symbol}`, symbol: r.symbol, ts,
        data: { circulating: r.circulating, driftPctPerDay: supplyDrift.find((s) => s.symbol === r.symbol)?.driftPctPerDay ?? null },
      })))
    }
    sources.supply = 'ok'
  } catch { sources.supply = 'fail' }

  const unlocks = readUnlocks()
  const regime = evalRegime({ asi, fng, btcDom, ethDom, mcapChg24h, supplyDrift, unlocks, now: ts })

  // Filter alt-lướt: candidates top volume + funding (1 call all) + OI trend.
  let sweep = []
  try {
    const [tickers, premium] = await Promise.all([
      ticker24h({ fetchImpl }),
      premiumIndex({ fetchImpl }),
    ])
    const candidates = pickSweepCandidates(tickers)
    const fundingBySymbol = {}
    const markBySymbol = {}
    for (const p of premium) {
      fundingBySymbol[p.symbol] = Number(p.lastFundingRate) || 0
      markBySymbol[p.symbol] = Number(p.markPrice) || 0
    }
    const prevOi = Intel ? await Intel.find({ kind: 'oi' }).lean() : []
    const prevOiBy = new Map(prevOi.map((d) => [d.symbol, d]))
    const oiRows = []
    const oiTrendBySymbol = {}
    for (const c of candidates) {
      let oiUsd = null
      try {
        const contracts = await openInterest(c.symbol, { fetchImpl })
        oiUsd = Math.round(contracts * (markBySymbol[c.symbol] || c.price || 0))
      } catch { oiUsd = null }
      const prevDoc = prevOiBy.get(c.symbol)
      const prevUsd = Number(prevDoc?.data?.oiUsd)
      const trend = oiUsd && Number.isFinite(prevUsd) && prevUsd > 0 ? ((oiUsd - prevUsd) / prevUsd) * 100 : null
      oiTrendBySymbol[c.symbol] = trend
      oiRows.push({ key: `oi:${c.symbol}`, symbol: c.symbol, ts, data: { oiUsd, trendPct: trend } })
    }
    if (Intel && oiRows.length) await saveSnapshot('oi', oiRows)
    sweep = altSweep({
      season: regime.season,
      candidates,
      fundingBySymbol,
      oiTrendBySymbol,
      unlock48Symbols: regime.unlocks48h.map((u) => u.symbol),
    })
  } catch { sources.sweep = 'fail' }

  // Persist regime + phát hiện lật mùa -> TG (dedupe insertEvents - D4).
  let alerted = 0
  if (Intel) {
    const prev = await Intel.find({ kind: 'regime' }).sort({ ts: -1 }).limit(1).lean()
    const prevSeason = prev?.[0]?.data?.season || null
    await saveSnapshot('regime', [{
      key: 'regime:current',
      ts,
      score: asi.d90,
      data: {
        season: regime.season,
        asi,
        fng: fng ? { value: fng.value, classification: fng.classification, avg30: fng.avg30 } : null,
        btcDom, ethDom, mcapChg24h,
        flags: regime.flags,
        unlocks48h: regime.unlocks48h,
        supplyDrift: supplyDrift.filter((s) => s.driftPctPerDay !== null),
        sweep,
        sources,
      },
    }])
    if (prevSeason && prevSeason !== regime.season) {
      const res = await insertEvents([{
        key: `alert:regime:flip:${prevSeason}->${regime.season}`,
        kind: 'alert',
        ts,
        score: asi.d90,
        data: { from: prevSeason, to: regime.season, asi90: asi.d90 },
      }])
      if (res?.inserted.length) {
        const label = { alt: 'ALT SEASON', btc: 'BITCOIN SEASON', neutral: 'TRUNG LẬP' }
        await send(
          ['🌡 TM Trading — LẬT MÙA THỊ TRƯỜNG', `${label[prevSeason] || prevSeason} -> ${label[regime.season] || regime.season}`, `ASI 90d: ${asi.d90}% (ngưỡng alt ≥${REGIME_CFG.asiAlt} / btc ≤${REGIME_CFG.asiBtc})`, `F&G: ${fng ? `${fng.value} (${fng.classification})` : 'n/a'} · BTC.D: ${btcDom !== null ? `${btcDom.toFixed(1)}%` : 'n/a'}`].join('\n'),
          '[regime]',
        )
        alerted = res.inserted.length
      }
    }
  }

  return {
    season: regime.season,
    asi90: asi.d90,
    fng: fng ? fng.value : null,
    btcDom,
    flags: regime.flags.length,
    sweep: sweep.length,
    sweepOk: sweep.filter((s) => s.ok).length,
    sources,
    alerted,
    mongo,
  }
}
