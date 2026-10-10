<script setup lang="ts">
import type { AccountItem } from '~~/types/accounts'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'accounts.title',
  descKey: 'accounts.desc'
})
const accountsApi = useAccounts()

const items = ref<AccountItem[]>([])
const mongoDown = ref(false)
const isLoading = ref(false)

async function load() {
  isLoading.value = true
  try {
    const res = await accountsApi.list()
    items.value = res.items
    mongoDown.value = res.meta?.mongo === 'down'
  } catch (err) {
    items.value = []
    notify.error(t('accounts.title'), getErrorMessage(err, key => t(key)))
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

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

const statCards = computed(() => [
  { key: 'accounts', label: t('accounts.statAccounts'), value: String(items.value.length) },
  {
    key: 'open',
    label: t('accounts.statOpen'),
    value: String(items.value.reduce((s, a) => s + a.open, 0))
  },
  {
    key: 'closed',
    label: t('accounts.statClosed'),
    value: String(items.value.reduce((s, a) => s + a.closed, 0))
  },
  {
    key: 'realized',
    label: t('accounts.statRealized'),
    value: fmtMoney(
      items.value.some(a => a.realizedPnlAbs != null)
        ? items.value.reduce((s, a) => s + (a.realizedPnlAbs ?? 0), 0)
        : null
    ),
    money: items.value.some(a => a.realizedPnlAbs != null)
      ? items.value.reduce((s, a) => s + (a.realizedPnlAbs ?? 0), 0)
      : null
  }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))
mobileBar.registerInfo(computed(() => ({
  count: items.value.length,
  hasMore: false,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="accounts" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="mongoDown"
          :label="t('accounts.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="load"
        />
      </div>
    </template>

    <div class="flex flex-col w-full gap-4 pb-24 lg:pb-6">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div
          v-for="c in statCards"
          :key="c.key"
          class="rounded-lg bg-default ring ring-default px-3 py-2 flex flex-col gap-0.5 min-w-0"
        >
          <span class="text-[10px] text-muted uppercase tracking-wider truncate">{{ c.label }}</span>
          <span
            class="text-sm font-bold font-mono truncate"
            :class="'money' in c ? moneyClass(c.money) : 'text-highlighted'"
          >{{ c.value }}</span>
        </div>
      </div>

      <div
        v-if="items.length"
        class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
      >
        <article
          v-for="a in items"
          :key="a.account"
          class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold text-highlighted truncate">{{ a.account }}</span>
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
            <div class="rounded-lg bg-elevated/50 px-2 py-1.5">
              <p class="text-[10px] text-muted uppercase tracking-wide">{{ t('accounts.labelOpen') }}</p>
              <p class="text-sm font-bold font-mono" :class="a.open > 0 ? 'text-success' : 'text-highlighted'">{{ a.open }}</p>
            </div>
            <div class="rounded-lg bg-elevated/50 px-2 py-1.5">
              <p class="text-[10px] text-muted uppercase tracking-wide">{{ t('accounts.labelClosed') }}</p>
              <p class="text-sm font-bold font-mono text-highlighted">{{ a.closed }}</p>
            </div>
            <div class="rounded-lg bg-elevated/50 px-2 py-1.5">
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
        v-if="!isLoading && !items.length"
        :title="t('accounts.empty')"
        :description="t('accounts.emptyHint')"
        icon="i-lucide-wallet"
      />
    </div>
  </BasePage>
</template>
