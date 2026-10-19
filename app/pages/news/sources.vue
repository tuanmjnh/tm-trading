<script setup lang="ts">
import type { NewsSourcePublic } from '~~/types/news'
import type { MetricItem } from '~/components/MetricRibbon.vue'
import type { SourceValidation } from '~/composables/useNewsDesk'

// =============================================================================
//  Source Registry (V3.5 §60.2 — /news/sources, admin capability).
//
//  Enable/disable connectors, trust tier, permitted uses, poll cadence,
//  freshness, error counters, license status and last successful ingest —
//  backed by the NewsSource registry (never a hardcoded list). Policy/rights
//  stay read-only here (DB-operator territory); only the enabled switch and
//  the connectivity probe are writable, through the hub-authenticated API.
// =============================================================================
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'newsSources.title',
  descKey: 'newsSources.desc'
})
const desk = useNewsDesk()

const sources = ref<NewsSourcePublic[]>([])
const sourcesMongo = ref<'up' | 'down'>('down')
const isLoading = ref(false)
const toggling = ref<Record<string, boolean>>({})
const validating = ref<Record<string, boolean>>({})
const validations = ref<Record<string, SourceValidation | null>>({})
const toggleError = ref('')

const trail = computed(() => [{ label: t('news.title') }, { label: title.value }])

async function refresh() {
  isLoading.value = true
  try {
    const snap = await desk.load({ group: '', level: '', source: '', q: '' }, 1)
    sources.value = snap.sources
    sourcesMongo.value = snap.sourcesMongo
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

async function toggle(s: NewsSourcePublic) {
  toggleError.value = ''
  toggling.value = { ...toggling.value, [s.sourceId]: true }
  try {
    const updated = await desk.setSourceEnabled(s.sourceId, !s.enabled)
    if (!updated) {
      toggleError.value = t('newsSources.toggleFailed')
      return
    }
    sources.value = sources.value.map((row) => (row.sourceId === s.sourceId ? updated : row))
  } finally {
    toggling.value = { ...toggling.value, [s.sourceId]: false }
  }
}

async function validate(s: NewsSourcePublic) {
  validating.value = { ...validating.value, [s.sourceId]: true }
  try {
    validations.value = { ...validations.value, [s.sourceId]: await desk.validateSource(s.sourceId) }
  } finally {
    validating.value = { ...validating.value, [s.sourceId]: false }
  }
}

const healthColor = (s: string): 'success' | 'error' | 'warning' | 'neutral' =>
  s === 'ok' ? 'success' : s === 'down' ? 'error' : s === 'degraded' ? 'warning' : 'neutral'
const licenseColor = (s: string): 'success' | 'error' | 'warning' =>
  s === 'ok' ? 'success' : s === 'revoked' ? 'error' : 'warning'

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const metrics = computed<MetricItem[]>(() => [
  { key: 'total', label: t('newsSources.metrics.total'), value: String(sources.value.length), icon: 'i-lucide-radio-tower', tone: 'primary' },
  { key: 'enabled', label: t('newsSources.metrics.enabled'), value: String(sources.value.filter((s) => s.enabled).length), icon: 'i-lucide-power', tone: 'success' },
  { key: 'errors', label: t('newsSources.metrics.errors'), value: String(sources.value.reduce((n, s) => n + (s.health.consecutiveErrors || 0), 0)), icon: 'i-lucide-triangle-alert', tone: 'warning' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="news-sources" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('newsSources.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="sourcesMongo === 'down'" :label="t('news.mongoDown')" color="warning" variant="subtle" size="xs" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading" @click="refresh" />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="sources.length" :loading="isLoading" />
    </template>

    <!-- Alerts live OUTSIDE the content block: inside a height-constrained
         (`min-h-0`) flex column they are allowed to shrink and get clipped.
         `shrink-0` keeps their full height here. -->
    <UAlert
      v-if="toggleError"
      class="shrink-0 mb-3"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="toggleError"
    />

    <!-- Page-level scroll: the panel body is the scroll container. The root must
         keep its CONTENT height — `h-full` + `min-h-0` pinned it to the viewport
         height and every card shrank to 0 px instead of overflowing. -->
    <div class="flex flex-col w-full pb-24 lg:pb-6 gap-3">
      <MetricRibbon :items="metrics" />

      <UCard v-for="s in sources" :key="s.sourceId">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold text-highlighted">{{ s.name }}</span>
            <UBadge :label="s.trustTier" color="primary" variant="subtle" size="xs" />
            <UBadge :label="s.enabled ? t('newsSources.enabled') : t('newsSources.disabled')" :color="s.enabled ? 'success' : 'neutral'" variant="subtle" size="xs" />
            <UBadge :label="s.health.state" :color="healthColor(s.health.state)" variant="subtle" size="xs" />
            <UBadge :label="`${t('newsSources.license')}: ${s.licenseStatus}`" :color="licenseColor(s.licenseStatus)" variant="outline" size="xs" />
            <span class="ms-auto flex items-center gap-1.5">
              <UButton
                :icon="validating[s.sourceId] ? 'i-lucide-loader-circle' : 'i-lucide-activity'"
                size="xs"
                variant="ghost"
                color="neutral"
                :label="t('newsSources.validate')"
                :loading="validating[s.sourceId]"
                @click="validate(s)"
              />
              <USwitch
                :model-value="s.enabled"
                :loading="toggling[s.sourceId]"
                @update:model-value="toggle(s)"
              />
            </span>
          </div>

          <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            <span>{{ t('newsSources.groups') }}: {{ s.marketGroups.join(', ') || '—' }}</span>
            <span>{{ t('newsSources.poll') }}: {{ s.pollIntervalSec }}s</span>
            <span>{{ t('newsSources.retention') }}: {{ s.retentionDays }}d</span>
            <span>{{ t('newsSources.lastOk') }}: {{ fmtTime(s.health.lastOkAt) }}</span>
            <span v-if="s.health.lastError" class="text-error">{{ s.health.lastError }}</span>
          </div>

          <div v-if="validations[s.sourceId]" class="flex flex-wrap gap-1.5 items-center">
            <UBadge
              :label="validations[s.sourceId]?.reachable ? t('newsSources.reachable', { ms: validations[s.sourceId]?.latencyMs ?? '?' }) : t('newsSources.unreachable')"
              :color="validations[s.sourceId]?.reachable ? 'success' : 'error'"
              variant="subtle"
              size="xs"
            />
            <span v-if="validations[s.sourceId]?.reason" class="text-[10px] font-mono text-dimmed">{{ validations[s.sourceId]?.reason }}</span>
          </div>
        </div>
      </UCard>

      <AdminEmptyState
        v-if="!isLoading && !sources.length"
        :title="t('newsSources.empty')"
        :description="sourcesMongo === 'down' ? t('news.emptyMongo') : t('newsSources.emptyHint')"
        icon="i-lucide-radio-tower"
      />
    </div>
  </BasePage>
</template>
