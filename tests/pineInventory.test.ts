import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { buildPineInventory, parsePineSource, REPORT_PATH, ROOT } from '../scripts/pine-inventory.mjs'

// =============================================================================
//  Pine inventory (roadmap §61.17 Phase D).
//
//  (1) The committed report must match pine/dist exactly — a script added or
//      edited without regenerating the doc fails here.
//  (2) A .pine file is data: no source file may import/require it, so a script
//      can never be executed as unvalidated code.
// =============================================================================

const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', '.git', 'dist'])

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

describe('pine inventory report', () => {
  test('matches the current pine/dist contents', () => {
    const { markdown } = buildPineInventory()
    const committed = readFileSync(REPORT_PATH, 'utf8')
    assert.equal(committed, markdown, 'pine-inventory.md is stale — run npm run pine:inventory')
  })

  test('describes every built script', () => {
    const { rows } = buildPineInventory()
    assert.ok(rows.length >= 9, `expected >= 9 scripts, got ${rows.length}`)
    for (const r of rows) {
      assert.ok(['indicator', 'strategy'].includes(r.kind), `${r.file} kind=${r.kind}`)
      assert.match(r.pineVersion, /^\d+$/)
      assert.match(r.sha, /^[0-9a-f]{12}$/)
    }
    assert.ok(rows.some((r) => r.kind === 'strategy'))
    assert.ok(rows.some((r) => r.kind === 'indicator'))
  })

  test('parses a synthetic source', () => {
    const row = parsePineSource('X.pine', '//@version=6\nstrategy("My Strat", overlay=true)\nplot(close)\n')
    assert.equal(row.kind, 'strategy')
    assert.equal(row.title, 'My Strat')
    assert.equal(row.pineVersion, '6')
    assert.equal(row.plots, 1)
  })
})

describe('pine scripts are data, never executed', () => {
  test('no source file imports a .pine file', () => {
    const offenders = []
    const re = /\b(?:import|require)\s*\(?\s*['"][^'"]+\.pine['"]/
    for (const file of walk(ROOT)) {
      if (!/\.(mjs|cjs|js|ts|vue)$/.test(file)) continue
      if (file.startsWith(join(ROOT, 'pine'))) continue
      if (re.test(readFileSync(file, 'utf8'))) offenders.push(file.slice(ROOT.length + 1))
    }
    assert.deepEqual(offenders, [], `source must not import .pine: ${offenders.join(', ')}`)
  })
})
