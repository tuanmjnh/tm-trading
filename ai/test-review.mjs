#!/usr/bin/env node
// =============================================================================
//  TM TRADING — fixtures for ai/review.mjs (roadmap Phase 13, item 2 SCAFFOLD)
//
//  No network, no API key, no Mongo: every gateway call is injected
//  (`chatImpl`), which is also the proof that the scaffold goes through
//  ai/gateway.mjs instead of talking to a provider itself.
//
//  Run: node ai/test-review.mjs   (wired into `npm test`)
// =============================================================================
import {
  PROPOSAL_KINDS, REVIEW_SYSTEM, reviewDigest, buildReviewPrompt, reviewMessages,
  parseReviewProposals, runReview,
} from './review.mjs'
import { normalizeEntry } from '../engine/journal.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
function finish() {
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
  process.exit(fail === 0 ? 0 : 1)
}
process.on('uncaughtException', (e) => { fail++; console.log(`  FAIL (unexpected throw) — ${e?.message || e}`); finish() })
process.on('unhandledRejection', (e) => { fail++; console.log(`  FAIL (unhandled rejection) — ${e?.message || e}`); finish() })

/** n closed journal rows: `wins` of them +2R, the rest -1R. */
const rows = (n, wins, extra = {}) => Array.from({ length: n }, (_, i) => normalizeEntry({
  source: i % 2 ? 'paper' : 'mt5',
  account: 'paper',
  id: `row-${n}-${wins}-${i}`,
  symbol: i % 3 ? 'BTCUSDT' : 'ETHUSDT',
  tf: '15',
  dir: 1,
  entryPrice: 100,
  sl: 95,
  tps: [110],
  exitPrice: i < wins ? 110 : 95,
  result: i < wins ? 'TP' : 'SL',
  method: i % 2 ? 'vsa' : 'price-action',
  regime: i % 4 ? 'alt' : 'btc',
  entryTime: new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString(),
  ...extra,
}))

const small = rows(5, 3)
const big = rows(25, 16)

// =============================================================================
section('1. reviewDigest — deterministic statistics of the journal')

const d = reviewDigest(big, { minTrades: 20 })
check('totals carried over', d.total === 25 && d.overall.n === 25 && d.overall.closed === 25)
check('win rate + expectancy in R computed', Math.abs(d.overall.winRate - 16 / 25) < 1e-12 && Math.abs(d.overall.expectancyR - (16 * 2 - 9) / 25) < 1e-12, JSON.stringify({ wr: d.overall.winRate, e: d.overall.expectancyR }))
check('enough R samples -> evidence ready', d.evidence.ready === true && d.evidence.reason === null)
check('by source / method / regime / symbol present', d.bySource.length === 2 && d.byMethod.length === 2 && d.byRegime.length === 2 && d.bySymbol.length === 2)
check('group stats are serialisable views, not full objects', Object.keys(d.bySource[0].stats).includes('expectancyR') && !('unknownTagCounts' in d.bySource[0].stats))
check('worst trades sorted by R ascending', d.worstTrades[0].rMultiple <= d.worstTrades[d.worstTrades.length - 1].rMultiple && d.worstTrades.length === 5)
check('best trades sorted by R descending', d.bestTrades[0].rMultiple === 2)
check('worst trade carries the tags the review needs', ['symbol', 'tf', 'method', 'regime', 'result'].every((k) => k in d.worstTrades[0]))
check('unknown tags surfaced for the model to see', d.unknownTags.fees === 25)
check('digest is deterministic (same input -> same digest)', JSON.stringify(reviewDigest(big, { minTrades: 20 })) === JSON.stringify(d))
check('digest is JSON-serialisable (no Date objects leak into the prompt)', (() => { try { JSON.parse(JSON.stringify(d)); return true } catch { return false } })())
check('entryTime is an ISO string in the digest', /Z$/.test(d.worstTrades[0].entryTime))
// Number(null) === 0 is a real trap: a closed trade whose R is UNKNOWN must not
// appear in the digest as a 0R trade (that would feed the model a made-up number).
const noRFloat = normalizeEntry({ source: 'manual', account: 'manual', id: 'nr', symbol: 'NORUSDT', dir: 1, entryPrice: 100, sl: 100, tps: [110], exitPrice: 95, result: 'SL', entryTime: '2026-10-01T00:00:00Z' })
const dNoR = reviewDigest([...big, noRFloat], { minTrades: 20 })
check('a closed trade with an underivable R is NOT reported as a 0R trade', !dNoR.worstTrades.some((t) => t.symbol === 'NORUSDT'))
check('every listed trade has a real R', dNoR.worstTrades.every((t) => Number.isFinite(t.rMultiple) && t.rMultiple !== 0))
check('the missing R is reported instead of being invented', dNoR.overall.rMissing === 1 && dNoR.overall.rSamples === 25)

