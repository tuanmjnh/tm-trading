<script setup lang="ts">
import type { MetricItem } from '~/components/MetricRibbon.vue'

// =============================================================================
//  News Impact Research (V3.5 §60.2 — /research/news-impact).
//
//  Historical event studies: scorecard runs comparing directional outlooks
//  against subsequent price action with a persistence baseline. Run button
//  triggers a fresh evaluation (expired snapshots only, PIT-safe); the table
//  shows hit rate vs baseline hit rate per run. Reuses the experiments flow
//  for deep dives (frozen evidence sets attach there).
// =============================================================================
const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'newsImpact.title',
  descKey: 'newsImpact.desc'
})

interface EvaluationRow {
  _id: string
  group: string
  horizon: string
  symbols: string[]
  asOf: string
  snapshots: number
  excluded: number
  hits: number
  hitRate: number | null
  baselineHitRate: number | null
}

const group = ref('crypto')
const horizon = ref('short_term')
const evals = ref<EvaluationRow[]>([])
const total = ref(0)
const mongo = ref<'up' | 'down'>('down')
const isLoading = ref(false)
const isRunning = ref(false)
const runError = ref('')

const trail = computed(() => [{ label: t('nav.ai_research') }, { label: title.value }])

async function refresh() {
  isLoading.value = true
  try {
    const res = await $fetch<{ evaluations: EvaluationRow[]; meta: { mongo: 'up' | 'down'; total: number } }>(
      `/api/v1/research/news-evaluations?group=${group.value}&horizon=${horizon.value}&limit=20`
    )
    evals.value = res.evaluations ?? []
    total.value = res.meta?.total ?? 0
    mongo.value = res.meta?.mongo ?? 'down'
  } catch {
    evals.value = []
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)
watch([group, horizon], refresh)

async function runEvaluation() {
  runError.value = ''
  isRunning.value = true
  try {
    await $fetch('/api/v1/research/news-evaluations', {
      method: 'POST',
      body: { group: group.value, horizon: horizon.value },
    })
    await refresh()
  } catch {
    runError.value = t('newsImpact.runFailed')
  } finally {
    isRunning.value = false
  }
}

function pct(v: number | null): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const metrics = computed<MetricItem[]>(() => {
  const latest = evals.value[0]
  return [
    { key: 'runs', label: t('newsImpact.metrics.runs'), value: String(total.value), icon: 'i-lucide-flask-conical', tone: 'primary' },
    { key: 'hit', label: t('newsImpact.metrics.hitRate'), value: pct(latest?.hitRate ?? null), icon: 'i-lucide-target', tone: 'success' },
    { key: 'base', label: t('newsImpact.metrics.baseline'), value: pct(latest?.baselineHitRate ?? null), icon: 'i-lucide-minus', tone: 'warning' }
  ]
})

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="news-impact" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('newsImpact.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="mongo === 'down'" :label="t('news.mongoDown')" color="warning" variant="subtle" size="xs" />
        <UButton
          icon="i-lucide-play"
          :label="t('newsImpact.run')"
          size="sm"
          color="primary"
          variant="soft"
          :loading="isRunning"
          @click="runEvaluation"
        />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading" @click="refresh" />
      </div>
    </template>

    <template #toolbar>
      <div class="flex items-center gap-1.5 flex-wrap px-4 sm:px-6 py-2">
        <UBadge
          v-for="g in ['crypto', 'macro_cb']"
          :key="g"
          :label="t(`news.groups.${g}`)"
          :color="group === g ? 'primary' : 'neutral'"
          :variant="group === g ? 'solid' : 'subtle'"
          size="xs"
          class="cursor-pointer"
          @click="group = g"
        />
        <USeparator orientation="vertical" class="h-4" />
        <UBadge
          v-for="h in ['short_term', 'swing', 'long_term']"
          :key="h"
          :label="t(`outlook.horizons.${h}`)"
          :color="horizon === h ? 'primary' : 'neutral'"
          :variant="horizon === h ? 'solid' : 'subtle'"
          size="xs"
          class="cursor-pointer"
          @click="horizon = h"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="evals.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-3">
      <MetricRibbon :items="metrics" />
      <UAlert
        v-if="runError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="runError"
      />

      <UCard v-for="e in evals" :key="e._id">
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold text-highlighted">{{ t(`outlook.horizons.${e.horizon}`) }}</span>
            <UBadge :label="t('newsImpact.hitRate', { v: pct(e.hitRate) })" color="success" variant="subtle" size="xs" />
            <UBadge :label="t('newsImpact.baselineRate', { v: pct(e.baselineHitRate) })" color="neutral" variant="subtle" size="xs" />
            <span class="ms-auto text-[10px] font-mono text-dimmed">{{ fmtTime(e.asOf) }}</span>
          </div>
          <p class="text-[11px] text-muted">
            {{ t('newsImpact.coverage', { n: e.snapshots, x: e.excluded, s: (e.symbols || []).join(', ') || '—' }) }}
          </p>
          <p class="text-[10px] font-mono text-dimmed">{{ e._id }}</p>
        </div>
      </UCard>

      <AdminEmptyState
        v-if="!isLoading && !evals.length"
        :title="t('newsImpact.empty')"
        :description="mongo === 'down' ? t('news.emptyMongo') : t('newsImpact.emptyHint')"
        icon="i-lucide-flask-conical"
      />
    </div>
  </BasePage>
</template>
