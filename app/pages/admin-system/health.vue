<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.health'))
useHead({ title })
</script>

<template>
  <BasePage id="health" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-heart-pulse"
    />
  </BasePage>
</template>
