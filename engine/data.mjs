#!/usr/bin/env node
// =============================================================================
//  TM TRADING - LAY DU LIEU (roadmap Phase 4, D11)
//
//  NGUON:
//    - mac dinh `fapi` (https://fapi.binance.com) -> kieu giac chinh la `*.P`
//      (perpetual) nhu chart TradingView. Dung `market: 'spot'` cho spot.
//    - phan trang: Binance toi da 1500 kline/lan. Goi lien tuc cho den khi
//      khong con du lieu hoac da du `limit` yeu cau.
//
//  CACHE (`data/`):
//    - 1 file JSON cho 1 (market, symbol, tf): { fetchedAt, source, market,
//      symbol, tf, bars }.
//    - Doc cache truoc. Chi goi API khi `refresh: true` hoac cache thieu.
//    - `data/` la DU LIEU TAI TAO DUOC (D13: khong can sao luu - xoa di tai
//      khoi duoc). Khong day vao git.
//
//  RESAMPLE (4m/10m - Binance khong co):
//    - `resample(bars1m, targetMs)` gop theo nhan `floor(time / targetMs)`.
//    - O/H/L/C theo nghia: O = open cua bar dau, H = max, L = min, C = cua bar
//      cuoi, volume = TONG (khong phai binh quan).
//    - Kiem tra nghiem ngat: chi so 1m PHAI nham vao dung so phan (lech = lech
//      data mismatch, not rounding variance. If so -> throw.
//
//  OFFLINE:
//    - `fetchImpl` cho phep day vao (test, replay) - khong test gan vao mang.
//      Neu khong cho phep, module nay van chay duoc 100% bang cache.
//
//  D11 - UNIVERSE SNAPSHOT:
//    - `universeSnapshot()` luu danh sach symbol + ngay lay + nguon + SO LENH
//      tung dong vao run. Loc min-history: token moi co 20 lenh khong so duoc
//      voi BTC 5000 lenh -> khong tron chung vao mot so tong hop.
//    - QUAN TRONG: van PHAI luu cac dong bi LOAI (voi `excluded: true` +
//      `reason`). Neu bo het di = survivorship bias cho toan bo ket qua (D11).
// =============================================================================
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Cac markets ho tro. `suffix` la ky hieu TradingView cho kieu giac. */
export const MARKETS = Object.freeze({
  fapi: { id: 'fapi', base: 'https://fapi.binance.com', suffix: '.P', label: 'USDⓈ-M perpetual' },
  spot: { id: 'spot', base: 'https://api.binance.com', suffix: '', label: 'spot' },
})

/** TF dinh dang string ('1','4','5','15','60','240') -> ms. */
export const TF_MS = Object.freeze({
  '1': 60000, '3': 180000, '4': 240000, '5': 300000, '10': 600000, '15': 900000,
  '30': 1800000, '60': 3600000, '120': 7200000, '240': 14400000, '360': 21600000,
  '720': 43200000, 'D': 86400000,
})

/**
 * Map dinh dang TF cua Binance (ghi ro, khong suy o trong fetch).
 * CHU Y: Binance KHONG co 4m/10m (day la ly do `MUST_RESAMPLE` ton tai) - neu
 * dua vao day se gui interval khong ton tai va nhan loi tu API mot cach qua muon.
 */
const BINANCE_INTERVAL = Object.freeze({
  '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h',
  '120': '2h', '240': '4h', '360': '6h', '720': '12h', 'D': '1d',
})

/**
 * Cac TF phai resample tu 1m (Binance khong co san).
 * De trong TF_MS de `resample(bars1m, TF_MS['4'])` van dung duoc.
 */
export const MUST_RESAMPLE = Object.freeze(['4', '10'])

export class DataError extends Error {
  constructor(msg, extra = {}) {
    super(msg)
    this.name = 'DataError'
    Object.assign(this, extra)
  }
}

/** Duong file cache cho 1 (market, symbol, tf). */
export function cachePath(dataDir, market, symbol, tf) {
  return join(dataDir, market, `${symbol}-${tf}.json`)
}

