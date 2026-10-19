<script setup lang="ts">
// =============================================================================
//  Display settings modal: show/hide the heavy terminal panes (watchlist,
//  order book, tape, intel strip, methods band). The core desk (chart, ticket,
//  positions) always renders — this only trims auxiliary DOM churn.
// =============================================================================

export interface PaneToggle {
  key: string
  label: string
}

const props = defineProps<{
  open: boolean
  panes: { items: PaneToggle[]; values: Record<string, boolean> }
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  toggle: [key: string, value: boolean]
  reset: []
}>()

const { t } = useI18n()
</script>

<template>
  <BaseResponsiveModal
    :open="open"
    :title="t('trade.layout.label')"
    icon="i-lucide-sliders-horizontal"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-col gap-1">
        <div
          v-for="pane in panes.items"
          :key="pane.key"
          class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-elevated/40"
        >
          <UCheckbox
            :model-value="panes.values[pane.key] ?? false"
            :label="pane.label"
            @update:model-value="(v) => emit('toggle', pane.key, v === true)"
          />
        </div>

        <div class="flex justify-end pt-2 mt-1 border-t border-default">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-rotate-ccw"
            :label="t('trade.layout.reset')"
            data-testid="workspace-reset"
            @click="emit('reset')"
          />
        </div>
      </div>
    </template>
  </BaseResponsiveModal>
</template>
