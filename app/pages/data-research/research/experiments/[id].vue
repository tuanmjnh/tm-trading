<script setup lang="ts">
import type { AcceptanceGate, ArmComparison, ArmMetrics, Experiment, ExperimentResearch } from '#shared/types/research'
import { getErrorMessage } from '~/shared/utils/errors'

// Experiment detail (roadmap §58.9 Slice 5, §28). One candidate's full trail:
// its lifecycle history, the four arms scored on the SAME metrics block, the
// §28.2 candidate-vs-baseline comparison and the §28.3 acceptance gate.
//
// The human drives the state machine: a legal forward move per step, and the
// accept/reject decision behind the gate. Accept runs the gate on the SERVER
// (never from this cached view), so a candidate cannot be accepted optimistically.
const { t } = useI18n()
const notify = useNotify()
const route = useRoute()
const api = useResearch()

const experimentId = computed(() => String(route.params.id ?? ''))
const detail = ref<ExperimentResearch | null>(null)
const isLoading = ref(true)

const ARM_ROLES = ['baseline', 'candidate', 'random', 'holdout'] as const
const COMPARE_METRICS = ['winRate', 'profitFactor', 'expectancyR', 'medianR', 'netPct', 'maxDrawdownPct'] as const

// Legal forward edges (mirrors engine/experiment.mjs ALLOWED). `accepted` is
// intentionally absent — acceptance only happens through decide() at the gate.
const NEXT: Record<string, string> = {
  proposed: 'approved',
  approved: 'running',
  running: 'backtested',
  backtested: 'holdout',
  holdout: 'paper_validation'
}

const experiment = computed<Experiment | null>(() => detail.value?.experiment ?? null)
const status = computed(() => experiment.value?.status ?? '')
const isTerminal = computed(() => status.value === 'accepted' || status.value === 'rejected')
const nextState = computed(() => NEXT[status.value] ?? null)
const atGate = computed(() => status.value === 'paper_validation')

const comparison = computed<ArmComparison | null>(() => detail.value?.comparison ?? null)
const acceptance = computed(() => detail.value?.acceptance ?? null)
const gates = computed<AcceptanceGate[]>(() => detail.value?.acceptance?.gates ?? [])

const arms = computed(() => ARM_ROLES.map(role => ({
  role,
  metrics: (experiment.value?.arms?.[role]?.metrics ?? null) as ArmMetrics | null
})))

async function load() {
  isLoading.value = true
  try {
    detail.value = await api.experiment(experimentId.value)
  } finally {
    isLoading.value = false
  }
}
onMounted(load)

// -------- run one arm --------
const runRole = ref<(typeof ARM_ROLES)[number]>('candidate')
const runSymbols = ref('')
const runTimeframes = ref('')
const running = ref(false)

const splitCsv = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean)

async function runArm() {
  running.value = true
  try {
    await api.runArm(experimentId.value, {
      role: runRole.value,
      symbols: splitCsv(runSymbols.value),
      timeframes: splitCsv(runTimeframes.value)
    })
    notify.success(t('research.run.button'))
    await load()
  } catch (err) {
    notify.error(t('research.run.button'), getErrorMessage(err, key => t(key)))
  } finally {
    running.value = false
  }
}

// -------- lifecycle move + decision --------
const acting = ref(false)

async function move(to: string) {
  acting.value = true
  try {
    await api.move(experimentId.value, to)
    await load()
  } catch (err) {
    notify.error(t('research.actions.title'), getErrorMessage(err, key => t(key)))
  } finally {
    acting.value = false
  }
}

async function decide(accept: boolean) {
  acting.value = true
  try {
    await api.decide(experimentId.value, accept, { minTrades: 30 })
    notify.success(accept ? t('research.actions.accept') : t('research.actions.reject'))
    await load()
  } catch (err) {
    notify.error(t('research.gates.title'), getErrorMessage(err, key => t(key)))
    await load()
  } finally {
    acting.value = false
  }
}

// -------- launch the governed paper-validation session (§59.15 Slice E) --------
// The candidate runs in its own live-paper session while the baseline stays
// live; the SERVER refuses unless the experiment is in `paper_validation` and
// the candidate is not already the active version (D31).
const launching = ref(false)
const launchedSessionId = ref<string | null>(null)

