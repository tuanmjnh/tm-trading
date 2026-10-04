import { z } from 'zod'

export interface DeviceLimitConfig {
  enabled: boolean
  default: number
  perType: {
    web: number
    mobile: number
    tablet: number
    desktop: number
    tv: number
    wearable: number
    cli: number
    other: number
  }
}

export interface PasskeyConfig {
  enabled: boolean
  mode: '2fa' | 'passwordless' | 'multi-factor'
  requireUserVerification: 'required' | 'preferred' | 'discouraged'
  rpName: string
  timeout: number
  attestation: 'none' | 'indirect' | 'direct'
  authenticatorAttachment: 'platform' | 'cross-platform'
  residentKey: 'required' | 'preferred' | 'discouraged'
}

export interface OAuthProviderConfig {
  enabled: boolean
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  scope?: string[]
  tenant?: string
}

export interface OAuthConfig {
  enabled: boolean
  providers: {
    google: OAuthProviderConfig
    github: OAuthProviderConfig
    microsoft: OAuthProviderConfig
  }
  autoCreateUser: boolean
  allowedDomains: string[]
  requireEmailVerified: boolean
}

export interface EmailAddress {
  email: string
  name?: string
}

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
  pool?: boolean
  maxConnections?: number
  maxMessages?: number
}

export interface MailProviderConfig {
  apiKey?: string
  accessToken?: string
  refreshToken?: string
  fromEmail?: string
  fromName?: string
  domain?: string
  baseUrl?: string
  region?: string
  configurationSet?: string
  messageStream?: string
}

export interface MailConfig {
  provider: 'smtp' | 'gmail' | 'sendgrid' | 'mailgun' | 'ses' | 'postmark' | 'resend' | 'brevo'
  enabled: boolean
  defaultFrom: EmailAddress
  replyTo?: EmailAddress
  smtp?: SmtpConfig
  gmail?: MailProviderConfig
  sendgrid?: MailProviderConfig
  mailgun?: MailProviderConfig
  ses?: MailProviderConfig
  postmark?: MailProviderConfig
  resend?: MailProviderConfig
  brevo?: MailProviderConfig
  dkim?: {
    domain: string
    selector: string
    privateKey: string
  }
  tracking?: {
    open: boolean
    click: boolean
    unsubscribe: boolean
  }
  rateLimit?: {
    maxPerMinute: number
    maxPerHour: number
  }
}

export interface AppFeatureFlags {
  auth: {
    password: boolean
    passkey: boolean
    oauth: boolean
    totp: boolean
    register: boolean
    emailVerification: boolean
    passwordReset: boolean
    deviceLimits: boolean
  }
  mail: {
    enabled: boolean
    provider: boolean
  }
  notifications: {
    push: boolean
    email: boolean
    inApp: boolean
  }
  media: {
    enabled: boolean
    provider: boolean
  }
  import: {
    enabled: boolean
    maxRows: number
  }
  api: {
    rateLimit: boolean
    cors: boolean
  }
}

export interface AppConfigBase {
  appId: string
  category: string
  key: string
  value: unknown
  isSecret: boolean
  isPublic: boolean
  description?: string
  updatedAt?: string
}

export const deviceLimitConfigSchema = z.object({
  enabled: z.boolean().default(true),
  default: z.number().int().min(1).max(100).default(5),
  perType: z.object({
    web: z.number().int().min(0).max(100).default(3),
    mobile: z.number().int().min(0).max(100).default(2),
    tablet: z.number().int().min(0).max(100).default(1),
    desktop: z.number().int().min(0).max(100).default(2),
    tv: z.number().int().min(0).max(100).default(1),
    wearable: z.number().int().min(0).max(100).default(1),
    cli: z.number().int().min(0).max(100).default(10),
    other: z.number().int().min(0).max(100).default(1),
  }).default({
    web: 3, mobile: 2, tablet: 1, desktop: 2, tv: 1, wearable: 1, cli: 10, other: 1
  }),
}).strict()

export const passkeyConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['2fa', 'passwordless', 'multi-factor']).default('2fa'),
  requireUserVerification: z.enum(['required', 'preferred', 'discouraged']).default('required'),
  rpName: z.string().min(1).max(100).default('TM Hub'),
  timeout: z.number().int().min(1000).max(300000).default(60000),
  attestation: z.enum(['none', 'indirect', 'direct']).default('none'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).default('platform'),
  residentKey: z.enum(['required', 'preferred', 'discouraged']).default('preferred'),
}).strict()

export const oauthProviderConfigSchema = z.object({
  enabled: z.boolean().default(false),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  redirectUri: z.string().url().optional(),
  scope: z.array(z.string()).optional(),
}).strict()

export const oauthConfigSchema = z.object({
  enabled: z.boolean().default(false),
  providers: z.object({
    google: oauthProviderConfigSchema.default({ enabled: false }),
    github: oauthProviderConfigSchema.default({ enabled: false }),
    microsoft: oauthProviderConfigSchema.default({ enabled: false }),
  }).default({
    google: { enabled: false }, github: { enabled: false }, microsoft: { enabled: false }
  }),
  autoCreateUser: z.boolean().default(true),
  allowedDomains: z.array(z.string()).default([]),
  requireEmailVerified: z.boolean().default(true),
}).strict()

