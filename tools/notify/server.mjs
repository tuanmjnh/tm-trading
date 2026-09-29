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

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
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
//  Chong trung: mot alert TradingView co the bi gui lai
// =============================================================================
const seen = new Map() // key -> timestamp
const DEDUP_MS = 60_000

function dedup(o) {
  const key = `${o.ts}|${o.action}|${o.side}|${o.price}|${o.level ?? ''}`
  const now = Date.now()
  for (const [k, t] of seen) if (now - t > DEDUP_MS) seen.delete(k)
  if (seen.has(key)) return true
  seen.set(key, now)
  return false
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
export function createNotifyServer({ logFile = LOG, quiet = false, token = TM_TOKEN } = {}) {
  mkdirSync(dirname(logFile), { recursive: true })

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

    if (req.method === 'GET' && pathname === '/health') return json(200, { ok: true, uptime: process.uptime() })

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
      body += c
      if (body.length > 16384) {
        tooBig = true
        req.destroy()
      }
    })

    req.on('end', async () => {
      try {
        if (tooBig) return json(413, { ok: false, error: 'payload qua lon' })

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

        if (dedup(o)) return json(200, { ok: true, note: 'duplicate' })

        appendFileSync(logFile, JSON.stringify(o) + '\n')

        let sent = 0
        try {
          sent = await notify(o)
        } catch (e) {
          console.error('[notify] fail:', e.message)
          // Van tra 200 de TradingView khong gui lai - du lieu da duoc ghi log.
        }

        log(`[ok] ${o.action} ${o.side} ${o.symbol} ${o.tf} @ ${o.price} (${sent} kenhang)`)
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
