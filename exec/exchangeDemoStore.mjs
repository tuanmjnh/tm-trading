import { ExchangeDemoConnection } from '../engine/models/exchangeDemoConnection.mjs'
import { DEMO_PROFILES, validateDemoProfile, probeDemoConnection } from './exchangeDemo.mjs'
import { decryptDemoCredentials, encryptDemoCredentials, fingerprintDemoKey, maskDemoKey } from './exchangeDemoCrypto.mjs'

function redacted(row) {
  return {
    id: String(row._id), profile: row.profile, venue: DEMO_PROFILES[row.profile]?.venue,
    enabled: row.enabled !== false, status: row.status, keyMask: row.keyMask,
    lastTestedAt: row.lastTestedAt, lastLatencyMs: row.lastLatencyMs,
    lastErrorCode: row.lastErrorCode, capabilities: DEMO_PROFILES[row.profile]?.capabilities,
  }
}

function validateCredentials(profile, value) {
  if (!DEMO_PROFILES[profile] || !value || typeof value !== 'object') throw Object.assign(new Error('Invalid demo profile or credentials'), { code: 'exchange.invalid-connection' })
  for (const field of ['apiKey', 'apiSecret']) if (typeof value[field] !== 'string' || value[field].trim().length < 8) throw Object.assign(new Error(`${field} is required`), { code: 'exchange.invalid-connection' })
  if (profile.startsWith('okx') && (typeof value.passphrase !== 'string' || value.passphrase.length < 1)) throw Object.assign(new Error('passphrase is required for OKX'), { code: 'exchange.invalid-connection' })
  return { apiKey: value.apiKey.trim(), apiSecret: value.apiSecret.trim(), ...(profile.startsWith('okx') ? { passphrase: value.passphrase } : {}) }
}

export async function listDemoConnections(ownerId) {
  const rows = await ExchangeDemoConnection.find({ ownerId }).sort({ profile: 1 }).lean()
  return rows.map(redacted)
}

export async function saveDemoConnection(ownerId, input, env = process.env) {
  const profile = String(input?.profile ?? '').trim().toLowerCase()
  const endpoint = typeof input?.endpoint === 'string' ? input.endpoint : DEMO_PROFILES[profile]?.baseUrl
  validateDemoProfile(profile, endpoint)
  const credentials = validateCredentials(profile, input?.credentials)
  const id = `${ownerId}:${profile}`
  const stored = await ExchangeDemoConnection.findOneAndUpdate({ _id: id, ownerId }, {
    $set: {
      profile,
      credentialsEnc: encryptDemoCredentials(credentials, env),
      keyMask: maskDemoKey(credentials.apiKey),
      keyFingerprint: fingerprintDemoKey(credentials.apiKey),
      enabled: input.enabled !== false,
      status: 'untested', lastTestedAt: null, lastLatencyMs: null, lastErrorCode: null,
    },
    $setOnInsert: { _id: id, ownerId },
  }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean()
  return redacted(stored)
}

export async function removeDemoConnection(ownerId, profile) {
  const normalized = String(profile ?? '').toLowerCase()
  if (!DEMO_PROFILES[normalized]) throw Object.assign(new Error('Unsupported demo exchange profile'), { code: 'exchange.invalid-profile' })
  const id = `${ownerId}:${normalized}`
  const res = await ExchangeDemoConnection.deleteOne({ _id: id, ownerId })
  return res.deletedCount === 1
}

export async function testDemoConnection(ownerId, profileId, options = {}) {
  const row = await ExchangeDemoConnection.findOne({ _id: `${ownerId}:${profileId}`, ownerId }).lean()
  if (!row) throw Object.assign(new Error('Demo exchange connection not found'), { code: 'exchange.connection-not-found' })
  const credentials = decryptDemoCredentials(row.credentialsEnc, options.env)
  try {
    const health = await probeDemoConnection(profileId, credentials, options)
    const updated = { ...row, status: 'up', lastLatencyMs: health.latencyMs, lastTestedAt: Date.now(), lastErrorCode: null }
    await ExchangeDemoConnection.updateOne({ _id: row._id, ownerId }, { $set: { status: updated.status, lastTestedAt: updated.lastTestedAt, lastLatencyMs: updated.lastLatencyMs, lastErrorCode: null } })
    return redacted(updated)
  } catch (error) {
    const code = String(error?.code ?? 'exchange.connection-error')
    await ExchangeDemoConnection.updateOne({ _id: row._id, ownerId }, { $set: { status: 'down', lastTestedAt: Date.now(), lastLatencyMs: null, lastErrorCode: code } })
    throw Object.assign(new Error('Demo exchange connectivity test failed'), { code })
  }
}

export async function resolveDemoCredentials(ownerId, profileId) {
  const row = await ExchangeDemoConnection.findOne({ _id: `${ownerId}:${profileId}`, ownerId, enabled: true }).lean()
  if (!row) throw Object.assign(new Error('Enabled demo exchange connection not found'), { code: 'exchange.connection-not-found' })
  return decryptDemoCredentials(row.credentialsEnc)
}
