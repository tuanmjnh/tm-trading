import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { getCategoryFromKey, isSecretKey, normalizeIncomingValue } from '#server/modules/config/service'

describe('getCategoryFromKey', () => {
  test('mail variants → mail', () => {
    assert.equal(getCategoryFromKey('mail'), 'mail')
    assert.equal(getCategoryFromKey('mail.enabled'), 'mail')
    assert.equal(getCategoryFromKey('mail.smtp.host'), 'mail')
    assert.equal(getCategoryFromKey('MAIL_SMTP_HOST'), 'mail')
  })

  test('auth.* → auth.{section}', () => {
    assert.equal(getCategoryFromKey('auth.password.enabled'), 'auth.password')
    assert.equal(getCategoryFromKey('auth.passkey.mode'), 'auth.passkey')
  })

  test('features / general', () => {
    assert.equal(getCategoryFromKey('features'), 'features')
    assert.equal(getCategoryFromKey('APP_NAME'), 'general')
    assert.equal(getCategoryFromKey('brevo.api.key'), 'general')
  })
})

describe('isSecretKey', () => {
  test('secret-ish keys (case-insensitive)', () => {
    const secrets = ['apiKey', 'api_key', 'BREVO_API_KEY', 'brevoApiKey', 'smtp.password', 'mail.smtp.pass', 'accessToken', 'privateKey', 'MY_SECRET']
    for (const k of secrets) assert.equal(isSecretKey(k), true, k)
  })

  test('auth feature flags and plain keys are not secrets', () => {
    const nonSecrets = ['auth.password', 'auth.password.enabled', 'auth.passwordreset.enabled', 'mail.enabled', 'features', 'APP_NAME', 'import.maxRows']
    for (const k of nonSecrets) assert.equal(isSecretKey(k), false, k)
  })
})

describe('normalizeIncomingValue', () => {
  test('structured JSON strings are parsed', () => {
    assert.equal(normalizeIncomingValue('true'), true)
    assert.equal(normalizeIncomingValue('false'), false)
    assert.equal(normalizeIncomingValue('null'), null)
    assert.equal(normalizeIncomingValue('"smtp"'), 'smtp')
    assert.deepEqual(normalizeIncomingValue('{"a":1}'), { a: 1 })
    assert.deepEqual(normalizeIncomingValue('["x"]'), ['x'])
    assert.equal(normalizeIncomingValue('  true  '), true)
  })

  test('plain strings / numbers stay as-is (no double-encode)', () => {
    assert.equal(normalizeIncomingValue('hello'), 'hello')
    assert.equal(normalizeIncomingValue('12345'), '12345')
    assert.equal(normalizeIncomingValue('smtp.example.com'), 'smtp.example.com')
    assert.equal(normalizeIncomingValue(42), 42)
    assert.equal(normalizeIncomingValue(true), true)
    assert.deepEqual(normalizeIncomingValue({ a: 1 }), { a: 1 })
  })

  test('malformed structured string falls back to original', () => {
    assert.equal(normalizeIncomingValue('{oops'), '{oops')
    assert.equal(normalizeIncomingValue('"unterminated'), '"unterminated')
  })
})
