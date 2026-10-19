// =============================================================================
//  G8.3 acceptance — frozen evidence can leave the dashboard.
//
//  The point of the export is OFFLINE re-verification: the bundle must carry
//  enough facts to re-derive the stored hash after a JSON round-trip, and it
//  must not look tidier than the evidence it came from.
// =============================================================================

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freezeEvidenceSet, verifyEvidenceSet, evidenceHash } from '../engine/evidence.mjs'
import { buildEvidenceExport, evidenceExportFilename, EVIDENCE_EXPORT_SCHEMA } from '../server/utils/evidenceExport'

const T0 = 1_790_000_000_000
type Row = Record<string, any>

const frozenSet = (over: Row = {}) => freezeEvidenceSet({
  setId: 'ev_paper-session_ses_1',
  kind: 'paper-session',
  sourceId: 'ses_1',
  sessionId: 'ses_1',
  strategyVersionId: 'tm-vsa@1.4.0',
  instruments: ['BTCUSDT'],
  timeframes: ['4m'],
  manifest: { paramsHash: 'ph_1', engineVersion: '3.5.0', datasetIds: ['ds_btc_60'] },
  counts: { orders: 1, fills: 1, trades: 1 },
  keys: { orderKeys: ['c1'], fillKeys: ['f1'], journalKeys: ['j1'] },
  trades: [{ symbol: 'BTCUSDT', r: 1.4 }],
  metrics: { trades: 1, sufficient: false },
  dataQuality: { datasets: ['ds_btc_60'] },
  limitations: ['only 1/20 closed trade(s) had a measured R'],
  sealed: true,
  pointInTime: { frozenAt: T0 },
  ...over,
})

describe('G8.3: evidence-set export bundle', () => {
  test('the bundle carries the frozen facts, the hash contract and the verdicts', () => {
    const doc = frozenSet()
    const bundle = buildEvidenceExport(
      { ...doc, integrity: { ok: true, code: 'OK' }, sufficiency: { sufficient: false, reasons: ['floor'] } },
      { exportedAt: T0 + 1000, appId: 'tm-trading_8pmp33' }
    )
    assert.equal(bundle.schemaVersion, EVIDENCE_EXPORT_SCHEMA)
    assert.equal(bundle.exportedAt, new Date(T0 + 1000).toISOString())
    assert.equal(bundle.appId, 'tm-trading_8pmp33')
    assert.equal(bundle.setId, 'ev_paper-session_ses_1')
    assert.equal(bundle.hash, doc.hash)
    assert.equal(bundle.integrity.ok, true)
    assert.equal(bundle.sufficiency.sufficient, false)
    assert.equal(bundle.verification.compareWith, 'hash')
    assert.match(String(bundle.verification.implementation), /evidenceHash/)
  })

  test('the stored hash is re-derivable from the exported doc after a JSON round-trip', () => {
    const doc = frozenSet()
    const bundle = buildEvidenceExport({ ...doc, integrity: { ok: true } }, { exportedAt: T0 })
    const onDisk = JSON.parse(JSON.stringify(bundle)) as Row
    assert.equal(onDisk.frozen._id, undefined, 'the storage key is not evidence')
    assert.equal(onDisk.frozen.integrity, undefined, 'a per-request verdict must not ride inside the frozen facts')
    const verdict = verifyEvidenceSet(onDisk.frozen) as Row
    assert.equal(verdict.ok, true, 'an exported set must still verify offline')
    assert.equal(verdict.hash, doc.hash)
    assert.equal(evidenceHash(onDisk.frozen), doc.hash)
  })

  test('a tampered export fails verification — the export cannot launder an edit', () => {
    const doc = frozenSet()
    const bundle = buildEvidenceExport({ ...doc, integrity: { ok: true } }, { exportedAt: T0 })
    const edited = JSON.parse(JSON.stringify(bundle)) as Row
    edited.frozen.limitations = ['all good']
    assert.equal((verifyEvidenceSet(edited.frozen) as Row).code, 'SET_TAMPERED')
    // Even the free-text limitations are covered: a "nicer" limitation is a lie.
    assert.equal((verifyEvidenceSet({ ...doc, limitations: ['nicer'] }) as Row).ok, false)
  })

  test('the filename is filesystem-safe and stable per set', () => {
    assert.equal(evidenceExportFilename({ setId: 'ev_paper-session_ses_1' }), 'evidence-ev_paper-session_ses_1.json')
    assert.equal(evidenceExportFilename({ setId: 'a/b c:d' }), 'evidence-a_b_c_d.json')
    assert.equal(evidenceExportFilename({}), 'evidence-evidence.json')
  })

  test('the endpoint streams the bundle as an attachment and never caches the verdict', () => {
    const src = readFileSync(new URL('../server/api/v1/research/evidence-sets/[id]/export.get.ts', import.meta.url), 'utf8')
    assert.match(src, /buildEvidenceExport\(set/)
    assert.match(src, /Content-Disposition['"], `attachment; filename="\$\{evidenceExportFilename\(set\)\}"/)
    assert.match(src, /Cache-Control['"], 'no-store'/, 'a cached export could keep claiming "verified" after tampering')
    assert.match(src, /statusCode: 404/, 'a missing set is a 404, not an empty file')
  })

  test('the detail page exposes the export (i18n in both locales)', () => {
    const page = readFileSync(new URL('../app/pages/data-research/research/evidence/[id].vue', import.meta.url), 'utf8')
    assert.match(page, /const exportUrl = computed\(\(\) => `\/api\/v1\/research\/evidence-sets\/\$\{encodeURIComponent\(setId\.value\)\}\/export`\)/)
    assert.match(page, /t\('research\.sets\.detail\.exportBundle'\)/)
    for (const locale of ['en', 'vi']) {
      const dict = JSON.parse(readFileSync(new URL(`../i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
      assert.equal(typeof dict.research?.sets?.detail?.exportBundle, 'string', `${locale} is missing the export label`)
    }
  })
})
