#!/usr/bin/env node
// =============================================================================
//  TM TRADING - fixtures cho services (roadmap Phase 8).
//  Pure logic + heartbeat file (temp) — KHÔNG Mongo, KHÔNG network.
//  Run: node services/test.mjs   (wired vào `npm test`)
// =============================================================================
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { evaluateHeartbeat, readHeartbeat, beat, checkOverdue, DEFAULT_INTERVALS } from './heartbeat.mjs'
import { isUsdtPerp, rawKlineToBar } from './binance.mjs'
import { evaluateFunding } from './funding.mjs'
import { parseFeed, scoreNews } from './news.mjs'
import { pickTickers, topMovers, computeStats, detectFlow, detectAccum, detectBreakout } from './scanner.mjs'
import { parseAsi, parseFng, evalRegime, altSweep, pickSweepCandidates, computeSupplyDrift, readUnlocks, REGIME_CFG } from './regime.mjs'
import { estimateZones, readLiqEvents, clusterLiqs, hourBucket, LIQ_CFG } from './liquidation.mjs'
import { combineScore, methodRecencyScore, scoreRegime, scoreFunding, scoreZone, CONFLUENCE_CFG } from './confluence.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const iso = (ms) => new Date(ms).toISOString()
const tmp = mkdtempSync(join(tmpdir(), 'tm-svc-'))

// =============================================================================
section('1. binance helpers')

check('isUsdtPerp: BTCUSDT', isUsdtPerp('BTCUSDT') === true)
check('isUsdtPerp: BTCUSD_ (coin-margined) khong phai', isUsdtPerp('BTCUSD_PERP') === false)
check('isUsdtPerp: junk/null', isUsdtPerp('') === false && isUsdtPerp(null) === false)

const bar = rawKlineToBar([1728000000000, '100', '105', '99', '104', '500', 1728003599999, '52000', '999', '320'])
check('rawKlineToBar giu cot takerBuy (index 9)', bar.takerBuy === 320 && bar.close === 104 && bar.volume === 500)
check('rawKlineToBar reject qua ngan', (() => { try { rawKlineToBar([1, '2']); return false } catch { return true } })())

// =============================================================================
section('2. funding evaluateFunding (pure)')

const F = (symbol, rate) => ({ symbol, rate, nextFundingTime: 1, price: 1 })
const fe = evaluateFunding(
  [F('AUSDT', 0.0001), F('BUSDT', -0.0006), F('CUSDT', 0.0004), F('DUSDT', 0.0005), F('EUSDT', -0.0009)],
  { snapshotN: 3, th: 0.0005 },
)
check('snapshot = top 3 theo |rate|', fe.snapshot.length === 3 && fe.snapshot[0].symbol === 'EUSDT' && fe.snapshot[2].symbol === 'DUSDT')
check('extreme: |rate| >= th (boundary 0.0005 bat buoc)', fe.extremes.length === 3 && fe.extremes.map((e) => e.symbol).join(',') === 'EUSDT,BUSDT,DUSDT')
check('th 0.001 -> khong extrem nao', evaluateFunding([F('AUSDT', 0.0005)], { th: 0.001 }).extremes.length === 0)
check('maxExtremes cap', evaluateFunding([F('A', 0.01), F('B', -0.01), F('C', 0.02)], { th: 0.001, maxExtremes: 2 }).extremes.length === 2)
check('rong -> rong', evaluateFunding([], {}).snapshot.length === 0)

// =============================================================================
section('3. news parseFeed + scoreNews (pure)')

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Hackers steal $100M in bridge exploit]]></title><link>https://x.com/a</link><pubDate>Mon, 04 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[pwned]]></description></item>
<item><title>Plain title</title><link>https://x.com/b</link></item>
<item><title>No link</title></item>
</channel></rss>`
const rss = parseFeed(RSS, 'coindesk')
check('RSS: 2 item hop le (bo cai thieu link)', rss.length === 2)
check('RSS: CDATA title + source + excerpt', rss[0].title.startsWith('Hackers') && rss[0].source === 'coindesk' && rss[0].excerpt === 'pwned')
check('RSS: pubDate parse thanh ts', rss[0].ts > 0 && rss[1].ts === 0)

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>ETF approval</title><link rel="alternate" href="https://y.com/a"/><updated>2026-10-04T10:00:00Z</updated></entry></feed>`
const atom = parseFeed(ATOM, 'x')
check('Atom: link lay tu href', atom.length === 1 && atom[0].link === 'https://y.com/a')
check('Atom: updated parse duoc', atom[0].ts > 0)

