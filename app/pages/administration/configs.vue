<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({
  middleware: () => {
    if (import.meta.client) {
      const a = useAuth()
      if (!a.isAuthenticated.value) return navigateTo('/login')
    }
  }
})

const { t } = useI18n()
const toast = useToast()
const { hubFetch, appId, configs } = useHub()

interface ConfigMeta {
  key: string
  category: string
  isSecret: boolean
  isPublic: boolean
  description?: string
  updatedAt?: string
}

interface ConfigItem extends ConfigMeta {
  value: string
}

interface ConfigsPage {
  success: boolean
  data: Record<string, unknown>
  meta?: ConfigMeta[]
  nextCursor?: string | null
}

type ConfigValueType = 'text' | 'textarea' | 'json' | 'secret' | 'boolean'

function detectConfigType(val: unknown, isSecret = false): ConfigValueType {
  if (isSecret) return 'secret'
  if (val === true || val === false) return 'boolean'
  if (typeof val === 'object' && val !== null) return 'json'
  const str = String(val ?? '').trim()
  if (str === 'true' || str === 'false') return 'boolean'
  if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
    try {
      JSON.parse(str)
      return 'json'
    } catch {
      // not JSON
    }
  }
  if (str.includes('\n') || str.length > 80) return 'textarea'
  return 'text'
}

const loading = ref(false)
const initialLoading = ref(false)
const items = ref<ConfigItem[]>([])
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const search = ref('')
const categoryFilter = ref('all')

const isModalOpen = ref(false)
const editingKey = ref('')
const saving = ref(false)

interface FormState extends Record<string, unknown> {
  key: string
  value: string
  category: string
  type: ConfigValueType
  isSecret: boolean
  isPublic: boolean
  description: string
}

const formState = reactive<FormState>({
  key: '',
  value: '',
  category: 'general',
  type: 'text',
  isSecret: false,
  isPublic: true,
  description: ''
})

const showSecret = ref(false)
const jsonError = ref('')
const jsonEditMode = ref<'tree' | 'code'>('tree')
const jsonModelValue = ref<unknown>({})

const typeOptions = computed(() => [
  { label: t('configs.typeText'), value: 'text', icon: 'i-lucide-type' },
  { label: t('configs.typeTextarea'), value: 'textarea', icon: 'i-lucide-align-left' },
  { label: t('configs.typeJson'), value: 'json', icon: 'i-lucide-braces' },
  { label: t('configs.typeSecret'), value: 'secret', icon: 'i-lucide-key' },
  { label: t('configs.typeBoolean'), value: 'boolean', icon: 'i-lucide-toggle-left' },
])

function selectType(newType: ConfigValueType) {
  formState.type = newType
  if (newType === 'secret') {
    formState.isSecret = true
    formState.isPublic = false
  } else if (newType === 'json') {
    formState.isSecret = false
    try {
      const parsed = JSON.parse(formState.value || '{}')
      jsonModelValue.value = parsed
      formState.value = JSON.stringify(parsed, null, 2)
      jsonError.value = ''
    } catch {
      jsonModelValue.value = {}
    }
  } else if (newType === 'boolean') {
    formState.isSecret = false
    if (formState.value !== 'true' && formState.value !== 'false') {
      formState.value = 'true'
    }
  }
}

function switchJsonEditMode(mode: 'tree' | 'code') {
  jsonEditMode.value = mode
  if (mode === 'tree') {
    try {
      jsonModelValue.value = JSON.parse(formState.value || '{}')
      jsonError.value = ''
    } catch (err: unknown) {
      jsonError.value = err instanceof Error ? err.message : t('configs.invalidJson')
    }
  }
}

watch(jsonModelValue, (val) => {
  if (formState.type === 'json' && jsonEditMode.value === 'tree') {
    formState.value = JSON.stringify(val, null, 2)
  }
}, { deep: true })

function tryFormatJson() {
  try {
    if (!formState.value.trim()) return
    const parsed = JSON.parse(formState.value)
    formState.value = JSON.stringify(parsed, null, 2)
    jsonModelValue.value = parsed
    jsonError.value = ''
  } catch (err: unknown) {
    jsonError.value = err instanceof Error ? err.message : t('configs.invalidJson')
  }
}

function tryMinifyJson() {
  try {
    if (!formState.value.trim()) return
    const parsed = JSON.parse(formState.value)
    formState.value = JSON.stringify(parsed)
    jsonModelValue.value = parsed
    jsonError.value = ''
  } catch (err: unknown) {
    jsonError.value = err instanceof Error ? err.message : t('configs.invalidJson')
  }
}

