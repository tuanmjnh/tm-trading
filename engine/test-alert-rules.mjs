#!/usr/bin/env node
// =============================================================================
//  TM TRADING — fixtures for engine/alertRules.mjs (roadmap §58.5 /alerts).
//
//  Pure logic ONLY: no Mongo, no network, no API key. Proves the rule contract —
//  validation, normalization, the stable definition key, the event matcher and the
//  per-(rule,event) dedupe key — everything the alertRules service relies on.
//
//  Run: node engine/test-alert-rules.mjs   (wired into `npm test`)
// =============================================================================
import {
  ALERT_RULE_VERSION,
  RULE_EVENT_KINDS, RULE_LEVELS, RULE_DIRS, RULE_PRIORITIES,
  validateRule, normalizeRule, ruleKeyFor, matchRule, ruleEventDedupeKey, notifyKindFor,
} from './alertRules.mjs'

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

const NEWS = { kind: 'news', title: 'Exchange hacked, $80M drained', level: 'high', dir: 'neg', source: 'coindesk', symbol: null, tags: ['hack', 'security'], score: 0.9, key: 'news:abc', ts: 1_700_000_000_000 }
const NEWS_LOW = { kind: 'news', title: 'Routine upgrade', level: 'low', dir: 'flat', source: 'coindesk', tags: [], score: 0.2, key: 'news:def', ts: 1_700_000_100_000 }
const ALERT = { kind: 'alert', title: 'Funding extreme BTCUSDT', level: null, dir: 'neg', source: null, symbol: 'BTCUSDT', tags: [], score: 0.7, key: 'alert:funding:BTCUSDT:1', ts: 1_700_000_200_000 }

// =============================================================================
section('1. constants — the ladder is shared, not invented')

check('version stamp', ALERT_RULE_VERSION === 'alert-rule.v1')
check('event kinds', RULE_EVENT_KINDS.join(',') === 'news,alert')
check('levels', RULE_LEVELS.join(',') === 'high,med,low')
check('dirs', RULE_DIRS.join(',') === 'pos,neg,flat')
check('priorities reuse the notify ladder', RULE_PRIORITIES.join(',') === 'critical,important,normal,info')

// =============================================================================
section('2. validateRule — first flaw wins')

check('non-object rejected', validateRule(null).ok === false && validateRule([]).ok === false)
check('name required', validateRule({}).ok === false)
check('name blank rejected', validateRule({ name: '   ' }).ok === false)
check('name too long rejected', validateRule({ name: 'x'.repeat(81) }).ok === false)
check('bad kind rejected', validateRule({ name: 'r', kind: 'tweet' }).ok === false)
check('bad minLevel rejected', validateRule({ name: 'r', minLevel: 'urgent' }).ok === false)
check('bad priority rejected', validateRule({ name: 'r', priority: 'loud' }).ok === false)
check('bad dir rejected', validateRule({ name: 'r', dirs: ['up'] }).ok === false)
check('dirs not array rejected', validateRule({ name: 'r', dirs: 'pos' }).ok === false)
check('symbols not array rejected', validateRule({ name: 'r', symbols: 'BTCUSDT' }).ok === false)
check('negative lookback rejected', validateRule({ name: 'r', lookbackSec: -1 }).ok === false)
check('minimal rule passes', validateRule({ name: 'Security headlines' }).ok === true)

// =============================================================================
section('3. normalizeRule — canonical shape + defaults')

const n = normalizeRule({ name: '  Security headlines  ', symbols: ['btcusdt', 'ethusdt'], sources: ['CoinDesk'], tags: ['Hack'], dirs: ['neg', 'pos'] })
check('default kind news', n.kind === 'news')
check('default minLevel med', n.minLevel === 'med')
check('default priority normal', n.priority === 'normal')
check('enabled defaults true', n.enabled === true)
check('lookback defaults 7d', n.lookbackSec === 7 * 24 * 3600)
check('name trimmed', n.name === 'Security headlines')
check('symbols upper + sorted', n.symbols.join(',') === 'BTCUSDT,ETHUSDT')
check('sources lower', n.sources.join(',') === 'coindesk')
check('tags lower', n.tags.join(',') === 'hack')
check('dirs sorted', n.dirs.join(',') === 'neg,pos')
check('minScore defaults null', n.minScore === null)
check('lookback clamped to 30d', normalizeRule({ name: 'r', lookbackSec: 999 * 24 * 3600 }).lookbackSec === 30 * 24 * 3600)
check('normalizeRule throws on invalid', (() => { try { normalizeRule({}); return false } catch { return true } })())

// =============================================================================
section('4. ruleKeyFor — stable definition identity (D4)')

