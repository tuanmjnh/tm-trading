<script setup lang="ts">
import { useDebounceFn, useInfiniteScroll } from '@vueuse/core'

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  mode?: 'inline' | 'popover'
  defaultIcon?: string
  isIcon?: boolean
  hideInput?: boolean
}>(), {
  mode: 'inline',
  defaultIcon: 'i-lucide:image-plus',
  isIcon: false,
  hideInput: false
})

// Unified display type detection for reliability across Vercel/Local
const displayType = computed(() => detectDisplayType(props.modelValue))
const isActuallySvg = computed(() => displayType.value === 'svg')
const isActuallyImage = computed(() => displayType.value === 'image')

const emit = defineEmits(['update:modelValue', 'select'])

// 1. Manage API parameters centrally in object filters
const filters = reactive({
  search: '',
  collection: 'lucide',
  cursor: '',
  limit: 100
})

// Other States
const icons = ref<string[]>([])
const isFetching = ref(false)
const hasMore = ref(false)
const scrollParent = ref<HTMLElement | null>(null)

const collections = [
  { label: 'Lucide', value: 'lucide' },
  { label: 'Simple Icons', value: 'simple-icons' }
]

// 2. Fetch data function using object filters
async function fetchIcons(isLoadMore = false) {
  if (isFetching.value) return
  isFetching.value = true

  try {
    // If it doesn't need to load more, reset the cursor to empty.
    if (!isLoadMore) filters.cursor = ''

    interface IconsResponse {
      icons: string[]
      nextCursor: string
      hasMore: boolean
    }

    const data = await $fetch<IconsResponse>('/api/icons', { query: { ...filters } })
    if (isLoadMore) {
      icons.value.push(...(data.icons || []))
    } else {
      icons.value = data.icons || []
    }

    // Update cursor for the next load
    filters.cursor = data.nextCursor || ''
    hasMore.value = data.hasMore
  } catch (error) {
    console.error('Fetch icons error:', error)
  } finally {
    isFetching.value = false
  }
}

// 3. Debounce fetch when the user enters a filter
const debouncedFetch = useDebounceFn(() => {
  fetchIcons(false)
}, 500)

// 4. Infinite Scroll with VueUse
useInfiniteScroll(
  scrollParent,
  () => {
    if (hasMore.value && !isFetching.value) {
      fetchIcons(true)
    }
  },
  { distance: 50 }
)

const selectIcon = (icon: string) => {
  emit('update:modelValue', icon)
  emit('select', icon)
}

// 5. Watcher to watch changes in filters
// If collection changes -> fetch immediately. If search changes -> debounce fetch.
watch(() => filters.collection, () => {
  filters.search = ''
  filters.cursor = ''
  icons.value = []
  fetchIcons(false)
})
watch(() => filters.search, debouncedFetch)

onMounted(() => {
  fetchIcons()
})
</script>

<template>
  <div v-if="mode === 'inline'" class="flex flex-col gap-4">
    <div class="flex flex-col gap-3">
      <div class="flex gap-2">
        <UButton v-for="c in collections" :key="c.value" :variant="filters.collection === c.value ? 'solid' : 'soft'"
          size="xs" @click="filters.collection = c.value">
          {{ c.label }}
        </UButton>
      </div>
      <UInput v-model="filters.search" :placeholder="placeholder || $t('icon_selector.search_placeholder')"
        icon="i-lucide:search" class="w-full" />
    </div>

    <div class="border rounded-lg bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800">
      <div ref="scrollParent" class="grid grid-cols-6 sm:grid-cols-8 gap-2 p-3 max-h-64 overflow-y-auto scrollbar-thin">
        <UTooltip v-for="icon in icons" :key="icon" :text="icon" :popper="{ strategy: 'fixed' }">
          <button type="button"
            class="flex items-center justify-center p-2 rounded-md hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-all aspect-square border-2 border-transparent"
            :class="{ 'border-primary-500 bg-white dark:bg-gray-800 shadow-sm': modelValue === icon }"
            @click="selectIcon(icon)">
            <UIcon :name="icon" class="w-6 h-6" />
          </button>
        </UTooltip>

        <div v-if="isFetching" class="col-span-full py-6 flex justify-center">
          <UIcon name="i-lucide:loader-2" class="w-6 h-6 animate-spin text-primary-500" />
        </div>

        <div v-if="!isFetching && icons.length === 0" class="col-span-full py-10 text-center text-gray-400 text-sm">
          {{ $t('icon_selector.no_icons') }}
        </div>
      </div>
    </div>
  </div>

  <UPopover v-else :popper="{ placement: 'bottom-start' }">
    <template #default>
      <div class="w-full">
        <div v-if="isIcon" class="w-6 h-6 flex items-center justify-center shrink-0">
          <div v-if="isActuallySvg" class="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
            v-html="sanitizeSvg(modelValue || '')" />
          <NuxtImg v-else-if="isActuallyImage" :src="modelValue" class="w-full h-full object-contain" width="24"
            height="24" />
          <UIcon v-else :name="modelValue || defaultIcon"
            class="w-full h-full cursor-pointer text-gray-600 hover:text-primary-500" />
        </div>
        <UButton v-else-if="hideInput" color="neutral" variant="ghost" :icon="modelValue || defaultIcon" />
        <UInput v-else :model-value="modelValue" readonly class="cursor-pointer w-full"
          :placeholder="$t('common.select_icon')">
          <template #leading>
            <div class="w-5 h-5 flex items-center justify-center shrink-0">
              <div v-if="isActuallySvg"
                class="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full text-gray-500"
                v-html="sanitizeSvg(modelValue || '')" />
              <NuxtImg v-else-if="isActuallyImage" :src="modelValue" class="w-full h-full object-contain" width="20"
                height="20" />
              <UIcon v-else :name="modelValue || defaultIcon" class="w-full h-full text-gray-500" />
            </div>
          </template>
        </UInput>
      </div>
    </template>

    <template #content="{ close }">
      <div class="p-4 w-72 sm:w-80 flex flex-col gap-4">
        <div class="flex gap-2">
          <UButton v-for="c in collections" :key="c.value"
            :variant="filters.collection === c.value ? 'outline' : 'soft'" size="xs"
            @click="filters.collection = c.value">
            {{ c.label }}
          </UButton>
        </div>
        <UInput v-model="filters.search" icon="i-lucide:search" size="sm" autofocus />
        <div ref="scrollParent"
          class="grid grid-cols-5 gap-2 max-h-60 overflow-y-auto p-1 border rounded bg-gray-50 dark:bg-gray-900/50">
          <button v-for="icon in icons" :key="icon"
            class="p-2 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 flex items-center justify-center aspect-square transition-colors"
            :class="{ 'bg-primary-100 ring-2 ring-primary-500': modelValue === icon }"
            @click="selectIcon(icon); close()">
            <UIcon :name="icon" class="w-6 h-6" />
          </button>
          <div v-if="isFetching" class="col-span-full py-2 flex justify-center">
            <UIcon name="i-lucide:loader-2" class="w-4 h-4 animate-spin" />
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
