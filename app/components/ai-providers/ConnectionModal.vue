<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'
import type { AiProviderConnectionRow, AiProviderDef } from '~/types/aiProviders'
import { aiProviderErrorText } from '~/utils/aiProvidersUi'

const props = defineProps<{
  open: boolean
  providers: AiProviderDef[]
  /** Existing connection in edit mode; null in create mode. */
  row?: AiProviderConnectionRow | null
  existingRows?: AiProviderConnectionRow[]
}>()

const emit = defineEmits<{ (e: 'saved'): void }>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const notify = useNotify()
const auth = useAuth()

/** Root-only affordance: reveal + copy the stored key (server enforces too).
 *  `permissions: ['*']` covers super admins; a stale token issued before a hub
 *  upgrade may lack the expanded claim, so the `root` role is accepted too. */
const isRoot = computed(() => {
  const u = auth.user.value
  return !!u && (u.permissions?.includes('*') === true || u.role === 'root')
})

const form = reactive({ provider: 'openai', name: 'default', model: '', baseUrl: '', apiKey: '', enabled: true })
const modelOptions = ref<string[]>([])
const modelMenuItems = computed(() => modelOptions.value.map(m => ({ label: m, value: m })))
const modelPersistProgress = ref('')
const discovering = ref(false)
const saving = ref(false)
// The provider the edited connection was loaded with. Changing it means the
// stored key (if any) no longer applies, so a fresh key is required.
const originalProvider = ref<string | null>(null)
let suppressProviderWatch = false

const providerItems = computed(() => props.providers
  // Hub rows are created only by the hub sync — never by hand.
  .filter(p => p.key !== 'hub')
  .map(p => ({ label: p.name, value: p.key })))

const currentDef = computed(() => props.providers.find(p => p.key === form.provider) ?? null)
const providerChanged = computed(() => Boolean(props.row && originalProvider.value && form.provider !== originalProvider.value))

function isLocalUrl(url?: string | null): boolean {
  if (!url) return false
  const trimmed = url.trim()
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|::1|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i.test(trimmed)
}

const isEffectiveKeyless = computed(() =>
  Boolean(currentDef.value?.keyless || isLocalUrl(form.baseUrl || currentDef.value?.baseUrl) || /freellm|local/i.test(form.provider))
)

const canSave = computed(() => Boolean(
  form.provider && form.model.trim()
  && (isEffectiveKeyless.value || form.apiKey.trim() || (props.row && !providerChanged.value)),
))

/**
 * Auto-generate a readable connection name:
 * - Standard provider: based on provider type name (e.g. openai-main, amd_radeon-main).
 * - Custom provider: different style (e.g. custom-endpoint-1, custom-endpoint-2).
 */
function autoNameForProvider(providerKey: string): string {
  const isCustom = providerKey === 'custom' || providerKey.startsWith('custom_')
  const existing = new Set((props.existingRows || []).map(r => (r.name || '').toLowerCase()))

  if (isCustom) {
    let candidate = 'custom-endpoint-1'
    let idx = 1
    while (existing.has(candidate.toLowerCase())) {
      idx++
      candidate = `custom-endpoint-${idx}`
    }
    return candidate
  } else {
    const baseKey = providerKey.toLowerCase().replace(/[^a-z0-9_]+/g, '_')
    let candidate = `${baseKey}-main`
    if (existing.has(candidate.toLowerCase())) {
      let idx = 2
      candidate = `${baseKey}-${idx}`
      while (existing.has(candidate.toLowerCase())) {
        idx++
        candidate = `${baseKey}-${idx}`
      }
    }
    return candidate
  }
}

// --- root key reveal ----------------------------------------------------------
const revealedKey = ref('')
const revealingKey = ref(false)

function copyRevealed() {
  if (!revealedKey.value) return
  navigator.clipboard.writeText(revealedKey.value).then(() => {
    notify.success(t('settings.aiProviders.keyCopied'))
  }).catch(() => { /* clipboard unavailable */ })
}

