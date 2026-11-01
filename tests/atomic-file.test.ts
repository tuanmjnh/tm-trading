import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ATOMIC_RENAME_DELAYS_MS, writeFileAtomicSync } from '../services/atomicFile.mjs'

// =============================================================================
//  V4.2 §17.5 — the atomic write both the supervisor state file and the command
//  inbox depend on.
//
//  The bug this file exists for was found by `npm run drills`, not by a unit
//  test: on win32 a concurrent reader makes `renameSync()` fail with EPERM, and
//  a single unretried failure crashed the supervisor daemon mid-operation.
//  These tests pin the contract that keeps that from happening again.
// =============================================================================

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'tm-atomic-'))
}

/** A rename that fails with `code` for the first `failures` calls. */
function flakyRename(code: string, failures: number) {
  const calls: Array<{ from: string, to: string }> = []
  const rename = (from: string, to: string) => {
    calls.push({ from, to })
    if (calls.length <= failures) {
      const error = new Error(`simulated ${code}`) as NodeJS.ErrnoException
      error.code = code
      throw error
    }
    // Real behaviour on success: the destination now holds the content.
    writeFileSync(to, readFileSync(from))
    rmSync(from, { force: true })
  }
  return { rename, calls }
}

describe('atomic file write', () => {
  test('the retry schedule starts immediately and totals well under one tick', () => {
    assert.equal(ATOMIC_RENAME_DELAYS_MS[0], 0, 'the first attempt must not wait')
    const total = ATOMIC_RENAME_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)
    assert.ok(total > 0 && total < 2_000, `retry budget ${total}ms must fit inside a tick`)
    for (let index = 1; index < ATOMIC_RENAME_DELAYS_MS.length; index += 1) {
      assert.ok(ATOMIC_RENAME_DELAYS_MS[index] > ATOMIC_RENAME_DELAYS_MS[index - 1], 'delays must grow')
    }
  })

  test('writes the content and leaves no tmp file behind', () => {
    const dir = freshDir()
    try {
      const file = join(dir, 'nested', 'state.json')
      writeFileAtomicSync(file, '{"revision":1}')
      assert.equal(readFileSync(file, 'utf8'), '{"revision":1}')
      assert.deepEqual(readdirSync(join(dir, 'nested')), ['state.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a contended rename is retried instead of thrown', () => {
    const dir = freshDir()
    try {
      const file = join(dir, 'state.json')
      const { rename, calls } = flakyRename('EPERM', 2)
      writeFileAtomicSync(file, '{"revision":2}', { rename, sleep: () => {} })
      assert.equal(calls.length, 3, 'two EPERM failures must consume three attempts')
      assert.equal(readFileSync(file, 'utf8'), '{"revision":2}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('EBUSY and EACCES are retried too', () => {
    for (const code of ['EBUSY', 'EACCES']) {
      const dir = freshDir()
      try {
        const file = join(dir, 'state.json')
        const { rename, calls } = flakyRename(code, 1)
        writeFileAtomicSync(file, '{"ok":true}', { rename, sleep: () => {} })
        assert.equal(calls.length, 2, `${code} must be retryable`)
        assert.equal(readFileSync(file, 'utf8'), '{"ok":true}')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  test('exhausting the budget throws a readable error and cleans up the tmp file', () => {
    const dir = freshDir()
    try {
      const file = join(dir, 'state.json')
      const { rename, calls } = flakyRename('EPERM', Number.MAX_SAFE_INTEGER)
      assert.throws(
        () => writeFileAtomicSync(file, '{"revision":3}', { rename, sleep: () => {}, delays: [0, 0] }),
        (error: Error) => {
          assert.match(error.message, /could not replace/)
          assert.match(error.message, /after 2 attempts/)
          assert.match(error.message, /EPERM/)
          return true
        },
      )
      assert.equal(calls.length, 2)
      assert.deepEqual(readdirSync(dir), [], 'a failed write must not leave a tmp file')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a non-transient error is rethrown immediately', () => {
    const dir = freshDir()
    try {
      const file = join(dir, 'state.json')
      const { rename, calls } = flakyRename('ENOSPC', 1)
      assert.throws(
        () => writeFileAtomicSync(file, '{"revision":4}', { rename, sleep: () => {} }),
        /simulated ENOSPC/,
      )
      assert.equal(calls.length, 1, 'disk-full is not worth retrying')
      assert.deepEqual(readdirSync(dir), [], 'a failed write must not leave a tmp file')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a reader never observes a partial document', async () => {
    const dir = freshDir()
    try {
      const file = join(dir, 'state.json')
      writeFileAtomicSync(file, JSON.stringify({ revision: 0 }))
      const writes = 60
      let stop = false
      const badReads: string[] = []

      const reader = (async () => {
        while (!stop) {
          try {
            const raw = readFileSync(file, 'utf8')
            JSON.parse(raw)
          } catch (error) {
            badReads.push(String(error))
          }
          await new Promise(resolve => setImmediate(resolve))
        }
      })()

      for (let revision = 1; revision <= writes; revision += 1) {
        writeFileAtomicSync(file, JSON.stringify({ revision, pad: 'x'.repeat(4_096) }))
      }
      stop = true
      await reader

      assert.deepEqual(badReads, [], 'a reader saw a torn document')
      const last = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(last.revision, writes)
      assert.deepEqual(readdirSync(dir), ['state.json'], 'tmp files were left behind')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('overwriting an existing file keeps the previous content visible until the swap', () => {
    const dir = freshDir()
    try {
      const file = join(dir, 'state.json')
      writeFileAtomicSync(file, '{"revision":1}')
      assert.ok(existsSync(file))
      writeFileAtomicSync(file, '{"revision":2}')
      assert.equal(readFileSync(file, 'utf8'), '{"revision":2}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})