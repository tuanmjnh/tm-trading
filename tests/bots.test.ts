import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BotProfile,
  BOT_PROFILE_MODES,
  BOT_PROFILE_STATUSES,
} from '../engine/models/botProfile.mjs'
import {
  BotInstance,
  BOT_INSTANCE_STATES,
  BOT_INSTANCE_TERMINAL_STATES,
} from '../engine/models/botInstance.mjs'

// =============================================================================
//  Bot contracts (§57.4 G/H, §58.6, §58.10). Bot Profile != Bot Instance:
//  a profile is reusable config pointing at an immutable strategy version; an
//  instance is one concrete session. Offline — models never connect here.
// =============================================================================

describe('bot contracts (§57.4 G/H)', () => {
  test('profile mode + status enums are the frozen contracts', () => {
    assert.deepEqual([...BOT_PROFILE_MODES], ['BACKTEST', 'REPLAY', 'LIVE_ANALYSIS', 'LIVE_PAPER'])
    assert.deepEqual([...BOT_PROFILE_STATUSES], ['draft', 'enabled', 'disabled', 'archived'])
  })

  test('instance states are the §57.4 H lifecycle; terminal set is a subset', () => {
    assert.deepEqual(
      [...BOT_INSTANCE_STATES],
      ['queued', 'starting', 'running', 'paused', 'stopping', 'completed', 'failed', 'halted'],
    )
    for (const s of BOT_INSTANCE_TERMINAL_STATES) {
      assert.ok(BOT_INSTANCE_STATES.includes(s), `${s} not a lifecycle state`)
    }
  })

  test('profile and instance are distinct models in distinct collections', () => {
    assert.ok(BotProfile.modelName && BotInstance.modelName)
    assert.notEqual(BotProfile.modelName, BotInstance.modelName)
    assert.equal(BotProfile.collection.collectionName, 'bot_profiles')
    assert.equal(BotInstance.collection.collectionName, 'bot_instances')
  })

  test('a profile references an immutable strategy version, never a copy', () => {
    for (const p of ['profileId', 'strategyVersionId', 'mode', 'instruments', 'timeframes', 'effectiveParamsHash', 'enabled', 'status']) {
      assert.ok(BotProfile.schema.path(p), `bot_profile missing ${p}`)
    }
  })

  test('an instance tracks lifecycle + traceability + outcome fields', () => {
    for (const p of [
      'instanceId', 'botProfileId', 'strategyVersionId', 'strategyFingerprint', 'mode', 'state',
      'startedAt', 'stoppedAt', 'lastEventAt', 'eventLagMs', 'paperEquity', 'paperPnl', 'lastError',
      'counts.signals', 'counts.orders', 'counts.trades',
    ]) {
      assert.ok(BotInstance.schema.path(p), `bot_instance missing ${p}`)
    }
  })

  test('lifecycle states are enum-constrained on the schema', () => {
    const enumVals = BotInstance.schema.path('state').options.enum
    assert.deepEqual(enumVals, [...BOT_INSTANCE_STATES])
  })
})
