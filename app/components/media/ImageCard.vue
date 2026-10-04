<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const { t } = useI18n()
const toast = useToast()
const auth = useAuth()
const isRoot = computed(() => auth.user.value?.permissions?.includes('*') || auth.user.value?.role === 'root')
// import FilePreview from './FilePreview.vue'
const props = withDefaults(
  defineProps<{
    file: Cloudinary.IFileAttach | null
    isShowSelected?: boolean
    isSelected?: boolean
    size?: string | number
    fit?: 'cover' | 'contain'
    labelKey?: 'display_name' | 'public_id'
    showName?: boolean
    hideActions?: boolean
    dropText?: string
    descriptionText?: string
    errorText?: string
    customEdit?: boolean
  }>(),
  {
    fit: 'cover',
    labelKey: 'display_name',
    showName: true,
    hideActions: false,
    errorText: 'File Error',
    customEdit: false
  }
)
const emit = defineEmits<{
  'upload': []
  'preview': [file: Cloudinary.IFileAttach | null]
  'edit': [file: Cloudinary.IFileAttach | null]
  'delete': [file: Cloudinary.IFileAttach | null]
  'toggle': [file: Cloudinary.IFileAttach | null]
  'rename': [file: Cloudinary.IFileAttach]
  'add-direct': []
  'add-link': []
  'add-library': []
  'drop': [files: FileList]
}>()
// const previewPopup = ref()
const imageError = ref(false)
const imageLoaded = ref(false)
const handleImageError = () => {
  imageError.value = true
  imageLoaded.value = true
}
const handleImageLoad = () => {
  imageLoaded.value = true
}
const isNoFile = computed(() => !props.file)
const cardSize = computed(() => {
  const val = props.size
  if (!val) return { width: '160px', height: '120px', full: false }
  // FULL / AUTO
  if (val === 'full' || val === 'auto') {
    return { width: '100%', height: 'auto', full: true }
  }
  // FILL
  if (val === 'fill') {
    return { width: '100%', height: '100%', full: false }
  }
  // RESPONSIVE
  if (val === 'responsive') {
    return { width: undefined, height: undefined, full: false }
  }
  // NUMBER = square pixels
  if (!isNaN(Number(val))) {
    const px = val + 'px'
    return { width: px, height: px, full: false }
  }
  const v = val.toString()
  // WxH format (e.g. "100%x200px", "300x200", "100%xauto")
  if (v.includes('x')) {
    const [w, h] = v.split('x')
    if (w && h) {
      const getVal = (x: string) => !isNaN(Number(x)) ? x + 'px' : x
      return { width: getVal(w), height: getVal(h), full: false }
    }
  }
  // Single value with unit (e.g. "120px", "100%")
  return { width: v, height: v, full: false }
})
const onPreview = (file: Cloudinary.IFileAttach | null) => {
  emit('preview', file)
}
// Rename functionality
const isRenameModalOpen = ref(false)
const itemToRename = ref<Cloudinary.IFileAttach | null>(null)
const openRenameModal = (file: Cloudinary.IFileAttach | null) => {
  if (!file) return
  itemToRename.value = file
  isRenameModalOpen.value = true
}
const handleRenameUpdate = (updatedFile: Cloudinary.IFileAttach) => {
  // Mutate directly as requested before, but now using the returned object
  if (itemToRename.value) {
    itemToRename.value.display_name = updatedFile.display_name
    emit('rename', itemToRename.value)
  }
}
const getAlt = computed(() => {
  const file = props.file as unknown as Record<string, unknown>
  return String(file.public_id || file.display_name || file.name || file.text || file.label || file.title || 'Media File')
})
const imgDimensions = computed(() => {
  const val = props.size
  if (!val) return { width: 160, height: 120 }
  if (val === 'full' || val === 'auto' || val === 'fill') return undefined
  if (typeof val === 'number') return { width: val, height: val }
  if (!isNaN(Number(val))) return { width: Number(val), height: Number(val) }
  const str = val.toString()
  if (str.endsWith('px')) {
    const num = parseInt(str)
    return { width: num, height: num }
  }
  if (str.includes('x')) {
    const [w, h] = str.split('x')
    // If any dimension is percentage or auto, do not set explicit width/height attributes on NuxtImg
    // as it interprets numbers as pixels. Let CSS handle it.
    if (!w || !h || w.includes('%') || h.includes('%') || w === 'auto' || h === 'auto') {
      return undefined
    }
    return { width: parseInt(w), height: parseInt(h) }
  }
  // If single string value is percentage, return undefined
  if (str.endsWith('%')) return undefined
  return undefined
})