const dSmall = reviewDigest(small, { minTrades: 20 })
check('too few R samples -> evidence NOT ready', dSmall.evidence.ready === false)
check('not-ready reason names the sample size', /5\/20/.test(dSmall.evidence.reason), dSmall.evidence.reason)
check('insufficient groups are flagged inside the digest too', dSmall.bySource.every((g) => g.stats.insufficient === true))
check('digest of an empty journal does not throw', reviewDigest([], {}).total === 0 && reviewDigest([]).evidence.ready === false)
check('topN is configurable', reviewDigest(big, { minTrades: 20, topN: 2 }).worstTrades.length === 2)

// =============================================================================
section('2. buildReviewPrompt — digest + output contract, no order talk')

const prompt = buildReviewPrompt(d, { language: 'en' })
check('prompt embeds the digest JSON', prompt.includes('"rSamples"') && prompt.includes('"expectancyR"'))
check('prompt states the output contract', /"proposals"/.test(prompt) && /"confidence"/.test(prompt) && /"evidence"/.test(prompt))
check('prompt lists the recurring-error taxonomy', PROPOSAL_KINDS.every((k) => prompt.includes(k)))
check('prompt forbids order instructions', /no order instructions/.test(prompt))
check('prompt honours the requested language', /Reply in en\./.test(prompt))
check('prompt repeats the D12 rule (no tuning on thin evidence)', /D12/.test(prompt))
const noted = buildReviewPrompt(dSmall, { language: 'en', note: dSmall.evidence.reason })
check('a not-ready digest can be reviewed, but the prompt says so out loud', /IMPORTANT: insufficient evidence/.test(noted))
check('prompt builder is pure (two calls identical)', buildReviewPrompt(d, { language: 'en' }) === prompt)

