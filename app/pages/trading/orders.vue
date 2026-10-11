<script setup lang="ts">
const { t } = useI18n()
const title = computed(() => t('nav.orders'))
useHead({ title })
</script>

<template>
  <BasePage id="orders" :title="title" :description="t('common.comingSoonDesc')">
    <AdminEmptyState
      :title="t('common.comingSoon')"
      :description="t('common.comingSoonDesc')"
      icon="i-lucide-list-checks"
    />
  </BasePage>
</template>
