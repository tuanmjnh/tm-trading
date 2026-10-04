<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useInfiniteScroll } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

interface Props {
  class?: string
  mode?: 'modal' | 'page'
  multiple?: boolean
  deleteTitle?: string
  deleteMessage?: string
  confirmText?: string
  cancelText?: string
  renameTitle?: string
  renameText?: string
  headerText?: string
  searchText?: string
  uploadTitle?: string
  uploadText?: string
  uploadAccept?: string
  selectText?: string
  selectedText?: string
  loadingFoldersError?: string
  loadingFilesError?: string
  folderCreatedTitle?: string
  folderCreatedText?: string
  folderCreateError?: string
  fileDeletedTitle?: string
  folderDeletedTitle?: string
  deleteError?: string
  fileRenamedTitle?: string
  renameError?: string
}
const props = withDefaults(defineProps<Props>(), {
  class: '',
  mode: 'page',
  multiple: false,
  deleteTitle: 'Confirm Delete',
  deleteMessage: 'Are you sure you want to delete this item?',
  confirmText: 'Delete',
  cancelText: 'Cancel',
  renameTitle: 'Rename',
  renameText: 'Enter new name',
  headerText: 'Cloudinary Manager',
  searchText: 'Search files...',
  uploadTitle: 'Upload files',
  uploadText: 'Upload',
  uploadAccept: '*',
  selectText: 'Select',
  selectedText: 'file(s) selected',
  loadingFoldersError: 'Error loading folders',
  loadingFilesError: 'Error loading files',
  folderCreatedTitle: 'Folder created',
  folderCreatedText: 'Folder "{name}" created successfully',
  folderCreateError: 'Error creating folder',
  fileDeletedTitle: 'File deleted',
  folderDeletedTitle: 'Folder deleted',
  deleteError: 'Error deleting',
  fileRenamedTitle: 'File renamed',
  renameError: 'Error renaming file'
})
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'selected-files', files: Cloudinary.IResource[]): void
}>()
const {
  listFolders,
  listFiles,
  createFolder,
  deleteFolder,
  deleteFile,
  renameFile
} = useCloudinary()
const toast = useToast()
const { t } = useI18n()
// State
const loadingFolders = ref(false)
const loadingFiles = ref(false)
const loadingMore = ref(false)
const processingAction = ref(false)
const isUploading = ref(false)
const currentFolder = ref<string>('root')
const folders = ref<Cloudinary.IFolder[]>([])
const files = ref<Cloudinary.IResource[]>([])
const nextCursor = ref<string | null>(null)
const selectedFiles = ref<Cloudinary.IResource[]>([])
const searchQuery = ref('')
const showUpload = ref(false)
const showConfirmDelete = ref(false)
const itemToDelete = ref<Cloudinary.IResource | Cloudinary.IFolder | null>(null)
const deleteType = ref<'file' | 'folder'>('file')
const isSidebarOpen = ref(false) // Mobile slideover
const isDesktopSidebarOpen = ref(true) // Desktop collapse
const fileContainer = ref<HTMLElement | null>(null)
// Computed
const filteredFiles = computed(() => {
  if (!searchQuery.value) return files.value
  const query = searchQuery.value.toLowerCase()
  return files.value.filter(f =>
    f.public_id.toLowerCase().includes(query)
    || (f.display_name && f.display_name.toLowerCase().includes(query))
  )
})
const isModal = computed(() => props.mode === 'modal')
// Methods
const toggleSidebar = () => {
  if (window.innerWidth < 768) {
    isSidebarOpen.value = !isSidebarOpen.value
  } else {
    isDesktopSidebarOpen.value = !isDesktopSidebarOpen.value
  }
}
const loadFolders = async (folder: string = 'root') => {
  try {
    loadingFolders.value = true
    const response = await listFolders(folder)
    if (folder === 'root') {
      folders.value = response.folders
    }
    return response.folders
  } catch (e) {
    toast?.add({ title: t('media.loading_folders_error'), description: getErrorMessage(e, key => t(key)), color: 'error' })
    return []
  } finally {
    loadingFolders.value = false
  }
}
const loadFiles = async (folder: string = 'root', loadMore = false) => {
  if (loadMore && !nextCursor.value) return
  if (loadingFiles.value || (loadMore && loadingMore.value)) return
  try {
    if (loadMore) {
      loadingMore.value = true
    } else {
      loadingFiles.value = true
      nextCursor.value = null
    }
    const response = await listFiles(folder, {
      max_results: 32,
      next_cursor: loadMore && nextCursor.value ? nextCursor.value : undefined
    })
    if (loadMore) {
      files.value = [...files.value, ...(response.resources || [])]
    } else {
      files.value = response.resources || []
    }
    nextCursor.value = response.next_cursor || null
  } catch (e) {
    toast?.add({ title: t('media.loading_files_error'), description: getErrorMessage(e, key => t(key)), color: 'error' })
    if (!loadMore) files.value = []
  } finally {
    loadingFiles.value = false
    loadingMore.value = false
  }
}
// Infinite Scroll
useInfiniteScroll(fileContainer, () => {
  if (nextCursor.value && !loadingFiles.value && !loadingMore.value) {
    loadFiles(currentFolder.value, true)
  }
}, { distance: 50 })
const handleFolderSelect = async (folder: Cloudinary.IFolder) => {
  currentFolder.value = folder.path
  if (fileContainer.value) fileContainer.value.scrollTop = 0
  await loadFiles(folder.path)
}
const handleFileSelect = (file: Cloudinary.IResource) => {
  if (props.multiple) {
    const index = selectedFiles.value.findIndex(f => f.public_id === file.public_id)
    if (index > -1) {
      selectedFiles.value.splice(index, 1)
    } else {
      selectedFiles.value.push(file)
    }
  } else {
    const firstSelected = selectedFiles.value[0]
    if (selectedFiles.value.length > 0 && firstSelected?.public_id === file.public_id) {
      selectedFiles.value = []
    } else {
      selectedFiles.value = [file]
    }
  }
}
const handleCreateFolder = async (name: string) => {
  try {
    loadingFolders.value = true
    const folderPath = `${currentFolder.value === 'root' ? '' : currentFolder.value + '/'}${name}`
    await createFolder(folderPath)
    toast?.add({ title: t('media.folder_created_title'), description: t('media.folder_created_text', { name }), color: 'success' })
    folders.value.push({
      name: name,
      path: folderPath,
      external_id: null,
      children: [],
      hasChildren: false,
      childrenLoaded: true
    })
    folders.value.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    toast?.add({ title: t('media.folder_create_error'), description: getErrorMessage(error, key => t(key)), color: 'error' })
  } finally {
    loadingFolders.value = false
  }
}
const handleDeleteFile = (file: Cloudinary.IResource) => {
  itemToDelete.value = file
  deleteType.value = 'file'
  showConfirmDelete.value = true
}
const handleDeleteFolder = (folder: Cloudinary.IFolder) => {
  itemToDelete.value = folder
  deleteType.value = 'folder'
  showConfirmDelete.value = true
}
const confirmDelete = async () => {
  const target = itemToDelete.value
  if (!target) return
  try {
    if (deleteType.value === 'file' && 'public_id' in target) {
      processingAction.value = true
      await deleteFile(target.public_id)
      files.value = files.value.filter(f => f.public_id !== target.public_id)
      toast?.add({ title: t('media.file_deleted_title'), color: 'success' })
    } else if ('path' in target) {
      loadingFolders.value = true
      await deleteFolder(target.path)
      folders.value = folders.value.filter(f => f.path !== target.path)
      toast?.add({ title: t('media.folder_deleted_title'), color: 'success' })
    }
  } catch (error) {
    toast?.add({ title: t('media.delete_error'), description: getErrorMessage(error, key => t(key)), color: 'error' })
  } finally {
    processingAction.value = false
    loadingFolders.value = false
    showConfirmDelete.value = false
    itemToDelete.value = null
  }
}
const handleRenameFile = async (file: Cloudinary.IResource, newName: string) => {
  try {
    processingAction.value = true
    const pathParts = file.public_id.split('/')
    pathParts[pathParts.length - 1] = newName
    const newPublicId = pathParts.join('/')
    await renameFile(file.public_id, newPublicId)
    const index = files.value.findIndex(f => f.public_id === file.public_id)
    if (index !== -1) {
      const updatedFile = {
        ...files.value[index],
        public_id: newPublicId,
        display_name: newName,
        filename: newName
      } as Cloudinary.IResource
      files.value.splice(index, 1, updatedFile)
    }
    toast?.add({ title: t('media.file_renamed_title'), color: 'success' })
  } catch (error) {
    toast?.add({ title: t('media.rename_error'), description: getErrorMessage(error, key => t(key)), color: 'error' })
  } finally {
    processingAction.value = false
  }
}
const handleUploadComplete = async (uploadedFiles?: Cloudinary.UploadedResponse[]) => {
  showUpload.value = false
  if (uploadedFiles && uploadedFiles.length > 0) {
    const newResources: Cloudinary.IResource[] = uploadedFiles.map(file => ({
      ...file,
      created_at: file.created_at || new Date().toISOString(),
      display_name: file.original_filename || file.public_id.split('/').pop(),
      asset_id: undefined
    } as unknown as Cloudinary.IResource))
    files.value = [...newResources, ...files.value]
  } else {
    await loadFiles(currentFolder.value)
  }
}
const handleConfirmSelection = () => {
  emit('selected-files', selectedFiles.value)
  if (isModal.value) {
    emit('close')
  }
}
// Lifecycle
onMounted(async () => {
  loadFolders()
  loadFiles()
})

