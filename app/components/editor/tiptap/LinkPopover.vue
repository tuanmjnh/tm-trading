<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'

const props = withDefaults(defineProps<{
  editor: Editor
  autoOpen?: boolean
  type?: 'link' | 'youtube'
}>(), {
  type: 'link'
})

const open = ref(false)
const url = ref('')

const active = computed(() => props.editor.isActive(props.type))
const disabled = computed(() => {
  if (!props.editor.isEditable) return true
  if (props.type === 'youtube') return false
  const { selection } = props.editor.state
  return selection.empty && !props.editor.isActive('link')
})

watch(() => props.editor?.options?.element, (el, _, onCleanup) => {
  const editor = props.editor
  if (!editor || !el) return

  const updateUrl = useDebounceFn(() => {
    if (props.type === 'youtube') {
      const { src } = editor.getAttributes('youtube')
      url.value = src || ''
    } else {
      const { href } = editor.getAttributes('link')
      url.value = href || ''
    }
  }, 200)

  updateUrl()
  editor.on('selectionUpdate', updateUrl)

  onCleanup(() => {
    editor.off('selectionUpdate', updateUrl)
  })
}, { immediate: true })

watch(active, (isActive) => {
  if (isActive && props.autoOpen) {
    open.value = true
  }
})

function submit() {
  if (!url.value) return

  const { selection } = props.editor.state
  let chain = props.editor.chain().focus()

  if (props.type === 'youtube') {
    chain.setYoutubeVideo({ src: url.value }).run()
  } else {
    const isEmpty = selection.empty
    chain = chain.extendMarkRange('link').setLink({ href: url.value })

    if (isEmpty) {
      chain = chain.insertContent({ type: 'text', text: url.value })
    }

    chain.run()
  }

  open.value = false
}

function remove() {
  const chain = props.editor.chain().focus()

  if (props.type === 'youtube') {
    // For youtube, arguably we might want to delete the node if it's selected?
    // But usually this popover is for insertion. If editing, maybe clear?
    // Let's assume standard behavior: if active, we might want to remove it.
    // But youtube is a void node, selection is around it.
    // For simplicity, just clearing input. If user wants to delete youtube, they usually press backspace.
    // Implementing deleteSelection for now if active.
    if (props.editor.isActive('youtube')) {
      chain.deleteSelection().run()
    }
  } else {
    chain
      .extendMarkRange('link')
      .unsetLink()
      .setMeta('preventAutolink', true)
      .run()
  }

  url.value = ''
  open.value = false
}

function openLink() {
  if (!url.value) return
  window.open(url.value, '_blank', 'noopener,noreferrer')
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <UPopover v-model:open="open" :ui="{ content: 'p-0.5' }">
    <UTooltip :text="type === 'youtube' ? 'YouTube' : 'Link'">
      <UButton :icon="type === 'youtube' ? 'i-lucide-youtube' : 'i-lucide-link'" color="neutral" active-color="primary"
        variant="ghost" active-variant="soft" size="sm" :active="active" :disabled="disabled" />
    </UTooltip>

    <template #content>
      <UInput v-model="url" autofocus name="url" type="url" variant="none"
        :placeholder="type === 'youtube' ? 'Paste a YouTube video URL...' : 'Paste a link...'" @keydown="handleKeyDown">
        <div class="flex items-center mr-0.5">
          <UButton icon="i-lucide-corner-down-left" variant="ghost" size="sm" :disabled="!url && !active"
            title="Apply link" @click="submit" />

          <USeparator orientation="vertical" class="h-6 mx-1" />

          <UButton icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" :disabled="!url && !active"
            title="Open in new window" @click="openLink" />

          <UButton icon="i-lucide-trash" color="neutral" variant="ghost" size="sm" :disabled="!url && !active"
            title="Remove link" @click="remove" />
        </div>
      </UInput>
    </template>
  </UPopover>
</template>
