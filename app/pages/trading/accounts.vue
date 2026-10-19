<script setup lang="ts">
import type { AccountItem } from '~~/types/accounts'
import type { PaperAccountSummary } from '~/composables/usePaperAccounts'
import { getErrorMessage } from '~/shared/utils/errors'
import type { MetricItem } from '~/components/MetricRibbon.vue'

// =============================================================================
//  Accounts (roadmap §61.17 Phase B). Two complementary views:
//   1. MANAGED paper accounts — the durable `paper_accounts` SPEC rows: create,
//      rename, archive/un-archive and delete (empty books only). Owner-scoped
//      server-side; a foreign id simply resolves to "not found".
//   2. DERIVED activity — open/closed/realized per account, read from positions
//      (never a second ledger — D12).
// =============================================================================
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'accounts.title',
  descKey: 'accounts.desc'
})
const accountsApi = useAccounts()
const paper = usePaperAccounts()
const { version: workspaceVersion } = useTradingWorkspace()

// ── 1. Managed paper accounts (CRUD) ────────────────────────────────────────
const managed = ref<PaperAccountSummary[]>([])
const managedMongoDown = ref(false)
const managedLoading = ref(false)
const { loading: isLoading, error: loadError, hasError, isStale, run } = useResourceState()

async function fetchManaged() {
  const res = await paper.accounts()
  managed.value = res.items
  managedMongoDown.value = res.mongo === 'down'
}

/** CRUD follow-up reload: only the managed list, with its own busy flag. */
async function reloadManaged() {
  managedLoading.value = true
  try {
    await fetchManaged()
  } catch (err) {
    notify.error(t('accounts.title'), getErrorMessage(err, key => t(key)))
  } finally {
    managedLoading.value = false
  }
}

const createOpen = ref(false)
const createForm = reactive({ accountId: '', currency: 'USDT', initialBalance: '' })
const creating = ref(false)

function openCreate() {
  createForm.accountId = ''
  createForm.currency = 'USDT'
  createForm.initialBalance = ''
  createOpen.value = true
}

async function submitCreate() {
  creating.value = true
  try {
    const balance = createForm.initialBalance.trim() === '' ? undefined : Number(createForm.initialBalance)
    await paper.create({
      accountId: createForm.accountId.trim(),
      currency: createForm.currency.trim() || undefined,
      initialBalance: Number.isFinite(balance) ? balance : undefined
    })
    notify.success(t('accounts.create'), t('accounts.createOk', { id: createForm.accountId.trim() }))
    createOpen.value = false
    await reloadManaged()
  } catch (err) {
    notify.error(t('accounts.create'), getErrorMessage(err, key => t(key)))
  } finally {
    creating.value = false
  }
}

const renameTarget = ref<PaperAccountSummary | null>(null)
const renameValue = ref('')
const renaming = ref(false)

function askRename(a: PaperAccountSummary) {
  renameTarget.value = a
  renameValue.value = a.accountId
}

async function submitRename() {
  const target = renameTarget.value
  if (!target) return
  renaming.value = true
  try {
    await paper.update(target.accountId, { accountId: renameValue.value.trim() })
    notify.success(t('accounts.rename'), t('accounts.renameOk', { id: renameValue.value.trim() }))
    renameTarget.value = null
    await reloadManaged()
  } catch (err) {
    notify.error(t('accounts.rename'), getErrorMessage(err, key => t(key)))
  } finally {
    renaming.value = false
  }
}

const archiveBusy = ref('')
async function toggleArchive(a: PaperAccountSummary) {
  archiveBusy.value = a.accountId
  try {
    await paper.update(a.accountId, { archived: !a.archived })
    notify.success(
      a.archived ? t('accounts.unarchive') : t('accounts.archive'),
      a.archived ? t('accounts.unarchiveOk', { id: a.accountId }) : t('accounts.archiveOk', { id: a.accountId })
    )
    await reloadManaged()
  } catch (err) {
    notify.error(t('accounts.title'), getErrorMessage(err, key => t(key)))
  } finally {
    archiveBusy.value = ''
  }
}