async function revealKey() {
  if (!props.row?.id) return
  revealingKey.value = true
  try {
    const res = await $fetch<{ data: { apiKey: string } }>(
      `/api/v1/ai/providers/connections/${encodeURIComponent(props.row.id)}/key`,
    )
    revealedKey.value = res.data.apiKey
  } catch (err) {
    notify.error(t('settings.aiProviders.revealKeyFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    revealingKey.value = false
  }
}

function init() {
  suppressProviderWatch = true
  revealedKey.value = ''
  if (props.row) {
    originalProvider.value = props.row.provider
    form.provider = props.row.provider
    form.name = props.row.name
    form.model = props.row.model
    form.baseUrl = props.row.baseUrl
    form.apiKey = ''
    form.enabled = props.row.enabled
  } else {
    originalProvider.value = null
    const def = props.providers[0]
    form.provider = def?.key ?? 'openai'
    form.name = autoNameForProvider(form.provider)
    form.model = ''
    form.baseUrl = def?.baseUrl ?? ''
    form.apiKey = ''
    form.enabled = true
  }
  modelOptions.value = []
  nextTick(() => { suppressProviderWatch = false })
}

watch(open, (value) => {
  if (value) init()
})

watch(() => form.provider, (key) => {
  if (suppressProviderWatch) return
  const def = props.providers.find(p => p.key === key)
  form.baseUrl = def?.baseUrl ?? ''
  form.model = ''
  modelOptions.value = []
  // Create mode: the default label follows the chosen provider.
  if (!props.row) form.name = autoNameForProvider(key)
})

async function discoverModels() {
  if (!form.provider) return
  if (!isEffectiveKeyless.value && !form.apiKey.trim()) {
    notify.error(t('settings.aiProviders.discoverFailed'), t('settings.aiProviders.discoverNoKey'))
    return
  }
  discovering.value = true
  modelOptions.value = []
  try {
    const res = await $fetch<{ data: { ok: boolean, models: string[], code: string | null, error: string | null } }>(
      '/api/v1/ai/providers/connections/discover',
      {
        method: 'POST',
        body: {
          provider: form.provider,
          baseUrl: form.baseUrl.trim() || undefined,
          // Edit mode: omit the key → the server falls back to the connection's
          // STORED key (decrypted server-side, never returned — D35).
          apiKey: form.apiKey.trim() || undefined,
          connectionId: props.row?.id ?? undefined,
          model: form.model.trim() || undefined
        }
      }
    )
    if (res.data.ok) {
      modelOptions.value = res.data.models
      if (res.data.models.length) {
        notify.success(t('settings.aiProviders.discovered', { count: res.data.models.length }))
        if (!form.model && res.data.models[0]) form.model = res.data.models[0]
      } else {
        notify.warning(t('settings.aiProviders.discoveredNone'))
      }
    } else {
      notify.error(t('settings.aiProviders.discoverFailed'), aiProviderErrorText(t, res.data.code, res.data.error))
    }
  } catch (err) {
    notify.error(t('settings.aiProviders.discoverFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    discovering.value = false
  }
}

/** Persist the freshly discovered list into the connection's catalogue. */
async function saveDiscoveredTo(connectionId: string, models: string[]) {
  const res = await $fetch<{ data: { added: number } }>(
    `/api/v1/ai/providers/connections/${encodeURIComponent(connectionId)}/models`,
    { method: 'POST', body: { models, source: 'discovered' } },
  )
  return res.data.added
}

async function saveDiscovered() {
  if (!props.row?.id || modelOptions.value.length === 0) return
  try {
    const added = await saveDiscoveredTo(props.row.id, modelOptions.value)
    notify.success(t('settings.aiProviders.savedDiscovered', { added }))
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  }
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    const res = await $fetch<{ data: { id: string | null } }>('/api/v1/ai/providers/connections', {
      method: 'POST',
      body: {
        id: props.row?.id ?? undefined,
        provider: form.provider,
        name: form.name.trim() || 'default',
        model: form.model.trim(),
        baseUrl: form.baseUrl.trim() || undefined,
        apiKey: form.apiKey.trim() || undefined,
        enabled: form.enabled
      }
    })
    const targetId = props.row?.id ?? res.data?.id
    const modelsToSave = Array.from(new Set([
      ...(form.model ? [form.model.trim()] : []),
      ...modelOptions.value.map(m => m.trim())
    ])).filter(Boolean)
    if (targetId && modelsToSave.length) {
      const chunkSize = 50
      for (let i = 0; i < modelsToSave.length; i += chunkSize) {
        const chunk = modelsToSave.slice(i, i + chunkSize)
        modelPersistProgress.value = `${Math.min(i + chunkSize, modelsToSave.length)}/${modelsToSave.length}`
        await saveDiscoveredTo(targetId, chunk).catch(() => {})
      }
    }
    notify.success(t('settings.aiProviders.saved'))
    open.value = false
    emit('saved')
  } catch (err) {
    notify.error(t('settings.aiProviders.title'), getErrorMessage(err, key => t(key)))
  } finally {
    saving.value = false
    modelPersistProgress.value = ''
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="row ? t('common.edit') : t('settings.aiProviders.add')"
    :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t('settings.aiProviders.provider')">
            <USelectMenu v-model="form.provider" :items="providerItems" value-key="value" label-key="label"
              :search-input="{ placeholder: t('settings.aiProviders.searchProvider') }" class="w-full" />
          </UFormField>
          <UFormField :label="t('settings.aiProviders.name')">
            <div class="flex gap-2">
              <UInput v-model="form.name" class="w-full" placeholder="default" />
              <UButton v-if="!row" icon="i-lucide-sparkles" color="neutral" variant="soft"
                :title="t('settings.aiProviders.autoGenerateName')"
                :aria-label="t('settings.aiProviders.autoGenerateName')"
                @click="form.name = autoNameForProvider(form.provider)" />
            </div>
          </UFormField>
          <UFormField :label="t('settings.aiProviders.model')">
            <div class="flex gap-2">
              <USelectMenu v-if="modelOptions.length" v-model="form.model"
                :items="modelMenuItems" value-key="value" label-key="label"
                :search-input="{ placeholder: t('settings.aiProviders.searchModel') }" class="w-full" placeholder="—" />
              <UInput v-else v-model="form.model" class="w-full" placeholder="gpt-4o-mini" />
              <UButton icon="i-lucide-sparkles" color="neutral" variant="soft" :loading="discovering"
                :disabled="!currentDef || (!isEffectiveKeyless && !form.apiKey.trim() && !row)"
                :aria-label="t('settings.aiProviders.discoverModels')" :title="t('settings.aiProviders.discoverModels')"
                :label="t('settings.aiProviders.discoverModels')"
                @click="discoverModels" />
            </div>
            <UButton v-if="modelOptions.length && row" icon="i-lucide-save" color="neutral" variant="soft" size="xs"
              class="mt-1.5 self-start"
              :label="t('settings.aiProviders.saveDiscovered', { count: modelOptions.length })"
              @click="saveDiscovered" />
          </UFormField>
          <UFormField :label="t('settings.aiProviders.baseUrl')">
            <UInput v-model="form.baseUrl" class="w-full" :placeholder="currentDef?.baseUrl ?? 'https://…/v1'" />
          </UFormField>
          <UFormField :label="isEffectiveKeyless ? t('settings.aiProviders.apiKeyOptional') : t('settings.aiProviders.apiKey')"
            :help="row && !providerChanged ? t('settings.aiProviders.apiKeyHint') : (isEffectiveKeyless ? t('settings.aiProviders.apiKeyOptionalHint') : undefined)">
            <UInput v-model="form.apiKey" type="password" class="w-full" autocomplete="new-password"
              :placeholder="isEffectiveKeyless ? t('settings.aiProviders.apiKeyOptionalPlaceholder') : '••••••••'" />
            <!-- Root-only: reveal + copy the stored key (server enforces root). -->
            <div v-if="isRoot && row && !providerChanged" class="mt-2 flex flex-wrap items-center gap-2">
              <UButton icon="i-lucide-eye" color="neutral" variant="soft" size="xs" :loading="revealingKey"
                :label="t('settings.aiProviders.revealKey')" @click="revealKey" />
              <template v-if="revealedKey">
                <code class="max-w-[240px] truncate rounded bg-elevated px-2 py-1 font-mono text-xs text-muted"
                  :title="revealedKey">{{ revealedKey }}</code>
                <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs"
                  :aria-label="t('settings.aiProviders.keyCopied')" :title="t('settings.aiProviders.copyKey')"
                  @click="copyRevealed" />
              </template>
            </div>
          </UFormField>
          <UFormField :label="t('settings.aiProviders.enabled')">
            <div class="flex h-8 items-center">
              <USwitch v-model="form.enabled" />
            </div>
          </UFormField>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="open = false" />
        <UButton :label="modelPersistProgress ? t('settings.aiProviders.savingModelsProgress', { progress: modelPersistProgress }) : t('common.save')" :loading="saving" variant="soft" :disabled="!canSave" @click="save" />
      </div>
    </template>
  </UModal>
</template>
