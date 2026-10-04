#!/usr/bin/env node
// =============================================================================
//  TM TRADING - WEBHOOK RECEIVER (Node thuan, khong dependency)
//  Nhan POST text/plain chua JSON tu TradingView, validate, chong trung, forward
//  sang Telegram / Discord (bat ky nao cai trong .env).
//
//  Run:  npm run notify
//  Test: npm test
// =============================================================================

import { createServer } from 'node:http'
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { alertKey } from '../engine/keys.mjs'
import { SIGNAL_TYPES } from '../engine/models/signal.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = Number(process.env.PORT || 8787)
const LOG = join(ROOT, 'logs', 'alerts.ndjson')

// --- .env don gian (KEY=VALUE) ---
export function loadEnv() {
  const f = join(ROOT, '.env')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
loadEnv()

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || ''
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || ''
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || ''
const TM_TOKEN = process.env.TM_TOKEN || ''

// Tran kich thuoc body. TradingView gioi han message 4096 ky tu nen payload that
// luon nho hon nhieu; muc nay chi chan body rac/khong lo.
const MAX_BODY = 16384

// =============================================================================
//  Xac thuc
//  TradingView chi gui duoc URL + JSON body, KHONG gui duoc header tuy y, nen
//  token phai nam trong URL: /tm-alert/<token> hoac /tm-alert?token=<token>.
//  Dung Authorization/X-TM-Token chi danh cho goi tu code (test, script).
// =============================================================================
export function offeredToken(req, pathname) {
  const m = pathname.match(/^\/tm-alert\/(.+)$/)
  if (m) return decodeURIComponent(m[1])
  try {
    const q = new URL(req.url, 'http://localhost').searchParams.get('token')
    if (q) return q
  } catch {}
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  const x = req.headers['x-tm-token']
  return typeof x === 'string' ? x : ''
}

function sameToken(a, b) {
  const ab = Buffer.from(String(a ?? ''), 'utf8')
  const bb = Buffer.from(String(b ?? ''), 'utf8')
  if (ab.length !== bb.length || ab.length === 0) return false
  return timingSafeEqual(ab, bb)
}

export function checkAuth(req, pathname, token) {
  // Fail-closed: khong cai token thi khong nhan alert nao ca.
  if (!token) return { ok: false, error: 'TM_TOKEN chua duoc cai dat - them TM_TOKEN=<bieu tuong> vao .env' }
  if (!sameToken(offeredToken(req, pathname), token)) return { ok: false, error: 'token khong hop le' }
  return { ok: true }
}

// =============================================================================
//  Validate
// =============================================================================
const SIDES = ['BUY', 'SELL']
const ACTIONS = ['ENTRY', 'TAKE_PROFIT', 'STOP_LOSS', 'TIME_CLOSE']

export function validate(o) {
  const err = (m) => ({ ok: false, error: m })
  if (!o || typeof o !== 'object') return err('payload khong phai JSON object')
  if (o.v !== 1) return err(`schema version khong ho tro: ${o.v}`)
  // ts BAT BUOC va phai la ISO-8601. Day la truong dinh danh (alertKey) - thieu no
  // thi khong the khuu trung, va khong biet alert nay xay ra luc nao (D2: UTC).
  if (typeof o.ts !== 'string' || Number.isNaN(Date.parse(o.ts))) {
    return err(`ts khong hop le (can ISO-8601 UTC,VD 2026-10-01T03:17:21Z): ${JSON.stringify(o.ts)}`)
  }
  if (ACTIONS.indexOf(o.action) === -1) return err(`action khong hop le: ${o.action}`)
  if (SIDES.indexOf(o.side) === -1) return err(`side khong hop le: ${o.side}`)
  if (!Number.isFinite(o.price) || o.price <= 0) return err(`price khong hop le: ${o.price}`)
  if (!Number.isFinite(o.sl)) return err(`sl khong hop le: ${o.sl}`)
  if (!Array.isArray(o.tps) || o.tps.length === 0) return err('tps phai la mang khong rong')

  // Bat buoc: SL phai nam dung phia so voi gia vao lenh
  if (o.side === 'BUY' && o.sl >= o.price) return err(`BUY nhung SL ${o.sl} >= price ${o.price}`)
  if (o.side === 'SELL' && o.sl <= o.price) return err(`SELL nhung SL ${o.sl} <= price ${o.price}`)

  // TP phai cung phia voi gia vao lenh
  for (const t of o.tps) {
    if (!Number.isFinite(t)) return err(`TP khong hop le: ${t}`)
    if (o.side === 'BUY' && t <= o.price) return err(`TP ${t} <= price ${o.price} (BUY)`)
    if (o.side === 'SELL' && t >= o.price) return err(`TP ${t} >= price ${o.price} (SELL)`)
  }

  return { ok: true }
}

// =============================================================================
//  D4 - DEDUPE BEN VUNG (thay cho `const seen = new Map()` trong RAM)
//
//  Van de cua cach cu: state nam hoan toan trong tien trinh. Restart/deploy la
//  mat sach; TradingView retry se tao LAN THU HAI that. Roadmap D4: khong duoc
//  dung Map trong RAM cho tang nay.
//
//  Cach dung: `alertKey` (engine/keys.mjs) + UNIQUE index tren collection
//  `alerts`. Khu trung tro thanh thuoc tinh cua DU LIEU: insert trung tra loi
//  11000 -> chan duoc ca khi restart, ca khi 2 tien trinh chay song song.
//
//  `ramDedupe` van ton tai nhung chi la PHU CAP khi Mongo khong dung duoc
//  (fail-soft giong db.mjs). No duoc nhan ro la khong ben vung (`durable:false`)
//  de /health va log khong ai tuong nham da an toan.
// =============================================================================

export function ramDedupe({ ttlMs = 60_000 } = {}) {
  const seen = new Map() // key -> ts (chi dung khi Mongo KHONG dung duoc)
  return {
    kind: 'ram',
    async claim(key) {
      const now = Date.now()
      for (const [k, t] of seen) if (now - t > ttlMs) seen.delete(k)
      if (seen.has(key)) return { duplicate: true, durable: false }
      seen.set(key, now)
      return { duplicate: false, durable: false }
    },
  }
}

/**
 * Dedupe tren MongoDB (D4). Mongo khong dung duoc -> lui ve RAM va ghi ro
 * `durable:false`. Khong bao gio nem: nhan loi alert la mat lenh that.
 */
export function mongoDedupe() {
  let AlertModel = null
  const fallback = ramDedupe()

  async function getModel() {
    if (AlertModel) return AlertModel
    const db = await import('../engine/db.mjs')
    const conn = await db.connectMongo() // fail-soft, co cooldown 30s khi loi
    if (!conn) return null
    const { Alert } = await import('../engine/models/alert.mjs')
    try {
      // tao index da khai trong schema (unique alertKey) - idempotent, khong drop index khac
      await Alert.createIndexes()
    } catch {
      // index da co hoac khong tao duoc -> insert van chay, chi la mat dam bao unique
    }
    AlertModel = Alert
    return Alert
  }

  return {
    kind: 'mongo',
    async claim(key, doc) {
      const Alert = await getModel()
      if (!Alert) return fallback.claim(key) // Mongo chua san sang
      try {
        await Alert.create({ ...doc, alertKey: key })
        return { duplicate: false, durable: true }
      } catch (e) {
        if (e?.code === 11000) return { duplicate: true, durable: true }
        // Loi khac (mat ket noi giua chung, validate...): van khong duoc mat alert
        // -> lui ve RAM, ro rang la KHONG ben vung.
        console.warn(`[dedupe] Mongo loi, dung phu cap RAM: ${e?.message}`)
        return fallback.claim(key)
      }
    },
  }
}

/**
 * Map payload -> document `alerts`. Dat o day (khong phai trong model) vi day la
 * noi duy nhat biet payload webhook truyen len the nao.
 */
export function toAlertDoc(o, source) {
  const num = (x) => (Number.isFinite(x) ? x : null)
  return {
    source,
    v: o.v,
    ts: new Date(o.ts), // D2: UTC ms - Mongo khong luu gio dia phuong
    symbol: o.symbol ?? null,
    tf: o.tf ?? null,
    mode: o.mode ?? null,
    action: o.action,
    level: num(o.level),
    side: o.side,
    price: o.price,
    sl: o.sl,
    tps: Array.isArray(o.tps) ? o.tps.map(Number).filter(Number.isFinite) : [],
    atr: num(o.atr),
    conf: num(o.conf),
    status: 'received',
    raw: JSON.stringify(o),
  }
}

const SIGNAL_TYPE_SET = new Set(SIGNAL_TYPES)

/**
 * Suy ra type su kien VSA cho signal (Phase 6). Payload v1 khong mang truong
 * VSA event nen mac dinh suy tu side: ENTRY BUY -> 'ST LONG', SELL -> 'ST SHORT'
 * (entry = ke hoach vao lenh, xem EVENT_SCORE). Neu chart gui them `event`
 * (field optional, khong can bump `v`) va no nam trong SIGNAL_TYPES -> dung no.
 */
function signalTypeOf(o) {
  if (o.event !== undefined && o.event !== null) {
    if (SIGNAL_TYPE_SET.has(o.event)) return o.event
    // Gia tri lai: khong 422 (alert van hop le) - canh bao de nguoi tao alert biet.
    console.warn(`[signal] event khong hop le, lui ve side: ${JSON.stringify(o.event)}`)
  }
  if (o.side === 'BUY') return 'ST LONG'
  if (o.side === 'SELL') return 'ST SHORT'
  return null
}

/**
 * Map payload -> document `signals` (Phase 6) - "dich nghia" alert thanh su kien
 * VSA. Chi `action=ENTRY` moi la su kien vao lenh; TP/SL/TIME_CLOSE la hanh dong
 * theo doi vi the (mot alert khong phai su kien) -> tra null, khong ghi.
 * `alertKey` giu lien ket voi alert goc (truoc dedupe) de truy vet nguon.
 */
export function toSignalDoc(o, source, key) {
  if (o?.action !== 'ENTRY') return null
  // Signal schema bat buoc symbol + tf - thieu khong the dich (validate() van cho
  // phep payload thieu symbol, nen day la phong thu rieng tang nay).
  if (!o.symbol || !o.tf) return null
  const type = signalTypeOf(o)
  if (!type) return null
  const num = (x) => (Number.isFinite(x) ? x : null)
  return {
    ts: new Date(o.ts),
    symbol: o.symbol,
    tf: String(o.tf),
    type,
    price: num(o.price),
    method: 'vsa',
    alertKey: key ?? null,
    meta: { source, action: o.action, side: o.side, sl: num(o.sl), tps: Array.isArray(o.tps) ? o.tps.map(Number).filter(Number.isFinite) : [], atr: num(o.atr), conf: num(o.conf), mode: o.mode ?? null, v: o.v },
  }
}

// Memo model ghi signal - giong cach mongoDedupe() memo Alert. Mongo khong dung
// duoc -> tra 'no-mongo' (fail-soft, khong bao gio nem: da ghi NDJSON roi).
let signalModel = null
export async function writeSignal(doc) {
  if (!doc) return 'skip'
  if (!signalModel) {
    const db = await import('../engine/db.mjs')
    const conn = await db.connectMongo()
    if (!conn) return 'no-mongo'
    const { Signal } = await import('../engine/models/signal.mjs')
    try {
      await Signal.createIndexes()
    } catch {
      // index da co / khong tao duoc - insert van chay
    }
    signalModel = Signal
  }
  try {
    await signalModel.create(doc)
    return 'written'
  } catch (e) {
    console.warn(`[signal] ghi that bai: ${e?.message}`)
    return 'error'
  }
}

/** Nguon mac dinh la TradingView; nguon thu hai (scanner/AI) gui `source` rieng. */
export function sourceOf(o) {
  const s = o?.source
  if (s === undefined || s === null || s === '') return 'tradingview'
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(s)) {
    throw new Error(`source khong hop le: ${JSON.stringify(s)}`)
  }
  return s
}

