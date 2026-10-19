import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildParityReport, REPORT_PATH, extractFeatures, parityRow } from '../scripts/pine-parity.mjs'

// =============================================================================
//  Pine compatibility report (roadmap §61.17 Phase D — D6).
//
//  The compatibility report is the ledger that decides the runtime/port strategy
//  for the `.pine` scripts. It must:
//    1. match a fresh scan of pine/dist (regenerate the doc when scripts change)
//    2. classify every ta.* primitive actually used by a script (no silent
//       "unknown" — an unclassified primitive is a review gap, not a pass)
//    3. be a pure function of the coverage verdicts (the decision text follows
//       the matrix, so they can never drift apart)
//    4. never execute a .pine file (scripts are data)
// =============================================================================

describe('pine compatibility report', () => {
  test('matches the committed report (regenerate with npm run pine:parity)', () => {
    const { markdown } = buildParityReport()
    const committed = readFileSync(REPORT_PATH, 'utf8')
    assert.equal(committed, markdown, 'pine-compatibility.md is stale — run npm run pine:parity')
  })

  test('every row has a feature set and a verdict', () => {
    const { rows } = buildParityReport()
    assert.ok(rows.length >= 9, `expected >= 9 scripts, got ${rows.length}`)
    for (const r of rows) {
      assert.ok(Array.isArray(r.features.ta), `${r.file}: features.ta must be an array`)
      assert.equal(typeof r.covered, 'boolean', `${r.file}: covered must be a boolean`)
      assert.equal(r.covered, r.gaps.length === 0 && r.unknown.length === 0,
        `${r.file}: covered must equal (no gaps AND no unknown)`)
    }
  })

  test('classifies every ta.* primitive actually used (no unknowns)', () => {
    const { rows } = buildParityReport()
    const allUnknown = [...new Set(rows.flatMap((r) => r.unknown))]
    assert.deepEqual(allUnknown, [], `unclassified ta.* primitives: ${allUnknown.join(', ')}`)
  })

  test('the decision text follows the matrix', () => {
    const { rows, markdown } = buildParityReport()
    const covered = rows.filter((r) => r.covered).length
    const gapSet = [...new Set(rows.flatMap((r) => r.gaps))]
if (gapSet.length === 0) {
      assert.match(markdown, /All \d+ scripts are covered by the native engine/)
    } else {
      // Line-agnostic: the decision is a pure function of the matrix, so check
      // the phrases that must follow the verdicts (never the exact wrapping).
      assert.match(markdown, /keep Pine as the reference \/ parity source; do NOT add a Pine[\s\S]*?runtime/)
      assert.match(markdown, /port the missing primitive\(s\) into `engine\/ta.mjs` first/)
      assert.match(markdown, new RegExp(`the ${rows.length - covered} script\\(s\\) that are not yet covered natively`))
      // The decision block must name every gap — wrapping may split the list.
      const decision = markdown.slice(markdown.indexOf('## Runtime / port decision'))
      for (const g of gapSet) assert.ok(decision.includes(g), `decision block must name gap: ${g}`)
    }
  })

  test('extractFeatures is honest about MTF/UDT/matrix/array/varip/library', () => {
    const src =
      '//@version=6\n' +
      'type Foo\n  bar int\n' +
      'm = matrix.new<float>(3, 3)\n' +
      'a = array.new<float>(3)\n' +
      'varip int x = 0\n' +
      'import "lib" as L\n' +
      'request.security("BTCUSDT", "60", close)\n' +
      'ta.dmi(14)\n'
    const f = extractFeatures(src)
    assert.deepEqual(f.ta, ['dmi'])
    assert.equal(f.mtf, true)
    assert.equal(f.udt, true)
    assert.equal(f.matrix, true)
    assert.equal(f.arrays, true)
    assert.equal(f.varip, true)
    assert.equal(f.library, true)
  })

  test('parityRow flags MISSING primitives as gaps', () => {
    const r = parityRow('X.pine', 'indicator', 'deadbeef', '//@version=6\nta.dmi(14)\nta.stoch(14, 70, 30)\n')
    assert.deepEqual(r.gaps, ['dmi', 'stoch'])
    assert.equal(r.covered, false)
  })
})

describe('pine scripts are data, never executed', () => {
  test('the parity generator does not import a .pine file', () => {
    const src = readFileSync(new URL('../scripts/pine-parity.mjs', import.meta.url), 'utf8')
    assert.doesNotMatch(src, /import\s+['"][^'"]+\.pine['"]/)
    assert.doesNotMatch(src, /require\(\s*['"][^'"]+\.pine['"]/)
    assert.match(src, /readFileSync/)
  })
})