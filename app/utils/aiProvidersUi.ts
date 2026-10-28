import type { AiProviderCatalogModel, AiProviderConnectionRow } from '~/types/aiProviders'

// Health-test / discovery failures come back with a stable `code`; map it to a
// localized hint so the user never sees a raw "fetch failed" / "HTTP 500".
const PROVIDER_ERROR_KEYS: Record<string, string> = {
  'ai.no-key': 'errNoKey',
  'ai.invalid-key': 'errInvalidKey',
  'ai.rate-limited': 'errRateLimited',
  'ai.provider-unavailable': 'errProviderUnavailable',
  'ai.timeout': 'errTimeout',
  'ai.network': 'errNetwork',
  'ai.http-error': 'errHttp',
  'ai.relay-tools': 'errRelayTools',
  'hub_not_configured': 'hubNotConfigured',
  'ai.invalid-connection': 'errInvalidConnection'
}

export type Translate = (key: string) => string

export function aiProviderErrorText(t: Translate, code?: string | null, fallback?: string | null) {
  const suffix = code ? PROVIDER_ERROR_KEYS[code] : null
  if (suffix) return t(`settings.aiProviders.${suffix}`)
  return fallback || t('settings.aiProviders.error')
}

export function aiProviderIsHubRow(row: AiProviderConnectionRow) {
  return row.provider === 'hub'
}

export function aiProviderStatusColor(row: AiProviderConnectionRow) {
  if (!row.enabled) return 'neutral' as const
  if (row.status === 'ok') return 'success' as const
  if (row.status === 'error') return 'error' as const
  return 'warning' as const
}

export function aiProviderStatusLabel(t: Translate, row: AiProviderConnectionRow) {
  if (!row.enabled) return t('settings.aiProviders.disabled')
  if (row.status === 'ok') return t('settings.aiProviders.ok')
  if (row.status === 'error') return t('settings.aiProviders.error')
  return row.hasSecret || row.keyless ? t('settings.aiProviders.untested') : t('settings.aiProviders.unconfigured')
}

export function aiProviderFormatWhen(ts: number | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

export function aiProviderSourceBadge(t: Translate, m: AiProviderCatalogModel) {
  return m.source === 'manual'
    ? t('settings.aiProviders.sourceManual')
    : m.source === 'discovered'
      ? t('settings.aiProviders.sourceDiscovered')
      : m.source
}

