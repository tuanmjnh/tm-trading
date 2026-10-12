<script setup lang="ts">
const { isHelpModalOpen } = useDashboard()
const { t } = useI18n()

const shortcuts = computed(() => [
  { key: 'g then h', desc: t('help.shortcuts.home') },
  { key: 'g then a', desc: t('help.shortcuts.apps') },
  { key: 'g then d', desc: t('help.shortcuts.docs') },
  { key: 'Ctrl + K / Cmd + K', desc: t('help.shortcuts.commandPalette') }
])
</script>

<template>
  <UModal
    v-model:open="isHelpModalOpen"
    :title="t('help.title')"
    :description="t('help.description')"
  >
    <template #body>
      <div class="space-y-4">
        <div class="space-y-2">
          <h4 class="text-xs font-semibold text-muted uppercase tracking-wider">
            {{ t('help.keyboardShortcuts') }}
          </h4>
          <div
            class="divide-y divide-default border border-default rounded"
          >
            <div v-for="s in shortcuts" :key="s.key" class="flex justify-between items-center p-3 text-xs">
              <span class="text-toned">{{ s.desc }}</span>
              <UKbd>{{ s.key }}</UKbd>
            </div>
          </div>
        </div>

        <div class="space-y-2 pt-2">
          <h4 class="text-xs font-semibold text-muted uppercase tracking-wider">
            {{ t('help.quickLinks') }}
          </h4>
          <div class="flex gap-2">
            <UButton
              :label="t('help.viewApiDocs')"
              icon="i-lucide-book-open"
              variant="outline"
              size="sm"
              to="/admin-system/docs"
              @click="isHelpModalOpen = false"
            />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
