<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'
import { aiProviderErrorText } from '~/utils/aiProvidersUi'
import type { AiProviderConnectionRow, AiProvidersResponse } from '~/types/aiProviders'

// Phase G / D35 — app-owned AI providers. The page owns the list, hub sync and
// the action registry; the add/edit flow, import/export and per-connection
// model catalogue live in the `settings/ai-providers/*` child components (modals).
const { t } = useI18n()
const notify = useNotify()
const auth = useAuth()

/** Root-only affordances (key reveal) — the server enforces the same rule. */
const isRoot = computed(() => auth.user.value?.permissions?.includes('*') === true)

const rows = ref<AiProviderConnectionRow[]>([])
const providers = ref<AiProvidersResponse['providers']>([])
const env = ref<AiProvidersResponse['env']>({ configured: false, provider: null, model: null })
const loading = ref(false)
const syncing = ref(false)
const testingId = ref<string | null>(null)
const discoveringId = ref<string | null>(null)
const assistantOpen = ref(false)

const formOpen = ref(false)
const editingRow = ref<AiProviderConnectionRow | null>(null)
const ioOpen = ref(false)
const ioMode = ref<'import' | 'export'>('import')
const modelsOpen = ref(false)
const modelsConnectionId = ref('')
const deleteTarget = ref<AiProviderConnectionRow | null>(null)
const deleting = ref(false)

