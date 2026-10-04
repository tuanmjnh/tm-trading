#!/usr/bin/env node
// =============================================================================
//  TM TRADING - AI AGENT (roadmap Phase 11).
//
//  Tool-calling layer over ai/gateway.mjs. Six READ-ONLY tools:
//    queryDB        runs | trades | signals | intel (whitelisted collections)
//    getKlines      candles via engine cache/Binance (compact [t,o,h,l,c,v])
//    scanMovers     intel kind=mover snapshot (24h movers)
//    methodSignals  run every registered method on recent bars
//    regimeSnapshot regime + funding + confluence + movers in one read
//    backtestQuick  simulate one method, return summary stats
//
//  Guardrails (Phase 11): NO tool can place/modify/cancel an order or touch
//  an account — the whitelist below is the entire surface, locked by a test.
//  Every gateway call is audited in logs/ai.ndjson. Output is analysis and
//  PROPOSALS only; anything executable must still pass exec/risk.mjs and a
//  human confirmation.
//
//  Run: node ai/agent.mjs "<prompt>" [maxRounds]
//  Env: inherited from ai/gateway.mjs (AI_*)
// =============================================================================
import { loadEnv } from '../exec/env.mjs'
loadEnv()

import { pathToFileURL } from 'node:url'
import { chat, aiConfig } from './gateway.mjs'
import { fetchKlines } from '../engine/data.mjs'
import { listMethods, getMethod } from '../engine/methods/index.mjs'
import '../engine/methods/all.mjs' // register every method before listMethods()
import { backtest } from '../engine/backtest.mjs'
import { summarizeBacktest } from '../engine/report.mjs'
import { loadRuns, readNdjson, TRADES_FILE } from '../engine/store.mjs'
import { getIntel } from '../services/store.mjs'
import { connectMongo } from '../engine/db.mjs'

const INTEL_KINDS = Object.freeze(['mover', 'flow', 'accum', 'funding', 'news', 'alert', 'regime', 'zone', 'oi', 'supply', 'confluence'])
const RUN_FIELDS = Object.freeze(['symbol', 'tf', 'method', 'preset', 'variant', 'engineVersion', 'paramsHash', 'params', 'createdAt'])

const clampInt = (v, min, max, dflt) => Math.min(max, Math.max(min, Number(v) || dflt))

async function intelModel() {
  return getIntel() // memoized; null = Mongo unavailable (fail-soft below)
}

