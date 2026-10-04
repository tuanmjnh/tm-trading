<script setup lang="ts">
interface Props {
  open: boolean
  file: Cloudinary.IFileAttach
  files?: Cloudinary.IFileAttach[]
  errorText?: string
  nameLabel?: string
  formatLabel?: string
  sizeLabel?: string
  createdLabel?: string
  naText?: string
}
const props = withDefaults(defineProps<Props>(), {
  errorText: 'Cannot load image. Please check URL or network connection.',
  nameLabel: 'Name:',
  formatLabel: 'Format:',
  sizeLabel: 'Size:',
  createdLabel: 'Created:',
  naText: 'N/A',
  files: () => []
})
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:open', value: boolean): void
}>()
const isOpen = computed({
  get: () => props.open,
  set: (value) => {
    emit('update:open', value)
    if (!value) emit('close')
  }
})
const carouselRef = ref()
// Prepare items for carousel
const carouselItems = computed(() => {
  if (props.files && props.files.length > 0) {
    return props.files
  }
  return [props.file]
})
// Navigation State
const imageLoaded = ref<Record<string, boolean>>({})
const imageError = ref<Record<string, boolean>>({})
const getItemKey = (item: Cloudinary.IFileAttach) => item.public_id || item.url || `key-${carouselItems.value.indexOf(item)}`
// Initial Slide
const initialIndex = computed(() => {
  if (carouselItems.value.length <= 1) return 0
  const idx = carouselItems.value.findIndex(f => getItemKey(f) === getItemKey(props.file))
  return idx > -1 ? idx : 0
})
const currentIndex = ref(0)
const currentItem = computed(() => carouselItems.value[currentIndex.value] || props.file)
// Watch open to reset index or re-init if needed (UCarousel should handle startIndex on mount/remount)
// But since we use v-if or modal, it remounts.
watch(() => props.open, (val) => {
  if (val) {
    currentIndex.value = initialIndex.value
    // We can allow UCarousel to handle the jump via startIndex prop
  }
})
onMounted(() => {
  watch(carouselRef, (ref) => {
    if (ref?.emblaApi) {
      ref.emblaApi.on('select', () => {
        currentIndex.value = ref.emblaApi.selectedScrollSnap()
      })
      ref.emblaApi.on('reInit', () => {
        currentIndex.value = ref.emblaApi.selectedScrollSnap()
      })
    }
  })
})
const handleImageLoad = (id: string) => {
  imageLoaded.value[id] = true
}
const handleImageError = (id: string) => {
  imageError.value[id] = true
  imageLoaded.value[id] = true
}
const getFormattedSize = (bytes?: number | null) => {
  if (bytes) {
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    return `${(kb / 1024).toFixed(1)} MB`
  }
  return props.naText
}
const getAlt = computed(() => {
  const file = currentItem.value as unknown as Record<string, unknown>
  return String(file.public_id || file.display_name || file.name || file.text || file.label || file.title || 'Media File')
})
</script>

