import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupFlatPermissions,
  computeAccessibleRouteIds,
  isFullAccessRole,
  hasAllRoutes
} from '../shared/rbac'

type Entry = { id: string, requiredPermission: string | null }

// Fixture simulating seed system_routes (ARCHITECTURE §5 - requiredPermission declared explicitly).
const routes: Entry[] = [
  { id: 'home', requiredPermission: null },
  { id: 'groups', requiredPermission: null },
  { id: 'apps', requiredPermission: 'apps.read' },
  { id: 'apps.details', requiredPermission: 'apps.read' },
  { id: 'apps.create', requiredPermission: 'apps.create' },
  { id: 'apps.edit', requiredPermission: 'apps.update' },
  { id: 'configs', requiredPermission: 'configs.read' },
  { id: 'configs.write', requiredPermission: 'configs.write' },
  { id: 'media', requiredPermission: 'media.read' },
  { id: 'media.upload', requiredPermission: 'media.upload' },
  { id: 'notifications', requiredPermission: 'notifications.read' }
]

const perms = (entries: Array<[string, string[]]>) => entries.map(([module, actions]) => ({ module, actions }))
const accessible = (permissions: Array<{ module: string, actions: string[] }>) =>
  new Set(computeAccessibleRouteIds(routes, permissions))

describe('groupFlatPermissions', () => {
  test('group flat codes, split at FIRST dot (preserves nested action logs.read)', () => {
    assert.deepEqual(
      groupFlatPermissions(['apps.read', 'apps.logs.read', 'apps.read']),
      [{ module: 'apps', actions: ['read', 'logs.read'] }]
    )
  })

  test('skip empty codes / codes without dot', () => {
    assert.deepEqual(groupFlatPermissions(['', 'nodot', 'media.upload']), [
      { module: 'media', actions: ['upload'] }
    ])
  })
})

describe('Case 1 — role apps.read', () => {
  const access = accessible(perms([['apps', ['read']]]))
  test('/apps + /apps/details + public routes accessible', () => {
    assert.equal(access.has('apps'), true)
    assert.equal(access.has('apps.details'), true)
    assert.equal(access.has('home'), true)
    assert.equal(access.has('groups'), true)
  })
  test('/apps/create + /apps/edit inaccessible', () => {
    assert.equal(access.has('apps.create'), false)
    assert.equal(access.has('apps.edit'), false)
  })
})

describe('Case 2 — role apps.read + apps.create', () => {
  const access = accessible(perms([['apps', ['read', 'create']]]))
  test('/apps/create accessible, /apps/edit not accessible', () => {
    assert.equal(access.has('apps'), true)
    assert.equal(access.has('apps.create'), true)
    assert.equal(access.has('apps.edit'), false)
  })
})

describe('Case 3 — role apps.read + apps.update', () => {
  const access = accessible(perms([['apps', ['read', 'update']]]))
  test('/apps/edit accessible, /apps/create not accessible', () => {
    assert.equal(access.has('apps.edit'), true)
    assert.equal(access.has('apps.create'), false)
  })
})

describe('Case 4 — role media.read + media.upload', () => {
  const access = accessible(perms([['media', ['read', 'upload']]]))
  test('media routes accessible, other modules not accessible', () => {
    assert.equal(access.has('media'), true)
    assert.equal(access.has('media.upload'), true)
    assert.equal(access.has('apps'), false)
    assert.equal(access.has('configs'), false)
  })
})

describe('Case 5 - cross-module: apps.read + configs.read + media.read, missing notifications.read', () => {
  const access = accessible(perms([
    ['apps', ['read']],
    ['configs', ['read']],
    ['media', ['read']]
  ]))
  test('notifications route inaccessible -> UI hides notifications module', () => {
    assert.equal(access.has('apps'), true)
    assert.equal(access.has('configs'), true)
    assert.equal(access.has('media'), true)
    assert.equal(access.has('notifications'), false)
  })
})

describe('Full access (System Root) — Case 8', () => {
  const root = perms([['*', ['*']]])
  test('isFullAccessRole + compute → ["*"] + hasAllRoutes', () => {
    assert.equal(isFullAccessRole(root), true)
    assert.deepEqual(computeAccessibleRouteIds(routes, root), ['*'])
    assert.equal(hasAllRoutes(computeAccessibleRouteIds(routes, root)), true)
  })
  test('role with no permissions -> only public routes', () => {
    const empty = accessible([])
    assert.equal(empty.has('home'), true)
    assert.equal(empty.has('apps'), false)
    assert.equal(empty.has('apps.details'), false)
  })
})
