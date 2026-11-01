<script setup lang="ts">
import type { OperationsOperationRow, OperationsServiceRow } from '#shared/types/operations'
import { formatTimeAgo } from '@vueuse/core'
import { SERVICE_ACTIONS_UI, isActionDisabled } from '~/utils/serviceActions'

// =============================================================================
//  ServiceDetailDrawer (V4.2 §17.9) — one service, in full.
//
//  Shows the operator everything the supervisor can prove: desired vs observed,
//  the READY / DEGRADED / FAILED verdict, per-rule readiness checks, the A7
//  telemetry sample, the workload of the last cycle, and the operation history.
//  Every field is a read of the API; nothing is recomputed here.
// =============================================================================

const props = withDefaults(defineProps<{
  open: boolean
  service: OperationsServiceRow | null
  operations?: OperationsOperationRow[]
  audit?: Array<Record<string, unknown>>
}>(), {
  operations: () => [],
  audit: () => [],
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'changed'): void
}>()

const { t, te } = useI18n()

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

/** Translate by service id; fall back to the registry label only for an unknown id. */
const title = computed(() => {
  if (!props.service) return ''
  const key = `operations.services.labels.${props.service.serviceId}`
  return te(key) ? t(key) : props.service.label
})

const serviceOperations = computed(() =>
  (props.operations ?? []).filter(operation => operation.serviceId === props.service?.serviceId).slice(0, 20),
)

const serviceAudit = computed(() =>
  (props.audit ?? [])
    .filter(row => row.serviceId === props.service?.serviceId)
    .slice(-20)
    .reverse(),
)

function observedColor(state: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  if (state === 'READY') return 'success'
  if (state === 'DEGRADED') return 'warning'
  if (state === 'FAILED') return 'error'
  if (state === 'STARTING' || state === 'STOPPING') return 'info'
  return 'neutral'
}

function ruleColor(passed: boolean | null): 'success' | 'error' | 'neutral' {
  if (passed === true) return 'success'
  if (passed === false) return 'error'
  return 'neutral'
}

function ruleIcon(passed: boolean | null): string {
  if (passed === true) return 'i-lucide-check'
  if (passed === false) return 'i-lucide-x'
  return 'i-lucide-circle-help'
}

function timeAgo(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return '—'
  return formatTimeAgo(new Date(value))
}