const availableActions = computed(() => {
  if (!props.file) return []
  const items = []

  if (props.isShowSelected) {
    items.push({
      label: props.isSelected ? t('common.unselect') || 'Unselect' : t('common.select') || 'Select',
      icon: props.isSelected ? 'i-lucide-circle-check' : 'i-lucide-circle',
      color: 'primary' as const,
      onClick: () => emit('toggle', props.file)
    })
  }

  items.push({
    label: t('common.preview') || 'Preview',
    icon: 'i-lucide-eye',
    color: 'info' as const,
    onClick: () => onPreview(props.file)
  })

  if (props.file.url) {
    items.push({
      label: t('common.copy_url') || 'Copy URL',
      icon: 'i-lucide-copy',
      color: 'neutral' as const,
      onClick: async () => {
        const url = props.file!.secure_url || props.file!.url!
        await navigator.clipboard.writeText(url)
        toast.add({
          title: t('common.copied_url') || 'Copied URL',
          icon: 'i-lucide-check-circle',
          color: 'success' as const
        })
      }
    })

    items.push({
      label: t('common.download') || 'Download',
      icon: 'i-lucide-download',
      color: 'secondary' as const,
      onClick: () => downloadFile(props.file!.secure_url || props.file!.url || '', props.file!.display_name || props.file!.public_id || 'image')
    })
  }

  items.push({
    label: t('common.edit') || 'Edit',
    icon: 'i-lucide-pencil',
    color: 'neutral' as const,
    onClick: () => props.customEdit ? emit('edit', props.file) : openRenameModal(props.file)
  })

  if (isRoot.value) {
    items.push({
      label: t('common.delete') || 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onClick: () => emit('delete', props.file)
    })
  }

  return [items]
})
const DEFAULT_CARD_CLASSES = 'relative rounded-xl overflow-hidden group transition-transform duration-200 bg-white dark:bg-gray-800'
watch(() => getImage(props.file, ['secure_url', 'thumbnail_url', 'url']), (newVal, oldVal) => {
  if (newVal !== oldVal) {
    imageError.value = false
    imageLoaded.value = false
  }
})
</script>

