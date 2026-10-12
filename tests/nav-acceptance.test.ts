import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateProposal, PROPOSAL_SCHEMA_VERSION } from '../ai/proposal.mjs'
import { mergeScannerCandidates } from '../app/utils/scanner'
import { filterNews, groupNewsByDay } from '../app/utils/calendar'
import { emptyRuleForm, ruleToForm, formToInput, validateRuleForm, ruleFacets, parseList } from '../app/utils/alertRules'
import type { IntelAccum, IntelFlow, IntelMover, IntelNewsItem } from '../types/intel'
import type { AlertRule } from '../types/alertRules'

// =============================================================================
//  §58.10 acceptance lock — the criteria the migration must keep true.
//
//  These are SOURCE-CONTRACT assertions (the same style as ai/test-review.mjs and
//  nav-i18n.test.ts): they pin the invariants that would silently regress if a
//  later change collapsed two distinct concepts, dropped the D1 stamp, or let AI
//  output reach the order path. Behavioural coverage of the pieces lives in
//  test-runs.test.ts / aiResearch.test.ts; this suite locks the boundaries.
// =============================================================================

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

describe('§58.10 #6 — market data provider health is distinct from generic connections', () => {
  test('provider health probes market venues, not the tm-hub connection catalogue', () => {
    const src = read('server/api/v1/market-sources/health.get.ts')
    assert.match(src, /VENUE_IDS/)
    assert.match(src, /latencyMs/)
    assert.doesNotMatch(src, /connections/, 'provider health must not read generic connections')
  })

  test('the generic connection catalogue stays tm-hub-backed and separate', () => {
    const src = read('app/pages/shared-resources/connections.vue')
    assert.match(src, /connections/i)
    assert.doesNotMatch(src, /market-sources/, 'connections page must not render provider health')
  })

  test('useSystemHealth targets both distinct health routes', () => {
    const src = read('app/composables/useSystemHealth.ts')
    assert.match(src, /\/api\/v1\/market-sources\/health/)
    assert.match(src, /\/api\/v1\/health/)
  })

  for (const page of ['admin-system/data-sources', 'admin-system/health']) {
    test(`${page}.vue is implemented (renders real health, not a placeholder)`, () => {
      const src = read(`app/pages/${page}.vue`)
      assert.match(src, /useSystemHealth/)
      assert.doesNotMatch(src, /comingSoon/, `${page} must not be a "coming soon" stub`)
    })
  }
})

describe('§58.10 #7 — Indicator / Strategy / Bot / TestRun / Dataset / Experiment are distinct', () => {
  test('engineModel maps each entity to its own model file + export', () => {
    const src = read('server/utils/engineModel.ts')
    const entities: Array<[string, string]> = [
      ['strategyProfile.mjs', 'StrategyProfile'],
      ['strategyVersion.mjs', 'StrategyVersion'],
      ['botProfile.mjs', 'BotProfile'],
      ['botInstance.mjs', 'BotInstance'],
      ['experiment.mjs', 'Experiment'],
      ['experimentRun.mjs', 'ExperimentRun'],
      ['aiProposal.mjs', 'AiProposal'],
      ['dataset.mjs', 'Dataset'],
      ['candle.mjs', 'Candle'],
      ['marketFeed.mjs', 'MarketFeed']
    ]
    for (const [file, name] of entities) {
      const re = new RegExp(`engineModel\\('${file.replace('.', '\\.')}', '${name}'\\)`)
      assert.match(src, re, `engineModel must expose ${name} from ${file}`)
    }
  })

  test('Bot Profile != Bot Instance is an explicit, documented contract', () => {
    assert.match(read('server/utils/engineModel.ts'), /Bot Profile != Bot Instance/)
  })
})

