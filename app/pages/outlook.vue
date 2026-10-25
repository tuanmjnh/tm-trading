<script setup lang="ts">
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { OutlookSnapshot } from '~/composables/useNewsDesk'

// =============================================================================
//  Outlook (V3.5 §60 Slice D — /outlook, read-only synthesis).
//
//  Deterministic rule-v1 horizons for the crypto pilot: state, supporting and
//  counter-evidence (every row links a NewsItem/MarketEvent id or source URL),
//  expiry, coverage counts and limitations. Unsupported groups and thin
//  evidence render `insufficient_evidence` — never a generic prediction.
//  No calibrated probabilities in v1 (qualitative scenarios only, §60.8).
// =============================================================================
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'outlook.title',
  descKey: 'outlook.desc'
})
const desk = useNewsDesk()

const GROUPS = ['crypto', 'equities_global', 'equities_vn', 'macro_cb', 'fx_gold_commod', 'reg_geo_risk', 'company_sector'] as const
const HORIZONS = ['short_term', 'swing', 'long_term'] as const

const group = ref<string>('crypto')
const snaps = ref<Record<string, OutlookSnapshot | null>>({})
const isLoading = ref(false)
const degraded = ref(false)
const assistantOpen = ref(false)
const assistantScope = computed(() => ({
  type: 'outlook' as const,
  group: group.value,
  horizon: 'short_term'
}))

const trail = computed(() => [{ label: title.value }])

