import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { BotCommand, BOT_COMMAND_TYPES, BOT_COMMAND_STATES } from '../engine/models/botCommand.mjs'
import { BotSupervisor } from '../engine/models/botSupervisor.mjs'
import { BotInstance } from '../engine/models/botInstance.mjs'
import { SUPERVISOR_COMMANDS } from '../engine/botSupervisor.mjs'

// =============================================================================
//  Bot runtime persistence contracts (roadmap §61.7 / §61.17 Phase E).
//
//  Offline: these models never connect here. The durable behaviour (lease
//  exclusivity, command dedupe, guarded transitions) is exercised against a
//  real Mongo in engine/test-db.mjs section 11.
// =============================================================================

describe('bot runtime models — shape and tenancy', () => {
  test('bot commands use their own collection and the supervisor vocabulary', () => {
    assert.equal(BotCommand.modelName, 'bot_commands')
    assert.equal(BotCommand.collection.collectionName, 'bot_commands')
    assert.deepEqual([...BOT_COMMAND_TYPES], [...SUPERVISOR_COMMANDS])
    assert.deepEqual([...BOT_COMMAND_STATES], ['pending', 'applied', 'rejected'])
  })

  test('(ownerId, commandId) is unique so a retried command is a no-op', () => {
    const idx = BotCommand.schema.indexes().find(([keys]) => keys.ownerId === 1 && keys.commandId === 1)
    assert.ok(idx, 'missing (ownerId, commandId) index')
    assert.equal(idx[1].unique, true)
  })

  test('instances carry owner/account scope and a demo marker', () => {
    assert.ok(BotInstance.schema.path('ownerId'))
    assert.ok(BotInstance.schema.path('accountId'))
    assert.ok(BotInstance.schema.path('demo'))
    assert.equal(BotInstance.schema.path('demo').defaultValue, false)
  })

  test('instances expose the additive supervisor fields', () => {
    for (const p of ['lease.supervisorId', 'lease.expiresAt', 'engineVersion', 'subscriptions', 'lastSignalKey', 'sessionId', 'healthReason']) {
      assert.ok(BotInstance.schema.path(p), `missing path ${p}`)
    }
  })

  test('one supervisor lease document per owner, keyed deterministically', () => {
    assert.equal(BotSupervisor.modelName, 'bot_supervisors')
    assert.equal(BotSupervisor.collection.collectionName, 'bot_supervisors')
    assert.equal(BotSupervisor.schema.path('_id').instance, 'String')
    assert.ok(BotSupervisor.schema.path('supervisorId'))
    assert.ok(BotSupervisor.schema.path('expiresAt'))
  })
})
