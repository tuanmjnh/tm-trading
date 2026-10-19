import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLUSTER_SIMILARITY,
  corroborate,
  correctionSignal,
  eventIdFor,
  eventTypeForTags,
  fingerprintOf,
  linkEntities,
  nearDuplicate,
} from '../engine/newsEvents.mjs'
import { observationAsOf, observationIdFor, toMacroObservation } from '../engine/macro.mjs'
import { clusterItems, clusterRecentEvents, toMarketEvent } from '../services/newsEvents.mjs'

// =============================================================================
//  Event normalization + entity/macro mechanics — V3.5 §60 Slice C.
//
//  Offline: deterministic clustering, allowlist entity linking (uncertainty
//  visible), source-independence corroboration, contradiction display,
//  append-only corrections, PIT-safe macro vintages. Glue with injected fakes.
// =============================================================================

const T0 = 1_790_000_000_000
const item = (over = {}) => ({
  _id: 'news_x',
  sourceId: 'coindesk',
  title: 'Bitcoin surges past $100k on ETF inflows',
  excerpt: '',
  marketGroup: 'crypto',
  tags: ['etf'],
  level: 'high',
  dir: 'pos',
  publishedAt: new Date(T0),
  firstSeenAt: new Date(T0),
  ...over,
})

describe('fingerprintOf / eventIdFor — one story, one event', () => {
  test('same story across providers (source words, case, punctuation) -> same id', () => {
    const a = fingerprintOf('CoinDesk: Bitcoin surges past $100K on ETF inflows!')
    const b = fingerprintOf('bitcoin surges past 100k on etf inflows — Cointelegraph')
    assert.equal(eventIdFor(a), eventIdFor(b))
    assert.ok(eventIdFor(a).startsWith('evt_'))
  })
  test('different stories -> different ids', () => {
    assert.notEqual(
      eventIdFor(fingerprintOf('Ethereum upgrade activates on mainnet')),
      eventIdFor(fingerprintOf('Solana outage halts block production')),
    )
  })
})

describe('nearDuplicate — reworded headlines merge, distinct ones do not', () => {
  test('threshold constant matches spec', () => {
    assert.equal(CLUSTER_SIMILARITY, 0.85)
  })
  test('lightly edited syndication merges; distinct stories stay apart', () => {
    assert.ok(nearDuplicate('Bitcoin ETF approval drives record inflows', 'Bitcoin ETF approval drives record inflows: report'))
    assert.ok(!nearDuplicate('Bitcoin ETF approval drives record inflows', 'Ethereum gas fees spike during NFT mint'))
  })
  test('distinct stories stay apart', () => {
    assert.ok(!nearDuplicate('Bitcoin ETF approval drives record inflows', 'Ethereum gas fees spike during NFT mint'))
  })
  test('empty titles never merge', () => {
    assert.ok(!nearDuplicate('', 'Bitcoin ETF approval'))
  })
})

describe('linkEntities — allowlist, uncertainty visible', () => {
  test('$TICKER is strong; bare name is normal', () => {
    const [hit] = linkEntities('BlackRock $BTC ETF filing')
    assert.equal(hit.symbol, 'BTC')
    assert.equal(hit.confidence, 0.95)
    assert.equal(hit.uncertain, false)
  })
  test('bare word links with lower confidence', () => {
    const [hit] = linkEntities('Ethereum upgrade activates')
    assert.equal(hit.symbol, 'ETH')
    assert.equal(hit.confidence, 0.85)
  })
  test('common words never link (no false positives)', () => {
    assert.deepEqual(linkEntities('Click the link below to read more'), [])
    assert.deepEqual(linkEntities('Market analysis for the week ahead'), [])
  })
  test('multiple symbols -> each marked uncertain', () => {
    const hits = linkEntities('Bitcoin and Ethereum ETFs see record day')
    assert.equal(hits.length, 2)
    assert.ok(hits.every((h) => h.uncertain))
  })
})