// =============================================================================
//  Format noi dung
// =============================================================================
const ICON = { ENTRY: '🟢', TAKE_PROFIT: '🎯', STOP_LOSS: '🛑', TIME_CLOSE: '⏱' }

function fmtRR(o) {
  const risk = Math.abs(o.price - o.sl)
  if (risk === 0) return '—'
  const mult = Math.abs(o.tps[o.tps.length - 1] - o.price) / risk
  return `1:${mult.toFixed(2)}`
}

function toText(o) {
  const head = `${ICON[o.action] || '•'} ${o.action} · ${o.side}`
  return [
    head,
    `${o.symbol} · ${o.tf} · ${o.mode}`,
    `Entry ${o.price}   SL ${o.sl}`,
    `TP    ${o.tps.join('  |  ')}`,
    `RR    ${fmtRR(o)}${Number.isFinite(o.conf) ? `   Conf ${o.conf}` : ''}`,
  ].join('\n')
}

function toMarkdown(o) {
  const bold = (s) => `**${s}**`
  return [
    `${bold(`${ICON[o.action] || '•'} ${o.action} — ${o.side} ${o.symbol} ${o.tf}`)}`,
    `\`\`\``,
    `Entry : ${o.price}`,
    `SL    : ${o.sl}`,
    `TP    : ${o.tps.join('  |  ')}`,
    `RR    : ${fmtRR(o)}   Conf ${o.conf ?? '—'}`,
    `Mode  : ${o.mode}`,
    '```',
  ].join('\n')
}

