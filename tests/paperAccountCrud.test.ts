import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPaperAccount,
  updatePaperAccount,
  deletePaperAccount
} from '../server/utils/paperAccount'

// =============================================================================
//  Paper-account CRUD + owner isolation (roadmap §61.17 Phase B).
//
//  The guards are exercised against an in-memory, filter-aware fake of the
//  PaperAccount model so the logic (owner scoping, "book in use" refusal, rename
//  clash) is pinned without Mongo. §61.18: user A cannot modify user B's
//  account — every filter carries the caller's ownerId, so a foreign id is a
//  plain notFound.
// =============================================================================

const ALICE = 'owner-alice'
const BOB = 'owner-bob'

function fakeAccounts() {
  const rows: any[] = []
  const same = (r: any, f: any) => Object.entries(f).every(([k, v]) => r[k] === v)
  return {
    rows,
    findOne: (filter: any) => ({ lean: async () => rows.find((r) => same(r, filter)) ?? null }),
    create: async (doc: any) => {
      if (rows.some((r) => r.ownerId === doc.ownerId && r.accountId === doc.accountId)) {
        const e: any = new Error('duplicate key')
        e.code = 11000
        throw e
      }
      const row = { currency: 'USDT', mode: 'LIVE_PAPER', archived: false, createdAt: new Date(), updatedAt: new Date(), ...doc }
      rows.push(row)
      return row
    },
    findOneAndUpdate: async (filter: any, update: any) => {
      let row = rows.find((r) => same(r, filter))
      if (!row) {
        row = { ownerId: filter.ownerId, accountId: filter.accountId, createdAt: new Date() }
        Object.assign(row, update.$setOnInsert ?? {})
        rows.push(row)
      }
      Object.assign(row, update.$set ?? {})
      row.updatedAt = new Date()
      return row
    },
    deleteOne: async (filter: any) => {
      const i = rows.findIndex((r) => same(r, filter))
      if (i < 0) return { deletedCount: 0 }
      rows.splice(i, 1)
      return { deletedCount: 1 }
    }
  }
}

/** Book models: `countDocuments` returns the configured count for the account. */
const bookModels = (count = 0) => ({
  Position: { countDocuments: async () => count },
  PaperOrder: { countDocuments: async () => count },
  PaperFill: { countDocuments: async () => count },
  RiskState: { countDocuments: async () => count }
})

describe('createPaperAccount', () => {
  test('stamps the caller owner and returns the summary', async () => {
    const Account = fakeAccounts()
    const res = await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    assert.equal(res.ok, true)
    assert.equal(res.account?.accountId, 'paper-main')
    assert.equal(res.account?.archived, false)
    assert.equal((Account.rows[0] as any).ownerId, ALICE)
  })

  test('duplicate id for the SAME owner is rejected', async () => {
    const Account = fakeAccounts()
    await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    const dup = await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    assert.deepEqual(dup, { ok: false, code: 'accounts.errExists' })
  })

  test('two owners may own the same accountId (isolation)', async () => {
    const Account = fakeAccounts()
    const a = await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    const b = await createPaperAccount({ ownerId: BOB, accountId: 'paper-main', models: { Account } })
    assert.equal(a.ok, true)
    assert.equal(b.ok, true)
    assert.equal(Account.rows.length, 2)
  })

  test('validates id, currency and balance', async () => {
    const Account = fakeAccounts()
    const m = { Account }
    assert.equal((await createPaperAccount({ ownerId: ALICE, accountId: 'x', models: m })).code, 'accounts.errInvalidId')
    assert.equal((await createPaperAccount({ ownerId: ALICE, accountId: 'has space', models: m })).code, 'accounts.errInvalidId')
    assert.equal((await createPaperAccount({ ownerId: ALICE, accountId: 'ok-id', currency: 'u$d', models: m })).code, 'accounts.errInvalidCurrency')
    assert.equal((await createPaperAccount({ ownerId: ALICE, accountId: 'ok-id', initialBalance: -5, models: m })).code, 'accounts.errInvalidBalance')
  })

  test('missing owner is unauthorized', async () => {
    const Account = fakeAccounts()
    assert.equal((await createPaperAccount({ ownerId: '', accountId: 'ok-id', models: { Account } })).code, 'accounts.errUnauthorized')
  })
})

