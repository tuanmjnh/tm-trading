<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'
import {
  AI_TRANSFER_FORMATS,
  decodeAiTransfer,
  serializeAiTransfer,
  type AiTransferFormat,
  type AiTransferRow
} from '~/utils/aiProviderTransfer'

interface ImportRow {
  provider: string
  name: string
  model: string
  baseUrl: string
  enabled: boolean
  hasKey: boolean
  duplicate?: boolean
}

interface ImportError {
  index: number | null
  label: string | null
  message: string
}

interface ImportPreview {
  preview: boolean
  total: number
  valid: number
  invalid: number
  duplicates: number
  willImport: number
  rows: ImportRow[]
  errors: ImportError[]
}

const props = defineProps<{ open: boolean, mode: 'import' | 'export' }>()

const emit = defineEmits<{ (e: 'completed'): void }>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const notify = useNotify()

const includeSecrets = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const importData = ref('')
const format = ref<AiTransferFormat>('json')
const defaultModel = ref('')
const overwrite = ref(false)
const preview = ref<ImportPreview | null>(null)
/** Problems found while decoding the file itself (before the server validates). */
const localErrors = ref<string[]>([])
const previewing = ref(false)
const committing = ref(false)
const exporting = ref(false)

// Rows that a commit would actually write: with overwrite off, duplicates skip.
const importableCount = computed(() => {
  const p = preview.value
  if (!p) return 0
  return overwrite.value ? p.valid : Math.max(0, p.valid - (p.duplicates ?? 0))
})

watch(open, (value) => {
  if (!value) return
  includeSecrets.value = false
  if (props.mode === 'import') {
    fileName.value = ''
    importData.value = ''
    defaultModel.value = ''
    overwrite.value = false
    preview.value = null
    localErrors.value = []
    format.value = 'json'
  }
})

function applyFormatForName(name: string) {
  const lower = (name || '').toLowerCase()
  if (lower.endsWith('.json')) format.value = 'json'
  else if (lower.endsWith('.csv')) format.value = 'csv'
  else if (lower.endsWith('.env') || lower.endsWith('.txt')) format.value = 'env'
}

watch(fileName, (name) => applyFormatForName(name))

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  applyFormatForName(file.name)
  importData.value = await file.text()
  preview.value = null
  localErrors.value = []
  input.value = ''
  // Preview immediately: the operator picked a file to import, so rows,
  // duplicates and errors must be visible without an extra click. Without
  // this, "Import now" stays disabled with no explanation.
  void previewImport()
}

/**
 * Decode the picked file locally (JSON / ENV / CSV) and hand the normalized
 * rows to the import endpoint, which still owns provider validation, duplicate
 * detection and the encrypted write — the same path a JSON import always used.
 */
function decodeFile(): AiTransferRow[] | null {
  const decoded = decodeAiTransfer(importData.value, { format: format.value, fileName: fileName.value })
  localErrors.value = decoded.errors.map(err => `${err.source}: ${err.message}`)
  preview.value = null
  if (decoded.errors.length || decoded.rows.length === 0) return null
  return decoded.rows
}

async function previewImport() {
  if (!importData.value) return
  const rows = decodeFile()
  if (!rows) return
  previewing.value = true
  try {
    const res = await $fetch<{ data: ImportPreview }>('/api/v1/ai/providers/import', {
      method: 'POST',
      body: { data: { connections: rows }, defaultModel: defaultModel.value.trim(), commit: false }
    })
    preview.value = res.data
  } catch (err) {
    notify.error(t('settings.aiProviders.importTitle'), getErrorMessage(err, key => t(key)))
  } finally {
    previewing.value = false
  }
}

async function commitImport() {
  if (!importData.value) return
  const rows = decodeFile()
  if (!rows) return
  committing.value = true
  try {
    const res = await $fetch<{ data: ImportPreview & { imported: number, skipped: number, failed: number } }>('/api/v1/ai/providers/import', {
      method: 'POST',
      body: {
        data: { connections: rows },
        defaultModel: defaultModel.value.trim(),
        commit: true,
        overwrite: overwrite.value
      }
    })
    const d = res.data
    notify.success(t('settings.aiProviders.importDone'), t('settings.aiProviders.imported', {
      imported: d.imported,
      skipped: d.skipped,
      failed: d.failed
    }))
    open.value = false
    emit('completed')
  } catch (err) {
    notify.error(t('settings.aiProviders.importTitle'), getErrorMessage(err, key => t(key)))
  } finally {
    committing.value = false
  }
}