watch(() => formState.value, (val) => {
  if (formState.type === 'json' && val && val.trim()) {
    try {
      JSON.parse(val)
      jsonError.value = ''
    } catch (err: unknown) {
      jsonError.value = err instanceof Error ? err.message : t('configs.invalidJson')
    }
  } else {
    jsonError.value = ''
  }
})

function getTypeBadgeLabel(type: ConfigValueType) {
  switch (type) {
    case 'json': return 'JSON'
    case 'secret': return 'Secret'
    case 'textarea': return 'Textarea'
    case 'boolean': return 'Bool'
    default: return 'Text'
  }
}

function getTypeBadgeColor(type: ConfigValueType): 'primary' | 'warning' | 'info' | 'neutral' {
  switch (type) {
    case 'json': return 'primary'
    case 'secret': return 'warning'
    case 'textarea': return 'info'
    default: return 'neutral'
  }
}

const isDeleteOpen = ref(false)
const deletingKey = ref('')
const deleting = ref(false)

const revealed = ref<Record<string, boolean>>({})

function mergePage(res: ConfigsPage, reset: boolean) {
  const metaMap = new Map((res.meta || []).map(m => [m.key, m]))
  const page: ConfigItem[] = Object.entries(res.data || {}).map(([key, value]) => {
    const meta = metaMap.get(key)
    return {
      key,
      value: String(value ?? ''),
      category: meta?.category || 'general',
      isSecret: meta?.isSecret || false,
      isPublic: meta?.isPublic ?? true,
      description: meta?.description,
      updatedAt: meta?.updatedAt
    }
  })
  items.value = reset ? page : [...items.value, ...page]
  nextCursor.value = res.nextCursor || null
  hasMore.value = !!res.nextCursor && page.length > 0
}

async function load(reset = false) {
  if (loading.value) return
  loading.value = true
  if (reset) initialLoading.value = true
  try {
    const res = await hubFetch<ConfigsPage>(`/api/v1/apps/${encodeURIComponent(appId)}/configs`, {
      query: { limit: 50, cursor: !reset && nextCursor.value ? nextCursor.value : undefined }
    })
    mergePage(res, reset)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    loading.value = false
    initialLoading.value = false
  }
}

function refresh() {
  categoryFilter.value = 'all'
  return load(true)
}

function loadMore() {
  if (hasMore.value && !loading.value) load(false)
}

const categoryItems = computed(() => {
  const cats = [...new Set(items.value.map(i => i.category))].sort()
  return [
    { label: t('common.all'), value: 'all' },
    ...cats.map(c => ({ label: c, value: c }))
  ]
})

