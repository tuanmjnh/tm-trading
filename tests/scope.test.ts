import { describe, test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

type Row = { scope: string; app_id: string | null }

function fakeSupabase(rows: Row[], error: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({ data: rows, error }),
        }),
      }),
    }),
  }
}

let currentRows: Row[] = [{ scope: 'app', app_id: null }]
let currentError: { message: string } | null = null

mock.module('#server/modules/database/supabase', {
  namedExports: {
    getSupabaseAdmin: () => fakeSupabase(currentRows, currentError),
  },
})

// Nitro auto-import createError - shim equivalent to H3Error (statusCode/statusMessage) for test environment
;(globalThis as any).createError = (opts: any) => {
  const err: any = new Error(opts.message || opts.statusMessage)
  err.statusCode = opts.statusCode
  err.statusMessage = opts.statusMessage
  return err
}

const { getCapabilityScope, invalidateScopeCache, isOwnScoped, scopeRank, assertScope, ownScopeFilter } = await import('#server/utils/scope')

const payload = { sub: 'user-1', appId: 'app-1' }

beforeEach(() => {
  currentRows = [{ scope: 'app', app_id: null }]
  currentError = null
  invalidateScopeCache()
})

describe('isOwnScoped / scopeRank', () => {
  test('own/team is own-scope, app/global is not', () => {
    assert.equal(isOwnScoped('own'), true)
    assert.equal(isOwnScoped('team'), true)
    assert.equal(isOwnScoped('app'), false)
    assert.equal(isOwnScoped('global'), false)
  })

  test('rank increases own < team < app < global', () => {
    assert.ok(scopeRank('own') < scopeRank('team'))
    assert.ok(scopeRank('team') < scopeRank('app'))
    assert.ok(scopeRank('app') < scopeRank('global'))
    assert.equal(scopeRank('app'), 2)
  })
})

describe('getCapabilityScope', () => {
  test('read scope from permissions catalog', async () => {
    currentRows = [{ scope: 'own', app_id: null }]
    assert.equal(await getCapabilityScope('app-1', 'users.update'), 'own')
  })

  test('prioritize exact app row over global row', async () => {
    currentRows = [
      { scope: 'app', app_id: 'other-app' },
      { scope: 'own', app_id: 'app-1' },
    ]
    assert.equal(await getCapabilityScope('app-1', 'users.update'), 'own')
  })

  test('invalid scope -> default app', async () => {
    currentRows = [{ scope: 'weird', app_id: null }]
    assert.equal(await getCapabilityScope('app-1', 'users.update'), 'app')
  })

  test('DB error → fail-open app', async () => {
    currentError = { message: 'boom' }
    assert.equal(await getCapabilityScope('app-1', 'users.update'), 'app')
  })

  test('missing row -> default app', async () => {
    currentRows = []
    assert.equal(await getCapabilityScope('app-1', 'users.update'), 'app')
  })

  test('cache 60s: invalidateScopeCache forces re-read', async () => {
    currentRows = [{ scope: 'app', app_id: null }]
    assert.equal(await getCapabilityScope('app-1', 'cache.check'), 'app')
    currentRows = [{ scope: 'own', app_id: null }]
    assert.equal(await getCapabilityScope('app-1', 'cache.check'), 'app') // still cached
    invalidateScopeCache()
    assert.equal(await getCapabilityScope('app-1', 'cache.check'), 'own')
  })
})

describe('assertScope', () => {
  test('root (*) bypass - no owner needed', async () => {
    await assertScope({ ...payload, permissions: ['*'] }, 'users.update', { appId: 'app-1', resourceOwnerId: 'someone-else' })
  })

  test('scope own + matching resource owner -> pass', async () => {
    currentRows = [{ scope: 'own', app_id: null }]
    await assertScope(payload, 'users.update', { appId: 'app-1', resourceOwnerId: 'user-1' })
  })

  test('scope own + wrong resource owner -> 403 error.insufficientScope', async () => {
    currentRows = [{ scope: 'own', app_id: null }]
    await assert.rejects(
      () => assertScope(payload, 'users.update', { appId: 'app-1', resourceOwnerId: 'user-2' }),
      (err: any) => err.statusCode === 403 && err.statusMessage === 'error.insufficientScope'
    )
  })

  test('scope own + missing resourceOwnerId -> 403 (cannot prove ownership)', async () => {
    currentRows = [{ scope: 'own', app_id: null }]
    await assert.rejects(
      () => assertScope(payload, 'users.update', { appId: 'app-1' }),
      (err: any) => err.statusCode === 403
    )
  })

  test('scope app -> pass regardless of owner', async () => {
    currentRows = [{ scope: 'app', app_id: null }]
    await assertScope(payload, 'users.read', { appId: 'app-1', resourceOwnerId: 'someone-else' })
  })

  test('team treated as own', async () => {
    currentRows = [{ scope: 'team', app_id: null }]
    await assert.rejects(
      () => assertScope(payload, 'users.update', { appId: 'app-1', resourceOwnerId: 'user-2' }),
      (err: any) => err.statusCode === 403
    )
  })
})

describe('ownScopeFilter', () => {
  test('scope own -> enforce filter = payload.sub', async () => {
    currentRows = [{ scope: 'own', app_id: null }]
    assert.equal(await ownScopeFilter(payload, 'users.read', { appId: 'app-1' }), 'user-1')
  })

  test('scope team -> enforce filter = payload.sub', async () => {
    currentRows = [{ scope: 'team', app_id: null }]
    assert.equal(await ownScopeFilter(payload, 'users.read', { appId: 'app-1' }), 'user-1')
  })

  test('scope app -> no filter', async () => {
    currentRows = [{ scope: 'app', app_id: null }]
    assert.equal(await ownScopeFilter(payload, 'users.read', { appId: 'app-1' }), undefined)
  })

  test('root (*) -> no filter even when scope own', async () => {
    currentRows = [{ scope: 'own', app_id: null }]
    assert.equal(await ownScopeFilter({ ...payload, permissions: ['*'] }, 'users.read', { appId: 'app-1' }), undefined)
  })
})
