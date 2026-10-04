<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue'
import Sortable from 'sortablejs'

const props = withDefaults(
  defineProps<{
    modelValue: unknown
    label?: string
    class?: string
    multiple?: boolean
    size?: string | number
    folder?: string | null
    accept?: string
    dropText?: string
    descriptionText?: string
    customEdit?: boolean
    itemKey?: string
    sortable?: boolean
  }>(),
  {
    folder: null,
    accept: '*',
    itemKey: 'public_id',
    sortable: true
  }
)
const emit = defineEmits<{
  'update:modelValue': [value: Cloudinary.IFileAttach | Cloudinary.IFileAttach[] | null]
  'selected': [files: Cloudinary.IFileAttach[]]
  'preview': [file: Cloudinary.IFileAttach]
  'edit': [file: Cloudinary.IFileAttach]
  'delete': [file: Cloudinary.IFileAttach]
}>()
const showCloudinaryManager = ref(false)
const showUploadReview = ref(false)
const showLinkModal = ref(false)
const isConfirmDelete = ref(false)
const selectedFile = ref<Cloudinary.IFileAttach | null>(null)
const selectedIndex = ref<number | null>(null)
const selectedFiles = ref<Cloudinary.IFileAttach[]>([])
const pendingFiles = ref<File[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const isSelected = (file: Cloudinary.IFileAttach): boolean => {
  if (!file) return false
  const key = (props.itemKey && ((file as unknown as Record<string, unknown>)[props.itemKey] as string)) || file.public_id || file.url
  return selectedFiles.value.some((s) => {
    const sKey = (props.itemKey && ((s as unknown as Record<string, unknown>)[props.itemKey] as string)) || s.public_id || s.url
    return sKey === key
  })
}
const handleToggleFile = (file?: Cloudinary.IFileAttach | null) => {
  if (!file) return
  const exists = isSelected(file)
  const key = (props.itemKey && ((file as unknown as Record<string, unknown>)[props.itemKey] as string)) || file.public_id || file.url

  if (props.multiple) {
    if (exists) {
      selectedFiles.value = selectedFiles.value.filter((f) => {
        const fKey = (props.itemKey && ((f as unknown as Record<string, unknown>)[props.itemKey] as string)) || f.public_id || f.url
        return fKey !== key
      })
    } else {
      selectedFiles.value.push(file)
    }
  } else {
    selectedFiles.value = [file]
  }
  emit('selected', selectedFiles.value)
}
const internalValue = computed<Cloudinary.IFileAttach | Cloudinary.IFileAttach[] | null>(() => {
  const val = props.modelValue
  if (!val) return null

  if (typeof val === 'string') {
    return {
      url: val,
      public_id: val,
      display_name: toNormalize(props.label || '') || val.split('/').pop()?.split('?')[0] || 'Image',
      thumbnail_url: val
    } as Cloudinary.IFileAttach
  }

  if (Array.isArray(val)) {
    return val.map((item: unknown): Cloudinary.IFileAttach => {
      if (typeof item === 'string') {
        return {
          url: item,
          public_id: item,
          display_name: toNormalize(props.label || '') || item.split('/').pop()?.split('?')[0] || 'Image',
          thumbnail_url: item
        } as Cloudinary.IFileAttach
      }
      return item as Cloudinary.IFileAttach
    })
  }

  return val as Cloudinary.IFileAttach
})
function mergeByKey<T extends Cloudinary.IFileAttach>(base: T[], updates: T[], key: string): T[] {
  const getKey = (item: T) => String((item as unknown as Record<string, unknown>)[key]) || item.public_id || item.url || Math.random().toString(36).substring(7)
  const map = new Map(base.map(item => [getKey(item), { ...item }]))
  for (const item of updates) {
    const k = getKey(item)
    if (map.has(k)) {
      map.set(k, { ...map.get(k), ...item })
    } else {
      map.set(k, item)
    }
  }
  return Array.from(map.values())
}
const onEditFile = (file: Cloudinary.IFileAttach) => {
  if (props.customEdit) {
    selectedFile.value = file
    emit('edit', file)
  }
}
const onOpenConfirmDelete = (file: Cloudinary.IFileAttach, index: number) => {
  selectedFile.value = file
  selectedIndex.value = index
  isConfirmDelete.value = true
}
const onConfirmDelete = () => {
  if (props.multiple && Array.isArray(props.modelValue)) {
    const clone = [...(props.modelValue as Cloudinary.IFileAttach[])]
    if (selectedIndex.value !== null && selectedIndex.value > -1) {
      clone.splice(selectedIndex.value, 1)
    }
    emit('update:modelValue', clone)
  } else emit('update:modelValue', null)
  if (selectedFile.value) emit('delete', selectedFile.value)
  isConfirmDelete.value = false
}
const processFiles = (files: FileList | null | undefined) => {
  if (!files || files.length === 0) return
  pendingFiles.value = Array.from(files)
  showUploadReview.value = true
  if (fileInputRef.value) fileInputRef.value.value = ''
}
const normalizeFile = (f: Cloudinary.UploadedResponse | Cloudinary.IFileAttach): Cloudinary.IFileAttach => {
  const rec = f as unknown as Record<string, unknown>
  const name = (rec.display_name as string) || (rec.filename as string) || (rec.original_filename as string) || ''
  return {
    public_id: f.public_id,
    display_name: name,
    url: f.secure_url || f.url,
    thumbnail_url: f.thumbnail_url || f.secure_url || f.url,
    format: f.format,
    bytes: f.bytes,
    width: f.width,
    height: f.height,
    created_at: f.created_at ? (typeof f.created_at === 'string' ? Date.parse(f.created_at) : f.created_at) : Date.now()
  }
}
const handleUploadDone = (uploadedFiles: Cloudinary.UploadedResponse[]) => {
  if (uploadedFiles.length > 0) {
    const normalized = uploadedFiles.map(normalizeFile)
    if (props.multiple) {
      const base = Array.isArray(props.modelValue) ? (props.modelValue as Cloudinary.IFileAttach[]).map(normalizeFile) : []
      const merged = mergeByKey(base, normalized, props.itemKey || 'public_id')
      emit('update:modelValue', merged)
    } else {
      emit('update:modelValue', normalized[0]!)
    }
  }
}
const handleFileSelect = (event: Event) => {
  const input = event.target as HTMLInputElement
  processFiles(input.files)
}
const openDirectUpload = () => {
  fileInputRef.value?.click()
}
const openCloudinaryManager = () => {
  showCloudinaryManager.value = true
}
const openLinkModal = () => {
  showLinkModal.value = true
}
const handleLinkAdd = (incoming: Cloudinary.UploadedResponse | Cloudinary.IFileAttach | (Cloudinary.UploadedResponse | Cloudinary.IFileAttach)[]) => {
  const files = (Array.isArray(incoming) ? incoming : [incoming]).map(normalizeFile)
  if (props.multiple) {
    const base = Array.isArray(props.modelValue) ? (props.modelValue as Cloudinary.IFileAttach[]).map(normalizeFile) : []
    const merged = [...base, ...files]
    emit('update:modelValue', merged)
  } else {
    emit('update:modelValue', files[0]!)
  }
}
const handleCloudinaryManagerSelect = (files: Cloudinary.IFileAttach[]) => {
  if (files && files.length > 0) {
    const normalized = files.map(normalizeFile)
    if (props.multiple) {
      const base = Array.isArray(props.modelValue) ? (props.modelValue as Cloudinary.IFileAttach[]).map(normalizeFile) : []
      const merged = mergeByKey(base, normalized, props.itemKey || 'public_id')
      emit('update:modelValue', merged)
    } else {
      emit('update:modelValue', normalized[0]!)
    }
  }
  showCloudinaryManager.value = false
}
const gridClass = computed(() => {
  return `grid gap-3 w-full justify-items-center`
})
const gridStyle = computed(() => {
  let min = '120px'
  if (props.size) {
    if (typeof props.size === 'number') min = `${props.size}px`
    else if (!isNaN(Number(props.size))) min = `${props.size}px`
    else if (props.size.toString().endsWith('px')) min = props.size
    else if (props.size.toString().includes('x')) {
      const parts = props.size.toString().split('x')
      if (parts[0]) min = `${parts[0]}px`
    }
  }
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))`
  }
})
// const getSize = computed(() => {
//   return props.size.spl
// })
// Preview
const isPreviewOpen = ref(false)
const previewFile = ref<Cloudinary.IFileAttach | null>(null)
// Computed for preview files (always array)
const previewFiles = computed(() => {
  const val = internalValue.value
  if (!val) return []
  if (Array.isArray(val)) return val
  return [val]
})
const onPreview = (file: Cloudinary.IFileAttach) => {
  previewFile.value = file
  isPreviewOpen.value = true
  emit('preview', file)
}

// Sortable
const dragEl = ref<HTMLElement | null>(null)
const sortableInstance = ref<Sortable | null>(null)

const initSortable = () => {
  if (sortableInstance.value || !dragEl.value || !props.multiple || !props.sortable) return

  sortableInstance.value = new Sortable(dragEl.value, {
    draggable: '.media-image-card-item',
    animation: 200,
    ghostClass: 'opacity-50',
    delay: 200, // Long press for mobile to allow scrolling
    delayOnTouchOnly: true,
    touchStartThreshold: 5,
    // Prevent moving items to the Upload Card's position (index 0)
    onMove(evt) {
      return evt.related.className.indexOf('upload-card-item') === -1
    },
    onUpdate: (evt) => {
      const { oldIndex, newIndex } = evt
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return

      // Shift indices by 1 because of the Upload Card at [0]
      const realOld = oldIndex - 1
      const realNew = newIndex - 1

      if (realOld < 0 || realNew < 0) return

      const updated = Array.isArray(props.modelValue) ? [...(props.modelValue as Cloudinary.IFileAttach[])] : []
      if (updated.length === 0) return

      const [movedItem] = updated.splice(realOld, 1)
      if (!movedItem) return
      updated.splice(realNew, 0, movedItem)

      // Update sort order metadata
      updated.forEach((item, idx) => {
        if (item && typeof item === 'object') {
          ;(item as unknown as { sort?: number }).sort = idx
        }
      })

      emit('update:modelValue', updated)
    }
  })
}

const destroySortable = () => {
  sortableInstance.value?.destroy()
  sortableInstance.value = null
}

watch([() => Array.isArray(internalValue.value) ? internalValue.value.length : internalValue.value ? 1 : 0, () => props.sortable], ([len, sortable]) => {
  if (len && len > 0 && sortable) {
    setTimeout(initSortable, 100)
  } else {
    destroySortable()
  }
}, { immediate: true })

onUnmounted(destroySortable)
</script>

<template>
  <div class="gallery-wrapper flex flex-col h-full min-h-0 w-full transition-all duration-300" :class="props.class">
    <!-- Hidden file input -->
    <input
      ref="fileInputRef"
      data-hidden=""
      tabindex="-1"
      type="file"
      :accept="accept"
      :multiple="multiple"
      style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); white-space: nowrap; overflow-wrap: normal; top: -1px; left: -1px;"
      @change="handleFileSelect"
    >

    <!-- Scrollable Area for Content -->
    <div class="flex-1 min-h-0" :class="[multiple ? 'overflow-y-auto' : 'flex items-center justify-center']">
      <!-- Multiple Mode: Grid with Upload Card First -->
      <div
        v-if="multiple"
        ref="dragEl"
        :class="gridClass"
        :style="gridStyle"
        class="py-1"
      >
        <!-- Upload Card -->
        <LazyMediaImageCard
          class="upload-card-item"
          :file="null"
          :size="size"
          :drop-text="dropText"
          :description-text="descriptionText"
          @add-direct="openDirectUpload"
          @add-link="openLinkModal"
          @add-library="openCloudinaryManager"
          @drop="processFiles"
        />
        <!-- Items -->
        <LazyMediaImageCard
          v-for="(f, i) in (internalValue as Cloudinary.IFileAttach[])"
          :key="(props.itemKey && ((f as unknown as Record<string, unknown>)[props.itemKey] as string)) || f.public_id || f.url || i"
          :file="f"
          :size="size"
          class="media-image-card-item"
          :is-show-selected="multiple"
          :is-selected="isSelected(f)"
          :custom-edit="customEdit"
          @toggle="handleToggleFile"
          @preview="onPreview(f)"
          @edit="onEditFile(f)"
          @delete="onOpenConfirmDelete(f, i)"
          @add-direct="openDirectUpload"
          @add-link="openLinkModal"
          @add-library="openCloudinaryManager"
          @drop="processFiles"
        />
      </div>

      <!-- Single Mode -->
      <div v-else class="w-full h-full flex justify-center items-center p-2">
        <LazyMediaImageCard
          :file="internalValue as Cloudinary.IFileAttach"
          :size="size"
          :is-show-selected="false"
          :is-selected="isSelected(internalValue as Cloudinary.IFileAttach)"
          :drop-text="dropText"
          :custom-edit="customEdit"
          :description-text="descriptionText"
          :upload-select-text="$t('media.drop_text') || 'Upload Select'"
          :upload-new-file="$t('media.upload_new_file') || 'Upload new file'"
          @toggle="handleToggleFile"
          @preview="onPreview(internalValue as Cloudinary.IFileAttach)"
          @edit="onEditFile(internalValue as Cloudinary.IFileAttach)"
          @delete="onOpenConfirmDelete(internalValue as Cloudinary.IFileAttach, 0)"
          @add-direct="openDirectUpload"
          @add-link="openLinkModal"
          @add-library="openCloudinaryManager"
          @drop="processFiles"
        />
      </div>
    </div>

    <!-- Modals & Overlay (Outside Scroll Area) -->
    <div class="gallery-modals">
      <LazyMediaInputImageLink v-model:open="showLinkModal" :multiple="multiple" @add="handleLinkAdd" />
      <ClientOnly>
        <LazyBaseResponsiveModal
          v-model:open="showCloudinaryManager"
          :fullscreen="true"
          :title="$t('media.cloudinary', 'Cloudinary Manager')"
          :ui="{ body: 'flex-1 min-h-0 p-0 pt-3 sm:p-0 sm:pt-3 overflow-hidden' }"
        >
          <template #body>
            <div class="flex flex-col flex-1 min-h-0 h-full">
              <LazyMediaCloudinary
                mode="modal"
                :multiple="multiple"
                :upload-accept="accept"
                class="w-full flex-1"
                @close="showCloudinaryManager = false"
                @selected-files="handleCloudinaryManagerSelect"
              />
            </div>
          </template>
        </LazyBaseResponsiveModal>
      </ClientOnly>
      <LazyMediaConfirmModal
        v-model="isConfirmDelete"
        :file="selectedFile"
        @confirm="onConfirmDelete"
        @cancel="isConfirmDelete = false"
      />
      <LazyMediaUploadReview
        v-model:open="showUploadReview"
        :files="pendingFiles"
        :folder="folder"
        :multiple="multiple"
        @done="handleUploadDone"
      />
      <!-- Preview Modal -->
      <LazyMediaImagePreview
        v-if="isPreviewOpen && previewFile"
        v-model:open="isPreviewOpen"
        :file="previewFile"
        :files="previewFiles"
        @close="isPreviewOpen = false"
      />
    </div>
  </div>
</template>