const s1 = scoreNews({ title: 'Hackers steal $100M in bridge exploit' })
check('score: hack -> high + neg', s1.level === 'high' && s1.dir === 'neg' && s1.tags.includes('security'), JSON.stringify(s1))
const s2 = scoreNews({ title: 'BlackRock files for spot ETF' })
check('score: etf -> med + pos', s2.level === 'med' && s2.dir === 'pos' && s2.tags.includes('etf'), JSON.stringify(s2))
const s3 = scoreNews({ title: 'Bitcoin price analysis for the week' })
check('score: khong rule -> low', s3.level === 'low' && s3.score === 0)
const s4 = scoreNews({ title: 'SEC sues exchange over ETF listing' })
check('score: cong diem da rule -> high', s4.level === 'high' && s4.score >= 6, String(s4.score))

// =============================================================================
section('4. scanner pick/top/stats/flows (pure)')

const T = (symbol, pct, qv, price = 1) => ({ symbol, priceChangePercent: String(pct), quoteVolume: String(qv), lastPrice: String(price) })
const picked = pickTickers([T('BTCUSDT', 5, 40e6), T('ETHUSDT', 3, 10e6), T('SOLUSDT', -2, 31e6), T('XRPUSD_', 9, 99e6), T('ADAUSDT', 1, 50e6, 0)], { minQuoteVol: 30e6 })
check('pick: USDT + minQuoteVol + lastPrice>0', picked.map((p) => p.symbol).join(',') === 'BTCUSDT,SOLUSDT')
const N = (symbol, pct24h) => ({ symbol, pct24h, quoteVolume: 1, lastPrice: 1 })
const mv = topMovers([N('BTCUSDT', 5), N('SOLUSDT', -9), N('ETHUSDT', 2), N('ADAUSDT', 7)], 2)
check('topMovers: theo |pct| giam dan', mv[0].symbol === 'SOLUSDT' && mv[1].symbol === 'ADAUSDT')

/** Bar phẳng: O=100 H=101 L=99 C=100 V=1000 Taker=500. */
function flatBars(n = 120, over = {}) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1728000000000 + i * 3600000,
    open: over.open ? over.open(i) : 100,
    high: over.high ? over.high(i) : 101,
    low: over.low ? over.low(i) : 99,
    close: over.close ? over.close(i) : 100,
    volume: over.volume ? over.volume(i) : 1000,
    takerBuy: over.takerBuy ? over.takerBuy(i) : 500,
  }))
}

const st0 = computeStats(flatBars())
check('stats: phang -> chg0, volRatio1, taker 0.5, cmf 0, obv 0', st0.chg4h === 0 && st0.volRatio === 1 && st0.takerRatio === 0.5 && st0.cmf === 0 && st0.obvNorm === 0)
check('stats: atrPct ~2% (range 101/99 quanh 100)', Math.abs(st0.atrPct - 2) < 0.01, String(st0.atrPct))
check('stats: rangePct ~2.02 ((101-99)/99)', Math.abs(st0.rangePct - (2 / 99) * 100) < 0.01, String(st0.rangePct))

const stSpike = computeStats(flatBars(120, { volume: (i) => (i >= 115 ? 3000 : 1000), takerBuy: (i) => (i >= 115 ? 1500 : 500) }))
check('stats: vol spike 5 bar cuoi -> volRatio 3', stSpike.volRatio === 3, String(stSpike.volRatio))

const stSell = computeStats(flatBars(120, { takerBuy: (i) => (i >= 100 ? 200 : 500) }))
check('stats: taker 20 bar cuoi 200/1000 -> 0.2', Math.abs(stSell.takerRatio - 0.2) < 1e-9, String(stSell.takerRatio))

// Flow
const f1 = detectFlow(stSpike)
check('flow: volRatio 3 (>=2) -> hit volSpike, dir vol', f1.hit && f1.reasons.includes('volSpike') && f1.dir === 'vol')
const f2 = detectFlow(stSell)
check('flow: taker 0.2 -> takerSell + dir sell (nhung volRatio=1 >= 1.2? khong) -> khong hit', f2.hit === false, JSON.stringify(f2))
const f3 = detectFlow({ ...st0, volRatio: 2.5, takerRatio: 0.65, cmf: 0.25 })
check('flow: takerBuy + cmfIn + spike -> dir buy, hit', f3.hit && f3.dir === 'buy' && f3.reasons.length === 3, JSON.stringify(f3))
const f4 = detectFlow({ ...st0, volRatio: 2.5, takerRatio: 0.3, cmf: -0.25 })
check('flow: takerSell + cmfOut -> dir sell', f4.hit && f4.dir === 'sell')
const f5 = detectFlow({ ...st0, volRatio: 2.5, takerRatio: 0.7, cmf: -0.3 })
check('flow: buy + sell tron nhau -> mixed', f5.hit && f5.dir === 'mixed')

