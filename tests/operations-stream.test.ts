import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  OPERATIONS_PING_MS,
  OPERATIONS_POLL_MS,
  operationsSignature,
  sseFrame,
} from '../server/utils/operationsStream'
import { parseOperationsSseFrame } from '../shared/utils/operationsStream'

// =============================================================================
//  Operations event stream (V4.2 §17.7).
//
//  The stream is the only push path, so the protocol must be exact and cheap:
//
//    1. a frame is newline-safe — a data field with an embedded newline must not
//       terminate the frame early;
//    2. the fingerprint changes only when something the screen renders changes,
//       so a 2 s poll does not spam identical snapshots;
//    3. the client decodes comments, ids and multi-line data per the SSE spec;
//    4. the endpoint is authenticated and the client uses fetch (EventSource
//       cannot carry the Authorization header this app requires).
// =============================================================================

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

function view(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'operations-view.v1',
    at: NOW,
    services: [
      {
        serviceId: 'news',
        observed: 'READY',
        health: 'HEALTHY',
        desired: 'RUNNING',
        drift: false,
        pid: 42,
        generation: 1,
        operationId: null,
        restartCount: 0,
        lastHeartbeatAt: NOW - 1000,
        lastSuccessAt: NOW - 2000,
        lastError: null,
        workload: { lastOutputCount: 5 },
      },
    ],
    operations: [{ operationId: 'op_1', state: 'RUNNING', phase: 'starting', error: null }],
    summary: { total: 1, ready: 1 },
    ...overrides,
  }
}

describe('sseFrame', () => {
  test('encodes an event with an id and a JSON payload', () => {
    const frame = sseFrame('snapshot', { a: 1 }, 123)
    assert.equal(frame, 'id: 123\nevent: snapshot\ndata: {"a":1}\n\n')
  })

  test('a payload with newlines never terminates the frame early', () => {
    const frame = sseFrame('snapshot', 'line-1\nline-2')
    assert.equal(frame, 'event: snapshot\ndata: line-1\ndata: line-2\n\n')
    const parsed = parseOperationsSseFrame(frame.trimEnd())
    assert.equal(parsed.data, 'line-1\nline-2')
  })

  test('a missing payload is still a valid frame', () => {
    assert.equal(sseFrame('ping'), 'event: ping\ndata: null\n\n')
  })
})

describe('operationsSignature', () => {
  test('is stable for identical views', () => {
    assert.equal(operationsSignature(view()), operationsSignature(view()))
  })

  test('changes when the observed state changes', () => {
    const before = operationsSignature(view())
    const after = operationsSignature(view({
      services: [{ ...view().services[0] as Record<string, unknown>, observed: 'FAILED', health: 'UNHEALTHY' }],
    }))
    assert.notEqual(before, after)
  })

  test('changes when an operation moves', () => {
    const before = operationsSignature(view())
    const after = operationsSignature(view({
      operations: [{ operationId: 'op_1', state: 'SUCCEEDED', phase: 'done', error: null }],
    }))
    assert.notEqual(before, after)
  })

  test('ignores fields the screen does not render', () => {
    const before = operationsSignature(view())
    const after = operationsSignature(view({ at: NOW + 5000, audit: [{ action: 'x' }] }))
    assert.equal(before, after, 'a new timestamp alone is not a change')
  })

  test('is resilient to an empty or broken view', () => {
    assert.equal(typeof operationsSignature(null), 'string')
    assert.equal(typeof operationsSignature({}), 'string')
  })
})

describe('parseOperationsSseFrame', () => {
  test('decodes event, id and data', () => {
    const parsed = parseOperationsSseFrame('id: 7\nevent: snapshot\ndata: {"a":1}')
    assert.deepEqual(parsed, { event: 'snapshot', data: '{"a":1}', id: '7' })
  })

  test('a comment line is a keepalive, not a message', () => {
    const parsed = parseOperationsSseFrame(`: ping ${NOW}`)
    assert.equal(parsed.event, 'message')
    assert.equal(parsed.data, '')
  })

  test('defaults the event name and strips one leading space of data', () => {
    assert.equal(parseOperationsSseFrame('data:  spaced').data, ' spaced')
    assert.equal(parseOperationsSseFrame('data:plain').data, 'plain')
  })
})

describe('stream wiring', () => {
  test('the endpoint streams text/event-stream and cleans up on disconnect', () => {
    const source = readFileSync(new URL('../server/api/v1/operations/events.get.ts', import.meta.url), 'utf8')
    assert.match(source, /requireOwnerId\(event\)/, 'the stream is authenticated')
    assert.match(source, /text\/event-stream/, 'declares the SSE content type')
    assert.match(source, /'X-Accel-Buffering': 'no'/, 'proxies must not buffer the stream')
    assert.match(source, /res\.on\('close', stop\)/, 'the poll timers are cleared on disconnect')
    assert.match(source, /sendStream\(event, stream\)/)
    assert.ok(OPERATIONS_POLL_MS > 0 && OPERATIONS_PING_MS > OPERATIONS_POLL_MS)
  })

  test('the client uses fetch, not EventSource, and backs off', () => {
    const source = readFileSync(new URL('../app/composables/useOperationsEvents.ts', import.meta.url), 'utf8')
    assert.match(source, /fetch\('\/api\/v1\/operations\/events'/, 'Bearer auth needs fetch, not EventSource')
    assert.doesNotMatch(source, /new EventSource\(/)
    assert.match(source, /Authorization: `Bearer \$\{token\}`/, 'sends the access token')
    assert.match(source, /MAX_BACKOFF_MS/, 'reconnect is bounded')
    assert.match(source, /parseOperationsSseFrame/, 'frames are decoded by the shared parser')
  })

  test('the panel polls only while the stream is down', () => {
    const panel = readFileSync(new URL('../app/components/operations/ServicesPanel.vue', import.meta.url), 'utf8')
    assert.match(panel, /useOperationsEvents\(/, 'subscribes to the stream')
    assert.match(panel, /if \(stream\.connected\.value\) return/, 'polling is a fallback')
  })
})
