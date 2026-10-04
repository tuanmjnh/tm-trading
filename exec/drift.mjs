#!/usr/bin/env node
// =============================================================================
//  TM TRADING - PARITY DRIFT GUARD (roadmap Phase 6 / D8)
//
//  "Drift must have AN ACTION, not just a report": if the signals TradingView
//  fired stop matching what the engine sees on the same data, the system is
//  trading on signals already known to be off — roadmap risk #1.
//
//  One check (window = DRIFT_WINDOW_H, default 24h):
//    TV side    = ENTRY alerts grouped by (symbol, tf)
//    ENGINE side = analyze() on the same symbol/tf bars -> planned setups whose
//                  bar time falls in the window (same VSA method, same data)
//    breach     = per pair: |tv - engine| > DRIFT_MAX_DIFF
//                 OR relative diff > DRIFT_MAX_PCT when the pair has enough
//                   samples (>= DRIFT_MIN_TOTAL) — avoids 1-vs-0 noise
//  On breach:
//    1. halt the risk gate with reason 'drift' (blocks NEW orders only — open
//       positions keep their SL/TP, same policy as the kill-switch);
//    2. append audit events to logs/risk.ndjson;
//    3. push a Telegram message (when configured).
//  Resuming is MANUAL ONLY: node exec/drift.mjs resume <reason>
//
//  CLI:
//    node exec/drift.mjs check              one check (default)
//    node exec/drift.mjs resume [reason]    operator resume after investigation
//    node exec/drift.mjs --watch            loop every DRIFT_INTERVAL sec (3600)
// =============================================================================
import { loadEnv } from './env.mjs'
import { halt, resume, loadSnapshot, loadRiskConfig, auditLog } from './risk.mjs'
import { pathToFileURL } from 'node:url'

loadEnv()

export const DRIFT_DEFAULTS = Object.freeze({
  windowH: Number(process.env.DRIFT_WINDOW_H || 24),
  maxDiff: Number(process.env.DRIFT_MAX_DIFF || 3),
  maxPct: Number(process.env.DRIFT_MAX_PCT || 50),
  minTotal: Number(process.env.DRIFT_MIN_TOTAL || 4),
})

const ENV_MAP = Object.freeze({
  DRIFT_WINDOW_H: 'windowH',
  DRIFT_MAX_DIFF: 'maxDiff',
  DRIFT_MAX_PCT: 'maxPct',
  DRIFT_MIN_TOTAL: 'minTotal',
})

export function loadDriftConfig(env = process.env) {
  const cfg = { ...DRIFT_DEFAULTS }
  for (const [key, field] of Object.entries(ENV_MAP)) {
    const n = Number(env[key])
    if (env[key] !== undefined && env[key] !== '' && Number.isFinite(n)) cfg[field] = n
  }
  return cfg
}

/** TV tf ('15', '1h', '1D', '60'...) -> engine/Binance tf ('15','60','D'). */
export function engineTf(tf) {
  const s = String(tf ?? '').trim()
  if (!s) return null
  const table = { '1': '1', '3': '3', '5': '5', '15': '15', '30': '30', '60': '60', '120': '120', '240': '240', '360': '360', '720': '720', D: 'D', '1D': 'D' }
  if (table[s]) return table[s]
  const m = s.match(/^(\d+)m$/)
  if (m && table[m[1]]) return table[m[1]]
  const h = s.match(/^(\d+)h$/)
  if (h) return table[String(Number(h[1]) * 60)] || null
  return null
}

/**
 * Pure verdict (golden-tested in exec/test-drift.mjs).
 * @param {{symbol:string, tf:string, tv:number, engine:number}[]} rows
 */
export function evaluateDrift(rows, th = DRIFT_DEFAULTS) {
  const flagged = []
  const skipped = []
  for (const r of rows) {
    if (!Number.isFinite(r.tv) || !Number.isFinite(r.engine)) {
      skipped.push(r)
      continue
    }
    const diff = Math.abs(r.tv - r.engine)
    const base = Math.max(r.tv, r.engine)
    const pct = base > 0 ? (diff / base) * 100 : 0
    const overAbs = diff > th.maxDiff
    const overPct = base >= th.minTotal && pct > th.maxPct
    if (overAbs || overPct) flagged.push({ ...r, diff, pct: Math.round(pct) })
  }
  return { breach: flagged.length > 0, flagged, skipped, checked: rows.length - skipped.length }
}

// --- Telegram (fail-soft, same .env keys as the webhook) --------------------
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_TOKEN || ''
  const chat = process.env.TELEGRAM_CHAT_ID || ''
  if (!token || !chat) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    })
    return res.ok
  } catch (e) {
    console.warn('[drift] telegram fail:', e?.message)
    return false
  }
}

const apiSymbol = (s) => (s.endsWith('.P') ? s.slice(0, -2) : s)