// Accum: bar co gia tang nhe 20 cuoi (obv +) + range hep + phang
const rising = flatBars(120, {
  close: (i) => (i >= 100 ? 100 + (i - 99) * 0.05 : 100),
  high: (i) => (i >= 100 ? 101 + (i - 99) * 0.05 : 101),
  low: (i) => (i >= 100 ? 99 + (i - 99) * 0.05 : 99),
})
const stR = computeStats(rising)
check('accum setup: obvNorm > 0.2, |priceChg48| <= 1.5, range <= 6', stR.obvNorm > 0.2 && Math.abs(stR.priceΔ48) <= 1.5 && stR.rangePct <= 6, JSON.stringify({ obv: stR.obvNorm, p48: stR.priceΔ48, rng: stR.rangePct }))
const a1 = detectAccum(stR)
check('accum: hit + reasons chua range/flat/obvUp', a1.hit && a1.reasons.includes('range') && a1.reasons.includes('obvUp'), JSON.stringify(a1))
const stWide = computeStats(flatBars(120, { low: () => 80, high: () => 120 }))
check('accum: range rong (50%) -> khong hit', detectAccum(stWide).hit === false)
const falling = flatBars(120, { close: (i) => (i >= 100 ? 100 - (i - 99) * 0.05 : 100), high: (i) => (i >= 100 ? 101 - (i - 99) * 0.05 : 101), low: (i) => (i >= 100 ? 99 - (i - 99) * 0.05 : 99) })
const stF = computeStats(falling)
check('accum: obv giam (gia giam 20 bar cuoi) -> khong hit', detectAccum(stF).hit === false, String(stF.obvNorm))

// Breakout
const bo = flatBars(120, { high: (i) => (i >= 99 && i <= 118 ? 100 : 101), close: (i) => (i === 119 ? 100.5 : 100), volume: (i) => (i >= 115 ? 3000 : 1000) })
const stBo = computeStats(bo)
check('breakout: close vuot top 20 + vol 3x -> true', detectBreakout(bo, stBo) === true)
const boNoVol = flatBars(120, { high: (i) => (i >= 99 && i <= 118 ? 100 : 101), close: (i) => (i === 119 ? 100.5 : 100) })
check('breakout: cung gia nhung khong volume -> false', detectBreakout(boNoVol, computeStats(boNoVol)) === false)

// =============================================================================
section('5. heartbeat D9 (temp file)')

const hbFile = join(tmp, 'services.json')
check('read: file thieu -> rong', readHeartbeat(hbFile).services && Object.keys(readHeartbeat(hbFile).services).length === 0)
writeFileSync(hbFile, '{corrupt json')
check('read: file hong -> rong (fail-soft)', Object.keys(readHeartbeat(hbFile).services).length === 0)

const NOW = Date.now()
beat('news', { lastRunAt: iso(NOW - 10_000), lastOkAt: iso(NOW - 10_000) }, hbFile)
beat('scanner', { lastRunAt: iso(NOW - 1900_000), lastOkAt: iso(NOW - 1900_000), count: 5 }, hbFile)
const hb1 = readHeartbeat(hbFile)
check('beat: ghi + merge + intervalSec mac dinh (news=600)', hb1.services.news.intervalSec === DEFAULT_INTERVALS.news && hb1.services.news.lastOkAt !== undefined && hb1.services.news.lastRunAt !== undefined)
check('beat: giu field cu khi patch moi (scanner.count=5)', hb1.services.scanner.count === 5 && hb1.services.scanner.lastOkAt !== undefined)

const rows = evaluateHeartbeat(hb1, NOW)
const rNews = rows.find((r) => r.name === 'news')
const rScan = rows.find((r) => r.name === 'scanner')
check('eval: 10s truoc -> OK', rNews.overdue === false && rNews.overdueSec === 10)
check('eval: 1900s truoc > 2*900 -> DEAD', rScan.overdue === true && rScan.overdueSec === 1900, JSON.stringify(rScan))
check('eval: boundary = 2*ky KHONG overdue (1800 vs 1800)', evaluateHeartbeat({ services: { a: { intervalSec: 900, lastOkAt: iso(NOW - 1800_000) } } }, NOW)[0].overdue === false)
check('eval: vuot 1s -> overdue', evaluateHeartbeat({ services: { a: { intervalSec: 900, lastOkAt: iso(NOW - 1801_000) } } }, NOW)[0].overdue === true)
check('eval: chua chay nao + file cu 2000s -> DEAD', evaluateHeartbeat({ updatedAt: iso(NOW - 2000_000), services: { a: { intervalSec: 900 } } }, NOW)[0].overdue === true)
check('eval: chua chay + file moi -> OK (grace khi boot)', evaluateHeartbeat({ updatedAt: iso(NOW - 1000), services: { a: { intervalSec: 900 } } }, NOW)[0].overdue === false)
check('eval: chi co lastErrorAt (khong ok) -> tinh tu lastRunAt', evaluateHeartbeat({ services: { a: { intervalSec: 300, lastRunAt: iso(NOW - 700_000), lastError: 'boom' } } }, NOW)[0].overdue === true)

