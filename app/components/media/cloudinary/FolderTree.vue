<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  folders: Cloudinary.IFolder[]
  currentFolder: string
  newFolderText?: string
  placeholderText?: string
  createText?: string
  cancelText?: string
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  newFolderText: '+ New Folder',
  placeholderText: 'Folder name',
  createText: 'Create',
  cancelText: 'Cancel',
  loading: false
})

const emit = defineEmits<{
  'select': [folder: Cloudinary.IFolder]
  'create': [name: string]
  'delete': [folder: Cloudinary.IFolder]
  'load-children': [folder: string]
}>()

const expandedFolders = ref<Set<string>>(new Set(['root']))
const showCreateFolder = ref(false)
const newFolderName = ref('')
const auth = useAuth()
const isRoot = computed(() => auth.user.value?.permissions?.includes('*') || auth.user.value?.role === 'root')

const toggleFolder = async (folder: Cloudinary.IFolder) => {
  const isExpanded = expandedFolders.value.has(folder.path)
  if (isExpanded) {
    expandedFolders.value.delete(folder.path)
  } else {
    expandedFolders.value.add(folder.path)
    // Load children if not loaded
    if (folder.hasChildren && !folder.childrenLoaded) {
      const children = await (emit('load-children', folder.path) as unknown as Promise<Cloudinary.IFolder[]>)
      folder.children = children
      folder.childrenLoaded = true
    }
  }
}

const selectFolder = (folder: Cloudinary.IFolder) => {
  emit('select', folder)
}

const handleCreateFolder = () => {
  if (newFolderName.value.trim()) {
    emit('create', newFolderName.value.trim())
    newFolderName.value = ''
    showCreateFolder.value = false
  }
}

const isExpanded = (path: string) => expandedFolders.value.has(path)
const isActive = (path: string) => props.currentFolder === path
</script>

<template>
  <div class="folder-tree flex flex-col h-full min-h-0">
    <!-- Create Folder Modal -->
    <LazyUModal
      v-if="showCreateFolder"
      v-model:open="showCreateFolder"
      :title="$t('media.new_folder_text') || newFolderText"
    >
      <template #body>
        <UInput
          v-model="newFolderName"
          :placeholder="$t('media.folder_name_placeholder')"
          autofocus
          class="w-full"
          @keyup.enter="handleCreateFolder"
        />
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="showCreateFolder = false">
            {{ $t('common.cancel') }}
          </UButton>
          <UButton color="primary" variant="soft" @click="handleCreateFolder">
            {{ $t('common.create') }}
          </UButton>
        </div>
      </template>
    </LazyUModal>

    <!-- Scrollable Content -->
    <div class="flex-1 min-h-0 overflow-y-auto pr-1">
      <!-- Skeleton Loading -->
      <div v-if="loading" class="space-y-2">
        <div v-for="i in 5" :key="i" class="flex items-center gap-2 px-2 py-1.5">
          <USkeleton class="w-4 h-4 rounded" />
          <USkeleton class="w-24 h-4 rounded" />
        </div>
      </div>

      <!-- Folder Tree -->
      <div v-else class="space-y-1">
        <!-- Root Folder Item -->
        <div
          :class="[
            'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition group/root',
            currentFolder === 'root' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
          ]"
          @click="selectFolder({ name: 'Root', path: 'root', external_id: null, children: [], hasChildren: true, childrenLoaded: true })"
        >
          <div class="w-4" />
          <UIcon
            name="i-lucide-home"
            class="w-4 h-4 shrink-0"
            :class="currentFolder === 'root' ? 'text-primary-500 fill-primary-500/20' : 'text-gray-400'"
          />
          <span class="text-[11px] flex flex-1 truncate font-bold uppercase tracking-wider">
            Root
          </span>

          <!-- Add Folder Icon next to Root -->
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-folder-plus"
            size="xs"
            :padded="false"
            class="rounded-full group-hover/root:opacity-100 transition-opacity"
            @click.stop="showCreateFolder = true"
          />
        </div>

        <USeparator v-if="folders.length > 0" class="my-1.5 opacity-50" />

        <div v-for="folder in folders" :key="folder.path" class="folder-item group">
          <div
            :class="[
              'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition',
              isActive(folder.path) ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
            ]"
            @click="selectFolder(folder)"
          >
            <!-- Expand/Collapse Icon -->
            <button
              v-if="folder.hasChildren"
              class="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
              @click.stop="toggleFolder(folder)"
            >
              <UIcon
                name="i-lucide-chevron-right"
                class="w-3 h-3 transition-transform duration-200"
                :class="{ 'rotate-90': isExpanded(folder.path) }"
              />
            </button>
            <div v-else class="w-4" />

            <!-- Folder Icon -->
            <UIcon
              name="i-lucide-folder"
              class="w-4 h-4 shrink-0"
              :class="isActive(folder.path) ? 'text-primary-500 fill-primary-500/20' : 'text-gray-400'"
            />

            <!-- Folder Name -->
            <span class="text-sm flex-1 truncate font-medium">{{ folder.name }}</span>

            <!-- Delete Button -->
            <UButton
              v-if="isRoot && folder.path !== 'root'"
              class="rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              size="xs"
              :padded="false"
              @click.stop="$emit('delete', folder)"
            />
          </div>

          <!-- Children -->
          <div
            v-if="isExpanded(folder.path) && folder.children"
            class="ml-4 mt-1 space-y-1 border-l border-gray-100 dark:border-gray-800 pl-1"
          >
            <div
              v-for="child in folder.children"
              :key="child.path"
              :class="[
                'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition',
                isActive(child.path) ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              ]"
              @click="selectFolder(child)"
            >
              <UIcon
                name="i-lucide-folder"
                class="w-4 h-4 shrink-0"
                :class="isActive(child.path) ? 'text-primary-500 fill-primary-500/20' : 'text-gray-400'"
              />
              <span class="text-sm flex-1 truncate font-medium">{{ child.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.folder-item:hover .opacity-0 {
  opacity: 1;
}
</style>