const msgs = reviewMessages(d, { language: 'en' })
check('messages: system + user, in that order', msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user')
check('system prompt is the guardrail text', msgs[0].content === REVIEW_SYSTEM)
check('user message is the built prompt', msgs[1].content === prompt)
check('guardrail: proposals only + risk gate named', /PROPOSAL/.test(REVIEW_SYSTEM) && /exec\/risk\.mjs/.test(REVIEW_SYSTEM))
check('guardrail: never invent a statistic', /Never invent/.test(REVIEW_SYSTEM))

// =============================================================================
section('3. parseReviewProposals — tolerant, never throws')

const fenced = parseReviewProposals('Here you go:\n```json\n{"proposals":[{"id":"p1","kind":"sl-too-wide","title":"tighten SL","rule":"cap SL at 1.5x ATR","evidence":"9 losses at -1R","confidence":0.7}],"notes":"small sample"}\n```')
check('fenced JSON parsed', fenced.error === null && fenced.proposals.length === 1)
check('proposal fields normalised', fenced.proposals[0].kind === 'sl-too-wide' && fenced.proposals[0].confidence === 0.7 && fenced.proposals[0].rule === 'cap SL at 1.5x ATR')
check('notes captured', fenced.notes === 'small sample')

const plain = parseReviewProposals('{"proposals":[{"title":"x","rule":"r","kind":"weird-kind"}]}')
check('unknown kind falls back to "other" (never a bogus class)', plain.proposals[0].kind === 'other')
check('missing confidence -> null, not a made-up number', plain.proposals[0].confidence === null)
check('explicit null confidence stays null (never 0)', parseReviewProposals('{"proposals":[{"title":"x","rule":"r","confidence":null}]}').proposals[0].confidence === null)
check('a real 0 confidence is preserved as 0', parseReviewProposals('{"proposals":[{"title":"x","rule":"r","confidence":0}]}').proposals[0].confidence === 0)
check('missing id -> generated', /^p\d+$/.test(plain.proposals[0].id))

const bare = parseReviewProposals('[{"rule":"only a rule"}]')
check('bare JSON array accepted', bare.error === null && bare.proposals.length === 1 && bare.proposals[0].title === 'only a rule')
check('title falls back to the rule when absent', bare.proposals[0].title === 'only a rule')

const prose = parseReviewProposals('I reviewed it. The answer is {"proposals":[]} — nothing to propose.')
check('JSON embedded in prose is found', prose.error === null && prose.proposals.length === 0)
const junk = parseReviewProposals('sorry, I cannot help with that')
check('unparseable answer -> error, empty list, NO throw', junk.error !== null && junk.proposals.length === 0)
check('empty/undefined input handled', parseReviewProposals('').error !== null && parseReviewProposals(undefined).proposals.length === 0)
const dropped = parseReviewProposals('{"proposals":[{"kind":"other"},{"title":"kept"}]}')
check('a proposal with neither title nor rule is dropped', dropped.proposals.length === 1 && dropped.proposals[0].title === 'kept')
check('PROPOSAL_KINDS is frozen (the taxonomy cannot be mutated at runtime)', Object.isFrozen(PROPOSAL_KINDS) && PROPOSAL_KINDS.length === 6)

// =============================================================================
section('4. runReview — one entry point, through the gateway, proposals only')

let calls = 0
const fakeChat = async (messages, tools, opts) => {
  calls++
  return {
    text: '{"proposals":[{"kind":"against-regime","title":"skip counter-regime longs","rule":"do not take longs when regime=btc","evidence":"12 trades, WR 25%","confidence":0.5}],"notes":"n=25"}',
    toolCalls: [],
    usage: { prompt: 10, completion: 5 },
    model: 'fake-model',
    ms: 1,
    _messages: messages,
    _tools: tools,
    _opts: opts,
  }
}

calls = 0
const skipped = await runReview({ entries: small, minTrades: 20, chatImpl: fakeChat })
check('not enough evidence -> the review is SKIPPED', skipped.ok === false && skipped.skipped === true)
check('skipped review spends NO model call', calls === 0)
check('skip reason explains why (Phase 13 needs accumulated trades)', /insufficient evidence: 5\/20/.test(skipped.reason), skipped.reason)
check('skipped review returns an empty proposal list', Array.isArray(skipped.proposals) && skipped.proposals.length === 0)
check('no order path exists in the result', skipped.orderPath === 'none' && !('order' in skipped))

calls = 0
let forcedSeen = null
const forcedChat = async (messages) => { calls++; forcedSeen = messages; return { text: '{"proposals":[{"kind":"against-regime","title":"skip counter-regime longs","rule":"do not take longs when regime=btc","evidence":"12 trades, WR 25%","confidence":0.5}],"notes":"n=25"}', toolCalls: [], usage: { prompt: 10, completion: 5 }, model: 'fake-model', ms: 1 } }
const forced = await runReview({ entries: small, minTrades: 20, force: true, chatImpl: forcedChat })
check('force:true reviews anyway', forced.ok === true && forced.skipped === false && calls === 1)
check('forced review tells the model the sample is thin', /IMPORTANT: insufficient evidence/.test(forcedSeen[1].content), forcedSeen[1].content.slice(0, 120))
check('forced review still returns proposals as data', forced.proposals.length === 1 && forced.proposals[0].kind === 'against-regime')
check('usage/model propagated for the audit trail', forced.usage.completion === 5 && forced.model === 'fake-model')

calls = 0
let seen = null
const spy = async (messages, tools, opts) => { calls++; seen = { messages, tools, opts }; return { text: '{"proposals":[{"title":"t","rule":"r"}]}', toolCalls: [], usage: { prompt: 1, completion: 1 }, model: 'm', ms: 2 } }
const ready = await runReview({ entries: big, minTrades: 20, chatImpl: spy })
check('ready digest -> exactly one gateway call', ready.ok === true && calls === 1)
check('gateway called with NO tools (pure text review)', Array.isArray(seen.tools) && seen.tools.length === 0)
check('gateway called with the review tag for the audit log', seen.opts.tag === '[ai:review]')
check('messages: system guardrail + prompt with the digest', seen.messages.length === 2 && seen.messages[0].content === REVIEW_SYSTEM && seen.messages[1].content.includes('"rSamples"'))
check('proposals parsed from the model answer', ready.proposals.length === 1 && ready.proposals[0].title === 't')
check('no order path in a successful review either', ready.orderPath === 'none' && !('order' in ready) && !('qty' in ready))
check('review result carries the digest it was based on', ready.digest.overall.rSamples === 25)
check('a prebuilt digest can be passed instead of entries', (await runReview({ digest: reviewDigest(big, { minTrades: 20 }), chatImpl: spy })).ok === true)

let threw = null
try {
  await runReview({ entries: big, minTrades: 20, chatImpl: async () => { const e = new Error('no key'); e.code = 'ai.no-key'; throw e } })
} catch (e) { threw = e }
check('gateway errors propagate (the caller decides how to log them)', threw?.code === 'ai.no-key')
let parseFail = null
try { parseFail = await runReview({ entries: big, minTrades: 20, chatImpl: async () => ({ text: 'no json here', toolCalls: [], usage: {}, model: 'm', ms: 1 }) }) } catch (e) { parseFail = { error: e } }
check('a non-JSON answer is reported, not thrown', parseFail?.parseError !== null && parseFail.proposals.length === 0)

// =============================================================================
section('5. guardrails — this scaffold has no execution surface')

const mod = await import('./review.mjs')
check('no exported function can place/modify/cancel an order',
  ['placeOrder', 'sendOrder', 'execute', 'checkOrder', 'halt', 'resume'].every((n) => typeof mod[n] === 'undefined'))
check('the module never references a provider URL (it uses the gateway)', !Object.keys(mod).some((k) => /fetch|http/i.test(k)))
check('PROPOSAL_KINDS contains only analysis classes', PROPOSAL_KINDS.every((k) => !/order|buy|sell/i.test(k)))

// The whole suite ran with chat injected: prove that no real Mongo connection was
// opened even though ai/gateway.mjs filled MONGODB_URI from .env at import time.
const { isMongoConnected } = await import('../engine/db.mjs')
check('suite never opened a Mongo connection (no real DB touched)', isMongoConnected() === false)

finish()
