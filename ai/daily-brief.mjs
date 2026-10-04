#!/usr/bin/env node
// =============================================================================
//  TM TRADING - DAILY BRIEF (roadmap Phase 11, use-case "daily brief -> TG").
//
//  Morning snapshot for Telegram: gathers context through the agent's
//  READ-ONLY tools (regime/movers/confluence/funding/runs + risk state),
//  asks the model for a compact brief, sends it via services/telegram.
//
//  Gating (fail-soft, never errors the heartbeat):
//   - missing AI_API_KEY        -> {skipped:'no-key'}
//   - outside AI_BRIEF_HOURS    -> {skipped:'outside-window'} (local time,
//     default 6-10, wrap supported: 22-4; force bypasses for manual runs)
//
//  Guardrails: analysis/PROPOSALS only — no order path exists here; the full
//  prompt/response is audited in logs/ai.ndjson by the gateway.
//
//  Run: node ai/daily-brief.mjs --force    (or via services heartbeat)
//  Env: AI_BRIEF_INTERVAL (3600), AI_BRIEF_HOURS (6-10), AI_LANG (vi), AI_*
// =============================================================================
import { loadEnv } from '../exec/env.mjs'
loadEnv()

import { pathToFileURL } from 'node:url'
import { aiConfig, chat } from './gateway.mjs'
import { executeTool } from './agent.mjs'
import { sendTelegram } from '../services/telegram.mjs'
import { loadRiskConfig, loadSnapshot } from '../exec/risk.mjs'

/**
 * Is `now` inside one of the "H-H" windows (local hours, wrap ok) — PURE.
 * Invalid/empty window string = always allowed (lenient, never blocks).
 */
export function inBriefWindow(now = new Date(), windowStr = '6-10') {
  const parts = String(windowStr || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return true
  const h = now.getHours()
  for (const p of parts) {
    const m = p.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/)
    if (!m) continue
    const a = Number(m[1])
    const b = Number(m[2])
    if (Number.isNaN(a) || Number.isNaN(b) || a > 23 || b > 23) continue
    if (a <= b ? h >= a && h <= b : h >= a || h <= b) return true
  }
  return false
}

/** Risk state, trimmed + JSON-safe (fails soft when exec/risk unavailable). */
async function riskContext() {
  try {
    const snap = await loadSnapshot(loadRiskConfig())
    return {
      ok: true,
      mongoDown: !!snap.mongoDown,
      equity: snap.equity ?? null,
      day: snap.day ?? null,
      winStats: snap.winStats ?? null,
      open: (Array.isArray(snap.open) ? snap.open : []).slice(0, 10).map((p) => ({
        symbol: p?.symbol ?? null, side: p?.side ?? null, dir: p?.dir ?? null,
        entryPrice: p?.entryPrice ?? null, qty: p?.qty ?? null,
      })),
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) }
  }
}

/** Gather brief context via the agent's own tools (single data surface — D1). */
export async function briefContext({ execute = executeTool } = {}) {
  const [regime, movers, confluence, funding, runs, risk] = await Promise.all([
    execute('regimeSnapshot', {}),
    execute('scanMovers', { limit: 10 }),
    execute('queryDB', { collection: 'intel', kind: 'confluence', limit: 8 }),
    execute('queryDB', { collection: 'intel', kind: 'funding', limit: 8 }),
    execute('queryDB', { collection: 'runs', limit: 5 }),
    riskContext(),
  ])
  return { regime, movers, confluence, funding, runs, risk }
}

export function buildBriefPrompt(ctx, language = 'vi') {
  return [
    `Daily market brief for the crypto trading desk. Reply in ${language}, plain text (no markdown fences), under 1200 characters.`,
    'Sections: (1) market state one line (season, fear&greed, regime) (2) top movers max 4 with % (3) funding/confluence extremes worth watching (4) risk state if present (halt, equity, drawdown) (5) 0-2 trade PROPOSALS only when confluence supports it: entry/SL/TP + why; label them as proposals that still need the risk gate and human confirmation.',
    'If a data block is empty or errored, say so in one short line instead of inventing numbers.',
    '',
    'Data (JSON from read-only tools):',
    JSON.stringify(ctx),
  ].join('\n')
}

/**
 * Run the daily brief once. Returns a summary for the heartbeat:
 * {skipped:'no-key'|'outside-window'} | {ok:true, sent, chars, ms, usage}.
 */
export async function runBrief(o = {}) {
  const cfg = o.cfg || aiConfig()
  const now = o.now || new Date()
  const force = !!o.force
  const execute = o.execute || executeTool
  const chatImpl = o.chatImpl || chat
  const sendImpl = o.sendImpl || sendTelegram
  const hours = o.hours ?? (process.env.AI_BRIEF_HOURS || '6-10')

  if (cfg.provider !== 'ollama' && !cfg.apiKey) {
    return { skipped: 'no-key', provider: cfg.provider, at: now.toISOString() }
  }
  if (!force && !inBriefWindow(now, hours)) {
    return { skipped: 'outside-window', hours, at: now.toISOString() }
  }

  const ctx = await briefContext({ execute })
  const prompt = buildBriefPrompt(ctx, cfg.lang)
  const res = await chatImpl([{ role: 'user', content: prompt }], [], { cfg, tag: '[ai:brief]' })
  const sent = await sendImpl(res.text, '[ai:brief]')
  return {
    ok: true, sent: !!sent, chars: res.text.length, ms: res.ms,
    usage: res.usage ?? null, provider: cfg.provider, model: res.model, at: now.toISOString(),
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const force = process.argv.includes('--force')
  try {
    const summary = await runBrief({ force })
    console.log(JSON.stringify(summary, null, 2))
    process.exit(0) // skips are normal (no key / outside window) — fail-soft
  } catch (e) {
    console.error(JSON.stringify({ error: String(e?.message || e), code: e?.code || null }))
    process.exit(1)
  }
}
