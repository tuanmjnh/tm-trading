import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deleteModel,
  listModels,
  setModelEnabled,
  setPrimaryModel,
  upsertModels,
} from '../ai/providerStore.mjs'

// =============================================================================
//  Phase G.5 — per-connection model catalogue (mirrors tm-hub R147 ai_models).
//
//  The contract under test: idempotent bulk save (D3), AT MOST ONE primary per
//  connection, setPrimary writes the model into the connection row (the bot's
//  live switch) and resets the health result, owner scoping on every op, and
//  cascade on connection delete. The Mongo layer is an in-memory fake injected
//  through the store's `deps` seam — same pattern as tests/assistantConversations.
// =============================================================================

const OWNER = '62da4efe-34b4-4a6b-b4ae-967942ecaf53'
const OTHER = 'mallory-owner'
const CONN = `${OWNER}:openai:default`

function fakeDeps({ withConnection = true } = {}) {
  const models = new Map()
  const connections = new Map()
  if (withConnection) {
    connections.set(CONN, { _id: CONN, provider: 'openai', adapter: 'openai_compatible', model: 'gpt-4o-mini', status: 'ok', ownerId: OWNER })
  }
  const model = {
    // Sync methods returning chainable objects — the store chains
    // `.sort().limit().lean()` / `.lean()` exactly like a mongoose Query.
    find(q: any) {
      const rows = [...models.values()].filter(
        (r: any) => (!q.ownerId || r.ownerId === q.ownerId) && (!q.connectionId || r.connectionId === q.connectionId),
      )
      rows.sort((a: any, b: any) => (b.isPrimary === true) - (a.isPrimary === true) || String(a.model).localeCompare(String(b.model)))
      return {
        sort: () => ({
          limit: () => ({ lean: async () => rows.map((r: any) => structuredClone(r)) }),
        }),
      }
    },
    async updateMany(q: any, patch: any) {
      let n = 0
      for (const [id, r] of models) {
        if (String(r.connectionId) === String(q.connectionId) && r.isPrimary === true && q.model?.$ne !== r.model) {
          models.set(id, { ...r, isPrimary: patch.$set.isPrimary })
          n++
        }
      }
      return { modifiedCount: n }
    },
    findOneAndUpdate(q: any, update: any, _opts: any = {}) {
      const id = String(q._id)
      const existing = models.get(id)
      if (existing && existing.ownerId !== q.ownerId) return { lean: async () => null }
      if (!existing && !update.$setOnInsert) return { lean: async () => null }
      const doc = {
        isEnabled: true,
        isPrimary: false,
        source: 'manual',
        schemaVersion: 'ai-provider.v1',
        ...(existing ?? {}),
        ...(update.$set ?? {}),
        ...(update.$setOnInsert ?? {}),
        _id: id,
      }
      models.set(id, doc)
      return { lean: async () => structuredClone(doc) }
    },
    async bulkWrite(ops: any[]) {
      let upserted = 0
      for (const op of ops) {
        const id = String(op.updateOne.filter._id)
        if (!models.has(id)) {
          models.set(id, { ...op.updateOne.update.$setOnInsert })
          upserted++
        }
      }
      return { upsertedCount: upserted }
    },
    findOneAndDelete(q: any) {
      const id = String(q._id)
      const r = models.get(id)
      if (!r || (q.ownerId && r.ownerId !== q.ownerId)) return { lean: async () => null }
      models.delete(id)
      return { lean: async () => structuredClone(r) }
    },
    async deleteMany(q: any) {
      let n = 0
      for (const [id, r] of models) {
        if (String(r.connectionId) === String(q.connectionId)) { models.delete(id); n++ }
      }
      return { deletedCount: n }
    },
  }
  const connection = {
    async exists(q: any) {
      const row = connections.get(String(q._id))
      return row && row.ownerId === q.ownerId ? { _id: String(q._id) } : null
    },
    findOneAndUpdate(_q: any, patch: any) {
      const row = connections.get(CONN)
      if (!row || row.ownerId !== OWNER) return { lean: async () => null }
      const next = { ...row, ...patch.$set }
      connections.set(CONN, next)
      return { lean: async () => structuredClone(next) }
    },
  }
  return {
    deps: { model, connection },
    models,
    connectionRow: () => structuredClone(connections.get(CONN)),
  }
}

