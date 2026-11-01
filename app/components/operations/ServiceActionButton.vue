<script setup lang="ts">
import { runServiceOperation } from '~/utils/serviceOperation'

// =============================================================================
//  ServiceActionButton — run one supervisor operation and follow it to a
//  terminal state (V4.2 §17.7–§17.8).
//
//  The button never reports success on acceptance. A control command returns
//  `202` + `operationId`, so it polls the operation and only then shows an
//  outcome. While it moves it shows the PHASE (starting, awaiting-readiness,
//  draining …), so a slow drain is visible instead of a dead spinner.
//
//  The polling loop itself lives in `~/utils/serviceOperation` and is shared with
//  the row context menu, so every surface reports the same way.
// =============================================================================

type ButtonColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

const props = withDefaults(defineProps<{
  serviceId: string
  action: string
  label: string
  icon?: string
  color?: ButtonColor
  variant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'link' | 'subtle'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  disabled?: boolean
  block?: boolean
}>(), {
  icon: undefined,
  color: 'neutral',
  variant: 'soft',
  size: 'xs',
  disabled: false,
  block: false,
})

const emit = defineEmits<{ (e: 'finished', result: { state: string } | null): void }>()

const { t } = useI18n()
const notify = useNotify()
const api = useOperations()

const inFlight = ref(false)
const phase = ref<string | null>(null)
let controller: AbortController | null = null

onUnmounted(() => controller?.abort())

const actionLabel = computed(() => t(`operations.services.actions.${props.action}`))
const phaseLabel = computed(() => (phase.value ? t(`operations.services.phase.${phase.value}`) : t('operations.services.phase.queued')))
const buttonLabel = computed(() => (inFlight.value ? `${actionLabel.value} · ${phaseLabel.value}` : props.label))
const target = computed(() => `${props.serviceId} · ${actionLabel.value}`)

async function run() {
  if (inFlight.value || props.disabled) return
  inFlight.value = true
  controller = new AbortController()
  try {
    const result = await runServiceOperation({
      serviceId: props.serviceId,
      action: props.action,
      request: (serviceId, action) => api.command(serviceId, action),
      fetchOperation: operationId => api.operation(operationId),
      onAccepted: () => notify.info(t('operations.services.result.accepted'), target.value),
      onPhase: (value) => { phase.value = value },
      signal: controller.signal,
    })

    if (result.state === 'SUCCEEDED') {
      notify.success(t('operations.services.result.succeeded'), target.value)
    } else if (result.state === 'UNCONFIRMED') {
      // The deadline passed without proof: never present this as success.
      notify.warning(t('operations.services.result.unconfirmed'), target.value)
    } else if (result.state === 'CANCELLED') {
      // The view was closed mid-operation; stay quiet and let the next snapshot speak.
    } else {
      notify.error(t('operations.services.result.failed'), result.error || target.value)
    }

    emit('finished', result.state === 'CANCELLED' ? null : result)
  } catch (error) {
    const detail = (error as { data?: { message?: string, statusMessage?: string } })?.data
    notify.error(t('operations.services.result.rejected'), detail?.message || detail?.statusMessage || '')
    emit('finished', null)
  } finally {
    inFlight.value = false
    controller = null
  }
}

</script>

<template>
  <UButton
    :label="buttonLabel"
    :icon="inFlight ? undefined : icon"
    :loading="inFlight"
    :color="color"
    :variant="variant"
    :size="size"
    :disabled="disabled || inFlight"
    :block="block"
    :title="actionLabel"
    @click.stop="run"
  />
</template>
