<script setup lang="ts">
import type { App } from '~~/types'
import type { ConfigItem } from '~/composables/useAdminConfigs'
import { getErrorMessage } from '~/shared/utils/errors'
import { useModuleExport, buildExportChildren } from '~/composables/admin/useModuleExport'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ app: App | null }>()

const { t } = useI18n()
const notify = useNotify()
const auth = useAuth()
const configs = useAdminConfigs()
const { exporting: exportingConfigs, exportModule: exportConfigs } = useModuleExport()

const canWrite = computed(() => auth.hasPermission('configs.write'))
const canExport = computed(() => auth.hasPermission('configs.export'))

// Consolidate Export (configs, CSV/JSON) + Import (centralized import module link)
// into 1 ellipsis menu to simplify header
const overflowMenuItems = computed(() => [
  ...(canExport.value
    ? [{
        label: t('admin.export.action'),
        icon: 'i-lucide-file-down',
        disabled: exportingConfigs.value,
        children: buildExportChildren(t, fmt => props.app && exportConfigs(props.app.id, 'configs', fmt))
      }]
    : []),
  ...(auth.hasPermission('imports.read')
    ? [{ label: t('import.open'), icon: 'i-lucide-file-up', onSelect: openImport }]
    : [])
])

// Import configs -> centralized import module
function openImport() {
  open.value = false
  navigateTo({ path: '/resources/import', query: { target: 'configs' } })
}

const revealed = ref<Record<string, boolean>>({})
const saving = ref(false)

// --- editor kind: JSON object/array -> JsonEditor, long/multiline -> UTextarea, others -> UInput ---
type EditorKind = 'json' | 'long' | 'short'

const MASKED = '••••••••'

function isMasked(value: string) {
  return value.includes('••••')
}

function tryParseJson(value: string): Record<string, unknown> | unknown[] | null {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // not JSON
  }
  return null
}

function editorKind(value: string): EditorKind {
  if (isMasked(value)) return 'short'
  const v = value.trim()
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    if (tryParseJson(v)) return 'json'
  }
  if (v.includes('\n') || v.length > 120) return 'long'
  return 'short'
}

function displayValue(item: ConfigItem) {
  return item.isSecret && !revealed.value[item.key] ? MASKED : item.value
}

function copyValue(value: string) {
  navigator.clipboard.writeText(value)
    .then(() => notify.success(t('common.copied')))
    .catch(() => notify.error(t('common.error')))
}

// --- edit existing entry ---
const editingKey = ref<string | null>(null)
const editValue = ref('')
const editJson = ref<Record<string, unknown> | unknown[] | null>(null)

const editingItem = computed(() => configs.items.value.find(i => i.key === editingKey.value) || null)
const editKind = computed<EditorKind>(() => editingItem.value ? editorKind(editingItem.value.value) : 'short')

function startEdit(item: ConfigItem) {
  isNewOpen.value = false
  editingKey.value = item.key
  editValue.value = isMasked(item.value) ? '' : item.value
  editJson.value = editorKind(item.value) === 'json' ? tryParseJson(item.value) : null
}

function cancelEdit() {
  editingKey.value = null
}

async function saveEdit() {
  const item = editingItem.value
  if (!item || saving.value) return

  let value: string
  if (isMasked(item.value)) {
    // Masked secret value - leave empty to preserve without overwriting
    if (!editValue.value.trim()) {
      cancelEdit()
      return
    }
    value = editValue.value
  } else if (editKind.value === 'json') {
    value = JSON.stringify(editJson.value ?? {})
  } else {
    value = editValue.value
  }

  if (value === item.value) {
    cancelEdit()
    return
  }

  saving.value = true
  try {
    await configs.saveConfigs({ [item.key]: value })
    notify.success(t('configs.saved'))
    cancelEdit()
  } catch (err: any) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    saving.value = false
  }
}

// --- new entry ---
const isNewOpen = ref(false)
const newKey = ref('')
const newValue = ref('')
const newJson = ref<Record<string, unknown> | unknown[] | null>(null)
const newEditor = ref<'text' | 'json'>('text')

function startNew() {
  editingKey.value = null
  newKey.value = ''
  newValue.value = ''
  newJson.value = null
  newEditor.value = 'text'
  isNewOpen.value = true
}

function cancelNew() {
  isNewOpen.value = false
}