describe('updatePaperAccount (rename / archive)', () => {
  test('archive toggles the flag on an empty account', async () => {
    const Account = fakeAccounts()
    await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    const on = await updatePaperAccount({ ownerId: ALICE, accountId: 'paper-main', patch: { archived: true }, models: { Account, ...bookModels() } })
    assert.equal(on.ok, true)
    assert.equal(on.account?.archived, true)
  })

  test('rename is refused once the account owns book rows', async () => {
    const Account = fakeAccounts()
    await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    const res = await updatePaperAccount({ ownerId: ALICE, accountId: 'paper-main', patch: { accountId: 'renamed' }, models: { Account, ...bookModels(3) } })
    assert.equal(res.code, 'accounts.errInUse')
  })

  test('rename on an empty book succeeds; clash with another id is refused', async () => {
    const Account = fakeAccounts()
    await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    await createPaperAccount({ ownerId: ALICE, accountId: 'swing', models: { Account } })
    const clash = await updatePaperAccount({ ownerId: ALICE, accountId: 'paper-main', patch: { accountId: 'swing' }, models: { Account, ...bookModels() } })
    assert.equal(clash.code, 'accounts.errExists')
    const ok = await updatePaperAccount({ ownerId: ALICE, accountId: 'paper-main', patch: { accountId: 'scalp' }, models: { Account, ...bookModels() } })
    assert.equal(ok.ok, true)
    assert.equal(ok.account?.accountId, 'scalp')
  })

  test('archiving a position-only account upserts a seed row', async () => {
    const Account = fakeAccounts()
    const res = await updatePaperAccount({ ownerId: ALICE, accountId: 'ghost', patch: { archived: true }, models: { Account, ...bookModels(1) } })
    assert.equal(res.ok, true)
    assert.equal(Account.rows.length, 1)
    assert.equal((Account.rows[0] as any).archived, true)
  })
})

describe('deletePaperAccount', () => {
  test('deletes an empty account', async () => {
    const Account = fakeAccounts()
    await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    const res = await deletePaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account, ...bookModels() } })
    assert.equal(res.ok, true)
    assert.equal(Account.rows.length, 0)
  })

  test('refuses to delete an account that still owns a book', async () => {
    const Account = fakeAccounts()
    await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account } })
    const res = await deletePaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account, ...bookModels(1) } })
    assert.equal(res.code, 'accounts.errInUse')
    assert.equal(Account.rows.length, 1)
  })

  test('a foreign owner cannot delete or see another owner account', async () => {
    const Account = fakeAccounts()
    await createPaperAccount({ ownerId: BOB, accountId: 'paper-main', models: { Account } })
    const res = await deletePaperAccount({ ownerId: ALICE, accountId: 'paper-main', models: { Account, ...bookModels() } })
    assert.equal(res.code, 'accounts.errNotFound')
    assert.equal(Account.rows.length, 1) // Bob's row survives
  })
})

// =============================================================================
//  Outbox emissions (§61.17 Phase C) — every account mutation publishes a
//  typed trading event so the other views reconcile without a hard refresh.
//  The `emit` seam keeps this off Mongo (no connection in the unit suite).
// =============================================================================

function recorder() {
  const seen: any[] = []
  return { seen, emit: async (input: any) => { seen.push(input); return input } }
}

describe('paper-account outbox emissions', () => {
  test('create / rename / archive / unarchive / delete each emit their event', async () => {
    const Account = fakeAccounts()
    const rec = recorder()
    const models = { Account, ...bookModels(), emit: rec.emit }

    await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models })
    await updatePaperAccount({ ownerId: ALICE, accountId: 'paper-main', patch: { accountId: 'scalp' }, models })
    await updatePaperAccount({ ownerId: ALICE, accountId: 'scalp', patch: { archived: true }, models })
    await updatePaperAccount({ ownerId: ALICE, accountId: 'scalp', patch: { archived: false }, models })
    await deletePaperAccount({ ownerId: ALICE, accountId: 'scalp', models })

    assert.deepEqual(
      rec.seen.map((e) => e.type),
      ['account.created', 'account.renamed', 'account.archived', 'account.unarchived', 'account.deleted']
    )
    // Every event is owner-stamped and keyed to the affected account id.
    for (const e of rec.seen) assert.equal(e.ownerId, ALICE)
    assert.equal(rec.seen[1].data.from, 'paper-main')
    assert.equal(rec.seen[1].data.to, 'scalp')
    assert.equal(rec.seen[1].entityId, 'scalp')
  })

  test('a rejected mutation emits nothing', async () => {
    const Account = fakeAccounts()
    const rec = recorder()
    const models = { Account, ...bookModels(2), emit: rec.emit }
    await createPaperAccount({ ownerId: ALICE, accountId: 'paper-main', models })
    const res = await deletePaperAccount({ ownerId: ALICE, accountId: 'paper-main', models }) // book in use
    assert.equal(res.code, 'accounts.errInUse')
    assert.equal(rec.seen.filter((e) => e.type === 'account.deleted').length, 0)
  })
})
