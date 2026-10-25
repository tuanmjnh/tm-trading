import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// AES-256-GCM at rest for provider secrets. The key is derived from
// AI_CREDENTIAL_KEY; there is deliberately no plaintext fallback. Losing the key
// makes stored secrets unreadable, which is the correct failure mode.
const PREFIX = 'enc1'

export function credentialKey(env = process.env) {
  const material = String(env.AI_CREDENTIAL_KEY ?? '').trim()
  if (!material) {
    const err = new Error('AI_CREDENTIAL_KEY is not set; refusing to store provider secrets')
    err.code = 'ai.no-credential-key'
    throw err
  }
  return createHash('sha256').update(material).digest()
}

export function encryptSecret(plain, env = process.env) {
  const text = String(plain ?? '')
  if (!text) return null
  const key = credentialKey(env)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.')
}

export function decryptSecret(blob, env = process.env) {
  if (!blob) return ''
  const parts = String(blob).split('.')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    const err = new Error('unsupported credential envelope')
    err.code = 'ai.bad-credential-envelope'
    throw err
  }
  const key = credentialKey(env)
  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  const data = Buffer.from(parts[3], 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
