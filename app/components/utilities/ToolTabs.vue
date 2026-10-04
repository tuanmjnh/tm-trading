<template>
  <div class="space-y-4">
    <UTabs :model-value="active" :items="items" class="w-full" :content="false"
      :ui="{ list: 'px-4 sm:px-6 flex-nowrap overflow-x-auto scrollbar-hide shrink-0', trigger: 'flex-shrink-0', content: 'flex-1 min-h-0 overflow-y-auto custom-scrollbar py-4 sm:py-6 px-4 sm:px-6 pb-24' }"
      @update:model-value="onSelect" />
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ active: string }>()
const emit = defineEmits<{ select: [value: string] }>()
const { t } = useI18n()

const items = computed(() => [
  { label: t('utilities.text.title'), value: 'text', icon: 'i-lucide-type' },
  { label: t('utilities.icons.title'), value: 'icons', icon: 'i-lucide-shapes' },
  { label: t('utilities.crypto.title'), value: 'encode', icon: 'i-lucide-binary' },
  { label: t('utilities.random.title'), value: 'random', icon: 'i-lucide-dices' }
])

function onSelect(v: string | number | undefined) {
  if (v) emit('select', String(v))
}
</script>
