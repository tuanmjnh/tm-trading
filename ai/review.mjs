#!/usr/bin/env node
// =============================================================================
//  TM TRADING — PERIODIC AI TRADE REVIEW (roadmap Phase 13, item 2) — SCAFFOLD
//
//  WHAT THIS FILE IS: the reusable, testable plumbing for a periodic review of
//  the trade journal —
//    1. `reviewDigest(entries)`  deterministic statistics of the journal
//       (by source / method / regime / symbol + the worst closed trades);
//    2. `buildReviewPrompt(digest)` / `reviewMessages(digest)`  the prompt,
//       including the recurring-error taxonomy the roadmap names (late entry,
//       SL too wide, trading against the regime, ...);
//    3. `parseReviewProposals(text)`  tolerant parser for the rule proposals;
//    4. `runReview()`  the single entry point — it goes through
//       `ai/gateway.mjs` `chat()` ONLY (never a provider directly), and returns
//       proposals as data.
//
//  WHAT THIS FILE IS NOT (deliberate — see the Phase 13 report):
//    - it is NOT scheduled: nothing in `services/run.mjs` calls it, so it cannot
//      run on its own or fire a Telegram message;
//    - it does NOT persist proposals and does NOT feed anything back into the
//      engine: the feedback loop stays OPEN until there are enough real trades
//      for a proposal to mean anything;
//    - it has NO order path. Proposals are text; the only executable route in
//      this repo is still `exec/risk.mjs` + a human (Phase 11 guardrail).
//
//  The evidence gate is part of the scaffold on purpose: `runReview()` refuses
//  to spend a model call (and to produce confident advice) when the journal has
//  fewer than `minTrades` closed trades with a derivable R (D12). Pass
//  `{ force: true }` to review anyway — the prompt then says so out loud.
//
//  Run: node ai/review.mjs [--limit 200] [--min-trades 20] [--force]
//  Env: AI_* (see ai/gateway.mjs)
// =============================================================================
import { pathToFileURL } from 'node:url'

import { chat, aiConfig } from './gateway.mjs'
import {
  MIN_TRADES_FOR_EVIDENCE, UNKNOWN, journalStats, groupJournal,
} from '../engine/journal.mjs'

/** The recurring-error classes the roadmap asks the review to look for. */
export const PROPOSAL_KINDS = Object.freeze([
  'entry-too-late',
  'sl-too-wide',
  'against-regime',
  'rr-too-low',
  'exit-too-early',
  'other',
])

/** Guardrail text — same rule as ai/agent.mjs and ai/daily-brief.mjs. */
export const REVIEW_SYSTEM = [
  'You are TM, reviewing the trade journal of a single-operator crypto trade desk.',
  'You may only read the digest you are given; you cannot place, modify or cancel orders and you must never claim you did.',
  'Every output is a PROPOSAL for a human to accept or reject; anything executable must still pass exec/risk.mjs.',
  'Ground every proposal in the numbers of the digest (sample size, R multiples, win rate) and say when the sample is too small to conclude anything.',
  'Never invent a statistic that is not in the digest.',
].join(' ')

const round = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : x)

/**
 * null/undefined/'' -> null, anything non-numeric -> null. Number(null) is 0 and
 * Number('') is 0, so a plain Number.isFinite(Number(x)) check would turn a
 * MISSING value into a real 0 — the exact defect class the risk gate has with
 * `tps.map(Number)`. Never let "unknown" become a number here.
 */
const numOrNull = (x) => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null)
const hasR = (e) => e.result !== 'OPEN' && numOrNull(e.rMultiple) !== null

/** Compact, serialisable snapshot of one stats object (no unbounded fields). */
function statsView(s) {
  return {
    n: s.n,
    closed: s.closed,
    open: s.open,
    rSamples: s.rSamples,
    rMissing: s.rMissing,
    wins: s.wins,
    losses: s.losses,
    winRate: s.winRate === null ? null : round(s.winRate),
    expectancyR: s.expectancyR === null ? null : round(s.expectancyR),
    medianR: s.medianR === null ? null : round(s.medianR),
    profitFactorR: s.profitFactorR === null ? null : Number.isFinite(s.profitFactorR) ? round(s.profitFactorR) : 'inf',
    insufficient: s.insufficient,
    insufficientReason: s.insufficientReason,
  }
}

const groupView = (entries, field, { minTrades, topN }) =>
  groupJournal(entries, [field], { minTrades }).slice(0, topN).map((g) => ({
    value: g.values[field],
    stats: statsView(g.stats),
  }))