export const TOOLS = Object.freeze({
  queryDB: {
    description: 'Read recent rows from a whitelisted collection. runs=engine runs, trades=closed trade rows, signals=webhook signals, intel=snapshot kinds (mover|flow|accum|funding|news|alert|regime|zone|oi|supply|confluence). Read-only.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', enum: ['runs', 'trades', 'signals', 'intel'] },
        kind: { type: 'string', description: 'intel kind (required when collection=intel)' },
        symbol: { type: 'string', description: 'optional symbol filter, e.g. BTCUSDT' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['collection'],
    },
    handler: async (p = {}) => {
      const limit = clampInt(p.limit, 1, 50, 20)
      const symbol = p.symbol ? String(p.symbol).toUpperCase() : null
      const coll = String(p.collection || '')
      if (!['runs', 'trades', 'signals', 'intel'].includes(coll)) {
        throw new Error(`collection must be one of runs|trades|signals|intel (got "${coll}")`)
      }
      if (coll === 'runs') {
        let rows = loadRuns()
        if (symbol) rows = rows.filter((r) => String(r.symbol || '').toUpperCase() === symbol)
        return { collection: coll, rows: rows.slice(-limit).reverse().map((r) => {
          const out = {}
          for (const k of RUN_FIELDS) if (r[k] !== undefined) out[k] = r[k]
          return out
        }) }
      }
      if (coll === 'trades') {
        let rows = readNdjson(TRADES_FILE).rows
        if (symbol) rows = rows.filter((r) => String(r.symbol || '').toUpperCase() === symbol)
        return { collection: coll, rows: rows.slice(-limit).reverse() }
      }
      if (coll === 'signals') {
        const mg = await connectMongo()
        if (!mg) return { collection: coll, mongo: 'down', rows: [] }
        const { Signal } = await import('../engine/models/signal.mjs')
        const q = symbol ? { symbol } : {}
        const rows = await Signal.find(q).sort({ ts: -1 }).limit(limit).lean()
        return { collection: coll, mongo: 'up', rows }
      }
      const kind = String(p.kind || '')
      if (!INTEL_KINDS.includes(kind)) throw new Error(`intel collection requires kind (${INTEL_KINDS.join('|')})`)
      const Intel = await intelModel()
      if (!Intel) return { collection: coll, kind, mongo: 'down', rows: [] }
      const rows = await Intel.find({ kind }).sort({ ts: -1 }).limit(limit).lean()
      return { collection: coll, kind, mongo: 'up', rows }
    },
  },

  getKlines: {
    description: 'Candles for one symbol/timeframe from the engine cache (Binance-backed), oldest to newest. Rows are [timeMs, open, high, low, close, volume]. tf uses engine format: 1|5|15|60|4|10|240.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', example: 'BTCUSDT' },
        tf: { type: 'string', default: '60' },
        limit: { type: 'integer', minimum: 20, maximum: 500, default: 200 },
      },
      required: ['symbol'],
    },
    handler: async (p = {}, deps = {}) => {
      const symbol = String(p.symbol || '').toUpperCase()
      const tf = String(p.tf || '60')
      const limit = clampInt(p.limit, 20, 500, 200)
      const k = await fetchKlines({ symbol, tf, limit, fetchImpl: deps.fetchImpl })
      const bars = k.bars.slice(-limit)
      return {
        symbol: k.symbol, tf: k.tf, source: k.source, fromCache: k.fromCache, count: bars.length,
        bars: bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]),
      }
    },
  },

  scanMovers: {
    description: 'Top 24h movers from the scanner service snapshot (intel kind=mover, already ranked by absolute change). Read-only.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 } },
    },
    handler: async (p = {}) => {
      const limit = clampInt(p.limit, 1, 20, 10)
      const Intel = await intelModel()
      if (!Intel) return { mongo: 'down', rows: [] }
      const rows = await Intel.find({ kind: 'mover' }).limit(limit).lean()
      return { mongo: 'up', rows }
    },
  },

  methodSignals: {
    description: 'Run every registered analysis method (vsa/price-action/trend/orderflow) on recent candles; returns each method last score + recent events + setup count. CPU-only read, no orders.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', default: 'BTCUSDT' },
        tf: { type: 'string', default: '60' },
        limit: { type: 'integer', minimum: 60, maximum: 500, default: 150, description: 'bars to analyze' },
        events: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'events returned per method' },
      },
    },
    handler: async (p = {}, deps = {}) => {
      const symbol = String(p.symbol || 'BTCUSDT').toUpperCase()
      const tf = String(p.tf || '60')
      const limit = clampInt(p.limit, 60, 500, 150)
      const evMax = clampInt(p.events, 1, 20, 10)
      const k = await fetchKlines({ symbol, tf, limit, fetchImpl: deps.fetchImpl })
      const bars = k.bars.slice(-limit)
      const methods = []
      for (const id of listMethods()) {
        const m = getMethod(id)
        const an = m.analyze(bars)
        const scores = Array.isArray(an?.scores) ? an.scores : []
        let lastScore = 0
        for (let i = scores.length - 1; i >= 0; i--) {
          if (Number.isFinite(scores[i])) { lastScore = scores[i]; break }
        }
        const events = (Array.isArray(an?.events) ? an.events : []).slice(-evMax).map((e) => ({
          bar: e?.bar ?? null,
          time: Number.isFinite(e?.bar) ? bars[e.bar]?.time ?? null : null,
          type: e?.type ?? null,
        }))
        methods.push({ id: m.id, name: m.name, lastScore, setups: Array.isArray(an?.setups) ? an.setups.length : 0, events })
      }
      return { symbol, tf, bars: bars.length, from: bars[0]?.time ?? null, to: bars[bars.length - 1]?.time ?? null, methods }
    },
  },

  regimeSnapshot: {
    description: 'Current market context in one read: latest regime, funding rows, confluence ranking and top movers from intel snapshots. Read-only.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const Intel = await intelModel()
      if (!Intel) return { mongo: 'down', regime: null, funding: [], confluence: [], movers: [] }
      const [regime, funding, confluence, movers] = await Promise.all([
        Intel.find({ kind: 'regime' }).sort({ ts: -1 }).limit(1).lean(),
        Intel.find({ kind: 'funding' }).limit(10).lean(),
        Intel.find({ kind: 'confluence' }).sort({ score: -1 }).limit(8).lean(),
        Intel.find({ kind: 'mover' }).limit(8).lean(),
      ])
      return { mongo: 'up', regime: regime[0] || null, funding, confluence, movers }
    },
  },

  backtestQuick: {
    description: 'Quick backtest of one method on recent candles (simulation only — never places orders). Returns summary stats: net%, PF, win rate, counters.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', default: 'vsa', description: 'method id: vsa|price-action|trend|orderflow' },
        symbol: { type: 'string', default: 'BTCUSDT' },
        tf: { type: 'string', default: '60' },
        bars: { type: 'integer', minimum: 100, maximum: 1000, default: 500 },
      },
    },
    handler: async (p = {}, deps = {}) => {
      const method = String(p.method || 'vsa')
      const symbol = String(p.symbol || 'BTCUSDT').toUpperCase()
      const tf = String(p.tf || '60')
      const n = clampInt(p.bars, 100, 1000, 500)
      const k = await fetchKlines({ symbol, tf, limit: n, fetchImpl: deps.fetchImpl })
      const bars = k.bars.slice(-n)
      const bt = backtest(bars, { method, symbol, tf })
      const summary = summarizeBacktest(bt)
      return { method, symbol, tf, bars: bars.length, summary }
    },
  },
})

