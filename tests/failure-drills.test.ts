import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_MAX_PENDING,
  InboxFullError,
  consumeCommand,
  enqueueCommand,
  listCommands,
  listQuarantine,
  normaliseCommand,
  pendingCount,
  quarantineCommand,
  quarantineCount,
  quarantineFile,
} from '../services/commandInbox.mjs'

// =============================================================================
//  V4.2 §17.11 — fault handling drills.
//
//  These are the drills that are pure enough to assert without a live cluster.
//  Each one names the mechanism that must hold, so a regression fails here
//  instead of in production. Drills that need a running supervisor are recorded
//  as operator runbooks instead (docs/user-guide/runbooks.md) and are NOT faked
//  as passing tests.
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

/** A throwaway inbox per test, so one drill can never leak state into the next. */
function freshDir(prefix = 'tm-inbox-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function command(overrides: Record<string, unknown> = {}) {
  return normaliseCommand({
    operationId: `op_${Math.random().toString(36).slice(2, 10)}`,
    serviceId: 'news',
    action: 'start',
    actor: 'tester',
    idempotencyKey: 'k1',
    now: NOW,
    ...overrides,
  })
}

describe('drill — queue backlog growth is bounded', () => {
  test('the inbox refuses new work at capacity instead of growing forever', () => {
    const dir = freshDir()
    try {
      const cap = 3
      for (let index = 0; index < cap; index += 1) {
        enqueueCommand(command({ operationId: `op_full_${index}` }), { dir, maxPending: cap, now: NOW })
      }
      assert.equal(pendingCount({ dir, now: NOW }), cap)

      assert.throws(
        () => enqueueCommand(command({ operationId: 'op_full_extra' }), { dir, maxPending: cap, now: NOW }),
        (error: unknown) => {
          assert.ok(error instanceof InboxFullError, 'a full inbox is a typed refusal, not a crash')
          assert.equal((error as InboxFullError).code, 'INBOX_FULL')
          assert.equal((error as InboxFullError).pending, cap)
          assert.equal((error as InboxFullError).max, cap)
          return true
        },
      )

      // Nothing was half-written by the refusal.
      assert.equal(readdirSync(dir).filter(name => name.endsWith('.json')).length, cap)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a replay of a queued command still succeeds when the inbox is full', () => {
    const dir = freshDir()
    try {
      const cap = 1
      const first = command({ operationId: 'op_replay' })
      enqueueCommand(first, { dir, maxPending: cap, now: NOW })
      // Same operationId = the same command, not a second one: at-least-once
      // delivery depends on the replay never being rejected as overflow.
      assert.doesNotThrow(() => enqueueCommand(first, { dir, maxPending: cap, now: NOW }))
      assert.equal(pendingCount({ dir, now: NOW }), 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('expired commands free capacity, they are not counted as pending', () => {
    const dir = freshDir()
    try {
      const cap = 1
      enqueueCommand(command({ operationId: 'op_old', now: NOW, ttlMs: 1_000 }), { dir, maxPending: cap, now: NOW })
      const later = NOW + 60_000
      assert.equal(pendingCount({ dir, now: later }), 0)
      assert.doesNotThrow(() => enqueueCommand(command({ operationId: 'op_new' }), { dir, maxPending: cap, now: later }))
      const listed = listCommands({ dir, now: later })
      assert.deepEqual(listed.commands.map(entry => entry.operationId), ['op_new'])
      assert.deepEqual(listed.expired.map(entry => entry.operationId), ['op_old'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the default ceiling is finite and sane', () => {
    assert.ok(Number.isFinite(DEFAULT_MAX_PENDING) && DEFAULT_MAX_PENDING > 0)
  })
})

describe('drill — a corrupt queue item does not wedge the queue', () => {
  test('an unreadable file is reported and skipped, never thrown', () => {
    const dir = freshDir('tm-inbox-bad-')
    try {
      writeFileSync(join(dir, 'op_broken.json'), '{ not json')
      enqueueCommand(command({ operationId: 'op_good' }), { dir, now: NOW })
      const listed = listCommands({ dir, now: NOW })
      assert.deepEqual(listed.commands.map(entry => entry.operationId), ['op_good'])
      assert.equal(listed.invalid.length, 1)
      assert.equal(listed.invalid[0].file, 'op_broken.json')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('consuming a command is one-way and idempotent', () => {
    const dir = freshDir('tm-inbox-consume-')
    try {
      enqueueCommand(command({ operationId: 'op_once' }), { dir, now: NOW })
      assert.equal(consumeCommand('op_once', { dir }), true)
      assert.equal(consumeCommand('op_once', { dir }), false, 'a second consume is a no-op')
      assert.equal(pendingCount({ dir, now: NOW }), 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('drill — the control plane refuses honestly when saturated', () => {
  function readRepo(path: string): string {
    return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  }

  test('the command endpoint answers 429, not 500, when the inbox is full', () => {
    const source = readRepo('server/api/v1/operations/services/[serviceId]/[action].post.ts')
    assert.match(source, /INBOX_FULL/, 'it recognises the typed refusal')
    assert.match(source, /statusCode: 429/, 'a full inbox is rate-limit-shaped, not a server fault')
    assert.doesNotMatch(source, /statusCode: 500/, 'never a generic server error for expected back-pressure')
  })

  test('the batch endpoint reports truncation instead of failing the whole batch', () => {
    const source = readRepo('server/api/v1/admin/services/run-once.post.ts')
    assert.match(source, /INBOX_FULL/, 'it detects capacity mid-batch')
    assert.match(source, /truncated/, 'the caller is told the batch was cut short')
    assert.match(source, /break/, 'it stops cleanly at the ceiling')
  })
})
describe('drill — a dropped command is quarantined, never silently deleted', () => {
  function freshInbox(prefix = 'tm-inbox-q-'): string {
    return mkdtempSync(join(tmpdir(), prefix))
  }

  test('an expired command moves to the dead-letter box with its reason', () => {
    const dir = freshInbox()
    try {
      const expired = command({ operationId: 'op_expired', now: NOW, ttlMs: 1_000 })
      enqueueCommand(expired, { dir, now: NOW })
      const file = quarantineCommand(expired, { dir, now: NOW + 60_000, reason: 'expired: deadline passed' })

      assert.ok(existsSync(file), 'the dropped command is kept')
      assert.equal(pendingCount({ dir, now: NOW + 60_000 }), 0, 'it is no longer pending')
      assert.equal(existsSync(join(dir, 'op_expired.json')), false, 'the original is gone, so it cannot be retried')

      const entries = listQuarantine({ dir })
      assert.equal(entries.length, 1)
      assert.equal(entries[0].reason, 'expired: deadline passed')
      assert.equal(entries[0].command?.operationId, 'op_expired')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('an unparseable file is preserved verbatim, not thrown away', () => {
    const dir = freshInbox('tm-inbox-qbad-')
    try {
      writeFileSync(join(dir, 'op_broken.json'), '{ not json')
      const file = quarantineFile('op_broken.json', { dir, now: NOW, reason: 'invalid: unreadable' })
      assert.ok(file)
      assert.equal(existsSync(join(dir, 'op_broken.json')), false, 'it can no longer wedge the queue')

      const entries = listQuarantine({ dir })
      assert.equal(entries.length, 1)
      assert.equal(entries[0].source, 'op_broken.json')
      assert.equal(entries[0].raw, '{ not json', 'the raw bytes are the evidence')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the dead-letter box is bounded and keeps the newest', () => {
    const dir = freshInbox('tm-inbox-qcap-')
    try {
      for (let index = 0; index < 5; index += 1) {
        const command_ = command({ operationId: `op_q_${index}` })
        enqueueCommand(command_, { dir, now: NOW })
        quarantineCommand(command_, { dir, now: NOW + index * 1_000, reason: `r${index}`, maxQuarantine: 3 })
      }
      const entries = listQuarantine({ dir })
      assert.equal(entries.length, 3, 'a dead-letter box that grows forever is just a slower outage')
      assert.deepEqual(entries.map(entry => entry.reason), ['r4', 'r3', 'r2'], 'newest first')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('quarantined commands never count as pending or re-appear', () => {
    const dir = freshInbox('tm-inbox-qpend-')
    try {
      const command_ = command({ operationId: 'op_q_pending' })
      enqueueCommand(command_, { dir, now: NOW })
      assert.equal(pendingCount({ dir, now: NOW }), 1)
      quarantineCommand(command_, { dir, now: NOW, reason: 'rejected: SERVICE_NOT_FOUND' })
      assert.equal(pendingCount({ dir, now: NOW }), 0)
      const listed = listCommands({ dir, now: NOW })
      assert.deepEqual(listed.commands, [])
      assert.deepEqual(listed.invalid, [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('drill — the supervisor routes every drop to quarantine', () => {
  test('rejected, expired and invalid commands are quarantined, not deleted', () => {
    const source = readFileSync(new URL('../services/supervisor.mjs', import.meta.url), 'utf8')
    assert.match(source, /quarantineCommand\(/, 'rejected and expired commands are kept')
    assert.match(source, /quarantineFile\(/, 'unparseable files are kept verbatim')
    assert.doesNotMatch(source, /removeCommandFile\(/, 'nothing is deleted outright anymore')
    assert.match(source, /command === 'quarantine'/, 'the operator can list the dead-letter box')
  })
})
describe('drill — the dead-letter count is cheap and exact', () => {
  test('it counts quarantined items without parsing them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-inbox-qcount-'))
    try {
      assert.equal(quarantineCount({ dir }), 0, 'a missing quarantine directory is zero, not an error')
      for (let index = 0; index < 3; index += 1) {
        const command_ = command({ operationId: `op_count_${index}` })
        enqueueCommand(command_, { dir, now: NOW })
        quarantineCommand(command_, { dir, now: NOW + index, reason: `r${index}` })
      }
      assert.equal(quarantineCount({ dir }), 3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})