describe('model catalogue (Phase G.5)', () => {
  test('bulk save is idempotent — re-running a discovery never resets enablement', async () => {
    const { deps, models } = fakeDeps()
    const first = await upsertModels({ ownerId: OWNER, connectionId: CONN, models: ['m-a', 'm-b'], deps })
    assert.equal(first.ok, true)
    assert.equal(first.added, 2)

    const row = models.get(`${CONN}::m-a`)
    row.isEnabled = false
    models.set(`${CONN}::m-a`, row)

    const again = await upsertModels({ ownerId: OWNER, connectionId: CONN, models: ['m-a', 'm-b', 'm-c'], deps })
    assert.equal(again.ok, true)
    assert.equal(again.added, 1)
    assert.equal(models.get(`${CONN}::m-a`).isEnabled, false, 'existing row untouched ($setOnInsert)')
  })

  test('setPrimary promotes the row, demotes the old one and rewrites connection.model', async () => {
    const { deps, models, connectionRow } = fakeDeps()
    await upsertModels({ ownerId: OWNER, connectionId: CONN, models: ['m-a', 'm-b'], deps })

    const res = await setPrimaryModel({ ownerId: OWNER, connectionId: CONN, model: 'm-b', deps })
    assert.ok(res?.model)
    assert.equal(res.model.model, 'm-b')
    assert.equal(connectionRow().model, 'm-b', 'the bot resolves through connection.model')
    assert.equal(connectionRow().status, 'untested', 'a model change invalidates the last health result')

    assert.equal(models.get(`${CONN}::m-b`).isPrimary, true)
    assert.equal(models.get(`${CONN}::m-a`).isPrimary, false)

    // Switching back leaves exactly one primary.
    await setPrimaryModel({ ownerId: OWNER, connectionId: CONN, model: 'm-a', deps })
    assert.equal(models.get(`${CONN}::m-a`).isPrimary, true)
    assert.equal(models.get(`${CONN}::m-b`).isPrimary, false)
    assert.equal([...models.values()].filter((r: any) => r.isPrimary).length, 1)
  })

  test('listModels returns primary first and is owner-scoped', async () => {
    const { deps } = fakeDeps()
    await upsertModels({ ownerId: OWNER, connectionId: CONN, models: ['m-b', 'm-a'], deps })
    await setPrimaryModel({ ownerId: OWNER, connectionId: CONN, model: 'm-a', deps })

    const rows = await listModels({ ownerId: OWNER, connectionId: CONN, deps })
    assert.equal(rows.length, 2)
    assert.equal(rows[0].model, 'm-a')
    assert.equal(rows[0].isPrimary, true)
  })

  test('every op is tenancy-scoped: a foreign owner sees nothing', async () => {
    const { deps } = fakeDeps()
    await upsertModels({ ownerId: OWNER, connectionId: CONN, models: ['m-a'], deps })

    const foreign = await upsertModels({ ownerId: OTHER, connectionId: CONN, models: ['m-x'], deps })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.code, 'connection_not_found')

    assert.equal(await setPrimaryModel({ ownerId: OTHER, connectionId: CONN, model: 'm-a', deps }), null)
    assert.equal(await setModelEnabled({ ownerId: OTHER, connectionId: CONN, model: 'm-a', isEnabled: false, deps }), null)
    assert.equal(await deleteModel({ ownerId: OTHER, connectionId: CONN, model: 'm-a', deps }), false)
    assert.equal((await listModels({ ownerId: OTHER, connectionId: CONN, deps })).length, 0)
    assert.equal((await listModels({ ownerId: OWNER, connectionId: CONN, deps })).length, 1)
  })

  test('deleting a catalogue row never touches the connection active model', async () => {
    const { deps, connectionRow } = fakeDeps()
    await upsertModels({ ownerId: OWNER, connectionId: CONN, models: ['m-a'], deps })
    await setPrimaryModel({ ownerId: OWNER, connectionId: CONN, model: 'm-a', deps })

    assert.equal(await deleteModel({ ownerId: OWNER, connectionId: CONN, model: 'm-a', deps }), true)
    assert.equal(connectionRow().model, 'm-a', 'the active model keeps working without its row')
    assert.equal((await listModels({ ownerId: OWNER, connectionId: CONN, deps })).length, 0)
  })
})