// checkOverdue: fake send + remind dedupe
const hb2File = join(tmp, 'hb2.json')
beat('funding', { lastRunAt: iso(NOW - 4000_000), lastOkAt: iso(NOW - 4000_000), intervalSec: 900 }, hb2File)
const sent1 = []
const r1 = await checkOverdue({ file: hb2File, now: NOW, send: async (t) => { sent1.push(t); return true } })
check('checkOverdue: DEAD -> gui TG 1 lan', r1.overdue.length === 1 && r1.alerted.join(',') === 'funding' && sent1.length === 1 && sent1[0].includes('funding'))
const sent2 = []
const r2 = await checkOverdue({ file: hb2File, now: NOW + 60_000, send: async (t) => { sent2.push(t); return true } })
check('checkOverdue: ngay sau do -> khong spam (remind 6h)', r2.alerted.length === 0 && sent2.length === 0)
const sent3 = []
await checkOverdue({ file: hb2File, now: NOW + 7 * 3600_000, send: async (t) => { sent3.push(t); return true } })
check('checkOverdue: sau 7h -> nhac lai', sent3.length === 1)
const hb3File = join(tmp, 'hb3.json')
beat('oksvc', { lastOkAt: iso(NOW), intervalSec: 900 }, hb3File)
const r4 = await checkOverdue({ file: hb3File, now: NOW, send: async () => { throw new Error('khong duoc gui') } })
check('checkOverdue: service OK -> khong gui, khong loi', r4.overdue.length === 0 && r4.alerted.length === 0)

// =============================================================================
section('6. regime parse/eval/sweep (pure — Phase 9)')

// parseAsi: latestScores (escaped JSON trong Next.js payload)
const ASI_HTML = `<html><head><meta content="57% · It is not Altcoin Season"/></head><body><script>self.__next_f.push([1,"latestScores\":{\\"30\\":78,\\"90\\":57,\\"365\\":37}])</script></body></html>`
const asi1 = parseAsi(ASI_HTML)
check('parseAsi: latestScores 30/90/365', asi1 && asi1.d30 === 78 && asi1.d90 === 57 && asi1.d365 === 37, JSON.stringify(asi1))
const asi2 = parseAsi('<html><meta content="81% · It is Altcoin Season"/></html>')
check('parseAsi: og fallback (khong "not")', asi2 && asi2.d90 === 81 && asi2.d30 === null, JSON.stringify(asi2))
const asi3 = parseAsi('<html>no data here</html>')
check('parseAsi: khong ca 2 nguon -> null', asi3 === null)
check('parseAsi: input rong/nil -> null', parseAsi('') === null && parseAsi(null) === null && parseAsi(undefined) === null)
const asi4 = parseAsi('latestScores":{"30":78,"365":37}<meta content="57% · It is not Altcoin Season"/>')
check('parseAsi: latestScores thieu d90 -> og fallback', asi4 && asi4.d90 === 57 && asi4.d30 === 78, JSON.stringify(asi4))

// parseFng — API that tra `value_classification` (alias `classification` van doc duoc)
const fng1 = parseFng({ data: [{ value: '65', value_classification: 'Greed' }, { value: '60', value_classification: 'Greed' }] })
check('parseFng: value_classification + avg30 round', fng1 && fng1.value === 65 && fng1.classification === 'Greed' && fng1.avg30 === 63, JSON.stringify(fng1))
check('parseFng: alias classification cu van doc duoc', parseFng({ data: [{ value: '10', classification: 'Extreme Fear' }] })?.classification === 'Extreme Fear')
check('parseFng: rong/nil -> null', parseFng({ data: [] }) === null && parseFng({}) === null && parseFng(null) === null)
check('parseFng: toan so khong hop le -> null', parseFng({ data: [{ value: 'x' }] }) === null)

// evalRegime — boundary season 75/25
check('eval: d90=75 -> alt (boundary >=)', evalRegime({ asi: { d90: 75 } }).season === 'alt')
check('eval: d90=74 -> neutral', evalRegime({ asi: { d90: 74 } }).season === 'neutral')
check('eval: d90=25 -> btc (boundary <=)', evalRegime({ asi: { d90: 25 } }).season === 'btc')
check('eval: d90=26 -> neutral', evalRegime({ asi: { d90: 26 } }).season === 'neutral')
check('eval: thieu asi -> neutral', evalRegime({}).season === 'neutral')
// flags F&G boundary
check('eval: fng=25 -> fear-extreme (boundary <=)', evalRegime({ fng: { value: 25 } }).flags.includes('fear-extreme'))
check('eval: fng=26 -> khong co fear', !evalRegime({ fng: { value: 26 } }).flags.includes('fear-extreme'))
check('eval: fng=75 -> greed-extreme (boundary >=)', evalRegime({ fng: { value: 75 } }).flags.includes('greed-extreme'))
// unlock 48h window
const NOWT = Date.UTC(2026, 9, 4, 0, 0, 0)
const evUnlock = evalRegime({
  now: NOWT,
  unlocks: [
    { symbol: 'ZRD', ts: NOWT + 49 * 3600_000, label: 'qua 48h' },
    { symbol: 'ARD', ts: NOWT + 1 * 3600_000, label: 'somp' },
    { symbol: 'BRD', ts: NOWT + 2 * 3600_000, label: 'second' },
    { symbol: 'XRD', ts: NOWT - 3600_000, label: 'qua khu' },
  ],
})
check('eval: unlock trong 48h -> flag + list, sap xep theo ts', evUnlock.flags.includes('unlock-48h') && evUnlock.unlocks48h.map((u) => u.symbol).join(',') === 'ARD,BRD', JSON.stringify(evUnlock.unlocks48h))
const evNoUnlock = evalRegime({ now: NOWT, unlocks: [{ symbol: 'ZRD', ts: NOWT + 49 * 3600_000, label: 'x' }] })
check('eval: unlock 49h -> khong tinh', !evNoUnlock.flags.includes('unlock-48h') && evNoUnlock.unlocks48h.length === 0)
// supply drift flag cap 5
const drifts = Array.from({ length: 7 }, (_, i) => ({ symbol: `S${i}`, flag: true }))
check('eval: supply-drift flag toi da 5', evalRegime({ supplyDrift: drifts }).flags.filter((f) => f.startsWith('supply-drift:')).length === 5)

