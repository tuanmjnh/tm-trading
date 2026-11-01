import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// =============================================================================
//  Service-control authorization (security finding S1).
//
//  `requireOwnerId()` proves *identity*; it does not prove *privilege*. Before
//  this guard existed, any authenticated user could POST run-once/reprobe and
//  spawn a detached Node process on the server with the server's environment
//  (docs/web-app/v4.2-operations-control-audit.md). These endpoints must now
//  require root, and must check identity before privilege so an anonymous
//  caller gets 401 rather than a misleading 403.
//
//  Nitro endpoints are not unit-importable without the Nuxt runtime, so this
//  suite asserts the guard on the route source, the same way the evidence
//  export suite pins its endpoint contract.
// =============================================================================

const CONTROL_ENDPOINTS = [
  'server/api/v1/admin/services/run-once.post.ts',
  'server/api/v1/admin/health/services/reprobe.post.ts',
]

describe('operations control API', () => {
  test('the command endpoint is root-only and answers 202, not a fake success', () => {
    const source = readFileSync(
      new URL('../server/api/v1/operations/services/[serviceId]/[action].post.ts', import.meta.url),
      'utf8',
    )
    assert.match(source, /requireRootEvent\(event\)/, 'mutating a service is privileged')
    assert.match(source, /setResponseStatus\(event, 202\)/, 'acceptance is 202, not 200 success')
    assert.match(source, /enqueueServiceCommand\(/, 'the API enqueues a command; it never runs the supervisor')
    assert.doesNotMatch(source, /from 'node:child_process'/, 'the API must not spawn processes')
    assert.doesNotMatch(source, /store\.put|createSupervisorStore/, 'the API must not write service state')
  })

  test('the legacy run-once endpoint enqueues real operations, never a detached spawn', () => {
    const source = readFileSync(
      new URL('../server/api/v1/admin/services/run-once.post.ts', import.meta.url),
      'utf8',
    )
    assert.doesNotMatch(source, /node:child_process|spawn\(/, 'no detached process (finding S2)')
    assert.doesNotMatch(source, /unref\(\)/, 'nothing is detached and forgotten')
    assert.match(source, /enqueueServiceCommand\(/, 'it enqueues supervisor operations')
    assert.match(source, /action: 'run-once'/, 'a real run-once operation')
    assert.match(source, /setResponseStatus\(event, 202\)/, 'acceptance is 202, not a fake success')
    assert.match(source, /requireRootEvent\(event\)/, 'starts background work, so root-only')
    assert.doesNotMatch(source, /success: true, message:/, 'no unobserved success message (finding S1)')
    const response = source.slice(source.indexOf('setResponseStatus(event, 202)'))
    assert.match(response, /batchKey/, 'the response describes the batch it accepted')
    assert.doesNotMatch(response, /ownerId/, 'the response no longer leaks the owner (finding S6)')
  })

  test('the operation status endpoint is read-only and authenticated', () => {
    const source = readFileSync(
      new URL('../server/api/v1/operations/operations/[operationId].get.ts', import.meta.url),
      'utf8',
    )
    assert.match(source, /requireOwnerId\(event\)/)
    assert.doesNotMatch(source, /requireRootEvent/, 'polling your own operation is not privileged')
    assert.match(source, /loadServiceOperation\(operationId\)/)
  })
})

describe('service-control endpoints require root', () => {
  for (const file of CONTROL_ENDPOINTS) {
    test(`${file} enforces privilege, not just identity`, () => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

      assert.match(source, /requireRootEvent\(event\)/, `${file} must call requireRootEvent(event)`)
      assert.match(source, /requireOwnerId\(event\)/, `${file} must still resolve the owner`)
      assert.match(
        source,
        /from '~~\/server\/utils\/authz'/,
        `${file} must import the guard from the shared authz module`,
      )

      const identity = source.indexOf('requireOwnerId(event)')
      const privilege = source.indexOf('requireRootEvent(event)')
      assert.ok(identity >= 0 && privilege >= 0)
      assert.ok(
        identity < privilege,
        `${file} must authenticate first, then authorize (401 before 403)`,
      )
    })
  }
})
