<script setup lang="ts">
const props = defineProps<{
  open: boolean
  file: Cloudinary.IFileAttach | null
  loading?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update', file: Cloudinary.IFileAttach): void
}>()
const isOpen = computed({
  get: () => props.open,
  set: val => emit('update:open', val)
})
const tempName = ref('')
watch(() => props.open, (val) => {
  if (val && props.file) {
    tempName.value = props.file.display_name || (props.file.public_id ? props.file.public_id.split('/').pop() || props.file.public_id : '')
  }
})
const handleRename = () => {
  if (props.file && tempName.value.trim()) {
    const updatedFile = { ...props.file, display_name: tempName.value.trim() }
    emit('update', updatedFile)
    isOpen.value = false
  }
}
</script>

<template>
  <LazyUModal
    v-model:open="isOpen"
    :title="$t('media.rename_text') || 'Rename'"
    :description="$t('media.rename_description') || 'Rename'"
  >
    <!-- <template #header-right>
      <UButton :loading="loading" color="primary" variant="soft" @click="handleRename">
        {{ $t('common.save') }}
      </UButton>
    </template> -->
    <template #body>
      <div class="space-y-4">
        <UInput
          v-model="tempName"
          autofocus
          class="w-full"
          @keyup.enter="handleRename"
        />
      </div>
    </template>
    <template #footer>
      <UButton
        block
        :loading="loading"
        color="primary"
        variant="soft"
        :label="$t('common.update')"
        @click="handleRename"
      />
    </template>
  </LazyUModal>
</template>
