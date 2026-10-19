import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../engine/session.mjs'
import { createPaperOrder } from '../simulation/order.mjs'
import { buildFillRecord } from '../simulation/fills.mjs'
import { snapshotRecord } from '../exec/snapshot.mjs'
import { filterJournal, journalQuery, normalizeEntry } from '../engine/journal.mjs'
import { ensureTodayRow } from '../exec/risk.mjs'
import { listPaperDesks } from '../exec/paper.mjs'
import { toAlertDoc, toSignalDoc } from '../server/webhook.mjs'

// =============================================================================
//  Tenancy isolation (roadmap §61.3) — two distinct owners must never see or
//  write each other's rows. Two hub identities are unavailable in CI (the
//  second account 403s on the deployed hub), so isolation is pinned at the
//  seam each layer owns: the ownerId stamped on every doc and the ownerId in
//  every query filter. One owner is a real sub, the other a different sub.
// =============================================================================

const ALICE = 'owner-alice'
const BOB = 'owner-bob'

describe('doc writers stamp ownerId (never a guessed owner)', () => {
  test('createSession carries ownerId; absent -> explicit null', () => {
    assert.equal(createSession({ ownerId: ALICE, now: 1 }).ownerId, ALICE)
    assert.equal(createSession({ now: 1 }).ownerId, null)
  })

  test('createPaperOrder carries ownerId; absent -> explicit null', () => {
    const o = createPaperOrder({ account: 'paper', ownerId: ALICE, symbol: 'BTCUSDT', side: 'BUY', qty: 1 })
    assert.equal(o.ownerId, ALICE)
    assert.equal(createPaperOrder({ account: 'paper', symbol: 'BTCUSDT', side: 'BUY', qty: 1 }).ownerId, null)
  })

  test('buildFillRecord carries ownerId; absent -> explicit null', () => {
    const f = buildFillRecord({ fillId: 'f1', orderId: 'o1', ownerId: BOB })
    assert.equal(f.ownerId, BOB)
    assert.equal(buildFillRecord({ fillId: 'f1', orderId: 'o1' }).ownerId, null)
  })

  test('snapshotRecord carries ownerId; absent -> explicit null', () => {
    const base = { alertKey: 'ak1', symbol: 'BTCUSDT', venue: 'binance', clockTime: 1, decision: { ok: true } }
    assert.equal(snapshotRecord({ ...base, ownerId: BOB }).ownerId, BOB)
    assert.equal(snapshotRecord({ ...base, alertKey: 'ak2' }).ownerId, null)
  })
})

describe('webhook producer stamps the configured desk owner', () => {
  test('WEBHOOK_OWNER_ID flows into alerts + signals; unset -> null', () => {
    const prev = process.env.WEBHOOK_OWNER_ID
    try {
      process.env.WEBHOOK_OWNER_ID = ALICE
      const alert = toAlertDoc({ ts: Date.now(), action: 'ENTRY', side: 'BUY' }, 'tradingview')
      assert.equal(alert.ownerId, ALICE)
      const sig = toSignalDoc({ ts: Date.now(), action: 'ENTRY', side: 'BUY', symbol: 'BTCUSDT', tf: '15' }, 'tradingview', 'k1')
      assert.equal(sig?.ownerId, ALICE)
      delete process.env.WEBHOOK_OWNER_ID
      assert.equal(toAlertDoc({ ts: Date.now(), action: 'ENTRY', side: 'BUY' }, 'tradingview').ownerId, null)
    } finally {
      if (prev === undefined) delete process.env.WEBHOOK_OWNER_ID
      else process.env.WEBHOOK_OWNER_ID = prev
    }
  })
})

describe('journal read path never crosses owners', () => {
  test('filterJournal excludes other owners; journalQuery pins ownerId', () => {
    const rows = [
      normalizeEntry({ symbol: 'BTCUSDT', dir: 1, entryPrice: 100, entryTime: 1_700_000_000_000, externalId: 'x1', ownerId: ALICE, account: 'paper' }),
      normalizeEntry({ symbol: 'ETHUSDT', dir: 1, entryPrice: 100, entryTime: 1_700_000_000_000, externalId: 'x2', ownerId: BOB, account: 'paper' }),
      normalizeEntry({ symbol: 'SOLUSDT', dir: 1, entryPrice: 100, entryTime: 1_700_000_000_000, externalId: 'x3', ownerId: null, account: 'paper' }),
    ]
    const alice = filterJournal(rows, { ownerId: ALICE })
    assert.equal(alice.length, 1)
    assert.equal(alice[0].symbol, 'BTCUSDT')
    assert.equal(journalQuery({ ownerId: BOB }).ownerId, BOB)
    assert.equal(journalQuery({}).ownerId, undefined)
  })
})

describe('risk_state read/write is owner-scoped', () => {
  const fakeRiskState = (rows: any[]) => {
    const query = (filter: any) => {
      const match = (r: any) => Object.entries(filter).every(([k, v]) => r[k] === v)
      const result: any = {
        lean: async () => rows.find(match) ?? null,
        sort: () => ({ lean: async () => rows.filter(match).slice().sort((a, b) => (a.utcDay < b.utcDay ? 1 : -1))[0] ?? null }),
      }
      return result
    }
    return {
      findOne: (filter: any) => query(filter),
      create: async (doc: any) => { rows.push(doc); return doc },
    }
  }

  test('ensureTodayRow finds/creates only the caller owner row', async () => {
    const rows: any[] = []
    const m: any = { RiskState: fakeRiskState(rows) }
    const a = await ensureTodayRow('paper', {}, m, ALICE)
    assert.equal(a.ownerId, ALICE)
    const b = await ensureTodayRow('paper', {}, m, BOB)
    assert.equal(b.ownerId, BOB)
    // Two owners, two rows — the alice lookup must not return bob's row.
    assert.equal(rows.length, 2)
    assert.equal(rows.filter((r) => r.ownerId === ALICE).length, 1)
    assert.equal(rows.filter((r) => r.ownerId === BOB).length, 1)
  })
})

describe('multi-tenant desk enumeration', () => {
  test('listPaperDesks dedupes (owner, account), skips missing account, keeps null owner', async () => {
    const rows = [
      { ownerId: ALICE, accountId: 'paper' },
      { ownerId: ALICE, accountId: 'paper' }, // duplicate
      { ownerId: ALICE, accountId: 'swing' },
      { ownerId: BOB, accountId: 'paper' },
      { ownerId: null, accountId: 'paper' },
      { ownerId: BOB, accountId: null }, // no account id -> skipped
    ]
    const m: any = { PaperAccount: { find: () => ({ lean: async () => rows }) } }
    const desks = await listPaperDesks(m)
    assert.equal(desks.length, 4)
    const keys = desks.map((d: any) => `${d.ownerId ?? ''}:${d.accountId}`).sort()
    assert.deepEqual(keys, ['owner-alice:paper', 'owner-alice:swing', 'owner-bob:paper', ':paper'].sort())
  })

  test('listPaperDesks never trades an archived desk', async () => {
    const rows = [
      { ownerId: ALICE, accountId: 'paper', archived: false },
      { ownerId: ALICE, accountId: 'retired', archived: true }
    ]
    // Filter-aware fake: honours { archived: { $ne: true } } the desk query sends.
    const m: any = {
      PaperAccount: {
        find: (filter: any) => ({
          lean: async () => rows.filter((r) => !(filter?.archived?.$ne === true && r.archived === true))
        })
      }
    }
    const desks = await listPaperDesks(m)
    assert.deepEqual(desks.map((d: any) => d.accountId), ['paper'])
  })
})