describe('corroborate — source independence + contradiction', () => {
  test('one provider -> single_source', () => {
    const c = corroborate([{ sourceId: 'coindesk', dir: 'pos' }])
    assert.equal(c.status, 'single_source')
    assert.equal(c.independentSources, 1)
  })
  test('two providers agreeing -> multi_source', () => {
    const c = corroborate([
      { sourceId: 'coindesk', dir: 'pos' },
      { sourceId: 'decrypt', dir: 'pos' },
    ])
    assert.equal(c.status, 'multi_source')
    assert.equal(c.independentSources, 2)
  })
  test('same provider twice still counts once (no fake corroboration)', () => {
    const c = corroborate([
      { sourceId: 'coindesk', dir: 'pos' },
      { sourceId: 'coindesk', dir: 'pos' },
    ])
    assert.equal(c.status, 'single_source')
    assert.equal(c.independentSources, 1)
  })
  test('direction conflict -> contradicted (displayed, not hidden)', () => {
    const c = corroborate([
      { sourceId: 'coindesk', dir: 'pos' },
      { sourceId: 'decrypt', dir: 'neg' },
    ])
    assert.equal(c.status, 'contradicted')
    assert.deepEqual(c.dirs.sort(), ['neg', 'pos'])
  })
})

describe('correctionSignal — flagged for review, never silent', () => {
  test('retraction / correction / amendment detected', () => {
    assert.equal(correctionSignal('We retract our earlier ETF report'), 'retraction')
    assert.equal(correctionSignal('Correction: figures were misstated'), 'correction')
    assert.equal(correctionSignal('Amended filing disclosed', ''), 'amendment')
  })
  test('ordinary headlines pass clean', () => {
    assert.equal(correctionSignal('Bitcoin ETF approval drives inflows'), null)
  })
})

describe('eventTypeForTags — taxonomy v1 forward map', () => {
  test('keyword tags map to event types; unknown -> null (honest)', () => {
    assert.equal(eventTypeForTags(['etf']), 'fund_flow')
    assert.equal(eventTypeForTags(['security']), 'security_incident')
    assert.equal(eventTypeForTags(['price']), null)
    assert.equal(eventTypeForTags([]), null)
  })
})

describe('clusterItems + toMarketEvent — glue', () => {
  test('same story from two providers -> one event, multi_source, entities merged', () => {
    const clusters = clusterItems([
      item({ _id: 'news_a', sourceId: 'coindesk' }),
      item({ _id: 'news_b', sourceId: 'decrypt', title: 'Bitcoin surges past $100K on ETF inflows: decrypt' }),
      item({ _id: 'news_c', sourceId: 'coindesk', title: 'Solana outage halts block production' }),
    ])
    assert.equal(clusters.length, 2)
    const evt = toMarketEvent(clusters[0], T0)
    assert.ok(evt._id.startsWith('evt_'))
    assert.equal(evt.corroboration.status, 'multi_source')
    assert.equal(evt.itemIds.length, 2)
    assert.ok(evt.entities.some((e) => e.symbol === 'BTC'))
    assert.equal(evt.title, clusters[0].members[0].title)
  })
  test('contradicting dirs on one story surface as contradicted', () => {
    const clusters = clusterItems([
      item({ _id: 'news_a', dir: 'pos' }),
      item({ _id: 'news_b', sourceId: 'decrypt', dir: 'neg' }),
    ])
    assert.equal(clusters.length, 1)
    assert.equal(toMarketEvent(clusters[0], T0).corroboration.status, 'contradicted')
  })
})