describe('§58.10 #8 — every test run is identified by engine + params (D1 stamp)', () => {
  test('startTestRun echoes the D1 identity (engineVersion/paramsHash/seriesId)', () => {
    const src = read('server/utils/testRuns.ts')
    assert.match(src, /engineVersion/)
    assert.match(src, /paramsHash/)
    assert.match(src, /seriesId/)
  })

  test('TestRunResult exposes engineVersion + paramsHash + runId + seriesId', () => {
    const src = read('types/runs.ts')
    for (const field of ['engineVersion', 'paramsHash', 'runId', 'seriesId']) {
      assert.match(src, new RegExp(`\\b${field}\\b`), `TestRunResult must carry ${field}`)
    }
  })

  test('research arms link a strategy version (version ↔ experiment traceability)', () => {
    assert.match(read('server/utils/research.ts'), /strategyVersionId/)
  })
})

describe('§58.10 #9 — AI output is proposals only; nothing bypasses the risk gate', () => {
  test('the agent prompt states the proposals-only + risk-gate guardrail', () => {
    const src = read('ai/agent.mjs')
    assert.match(src, /PROPOSALS only/)
    assert.match(src, /risk/)
  })

  test('createExperiment persists proposals as DATA, never touching presets/risk', () => {
    const src = read('server/utils/research.ts')
    assert.match(src, /Proposals are DATA/)
    assert.match(src, /never touches a preset/)
  })

  test('the proposal validator is pure and stamps a schema version', () => {
    assert.equal(PROPOSAL_SCHEMA_VERSION, 'proposal.v1')
    assert.equal(validateProposal(null).ok, false)
    assert.equal(validateProposal({ proposalId: 'p1', hypothesis: 'h' }).ok, true)
  })

  test('no ai module writes a strategy version (proposals cannot mutate active versions)', () => {
    for (const f of ['agent.mjs', 'research.mjs', 'review.mjs', 'daily-brief.mjs', 'proposal.mjs']) {
      const src = read(`ai/${f}`)
      assert.doesNotMatch(
        src,
        /strategy_?versions?[\s\S]{0,40}\b(insert|save|update|delete)\b/i,
        `ai/${f} must not write strategy versions`
      )
    }
  })
})

describe('§58.10 #10 — the nav/route migration is idempotent & duplicate-safe', () => {
  const seed = join(ROOT, '..', 'tm-hub', 'scripts', 'seed', 'shared.ts')

  test('seedSystemRoute upserts routes by (app_id, id) and prunes only removed ids', { skip: !existsSync(seed) }, () => {
    const src = readFileSync(seed, 'utf8')
    assert.match(src, /app_id/)
    assert.match(src, /upsert/i)
    assert.match(src, /cleanOldRoutes/)
  })
})

describe('§58.10 #12 — status is recorded only with evidence', () => {
  test('the navigation audit carries the §58 closure evidence', () => {
    const src = read('docs/navigation-audit.md')
    assert.match(src, /58\.10/)
  })
})

