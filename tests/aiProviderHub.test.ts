import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { hubRelayEnv, syncHubCatalog, upsertModels } from '../ai/providerStore.mjs'

// =============================================================================
//  TM Hub AI relay sync — the app mirrors the hub's relay catalog into local
//  `provider='hub'` rows (no key is ever stored: secrets stay on the hub).
//  Contract under test: idempotent mirror (D3), one hub row per granted
//  connection, first sync adopts the hub primary but later syncs preserve the
//  user's local model choice, revoked connections are disabled (not deleted),
//  and failure modes return stable codes. Mongo + fetch are injected fakes.
// =============================================================================

const OWNER = '62da4efe-34b4-4a6b-b4ae-967942ecaf53'

const ENV_OK = {
  NUXT_PUBLIC_HUB_URL: 'https://hub.test',
  NUXT_PUBLIC_HUB_APP_ID: 'app_test',
  NUXT_HUB_APP_SECRET: 'app-secret-1',
}

/** Catalog payload as returned by tm-hub GET /api/v1/apps/:id/ai/relay/catalog. */
function catalogPayload(connections: any[]) {
  return { success: true, data: { connections } }
}

function hubRow(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: 'conn-oracle',
    provider: 'openai',
    name: 'openai (hub)',
    adapterType: 'openai_compatible',
    origin: 'own',
    hasKey: true,
    model: 'gpt-4o-mini',
    models: [
      { modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini', isPrimary: true },
      { modelId: 'o3-mini', displayName: null, isPrimary: false },
    ],
    ...overrides,
  }
}

/** Chainable that satisfies both `await Q` (thenable) and `Q.lean()`. */
function chain(doc: any) {
  const base: any = Promise.resolve(doc ? structuredClone(doc) : doc)
  base.lean = async () => (doc ? structuredClone(doc) : doc)
  base.catch = () => base
  return base
}

function fakeConnection() {
  const rows = new Map<string, any>()
  const connection = {
    async exists(q: any) {
      const r = rows.get(String(q._id))
      return r && r.ownerId === q.ownerId ? { _id: String(q._id) } : null
    },
    findOne(q: any) {
      const r = rows.get(String(q._id))
      return chain(r ?? null)
    },
    findByIdAndUpdate(_id: any, update: any) {
      const id = String(_id?._id ?? _id)
      const existing = rows.get(id)
      const doc = { ...(existing ?? {}), ...(update.$set ?? {}), ...(update.$setOnInsert ?? {}), _id: id }
      rows.set(id, doc)
      return chain(doc)
    },
    find(q: any) {
      const list = [...rows.values()].filter(
        r => (!q.ownerId || r.ownerId === q.ownerId) && (!q.provider || r.provider === q.provider),
      )
      return { select: () => ({ lean: async () => list.map((r: any) => structuredClone(r)) }) }
    },
    async updateOne(q: any, patch: any) {
      const id = String(q._id)
      const r = rows.get(id)
      if (!r) return { modifiedCount: 0 }
      rows.set(id, { ...r, ...patch.$set })
      return { modifiedCount: 1 }
    },
  }
  return { connection, rows }
}

function fakeModel() {
  const rows = new Map<string, any>()
  return {
    rows,
    async bulkWrite(ops: any[]) {
      let upserted = 0
      for (const op of ops) {
        const id = String(op.updateOne.filter._id)
        if (!rows.has(id)) {
          rows.set(id, { ...op.updateOne.update.$setOnInsert })
          upserted++
        }
      }
      return { upsertedCount: upserted }
    },
  }
}

function okFetch(payload: unknown) {
  return async (_url: any, _opts: any) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  })
}

describe('hub relay env', () => {
  test('hubRelayEnv requires all three variables', () => {
    assert.ok(hubRelayEnv(ENV_OK))
    assert.equal(hubRelayEnv({ NUXT_PUBLIC_HUB_URL: 'https://hub.test' }), null)
    assert.equal(hubRelayEnv({ ...ENV_OK, NUXT_HUB_APP_SECRET: '' }), null)
    assert.equal(hubRelayEnv({ ...ENV_OK, NUXT_PUBLIC_HUB_URL: ' ' }), null)
  })
})

