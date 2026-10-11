import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createHasLocalPage,
  flattenVisiblePaths,
  navAllows,
  selectNavRoutes,
  type NavNode
} from '../app/utils/navTree'

const node = (partial: Partial<NavNode> & { path: string }): NavNode => ({
  name: partial.name ?? partial.path.replace(/[/#]/g, '_'),
  isVisible: true,
  ...partial
})

const allLocal = () => true
const noneLocal = () => false

describe('createHasLocalPage', () => {
  const hasLocalPage = createHasLocalPage(new Set(['/', '/trade', '/runs']))

  test('matches registered paths', () => {
    assert.equal(hasLocalPage('/'), true)
    assert.equal(hasLocalPage('/trade'), true)
    assert.equal(hasLocalPage('/missing'), false)
  })

  test('normalises trailing slashes', () => {
    assert.equal(hasLocalPage('/trade/'), true)
    assert.equal(hasLocalPage(''), false)
  })

  test('treats group anchors and the wildcard specially', () => {
    assert.equal(hasLocalPage('#markets'), false)
    assert.equal(hasLocalPage('*'), true)
    assert.equal(hasLocalPage(null), false)
  })
})

describe('selectNavRoutes', () => {
  test('keeps visible leaves that resolve to a local page', () => {
    const tree = [node({ path: '/trade' }), node({ path: '/missing' })]
    const result = selectNavRoutes(tree, {
      hasLocalPage: (p) => p === '/trade'
    })
    assert.deepEqual(result.map(n => n.path), ['/trade'])
  })

  test('drops hidden (isVisible:false) nodes together with their subtree', () => {
    const tree = [
      node({ path: '#markets', children: [
        node({ path: '/intel' }),
        node({ path: '/scanner', isVisible: false, children: [node({ path: '/scanner/deep' })] })
      ] })
    ]
    const result = selectNavRoutes(tree, { hasLocalPage: allLocal })
    assert.deepEqual(result.map(n => n.path), ['#markets'])
    assert.deepEqual(result[0].children?.map(n => n.path), ['/intel'])
  })

  test('prunes a group when no descendant survives', () => {
    const tree = [
      node({ path: '#empty', children: [node({ path: '/a', isVisible: false })] })
    ]
    assert.deepEqual(selectNavRoutes(tree, { hasLocalPage: allLocal }), [])
  })

  test('keeps a group when at least one descendant survives', () => {
    const tree = [
      node({ path: '#group', children: [node({ path: '/a' }), node({ path: '/b' })] })
    ]
    const result = selectNavRoutes(tree, { hasLocalPage: (p) => p === '/a' })
    assert.equal(result.length, 1)
    assert.deepEqual(result[0].children?.map(n => n.path), ['/a'])
  })

  test('hiddenNames drops matching nodes by name', () => {
    const tree = [node({ path: '/system/settings', name: 'settings' }), node({ path: '/trade' })]
    const result = selectNavRoutes(tree, { hasLocalPage: allLocal, hiddenNames: new Set(['settings']) })
    assert.deepEqual(result.map(n => n.path), ['/trade'])
  })

  test('drops a top-level hidden group even when children are visible', () => {
    const tree = [node({ path: '#data', isVisible: false, children: [node({ path: '/data/datasets' })] })]
    assert.deepEqual(selectNavRoutes(tree, { hasLocalPage: allLocal }), [])
  })

  test('drops every leaf when nothing is local', () => {
    const tree = [node({ path: '/trade' }), node({ path: '#g', children: [node({ path: '/runs' })] })]
    assert.deepEqual(selectNavRoutes(tree, { hasLocalPage: noneLocal }), [])
  })
})

describe('flattenVisiblePaths', () => {
  test('flattens visible nodes and skips hidden subtrees', () => {
    const tree = [
      node({ path: '/' }),
      node({ path: '#markets', children: [node({ path: '/intel' }), node({ path: '/scanner', isVisible: false })] }),
      node({ path: '/hidden-group', isVisible: false, children: [node({ path: '/x' })] })
    ]
    assert.deepEqual(flattenVisiblePaths(tree), ['/', '#markets', '/intel'])
  })
})

describe('navAllows', () => {
  test('root only matches root', () => {
    assert.equal(navAllows('/', '/'), true)
    assert.equal(navAllows('/', '/trade'), false)
  })

  test('wildcard matches everything', () => {
    assert.equal(navAllows('*', '/anything'), true)
  })

  test('group anchors never match', () => {
    assert.equal(navAllows('#markets', '/markets'), false)
    assert.equal(navAllows('', '/'), false)
  })

  test('exact path match', () => {
    assert.equal(navAllows('/trade', '/trade'), true)
    assert.equal(navAllows('/trade', '/runs'), false)
  })

  test('param pattern of equal segment length', () => {
    assert.equal(navAllows('/runs/:id', '/runs/abc'), true)
    assert.equal(navAllows('/runs/:id', '/runs/abc/extra'), false)
  })

  test('prefix match for nested routes', () => {
    assert.equal(navAllows('/runs', '/runs/compare'), true)
    assert.equal(navAllows('/run', '/runs'), false)
  })

  test('normalises trailing slashes', () => {
    assert.equal(navAllows('/trade/', '/trade'), true)
  })
})