function setNewEditor(kind: 'text' | 'json') {
  if (kind === newEditor.value) return
  if (kind === 'json') {
    newJson.value = tryParseJson(newValue.value) || {}
    newEditor.value = 'json'
  } else {
    newValue.value = newJson.value ? JSON.stringify(newJson.value, null, 2) : ''
    newEditor.value = 'text'
  }
}

async function saveNew() {
  if (saving.value) return
  const key = newKey.value.trim()
  if (!key) {
    notify.error(t('error.required'))
    return
  }
  if (configs.items.value.some(i => i.key === key)) {
    notify.error(t('configs.duplicateKey'))
    return
  }
  const value = newEditor.value === 'json' ? JSON.stringify(newJson.value ?? {}) : newValue.value
  saving.value = true
  try {
    await configs.saveConfigs({ [key]: value })
    notify.success(t('configs.saved'))
    isNewOpen.value = false
  } catch (err: any) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    saving.value = false
  }
}

// --- delete ---
const isDeleteOpen = ref(false)
const deletingKey = ref('')

function confirmDelete(key: string) {
  deletingKey.value = key
  isDeleteOpen.value = true
}

async function handleDelete() {
  if (!deletingKey.value || saving.value) return
  saving.value = true
  try {
    await configs.deleteConfigs([deletingKey.value])
    notify.success(t('configs.deleted'))
    if (editingKey.value === deletingKey.value) editingKey.value = null
    isDeleteOpen.value = false
    deletingKey.value = ''
  } catch (err: any) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    saving.value = false
  }
}

// --- load on open ---
watch(open, async (val) => {
  if (!val) {
    editingKey.value = null
    isNewOpen.value = false
    return
  }
  const app = props.app
  if (!app) return
  editingKey.value = null
  isNewOpen.value = false
  try {
    if (configs.targetAppId.value !== app.id) await configs.setApp(app.id)
    else await configs.refresh()
  } catch (err: any) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
})
</script>

