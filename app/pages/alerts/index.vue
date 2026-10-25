<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { AlertRule, AlertRuleDir } from '#shared/types/alertRules'
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  Alert Rules (roadmap §58.5 /alerts; §58.6 Notifications != Alert Rules).
//
//  The trading-domain rule list: each row is an `alert_rules` doc the alertRules
//  service evaluates against the intel event stream (news/alert). This page OWNS
//  rule definitions only — creating/editing/toggling/deleting conditions. Delivery
//  and dedupe are the shared notify router + notification_logs (see /alerts/history
//  and /alerts/inbox), never a second pipeline here.
// =============================================================================
const { t } = useI18n()
const route = useRoute()
const notify = useNotify()
const api = useAlertRules()

const { title, description } = useAdminPageChrome({
  titleKey: 'alertRules.title',
  descKey: 'alertRules.desc'
})
const { viewMode } = useAdminGridView('alert-rules-view-mode')

const rows = ref<AlertRule[]>([])
const isLoading = ref(false)
const saving = ref(false)
const mongo = ref<'up' | 'down'>('up')
const statusFilter = ref<string>('')

async function refresh() {
  isLoading.value = true
  try {
    const res = await api.list()
    rows.value = res.items
    mongo.value = res.mongo
  } finally {
    isLoading.value = false
  }
}

// Deep link from other modules (e.g. a signal row): /alerts?create=1&symbol=BTCUSDT
// opens the editor prefilled. The query is consumed once, then stripped so a
// reload or back-navigation does not silently reopen the form.
function applyDeepLink(): boolean {
  const q = route.query
  if (!q.create && !q.symbol) return false
  openCreate()
  const rawSymbols = typeof q.symbol === 'string' ? q.symbol.trim().toUpperCase() : ''
  if (rawSymbols) {
    form.value.symbols = rawSymbols
    if (!form.value.name) form.value.name = rawSymbols
  }
  if (typeof q.name === 'string' && q.name.trim()) form.value.name = q.name.trim().slice(0, 120)
  void navigateTo({ path: route.path, replace: true })
  return true
}

onMounted(async () => {
  await refresh()
  applyDeepLink()
})

const filtered = computed(() => {
  if (statusFilter.value === 'enabled') return rows.value.filter((r) => r.enabled)
  if (statusFilter.value === 'disabled') return rows.value.filter((r) => !r.enabled)
  return rows.value
})

const statusChips = computed(() => [
  { value: '', label: t('common.all'), count: rows.value.length },
  { value: 'enabled', label: t('alertRules.filter_enabled'), count: rows.value.filter(r => r.enabled).length },
  { value: 'disabled', label: t('alertRules.filter_disabled'), count: rows.value.filter(r => !r.enabled).length }
])

const metrics = computed(() => {
  const matches = rows.value.reduce((a, r) => a + (r.stats?.matches || 0), 0)
  const enabled = rows.value.filter(r => r.enabled).length
  return [
    { key: 'total', label: t('alertRules.metrics.total'), value: String(rows.value.length), icon: 'i-lucide-shield' },
    { key: 'enabled', label: t('alertRules.metrics.enabled'), value: String(enabled), icon: 'i-lucide-circle-check', tone: 'success' as const },
    { key: 'disabled', label: t('alertRules.metrics.disabled'), value: String(rows.value.length - enabled), icon: 'i-lucide-circle-slash' },
    { key: 'matches', label: t('alertRules.metrics.matches'), value: matches.toLocaleString(), icon: 'i-lucide-activity' }
  ]
})

const trail = computed(() => [
  { label: t('nav.alerts_notifications') },
  { label: title.value }
])

// -------- editor (create / edit) --------
const showEditor = ref(false)
const editing = ref<AlertRule | null>(null)
const form = ref(emptyRuleForm())
const formError = ref('')

const KIND_OPTIONS = RULE_KINDS
const LEVEL_OPTIONS = RULE_LEVELS
const DIR_OPTIONS = RULE_DIRS
const PRIORITY_OPTIONS = RULE_PRIORITIES

