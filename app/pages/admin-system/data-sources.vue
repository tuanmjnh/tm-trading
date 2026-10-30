<script setup lang="ts">
import type { MarketSourceHealth, MarketSourceHealthResponse } from '#shared/types/health'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import { getErrorMessage } from '~/shared/utils/errors'

// Market Data Sources (roadmap §58 acceptance #6). Live per-venue probes of the
// market data providers (§30.1) — DISTINCT from tm-hub connection records
// (shared-resources/connections.vue). Never re-derives engine numbers (D12).
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'marketSources.title',
  descKey: 'marketSources.desc'
})
const health = useSystemHealth()
const notify = useNotify()

const sources = ref<MarketSourceHealth[]>([])
const meta = ref<MarketSourceHealthResponse['meta'] | null>(null)
const isLoading = ref(false)

type DemoProfile = 'bybit' | 'okx' | 'okx-us' | 'okx-eea' | 'binance' | 'binance-usdm'
interface DemoConnection {
  id: string
  profile: DemoProfile
  venue: string
  enabled: boolean
  status: 'untested' | 'up' | 'down'
  keyMask: string
  lastTestedAt: number | null
  lastLatencyMs: number | null
  lastErrorCode: string | null
  capabilities: { account: string, order: string, cancel: string, privateStream: string, markets: string[] }
}

const demoConnections = ref<DemoConnection[]>([])
const demoProfile = ref<DemoProfile>('bybit')
const demoApiKey = ref('')
const demoApiSecret = ref('')
const demoPassphrase = ref('')
const demoBusy = ref(false)
const demoLoading = ref(false)
const demoLoadFailed = ref(false)
const demoDeleteOpen = ref(false)
const demoPendingDelete = ref<DemoProfile | null>(null)
const demoProfileItems = computed(() => [
  { label: t('marketSources.demo.profiles.bybit'), value: 'bybit' },
  { label: t('marketSources.demo.profiles.okx'), value: 'okx' },
  { label: t('marketSources.demo.profiles.okxUs'), value: 'okx-us' },
  { label: t('marketSources.demo.profiles.okxEea'), value: 'okx-eea' },
  { label: t('marketSources.demo.profiles.binance'), value: 'binance' },
  { label: t('marketSources.demo.profiles.binanceUsdm'), value: 'binance-usdm' }
])

/** i18n suffix for a demo profile id (kebab-case ids map to camelCase keys). */
const profileLabelKey = (profile: DemoProfile): string =>
  ({ bybit: 'bybit', okx: 'okx', 'okx-us': 'okxUs', 'okx-eea': 'okxEea', binance: 'binance', 'binance-usdm': 'binanceUsdm' } as Record<DemoProfile, string>)[profile]
const profileLabel = (profile: DemoProfile) => t(`marketSources.demo.profiles.${profileLabelKey(profile)}`)

async function refreshDemoConnections() {
  demoLoading.value = true
  try {
    const res = await $fetch<{ success: boolean, data: DemoConnection[] }>('/api/v1/exchange-demo/connections')
    demoConnections.value = res.data ?? []
    demoLoadFailed.value = false
  } catch (error) {
    demoLoadFailed.value = true
    notify.error(getErrorMessage(error, key => t(key)))
  } finally {
    demoLoading.value = false
  }
}

async function saveDemoConnection() {
  demoBusy.value = true
  try {
    await $fetch('/api/v1/exchange-demo/connections', {
      method: 'POST',
      body: {
        profile: demoProfile.value,
        credentials: { apiKey: demoApiKey.value, apiSecret: demoApiSecret.value, ...(demoProfile.value.startsWith('okx') ? { passphrase: demoPassphrase.value } : {}) }
      }
    })
    demoApiKey.value = ''
    demoApiSecret.value = ''
    demoPassphrase.value = ''
    notify.success(t('marketSources.demo.saveSuccess'))
    await refreshDemoConnections()
  } catch (error) {
    notify.error(getErrorMessage(error, key => t(key)))
  } finally {
    demoBusy.value = false
  }
}

async function testDemoConnection(profile: DemoProfile) {
  demoBusy.value = true
  try {
    await $fetch(`/api/v1/exchange-demo/connections/${encodeURIComponent(profile)}/test`, { method: 'POST' })
    notify.success(t('marketSources.demo.testSuccess'))
  } catch (error) {
    notify.error(getErrorMessage(error, key => t(key)))
  } finally {
    await refreshDemoConnections()
    demoBusy.value = false
  }
}