/**
 * Deterministic digest of the journal for one review. No clock, no IO: the same
 * entries always produce the same digest, which is what makes the prompt (and
 * therefore the audit trail) reproducible.
 */
export function reviewDigest(entries, { minTrades = MIN_TRADES_FOR_EVIDENCE, topN = 5 } = {}) {
  const list = (entries ?? []).filter(Boolean)
  const overall = journalStats(list, { minTrades })
  const closed = list.filter(hasR)
  const worst = [...closed].sort((a, b) => Number(a.rMultiple) - Number(b.rMultiple)).slice(0, topN).map((e) => ({
    symbol: e.symbol ?? UNKNOWN,
    tf: e.tf ?? UNKNOWN,
    method: e.method ?? UNKNOWN,
    regime: e.regime ?? UNKNOWN,
    dir: e.dir,
    result: e.result ?? UNKNOWN,
    rMultiple: round(Number(e.rMultiple)),
    entryTime: e.entryTime instanceof Date ? e.entryTime.toISOString() : e.entryTime ?? null,
  }))
  const best = [...closed].sort((a, b) => Number(b.rMultiple) - Number(a.rMultiple)).slice(0, topN).map((e) => ({
    symbol: e.symbol ?? UNKNOWN,
    result: e.result ?? UNKNOWN,
    rMultiple: round(Number(e.rMultiple)),
  }))
  const ready = overall.rSamples >= minTrades
  return {
    total: list.length,
    overall: statsView(overall),
    bySource: groupView(list, 'source', { minTrades, topN }),
    byMethod: groupView(list, 'method', { minTrades, topN }),
    byRegime: groupView(list, 'regime', { minTrades, topN }),
    bySymbol: groupView(list, 'symbol', { minTrades, topN }),
    worstTrades: worst,
    bestTrades: best,
    unknownTags: overall.unknownTagCounts,
    evidence: {
      minTrades,
      rSamples: overall.rSamples,
      ready,
      reason: ready
        ? null
        : overall.insufficientReason ?? `insufficient evidence: ${overall.rSamples}/${minTrades} closed trades with a derivable R`,
    },
  }
}

/**
 * The user prompt: digest + the output contract. `language` only changes the
 * reply language (AI_LANG), never the numbers.
 */
export function buildReviewPrompt(digest, { language = aiConfig().lang, note = null } = {}) {
  return [
    `Review this trade journal digest and propose concrete rule changes.`,
    note ? `IMPORTANT: ${note} Say so explicitly instead of drawing conclusions.` : '',
    ``,
    `Journal digest (JSON):`,
    JSON.stringify(digest, null, 2),
    ``,
    `Answer with ONE JSON object and nothing else:`,
    `{"proposals":[{"id":"p1","kind":"<${PROPOSAL_KINDS.join('|')}>","title":"short rule change","rule":"the rule in one sentence, testable","evidence":"which numbers in the digest support it","confidence":0.0}],"notes":"anything the operator must know (sample size, missing tags)"}`,
    `Rules:`,
    `- at most 5 proposals, ordered by how much the evidence supports them;`,
    `- a proposal whose evidence is a bucket marked "insufficient": true must say "small sample" in its evidence;`,
    `- never propose parameter tuning when the digest shows fewer than the required R samples (D12);`,
    `- no order instructions, no position sizes.`,
    `Reply in ${language}.`,
  ].filter((l) => l !== '').join('\n')
}

/** Canonical messages for ai/gateway.mjs `chat()`. */
export function reviewMessages(digest, opts = {}) {
  return [
    { role: 'system', content: REVIEW_SYSTEM },
    { role: 'user', content: buildReviewPrompt(digest, opts) },
  ]
}

function normalizeProposal(p, i) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const kind = PROPOSAL_KINDS.includes(String(p.kind)) ? String(p.kind) : 'other'
  const rule = p.rule === undefined || p.rule === null ? '' : String(p.rule)
  const title = p.title ? String(p.title) : rule ? rule.slice(0, 80) : ''
  if (!title && !rule) return null
  return {
    id: p.id ? String(p.id) : `p${i + 1}`,
    kind,
    title,
    rule,
    evidence: p.evidence === undefined || p.evidence === null ? '' : String(p.evidence),
    confidence: numOrNull(p.confidence),
  }
}

/**
 * Tolerant parser: the model may wrap its JSON in a fence or add prose. We look
 * for a fenced block, then an object, then an array — and never throw, because a
 * malformed answer must not break the caller.
 */