// =============================================================================
//  Check
// =============================================================================
export async function runCheck(config = loadRiskConfig(), th = loadDriftConfig()) {
  const out = { checked: 0, breach: false, flagged: [], skipped: [], reasons: [], mongoDown: false, halted: false, messaged: false }
  const db = await import('../engine/db.mjs')
  if (!(await db.connectMongo())) {
    out.mongoDown = true
    console.warn('[drift] Mongo unavailable — check skipped (fail-soft)')
    return out
  }
  const { Alert } = await import('../engine/models/index.mjs')
  const windowStart = Date.now() - th.windowH * 3600_000

  // TV side: ENTRY alerts per (symbol, tf) in the window
  const tvRows = await Alert.aggregate([
    { $match: { action: 'ENTRY', ts: { $gte: new Date(windowStart) }, symbol: { $ne: null } } },
    { $group: { _id: { symbol: '$symbol', tf: '$tf' }, tv: { $sum: 1 }, lastTs: { $max: '$ts' } } },
  ])
  if (!tvRows.length) {
    console.log(`[drift] no TV ENTRY alerts in the last ${th.windowH}h — nothing to compare`)
    auditLog('drift_report', { windowH: th.windowH, checked: 0, breach: false, note: 'no TV signals' })
    return out
  }

  const { fetchKlines, TF_MS } = await import('../engine/data.mjs')
  const { analyze } = await import('../engine/methods/vsa.mjs')
  const rows = []
  for (const r of tvRows) {
    const symbol = r._id.symbol
    const tf = engineTf(r._id.tf)
    if (!tf || !TF_MS[tf]) {
      out.skipped.push({ symbol, tf: r._id.tf, reason: 'unmappable tf' })
      continue
    }
    try {
      // window coverage + lookback for VSA indicators (SV/BC need history)
      const barsNeeded = Math.min(3000, Math.ceil((th.windowH * 3600_000) / TF_MS[tf]) + 400)
      const { bars } = await fetchKlines({ symbol: apiSymbol(symbol), tf, refresh: true, limit: barsNeeded })
      const an = analyze(bars, {})
      let engineCount = 0
      for (const s of an.setups || []) {
        const b = bars[s.bar]
        if (b && b.time >= windowStart) engineCount++
      }
      rows.push({ symbol, tf, tv: r.tv, engine: engineCount })
    } catch (e) {
      // No data -> cannot judge this pair. Never false-halt on fetch failures.
      out.skipped.push({ symbol, tf, reason: e?.message || String(e) })
      console.warn(`[drift] skip ${symbol} ${tf}:`, e?.message || e)
    }
  }

  const verdict = evaluateDrift(rows, th)
  out.checked = verdict.checked
  out.flagged = verdict.flagged
  out.skipped.push(...verdict.skipped)
  out.breach = verdict.breach
  out.reasons = verdict.flagged.map((f) => `${f.symbol}/${f.tf}: TV=${f.tv} engine=${f.engine} (Δ${f.diff}, ${f.pct}%)`)

  auditLog('drift_report', { windowH: th.windowH, checked: out.checked, breach: out.breach, rows, skipped: out.skipped.length })

  if (!verdict.breach) {
    console.log(`[drift] OK — ${out.checked} pair(s) compared in ${th.windowH}h window${out.skipped.length ? ` (${out.skipped.length} skipped)` : ''}`)
    return out
  }

  // --- BREACH: halt new orders + audit + Telegram (D8 "must have action") ---
  console.warn(`[drift] BREACH — ${out.reasons.join(' | ')}`)
  auditLog('drift_breach', { windowH: th.windowH, flagged: verdict.flagged, skipped: out.skipped })

  const snap = await loadSnapshot(config)
  const alreadyHalted = snap.day.halted && snap.day.haltReason === 'drift'
  if (!alreadyHalted) {
    const h = await halt('drift', { config, by: 'drift-guard' })
    out.halted = !h.mongoDown
    out.messaged = await sendTelegram(
      [
        '🚨 TM Trading — PARITY DRIFT (D8)',
        `Cửa sổ ${th.windowH}h, ${out.checked} cặp symbol/tf:`,
        ...out.reasons.map((s) => `• ${s}`),
        `Đã TẠM DỪNG mở lệnh mới (reason=drift). Vị thế đang mở giữ nguyên (SL/TP bảo vệ).`,
        `Điều tra xong -> node exec/drift.mjs resume <lý do>`,
      ].join('\n'),
    )
  } else {
    console.log('[drift] already halted for drift — no duplicate Telegram')
  }
  return out
}

// =============================================================================
//  CLI
// =============================================================================
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  const watch = args.includes('--watch')
  const ivIdx = args.indexOf('--interval')
  const intervalSec = ivIdx >= 0 && Number.isFinite(Number(args[ivIdx + 1])) ? Number(args[ivIdx + 1]) : Number(process.env.DRIFT_INTERVAL || 3600)
  const cmd = args.find((a) => !a.startsWith('--'))
  const config = loadRiskConfig()

  try {
    if (cmd === 'resume') {
      const reason = args.filter((a) => !a.startsWith('--') && a !== 'resume').join(' ') || 'drift-cleared'
      console.log(JSON.stringify(await resume(reason, { config, by: 'drift-cli' }), null, 2))
    } else if (watch) {
      console.log(`[drift] watch — every ${intervalSec}s (Ctrl+C to stop)`)
      let running = false
      const tick = async () => {
        if (running) return
        running = true
        try { await runCheck(config) } catch (e) { console.error('[drift]', e?.message || e) } finally { running = false }
      }
      tick()
      const timer = setInterval(tick, intervalSec * 1000)
      process.on('SIGINT', () => { clearInterval(timer); console.log('\n[drift] stopped'); process.exit(0) })
      process.on('SIGTERM', () => { clearInterval(timer); process.exit(0) })
    } else {
      const out = await runCheck(config)
      process.exit(out.mongoDown ? 1 : out.breach ? 2 : 0)
    }
  } catch (e) {
    console.error('[drift] error:', e?.message || e)
    process.exit(1)
  }
}
