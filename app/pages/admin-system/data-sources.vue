<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.market_data_sources'))
useHead({ title })
</script>

<template>
  <BasePage id="system-data-sources" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-database-zap"
    />
  </BasePage>
</template>