// pickSweepCandidates — loai BTC/stable + topN
const cand = pickSweepCandidates([
  { symbol: 'BTCUSDT', quoteVolume: '999', lastPrice: '1' },
  { symbol: 'SOLUSDT', quoteVolume: '50', lastPrice: '2' },
  { symbol: 'XRPUSDT', quoteVolume: '90', lastPrice: '3' },
  { symbol: 'USDCUSDT', quoteVolume: '80', lastPrice: '4' },
  { symbol: 'ADAUSDT', quoteVolume: '70', price: '5' },
  { symbol: 'ETHUSD_', quoteVolume: '60', lastPrice: '6' },
], { topN: 3 })
check('pick: loai BTC/stable/khong USDT + top 3 theo vol', cand.map((c) => c.symbol).join(',') === 'XRPUSDT,ADAUSDT,SOLUSDT', JSON.stringify(cand))
check('pick: lay price + cat bo quoteVolume/base', cand[0].price === 3 && cand[0].quoteVolume === 90 && !('base' in cand[0]))

// altSweep — cac cap block hop le
const SW_OK = altSweep({
  season: 'alt',
  candidates: [{ symbol: 'SOLUSDT' }],
  fundingBySymbol: { SOLUSDT: 0.0001 },
  oiTrendBySymbol: { SOLUSDT: 5.2 },
})[0]
check('sweep: alt + funding ok + oi tang -> ok', SW_OK.ok === true && SW_OK.reasons.join(',').includes('altseason') && SW_OK.rate === 0.0001 && SW_OK.oiTrendPct === 5.2, JSON.stringify(SW_OK))
const SW_SEASON = altSweep({ season: 'neutral', candidates: [{ symbol: 'AUSDT' }], fundingBySymbol: { AUSDT: 0.0001 }, oiTrendBySymbol: { AUSDT: 1 } })[0]
check('sweep: season khong phai alt -> chan', SW_SEASON.ok === false && SW_SEASON.blockers.includes('season:neutral'))
const SW_FUND = altSweep({ season: 'alt', candidates: [{ symbol: 'BUSDT' }], fundingBySymbol: { BUSDT: 0.0006 }, oiTrendBySymbol: { BUSDT: 1 } })[0]
check('sweep: funding 0.06% >= th 0.05% -> chan', SW_FUND.blockers.some((b) => b.startsWith('funding:0.0600')), JSON.stringify(SW_FUND.blockers))
const SW_UNK = altSweep({ season: 'alt', candidates: [{ symbol: 'CUSDT' }] })[0]
check('sweep: thieu funding + oi -> 2 unknown trung thuong', SW_UNK.blockers.includes('funding:unknown') && SW_UNK.blockers.includes('oi-trend:unknown') && SW_UNK.rate === null)
const SW_OI0 = altSweep({ season: 'alt', candidates: [{ symbol: 'DUSDT' }], fundingBySymbol: { DUSDT: 0.0001 }, oiTrendBySymbol: { DUSDT: 0 } })[0]
check('sweep: oi=0 -> chan (chi tang moi dat)', SW_OI0.blockers.some((b) => b.startsWith('oi:')))
const SW_UL = altSweep({ season: 'alt', candidates: [{ symbol: 'EUSDT' }], fundingBySymbol: { EUSDT: 0.0001 }, oiTrendBySymbol: { EUSDT: 3 }, unlock48Symbols: ['EUSDT'] })[0]
check('sweep: unlock 48h -> chan', SW_UL.ok === false && SW_UL.blockers.includes('unlock:48h'))
check('sweep: rong -> rong', altSweep({}).length === 0)

