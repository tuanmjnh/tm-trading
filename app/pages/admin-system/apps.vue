<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.applications'))
useHead({ title })
</script>

<template>
  <BasePage id="admin-apps" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-layout-grid"
    />
  </BasePage>
</template>
