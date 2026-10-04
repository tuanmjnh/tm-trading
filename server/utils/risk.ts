import type { DriftStatus, RiskAccountDay, RiskStatusData } from '../../types/risk'
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { engineModel } from './engineModel'

// =============================================================================
//  DOC TRANG THAI RISK GATE CHO DASHBOARD — roadmap Phase 7.
//
//  Chi DOC `risk_state` + `positions` (engine ghi, D1: mot nguon suy ra) va
//  audit D8 `drift_report` trong logs/risk.ndjson (exec/drift.mjs ghi).
//  Mongo khong ket noi duoc -> tra 200 + mongo='down' (fail-soft nhu signals.ts).
// =============================================================================

/** Doc duong dan log audit D8 — mac dinh `<cwd>/logs/risk.ndjson`. */
const DRIFT_LOG = join(process.cwd(), 'logs', 'risk.ndjson')

/**
 * Lay `drift_report` GAN NHAT tu audit file (doc tu duoi len, chi doc 64KB cuoi
 * — file co the lon). Fail-soft: thieu file / loi doc / dong hong -> null.
 * Test truyen duong dan rieng qua `file`.
 */
export function readDriftStatus(file: string = DRIFT_LOG): DriftStatus | null {
  try {
    if (!existsSync(file)) return null
    const size = statSync(file).size
    if (size <= 0) return null
    const len = Math.min(size, 64 * 1024)
    const buf = Buffer.alloc(len)
    const fd = openSync(file, 'r')
    readSync(fd, buf, 0, len, size - len)
    closeSync(fd)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim()
      if (!line) continue
      let e: any
      try {
        e = JSON.parse(line)
      } catch {
        continue // dong bi cat giua (khu doc 64KB) — bo qua, xuong dong truoc
      }
      if (e?.event !== 'drift_report') continue
      const rows = Array.isArray(e.rows) ? e.rows : []
      const last = String(e.ts ?? '')
      return {
        lastCheckAt: last,
        breach: !!e.breach,
        windowH: Number(e.windowH) || 0,
        checked: Number(e.checked) || 0,
        diverged: rows.filter((r: any) => r && r.tv !== r.engine).length
      }
    }
    return null
  } catch {
    return null
  }
}

/** Ngay UTC hien tai theo format `YYYY-MM-DD` (D2: khong gio dia phuong). */
export function utcDayNow(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function toIso(d: unknown): string | null {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString()
  if (d == null) return null
  const t = new Date(d as string | number)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Map document risk_state -> RiskAccountDay (thieu gi thi mac dinh, khong loi). */
export function toAccountDay(doc: any): RiskAccountDay {
  return {
    account: String(doc?.account ?? 'default'),
    utcDay: String(doc?.utcDay ?? ''),
    halted: !!doc?.halted,
    haltReason: String(doc?.haltReason ?? ''),
    haltedAt: toIso(doc?.haltedAt),
    realizedPnlAbs: num(doc?.realizedPnlAbs),
    realizedPnlPct: num(doc?.realizedPnlPct),
    tradesOpened: num(doc?.tradesOpened),
    tradesClosed: num(doc?.tradesClosed),
    consecutiveLosses: num(doc?.consecutiveLosses)
  }
}

export async function loadRiskStatus(now: Date = new Date()): Promise<RiskStatusData> {
  const day = utcDayNow(now)
  const drift = readDriftStatus() // doc FILE — doc duoc ca khi Mongo down

  const [RiskState, Position] = await Promise.all([
    engineModel('riskState.mjs', 'RiskState'),
    engineModel('position.mjs', 'Position')
  ])
  if (!RiskState || !Position) {
    return { day, accounts: [], openPositions: 0, mongo: 'down', drift }
  }

  try {
    const today = await RiskState.find({ utcDay: day }).lean()
    let accounts = today.map(toAccountDay)

    if (!accounts.length) {
      // Khong co ban ghi hom nay nhung kill-switch la ban vung (D7c): neu ban
      // ghi moi nhat van halted thi hien thi no de khong "tu mat" qua nua dem.
      const latest = await RiskState.findOne({}).sort({ utcDay: -1, updatedAt: -1 }).lean()
      if (latest && latest.halted) accounts = [toAccountDay(latest)]
    }

    const openPositions = await Position.countDocuments({ status: 'open' })
    return { day, accounts, openPositions, mongo: 'up', drift }
  } catch {
    // Mat ket noi giua chung -> fail-soft: khong 500, bao ro down.
    return { day, accounts: [], openPositions: 0, mongo: 'down', drift }
  }
}