function askDeleteDemoConnection(profile: DemoProfile) {
  demoPendingDelete.value = profile
  demoDeleteOpen.value = true
}

async function removeDemoConnection() {
  const profile = demoPendingDelete.value
  if (!profile) return
  demoBusy.value = true
  try {
    await $fetch(`/api/v1/exchange-demo/connections/${encodeURIComponent(profile)}`, { method: 'DELETE' })
    demoConnections.value = demoConnections.value.filter(connection => connection.profile !== profile)
    demoDeleteOpen.value = false
    demoPendingDelete.value = null
    await refreshDemoConnections()
  } catch (error) {
    notify.error(getErrorMessage(error, key => t(key)))
  } finally {
    demoBusy.value = false
  }
}

async function refresh() {
  isLoading.value = true
  try {
    const res = await health.marketSources()
    sources.value = res.data ?? []
    meta.value = res.meta ?? null
  } catch {
    sources.value = []
    meta.value = null
  } finally {
    isLoading.value = false
  }
}

// --- V3.9 venue preference & failover (§64.4/§64.5) --------------------------
type VenueId = 'bybit' | 'binance' | 'okx'
type CapLevel = 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN'
interface VenueProfileView {
  profileId: string
  label: string
  marketType: string
  region: string | null
  environment: string
  endpoints: { rest: string, privateWs: string, publicWs: string, publicIsMainnet: boolean }
  declaredCapabilities: Record<string, CapLevel>
  executionRequiredCaps: string[]
  executionReady: boolean
  executionGaps: Array<{ capability: string, level: CapLevel }>
  connection: { configured: boolean, enabled?: boolean, status?: string, keyMask?: string, lastTestedAt?: number | null, lastLatencyMs?: number | null, lastErrorCode?: string | null }
  health: { status: string, restAccount?: any, privateStream?: any, publicStream?: any, clockSkewMs?: number | null, rateLimit?: any, lastReconcileAt?: number | null }
  wsTradeSupported: boolean
  retentionDays: number | null
}
interface VenueGroup { venue: VenueId, profiles: VenueProfileView[] }
interface VenuePreferenceView {
  preferredVenue: VenueId
  executionEnvironment: 'DEMO'
  marketDataPolicy: 'PREFERRED_ONLY' | 'ALLOW_REFERENCE_FAILOVER'
  marketDataFallbackOrder: VenueId[]
  executionSwitchPolicy: 'MANUAL_NEW_SESSION_ONLY'
  pendingVenueSwitch: { targetVenue: VenueId, requestedAt: number, reason: string | null } | null
}

const venueGroups = ref<VenueGroup[]>([])
const venuesLoadFailed = ref(false)
const venuesLoading = ref(false)
const prefs = ref<VenuePreferenceView | null>(null)
const prefsLoadFailed = ref(false)
const prefVenue = ref<VenueId>('bybit')
const prefPolicy = ref<'PREFERRED_ONLY' | 'ALLOW_REFERENCE_FAILOVER'>('PREFERRED_ONLY')
const prefFallback = ref<VenueId[]>([])
const prefsBusy = ref(false)
const switchOpen = ref(false)
const switchTarget = ref<VenueId>('okx')
const switchReason = ref('')

const VENUE_LIST: VenueId[] = ['bybit', 'binance', 'okx']
const venueItems = computed(() => VENUE_LIST.map(v => ({ label: v.toUpperCase(), value: v })))
const policyItems = computed(() => [
  { label: t('marketSources.venuePrefs.policies.PREFERRED_ONLY'), value: 'PREFERRED_ONLY' },
  { label: t('marketSources.venuePrefs.policies.ALLOW_REFERENCE_FAILOVER'), value: 'ALLOW_REFERENCE_FAILOVER' }
])
const switchItems = computed(() => VENUE_LIST.filter(v => v !== prefVenue.value).map(v => ({ label: v.toUpperCase(), value: v })))

const capLevel = (level?: CapLevel) => t(`marketSources.venuePrefs.caps.${level ?? 'UNKNOWN'}`)
const venueStatusColor = (s: string) => s === 'READY' ? 'success' : s === 'DEGRADED' ? 'warning' : s === 'STALE' ? 'warning' : 'neutral'
const venueStatusLabel = (s: string) => t(`marketSources.venuePrefs.statusLabels.${s as 'READY'}`)

