<script setup lang="ts">
import { z } from 'zod'
import { useInfiniteScroll, watchDebounced } from '@vueuse/core'

const props = defineProps<{
  open: boolean
  multiple?: boolean
}>()
const emit = defineEmits(['update:open', 'add'])
const { t } = useI18n()
const isOpen = computed({
  get: () => props.open,
  set: val => emit('update:open', val)
})

const mediaStore = useMediaStore()
// Helper to parse URLs from string (handles newlines and spaces)
const parseUrls = (input: string): string[] => {
  if (!input) return []
  // Split by newline or whitespace
  return input.split(/[\s\n]+/).map(l => l.trim()).filter(l => l.match(/^https?:\/\/.+/i))
}
const schema = z.object({
  url: z.string().min(1, t('error.required')).refine(val => parseUrls(val).length > 0, {
    message: t('error.invalid_url') || 'Invalid URL'
  })
})
const formRef = ref()
const state = reactive({
  url: ''
})
// State for preview files to support metadata editing (renaming)
const previewFiles = ref<Cloudinary.IFileAttach[]>([])
const loading = ref(false)
// History Management
const historyContainer = ref<HTMLElement | null>(null)
const displayedHistory = ref<string[]>([])
const historyPage = ref(1)
const historyPageSize = 10
// Navigation State
// Navigation State - Removed unused image loading handlers
const loadMoreHistory = () => {
  const start = 0
  const end = historyPage.value * historyPageSize
  const history = mediaStore.linkHistory.value
  displayedHistory.value = history.slice(start, end)
  if (end < history.length) {
    historyPage.value++
  }
}
// Reset history view when modal opens
watch(isOpen, (val) => {
  if (val) {
    historyPage.value = 1
    loadMoreHistory()
  } else {
    state.url = ''
    previewFiles.value = []
  }
})
// Use VueUse infinite scroll
useInfiniteScroll(historyContainer, () => {
  loadMoreHistory()
}, { distance: 10 })
const selectHistory = (link: string) => {
  if (props.multiple) {
    const current = state.url ? state.url + '\n' : ''
    state.url = current + link
  } else {
    state.url = link
  }
}
// Sync loop to update previewFiles from text input while preserving existing names
// Use debounced watch to avoid flickering while typing
watchDebounced(() => state.url, (val) => {
  const allUrls = parseUrls(val)
  // Decide which URLs to keep based on 'multiple' prop
  let urlsToKeep: string[] = []
  if (props.multiple) {
    // Keep unique URLs to avoid duplicate keys
    urlsToKeep = [...new Set(allUrls.filter(l => isImage(l)))]
  } else {
    const firstUrl = allUrls.find(l => isImage(l))
    urlsToKeep = firstUrl ? [firstUrl] : []
  }

  const newFiles: Cloudinary.IFileAttach[] = urlsToKeep.map((url, idx) => {
    // Check in both current previewFiles and a potential "recently seen" logic
    // Actually, just checking previewFiles is often enough if we don't clear it too aggressively
    const existing = previewFiles.value.find(f => f.url === url)
    if (existing) return existing

    return {
      public_id: 'link_' + Date.now() + '_' + idx,
      url: url,
      resource_type: 'image',
      format: 'url',
      created_at: new Date().toISOString(),
      display_name: url.split('/').pop() || `Linked Image ${idx + 1}`
    } as Cloudinary.IFileAttach
  })
  previewFiles.value = newFiles
}, { debounce: 500, maxWait: 2000 })
const removePreview = (file: Cloudinary.IFileAttach) => {
  const currentUrls = parseUrls(state.url)
  const newUrls = currentUrls.filter(u => u !== file.url)
  state.url = newUrls.join('\n')
}
const onSubmit = async () => {
  if (previewFiles.value.length === 0) return
  // Save to history
  const validUrls = parseUrls(state.url)
  if (validUrls.length > 0) {
    mediaStore.addHistory(validUrls)
  }
  if (props.multiple) {
    emit('add', previewFiles.value)
  } else {
    emit('add', previewFiles.value[0])
  }
  isOpen.value = false
  state.url = ''
  previewFiles.value = []
}
// Preview
const isFilePreview = ref(false)
const selectedFile = ref<Cloudinary.IFileAttach | null>(null)
const onPreview = (file: Cloudinary.IFileAttach) => {
  selectedFile.value = file
  isFilePreview.value = true
}
</script>

