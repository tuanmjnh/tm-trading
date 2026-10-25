import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshAccessToken, refreshAccessTokenSingleFlight } from '../server/utils/tokenRefresh'

// F9/U5 — the response shape and single-flight behaviour of the server-side
// self-heal. These lock the contract the auth middleware relies on: success only
// on a well-formed 2xx body, null on every other outcome, one hub call per token.

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const INPUT = { hubUrl: 'https://hub.example/', appId: 'app_1', refreshToken: 'rt_1' }

describe('refreshAccessToken', () => {
  test('exchanges a refresh token for fresh tokens', async () => {
    let seen: { url: string, init: RequestInit } | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return jsonRes(200, { success: true, data: { accessToken: 'at_2', refreshToken: 'rt_2', expiresIn: 900 } })
    }) as unknown as typeof fetch

    const out = await refreshAccessToken(INPUT, fetchImpl)

    assert.deepEqual(out, { accessToken: 'at_2', refreshToken: 'rt_2', expiresIn: 900 })
    assert.equal(seen!.url, 'https://hub.example/api/v1/auth/refresh')
    assert.equal(seen!.init.method, 'POST')
    assert.equal((seen!.init.headers as Record<string, string>)['X-App-Id'], 'app_1')
    assert.deepEqual(JSON.parse(String(seen!.init.body)), { refreshToken: 'rt_1', appId: 'app_1' })
  })

  test('returns null on non-2xx (401 / 429 / 500)', async () => {
    for (const status of [401, 429, 500]) {
      const out = await refreshAccessToken(INPUT, (async () => jsonRes(status, { success: false })) as unknown as typeof fetch)
      assert.equal(out, null, `status ${status}`)
    }
  })

  test('returns null on a malformed / unsuccessful body', async () => {
    const cases: unknown[] = [
      { success: false },
      { success: true, data: { accessToken: 'at' } },
      null,
    ]
    for (const body of cases) {
      const out = await refreshAccessToken(INPUT, (async () => jsonRes(200, body)) as unknown as typeof fetch)
      assert.equal(out, null)
    }
  })

  test('returns null on a network failure', async () => {
    const fetchImpl = (async () => { throw new Error('boom') }) as unknown as typeof fetch
    assert.equal(await refreshAccessToken(INPUT, fetchImpl), null)
  })

  test('returns null without full input', async () => {
    assert.equal(await refreshAccessToken({ ...INPUT, hubUrl: '' }), null)
    assert.equal(await refreshAccessToken({ ...INPUT, appId: '' }), null)
    assert.equal(await refreshAccessToken({ ...INPUT, refreshToken: '' }), null)
  })
})

describe('refreshAccessTokenSingleFlight', () => {
  test('shares one hub call across concurrent requests for the same token', async () => {
    let calls = 0
    let resolveGate: (v: unknown) => void = () => {}
    const gate = new Promise((resolve) => { resolveGate = resolve })
    const fetchImpl = (async () => {
      calls += 1
      await gate
      return jsonRes(200, { success: true, data: { accessToken: 'at', refreshToken: 'rt', expiresIn: 60 } })
    }) as unknown as typeof fetch

    const a = refreshAccessTokenSingleFlight(INPUT, fetchImpl)
    const b = refreshAccessTokenSingleFlight(INPUT, fetchImpl)
    resolveGate(undefined)
    const [ra, rb] = await Promise.all([a, b])

    assert.equal(calls, 1)
    assert.deepEqual(ra, rb)
  })

  test('uses a separate call per refresh token', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return jsonRes(200, { success: true, data: { accessToken: 'at', refreshToken: 'rt', expiresIn: 60 } })
    }) as unknown as typeof fetch

    await Promise.all([
      refreshAccessTokenSingleFlight({ ...INPUT, refreshToken: 'rt_a' }, fetchImpl),
      refreshAccessTokenSingleFlight({ ...INPUT, refreshToken: 'rt_b' }, fetchImpl),
    ])

    assert.equal(calls, 2)
  })

  test('a failed refresh clears the slot so a later attempt retries', async () => {
    let calls = 0
    const fetchImpl = (async () => { calls += 1; return jsonRes(500, {}) }) as unknown as typeof fetch

    assert.equal(await refreshAccessTokenSingleFlight({ ...INPUT, refreshToken: 'rt_retry' }, fetchImpl), null)
    assert.equal(await refreshAccessTokenSingleFlight({ ...INPUT, refreshToken: 'rt_retry' }, fetchImpl), null)
    assert.equal(calls, 2)
  })
})