// computeSupplyDrift
const T0 = Date.UTC(2026, 9, 4)
const dPrev = [{ symbol: 'AAA', data: { circulating: 100 }, ts: T0 - 86_400_000 }]
const d1 = computeSupplyDrift(dPrev, [{ symbol: 'AAA', circulating: 110 }], T0)
check('drift: +10%/ngay -> flag (th 0.2)', d1[0].driftPctPerDay === 10 && d1[0].flag === true, JSON.stringify(d1))
const d2 = computeSupplyDrift([], [{ symbol: 'BBB', circulating: 50 }], T0)
check('drift: khong co snapshot truoc -> null + khong flag', d2[0].driftPctPerDay === null && d2[0].flag === false)
const d3 = computeSupplyDrift([{ symbol: 'CCC', data: { circulating: 100 }, ts: T0 - 86_400_000 }], [{ symbol: 'CCC', circulating: 100.2 }], T0)
check('drift: chinh bang th 0.2 -> flag (boundary >=)', d3[0].flag === true, String(d3[0].driftPctPerDay))
const d4 = computeSupplyDrift([{ symbol: 'DDD', data: { circulating: 100 }, ts: T0 - 86_400_000 }], [{ symbol: 'DDD', circulating: 100.19 }], T0)
check('drift: 0.19 < 0.2 -> khong flag', d4[0].flag === false, String(d4[0].driftPctPerDay))
const d5 = computeSupplyDrift([{ symbol: 'EEE', data: { circulating: 100 }, ts: new Date(T0 - 3600_000) }], [{ symbol: 'EEE', circulating: 101 }], T0)
check('drift: ts la Date van doc duoc (1h -> 24%/ngay)', d5[0].flag === true && d5[0].driftPctPerDay === 24, JSON.stringify(d5))

// readUnlocks — temp file
const ulFile = join(tmp, 'unlocks.json')
writeFileSync(ulFile, JSON.stringify([
  { symbol: 'arb', date: iso(NOWT + 3600_000), label: 'Team unlock' },
  { symbol: 'NO_DATE', label: 'thieu ngay' },
]))
const ul1 = readUnlocks(ulFile)
check('unlocks: parse + upper + bo entry thieu ngay', ul1.length === 1 && ul1[0].symbol === 'ARB' && ul1[0].ts === NOWT + 3600_000 && ul1[0].label === 'Team unlock', JSON.stringify(ul1))
check('unlocks: file thieu -> []', readUnlocks(join(tmp, 'khong-ton-tai.json')).length === 0)
writeFileSync(join(tmp, 'bad.json'), '{oops')
check('unlocks: file hong -> [] (fail-soft)', readUnlocks(join(tmp, 'bad.json')).length === 0)
writeFileSync(join(tmp, 'obj.json'), '{"a":1}')
check('unlocks: khong phai mang -> []', readUnlocks(join(tmp, 'obj.json')).length === 0)

// =============================================================================
section('7. liquidation estimate/events/cluster (pure — Phase 9)')

const Z = estimateZones({ markPx: 100, oiUsd: 1_000_000_000, bands: [{ lev: 10, w: 1 }], mmr: 0.004 })
check('zones: lev10 dist 9.6% — long duoi mark, short tren mark', Z.length === 2 && Z[0].side === 'long' && Math.abs(Z[0].price - 90.4) < 1e-9 && Math.abs(Z[0].pct + 9.6) < 1e-9 && Z[1].side === 'short' && Math.abs(Z[1].price - 109.6) < 1e-9 && Z[1].usd === 1_000_000_000, JSON.stringify(Z))
check('zones: markPx/oi khong hop le -> []', estimateZones({ markPx: 0, oiUsd: 1e9 }).length === 0 && estimateZones({ markPx: 100, oiUsd: 0 }).length === 0 && estimateZones({}).length === 0)
check('zones: dist <= 0 (lev 500) -> bo qua', estimateZones({ markPx: 100, oiUsd: 1e6, bands: [{ lev: 500, w: 1 }], mmr: 0.004 }).length === 0)
const Zdef = estimateZones({ markPx: 100, oiUsd: 700_000_000 })
const longs = Zdef.filter((z) => z.side === 'long')
check('zones: mac dinh 7 bang x 2 = 14 row', Zdef.length === 14)
check('zones: sum(w)=1 -> tong long usd = OI', longs.reduce((s, z) => s + z.usd, 0) === 700_000_000)
check('zones: tat ca long < mark, short > mark', longs.every((z) => z.price < 100) && Zdef.filter((z) => z.side === 'short').every((z) => z.price > 100))