export function parseReviewProposals(text) {
  const raw = String(text ?? '')
  const candidates = []
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1])
  const oFirst = raw.indexOf('{')
  const oLast = raw.lastIndexOf('}')
  if (oFirst >= 0 && oLast > oFirst) candidates.push(raw.slice(oFirst, oLast + 1))
  const aFirst = raw.indexOf('[')
  const aLast = raw.lastIndexOf(']')
  if (aFirst >= 0 && aLast > aFirst) candidates.push(raw.slice(aFirst, aLast + 1))

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c)
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.proposals) ? parsed.proposals : null
      if (!list) continue
      return {
        proposals: list.map(normalizeProposal).filter(Boolean),
        notes: typeof parsed?.notes === 'string' ? parsed.notes : null,
        error: null,
      }
    } catch {
      // try the next candidate shape
    }
  }
  return { proposals: [], notes: null, error: 'no JSON proposals found in the model output' }
}

/**
 * The review entry point. Goes through ai/gateway.mjs ONLY (`chat`), so every
 * call is rate-limited and audited in logs/ai.ndjson exactly like the agent.
 *
 * @param {object} o
 * @param {object[]} [o.entries]   journal rows (or pass a prebuilt `digest`)
 * @param {object}   [o.digest]    result of reviewDigest()
 * @param {number}   [o.minTrades] evidence threshold (D12)
 * @param {boolean}  [o.force]     review even with too little evidence (says so in the prompt)
 * @param {Function} [o.chatImpl]  injected gateway call (tests: no network, no key)
 * @returns {Promise<object>} { ok, skipped, proposals, ... } — never an order, never a write
 */
export async function runReview(o = {}) {
  const digest = o.digest ?? reviewDigest(o.entries ?? [], { minTrades: o.minTrades ?? MIN_TRADES_FOR_EVIDENCE })
  if (!digest.evidence.ready && !o.force) {
    return {
      ok: false,
      skipped: true,
      reason: `review skipped: ${digest.evidence.reason} (Phase 13 item 2 needs accumulated real trades)`,
      proposals: [],
      digest,
      orderPath: 'none',
    }
  }
  const chatImpl = o.chatImpl ?? chat
  const messages = reviewMessages(digest, {
    language: o.language,
    note: digest.evidence.ready ? null : digest.evidence.reason,
  })
  const res = await chatImpl(messages, [], {
    cfg: o.cfg,
    tag: o.tag ?? '[ai:review]',
    logFile: o.logFile,
    limiter: o.limiter,
    now: o.now,
    fetchImpl: o.fetchImpl,
  })
  const parsed = parseReviewProposals(res?.text)
  return {
    ok: true,
    skipped: false,
    proposals: parsed.proposals,
    parseError: parsed.error,
    notes: parsed.notes,
    text: res?.text ?? '',
    usage: res?.usage ?? null,
    model: res?.model ?? null,
    ms: res?.ms ?? null,
    digest,
    orderPath: 'none',
  }
}

// =============================================================================
//  CLI — reads the journal, prints proposals. Never writes, never orders.
// =============================================================================
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  const val = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  try {
    const { loadJournal } = await import('../engine/journal.mjs')
    const loaded = await loadJournal({ mongo: 'auto', limit: Number(val('--limit')) || 200 })
    const digest = reviewDigest(loaded.entries, { minTrades: Number(val('--min-trades')) || MIN_TRADES_FOR_EVIDENCE })
    console.log(`[review] journal source=${loaded.source} rows=${loaded.entries.length} R-samples=${digest.overall.rSamples} minTrades=${digest.evidence.minTrades}`)
    if (loaded.warnings?.length) for (const w of loaded.warnings) console.warn(`[review] ${w}`)
    const cfg = aiConfig()
    if (cfg.provider !== 'ollama' && !cfg.apiKey) {
      console.log('[review] SKIP — no AI_API_KEY configured; prompt/digest plumbing is ready, nothing was sent')
      console.log(`[review] evidence ready=${digest.evidence.ready}${digest.evidence.reason ? ` (${digest.evidence.reason})` : ''}`)
      process.exit(0)
    }
    const out = await runReview({ digest, force: args.includes('--force') })
    if (out.skipped) {
      console.log(`[review] ${out.reason}`)
      process.exit(0)
    }
    console.log(JSON.stringify({ proposals: out.proposals, notes: out.notes, parseError: out.parseError, model: out.model, ms: out.ms, usage: out.usage, orderPath: out.orderPath }, null, 2))
  } catch (e) {
    console.error(`[review] error (${e?.code ?? 'unknown'}):`, e?.message || e)
    process.exit(1)
  }
  process.exit(0)
}
