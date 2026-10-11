<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.ai_research'))
useHead({ title })
</script>

<template>
  <BasePage id="research" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-sparkles"
    />
  </BasePage>
</template>