/** The entire tool surface — locked by ai/test.mjs (guardrail). */
export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS))

/**
 * Execute one tool by name. Never throws: broken sources come back as
 * {ok:false, error} so a single failure cannot kill an agent round.
 */
export async function executeTool(name, params = {}, deps = {}) {
  const t = TOOLS[name]
  if (!t) {
    return { ok: false, error: `unknown tool "${name}" (allowed: ${TOOL_NAMES.join(', ')})` }
  }
  try {
    const data = await t.handler(params, deps)
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}

/** Gateway tool specs (OpenAI/Anthropic shared shape). */
export function toolSpecs(names = TOOL_NAMES) {
  return names.filter((n) => TOOLS[n]).map((n) => ({
    name: n,
    description: TOOLS[n].description,
    parameters: TOOLS[n].parameters,
  }))
}

export function defaultSystem(language = aiConfig().lang) {
  return [
    'You are TM, a market analyst for a crypto trading desk.',
    'Your tools are READ-ONLY data sources: you can never place, modify or cancel orders, and you must never claim you did.',
    'Ground every statement in tool output; cite symbols, numbers and units; say explicitly when data is missing.',
    'Trade ideas are PROPOSALS only (entry/SL/TP + reason + confluence) and must still pass the risk gate and human confirmation.',
    `Reply in ${language}. Keep it concise and skimmable.`,
  ].join(' ')
}

/**
 * Tool-calling loop: chat -> execute tools -> feed results back -> repeat
 * until a plain answer or `maxRounds` (then truncated:true, never infinite).
 *
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} [o.system]
 * @param {string[]} [o.toolNames] subset of TOOL_NAMES (default: all)
 * @param {number} [o.maxRounds]
 * @param {string} [o.language] reply language (AI_LANG)
 * @param {Function} [o.chatImpl] injectable gateway (tests)
 * @param {Function} [o.executeImpl] injectable tool executor (tests)
 * @param {object} [o.gatewayFetch] fetch for the model HTTP call
 * @param {object} [o.dataFetch] (url)=>payload for kline reads
 * @returns {Promise<{text:string, rounds:number, toolCalls:string[], usage:object, truncated:boolean}>}
 */
export async function runAgent(o = {}) {
  const prompt = String(o.prompt || '').trim()
  if (!prompt) throw new Error('runAgent: missing prompt')
  const cfg = o.cfg || aiConfig()
  const chatImpl = o.chatImpl || chat
  const executeImpl = o.executeImpl || executeTool
  const maxRounds = Math.max(1, Math.min(12, Number(o.maxRounds) || 6))
  const specs = toolSpecs(o.toolNames || TOOL_NAMES)
  const messages = [
    { role: 'system', content: o.system || defaultSystem(o.language || cfg.lang) },
    { role: 'user', content: prompt },
  ]
  const used = []
  const usage = { prompt: 0, completion: 0 }
  let text = ''
  for (let round = 1; round <= maxRounds; round++) {
    const res = await chatImpl(messages, specs, {
      cfg, tag: o.tag || '[ai:agent]', fetchImpl: o.gatewayFetch, limiter: o.limiter, now: o.now,
    })
    usage.prompt += res.usage?.prompt || 0
    usage.completion += res.usage?.completion || 0
    if (!res.toolCalls.length) {
      return { text: res.text, rounds: round, toolCalls: used, usage, truncated: false, model: res.model, ms: res.ms }
    }
    if (res.text) text = res.text
    messages.push({ role: 'assistant', content: res.text || '', toolCalls: res.toolCalls })
    for (const c of res.toolCalls) {
      used.push(c.name)
      const out = await executeImpl(c.name, c.args || {}, { fetchImpl: o.dataFetch })
      messages.push({ role: 'tool', toolCallId: c.id, content: JSON.stringify(out) })
    }
  }
  return { text, rounds: maxRounds, toolCalls: used, usage, truncated: true, error: 'agent.max-rounds' }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const prompt = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ')
  const maxRounds = Number(process.argv.find((a) => a.startsWith('--rounds='))?.split('=')[1]) || 6
  try {
    const res = await runAgent({ prompt, maxRounds })
    console.log(JSON.stringify(res, null, 2))
    process.exit(res.text ? 0 : 2)
  } catch (e) {
    console.error(JSON.stringify({ error: String(e?.message || e), code: e?.code || null }))
    process.exit(1)
  }
}
