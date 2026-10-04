export const SYSTEM_APP_ID = process.env.HUB_APP_ID || ''

export const APP_TYPES = {
  SYSTEM: 'system',
  APPLICATION: 'application',
  SERVICE: 'service'
} as const

export type AppType = typeof APP_TYPES[keyof typeof APP_TYPES]