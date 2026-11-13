<script setup lang="ts">
// Market Briefing (V5.0 §3.5).
//
// HONEST SCOPE: the repository has no persisted AI-written brief (ai/daily-brief.mjs
// sends to Telegram and stores nothing), so this panel shows the DETERMINISTIC,
// evidence-linked horizons from /api/v1/outlook and labels them as rules-based.
// It never presents generated text as an AI summary, and it never runs a provider
// test on render — only the configured provider/model identity is read.
import type { OutlookSnapshot } from '~/composables/useNewsDesk'

const { t } = useI18n()
const { outlook, loading, failed, intel } = useDashboardFeed()

const horizons = ['short_term', 'swing', 'long_term'] as const
const horizon = ref<(typeof horizons)[number]>('short_term')

const snapshot = computed<OutlookSnapshot | null>(() => outlook.value[horizon.value] ?? null)

const provider = ref<{ configured: boolean, provider: string | null, model: string | null } | null>(null)

onMounted(async () => {
  try {
    const res = await $fetch<{ data: { env: { configured: boolean, provider: string | null, model: string | null } } }>(
      '/api/v1/ai/providers'
    )
    provider.value = res?.data?.env ?? null
  } catch {
    provider.value = null
  }
})

const stateColor = (state: string) =>
  state === 'risk_on' || state === 'bullish'
    ? 'success'
    : state === 'risk_off' || state === 'bearish'
      ? 'error'
      : 'neutral'

const regimeLabel = computed(() => {
  const r = intel.value?.regime
  if (!r) return null
  return t(`dash.market.season.${r.season}`)
})
</script>

<template>
  <UCard :ui="{ body: 'p-3 sm:p-4' }">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <UIcon name="i-lucide-scroll-text" class="size-4 text-primary" />
        <h2 class="text-sm font-semibold text-highlighted">{{ t('dash.briefing.title') }}</h2>
        <UBadge color="neutral" variant="subtle" size="xs" icon="i-lucide-rule"
          :label="t('dash.briefing.rules')" />
        <UBadge
          v-if="snapshot?.stale"
          color="warning"
          variant="subtle"
          size="xs"
          icon="i-lucide-clock-alert"
          :label="t('dash.briefing.stale')"
        />
        <div class="ms-auto flex gap-1">
          <UButton
            v-for="h in horizons"
            :key="h"
            :label="t(`dash.briefing.${h}`)"
            size="xs"
            :color="horizon === h ? 'primary' : 'neutral'"
            :variant="horizon === h ? 'soft' : 'ghost'"
            @click="horizon = h"
          />
        </div>
      </div>
    </template>

    <div v-if="loading.outlook" class="space-y-2">
      <USkeleton class="h-5 w-2/3" />
      <USkeleton class="h-16 w-full" />
    </div>

    <AdminEmptyState
      v-else-if="!snapshot"
      :title="t('dash.briefing.empty')"
      :description="failed.outlook ? t('common.loadErrorHint') : t('dash.briefing.emptyHint')"
      icon="i-lucide-scroll-text"
    />

    <div v-else class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :color="stateColor(snapshot.state)" variant="subtle" size="sm" :label="snapshot.state" />
        <UBadge color="neutral" variant="subtle" size="xs" :label="`${snapshot.horizonDays}d`" />
        <UBadge v-if="regimeLabel" color="info" variant="subtle" size="xs" :label="regimeLabel" />
        <span class="text-[11px] text-muted font-mono">
          {{ t('dash.asOf') }} {{ snapshot.generatedAt?.slice(0, 16).replace('T', ' ') ?? '—' }} UTC
        </span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div class="min-w-0 space-y-1">
          <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {{ t('dash.briefing.evidence') }} ({{ snapshot.supporting.length }})
          </h3>
          <p v-if="!snapshot.supporting.length" class="text-[11px] text-dimmed">{{ t('common.no_data') }}</p>
          <ul v-else class="space-y-1">
            <li v-for="item in snapshot.supporting.slice(0, 5)" :key="`sup-${item.id}`" class="text-xs min-w-0">
              <a
                v-if="item.url"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline line-clamp-2"
              >{{ item.title }}</a>
              <span v-else class="text-toned line-clamp-2">{{ item.title }}</span>
              <span class="text-[10px] text-dimmed font-mono"> · {{ item.kind }}</span>
            </li>
          </ul>
        </div>

        <div class="min-w-0 space-y-1">
          <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {{ t('dash.briefing.counter') }} ({{ snapshot.counterEvidence.length }})
          </h3>
          <p v-if="!snapshot.counterEvidence.length" class="text-[11px] text-dimmed">{{ t('common.no_data') }}</p>
          <ul v-else class="space-y-1">
            <li v-for="item in snapshot.counterEvidence.slice(0, 5)" :key="`ctr-${item.id}`" class="text-xs min-w-0">
              <a
                v-if="item.url"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline line-clamp-2"
              >{{ item.title }}</a>
              <span v-else class="text-toned line-clamp-2">{{ item.title }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="snapshot.limitations.length" class="rounded border border-default/60 p-2">
        <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{{ t('dash.briefing.limitations') }}</h3>
        <ul class="list-disc ps-4 space-y-0.5">
          <li v-for="(l, i) in snapshot.limitations" :key="`lim-${i}`" class="text-[11px] text-muted">{{ l }}</li>
        </ul>
      </div>

      <p class="text-[11px] text-muted">
        <span class="font-semibold">{{ t('dash.briefing.invalidation') }}:</span> {{ snapshot.invalidation }}
      </p>
      <p class="text-[10px] text-dimmed font-mono break-all">
        {{ t('dash.briefing.evidenceHash') }} {{ snapshot.evidenceHash }}
      </p>
    </div>

    <div class="mt-3 border-t border-default/60 pt-2 flex flex-wrap items-center gap-2 text-[11px]">
      <UIcon name="i-lucide-cpu" class="size-3.5 text-muted" />
      <span class="text-muted">{{ t('dash.briefing.aiStatus') }}:</span>
      <UBadge
        v-if="provider"
        :color="provider.configured ? 'success' : 'neutral'"
        variant="subtle"
        size="xs"
        :label="provider.configured ? `${provider.provider} · ${provider.model}` : t('dash.briefing.aiNotConfigured')"
      />
      <span v-else class="text-dimmed">{{ t('common.unknown') }}</span>
      <span class="text-dimmed">{{ t('dash.briefing.aiNote') }}</span>
    </div>
  </UCard>
</template>
