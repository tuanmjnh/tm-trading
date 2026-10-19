<script setup lang="ts">
// =============================================================================
//  Timeframe dropdown (TradingView-style): the full served scale in one
//  overlay list — click a row to switch, checkbox to pin/unpin the quick bar
//  (min 1, max 8 enforced by the caller). Live (L) vs history-only (H) badges
//  match the quick bar so the distinction is never silent.
// =============================================================================

const props = defineProps<{
  open: boolean
  current: string
  quick: string[]
  all: readonly string[]
  labels: Record<string, string>
  live: readonly string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [tf: string]
  toggleQuick: [tf: string]
}>()

const { t } = useI18n()

const labelOf = (tf: string): string => props.labels[tf] ?? tf
const isLive = (tf: string): boolean => (props.live as readonly string[]).includes(tf)
const isQuick = (tf: string): boolean => props.quick.includes(tf)

const choose = (tf: string): void => {
  emit('select', tf)
  emit('update:open', false)
}
</script>

<template>
  <BaseResponsiveModal
    :open="open"
    :title="t('trade.tfAll')"
    icon="i-lucide-clock"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-col gap-0.5 max-h-80 overflow-y-auto" role="listbox" aria-label="Timeframes">
        <div
          v-for="tf in all"
          :key="tf"
          class="flex items-center gap-1 rounded px-1 py-0.5"
          :class="tf === current ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-elevated/60'"
        >
          <button
            type="button"
            role="option"
            :aria-selected="tf === current"
            class="flex flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left"
            :data-testid="`tf-full-${tf}`"
            @click="choose(tf)"
          >
            <span class="font-mono text-xs font-semibold" :class="tf === current ? 'text-primary' : 'text-highlighted'">
              {{ labelOf(tf) }}
            </span>
            <UBadge :label="isLive(tf) ? t('trade.tfLive') : t('trade.tfHistory')" :color="isLive(tf) ? 'success' : 'neutral'" variant="subtle" size="xs" />
          </button>
          <UCheckbox
            :model-value="isQuick(tf)"
            :aria-label="isQuick(tf) ? t('trade.tfUnpin') : t('trade.tfPin')"
            :title="isQuick(tf) ? t('trade.tfUnpin') : t('trade.tfPin')"
            :disabled="isQuick(tf) && quick.length <= 1"
            :data-testid="`tf-pin-${tf}`"
            @update:model-value="() => emit('toggleQuick', tf)"
          />
        </div>
      </div>
    </template>
  </BaseResponsiveModal>
</template>