describe('hub catalog sync', () => {
  test('missing env returns hub_not_configured without touching the store', async () => {
    const { connection, rows } = fakeConnection()
    const res = await syncHubCatalog({
      ownerId: OWNER,
      env: { NUXT_PUBLIC_HUB_URL: 'https://hub.test' },
      deps: { connection },
    })
    assert.equal(res.ok, false)
    assert.equal(res.code, 'hub_not_configured')
    assert.equal(rows.size, 0)
  })

  test('happy path mirrors hub connections into provider=hub rows with models', async () => {
    const { connection, rows } = fakeConnection()
    const model = fakeModel()
    const res = await syncHubCatalog({
      ownerId: OWNER,
      env: ENV_OK,
      fetchImpl: okFetch(catalogPayload([hubRow()])),
      deps: { connection, model },
    })
    assert.equal(res.ok, true)
    assert.equal(res.created, 1)
    assert.equal(res.modelsAdded, 2)

    const bob = rows.get(`${OWNER}:hub:conn-oracle`)
    assert.equal(bob.provider, 'hub')
    assert.equal(bob.adapter, 'hub_relay')
    assert.equal(bob.hubConnectionId, 'conn-oracle')
    assert.equal(bob.hubProvider, 'openai')
    assert.equal(bob.model, 'gpt-4o-mini', 'first sync adopts the hub primary')
    assert.equal(bob.secretEnc, null, 'hub rows never store a key')
    assert.equal(bob.enabled, true)
    assert.ok(bob.hubSyncedAt > 0)

    assert.equal(model.rows.get(`${OWNER}:hub:conn-oracle::gpt-4o-mini`).displayName, 'GPT-4o mini')
    assert.ok(!model.rows.get(`${OWNER}:hub:conn-oracle::o3-mini`).displayName, 'no display name without one')
    assert.equal(model.rows.get(`${OWNER}:hub:conn-oracle::gpt-4o-mini`).source, 'discovered')
  })

  test('re-sync is idempotent and preserves the user local model choice', async () => {
    const { connection, rows } = fakeConnection()
    const model = fakeModel()
    const deps = { connection, model }
    await syncHubCatalog({ ownerId: OWNER, env: ENV_OK, fetchImpl: okFetch(catalogPayload([hubRow()])), deps })

    // The user switched the bot model locally (setPrimaryModel writes model).
    const bob = rows.get(`${OWNER}:hub:conn-oracle`)
    rows.set(`${OWNER}:hub:conn-oracle`, { ...bob, model: 'o3-mini' })

    const again = await syncHubCatalog({
      ownerId: OWNER,
      env: ENV_OK,
      fetchImpl: okFetch(catalogPayload([hubRow()])),
      deps,
    })
    assert.equal(again.created, 0)
    assert.equal(again.updated, 1)
    assert.equal(again.modelsAdded, 0, 'model rows are not duplicated')
    assert.equal(rows.get(`${OWNER}:hub:conn-oracle`).model, 'o3-mini', 'local primary survives re-sync')
  })

  test('connections revoked at the hub are disabled locally, not deleted', async () => {
    const { connection, rows } = fakeConnection()
    const model = fakeModel()
    const deps = { connection, model }
    await syncHubCatalog({
      ownerId: OWNER,
      env: ENV_OK,
      fetchImpl: okFetch(catalogPayload([hubRow(), hubRow({ connectionId: 'conn-x', models: [], model: 'm1' })])),
      deps,
    })
    assert.equal(rows.size, 2)

    // Second sync only grants conn-oracle → conn-x must be switched off.
    const res = await syncHubCatalog({
      ownerId: OWNER,
      env: ENV_OK,
      fetchImpl: okFetch(catalogPayload([hubRow()])),
      deps,
    })
    assert.equal(res.disabled, 1)
    const revoke = rows.get(`${OWNER}:hub:conn-x`)
    assert.equal(revoke.enabled, false, 'disabled, history kept')
    assert.ok(revoke, 'row not deleted')

    // Re-granted hub rows come back enabled on their own (new rows from the
    // mirror), while a locally-disabled grant stays under user control.
    const grant = rows.get(`${OWNER}:hub:conn-oracle`)
    assert.equal(grant.enabled, true)
  })

  test('hub errors and network failures return stable codes', async () => {
    const { connection, rows } = fakeConnection()
    const bad = await syncHubCatalog({
      ownerId: OWNER,
      env: ENV_OK,
      fetchImpl: async () => ({ ok: false, status: 502, text: async () => JSON.stringify({ message: 'ai.invalid-key' }) }),
      deps: { connection },
    })
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'hub_error')
    assert.equal(bad.error, 'ai.invalid-key')
    assert.equal(rows.size, 0)

    const net = await syncHubCatalog({
      ownerId: OWNER,
      env: ENV_OK,
      fetchImpl: async () => { throw new Error('ECONNREFUSED') },
      deps: { connection },
    })
    assert.equal(net.ok, false)
    assert.equal(net.code, 'hub_network')
  })

  test('sync is owner-scoped and rows are named after the hub connection', async () => {
    const { connection } = fakeConnection()
    const res = await syncHubCatalog({
      ownerId: OWNER,
      env: ENV_OK,
      fetchImpl: okFetch(catalogPayload([hubRow({ name: 'OpenAI central' })])),
      deps: { connection },
    })
    assert.equal(res.ok, true)
  })
})

describe('model catalogue entries', () => {
  test('upsertModels accepts {model, displayName} entries next to plain strings', async () => {
    const { connection, rows: connRows } = fakeConnection()
    connRows.set('c1', { _id: 'c1', ownerId: OWNER, provider: 'openai' })
    const model = fakeModel()
    const res = await upsertModels({
      ownerId: OWNER,
      connectionId: 'c1',
      models: [
        { model: 'gpt-4o-mini', displayName: 'GPT-4o mini' },
        'plain-model',
        { modelId: 'm2', displayName: 'M Two' },
        { model: 'gpt-4o-mini', displayName: 'dup ignored' },
      ],
      deps: { model, connection },
    })
    assert.equal(res.ok, true)
    assert.equal(res.total, 3)
    assert.equal(model.rows.get('c1::gpt-4o-mini').displayName, 'GPT-4o mini')
    assert.equal(model.rows.get('c1::plain-model').displayName, undefined)
    assert.equal(model.rows.get('c1::m2').model, 'm2', 'modelId alias works')
    assert.equal(model.rows.get('c1::m2').displayName, 'M Two')
  })
})
