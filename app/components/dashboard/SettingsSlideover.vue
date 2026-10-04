<script setup lang="ts">
import { useEditorType } from '~/composables/useEditorType'

const { isSettingsSlideoverOpen } = useDashboard()
const colorMode = useColorMode()
const appConfig = useAppConfig()
const { t, locale, setLocale } = useI18n()
const { editorType, setEditorType } = useEditorType()

const primaryColors = ['blue', 'indigo', 'violet', 'purple', 'emerald', 'teal', 'cyan', 'rose', 'red', 'amber']

const isStorageModalOpen = ref(false)
</script>

<template>
  <USlideover v-model:open="isSettingsSlideoverOpen" :title="t('settings.title')"
    :description="t('settings.description')">
    <template #body>
      <div class="space-y-6">
        <!-- Ngôn ngữ -->
        <div class="space-y-2">
          <label class="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {{ t('settings.language') }}
          </label>
          <div class="grid grid-cols-2 gap-2">
            <UButton :variant="locale === 'vi' ? 'solid' : 'outline'" color="primary" label="Tiếng Việt" block
              @click="setLocale('vi')" />
            <UButton :variant="locale === 'en' ? 'solid' : 'outline'" color="primary" label="English" block
              @click="setLocale('en')" />
          </div>
        </div>

        <!-- Chế độ sáng tối -->
        <div class="space-y-2">
          <label class="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {{ t('settings.theme') }}
          </label>
          <div class="grid grid-cols-3 gap-2">
            <UButton :variant="colorMode.preference === 'light' ? 'solid' : 'outline'" color="neutral"
              icon="i-lucide-sun" :label="t('settings.light')" block @click="colorMode.preference = 'light'" />
            <UButton :variant="colorMode.preference === 'dark' ? 'solid' : 'outline'" color="neutral"
              icon="i-lucide-moon" :label="t('settings.dark')" block @click="colorMode.preference = 'dark'" />
            <UButton :variant="colorMode.preference === 'system' ? 'solid' : 'outline'" color="neutral"
              icon="i-lucide-monitor" :label="t('settings.systemTheme')" block
              @click="colorMode.preference = 'system'" />
          </div>
        </div>

        <!-- Màu sắc chủ đạo -->
        <div class="space-y-2">
          <label class="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {{ t('settings.appearance') }}
          </label>
          <div class="flex flex-wrap gap-2">
            <button v-for="color in primaryColors" :key="color" type="button"
              class="w-7 h-7 rounded-full transition-transform flex items-center justify-center cursor-pointer hover:scale-110"
              :style="{ backgroundColor: `var(--color-${color}-500)` }" @click="appConfig.ui.colors.primary = color">
              <UIcon v-if="appConfig.ui.colors.primary === color" name="i-lucide-check"
                class="w-4 h-4 text-white drop-shadow" />
            </button>
          </div>
        </div>

        <!-- Chọn trình soạn thảo -->
        <div class="space-y-2">
          <label class="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {{ t('settings.editor') }}
          </label>
          <div class="grid grid-cols-2 gap-2">
            <UButton :variant="editorType === 'tiptap' ? 'solid' : 'outline'" color="primary" size="sm" block
              @click="setEditorType('tiptap')">
              Tiptap
            </UButton>
            <UButton :variant="editorType === 'tinymce' ? 'solid' : 'outline'" color="primary" size="sm" block
              @click="setEditorType('tinymce')">
              TinyMCE
            </UButton>
          </div>
        </div>

        <!-- Quản lý bộ nhớ -->
        <div class="space-y-2">
          <label class="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {{ t('settings.storage.storage_management') }}
          </label>
          <UButton icon="i-lucide-database" variant="outline" color="neutral" block
            class="justify-start text-xs rounded-xl" @click="isStorageModalOpen = true">
            {{ t('settings.storage.storage_management') }}
          </UButton>
        </div>

        <!-- Thông tin hệ thống -->
        <div class="pt-4 border-t border-neutral-100 dark:border-neutral-800 space-y-3 text-xs">
          <div class="flex justify-between items-center text-neutral-500">
            <span>{{ t('settings.hubVersion') }}</span>
            <UBadge label="v1.0.0" variant="subtle" size="xs" />
          </div>
          <div class="flex justify-between items-center text-neutral-500">
            <span>{{ t('settings.primaryDatabase') }}</span>
            <span class="font-medium text-neutral-700 dark:text-neutral-300">Supabase (PostgreSQL)</span>
          </div>
          <div class="flex justify-between items-center text-neutral-500">
            <span>{{ t('settings.defaultPort') }}</span>
            <span class="font-mono text-primary">Port 4000</span>
          </div>
        </div>
      </div>

      <LazyDashboardStorageSettingsModal v-model:open="isStorageModalOpen" />
    </template>
  </USlideover>
</template>
