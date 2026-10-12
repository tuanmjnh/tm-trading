<script setup lang="ts">
import type { IntelNewsItem, IntelRegime } from '~~/types/intel'
import type { NewsDay } from '~/utils/calendar'

// =============================================================================
//  News Calendar (roadmap §58.5 /markets/calendar) — the intel `news` stream
//  (scored headlines written by services/news.mjs) grouped into UTC-day buckets,
//  newest first, with the token-unlock window from the same intel snapshot as
//  CONTEXT only (the full regime panel lives on Market Intelligence — §58.6).
// =============================================================================
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'marketCalendar.title',
  descKey: 'marketCalendar.desc'
})
const calendar = useMarketCalendar()

const news = ref<IntelNewsItem[]>([])
const unlocks = ref<IntelRegime['unlocks48h']>([])
const mongo = ref<'up' | 'down'>('up')
const generatedAt = ref<string | null>(null)
const total = ref(0)
const isLoading = ref(false)
const levelFilter = ref<'high' | 'med' | ''>('')
const search = ref('')

const LEVELS: Array<'high' | 'med' | ''> = ['', 'high', 'med']

async function refresh() {
  isLoading.value = true
  try {
    const snap = await calendar.load()
    news.value = snap.news
    unlocks.value = snap.unlocks
    mongo.value = snap.mongo
    generatedAt.value = snap.generatedAt
    total.value = snap.total
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

const filtered = computed(() => filterNews(news.value, { level: levelFilter.value, query: search.value }))
const days = computed<NewsDay[]>(() => groupNewsByDay(filtered.value))
const shownCount = computed(() => days.value.reduce((n, d) => n + d.items.length, 0))

const levelColor = (l: IntelNewsItem['level']): 'error' | 'warning' =>
  l === 'high' ? 'error' : 'warning'
const dirColor = (d: IntelNewsItem['dir']): 'success' | 'error' | 'neutral' =>
  d === 'pos' ? 'success' : d === 'neg' ? 'error' : 'neutral'
function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--:--' : `${d.toISOString().slice(11, 16)} UTC`
}
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })
}
function fmtUtc(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="markets-calendar" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="mongo === 'down'" :label="t('marketCalendar.mongoDown')" color="warning" variant="subtle" size="xs" />
        <UBadge v-if="total" :label="t('marketCalendar.eventsCount', { n: total })" color="neutral" variant="subtle" size="xs" />
        <UBadge v-if="generatedAt" :label="fmtUtc(generatedAt)" color="neutral" variant="subtle" size="xs" />
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

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <UButton
          v-for="lv in LEVELS"
          :key="lv || 'all-levels'"
          :label="lv ? t(`intel.level_${lv}`) : t('marketCalendar.allLevels')"
          size="xs"
          :color="levelFilter === lv ? 'primary' : 'neutral'"
          :variant="levelFilter === lv ? 'soft' : 'ghost'"
          @click="levelFilter = lv"
        />
        <USeparator orientation="vertical" class="h-4" />
        <UInput
          v-model="search"
          :placeholder="t('marketCalendar.search')"
          icon="i-lucide-search"
          size="xs"
          class="w-52"
          :aria-label="t('marketCalendar.search')"
        />
        <UButton
          icon="i-lucide-brain-circuit"
          :label="t('marketCalendar.intelDetail')"
          size="xs"
          variant="ghost"
          color="neutral"
          to="/markets"
          class="ms-auto"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="shownCount" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-3">
      <UAlert
        v-if="mongo === 'down'"
        color="warning"
        variant="subtle"
        icon="i-lucide-database-zap"
        :title="t('marketCalendar.mongoDown')"
        :description="t('marketCalendar.emptyMongo')"
      />

      <UCard v-if="unlocks.length">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-unlock" class="size-4 text-primary" />
            <span class="text-xs font-semibold text-highlighted">{{ t('marketCalendar.unlocksTitle') }}</span>
          </div>
        </template>
        <div class="flex flex-wrap gap-2">
          <UBadge
            v-for="u in unlocks"
            :key="`${u.symbol}-${u.date}`"
            color="warning"
            variant="subtle"
            size="sm"
          >
            {{ u.symbol }} · {{ u.date }}<template v-if="u.label"> · {{ u.label }}</template>
          </UBadge>
        </div>
      </UCard>

      <div v-for="d in days" :key="d.day" class="flex flex-col gap-2">
        <div class="flex items-center gap-3">
          <span class="text-xs font-semibold text-highlighted">{{ dayLabel(d.day) }}</span>
          <span class="text-[11px] font-mono text-dimmed">{{ d.day }}</span>
          <USeparator class="flex-1" />
          <span class="text-[11px] text-dimmed">{{ d.items.length }}</span>
        </div>

        <a
          v-for="n in d.items"
          :key="n.link || n.ts"
          :href="n.link || undefined"
          :target="n.link ? '_blank' : undefined"
          rel="noopener noreferrer"
          class="block rounded border border-default p-3 transition-colors hover:bg-elevated/40"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-1 min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <UBadge :label="t(`intel.level_${n.level}`)" :color="levelColor(n.level)" variant="subtle" size="xs" />
                <UBadge :label="t(`intel.dir_${n.dir}`)" :color="dirColor(n.dir)" variant="subtle" size="xs" />
                <span class="text-[10px] font-mono text-dimmed">{{ n.source }}</span>
                <UIcon v-if="n.link" name="i-lucide-external-link" class="size-3 text-dimmed" />
              </div>
              <p class="text-xs font-medium text-highlighted leading-snug">{{ n.title }}</p>
              <p v-if="n.excerpt" class="text-[11px] text-muted leading-relaxed line-clamp-2">{{ n.excerpt }}</p>
              <div v-if="n.tags.length" class="flex flex-wrap gap-1 pt-0.5">
                <UBadge v-for="tag in n.tags" :key="tag" :label="tag" color="neutral" variant="outline" size="xs" />
              </div>
            </div>
            <time :datetime="n.ts" class="text-[11px] font-mono text-dimmed shrink-0">{{ fmtTime(n.ts) }}</time>
          </div>
        </a>
      </div>

      <AdminEmptyState
        v-if="!isLoading && !days.length"
        :title="t('marketCalendar.empty')"
        :description="mongo === 'down' ? t('marketCalendar.emptyMongo') : t('marketCalendar.emptyHint')"
        icon="i-lucide-calendar-days"
      />
    </div>
  </BasePage>
</template>
