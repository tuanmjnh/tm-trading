<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'
import { readCsv, readJson } from '~/shared/utils/helper'

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
const route = useRoute()
const { hubFetch, appId } = useHub()

type SourceKey = 'csv' | 'json' | 'paste' | 'sheets'
type ImportRow = Record<string, unknown>

interface TargetDef {
  key: string
  identifierField: string
  requiredFields: string[]
  optionalFields: string[]
}

interface RowResult {
  index: number
  ok: boolean
  action: 'create' | 'update' | null
  identifier?: string
  error?: string
}

interface RunResult {
  total: number
  created: number
  updated: number
  failed: number
  results: RowResult[]
}

const VALID_TARGETS = ['apps', 'configs', 'users', 'routes', 'roles', 'permissions', 'media', 'notifications']

const source = ref<SourceKey>('csv')
const target = ref('configs')
const rows = ref<ImportRow[]>([])
const sourceLabel = ref('')
const targets = ref<TargetDef[]>([])
const pasteText = ref('')
const sheetId = ref('')
const sheetRange = ref('Sheet1!A1:Z1000')

const parsing = ref(false)
const fetchingSheet = ref(false)
const previewing = ref(false)
const running = ref(false)
const previewResults = ref<RowResult[] | null>(null)
const runResult = ref<RunResult | null>(null)
const isRunOpen = ref(false)

const sourceItems = computed(() => [
  { label: t('import.source.csv'), value: 'csv' },
  { label: t('import.source.json'), value: 'json' },
  { label: t('import.source.paste'), value: 'paste' },
  { label: t('import.source.google'), value: 'sheets' }
])

const targetItems = computed(() => targets.value.map(ti => ({ label: ti.key, value: ti.key })))
const targetDef = computed(() => targets.value.find(ti => ti.key === target.value) || null)

watch(() => route.query.target, (v) => {
  if (typeof v === 'string' && (VALID_TARGETS.includes(v) || targets.value.some(t => t.key === v))) target.value = v
}, { immediate: true })

watch(target, () => {
  previewResults.value = null
  runResult.value = null
})

async function loadTargets() {
  try {
    const res = await hubFetch<{ success: boolean, data: TargetDef[] }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/import`
    )
    targets.value = res.data || []
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

onMounted(loadTargets)

function setRows(parsed: ImportRow[], label: string) {
  rows.value = parsed.slice(0, 500)
  sourceLabel.value = label
  previewResults.value = null
  runResult.value = null
}

async function handleFile(event: Event, kind: 'csv' | 'json') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  parsing.value = true
  try {
    const text = await file.text()
    const parsed = kind === 'csv' ? readCsv(text) : readJson(text)
    if (!parsed.length) {
      toast.add({ title: t('import.invalidFile'), color: 'error' })
      return
    }
    setRows(parsed, file.name)
  } catch {
    toast.add({ title: t('import.invalidFile'), color: 'error' })
  } finally {
    parsing.value = false
  }
}

function parsePaste() {
  const text = pasteText.value.trim()
  if (!text) return
  try {
    const isJson = text.startsWith('[') || text.startsWith('{')
    const parsed = (isJson ? readJson(text) : readCsv(text)) as ImportRow[]
    if (!parsed.length) {
      toast.add({ title: t('import.invalidFile'), color: 'error' })
      return
    }
    setRows(parsed, t('import.paste'))
  } catch {
    toast.add({ title: t('import.invalidFile'), color: 'error' })
  }
}

async function fetchSheet() {
  if (!sheetId.value.trim() || !sheetRange.value.trim()) return
  fetchingSheet.value = true
  try {
    const query = new URLSearchParams({
      spreadsheet_id: sheetId.value.trim(),
      range: sheetRange.value.trim()
    })
    const res = await hubFetch<{ success: boolean, data: { range: string, values: string[][] } }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/import/sheets?${query.toString()}`
    )
    const values = res.data?.values || []
    if (values.length < 2) {
      toast.add({ title: t('import.invalidFile'), color: 'error' })
      return
    }
    const headers = (values[0] || []).map(h => String(h ?? '').trim())
    const parsed: ImportRow[] = values.slice(1)
      .filter(r => (r || []).some(c => String(c ?? '').trim() !== ''))
      .map(r => Object.fromEntries(headers.map((h, i) => [h, String(r?.[i] ?? '')])))
    if (!parsed.length) {
      toast.add({ title: t('import.invalidFile'), color: 'error' })
      return
    }
    setRows(parsed, `Sheets: ${res.data.range}`)
    toast.add({ title: t('import.parsed', [parsed.length]), icon: 'i-lucide-check', color: 'success' })
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    fetchingSheet.value = false
  }
}

