<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { getErrorMessage } from '~/shared/utils/errors'
import type { AiProviderCatalogModel } from '~/types/aiProviders'
import { aiProviderSourceBadge, aiProviderErrorText } from '~/utils/aiProvidersUi'

/**
 * Saved-model catalogue for one connection, rendered in a modal (the list can
 * be long). Per-model row: enable switch + an actions dropdown (set/unset
 * primary, delete with confirm). Manual model entry at the bottom.
 */
const props = defineProps<{ connectionId: string }>()

const emit = defineEmits<{ (e: 'primary-changed'): void }>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const notify = useNotify()
const { copy } = useClipboard()

const models = ref<AiProviderCatalogModel[]>([])
const modelsLoading = ref(false)
const discovering = ref(false)
const searchQuery = ref('')
const displayLimit = ref(50)

const filteredModels = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return models.value
  return models.value.filter(m =>
    m.model.toLowerCase().includes(q) ||
    (m.displayName && m.displayName.toLowerCase().includes(q))
  )
})

const displayedModels = computed(() => filteredModels.value.slice(0, displayLimit.value))

watch(searchQuery, () => {
  displayLimit.value = 50
})

async function loadModels() {
  modelsLoading.value = true
  try {
    const res = await $fetch<{ data: { models: AiProviderCatalogModel[] } }>(
      `/api/v1/ai/providers/connections/${encodeURIComponent(props.connectionId)}/models`,
    )
    models.value = res.data.models
  } catch (err) {
    notify.error(t('settings.aiProviders.modelsLoadFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    modelsLoading.value = false
  }
}

async function discoverAndSaveModels() {
  if (!props.connectionId) return
  discovering.value = true
  try {
    const res = await $fetch<{ data: { ok: boolean, models: string[], code: string | null, error: string | null } }>(
      '/api/v1/ai/providers/connections/discover',
      {
        method: 'POST',
        body: {
          connectionId: props.connectionId
        }
      }
    )
    if (res.data.ok && res.data.models.length) {
      const added = await $fetch<{ data: { added: number } }>(
        `/api/v1/ai/providers/connections/${encodeURIComponent(props.connectionId)}/models`,
        { method: 'POST', body: { models: res.data.models, source: 'discovered' } }
      )
      notify.success(t('settings.aiProviders.discovered', { count: res.data.models.length }), t('settings.aiProviders.savedDiscovered', { count: res.data.models.length, added: added.data.added }))
      await loadModels()
    } else if (res.data.ok) {
      notify.warning(t('settings.aiProviders.discoveredNone'))
    } else {
      notify.error(t('settings.aiProviders.discoverFailed'), aiProviderErrorText(t, res.data.code, res.data.error))
    }
  } catch (err) {
    notify.error(t('settings.aiProviders.discoverFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    discovering.value = false
  }
}

watch(open, (value) => {
  if (value) {
    displayLimit.value = 50
    searchQuery.value = ''
    loadModels()
  }
})

/** Switch the bot's active model — live on the next request, no redeploy. */
async function setPrimary(m: AiProviderCatalogModel) {
  try {
    await $fetch(
      `/api/v1/ai/providers/connections/${encodeURIComponent(props.connectionId)}/models/${encodeURIComponent(m.model)}`,
      { method: 'PATCH', body: { isPrimary: true } },
    )
    notify.success(t('settings.aiProviders.primarySet', { model: m.model }))
    await Promise.all([loadModels(), Promise.resolve(emit('primary-changed'))])
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  }
}

/** Clear the primary badge — the bot keeps its active model until another is picked. */
async function unsetPrimary(m: AiProviderCatalogModel) {
  try {
    await $fetch(
      `/api/v1/ai/providers/connections/${encodeURIComponent(props.connectionId)}/models/${encodeURIComponent(m.model)}`,
      { method: 'PATCH', body: { isPrimary: false } },
    )
    notify.success(t('settings.aiProviders.primaryCleared', { model: m.model }))
    await Promise.all([loadModels(), Promise.resolve(emit('primary-changed'))])
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  }
}

async function toggleModelEnabled(m: AiProviderCatalogModel) {
  try {
    await $fetch(
      `/api/v1/ai/providers/connections/${encodeURIComponent(props.connectionId)}/models/${encodeURIComponent(m.model)}`,
      { method: 'PATCH', body: { isEnabled: !m.isEnabled } },
    )
    await loadModels()
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  }
}

// --- delete with confirm ------------------------------------------------------
const deleteTarget = ref<AiProviderCatalogModel | null>(null)
const deleting = ref(false)

async function removeModel() {
  const m = deleteTarget.value
  if (!m) return
  deleting.value = true
  try {
    await $fetch(
      `/api/v1/ai/providers/connections/${encodeURIComponent(props.connectionId)}/models/${encodeURIComponent(m.model)}`,
      { method: 'DELETE' },
    )
    notify.success(t('settings.aiProviders.modelDeleted', { model: m.model }))
    deleteTarget.value = null
    await loadModels()
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  } finally {
    deleting.value = false
  }
}

// --- manual model entry -------------------------------------------------------
const newModelId = ref('')
const newModelDisplayName = ref('')
const addingModel = ref(false)

async function addManualModel() {
  const model = newModelId.value.trim()
  if (!model) return
  addingModel.value = true
  try {
    await $fetch(`/api/v1/ai/providers/connections/${encodeURIComponent(props.connectionId)}/models`, {
      method: 'POST',
      body: {
        models: [{ model, ...(newModelDisplayName.value.trim() ? { displayName: newModelDisplayName.value.trim() } : {}) }],
        source: 'manual'
      }
    })
    notify.success(t('settings.aiProviders.addModel'), t('settings.aiProviders.modelAdded', { model }))
    newModelId.value = ''
    newModelDisplayName.value = ''
    await loadModels()
  } catch (err) {
    notify.error(t('settings.aiProviders.addModel'), getErrorMessage(err, key => t(key)))
  } finally {
    addingModel.value = false
  }
}

function modelActions(m: AiProviderCatalogModel): DropdownMenuItem[] {
  const actions: DropdownMenuItem[] = []
  if (!m.isPrimary) {
    actions.push({
      label: t('settings.aiProviders.setPrimary'),
      icon: 'i-lucide-star',
      color: 'primary',
      disabled: !m.isEnabled,
      onSelect: () => setPrimary(m)
    })
  } else {
    actions.push({
      label: t('settings.aiProviders.unsetPrimary'),
      icon: 'i-lucide-circle-off',
      color: 'warning',
      onSelect: () => unsetPrimary(m)
    })
  }
  actions.push({
    label: t('settings.aiProviders.copyModelId'),
    icon: 'i-lucide-copy',
    color: 'neutral',
    onSelect: () => {
      copy(m.model)
      notify.success(t('settings.aiProviders.modelIdCopied', { model: m.model }))
    }
  })
  actions.push({ type: 'separator' })
  actions.push({
    label: t('settings.aiProviders.deleteModel'),
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => { deleteTarget.value = m }
  })
  return actions
}
</script>

<template>
  <UModal v-model:open="open" :title="t('settings.aiProviders.modelsTitle')" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div class="space-y-3">
        <p v-if="modelsLoading && !models.length" class="text-sm text-muted">{{ t('global.loading') }}</p>
        <div class="flex items-center justify-between gap-2">
          <UInput v-if="models.length > 5" v-model="searchQuery" icon="i-lucide-search" size="sm" class="flex-1"
            :placeholder="t('settings.aiProviders.searchModelsPlaceholder')" />
          <div v-else class="flex-1" />
          <UButton icon="i-lucide-sparkles" size="sm" color="primary" variant="soft" :loading="discovering"
            :label="t('settings.aiProviders.discoverModels')" @click="discoverAndSaveModels" />
        </div>

        <div v-if="!models.length && !modelsLoading" class="flex flex-col items-center justify-center p-6 text-center border border-dashed border-default rounded gap-3">
          <p class="text-sm text-muted">{{ t('settings.aiProviders.modelsEmpty') }}</p>
          <UButton icon="i-lucide-sparkles" size="sm" color="primary" variant="soft" :loading="discovering"
            :label="t('settings.aiProviders.discoverModels')" @click="discoverAndSaveModels" />
        </div>
        <div v-else-if="models.length" class="max-h-[50vh] divide-y divide-default overflow-y-auto rounded border border-default">
          <div v-for="m in displayedModels" :key="m.model" class="flex items-center gap-2 px-3 py-2">
            <UIcon :name="m.isPrimary ? 'i-lucide-star' : 'i-lucide-box'" class="size-4 shrink-0"
              :class="m.isPrimary ? 'text-warning fill-warning' : 'text-muted'" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-mono text-xs"
                :class="m.isEnabled ? 'text-highlighted' : 'text-muted line-through'" :title="m.model">
                {{ m.displayName || m.model }}
              </p>
            </div>
            <UBadge v-if="m.isPrimary" color="warning" variant="subtle" size="xs">
              {{ t('settings.aiProviders.primaryBadge') }}</UBadge>
            <UBadge v-if="m.source === 'manual' || m.source === 'discovered'" color="neutral" variant="subtle"
              size="xs">
              {{ aiProviderSourceBadge(t, m) }}</UBadge>
            <USwitch :model-value="m.isEnabled" size="xs" :aria-label="m.model"
              @update:model-value="() => toggleModelEnabled(m)" />
            <UDropdownMenu :items="modelActions(m)" :content="{ align: 'end' }">
              <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" square size="xs"
                :aria-label="t('common.actions')" />
            </UDropdownMenu>
          </div>

          <div v-if="filteredModels.length > displayedModels.length"
            class="flex items-center justify-between border-t border-default/50 p-2 bg-muted/20 text-xs text-muted">
            <span>{{ t('settings.aiProviders.discovered', { count: filteredModels.length }) }} ({{ displayedModels.length }}/{{ filteredModels.length }})</span>
            <div class="flex gap-2">
              <UButton size="xs" variant="ghost" color="neutral" :label="t('settings.aiProviders.loadMoreModels')"
                @click="displayLimit += 50" />
              <UButton size="xs" variant="ghost" color="neutral"
                :label="t('settings.aiProviders.showAllModels', { count: filteredModels.length })"
                @click="displayLimit = filteredModels.length" />
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 border-t border-default pt-3">
          <UInput v-model="newModelId" size="sm" class="min-w-[200px] flex-1"
            :placeholder="t('settings.aiProviders.addModelPlaceholder')" @keyup.enter="addManualModel" />
          <UInput v-model="newModelDisplayName" size="sm" class="min-w-[160px] flex-1"
            :placeholder="t('settings.aiProviders.addModelDisplayName')" @keyup.enter="addManualModel" />
          <UButton size="sm" icon="i-lucide-plus" :loading="addingModel" variant="soft" :disabled="!newModelId.trim()"
            :label="t('settings.aiProviders.addModel')" @click="addManualModel" />
        </div>
      </div>
    </template>
    <!-- <template #footer>
      <div class="flex w-full justify-end">
        <UButton :label="t('common.close')" color="neutral" variant="ghost" @click="open = false" />
      </div>
    </template> -->
  </UModal>

  <LazyBaseConfirmModal :open="!!deleteTarget" :title="t('settings.aiProviders.deleteModelTitle')"
    :description="t('settings.aiProviders.deleteModelDesc', { model: deleteTarget?.displayName || deleteTarget?.model || '' })"
    :confirm-label="t('common.delete')" :loading="deleting" @update:open="value => !value && (deleteTarget = null)"
    @confirm="removeModel" />
</template>

