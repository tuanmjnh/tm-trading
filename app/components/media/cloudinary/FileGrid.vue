<script setup lang="ts">
interface Props {
  files: Cloudinary.IResource[]
  selectedFiles: Cloudinary.IResource[]
  multiple?: boolean
  emptyText?: string
  previewText?: string
  renameText?: string
  deleteText?: string
  renameModalTitle?: string
  renameInputPlaceholder?: string
  cancelButtonText?: string
  renameButtonText?: string
  loading?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  emptyText: 'No files in this folder',
  previewText: 'Preview',
  renameText: 'Rename',
  deleteText: 'Delete',
  renameModalTitle: 'Rename File',
  renameInputPlaceholder: 'Enter new file name',
  cancelButtonText: 'Cancel',
  renameButtonText: 'Rename',
  loading: false
})
const emit = defineEmits<{
  select: [file: Cloudinary.IResource]
  delete: [file: Cloudinary.IResource]
  rename: [file: Cloudinary.IResource, newName: string]
}>()
const isSelected = (file: Cloudinary.IResource) => {
  return props.selectedFiles.some(f => f.public_id === file.public_id)
}
const handleSelect = (file: Cloudinary.IFileAttach | null) => {
  if (file) {
    emit('select', file as Cloudinary.IResource)
  }
}
const handleRename = (file: Cloudinary.IFileAttach) => {
  // ImageCard emits the file with updated display_name
  if (file && file.display_name) {
    emit('rename', file as Cloudinary.IResource, file.display_name)
  }
}
// Preview
const isPreviewOpen = ref(false)
const previewFile = ref<Cloudinary.IFileAttach | null>(null)
const onPreview = (file: Cloudinary.IFileAttach) => {
  previewFile.value = file
  isPreviewOpen.value = true
}
</script>

<template>
  <div class="file-grid w-full min-h-full flex flex-col">
    <!-- Skeleton Loading -->
    <div v-if="loading" class="w-full">
      <div class="flex flex-wrap gap-5 sm:gap-6 w-full items-center justify-evenly py-2">
        <div
          v-for="i in 32"
          :key="i"
          class="w-[calc(50%-10px)] sm:w-[220px] aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0"
        >
          <USkeleton class="w-full h-full" />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="files.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-center text-gray-500 py-10"
    >
      <svg
        class="w-16 h-16 mx-auto mb-4 text-gray-400 opacity-20"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
      <p class="text-sm italic font-medium opacity-60">
        {{ $t('media.empty_text') || emptyText }}
      </p>
    </div>

    <!-- Files Grid -->
    <div v-else class="w-full">
      <div class="flex flex-wrap gap-5 sm:gap-6 w-full items-center justify-evenly py-2 pr-2 pb-32 sm:pb-2">
        <LazyMediaImageCard
          v-for="file in files"
          :key="file.public_id"
          :file="(file as any)"
          label-key="public_id"
          class="w-[calc(50%-10px)] sm:w-[220px] aspect-square flex-none"
          :is-show-selected="true"
          size="responsive"
          :is-selected="isSelected(file)"
          :show-name="true"
          @toggle="handleSelect"
          @delete="$emit('delete', file)"
          @rename="handleRename"
          @preview="onPreview(file as any)"
        />
      </div>
    </div>
    <!-- Preview Modal -->
    <LazyMediaImagePreview
      v-if="isPreviewOpen && previewFile"
      v-model:open="isPreviewOpen"
      :file="previewFile"
      :files="(files as any[])"
      @close="isPreviewOpen = false"
    />
  </div>
</template>
