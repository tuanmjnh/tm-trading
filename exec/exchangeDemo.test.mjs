import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEMO_PROFILES, validateDemoProfile, signDemoRequest, placeDemoOrder, cancelDemoOrder, probeDemoConnection } from './exchangeDemo.mjs'
import { decryptDemoCredentials, encryptDemoCredentials, fingerprintDemoKey, maskDemoKey } from './exchangeDemoCrypto.mjs'

const env = { EXCHANGE_DEMO_CREDENTIAL_KEY: 'unit-test-demo-key-material-32chars+' }
const credentials = { apiKey: 'demo-api-key-1234', apiSecret: 'demo-api-secret-5678', passphrase: 'demo-passphrase' }

test('demo profiles contain only fixed demo execution endpoints', () => {
  for (const [profile, config] of Object.entries(DEMO_PROFILES)) {
    assert.equal(validateDemoProfile(profile, config.baseUrl), config)
    const forbiddenHost = config.venue === 'bybit' ? 'api.bybit.com' : config.venue === 'binance' ? 'api.binance.com' : 'www.okx.com.evil.example'
    assert.throws(() => validateDemoProfile(profile, `https://${forbiddenHost}`), { code: 'exchange.demo-host-required' })
  }
  assert.equal(DEMO_PROFILES.bybit.baseUrl, 'https://api-demo.bybit.com')
  assert.equal(DEMO_PROFILES.binance.baseUrl, 'https://demo-api.binance.com')
  assert.equal(DEMO_PROFILES['binance-usdm'].baseUrl, 'https://demo-fapi.binance.com')
  assert.equal(validateDemoProfile('okx-us', 'https://us.okx.com').baseUrl, 'https://us.okx.com')
  assert.equal(validateDemoProfile('okx-eea', 'https://eea.okx.com').baseUrl, 'https://eea.okx.com')
  assert.equal(DEMO_PROFILES.binance.capabilities.order, 'unknown')
  assert.equal(DEMO_PROFILES.bybit.capabilities.privateStream, 'unknown')
})

test('credential envelope encrypts at rest, authenticates tampering, and is redacted', () => {
  const plain = { apiKey: credentials.apiKey, apiSecret: credentials.apiSecret }
  const envelope = encryptDemoCredentials(plain, env)
  assert.ok(!envelope.includes(credentials.apiKey))
  assert.deepEqual(decryptDemoCredentials(envelope, env), plain)
  // Deterministic tamper: flip the FIRST ciphertext char (base64url char 0 always
  // maps to significant high bits of byte 0), so GCM authentication must fail.
  // (The old "replace last char with 'A'" was flaky: a trailing base64url char can
  // decode to identical bytes, so ~1/6 runs did not actually change the payload.)
  const seg = envelope.split('.')
  seg[3] = (seg[3][0] === 'A' ? 'B' : 'A') + seg[3].slice(1)
  assert.throws(() => decryptDemoCredentials(seg.join('.'), env))
  assert.throws(() => encryptDemoCredentials(plain, {}), { code: 'exchange.credential-key-missing' })
  assert.equal(maskDemoKey(credentials.apiKey), 'demo*********1234')
  assert.equal(fingerprintDemoKey(credentials.apiKey).length, 16)
})

test('signatures bind requests to fixed demo hosts and protocol-specific auth', () => {
  const bybit = signDemoRequest('bybit', credentials, { method: 'POST', path: '/v5/order/create', body: { category: 'linear' } }, { now: 1700000000000 })
  assert.equal(new URL(bybit.url).origin, DEMO_PROFILES.bybit.baseUrl)
  assert.match(bybit.headers['X-BAPI-SIGN'], /^[a-f0-9]{64}$/)
  const okx = signDemoRequest('okx', credentials, { method: 'POST', path: '/api/v5/trade/order', body: { instId: 'BTC-USDT-SWAP' } }, { now: 1700000000000 })
  assert.equal(okx.headers['x-simulated-trading'], '1')
  assert.equal(new URL(okx.url).origin, DEMO_PROFILES.okx.baseUrl)
  const binance = signDemoRequest('binance-usdm', credentials, { method: 'GET', path: '/fapi/v3/account' }, { now: 1700000000000 })
  assert.equal(new URL(binance.url).origin, DEMO_PROFILES['binance-usdm'].baseUrl)
  assert.ok(new URL(binance.url).searchParams.get('signature'))
  assert.throws(() => signDemoRequest('bybit', credentials, { method: 'POST', path: 'https://api.bybit.com/v5/order/create' }), { code: 'exchange.invalid-path' })
})

test('read-only credential probe uses fixed account endpoint and redacted credentials', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return { ok: true, json: async () => ({ retCode: 0, result: { list: [] } }) }
  }
  const health = await probeDemoConnection('bybit', credentials, { fetchImpl, now: () => 1700000000000 })
  assert.equal(health.status, 'up')
  assert.equal(new URL(calls[0].url).origin, DEMO_PROFILES.bybit.baseUrl)
  assert.equal(new URL(calls[0].url).pathname, '/v5/account/wallet-balance')
  assert.equal(new URL(calls[0].url).searchParams.get('accountType'), 'UNIFIED')
  assert.ok(calls[0].init.headers['X-BAPI-API-KEY'])
  assert.equal(JSON.stringify(health).includes(credentials.apiKey), false)
  await assert.rejects(probeDemoConnection('binance', credentials, { fetchImpl: async () => ({ ok: true, json: async () => null }), now: () => 1700000000000 }), { code: 'exchange.invalid-response' })
  await assert.rejects(probeDemoConnection('binance-usdm', credentials, { fetchImpl: async () => ({ ok: true, json: async () => ({ assets: [] }) }), now: () => 1700000000000 }), { code: 'exchange.invalid-account-response' })
})

test('place and cancel operations can only reach fixed demo origins', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return { ok: true, json: async () => ({ code: '0', orderId: 'demo-order-1' }) }
  }
  await placeDemoOrder('okx', credentials, { symbol: 'BTC-USDT-SWAP', side: 'BUY', qty: '0.01', clientOrderId: 'demo-order-1' }, { fetchImpl, now: () => 1700000000000 })
  await cancelDemoOrder('okx', credentials, { symbol: 'BTC-USDT-SWAP', clientOrderId: 'demo-order-1' }, { fetchImpl, now: () => 1700000000000 })
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => new URL(call.url).origin === DEMO_PROFILES.okx.baseUrl))
  assert.ok(calls.every(call => call.init.headers['x-simulated-trading'] === '1'))
  assert.equal(calls[0].init.body.includes('clOrdId'), true)
  assert.equal(calls[1].init.body.includes('clOrdId'), true)
  await assert.rejects(placeDemoOrder('bybit', credentials, { symbol: 'BTCUSDT', side: 'BUY', qty: 1 }), { code: 'exchange.invalid-order' })
})