const displayItems = computed(() => {
  let list = items.value
  if (categoryFilter.value !== 'all') list = list.filter(i => i.category === categoryFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter(i => i.key.toLowerCase().includes(q) || i.category.includes(q))
  return list
})

const columns = computed(() => [
  { key: 'key', label: t('configs.key'), class: 'w-52' },
  { key: 'value', label: t('configs.value') },
  { key: 'type', label: t('configs.type'), class: 'w-24' },
  { key: 'category', label: t('configs.category'), class: 'w-28' },
  { key: 'isSecret', label: t('configs.secret'), class: 'w-24' }
])

function openCreate() {
  editingKey.value = ''
  formState.key = ''
  formState.value = ''
  formState.category = 'general'
  formState.type = 'text'
  formState.isSecret = false
  formState.isPublic = true
  formState.description = ''
  jsonModelValue.value = {}
  jsonError.value = ''
  showSecret.value = false
  isModalOpen.value = true
}

function openEdit(item: ConfigItem) {
  editingKey.value = item.key
  formState.key = item.key
  formState.category = item.category || 'general'
  formState.isSecret = item.isSecret || false
  formState.isPublic = item.isPublic ?? !item.isSecret
  formState.description = item.description || ''

  const detected = detectConfigType(item.value, item.isSecret)
  formState.type = detected
  if (item.isSecret) {
    formState.value = ''
    jsonModelValue.value = {}
  } else if (detected === 'json') {
    try {
      const parsed = JSON.parse(item.value)
      jsonModelValue.value = parsed
      formState.value = JSON.stringify(parsed, null, 2)
    } catch {
      jsonModelValue.value = {}
      formState.value = item.value
    }
  } else {
    jsonModelValue.value = {}
    formState.value = item.value
  }
  jsonError.value = ''
  showSecret.value = false
  isModalOpen.value = true
}

async function handleSave() {
  const key = formState.key.trim()
  if (!key) return

  if (formState.type === 'json' && formState.value.trim()) {
    try {
      JSON.parse(formState.value)
    } catch (err: unknown) {
      toast.add({ title: `${t('configs.invalidJson')}: ${err instanceof Error ? err.message : ''}`, color: 'error' })
      return
    }
  }

  let finalValue: unknown = formState.value
  if (formState.type === 'json' && formState.value.trim()) {
    try {
      finalValue = JSON.parse(formState.value)
    } catch {
      finalValue = formState.value
    }
  } else if (formState.type === 'boolean') {
    finalValue = formState.value === 'true'
  }

  // If secret and editing, and left blank -> keep previous secret
  if (formState.type === 'secret' && editingKey.value && !formState.value.trim()) {
    const existing = items.value.find(i => i.key === key)
    if (existing) {
      finalValue = undefined
    }
  }

  saving.value = true
  try {
    if (finalValue !== undefined) {
      await hubFetch(`/api/v1/apps/${encodeURIComponent(appId)}/configs/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: {
          value: finalValue,
          category: formState.category.trim() || 'general',
          isSecret: formState.isSecret,
          isPublic: formState.isPublic,
          description: formState.description.trim() || undefined
        }
      })
    }
    toast.add({ title: t('configs.saved'), icon: 'i-lucide-check', color: 'success' })
    isModalOpen.value = false
    await load(true)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    saving.value = false
  }
}

function confirmDelete(item: ConfigItem) {
  deletingKey.value = item.key
  isDeleteOpen.value = true
}

async function handleDelete() {
  if (!deletingKey.value) return
  deleting.value = true
  try {
    await hubFetch(`/api/v1/apps/${encodeURIComponent(appId)}/configs/${encodeURIComponent(deletingKey.value)}`, {
      method: 'DELETE'
    })
    toast.add({ title: t('configs.deleted'), icon: 'i-lucide-check', color: 'success' })
    isDeleteOpen.value = false
    deletingKey.value = ''
    await load(true)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    deleting.value = false
  }
}

function copyValue(value: string) {
  navigator.clipboard.writeText(value).then(() =>
    toast.add({ title: t('common.copied'), icon: 'i-lucide-check', color: 'success' })
  )
}

const getActionOptions = (item: ConfigItem) => [
  [
    {
      label: t('global.edit'),
      icon: 'i-lucide-pencil',
      onSelect() { openEdit(item) }
    },
    {
      label: t('global.copy'),
      icon: 'i-lucide-copy',
      onSelect() { copyValue(item.value) }
    },
    {
      label: t('global.delete'),
      icon: 'i-lucide-trash',
      color: 'error' as const,
      onSelect() { confirmDelete(item) }
    }
  ]
]

onMounted(() => load(true))
</script>

<template>
  <BasePage id="admin-configs" :title="$t('configs.title')">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton icon="i-lucide-plus" :label="t('configs.new')" color="primary" variant="soft" @click="openCreate" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="loading"
          @click="refresh" />
      </div>
    </template>

    <template #toolbar>
      <div class="flex items-center gap-2 px-4 pb-3 flex-wrap">
        <UInput v-model="search" icon="i-lucide-search" :placeholder="t('common.search')" size="sm"
          class="w-full sm:w-56" />
        <USelect v-model="categoryFilter" :items="categoryItems" value-key="value" size="sm" class="w-36"
          :aria-label="t('configs.category')" />
        <span class="text-xs text-muted whitespace-nowrap">{{ displayItems.length }}</span>
      </div>
    </template>

    <template #default>
      <div class="flex-1 min-h-0 relative h-full">
        <LazyGridList :items="displayItems" :columns="columns" :loading="initialLoading" item-key="key"
          :can-load-more="hasMore" :action-options="getActionOptions" @load-more="loadMore" @refresh="refresh"
          @click="openEdit">
          <template #key="{ item }">
            <div class="min-w-0">
              <span class="font-mono text-xs font-medium text-highlighted truncate block">{{ item.key }}</span>
              <p v-if="item.description" class="text-[11px] text-muted mt-0.5 truncate">
                {{ item.description }}
              </p>
            </div>
          </template>

          <template #value="{ item }">
            <div class="flex items-center gap-1 min-w-0 w-full">
              <code class="text-[11px] py-1 rounded truncate max-w-full flex-1">
                {{ item.isSecret && !revealed[item.key] ? '••••••••' : item.value }}
              </code>
              <UButton v-if="item.isSecret" :icon="revealed[item.key] ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                variant="soft" size="xs" @click.stop="revealed[item.key] = !revealed[item.key]" />
              <UButton icon="i-lucide-copy" variant="soft" size="xs" @click.stop="copyValue(item.value)" />
            </div>
          </template>

          <template #type="{ item }">
            <UBadge :label="getTypeBadgeLabel(detectConfigType(item.value, item.isSecret))"
              :color="getTypeBadgeColor(detectConfigType(item.value, item.isSecret))" variant="subtle" size="xs" />
          </template>

          <template #category="{ item }">
            <UBadge :label="item.category" variant="subtle" size="xs" />
          </template>

          <template #isSecret="{ item }">
            <UBadge v-if="item.isSecret" :label="t('configs.secret')" color="warning" variant="subtle" size="xs" />
            <UBadge v-else-if="item.isPublic" :label="t('configs.public')" color="success" variant="subtle" size="xs" />
          </template>

          <template #mobile-content="{ item }">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-xs font-semibold text-highlighted truncate">{{ item.key }}</span>
                  <UBadge :label="getTypeBadgeLabel(detectConfigType(item.value, item.isSecret))"
                    :color="getTypeBadgeColor(detectConfigType(item.value, item.isSecret))" variant="subtle"
                    size="xs" />
                  <UBadge :label="item.category" variant="subtle" size="xs" />
                  <UBadge v-if="item.isSecret" :label="t('configs.secret')" color="warning" variant="subtle"
                    size="xs" />
                </div>
                <code class="text-[11px] py-0.5 rounded break-all block">
                {{ item.isSecret && !revealed[item.key] ? '••••••••' : item.value }}
              </code>
                <p v-if="item.description" class="text-[11px] text-muted truncate">
                  {{ item.description }}
                </p>
              </div>
              <UDropdownMenu :items="getActionOptions(item)">
                <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" />
              </UDropdownMenu>
            </div>
          </template>

          <template #empty>
            <div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <UIcon name="i-lucide-sliders-horizontal" class="size-10 text-muted" />
              <p class="text-sm text-muted">
                {{ $t('common.no_results') }}
              </p>
            </div>
          </template>
        </LazyGridList>
      </div>

      <!-- Unified Form Modal -->
      <BaseFormModal v-model:open="isModalOpen" :title="editingKey ? t('common.edit') : t('configs.new')"
        :description="editingKey" :state="formState" :loading="saving"
        :submit-label="editingKey ? t('common.save') : t('common.create')" class="max-w-2xl" @submit="handleSave">
        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField :label="t('configs.key')" required>
              <UInput v-model="formState.key" class="w-full font-mono text-xs" placeholder="APP_NAME"
                :disabled="!!editingKey" />
            </UFormField>

            <UFormField :label="t('configs.category')">
              <UInput v-model="formState.category" class="w-full text-xs" placeholder="general" />
            </UFormField>
          </div>

          <!-- Data Type Selection -->
          <UFormField :label="t('configs.type')">
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5 p-1 bg-default/40 rounded-lg border border-default">
              <UButton v-for="opt in typeOptions" :key="opt.value" :label="opt.label" :icon="opt.icon" size="xs"
                :variant="formState.type === opt.value ? 'solid' : 'ghost'"
                :color="formState.type === opt.value ? 'primary' : 'neutral'" class="justify-center"
                @click="selectType(opt.value as ConfigValueType)" />
            </div>
          </UFormField>

          <!-- Dynamic Value Editor based on type -->
          <UFormField :label="t('configs.value')">
            <!-- 1. Text -->
            <UInput v-if="formState.type === 'text'" v-model="formState.value" class="w-full font-mono text-xs"
              :placeholder="t('configs.value')" />

            <!-- 2. Textarea -->
            <UTextarea v-else-if="formState.type === 'textarea'" v-model="formState.value" :rows="6"
              class="w-full font-mono text-xs" :placeholder="t('configs.typeTextarea')" />

            <!-- 3. JSON Editor (Supports visual tree editor & raw code mode) -->
            <div v-else-if="formState.type === 'json'" class="space-y-2 w-full">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-1 bg-default/40 p-0.5 rounded-lg border border-default">
                  <UButton
                    label="Visual Tree"
                    icon="i-lucide-network"
                    size="xs"
                    :variant="jsonEditMode === 'tree' ? 'solid' : 'ghost'"
                    :color="jsonEditMode === 'tree' ? 'primary' : 'neutral'"
                    @click="switchJsonEditMode('tree')"
                  />
                  <UButton
                    label="Raw Code"
                    icon="i-lucide-code"
                    size="xs"
                    :variant="jsonEditMode === 'code' ? 'solid' : 'ghost'"
                    :color="jsonEditMode === 'code' ? 'primary' : 'neutral'"
                    @click="switchJsonEditMode('code')"
                  />
                </div>

                <div class="flex items-center gap-1.5">
                  <UBadge v-if="!jsonError && formState.value.trim()" :label="t('configs.validJson')" color="success"
                    variant="subtle" size="xs" />
                  <UBadge v-else-if="jsonError" :label="t('configs.invalidJson')" color="error" variant="subtle"
                    size="xs" />
                  <UButton :label="t('configs.formatJson')" icon="i-lucide-code" size="xs" variant="soft"
                    color="neutral" @click="tryFormatJson" />
                  <UButton :label="t('configs.minifyJson')" icon="i-lucide-minimize-2" size="xs" variant="soft"
                    color="neutral" @click="tryMinifyJson" />
                </div>
              </div>

              <!-- Visual Json Editor via component inputs/JsonEditor.vue -->
              <div v-if="jsonEditMode === 'tree'" class="h-64 rounded-lg overflow-hidden border border-default">
                <LazyInputsJsonEditor v-model="jsonModelValue" />
              </div>

              <!-- Raw Textarea Code Editor -->
              <div v-else class="space-y-1">
                <UTextarea v-model="formState.value" :rows="8" class="w-full font-mono text-xs"
                  placeholder="{ &quot;key&quot;: &quot;value&quot; }" />
              </div>
              <p v-if="jsonError" class="text-xs text-error font-mono">{{ jsonError }}</p>
            </div>

            <!-- 4. Secret -->
            <div v-else-if="formState.type === 'secret'" class="space-y-2 w-full">
              <UAlert v-if="editingKey && !formState.value" color="info" variant="subtle" icon="i-lucide-info"
                :description="t('configs.secretHint')" />
              <div class="relative flex items-center">
                <UInput v-model="formState.value" :type="showSecret ? 'text' : 'password'"
                  class="w-full font-mono text-xs pr-10" :placeholder="editingKey ? '••••••••' : t('configs.secret')" />
                <UButton :icon="showSecret ? 'i-lucide-eye-off' : 'i-lucide-eye'" variant="ghost" color="neutral"
                  size="xs" class="absolute right-2"
                  :title="showSecret ? t('configs.hideSecret') : t('configs.showSecret')"
                  @click="showSecret = !showSecret" />
              </div>
            </div>

            <!-- 5. Boolean -->
            <div v-else-if="formState.type === 'boolean'" class="flex items-center gap-3 py-2">
              <USwitch :model-value="formState.value === 'true'"
                @update:model-value="(val: boolean) => formState.value = val ? 'true' : 'false'" />
              <span class="font-mono text-xs font-semibold">{{ formState.value === 'true' ? 'true' : 'false' }}</span>
            </div>
          </UFormField>

          <!-- Description -->
          <UFormField :label="t('configs.description')">
            <UInput v-model="formState.description" class="w-full text-xs" :placeholder="t('configs.description')" />
          </UFormField>

          <!-- Flags: isSecret & isPublic -->
          <div class="flex items-center gap-6 pt-2 border-t border-default">
            <div class="flex items-center gap-2">
              <USwitch v-model="formState.isSecret" :disabled="formState.type === 'secret'"
                @update:model-value="(val: boolean) => { if (val) formState.isPublic = false }" />
              <span class="text-xs font-medium">{{ t('configs.secret') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <USwitch v-model="formState.isPublic" :disabled="formState.isSecret" />
              <span class="text-xs font-medium">{{ t('configs.public') }}</span>
            </div>
          </div>
        </div>
      </BaseFormModal>

      <LazyBaseConfirmModal v-model:open="isDeleteOpen" :title="t('confirm.delete_title')"
        :description="t('confirm.delete_desc_name', [deletingKey])" :confirm-label="t('common.delete')"
        :cancel-label="t('common.cancel')" :loading="deleting" color="error" icon="i-lucide-trash-2"
        @confirm="handleDelete" />
    </template>
  </BasePage>
</template>
