import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_ADAPTER_TYPES,
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_SCHEMA_VERSION,
  PROVIDER_KEYS,
  budgetAllows,
  budgetStatus,
  capabilitiesFor,
  connectionHealth,
  fallbackCompatible,
  maskSecret,
  normalizeConnection,
  providerDefinition,
  rankCandidates,
  redactConnection,
  secretFingerprint,
  supports
} from '../engine/aiProviders.mjs'
import { decryptSecret, encryptSecret } from '../engine/aiProviderCrypto.mjs'

// =============================================================================
//  Phase G / D35 — app-owned AI providers (pure).
//
//  These tests lock the decisions that must not drift: the catalog knows every
//  adapter the gateway implements, secrets never survive redaction, fallback is
//  only within the same wire protocol, and a connection that was never tested is
//  not reported as healthy.
// =============================================================================

const ENV = { AI_CREDENTIAL_KEY: 'test-key-material' }

describe('catalog', () => {
  test('declares the required providers and only implemented adapters', () => {
    for (const key of ['openai', 'openrouter', 'anthropic', 'ollama', 'freellmapi', 'opencode', 'custom_openai']) {
      assert.ok(PROVIDER_KEYS.includes(key), key)
    }
    assert.equal(new Set(PROVIDER_KEYS).size, PROVIDER_KEYS.length)
    for (const p of AI_PROVIDER_CATALOG) {
      assert.ok(AI_ADAPTER_TYPES.includes(p.adapter), `${p.key}:${p.adapter}`)
      assert.equal(typeof p.capabilities.chat, 'boolean')
    }
    assert.equal(providerDefinition('OPENROUTER')?.key, 'openrouter')
    assert.equal(providerDefinition('nope'), null)
  })

  test('capabilities are copied, not shared references', () => {
    const caps = capabilitiesFor('openai')
    caps.chat = false
    assert.equal(capabilitiesFor('openai').chat, true)
    assert.equal(supports('openai', ['chat', 'structured']), true)
    assert.equal(supports('deepseek', ['tools']), false)
    assert.equal(supports('missing', ['chat']), false)
  })
})

describe('normalizeConnection', () => {
  test('accepts a default OpenAI connection and strips trailing slashes', () => {
    const r = normalizeConnection({ provider: 'openai', apiKey: 'sk-test-123456789', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1///' })
    assert.equal(r.ok, true)
    assert.equal(r.connection.adapter, 'openai_compatible')
    assert.equal(r.connection.baseUrl, 'https://api.openai.com/v1')
    assert.equal(r.connection.apiKey, 'sk-test-123456789')
    assert.equal(r.connection.privacy, 'vendor')
  })

  test('rejects unknown providers without echoing the secret', () => {
    const r = normalizeConnection({ provider: 'not-a-provider', apiKey: 'sk-secret-value', model: 'x' })
    assert.equal(r.ok, false)
    assert.match(r.errors.join(' '), /unknown provider/)
    assert.equal(JSON.stringify(r).includes('sk-secret-value'), false)
  })

  test('requires an explicit base URL for deployments', () => {
    const missing = normalizeConnection({ provider: 'freellmapi', apiKey: 'k'.repeat(20), model: 'x' })
    assert.equal(missing.ok, false)
    assert.ok(missing.errors.some((e) => e.includes('baseUrl')))
    const ok = normalizeConnection({ provider: 'freellmapi', apiKey: 'k'.repeat(20), model: 'x', baseUrl: 'https://free.example/v1' })
    assert.equal(ok.ok, true)
    assert.equal(ok.connection.baseUrl, 'https://free.example/v1')
  })

  test('keyless Ollama needs no key; keyed providers do', () => {
    assert.equal(normalizeConnection({ provider: 'ollama', model: 'llama3.2' }).ok, true)
    const r = normalizeConnection({ provider: 'openrouter', model: 'openai/gpt-4o-mini' })
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('apiKey')))
  })

  test('rejects non-http base URLs and empty models', () => {
    const r = normalizeConnection({ provider: 'custom_openai', apiKey: 'k'.repeat(20), model: '', baseUrl: 'file:///etc/passwd' })
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('http')))
    assert.ok(r.errors.some((e) => e.includes('model')))
  })

  test('rejects credentials or keys embedded in the base URL', () => {
    const creds = normalizeConnection({ provider: 'custom_openai', apiKey: 'k'.repeat(20), model: 'x', baseUrl: 'https://user:pass@example.com/v1' })
    assert.equal(creds.ok, false)
    assert.ok(creds.errors.some((e) => e.includes('credentials')))
    const query = normalizeConnection({ provider: 'custom_openai', apiKey: 'k'.repeat(20), model: 'x', baseUrl: 'https://example.com/v1?api_key=leak' })
    assert.equal(query.ok, false)
    assert.ok(query.errors.some((e) => e.includes('API key')))
  })
})

