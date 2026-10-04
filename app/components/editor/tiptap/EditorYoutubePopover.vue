<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{
  editor: Editor
}>()

const open = ref(false)
const url = ref('')

const active = computed(() => props.editor.isActive('youtube'))

watch(() => props.editor?.options?.element, (el, _, onCleanup) => {
  const editor = props.editor
  if (!editor || !el) return

  const updateUrl = () => {
    if (editor.isActive('youtube')) {
      url.value = editor.getAttributes('youtube').src || ''
    }
  }

  editor.on('selectionUpdate', updateUrl)
  onCleanup(() => editor.off('selectionUpdate', updateUrl))
}, { immediate: true })

function setVideo() {
  if (!url.value) return

  props.editor.chain().focus().setYoutubeVideo({
    src: url.value
  }).run()

  open.value = false
  // Don't clear URL immediately if we want to keep it for next time?
  // actually better to clear it if it was a new insertion.
  // But if editing, we might want to keep it.
  // For simplicity, let's leave it, the watcher will update it anyway if selection changes.
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    setVideo()
  }
}
</script>

<template>
  <UPopover v-model:open="open" :ui="{ content: 'p-0.5' }">
    <UTooltip text="YouTube">
      <UButton icon="i-lucide-youtube" color="neutral" active-color="primary" variant="ghost" active-variant="soft"
        size="sm" :active="active" />
    </UTooltip>

    <template #content>
      <UInput v-model="url" autofocus name="url" type="url" variant="none" placeholder="Paste a YouTube link..."
        @keydown="handleKeyDown" class="min-w-[320px]">
        <div class="flex items-center mr-0.5 gap-1">
          <UButton icon="i-lucide-check" variant="ghost" size="sm" :disabled="!url" title="Insert Video"
            @click="setVideo" />
        </div>
      </UInput>
    </template>
  </UPopover>
</template>
