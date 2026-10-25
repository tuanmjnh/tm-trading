import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, AuthenticatorTransport } from '@simplewebauthn/types'

export interface WebAuthnCredential {
  id: string
  userId: string
  appId: string
  credentialId: string
  publicKey: string
  counter: number
  transports: AuthenticatorTransport[]
  deviceName?: string
  aaguid?: string
  createdAt: string
  lastUsedAt?: string
}

export interface WebAuthnChallenge {
  challenge: string
  userId: string
  appId: string
  type: 'register' | 'login'
  expiresAt: number
}

export interface ServerRegisterStartResponse {
  challenge: string
  user: {
    id: string
    name: string
    displayName: string
  }
  rp: {
    id: string
    name: string
  }
  pubKeyCredParams: Array<{ type: 'public-key', alg: number }>
  timeout: number
  attestation: 'none' | 'indirect' | 'direct'
  authenticatorSelection: {
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey: 'required' | 'preferred' | 'discouraged'
    requireResidentKey?: boolean
    userVerification: 'required' | 'preferred' | 'discouraged'
  }
}

export interface RegisterFinishRequest {
  credential: PublicKeyCredentialCreationOptionsJSON
}

export interface ServerLoginStartResponse {
  challenge: string
  allowCredentials: Array<{
    id: string
    type: 'public-key'
    transports?: AuthenticatorTransport[]
  }>
  timeout: number
  userVerification: 'required' | 'preferred' | 'discouraged'
  rpId?: string
}

export interface LoginFinishRequest {
  credential: PublicKeyCredentialRequestOptionsJSON
}

export interface ServerPasskeyInfo {
  id: string
  /** WebAuthn credential id (base64url) - used for delete. */
  credentialId: string
  deviceName?: string
  transports: AuthenticatorTransport[]
  createdAt: string
  lastUsedAt?: string
}