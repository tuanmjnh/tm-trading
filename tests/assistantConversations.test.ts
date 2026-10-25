import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendConversationTurn,
  conversationIdFor,
  conversationPatch,
  conversationTtlDays,
  deleteConversation,
  getConversation,
  isConversationExpired,
  listConversations,
  publicConversation,
  turnMessages,
} from '../server/utils/assistantConversations'

// =============================================================================
//  Phase H (§61.12 H5) — persisted assistant conversations.
//
//  The contract under test: one turn per verified ask, owner-scoped reads (a
//  foreign conversation id is never hijacked), capped messages with counted
//  drops, sliding TTL retention, and a public projection that never leaks the
//  owner id. The Mongo layer is an in-memory fake implementing exactly the four
//  calls the store makes.
// =============================================================================

type Row = Record<string, any>

const NOW = 1_790_000_000_000

function fakeModel(seed: Row[] = []) {
  const docs = new Map<string, Row>()
  for (const d of seed) docs.set(String(d._id), structuredClone(d))
  const M: any = {
    __docs: docs,
    findOne(q: Row) {
      return {
        lean: async () => {
          const d = docs.get(String(q._id))
          return d && d.ownerId === q.ownerId ? structuredClone(d) : null
        },
      }
    },
    find(q: Row) {
      return {
        sort: () => ({
          limit: (n: number) => ({
            lean: async () => [...docs.values()]
              .filter(d => d.ownerId === q.ownerId)
              .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
                || String(b._id).localeCompare(String(a._id)))
              .slice(0, n)
              .map(d => structuredClone(d)),
          }),
        }),
      }
    },
    findOneAndUpdate(q: Row, patch: Row) {
      return {
        lean: async () => {
          const existing = docs.get(String(q._id))
          if (existing && existing.ownerId !== q.ownerId) return null
          const doc = {
            ...(existing ?? {}),
            ...patch.$set,
            ...(patch.$setOnInsert ?? {}),
            createdAt: existing?.createdAt ?? new Date(NOW),
            updatedAt: new Date(NOW),
          }
          docs.set(String(q._id), doc)
          return structuredClone(doc)
        },
      }
    },
    findOneAndDelete(q: Row) {
      return {
        lean: async () => {
          const d = docs.get(String(q._id))
          if (!d || d.ownerId !== q.ownerId) return null
          docs.delete(String(q._id))
          return structuredClone(d)
        },
      }
    },
  }
  return M
}

const TURN = (over: Row = {}): Row => ({
  scopeType: 'session',
  scopeId: 'ses_1',
  question: 'Why is this session running?',
  answer: 'It is running (fact).',
  refs: [{ kind: 'session', id: 'ses_1' }],
  model: 'm1',
  toolCalls: [],
  ...over,
})

describe('conversation pure helpers', () => {
  test('one turn produces a user + assistant message pair', () => {
    const [user, assistant] = turnMessages(TURN() as any, NOW)
    assert.equal(user.role, 'user')
    assert.equal(user.content, 'Why is this session running?')
    assert.equal(assistant.role, 'assistant')
    assert.equal(assistant.content, 'It is running (fact).')
    for (const m of [user, assistant]) {
      assert.equal(m.at, NOW)
      assert.equal(m.model, 'm1')
      assert.deepEqual(m.refs, [{ kind: 'session', id: 'ses_1' }])
    }
  })

  test('first turn creates the doc; later turns keep the title and re-arm retention', () => {
    const first = conversationPatch({ existing: null, ownerId: 'alice', turn: TURN() as any, nowMs: NOW, ttlDays: 30 })
    assert.match(first.id, /^cnv_/)
    assert.equal(first.title, 'Why is this session running?')
    assert.equal(first.set.messageCount, 2)
    assert.equal(first.set.expiresAt.getTime(), NOW + 30 * 86_400_000)

    const existing = { _id: first.id, ownerId: 'alice', title: 'Why is this session running?', scopeType: 'session', scopeId: 'ses_1', messages: first.set.messages, droppedMessages: 0 }
    const second = conversationPatch({
      existing, ownerId: 'alice',
      turn: TURN({ question: 'And the fills?', answer: 'Two fills.', conversationId: first.id }) as any,
      nowMs: NOW + 1000, ttlDays: 30,
    })
    assert.equal(second.id, first.id)
    assert.equal(second.title, 'Why is this session running?')
    assert.equal(second.set.messageCount, 4)
    assert.equal(second.set.lastMessageAt, NOW + 1000)
    assert.equal(second.set.expiresAt.getTime(), NOW + 1000 + 30 * 86_400_000)
  })

  test('messages are capped with counted drops (never silent loss)', () => {
    const existing = { _id: 'cnv_x', ownerId: 'alice', title: 't', scopeType: 'session', messages: Array.from({ length: 100 }, (_, i) => ({ role: 'user', content: `m${i}`, at: i })), droppedMessages: 0 }
    const patch = conversationPatch({ existing, ownerId: 'alice', turn: TURN() as any, nowMs: NOW, maxMessages: 100 })
    assert.equal(patch.set.messages.length, 100)
    assert.equal(patch.set.droppedMessages, 2)
    assert.equal(patch.set.messages[0].content, 'm2')
  })

  test('retention window comes from env, default 30 days', () => {
    assert.equal(conversationTtlDays(), 30)
    assert.equal(conversationTtlDays({ ASSISTANT_CONVERSATION_TTL_DAYS: '7' }), 7)
    assert.equal(conversationTtlDays({ ASSISTANT_CONVERSATION_TTL_DAYS: 'nope' }), 30)
    assert.equal(conversationTtlDays({ ASSISTANT_CONVERSATION_TTL_DAYS: '0' }), 30)
  })

  test('expiry check: missing expiry is never expired; the past is', () => {
    assert.equal(isConversationExpired(null), false)
    assert.equal(isConversationExpired({}), false)
    assert.equal(isConversationExpired({ expiresAt: new Date(NOW - 1) }, NOW), true)
    assert.equal(isConversationExpired({ expiresAt: new Date(NOW + 1) }, NOW), false)
  })

  test('public projection never carries the owner id', () => {
    const doc = { _id: 'cnv_1', ownerId: 'alice', scopeType: 'session', title: 't', messages: [{ role: 'user', content: 'q', at: NOW }], messageCount: 1, expiresAt: new Date(NOW), createdAt: new Date(NOW) }
    const pub = publicConversation(doc) as Row
    assert.equal(pub.id, 'cnv_1')
    assert.equal('ownerId' in pub, false)
    assert.equal(JSON.stringify(pub).includes('alice'), false)
    assert.equal(pub.messages[0].content, 'q')
    assert.equal('secretEnc' in pub.messages[0], false)
  })

  test('conversation ids are unique and refuse a bad clock', () => {
    assert.notEqual(conversationIdFor(NOW), conversationIdFor(NOW))
    assert.match(conversationIdFor(NOW), /^cnv_[a-z0-9]+_[a-z0-9]+$/)
    assert.throws(() => conversationIdFor(0))
  })
})

