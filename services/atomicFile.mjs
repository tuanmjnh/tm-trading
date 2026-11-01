// =============================================================================
//  TM TRADING — ATOMIC FILE WRITE (V4.2 §17.5–§17.7)
//
//  Both the supervisor state file and the command inbox are written with
//  tmp + rename so a reader never observes a half-written JSON document. On
//  win32 that rename is not reliably atomic in practice: if another process
//  holds the destination open for reading (the Operations API polls the state
//  file every couple of seconds), `renameSync()` intermittently fails with
//  EPERM/EBUSY/EACCES instead of replacing the file.
//
//  A single EPERM used to escape `save()` and crash the supervisor daemon —
//  observed by the drill harness, not theorised. The reader was not doing
//  anything wrong and neither was the writer, so the correct fix is a bounded
//  retry: the competing handle is short-lived, and a few hundred milliseconds
//  of patience turns a crash into a millisecond of latency.
//
//  The retry is synchronous on purpose. `save()` runs inside a synchronous tick
//  where the state object must be on disk before the caller acknowledges it, so
//  an async sleep would require making every store mutation async for no gain.
// =============================================================================

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Delay before each rename attempt (ms). The first attempt is immediate; the
 * rest total ~390 ms, which is far longer than any healthy read and far shorter
 * than a tick.
 */
export const ATOMIC_RENAME_DELAYS_MS = Object.freeze([0, 5, 10, 25, 50, 100, 200])

/** Windows error codes that mean "a handle is briefly in the way", not "broken". */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Block the current thread for `ms` without a timer.
 *
 * `Atomics.wait` on a throwaway SharedArrayBuffer is the only synchronous sleep
 * available in Node without spawning a process. It is never called for more
 * than the sum of `ATOMIC_RENAME_DELAYS_MS`.
 *
 * @param {number} ms
 */
function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Write `contents` to `file` atomically, retrying a contended rename.
 *
 * The tmp file name is unique per attempt, so two writers in the same process
 * cannot overwrite each other's partial document. If every attempt fails the
 * tmp file is removed and a descriptive error is thrown: silently dropping a
 * write would lose operator intent.
 *
 * `options` exists so a test can drive the retry loop with a rename that fails
 * on demand. The OS primitive is the only unreliable part of this function, and
 * a race that only appears under a real Windows reader handle is exactly the
 * kind of bug that otherwise ships untested.
 *
 * @param {string} file
 * @param {string} contents
 * @param {{
 *   rename?: (from: string, to: string) => void,
 *   delays?: ReadonlyArray<number>,
 *   sleep?: (ms: number) => void,
 * }} [options]
 * @returns {string} `file`
 */
export function writeFileAtomicSync(file, contents, options = {}) {
  const rename = options.rename ?? renameSync
  const delays = options.delays ?? ATOMIC_RENAME_DELAYS_MS
  const sleep = options.sleep ?? sleepSync
  if (delays.length === 0) throw new Error('writeFileAtomicSync: delays must not be empty')

  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tmp, contents)

  let lastError = null
  for (const delayMs of delays) {
    sleep(delayMs)
    try {
      rename(tmp, file)
      return file
    } catch (error) {
      lastError = error
      if (!RETRYABLE_RENAME_CODES.has(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? '')) {
        rmSync(tmp, { force: true })
        throw error
      }
    }
  }

  rmSync(tmp, { force: true })
  const detail = lastError
    ? `${/** @type {NodeJS.ErrnoException} */ (lastError).code ?? 'UNKNOWN'}: ${lastError.message}`
    : 'unknown error'
  throw new Error(
    `writeFileAtomicSync: could not replace ${file} after ${delays.length} attempts (${detail})`,
  )
}