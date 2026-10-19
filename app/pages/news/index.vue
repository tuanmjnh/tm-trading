<script setup lang="ts">
import type { MarketEventPublic, NewsDeskItem } from '~~/types/news'
import type { MetricItem } from '~/components/MetricRibbon.vue'

// =============================================================================
//  News Desk (V3.5 §60 Slice B — /news, read-only).
//
//  Renders the durable `news_items` envelope: taxonomy group chips (pilot =
//  crypto; other groups honestly report insufficient evidence), level/source
//  filters, source labels with trust-tier badges, citation link-outs, and
//  loading/error/empty/degraded states. Original-language titles are preserved
//  (no translation at rest or render). No AI summaries in this slice.
// =============================================================================
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'news.title',
  descKey: 'news.desc'
})
const desk = useNewsDesk()

const GROUPS = ['crypto', 'equities_global', 'equities_vn', 'macro_cb', 'fx_gold_commod', 'reg_geo_risk', 'company_sector'] as const
const PILOT_GROUPS = ['crypto']
const LEVELS: Array<'high' | 'med' | ''> = ['', 'high', 'med']

const group = ref<string>('crypto')
const levelFilter = ref<'' | 'high' | 'med'>('')
const sourceFilter = ref('')
const search = ref('')
const items = ref<NewsDeskItem[]>([])
const events = ref<MarketEventPublic[]>([])
const eventsTotal = ref(0)
const sources = ref<Awaited<ReturnType<typeof desk.load>>['sources']>([])
const meta = ref({ mongo: 'down' as 'up' | 'down', total: 0, generatedAt: null as string | null, degradedSources: [] as string[] })
const sourcesMongo = ref<'up' | 'down'>('down')
const isLoading = ref(false)
const loadError = ref(false)

const trail = computed(() => [{ label: title.value }])

async function refresh() {
  isLoading.value = true
  loadError.value = false
  try {
    const [snap, ev] = await Promise.all([
      desk.load({ group: group.value, level: levelFilter.value, source: sourceFilter.value, q: search.value }),
      desk.loadEvents(group.value)
    ])
    items.value = snap.items
    sources.value = snap.sources
    meta.value = snap.meta
    sourcesMongo.value = snap.sourcesMongo
    events.value = ev.events
    eventsTotal.value = ev.total
    if (sourceFilter.value && !snap.sources.some((s) => s.sourceId === sourceFilter.value)) sourceFilter.value = ''
  } catch {
    loadError.value = true
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)
watch([group, levelFilter, sourceFilter], refresh)
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(refresh, 400)
})

const isPilotGroup = computed(() => (PILOT_GROUPS as readonly string[]).includes(group.value))
const degraded = computed(() => meta.value.mongo === 'down' || meta.value.degradedSources.length > 0)
const sourceName = (id: string) => sources.value.find((s) => s.sourceId === id)?.name || id
const tierBadge = (id: string) => sources.value.find((s) => s.sourceId === id)?.trustTier || 'T2_SECONDARY'

const levelColor = (l: NewsDeskItem['level']): 'error' | 'warning' => (l === 'high' ? 'error' : 'warning')
const dirColor = (d: NewsDeskItem['dir']): 'success' | 'error' | 'neutral' =>
  d === 'pos' ? 'success' : d === 'neg' ? 'error' : 'neutral'
const corroborationColor = (c: string): 'success' | 'error' | 'neutral' =>
  c === 'multi_source' ? 'success' : c === 'contradicted' ? 'error' : 'neutral'
const statusColor = (s: string): 'error' | 'warning' | 'neutral' =>
  s === 'retracted' ? 'error' : s === 'corrected' ? 'warning' : 'neutral'