/** Doc cache. Tra ve null neu khong co hoac hong (khong nem - cache khong phai su that). */
export function readCache(dataDir, market, symbol, tf) {
  const p = cachePath(dataDir, market, symbol, tf)
  if (!existsSync(p)) return null
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8'))
    if (!Array.isArray(doc?.bars) || doc.bars.length === 0) return null
    return doc
  } catch {
    return null
  }
}

/** Ghi cache. Tao thu muc tu dong. */
export function writeCache(dataDir, market, symbol, tf, doc) {
  const p = cachePath(dataDir, market, symbol, tf)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(doc))
  return p
}

/**
 * Chuyen 1 dong kline cua Binance (mang string) -> bar cua engine.
 * DungNumber.parseFloat truc tiep (khong Number() vi co the nhan ngay thang).
 *
 * Cot 9 = taker_buy_volume — GIU lai `takerBuy` cho method orderflow (Phase 10).
 * Kline nguyen goc co 12 cot; input 6 cot (test/fixtures) van dung, chi la
 * khong co takerBuy (field bi bo qua, khong append undefined).
 */
export function klineToBar(k) {
  if (!Array.isArray(k) || k.length < 6) throw new DataError('kline khong du cot', { kline: k })
  const time = Number(k[0])
  const o = Number(k[1])
  const h = Number(k[2])
  const l = Number(k[3])
  const c = Number(k[4])
  const v = Number(k[5])
  if (![time, o, h, l, c, v].every((x) => Number.isFinite(x))) {
    throw new DataError('kline co gia tri khong huu han', { kline: k })
  }
  if (h < l || h < o || h < c || l > o || l > c) {
    throw new DataError('kline vi pham moi quan he O/H/L/C', { kline: k })
  }
  const bar = { time, open: o, high: h, low: l, close: c, volume: v }
  if (k.length >= 10) {
    const tb = Number(k[9])
    if (Number.isFinite(tb)) bar.takerBuy = tb
  }
  return bar
}

/**
 * Fetch 1 symbol x 1 TF, co phan trang va cache.
 *
 * @param {object} o
 * @param {string} o.symbol       vi du 'BTCUSDT'
 * @param {string} o.tf           dinh dang engine ('5','15','60','4','10'...)
 * @param {'fapi'|'spot'} [o.market='fapi']
 * @param {string} [o.dataDir='data']
 * @param {number} [o.limit]      so bar toi da (khong set = lay toi da co the)
 * @param {boolean} [o.refresh=false] bo qua cache, goi lai API
 * @param {number} [o.endTime]    ms - chi lay truoc thoi diem nay
 * @param {Function} [o.fetchImpl] (url) => Promise<object[]> - de test offline
 * @returns {Promise<{bars:object[], source:string, fetchedAt:string, market:string, symbol:string, tf:string, fromCache:boolean}>}
 */