async function runPreview() {
  if (!rows.value.length) return
  previewing.value = true
  try {
    const res = await hubFetch<{
      success: boolean
      data: {
        validation: { valid: boolean, errors: Array<{ row: number, message: string }> }
        preview: {
          items: Array<Record<string, unknown>>
          errors: Array<{ row: number, message: string }>
          warnings: Array<{ row: number, message: string }>
          summary: Record<string, number>
        }
      }
    }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/import/preview`,
      { method: 'POST', body: { target: target.value, source: source.value === 'sheets' ? 'google' : source.value, rows: rows.value } }
    )
    const p = res.data?.preview
    const errorByRow = new Map((p?.errors || []).map(e => [e.row, e.message]))
    const idField = targetDef.value?.identifierField
    previewResults.value = (p?.items || []).map((item, i) => {
      const rowIndex = (item._rowIndex as number | undefined) ?? i
      return {
        index: rowIndex,
        ok: !item._hasError && !errorByRow.has(rowIndex),
        action: item._isNew ? 'create' : 'update',
        identifier: idField ? String(item[idField] ?? '') : undefined,
        error: errorByRow.get(rowIndex)
      }
    })
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    previewing.value = false
  }
}

async function executeImport() {
  running.value = true
  try {
    const res = await hubFetch<{ success: boolean, data: RunResult }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/import/run`,
      { method: 'POST', body: { target: target.value, source: source.value === 'sheets' ? 'google' : source.value, rows: rows.value } }
    )
    runResult.value = res.data
    previewResults.value = null
    isRunOpen.value = false
    const r = res.data
    if (r.failed) toast.add({ title: t('import.resultSummary', [r.created, r.updated, r.failed]), color: 'error' })
    else toast.add({ title: t('import.resultSummary', [r.created, r.updated, r.failed]), icon: 'i-lucide-check', color: 'success' })
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    running.value = false
  }
}

function actionBadge(r: RowResult | undefined) {
  if (!r) return null
  if (!r.ok) return { label: t('import.failed'), color: 'error' as const }
  if (r.action === 'create') return { label: t('import.create'), color: 'info' as const }
  return { label: t('import.update'), color: 'warning' as const }
}

function clearAll() {
  rows.value = []
  sourceLabel.value = ''
  previewResults.value = null
  runResult.value = null
  pasteText.value = ''
}
</script>

