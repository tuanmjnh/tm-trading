<script setup lang="ts">
const { t } = useI18n()
const { fetchConfig } = useCloudinary()
const { data: mediaConfigResponse } = await useAsyncData('media-config', () => fetchConfig())
const mediaStore = useMediaStore()
const isConfirmClearHistory = ref(false)
const loading = ref(true)

onMounted(() => {
  loading.value = false
})

const isCloudinaryConnected = computed(() => {
  return !!mediaConfigResponse.value?.data?.cloudinary?.connected
})

const items = computed(() => {
  const tabs = [
    {
      label: t('media.local'),
      slot: 'local',
      icon: 'i-lucide-computer'
    }
  ]

  if (isCloudinaryConnected.value) {
    tabs.push({
      label: t('media.cloudinary'),
      slot: 'cloudinary',
      icon: 'i-simple-icons-cloudinary'
    })
  }

  return tabs
})

const toFile = (link: string) => ({
  public_id: link,
  url: link,
  thumbnail_url: link,
  resource_type: 'image',
  format: 'url',
  created_at: new Date().toISOString(),
  display_name: link.split('/').pop() || link
}) as Cloudinary.IFileAttach
</script>

<template>
  <BasePage id="media" :title="t('media.title')">
    <template #default>
      <div class="flex-1 flex flex-col min-h-0 relative">
        <!-- UTabs requires flex-1 min-h-0 so child slots can scroll -->
        <UTabs
          :items="items"
          class="flex-1 flex flex-col min-h-0"
          :ui="{ list: 'px-4 sm:px-6 shrink-0', content: 'flex-1 min-h-0 flex flex-col' }"
        >
          <template #local>
            <!-- Loading skeleton -->
            <div v-if="loading" class="h-full px-4 sm:px-6 py-4 overflow-y-auto">
              <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
                <USkeleton v-for="i in 16" :key="i" class="aspect-square w-full rounded-lg" />
              </div>
            </div>

            <!-- Empty state -->
            <div
              v-else-if="mediaStore.linkHistory.value.length === 0"
              class="h-full px-4 sm:px-6 py-4 flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50"
            >
              <div class="text-center">
                <UIcon name="i-lucide-computer" class="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  {{ t('media.local_storage') }}
                </h3>
                <p class="text-gray-500 dark:text-gray-400">
                  {{ t('media.no_history') }}
                </p>
              </div>
            </div>

            <!-- History list -->
            <div v-else class="flex flex-col h-full w-full relative">
              <div class="flex-1 overflow-y-auto px-4 sm:px-6 py-4 pb-24 custom-scrollbar">
                <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
                  <LazyMediaImageCard
                    v-for="link in mediaStore.linkHistory.value"
                    :key="link"
                    :file="toFile(link)"
                    @delete="mediaStore.removeHistory(link)"
                  />
                </div>
              </div>
              <!-- Manual Absolute Footer (Glassmorphism) -->
              <div
                class="fixed sm:absolute bottom-0 left-0 right-0 z-50 py-4 sm:py-3 px-5 sm:px-6 bg-white/80 dark:bg-gray-900/80 sm:bg-white/10 sm:dark:bg-gray-900/10 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3 shadow-[0_-10px_20px_-5px_rgba(0,0,0,0.05)] sm:shadow-none"
              >
                <!-- Left: Totals -->
                <div class="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                  <span class="text-xs uppercase tracking-wider opacity-50 font-bold text-gray-500 dark:text-gray-400">
                    {{ t('common.total') }}
                  </span>
                  <span class="text-primary text-xs">
                    {{ mediaStore.linkHistory.value.length }} {{ t('common.records') }}
                  </span>
                </div>

                <!-- Right: Actions -->
                <div class="flex items-center gap-2">
                  <UButton
                    color="error"
                    variant="soft"
                    icon="i-lucide-trash-2"
                    size="md"
                    :label="t('common.clear')"
                    class="w-full sm:w-auto font-bold px-6"
                    @click="isConfirmClearHistory = true"
                  />
                </div>
              </div>
            </div>
          </template>

          <template #cloudinary>
            <!-- flex-1 min-h-0 allows Cloudinary component internal scroll -->
            <div class="flex flex-col h-full p-0 overflow-hidden">
              <LazyMediaCloudinary
                class="flex-1 min-h-0"
                mode="page"
                :header-text="t('media.title')"
                :search-text="t('common.search')"
                :upload-text="t('media.upload_text')"
                :select-text="t('common.select')"
                :selected-text="t('media.selected_files_text')"
                :loading-folders-error="t('media.loading_folders_error')"
                :loading-files-error="t('media.loading_files_error')"
                :folder-created-title="t('media.folder_created_title')"
                :folder-created-text="t('media.folder_created_text')"
                :folder-create-error="t('media.folder_create_error')"
                :file-deleted-title="t('media.file_deleted_title')"
                :folder-deleted-title="t('media.folder_deleted_title')"
                :delete-error="t('media.delete_error')"
                :file-renamed-title="t('media.file_renamed_title')"
                :rename-error="t('media.rename_error')"
                :delete-title="t('common.delete')"
                :delete-message="t('common.confirm_delete')"
                :confirm-text="t('common.delete')"
                :cancel-text="t('common.cancel')"
                :rename-title="t('media.rename_modal_title')"
                :rename-text="t('media.rename_input_placeholder')"
              />
            </div>
          </template>
        </UTabs>
      </div>

      <LazyBaseConfirmModal
        v-model:open="isConfirmClearHistory"
        :title="t('confirm.delete_title')"
        :description="t('media.clear_history_desc')"
        :confirm-label="t('common.confirm')"
        :cancel-label="t('common.cancel')"
        color="error"
        @confirm="() => {
          mediaStore.clearHistory()
          isConfirmClearHistory = false
        }"
      />
    </template>
  </BasePage>
</template>
