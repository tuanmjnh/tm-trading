import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFeatureLayer } from '#server/utils/config'

type Row = { key: string; value: string }

describe('buildFeatureLayer', () => {
  test('blob features as baseline, leaf overrides (independent of row order)', () => {
    const rows: Row[] = [
      { key: 'mail.enabled', value: 'true' }, // leaf BEFORE blob must still win
      { key: 'features', value: JSON.stringify({ mail: { enabled: false, provider: false }, api: { cors: true } }) },
    ]
    const layer = buildFeatureLayer(rows)
    assert.equal((layer.mail as any).enabled, true)
    assert.equal((layer.mail as any).provider, false)
    assert.equal((layer.api as any).cors, true)
  })

  test('leaf after blob -> leaf wins', () => {
    const rows: Row[] = [
      { key: 'features', value: JSON.stringify({ mail: { enabled: false } }) },
      { key: 'mail.enabled', value: 'true' },
    ]
    const layer = buildFeatureLayer(rows)
    assert.equal((layer.mail as any).enabled, true)
  })

  test('blob mail → section mail', () => {
    const layer = buildFeatureLayer([{ key: 'mail', value: JSON.stringify({ provider: 'smtp', smtp: { host: 'h' } }) }])
    assert.equal((layer.mail as any).provider, 'smtp')
    assert.equal((layer.mail as any).smtp.host, 'h')
  })

  test('nested leaf path (auth.passkey.mode)', () => {
    const layer = buildFeatureLayer([{ key: 'auth.passkey.mode', value: '"required"' }])
    assert.equal((layer.auth as any).passkey.mode, 'required')
  })

  test('sections outside FEATURE_SECTIONS are ignored', () => {
    const layer = buildFeatureLayer([{ key: 'random.thing', value: '"x"' }])
    assert.equal(layer.random, undefined)
  })

  test('non-object blob is ignored', () => {
    const layer = buildFeatureLayer([{ key: 'features', value: 'not-json' }])
    assert.deepEqual(layer, {})
  })

  test('empty rows -> empty layer', () => {
    assert.deepEqual(buildFeatureLayer([]), {})
  })
})