function absolute(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return '—'
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19)
}

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value)} ms`
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

const actionButtons = computed(() => {
  const service = props.service
  if (!service) return []
  // Colour, icon and "is it allowed" are decided in `~/utils/serviceActions`, so
  // the drawer, the row context menu and the swipe actions cannot disagree.
  return SERVICE_ACTIONS_UI
    .filter(meta => (service.supports ?? []).includes(meta.action))
    .map(meta => ({
      action: meta.action,
      icon: meta.icon,
      color: meta.color,
      restricted: isActionDisabled(service, meta.action),
    }))
})

function onFinished() {
  emit('changed')
}
</script>

<template>
  <LazyBaseResponsiveSlideover v-model:open="isOpen" :title="title" side="right">
    <template #header-right>
      <UBadge v-if="service" :color="observedColor(service.observed)" variant="subtle" size="sm"
        :label="t(`operations.services.state.${service.observed}`)" />
    </template>

    <template #body>
      <div v-if="!service" class="text-sm text-muted">{{ t('operations.services.detail.empty') }}</div>

      <div v-else class="space-y-5">
        <!-- Identity -->
        <div class="flex flex-wrap items-center gap-1.5">
          <UBadge color="neutral" variant="subtle" size="xs" :label="t(`operations.services.category.${service.category}`)" />
          <UBadge color="neutral" variant="outline" size="xs" :label="t(`operations.services.scope.${service.scope}`)" />
          <UBadge v-if="service.executionMode" color="neutral" variant="outline" size="xs"
            :label="t(`operations.services.mode.${service.executionMode}`)" />
          <UBadge v-if="service.planned" color="warning" variant="subtle" size="xs"
            :label="t('operations.services.flags.planned')" />
          <UBadge v-if="!service.supervised" color="info" variant="subtle" size="xs"
            :label="t('operations.services.flags.external')" />
          <UBadge v-if="service.drift" color="error" variant="subtle" size="xs"
            :label="t('operations.services.flags.drift')" />
        </div>

        <!-- Overview -->
        <section class="space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-dimmed">
            {{ t('operations.services.detail.overview') }}
          </h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.columns.desired') }}</dt>
              <dd class="font-medium">{{ t(`operations.services.desired.${service.desired}`) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.columns.health') }}</dt>
              <dd class="font-medium">{{ t(`operations.services.health.${service.health}`) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.pid') }}</dt>
              <dd class="font-mono tabular-nums">{{ service.pid ?? '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.generation') }}</dt>
              <dd class="font-mono tabular-nums">{{ service.generation }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.restarts') }}</dt>
              <dd class="font-mono tabular-nums">{{ service.restartCount }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.host') }}</dt>
              <dd class="truncate font-mono">{{ service.host ?? '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.heartbeat') }}</dt>
              <dd :title="absolute(service.lastHeartbeatAt)">{{ timeAgo(service.lastHeartbeatAt) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.lastSuccess') }}</dt>
              <dd :title="absolute(service.lastSuccessAt)">{{ timeAgo(service.lastSuccessAt) }}</dd>
            </div>
          </dl>

          <UAlert v-if="service.lastError" color="error" variant="subtle" icon="i-lucide-alert-circle"
            :title="t('operations.services.detail.lastError')" :description="service.lastError" class="mt-2" />
        </section>

        <!-- Service objectives (V4.2 §17.13) -->
        <section class="space-y-2">
          <h3 class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-dimmed">
            {{ t('operations.services.slo.title') }}
            <OperationsServiceSloBadge :status="service.slo.status" />
          </h3>
          <ul class="space-y-2">
            <li v-for="goal in service.slo.objectives" :key="goal.id" class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-medium text-toned">{{ t(`operations.services.slo.objectives.${goal.id}`) }}</p>
                <p class="truncate text-[11px] text-muted" :title="goal.detail">{{ goal.detail }}</p>
              </div>
              <OperationsServiceSloBadge :status="goal.status" />
            </li>
          </ul>
        </section>

        <!-- Readiness -->
        <section class="space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-dimmed">
            {{ t('operations.services.detail.readiness') }}
          </h3>
          <p v-if="!service.readiness.length" class="text-xs text-muted">
            {{ t('operations.services.detail.noReadiness') }}
          </p>
          <ul v-else class="space-y-1">
            <li v-for="rule in service.readiness" :key="rule.id"
              class="flex items-start gap-2 text-xs rounded border border-default px-2 py-1.5">
              <UIcon :name="ruleIcon(rule.passed)" class="size-4 shrink-0 mt-0.5"
                :class="rule.passed === true ? 'text-success' : rule.passed === false ? 'text-error' : 'text-dimmed'" />
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="font-medium">{{ t(`operations.services.rules.${rule.id}`) }}</span>
                  <UBadge color="neutral" variant="outline" size="xs"
                    :label="rule.required ? t('operations.services.detail.required') : t('operations.services.detail.optional')" />
                </div>
                <p class="text-muted truncate" :title="rule.detail">{{ rule.detail || '—' }}</p>
              </div>
            </li>
          </ul>
        </section>

        <!-- Workload -->
        <section class="space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-dimmed">
            {{ t('operations.services.detail.workload') }}
          </h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.lastDuration') }}</dt>
              <dd class="font-mono tabular-nums">{{ ms(service.workload.lastDurationMs) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.lastOutput') }}</dt>
              <dd class="font-mono tabular-nums">{{ service.workload.lastOutputCount ?? '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.interval') }}</dt>
              <dd class="font-mono tabular-nums">{{ service.intervalSec ? `${service.intervalSec}s` : '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.lease') }}</dt>
              <dd class="truncate font-mono">{{ service.lease?.owner ?? '—' }}</dd>
            </div>
          </dl>
        </section>

        <!-- Control plane (§17.13): how long the last command actually took -->
        <section class="space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-dimmed">
            {{ t('operations.services.detail.controlPlane') }}
          </h3>
          <p v-if="!service.control" class="text-xs text-muted">
            {{ t('operations.services.detail.controlNone') }}
          </p>
          <div v-else class="space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge color="neutral" variant="subtle" size="xs"
                :label="t(`operations.services.actions.${service.control.action}`)" />
              <UBadge
                :color="service.control.state === 'SUCCEEDED' ? 'success' : service.control.state === 'FAILED' ? 'error' : service.control.state === 'UNCONFIRMED' ? 'warning' : 'info'"
                variant="subtle" size="xs" :label="t(`operations.services.operationState.${service.control.state}`)" />
              <span class="text-[11px] text-muted" :title="absolute(service.control.finishedAt)">
                {{ timeAgo(service.control.finishedAt) }}
              </span>
            </div>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div class="flex justify-between gap-2">
                <dt class="text-muted">{{ t('operations.services.detail.controlQueue') }}</dt>
                <dd class="font-mono tabular-nums">{{ ms(service.control.queueMs) }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">{{ t('operations.services.detail.controlRun') }}</dt>
                <dd class="font-mono tabular-nums">{{ ms(service.control.runMs) }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">{{ t('operations.services.detail.controlTotal') }}</dt>
                <dd class="font-mono tabular-nums">{{ ms(service.control.durationMs) }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">{{ t('operations.services.detail.controlOperation') }}</dt>
                <dd class="truncate font-mono" :title="service.control.operationId">{{ service.control.operationId }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <!-- Telemetry (A7) -->
        <section class="space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-dimmed">
            {{ t('operations.services.detail.telemetry') }}
          </h3>
          <p v-if="!service.telemetry" class="text-xs text-muted">
            {{ t('operations.services.detail.noTelemetry') }}
          </p>
          <dl v-else class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.eventLoopP95') }}</dt>
              <dd class="font-mono tabular-nums">{{ ms(service.telemetry.eventLoopDelayMs?.p95) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.eventLoopP99') }}</dt>
              <dd class="font-mono tabular-nums">{{ ms(service.telemetry.eventLoopDelayMs?.p99) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.utilization') }}</dt>
              <dd class="font-mono tabular-nums">{{ pct(service.telemetry.utilization) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.cpu') }}</dt>
              <dd class="font-mono tabular-nums">
                {{ service.telemetry.cpuPercent === null || service.telemetry.cpuPercent === undefined ? '—' : `${service.telemetry.cpuPercent.toFixed(1)}%` }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.heap') }}</dt>
              <dd class="font-mono tabular-nums">{{ service.telemetry.heapUsedMb }} / {{ service.telemetry.heapTotalMb }} MB</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">{{ t('operations.services.detail.rss') }}</dt>
              <dd class="font-mono tabular-nums">{{ service.telemetry.rssMb }} MB</dd>
            </div>
          </dl>
        </section>

        <!-- Activity -->
        <section class="space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-dimmed">
            {{ t('operations.services.detail.activity') }}
          </h3>
          <p v-if="!serviceOperations.length" class="text-xs text-muted">
            {{ t('operations.services.detail.noActivity') }}
          </p>
          <ul v-else class="space-y-1">
            <li v-for="operation in serviceOperations" :key="operation.operationId"
              class="flex items-center justify-between gap-2 rounded border border-default px-2 py-1.5 text-xs">
              <div class="flex items-center gap-2 min-w-0">
                <UBadge color="neutral" variant="subtle" size="xs"
                  :label="t(`operations.services.actions.${operation.action}`)" />
                <span class="truncate font-mono text-muted" :title="operation.operationId">{{ operation.operationId }}</span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-muted">{{ operation.phase ? t(`operations.services.phase.${operation.phase}`) : '' }}</span>
                <UBadge
                  :color="operation.state === 'SUCCEEDED' ? 'success' : operation.state === 'FAILED' ? 'error' : operation.state === 'UNCONFIRMED' ? 'warning' : 'info'"
                  variant="subtle" size="xs" :label="t(`operations.services.operationState.${operation.state}`)" />
              </div>
            </li>
          </ul>

          <div v-if="serviceAudit.length" class="pt-1">
            <h4 class="text-[11px] font-semibold uppercase tracking-wider text-dimmed mb-1">
              {{ t('operations.services.detail.audit') }}
            </h4>
            <ul class="space-y-0.5">
              <li v-for="(row, index) in serviceAudit" :key="String(row.auditId ?? index)"
                class="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span class="truncate">{{ t(`operations.services.audit.${String(row.action)}`) }}</span>
                <span class="shrink-0">{{ timeAgo(Number(row.at)) }}</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </template>

    <template #footer>
      <div v-if="service" class="flex flex-wrap items-center gap-2">
        <OperationsServiceActionButton
          v-for="button in actionButtons"
          :key="button.action"
          :service-id="service.serviceId"
          :action="button.action"
          :label="t(`operations.services.actions.${button.action}`)"
          :icon="button.icon"
          :color="button.color"
          variant="soft"
          size="sm"
          :disabled="button.restricted"
          @finished="onFinished"
        />
      </div>
    </template>
  </LazyBaseResponsiveSlideover>
</template>
