<script setup lang="ts">
import type { MarketEventPublic } from '#shared/types/news'
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { MarketEventDetail } from '~/composables/useNewsDesk'

// =============================================================================
//  Market Events (V3.5 §60.2 — /news/events).
//
//  Deduplicated events with affected entities, corroborating sources, revision
//  trail and impact evidence. Rows expand inline to show every source report
//  (provenance kept) plus corrections/retractions; ?id= deep-links one event.
// =============================================================================
const { t } = useI18n()
const route = useRoute()
const { title, description } = useAdminPageChrome({
  titleKey: 'newsEvents.title',
  descKey: 'newsEvents.desc'
})
const desk = useNewsDesk()

const CORR: Array<'' | 'single_source' | 'multi_source' | 'contradicted'> = ['', 'single_source', 'multi_source', 'contradicted']

const corrFilter = ref<'' | 'single_source' | 'multi_source' | 'contradicted'>('')
const symbolFilter = ref('')
const events = ref<MarketEventPublic[]>([])
const total = ref(0)
const mongo = ref<'up' | 'down'>('down')
const isLoading = ref(false)
const expanded = ref<string | null>(typeof route.query.id === 'string' ? route.query.id : null)
const details = ref<Record<string, MarketEventDetail | null>>({})
const loadingDetail = ref<Record<string, boolean>>({})
const assistantOpen = ref(false)
const assistantScope = ref<{ type: 'market_event', id: string } | null>(null)

function askAssistant(id: string) {
  assistantScope.value = { type: 'market_event', id }
  assistantOpen.value = true
}

const trail = computed(() => [{ label: t('news.title') }, { label: title.value }])

async function refresh() {
  isLoading.value = true
  try {
    const params = new URLSearchParams({ limit: '100', group: 'crypto' })
    if (corrFilter.value) params.set('corroboration', corrFilter.value)
    if (symbolFilter.value.trim()) params.set('symbol', symbolFilter.value.trim().toUpperCase())
    const res = await $fetch<{ events: MarketEventPublic[]; meta: { mongo: 'up' | 'down'; total: number } }>(
      `/api/v1/news/events?${params.toString()}`
    )
    events.value = res.events ?? []
    total.value = res.meta?.total ?? events.value.length
    mongo.value = res.meta?.mongo ?? 'down'
    if (expanded.value && !events.value.some((e) => e.id === expanded.value)) expanded.value = null
  } catch {
    events.value = []
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)
watch([corrFilter], refresh)
let symbolTimer: ReturnType<typeof setTimeout> | null = null
watch(symbolFilter, () => {
  if (symbolTimer) clearTimeout(symbolTimer)
  symbolTimer = setTimeout(refresh, 400)
})

async function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id
  if (expanded.value && !(expanded.value in details.value)) {
    loadingDetail.value = { ...loadingDetail.value, [id]: true }
    try {
      details.value = { ...details.value, [id]: await desk.loadEventDetail(id) }
    } finally {
      loadingDetail.value = { ...loadingDetail.value, [id]: false }
    }
  }
}
onMounted(() => { if (expanded.value) void toggle(expanded.value) })