// readLiqEvents — ndjson windowed
const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0)
const liqFile = join(tmp, 'liq.ndjson')
writeFileSync(liqFile, [
  JSON.stringify({ symbol: 'BTCUSDT', price: 100000, usd: 30000, side: 'long', ts: NOW_MS - 60_000 }),
  JSON.stringify({ symbol: 'ETHUSDT', price: 3000, usd: 10000, ts: NOW_MS - 60_000 }), // thieu side -> long
  JSON.stringify({ symbol: 'OLDUSDT', price: 1, usd: 1, ts: NOW_MS - 7 * 3600_000 }), // qua cua so
  JSON.stringify({ symbol: 'FUTUSDT', price: 1, usd: 1, ts: NOW_MS + 3600_000 }), // tuong lai qua 60s
  '{corrupt json',
  '',
].join('\n') + '\n')
const evs = readLiqEvents({ file: liqFile, now: NOW_MS, windowH: 6 })
check('liq events: chi giu trong cua so + bo corrupt/future', evs.length === 2 && evs[0].symbol === 'BTCUSDT' && evs[1].side === 'long', JSON.stringify(evs))
check('liq events: file thieu -> []', readLiqEvents({ file: join(tmp, 'none.ndjson'), now: NOW_MS }).length === 0)

// clusterLiqs — bin 1% quanh ref (event dau) + minUsd
const cl = clusterLiqs([
  { symbol: 'BTCUSDT', price: 100000, usd: 30000, side: 'long', ts: 1 },
  { symbol: 'BTCUSDT', price: 100100, usd: 25000, side: 'long', ts: 2 },
  { symbol: 'BTCUSDT', price: 102000, usd: 20000, side: 'long', ts: 3 },
])
check('cluster: 2 event cung bin (0.1%) -> 1 cum 55k, n=2, gia TB', cl.length === 1 && cl[0].usd === 55000 && cl[0].n === 2 && cl[0].price === 100050, JSON.stringify(cl))
const cl2 = clusterLiqs([
  { symbol: 'BTCUSDT', price: 100000, usd: 30000, side: 'long', ts: 1 },
  { symbol: 'BTCUSDT', price: 98500, usd: 60000, side: 'short', ts: 2 },
], { minUsd: 1000 })
check('cluster: khac bin/khac side -> rieng, sort theo usd giam', cl2.length === 2 && cl2[0].usd === 60000 && cl2[1].usd === 30000, JSON.stringify(cl2))
const cl3 = clusterLiqs([{ symbol: 'A', price: 100, usd: 40000, side: 'long', ts: 1 }])
check('cluster: duoi minUsd (50k mac dinh) -> loc', cl3.length === 0)
check('cluster: rong -> []', clusterLiqs([]).length === 0 && clusterLiqs(null).length === 0)

check('hourBucket: chia nguyen 3_600_000', hourBucket(3_600_000) === 1 && hourBucket(3_599_999) === 0)

  check('heartbeat: 7 services mac dinh (Phase 11)', ['news', 'scanner', 'funding', 'regime', 'liquidation', 'confluence', 'brief'].every((k) => typeof DEFAULT_INTERVALS[k] === 'number' && DEFAULT_INTERVALS[k] > 0), JSON.stringify(DEFAULT_INTERVALS))
check('regime cfg: nguong 75/25 + sweep top12', REGIME_CFG.asiAlt === 75 && REGIME_CFG.asiBtc === 25 && REGIME_CFG.sweepTopN === 12)
check('liq cfg: 7 bang sum(w)=1', LIQ_CFG.bands.length === 7 && Math.abs(LIQ_CFG.bands.reduce((s, b) => s + b.w, 0) - 1) < 1e-9)

// =============================================================================
section('8. confluence diem gop (pure — Phase 10)')

const approx = (a, b, e = 1e-9) => Math.abs(a - b) < e

check('cfg: weights sum = 1 (0.4/0.2/0.2/0.2)',
  CONFLUENCE_CFG.weights.method === 0.4 && CONFLUENCE_CFG.weights.regime === 0.2
  && CONFLUENCE_CFG.weights.funding === 0.2 && CONFLUENCE_CFG.weights.zone === 0.2)

// combineScore — tong trong so, fail-soft NaN, clamp [-1,1]
check('combine: toan 0 -> 0', combineScore({ method: 0, regime: 0, funding: 0, zone: 0 }) === 0)
check('combine: toan 1 -> 1', approx(combineScore({ method: 1, regime: 1, funding: 1, zone: 1 }), 1))
check('combine: thieu phan -> coi nhu 0 (chi method 1 -> 0.4)', approx(combineScore({ method: 1 }), 0.4))
check('combine: null -> 0', combineScore(null) === 0)
check('combine: NaN giua cac phan -> bo qua, tinh phan con lai', approx(combineScore({ method: NaN, regime: 0.5, funding: 0, zone: 0 }), 0.1))
check('combine: vuot [-1,1] -> clamp', combineScore({ method: 5, regime: 5, funding: 5, zone: 5 }) === 1
  && combineScore({ method: -9, regime: -9, funding: -9, zone: -9 }) === -1)
check('combine: trong so cu the — method 1 + regime 0.5 -> 0.4+0.1 = 0.5', approx(combineScore({ method: 1, regime: 0.5 }), 0.5))

