<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.paper'))
useHead({ title })
</script>

<template>
  <BasePage id="paper" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-notebook-pen"
    />
  </BasePage>
</template>
