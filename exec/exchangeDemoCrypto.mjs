import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function credentialKey(env = process.env) {
  const key = String(env.EXCHANGE_DEMO_CREDENTIAL_KEY ?? '').trim()
  if (key.length < 32) throw Object.assign(new Error('EXCHANGE_DEMO_CREDENTIAL_KEY must be at least 32 characters'), { code: 'exchange.credential-key-missing' })
  return createHash('sha256').update(key).digest()
}

export function encryptDemoCredentials(value, env = process.env) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', credentialKey(env), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['exd1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptDemoCredentials(envelope, env = process.env) {
  const [version, ivText, tagText, encryptedText, ...rest] = String(envelope ?? '').split('.')
  if (version !== 'exd1' || !ivText || !tagText || !encryptedText || rest.length) throw Object.assign(new Error('Invalid exchange credential envelope'), { code: 'exchange.bad-envelope' })
  const decipher = createDecipheriv('aes-256-gcm', credentialKey(env), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8'))
}

export function maskDemoKey(key) {
  const value = String(key ?? '')
  return value.length <= 8 ? '********' : `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`
}

export function fingerprintDemoKey(key) {
  return createHash('sha256').update(String(key ?? '')).digest('hex').slice(0, 16)
}