const base = normalizeRule({ name: 'Rule A', symbols: ['BTCUSDT'] })
check('same definition -> same key', ruleKeyFor(base) === ruleKeyFor(normalizeRule({ name: 'Rule A', symbols: ['BTCUSDT'] })))
check('key prefix r1_', ruleKeyFor(base).startsWith('r1_'))
check('whitespace/case normalize to same key', ruleKeyFor(base) === ruleKeyFor(normalizeRule({ name: 'Rule A', symbols: ['btcusdt'] })))
check('list order does not change the key', ruleKeyFor(normalizeRule({ name: 'Rule A', symbols: ['BTCUSDT'], dirs: ['neg', 'pos'] })) === ruleKeyFor(normalizeRule({ name: 'Rule A', symbols: ['BTCUSDT'], dirs: ['pos', 'neg'] })))
check('enabled toggle keeps the key', ruleKeyFor(base) === ruleKeyFor(normalizeRule({ name: 'Rule A', symbols: ['BTCUSDT'], enabled: false })))
check('lookback change keeps the key', ruleKeyFor(base) === ruleKeyFor(normalizeRule({ name: 'Rule A', symbols: ['BTCUSDT'], lookbackSec: 60 })))
check('different condition -> different key', ruleKeyFor(base) !== ruleKeyFor(normalizeRule({ name: 'Rule A', symbols: ['ETHUSDT'] })))
check('different name -> different key', ruleKeyFor(base) !== ruleKeyFor(normalizeRule({ name: 'Rule B', symbols: ['BTCUSDT'] })))

// =============================================================================
section('5. matchRule — a narrow rule never fires on noise')

const newsRule = normalizeRule({ name: 'News security', kind: 'news', minLevel: 'high' })
check('kind mismatch -> no match', matchRule(newsRule, ALERT) === false)
check('level floor high passes high event', matchRule(newsRule, NEWS) === true)
check('level floor high rejects low event', matchRule(newsRule, NEWS_LOW) === false)
check('minLevel med accepts high', matchRule(normalizeRule({ name: 'r', minLevel: 'med' }), NEWS) === true)
check('minLevel med rejects low', matchRule(normalizeRule({ name: 'r', minLevel: 'med' }), NEWS_LOW) === false)

check('dir filter hits', matchRule(normalizeRule({ name: 'r', dirs: ['neg'] }), NEWS) === true)
check('dir filter misses', matchRule(normalizeRule({ name: 'r', dirs: ['pos'] }), NEWS) === false)

check('source filter hits (case-insensitive)', matchRule(normalizeRule({ name: 'r', sources: ['CoinDesk'] }), NEWS) === true)
check('source filter misses', matchRule(normalizeRule({ name: 'r', sources: ['reuters'] }), NEWS) === false)
check('source filter cannot match an event without a source', matchRule(normalizeRule({ name: 'r', sources: ['coindesk'] }), ALERT) === false)

const symRule = normalizeRule({ name: 'r', kind: 'alert', symbols: ['BTCUSDT'] })
check('symbol filter hits alert', matchRule(symRule, ALERT) === true)
check('symbol filter misses other symbol', matchRule(symRule, { ...ALERT, symbol: 'ETHUSDT' }) === false)
check('symbol filter cannot match an event without a symbol', matchRule(normalizeRule({ name: 'r', symbols: ['BTCUSDT'] }), NEWS) === false)

check('tag filter hits (any-of)', matchRule(normalizeRule({ name: 'r', tags: ['security', 'listing'] }), NEWS) === true)
check('tag filter misses', matchRule(normalizeRule({ name: 'r', tags: ['listing'] }), NEWS) === false)

check('minScore passed', matchRule(normalizeRule({ name: 'r', minScore: 0.5 }), NEWS) === true)
check('minScore failed', matchRule(normalizeRule({ name: 'r', minScore: 0.95 }), NEWS) === false)
check('score floor cannot match an event without a score', matchRule(normalizeRule({ name: 'r', minScore: 0.1 }), { ...NEWS, score: null }) === false)

check('null rule/event -> false', matchRule(null, NEWS) === false && matchRule(newsRule, null) === false)

// =============================================================================
section('6. ruleEventDedupeKey — stable, rule-scoped identity (D4)')

const ruleA = { _id: 'aaaa', ruleKey: 'r1_a' }
const ruleB = { _id: 'bbbb', ruleKey: 'r1_b' }
check('prefix ar1_', ruleEventDedupeKey(ruleA, NEWS).startsWith('ar1_'))
check('same (rule,event) -> same key (replay is a no-op)', ruleEventDedupeKey(ruleA, NEWS) === ruleEventDedupeKey(ruleA, { ...NEWS }))
check('different rule -> different key', ruleEventDedupeKey(ruleA, NEWS) !== ruleEventDedupeKey(ruleB, NEWS))
check('different event -> different key', ruleEventDedupeKey(ruleA, NEWS) !== ruleEventDedupeKey(ruleA, NEWS_LOW))
check('falls back to ruleKey when unsaved', ruleEventDedupeKey({ ruleKey: 'r1_a' }, NEWS) === ruleEventDedupeKey({ _id: 'r1_a' }, NEWS))

// =============================================================================
section('7. notifyKindFor — map onto the notify ladder (§25)')

check('news -> market', notifyKindFor('news') === 'market')
check('alert -> signal', notifyKindFor('alert') === 'signal')

finish()
