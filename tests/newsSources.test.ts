import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

// Offline suite: no Mongo, no network. tsx auto-loads the repo .env (which
// points at a live mongod), so blank the URI up front — every glue path
// (persist/health/cluster/intel) already fail-softs to null without it.
process.env.MONGODB_URI = ''
process.env.CRYPTOPANIC_TOKEN = ''
import {
  PILOT_SOURCES,
  licenseGate,
  marketGroupFor,
  pilotSourceFor,
  toNewsItem,
} from '../engine/newsIngest.mjs'
import { runNews, scoreNews } from '../services/news.mjs'
import {
  getNewsSource,
  setNewsSourceEnabled,
  validateNewsSource,
} from '../server/utils/newsStore'

// =============================================================================
//  Source management — §60.2 registry (enable/disable/validate), default seed
//  incl. the official Fed RSS, per-source market groups, disabled skip.
//
//  Offline: pure rules + injected fakes (no Mongo). runNews uses fetchImpl +
//  seedImpl fakes; the intel/persist/health paths already fail-soft to null.
// =============================================================================

const T0 = 1_790_000_000_000
const rss = (items) => `<rss><channel>${items.map((i) => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>Thu, 16 Oct 2026 10:00:00 GMT</pubDate><description>${i.d || ''}</description></item>`).join('')}</channel></rss>`

describe('default seed — official source included', () => {
  test('13 pilot sources: 3 crypto RSS + cryptopanic + Fed + SEC EDGAR + ECB + 4 BLS releases + EIA + VnExpress (T0/T2)', () => {
    assert.equal(PILOT_SOURCES.length, 13)
    const fed = pilotSourceFor('federalreserve')
    assert.ok(fed)
    assert.equal(fed.trustTier, 'T0_PRIMARY')
    assert.deepEqual(fed.marketGroups, ['macro_cb'])
    assert.equal(fed.licenseStatus, 'ok')
    assert.ok(fed.feedUrl.startsWith('https://www.federalreserve.gov/'))

    // §60.3 coverage: the two license-free official connectors added in Slice F.
    const sec = pilotSourceFor('sec_edgar')
    assert.ok(sec)
    assert.equal(sec.trustTier, 'T0_PRIMARY')
    assert.deepEqual(sec.marketGroups, ['equities_global'])
    assert.ok(sec.feedUrl.startsWith('https://www.sec.gov/'))

    const ecb = pilotSourceFor('ecb')
    assert.ok(ecb)
    assert.equal(ecb.trustTier, 'T0_PRIMARY')
    assert.deepEqual(ecb.marketGroups, ['macro_cb'])
    assert.ok(ecb.feedUrl.startsWith('https://www.ecb.europa.eu/'))

    // §60.5 coverage (G5): one BLS release feed per market-moving program, all
    // T0 macro_cb and public domain. `bls_latest` is deliberately NOT seeded —
    // its single aggregate item scores `low` and would never be stored.
    for (const id of ['bls_cpi', 'bls_empsit', 'bls_ppi', 'bls_jolts']) {
      const bls = pilotSourceFor(id)
      assert.ok(bls, `${id} must be seeded`)
      assert.equal(bls.trustTier, 'T0_PRIMARY')
      assert.deepEqual(bls.marketGroups, ['macro_cb'])
      assert.ok(bls.feedUrl.startsWith('https://www.bls.gov/feed/'))
    }
    assert.equal(pilotSourceFor('bls_latest'), null, 'the aggregate latest-numbers feed is not a source')

    // §60.5 coverage (G5): the two remaining pilot groups. EIA is official (T0),
    // public domain, fx_gold_commod; the VnExpress International business feed is
    // a public press RSS (T2) for Vietnam equities.
    const eia = pilotSourceFor('eia')
    assert.ok(eia)
    assert.equal(eia.trustTier, 'T0_PRIMARY')
    assert.deepEqual(eia.marketGroups, ['fx_gold_commod'])
    assert.ok(eia.feedUrl.startsWith('https://www.eia.gov/'))

    const vn = pilotSourceFor('vnexpress')
    assert.ok(vn)
    assert.equal(vn.trustTier, 'T2_SECONDARY')
    assert.deepEqual(vn.marketGroups, ['equities_vn', 'fx_gold_commod'])
    assert.ok(vn.feedUrl.startsWith('https://e.vnexpress.net/'))

    // Every pilot source must be seedable and rights-cleared (no unknown/revoked).
    for (const s of PILOT_SOURCES) {
      assert.equal(licenseGate({ ...s, enabled: true }).ok, true, `${s.sourceId} must pass the license gate`)
    }
  })
})

describe('licenseGate — disabled sources store nothing', () => {
  test('enabled ok passes; disabled blocks with source_disabled', () => {
    assert.deepEqual(licenseGate({ licenseStatus: 'ok', rights: { allowedStoreMetadata: true } }), { ok: true, reason: 'ok' })
    assert.deepEqual(licenseGate({ enabled: false, licenseStatus: 'ok', rights: { allowedStoreMetadata: true } }), {
      ok: false, reason: 'source_disabled',
    })
  })
})

describe('toNewsItem — market group follows the source', () => {
  test('fed item lands in macro_cb, crypto item in crypto', () => {
    const fed = toNewsItem(
      { title: 'Federal Reserve issues FOMC statement', link: 'https://www.federalreserve.gov/x', source: 'federalreserve', excerpt: '', ts: T0, score: 4, level: 'med', dir: 'flat', tags: ['central_bank'] },
      pilotSourceFor('federalreserve'), T0,
    )
    assert.equal(fed.marketGroup, 'macro_cb')
    const crypto = toNewsItem(
      { title: 'Bitcoin ETF approval', link: 'https://www.coindesk.com/x', source: 'coindesk', excerpt: '', ts: T0, score: 7, level: 'high', dir: 'pos', tags: ['etf'] },
      pilotSourceFor('coindesk'), T0,
    )
    assert.equal(crypto.marketGroup, 'crypto')
  })
})

describe('scoreNews — official macro clears the med floor, direction flat', () => {
  test('FOMC statement scores med + central_bank + flat', () => {
    const s = scoreNews({ title: 'Federal Reserve issues FOMC statement', excerpt: 'The Board voted to maintain the target range for the federal funds rate.' })
    assert.equal(s.level, 'med')
    assert.ok(s.tags.includes('central_bank'))
    assert.equal(s.dir, 'flat')
  })
  test('BLS release headline scores med + macro_release + flat', () => {
    const s = scoreNews({ title: 'Consumer Price Index — October 2026', excerpt: 'The Consumer Price Index rose 0.2 percent in October.' })
    assert.equal(s.level, 'med')
    assert.ok(s.tags.includes('macro_release'))
    assert.equal(s.dir, 'flat')
    assert.equal(scoreNews({ title: 'Producer Price Index news release' }).level, 'med')
    assert.equal(scoreNews({ title: 'Employment Situation summary' }).level, 'med')
    // The rule must not fire on an unrelated headline that merely contains "ppi".
    assert.equal(scoreNews({ title: 'Weekly crypto market recap' }).level, 'low')
  })
  test('regression: "All Urban Consumers" is not a "ban" (no false regulation)', () => {
    // The regulation rule's `\bban(ned|s)?\b` must not match the "ban" inside
    // "Urban" — BLS CPI releases say "All Urban Consumers".
    const s = scoreNews({ title: 'CPI for all items increases 0.6% in September', excerpt: 'The Consumer Price Index for All Urban Consumers (CPI-U) increased 0.6 percent.' })
    assert.ok(!s.tags.includes('regulation'), `must not be tagged regulation: ${JSON.stringify(s)}`)
    assert.ok(s.tags.includes('macro_release'))
    assert.equal(s.dir, 'flat')
    assert.equal(s.level, 'med')
    assert.equal(scoreNews({ title: 'Regulator bans exchange', excerpt: '' }).dir, 'neg')
  })
  test('EIA commodity headline scores med + commodity + flat', () => {
    const s = scoreNews({ title: 'Crude oil prices and refinery margins increased', excerpt: 'Refinery utilization rose.' })
    assert.ok(s.tags.includes('commodity'), `expected commodity tag: ${JSON.stringify(s)}`)
    assert.equal(s.level, 'med')
    assert.equal(s.dir, 'flat')
    // Non-price energy-analysis items from the same feed stay low.
    assert.equal(scoreNews({ title: 'U.S. small-scale solar generation quadrupled' }).level, 'low')
  })
  test('VnExpress Vietnam market terms score med + equity_market + flat', () => {
    for (const title of ['VN-Index climbs on bank stocks', 'Dollar weakens against dong', 'State Bank of Vietnam holds rates']) {
      const s = scoreNews({ title, excerpt: '' })
      assert.ok(s.tags.includes('equity_market'), `expected equity_market for "${title}": ${JSON.stringify(s)}`)
      assert.equal(s.level, 'med')
      assert.equal(s.dir, 'flat')
    }
    // Lifestyle/sport items in the same business feed stay low.
    assert.equal(scoreNews({ title: 'KFC ditches Pepsi for Coca-Cola at US restaurants' }).level, 'low')
  })
  test('crypto golden rules unchanged by the macro addition', () => {
    assert.equal(scoreNews({ title: 'Hackers steal $100M in bridge exploit' }).level, 'high')
    assert.equal(scoreNews({ title: 'Bitcoin price analysis for the week' }).level, 'low')
  })
})

describe('marketGroupFor — per-item group precision (§60.5)', () => {
  test('a group-specific tag moves the item only within the source\'s declared groups', () => {
    // VnExpress is multi-group: a gold headline leaves equities_vn for fx_gold_commod.
    assert.equal(marketGroupFor(['commodity'], ['equities_vn', 'fx_gold_commod']), 'fx_gold_commod')
    assert.equal(marketGroupFor(['equity_market'], ['equities_vn', 'fx_gold_commod']), 'equities_vn')
    // Single-group sources are unchanged: a crypto source never leaves crypto.
    assert.equal(marketGroupFor(['commodity'], ['crypto']), 'crypto')
    assert.equal(marketGroupFor(['security'], ['crypto']), 'crypto')
    // Fed/BLS/ECB stay macro_cb; SEC stays equities_global.
    assert.equal(marketGroupFor(['macro_release'], ['macro_cb']), 'macro_cb')
    assert.equal(marketGroupFor(['central_bank'], ['macro_cb']), 'macro_cb')
    assert.equal(marketGroupFor(['filing'], ['equities_global']), 'equities_global')
    // No group-specific tag -> the source's primary group.
    assert.equal(marketGroupFor([], ['equities_vn', 'fx_gold_commod']), 'equities_vn')
    assert.equal(marketGroupFor(undefined, undefined), 'crypto')
  })
  test('toNewsItem applies the per-item group end-to-end', () => {
    const source = pilotSourceFor('vnexpress')
    const gold = toNewsItem({ title: 'Gold prices gain', link: 'https://e.vnexpress.net/x/gold', excerpt: '', ts: 0, score: 3, level: 'med', dir: 0, tags: ['commodity'] }, source)
    assert.equal(gold.marketGroup, 'fx_gold_commod')
    const vn = toNewsItem({ title: 'VN-Index climbs on bank stocks', link: 'https://e.vnexpress.net/x/vnindex', excerpt: '', ts: 0, score: 3, level: 'med', dir: 0, tags: ['equity_market'] }, source)
    assert.equal(vn.marketGroup, 'equities_vn')
  })
})

describe('runNews — disabled sources are never fetched', () => {
  test('fed disabled -> its URL is never requested; others still run', async () => {
    const requested = []
    const fetchImpl = async (url) => {
      requested.push(url)
      return { ok: true, text: async () => rss([{ t: 'Bitcoin ETF approval drives inflows', l: 'https://www.coindesk.com/a', d: 'ETF filing' }]) }
    }
    const seedImpl = async () => ({
      coindesk: { ...pilotSourceFor('coindesk'), enabled: true },
      cointelegraph: { ...pilotSourceFor('cointelegraph'), enabled: true },
      decrypt: { ...pilotSourceFor('decrypt'), enabled: true },
      cryptopanic: { ...pilotSourceFor('cryptopanic'), enabled: true },
      federalreserve: { ...pilotSourceFor('federalreserve'), enabled: false },
      bls_cpi: { ...pilotSourceFor('bls_cpi'), enabled: false },
      bls_empsit: { ...pilotSourceFor('bls_empsit'), enabled: false },
      bls_ppi: { ...pilotSourceFor('bls_ppi'), enabled: false },
      bls_jolts: { ...pilotSourceFor('bls_jolts'), enabled: false },
    })
    const r = await runNews({ fetchImpl, now: new Date(T0), seedImpl })
    assert.ok(!requested.some((u) => u.includes('federalreserve.gov')), 'fed must not be fetched when disabled')
    assert.ok(requested.some((u) => u.includes('coindesk')), 'enabled sources still fetch')
    assert.equal(r.feeds >= 3, true)
  })

  test('every source disabled -> clean disabled return (no throw, no fetch)', async () => {
    const requested = []
    const seedImpl = async () => Object.fromEntries(
      PILOT_SOURCES.map((s) => [s.sourceId, { ...s, enabled: false }]),
    )
    const r = await runNews({ fetchImpl: async (url) => { requested.push(url); throw new Error('must not fetch') }, now: new Date(T0), seedImpl })
    assert.equal(r.disabled, true)
    assert.equal(requested.length, 0)
  })
})

describe('source admin glue — detail / switch / probe', () => {
  const row = (over = {}) => ({
    _id: 'coindesk', sourceId: 'coindesk', name: 'CoinDesk', transport: 'rss',
    feedUrl: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    trustTier: 'T2_SECONDARY', marketGroups: ['crypto'], languages: ['en'],
    licenseStatus: 'ok', enabled: true, pollIntervalSec: 600, retentionDays: 7,
    health: { state: 'ok', lastOkAt: new Date(T0), consecutiveErrors: 0 }, ...over,
  })
  const model = (rows, writes = []) => ({
    writes,
    find() { return { sort() { return { lean: async () => rows } } } },
    findOne(filter) { return { lean: async () => rows.find((r) => r._id === filter._id) || null } },
    findOneAndUpdate(filter, update) {
      writes.push({ filter, update })
      const r = rows.find((x) => x._id === filter._id)
      if (!r) return { lean: async () => null }
      return { lean: async () => ({ ...r, ...update.$set }) }
    },
  })

  test('detail projects the public row; unknown id -> 404', async () => {
    const d = await getNewsSource('coindesk', { NewsSourceModel: model([row()]) })
    assert.equal(d.sourceId, 'coindesk')
    assert.equal(d.enabled, true)
    await assert.rejects(() => getNewsSource('nope', { NewsSourceModel: model([]) }), (e) => e.statusCode === 404)
  })
  test('switch writes ONLY the enabled flag; non-boolean -> 400', async () => {
    const writes = []
    const d = await setNewsSourceEnabled('coindesk', false, { NewsSourceModel: model([row()], writes) })
    assert.equal(d.enabled, false)
    assert.deepEqual(writes[0].update, { $set: { enabled: false } })
    await assert.rejects(() => setNewsSourceEnabled('coindesk', 'yes', { NewsSourceModel: model([row()]) }), (e) => e.statusCode === 400)
    await assert.rejects(() => setNewsSourceEnabled('nope', true, { NewsSourceModel: model([]) }), (e) => e.statusCode === 404)
  })
  test('probe reports reachability without touching the registry', async () => {
    const writes = []
    const feed = '<rss version="2.0"><channel><title>FRB</title></channel></rss>'
    const ok = await validateNewsSource('coindesk', {
      NewsSourceModel: model([row()], writes),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => feed }),
    })
    assert.equal(ok.reachable, true)
    assert.equal(ok.httpStatus, 200)
    assert.equal(ok.looksLikeFeed, true)
    assert.equal(writes.length, 0)
    const down = await validateNewsSource('coindesk', {
      NewsSourceModel: model([row()]),
      fetchImpl: async () => { throw new Error('socket hang up') },
    })
    assert.equal(down.reachable, false)
  })
  test('cryptopanic without token reports token_not_configured (no secret probe)', async () => {
    const r = await validateNewsSource('cryptopanic', {
      NewsSourceModel: model([row({ _id: 'cryptopanic', sourceId: 'cryptopanic', transport: 'api', feedUrl: 'https://cryptopanic.com/api/v1/posts/' })]),
      fetchImpl: async () => { throw new Error('must not fetch without token') },
    })
    assert.equal(r.reachable, false)
    assert.equal(r.reason, 'token_not_configured')
  })
})
