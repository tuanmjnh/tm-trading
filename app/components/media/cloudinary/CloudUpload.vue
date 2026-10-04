<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'
interface Props {
  folder: string
  title?: string
  dropText?: string
  descriptionText?: string
  browseText?: string
  uploadingText?: string
  uploadText?: string
  cancelText?: string
  selectedFilesText?: string
  successTitle?: string
  successDescription?: string
  errorTitle?: string
  accept?: string
}
const props = withDefaults(defineProps<Props>(), {
  title: 'Upload Files',
  dropText: 'Drop files here or click to browse',
  descriptionText: 'Upload images, videos, or other files',
  browseText: 'Browse Files',
  uploadingText: 'Uploading...',
  uploadText: 'Upload',
  cancelText: 'Cancel',
  selectedFilesText: 'file(s) selected',
  successTitle: 'Upload complete',
  successDescription: 'file(s) uploaded successfully',
  errorTitle: 'Upload failed',
  accept: '*'
})
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'complete', files: Cloudinary.UploadedResponse[]): void
  (e: 'uploading', value: boolean): void
}>()
const { uploadToCloudinary } = useCloudinary()
const toast = useToast()
const { t } = useI18n()
const files = ref<File[]>([])
const uploading = ref(false)
const uploadProgress = ref<Record<string, number>>({})
const uploadStatus = ref<Record<string, 'pending' | 'success' | 'error'>>({})
const dragOver = ref(false)
const previews = ref<Record<string, string>>({})
watch(uploading, (val) => {
  emit('uploading', val)
})
const handleFileSelect = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files) {
    const newFiles = Array.from(input.files)
    files.value = [...files.value, ...newFiles]
    // Generate previews
    newFiles.forEach((file) => {
      uploadStatus.value[file.name] = 'pending'
      if (file.type.startsWith('image/')) {
        previews.value[file.name] = URL.createObjectURL(file)
      }
    })
  }
}
const handleDrop = (event: DragEvent) => {
  dragOver.value = false
  if (event.dataTransfer?.files) {
    const newFiles = Array.from(event.dataTransfer.files)
    files.value = [...files.value, ...newFiles]
    // Generate previews
    newFiles.forEach((file) => {
      uploadStatus.value[file.name] = 'pending'
      if (file.type.startsWith('image/')) {
        previews.value[file.name] = URL.createObjectURL(file)
      }
    })
  }
}
const removeFile = (index: number) => {
  const file = files.value[index]
  const previewUrl = file ? previews.value[file.name] : undefined
  if (file && previewUrl) {
    URL.revokeObjectURL(previewUrl)
    const { [file.name]: _p, ...newPreviews } = previews.value
    previews.value = newPreviews
    const { [file.name]: _s, ...newStatus } = uploadStatus.value
    uploadStatus.value = newStatus
  }
  files.value.splice(index, 1)
}
// Cleanup previews on unmount
onUnmounted(() => {
  Object.values(previews.value).forEach(url => URL.revokeObjectURL(url))
})
const uploadFiles = async () => {
  if (files.value.length === 0) return
  uploading.value = true
  let successCount = 0
  let errorCount = 0
  const CONCURRENCY = 3
  const queue = [...files.value]
  const processing = new Set<Promise<void>>()
  const uploadedFiles: Cloudinary.UploadedResponse[] = []
  const processFile = async (file: File) => {
    try {
      uploadStatus.value[file.name] = 'pending'
      uploadProgress.value[file.name] = 0
      const response = await uploadToCloudinary(file, props.folder, (progress) => {
        uploadProgress.value[file.name] = progress
      })
      uploadedFiles.push(response)
      uploadStatus.value[file.name] = 'success'
      successCount++
    } catch {
      uploadStatus.value[file.name] = 'error'
      errorCount++
    }
  }
  try {
    while (queue.length > 0 || processing.size > 0) {
      while (queue.length > 0 && processing.size < CONCURRENCY) {
        const file = queue.shift()!
        const promise = processFile(file).then(() => {
          processing.delete(promise)
        })
        processing.add(promise)
      }
      if (processing.size > 0) {
        await Promise.race(processing)
      }
    }
    if (successCount > 0) {
      toast?.add({
        title: t('media.upload_success', 'Upload complete'),
        description: `${successCount} ${t('media.upload_success_description', 'file(s) uploaded successfully')}`,
        color: 'success'
      })
      emit('complete', uploadedFiles)
      // Only close if all successful? Or maybe just clear successful ones?
      // For now, close if all successful, otherwise leave errors
      if (errorCount === 0) emit('close')
    }
    if (errorCount > 0) {
      toast?.add({
        title: t('media.upload_error', 'Upload error'),
        description: `${errorCount} ${t('media.upload_error_description', 'file(s) failed to upload')}`,
        color: 'error'
      })
    }
  } catch (error) {
    toast?.add({
      title: t('media.upload_error', 'Upload error'),
      description: getErrorMessage(error, key => t(key)),
      color: 'error'
    })
  } finally {
    uploading.value = false
  }
}
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
</script>

