<template>
  <div class="p-6">
    <div class="flex items-center justify-between gap-4 mb-4">
      <h2 class="text-xl font-bold">{{ t('utilities.editor.title') }}</h2>

      <!-- Editor Type Switcher -->
      <div class="flex items-center gap-2">
        <UButton
          v-if="editorType === 'tiptap'"
          variant="solid"
          color="primary"
          size="sm"
          @click="setEditorType('tinymce')"
        >
          <UIcon name="i-lucide-square" class="mr-1" /> TinyMCE
        </UButton>
        <UButton
          v-else
          variant="outline"
          color="primary"
          size="sm"
          @click="setEditorType('tiptap')"
        >
          <UIcon name="i-lucide-text" class="mr-1" /> Tiptap
        </UButton>
      </div>
    </div>

    <div class="space-y-4">

      <!-- Tiptap Editor -->
      <template v-if="editorType === 'tiptap'">
      <EditorTiptap
        v-model="content"
        :placeholder="$t('utilities.editor.placeholder')"
        :isBubble="false"
      />
      </template>

      <!-- TinyMCE Editor -->
      <template v-else>
      <EditorTinymce
        v-model="content"
        :placeholder="$t('utilities.editor.placeholder')"
      />
      </template>

      <!-- Controls -->
      <div class="flex gap-2">
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          @click="copyContent"
          :label="$t('utilities.editor.copy')"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          @click="downloadContent"
          :label="$t('utilities.editor.download')"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          @click="clearContent"
          :label="$t('utilities.editor.clear')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useEditorType } from '~/composables/useEditorType'

const { editorType, setEditorType } = useEditorType()
const { t } = useI18n()
const content = ref('')

// Mock functions for clipboard/Download
function copyContent() {
  navigator.clipboard.writeText(content.value)
  // TODO: add toast notification
}

function downloadContent() {
  const blob = new Blob([content.value], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'editor-content-' + new Date().toISOString().split('T')[0] + '.html'
  a.click()
  URL.revokeObjectURL(url)
}

function clearContent() {
  content.value = ''
}
</script>

<style scoped>
/* Editor styles can be added here */
</style>