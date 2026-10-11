<script setup lang="ts">
// Data Center overview (roadmap §58.9 Slice 4). Hub for the four read-only
// views over the recorder's persistence: datasets, recordings, quality, lineage.
const { t } = useI18n()
const title = computed(() => t('nav.data_center'))
const description = computed(() => t('dataCenter.overviewDesc'))
const dc = useDataCenter()

const stats = reactive({ datasets: 0, recordings: 0, qualityWarn: 0, lineage: 0 })
const isLoading = ref(false)

async function refresh() {
  isLoading.value = true
  try {
    const [ds, rec, q, lin] = await Promise.all([
      dc.datasets({ limit: 1000 }),
      dc.recordings(),
      dc.quality({ limit: 1000 }),
      dc.lineage()
    ])
    stats.datasets = ds.length
    stats.recordings = rec.length
    stats.qualityWarn = q.filter(r => r.verdict !== 'ok').length
    stats.lineage = lin.length
  } finally {
    isLoading.value = false
  }
}
onMounted(refresh)

interface OverviewCard {
  to: string
  icon: string
  title: string
  desc: string
  count: number
  warn?: boolean
}

const cards = computed<OverviewCard[]>(() => [
  { to: '/data-research/data/datasets', icon: 'i-lucide-table', title: t('dataCenter.datasetsTitle'), desc: t('dataCenter.datasetsDesc'), count: stats.datasets },
  { to: '/data-research/data/recordings', icon: 'i-lucide-video', title: t('dataCenter.recordingsTitle'), desc: t('dataCenter.recordingsDesc'), count: stats.recordings },
  { to: '/data-research/data/quality', icon: 'i-lucide-badge-check', title: t('dataCenter.qualityTitle'), desc: t('dataCenter.qualityDesc'), count: stats.qualityWarn, warn: true },
  { to: '/data-research/data/lineage', icon: 'i-lucide-git-branch', title: t('dataCenter.lineageTitle'), desc: t('dataCenter.lineageDesc'), count: stats.lineage }
])

useHead({ title })
</script>

<template>
  <BasePage id="data" :title="title" :description="description">
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

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 sm:p-6">
      <NuxtLink
        v-for="card in cards"
        :key="card.to"
        :to="card.to"
        class="group rounded-lg border border-default bg-elevated/50 hover:bg-elevated transition-colors p-4 flex flex-col gap-2"
      >
        <div class="flex items-center gap-2">
          <UIcon :name="card.icon" class="size-5 text-primary shrink-0" />
          <span class="font-semibold text-highlighted">{{ card.title }}</span>
          <UBadge
            class="ml-auto shrink-0"
            :color="card.warn && card.count > 0 ? 'warning' : 'neutral'"
            variant="subtle"
            size="xs"
            :label="String(card.count)"
          />
        </div>
        <p class="text-[11px] text-muted leading-relaxed">{{ card.desc }}</p>
        <span class="text-[11px] text-primary mt-auto inline-flex items-center gap-1">
          {{ t('common.view') }}
          <UIcon name="i-lucide-arrow-right" class="size-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </NuxtLink>
    </div>
  </BasePage>
</template>
