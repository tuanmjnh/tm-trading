<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { NodeViewProps } from '@tiptap/vue-3'
import { NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps<NodeViewProps>()

const isOpen = ref(false)
const selectedFiles = ref<any>(null)

function onSelect(files: any) {
  if (!files) return
  const fileList = Array.isArray(files) ? files : [files]

  if (fileList.length === 0) return

  const pos = props.getPos()
  if (typeof pos !== 'number') return

  const chain = props.editor.chain().focus().deleteRange({ from: pos, to: pos + 1 })

  fileList.forEach((file) => {
    if (file.url) {
      chain.setImage({ src: file.url, alt: file.display_name || '' })
    }
  })

  chain.run()
  isOpen.value = false
}

// Auto-open on mount if empty?
onMounted(() => {
  // Only open if this is a new node (no data yet)
  if (!props.node.attrs.src) isOpen.value = true
})
</script>

<template>
  <NodeViewWrapper class="my-4 w-full">
    <LazyMediaGallery v-model="selectedFiles" :multiple="false" size="auto" accept="image/*"
      class="w-full min-h-48" @update:model-value="onSelect" />
  </NodeViewWrapper>
</template>
