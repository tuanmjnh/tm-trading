<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { IndicatorMeta } from '~~/types/indicators'

// Indicator Library (roadmap §58.9 Slice 2 §57.4 C). Canonical definitions from
// the engine registry (D1) — the dashboard only reads meta, never the math.
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'strategyLab.indicators.title',
  descKey: 'strategyLab.indicators.desc'
})
const { viewMode } = useAdminGridView('indicators-view-mode')
const indicatorsApi = useIndicators()

const catalog = ref<IndicatorMeta[]>([])
const isLoading = ref(false)
const search = ref('')
const kindFilter = ref('')

async function refresh() {
  isLoading.value = true
  try {
    catalog.value = await indicatorsApi.list()
  } finally {
    isLoading.value = false
  }
}

onMounted(refresh)

const kinds = computed(() => ['', ...new Set(catalog.value.map(c => c.kind))])

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return catalog.value.filter((c) => {
    if (kindFilter.value && c.kind !== kindFilter.value) return false
    if (!term) return true
    return c.id.toLowerCase().includes(term)
  })
})

const kindColor = (kind: string) =>
  kind === 'overlay' ? 'primary' : kind === 'pane' ? 'info' : 'warning'
const kindLabel = (kind: string) => t(`strategyLab.indicators.kindLabels.${kind}`)

const columns = computed<GridColumn[]>(() => [
  { key: 'id', label: t('strategyLab.indicators.id'), class: 'w-48' },
  { key: 'kind', label: t('strategyLab.indicators.kind'), class: 'w-28' },
  { key: 'version', label: t('strategyLab.indicators.version'), class: 'w-20' },
  { key: 'params', label: t('strategyLab.indicators.params'), class: 'w-20' },
  { key: 'outputs', label: t('strategyLab.indicators.outputs'), class: 'w-20' },
  { key: 'warmup', label: t('strategyLab.indicators.warmup'), class: 'w-20' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="indicators" :title="title" :description="description">
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

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          leading
          size="sm"
          :placeholder="t('strategyLab.indicators.search')"
          class="w-full sm:w-64"
        />
        <div class="flex items-center gap-1">
          <UButton
            v-for="kind in kinds"
            :key="kind || 'all'"
            :label="kind ? kindLabel(kind) : t('strategyLab.indicators.all')"
            size="xs"
            :color="kindFilter === kind ? 'primary' : 'neutral'"
            :variant="kindFilter === kind ? 'soft' : 'ghost'"
            @click="kindFilter = kind"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6">
      <LazyGridList
        :items="filtered"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="id"
        storage-key="indicators-view-mode"
        @refresh="refresh"
      >
        <template #id="{ item }">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-activity" class="w-4 h-4 text-dimmed shrink-0" />
            <span class="font-semibold text-xs text-highlighted truncate">{{ item.id }}</span>
          </div>
        </template>

        <template #kind="{ item }">
          <UBadge :label="kindLabel(item.kind)" :color="kindColor(item.kind)" variant="subtle" size="xs" />
        </template>

        <template #version="{ item }">
          <span class="text-[11px] font-mono text-muted">v{{ item.version }}</span>
        </template>

        <template #params="{ item }">
          <span class="text-xs text-muted">{{ Object.keys(item.paramsSchema).length }}</span>
        </template>

        <template #outputs="{ item }">
          <span class="text-xs text-muted">{{ item.outputs.length }}</span>
        </template>

        <template #warmup="{ item }">
          <span class="text-xs text-muted">{{ item.warmup }}</span>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold text-highlighted truncate">{{ item.id }}</span>
                <UBadge :label="kindLabel(item.kind)" :color="kindColor(item.kind)" variant="subtle" size="xs" class="shrink-0" />
              </div>
              <div class="text-[11px] text-dimmed mt-0.5">
                v{{ item.version }} · {{ Object.keys(item.paramsSchema).length }} {{ t('strategyLab.indicators.params').toLowerCase() }} · {{ t('strategyLab.indicators.warmup').toLowerCase() }} {{ item.warmup }}
              </div>
            </div>
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('strategyLab.indicators.empty')"
            :description="t('strategyLab.indicators.emptyHint')"
            icon="i-lucide-chart-line"
          />
        </template>
      </LazyGridList>
    </div>
  </BasePage>
</template>
