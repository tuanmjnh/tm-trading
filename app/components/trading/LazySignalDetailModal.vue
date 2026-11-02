<script setup lang="ts">
import type { SignalItem, NativeSignalItem } from '#shared/types/signals'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()

const props = withDefaults(defineProps<{
  modelValue?: boolean
  itemId?: string | null
  source?: 'alerts' | 'engine'
}>(), {
  modelValue: false,
  itemId: null,
  source: 'alerts'
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

const isOpen = computed({
  get: () => props.modelValue ?? false,
  set: (v) => emit('update:modelValue', v)
})

const signalsApi = useSignals()
const nativeApi = useNativeSignals()

const item = ref<SignalItem | NativeSignalItem | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const saving = ref(false)
const transitionForm = ref({
  status: '',
  note: ''
})

watch([isOpen, () => props.itemId], async ([open, id]) => {
  if (!open || !id) {
    item.value = null
    error.value = null
    return
  }
  loading.value = true
  error.value = null
  try {
    const data = props.source === 'engine'
      ? await nativeApi.get(id)
      : await signalsApi.get(id)
    item.value = data
    transitionForm.value = { status: '', note: '' }
  } catch (e: any) {
    error.value = getErrorMessage(e, k => t(k))
    notify.error(t('signals.title'), error.value)
  } finally {
    loading.value = false
  }
}, { immediate: true })

const isEngine = computed(() => props.source === 'engine')
const signal = computed<SignalItem | NativeSignalItem | null>(() => item.value)

const lifecycleLabel = (s: string) => t(`signals.lifecycle_${s}`) || s

const canTransition = computed(() => signal.value?.lifecycleStatus === 'active')

async function submitTransition() {
  if (!signal.value || !transitionForm.value.status) return
  saving.value = true
  try {
    if (isEngine.value) {
      await nativeApi.setLifecycle(String((signal.value as NativeSignalItem).id), transitionForm.value.status, transitionForm.value.note)
    } else {
      await signalsApi.setLifecycle(String((signal.value as SignalItem).id), transitionForm.value.status, transitionForm.value.note)
    }
    if (props.itemId) {
      const data = isEngine.value
        ? await nativeApi.get(props.itemId!)
        : await signalsApi.get(props.itemId!)
      item.value = data
      notify.success(t('signals.title'), t('signals.lifecycleUpdated'))
    }
  } catch (e: unknown) {
    notify.error(t('signals.title'), getErrorMessage(e, k => t(k)))
  } finally {
    saving.value = false
  }
}

const fmtPrice = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'
</script>

<template>
  <LazyBaseResponsiveModal
    v-model="isOpen"
    :title="t('signals.detail_modal_title')"
    :loading="loading"
  >
    <template #default>
      <div v-if="error" class="p-4 text-error">{{ error }}</div>
      <div v-else-if="!signal" class="p-4 text-muted">{{ t('signals.noData') }}</div>
      <div v-else class="space-y-4">
        <!-- Evidence -->
        <div class="space-y-2">
          <h3 class="text-sm font-semibold">{{ t('signals.evidence') }}</h3>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div><span class="text-dimmed">{{ t('signals.time') }}</span><div>{{ signal.ts }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.symbol') }}</span><div>{{ (signal as any).symbol ?? '—' }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.tf') }}</span><div>{{ (signal as any).tf ?? '—' }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.action') }}</span><div>{{ (signal as any).action ?? '—' }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.side') }}</span><div>{{ (signal as any).side ?? '—' }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.price') }}</span><div class="font-mono">{{ fmtPrice((signal as any).price) }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.sl') }}</span><div class="font-mono text-error">{{ fmtPrice((signal as any).sl) }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.tps') }}</span><div class="font-mono text-success">{{ ((signal as any).tps || []).join(' · ') || '—' }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.conf') }}</span><div>{{ (signal as any).conf ?? '—' }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.status') }}</span><div>{{ t(`signals.status_${(signal as SignalItem).status}`) }}</div></div>
          </div>
        </div>

        <!-- Method / Attribution -->
        <div v-if="isEngine" class="space-y-2">
          <h3 class="text-sm font-semibold">{{ t('signals.methodValues') }}</h3>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div><span class="text-dimmed">{{ t('signals.method') }}</span><div>{{ (signal as NativeSignalItem).method }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.strategyVersion') }}</span><div class="font-mono">{{ (signal as NativeSignalItem).attribution?.strategyVersion ?? '—' }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.engineVersion') }}</span><div class="font-mono">{{ (signal as NativeSignalItem).attribution?.engineVersion ?? '—' }}</div></div>
            <div><span class="text-dimmed">{{ t('signals.params') }}</span><div class="font-mono">{{ (signal as NativeSignalItem).attribution?.paramsHash?.slice(0,8) ?? '—' }}</div></div>
          </div>
        </div>

        <!-- Context -->
        <div class="space-y-2">
          <h3 class="text-sm font-semibold">{{ t('signals.context') }}</h3>
          <div class="text-xs text-dimmed">{{ t('signals.contextHint') }}</div>
          <pre class="text-[10px] bg-elevated p-2 rounded overflow-auto">{{ JSON.stringify((signal as any).meta ?? {}, null, 2) }}</pre>
        </div>

        <!-- Lifecycle -->
        <div class="space-y-2">
          <h3 class="text-sm font-semibold">{{ t('signals.detail_modal_history') }}</h3>
          <div class="flex items-center gap-2">
            <UBadge :label="lifecycleLabel(signal.lifecycleStatus)" :variant="signal.lifecycleStatus === 'active' ? 'subtle' : 'soft'" />
            <span class="text-[10px] text-muted">{{ signal.lifecycleAt ? `· ${formatTimeAgo(new Date(signal.lifecycleAt))}` : '' }}</span>
            <span v-if="signal.lifecycleNote" class="text-[10px] text-dimmed">· {{ signal.lifecycleNote }}</span>
          </div>

          <div v-if="canTransition" class="rounded border border-default p-3 space-y-2">
            <label class="text-xs">{{ t('signals.detail_modal_transition') }}</label>
            <USelect class="w-full" v-model="transitionForm.status" :items="[
              { label: t('signals.lifecycle_expired'), value: 'expired' },
              { label: t('signals.lifecycle_invalidated'), value: 'invalidated' },
              { label: t('signals.lifecycle_superseded'), value: 'superseded' }
            ]" :placeholder="t('signals.selectStatus')" />
            <UTextarea class="w-full" v-model="transitionForm.note" :placeholder="t('signals.detail_modal_note')" rows="2" />
            <UButton :loading="saving" :disabled="!transitionForm.status" color="primary" variant="soft" size="sm" @click="submitTransition">
              {{ t('common.save') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </LazyBaseResponsiveModal>
</template>