describe('secrets', () => {
  test('mask keeps only a head/tail hint', () => {
    assert.equal(maskSecret('sk-1234567890abcdef'), 'sk-…cdef')
    assert.equal(maskSecret('short'), '••••')
    assert.equal(maskSecret(''), '')
  })

  test('fingerprint is stable, non-reversible, and distinct', () => {
    const a = secretFingerprint('sk-aaaaaaaaaaaa')
    assert.equal(a, secretFingerprint('sk-aaaaaaaaaaaa'))
    assert.notEqual(a, secretFingerprint('sk-bbbbbbbbbbbb'))
    assert.match(a, /^afp1_[a-f0-9]{16}$/)
    assert.equal(secretFingerprint(''), null)
    assert.equal(JSON.stringify(a).includes('sk-aaaaaaaaaaaa'), false)
  })

  test('redaction removes apiKey, ciphertext, and envelope fields', () => {
    const red = redactConnection({
      id: 'openai:default',
      provider: 'openai',
      adapter: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-do-not-leak',
      secretEnc: 'enc1.a.b.c',
      secretMask: 'sk-…leak',
      secretFingerprint: 'afp1_1234567890abcdef',
    })
    const text = JSON.stringify(red)
    assert.equal(text.includes('sk-do-not-leak'), false)
    assert.equal(text.includes('enc1.'), false)
    assert.equal(red.hasSecret, true)
    assert.equal(red.secretMask, 'sk-…leak')
    assert.equal(red.schemaVersion, AI_PROVIDER_SCHEMA_VERSION)
  })

  test('AES-GCM roundtrip; wrong key and missing key fail closed', () => {
    const blob = encryptSecret('sk-roundtrip-123', ENV)
    assert.match(blob, /^enc1\./)
    assert.equal(decryptSecret(blob, ENV), 'sk-roundtrip-123')
    assert.throws(() => decryptSecret(blob, { AI_CREDENTIAL_KEY: 'other' }))
    assert.throws(() => encryptSecret('x', {}), (e) => e.code === 'ai.no-credential-key')
    assert.throws(() => decryptSecret('plain-text', ENV), (e) => e.code === 'ai.bad-credential-envelope')
    assert.equal(encryptSecret('', ENV), null)
    assert.equal(decryptSecret(null, ENV), '')
  })
})

describe('fallback policy', () => {
  const openai = { id: 'a', provider: 'openai', adapter: 'openai_compatible', enabled: true }
  const openrouter = { id: 'b', provider: 'openrouter', adapter: 'openai_compatible', enabled: true }
  const anthropic = { id: 'c', provider: 'anthropic', adapter: 'anthropic', enabled: true }

  test('same protocol + capabilities is compatible; cross-protocol is not', () => {
    assert.equal(fallbackCompatible(openai, openrouter), true)
    assert.equal(fallbackCompatible(openai, anthropic), false)
    assert.equal(fallbackCompatible(openai, { ...openrouter, enabled: false }), false)
    assert.equal(fallbackCompatible(openai, { ...openrouter, provider: 'deepseek' }, ['chat', 'tools']), false)
  })

  test('ranking dedupes and keeps order', () => {
    const out = rankCandidates(openai, [openrouter, { ...openrouter }, anthropic])
    assert.deepEqual(out.map((c) => c.id), ['a', 'b'])
  })
})

describe('budget and health projections', () => {
  test('budget states cover unbounded, near, exhausted', () => {
    assert.equal(budgetStatus({}, {}).state, 'unbounded')
    assert.equal(budgetStatus({ limitTokens: 100 }, { usedTokens: 50 }).state, 'ok')
    assert.equal(budgetStatus({ limitTokens: 100 }, { usedTokens: 85 }).state, 'near')
    assert.equal(budgetStatus({ limitUsd: 10 }, { usedUsd: 12 }).state, 'exhausted')
    assert.equal(budgetAllows(budgetStatus({ limitUsd: 10 }, { usedUsd: 12 })), false)
    assert.equal(budgetAllows(budgetStatus({}, {})), true)
  })

  test('never-tested and unconfigured are not ok', () => {
    assert.equal(connectionHealth({ enabled: true, hasSecret: true }), 'untested')
    assert.equal(connectionHealth({ enabled: true, hasSecret: true, lastTestedAt: 1 }), 'ok')
    assert.equal(connectionHealth({ enabled: true, hasSecret: false }), 'unconfigured')
    assert.equal(connectionHealth({ enabled: false, hasSecret: true }), 'disabled')
    assert.equal(connectionHealth({ enabled: true, hasSecret: true, lastError: 'bad key' }), 'error')
  })
})