<template>
  <LazyBaseResponsiveModal v-model:open="isOpen" :title="multiple ? $t('media.insert_links') : $t('media.insert_link')">
    <!-- <template #header-right>
      <UButton type="submit" color="primary" variant="soft" class="cursor-pointer" :loading="loading"
      :label="$t('common.add')"  @click="formRef?.submit()" />
    </template> -->
    <template #body>
      <UForm
        ref="formRef"
        :schema="schema"
        :state="state"
        @submit="onSubmit"
      >
        <!-- URL Input Section -->
        <UFormField name="url" class="mb-3">
          <UTextarea
            v-if="multiple"
            v-model="state.url"
            :rows="3"
            :maxrows="3"
            autoresize
            placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg"
            class="w-full"
          />
          <UInput
            v-else
            v-model="state.url"
            placeholder="https://example.com/image.jpg"
            class="w-full"
          />
        </UFormField>

        <!-- Preview Section -->
        <div
          class="h-[39vh] md:h-[32vh] mb-6 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50/30 dark:bg-gray-800/20 gap-4 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] w-full justify-items-center transition-all shadow-inner"
        >
          <LazyMediaImageCard
            v-for="(file, index) in previewFiles"
            :key="file.public_id || file.url || index"
            :file="file"
            size="166px"
            class="aspect-square hover:scale-[1.02] transition-transform duration-200"
            :is-show-selected="false"
            :is-selected="false"
            @delete="removePreview(file)"
            @preview="onPreview(file)"
          />
        </div>

        <!-- History Section -->
        <div v-if="mediaStore.linkHistory.value.length > 0">
          <div class="text-sm font-semibold text-gray-500 mb-3 flex justify-between items-center px-1">
            <span class="flex items-center gap-2">
              <UIcon name="i-lucide-history" class="w-4 h-4" />
              {{ $t('media.history') }}
            </span>
            <UButton
              size="xs"
              color="error"
              variant="link"
              class="cursor-pointer"
              icon="i-lucide-trash-2"
              :label="$t('common.clear')"
              @click="mediaStore.clearHistory()"
            />
          </div>
          <div
            ref="historyContainer"
            class="h-[26vh] md:h-[22vh] overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-white/50 dark:bg-gray-900/50"
          >
            <LazyMediaImageCard
              v-for="link in displayedHistory"
              :key="link"
              :file="{
                public_id: link,
                url: link,
                thumbnail_url: link,
                resource_type: 'image',
                format: 'url',
                created_at: new Date().toISOString(),
                display_name: link
              } as any"
              size="120px"
              class="aspect-square"
              :hide-actions="true"
              @click="selectHistory(link)"
            />
            <div
              v-if="displayedHistory.length < mediaStore.linkHistory.value.length"
              class="col-span-full text-xs text-center py-2 text-gray-400 font-medium"
            >
              {{ $t('common.scroll_load') }}
            </div>
          </div>
        </div>
      </UForm>
    </template>
    <template #footer>
      <UButton
        block
        type="submit"
        color="primary"
        variant="soft"
        class="cursor-pointer"
        :loading="loading"
        :label="$t('common.add')"
        @click="formRef?.submit()"
      />
    </template>
  </LazyBaseResponsiveModal>
  <!-- Preview Modal -->
  <LazyMediaImagePreview
    v-if="isFilePreview && selectedFile"
    v-model:open="isFilePreview"
    :file="selectedFile"
    :files="previewFiles"
    @close="isFilePreview = false"
  />
</template>
