// Env-key standard (v2): no SYSTEM_APP_ID here. tm-trading is a satellite — it
// never stores or needs tm-hub's own id; the hub `apps` table is authoritative.

export const APP_TYPES = {
  SYSTEM: 'system',
  APPLICATION: 'application',
  SERVICE: 'service'
} as const

export type AppType = typeof APP_TYPES[keyof typeof APP_TYPES]