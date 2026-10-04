// =============================================================================
//  TM TRADING - SERVICE HEARTBEAT (roadmap Phase 8 / D9)
//
//  "Không có gì xảy ra" KHÔNG được giống "thị trường yên": mỗi service ghi
//  lastRunAt / lastOkAt / lastErrorAt vào logs/services.json (FILE — đọc được
//  cả khi Mongo chết, đúng tinh thần fail-soft của risk status). Quá hạn
//  2 × chu kỳ -> bắn Telegram (nhắc lại mỗi HEARTBEAT_REMIND_H, không spam).
//
//  /health (server) đọc CÙNG file + CÙNG evaluate() này (một nguồn — D1).
//  Test offline: services/test.mjs (truyền file/now/send giả).
// =============================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** File trạng thái — cùng chỗ với các log khác (logs/). */
export const HEARTBEAT_FILE = join(ROOT, 'logs', 'services.json')

/** Chu kỳ mặc định (giây) — orchestrator ghi lại vào file lúc beat(). */
export const DEFAULT_INTERVALS = Object.freeze({
  scanner: Number(process.env.SCANNER_INTERVAL || 900),
  funding: Number(process.env.FUNDING_INTERVAL || 900),
  news: Number(process.env.NEWS_INTERVAL || 600),
  regime: Number(process.env.REGIME_INTERVAL || 3600),
  liquidation: Number(process.env.LIQ_INTERVAL || 900),
  confluence: Number(process.env.CONFLUENCE_INTERVAL || 86400), // Phase 10 — 1 ngay/lan
})

/** Nhắc lại Telegram sau khi overdue: 6h (đổi qua HEARTBEAT_REMIND_H). */
export const REMIND_H = Number(process.env.HEARTBEAT_REMIND_H || 6)

/** Doc file — fail-soft: thiếu/hỏng -> { services: {} }. */
export function readHeartbeat(file = HEARTBEAT_FILE) {
  try {
    if (!existsSync(file)) return { updatedAt: '', services: {} }
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    if (!doc || typeof doc !== 'object' || typeof doc.services !== 'object' || doc.services === null) {
      return { updatedAt: '', services: {} }
    }
    return { updatedAt: String(doc.updatedAt || ''), services: doc.services }
  } catch {
    return { updatedAt: '', services: {} }
  }
}

/**
 * Ghi/ghép trạng thái 1 service (atomic-ish: ghi tạm rồi rename — Windows
 * readSync song song không bị đọc file giữa chừng).
 */
export function beat(name, patch, file = HEARTBEAT_FILE) {
  const hb = readHeartbeat(file)
  const prev = hb.services[name] || {}
  hb.services[name] = { ...prev, ...patch, intervalSec: Number(patch.intervalSec || prev.intervalSec || DEFAULT_INTERVALS[name] || 900) }
  hb.updatedAt = new Date().toISOString()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(hb, null, 2))
  renameSync(tmp, file)
  return hb
}

/**
 * Tính trạng thái mỗi service — PURE (golden test).
 *
 * Quá hạn = không có lần chạy OK nào trong 2 × chu kỳ. Chưa từng chạy bao giờ
 * -> mốc tính là updatedAt của file (tránh báo ngay khi orchestrator vừa boot).
 *
 * @param {{updatedAt?: string, services?: Record<string, any>}} hb
 * @param {number} now ms epoch
 * @returns {{name:string, intervalSec:number, overdueSec:number, overdue:boolean,
 *            lastRunAt:string|null, lastOkAt:string|null, lastErrorAt:string|null,
 *            lastError:string|null, count:number}[]}
 */
export function evaluateHeartbeat(hb, now = Date.now()) {
  const services = hb?.services || {}
  const fileAt = Date.parse(hb?.updatedAt || '') || now
  const out = []
  for (const name of Object.keys(services).sort()) {
    const s = services[name] || {}
    const intervalSec = Number(s.intervalSec) > 0 ? Number(s.intervalSec) : 900
    const lastOkAt = s.lastOkAt ? Date.parse(s.lastOkAt) : NaN
    const lastRunAt = s.lastRunAt ? Date.parse(s.lastRunAt) : NaN
    const marker = Number.isFinite(lastOkAt) ? lastOkAt : Number.isFinite(lastRunAt) ? lastRunAt : fileAt
    const ageSec = Math.max(0, Math.round((now - marker) / 1000))
    out.push({
      name,
      intervalSec,
      overdueSec: ageSec,
      overdue: ageSec > intervalSec * 2,
      lastRunAt: s.lastRunAt || null,
      lastOkAt: s.lastOkAt || null,
      lastErrorAt: s.lastErrorAt || null,
      lastError: s.lastError || null,
      count: Number(s.count) || 0,
    })
  }
  return out
}

/**
 * Services quá hạn + gửi Telegram (nhắc lại theo REMIND_H).
 * `send(text)` = async (text) => boolean — test truyền fake.
 *
 * @returns {{overdue:any[], alerted:string[]}}
 */
export async function checkOverdue({ file = HEARTBEAT_FILE, now = Date.now(), send, remindH = REMIND_H } = {}) {
  const hb = readHeartbeat(file)
  const rows = evaluateHeartbeat(hb, now)
  const overdue = rows.filter((r) => r.overdue)
  const alerted = []
  if (!overdue.length) return { overdue, alerted }

  for (const r of overdue) {
    const lastAlertAt = Date.parse(hb.services?.[r.name]?.lastAlertAt || '') || 0
    if (now - lastAlertAt < remindH * 3600_000) continue
    alerted.push(r.name)
    // Ghi lastAlertAt TRƯỚC khi gửi — gửi fail cũng không spam lặp mỗi 60s.
    beat(r.name, { lastAlertAt: new Date(now).toISOString() }, file)
    if (send) {
      const age = Math.round(r.overdueSec / 60)
      await send(
        [
          `🛑 TM Trading — SERVICE CHẾT (D9)`,
          `${r.name}: quá hạn ${age} phút (chu kỳ ${Math.round(r.intervalSec / 60)}' × 2).`,
          r.lastError ? `Lỗi gần nhất: ${r.lastError}` : `Lần OK gần nhất: ${r.lastOkAt || 'chưa có'}`,
          `Chạy lại: node services/run.mjs once   |   Trạng thái: node services/run.mjs status`,
        ].join('\n'),
      )
    }
  }
  return { overdue, alerted }
}
