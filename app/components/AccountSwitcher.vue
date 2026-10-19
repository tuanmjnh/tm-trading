<script setup lang="ts">
// =============================================================================
//  AccountSwitcher — pick the paper account the trading pages scope to
//  (roadmap §61.17 Phase B). Lists the caller's NON-archived accounts plus an
//  "all accounts" option; writes the choice through useAccountScope(), which
//  orders / positions / fills read as their default filter.
// =============================================================================
const emit = defineEmits<{ (e: 'change', account: string | null): void }>()

const { t } = useI18n()
const accountsApi = usePaperAccounts()
const { account, setAccount } = useAccountScope()

/** Sentinel for "no account filter" — distinct from a real accountId. */
const ALL = '__all__'

const items = ref<{ label: string, value: string }[]>([])
const loading = ref(false)
const mongoDown = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await accountsApi.accounts()
    mongoDown.value = res.mongo === 'down'
    items.value = [
      { label: t('accounts.switcherAll'), value: ALL },
      ...res.items.filter(a => !a.archived).map(a => ({ label: a.accountId, value: a.accountId }))
    ]
  } finally {
    loading.value = false
  }
}
onMounted(load)

const selected = computed({
  get: () => account.value ?? ALL,
  set: (v: string) => {
    const next = v === ALL ? null : v
    setAccount(next)
    emit('change', next)
  }
})

// If the stored account is gone (archived / deleted elsewhere), fall back to All
// so the page is never stuck filtering on an account that no longer exists.
watch(items, (list) => {
  if (!list.length) return
  if (account.value && !list.some(i => i.value === account.value)) setAccount(null)
})

defineExpose({ refresh: load })
</script>

<template>
  <USelectMenu
    v-model="selected"
    :items="items"
    value-key="value"
    :loading="loading"
    :placeholder="t('accounts.switcherLabel')"
    icon="i-lucide-wallet"
    size="sm"
    class="w-40 sm:w-48"
    :aria-label="t('accounts.switcherLabel')"
  />
</template>
