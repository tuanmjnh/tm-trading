<script setup lang="ts">
import type { MetricItem } from '~/components/MetricRibbon.vue'
import type { MethodLeague, MethodMeta } from '~~/types/methods'

// Method Library (roadmap §58.9 Slice 2 §57.4 D). Read-only view of the engine
// method registry (id/name/version/defaults) plus the pooled league snapshot.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'strategyLab.methods.title',
  descKey: 'strategyLab.methods.desc'
})

const methods = ref<MethodMeta[]>([])
const league = ref<MethodLeague | null>(null)
const isLoading = ref(false)

async function refresh() {
  isLoading.value = true
  try {
    const res = await $fetch<{ success: boolean; data: { methods: MethodMeta[]; league: MethodLeague | null } }>('/api/v1/methods')
    methods.value = res.data?.methods ?? []
    league.value = res.data?.league ?? null
  } catch {
    methods.value = []
    league.value = null
  } finally {
    isLoading.value = false
  }
}

onMounted(refresh)

const fmtPct = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'
const fmtNum = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—'
const netColor = (v: number) => (v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted')

const pooledWinRate = computed(() => {
  const rows = league.value?.methods ?? []
  const trades = rows.reduce((s, m) => s + m.trades, 0)
  if (!trades) return null
  return rows.reduce((s, m) => s + m.winRate * m.trades, 0) / trades
})

const metrics = computed<MetricItem[]>(() => [
  {
    key: 'registered',
    label: t('strategyLab.methods.metrics.registered'),
    value: String(methods.value.length),
    tone: 'primary',
    icon: 'i-lucide-git-merge'
  },
  {
    key: 'league',
    label: t('strategyLab.methods.metrics.leagueRows'),
    value: String(league.value?.methods.length ?? 0),
    icon: 'i-lucide-trophy'
  },
  {
    key: 'engine',
    label: t('strategyLab.methods.metrics.engine'),
    value: league.value?.engineVersion || '—',
    icon: 'i-lucide-cpu'
  },
  {
    key: 'winRate',
    label: t('strategyLab.methods.metrics.winRate'),
    value: pooledWinRate.value == null ? '—' : fmtPct(pooledWinRate.value * 100, 1),
    icon: 'i-lucide-percent'
  }
])

const trail = computed(() => [
  { label: t('nav.strategy_lab') },
  { label: t('nav.methods') }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="methods" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('strategyLab.pips.methods')" />
    </template>

    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="soft"
        color="neutral"
        size="sm"
        :loading="isLoading"
        @click="refresh"
      />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-3 overflow-y-auto">
      <MetricRibbon :items="metrics" />

      <!-- Registry -->
      <UCard :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-git-merge" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('strategyLab.methods.registry') }}</h3>
            <UBadge :label="String(methods.length)" color="neutral" variant="subtle" size="xs" />
          </div>
        </template>

        <div v-if="methods.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div
            v-for="m in methods"
            :key="m.id"
            class="rounded border border-default p-3 flex flex-col gap-1"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-xs text-highlighted truncate">{{ m.name || m.id }}</span>
              <span class="text-[10px] font-mono text-dimmed shrink-0">v{{ m.version }}</span>
            </div>
            <span class="text-[10px] text-dimmed font-mono truncate">{{ m.id }}</span>
            <span class="text-[10px] text-dimmed">
              {{ Object.keys(m.defaults).length }} {{ t('strategyLab.methods.defaults').toLowerCase() }}
            </span>
          </div>
        </div>
        <AdminEmptyState
          v-else
          :title="t('strategyLab.methods.empty')"
          :description="t('strategyLab.methods.emptyHint')"
          icon="i-lucide-git-merge"
        />
      </UCard>

      <!-- League -->
      <UCard :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trophy" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('strategyLab.methods.league') }}</h3>
            </div>
            <span v-if="league" class="text-[10px] text-dimmed">
              {{ t('strategyLab.methods.generated') }} {{ new Date(league.generatedAt).toLocaleString() }}
              · engine {{ league.engineVersion }}
            </span>
          </div>
        </template>

        <div v-if="league && league.methods.length" class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead class="bg-muted/50">
              <tr class="text-[11px] text-dimmed uppercase tracking-wider">
                <th class="text-left font-medium px-2 py-1">{{ t('strategyLab.methods.method') }}</th>
                <th class="text-right font-medium px-2 py-1">{{ t('strategyLab.methods.trades') }}</th>
                <th class="text-right font-medium px-2 py-1">{{ t('strategyLab.methods.open') }}</th>
                <th class="text-right font-medium px-2 py-1">{{ t('strategyLab.methods.winRate') }}</th>
                <th class="text-right font-medium px-2 py-1">{{ t('strategyLab.methods.profitFactor') }}</th>
                <th class="text-right font-medium px-2 py-1">{{ t('strategyLab.methods.net') }}</th>
                <th class="text-right font-medium px-2 py-1">{{ t('strategyLab.methods.expectancy') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in league.methods" :key="row.id" class="border-t border-default/50">
                <td class="px-2 py-1 font-semibold text-highlighted whitespace-nowrap">{{ row.name || row.id }}</td>
                <td class="px-2 py-1 text-right text-muted">{{ row.trades }}</td>
                <td class="px-2 py-1 text-right text-muted">{{ row.open }}</td>
                <td class="px-2 py-1 text-right text-muted">{{ fmtPct(row.winRate * 100, 1) }}</td>
                <td class="px-2 py-1 text-right text-muted">{{ fmtNum(row.profitFactor) }}</td>
                <td class="px-2 py-1 text-right font-semibold" :class="netColor(row.netPct)">{{ fmtPct(row.netPct) }}</td>
                <td class="px-2 py-1 text-right text-muted">{{ fmtNum(row.expectancy) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <AdminEmptyState
          v-else
          :title="t('strategyLab.methods.leagueEmpty')"
          :description="t('strategyLab.methods.leagueEmptyHint')"
          icon="i-lucide-trophy"
        />
      </UCard>
    </div>
  </BasePage>
</template>