const corrColor = (c: string): 'success' | 'error' | 'neutral' =>
  c === 'multi_source' ? 'success' : c === 'contradicted' ? 'error' : 'neutral'

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const metrics = computed<MetricItem[]>(() => [
  { key: 'total', label: t('newsEvents.metrics.total'), value: String(total.value), icon: 'i-lucide-network', tone: 'primary' },
  { key: 'multi', label: t('newsEvents.metrics.corroborated'), value: String(events.value.filter((e) => e.corroboration === 'multi_source').length), icon: 'i-lucide-badge-check', tone: 'success' },
  { key: 'contra', label: t('newsEvents.metrics.contradicted'), value: String(events.value.filter((e) => e.corroboration === 'contradicted').length), icon: 'i-lucide-scale', tone: 'error' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="news-events" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('newsEvents.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="mongo === 'down'" :label="t('news.mongoDown')" color="warning" variant="subtle" size="xs" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading" @click="refresh" />
      </div>
    </template>

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <SharedFilterChips v-model="corrFilter" :items="CORR.map((c) => ({ value: c, label: c ? t(`news.corroboration.${c}`) : t('newsEvents.allCorroboration') }))" />
        <USeparator orientation="vertical" class="h-4" />
        <UInput
          v-model="symbolFilter"
          :placeholder="t('newsEvents.symbolFilter')"
          icon="i-lucide-search"
          size="xs"
          class="w-40"
          :aria-label="t('newsEvents.symbolFilter')"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="events.length" :loading="isLoading" />
    </template>

    <!-- Page-level scroll: the panel body is the scroll container. The root must
         keep its CONTENT height — `h-full`/`min-h-full` + `min-h-0` pinned it to
         the viewport height and every card shrank to 0 px instead of overflowing. -->
    <div class="flex flex-col w-full pb-24 lg:pb-6 gap-3">
      <SharedMetricRibbon :items="metrics" />

      <UCard v-for="e in events" :key="e.id">
        <div class="flex flex-col gap-2">
          <button class="flex flex-col gap-1 text-left" @click="toggle(e.id)">
            <div class="flex items-center gap-1.5 flex-wrap">
              <UBadge :label="t(`news.corroboration.${e.corroboration}`)" :color="corrColor(e.corroboration)" variant="subtle" size="xs" />
              <UBadge v-if="e.status !== 'active'" :label="t(`news.eventStatus.${e.status}`)" color="warning" variant="subtle" size="xs" />
              <span class="text-[10px] font-mono text-dimmed">{{ t('news.eventSources', { n: e.independentSources, m: e.itemCount }) }}</span>
              <span v-if="e.eventType" class="text-[10px] font-mono text-dimmed">{{ e.eventType }}</span>
              <UIcon :name="expanded === e.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5 text-dimmed ms-auto" />
            </div>
            <p class="text-xs font-medium text-highlighted leading-snug">{{ e.title }}</p>
            <div v-if="e.entities.length" class="flex flex-wrap gap-1">
              <UBadge
                v-for="en in e.entities"
                :key="en.symbol"
                :label="en.uncertain ? `${en.symbol}?` : en.symbol"
                color="neutral"
                :variant="en.uncertain ? 'outline' : 'subtle'"
                size="xs"
              />
            </div>
          </button>

          <div class="flex justify-end -mt-1">
            <UButton icon="i-lucide-sparkles" variant="ghost" color="primary" size="xs"
              :aria-label="t('assistant.title')" :title="t('assistant.title')" @click="askAssistant(e.id)" />
          </div>

          <div v-if="expanded === e.id" class="flex flex-col gap-2 pt-1 border-t border-default">
            <p v-if="loadingDetail[e.id]" class="text-[11px] text-dimmed">{{ t('common.loading') }}</p>
            <template v-else-if="details[e.id]">
              <p class="text-[11px] font-semibold text-highlighted">{{ t('newsEvents.reports', { n: details[e.id]?.items.length ?? 0 }) }}</p>
              <a
                v-for="it in details[e.id]?.items"
                :key="it.id"
                :href="it.url || undefined"
                :target="it.url ? '_blank' : undefined"
                rel="noopener noreferrer"
                class="block rounded border border-default px-2.5 py-1.5 text-[11px] leading-snug hover:bg-elevated/40"
              >
                <span class="font-medium text-highlighted">{{ it.title }}</span>
                <span class="text-dimmed"> · {{ it.sourceId }} · {{ fmtTime(it.publishedAt || it.firstSeenAt) }}</span>
                <UIcon v-if="it.url" name="i-lucide-external-link" class="size-3 text-dimmed inline-block ms-1" />
              </a>
              <div v-if="(details[e.id]?.revisions.length ?? 0) > 0">
                <p class="text-[11px] font-semibold text-highlighted">{{ t('newsEvents.revisions') }}</p>
                <div class="flex flex-col gap-1 pt-1">
                  <div v-for="(r, i) in details[e.id]?.revisions" :key="i" class="text-[11px] text-muted">
                    <UBadge :label="r.kind" color="warning" variant="outline" size="xs" />
                    <span class="ms-1.5 font-mono">{{ fmtTime(r.at) }}</span>
                  </div>
                </div>
              </div>
            </template>
            <p v-else class="text-[11px] text-dimmed">{{ t('newsEvents.noDetail') }}</p>
          </div>
        </div>
      </UCard>

      <AdminEmptyState
        v-if="!isLoading && !events.length"
        :title="t('newsEvents.empty')"
        :description="mongo === 'down' ? t('news.emptyMongo') : t('newsEvents.emptyHint')"
        icon="i-lucide-network"
      />
    </div>
    <BaseModuleAssistantPanel v-model:open="assistantOpen" :scope="assistantScope" />
  </BasePage>
</template>