// methodRecencyScore — mean scores o N bar cuoi
check('recency: mean cua n bar cuoi (3 cuoi cua [1,1,-1,-1,1] = [-1,-1,1] -> -1/3)', approx(methodRecencyScore([1, 1, -1, -1, 1], 3), -1 / 3))
check('recency: n > do dai -> mean toan bo', approx(methodRecencyScore([1, -1, 1], 99), 1 / 3))
check('recency: rong/null -> 0', methodRecencyScore([], 5) === 0 && methodRecencyScore(null, 5) === 0)
check('recency: toan NaN -> 0', methodRecencyScore([NaN, NaN], 5) === 0)
check('recency: vuot [-1,1] -> clamp', methodRecencyScore([5, 5], 2) === 1)

// scoreRegime — season + F&G contrarian
check('regime: null -> 0', scoreRegime(null, 'BTCUSDT') === 0)
check('regime: alt-season + alt symbol -> +0.2', scoreRegime({ season: 'alt' }, 'SOLUSDT') === 0.2)
check('regime: alt-season + BTC -> -0.05', scoreRegime({ season: 'alt' }, 'BTCUSDT') === -0.05)
check('regime: btc-season: BTC +0.2, alt -0.1', scoreRegime({ season: 'btc' }, 'BTCUSDT') === 0.2 && scoreRegime({ season: 'btc' }, 'SOLUSDT') === -0.1)
check('regime: neutral -> 0 (khong F&G)', scoreRegime({ season: 'neutral' }, 'SOLUSDT') === 0)
check('regime: fear-extreme (<=25) +0.15 / greed-extreme (>=75) -0.15',
  scoreRegime({ fng: { value: 25 } }, 'SOLUSDT') === 0.15 && scoreRegime({ fng: { value: 75 } }, 'SOLUSDT') === -0.15)
check('regime: F&G binhThuong 50 -> 0', scoreRegime({ fng: { value: 50 } }, 'SOLUSDT') === 0)
check('regime: alt + fear-extreme cong them 0.35', approx(scoreRegime({ season: 'alt', fng: { value: 10 } }, 'DOGEUSDT'), 0.35))

// scoreFunding — crowded long am, crowded short duong, nguong 3bp/8h
check('funding: null/NaN -> 0', scoreFunding(null) === 0 && scoreFunding(NaN) === 0)
check('funding: +0.0003 (crowded long) -> -1', scoreFunding(0.0003) === -1)
check('funding: -0.0003 (crowded short) -> +1', scoreFunding(-0.0003) === 1)
check('funding: nua nguong +0.00015 -> -0.5', approx(scoreFunding(0.00015), -0.5))
check('funding: 0 -> 0', scoreFunding(0) === 0)
check('funding: vuot nguong -> clamp', scoreFunding(0.01) === -1 && scoreFunding(-0.01) === 1)

// scoreZone — L/S crowding + cascade fuel + actual
check('zone: null -> 0', scoreZone(null) === 0)
check('zone: L/S 3.0 (crowded long) -> -0.2', scoreZone({ lsRatio: 3.0, est: [], actual: [] }) === -0.2)
check('zone: L/S 0.5 (crowded short) -> +0.2', scoreZone({ lsRatio: 0.5 }) === 0.2)
check('zone: L/S 1.5 binhThuong -> 0', scoreZone({ lsRatio: 1.5 }) === 0)
check('zone: boundary L/S — 2.5/0.7 khong tru, 2.51/0.69 co',
  scoreZone({ lsRatio: 2.5 }) === 0 && scoreZone({ lsRatio: 2.51 }) === -0.2
  && scoreZone({ lsRatio: 0.7 }) === 0 && scoreZone({ lsRatio: 0.69 }) === 0.2)
check('zone: vung long -1.5% duoi gia -> -0.3 (cascade fuel)', scoreZone({ est: [{ side: 'long', pct: -1.5 }] }) === -0.3)
check('zone: boundary pct — -2.5 tru, -2.6 khong',
  scoreZone({ est: [{ side: 'long', pct: -2.5 }] }) === -0.3 && scoreZone({ est: [{ side: 'long', pct: -2.6 }] }) === 0)
check('zone: chon vung gan nhat trong nhieu vung long', scoreZone({ est: [{ side: 'long', pct: -8 }, { side: 'long', pct: -2 }] }) === -0.3)
check('zone: est short khong tinh (chi vung duong duoi)', scoreZone({ est: [{ side: 'short', pct: 2 }] }) === 0)
check('zone: actual long vua qua -> -0.15, actual short khong',
  scoreZone({ actual: [{ side: 'long', price: 1, usd: 1, n: 1 }] }) === -0.15
  && scoreZone({ actual: [{ side: 'short' }] }) === 0)
check('zone: 3 dieu kien cung xay -> -0.65 (-0.2-0.3-0.15)',
  approx(scoreZone({ lsRatio: 3, est: [{ side: 'long', pct: -1 }], actual: [{ side: 'long' }] }), -0.65))

rmSync(tmp, { recursive: true, force: true })

// =============================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
