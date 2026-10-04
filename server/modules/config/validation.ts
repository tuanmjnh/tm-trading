import { z } from 'zod'
import {
  deviceLimitConfigSchema,
  passkeyConfigSchema,
  oauthConfigSchema,
  mailConfigSchema,
  appFeatureFlagsSchema,
  appConfigBaseSchema,
  AppConfigSchema,
  type DeviceLimitConfigInput,
  type PasskeyConfigInput,
  type OAuthConfigInput,
  type MailConfigInput,
  type AppFeatureFlagsInput,
  type AppConfigInput,
} from '#server/types/app-config'

export const categorySchemas: Record<string, z.ZodSchema> = {
  'auth.device_limits': deviceLimitConfigSchema,
  'auth.passkey': passkeyConfigSchema,
  'auth.oauth': oauthConfigSchema,
  'auth.totp': z.object({ enabled: z.boolean().default(true) }).strict(),
  'auth.password': z.object({
    minLength: z.number().int().min(1).max(128).default(6),
    requireSpecialChar: z.boolean().default(false),
    maxAgeDays: z.number().int().min(1).max(3650).default(90),
  }).strict(),
  'auth.session': z.object({
    accessTokenTtl: z.number().int().min(60).max(86400).default(900),
    refreshTokenTtl: z.number().int().min(3600).max(2592000).default(604800),
    maxDevices: z.number().int().min(1).max(100).default(5),
  }).strict(),
  'mail': mailConfigSchema,
  'features': appFeatureFlagsSchema,
}

export function validateConfigValue(category: string, value: unknown): { success: boolean; data?: unknown; error?: z.ZodError } {
  const schema = categorySchemas[category]
  if (!schema) {
    return { success: true, data: value }
  }
  
  const result = schema.safeParse(value)
  if (result.success) {
    return { success: true, data: result.data }
  }
  
  return { success: false, error: result.error }
}

export function validateAppConfigInput(input: AppConfigInput): { success: boolean; data?: AppConfigInput; error?: z.ZodError } {
  const result = AppConfigSchema.safeParse(input)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

export function getSchemaForCategory(category: string): z.ZodSchema | undefined {
  return categorySchemas[category]
}

export function isKnownCategory(category: string): boolean {
  return category in categorySchemas
}

export type {
  DeviceLimitConfigInput,
  PasskeyConfigInput,
  OAuthConfigInput,
  MailConfigInput,
  AppFeatureFlagsInput,
  AppConfigInput,
}