describe('conversation store (owner-scoped IO)', () => {
  test('append creates, then appends; a foreign conversation id is never hijacked', async () => {
    const M = fakeModel()
    const first = await appendConversationTurn('alice', TURN() as any, { Model: M, now: () => NOW })
    assert.ok(first)
    assert.equal(first!.messageCount, 2)

    const second = await appendConversationTurn('alice', TURN({ conversationId: first!.id, question: 'And fills?', answer: 'Two.' }) as any, { Model: M, now: () => NOW + 1 })
    assert.equal(second!.id, first!.id)
    assert.equal(second!.messageCount, 4)

    const hijack = await appendConversationTurn('mallory', TURN({ conversationId: first!.id }) as any, { Model: M, now: () => NOW + 2 })
    assert.equal(hijack, null)
    const stillTwo = await appendConversationTurn('alice', TURN({ conversationId: first!.id, question: 'again', answer: 'ok' }) as any, { Model: M, now: () => NOW + 3 })
    assert.equal(stillTwo!.messageCount, 6)
  })

  test('reads and deletes are owner-scoped', async () => {
    const M = fakeModel()
    const conv = await appendConversationTurn('alice', TURN() as any, { Model: M, now: () => NOW })
    await appendConversationTurn('mallory', TURN({ scopeId: 'ses_9' }) as any, { Model: M, now: () => NOW })

    const got = await getConversation('alice', conv!.id as string, { Model: M, now: () => NOW })
    assert.equal(got!.id, conv!.id)
    assert.equal(await getConversation('mallory', conv!.id as string, { Model: M, now: () => NOW }), null)
    assert.equal(await getConversation('alice', 'cnv_unknown', { Model: M, now: () => NOW }), null)

    const listed = await listConversations('alice', { Model: M, now: () => NOW })
    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, conv!.id)

    assert.equal(await deleteConversation('mallory', conv!.id as string, { Model: M }), false)
    assert.equal(await deleteConversation('alice', conv!.id as string, { Model: M }), true)
    assert.equal((await listConversations('alice', { Model: M, now: () => NOW })).length, 0)
  })

  test('expired rows are hidden from list/get even before the TTL sweep', async () => {
    const past = { _id: 'cnv_old', ownerId: 'alice', scopeType: 'session', title: 't', messages: [], messageCount: 0, lastMessageAt: NOW - 1000, expiresAt: new Date(NOW - 1) }
    const live = { _id: 'cnv_new', ownerId: 'alice', scopeType: 'session', title: 't', messages: [], messageCount: 0, lastMessageAt: NOW, expiresAt: new Date(NOW + 86_400_000) }
    const M = fakeModel([past, live])
    const listed = await listConversations('alice', { Model: M, now: () => NOW })
    assert.deepEqual(listed.map(c => c.id), ['cnv_new'])
    assert.equal(await getConversation('alice', 'cnv_old', { Model: M, now: () => NOW }), null)
    // At a later clock the survivor ages out too.
    assert.deepEqual(await listConversations('alice', { Model: M, now: () => NOW + 90 * 86_400_000 }), [])
  })

  test('Mongo unavailable → fail-soft null/empty, never a throw', async () => {
    assert.deepEqual(await listConversations('alice', { Model: null }), [])
    assert.equal(await getConversation('alice', 'cnv_1', { Model: null }), null)
    assert.equal(await appendConversationTurn('alice', TURN() as any, { Model: null }), null)
    assert.equal(await deleteConversation('alice', 'cnv_1', { Model: null }), false)
  })
})
