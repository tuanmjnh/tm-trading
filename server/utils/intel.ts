import type { IntelAccum, IntelConfluence, IntelData, IntelFlow, IntelFunding, IntelMover, IntelNewsItem, IntelRegime, IntelServiceRow, IntelZone } from '../../types/intel'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineModel } from './engineModel'

// =============================================================================
//  DOC MARKET INTEL CHO DASHBOARD — roadmap Phase 8 (+ heartbeat D9).
//
//  `intel` doc truc tiep collection (engineModel — 1 nguon, fail-soft Mongo
//  down -> 200 + mongo='down'). Heartbeat doc CUNG services/heartbeat.mjs
//  (dynamic import process.cwd() — dung cach cua engineModel vi Nitro bundle
//  khong tinh duong dan tuong doi ra ngoai server/).
// =============================================================================

type HeartbeatMod = typeof import('../../services/heartbeat.mjs')

let hbMod: Promise<HeartbeatMod> | null = null
function heartbeatMod(): Promise<HeartbeatMod> {
  if (!hbMod) {
    const file = pathToFileURL(join(process.cwd(), 'services', 'heartbeat.mjs')).href
    hbMod = import(/* @vite-ignore */ file) as Promise<HeartbeatMod>
  }
  return hbMod
}

/** Trang thai cac services (D9) — rong neu services chua chay/loi doc file. */
export async function loadServicesStatus(now: number = Date.now()): Promise<IntelServiceRow[]> {
  try {
    const m = await heartbeatMod()
    return m.evaluateHeartbeat(m.readHeartbeat(), now)
  } catch {
    return []
  }
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

function dataOf(doc: any): any {
  return doc?.data && typeof doc.data === 'object' ? doc.data : {}
}

export function toMover(doc: any): IntelMover {
  const d = dataOf(doc)
  return {
    symbol: String(doc?.symbol ?? d.symbol ?? ''),
    pct24h: num(d.pct24h),
    chg4h: num(d.chg4h),
    quoteVolume: num(d.quoteVolume),
    lastPrice: num(d.lastPrice),
    breakout: !!d.breakout,
    atrPct: num(d.atrPct),
  }
}

export function toFlow(doc: any): IntelFlow {
  const d = dataOf(doc)
  const dir = d.dir
  return {
    symbol: String(doc?.symbol ?? ''),
    dir: dir === 'buy' || dir === 'sell' || dir === 'mixed' ? dir : 'vol',
    reasons: Array.isArray(d.reasons) ? d.reasons.map((x: unknown) => String(x)) : [],
    volRatio: num(d.volRatio),
    takerRatio: num(d.takerRatio),
    cmf: num(d.cmf),
    pct24h: num(d.pct24h),
    score: num(d.score),
  }
}

export function toAccum(doc: any): IntelAccum {
  const d = dataOf(doc)
  return {
    symbol: String(doc?.symbol ?? ''),
    reasons: Array.isArray(d.reasons) ? d.reasons.map((x: unknown) => String(x)) : [],
    rangePct: num(d.rangePct),
    priceChg48: num(d.priceChg48),
    obvNorm: num(d.obvNorm),
    volRatio: num(d.volRatio),
    pct24h: num(d.pct24h),
  }
}

export function toFunding(doc: any): IntelFunding {
  const d = dataOf(doc)
  return {
    symbol: String(doc?.symbol ?? ''),
    rate: num(d.rate),
    pct: num(d.pct),
    nextFundingTime: num(d.nextFundingTime),
    price: num(d.price),
    oiContracts: typeof d.oiContracts === 'number' ? d.oiContracts : null,
    oiNotionalUsd: typeof d.oiNotionalUsd === 'number' ? d.oiNotionalUsd : null,
  }
}

export function toNews(doc: any): IntelNewsItem {
  const d = dataOf(doc)
  const level = d.level === 'high' ? 'high' : 'med'
  const dir = d.dir === 'pos' || d.dir === 'neg' ? d.dir : 'flat'
  const ts = doc?.ts ? new Date(doc.ts) : null
  return {
    title: String(doc?.title ?? ''),
    link: String(d.link ?? ''),
    source: String(d.source ?? ''),
    level,
    dir,
    tags: Array.isArray(d.tags) ? d.tags.map((x: unknown) => String(x)) : [],
    score: num(doc?.score ?? d.score),
    ts: ts && !Number.isNaN(ts.getTime()) ? ts.toISOString() : '',
    excerpt: String(d.excerpt ?? ''),
  }
}

/** Regime doc (Phase 9) — doc an toan, thieu truong -> mac dinh. */
export function toRegime(doc: any): IntelRegime {
  const d = dataOf(doc)
  const season = d.season === 'alt' || d.season === 'btc' ? d.season : 'neutral'
  const asiRaw = d.asi && typeof d.asi === 'object' ? d.asi : null
  const fngRaw = d.fng && typeof d.fng === 'object' ? d.fng : null
  const ts = doc?.ts ? new Date(doc.ts) : null
  return {
    season,
    asi: asiRaw
      ? { d30: typeof asiRaw.d30 === 'number' ? asiRaw.d30 : null, d90: typeof asiRaw.d90 === 'number' ? asiRaw.d90 : null, d365: typeof asiRaw.d365 === 'number' ? asiRaw.d365 : null }
      : null,
    fng: fngRaw
      ? { value: num(fngRaw.value), classification: String(fngRaw.classification ?? ''), avg30: typeof fngRaw.avg30 === 'number' ? fngRaw.avg30 : null }
      : null,
    btcDom: typeof d.btcDom === 'number' ? d.btcDom : null,
    ethDom: typeof d.ethDom === 'number' ? d.ethDom : null,
    mcapChg24h: typeof d.mcapChg24h === 'number' ? d.mcapChg24h : null,
    flags: Array.isArray(d.flags) ? d.flags.map((x: unknown) => String(x)) : [],
    unlocks48h: Array.isArray(d.unlocks48h)
      ? d.unlocks48h.map((u: any) => ({ symbol: String(u?.symbol ?? ''), date: String(u?.date ?? ''), label: String(u?.label ?? '') }))
      : [],
    supplyDrift: Array.isArray(d.supplyDrift)
      ? d.supplyDrift.map((s: any) => ({ symbol: String(s?.symbol ?? ''), circulating: num(s?.circulating), driftPctPerDay: typeof s?.driftPctPerDay === 'number' ? s.driftPctPerDay : null }))
      : [],
    sweep: Array.isArray(d.sweep)
      ? d.sweep.map((s: any) => ({
          symbol: String(s?.symbol ?? ''),
          ok: !!s?.ok,
          reasons: Array.isArray(s?.reasons) ? s.reasons.map((x: unknown) => String(x)) : [],
          blockers: Array.isArray(s?.blockers) ? s.blockers.map((x: unknown) => String(x)) : [],
          rate: typeof s?.rate === 'number' ? s.rate : null,
          oiTrendPct: typeof s?.oiTrendPct === 'number' ? s.oiTrendPct : null,
        }))
      : [],
    sources: d.sources && typeof d.sources === 'object' ? d.sources : {},
    ts: ts && !Number.isNaN(ts.getTime()) ? ts.toISOString() : '',
  }
}

/** Zone thanh ly 1 symbol (Phase 9) — est gia modal, actual tu file forceOrder. */
export function toZone(doc: any): IntelZone {
  const d = dataOf(doc)
  const ts = doc?.ts ? new Date(doc.ts) : null
  return {
    symbol: String(doc?.symbol ?? ''),
    markPx: num(d.markPx),
    oiUsd: typeof d.oiUsd === 'number' ? d.oiUsd : null,
    lsRatio: typeof d.lsRatio === 'number' ? d.lsRatio : null,
    est: Array.isArray(d.est)
      ? d.est.map((e: any) => ({
          lev: num(e?.lev),
          side: e?.side === 'short' ? ('short' as const) : ('long' as const),
          price: num(e?.price),
          pct: num(e?.pct),
          usd: num(e?.usd),
        }))
      : [],
    actual: Array.isArray(d.actual)
      ? d.actual.map((a: any) => ({
          side: a?.side === 'short' ? ('short' as const) : ('long' as const),
          price: num(a?.price),
          usd: num(a?.usd),
          n: num(a?.n),
        }))
      : [],
    ts: ts && !Number.isNaN(ts.getTime()) ? ts.toISOString() : '',
  }
}

/** Diem gop hang ngay (Phase 10) — doc an toan, thieu truong -> mac dinh. */
export function toConfluence(doc: any): IntelConfluence {
  const d = dataOf(doc)
  const p = d.parts && typeof d.parts === 'object' ? d.parts : {}
  const ts = doc?.ts ? new Date(doc.ts) : null
  return {
    symbol: String(doc?.symbol ?? ''),
    score: num(d.score),
    parts: {
      method: num(p.method),
      regime: num(p.regime),
      funding: num(p.funding),
      zone: num(p.zone),
    },
    rank: num(d.rank),
    tf: String(d.tf || '60'),
    bars: num(d.bars),
    src: String(d.src || ''),
    ts: ts && !Number.isNaN(ts.getTime()) ? ts.toISOString() : '',
  }
}

const EMPTY = (mongo: 'up' | 'down', services: IntelServiceRow[]): IntelData => ({
  mongo,
  generatedAt: null,
  movers: [],
  flows: [],
  accums: [],
  funding: [],
  news: [],
  regime: null,
  zones: [],
  confluence: [],
  services,
})

export async function loadIntelData(now: Date = new Date()): Promise<IntelData> {
  const services = await loadServicesStatus(now.getTime())
  const Intel = await engineModel('intel.mjs', 'Intel')
  if (!Intel) return EMPTY('down', services)

  try {
    const [movers, flows, accums, funding, news, regimeDocs, zones, confluence] = await Promise.all([
      Intel.find({ kind: 'mover' }).sort({ ts: -1 }).limit(8).lean(),
      Intel.find({ kind: 'flow' }).sort({ 'data.score': -1, ts: -1 }).limit(8).lean(),
      Intel.find({ kind: 'accum' }).sort({ ts: -1 }).limit(8).lean(),
      Intel.find({ kind: 'funding' }).sort({ 'data.pct': -1, ts: -1 }).limit(15).lean(),
      Intel.find({ kind: 'news' }).sort({ ts: -1 }).limit(6).lean(),
      Intel.find({ kind: 'regime' }).sort({ ts: -1 }).limit(1).lean(),
      Intel.find({ kind: 'zone' }).sort({ score: -1, ts: -1 }).limit(12).lean(),
      // Phase 10 — rank da sort trong service; giu theo score de doc vong lap
      // sau saveSnapshot (row.score = tong [-1,1], desc).
      Intel.find({ kind: 'confluence' }).sort({ score: -1, ts: -1 }).limit(10).lean(),
    ])
    const generated = movers[0]?.ts ?? funding[0]?.ts ?? regimeDocs[0]?.ts ?? confluence[0]?.ts ?? null
    return {
      mongo: 'up',
      generatedAt: generated ? new Date(generated as string | number | Date).toISOString() : null,
      movers: movers.map(toMover),
      flows: flows.map(toFlow),
      accums: accums.map(toAccum),
      funding: funding.map(toFunding),
      news: news.map(toNews),
      regime: regimeDocs.length ? toRegime(regimeDocs[0]) : null,
      zones: zones.map(toZone),
      confluence: confluence.map(toConfluence),
      services,
    }
  } catch {
    // Mat ket noi giua chung -> fail-soft (khong 500) — giong risk status.
    return EMPTY('down', services)
  }
}