<template>
  <div
    v-bind="$attrs"
    :class="[
      DEFAULT_CARD_CLASSES,
      !isNoFile ? 'cursor-pointer hover:shadow-lg' : 'cursor-default',
      isSelected
        ? 'border border-primary-500 ring-2 ring-primary-500/20 shadow-md'
        : 'border border-gray-200 dark:border-gray-700'
    ]"
    :style="{ width: cardSize.width, height: cardSize.height }"
  >
    <!-- <div class="flex items-center justify-center bg-gray-200 dark:bg-gray-700 animate-pulse absolute inset-0 z-10"
      :style="{ width: '100%', height: cardSize.height }">
      <svg class="w-16 h-16 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
        stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
      </svg>
    </div> -->
    <LazyMediaUploadCard
      v-if="isNoFile"
      :drop-text="dropText"
      :description-text="descriptionText"
      @click-upload="$emit('add-direct')"
      @click-link="$emit('add-link')"
      @click-library="$emit('add-library')"
      @files-dropped="$emit('drop', $event)"
    />
    <template v-else>
      <!-- IMAGE ERROR -->
      <div
        v-if="imageError"
        class="flex flex-col items-center justify-center text-center bg-gray-100 dark:bg-gray-800 absolute inset-0 z-10"
        :style="{ width: '100%', height: cardSize.height }"
      >
        <svg
          class="w-8 h-8 text-red-500/80 dark:text-red-400/80 mb-1"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span
          class="text-[10px] flex w-full text-gray-500 font-medium items-center justify-center px-2 text-center whitespace-normal"
        >
          {{ $t('media.error_text', errorText) }}
        </span>
      </div>
      <!-- LOADING SKELETON -->
      <div
        v-if="!imageLoaded && !imageError"
        class="flex items-center justify-center bg-gray-200 dark:bg-gray-700 animate-pulse absolute inset-0 z-10"
        :style="{ width: '100%', height: cardSize.height }"
      >
        <!-- <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M4 16l4.586-4.586a2 2 0 012.828 0L14 14m0 0l-1.586-1.586a2 2 0 00-2.828 0L7 16m0 0l-1.586-1.586a2 2 0 00-2.828 0L2 14v4a2 2 0 002 2h16a2 2 0 002-2v-4a2 2 0 00-2-2h-3m-6 3h.01M16 11H8">
          </path>
        </svg> -->
        <svg
          class="w-16 h-16 text-gray-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
          />
        </svg>
      </div>
      <template v-if="!imageError">
        <!-- Raw SVG content -->
        <img class="hidden" :src="'/favicon.ico'" @load="handleImageLoad">
        <div
          v-if="isRawSvg(file?.url || '')"
          class="w-full h-full p-2 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full text-gray-700 dark:text-gray-200"
          :style="{ width: cardSize.width, height: cardSize.full ? 'auto' : cardSize.height }"
          v-html="sanitizeSvg(file?.url || '')"
        />

        <!-- .ico and .svg files -->
        <img
          v-else-if="isSpecialImage(file?.url)"
          :src="getImage(file, ['secure_url', 'thumbnail_url', 'url'])"
          :alt="getAlt"
          class="w-full h-full rounded-t-lg transition-opacity duration-300"
          :style="{ width: cardSize.width, height: cardSize.full ? 'auto' : cardSize.height }"
          :class="[{ 'opacity-0': !imageLoaded }, `object-${fit}`]"
          @load="handleImageLoad"
          @error="handleImageError"
        >

        <!-- Other images -->
        <NuxtImg
          v-else
          :src="getImage(file, ['secure_url', 'thumbnail_url', 'url'])"
          :alt="getAlt"
          :width="imgDimensions?.width"
          :height="imgDimensions?.height"
          format="webp"
          class="w-full h-full rounded-t-lg transition-opacity duration-300"
          :style="{ width: cardSize.width, height: cardSize.full ? 'auto' : cardSize.height }"
          loading="lazy"
          :class="[{ 'opacity-0': !imageLoaded }, `object-${fit}`]"
          @load="handleImageLoad"
          @error="handleImageError"
        />
      </template>
      <!-- ACTION OVERLAY -->
      <div
        v-if="!hideActions"
        class="absolute top-1 right-1 flex flex-col items-center gap-2 z-20 transition-all duration-100"
      >
        <!-- Action Trigger -->
        <UPopover :popper="{ placement: 'bottom-end', offsetDistance: 8 }">
          <template #default>
            <UButton
              icon="i-lucide-more-vertical"
              :color="isSelected ? 'primary' : 'neutral'"
              variant="link"
              size="xs"
              class="flex p-1.5 rounded-full backdrop-blur-md shadow-lg border transition-colors duration-100 text-white!"
              :class="[
                isSelected
                  ? 'bg-primary-500/80 border-primary-400'
                  : 'bg-gray-500/10 border-white/20 hover:bg-gray-500/20'
              ]"
              @click.stop
            />
          </template>
          <template #content="{ close }">
            <div class="p-1.5 w-40 flex flex-col gap-1">
              <template v-for="(group, gIdx) in availableActions" :key="gIdx">
                <UButton
                  v-for="(action, aIdx) in group"
                  :key="aIdx"
                  :color="action.color || 'neutral'"
                  variant="ghost"
                  :icon="action.icon"
                  :label="action.label"
                  class="w-full justify-start text-xs"
                  @click.stop="action.onClick(); close()"
                />
              </template>
            </div>
          </template>
        </UPopover>
      </div>
      <!-- NAME OVERLAY -->
      <div
        v-if="showName && !isNoFile"
        class="absolute bottom-0 left-0 right-0 bg-black/20 text-white/90 text-[10px] p-1 truncate text-center backdrop-blur-[1px] transition-opacity duration-300"
      >
        {{ file?.[labelKey] || file?.public_id }}
      </div>
    </template>
  </div>
  <!-- Rename Modal -->
  <LazyMediaRenameModal v-model:open="isRenameModalOpen" :file="itemToRename" @update="handleRenameUpdate" />
</template>
