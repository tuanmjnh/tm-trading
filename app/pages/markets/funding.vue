<script setup lang="ts">
import type { IntelFundingOi } from '#shared/types/intel'
import type { GridColumn } from '~/components/gridList/Index.vue'

const { t } = useI18n()
const { title, description } = useAdminPageChrome({
  titleKey: 'marketFundingOi.title',
  descKey: 'marketFundingOi.desc'
})
const intelApi = useIntel()

const rows = ref<IntelFundingOi[]>([])
const isLoading = ref(false)

async function load() {
  isLoading.value = true
  try {
    const data = await intelApi.get()
    rows.value = data.fundingOi ?? []
  } finally {
    isLoading.value = false
  }
}
onMounted(load)

const columns: GridColumn[] = [
  { key: 'symbol', label: t('common.symbol') },
  { key: 'pct', label: t('marketFundingOi.rate') },
  { key: 'oiNotionalUsd', label: t('marketFundingOi.oi') },
  { key: 'score', label: t('common.score') }
]

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))
</script>

<template>
  <BasePage id="markets-funding" :title="title" :description="description">
    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ t('marketFundingOi.title') }}</h2>
        <UButton :loading="isLoading" @click="load" color="primary" variant="soft" icon="i-lucide-refresh-cw">
          {{ t('common.refresh') }}
        </UButton>
      </div>
      <LazyGridList :items="rows" :columns="columns" :loading="isLoading" :can-load-more="false" item-key="symbol" />
    </div>
  </BasePage>
</template>