export async function fetchKlines(o = {}) {
  const market = o.market ?? 'fapi'
  const M = MARKETS[market]
  if (!M) throw new DataError(`market khong ho tro "${market}" (chi: ${Object.keys(MARKETS).join(', ')})`)
  if (!o.symbol) throw new DataError('thieu symbol')
  if (!o.tf) throw new DataError('thieu tf')
  const interval = BINANCE_INTERVAL[o.tf]
  if (!interval) throw new DataError(`tf khong ho tro "${o.tf}" (Binance interval map: ${Object.keys(BINANCE_INTERVAL).join(', ')})`)

  const dataDir = o.dataDir ?? join(ROOT, 'data')

  if (!o.refresh) {
    const cached = readCache(dataDir, market, o.symbol, o.tf)
    if (cached && (!o.limit || cached.bars.length >= o.limit)) {
      return { ...cached, fromCache: true }
    }
  }

  // Phan trang: Binance tra toi da 1500 kline/lan. Lay tu cu ve moi (endTime
  // giam dan) de khong bi lech khi du lieu moi den giua lan fetch.
  const doFetch = o.fetchImpl ?? defaultFetch
  const bars = []
  let endTime = Number.isFinite(o.endTime) ? o.endTime : undefined
  const target = o.limit ?? 5000
  const urlBase = market === 'fapi' ? `${M.base}/fapi/v1/klines` : `${M.base}/api/v3/klines`

  for (let page = 0; page < 500 && bars.length < target; page++) {
    const u = new URL(urlBase)
    u.searchParams.set('symbol', o.symbol)
    u.searchParams.set('interval', interval)
    u.searchParams.set('limit', String(Math.min(1500, target - bars.length + 1)))
    if (endTime !== undefined) u.searchParams.set('endTime', String(endTime))

    const payload = await doFetch(u.toString())
    // Binance tra loi JSON {code, msg} thay vi mang kline -> bao ro, khong doc
    // thanh bar (neu khong, `Array.isArray` sai va chung se in "khong phai mang").
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && (payload.code !== undefined || payload.msg !== undefined)) {
      throw new DataError(`Binance loi ${payload.code ?? '?'}: ${payload.msg ?? 'khong ro'}`, { code: payload.code, url: u.toString() })
    }
    if (!Array.isArray(payload)) throw new DataError('response khong phai mang kline', { url: u.toString(), payload })

    const pageBars = payload.map(klineToBar).sort((a, b) => a.time - b.time)
    if (pageBars.length === 0) break

    // Tranh trung khi phan trang (du an toan: endpoint co the bo qua endTime)
    const seen = new Set(bars.map((b) => b.time))
    const fresh = pageBars.filter((b) => !seen.has(b.time))
    // Khong con bar moi -> da het lich su (hoac endpoint khong doi endTime).
    // KHONG dung dieu kien "page ngan hon limit" o day: server co the cap kich
    // thuoc trang, khi do phan trach se dung som va mat du lieu (da gap trong test).
    if (fresh.length === 0) break
    bars.unshift(...fresh)

    // Tiet kiem: da du thi dung truoc khi lap lai
    if (bars.length >= target) break
    endTime = pageBars[0].time - 1
  }

  const out = bars.sort((a, b) => a.time - b.time).slice(-target)
  if (out.length === 0) throw new DataError(`khong lay duoc bar nao cho ${o.symbol} ${o.tf}`, { symbol: o.symbol, tf: o.tf })

  const doc = {
    fetchedAt: new Date().toISOString(),
    source: urlBase,
    market,
    symbol: o.symbol,
    tf: o.tf,
    bars: out,
  }
  if (o.cache !== false) writeCache(dataDir, market, o.symbol, o.tf, doc)
  return { ...doc, fromCache: false }
}

/** Fetch mac dinh. Chep lai thanh cong: JSON, HTTP khong phai 2xx -> loi ro. */
async function defaultFetch(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'tm-trading/1.0' } })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new DataError(`response khong phai JSON (HTTP ${res.status})`, { url, body: text.slice(0, 200) })
  }
  if (!res.ok) throw new DataError(`HTTP ${res.status}`, { url, body: text.slice(0, 200) })
  return json
}

/**
 * Resample tu bar nho (thuong 1m) len khung lon hon (4m/10m - Binance khong co).
 *
 * @param {object[]} bars     da sap xep tang theo time, khong trung
 * @param {number} targetMs   240000 (4m), 600000 (10m)...
 * @param {number} [srcMs]    do dai 1 bar goc. Mac dinh suy tu 2 bar dau.
 * @returns {object[]}
 */
