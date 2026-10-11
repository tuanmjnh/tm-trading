<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.market_explorer'))
useHead({ title })
</script>

<template>
  <BasePage id="markets" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-globe"
    />
  </BasePage>
</template>