describe('§57.4/§58.5 — API-backed leaves are real pages, not stubs', () => {
  test('markets/explorer consumes the Instrument Catalog API (no second symbol list)', () => {
    const src = read('app/pages/markets/explorer.vue')
    assert.doesNotMatch(src, /comingSoon/, 'explorer must not be a "coming soon" stub')
    assert.match(src, /useMarketCatalog/)
    assert.match(src, /useSystemHealth/, 'explorer must surface live provider health')
    const api = read('app/composables/useMarketCatalog.ts')
    assert.match(api, /\/api\/v1\/instruments/)
    assert.match(api, /\/api\/v1\/venues/)
  })

  test('trading/paper projects the persisted paper account + risk gate (D1)', () => {
    const src = read('app/pages/trading/paper.vue')
    assert.doesNotMatch(src, /comingSoon/, 'paper must not be a "coming soon" stub')
    assert.match(src, /usePaperAccounts/)
    const api = read('app/composables/usePaperAccounts.ts')
    assert.match(api, /\/api\/v1\/paper\/accounts/)
    assert.match(api, /\/api\/v1\/risk\/status/)
  })

  test('trading/orders is the read+cancel paper order lifecycle (D14)', () => {
    const src = read('app/pages/trading/orders.vue')
    assert.doesNotMatch(src, /comingSoon/, 'orders must not be a "coming soon" stub')
    assert.match(src, /usePaperOrders/)
    assert.match(src, /cancelable/, 'cancel must be driven by the server cancelable flag')
    const api = read('app/composables/usePaperOrders.ts')
    assert.match(api, /\/api\/v1\/orders/)
    assert.match(api, /\/cancel/)
  })

  test('the terminal accepts instrument deep-links from the explorer (§57.4 B)', () => {
    const src = read('app/pages/trading/index.vue')
    assert.match(src, /route\.query\.instrument/)
  })

  test('markets/scanner consumes scanner snapshots + the Instrument Catalog', () => {
    const src = read('app/pages/markets/scanner.vue')
    assert.doesNotMatch(src, /comingSoon/, 'scanner must not be a "coming soon" stub')
    assert.match(src, /useMarketScanner/)
    assert.match(src, /\/trading\?instrument=/, 'scanner must deep-link candidates into the terminal')
    const composable = read('app/composables/useMarketScanner.ts')
    assert.match(composable, /mergeScannerCandidates/, 'scanner must project, not recompute (D1)')
    assert.match(composable, /useIntel/)
    assert.match(composable, /useMarketCatalog/)
  })

  test('markets/calendar consumes the intel news stream (no second ingest)', () => {
    const src = read('app/pages/markets/calendar.vue')
    assert.doesNotMatch(src, /comingSoon/, 'calendar must not be a "coming soon" stub')
    assert.match(src, /useMarketCalendar/)
    assert.match(src, /groupNewsByDay/)
    const composable = read('app/composables/useMarketCalendar.ts')
    assert.match(composable, /\/api\/v1\/news/)
    assert.match(composable, /useIntel/, 'unlocks come from the same intel snapshot (§58.6)')
    const route = read('server/api/v1/news/index.get.ts')
    assert.match(route, /listNews/)
  })
})

describe('§58.5 — scanner candidate merge is a pure projection (D1)', () => {
  const mover = (symbol: string, pct24h: number, extra: Partial<IntelMover> = {}): IntelMover =>
    ({ symbol, pct24h, chg4h: 1, quoteVolume: 1e8, lastPrice: 2, breakout: false, atrPct: 1.5, ...extra })
  const flow = (symbol: string, dir: IntelFlow['dir'], score: number, reasons: string[]): IntelFlow =>
    ({ symbol, dir, reasons, volRatio: 2.5, takerRatio: 0.7, cmf: 0.3, pct24h: 5, score })
  const accum = (symbol: string, reasons: string[]): IntelAccum =>
    ({ symbol, reasons, rangePct: 2, priceChg48: 0.5, obvNorm: 1, volRatio: 0.6, pct24h: 1 })

  test('merges mover/flow/accum by symbol, de-dupes reasons, keeps richest metrics', () => {
    const out = mergeScannerCandidates(
      {
        movers: [mover('AAAUSDT', 40, { breakout: true })],
        flows: [flow('AAAUSDT', 'buy', 9, ['volSpike', 'cmfIn'])],
        accums: [accum('BBBUSDT', ['range', 'flat'])]
      },
      []
    )
    assert.equal(out.length, 2)
    const a = out.find(c => c.symbol === 'AAAUSDT')!
    assert.deepEqual([...a.signals].sort(), ['flow', 'mover'])
    assert.equal(a.flowDir, 'buy')
    assert.equal(a.score, 9)
    assert.equal(a.pct24h, 40, 'mover 24h change wins over flow')
    assert.equal(a.breakout, true)
    assert.deepEqual(a.reasons, ['volSpike', 'cmfIn'])
    assert.equal(out[0]!.symbol, 'AAAUSDT', 'sorted by flow score desc')
  })

  test('joins the catalog by venue-native / engine symbol', () => {
    const instrument = {
      id: 'crypto:perp:BTC/USDT', symbol: 'BTC/USDT', type: 'perp' as const, base: 'BTC', quote: 'USDT',
      venues: [{ venue: 'binance', native: 'BTCUSDT' }], status: 'active' as const, engineSymbol: 'BTCUSDT'
    }
    const out = mergeScannerCandidates({ movers: [mover('BTCUSDT', 3)], flows: [], accums: [] }, [instrument])
    assert.equal(out[0]!.instrument?.id, 'crypto:perp:BTC/USDT')
  })

  test('fails soft to [] on a null payload', () => {
    assert.deepEqual(mergeScannerCandidates(null, []), [])
  })
})