const lookbackHours = computed({
  get: () => Math.round(form.value.lookbackSec / 3600),
  set: (v: number) => {
    form.value.lookbackSec = Math.max(0, Math.round(Number(v) || 0)) * 3600
  }
})

function openCreate() {
  editing.value = null
  form.value = emptyRuleForm()
  formError.value = ''
  showEditor.value = true
}

function openEdit(rule: AlertRule) {
  editing.value = rule
  form.value = ruleToForm(rule)
  formError.value = ''
  showEditor.value = true
}

function toggleDir(d: AlertRuleDir) {
  const i = form.value.dirs.indexOf(d)
  if (i >= 0) form.value.dirs.splice(i, 1)
  else form.value.dirs.push(d)
}

async function submit() {
  formError.value = ''
  const v = validateRuleForm(form.value)
  if (!v.ok) {
    formError.value = t(`alertRules.error.${v.error}`)
    return
  }
  saving.value = true
  try {
    const payload = formToInput(form.value)
    if (editing.value) {
      await api.update(editing.value._id, payload)
      notify.success(t('alertRules.updated'))
    } else {
      await api.create(payload)
      notify.success(t('alertRules.created'))
    }
    showEditor.value = false
    await refresh()
  } catch (err) {
    formError.value = getErrorMessage(err, (key) => t(key))
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(rule: AlertRule, value: boolean) {
  const prev = rule.enabled
  rule.enabled = value
  try {
    await api.update(rule._id, { enabled: value })
    notify.success(t(value ? 'alertRules.toggledOn' : 'alertRules.toggledOff'))
  } catch (err) {
    rule.enabled = prev
    notify.error(getErrorMessage(err, (key) => t(key)))
  }
}

// -------- delete --------
const deleteTarget = ref<AlertRule | null>(null)
const isDeleteOpen = ref(false)

function askDelete(rule: AlertRule) {
  deleteTarget.value = rule
  isDeleteOpen.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  try {
    await api.remove(deleteTarget.value._id)
    notify.success(t('alertRules.deleted'))
    isDeleteOpen.value = false
    await refresh()
  } catch (err) {
    notify.error(getErrorMessage(err, (key) => t(key)))
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

const columns = computed<GridColumn[]>(() => [
  { key: 'name', label: t('alertRules.columns.name'), class: 'min-w-48' },
  { key: 'conditions', label: t('alertRules.columns.conditions'), class: 'min-w-72' },
  { key: 'priority', label: t('alertRules.columns.priority'), class: 'w-28' },
  { key: 'enabled', label: t('alertRules.columns.status'), class: 'w-24' },
  { key: 'stats', label: t('alertRules.columns.stats'), class: 'w-44' },
  { key: 'actions', label: '', class: 'w-24' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-plus', label: t('alertRules.create'), onSelect: openCreate },
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refresh }
]))

useHead({ title })
</script>

<template>
  <BasePage id="alerts" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('alertRules.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="mongo === 'down'" :label="t('alertRules.mongoDown')" color="warning" variant="subtle" size="xs" />
        <UBadge v-if="rows.length" :label="t('alertRules.ruleCount', { n: rows.length })" color="neutral" variant="subtle" size="xs" />
        <UButton
          icon="i-lucide-plus"
          :label="t('alertRules.create')"
          variant="soft"
          color="primary"
          size="sm"
          :ui="{ label: 'hidden md:block' }"
          @click="openCreate"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="refresh"
        />
      </div>
    </template>

    <template #toolbar>
      <div class="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2">
        <SharedFilterChips v-model="statusFilter" :items="statusChips" />
        <UButton
          icon="i-lucide-history"
          :label="t('alertRules.historyLink')"
          size="xs"
          variant="ghost"
          color="neutral"
          to="/alerts/history"
          class="ms-auto"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <SharedMetricRibbon :items="metrics" />
      <UAlert
        v-if="mongo === 'down'"
        color="warning"
        variant="subtle"
        icon="i-lucide-database-zap"
        :title="t('alertRules.mongoDown')"
        :description="t('alertRules.emptyMongo')"
      />

      <LazyGridList
        :items="filtered"
        :columns="columns"
        :loading="isLoading"
        :can-load-more="false"
        v-model:view-mode="viewMode"
        item-key="_id"
        storage-key="alert-rules-view-mode"
        @refresh="refresh"
      >
        <template #name="{ item }">
          <div class="flex flex-col">
            <span class="text-xs font-medium text-highlighted truncate">{{ item.name }}</span>
            <span class="text-[10px] font-mono text-dimmed truncate">{{ item.ruleKey }}</span>
          </div>
        </template>

        <template #conditions="{ item }">
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-for="f in ruleFacets(item)"
              :key="`${f.facet}-${f.value}`"
              color="neutral"
              variant="outline"
              size="xs"
            >
              {{ t(`alertRules.facet.${f.facet}`) }}: {{ f.value }}
            </UBadge>
          </div>
        </template>

        <template #priority="{ item }">
          <UBadge :label="t(`alertRules.priority.${item.priority}`)" color="primary" variant="subtle" size="xs" />
        </template>

        <template #enabled="{ item }">
          <USwitch
            :model-value="item.enabled"
            size="sm"
            :aria-label="t('alertRules.columns.status')"
            @update:model-value="(v: boolean) => toggleEnabled(item, v)"
          />
        </template>

        <template #stats="{ item }">
          <div class="flex flex-col text-[11px]">
            <span class="text-highlighted">{{ t('alertRules.stats', { m: item.stats.matches, n: item.stats.notified }) }}</span>
            <span class="text-dimmed">{{ fmtDate(item.stats.lastMatchAt) }}</span>
          </div>
        </template>

        <template #actions="{ item }">
          <div class="flex items-center gap-1">
            <UButton
              icon="i-lucide-pencil"
              variant="ghost"
              color="neutral"
              size="xs"
              :aria-label="t('alertRules.edit')"
              @click="openEdit(item)"
            />
            <UButton
              icon="i-lucide-trash-2"
              variant="ghost"
              color="error"
              size="xs"
              :aria-label="t('alertRules.delete')"
              @click="askDelete(item)"
            />
          </div>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-highlighted truncate">{{ item.name }}</span>
                <UBadge :label="t(`alertRules.priority.${item.priority}`)" color="primary" variant="subtle" size="xs" class="shrink-0" />
              </div>
              <div class="flex flex-wrap gap-1 mt-1">
                <UBadge
                  v-for="f in ruleFacets(item)"
                  :key="`m-${f.facet}-${f.value}`"
                  color="neutral"
                  variant="outline"
                  size="xs"
                >
                  {{ f.value }}
                </UBadge>
              </div>
            </div>
            <USwitch
              :model-value="item.enabled"
              size="sm"
              :aria-label="t('alertRules.columns.status')"
              @update:model-value="(v: boolean) => toggleEnabled(item, v)"
            />
            <UButton
              icon="i-lucide-pencil"
              variant="ghost"
              color="neutral"
              size="xs"
              :aria-label="t('alertRules.edit')"
              @click="openEdit(item)"
            />
          </div>
        </template>

        <template #empty>
          <AdminEmptyState
            :title="t('alertRules.empty')"
            :description="mongo === 'down' ? t('alertRules.emptyMongo') : t('alertRules.emptyHint')"
            icon="i-lucide-shield-alert"
          />
        </template>
      </LazyGridList>
    </div>

    <UModal v-model:open="showEditor" :title="editing ? t('alertRules.editTitle') : t('alertRules.createTitle')">
      <template #body>
        <div class="space-y-4">
          <div class="space-y-1">
            <label class="text-xs font-medium text-highlighted">{{ t('alertRules.name') }}</label>
            <UInput
              v-model="form.name"
              :placeholder="t('alertRules.namePlaceholder')"
              class="w-full"
              :aria-label="t('alertRules.name')"
            />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-xs font-medium text-highlighted">{{ t('alertRules.kindLabel') }}</label>
              <div class="flex flex-wrap gap-1">
                <UButton
                  v-for="k in KIND_OPTIONS"
                  :key="k"
                  :label="t(`alertRules.kind.${k}`)"
                  size="xs"
                  :color="form.kind === k ? 'primary' : 'neutral'"
                  :variant="form.kind === k ? 'soft' : 'ghost'"
                  @click="form.kind = k"
                />
              </div>
            </div>

            <div class="space-y-1">
              <label class="text-xs font-medium text-highlighted">{{ t('alertRules.priorityLabel') }}</label>
              <div class="flex flex-wrap gap-1">
                <UButton
                  v-for="p in PRIORITY_OPTIONS"
                  :key="p"
                  :label="t(`alertRules.priority.${p}`)"
                  size="xs"
                  :color="form.priority === p ? 'primary' : 'neutral'"
                  :variant="form.priority === p ? 'soft' : 'ghost'"
                  @click="form.priority = p"
                />
              </div>
            </div>
          </div>

          <div v-if="form.kind === 'news'" class="space-y-1">
            <label class="text-xs font-medium text-highlighted">{{ t('alertRules.levelLabel') }}</label>
            <div class="flex flex-wrap gap-1">
              <UButton
                v-for="lv in LEVEL_OPTIONS"
                :key="lv"
                :label="t(`alertRules.level.${lv}`)"
                size="xs"
                :color="form.minLevel === lv ? 'primary' : 'neutral'"
                :variant="form.minLevel === lv ? 'soft' : 'ghost'"
                @click="form.minLevel = lv"
              />
            </div>
          </div>

          <div class="space-y-1">
            <label class="text-xs font-medium text-highlighted">{{ t('alertRules.dirs') }}</label>
            <div class="flex flex-wrap gap-1">
              <UButton
                v-for="d in DIR_OPTIONS"
                :key="d"
                :label="t(`alertRules.dir.${d}`)"
                size="xs"
                :color="form.dirs.includes(d) ? 'primary' : 'neutral'"
                :variant="form.dirs.includes(d) ? 'soft' : 'ghost'"
                @click="toggleDir(d)"
              />
            </div>
            <p class="text-[11px] text-dimmed">{{ t('alertRules.dirsHint') }}</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-xs font-medium text-highlighted">{{ t('alertRules.symbols') }}</label>
              <UInput v-model="form.symbols" :placeholder="t('alertRules.symbolsHint')" class="w-full" :aria-label="t('alertRules.symbols')" />
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-highlighted">{{ t('alertRules.sources') }}</label>
              <UInput v-model="form.sources" :placeholder="t('alertRules.sourcesHint')" class="w-full" :aria-label="t('alertRules.sources')" />
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-highlighted">{{ t('alertRules.tags') }}</label>
              <UInput v-model="form.tags" :placeholder="t('alertRules.tagsHint')" class="w-full" :aria-label="t('alertRules.tags')" />
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-highlighted">{{ t('alertRules.minScore') }}</label>
              <UInput v-model="form.minScore" type="number" :placeholder="t('alertRules.minScoreHint')" class="w-full" :aria-label="t('alertRules.minScore')" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-xs font-medium text-highlighted">{{ t('alertRules.lookback') }}</label>
              <UInput v-model="lookbackHours" type="number" min="0" class="w-full" :aria-label="t('alertRules.lookback')" />
              <p class="text-[11px] text-dimmed">{{ t('alertRules.lookbackHint') }}</p>
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-highlighted">{{ t('alertRules.enabled') }}</label>
              <div class="pt-1">
                <USwitch v-model="form.enabled" />
              </div>
            </div>
          </div>

          <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="formError" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton :label="t('global.cancel')" color="neutral" variant="ghost" :disabled="saving" @click="showEditor = false" />
          <UButton :label="t('alertRules.save')" color="primary" variant="soft" :loading="saving" @click="submit" />
        </div>
      </template>
    </UModal>

    <LazyBaseConfirmModal
      v-model:open="isDeleteOpen"
      :title="t('alertRules.deleteConfirmTitle')"
      :description="t('alertRules.deleteConfirm')"
      @confirm="confirmDelete"
    />
  </BasePage>
</template>
