<script setup lang="ts">
import { ref, computed } from 'vue'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3'

const props = defineProps<NodeViewProps>()

const resizing = ref(false)
const startX = ref(0)
const startWidth = ref(0)
const aspect = ref(0)

const src = computed(() => props.node.attrs.src)
const alt = computed(() => props.node.attrs.alt)
const width = computed(() => props.node.attrs.width || '100%')

const onResizeStart = (event: MouseEvent) => {
  event.preventDefault()

  const imgElement = (event.target as HTMLElement).parentElement?.querySelector('img')
  if (!imgElement) return

  resizing.value = true
  startX.value = event.clientX
  startWidth.value = imgElement.clientWidth
  aspect.value = imgElement.naturalWidth / imgElement.naturalHeight

  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

const onResizeMove = (event: MouseEvent) => {
  if (!resizing.value) return

  const diff = event.clientX - startX.value
  const newWidth = Math.max(10, startWidth.value + diff)

  // Update local visual? or direct attributes?
  // Updating attributes on every move might handle re-render.
  // For smoother experience, efficient updates are key.
  props.updateAttributes({
    width: `${newWidth}px` // Save as pixel value
  })
}

const onResizeEnd = () => {
  resizing.value = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}
</script>

<template>
  <NodeViewWrapper as="span" class="image-node-view relative inline-block leading-none"
    :class="{ 'is-selected': selected }">
    <div class="relative group inline-block max-w-full">
      <img :src="src" :alt="alt" :style="{ width: typeof width === 'number' ? width + 'px' : width }"
        class="block max-w-full h-auto transition-all"
        :class="{ 'ring-2 ring-primary rounded-sm': selected || resizing }" />

      <!-- Resize Handle -->
      <div
        class="resize-handle absolute bottom-2 right-2 w-4 h-4 bg-primary border-2 border-white rounded-full cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity"
        :class="{ 'opacity-100': resizing, 'bg-primary-600': resizing }" @mousedown="onResizeStart">
      </div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.image-node-view {
  /* Ensure wrapper behaves like an inline-block for proper flow */
  line-height: 0;
}

.resize-handle {
  z-index: 10;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
}
</style>