function download(content: string, name: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

async function downloadExport() {
  if (includeSecrets.value && !window.confirm(t('settings.aiProviders.exportSecretsConfirm'))) return
  exporting.value = true
  try {
    const res = await $fetch<{ data: { connections: Array<AiTransferRow & { apiKey?: string | null }>, unreadable: number } }>(
      '/api/v1/ai/providers/export',
      { query: { includeSecrets: includeSecrets.value ? 1 : 0 } }
    )
    const rows = (res.data?.connections || []).map(row => ({
      provider: row.provider,
      name: row.name || 'default',
      model: row.model || '',
      baseUrl: row.baseUrl || '',
      apiKey: row.apiKey || '',
      enabled: row.enabled !== false
    }))
    if (!rows.length) {
      notify.warning(t('settings.aiProviders.exportTitle'), t('settings.aiProviders.exportEmpty'))
      return
    }
    const out = serializeAiTransfer(rows, format.value, {
      appName: 'tm-trading',
      appId: 'tm-trading',
      includeSecrets: includeSecrets.value
    })
    download(out.content, out.fileName, out.mime)
    notify.success(t('settings.aiProviders.exported', { count: rows.length }))
    if (res.data.unreadable > 0) {
      notify.warning(t('settings.aiProviders.exportUnreadable', { count: res.data.unreadable }))
    }
    open.value = false
    emit('completed')
  } catch (err) {
    notify.error(t('settings.aiProviders.exportTitle'), getErrorMessage(err, key => t(key)))
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open"
    :title="mode === 'import' ? t('settings.aiProviders.importTitle') : t('settings.aiProviders.exportTitle')"
    :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div class="space-y-3">
        <p class="text-xs text-muted">
          {{ mode === 'import' ? t('settings.aiProviders.importHelp') : t('settings.aiProviders.exportHelp') }}
        </p>

        <UFormField :label="t('settings.aiProviders.format')">
          <div class="flex flex-wrap items-center gap-1">
            <UButton v-for="item in AI_TRANSFER_FORMATS" :key="item" size="xs" :label="item === 'json'
              ? t('settings.aiProviders.formatJson')
              : item === 'env'
                ? t('settings.aiProviders.formatEnv')
                : t('settings.aiProviders.formatCsv')" :color="format === item ? 'primary' : 'neutral'"
              :variant="format === item ? 'soft' : 'ghost'" :icon="format === item ? 'i-lucide-check' : undefined"
              @click="format = item" />
          </div>
        </UFormField>

        <template v-if="mode === 'export'">
          <div class="flex items-center gap-3">
            <USwitch v-model="includeSecrets" />
            <div>
              <p class="text-sm font-medium text-highlighted">{{ t('settings.aiProviders.includeSecrets') }}</p>
              <p class="text-xs text-muted">{{ t('settings.aiProviders.includeSecretsHelp') }}</p>
            </div>
          </div>
          <UAlert v-if="includeSecrets" color="warning" variant="subtle" icon="i-lucide-triangle-alert"
            :description="t('settings.aiProviders.exportSecretsConfirm')" />
        </template>

        <template v-else>
          <input ref="fileInput" type="file" accept=".json,.env,.csv,.txt,application/json,text/csv,text/plain"
            class="hidden" @change="readFile">
          <div class="flex flex-wrap items-center gap-2">
            <UButton icon="i-lucide-file-up" color="neutral" variant="soft" size="sm"
              :label="t('settings.aiProviders.chooseFile')" @click="fileInput?.click()" />
            <span class="text-xs text-muted">{{ fileName || t('settings.aiProviders.noFile') }}</span>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('settings.aiProviders.defaultModel')"
              :help="t('settings.aiProviders.defaultModelHelp')">
              <UInput v-model="defaultModel" class="w-full" placeholder="gpt-4o-mini" />
            </UFormField>
            <UFormField :label="t('settings.aiProviders.overwrite')" :help="t('settings.aiProviders.overwriteHelp')">
              <div class="flex h-8 items-center">
                <USwitch v-model="overwrite" />
              </div>
            </UFormField>
          </div>

          <div v-if="localErrors.length" class="max-h-40 space-y-1 overflow-auto rounded border border-error/40 p-3">
            <p v-for="(err, index) in localErrors" :key="index" class="text-xs text-error">
              {{ err }}
            </p>
          </div>

          <div v-if="preview" class="space-y-2 rounded border border-default p-3">
            <p class="text-sm text-highlighted">
              {{ t('settings.aiProviders.previewSummary', { valid: preview.valid, invalid: preview.invalid }) }}
            </p>
            <p v-if="preview.duplicates" class="text-xs text-warning">
              {{ t('settings.aiProviders.previewDuplicates', { count: preview.duplicates }) }}
            </p>
            <p v-if="preview.rows.length && importableCount === 0" class="text-xs font-medium text-error">
              {{ t('settings.aiProviders.importBlocked') }}
            </p>
            <div v-if="preview.rows.length" class="max-h-56 space-y-1 overflow-auto">
              <div v-for="row in preview.rows" :key="`${row.provider}:${row.name}`"
                class="flex flex-wrap items-center gap-2 text-xs">
                <span class="font-mono text-muted">{{ row.provider }}</span>
                <span class="font-medium text-highlighted">{{ row.name }}</span>
                <span class="text-muted">{{ row.model }}</span>
                <UBadge v-if="row.hasKey" color="success" variant="subtle" size="sm">{{ t('settings.aiProviders.hasKey')
                }}</UBadge>
                <UBadge v-if="row.duplicate" color="warning" variant="subtle" size="sm">{{
                  t('settings.aiProviders.duplicateRow') }}</UBadge>
              </div>
            </div>
            <div v-if="preview.errors.length" class="max-h-40 space-y-1 overflow-auto">
              <p v-for="(err, index) in preview.errors" :key="index" class="text-xs text-error">
                {{ err.label || `#${(err.index ?? 0) + 1}` }} — {{ err.message }}
              </p>
            </div>
          </div>
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="mode === 'import'">
          <UButton color="neutral" variant="soft" :label="t('settings.aiProviders.preview')" :loading="previewing"
            :disabled="!importData" @click="previewImport" />
          <UButton :label="t('settings.aiProviders.importNow')" variant="soft" :loading="committing"
            :disabled="!preview || importableCount === 0" @click="commitImport" />
        </template>
        <template v-else>
          <UButton icon="i-lucide-download" :label="t('settings.aiProviders.exportDownload')" variant="soft"
            :loading="exporting" @click="downloadExport" />
        </template>
      </div>
    </template>
  </UModal>
</template>
