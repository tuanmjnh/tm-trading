<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  dropText?: string
  descriptionText?: string
  uploadTitle?: string
  linkTitle?: string
  libraryTitle?: string
}>()
const emit = defineEmits<{
  'click-upload': []
  'click-link': []
  'click-library': []
  'files-dropped': [files: FileList]
}>()
const isDragOver = ref(false)
const onDragOver = (e: DragEvent) => {
  e.preventDefault()
  isDragOver.value = true
}
const onDragLeave = (e: DragEvent) => {
  e.preventDefault()
  isDragOver.value = false
}
const onDrop = (e: DragEvent) => {
  e.preventDefault()
  isDragOver.value = false
  if (e.dataTransfer?.files) {
    emit('files-dropped', e.dataTransfer.files)
  }
}
</script>

<template>
  <div
    class="w-full h-full border border-dashed rounded-xl overflow-hidden transition flex flex-col items-center justify-center gap-2 bg-gray-50 dark:bg-gray-800/50 p-6"
    :class="[isDragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10' : 'border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400']"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="text-center">
      <p>
        <UIcon name="i-lucide-upload" class="size-5" />
      </p>
      <div v-if="dropText !== 'hidden'">
        <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ dropText || $t('media.drop_text', 'Drop files here to upload') }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-2">
          {{ descriptionText || $t('media.upload_click_text', 'Click to choose upload method') }}
        </p>
      </div>
      <div class="flex items-center justify-center gap-2">
        <UTooltip :text="uploadTitle || $t('media.upload_from_computer') || 'Upload from Computer'">
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-upload"
            @click="emit('click-upload')"
          />
        </UTooltip>
        <UTooltip :text="linkTitle || $t('media.add_from_link') || 'Add from Link'">
          <UButton
            color="warning"
            variant="soft"
            icon="i-lucide-link"
            @click="emit('click-link')"
          />
        </UTooltip>
        <UTooltip :text="libraryTitle || $t('media.browse_library') || 'Browse Library'">
          <UButton
            color="success"
            variant="soft"
            icon="i-lucide-folder-open"
            @click="emit('click-library')"
          />
        </UTooltip>
      </div>
    </div>
  </div>
</template>
