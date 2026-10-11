<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.experiments'))
useHead({ title })
</script>

<template>
  <BasePage id="research-experiments" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-test-tube"
    />
  </BasePage>
</template>
