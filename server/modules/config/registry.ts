import type {
  DeviceLimitConfig,
  PasskeyConfig,
  OAuthConfig,
  MailConfig,
  AppFeatureFlags,
} from '#server/types/app-config'

export interface ConfigRegistryEntry<T = unknown> {
  category: string
  key: string
  defaultValue: T
  description: string
  isSecret: boolean
  isPublic: boolean
  validator?: (value: unknown) => value is T
}

export const configRegistry: ConfigRegistryEntry[] = [
  {
    category: 'auth.device_limits',
    key: 'auth.device_limits',
    defaultValue: {
      enabled: true,
      default: 5,
      perType: {
        web: 3,
        mobile: 2,
        tablet: 1,
        desktop: 2,
        tv: 1,
        wearable: 1,
        cli: 10,
        other: 1,
      },
    } satisfies DeviceLimitConfig,
    description: 'Device limit configuration per device type',
    isSecret: false,
    isPublic: false,
  },
  {
    category: 'auth.passkey',
    key: 'auth.passkey',
    defaultValue: {
      enabled: true,
      mode: '2fa',
      requireUserVerification: 'required',
      rpName: 'TM Hub',
      timeout: 60000,
      attestation: 'none',
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
    } satisfies PasskeyConfig,
    description: 'Passkey/WebAuthn authentication configuration',
    isSecret: false,
    isPublic: false,
  },
  {
    category: 'auth.oauth',
    key: 'auth.oauth',
    defaultValue: {
      enabled: false,
      providers: {
        google: { enabled: false },
        github: { enabled: false },
        microsoft: { enabled: false },
      },
      autoCreateUser: true,
      allowedDomains: [],
      requireEmailVerified: true,
    } satisfies OAuthConfig,
    description: 'OAuth providers configuration',
    isSecret: false,
    isPublic: false,
  },
  {
    category: 'auth.totp',
    key: 'auth.totp',
    defaultValue: { enabled: true },
    description: 'TOTP (Time-based One-Time Password) authentication',
    isSecret: false,
    isPublic: false,
  },
  {
    category: 'auth.password',
    key: 'auth.password',
    defaultValue: {
      minLength: 6,
      requireSpecialChar: false,
      maxAgeDays: 90,
    },
    description: 'Password policy configuration',
    isSecret: false,
    isPublic: false,
  },
  {
    category: 'auth.session',
    key: 'auth.session',
    defaultValue: {
      accessTokenTtl: 900,
      refreshTokenTtl: 604800,
      maxDevices: 5,
    },
    description: 'Session and token TTL configuration',
    isSecret: false,
    isPublic: false,
  },
  {
    category: 'mail',
    key: 'mail',
    defaultValue: {
      provider: 'smtp',
      enabled: false,
      defaultFrom: { email: 'noreply@tmhub.local', name: 'TM Hub' },
      replyTo: { email: 'noreply@tmhub.local', name: 'TM Hub' },
      rateLimit: { maxPerMinute: 60, maxPerHour: 1000 },
      tracking: { open: true, click: true, unsubscribe: true },
    } satisfies MailConfig,
    description: 'Mail/Email service configuration',
    isSecret: false,
    isPublic: false,
  },
  {
    category: 'features',
    key: 'features',
    defaultValue: {
      auth: {
        password: true,
        passkey: true,
        oauth: false,
        totp: true,
        register: true,
        emailVerification: true,
        passwordReset: true,
        deviceLimits: true,
      },
      mail: {
        enabled: false,
        provider: false,
      },
      notifications: {
        push: true,
        email: true,
        inApp: true,
      },
      media: {
        enabled: true,
        provider: false,
      },
      import: {
        enabled: true,
        maxRows: 10000,
      },
      api: {
        rateLimit: true,
        cors: true,
      },
    } satisfies AppFeatureFlags,
    description: 'Application feature flags',
    isSecret: false,
    isPublic: true,
  },
]

export function getRegistryEntry(category: string, key: string): ConfigRegistryEntry | undefined {
  return configRegistry.find(entry => entry.category === category && entry.key === key)
}

export function getRegistryEntriesByCategory(category: string): ConfigRegistryEntry[] {
  return configRegistry.filter(entry => entry.category === category)
}

export function getAllRegistryEntries(): ConfigRegistryEntry[] {
  return configRegistry
}

export function getDefaultConfig<T = unknown>(category: string, key: string): T | undefined {
  const entry = getRegistryEntry(category, key)
  return entry?.defaultValue as T | undefined
}

export function getCategoryFromKey(key: string): string {
  if (key.startsWith('auth.')) {
    return `auth.${key.split('.')[1]}`
  }
  if (key === 'mail' || key.startsWith('mail.') || key.startsWith('MAIL_')) return 'mail'
  if (key === 'features') return 'features'
  return 'general'
}