describe('clusterRecentEvents — idempotent upsert + correction escalation', () => {
  function fakes(itemsList) {
    const events = new Map()
    const writes = []
    const Item = {
      find() {
        return { sort() { return { limit() { return { lean: async () => itemsList } } } } }
      },
    }
    const Event = {
      async bulkWrite(ops) {
        writes.push(...ops)
        let upserted = 0
        for (const op of ops) {
          if (!events.has(op.updateOne.filter._id)) {
            events.set(op.updateOne.filter._id, { status: 'active', revisions: [] })
            upserted += 1
          }
        }
        return { getUpsertedIds: () => Object.fromEntries(Array.from({ length: upserted }, (_, i) => [i, 1])) }
      },
      async updateOne(filter, update) {
        writes.push({ updateOne: { filter, update } })
        const e = events.get(filter._id)
        if (e) {
          if (update.$push?.revisions) e.revisions.push(update.$push.revisions)
          if (update.$set?.status) e.status = update.$set.status
        }
        return {}
      },
      findOne(filter) {
        const e = events.get(filter._id) || { status: 'active', revisions: [] }
        return { select() { return { lean: async () => e } } }
      },
    }
    return { Item, Event, events, writes }
  }

  test('re-clustering never forks events; status never de-escalates', async () => {
    const { Item, Event, events } = fakes([
      item({ _id: 'news_a', sourceId: 'coindesk' }),
      item({ _id: 'news_b', sourceId: 'decrypt' }),
    ])
    const r1 = await clusterRecentEvents({ NewsItemModel: Item, MarketEventModel: Event, now: new Date(T0) })
    assert.equal(r1.events, 1)
    assert.equal(r1.newEvents, 1)
    const r2 = await clusterRecentEvents({ NewsItemModel: Item, MarketEventModel: Event, now: new Date(T0 + 1000) })
    assert.equal(r2.newEvents, 0)
    assert.equal(events.size, 1)
  })
  test('correction item appends one revision and escalates; rerun adds nothing', async () => {
    const flagged = item({ _id: 'news_z', sourceId: 'decrypt', title: 'Correction: Bitcoin ETF figures were misstated' })
    const { Item, Event, events } = fakes([item({ _id: 'news_a' }), flagged])
    // Two distinct stories -> two events; the correction lives on its own
    // event (cross-story linkage needs human review / Slice D extraction).
    const r1 = await clusterRecentEvents({ NewsItemModel: Item, MarketEventModel: Event, now: new Date(T0) })
    assert.equal(r1.events, 2)
    assert.equal(r1.corrections, 1)
    const corrected = [...events.values()].find((e) => e.revisions.length === 1)
    assert.ok(corrected)
    assert.equal(corrected.status, 'corrected')
    await clusterRecentEvents({ NewsItemModel: Item, MarketEventModel: Event, now: new Date(T0 + 1000) })
    assert.equal([...events.values()].filter((e) => e.revisions.length > 1).length, 0)
  })
})

describe('macro vintages — PIT-safe, append-only', () => {
  test('deterministic ids; bad payload -> null', () => {
    assert.equal(observationIdFor('US_CPI_YOY', '2026-09', T0), `US_CPI_YOY|2026-09|${new Date(T0).toISOString()}`)
    assert.equal(toMacroObservation({ seriesId: '', refPeriod: '2026-09', value: 3.1, vintageAt: T0 }, T0), null)
    assert.equal(toMacroObservation({ seriesId: 'US_CPI_YOY', refPeriod: '2026-09', value: null, vintageAt: T0 }, T0), null)
  })
  test('asOf reads the latest vintage known at that time — never the future', () => {
    const v1 = toMacroObservation({ seriesId: 'US_CPI_YOY', refPeriod: '2026-09', value: 3.1, unit: '%', vintageAt: T0, status: 'preliminary' }, T0)
    const v2 = toMacroObservation({ seriesId: 'US_CPI_YOY', refPeriod: '2026-09', value: 3.2, unit: '%', vintageAt: T0 + 86_400_000, status: 'revised' }, T0)
    assert.equal(observationAsOf([v1, v2], T0).value, 3.1)
    assert.equal(observationAsOf([v1, v2], T0 + 86_400_000).value, 3.2)
    assert.equal(observationAsOf([v2], T0), null)
  })
})
