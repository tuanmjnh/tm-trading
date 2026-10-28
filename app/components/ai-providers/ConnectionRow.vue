<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { AiProviderConnectionRow } from '~/types/aiProviders'
import { aiProviderFormatWhen, aiProviderErrorText, aiProviderIsHubRow, aiProviderStatusColor, aiProviderStatusLabel } from '~/utils/aiProvidersUi'

const props = defineProps<{
  row: AiProviderConnectionRow,
  testing?: boolean,
  discovering?: boolean
}>()

const emit = defineEmits<{
  (e: 'test'): void
  (e: 'toggle', value: boolean): void
  (e: 'edit'): void
  (e: 'remove'): void
  (e: 'open-models'): void
  (e: 'discover-models'): void
}>()

const { t } = useI18n()

const isHub = computed(() => aiProviderIsHubRow(props.row))

/** Colored actions: test primary, browse neutral, destructive error. */
const actions = computed((): DropdownMenuItem[] => {
  const items: DropdownMenuItem[] = [
    { label: t('settings.aiProviders.test'), icon: 'i-lucide-activity', color: 'primary', disabled: props.testing, onSelect: () => emit('test') },
    { label: t('settings.aiProviders.discoverModels'), icon: 'i-lucide-sparkles', color: 'neutral', disabled: props.discovering, onSelect: () => emit('discover-models') },
    { label: t('settings.aiProviders.models'), icon: 'i-lucide-library', color: 'neutral', onSelect: () => emit('open-models') }
  ]
  if (!isHub.value) {
    items.push({ label: t('common.edit'), icon: 'i-lucide-pencil', color: 'neutral', onSelect: () => emit('edit') })
  }
  items.push(
    { type: 'separator' },
    // Hub rows delete LOCALLY only — the connection stays on TM Hub and may
    // reappear on the next sync unless revoked there.
    { label: t('common.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('remove') }
  )
  return items
})
</script>

<template>
  <div class="p-3">
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="truncate text-sm font-medium text-highlighted">{{ row.name }}</span>
          <UBadge :color="aiProviderStatusColor(row)" variant="subtle" size="sm">{{ aiProviderStatusLabel(t, row) }}
          </UBadge>
          <span class="font-mono text-xs text-muted">
            {{ isHub && row.hubProvider ? `${row.provider} · ${row.hubProvider}` : row.provider }}
          </span>
        </div>
        <p class="mt-1 truncate text-xs text-muted">
          {{ isHub ? `${row.model} · ${t('settings.aiProviders.viaHub')}` : `${row.model} · ${row.baseUrl}` }}
        </p>
        <p class="mt-0.5 text-xs" :class="row.lastError ? 'text-error' : 'text-muted'">
          <template v-if="row.lastError">{{ aiProviderErrorText(t, row.lastErrorCode, row.lastError) }}</template>
          <template v-else>
            {{ t('settings.aiProviders.lastTested') }}: {{ aiProviderFormatWhen(row.lastTestedAt) }}
            <span v-if="row.testLatencyMs"> · {{ row.testLatencyMs }}ms</span>
          </template>
        </p>
        <p v-if="row.hasSecret" class="mt-0.5 font-mono text-xs text-muted">{{ row.secretMask }}</p>
      </div>

      <div class="flex items-center gap-2">
        <USwitch :model-value="row.enabled" :aria-label="t('settings.aiProviders.enabled')"
          @update:model-value="value => emit('toggle', value === true)" />
        <UDropdownMenu :items="actions" :content="{ align: 'end' }">
          <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" square size="sm"
            :aria-label="t('common.actions')" :title="t('common.actions')" />
        </UDropdownMenu>
      </div>
    </div>
  </div>
</template>