async function refreshVenues() {
  venuesLoading.value = true
  try {
    const res = await $fetch<{ success: boolean, data: { venues: VenueGroup[] } }>('/api/v1/exchange-demo/venues')
    venueGroups.value = res.data?.venues ?? []
    venuesLoadFailed.value = false
  } catch {
    venuesLoadFailed.value = true
  } finally {
    venuesLoading.value = false
  }
}

async function refreshPrefs() {
  try {
    const res = await $fetch<{ success: boolean, data: VenuePreferenceView }>('/api/v1/exchange-demo/venue-preference')
    prefs.value = res.data
    prefVenue.value = res.data.preferredVenue
    prefPolicy.value = res.data.marketDataPolicy
    prefFallback.value = [...(res.data.marketDataFallbackOrder ?? [])]
    prefsLoadFailed.value = false
  } catch {
    prefsLoadFailed.value = true
  }
}

function toggleFallback(v: VenueId) {
  const i = prefFallback.value.indexOf(v)
  if (i >= 0) prefFallback.value.splice(i, 1)
  else prefFallback.value.push(v)
  prefFallback.value = prefFallback.value.filter(x => x !== prefVenue.value)
}

async function savePrefs() {
  prefsBusy.value = true
  try {
    const res = await $fetch<{ success: boolean, data: VenuePreferenceView }>('/api/v1/exchange-demo/venue-preference', {
      method: 'PUT',
      body: { preferredVenue: prefVenue.value, marketDataPolicy: prefPolicy.value, marketDataFallbackOrder: prefFallback.value }
    })
    prefs.value = res.data
    notify.success(t('marketSources.venuePrefs.saveSuccess'))
    await Promise.all([refreshPrefs(), refreshVenues()])
  } catch (error) {
    notify.error(getErrorMessage(error, key => t(key)))
  } finally {
    prefsBusy.value = false
  }
}

function openSwitch() {
  if (switchTarget.value === prefVenue.value) switchTarget.value = VENUE_LIST.find(v => v !== prefVenue.value) ?? 'okx'
  switchOpen.value = true
}

async function submitSwitch() {
  prefsBusy.value = true
  try {
    await $fetch('/api/v1/exchange-demo/venue-preference/switch', {
      method: 'POST',
      body: { targetVenue: switchTarget.value, reason: switchReason.value || null }
    })
    notify.success(t('marketSources.venuePrefs.switch.success'))
    switchOpen.value = false
    await refreshPrefs()
  } catch (error) {
    notify.error(getErrorMessage(error, key => t(key)))
  } finally {
    prefsBusy.value = false
  }
}

onMounted(() => {
  refresh()
  refreshDemoConnections()
  refreshVenues()
  refreshPrefs()
})

const statusColor = (s: MarketSourceHealth['status']) =>
  s === 'up' ? 'success' : s === 'down' ? 'error' : 'neutral'

const metrics = computed<MetricItem[]>(() => {
  const up = sources.value.filter(s => s.status === 'up').length
  const down = sources.value.filter(s => s.status === 'down').length
  const unknown = sources.value.length - up - down
  return [
    { key: 'venues', label: t('marketSources.metrics.venues'), value: String(sources.value.length), icon: 'i-lucide-database-zap' },
    { key: 'up', label: t('marketSources.metrics.up'), value: String(up), icon: 'i-lucide-circle-check', tone: 'success' as const },
    { key: 'down', label: t('marketSources.metrics.down'), value: String(down), icon: 'i-lucide-circle-x', tone: down > 0 ? 'error' as const : 'default' as const },
    { key: 'unknown', label: t('marketSources.metrics.unknown'), value: String(unknown), icon: 'i-lucide-circle-help' }
  ]
})

