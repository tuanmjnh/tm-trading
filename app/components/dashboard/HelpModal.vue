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
          <h4 class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
            {{ t('help.keyboardShortcuts') }}
          </h4>
          <div
            class="divide-y divide-neutral-100 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-lg"
          >
            <div v-for="s in shortcuts" :key="s.key" class="flex justify-between items-center p-3 text-xs">
              <span class="text-neutral-600 dark:text-neutral-300">{{ s.desc }}</span>
              <UKbd>{{ s.key }}</UKbd>
            </div>
          </div>
        </div>

        <div class="space-y-2 pt-2">
          <h4 class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
            {{ t('help.quickLinks') }}
          </h4>
          <div class="flex gap-2">
            <UButton
              :label="t('help.viewApiDocs')"
              icon="i-lucide-book-open"
              variant="outline"
              size="sm"
              to="/system/docs"
              @click="isHelpModalOpen = false"
            />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