describe('§58.5 — news calendar grouping is a pure projection (D1)', () => {
  const item = (ts: string, extra: Partial<IntelNewsItem> = {}): IntelNewsItem =>
    ({ title: 't', link: '', source: 'coindesk', level: 'med', dir: 'flat', tags: [], score: 0.5, ts, excerpt: '', ...extra })

  test('groups by UTC day, newest day first, newest headline first within a day', () => {
    const out = groupNewsByDay([
      item('2026-10-08T09:00:00Z'),
      item('2026-10-08T11:00:00Z'),
      item('2026-10-07T23:00:00Z')
    ])
    assert.equal(out.length, 2)
    assert.equal(out[0]!.day, '2026-10-08')
    assert.deepEqual(out[0]!.items.map(i => i.ts), ['2026-10-08T11:00:00Z', '2026-10-08T09:00:00Z'])
    assert.equal(out[1]!.day, '2026-10-07')
  })

  test('drops headlines without a usable timestamp and fails soft on empty input', () => {
    const out = groupNewsByDay([item(''), item('not-a-date'), item('2026-10-08T00:00:00Z')])
    assert.equal(out.length, 1)
    assert.equal(out[0]!.items.length, 1)
    assert.deepEqual(groupNewsByDay([]), [])
  })

  test('filters by level + free-text over title/excerpt/source/tags', () => {
    const items = [
      item('2026-10-08T00:00:00Z', { level: 'high', title: 'Fed holds rates', tags: ['macro'] }),
      item('2026-10-08T01:00:00Z', { level: 'med', title: 'ETF inflows', source: 'cointelegraph' })
    ]
    assert.equal(filterNews(items, { level: 'high' }).length, 1)
    assert.equal(filterNews(items, { query: 'etf' }).length, 1)
    assert.equal(filterNews(items, { query: 'cointelegraph' }).length, 1)
    assert.equal(filterNews(items, { query: 'macro' }).length, 1)
    assert.equal(filterNews(items, {}).length, 2)
  })
})

