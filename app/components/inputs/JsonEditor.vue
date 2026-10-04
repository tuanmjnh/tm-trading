<script setup lang="ts">
import JsonEditorVue from 'json-editor-vue'
import { Mode } from 'vanilla-jsoneditor'
import 'vanilla-jsoneditor/themes/jse-theme-dark.css'

const props = defineProps<{
  modelValue: unknown
  readOnly?: boolean
  mode?: Mode
}>()

const emit = defineEmits(['update:modelValue', 'change'])
const colorMode = useColorMode()

const localValue = ref<unknown>(props.modelValue)

watch(() => props.modelValue, (newVal) => {
  localValue.value = newVal
})

const onUpdate = (val: unknown) => {
  let processedValue: unknown = val

  // JsonEditorVue may emit string in text mode, ensure we always return object
  if (typeof val === 'string') {
    try {
      processedValue = JSON.parse(val)
    } catch {
      // If it's not valid JSON, try to create an object with the string as value
      processedValue = { value: val }
    }
  }

  // Ensure it's always an object
  if (typeof processedValue !== 'object' || processedValue === null) {
    processedValue = {}
  }

  localValue.value = processedValue
  emit('update:modelValue', processedValue)
}

const handleBlur = () => {
  emit('change', localValue.value)
}
</script>

<template>
  <div class="json-editor-container h-full min-h-0 flex flex-col"
    :class="{ 'jse-theme-dark': colorMode.value === 'dark' }">
    <ClientOnly>
      <JsonEditorVue v-model="localValue" :mode="mode || Mode.tree" :read-only="readOnly" class="flex-1 min-h-0"
        :on-blur="handleBlur" @update:model-value="onUpdate" />
      <template #fallback>
        <div
          class="h-full w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-md border border-gray-200 dark:border-gray-700">
          <UIcon name="i-lucide-loader-2" class="animate-spin mr-2" />
          {{ $t('common.loading') }}...
        </div>
      </template>
    </ClientOnly>
  </div>
</template>

<style>
/* Ensure the editor takes the full height of the container */
.json-editor-container {
  /* vanilla-jsoneditor CSS variables override for dark mode if needed */
  --jse-font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* Ensure the editor has height for internal scrolling */
.json-editor-container :deep(.jse-main) {
  height: 100%;
  flex: 1;
  min-height: 0;
}

/* Dark mode overrides if not automatically handled by the class */
.jse-theme-dark {
  --jse-theme-color: #3b82f6;
  --jse-text-color-inverse: #ffffff;
  --jse-background-color: #1f2937;
  /* gray-800 */
  --jse-panel-background: #374151;
  /* gray-700 */
  --jse-panel-border: #4b5563;
  /* gray-600 */
}
</style>
