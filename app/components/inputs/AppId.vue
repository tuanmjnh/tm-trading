<script setup lang="ts">
const props = withDefaults(defineProps<{
  sourceName?: string
  placeholder?: string
  disabled?: boolean
}>(), {
  sourceName: '',
  placeholder: 'app_xxxxxxxx',
  disabled: false
})

const model = defineModel<string>({ default: '' })
const { t } = useI18n()
const notify = useNotify()

function handleGenerateRandom() {
  model.value = generateSecureId('app', 8)
  notify.success(t('apps.idGenerated'))
}

function handleGenerateFromName() {
  if (props.sourceName) {
    model.value = generateAppId(props.sourceName)
    notify.success(t('apps.idGenerated'))
  } else {
    handleGenerateRandom()
  }
}

async function handleCopy() {
  if (!model.value) return
  try {
    await navigator.clipboard.writeText(model.value)
    notify.success(t('common.copied'))
  } catch {
    notify.error(t('common.error'))
  }
}
</script>

<template>
  <div class="space-y-1.5 w-full">
    <div class="relative flex items-center w-full">
      <UInput v-model="model" :placeholder="placeholder" :disabled="disabled" icon="i-lucide-key"
        class="w-full font-mono text-sm" :ui="{ trailing: 'pe-1.5' }">
        <template #trailing>
          <div class="flex items-center gap-0.5">
            <UTooltip :text="t('apps.copyId')">
              <UButton v-if="model" icon="i-lucide-copy" variant="ghost" color="neutral" size="xs" tabindex="-1"
                @click.stop="handleCopy" />
            </UTooltip>
            <UTooltip :text="t('apps.generateId')">
              <UButton icon="i-lucide-sparkles" variant="soft" color="primary" size="xs" tabindex="-1"
                @click.stop="handleGenerateFromName" />
            </UTooltip>
          </div>
        </template>
      </UInput>
    </div>

    <!-- Quick generation shortcuts -->
    <div class="flex flex-wrap items-center justify-between text-[11px] text-muted pt-0.5 gap-2">
      <span class="truncate">{{ t('apps.idHint') }}</span>
      <div class="flex items-center gap-1.5 shrink-0">
        <button v-if="sourceName && sourceName.trim()" type="button"
          class="text-primary hover:underline cursor-pointer flex items-center gap-1" @click="handleGenerateFromName">
          <UIcon name="i-lucide-wand" class="w-3 h-3" />
          <span>{{ t('apps.fromName') }}</span>
        </button>
        <span v-if="sourceName && sourceName.trim()" class="text-neutral-300 dark:text-neutral-700">•</span>
        <button type="button" class="text-primary hover:underline cursor-pointer flex items-center gap-1"
          @click="handleGenerateRandom">
          <UIcon name="i-lucide-wand-sparkles" class="w-3 h-3" />
          <span>{{ t('apps.randomId') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
