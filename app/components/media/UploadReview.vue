<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    open: boolean
    files: File[]
    folder?: string | null
    multiple?: boolean
  }>(),
  {
    folder: '',
    multiple: true
  }
)
const emit = defineEmits<{
  'update:open': [value: boolean]
  'close': []
  'done': [files: Cloudinary.UploadedResponse[]]
}>()
const { uploadToCloudinary } = useCloudinary()
const toast = useToast()
const { t } = useI18n()
import { getErrorMessage } from '~/shared/utils/errors'
const fileList = ref<File[]>([])
const uploading = ref(false)
const uploadProgress = ref<Record<string, number>>({})
const uploadStatus = ref<Record<string, 'pending' | 'success' | 'error'>>({})
const previews = ref<Record<string, string>>({})
const isOpen = computed({
  get: () => props.open,
  set: (val) => {
    emit('update:open', val)
    if (!val) emit('close')
  }
})
// Initialize files from props
watch(() => props.files, (newFiles) => {
  // Clear old previews to avoid memory leaks
  Object.values(previews.value).forEach(url => URL.revokeObjectURL(url))
  previews.value = {}
  if (newFiles) {
    let filesToProcess = newFiles
    if (!props.multiple && newFiles.length > 1) {
      const first = newFiles[0]
      if (first) filesToProcess = [first]
    }
    fileList.value = [...filesToProcess]
    filesToProcess.forEach((file) => {
      if (file.type.startsWith('image/')) {
        previews.value[file.name] = URL.createObjectURL(file)
      }
    })
  }
}, { immediate: true })
onUnmounted(() => {
  Object.values(previews.value).forEach(url => URL.revokeObjectURL(url))
})
const removeFile = (index: number) => {
  const file = fileList.value[index]
  if (file) {
    const previewUrl = previews.value[file.name]
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      const { [file.name]: _removed, ...rest } = previews.value
      previews.value = rest
    }
  }
  fileList.value.splice(index, 1)
  if (fileList.value.length === 0) {
    isOpen.value = false
  }
}
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
const handleUpload = async () => {
  if (fileList.value.length === 0) return
  uploading.value = true
  const uploadedFiles: Cloudinary.UploadedResponse[] = []
  let successCount = 0
  let errorCount = 0
  // Reset statuses
  fileList.value.forEach((f) => {
    uploadStatus.value[f.name] = 'pending'
  })
  const CONCURRENCY = 3
  const queue = [...fileList.value]
  const processing = new Set<Promise<void>>()
  const processFile = async (file: File) => {
    try {
      uploadStatus.value[file.name] = 'pending'
      uploadProgress.value[file.name] = 0
      const result = await uploadToCloudinary(file, props.folder || undefined, (progress) => {
        uploadProgress.value[file.name] = progress
      })
      uploadedFiles.push({
        public_id: result.public_id,
        url: result.secure_url || result.url,
        secure_url: result.secure_url,
        resource_type: result.resource_type,
        format: result.format,
        bytes: result.bytes,
        created_at: new Date().toISOString(),
        width: result.width,
        height: result.height,
        display_name: result.original_filename
      } as Cloudinary.UploadedResponse)
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
      toast.add({
        title: t('media.upload_success', 'Upload complete'),
        description: `${successCount} ${t('media.upload_success_description', 'file(s) uploaded successfully')}`,
        color: 'success'
      })
      emit('done', uploadedFiles)
    }
    if (errorCount === 0) {
      isOpen.value = false
    } else {
      toast.add({
        title: t('media.upload_error', 'Upload error'),
        description: `${errorCount} ${t('media.upload_error_description', 'file(s) failed to upload')}`,
        color: 'error'
      })
    }
  } catch (error) {
    toast.add({
      title: t('media.upload_error', 'Upload error'),
      description: getErrorMessage(error, key => t(key)),
      color: 'error'
    })
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <LazyBaseResponsiveModal v-model:open="isOpen" :disabled="uploading"
    :title="`${$t('media.upload_review_title', 'Review Upload')} (${fileList.length})`"
    :description="$t('media.upload_review_desc')" :ui="{ body: 'p-0 sm:p-0', width: 'sm:max-w-xl' }">
    <template #body>
      <div class="p-3">
        <div class="space-y-2 max-h-[80vh] sm:max-h-[60vh] overflow-y-auto pr-2">
          <div v-for="(file, index) in fileList" :key="index"
            class="flex items-center gap-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
            <!-- File Icon/Preview -->
            <div class="shrink-0 w-12 h-12 rounded overflow-hidden bg-gray-100 flex items-center justify-center">
              <template v-if="previews[file.name]">
                <img v-if="isSpecialImage(file.name)" :src="previews[file.name]" class="w-full h-full object-cover"
                  alt="Preview">
                <NuxtImg v-else :src="previews[file.name]" class="w-full h-full object-cover" alt="Preview" />
              </template>
              <UIcon v-else name="i-lucide-file-image" class="w-8 h-8 text-gray-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-center mb-1">
                <p class="font-medium truncate text-gray-900 dark:text-white">
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
            <div v-else-if="uploadStatus[file.name] === 'success'" class="text-green-500">
              <UIcon name="i-lucide-check-circle" class="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex items-center justify-between w-full">
        <p class="text-sm text-gray-600 dark:text-gray-400 font-medium">
          {{ fileList.length }} {{ $t('media.selected_files_text', 'file(s) selected') }}
        </p>
        <div class="flex gap-2">
          <!-- <UButton color="neutral" variant="ghost" :disabled="uploading" @click="isOpen = false">
            {{ $t('common.cancel', 'Cancel') }}
          </UButton> -->
          <UButton color="primary" variant="soft" :loading="uploading" :disabled="fileList.length === 0 || uploading"
            @click="handleUpload">
            {{ uploading ? $t('media.uploading_text', 'Uploading...') : $t('media.confirm_upload', 'Confirm Upload') }}
          </UButton>
        </div>
      </div>
    </template>
  </LazyBaseResponsiveModal>
</template>