const trail = computed(() => [
  { label: t('nav.admin_system') },
  { label: title.value }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('marketSources.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="system-data-sources" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('marketSources.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="meta"
          :label="`${meta.healthy} / ${meta.total}`"
          color="neutral"
          variant="subtle"
          size="sm"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refresh"
        />
      </div>
    </template>

    <div class="w-full pb-24 lg:pb-6 space-y-4">
      <SharedMetricRibbon :items="metrics" />

      <UAlert
        icon="i-lucide-info"
        color="neutral"
        variant="subtle"
        :title="t('marketSources.distinctNote')"
      />

      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="font-semibold text-highlighted">{{ t('marketSources.demo.title') }}</h2>
              <p class="mt-1 text-xs text-muted">{{ t('marketSources.demo.description') }}</p>
            </div>
            <UBadge :label="t('marketSources.demo.demoOnly')" color="warning" variant="subtle" />
          </div>
        </template>

        <div class="space-y-4">
          <UAlert icon="i-lucide-shield-check" color="warning" variant="subtle" :title="t('marketSources.demo.safetyNote')" />
          <UAlert v-if="demoLoadFailed" icon="i-lucide-triangle-alert" color="error" variant="subtle" :title="t('marketSources.demo.loadFailed')">
            <template #actions>
              <UButton size="xs" color="error" variant="soft" :loading="demoLoading" :label="t('marketSources.refresh')" @click="refreshDemoConnections" />
            </template>
          </UAlert>
          <div v-if="demoLoading && !demoConnections.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <USkeleton v-for="n in 2" :key="n" class="h-28 rounded" />
          </div>
          <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <UCard v-for="profile in demoConnections" :key="profile.profile" :ui="{ body: 'p-3' }">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-highlighted">{{ profileLabel(profile.profile) }}</span>
                <UBadge :label="t(`marketSources.demo.status.${profile.status}`)" :color="profile.status === 'up' ? 'success' : profile.status === 'down' ? 'error' : 'neutral'" variant="subtle" size="xs" />
              </div>
              <div class="mt-2 text-[11px] text-muted font-mono">{{ profile.keyMask }}</div>
              <dl class="mt-2 space-y-1 text-[11px] text-muted">
                <div class="flex justify-between gap-2">
                  <dt>{{ t('marketSources.demo.accountApi') }}</dt>
                  <dd>{{ profile.status === 'up' && profile.lastLatencyMs != null ? `${profile.lastLatencyMs} ms` : profile.status === 'down' ? t('marketSources.demo.testFailed') : t('marketSources.demo.notTested') }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt>{{ t('marketSources.demo.orderCapability') }}</dt>
                  <dd>{{ t(`marketSources.demo.capabilities.${profile.capabilities.order}`) }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt>{{ t('marketSources.demo.privateStream') }}</dt>
                  <dd>{{ t(`marketSources.demo.capabilities.${profile.capabilities.privateStream}`) }}</dd>
                </div>
              </dl>
              <p v-if="profile.lastErrorCode" class="mt-2 text-[11px] text-error break-all">{{ profile.lastErrorCode }}</p>
              <div class="mt-3 flex gap-2">
                <UButton size="xs" color="primary" variant="soft" :loading="demoBusy" :disabled="!profile.enabled" :label="t('marketSources.demo.test')" @click="testDemoConnection(profile.profile)" />
                <UButton size="xs" color="error" variant="ghost" :disabled="demoBusy" :label="t('common.delete')" @click="askDeleteDemoConnection(profile.profile)" />
              </div>
            </UCard>
            <div v-if="!demoConnections.length" class="rounded border border-dashed border-default px-4 py-6 text-center text-sm text-muted sm:col-span-2 lg:col-span-4">
              {{ t('marketSources.demo.empty') }}
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <UFormField :label="t('marketSources.demo.profile')">
              <USelect v-model="demoProfile" :items="demoProfileItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('marketSources.demo.apiKey')">
              <UInput v-model="demoApiKey" autocomplete="off" class="w-full font-mono" />
            </UFormField>
            <UFormField :label="t('marketSources.demo.apiSecret')">
              <UInput v-model="demoApiSecret" type="password" autocomplete="new-password" class="w-full font-mono" />
            </UFormField>
            <UFormField v-if="demoProfile === 'okx'" :label="t('marketSources.demo.passphrase')">
              <UInput v-model="demoPassphrase" type="password" autocomplete="new-password" class="w-full font-mono" />
            </UFormField>
          </div>
          <div class="flex justify-end">
            <UButton color="primary" variant="soft" icon="i-lucide-key-round" :disabled="!demoApiKey || !demoApiSecret || (demoProfile.startsWith('okx') && !demoPassphrase)" :loading="demoBusy" :label="t('marketSources.demo.save')" @click="saveDemoConnection" />
          </div>
        </div>
      </UCard>
      <LazyBaseConfirmModal
        v-model:open="demoDeleteOpen"
        :title="t('common.delete')"
        :description="demoPendingDelete ? t('marketSources.demo.deleteConfirm', { profile: profileLabel(demoPendingDelete) }) : ''"
        :confirm-label="t('common.delete')"
        :cancel-label="t('common.cancel')"
        :loading="demoBusy"
        color="error"
        icon="i-lucide-trash-2"
        @confirm="removeDemoConnection"
      />

      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="font-semibold text-highlighted">{{ t('marketSources.venuePrefs.title') }}</h2>
              <p class="mt-1 text-xs text-muted">{{ t('marketSources.venuePrefs.description') }}</p>
            </div>
            <UBadge :label="t('marketSources.demo.demoOnly')" color="warning" variant="subtle" />
          </div>
        </template>

        <div class="space-y-4">
          <UAlert icon="i-lucide-lock" color="warning" variant="subtle" :title="t('marketSources.venuePrefs.demoOnlyNote')" />
          <UAlert v-if="prefsLoadFailed" icon="i-lucide-triangle-alert" color="error" variant="subtle" :title="t('marketSources.venuePrefs.loadFailed')" />
          <UAlert v-if="venuesLoadFailed" icon="i-lucide-triangle-alert" color="error" variant="subtle" :title="t('marketSources.venuePrefs.venuesLoadFailed')">
            <template #actions>
              <UButton size="xs" color="error" variant="soft" :loading="venuesLoading" :label="t('marketSources.refresh')" @click="refreshVenues" />
            </template>
          </UAlert>

          <div class="grid gap-3 md:grid-cols-2">
            <UFormField :label="t('marketSources.venuePrefs.preferredVenue')">
              <USelect v-model="prefVenue" :items="venueItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('marketSources.venuePrefs.marketDataPolicy')">
              <USelect v-model="prefPolicy" :items="policyItems" value-key="value" class="w-full" />
            </UFormField>
          </div>

          <UFormField :label="t('marketSources.venuePrefs.fallbackOrder')">
            <div class="flex flex-wrap gap-4">
              <UCheckbox
                v-for="v in VENUE_LIST.filter(x => x !== prefVenue)"
                :key="v"
                :model-value="prefFallback.includes(v)"
                :label="v.toUpperCase()"
                @update:model-value="toggleFallback(v)"
              />
            </div>
          </UFormField>

          <div class="flex justify-end">
            <UButton color="primary" variant="soft" icon="i-lucide-save" :loading="prefsBusy" :label="t('marketSources.venuePrefs.save')" @click="savePrefs" />
          </div>

          <div class="rounded border border-default p-3 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-highlighted">{{ t('marketSources.venuePrefs.switch.button') }}</span>
              <UBadge :label="t('marketSources.venuePrefs.switch.nextSessionOnly')" color="neutral" variant="subtle" size="xs" />
            </div>
            <p class="text-[11px] text-muted">{{ t('marketSources.venuePrefs.switch.description') }}</p>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField :label="t('marketSources.venuePrefs.switch.target')">
                <USelect v-model="switchTarget" :items="switchItems" value-key="value" class="w-full" />
              </UFormField>
              <UFormField :label="t('marketSources.venuePrefs.switch.reason')">
                <UInput v-model="switchReason" class="w-full" />
              </UFormField>
            </div>
            <div class="flex items-center justify-between gap-2">
              <span v-if="prefs?.pendingVenueSwitch" class="text-[11px] text-muted">
                {{ t('marketSources.venuePrefs.switch.nextSessionOnly') }}:
                <span class="font-semibold text-highlighted">{{ prefs.pendingVenueSwitch.targetVenue.toUpperCase() }}</span>
              </span>
              <span v-else />
              <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left-right" :disabled="prefsBusy" :label="t('marketSources.venuePrefs.switch.button')" @click="openSwitch" />
            </div>
          </div>

          <!-- Per-venue health / capability cards: MARKET DATA vs EXECUTION kept distinct -->
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UCard v-for="group in venueGroups" :key="group.venue" :ui="{ body: 'p-3' }">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-highlighted">{{ group.venue.toUpperCase() }}</span>
                <UBadge
                  :label="group.venue === prefVenue ? t('marketSources.venuePrefs.executionVenue') : t('marketSources.venuePrefs.marketDataSource')"
                  :color="group.venue === prefVenue ? 'primary' : 'neutral'"
                  variant="subtle"
                  size="xs"
                />
              </div>
              <div class="mt-2 space-y-2">
                <div v-for="p in group.profiles" :key="p.profileId" class="rounded bg-elevated/40 p-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-[11px] font-medium text-highlighted truncate">{{ p.label }}</span>
                    <UBadge
                      :label="p.executionReady ? t('marketSources.venuePrefs.executionReady') : t('marketSources.venuePrefs.notExecutionReady')"
                      :color="p.executionReady ? 'success' : 'neutral'"
                      variant="subtle"
                      size="xs"
                    />
                  </div>
                  <dl class="mt-1.5 space-y-0.5 text-[10px] text-muted">
                    <div class="flex justify-between gap-2">
                      <dt>{{ t('marketSources.venuePrefs.health.status') }}</dt>
                      <dd><UBadge :label="venueStatusLabel(p.health.status)" :color="venueStatusColor(p.health.status)" variant="subtle" size="xs" /></dd>
                    </div>
                    <div class="flex justify-between gap-2">
                      <dt>{{ t('marketSources.venuePrefs.health.restAccount') }}</dt>
                      <dd class="font-mono">{{ p.connection.configured ? (p.connection.status ?? '—') : t('marketSources.venuePrefs.notConfigured') }}</dd>
                    </div>
                    <div class="flex justify-between gap-2">
                      <dt>{{ t('marketSources.venuePrefs.health.privateStream') }}</dt>
                      <dd>{{ capLevel(p.declaredCapabilities.privateStream) }}</dd>
                    </div>
                    <div class="flex justify-between gap-2">
                      <dt>{{ t('marketSources.venuePrefs.health.publicStream') }}</dt>
                      <dd>{{ p.endpoints.publicIsMainnet ? t('marketSources.venuePrefs.mainnetPublicFeed') : capLevel(p.declaredCapabilities.publicStream) }}</dd>
                    </div>
                    <div class="flex justify-between gap-2">
                      <dt>{{ t('marketSources.venuePrefs.health.clockSkew') }}</dt>
                      <dd class="font-mono">{{ p.health.clockSkewMs != null ? `${p.health.clockSkewMs} ms` : '—' }}</dd>
                    </div>
                    <div class="flex justify-between gap-2">
                      <dt>{{ t('marketSources.venuePrefs.health.rateBudget') }}</dt>
                      <dd class="font-mono">{{ p.health.rateLimit?.remaining ?? '—' }}</dd>
                    </div>
                  </dl>
                  <p v-if="p.executionGaps.length" class="mt-1 text-[10px] text-dimmed">
                    {{ t('marketSources.venuePrefs.capabilityGaps') }}:
                    <span class="font-mono">{{ p.executionGaps.map(g => `${g.capability}=${g.level}`).join(', ') }}</span>
                  </p>
                </div>
              </div>
            </UCard>
          </div>
        </div>
      </UCard>

      <LazyBaseConfirmModal
        v-model:open="switchOpen"
        :title="t('marketSources.venuePrefs.switch.title')"
        :description="t('marketSources.venuePrefs.switch.description')"
        :confirm-label="t('marketSources.venuePrefs.switch.confirm')"
        :cancel-label="t('common.cancel')"
        :loading="prefsBusy"
        color="primary"
        icon="i-lucide-arrow-left-right"
        @confirm="submitSwitch"
      />

      <div v-if="isLoading && !sources.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <USkeleton v-for="n in sources.length || 3" :key="n" class="h-28 rounded" />
      </div>

      <AdminEmptyState
        v-else-if="!sources.length"
        :title="t('marketSources.empty')"
        :description="t('marketSources.emptyHint')"
        icon="i-lucide-database-zap"
      />

      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="s in sources" :key="s.venue" :ui="{ body: 'p-3' }">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-semibold text-highlighted capitalize truncate">{{ s.venue }}</div>
              <div class="text-[11px] text-muted mt-0.5">
                {{ t('marketSources.instruments') }}:
                <span class="font-mono">{{ s.instruments }}</span>
              </div>
            </div>
            <UBadge
              :label="t(`marketSources.statusLabels.${s.status}`)"
              :color="statusColor(s.status)"
              variant="subtle"
              size="sm"
            />
          </div>

          <dl class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt class="text-dimmed">{{ t('marketSources.latency') }}</dt>
              <dd class="font-mono text-muted">{{ s.latencyMs != null ? `${s.latencyMs} ms` : '—' }}</dd>
            </div>
            <div>
              <dt class="text-dimmed">{{ t('marketSources.status') }}</dt>
              <dd class="font-mono text-muted">{{ s.status }}</dd>
            </div>
          </dl>

          <p v-if="s.error" class="mt-2 text-[11px] text-error break-words">{{ s.error }}</p>
        </UCard>
      </div>
    </div>
  </BasePage>
</template>