<template>
  <BasePage id="admin-import" :title="$t('import.title')">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          v-if="rows.length"
          icon="i-lucide-x"
          :label="t('import.clear')"
          variant="soft"
          size="sm"
          :ui="{ label: 'hidden md:block' }"
          @click="clearAll"
        />
      </div>
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6 gap-4 max-w-5xl">
      <p class="text-sm text-muted">
        {{ $t('import.description') }}
      </p>

      <section class="rounded-xl border border-primary/30 p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <h2 class="font-semibold text-highlighted flex items-center gap-2">
            <UIcon name="i-lucide-database" class="size-4 text-muted" />
            {{ t('import.sourceTitle') }}
          </h2>
          <USelect
            v-model="source"
            :items="sourceItems"
            value-key="value"
            size="sm"
            class="w-44"
            :aria-label="t('import.sourceType')"
          />
        </div>

        <div v-if="source === 'csv' || source === 'json'">
          <input
            type="file"
            :accept="source === 'csv' ? '.csv,text/csv' : '.json,application/json'"
            class="block text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-elevated file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-highlighted hover:file:bg-elevated/70"
            :disabled="parsing"
            @change="e => handleFile(e, source as 'csv' | 'json')"
          >
        </div>

        <div v-else-if="source === 'paste'" class="space-y-2">
          <UTextarea
            v-model="pasteText"
            :placeholder="t('import.pastePlaceholder')"
            :rows="6"
            class="w-full font-mono text-xs"
          />
          <UButton
            :label="t('common.confirm')"
            size="sm"
            variant="soft"
            @click="parsePaste"
          />
        </div>

        <div v-else class="space-y-2">
          <p class="text-xs text-muted">
            {{ t('import.needGoogle') }}
          </p>
          <div class="flex flex-col sm:flex-row gap-2">
            <UInput
              v-model="sheetId"
              :placeholder="t('import.sheetIdPlaceholder')"
              class="flex-1 font-mono text-xs"
              size="sm"
            />
            <UInput
              v-model="sheetRange"
              :placeholder="t('import.sheetRangePlaceholder')"
              class="flex-1 font-mono text-xs"
              size="sm"
            />
            <UButton
              :label="t('import.fetchSheet')"
              icon="i-lucide-cloud-download"
              size="sm"
              :loading="fetchingSheet"
              @click="fetchSheet"
            />
          </div>
        </div>

        <div v-if="rows.length" class="flex items-center gap-2 flex-wrap text-xs">
          <UBadge
            :label="t('import.parsed', [rows.length])"
            color="success"
            variant="subtle"
            size="sm"
          />
          <span v-if="sourceLabel" class="text-muted truncate max-w-60">{{ sourceLabel }}</span>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-toned">{{ t('import.columns') }}:</span>
            <UBadge
              v-for="col in Object.keys(rows[0] || {})"
              :key="col"
              :label="col"
              variant="subtle"
              size="xs"
            />
          </div>
        </div>
      </section>

      <section class="rounded-xl border border-primary/30 p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <h2 class="font-semibold text-highlighted flex items-center gap-2">
            <UIcon name="i-lucide-crosshair" class="size-4 text-muted" />
            {{ t('import.target') }}
          </h2>
          <USelect
            v-model="target"
            :items="targetItems"
            value-key="value"
            size="sm"
            class="w-44"
            :aria-label="t('import.target')"
          />
        </div>
        <div v-if="targetDef" class="text-xs text-muted space-y-1.5">
          <p class="flex items-center gap-1 flex-wrap">
            <span class="text-toned">ID:</span>
            <UBadge :label="targetDef.identifierField" variant="outline" size="xs" />
            <span class="text-toned ml-2">Required:</span>
            <UBadge
              v-for="f in targetDef.requiredFields"
              :key="f"
              :label="f"
              color="warning"
              variant="subtle"
              size="xs"
            />
          </p>
          <p class="flex items-center gap-1 flex-wrap">
            <span class="text-toned">Optional:</span>
            <UBadge
              v-for="f in targetDef.optionalFields"
              :key="f"
              :label="f"
              variant="subtle"
              size="xs"
            />
          </p>
        </div>
      </section>

      <section class="rounded-xl border border-primary/30 p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <h2 class="font-semibold text-highlighted flex items-center gap-2">
            <UIcon name="i-lucide-eye" class="size-4 text-muted" />
            {{ t('import.preview') }}
          </h2>
          <div class="flex items-center gap-2">
            <UButton
              :label="t('import.preview')"
              icon="i-lucide-scan-search"
              size="sm"
              variant="soft"
              :loading="previewing"
              :disabled="!rows.length"
              @click="runPreview"
            />
            <UButton
              :label="t('import.importNow')"
              icon="i-lucide-file-up"
              size="sm"
              color="primary"
              :loading="running"
              :disabled="!rows.length"
              @click="isRunOpen = true"
            />
          </div>
        </div>

        <p v-if="!rows.length" class="text-sm text-muted py-4 text-center">
          {{ t('import.no_rows') }}
        </p>

        <div v-else class="overflow-x-auto -mx-1 px-1">
          <table v-if="previewResults" class="w-full text-xs">
            <thead>
              <tr class="text-left text-toned border-b border-default">
                <th class="py-1.5 pr-2 w-10">
                  #
                </th>
                <th class="py-1.5 pr-2">
                  {{ targetDef?.identifierField }}
                </th>
                <th class="py-1.5 pr-2 w-24">
                  {{ t('common.status') }}
                </th>
                <th class="py-1.5">
                  {{ t('common.error') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in previewResults" :key="r.index" class="border-b border-default/50">
                <td class="py-1.5 pr-2 text-muted">
                  {{ r.index + 1 }}
                </td>
                <td class="py-1.5 pr-2 font-mono text-highlighted">
                  {{ r.identifier || '—' }}
                </td>
                <td class="py-1.5 pr-2">
                  <UBadge
                    v-if="actionBadge(r)"
                    :label="actionBadge(r)!.label"
                    :color="actionBadge(r)!.color"
                    variant="subtle"
                    size="xs"
                  />
                </td>
                <td class="py-1.5 text-error">
                  {{ r.error || '' }}
                </td>
              </tr>
            </tbody>
          </table>

          <div v-else class="text-xs text-muted">
            <p class="py-2">
              {{ t('import.rowLimit') }} — {{ rows.length }} {{ t('import.rows').toLowerCase() }}
            </p>
            <div class="max-h-64 overflow-y-auto rounded-lg border border-default divide-y divide-default/50">
              <div v-for="(row, i) in rows.slice(0, 50)" :key="i" class="px-3 py-2 font-mono text-[11px] truncate">
                {{ JSON.stringify(row) }}
              </div>
            </div>
            <p v-if="rows.length > 50" class="pt-1 text-toned">
              … {{ rows.length - 50 }}
            </p>
          </div>
        </div>

        <div
          v-if="runResult"
          class="rounded-lg border p-3 text-sm space-y-2"
          :class="runResult.failed ? 'border-error/40 bg-error/5' : 'border-success/40 bg-success/5'"
        >
          <p class="font-medium text-highlighted">
            {{ t('import.result') }} —
            {{ t('import.resultSummary', [runResult.created, runResult.updated, runResult.failed]) }}
          </p>
          <div v-if="runResult.results.some(r => !r.ok)" class="text-xs text-error space-y-0.5">
            <p v-for="r in runResult.results.filter(rr => !rr.ok)" :key="r.index">
              #{{ r.index + 1 }} {{ r.identifier || '' }} — {{ r.error }}
            </p>
          </div>
        </div>
      </section>
    </div>

    <LazyBaseConfirmModal
      v-model:open="isRunOpen"
      :title="t('import.confirmTitle')"
      :description="t('import.confirmDesc', [rows.length, target])"
      :confirm-label="t('import.importNow')"
      :cancel-label="t('common.cancel')"
      :loading="running"
      color="primary"
      icon="i-lucide-file-up"
      @confirm="executeImport"
    />
  </BasePage>
</template>