function fmtTime(iso: string | null): string {
  if (!iso) return '--:--'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--:--' : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const metrics = computed<MetricItem[]>(() => [
  { key: 'total', label: t('news.metrics.total'), value: String(meta.value.total), icon: 'i-lucide-newspaper', tone: 'primary' },
  { key: 'high', label: t('news.metrics.high'), value: String(items.value.filter((n) => n.level === 'high').length), icon: 'i-lucide-triangle-alert', tone: 'error' },
  { key: 'sources', label: t('news.metrics.sources'), value: String(sources.value.length), icon: 'i-lucide-radio-tower', tone: sourcesMongo.value === 'up' ? 'success' : 'warning' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="news-desk" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('news.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="meta.mongo === 'down'" :label="t('news.mongoDown')" color="warning" variant="subtle" size="xs" />
        <UBadge v-if="meta.degradedSources.length" :label="t('news.degraded', { n: meta.degradedSources.length })"
          color="warning" variant="subtle" size="xs" />
        <UBadge v-if="meta.total" :label="t('news.eventsCount', { n: meta.total })" color="neutral" variant="subtle"
          size="xs" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading"
          @click="refresh" />
      </div>
    </template>

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <FilterChips v-model="levelFilter"
          :items="LEVELS.map((lv) => ({ value: lv, label: lv ? t(`intel.level_${lv}`) : t('news.allLevels') }))" />
        <USeparator orientation="vertical" class="h-4" />
        <FilterChips v-model="sourceFilter"
          :items="[{ value: '', label: t('news.allSources') }, ...sources.filter((s) => s.enabled).map((s) => ({ value: s.sourceId, label: s.name }))]" />
        <USeparator orientation="vertical" class="h-4" />
        <UInput v-model="search" :placeholder="t('news.search')" icon="i-lucide-search" size="xs" class="w-52"
          :aria-label="t('news.search')" />
        <UButton icon="i-lucide-radio-tower" :label="t('news.manageSources')" size="xs" variant="ghost" color="neutral"
          to="/news/sources" class="ms-auto" />
      </div>
      <div class="flex items-center gap-1.5 flex-wrap px-4 sm:px-6 pb-2">
        <UBadge v-for="g in GROUPS" :key="g" :label="t(`news.groups.${g}`)" :color="group === g ? 'primary' : 'neutral'"
          :variant="group === g ? 'solid' : 'subtle'" size="xs" class="cursor-pointer" @click="group = g" />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="items.length" :loading="isLoading" />
    </template>

    <!-- Alerts live OUTSIDE the content block: inside a height-constrained
         (`min-h-0`) flex column they are allowed to shrink and get clipped.
         `shrink-0` keeps their full height here. -->
    <UAlert v-if="degraded && !isLoading" class="shrink-0 mb-3" color="warning" variant="subtle" icon="i-lucide-database-zap"
      :title="t('news.degradedTitle')"
      :description="meta.mongo === 'down' ? t('news.emptyMongo') : t('news.degradedHint', { sources: meta.degradedSources.join(', ') })" />
    <UAlert v-if="loadError" class="shrink-0 mb-3" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('news.loadError')"
      :description="t('news.loadErrorHint')" />

    <!-- Page-level scroll: the panel body is the scroll container. The root must
         keep its CONTENT height — `h-full` + `min-h-0` pinned it to the viewport
         height and every card shrank to 0 px instead of overflowing. -->
    <div class="flex flex-col w-full pb-24 lg:pb-6 gap-3">
      <MetricRibbon :items="metrics" />

      <template v-if="isPilotGroup">
        <div v-if="events.length" class="flex flex-col gap-2">
          <div class="flex items-center gap-3">
            <span class="text-xs font-semibold text-highlighted">{{ t('news.eventsTitle') }}</span>
            <USeparator class="flex-1" />
            <span class="text-[11px] text-dimmed">{{ t('news.eventsCount', { n: eventsTotal }) }}</span>
          </div>
          <div v-for="e in events" :key="e.id" class="rounded border border-default p-3"
            :class="e.corroboration === 'contradicted' ? 'border-error/40' : ''">
            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <UBadge :label="t(`news.corroboration.${e.corroboration}`)" :color="corroborationColor(e.corroboration)"
                  variant="subtle" size="xs" />
                <UBadge v-if="e.status !== 'active'" :label="t(`news.eventStatus.${e.status}`)"
                  :color="statusColor(e.status)" variant="subtle" size="xs" />
                <span class="text-[10px] font-mono text-dimmed">{{ t('news.eventSources', {
                  n: e.independentSources, m:
                    e.itemCount
                }) }}</span>
                <span v-if="e.eventType" class="text-[10px] font-mono text-dimmed">{{ e.eventType }}</span>
              </div>
              <p class="text-xs font-medium text-highlighted leading-snug">{{ e.title }}</p>
              <div v-if="e.entities.length" class="flex flex-wrap gap-1 pt-0.5">
                <UBadge v-for="en in e.entities" :key="en.symbol" :label="en.uncertain ? `${en.symbol}?` : en.symbol"
                  color="neutral" :variant="en.uncertain ? 'outline' : 'subtle'" size="xs"
                  :title="en.uncertain ? t('news.entityUncertain') : ''" />
              </div>
            </div>
          </div>
        </div>

        <a v-for="n in items" :key="n.id" :href="n.url || undefined" :target="n.url ? '_blank' : undefined"
          rel="noopener noreferrer"
          class="block rounded border border-default p-3 transition-colors hover:bg-elevated/40">
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-1 min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <UBadge :label="t(`intel.level_${n.level}`)" :color="levelColor(n.level)" variant="subtle" size="xs" />
                <UBadge :label="t(`intel.dir_${n.dir}`)" :color="dirColor(n.dir)" variant="subtle" size="xs" />
                <span class="text-[10px] font-mono text-dimmed">{{ sourceName(n.sourceId) }}</span>
                <UBadge :label="tierBadge(n.sourceId)" color="neutral" variant="outline" size="xs" />
                <UIcon v-if="n.url" name="i-lucide-external-link" class="size-3 text-dimmed" />
              </div>
              <p class="text-xs font-medium text-highlighted leading-snug">{{ n.title }}</p>
              <p v-if="n.excerpt" class="text-[11px] text-muted leading-relaxed line-clamp-2">{{ n.excerpt }}</p>
              <div v-if="n.tags.length" class="flex flex-wrap gap-1 pt-0.5">
                <UBadge v-for="tag in n.tags" :key="tag" :label="tag" color="neutral" variant="outline" size="xs" />
              </div>
            </div>
            <time :datetime="n.publishedAt || n.firstSeenAt || ''" class="text-[11px] font-mono text-dimmed shrink-0">{{
              fmtTime(n.publishedAt || n.firstSeenAt) }}</time>
          </div>
        </a>
      </template>

      <AdminEmptyState v-if="!isLoading && (!isPilotGroup || !items.length)"
        :title="!isPilotGroup ? t('news.insufficientEvidence') : t('news.empty')"
        :description="!isPilotGroup ? t('news.insufficientEvidenceHint', { group: t(`news.groups.${group}`) }) : (meta.mongo === 'down' ? t('news.emptyMongo') : t('news.emptyHint'))"
        icon="i-lucide-newspaper" />
    </div>
  </BasePage>
</template>