<template>
  <LazyBaseResponsiveModal
    v-model:open="isOpen"
    fullscreen
    :title="$t('common.slideshow') || 'Preview'"
    :ui="{ body: 'sm:p-0 p-0 flex-1 flex flex-col bg-gray-50 dark:bg-gray-950/80 backdrop-blur-sm overflow-hidden' }"
  >
    <template #header-right>
      <UButton
        v-if="currentItem?.url && !isIconify(currentItem.url)"
        color="neutral"
        variant="ghost"
        icon="i-lucide-download"
        :label="$t('common.download') || 'Download'"
        @click="downloadFile(currentItem.url || '', currentItem.display_name || currentItem.public_id || 'image')"
      />
    </template>
    <template #body>
      <div class="flex-1 w-full h-full min-h-0 relative group">
        <!-- Custom Navigation -->
        <button
          v-if="carouselItems.length > 1"
          class="flex absolute left-4 top-1/2 -translate-y-1/2 z-50 p-2 rounded-full bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 shadow-lg backdrop-blur-sm transition-all cursor-pointer"
          @click.stop="carouselRef?.emblaApi?.scrollPrev()"
        >
          <UIcon name="i-lucide-chevron-left" class="w-6 h-6 text-gray-900 dark:text-gray-100" />
        </button>
        <button
          v-if="carouselItems.length > 1"
          class="flex absolute right-4 top-1/2 -translate-y-1/2 z-50 p-2 rounded-full bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 shadow-lg backdrop-blur-sm transition-all cursor-pointer"
          @click.stop="carouselRef?.emblaApi?.scrollNext()"
        >
          <UIcon name="i-lucide-chevron-right" class="w-6 h-6 text-gray-900 dark:text-gray-100" />
        </button>
        <UCarousel
          ref="carouselRef"
          :items="carouselItems"
          :ui="{ item: 'basis-full flex flex-col h-full relative', container: 'h-full', viewport: 'h-full' }"
          class="w-full h-full"
          :arrows="false"
          :start-index="initialIndex"
          indicators
        >
          <template #default="{ item }">
            <div class="flex-1 relative flex items-center justify-center min-h-0 w-full h-full overflow-hidden">
              <!-- Loading State -->
              <div
                v-if="!imageLoaded[getItemKey(item)] && !isRawSvg(item.url || '') && !isIconify(item.url || '')"
                class="absolute inset-0 flex items-center justify-center text-gray-400 text-sm z-0"
              >
                <UIcon name="i-lucide-loader-2" class="w-12 h-12 animate-spin" />
              </div>
              <!-- Error Overlay -->
              <div
                v-if="imageError[getItemKey(item)]"
                class="absolute inset-0 bg-red-100/90 dark:bg-red-900/50 flex flex-col gap-2 items-center justify-center p-4 z-10"
              >
                <UIcon name="i-lucide-alert-circle" class="w-10 h-10 text-red-600/80 dark:text-red-400" />
                <p class="text-sm text-red-700 dark:text-red-300 font-semibold text-center">
                  {{ $t('media.error_text', errorText) }}
                </p>
              </div>
              <!-- The Image -->
              <template v-else>
                <!-- Raw SVG content support (for InputIcon preview) -->
                <div
                  v-if="isRawSvg(item.url || '')"
                  class="block w-full h-full [&>svg]:w-full [&>svg]:h-full object-scale-down transition-all duration-300 transform"
                  v-html="sanitizeSvg(item.url || '')"
                />

                <!-- Iconify icon support -->
                <div v-else-if="isIconify(item.url || '')" class="flex items-center justify-center w-full h-full">
                  <UIcon
                    :name="item.url || ''"
                    class="w-32 h-32 text-primary-500 transition-all duration-300 transform scale-110"
                  />
                </div>

                <!-- .ico and .svg files via standard <img> to avoid NuxtImg processing issues -->
                <img
                  v-else-if="isSpecialImage(item.url || '')"
                  :src="getImage(item, ['secure_url', 'thumbnail_url', 'url'])"
                  :alt="getAlt"
                  class="block w-full h-full object-scale-down transition-all duration-300 transform"
                  :class="{ 'opacity-0 scale-95': !imageLoaded[getItemKey(item)], 'opacity-100 scale-100': imageLoaded[getItemKey(item)] }"
                  @load="handleImageLoad(getItemKey(item))"
                  @error="handleImageError(getItemKey(item))"
                >

                <NuxtImg
                  v-else
                  :src="getImage(item, ['secure_url', 'thumbnail_url', 'url'])"
                  format="webp"
                  quality="100"
                  :alt="getAlt"
                  class="block w-full h-full object-scale-down transition-all duration-300 transform"
                  :class="{ 'opacity-0 scale-95': !imageLoaded[getItemKey(item)], 'opacity-100 scale-100': imageLoaded[getItemKey(item)] }"
                  loading="lazy"
                  @load="handleImageLoad(getItemKey(item))"
                  @error="handleImageError(getItemKey(item))"
                />
              </template>
            </div>
          </template>
        </UCarousel>
      </div>
    </template>
    <template #footer>
      <div v-if="currentItem" class="w-full">
        <div
          class="w-full max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-sm text-gray-700 dark:text-gray-300 justify-items-center text-center"
        >
          <div class="w-full truncate" :title="currentItem.public_id || ''">
            <strong class="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-0.5">Public
              ID</strong>
            {{ currentItem.public_id || naText }}
          </div>
          <div class="w-full truncate" :title="currentItem.display_name || ''">
            <strong class="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-0.5">{{
              $t('media.name_label', nameLabel) }}</strong>
            {{ currentItem.display_name || naText }}
          </div>
          <div class="w-full">
            <strong class="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-0.5">{{
              $t('media.format_label', formatLabel) }}</strong>
            <span class="uppercase badge">{{ currentItem.format || naText }}</span>
          </div>
          <div class="w-full">
            <strong class="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-0.5">{{
              $t('media.size_label', sizeLabel) }}</strong>
            {{ getFormattedSize(currentItem.bytes) }}
          </div>
        </div>
      </div>
    </template>
  </LazyBaseResponsiveModal>
</template>
