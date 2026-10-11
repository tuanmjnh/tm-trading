<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.news_calendar'))
useHead({ title })
</script>

<template>
  <BasePage id="calendar" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-calendar-days"
    />
  </BasePage>
</template>