// Parent page (media.vue) drives desktop header/footer + mobile BottomNav actions through these.
const openUpload = () => { showUpload.value = true }
const reload = async () => {
  await Promise.all([loadFolders('root'), loadFiles(currentFolder.value)])
}
const setSearch = (q: string) => { searchQuery.value = q }
const getStats = () => ({
  count: files.value.length,
  loading: loadingFiles.value || loadingFolders.value || loadingMore.value || processingAction.value,
  folder: currentFolder.value
})

defineExpose({ openUpload, reload, toggleSidebar, setSearch, getStats })

</script>

<template>
  <!--
    Requirement: parent component must pass class="flex flex-col flex-1 min-h-0"
    for the flex chain layout to work properly.
  -->
  <div class="h-full w-full overflow-hidden relative min-h-0">
    <!-- Main UI Grid: modal = header/content/footer rows, page = content only (header/footer live in BasePage slots) -->
    <div class="grid h-full w-full overflow-hidden" :class="isModal ? 'grid-rows-[auto_1fr_auto]' : 'grid-rows-[1fr]'">
      <!-- Header: Row 1 (modal mode only — page mode renders search/upload via BasePage toolbar/header slots) -->
      <div
        v-if="isModal"
        class="shrink-0 flex flex-col sm:flex-row items-center justify-between border-b border-default gap-3 pb-3 px-1"
      >
        <div class="w-full sm:w-auto flex items-center gap-2 sm:flex-1 sm:max-w-md">
          <!-- Sidebar Toggle -->
          <UTooltip :text="$t('media.folder_text', 'Folders list')" class="hidden md:flex">
            <UButton
              color="neutral"
              variant="ghost"
              :icon="isDesktopSidebarOpen ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
              @click="toggleSidebar"
            />
          </UTooltip>
          <!-- Search -->
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            :placeholder="$t('common.search_placeholder')"
            class="w-full"
          />
        </div>
        <div class="hidden sm:flex items-center justify-end gap-2 w-full sm:w-auto">
          <UButton
            v-if="isModal && selectedFiles.length > 0"
            color="success"
            variant="soft"
            icon="i-lucide-check"
            class="flex-1 sm:flex-none justify-center"
            @click="handleConfirmSelection"
          >
            {{ $t('common.select', selectText) }} ({{ selectedFiles.length }})
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-upload"
            class="flex-1 sm:flex-none justify-center"
            @click="showUpload = true"
          >
            {{ $t('media.upload_text', uploadText) }}
          </UButton>
        </div>
      </div>

      <!-- Main Content: Row 2 (1fr) -->
      <div class="flex min-h-0 overflow-hidden relative">
        <!-- Sidebar - Folder Tree -->
        <div
          class="hidden md:block transition-all duration-300 border-r border-default h-full overflow-hidden"
          :class="[isDesktopSidebarOpen ? 'w-64' : 'w-0 border-none']"
        >
          <div class="w-64 h-full p-2">
            <LazyMediaCloudinaryFolderTree
              :folders="folders"
              :current-folder="currentFolder"
              :loading="loadingFolders"
              @select="handleFolderSelect"
              @create="handleCreateFolder"
              @delete="handleDeleteFolder"
              @load-children="loadFolders"
            />
          </div>
        </div>

        <!-- Mobile Slideover -->
        <LazyBaseResponsiveSlideover
          v-model:open="isSidebarOpen"
          side="left"
          :title="$t('media.folder_text', 'Folders list')"
          :description="$t('media.cloudinary', 'Cloudinary Manager')"
        >
          <template #body>
            <div class="h-full p-2">
              <LazyMediaCloudinaryFolderTree
                :folders="folders"
                :current-folder="currentFolder"
                :loading="loadingFolders"
                @select="(f) => { handleFolderSelect(f); isSidebarOpen = false }"
                @create="handleCreateFolder"
                @delete="handleDeleteFolder"
                @load-children="loadFolders"
              />
            </div>
          </template>
        </LazyBaseResponsiveSlideover>

        <!-- File Grid Area -->
        <div class="flex-1 min-h-0 relative p-2 overflow-hidden flex flex-col">
          <div ref="fileContainer" class="flex-1 min-h-0 relative overflow-y-auto custom-scrollbar"
            :class="isModal ? '' : 'pb-24 lg:pb-4'">
            <LazyMediaCloudinaryFileGrid
              :files="filteredFiles"
              :selected-files="selectedFiles"
              :multiple="multiple"
              :loading="loadingFiles"
              class="w-full min-h-full flex flex-col"
              @select="handleFileSelect"
              @delete="handleDeleteFile"
              @rename="handleRenameFile"
            />
          </div>
          <!-- Loading Indicator -->
          <div
            v-if="loadingFiles || loadingMore || processingAction"
            class="absolute inset-0 z-50 flex items-center justify-center bg-default/50 backdrop-blur-sm"
          >
            <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-primary" />
          </div>
        </div>
      </div>

      <!-- Footer Desktop: Row 3 (modal mode only — page mode uses BasePage #footer / SharedListFooter) -->
      <div
        v-if="isModal"
        class="shrink-0 hidden md:flex px-4 py-3 border-t border-default justify-between items-center bg-elevated/80 backdrop-blur-sm z-30 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
      >
        <div class="text-xs text-muted font-medium flex items-center gap-3">
          <div class="flex items-center gap-1.5 px-2 py-1 bg-elevated rounded-md">
            <UIcon
              :name="isModal ? 'i-lucide-check-square' : 'i-lucide-files'"
              class="w-4 h-4"
              :class="isModal && selectedFiles.length > 0 ? 'text-primary' : 'text-dimmed'"
            />
            <span v-if="isModal" class="tabular-nums">
              {{ selectedFiles.length }} {{ $t('media.selected_files_text') || selectedText }}
            </span>
            <span v-else class="tabular-nums">
              {{ files.length }} {{ $t('media.total_files_text') || 'files in folder' }}
            </span>
          </div>
          <span class="opacity-30">|</span>
          <span class="text-[10px] uppercase tracking-wider opacity-60">{{ currentFolder === 'root' ? 'ROOT'
            : currentFolder }}</span>
        </div>
        <div v-if="isModal && selectedFiles.length > 0" class="flex gap-2">
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash"
            size="xs"
            class="px-3"
            @click="selectedFiles = []"
          >
            {{ $t('common.clear', 'Clear') }}
          </UButton>
          <UButton
            color="success"
            variant="soft"
            icon="i-lucide-check"
            size="xs"
            @click="handleConfirmSelection"
          >
            {{ $t('common.select', selectText) }} ({{ selectedFiles.length }})
          </UButton>
        </div>
      </div>
    </div>

    <!-- Mobile Sticky Footer (modal mode only — page mode uses app BottomNav + Actions sheet) -->
    <div
      v-if="isModal"
      class="md:hidden fixed bottom-0 left-0 right-0 z-50 py-3 px-5 bg-elevated/90 backdrop-blur-md flex items-center justify-between gap-3 shadow-2xl border-t border-default"
    >
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-menu"
        class="md:hidden"
        @click="toggleSidebar"
      />
      <div v-if="isModal" class="flex flex-col flex-1 gap-1">
        <UButton
          :disabled="selectedFiles.length === 0"
          color="success"
          variant="soft"
          icon="i-lucide-check"
          class="justify-center w-full"
          :label="`${$t('common.select', selectText)} (${selectedFiles.length})`"
          @click="handleConfirmSelection"
        />
      </div>
      <UButton
        color="primary"
        variant="soft"
        icon="i-lucide-upload"
        class="flex-1 justify-center"
        @click="showUpload = true"
      >
        {{ $t('media.upload_text', uploadText) }}
      </UButton>
    </div>

    <!-- Modals -->
    <LazyBaseResponsiveModal
      v-model:open="showUpload"
      :ui="{ width: 'w-full sm:max-w-2xl' }"
      :disabled="isUploading"
      :title="$t('media.upload_title', uploadTitle)"
    >
      <template #body>
        <LazyMediaCloudinaryCloudUpload
          :folder="currentFolder"
          :accept="uploadAccept"
          @close="showUpload = false"
          @complete="handleUploadComplete"
          @uploading="isUploading = $event"
        />
      </template>
    </LazyBaseResponsiveModal>

    <LazyMediaConfirmModal
      v-model="showConfirmDelete"
      :file="itemToDelete"
      @confirm="confirmDelete"
      @cancel="showConfirmDelete = false"
    />
  </div>
</template>