async function launchPaperSession() {
  launching.value = true
  try {
    const res = await api.launchPaperSession(experimentId.value, {
      instruments: experiment.value?.recommendedTest?.symbols ?? [],
      timeframes: experiment.value?.recommendedTest?.timeframes ?? [],
      evidenceSetId: experiment.value?.evidenceSetId ?? null
    })
    launchedSessionId.value = String(res.session?.sessionId ?? '') || null
    notify.success(t('research.launch.success'), launchedSessionId.value ?? undefined)
    await load()
  } catch (err) {
    notify.error(t('research.launch.action'), getErrorMessage(err, key => t(key)))
  } finally {
    launching.value = false
  }
}

// -------- formatting --------
const fmtDate = (ts: number | null | undefined) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : '—')
const fmtNum = (v: number | null | undefined, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—')
const fmtPct = (v: number | null | undefined) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')
const fmtDelta = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmtNum(v)}`)
const deltaClass = (v: number | null | undefined) =>
  v == null ? 'text-muted' : v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted'
function statusColor(s: string): 'primary' | 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (s === 'accepted') return 'success'
  if (s === 'rejected') return 'error'
  if (s === 'paper_validation') return 'warning'
  if (s === 'running') return 'primary'
  if (s === 'approved') return 'info'
  return 'neutral'
}

const title = computed(() => experiment.value?.hypothesis ? experiment.value.hypothesis.slice(0, 60) : t('research.detail.title'))
const description = computed(() => experimentId.value)

const trail = computed(() => [
  { label: t('nav.data_research') },
  { label: t('research.experimentsTitle'), to: '/data-research/research/experiments' },
  { label: experimentId.value }
])

useHead({ title })
</script>

<template>
  <BasePage id="research-experiment" :title="title" :description="description">
    <template #eyebrow>
      <BasePageEyebrow :trail="trail" :pip="t('research.pips.detail')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-arrow-left"
          :label="t('research.backToList')"
          variant="soft"
          color="neutral"
          size="sm"
          to="/data-research/research/experiments"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" size="sm" :loading="isLoading" @click="load" />
      </div>
    </template>

    <div v-if="!experiment && !isLoading" class="py-6">
      <AdminEmptyState :title="t('research.detail.noExperiment')" icon="i-lucide-flask-conical" />
    </div>

    <div v-else-if="experiment" class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <!-- Header -->
      <UCard>
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-highlighted">{{ experiment.hypothesis || '—' }}</div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted mt-1.5">
              <span class="font-mono">{{ experimentId }}</span>
              <span v-if="experiment.proposalId">{{ t('research.detail.proposalLabel') }}: <span class="font-mono">{{ experiment.proposalId }}</span></span>
              <span v-if="experiment.strategyVersionId">{{ t('research.detail.strategyVersionLabel') }}: <span class="font-mono">{{ experiment.strategyVersionId }}</span></span>
              <span>{{ t('research.detail.createdLabel') }}: {{ fmtDate(experiment.createdAt) }}</span>
            </div>
          </div>
          <UBadge :label="t(`research.status.${status}`)" :color="statusColor(status)" variant="subtle" size="md" class="shrink-0" />
        </div>
      </UCard>

      <!-- Actions -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-git-branch" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('research.actions.title') }}</h3>
          </div>
        </template>

        <div class="flex items-center gap-2 flex-wrap">
          <template v-if="!isTerminal">
            <UButton
              v-if="nextState"
              icon="i-lucide-arrow-right"
              :label="`${t('research.actions.advanceTo')} ${t(`research.status.${nextState}`)}`"
              color="primary"
              variant="soft"
              size="sm"
              :loading="acting"
              @click="move(nextState)"
            />
            <UButton
              v-if="atGate"
              icon="i-lucide-check"
              :label="t('research.actions.accept')"
              color="success"
              variant="soft"
              size="sm"
              :loading="acting"
              @click="decide(true)"
            />
            <UButton
              icon="i-lucide-x"
              :label="t('research.actions.reject')"
              color="error"
              variant="soft"
              size="sm"
              :loading="acting"
              @click="decide(false)"
            />
            <UButton
              v-if="atGate"
              icon="i-lucide-radio"
              :label="t('research.launch.action')"
              color="warning"
              variant="soft"
              size="sm"
              :loading="launching"
              @click="launchPaperSession"
            />
          </template>
          <span v-else class="text-xs text-dimmed">{{ t('research.actions.terminal') }}</span>
        </div>

        <p class="text-[11px] text-dimmed mt-2">{{ t('research.launch.hint') }}</p>
      </UCard>

      <!-- Provenance: which facts and which baseline (§59.15 Slice E) -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-fingerprint" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('research.provenance.title') }}</h3>
          </div>
        </template>

        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div class="flex items-start justify-between gap-3">
            <dt class="text-muted">{{ t('research.provenance.candidate') }}</dt>
            <dd class="font-mono text-[11px] text-highlighted text-right break-all">{{ experiment.strategyVersionId || '—' }}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-muted">{{ t('research.provenance.baseline') }}</dt>
            <dd class="font-mono text-[11px] text-right break-all" :class="experiment.baselineVersionId ? 'text-highlighted' : 'text-dimmed'">
              {{ experiment.baselineVersionId || t('research.provenance.noBaseline') }}
            </dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-muted">{{ t('research.provenance.evidenceSet') }}</dt>
            <dd class="text-right">
              <UButton
                v-if="experiment.evidenceSetId"
                :label="experiment.evidenceSetId"
                size="xs"
                color="primary"
                variant="soft"
                icon="i-lucide-lock"
                class="font-mono"
                :to="`/data-research/research/evidence/${encodeURIComponent(experiment.evidenceSetId)}`"
              />
              <span v-else class="text-[11px] text-dimmed">{{ t('research.provenance.noEvidence') }}</span>
            </dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-muted">{{ t('research.provenance.paperSessions') }}</dt>
            <dd class="flex flex-wrap gap-1 justify-end">
              <UButton
                v-for="sid in experiment.paperSessionIds ?? []"
                :key="sid"
                :label="sid"
                size="xs"
                color="info"
                variant="soft"
                icon="i-lucide-layers"
                class="font-mono"
                :to="`/sessions/${encodeURIComponent(sid)}`"
              />
              <span v-if="!(experiment.paperSessionIds ?? []).length" class="text-[11px] text-dimmed">
                {{ t('research.provenance.noPaperSessions') }}
              </span>
            </dd>
          </div>
        </dl>
      </UCard>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <!-- History -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-history" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('research.history.title') }}</h3>
            </div>
          </template>
          <ol class="relative border-s border-default ms-2 space-y-3">
            <li v-for="(h, i) in experiment.history ?? []" :key="i" class="ms-4">
              <span class="absolute -start-1.5 mt-1 w-3 h-3 rounded-full bg-primary/70" />
              <div class="text-xs font-semibold text-highlighted">
                {{ h.from ? `${t(`research.status.${h.from}`)} → ${t(`research.status.${h.to}`)}` : t(`research.status.${h.to}`) }}
              </div>
              <time class="text-[10px] text-dimmed">{{ fmtDate(h.at) }}</time>
            </li>
          </ol>
        </UCard>

        <!-- Comparison (§28.2) -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-scale" class="w-4 h-4 text-primary" />
                <h3 class="font-semibold text-sm">{{ t('research.comparison.title') }}</h3>
              </div>
              <UBadge
                v-if="comparison"
                :label="comparison.complete ? t('research.comparison.complete') : t('research.comparison.incomplete')"
                :color="comparison.complete ? 'success' : 'warning'"
                variant="subtle"
                size="xs"
              />
            </div>
          </template>

          <table v-if="comparison" class="w-full text-xs">
            <thead class="bg-muted/50">
              <tr class="text-left text-dimmed">
                <th class="font-medium py-1">{{ t('research.comparison.metric') }}</th>
                <th class="font-medium py-1 text-right">{{ t('research.comparison.baseline') }}</th>
                <th class="font-medium py-1 text-right">{{ t('research.comparison.candidate') }}</th>
                <th class="font-medium py-1 text-right">{{ t('research.comparison.delta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in COMPARE_METRICS" :key="m" class="border-t border-default">
                <td class="py-1 text-muted">{{ t(`research.metrics.${m}`) }}</td>
                <td class="py-1 text-right font-mono text-highlighted">{{ fmtNum(comparison.arms.find(a => a.name === 'baseline')?.metrics?.[m]) }}</td>
                <td class="py-1 text-right font-mono text-highlighted">{{ fmtNum(comparison.arms.find(a => a.name === 'candidate')?.metrics?.[m]) }}</td>
                <td class="py-1 text-right font-mono" :class="deltaClass(comparison.delta[m])">{{ fmtDelta(comparison.delta[m]) }}</td>
              </tr>
            </tbody>
          </table>
          <AdminEmptyState v-else :title="t('research.comparison.empty')" icon="i-lucide-scale" />
        </UCard>
      </div>

      <!-- Arms (§28.2 base set) -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-layers" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('research.arms.title') }}</h3>
          </div>
        </template>

        <div class="overflow-x-auto">
          <table class="w-full text-xs min-w-[720px]">
            <thead class="bg-muted/50">
              <tr class="text-left text-dimmed">
                <th class="font-medium py-1 pe-3">{{ t('research.arms.role') }}</th>
                <th class="font-medium py-1 px-2 text-right">{{ t('research.arms.trades') }}</th>
                <th class="font-medium py-1 px-2 text-right">{{ t('research.arms.winRate') }}</th>
                <th class="font-medium py-1 px-2 text-right">{{ t('research.arms.profitFactor') }}</th>
                <th class="font-medium py-1 px-2 text-right">{{ t('research.arms.expectancy') }}</th>
                <th class="font-medium py-1 px-2 text-right">{{ t('research.arms.net') }}</th>
                <th class="font-medium py-1 ps-2 text-right">{{ t('research.arms.maxDD') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in arms" :key="a.role" class="border-t border-default">
                <td class="py-1 pe-3">
                  <UBadge :label="t(`research.roles.${a.role}`)" color="neutral" variant="subtle" size="xs" class="font-mono" />
                </td>
                <template v-if="a.metrics">
                  <td class="py-1 px-2 text-right font-mono text-highlighted">{{ a.metrics.trades ?? '—' }}</td>
                  <td class="py-1 px-2 text-right font-mono text-highlighted">{{ fmtPct(a.metrics.winRate) }}</td>
                  <td class="py-1 px-2 text-right font-mono text-highlighted">{{ a.metrics.profitFactor === null ? '∞' : fmtNum(a.metrics.profitFactor) }}</td>
                  <td class="py-1 px-2 text-right font-mono" :class="(a.metrics.expectancyR ?? 0) > 0 ? 'text-success' : (a.metrics.expectancyR ?? 0) < 0 ? 'text-error' : 'text-muted'">{{ fmtNum(a.metrics.expectancyR, 3) }}R</td>
                  <td class="py-1 px-2 text-right font-mono text-highlighted">{{ fmtNum(a.metrics.netPct) }}%</td>
                  <td class="py-1 ps-2 text-right font-mono text-muted">{{ fmtNum(a.metrics.maxDrawdownPct) }}%</td>
                </template>
                <td v-else colspan="6" class="py-1 text-dimmed italic">{{ t('research.arms.notRun') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Run an arm -->
        <div class="mt-4 pt-4 border-t border-default flex items-end gap-2 flex-wrap">
          <div class="flex items-center gap-1">
            <UButton
              v-for="r in ARM_ROLES"
              :key="r"
              :label="t(`research.roles.${r}`)"
              size="xs"
              :color="runRole === r ? 'primary' : 'neutral'"
              :variant="runRole === r ? 'soft' : 'ghost'"
              @click="runRole = r"
            />
          </div>
          <UInput v-model="runSymbols" :placeholder="t('research.run.symbolsPlaceholder')" size="xs" class="w-40" :aria-label="t('research.run.symbols')" />
          <UInput v-model="runTimeframes" :placeholder="t('research.run.timeframesPlaceholder')" size="xs" class="w-32" :aria-label="t('research.run.timeframes')" />
          <UButton
            icon="i-lucide-play"
            :label="t('research.run.button')"
            color="primary"
            variant="soft"
            size="sm"
            :loading="running"
            :disabled="isTerminal"
            @click="runArm"
          />
        </div>
      </UCard>

      <!-- Acceptance gates (§28.3) -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-shield-check" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('research.gates.title') }}</h3>
            </div>
            <UBadge
              v-if="acceptance"
              :label="acceptance.ok ? t('research.gates.allPass') : t('research.gates.someFail')"
              :color="acceptance.ok ? 'success' : 'error'"
              variant="subtle"
              size="xs"
            />
          </div>
        </template>

        <ul v-if="gates.length" class="space-y-2">
          <li v-for="g in gates" :key="g.key" class="flex items-start gap-2 text-xs">
            <UIcon
              :name="g.pass ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
              class="w-4 h-4 shrink-0 mt-0.5"
              :class="g.pass ? 'text-success' : 'text-error'"
            />
            <div class="min-w-0">
              <span class="font-medium text-highlighted">{{ t(`research.gateKeys.${g.key}`) }}</span>
              <span v-if="g.detail" class="text-dimmed"> — {{ g.detail }}</span>
            </div>
          </li>
        </ul>
        <AdminEmptyState v-else :title="t('research.gates.empty')" icon="i-lucide-shield-check" />
      </UCard>
    </div>
  </BasePage>
</template>