const deleteTarget = ref<PaperAccountSummary | null>(null)
const deleting = ref(false)

async function submitDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleting.value = true
  try {
    await paper.remove(target.accountId)
    notify.success(t('accounts.remove'), t('accounts.removeOk', { id: target.accountId }))
    deleteTarget.value = null
    await reloadManaged()
  } catch (err) {
    notify.error(t('accounts.remove'), getErrorMessage(err, key => t(key)))
  } finally {
    deleting.value = false
  }
}

// ── 2. Derived activity (read-only) ─────────────────────────────────────────
const items = ref<AccountItem[]>([])
const mongoDown = ref(false)

async function fetchActivity() {
  const res = await accountsApi.list()
  items.value = res.items
  mongoDown.value = res.meta?.mongo === 'down'
}

async function refreshAll() {
  await run(async () => { await Promise.all([fetchManaged(), fetchActivity()]) })
  if (hasError.value) notify.error(t('accounts.title'), getErrorMessage(loadError.value, key => t(key)))
}

onMounted(refreshAll)
// §61.17 Phase C: account lifecycle events from anywhere (another tab, the API)
// reconcile this list without a hard refresh.
watch(workspaceVersion('accounts'), refreshAll)

const fmtMoney = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`
const moneyClass = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? 'text-dimmed' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted'
const fmtNum = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US') : '—')

/** ISO -> "YYYY-MM-DD HH:mm UTC" (never machine timezone — D2). */
function fmtUtc(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const metrics = computed<MetricItem[]>(() => {
  const sumRealized = items.value.some(a => a.realizedPnlAbs != null)
    ? items.value.reduce((s, a) => s + (a.realizedPnlAbs ?? 0), 0)
    : null
  const active = managed.value.filter(a => !a.archived).length
  return [
    { key: 'accounts', label: t('accounts.statAccounts'), value: String(active), icon: 'i-lucide-wallet', tone: 'primary' },
    { key: 'open', label: t('accounts.statOpen'), value: String(items.value.reduce((s, a) => s + a.open, 0)), icon: 'i-lucide-layers', tone: 'success' },
    { key: 'closed', label: t('accounts.statClosed'), value: String(items.value.reduce((s, a) => s + a.closed, 0)), icon: 'i-lucide-archive' },
    { key: 'realized', label: t('accounts.statRealized'), value: fmtMoney(sumRealized), icon: 'i-lucide-trending-up', tone: sumRealized == null ? 'default' : sumRealized > 0 ? 'success' : sumRealized < 0 ? 'error' : 'default' }
  ]
})

const trail = computed(() => [{ label: t('nav.trading') }, { label: title.value }])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-plus', label: t('accounts.create'), onSelect: openCreate },
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: refreshAll }
]))
mobileBar.registerInfo(computed(() => ({
  count: managed.value.length,
  hasMore: false,
  loading: isLoading.value || managedLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="accounts" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('accounts.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="mongoDown || managedMongoDown"
          :label="t('accounts.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-plus"
          :label="t('accounts.create')"
          variant="soft"
          color="primary"
          size="sm"
          @click="openCreate"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading || managedLoading"
          @click="refreshAll"
        />
      </div>
    </template>

    <div class="flex flex-col w-full gap-3 pb-24 lg:pb-6">
      <MetricRibbon :items="metrics" />

      <SharedRefreshNotice
        :stale="isStale"
        :retrying="isLoading"
        :message="t('common.staleData')"
        @retry="refreshAll"
      />

      <!-- Create account -->
      <div v-if="createOpen" class="rounded bg-default ring ring-primary/40 p-3 flex flex-col gap-3">
        <p class="text-xs font-semibold text-highlighted">{{ t('accounts.createTitle') }}</p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <UInput
            v-model="createForm.accountId"
            :placeholder="t('accounts.accountIdPlaceholder')"
            :aria-label="t('accounts.accountId')"
            size="sm"
            class="w-full"
          />
          <UInput
            v-model="createForm.currency"
            :placeholder="t('accounts.currency')"
            :aria-label="t('accounts.currency')"
            size="sm"
            class="w-full"
          />
          <UInput
            v-model="createForm.initialBalance"
            type="number"
            :placeholder="t('accounts.initialBalancePlaceholder')"
            :aria-label="t('accounts.initialBalance')"
            size="sm"
            class="w-full"
          />
        </div>
        <div class="flex items-center gap-2">
          <UButton
            :label="t('accounts.createSubmit')"
            color="primary"
            variant="soft"
            size="sm"
            :loading="creating"
            :disabled="!createForm.accountId.trim()"
            @click="submitCreate"
          />
          <UButton
            :label="t('common.cancel')"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="createOpen = false"
          />
        </div>
      </div>

      <!-- Managed paper accounts -->
      <div class="rounded bg-default ring ring-default p-3 flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-highlighted">{{ t('accounts.manageTitle') }}</p>
            <p class="text-[11px] text-muted">{{ t('accounts.manageHint') }}</p>
          </div>
          <UBadge :label="String(managed.length)" color="neutral" variant="subtle" size="xs" />
        </div>

        <div v-if="managed.length" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          <article
            v-for="a in managed"
            :key="a.accountId"
            class="rounded bg-elevated/50 p-2.5 flex flex-col gap-2"
            :class="a.archived ? 'opacity-60' : ''"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold text-highlighted truncate font-mono">{{ a.accountId }}</span>
              <UBadge
                :label="a.archived ? t('accounts.archivedBadge') : t('accounts.activeBadge')"
                :color="a.archived ? 'neutral' : 'success'"
                variant="subtle"
                size="xs"
              />
            </div>
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <span class="text-muted">{{ t('accounts.mode') }}</span>
              <span class="font-mono text-dimmed">{{ a.mode }}</span>
            </div>
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <span class="text-muted">{{ t('accounts.initialBalance') }}</span>
              <span class="font-mono text-dimmed">{{ fmtNum(a.initialBalance) }} {{ a.currency }}</span>
            </div>
            <div class="flex items-center gap-1.5 pt-1">
              <UButton
                icon="i-lucide-pencil"
                :label="t('accounts.rename')"
                variant="ghost"
                color="neutral"
                size="xs"
                :disabled="a.archived"
                @click="askRename(a)"
              />
              <UButton
                :icon="a.archived ? 'i-lucide-archive-restore' : 'i-lucide-archive'"
                :label="a.archived ? t('accounts.unarchive') : t('accounts.archive')"
                variant="ghost"
                color="neutral"
                size="xs"
                :loading="archiveBusy === a.accountId"
                @click="toggleArchive(a)"
              />
              <UButton
                icon="i-lucide-trash-2"
                :label="t('accounts.remove')"
                variant="ghost"
                color="error"
                size="xs"
                @click="deleteTarget = a"
              />
            </div>
          </article>
        </div>

        <AdminEmptyState
          v-else-if="hasError"
          :title="t('common.loadErrorTitle')"
          :description="t('common.loadErrorHint')"
          icon="i-lucide-triangle-alert"
          :actions="[{ label: t('common.retry'), icon: 'i-lucide-refresh-cw', color: 'warning', onClick: refreshAll }]"
        />
        <AdminEmptyState
          v-else-if="!managedLoading"
          :title="t('accounts.noManaged')"
          :description="t('accounts.noManagedHint')"
          icon="i-lucide-wallet"
        />
      </div>

      <!-- Rename confirm -->
      <div v-if="renameTarget" class="rounded bg-default ring ring-primary/40 p-3 flex flex-col gap-3">
        <p class="text-xs font-semibold text-highlighted">{{ t('accounts.renameTitle', { id: renameTarget.accountId }) }}</p>
        <UInput
          v-model="renameValue"
          :placeholder="t('accounts.accountIdPlaceholder')"
          :aria-label="t('accounts.accountId')"
          size="sm"
          class="w-full sm:w-64"
        />
        <div class="flex items-center gap-2">
          <UButton
            :label="t('accounts.renameSubmit')"
            color="primary"
            variant="soft"
            size="sm"
            :loading="renaming"
            :disabled="!renameValue.trim()"
            @click="submitRename"
          />
          <UButton :label="t('common.cancel')" variant="ghost" color="neutral" size="sm" @click="renameTarget = null" />
        </div>
      </div>

      <!-- Delete confirm -->
      <div v-if="deleteTarget" class="rounded bg-default ring ring-error/50 p-3">
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-trash-2"
          :title="t('accounts.removeTitle', { id: deleteTarget.accountId })"
          :description="t('accounts.removeHint')"
          :actions="[
            { label: t('accounts.removeSubmit'), color: 'error', variant: 'solid', loading: deleting, onClick: submitDelete },
            { label: t('common.cancel'), variant: 'ghost', color: 'neutral', onClick: () => { deleteTarget = null } }
          ]"
        />
      </div>

      <!-- Derived activity -->
      <div class="flex items-center justify-between gap-2 pt-1">
        <p class="text-xs font-semibold text-highlighted">{{ t('accounts.activityTitle') }}</p>
      </div>

      <div
        v-if="items.length"
        class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
      >
        <article
          v-for="a in items"
          :key="a.account"
          class="rounded bg-default ring ring-default p-3 flex flex-col gap-3"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold text-highlighted truncate font-mono">{{ a.account }}</span>
            <div class="flex flex-wrap gap-1 justify-end">
              <UBadge
                v-for="s in a.sources"
                :key="s"
                :label="s"
                color="neutral"
                variant="subtle"
                size="xs"
              />
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div class="rounded bg-elevated/50 px-2 py-1.5">
              <p class="text-[10px] text-muted uppercase tracking-wide">{{ t('accounts.labelOpen') }}</p>
              <p class="text-sm font-bold font-mono" :class="a.open > 0 ? 'text-success' : 'text-highlighted'">{{ a.open }}</p>
            </div>
            <div class="rounded bg-elevated/50 px-2 py-1.5">
              <p class="text-[10px] text-muted uppercase tracking-wide">{{ t('accounts.labelClosed') }}</p>
              <p class="text-sm font-bold font-mono text-highlighted">{{ a.closed }}</p>
            </div>
            <div class="rounded bg-elevated/50 px-2 py-1.5">
              <p class="text-[10px] text-muted uppercase tracking-wide">{{ t('accounts.labelCancelled') }}</p>
              <p class="text-sm font-bold font-mono text-dimmed">{{ a.cancelled }}</p>
            </div>
          </div>

          <div class="flex flex-col gap-1.5 text-[11px]">
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted">{{ t('accounts.labelRealized') }}</span>
              <span class="font-mono font-semibold" :class="moneyClass(a.realizedPnlAbs)">{{ fmtMoney(a.realizedPnlAbs) }}</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted">{{ t('accounts.labelEquity') }}</span>
              <span class="font-mono" :class="a.latestEquity != null ? 'text-highlighted' : 'text-dimmed'">
                {{ a.latestEquity != null ? fmtNum(a.latestEquity) : t('accounts.noSnapshot') }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted">{{ t('accounts.labelLastActivity') }}</span>
              <span class="font-mono text-dimmed">{{ fmtUtc(a.lastActivityAt) }}</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted">{{ t('accounts.labelFirstEntry') }}</span>
              <span class="font-mono text-dimmed">{{ fmtUtc(a.firstEntryAt) }}</span>
            </div>
          </div>
        </article>
      </div>

      <AdminEmptyState
        v-if="hasError && !items.length"
        :title="t('common.loadErrorTitle')"
        :description="t('common.loadErrorHint')"
        icon="i-lucide-triangle-alert"
        :actions="[{ label: t('common.retry'), icon: 'i-lucide-refresh-cw', color: 'warning', onClick: refreshAll }]"
      />
      <AdminEmptyState
        v-else-if="!isLoading && !items.length"
        :title="t('accounts.empty')"
        :description="t('accounts.emptyHint')"
        icon="i-lucide-wallet"
      />
    </div>
  </BasePage>
</template>