describe('§58.5 — alert rules are conditions over intel, delivered via the shared pipeline (§58.6)', () => {
  test('alerts page is a real, API-backed rule list (not a stub)', () => {
    const src = read('app/pages/alerts/index.vue')
    assert.doesNotMatch(src, /comingSoon/, 'alerts must not be a "coming soon" stub')
    assert.match(src, /useAlertRules/)
    const api = read('app/composables/useAlertRules.ts')
    assert.match(api, /\/api\/v1\/alert-rules/)
  })

  test('the engine owns the rule contract; the service reuses the notify router (no second pipeline)', () => {
    const engine = read('engine/alertRules.mjs')
    assert.match(engine, /ALERT_RULE_VERSION/)
    assert.match(engine, /ruleKeyFor/)
    assert.match(engine, /ruleEventDedupeKey/)
    const service = read('services/alertRules.mjs')
    assert.match(service, /notify/, 'delivery must go through the shared notify router')
    assert.match(service, /notifyHash/, 'dedupe reuses the notification ledger identity')
    assert.match(service, /_id:/, 'the notification ledger _id is the idempotency anchor (D4)')
  })

  test('the rule CRUD routes exist and the service is registered on the run loop', () => {
    for (const f of ['index.get', 'index.post', '[id].get', '[id].patch', '[id].delete']) {
      const p = `server/api/v1/alert-rules/${f}.ts`
      assert.equal(existsSync(join(ROOT, p)), true, `${p} must exist`)
    }
    assert.match(read('services/run.mjs'), /alertRules/)
    assert.match(read('services/heartbeat.mjs'), /alertRules/)
  })

  test('the rule model is a distinct collection from the notification ledger', () => {
    const model = read('engine/models/alertRule.mjs')
    assert.match(model, /collection: 'alert_rules'/)
    assert.doesNotMatch(model, /collection: 'notification_logs'/, 'rules must not share the notify ledger collection')
    assert.match(model, /unique: true/, 'ruleKey stays the idempotent definition identity (D4)')
  })

  const base = (over: Partial<AlertRule> = {}): AlertRule => ({
    _id: 'r1', ruleKey: 'r1_abc', name: 'BTC news', enabled: true, kind: 'news', minLevel: 'med',
    dirs: ['pos'], symbols: ['BTCUSDT'], sources: ['coindesk'], tags: ['etf'], minScore: null,
    priority: 'normal', lookbackSec: 7 * 24 * 3600,
    stats: { matches: 0, notified: 0, lastMatchAt: null, lastRunAt: null },
    createdAt: '', updatedAt: '', ...over
  })

  test('validateRuleForm mirrors the server rules (name required/bounded, numeric score)', () => {
    assert.deepEqual(validateRuleForm(emptyRuleForm()), { ok: false, error: 'nameRequired' })
    assert.equal(validateRuleForm({ ...emptyRuleForm(), name: 'x'.repeat(81) }).error, 'nameTooLong')
    assert.equal(validateRuleForm({ ...emptyRuleForm(), name: 'ok', minScore: 'abc' }).error, 'scoreInvalid')
    assert.equal(validateRuleForm({ ...emptyRuleForm(), name: 'ok', minScore: '2.5' }).ok, true)
  })

  test('parseList splits on comma/space and de-dupes case-insensitively', () => {
    assert.deepEqual(parseList('btc, eth  btc\nSOL'), ['btc', 'eth', 'SOL'])
    assert.deepEqual(parseList('   '), [])
  })

  test('formToInput collects a validated form into the API payload', () => {
    const input = formToInput({ ...emptyRuleForm(), name: '  BTC  ', symbols: 'btc, eth', minScore: '' })
    assert.equal(input.name, 'BTC', 'name is trimmed')
    assert.deepEqual(input.symbols, ['btc', 'eth'])
    assert.equal(input.minScore, null, 'empty score -> no floor')
    assert.equal(input.lookbackSec, 7 * 24 * 3600, 'default lookback is 7 days')
  })

  test('ruleToForm ↔ formToInput round-trips a rule without losing facets', () => {
    const rule = base({ minScore: 3 })
    const round = formToInput(ruleToForm(rule))
    assert.deepEqual(round.symbols, rule.symbols)
    assert.deepEqual(round.sources, rule.sources)
    assert.deepEqual(round.tags, rule.tags)
    assert.deepEqual(round.dirs, rule.dirs)
    assert.equal(round.minScore, 3)
  })

  test('ruleFacets shows only the facets a rule actually constrains, kind/priority first+last', () => {
    const faces = ruleFacets(base())
    assert.equal(faces[0]!.facet, 'kind')
    assert.equal(faces.at(-1)!.facet, 'priority')
    assert.ok(faces.some(f => f.facet === 'symbol' && f.value === 'BTCUSDT'))
    const lean = ruleFacets(base({ dirs: [], symbols: [], sources: [], tags: [], minScore: null }))
    assert.deepEqual(lean.map(f => f.facet), ['kind', 'level', 'priority'])
  })
})