async function refresh() {
  isLoading.value = true
  degraded.value = false
  try {
    const out: Record<string, OutlookSnapshot | null> = {}
    const rows = await Promise.all(HORIZONS.map((h) => desk.loadOutlook(group.value, h)))
    HORIZONS.forEach((h, i) => { out[h] = rows[i] ?? null })
    snaps.value = out
    if (Object.values(out).every((s) => s === null)) degraded.value = true
  } catch {
    degraded.value = true
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)
watch(group, refresh)

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const stateColor = (s: string): 'success' | 'error' | 'warning' | 'neutral' =>
  s === 'bullish' ? 'success' : s === 'bearish' ? 'error' : s === 'mixed' ? 'warning' : 'neutral'

function evidenceHref(kind: string, id: string, url: string | null | undefined): string | undefined {
  if (url) return url
  if (kind === 'event') return `/news#${id}`
  return undefined
}

const metrics = computed<MetricItem[]>(() => {
  const list = HORIZONS.map((h) => snaps.value[h]).filter((s) => s !== null)
  return [
    { key: 'state', label: t('outlook.metrics.shortTerm'), value: t(`outlook.states.${snaps.value.short_term?.state ?? 'unknown'}`), icon: 'i-lucide-compass', tone: 'primary' },
    { key: 'contra', label: t('outlook.metrics.contradictions'), value: String(list.reduce((n, s) => n + (s?.contradictionCount ?? 0), 0)), icon: 'i-lucide-scale', tone: 'warning' },
    { key: 'multi', label: t('outlook.metrics.corroborated'), value: String(list.reduce((n, s) => n + (s?.multiSourceCount ?? 0), 0)), icon: 'i-lucide-badge-check', tone: 'success' }
  ]
})

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="market-outlook" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('outlook.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="degraded" :label="t('outlook.degraded')" color="warning" variant="subtle" size="xs" />
        <UButton icon="i-lucide-sparkles" variant="soft" color="primary" size="sm"
          :aria-label="t('assistant.title')" :title="t('assistant.title')" @click="assistantOpen = true" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading" @click="refresh" />
      </div>
    </template>

    <template #toolbar>
      <div class="flex items-center gap-1.5 flex-wrap px-4 sm:px-6 py-2">
        <UBadge
          v-for="g in GROUPS"
          :key="g"
          :label="t(`news.groups.${g}`)"
          :color="group === g ? 'primary' : 'neutral'"
          :variant="group === g ? 'solid' : 'subtle'"
          size="xs"
          class="cursor-pointer"
          @click="group = g"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="HORIZONS.length" :loading="isLoading" />
    </template>

    <!-- Alerts live OUTSIDE the content block: inside a height-constrained
         (`min-h-0`) flex column they are allowed to shrink and get clipped.
         `shrink-0` keeps their full height here. -->
    <UAlert
      v-if="degraded && !isLoading"
      class="shrink-0 mb-3"
      color="warning"
      variant="subtle"
      icon="i-lucide-database-zap"
      :title="t('outlook.degraded')"
      :description="t('outlook.degradedHint')"
    />

    <!-- Page-level scroll: the panel body is the scroll container. The root must
         keep its CONTENT height — `h-full` + `min-h-0` pinned it to the viewport
         height and every card shrank to 0 px instead of overflowing. -->
    <div class="flex flex-col w-full pb-24 lg:pb-6 gap-3">
      <SharedMetricRibbon :items="metrics" />

      <UCard v-for="h in HORIZONS" :key="h">
        <template #header>
          <div class="flex items-center gap-2 flex-wrap">
            <UIcon name="i-lucide-telescope" class="size-4 text-primary" />
            <span class="text-xs font-semibold text-highlighted">{{ t(`outlook.horizons.${h}`) }}</span>
            <UBadge
              v-if="snaps[h]"
              :label="t(`outlook.states.${snaps[h]?.state}`)"
              :color="stateColor(snaps[h]?.state ?? '')"
              variant="subtle"
              size="xs"
            />
            <UBadge v-if="snaps[h]?.stale" :label="t('outlook.stale')" color="warning" variant="subtle" size="xs" />
            <span v-if="snaps[h]" class="ms-auto text-[10px] font-mono text-dimmed">{{ t('outlook.expires', { at: fmtTime(snaps[h]?.expiresAt ?? null) }) }}</span>
          </div>
        </template>

        <div v-if="snaps[h]" class="flex flex-col gap-3">
          <div v-if="(snaps[h]?.supporting?.length ?? 0) > 0">
            <p class="text-[11px] font-semibold text-highlighted pb-1">{{ t('outlook.supporting') }}</p>
            <div class="flex flex-col gap-1.5">
              <component
                :is="evidenceHref(e.kind, e.id, e.url) ? 'a' : 'span'"
                v-for="e in snaps[h]?.supporting"
                :key="`${e.kind}:${e.id}`"
                :href="evidenceHref(e.kind, e.id, e.url)"
                :target="e.url ? '_blank' : undefined"
                rel="noopener noreferrer"
                class="block rounded border border-default px-2.5 py-1.5 text-[11px] leading-snug"
              >
                <span class="font-medium text-highlighted">{{ e.title }}</span>
                <span class="text-dimmed"> · {{ e.kind === 'event' ? t('outlook.evidenceEvent', { n: e.corroboration }) : t('outlook.evidenceItem') }}</span>
                <UIcon v-if="e.url" name="i-lucide-external-link" class="size-3 text-dimmed inline-block ms-1" />
              </component>
            </div>
          </div>

          <div v-if="(snaps[h]?.counterEvidence?.length ?? 0) > 0">
            <p class="text-[11px] font-semibold text-highlighted pb-1">{{ t('outlook.counterEvidence') }}</p>
            <div class="flex flex-col gap-1.5">
              <div
                v-for="e in snaps[h]?.counterEvidence"
                :key="`${e.kind}:${e.id}`"
                class="rounded border border-warning/30 px-2.5 py-1.5 text-[11px] leading-snug text-muted"
              >
                {{ e.title }}<span v-if="e.note"> — {{ e.note }}</span>
              </div>
            </div>
          </div>

          <p class="text-[11px] text-muted leading-relaxed">{{ t('outlook.invalidationLabel') }}: {{ snaps[h]?.invalidation }}</p>
          <div class="flex flex-wrap gap-1">
            <UBadge v-for="lim in snaps[h]?.limitations" :key="lim" :label="lim" color="neutral" variant="outline" size="xs" />
          </div>
          <p class="text-[10px] font-mono text-dimmed">{{ t('outlook.evidenceHash', { hash: (snaps[h]?.evidenceHash || '').slice(0, 12) }) }}</p>
        </div>

        <AdminEmptyState
          v-else-if="!isLoading"
          :title="t('outlook.noSnapshot')"
          :description="t('outlook.noSnapshotHint')"
          icon="i-lucide-telescope"
        />
      </UCard>
    </div>
    <BaseModuleAssistantPanel v-model:open="assistantOpen" :scope="assistantScope" />
  </BasePage>
</template>
