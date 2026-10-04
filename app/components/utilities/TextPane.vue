<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <label class="text-sm font-medium text-highlighted">{{ label }}</label>
      <div class="flex gap-1">
        <UButton
          v-if="!readonly"
          :icon="modelValue ? 'i-lucide-eraser' : 'i-lucide-clipboard-paste'"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="modelValue ? emit('update:modelValue', '') : paste()"
        />
        <UButton
          v-if="modelValue"
          icon="i-lucide-copy"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="copy"
        />
        <UButton
          v-if="modelValue && allowDownload"
          icon="i-lucide-download"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="download"
        />
      </div>
    </div>
    <UTextarea
      :model-value="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      :readonly="readonly"
      class="w-full font-mono text-xs"
      @update:model-value="v => emit('update:modelValue', v ?? '')"
    />
    <slot name="footer" />
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  modelValue: string
  placeholder?: string
  rows?: number
  readonly?: boolean
  allowDownload?: boolean
}>(), { rows: 8, readonly: false, placeholder: '', allowDownload: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const toast = useToast()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.modelValue)
    toast.add({ title: t('utilities.text.copied'), color: 'success', icon: 'i-lucide-check' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function paste() {
  try {
    const text = await navigator.clipboard.readText()
    emit('update:modelValue', text)
  } catch {
    toast.add({ title: 'Paste failed', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function download() {
  const blob = new Blob([props.modelValue], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'utilities-output.txt'
  a.click()
  URL.revokeObjectURL(url)
}
</script>
