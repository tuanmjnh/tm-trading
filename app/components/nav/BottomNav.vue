<script setup lang="ts">
const { t } = useI18n()
const actionsOpen = useState<boolean>('actions-sheet-open', () => false)
const { store } = useMobileBar()

const info = computed(() => {
  void store.version.value
  return store.info?.value ?? null
})
const hasInfo = computed(() => info.value !== null
  && (info.value.text !== undefined || info.value.count !== undefined || info.value.loading === true))
</script>

<template>
  <div class="lg:hidden">
    <!-- Bottom Bar: Actions (zap) + page info text zone -->
    <nav class="fixed bottom-0 inset-x-0 z-40 bg-elevated/95 backdrop-blur border-t border-default safe-area-pb">
      <div class="flex h-14 items-stretch">
        <!-- Actions sheet trigger -->
        <button type="button"
          class="zap-actions-btn flex my-2 ms-2 me-1 shrink-0 items-center gap-1.5 transition-colors"
          :aria-label="t('common.actions')" @click="actionsOpen = true">
          <UIcon name="i-lucide-zap" class="zap-gradient-icon size-5" />
          <span class="zap-gradient-text text-sm font-semibold">{{ t('common.actions') }}</span>
        </button>

        <!-- Custom page info (text / count / loading) -->
        <div v-if="hasInfo" class="flex min-w-0 flex-1 items-center gap-2 ps-1 pe-3">
          <UIcon v-if="info?.loading" name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin text-primary" />
          <span v-if="info?.text" class="truncate text-xs text-muted">{{ info.text }}</span>
          <span v-if="info?.count !== undefined"
            class="ms-auto shrink-0 inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-highlighted">
            <UIcon name="i-lucide-database" class="size-3.5 shrink-0 text-muted" />
            {{ info.hasMore ? `${info.count}+` : info.count }}
          </span>
        </div>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.safe-area-pb {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