// --- TM Hub relay (shared AI, no local key) -----------------------------------
async function syncFromHub() {
  syncing.value = true
  try {
    const res = await $fetch<{ data: { connections: number, created: number, updated: number, disabled: number, modelsAdded: number } }>(
      '/api/v1/ai/providers/hub/sync',
      { method: 'POST' }
    )
    notify.success(t('settings.aiProviders.hubSync'), t('settings.aiProviders.hubSyncDone', {
      created: res.data.created,
      updated: res.data.updated,
      disabled: res.data.disabled,
      added: res.data.modelsAdded
    }))
    await load()
  } catch (err) {
    notify.error(t('settings.aiProviders.hubSyncFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    syncing.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ data: AiProvidersResponse }>('/api/v1/ai/providers')
    rows.value = res.data.connections
    providers.value = res.data.providers
    env.value = res.data.env
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  } finally {
    loading.value = false
  }
}

async function test(row: AiProviderConnectionRow) {
  testingId.value = row.id
  try {
    const res = await $fetch<{ data: { ok: boolean, code: string | null, error: string | null, latencyMs: number } }>(
      `/api/v1/ai/providers/connections/${encodeURIComponent(row.id)}/test`,
      { method: 'POST' }
    )
    if (res.data.ok) notify.success(t('settings.aiProviders.testOk', { ms: res.data.latencyMs }))
    else notify.error(t('settings.aiProviders.testFailed'), aiProviderErrorText(t, res.data.code, res.data.error))
    await load()
  } catch (err) {
    notify.error(t('settings.aiProviders.testFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    testingId.value = null
  }
}

async function discoverModelsForRow(row: AiProviderConnectionRow) {
  discoveringId.value = row.id
  try {
    const res = await $fetch<{ data: { ok: boolean, models: string[], code: string | null, error: string | null } }>(
      '/api/v1/ai/providers/connections/discover',
      {
        method: 'POST',
        body: { connectionId: row.id }
      }
    )
    if (res.data.ok && res.data.models.length) {
      const added = await $fetch<{ data: { added: number } }>(
        `/api/v1/ai/providers/connections/${encodeURIComponent(row.id)}/models`,
        { method: 'POST', body: { models: res.data.models, source: 'discovered' } }
      )
      notify.success(
        t('settings.aiProviders.discovered', { count: res.data.models.length }),
        t('settings.aiProviders.savedDiscovered', { count: res.data.models.length, added: added.data.added })
      )
      await load()
    } else if (res.data.ok) {
      notify.warning(t('settings.aiProviders.discoveredNone'))
    } else {
      notify.error(t('settings.aiProviders.discoverFailed'), aiProviderErrorText(t, res.data.code, res.data.error))
    }
  } catch (err) {
    notify.error(t('settings.aiProviders.discoverFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    discoveringId.value = null
  }
}

async function toggle(row: AiProviderConnectionRow, enabled: boolean) {
  try {
    await $fetch(`/api/v1/ai/providers/connections/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { enabled } })
    await load()
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  }
}

/** Hard delete after the confirm modal — the row and its model catalogue are gone. */
async function removeConnection() {
  const row = deleteTarget.value
  if (!row) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/ai/providers/connections/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
    notify.success(t('settings.aiProviders.deleted'))
    deleteTarget.value = null
    await load()
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  } finally {
    deleting.value = false
  }
}

function openCreate() {
  editingRow.value = null
  formOpen.value = true
}

function openEdit(row: AiProviderConnectionRow) {
  editingRow.value = row
  formOpen.value = true
}

function openModels(row: AiProviderConnectionRow) {
  modelsConnectionId.value = row.id
  modelsOpen.value = true
}

function openImport() {
  ioMode.value = 'import'
  ioOpen.value = true
}

function openExport() {
  ioMode.value = 'export'
  ioOpen.value = true
}

/** Registered once here — BasePage (`#right` fallback) renders the desktop
 *  buttons and the bottom bar (inline icons + ⋯ sheet) the mobile ones. */
const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-plus', label: t('settings.aiProviders.add'), color: 'primary', primary: true, onSelect: openCreate },
  { icon: 'i-lucide-cloud', label: t('settings.aiProviders.hubSync'), disabled: syncing.value, onSelect: () => syncFromHub() },
  { icon: 'i-lucide-upload', label: t('settings.aiProviders.import'), disabled: loading.value, onSelect: openImport },
  { icon: 'i-lucide-download', label: t('settings.aiProviders.export'), onSelect: openExport },
  { icon: 'i-lucide-sparkles', label: t('assistant.title'), onSelect: () => { assistantOpen.value = true } },
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), disabled: loading.value, onSelect: () => load() }
]))
mobileBar.registerInfo(computed(() => (loading.value
  ? { loading: true }
  : { count: rows.value.length })))

const trail = computed(() => [
  { label: t('nav.admin_system') },
  { label: t('settings.aiProviders.title') }
])

useHead({ title: computed(() => t('settings.aiProviders.title')) })

onMounted(load)
</script>

<template>
  <BasePage id="ai-providers" :title="t('settings.aiProviders.title')"
    :description="t('settings.aiProviders.description')">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" />
    </template>

    <div class="flex flex-col w-full gap-4 pb-24 lg:pb-6">
      <div class="space-y-4">
        <UAlert v-if="env.configured" color="neutral" variant="subtle" icon="i-lucide-terminal"
          :title="t('settings.aiProviders.envFallback')" :description="`${env.provider} · ${env.model}`" />

        <div v-if="loading && rows.length === 0" class="space-y-2">
          <USkeleton class="h-16 w-full" />
          <USkeleton class="h-16 w-full" />
        </div>

        <p v-else-if="rows.length === 0" class="text-sm text-muted">
          {{ t('settings.aiProviders.noConnections') }}
        </p>

        <div v-else class="divide-y divide-default rounded border border-default">
          <AiProvidersConnectionRow v-for="row in rows" :key="row.id" :row="row" :testing="testingId === row.id"
            :discovering="discoveringId === row.id" @test="test(row)" @toggle="value => toggle(row, value)"
            @edit="openEdit(row)" @remove="deleteTarget = row" @open-models="openModels(row)"
            @discover-models="discoverModelsForRow(row)" />
        </div>
      </div>

      <AiProvidersConnectionModal v-model:open="formOpen" :providers="providers" :row="editingRow" :existing-rows="rows"
        @saved="load" />
      <AiProvidersIoModal v-model:open="ioOpen" :mode="ioMode" @completed="load" />
      <AiProvidersConnectionModelsModal v-model:open="modelsOpen" :connection-id="modelsConnectionId"
        @primary-changed="load" />

      <LazyBaseConfirmModal :open="!!deleteTarget" :title="t('settings.aiProviders.deleteConnectionTitle')"
        :description="deleteTarget?.provider === 'hub'
          ? t('settings.aiProviders.deleteConnectionHubDesc', { name: deleteTarget?.name || '' })
          : t('settings.aiProviders.deleteConnectionDesc', { name: deleteTarget?.name || '' })"
        :confirm-label="t('common.delete')" :loading="deleting" @update:open="value => !value && (deleteTarget = null)"
        @confirm="removeConnection" />

      <BaseModuleAssistantPanel v-if="isRoot" v-model:open="assistantOpen" :scope="{ type: 'provider' }" />
    </div>
  </BasePage>
</template>