<template>
  <BaseResponsiveSlideover v-model:open="open" :title="t('configs.title')"
    :description="app?.name || app?.id" icon="i-lucide-settings-2" :loading="configs.initialLoading.value"
    :ui="{ content: 'w-screen max-w-xl' }">
    <template #header-right>
      <div class="flex items-center gap-1">
        <UButton v-if="canWrite" icon="i-lucide-plus" color="neutral" variant="ghost" size="xs"
          :aria-label="t('configs.new')" @click="startNew" />
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="xs"
          :aria-label="t('common.refresh')" :loading="configs.loading.value" @click="configs.refresh()" />
        <UDropdownMenu v-if="overflowMenuItems.length" :items="overflowMenuItems"
          :popper="{ placement: 'bottom-end' }">
          <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs"
            :aria-label="t('common.actions')" />
        </UDropdownMenu>
      </div>
    </template>

    <template #body>
      <div v-if="app" class="space-y-3">
        <!-- New config card -->
        <div v-if="isNewOpen" class="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div class="flex items-center gap-2">
            <UInput v-model="newKey" :placeholder="t('configs.key')" class="flex-1 font-mono text-xs" />
            <div class="flex rounded-lg border border-default overflow-hidden shrink-0">
              <UButton :label="t('configs.asText')" size="xs" color="neutral"
                :variant="newEditor === 'text' ? 'solid' : 'ghost'" :ui="{ label: 'hidden sm:block' }"
                icon="i-lucide-align-left" @click="setNewEditor('text')" />
              <UButton :label="t('configs.asJson')" size="xs" color="neutral"
                :variant="newEditor === 'json' ? 'solid' : 'ghost'" :ui="{ label: 'hidden sm:block' }"
                icon="i-lucide-file-json" @click="setNewEditor('json')" />
            </div>
          </div>

          <UTextarea v-if="newEditor === 'text'" v-model="newValue" :placeholder="t('configs.value')" :rows="3"
            class="w-full font-mono text-xs" />
          <div v-else class="h-48 rounded-lg overflow-hidden border border-default">
            <LazyInputsJsonEditor v-model="newJson" />
          </div>

          <div class="flex justify-end gap-2">
            <UButton :label="t('common.cancel')" size="xs" color="neutral" variant="ghost" @click="cancelNew" />
            <UButton :label="t('common.create')" icon="i-lucide-plus" size="xs" color="primary" variant="soft"
              :loading="saving" @click="saveNew" />
          </div>
        </div>

        <!-- Loading -->
        <div v-if="configs.initialLoading.value" class="flex flex-col items-center justify-center py-12 gap-3">
          <UIcon name="i-lucide-loader-2" class="w-7 h-7 animate-spin text-primary" />
          <span class="text-xs text-muted">{{ t('common.loading') }}</span>
        </div>

        <!-- Empty -->
        <div v-else-if="configs.items.value.length === 0 && !isNewOpen"
          class="flex flex-col items-center justify-center py-12 gap-3">
          <UIcon name="i-lucide-file-json" class="w-8 h-8 text-muted" />
          <p class="text-sm text-muted">{{ t('apps.noConfigsYet') }}</p>
          <UButton v-if="canWrite" :label="t('configs.new')" icon="i-lucide-plus" size="xs" color="primary"
            variant="soft" @click="startNew" />
        </div>

        <!-- List -->
        <template v-else>
          <div v-for="item in configs.items.value" :key="item.key"
            class="rounded-xl border border-default bg-default/30 p-3 space-y-2">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs font-semibold text-highlighted truncate">{{ item.key }}</span>
              <UBadge v-if="item.isSecret" :label="t('configs.secret')" color="warning" variant="subtle" size="xs" />
              <UBadge v-else-if="item.isPublic" :label="t('configs.public')" color="success" variant="subtle"
                size="xs" />
              <UBadge :label="item.category" color="neutral" variant="soft" size="xs" class="ms-auto shrink-0" />
            </div>

            <p v-if="item.description" class="text-[11px] text-muted">{{ item.description }}</p>

            <!-- Edit mode -->
            <div v-if="editingKey === item.key" class="space-y-2 pt-2 border-t border-default">
              <UAlert v-if="isMasked(item.value)" color="info" variant="subtle" icon="i-lucide-info"
                :description="t('configs.secretHint')" />

              <div v-if="editKind === 'json'" class="h-52 rounded-lg overflow-hidden border border-default">
                <LazyInputsJsonEditor v-model="editJson" />
              </div>
              <UTextarea v-else-if="editKind === 'long'" v-model="editValue" :rows="6"
                class="w-full font-mono text-xs" />
              <UInput v-else v-model="editValue" class="w-full font-mono text-xs"
                :placeholder="isMasked(item.value) ? MASKED : t('configs.value')" />

              <div class="flex justify-end gap-2">
                <UButton :label="t('common.cancel')" size="xs" color="neutral" variant="ghost"
                  @click="cancelEdit" />
                <UButton :label="t('common.save')" icon="i-lucide-save" size="xs" color="primary" variant="soft"
                  :loading="saving" @click="saveEdit" />
              </div>
            </div>

            <!-- View mode -->
            <div v-else class="flex items-start gap-2 pt-2 border-t border-default">
              <code class="flex-1 min-w-0 text-xs font-mono break-all text-highlighted">{{ displayValue(item)
              }}</code>
              <div class="flex items-center gap-0.5 shrink-0">
                <UButton v-if="item.isSecret" :icon="revealed[item.key] ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  color="neutral" variant="ghost" size="xs" :aria-label="t('configs.secret')"
                  @click="revealed[item.key] = !revealed[item.key]" />
                <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs"
                  :aria-label="t('common.copied')" @click="copyValue(item.value)" />
                <template v-if="canWrite">
                  <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs"
                    :aria-label="t('common.edit')" @click="startEdit(item)" />
                  <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs"
                    :aria-label="t('common.delete')" @click="confirmDelete(item.key)" />
                </template>
              </div>
            </div>
          </div>

          <div v-if="configs.hasMore.value" class="flex justify-center pt-1">
            <UButton :label="t('common.loadMore')" size="xs" color="neutral" variant="ghost"
              :loading="configs.loading.value" @click="configs.loadMore()" />
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full gap-2">
        <span class="text-xs text-muted">{{ t('apps.configsCount', { count: configs.items.value.length })
        }}</span>
        <UButton :label="t('common.close')" color="neutral" variant="ghost" size="sm" @click="open = false" />
      </div>
    </template>
  </BaseResponsiveSlideover>

  <BaseConfirmModal v-model:open="isDeleteOpen" :title="t('confirm.delete_title')"
    :description="t('confirm.delete_desc_name', [deletingKey])" :confirm-label="t('common.delete')"
    :cancel-label="t('common.cancel')" color="error" icon="i-lucide-trash-2" :loading="saving"
    @confirm="handleDelete" />
</template>