// =============================================================================
//  Forward
// =============================================================================
async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
}

async function notify(o) {
  const jobs = []

  if (TELEGRAM_TOKEN && TELEGRAM_CHAT) {
    jobs.push(
      post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT,
        text: toText(o),
        disable_web_page_preview: true,
      })
    )
  }

  if (DISCORD_WEBHOOK) {
    jobs.push(post(DISCORD_WEBHOOK, { content: toMarkdown(o) }))
  }

  const results = await Promise.allSettled(jobs)
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length) throw new Error(failed.map((f) => f.reason.message).join('; '))
  return results.length
}

// =============================================================================
//  HTTP server
// =============================================================================
/**
 * @param {object} opt
 * @param {string} [opt.logFile]   NDJSON luon ghi (khong phu thuoc Mongo)
 * @param {string} [opt.token]     TM_TOKEN
 * @param {'mongo'|'ram'} [opt.dedupe]  mac dinh 'mongo' (D4); 'ram' chi dung cho test
 * @param {boolean} [opt.quiet]
 */
export function createNotifyServer({ logFile = LOG, quiet = false, token = TM_TOKEN, dedupe: dedupeMode = 'mongo' } = {}) {
  mkdirSync(dirname(logFile), { recursive: true })
  const dedupe = dedupeMode === 'ram' ? ramDedupe() : mongoDedupe()

  const log = (...a) => {
    if (!quiet) console.log(...a)
  }
  const warn = (...a) => {
    if (!quiet) console.warn(...a)
  }

  return createServer(async (req, res) => {
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }

    let pathname = req.url || ''
    try {
      pathname = new URL(req.url, 'http://localhost').pathname
    } catch {}

    if (req.method === 'GET' && pathname === '/health') {
      // D9 (nham truoc): phai biet duoc dedupe dang o CHE DO NAO. 'ram' = khong
      // ben vung -> khong duoc tuong nham la da an toan.
      return json(200, { ok: true, uptime: process.uptime(), dedupe: dedupe.kind })
    }

    const isAlert = req.method === 'POST' && (pathname === '/tm-alert' || pathname.startsWith('/tm-alert/'))
    if (!isAlert) return json(404, { ok: false, error: 'not found' })

    const auth = checkAuth(req, pathname, token)
    if (!auth.ok) {
      warn(`[401] ${auth.error}`)
      req.resume() // bo qua body da nhan duoc
      return json(401, { ok: false, error: auth.error })
    }

    let body = ''
    let tooBig = false
    req.on('data', (c) => {
      if (tooBig) return
      body += c
      if (body.length > MAX_BODY) {
        // Tra 413 roi RUT CAN (req.resume) thay vi cat socket. Cat ngay bang
        // destroy() lam client dang gui do nhan RST -> "fetch failed" chu khong
        // phai 413 (da gap that: probe 64KB -> status 0). Dung lai phan body con
        // lai la du de client doc duoc phan hoi; khong giu vao bo nho.
        tooBig = true
        body = ''
        req.resume()
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'payload qua lon' }))
      }
    })
    // Socket bi cat giua chung (client bo di, hoac ta vua destroy o tren) khong
    // duoc lam sap process: thieu handler nay 'error' se nem ra uncaught.
    req.on('error', () => {})

    req.on('end', async () => {
      try {
        // 413 da duoc tra ngay trong handler 'data' (kem destroy socket) - o day
        // chi can thoat, ghi header lan nua se nem ERR_HTTP_HEADERS_SENT.
        if (tooBig) return

        let o
        try {
          o = JSON.parse(body)
        } catch {
          warn('[reject] JSON khong hop le:', body.slice(0, 200))
          return json(400, { ok: false, error: 'invalid JSON' })
        }

        const v = validate(o)
        if (!v.ok) {
          warn(`[reject] ${v.error}`)
          return json(422, { ok: false, error: v.error })
        }

        // --- D4: khu trung BEN VUNG truoc khi lam gi khac ---
        // alertKey nem loi neu ts/price hong - nhung validate o tren da bat no
        // roi nen day chi la phong thu (khong duoc 500 cho 1 payload lech).
        let key
        let source
        try {
          source = sourceOf(o)
          key = alertKey(o, source)
        } catch (e) {
          warn(`[reject] ${e.message}`)
          return json(422, { ok: false, error: e.message })
        }

        const claimed = await dedupe.claim(key, toAlertDoc(o, source))
        if (claimed.duplicate) {
          // Tra 200 de TradingView khong retry nua - da nhan roi, chi la trung.
          return json(200, { ok: true, note: 'duplicate' })
        }

        // NDJSON LUON ghi (du Mongo co hay khong) - day la noi luu cham chac.
        appendFileSync(logFile, JSON.stringify(o) + '\n')

        if (!claimed.durable) {
          // Khong im lang khi dang o che do phu cap: neu Mongo roi thi restart
          // se mat trang thai khu trung -> can thay ro de xu ly.
          warn('[dedupe] DANG O CHE DO RAM (khong ben vung) - Mongo khong ket noi duoc. D4 CHUA DAM BAO.')
        }

        // Phase 6: ghi `signals` SONG SONG voi NDJSON (da ghi o tren). Bat ky loi
        // nao o day cung khong duoc chan 200 - TradingView se retry -> alertKey
        // trung -> dedupe chan retry -> signal da ghi van con, alert khong mat.
        let sig = 'skip'
        try {
          sig = await writeSignal(toSignalDoc(o, source, key))
        } catch (e) {
          console.error('[signal] loi ngoai du kien:', e?.message)
          sig = 'error'
        }

        let sent = 0
        try {
          sent = await notify(o)
        } catch (e) {
          console.error('[notify] fail:', e.message)
          // Van tra 200 de TradingView khong gui lai - du lieu da duoc ghi log.
        }

        log(`[ok] ${o.action} ${o.side} ${o.symbol} ${o.tf} @ ${o.price} (${sent} kenhang, signal=${sig})`)
        json(200, { ok: true })
      } catch (e) {
        console.error('[500]', e)
        json(500, { ok: false, error: 'internal' })
      }
    })
  })
}

// Chay truc tiep moi len server; import (npm test) thi chi lay factory.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const server = createNotifyServer()
  server.listen(PORT, () => {
    console.log(`TM notify server : http://localhost:${PORT}/tm-alert/<token>`)
    console.log(`Log             : ${LOG}`)
    console.log(`Telegram        : ${TELEGRAM_TOKEN ? 'bat' : 'tat'}`)
    console.log(`Discord         : ${DISCORD_WEBHOOK ? 'bat' : 'tat'}`)
    if (TM_TOKEN) {
      console.log(`Webhook (TV)    : http://<dia-chi-cua-ban>:${PORT}/tm-alert/${TM_TOKEN}`)
      console.log('  -> dat vao truong "Webhook URL" cua alert tren TradingView')
    } else {
      console.log('CAM BAO: thieu TM_TOKEN -> /tm-alert tra ve 401 cho moi request.')
      console.log('  -> them TM_TOKEN=<bieu tuong> vao .env roi chay lai.')
    }
  })
}