export function resample(bars, targetMs, srcMs) {
  if (!Array.isArray(bars) || bars.length === 0) return []
  if (!Number.isFinite(targetMs) || targetMs <= 0) throw new DataError(`targetMs khong hop le: ${targetMs}`)

  const step = srcMs ?? (bars.length > 1 ? bars[1].time - bars[0].time : 0)
  if (step <= 0) throw new DataError('khong suy duoc do dai bar goc - truyen srcMs')
  if (targetMs < step) throw new DataError(`targetMs (${targetMs}) nho hon bar goc (${step})`)
  if (targetMs % step !== 0) throw new DataError(`targetMs (${targetMs}) khong chia het cho bar goc (${step}) - lech nhan`)

  // Moi bar goc PHAI nam trong dung 1 o. Lech = du lieu thieu/nhieu khong de y.
  for (const b of bars) {
    if (b.time % step !== 0) {
      throw new DataError(`bar goc time=${b.time} khong lech tren lo phan cua ${step}ms - du lieu lech`, { bar: b })
    }
  }

  const out = []
  let cur = null
  for (const b of bars) {
    const bucket = Math.floor(b.time / targetMs) * targetMs
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur)
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }
      // takerBuy cong nhu volume — chi carry khi bar goc CO (khong append undefined)
      if (Number.isFinite(b.takerBuy)) cur.takerBuy = b.takerBuy
    } else {
      if (b.high > cur.high) cur.high = b.high
      if (b.low < cur.low) cur.low = b.low
      cur.close = b.close
      cur.volume += b.volume
      if (Number.isFinite(b.takerBuy)) cur.takerBuy = (cur.takerBuy ?? 0) + b.takerBuy
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * D11 - chot danh sach universe cho 1 run.
 *
 * `entries` = [{ symbol, bars, trades? }] - `bars` la so bar (dai lich su),
 * `trades` la so lenh tim duoc (neu da chay backtest truoc).
 *
 * @param {object} o
 * @param {string[]} [o.exchanges=['binance']]
 * @param {'fapi'|'spot'} [o.market='fapi']
 * @param {number} [o.minHistoryBars=0] neu > 0 -> duoi muc nay bi loai (ghi ro ly do)
 * @param {number} [o.minTrades=0]       neu > 0 -> duoi muc nay bi loai
 * @returns {object} document de dat vao run.universe
 */
export function universeSnapshot(o = {}) {
  const market = o.market ?? 'fapi'
  const entries = Array.isArray(o.entries) ? o.entries : []
  if (entries.length === 0) throw new DataError('universeSnapshot: entries rong - khong co gi de chot')

  const minBars = o.minHistoryBars ?? 0
  const minTrades = o.minTrades ?? 0
  const at = new Date().toISOString()

  const symbols = entries.map((e) => {
    const bars = Number(e.bars) || 0
    const trades = Number.isFinite(e.trades) ? e.trades : null
    const reasons = []
    if (minBars > 0 && bars < minBars) reasons.push(`lich su ${bars} bar < min ${minBars}`)
    if (minTrades > 0 && (trades === null || trades < minTrades)) {
      reasons.push(`${trades === null ? 'chua chay' : trades} lenh < min ${minTrades}`)
    }
    return {
      symbol: e.symbol,
      bars,
      trades,
      // `excluded` van LUU day du. Bo no di = survivorship bias (D11).
      excluded: reasons.length > 0,
      reason: reasons.length ? reasons.join('; ') : null,
      note: e.note ?? null,
    }
  })

  return {
    fetchedAt: at,
    market,
    exchanges: o.exchanges ?? ['binance'],
    source: o.source ?? MARKETS[market]?.base ?? null,
    minHistoryBars: minBars,
    minTrades,
    total: symbols.length,
    included: symbols.filter((s) => !s.excluded).length,
    excludedCount: symbols.filter((s) => s.excluded).length,
    symbols,
    // Canh bao mac dinh - de ai do doc bao cao biet rang day CHUA phai la
    // ket qua cua toan bo phien ban.
    survivorshipBias: true,
    survivorshipNote:
      'Universe lay tu Binance hien tai - token da delisted/tra het khong con trong danh sach. ' +
      'Moi so lieu o day NEN GIA TRI HON thuc te (khong con cac lenh thua cua token da loi). ' +
      'D11: khong loc delisted = survivorship bias cho toan bo ket qua.',
  }
}

/** Lay danh sach symbol dang giao dich (de lay truoc universe - khong de default). */
export async function listSymbols({ market = 'fapi', fetchImpl } = {}) {
  const M = MARKETS[market]
  if (!M) throw new DataError(`market khong ho tro "${market}"`)
  const url = market === 'fapi' ? `${M.base}/fapi/v1/exchangeInfo` : `${M.base}/api/v3/exchangeInfo`
  const data = await (fetchImpl ?? defaultFetch)(url)
  const info = Array.isArray(data) ? data : data?.symbols
  if (!Array.isArray(info)) throw new DataError('exchangeInfo khong doc duoc symbols', { url })
  const status = 'TRADING'
  return info.filter((s) => s.status === status).map((s) => s.symbol)
}
