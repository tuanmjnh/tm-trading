import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const SALT_LENGTH = 16
const TAG_LENGTH = 16
const ITERATIONS = 100000

function getMasterKey(): Buffer {
  const config = useRuntimeConfig()
  const masterKey = (config.configEncryptionKey as string) || process.env.CONFIG_ENCRYPTION_KEY
  
  if (!masterKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'error.encryptionKeyMissing',
      message: 'CONFIG_ENCRYPTION_KEY environment variable is required for secret encryption'
    })
  }
  
  return scryptSync(masterKey, 'tm-hub-salt', KEY_LENGTH)
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext

  const masterKey = getMasterKey()

  try {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, masterKey, iv)
    
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ])
    
    const authTag = cipher.getAuthTag()
    
    return [
      masterKey.toString('base64').slice(0, SALT_LENGTH),
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64')
    ].join(':')
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'error.encryptionFailed',
      message: 'Failed to encrypt secret value'
    })
  }
}

export function decryptSecret(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext
  
  try {
    const masterKey = getMasterKey()
    const parts = ciphertext.split(':')
    
    if (parts.length !== 4) {
      return ciphertext
    }
    
    const [, ivB64, authTagB64, encryptedB64] = parts as [string, string, string, string]
    
    const iv = Buffer.from(ivB64, 'base64')
    const authTag = Buffer.from(authTagB64, 'base64')
    const encrypted = Buffer.from(encryptedB64, 'base64')
    
    const decipher = createDecipheriv(ALGORITHM, masterKey, iv)
    decipher.setAuthTag(authTag)
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ])
    
    return decrypted.toString('utf8')
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'error.decryptionFailed',
      message: 'Failed to decrypt secret value'
    })
  }
}

export function isEncrypted(value: string): boolean {
  return value.includes(':') && value.split(':').length === 4
}

export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '********'
  return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4)
}

export function decryptConfigValue(value: string, isSecret: boolean): string {
  if (!isSecret) return value
  return decryptSecret(value)
}

export function encryptConfigValue(value: string, isSecret: boolean): string {
  if (!isSecret) return value
  return encryptSecret(value)
}