export const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  auth: z.object({
    user: z.string().min(1),
    pass: z.string().min(1),
  }),
  pool: z.boolean().optional(),
  maxConnections: z.number().int().min(1).optional(),
  maxMessages: z.number().int().min(1).optional(),
}).strict()

export const mailProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  fromEmail: z.string().email().optional(),
  fromName: z.string().optional(),
  domain: z.string().optional(),
  baseUrl: z.string().url().optional(),
  region: z.string().optional(),
  configurationSet: z.string().optional(),
  messageStream: z.string().optional(),
}).strict()

export const mailConfigSchema = z.object({
  provider: z.enum(['smtp', 'gmail', 'sendgrid', 'mailgun', 'ses', 'postmark', 'resend', 'brevo']).default('smtp'),
  enabled: z.boolean().default(false),
  defaultFrom: z.object({
    email: z.string().email(),
    name: z.string().min(1).optional(),
  }),
  replyTo: z.object({
    email: z.string().email(),
    name: z.string().min(1).optional(),
  }).optional(),
  smtp: smtpConfigSchema.optional(),
  gmail: mailProviderConfigSchema.optional(),
  sendgrid: mailProviderConfigSchema.optional(),
  mailgun: mailProviderConfigSchema.optional(),
  ses: mailProviderConfigSchema.optional(),
  postmark: mailProviderConfigSchema.optional(),
  resend: mailProviderConfigSchema.optional(),
  brevo: mailProviderConfigSchema.optional(),
  dkim: z.object({
    domain: z.string().min(1),
    selector: z.string().min(1),
    privateKey: z.string().min(1),
  }).optional(),
  tracking: z.object({
    open: z.boolean().default(true),
    click: z.boolean().default(true),
    unsubscribe: z.boolean().default(true),
  }).optional(),
  rateLimit: z.object({
    maxPerMinute: z.number().int().min(1).default(60),
    maxPerHour: z.number().int().min(1).default(1000),
  }).optional(),
}).strict()

export const appFeatureFlagsSchema = z.object({
  auth: z.object({
    password: z.boolean().default(true),
    passkey: z.boolean().default(true),
    oauth: z.boolean().default(false),
    totp: z.boolean().default(true),
    register: z.boolean().default(true),
    emailVerification: z.boolean().default(true),
    passwordReset: z.boolean().default(true),
    deviceLimits: z.boolean().default(true),
  }).default({
    password: true, passkey: true, oauth: false, totp: true, register: true, emailVerification: true, passwordReset: true, deviceLimits: true
  }),
  mail: z.object({
    enabled: z.boolean().default(false),
    provider: z.boolean().default(false),
  }).default({ enabled: false, provider: false }),
  notifications: z.object({
    push: z.boolean().default(true),
    email: z.boolean().default(true),
    inApp: z.boolean().default(true),
  }).default({ push: true, email: true, inApp: true }),
  media: z.object({
    enabled: z.boolean().default(true),
    provider: z.boolean().default(false),
  }).default({ enabled: true, provider: false }),
  import: z.object({
    enabled: z.boolean().default(true),
    maxRows: z.number().int().min(1).max(100000).default(10000),
  }).default({ enabled: true, maxRows: 10000 }),
  api: z.object({
    rateLimit: z.boolean().default(true),
    cors: z.boolean().default(true),
  }).default({ rateLimit: true, cors: true }),
}).strict()

export const appConfigBaseSchema = z.object({
  appId: z.string().min(1),
  category: z.string().default('general'),
  key: z.string().min(1).max(100),
  value: z.unknown(),
  isSecret: z.boolean().default(false),
  isPublic: z.boolean().default(false),
  description: z.string().optional(),
}).strict()

export const AppConfigSchema = z.discriminatedUnion('category', [
  z.object({ category: z.literal('auth.device_limits') }).merge(deviceLimitConfigSchema),
  z.object({ category: z.literal('auth.passkey') }).merge(passkeyConfigSchema),
  z.object({ category: z.literal('auth.oauth') }).merge(oauthConfigSchema),
  z.object({ category: z.literal('auth.totp') }).merge(z.object({ enabled: z.boolean().default(true) }).strict()),
  z.object({ category: z.literal('auth.password') }).merge(z.object({
    minLength: z.number().int().min(1).max(128).default(6),
    requireSpecialChar: z.boolean().default(false),
    maxAgeDays: z.number().int().min(1).max(3650).default(90),
  }).strict()),
  z.object({ category: z.literal('auth.session') }).merge(z.object({
    accessTokenTtl: z.number().int().min(60).max(86400).default(900),
    refreshTokenTtl: z.number().int().min(3600).max(2592000).default(604800),
    maxDevices: z.number().int().min(1).max(100).default(5),
  }).strict()),
  z.object({ category: z.literal('mail') }).merge(mailConfigSchema),
  z.object({ category: z.literal('features') }).merge(appFeatureFlagsSchema),
  appConfigBaseSchema,
])

export type AppConfigInput = z.infer<typeof AppConfigSchema>
export type DeviceLimitConfigInput = z.infer<typeof deviceLimitConfigSchema>
export type PasskeyConfigInput = z.infer<typeof passkeyConfigSchema>
export type OAuthConfigInput = z.infer<typeof oauthConfigSchema>
export type MailConfigInput = z.infer<typeof mailConfigSchema>
export type AppFeatureFlagsInput = z.infer<typeof appFeatureFlagsSchema>