<template>
  <UCard
    :ui="{ root: 'border-0 ring-0', body: 'p-0 sm:p-0 border-0 mb-3', header: 'p-4 sm:p-6', footer: 'p-0 sm:p-0' }">
    <!-- Drop Zone -->
    <div class="border-2 border-dashed rounded-lg p-8 text-center transition-colors duration-200" :class="[
      dragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
    ]" @dragover.prevent="dragOver = true" @dragleave.prevent="dragOver = false" @drop.prevent="handleDrop">
      <UIcon name="i-lucide-cloud-upload" class="w-16 h-16 mx-auto mb-4 text-gray-400" />
      <p class="text-lg font-medium mb-2 text-gray-900 dark:text-white">
        {{ $t('media.drop_browse', dropText) }}
      </p>
      <p class="text-sm text-gray-500 mb-4">
        {{ $t('media.description_text', descriptionText) }}
      </p>
      <input id="file-input" type="file" multiple :accept="accept" class="hidden" @change="handleFileSelect">
      <label for="file-input">
        <UButton as="span" color="primary" variant="soft" class="cursor-pointer">
          {{ $t('media.browse_text', browseText) }}
        </UButton>
      </label>
    </div>
    <!-- File List -->
    <div v-if="files.length > 0" class="mt-6 space-y-2 max-h-[50vh] sm:max-h-[39vh] overflow-y-auto pr-2">
      <div v-for="(file, index) in files" :key="index"
        class="flex items-center gap-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
        <!-- File Icon/Preview -->
        <div class="shrink-0 w-12 h-12 rounded overflow-hidden bg-gray-100 flex items-center justify-center">
          <NuxtImg v-if="previews[file.name]" :src="previews[file.name]" class="w-full h-full object-cover"
            alt="Preview" />
          <UIcon v-else name="i-lucide-file" class="w-8 h-8 text-gray-400" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-center mb-1">
            <p class="font-medium truncate text-gray-900 dark:text-white"
              :class="{ 'text-red-500': uploadStatus[file.name] === 'error' }">
              {{ file.name }}
            </p>
            <p class="text-sm text-gray-500">
              {{ formatFileSize(file.size) }}
            </p>
          </div>
          <!-- Progress Bar -->
          <div v-if="uploading && uploadStatus[file.name] !== 'error' && uploadStatus[file.name] !== 'success'">
            <UProgress :model-value="uploadProgress[file.name]" :max="100" size="xs" color="primary" />
            <p class="text-xs text-gray-500 mt-1 text-right">
              {{ Math.round(uploadProgress[file.name] || 0) }}%
            </p>
          </div>
          <div v-else-if="uploadStatus[file.name] === 'error'" class="text-red-500 text-xs">
            {{ $t('media.upload_error') }}
          </div>
        </div>
        <UButton v-if="!uploading && uploadStatus[file.name] !== 'success'" color="error" variant="ghost"
          icon="i-lucide-trash-2" size="sm" @click="removeFile(index)" />
        <div v-if="uploadStatus[file.name] === 'success'" class="text-green-500">
          <UIcon name="i-lucide-check-circle" class="w-5 h-5" />
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex items-center justify-between w-full">
        <p class="text-sm text-gray-600 dark:text-gray-400 font-medium">
          {{ files.length }} {{ $t('media.selected_files_text', selectedFilesText) }}
        </p>
        <div class="flex gap-2">
          <!-- <UButton color="neutral" variant="ghost" :disabled="uploading" @click="$emit('close')">
            {{ $t('common.cancel', cancelText) }}
          </UButton> -->
          <UButton color="primary" variant="soft" :loading="uploading" :disabled="files.length === 0 || uploading"
            @click="uploadFiles">
            {{ uploading ? ($t('media.uploading_text') || uploadingText) : ($t('media.confirm_upload') || uploadText) }}
          </UButton>
        </div>
      </div>
    </template>
  </UCard>
</template>
