<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.alert_rules'))
useHead({ title })
</script>

<template>
  <BasePage id="alerts" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-shield-alert"
    />
  </BasePage>
</template>
