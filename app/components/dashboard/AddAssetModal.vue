<script setup lang="ts">
// Quick edit → Modal (V5.0 §4/§5): adding a symbol is one field and one confirm.
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ symbols: string[] }>()
const emit = defineEmits<{ (e: 'submit', symbol: string): Promise<void> | void }>()

const { t } = useI18n()
const symbol = ref('')
const saving = ref(false)
const error = ref('')

const normalised = computed(() => symbol.value.trim().toUpperCase())

const duplicate = computed(() => props.symbols.includes(normalised.value))
const valid = computed(() => /^[A-Z0-9]{2,20}$/.test(normalised.value) && !duplicate.value)

function reset() {
  symbol.value = ''
  error.value = ''
}

async function submit() {
  if (!valid.value) return
  saving.value = true
  error.value = ''
  try {
    await emit('submit', normalised.value)
    reset()
    open.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

watch(open, (isOpen) => { if (!isOpen) reset() })
</script>

<template>
  <LazyBaseResponsiveModal
    v-model:open="open"
    :title="t('dash.watchlist.add')"
    icon="i-lucide-plus"
    :loading="saving"
  >
    <form class="space-y-3" @submit.prevent="submit">
      <UFormField :label="t('dash.watchlist.symbol')" required :error="duplicate ? t('dash.watchlist.duplicate') : ''">
        <UInput
          v-model="symbol"
          class="w-full"
          placeholder="BTCUSDT"
          autofocus
          :aria-label="t('dash.watchlist.symbol')"
        />
      </UFormField>
      <UAlert v-if="error" color="error" variant="subtle" :title="error" />
    </form>

    <template #footer>
      <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="open = false" />
      <UButton :label="t('common.add')" color="primary" variant="soft" :loading="saving" :disabled="!valid" @click="submit" />
    </template>
  </LazyBaseResponsiveModal>
</template>
