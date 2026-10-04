<script setup lang="ts">
interface ConfirmFileDisplay {
  name?: string
  display_name?: string | null
  public_id?: string | null
  url?: string | null
  thumbnail_url?: string | null
  format?: string | null
}

const props = withDefaults(defineProps<{
  modelValue?: boolean
  title?: string
  description?: string
  icon?: string
  color?: 'error' | 'success' | 'primary' | 'secondary' | 'info' | 'warning' | 'neutral' | undefined
  confirmLabel?: string
  cancelLabel?: string
  file?: ConfirmFileDisplay | null
}>(),
{
  title: 'Confirm Action',
  description: 'Are you sure you want to perform this action?',
  icon: 'i-lucide-alert-triangle',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  color: 'error',
  file: null
}
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'confirm': []
  'cancel': []
}>()

const isOpen = computed({
  get: () => props.modelValue ?? false,
  set: value => emit('update:modelValue', value)
})

const onConfirm = () => {
  emit('confirm')
  isOpen.value = false
}

const onCancel = () => {
  emit('cancel')
  isOpen.value = false
}
</script>

<template>
  <UModal v-model:open="isOpen">
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center justify-center gap-2">
          <UIcon
            :name="icon"
            class="w-5 h-5 shrink-0"
            :class="[color === 'error' ? 'text-red-500 dark:text-red-400' : 'text-primary-500']"
          />
          <div class="flex flex-col">
            <h2 class="text-base font-semibold leading-6 text-gray-900 dark:text-white">
              {{ $t('confirm.delete_title', 'Confirm Delete') }}
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ $t('confirm.delete_desc_name', [file?.display_name || file?.public_id], `Are you sure you want to
              permanently delete
              ${file?.display_name || file?.public_id}? This action cannot be undone.`) }}
            </p>
          </div>
        </div>
      </div>
    </template>
    <template #body>
      <div v-if="file" class="flex items-center gap-4 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
        <div
          v-if="file.thumbnail_url || file.url"
          class="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 flex items-center justify-center p-1"
        >
          <div v-if="isRawSvg(file.url || '')" class="h-full w-full [&>svg]:w-full [&>svg]:h-full" v-html="sanitizeSvg(file.url || '')" />
          <img
            v-else-if="isSpecialImage(file.url || '')"
            :src="file.thumbnail_url || file.url || ''"
            class="h-full w-full object-cover"
            alt="Preview"
            width="64"
            height="64"
          >
          <NuxtImg
            v-else
            :src="file.thumbnail_url || file.url || ''"
            class="h-full w-full object-cover"
            alt="Preview"
            width="64"
            height="64"
          />
        </div>
        <div v-else class="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700">
          <UIcon name="i-lucide-file" class="h-8 w-8 text-gray-400" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
            {{ file.display_name || file.public_id || file.name || 'Unknown File' }}
          </p>
          <p v-if="file.format" class="text-xs text-gray-500 dark:text-gray-400 uppercase">
            {{ file.format }}
          </p>
        </div>
      </div>
      <slot />
    </template>
    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <UButton
          :label="$t('common.cancel', 'Cancel')"
          color="neutral"
          variant="ghost"
          @click="onCancel"
        />
        <UButton
          :label="$t('common.confirm', 'Confirm')"
          :color="color"
          variant="soft"
          @click="onConfirm"
        />
      </div>
    </template>
  </UModal>
</template>
