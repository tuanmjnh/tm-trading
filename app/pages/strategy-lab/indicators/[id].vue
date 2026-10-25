<script setup lang="ts">
import type { MetricItem } from '~/components/shared/MetricRibbon.vue'
import type { IndicatorMeta, IndicatorOutputDef } from '#shared/types/indicators'
import { getErrorMessage } from '~/shared/utils/errors'

// Indicator detail (roadmap §57.4 D / §58.9 Slice 2). Read-only registry entry:
// the canonical definition owned by the engine (D1). The dashboard shows meta
// only — id/version/kind/paramsSchema/warmup/outputs — never the math.
const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const indicatorsApi = useIndicators()

const indicatorId = computed(() => String(route.params.id ?? ''))
const meta = ref<IndicatorMeta | null>(null)
const isLoading = ref(true)

async function load() {
  isLoading.value = true
  try {
    meta.value = await indicatorsApi.detail(indicatorId.value)
  } catch (err) {
    notify.error(t('strategyLab.indicatorDetail.title'), getErrorMessage(err, key => t(key)))
    meta.value = null
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

const title = computed(() => meta.value?.id || t('strategyLab.indicatorDetail.title'))
const description = computed(() => (meta.value ? `v${meta.value.version}` : t('strategyLab.indicators.desc')))

const trail = computed(() => [
  { label: t('nav.strategy_lab'), to: '/strategy-lab' },
  { label: t('nav.indicators'), to: '/strategy-lab/indicators' },
  { label: title.value }
])

const kindColor = (kind: string) =>
  kind === 'overlay' ? 'primary' : kind === 'pane' ? 'info' : 'warning'
const kindLabel = (kind: string) => t(`strategyLab.indicators.kindLabels.${kind}`)

const params = computed(() => {
  const schema = meta.value?.paramsSchema ?? {}
  return Object.entries(schema)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, def]) => ({ key, default: def.default, min: def.min, max: def.max }))
})

const outputs = computed<IndicatorOutputDef[]>(() => meta.value?.outputs ?? [])

const metrics = computed<MetricItem[]>(() => {
  const m = meta.value
  if (!m) return []
  return [
    { key: 'kind', label: t('strategyLab.indicators.kind'), value: kindLabel(m.kind), tone: kindColor(m.kind) },
    { key: 'version', label: t('strategyLab.indicators.version'), value: `v${m.version}` },
    { key: 'params', label: t('strategyLab.indicators.params'), value: String(params.value.length) },
    { key: 'outputs', label: t('strategyLab.indicators.outputs'), value: String(outputs.value.length) },
    { key: 'warmup', label: t('strategyLab.indicators.warmup'), value: String(m.warmup) }
  ]
})

const fmtNum = (v: number) => (Number.isFinite(v) ? String(v) : '—')

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))

useHead({ title })
</script>

<template>
  <BasePage id="indicator-detail" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('strategyLab.pips.indicatorDetail')" />
    </template>

    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="soft"
        color="neutral"
        size="sm"
        :loading="isLoading"
        @click="load"
      />
    </template>

    <div class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <AdminEmptyState
        v-if="!isLoading && !meta"
        :title="t('strategyLab.indicatorDetail.notFound')"
        :description="t('strategyLab.indicatorDetail.notFoundHint')"
        icon="i-lucide-chart-line"
      />

      <template v-else>
        <SharedMetricRibbon :items="metrics" :cols="'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'" />

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Params schema -->
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-sliders-horizontal" class="w-4 h-4 text-primary" />
                  <h3 class="font-semibold text-sm">{{ t('strategyLab.indicatorDetail.paramsTitle') }}</h3>
                </div>
                <UBadge :label="String(params.length)" variant="subtle" size="xs" />
              </div>
            </template>

            <div v-if="params.length" class="overflow-x-auto">
              <table class="w-full text-xs border-collapse">
                <thead class="bg-muted/50">
                  <tr class="text-[11px] text-dimmed uppercase tracking-wider">
                    <th class="text-left font-medium px-3 py-1.5">{{ t('strategyLab.indicatorDetail.paramName') }}</th>
                    <th class="text-right font-medium px-3 py-1.5">{{ t('strategyLab.indicatorDetail.paramDefault') }}</th>
                    <th class="text-right font-medium px-3 py-1.5">{{ t('strategyLab.indicatorDetail.paramMin') }}</th>
                    <th class="text-right font-medium px-3 py-1.5">{{ t('strategyLab.indicatorDetail.paramMax') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in params" :key="p.key" class="border-t border-default/50">
                    <td class="px-3 py-1.5 font-mono text-highlighted">{{ p.key }}</td>
                    <td class="px-3 py-1.5 text-right font-mono text-muted">{{ fmtNum(p.default) }}</td>
                    <td class="px-3 py-1.5 text-right font-mono text-dimmed">{{ fmtNum(p.min) }}</td>
                    <td class="px-3 py-1.5 text-right font-mono text-dimmed">{{ fmtNum(p.max) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <AdminEmptyState
              v-else
              :title="t('strategyLab.indicatorDetail.noParams')"
              icon="i-lucide-sliders-horizontal"
            />
          </UCard>

          <!-- Outputs -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-chart-line" class="w-4 h-4 text-primary" />
                  <h3 class="font-semibold text-sm">{{ t('strategyLab.indicatorDetail.outputsTitle') }}</h3>
                </div>
                <UBadge :label="String(outputs.length)" variant="subtle" size="xs" />
              </div>
            </template>

            <ul v-if="outputs.length" class="space-y-2">
              <li
                v-for="o in outputs"
                :key="o.key"
                class="flex items-center justify-between gap-3 rounded border border-default/60 px-3 py-1.5"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    class="w-3 h-3 rounded-sm shrink-0 border border-default/60"
                    :style="{ backgroundColor: o.color }"
                    aria-hidden="true"
                  />
                  <span class="font-mono text-xs text-highlighted truncate">{{ o.key }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <UBadge :label="o.type" color="neutral" variant="subtle" size="xs" class="font-mono" />
                  <span class="text-[11px] font-mono text-dimmed">{{ o.color }}</span>
                </div>
              </li>
            </ul>
            <AdminEmptyState
              v-else
              :title="t('strategyLab.indicatorDetail.noOutputs')"
              icon="i-lucide-chart-line"
            />
          </UCard>
        </div>
      </template>
    </div>
  </BasePage>
</template>
